import json
import math
import statistics
from pathlib import Path

import numpy as np
import pytest
from tiff_helpers import make_geotiff, to_bigtiff

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.http import Fetcher
from martian_map.scenario import Bounds, load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import dunes

SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"
R = 3396190.0
M_PER_DEG = R * np.pi / 180


def _texture(h, w, seed=0):
    rng = np.random.default_rng(seed)
    base = rng.normal(size=(h // 4 + 2, w // 4 + 2))
    img = np.kron(base, np.ones((4, 4)))[:h, :w]  # blobs a few pixels wide, like ripples and rocks
    return img


def test_phase_shifts_find_moved_patch_and_still_ground():
    a = _texture(256, 256)
    b = a.copy()
    b[64:192, 64:192] = np.roll(a, (2, -3), axis=(0, 1))[64:192, 64:192]  # this patch moved 2 px south, 3 px west
    shifts = dunes.phase_shifts(a, b, win=64, step=64, max_shift=8)
    inner = [s for s in shifts if 64 <= s["row"] < 192 and 64 <= s["col"] < 192]
    outer = [s for s in shifts if not (64 <= s["row"] < 192 and 64 <= s["col"] < 192)]
    assert inner and outer
    for s in inner:
        assert (round(s["dx"]), round(s["dy"])) == (-3, 2) and s["peak"] > 0.3
    for s in outer:
        assert abs(s["dx"]) < 0.5 and abs(s["dy"]) < 0.5


def test_phase_shifts_skip_windows_with_no_data():
    a = _texture(128, 128)
    b = a.copy()
    a[:64, :64] = 0  # no data in the 2007 image here
    shifts = dunes.phase_shifts(a, b, win=64, step=64, max_shift=8, nodata=0)
    assert len(shifts) == 3


def test_summary_reports_moving_sand_rate_and_direction():
    shifts = [{"row": 0, "col": 0, "dx": 0.1, "dy": -0.1, "peak": 0.8}] * 6 + \
             [{"row": 0, "col": 0, "dx": -3.0, "dy": 3.0, "peak": 0.5}] * 4  # moving south-west
    s = dunes.summarize_shifts(shifts, pixel_m=1.0, years=8.0, min_peak=0.2, moving_px=1.5)
    assert s["windows_used"] == 10 and s["moving_windows"] == 4
    assert s["moving_median_m"] == pytest.approx(3 * 2 ** 0.5, abs=1e-3)
    assert s["moving_rate_m_per_earth_year"] == pytest.approx(3 * 2 ** 0.5 / 8, abs=1e-3)
    assert s["moving_direction_deg"] == pytest.approx(225.0, abs=0.5)  # towards the south-west
    assert s["still_median_m"] == pytest.approx(0.141, abs=1e-3)
    assert s["direction_consistency"] == pytest.approx(1.0)


def test_sand_edge_shifts_follow_a_moving_dark_patch():
    rng = np.random.default_rng(3)
    a = np.full((128, 128), 180.0) + rng.normal(0, 5, (128, 128))
    a[40:90, 30:80] = 20  # a dark patch of sand on bright rock
    b = np.full((128, 128), 180.0) + rng.normal(0, 5, (128, 128))
    b[43:93, 26:76] = 20  # 3 px south, 4 px west
    edges = dunes.sand_edge_shifts(a, b, 32)
    assert edges
    moved = [s for s in edges if s["peak"] > 0.15 and math.hypot(s["dx"], s["dy"]) > 1.5]
    assert moved and statistics.median(round(s["dx"]) for s in moved) == -4
    assert statistics.median(round(s["dy"]) for s in moved) == 3


def test_summary_reports_all_edges_and_drops_shifts_at_the_search_limit():
    shifts = [{"row": 0, "col": 0, "dx": 0.5, "dy": 0.0, "peak": 0.8, "at_limit": False}] * 7 + \
             [{"row": 0, "col": 0, "dx": -3.0, "dy": 0.0, "peak": 0.5, "at_limit": False}] * 3 + \
             [{"row": 0, "col": 0, "dx": 16.0, "dy": 0.0, "peak": 0.5, "at_limit": True}] * 2
    s = dunes.summarize_shifts(shifts, pixel_m=1.0, years=10.0, min_peak=0.2, moving_px=1.5)
    assert s["windows_used"] == 10 and s["at_search_limit"] == 2 and s["moving_windows"] == 3
    assert s["all_median_m"] == pytest.approx(0.5) and s["all_rate_m_per_earth_year"] == pytest.approx(0.05)
    assert s["moving_fraction"] == pytest.approx(0.3)


def test_phase_shifts_flag_the_search_limit():
    a = _texture(64, 64)
    b = np.roll(a, (0, 8), axis=(0, 1))
    s = dunes.phase_shifts(a, b, win=64, step=64, max_shift=8)
    assert s and s[0]["at_limit"] is True
    assert dunes.phase_shifts(a, a, win=64, step=64, max_shift=8)[0]["at_limit"] is False


def test_window_for_bounds_matches_pixels():
    tags = {256: [6220], 257: [12171], 33550: [1.0117571650087, 1.0117571650087, 0.0],
            33922: [0.0, 0.0, 0.0, 8140482.2112, -271632.0108, 0.0], 34735: [1, 1, 0, 1, 1025, 0, 1, 1]}
    row0, col0, rows, cols = dunes.window_for_bounds(tags, Bounds(137.388, -4.669, 137.413, -4.644), R)
    assert (rows, cols) == (round(0.025 * M_PER_DEG / 1.0117571650087),) * 2
    assert col0 == round((137.388 * M_PER_DEG - 8140482.2112) / 1.0117571650087)
    with pytest.raises(ValueError, match="outside"):
        dunes.window_for_bounds(tags, Bounds(137.2, -4.669, 137.25, -4.644), R)


def _cog(img, west_lon, north_lat, px_m):
    return to_bigtiff(make_geotiff(img[None].astype(np.uint16), pixel_scale=(px_m, px_m),
                                   tiepoint_xy=(west_lon * M_PER_DEG, north_lat * M_PER_DEG), compression=8,
                                   tile=(64, 64), nodata="0"))


class RangeSession:
    def __init__(self, files):
        self.files = files
        self.calls = []

    def get(self, url, headers=None, **kw):
        self.calls.append((url, dict(headers or {})))
        body = self.files[url]
        rng = (headers or {}).get("Range")
        if not rng:
            return FakeResponse(200, body, {"Content-Type": "image/tiff"})
        a, b = (int(x) for x in rng.split("=")[1].split("-"))
        part = body[a:b + 1]
        return FakeResponse(206, part, {"Content-Type": "image/tiff", "Content-Range": f"bytes {a}-{a + len(part) - 1}/{len(body)}"})


def test_step_crops_both_dates_and_measures_movement(tmp_path, monkeypatch):
    px = 25.0  # coarse test pixels keep the fake images small
    crop = Bounds(137.388, -4.669, 137.413, -4.644)
    w = int(round(0.06 * M_PER_DEG / px))
    early = (_texture(w, w, 1) * 400 + 2000).clip(1, 60000)
    late = early.copy()
    late[20:60, 20:60] = np.roll(early, (2, -2), axis=(0, 1))[20:60, 20:60]
    west, north = 137.37, -4.63
    files = {}
    epochs = []
    for name, img in (("early", early), ("late", late)):
        url = f"https://astrogeo-ard.s3-us-west-2.amazonaws.com/test/{name}.tif"
        files[url] = _cog(img, west, north, px)
        epochs.append(dict(dunes.EPOCHS[0 if name == "early" else 1], url=url))
    monkeypatch.setattr(dunes, "EPOCHS", epochs)
    monkeypatch.setattr(dunes, "CROP", crop)
    monkeypatch.setattr(dunes, "WINDOW_PX", 16)
    session = RangeSession(files)
    report = run_snapshot(load_scenario(SCENARIO), tmp_path, Fetcher(session=session, sleep=lambda s: None),
                          steps=[dunes.dune_change_step], log=lambda m: None)
    assert report.failed == []
    assert all(h.get("Range") for _, h in session.calls)  # never the whole file
    e = Catalog.load(tmp_path / "catalog.json").get("dune_change_imagery")
    assert e["access"] == "local" and e["evidence_type"] == "observation"
    assert {f["path"] for f in e["files"]} >= {"dunes/hirise_2007-04-22.png", "dunes/hirise_2015-04-08.png",
                                               "dunes/dune_shifts.json"}
    m = e["movement"]
    assert m["registration"]["windows_used"] >= 1 and m["years_between"] == pytest.approx(7.96, abs=0.01)
    assert "sand_edges" in m and len(m["sand_fraction"]) == 2
    assert "near_base_west" in e["distance_to_sites_km"]
    shifts = json.loads((tmp_path / "dunes" / "dune_shifts.json").read_text())
    assert shifts["pixel_m"] == pytest.approx(px)
