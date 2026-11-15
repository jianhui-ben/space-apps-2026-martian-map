import hashlib
from pathlib import Path

import numpy as np
import pytest

from martian_map.pds3 import map_bounds, parse_label, read_image, reproject_to_lonlat, split_attached, verify_md5
from martian_map.scenario import Bounds

FIXTURES = Path(__file__).parent / "fixtures"


def _label_text():
    return (FIXTURES / "themis_pbt_label.txt").read_text()


def test_parse_label_fixture():
    lab = parse_label(_label_text())
    img = lab["IMAGE"]
    assert (img["LINES"], img["LINE_SAMPLES"], img["SAMPLE_TYPE"]) == (7178, 1294, "PC_REAL")
    assert img["ODY:SAMPLE_UNIT"] == "KELVIN"
    proj = lab["IMAGE_MAP_PROJECTION"]
    assert proj["MAP_PROJECTION_TYPE"] == "SINUSOIDAL"
    assert proj["CENTER_LONGITUDE"] == pytest.approx(137.064)
    assert lab["LOCAL_TIME"] == pytest.approx(6.137) and lab["SOLAR_LONGITUDE"] == pytest.approx(168.049)
    assert lab["BAND_CENTER"] == {"value": 12.57, "unit": "MICROMETERS"}
    assert lab["SPACECRAFT_ORIENTATION_DESC"] == ["PITCH", "ROLL", "YAW"]
    assert lab["^IMAGE"] == 2


def _synthetic(null=True):
    label = (
        "PDS_VERSION_ID = PDS3\r\nRECORD_TYPE = FIXED_LENGTH\r\nRECORD_BYTES = 256\r\nLABEL_RECORDS = 2\r\n"
        "^IMAGE = 3\r\nOBJECT = IMAGE\r\n  LINES = 2\r\n  LINE_SAMPLES = 3\r\n  SAMPLE_TYPE = PC_REAL\r\n"
        "  SAMPLE_BITS = 32\r\n" + ("  NULL_CONSTANT = 0\r\n" if null else "") + "  SCALING_FACTOR = 2.0\r\n"
        "  OFFSET = 1.0\r\nEND_OBJECT = IMAGE\r\nEND\r\n"
    ).encode()
    label = label.ljust(512, b" ")
    data = np.array([[1, 2, 0], [4, 5, 6]], dtype="<f4").tobytes()
    return label + data


def test_split_attached():
    text, offset = split_attached(_synthetic())
    assert offset == 512 and text.strip().endswith("END")


def test_read_image_synthetic():
    raw = _synthetic()
    text, _ = split_attached(raw)
    a = read_image(raw, parse_label(text))
    assert a.shape == (2, 3)
    assert a[0, 0] == pytest.approx(3.0)  # 1 * 2 + 1
    assert np.isnan(a[0, 2])  # NULL_CONSTANT 0 before scaling
    assert a[1, 2] == pytest.approx(13.0)


def test_read_image_rejects_multiband():
    raw = _synthetic().replace(b"  LINES = 2\r\n", b"  LINES = 2\r\n  BANDS = 3\r\n", 1)
    text, _ = split_attached(raw)
    with pytest.raises(ValueError, match="BANDS"):
        read_image(raw, parse_label(text))


def test_map_bounds_fixture():
    b = map_bounds(parse_label(_label_text()))
    assert b.contains(137.062, 0.341)  # ODE centre of this product
    assert b.south == pytest.approx(-5.715) and b.north == pytest.approx(6.393)


def test_verify_md5():
    raw = _synthetic()
    text, off = split_attached(raw)
    lab = parse_label(text)
    lab["IMAGE"]["MD5_CHECKSUM"] = hashlib.md5(raw[off:]).hexdigest()
    verify_md5(raw, lab)
    lab["IMAGE"]["MD5_CHECKSUM"] = "0" * 32
    with pytest.raises(ValueError, match="MD5"):
        verify_md5(raw, lab)


def test_reproject_sinusoidal_round_trip():
    # A synthetic sinusoidal image whose value is the pixel's own latitude.
    r_km, scale, lpo, spo, lon0 = 3396.19, 0.1, 50.0, 40.0, 137.0
    rows, cols = 100, 80
    y = (lpo - (np.arange(rows) + 0.5)) * scale
    lat = np.degrees(y / r_km)
    img = np.repeat(lat[:, None], cols, axis=1).astype(np.float32)
    proj = {"MAP_PROJECTION_TYPE": "SINUSOIDAL", "A_AXIS_RADIUS": r_km, "MAP_SCALE": scale,
            "LINE_PROJECTION_OFFSET": lpo, "SAMPLE_PROJECTION_OFFSET": spo, "CENTER_LONGITUDE": lon0,
            "CENTER_LATITUDE": 0.0, "POSITIVE_LONGITUDE_DIRECTION": "EAST"}
    target = Bounds(136.99, -0.03, 137.01, 0.03)
    g = reproject_to_lonlat(img, proj, target, 0.002)
    lats = target.north - (np.arange(g.values.shape[0]) + 0.5) * 0.002
    assert np.allclose(g.values[:, 3], lats, atol=0.0017 + 1e-6)  # within one source pixel (0.1 km)
    outside = reproject_to_lonlat(img, proj, Bounds(140.0, 0.0, 140.01, 0.01), 0.002)
    assert np.isnan(outside.values).all()
