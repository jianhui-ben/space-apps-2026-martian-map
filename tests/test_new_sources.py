import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from conftest import FakeResponse, FakeSession
from tiff_helpers import make_geotiff
from martian_map.catalog import Catalog
from martian_map.grids import read_grid
from martian_map.http import Fetcher
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import thermal_inertia, water

FIXTURES = Path(__file__).parent / "fixtures"
SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"


@pytest.fixture
def scenario():
    return load_scenario(SCENARIO)


def _fetcher(routes):
    return Fetcher(session=FakeSession(routes), sleep=lambda s: None)


def _ok(body, ctype="application/octet-stream"):
    return FakeResponse(200, body, {"Content-Type": ctype, "Content-Length": str(len(body))})


# --- THEMIS thermal inertia (Zenodo 23527756, sheet MC-23) -----------------------------------------------------------

def _mc23(ti_value=171.0, upper=0):
    h, w = 1779, 2668
    b1 = np.full((h, w), int(round(ti_value * 10)), dtype=np.uint16)
    b1[300:310, 100:110] = 65535  # a hole inside the Gale region
    b2 = np.full((h, w), upper, dtype=np.uint16)
    return make_geotiff(np.stack([b1, b2]), tile=(256, 256))


def _ti_routes(tif, sums_hash=None):
    digest = sums_hash or hashlib.sha256(tif).hexdigest()
    sums = f"{'0' * 64}  THEMIS_TI_2026_MC22_ti_1km.tif\n{digest}  {thermal_inertia.TILE}\n".encode()
    return {thermal_inertia.SUMS_URL: _ok(sums, "text/plain"), thermal_inertia.TILE_URL: _ok(tif, "image/tiff")}


def test_thermal_inertia_step_writes_gale_grid(tmp_path, scenario):
    tif = _mc23()
    report = run_snapshot(scenario, tmp_path, _fetcher(_ti_routes(tif)), steps=[thermal_inertia.thermal_inertia_step],
                          log=lambda m: None)
    assert report.failed == []
    e = Catalog.load(tmp_path / "catalog.json").get("thermal_inertia_themis_1km")
    assert e["access"] == "local" and e["evidence_type"] == "derived"
    assert set(e["factors"]) >= {"terrain", "ground", "thermal"}
    rec = next(f for f in e["files"] if f["format"] == "f32")
    grid = read_grid(tmp_path, rec)
    region = scenario.gale_region
    assert grid.bounds.contains_bounds(region)
    assert grid.bounds.west > region.west - 0.05 and grid.bounds.east < region.east + 0.05
    finite = grid.values[np.isfinite(grid.values)]
    assert finite.size and np.allclose(finite, 171.0)
    assert np.isnan(grid.values).any()  # the hole stays a hole, never 0
    assert e["source"]["sha256_verified"] is True
    assert "10.5281/zenodo.23527756" in e["source"]["doi"]
    assert any(f["format"] == "png" for f in e["files"])


def test_thermal_inertia_checksum_mismatch_fails(tmp_path, scenario):
    report = run_snapshot(scenario, tmp_path, _fetcher(_ti_routes(_mc23(), sums_hash="f" * 64)),
                          steps=[thermal_inertia.thermal_inertia_step], log=lambda m: None)
    assert report.failed and "checksum" in report.failed[0][1]
    assert Catalog.load(tmp_path / "catalog.json").get("thermal_inertia_themis_1km")["status"] == "failed"


def test_thermal_inertia_wrong_sheet_extent_fails(tmp_path, scenario):
    tif = make_geotiff(np.zeros((2, 64, 64), dtype=np.uint16), tiepoint_xy=(0.0, 0.0), tile=(32, 32))
    report = run_snapshot(scenario, tmp_path, _fetcher(_ti_routes(tif)), steps=[thermal_inertia.thermal_inertia_step],
                          log=lambda m: None)
    assert report.failed and "does not cover" in report.failed[0][1]


# --- Mars Odyssey GRS water (H2O_SR_5X5) -----------------------------------------------------------------------------

def _grs_table(overrides=None, rows=None):
    overrides = overrides or {}
    lines = []
    for lat in np.arange(-87.5, 90, 5.0):
        for lon in np.arange(2.5, 360, 5.0):
            v = overrides.get((lat, lon), (9999.999, 9999.999, 9999.999) if abs(lat) > 50 else (3.0, 0.3, 0.4))
            lines.append(f"{lat:5.1f}{'':10}{lon:5.1f}{'':8}{v[0]:8.3f}{'':9}{v[1]:8.3f}{'':9}{v[2]:8.3f}  ")
    if rows is not None:
        lines = lines[:rows]
    return ("\r\n".join(lines) + "\r\n").encode("ascii")


def _grs_routes(table):
    return {water.GRS_LABEL_URL: _ok((FIXTURES / "grs_h2o_sr_5x5.lbl").read_bytes(), "text/plain"),
            water.GRS_TABLE_URL: _ok(table, "text/plain")}


def test_parse_grs_table_converts_longitude_and_missing():
    label = (FIXTURES / "grs_h2o_sr_5x5.lbl").read_text()
    bins = water.parse_grs_table(label, _grs_table({(-2.5, 137.5): (5.415, 0.392, 0.533)}).decode())
    assert len(bins) == 2592
    gale = next(b for b in bins if b["lat"] == -2.5 and b["lon"] == 137.5)
    assert gale["h2o_wt_pct"] == pytest.approx(5.415) and gale["sigma_wt_pct"] == pytest.approx(0.392)
    west = next(b for b in bins if b["lat"] == -2.5 and b["lon"] == -177.5)  # 182.5 E -> -177.5
    assert west["h2o_wt_pct"] == pytest.approx(3.0)
    polar = next(b for b in bins if b["lat"] == 87.5)
    assert polar["h2o_wt_pct"] is None


def test_parse_grs_table_rejects_short_table():
    label = (FIXTURES / "grs_h2o_sr_5x5.lbl").read_text()
    with pytest.raises(ValueError, match="2592"):
        water.parse_grs_table(label, _grs_table(rows=100).decode())


def test_parse_grs_table_rejects_unexpected_columns():
    label = (FIXTURES / "grs_h2o_sr_5x5.lbl").read_text().replace("WEIGHT PERCENT", "PPM")
    with pytest.raises(ValueError, match="WEIGHT PERCENT"):
        water.parse_grs_table(label, _grs_table().decode())


def test_water_step_records_gale_bins(tmp_path, scenario):
    table = _grs_table({(-2.5, 137.5): (5.415, 0.392, 0.533), (-7.5, 137.5): (5.403, 0.364, 0.496)})
    report = run_snapshot(scenario, tmp_path, _fetcher(_grs_routes(table)), steps=[water.water_step], log=lambda m: None)
    assert report.failed == []
    e = Catalog.load(tmp_path / "catalog.json").get("water_odyssey_grs")
    assert e["access"] == "local" and "ground" in e["factors"] and e["resolution_m"] >= 290000
    gale = {(b["lat"], b["lon"]): b["h2o_wt_pct"] for b in e["gale_bins"]}
    assert gale[(-2.5, 137.5)] == pytest.approx(5.415) and gale[(-7.5, 137.5)] == pytest.approx(5.403)
    grid = read_grid(tmp_path, next(f for f in e["files"] if f["format"] == "f32"))
    assert grid.values.shape == (36, 72)
    assert grid.sample(137.4, -4.6) == pytest.approx(5.415, abs=1e-3)  # -4.6 lies in the 0..-5 bin (centre -2.5)
    data = json.loads((tmp_path / next(f for f in e["files"] if f["format"] == "json")["path"]).read_text())
    assert len(data["bins"]) == 2592
    assert any("ice" in lim.lower() for lim in e["limitations"])


def test_water_step_table_error_page_fails(tmp_path, scenario):
    routes = _grs_routes(b"<html>maintenance</html>")
    report = run_snapshot(scenario, tmp_path, _fetcher(routes), steps=[water.water_step], log=lambda m: None)
    assert report.failed
