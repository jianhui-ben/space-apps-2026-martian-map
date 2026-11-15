import json
import math
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import numpy as np
import pytest

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.grids import read_grid
from martian_map.http import Fetcher
from martian_map.scenario import Bounds, load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import elevation
from martian_map.sources.elevation import GALE_DEM, GALE_DEM_PIXEL_DEG, MOLA, export_grid, identify

FIXTURES = Path(__file__).parent / "fixtures"
NODATA = -3.4028230607370965e38


class TerrainSession:
    """Fake Trek ImageServer: answers exportImage from a height function f(lon, lat)."""

    def __init__(self, f, short=False):
        self.f = f
        self.short = short
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        parts = urlsplit(url)
        q = {k: v[0] for k, v in parse_qs(parts.query).items()}
        if parts.path.endswith("/ImageServer") and q.get("f") == "json":
            body = json.dumps({"pixelSizeX": 0.0078125, "pixelSizeY": 0.0078125}).encode()
            return FakeResponse(200, body, {"Content-Type": "application/json"})
        assert parts.path.endswith("/exportImage"), url
        w_, s_, e_, n_ = (float(x) for x in q["bbox"].split(","))
        w, h = (int(x) for x in q["size"].split(","))
        px, py = (e_ - w_) / w, (n_ - s_) / h
        lons = w_ + (np.arange(w) + 0.5) * px
        lats = n_ - (np.arange(h) + 0.5) * py
        grid = np.array([[self.f(lon, lat) for lon in lons] for lat in lats], dtype="<f4")
        body = grid.tobytes() + b"\xff" * math.ceil(w * h / 8)
        if self.short:
            body = body[: w * h * 2]
        return FakeResponse(200, body, {"Content-Type": "application/octet-stream"})


def _fetcher(session):
    return Fetcher(session=session, sleep=lambda s: None)


def _tiny_scenario(tmp_path, site_deg=0.001, study=(137.40, -4.81, 137.41, -4.80)):
    data = json.loads((Path(__file__).resolve().parents[1] / "scenario" / "gale.json").read_text())
    data["study_area"] = list(study)
    data.pop("trip_area", None)
    data["base"] = {"lon": study[0] + 0.001, "lat": study[1] + 0.001, "note": "test"}
    data["sites"] = [{"id": "curiosity_recent", "name": "t", "note": "t",
                      "bounds": [study[0], study[1], study[0] + site_deg, study[1] + site_deg]}]
    p = tmp_path / "scenario.json"
    p.write_text(json.dumps(data))
    return load_scenario(p)


def test_export_grid_bands_and_stitch():
    session = TerrainSession(lambda lon, lat: (lat + 4.8) * 1e5)  # small values: float32-exact enough
    b = Bounds(137.4, -4.8, 137.4 + 10 * GALE_DEM_PIXEL_DEG, -4.8 + 2500 * GALE_DEM_PIXEL_DEG)
    g = export_grid(_fetcher(session), GALE_DEM, b, GALE_DEM_PIXEL_DEG, max_rows=1024)
    assert len(session.calls) == 3
    assert g.values.shape == (2500, 10)
    col = g.values[:, 0].astype(float)
    assert np.all(np.diff(col) < 0)  # north to south, no band out of order
    steps = np.diff(col)
    assert np.allclose(steps, steps[0], rtol=1e-3)  # no seam between bands


def test_export_out_of_range_is_nan():
    session = TerrainSession(lambda lon, lat: -32768.0 if lon < 137.40005 else (1e30 if lat > -4.79995 else -4300.0))
    b = Bounds(137.4, -4.8, 137.4 + 8 * GALE_DEM_PIXEL_DEG, -4.8 + 8 * GALE_DEM_PIXEL_DEG)
    g = export_grid(_fetcher(session), GALE_DEM, b, GALE_DEM_PIXEL_DEG)
    assert np.isnan(g.values[:, 0]).all()
    assert np.isnan(g.values[0, 5])
    assert g.values[7, 7] == pytest.approx(-4300.0)


def test_export_nodata_marker_is_nan():
    session = TerrainSession(lambda lon, lat: NODATA)
    b = Bounds(137.4, -4.8, 137.4 + 4 * GALE_DEM_PIXEL_DEG, -4.8 + 4 * GALE_DEM_PIXEL_DEG)
    assert np.isnan(export_grid(_fetcher(session), GALE_DEM, b, GALE_DEM_PIXEL_DEG).values).all()


def test_bsq_wrong_length_rejected_in_step(tmp_path):
    sc = _tiny_scenario(tmp_path)
    session = TerrainSession(lambda lon, lat: -4300.0, short=True)
    report = run_snapshot(sc, tmp_path / "data", _fetcher(session), steps=elevation.site_steps(sc), log=lambda m: None)
    assert report.failed and "length" in report.failed[0][1]


def _plane(lon, lat):
    # rises 0.1 m per metre eastward (about 5.7 degrees)
    return -4300.0 + (lon - 137.4) * (3396190 * math.pi / 180 * math.cos(math.radians(4.8))) * 0.1


def test_site_step_outputs(tmp_path):
    sc = _tiny_scenario(tmp_path)
    data = tmp_path / "data"
    report = run_snapshot(sc, data, _fetcher(TerrainSession(_plane)), steps=elevation.site_steps(sc), log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(data / "catalog.json")
    for kind in ("elevation", "slope", "roughness"):
        e = cat.get(f"{kind}_1m_curiosity_recent")
        assert e["evidence_type"] == "derived"
        assert e["resolution_m"] == 1
        formats = sorted(f["format"] for f in e["files"])
        assert formats == ["f32", "png"]
        assert e["coverage"]["area"] == "curiosity_recent"
        assert e["coverage"]["covered_fraction"] == pytest.approx(1.0)
        assert e["uncertainty"]["value"] == 0.25
        assert "placeholder" in e["uncertainty"]["basis"]
    slope = cat.get("slope_1m_curiosity_recent")
    assert "noise_floor" in slope and slope["noise_floor"]["slope_deg"] > 0
    g = read_grid(data, next(f for f in slope["files"] if f["format"] == "f32"))
    inner = g.values[2:-2, 2:-2]
    assert np.nanmedian(inner) == pytest.approx(math.degrees(math.atan(0.1)), abs=0.3)
    rough = read_grid(data, next(f for f in cat.get("roughness_1m_curiosity_recent")["files"] if f["format"] == "f32"))
    assert np.nanmax(rough.values) < 0.01  # a plane is smooth at any tilt
    assert "3 m" in " ".join(cat.get("elevation_1m_curiosity_recent")["limitations"])


def test_site_step_bt05_bt08_windows(tmp_path):
    sc = _tiny_scenario(tmp_path, site_deg=0.0006)  # about 66 m, so several full 10 m windows fit
    data = tmp_path / "data"
    report = run_snapshot(sc, data, _fetcher(TerrainSession(_plane)), steps=elevation.site_steps(sc), log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(data / "catalog.json")
    win = cat.get("slope_10m_window_curiosity_recent")
    assert win["method"]["metric"] == "BT-05" and win["method"]["window_m"] == pytest.approx(10, abs=0.5)
    assert win["noise_floor"]["slope_window_deg"] < 1.0
    g = read_grid(data, next(f for f in win["files"] if f["format"] == "f32"))
    assert np.nanmedian(g.values) == pytest.approx(math.degrees(math.atan(0.1)), abs=0.05)
    rough = cat.get("roughness_1m_curiosity_recent")
    assert rough["method"]["metric"] == "BT-08" and rough["method"]["window_m"] == pytest.approx(10, abs=0.5)
    assert "10 x 10 m" in rough["summary"]
    assert cat.get("slope_1m_curiosity_recent")["method"]["metric"] is None  # pixel slope: not the BT-05 measure


def test_low_coverage_site_warns(tmp_path):
    sc = _tiny_scenario(tmp_path)
    west = sc.sites[0].bounds.west
    hole = lambda lon, lat: NODATA if lon < west + 0.0001 else -4300.0  # about 10% of the site
    report = run_snapshot(sc, tmp_path / "data", _fetcher(TerrainSession(hole)), steps=elevation.site_steps(sc),
                          log=lambda m: None)
    assert any("curiosity_recent" in w and "95%" in w for w in report.warnings)


def test_study_step_has_nodata_overlay(tmp_path):
    sc = _tiny_scenario(tmp_path)
    data = tmp_path / "data"
    run_snapshot(sc, data, _fetcher(TerrainSession(_plane)), steps=[elevation.study_step], log=lambda m: None)
    cat = Catalog.load(data / "catalog.json")
    elev = cat.get("elevation_10m_study")
    pngs = [f["path"] for f in elev["files"] if f["format"] == "png"]
    assert len(pngs) == 2 and any(p.endswith("nodata.png") for p in pngs)
    assert elev["resolution_m"] == 10 and elev["coverage"]["area"] == "study_area"
    assert ("Computed on a 10 m grid: smoother than the 1 m slope; for screening only."
            in cat.get("slope_10m_study")["limitations"])


def test_region_step_uses_native_mola_pixel(tmp_path):
    sc = _tiny_scenario(tmp_path)
    data = tmp_path / "data"
    session = TerrainSession(lambda lon, lat: -4000.0)
    run_snapshot(sc, data, _fetcher(session), steps=[elevation.region_step], log=lambda m: None)
    e = Catalog.load(data / "catalog.json").get("elevation_463m_region")
    grid = next(f for f in e["files"] if f["format"] == "f32")["grid"]
    assert (grid["width"], grid["height"]) == (384, 384)
    assert MOLA in session.calls[0]


def test_identify_parses_fixture(monkeypatch):
    payload = (FIXTURES / "gale_dem_identify.json").read_bytes()

    class S:
        def get(self, url, **kw):
            return FakeResponse(200, payload, {"Content-Type": "application/json"})

    assert identify(_fetcher(S()), GALE_DEM, 137.4, -4.7) == pytest.approx(-4285, abs=1)


@pytest.mark.network
def test_network_identify_matches():
    assert identify(Fetcher(), GALE_DEM, 137.4, -4.7) == pytest.approx(-4285, abs=1)


def test_moved_site_refetched_and_warned(tmp_path):
    sc = _tiny_scenario(tmp_path)
    data = tmp_path / "data"
    hole_east = lambda lon, lat: NODATA if lon > 137.405 else -4300.0
    run_snapshot(sc, data, _fetcher(TerrainSession(hole_east)), steps=elevation.site_steps(sc), log=lambda m: None)
    raw = json.loads(sc.path.read_text())
    raw["sites"][0]["bounds"] = [137.408, -4.802, 137.409, -4.801]  # same id, now inside the hole
    moved_path = tmp_path / "moved.json"
    moved_path.write_text(json.dumps(raw))
    moved = load_scenario(moved_path)
    session = TerrainSession(hole_east)
    report = run_snapshot(moved, data, _fetcher(session), steps=elevation.site_steps(moved), log=lambda m: None)
    assert any("exportImage" in c for c in session.calls)
    assert any("curiosity_recent" in w for w in report.warnings)
    grid = next(f for f in Catalog.load(data / "catalog.json").get("elevation_1m_curiosity_recent")["files"]
                if f["format"] == "f32")["grid"]
    assert grid["bounds"] == [137.408, -4.802, 137.409, -4.801]


def test_trip_area_step_2m_grid(tmp_path):
    data = json.loads((Path(__file__).resolve().parents[1] / "scenario" / "gale.json").read_text())
    study = (137.40, -4.81, 137.41, -4.80)
    data["study_area"] = list(study)
    data["base"] = {"lon": 137.401, "lat": -4.809, "note": "test"}
    data["sites"] = []
    data["trip_area"] = {"bounds": [137.4005, -4.8095, 137.4025, -4.8075], "note": "test"}
    p = tmp_path / "scenario.json"
    p.write_text(json.dumps(data))
    sc = load_scenario(p)
    assert sc.trip_area is not None and sc.trip_area.as_list() == [137.4005, -4.8095, 137.4025, -4.8075]
    out = tmp_path / "data"
    steps = elevation.trip_steps(sc)
    assert [s.id for s in steps] == ["elevation_trip_area"]
    report = run_snapshot(sc, out, _fetcher(TerrainSession(_plane)), steps=steps, log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(out / "catalog.json")
    assert cat.areas["trip_area"] == sc.trip_area.as_list()
    for kind in ("elevation", "slope"):
        e = cat.get(f"{kind}_2m_trip_area")
        assert e["resolution_m"] == 2 and e["coverage"]["area"] == "trip_area"
        assert "6 m" in " ".join(e["limitations"])
    g = read_grid(out, next(f for f in cat.get("elevation_2m_trip_area")["files"] if f["format"] == "f32"))
    assert g.values.shape == (round(0.002 / (2 * elevation.GALE_DEM_PIXEL_DEG)),) * 2
    assert (out / "elevation" / "trip_area_nodata.png").exists() and not (out / "elevation" / "study_nodata.png").exists()


def test_no_trip_area_no_step(tmp_path):
    sc = _tiny_scenario(tmp_path)
    assert sc.trip_area is None and elevation.trip_steps(sc) == []
