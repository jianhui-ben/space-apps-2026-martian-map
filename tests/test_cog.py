import math

import numpy as np
import pytest
from tiff_helpers import RangeSession, make_geotiff, to_bigtiff

from martian_map import cog
from martian_map.http import Fetcher
from martian_map.scenario import Bounds

R = 3396190.0
M_PER_DEG = R * math.pi / 180.0
URL = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/test/dtm.tif"
NODATA = -3.4028226550889045e38
PX = 100.0  # metres per pixel in the fake DTM


class Ctx:
    def __init__(self, session):
        self.fetcher = Fetcher(session=session, sleep=lambda s: None)
        self.log = lambda m: None


def _dtm(h=64, w=48, west_deg=77.0, north_deg=18.5, predictor=2):
    rng = np.random.default_rng(3)
    heights = (rng.normal(-2500.0, 30.0, size=(1, h, w))).astype(np.float32)
    heights[0, 5, 7] = NODATA
    tif = to_bigtiff(make_geotiff(heights, pixel_scale=(PX, PX), tiepoint_xy=(west_deg * M_PER_DEG, north_deg * M_PER_DEG),
                                  compression=8, predictor=predictor, tile=(16, 16), nodata=repr(NODATA)))
    return heights[0], tif, west_deg, north_deg


def _deg(px):
    return px * PX / M_PER_DEG


@pytest.mark.parametrize("predictor", [2, 3])
def test_window_matches_pixels_and_nodata_is_nan(predictor):
    heights, tif, w0, n0 = _dtm(predictor=predictor)
    session = RangeSession({URL: tif})
    want = Bounds(w0 + _deg(4), n0 - _deg(30), w0 + _deg(20), n0 - _deg(2))
    grid = cog.read_cog_grid(Ctx(session), URL, want)
    assert grid.shape == (28, 16)
    expected = heights[2:30, 4:20].copy()
    expected[expected < -1e30] = np.nan
    assert np.array_equal(grid.values, expected, equal_nan=True)
    assert np.isnan(grid.values[3, 3])  # the no-data pixel
    assert grid.bounds.west == pytest.approx(want.west) and grid.bounds.north == pytest.approx(want.north)
    assert all(h.get("Range") for _, h in session.calls)


def test_tiles_are_fetched_in_few_requests():
    _, tif, w0, n0 = _dtm(h=256, w=256)
    assert len(tif) > 3 * cog.HEAD_BYTES  # most tiles lie past the cached head
    session = RangeSession({URL: tif})
    grid = cog.read_cog_grid(Ctx(session), URL, Bounds(w0 + _deg(1), n0 - _deg(250), w0 + _deg(250), n0 - _deg(1)))
    assert grid.shape == (249, 249)
    assert len(session.calls) <= 3  # the head, then ~200 tiles in one or two merged reads


def test_prefetch_merges_nearby_ranges_and_serves_reads(monkeypatch):
    body = bytes(range(256)) * 4096
    monkeypatch.setattr(cog, "HEAD_BYTES", 16)
    session = RangeSession({URL: body})
    r = cog.RangeReader(Ctx(session), URL)
    r.prefetch([(1150, 50), (1000, 100), (900_000, 10)])
    assert len(session.calls) == 3  # head, 1000-1199 merged, 900000-900009
    assert r(1150, 50) == body[1150:1200] and r(1100, 20) == body[1100:1120] and r(900_002, 4) == body[900_002:900_006]
    assert len(session.calls) == 3
    monkeypatch.setattr(cog, "MAX_REQUEST_BYTES", 120)
    r2 = cog.RangeReader(Ctx(session), URL)
    r2.prefetch([(1000, 100), (1150, 50)])
    assert len(session.calls) == 6  # too big to merge: two reads


def test_window_past_the_edge_is_padded_with_nan():
    heights, tif, w0, n0 = _dtm()
    grid = cog.read_cog_grid(Ctx(RangeSession({URL: tif})), URL,
                             Bounds(w0 - _deg(4), n0 - _deg(10), w0 + _deg(6), n0 + _deg(2)))
    assert grid.shape == (12, 10)
    assert np.isnan(grid.values[:2]).all() and np.isnan(grid.values[:, :4]).all()
    assert np.array_equal(grid.values[2:, 4:], heights[0:10, 0:6])


def test_decimate_takes_block_means_and_keeps_gaps():
    heights, tif, w0, n0 = _dtm()
    grid = cog.read_cog_grid(Ctx(RangeSession({URL: tif})), URL,
                             Bounds(w0 + _deg(4), n0 - _deg(12), w0 + _deg(12), n0), decimate=2)
    assert grid.shape == (6, 4)
    block = heights[0:12, 4:12].astype(np.float64).reshape(6, 2, 4, 2)
    expected = block.mean(axis=(1, 3))
    expected[2, 1] = np.nan  # covers the no-data pixel at row 5, col 7
    assert np.allclose(grid.values, expected, equal_nan=True, atol=1e-3)


def test_bounds_off_the_raster_raise():
    _, tif, w0, n0 = _dtm()
    with pytest.raises(ValueError, match="does not overlap"):
        cog.read_cog_grid(Ctx(RangeSession({URL: tif})), URL, Bounds(w0 + 5, n0 - 1, w0 + 5.1, n0 - 0.9))
