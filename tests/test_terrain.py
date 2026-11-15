import math

import numpy as np
import pytest

from martian_map.grids import Grid
from martian_map.scenario import Bounds
from martian_map.terrain import noise_floor, pixel_size_m, roughness_m, slope_deg


def test_slope_plane():
    y, x = np.mgrid[0:20, 0:20].astype(float)
    east = x * 1.0  # rises 1 m per pixel eastward
    s = slope_deg(east, 1.0, 1.0)
    assert np.allclose(s[1:-1, 1:-1], 45.0, atol=1e-6)
    north = (19 - y) * 2.0 * math.tan(math.radians(10))  # rises northward (row 0 = north)
    s2 = slope_deg(north, 1.0, 2.0)
    assert np.allclose(s2[1:-1, 1:-1], 10.0, atol=1e-6)


def test_slope_border_is_nan():
    s = slope_deg(np.zeros((5, 5)), 1.0, 1.0)
    assert np.isnan(s[0]).all() and np.isnan(s[-1]).all() and np.isnan(s[:, 0]).all() and np.isnan(s[:, -1]).all()
    assert np.allclose(s[1:-1, 1:-1], 0.0)


def test_slope_nan_propagates():
    z = np.zeros((11, 11))
    z[5, 5] = np.nan
    s = slope_deg(z, 1.0, 1.0)
    for r, c in ((5, 5), (4, 5), (6, 5), (5, 4), (5, 6)):
        assert np.isnan(s[r, c]), (r, c)
    assert np.isfinite(s[8, 8])


def test_roughness_zero_on_plane():
    y, x = np.mgrid[0:15, 0:15].astype(float)
    z = 3.0 * x - 1.7 * y + 100.0
    r = roughness_m(z)
    assert np.nanmax(np.abs(r[2:-2, 2:-2])) < 1e-9


def test_roughness_single_bump():
    z = np.zeros((11, 11))
    z[5, 5] = 1.0
    r = roughness_m(z)
    assert r[5, 5] == pytest.approx(math.sqrt(0.96 / 25), abs=1e-6)
    assert np.isnan(r[0, 0]) and np.isnan(r[1, 5])


def test_roughness_nan_window():
    z = np.zeros((11, 11))
    z[5, 5] = np.nan
    r = roughness_m(z)
    assert np.isnan(r[5, 5]) and np.isnan(r[3, 3]) and np.isnan(r[7, 7])
    assert np.isfinite(r[2, 2])


def test_pixel_size_m():
    d = 1.687e-5
    g = Grid(np.zeros((10, 10)), Bounds(137.4, -4.8 - 5 * d, 137.4 + 10 * d, -4.8 + 5 * d))
    dx, dy = pixel_size_m(g)
    assert dx == pytest.approx(0.996, rel=0.005)
    assert dy == pytest.approx(1.000, rel=0.005)


def test_noise_floor():
    nf = noise_floor(0.25, 1.0)
    assert nf["slope_deg"] == pytest.approx(10.0, abs=0.1)
    assert nf["roughness_m"] == 0.25


# --- BT-05 / BT-08: 10 m x 10 m plane-fit windows ----------------------------------------------------------------

from martian_map.terrain import window_plane_fit  # noqa: E402


def test_window_slope_exact_on_tilted_plane():
    y, x = np.mgrid[0:30, 0:30].astype(float)
    z = x * 0.9965 * math.tan(math.radians(7.0))  # 7 degrees eastward with 0.9965 m pixels
    slope, rms = window_plane_fit(z, 10, 0.9965, 1.0)
    inner = slope[np.isfinite(slope)]
    assert inner.size == 21 * 21  # one value per full 10 x 10 window
    assert np.allclose(inner, 7.0, atol=1e-6)
    assert np.nanmax(rms) < 1e-9


def test_window_slope_north_and_even_window_position():
    y, x = np.mgrid[0:20, 0:20].astype(float)
    z = (19 - y) * 2.0 * math.tan(math.radians(4.0))  # rises northward, 2 m rows
    slope, _ = window_plane_fit(z, 10, 1.0, 2.0)
    # window rows/cols r0..r0+9 report at (r0 + 5, c0 + 5): first value at (5, 5), last at (15, 15)
    assert np.isnan(slope[4, 5]) and np.isfinite(slope[5, 5]) and np.isfinite(slope[15, 15]) and np.isnan(slope[16, 15])
    assert np.allclose(slope[np.isfinite(slope)], 4.0, atol=1e-6)


def test_window_fit_missing_cell_flags_every_window_touching_it():
    z = np.zeros((25, 25))
    z[12, 12] = np.nan
    slope, rms = window_plane_fit(z, 10, 1.0, 1.0)
    # windows whose rows and cols include 12: r0 in 3..12 -> reported rows 8..17
    assert np.isnan(slope[8:18, 8:18]).all() and np.isnan(rms[8:18, 8:18]).all()
    assert np.isfinite(slope[7, 7]) and np.isfinite(slope[18, 18])


def test_window_rms_single_bump_10m():
    z = np.zeros((10, 10))
    z[4, 4] = 1.0
    _, rms = window_plane_fit(z, 10, 1.0, 1.0)
    # plane fit of a single unit spike over n=100 cells: residual sum of squares = 1 - 1/n - x^2/Sxx - y^2/Sxx
    sxx = 10 * 10 * 99 / 12
    off = 4 - 4.5
    expected = math.sqrt((1 - 1 / 100 - off ** 2 / sxx - off ** 2 / sxx) / 100)
    assert rms[5, 5] == pytest.approx(expected, abs=1e-9)


def test_noise_floor_for_10m_window_slope():
    nf = noise_floor(0.25, 1.0, window=10)
    sxx = 10 * 10 * 99 / 12
    assert nf["slope_window_deg"] == pytest.approx(math.degrees(math.atan(math.sqrt(2) * 0.25 / math.sqrt(sxx))))
    assert nf["slope_window_deg"] == pytest.approx(0.70, abs=0.01)
    assert nf["window_m"] == 10
