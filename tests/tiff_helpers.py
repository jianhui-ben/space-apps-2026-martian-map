"""Write small GeoTIFFs for tests (classic TIFF, little-endian, tiles or strips, chunky samples)."""

from __future__ import annotations

import struct
import zlib

import numpy as np


def _encode(raw: bytes, compression: int) -> bytes:
    if compression == 1:
        return raw
    if compression == 8:
        return zlib.compress(raw)
    if compression == 50000:
        import zstandard

        return zstandard.ZstdCompressor().compress(raw)
    raise ValueError(compression)


def _predict(block: np.ndarray) -> np.ndarray:
    """Horizontal differencing (TIFF predictor 2) on a (rows, cols, samples) integer block."""
    out = block.copy()
    out[:, 1:, :] = block[:, 1:, :] - block[:, :-1, :]
    return out


def make_geotiff(bands, pixel_scale=(1000.0, 1000.0), tiepoint_xy=(8002000.0, 0.0), compression=50000,
                 predictor=2, tile=(16, 16), nodata="65535", pixel_is_point=False) -> bytes:
    """``bands`` is (samples, rows, cols). ``tile=None`` writes one strip per 4 rows instead of tiles."""
    arr = np.asarray(bands)
    spp, h, w = arr.shape
    pix = np.ascontiguousarray(np.moveaxis(arr, 0, -1))  # rows, cols, samples
    dt = pix.dtype.newbyteorder("<")
    sample_format = 3 if pix.dtype.kind == "f" else (2 if pix.dtype.kind == "i" else 1)
    chunks = []
    if tile:
        th, tw = tile
        for r0 in range(0, h, th):
            for c0 in range(0, w, tw):
                block = np.zeros((th, tw, spp), dtype=pix.dtype)
                part = pix[r0:r0 + th, c0:c0 + tw]
                block[: part.shape[0], : part.shape[1]] = part
                if predictor == 2:
                    block = _predict(block)
                chunks.append(_encode(block.astype(dt).tobytes(), compression))
    else:
        rps = 4
        for r0 in range(0, h, rps):
            block = pix[r0:r0 + rps]
            if predictor == 2:
                block = _predict(block)
            chunks.append(_encode(block.astype(dt).tobytes(), compression))

    entries = []  # (tag, type, values)
    entries += [(256, 3, [w]), (257, 3, [h]), (258, 3, [pix.dtype.itemsize * 8] * spp), (259, 3, [compression]),
                (262, 3, [1]), (277, 3, [spp]), (284, 3, [1]), (317, 3, [predictor]), (339, 3, [sample_format] * spp)]
    if tile:
        entries += [(322, 3, [tile[1]]), (323, 3, [tile[0]]), (324, 4, None), (325, 4, [len(c) for c in chunks])]
    else:
        entries += [(273, 4, None), (278, 3, [4]), (279, 4, [len(c) for c in chunks])]
    entries += [(33550, 12, [pixel_scale[0], pixel_scale[1], 0.0]),
                (33922, 12, [0.0, 0.0, 0.0, tiepoint_xy[0], tiepoint_xy[1], 0.0]),
                (34735, 3, [1, 1, 0, 1, 1025, 0, 1, 2 if pixel_is_point else 1])]
    if nodata is not None:
        entries.append((42113, 2, nodata))
    entries.sort(key=lambda e: e[0])

    fmt = {3: "H", 4: "I", 12: "d"}
    n = len(entries)
    ifd_size = 2 + n * 12 + 4
    data_start = 8 + ifd_size
    extra = bytearray()
    offsets_tag_pos = None
    ifd = bytearray(struct.pack("<H", n))
    pending = []
    for tag, typ, values in entries:
        if typ == 2:
            payload = values.encode("ascii") + b"\0"
            count = len(payload)
        elif values is None:  # chunk offsets, filled in once the layout is known
            count = len(chunks)
            payload = b"\0" * (4 * count)
            offsets_tag_pos = (len(ifd), count)
        else:
            count = len(values)
            payload = struct.pack("<" + fmt[typ] * count, *values)
        if len(payload) <= 4:
            ifd += struct.pack("<HHI", tag, typ, count) + payload.ljust(4, b"\0")
        else:
            pending.append((len(ifd) + 8, len(extra), tag))
            ifd += struct.pack("<HHII", tag, typ, count, 0)
            extra += payload
            if len(extra) % 2:
                extra += b"\0"
    ifd += struct.pack("<I", 0)
    for pos, rel, _ in pending:
        struct.pack_into("<I", ifd, pos, data_start + rel)
    chunk_start = data_start + len(extra)
    offs, o = [], chunk_start
    for c in chunks:
        offs.append(o)
        o += len(c)
    # write the offsets array into its slot (inline or in extra)
    pos, count = offsets_tag_pos
    value_field = pos + 8
    if count == 1:
        struct.pack_into("<I", ifd, value_field, offs[0])
    else:
        rel = struct.unpack_from("<I", ifd, value_field)[0] - data_start
        struct.pack_into("<" + "I" * count, extra, rel, *offs)
    return b"II" + struct.pack("<HI", 42, 8) + bytes(ifd) + bytes(extra) + b"".join(chunks)


def to_bigtiff(classic: bytes) -> bytes:
    """Rewrite a little-endian classic TIFF from ``make_geotiff`` as a BigTIFF with the same pixels and tags."""
    off = struct.unpack_from("<I", classic, 4)[0]
    n = struct.unpack_from("<H", classic, off)[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8}
    entries = []
    for i in range(n):
        tag, typ, count, val = struct.unpack_from("<HHII", classic, off + 2 + 12 * i)
        total = sizes[typ] * count
        raw = classic[off + 10 + 12 * i: off + 10 + 12 * i + total] if total <= 4 else classic[val:val + total]
        entries.append((tag, typ, count, raw))
    first_chunk = min(struct.unpack("<" + "I" * c, r)[0] if t == 4 and tag in (273, 324) else 1 << 62
                      for tag, t, c, r in entries)
    pixels = classic[first_chunk:]
    head_size = 16 + 8 + 20 * n + 8
    extra = bytearray()
    out_entries = []
    for tag, typ, count, raw in entries:
        if tag in (273, 324):  # chunk offsets -> LONG8, shifted to the new pixel position
            typ, raw = 16, b"".join(struct.pack("<Q", v) for v in struct.unpack("<" + "I" * count, raw))
        out_entries.append((tag, typ, count, raw))
    layout = []
    for tag, typ, count, raw in out_entries:
        if len(raw) <= 8:
            layout.append((tag, typ, count, raw, None))
        else:
            layout.append((tag, typ, count, raw, len(extra)))
            extra += raw + (b"\0" if len(raw) % 2 else b"")
    pix_start = head_size + len(extra)
    shift = pix_start - first_chunk
    ifd = bytearray(struct.pack("<Q", n))
    fixed_extra = bytearray(extra)
    for tag, typ, count, raw, rel in layout:
        if tag in (273, 324):
            vals = [v + shift for v in struct.unpack("<" + "Q" * count, raw)]
            raw = struct.pack("<" + "Q" * count, *vals)
            if rel is not None:
                fixed_extra[rel:rel + len(raw)] = raw
        if rel is None:
            ifd += struct.pack("<HHQ", tag, typ, count) + raw.ljust(8, b"\0")
        else:
            ifd += struct.pack("<HHQQ", tag, typ, count, head_size + rel)
    ifd += struct.pack("<Q", 0)
    return b"II" + struct.pack("<HHHQ", 43, 8, 0, 16) + bytes(ifd) + bytes(fixed_extra) + pixels
