import struct
import zlib

import numpy as np

from martian_map.png import colorize, encode_png_rgba, write_overlay
from martian_map.scenario import Bounds


def _chunks(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, out = 8, []
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length : pos + 12 + length])
        assert crc == zlib.crc32(ctype + body) & 0xFFFFFFFF
        out.append((ctype, body))
        pos += 12 + length
    return out


def _decode(data):
    chunks = _chunks(data)
    ihdr = dict(chunks)[b"IHDR"]
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    raw = zlib.decompress(b"".join(b for t, b in chunks if t == b"IDAT"))
    rows = [raw[i * (w * 4 + 1) : (i + 1) * (w * 4 + 1)] for i in range(h)]
    assert all(r[0] == 0 for r in rows)
    pix = np.frombuffer(b"".join(r[1:] for r in rows), dtype=np.uint8).reshape(h, w, 4)
    return w, h, depth, ctype, pix


def test_png_decodes():
    rgba = np.arange(2 * 3 * 4, dtype=np.uint8).reshape(2, 3, 4)
    w, h, depth, ctype, pix = _decode(encode_png_rgba(rgba))
    assert (w, h, depth, ctype) == (3, 2, 8, 6)
    assert np.array_equal(pix, rgba)


def test_colorize_interpolates_and_clamps():
    stops = [(0.0, (0, 0, 0)), (10.0, (200, 100, 0))]
    vals = np.array([[-5.0, 5.0, 20.0]])
    rgba = colorize(vals, stops, np.zeros_like(vals, dtype=bool))
    assert rgba[0, 0].tolist() == [0, 0, 0, 255]
    assert rgba[0, 1].tolist() == [100, 50, 0, 255]
    assert rgba[0, 2].tolist() == [200, 100, 0, 255]


def test_overlay_nodata_transparent(tmp_path):
    vals = np.array([[1.0, np.nan], [3.0, 4.0]])
    mask = np.array([[False, False], [True, False]])
    rec = write_overlay(vals, mask, Bounds(0, 0, 1, 1), tmp_path / "o.png", tmp_path,
                        [(0.0, (0, 0, 0)), (4.0, (255, 255, 255))], "deg")
    _, _, _, _, pix = _decode((tmp_path / "o.png").read_bytes())
    assert pix[0, 0, 3] == 255 and pix[1, 1, 3] == 255
    assert pix[1, 0, 3] == 0  # masked
    assert pix[0, 1, 3] == 0  # NaN is never drawn
    assert rec["bounds"] == [0, 0, 1, 1]
    assert rec["legend"] == {"unit": "deg", "stops": [[0.0, "#000000"], [4.0, "#ffffff"]]}
    assert rec["path"] == "o.png" and rec["format"] == "png"


def test_overlay_decimates(tmp_path):
    vals = np.zeros((100, 5000))
    write_overlay(vals, np.zeros_like(vals, dtype=bool), Bounds(0, 0, 1, 1), tmp_path / "big.png", tmp_path,
                  [(0.0, (0, 0, 0)), (1.0, (1, 1, 1))], "m")
    w, h, _, _, _ = _decode((tmp_path / "big.png").read_bytes())
    assert w <= 2048 and h >= 1
