"""A small GeoTIFF reader: just enough for the THEMIS thermal-inertia sheets.

Supports classic TIFF and BigTIFF in either byte order, tiles or strips, samples
stored together per pixel ("chunky"), 8/16/32-bit integers and 32/64-bit floats,
no compression, Deflate or ZSTD (via the ``zstandard`` package), and the
horizontal-differencing predictor. Anything else raises :class:`GeoTiffError`
rather than returning wrong numbers.

``read_tags`` and ``read_window`` take a ``read(offset, length)`` function, so a
cloud-optimised GeoTIFF can be read a few tiles at a time with HTTP range requests.
"""

from __future__ import annotations

import math
import struct
import zlib
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from .scenario import Bounds

_TYPES = {1: ("B", 1), 2: ("s", 1), 3: ("H", 2), 4: ("I", 4), 6: ("b", 1), 7: ("B", 1), 8: ("h", 2), 9: ("i", 4),
          11: ("f", 4), 12: ("d", 8), 16: ("Q", 8), 17: ("q", 8), 18: ("Q", 8)}
Reader = Callable[[int, int], bytes]
_PIXEL_IS_POINT = 2


class GeoTiffError(ValueError):
    """The file is not a GeoTIFF this reader can decode correctly."""


@dataclass(frozen=True)
class GeoTiff:
    bands: np.ndarray  # (samples, rows, cols), row 0 = north
    pixel_scale: Tuple[float, float]  # model units per pixel (x, y)
    tiepoint: Tuple[float, float, float, float, float, float]  # (i, j, k, x, y, z)
    pixel_is_point: bool
    nodata: Optional[str]
    gdal_metadata: str


def _tags(data: bytes) -> Tuple[str, Dict[int, list]]:
    return read_tags(lambda off, n: data[off:off + n])


def read_tags(read: Reader) -> Tuple[str, Dict[int, list]]:
    """Byte order and the first image directory's tags, for classic TIFF or BigTIFF."""
    head = read(0, 16)
    if len(head) < 8 or head[:2] not in (b"II", b"MM"):
        raise GeoTiffError("not a TIFF file")
    bo = "<" if head[:2] == b"II" else ">"
    magic = struct.unpack(bo + "H", head[2:4])[0]
    if magic == 43:
        if len(head) < 16 or struct.unpack(bo + "HH", head[4:8]) != (8, 0):
            raise GeoTiffError("BigTIFF header is not understood")
        off, count_fmt, entry, inline, ptr_fmt = struct.unpack(bo + "Q", head[8:16])[0], "Q", 20, 8, "Q"
    elif magic == 42:
        off, count_fmt, entry, inline, ptr_fmt = struct.unpack(bo + "I", head[4:8])[0], "H", 12, 4, "I"
    else:
        raise GeoTiffError("not a TIFF file")
    csize = struct.calcsize(count_fmt)
    raw_n = read(off, csize)
    if len(raw_n) < csize:
        raise GeoTiffError("TIFF header points past the end of the file")
    n = struct.unpack(bo + count_fmt, raw_n)[0]
    block = read(off + csize, n * entry)
    if len(block) < n * entry:
        raise GeoTiffError("TIFF directory is truncated")
    tags: Dict[int, list] = {}
    for i in range(n):
        e = block[entry * i: entry * (i + 1)]
        tag, typ = struct.unpack(bo + "HH", e[:4])
        count = struct.unpack(bo + ("Q" if magic == 43 else "I"), e[4:entry - inline])[0]
        if typ not in _TYPES:
            continue
        fmt, size = _TYPES[typ]
        total = size * count
        if total <= inline:
            raw = e[entry - inline: entry - inline + total]
        else:
            raw = read(struct.unpack(bo + ptr_fmt, e[entry - inline:])[0], total)
            if len(raw) < total:
                raise GeoTiffError(f"TIFF tag {tag} points past the end of the file")
        if typ == 2:
            tags[tag] = [raw.rstrip(b"\0").decode("latin-1")]
        else:
            tags[tag] = list(struct.unpack(bo + fmt * count, raw))
    return bo, tags


def _decompress(chunk: bytes, compression: int) -> bytes:
    if compression == 1:
        return chunk
    if compression in (8, 32946):
        return zlib.decompress(chunk)
    if compression == 50000:
        try:
            import zstandard
        except ImportError as exc:  # pragma: no cover - dependency is declared in pyproject
            raise GeoTiffError("ZSTD-compressed TIFF needs the 'zstandard' package") from exc
        return zstandard.ZstdDecompressor().decompress(chunk, max_output_size=1 << 28)
    raise GeoTiffError(f"TIFF compression {compression} is not supported")


def _dtype(bo: str, bits: int, sample_format: int) -> np.dtype:
    kind = {1: "u", 2: "i", 3: "f"}.get(sample_format)
    if kind is None or bits not in (8, 16, 32, 64) or (kind == "f" and bits < 32):
        raise GeoTiffError(f"TIFF sample format {sample_format} with {bits} bits is not supported")
    return np.dtype(f"{bo}{kind}{bits // 8}")


def _image(bo: str, t: Dict[int, list]):
    try:
        width, height = t[256][0], t[257][0]
    except KeyError as exc:
        raise GeoTiffError("TIFF has no image size") from exc
    spp = t.get(277, [1])[0]
    bits = t.get(258, [1])
    if len(set(bits)) != 1:
        raise GeoTiffError("TIFF samples of different sizes are not supported")
    if t.get(284, [1])[0] != 1:
        raise GeoTiffError("TIFF with separate sample planes is not supported")
    compression = t.get(259, [1])[0]
    predictor = t.get(317, [1])[0]
    if predictor not in (1, 2):
        raise GeoTiffError(f"TIFF predictor {predictor} is not supported")
    dt = _dtype(bo, bits[0], t.get(339, [1])[0])
    if predictor == 2 and dt.kind == "f":
        raise GeoTiffError("TIFF predictor 2 on floating-point samples is not supported")
    if 322 in t:
        cw, ch = t[322][0], t[323][0]
        offsets, counts = t.get(324), t.get(325)
        across = math.ceil(width / cw)
        layout = [((k // across) * ch, (k % across) * cw, ch, cw) for k in range(len(offsets or []))]
    else:
        rps = t.get(278, [height])[0]
        offsets, counts = t.get(273), t.get(279)
        layout = [(k * rps, 0, min(rps, height - k * rps), width) for k in range(len(offsets or []))]
    expected = math.ceil(height / layout[0][2]) * math.ceil(width / layout[0][3]) if layout else 0
    if not offsets or not counts or len(offsets) != len(counts) or len(offsets) != expected:
        raise GeoTiffError("TIFF chunk tables are missing or inconsistent")
    return width, height, spp, dt, compression, predictor, layout, offsets, counts


def read_window(read: Reader, bo: str, t: Dict[int, list], row0: int, col0: int, rows: int,
                cols: int) -> np.ndarray:
    """Pixels [row0:row0+rows, col0:col0+cols] as (samples, rows, cols), reading only the chunks it needs."""
    width, height, spp, dt, compression, predictor, layout, offsets, counts = _image(bo, t)
    if row0 < 0 or col0 < 0 or rows <= 0 or cols <= 0 or row0 + rows > height or col0 + cols > width:
        raise GeoTiffError(f"window {row0},{col0} {rows}x{cols} is outside the {height}x{width} image")
    out = np.empty((rows, cols, spp), dtype=dt.newbyteorder("="))
    for (r0, c0, ch, cw), off, n in zip(layout, offsets, counts):
        if r0 >= row0 + rows or r0 + ch <= row0 or c0 >= col0 + cols or c0 + cw <= col0:
            continue
        chunk = read(off, n)
        if len(chunk) != n:
            raise GeoTiffError("TIFF chunk runs past the end of the file")
        try:
            raw = _decompress(chunk, compression)
        except GeoTiffError:
            raise
        except Exception as exc:  # corrupt compressed data
            raise GeoTiffError(f"TIFF chunk could not be decompressed: {exc}") from exc
        need = ch * cw * spp * dt.itemsize
        if len(raw) < need:
            raise GeoTiffError("TIFF chunk is shorter than its declared size")
        block = np.frombuffer(raw[:need], dtype=dt).reshape(ch, cw, spp)
        if predictor == 2:
            block = np.cumsum(block, axis=1, dtype=block.dtype)
        ra, rb = max(r0, row0), min(r0 + ch, row0 + rows, height)
        ca, cb = max(c0, col0), min(c0 + cw, col0 + cols, width)
        out[ra - row0:rb - row0, ca - col0:cb - col0] = block[ra - r0:rb - r0, ca - c0:cb - c0]
    return np.ascontiguousarray(np.moveaxis(out, -1, 0))


def georef(t: Dict[int, list]) -> Tuple[Tuple[float, float], Tuple[float, ...], bool]:
    """(pixel_scale, tiepoint, pixel_is_point) from the GeoTIFF tags."""
    scale = t.get(33550)
    tie = t.get(33922)
    if not scale or not tie or len(tie) < 6:
        raise GeoTiffError("TIFF has no georeferencing (ModelPixelScale / ModelTiepoint)")
    keys = t.get(34735, [])
    point = False
    for k in range(4, len(keys) - 3, 4):
        if keys[k] == 1025 and keys[k + 1] == 0:
            point = keys[k + 3] == _PIXEL_IS_POINT
    return (float(scale[0]), float(scale[1])), tuple(float(v) for v in tie[:6]), point


def read_geotiff(data: bytes) -> GeoTiff:
    bo, t = _tags(data)
    width, height = _image(bo, t)[:2]
    bands = read_window(lambda off, n: data[off:off + n], bo, t, 0, 0, height, width)
    scale, tie, point = georef(t)
    return GeoTiff(
        bands=bands, pixel_scale=scale,
        tiepoint=tie,  # type: ignore[arg-type]
        pixel_is_point=point,
        nodata=t[42113][0] if 42113 in t else None,
        gdal_metadata=t[42112][0] if 42112 in t else "",
    )


def equirect_bounds(gt: GeoTiff, radius_m: float) -> Bounds:
    """[W, S, E, N] in degrees for a grid in metres on an equirectangular (centre 0°, standard parallel 0°) sphere."""
    i, j, _, x, y, _ = gt.tiepoint
    sx, sy = gt.pixel_scale
    west, north = x - i * sx, y + j * sy
    if gt.pixel_is_point:  # the tiepoint names a pixel centre, not its corner
        west, north = west - sx / 2, north + sy / 2
    _, h, w = gt.bands.shape
    m_per_deg = radius_m * math.pi / 180.0
    return Bounds(west / m_per_deg, (north - h * sy) / m_per_deg, (west + w * sx) / m_per_deg, north / m_per_deg)


__all__: List[str] = ["GeoTiff", "GeoTiffError", "equirect_bounds", "georef", "read_geotiff", "read_tags",
                      "read_window"]
