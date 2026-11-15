import struct

import numpy as np
import pytest

from martian_map.grids import GRID_CRS, Grid, nodata_report, parse_bsq_f32, read_grid, write_grid
from martian_map.scenario import Bounds


def test_parse_bsq_exact_and_trailer():
    vals = [float(i) - 4263.5 for i in range(16)]
    body = struct.pack("<16f", *vals)
    a = parse_bsq_f32(body, 4, 4)
    b = parse_bsq_f32(body + b"\x00\x00", 4, 4)
    assert a.shape == (4, 4)
    assert np.array_equal(a, b)
    assert a[0, 1] == pytest.approx(vals[1])
    assert a[3, 3] == pytest.approx(vals[15])


def test_bsq_wrong_length_rejected():
    body = struct.pack("<16f", *range(16))
    with pytest.raises(ValueError):
        parse_bsq_f32(body[:-4], 4, 4)
    with pytest.raises(ValueError):
        parse_bsq_f32(body + b"\x00" * 20, 4, 4)


def test_write_read_round_trip(tmp_path):
    vals = np.arange(12, dtype=np.float32).reshape(3, 4)
    vals[1, 2] = np.nan
    g = Grid(vals, Bounds(137.0, -5.0, 137.4, -4.7))
    rec = write_grid(g, tmp_path / "elevation" / "x.f32", tmp_path, "f32")
    assert rec["path"] == "elevation/x.f32"
    assert rec["bytes"] == 48
    meta = rec["grid"]
    assert meta["byte_order"] == "little"
    assert (meta["width"], meta["height"]) == (4, 3)
    assert meta["bounds"] == [137.0, -5.0, 137.4, -4.7]
    assert meta["crs"] == GRID_CRS
    back = read_grid(tmp_path, rec)
    assert np.array_equal(np.isnan(back.values), np.isnan(vals))
    assert np.allclose(np.nan_to_num(back.values), np.nan_to_num(vals))
    assert back.bounds == g.bounds


def test_write_u8(tmp_path):
    g = Grid(np.array([[0, 255], [7, 8]], dtype=np.uint8), Bounds(0, 0, 1, 1))
    rec = write_grid(g, tmp_path / "h.u8", tmp_path, "u8", nodata=255)
    assert rec["bytes"] == 4 and rec["grid"]["nodata"] == 255
    assert read_grid(tmp_path, rec).values.tolist() == [[0, 255], [7, 8]]


def test_grid_sample_and_pixel_deg():
    vals = np.array([[1.0, 2.0], [3.0, 4.0]])
    g = Grid(vals, Bounds(0.0, 0.0, 2.0, 2.0))
    assert g.pixel_deg == (1.0, 1.0)
    assert g.sample(0.5, 1.5) == 1.0  # north-west pixel
    assert g.sample(1.5, 0.5) == 4.0  # south-east pixel
    assert g.sample(2.0, 0.0) == 4.0  # on the south-east corner
    assert np.isnan(g.sample(3.0, 0.5))


def test_grid_window():
    vals = np.arange(16, dtype=float).reshape(4, 4)
    g = Grid(vals, Bounds(0.0, 0.0, 4.0, 4.0))
    w = g.window(Bounds(1.0, 1.0, 3.0, 3.0))
    assert w.values.tolist() == [[5.0, 6.0], [9.0, 10.0]]
    assert w.bounds == Bounds(1.0, 1.0, 3.0, 3.0)


def test_nodata_report():
    mask = np.zeros((128, 128), dtype=bool)
    mask[:10, :10] = True
    b = Bounds(137.0, -5.0, 137.128, -4.872)
    rep = nodata_report(mask, b)
    assert rep["covered_fraction"] == pytest.approx(1 - 100 / 16384)
    assert len(rep["gaps"]) == 1
    w, s, e, n = rep["gaps"][0]
    assert w == pytest.approx(b.west) and n == pytest.approx(b.north)
    assert e == pytest.approx(137.064) and s == pytest.approx(-4.936)
    assert rep["truncated"] is False


def test_nodata_report_merges_runs_and_truncates():
    mask = np.zeros((128, 256), dtype=bool)
    mask[0, :] = True  # top block row fully missing -> one merged box
    mask[100, 0] = True
    mask[100, 200] = True
    rep = nodata_report(mask, Bounds(0, -64, 256, 64))
    assert len(rep["gaps"]) == 3
    assert rep["gaps"][0] == [0.0, 0.0, 256.0, 64.0]
    assert rep["gaps"][1] == [0.0, -64.0, 64.0, 0.0]
    assert rep["gaps"][2] == [192.0, -64.0, 256.0, 0.0]
    small = nodata_report(mask, Bounds(0, -64, 256, 64), max_boxes=2)
    assert len(small["gaps"]) == 2 and small["truncated"] is True


def test_parse_bsq_accepts_validity_mask_trailer():
    # Trek's ImageServer appends a 1-bit-per-pixel validity mask: ceil(w*h/8) bytes.
    w, h = 64, 32
    body = np.arange(w * h, dtype="<f4").tobytes() + b"\xff" * (w * h // 8)
    a = parse_bsq_f32(body, w, h)
    assert a.shape == (h, w) and a[1, 0] == 64.0
    with pytest.raises(ValueError):
        parse_bsq_f32(body + b"\xff", w, h)
