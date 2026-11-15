import json
from pathlib import Path

import numpy as np
import pytest

from conftest import FakeSession
from martian_map.alignment import dem_vs_rover, regional_vs_local
from martian_map.catalog import Catalog, file_record, new_entry
from martian_map.grids import Grid, write_grid
from martian_map.http import Fetcher, atomic_write
from martian_map.scenario import Bounds, load_scenario
from martian_map.snapshot import Step, run_snapshot
from martian_map.sources import alignment_step

REPO = Path(__file__).resolve().parents[1]


def _wp(*pts):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"lon": lon, "lat": lat, "elev_geoid": h, "sol": i},
         "geometry": {"type": "Point", "coordinates": [lon, lat]}} for i, (lon, lat, h) in enumerate(pts)]}


def test_dem_vs_rover_offset():
    g = Grid(np.full((10, 10), -4300.0, dtype=np.float32), Bounds(137.0, -5.0, 137.1, -4.9))
    r = dem_vs_rover(g, _wp((137.01, -4.95, -4305.0), (137.05, -4.95, -4305.0), (137.09, -4.91, -4305.0),
                            (140.0, 0.0, -1.0)))
    assert r["n"] == 3
    assert r["median_offset_m"] == pytest.approx(5.0)
    assert r["flag"] is True


def test_dem_vs_rover_no_points():
    g = Grid(np.zeros((4, 4), dtype=np.float32), Bounds(137.0, -5.0, 137.1, -4.9))
    r = dem_vs_rover(g, _wp((140.0, 0.0, -1.0)))
    assert r["n"] == 0 and r["flag"] is None and "no rover heights" in r["note"]


def test_regional_vs_local():
    regional = Grid(np.arange(16, dtype=np.float32).reshape(4, 4) * 10, Bounds(0.0, -4.0, 4.0, 0.0))
    local_vals = np.kron(regional.values[1:3, 1:3], np.ones((5, 5))) + 3.0
    local = Grid(local_vals.astype(np.float32), Bounds(1.0, -3.0, 3.0, -1.0))
    r = regional_vs_local(regional, local)
    assert r["n"] == 4
    assert r["median_offset_m"] == pytest.approx(3.0)
    assert r["flag"] is False


def test_alignment_step_updates_entries(tmp_path):
    sc = load_scenario(REPO / "scenario" / "gale.json")
    site = sc.sites[0].bounds
    g = Grid(np.full((20, 20), -4300.0, dtype=np.float32), site)

    def seed(ctx):
        f = write_grid(g, ctx.path("elevation/elevation_1m_curiosity_recent.f32"), ctx.data_root, "f32")
        p = ctx.path("rover/MSL_waypoints.json")
        lon, lat = site.center()
        atomic_write(p, json.dumps(_wp((lon, lat, -4301.0))).encode())
        return [
            new_entry("elevation_1m_curiosity_recent", "E", "e", ["terrain"], "elevation", "derived", "local", files=[f]),
            new_entry("rover_stops", "S", "s", ["routes"], "route", "observation", "local",
                      files=[file_record(p, ctx.data_root, "geojson")]),
        ]

    steps = [Step("seed", ("elevation_1m_curiosity_recent", "rover_stops"), seed), alignment_step]
    report = run_snapshot(sc, tmp_path, Fetcher(session=FakeSession({})), steps=steps, log=lambda m: None)
    assert report.failed == []
    e = Catalog.load(tmp_path / "catalog.json").get("elevation_1m_curiosity_recent")
    assert e["alignment"]["dem_vs_rover"]["median_offset_m"] == pytest.approx(1.0)
    assert e["alignment"]["dem_vs_rover"]["n"] == 1
