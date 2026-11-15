import math
import time

import numpy as np
import pytest

from martian_map.grids import Grid
from martian_map.horizon import Level, horizon_grid, horizon_profile
from martian_map.scenario import Bounds

M_PER_DEG = 3396190 * math.pi / 180


def _flat(bounds, n, value=0.0):
    return Grid(np.full((n, n), value, dtype=np.float32), bounds)


def test_horizon_flat_is_zero():
    site = Bounds(137.49, -4.81, 137.49 + 1000 / M_PER_DEG, -4.81 + 1000 / M_PER_DEG)
    local = _flat(site, 200)
    regional = _flat(Bounds(137.0, -5.3, 138.0, -4.3), 100)
    h, lons, lats, missing = horizon_grid([Level(local, 5.0, 3000.0), Level(regional, 463.0, 50000.0)], site)
    assert h.shape == (10, 10, 360)
    assert h.dtype == np.uint8
    assert int(h.max()) == 0
    assert missing == []
    assert lons[0] > site.west and lats[0] < site.north  # cell centres, north row first


def test_horizon_wall():
    lon0, lat0 = 137.5, -4.8
    n = 1200
    b = Bounds(lon0 - 0.3, lat0 - 0.3, lon0 + 0.3, lat0 + 0.3)
    vals = np.zeros((n, n), dtype=np.float32)
    py = 0.6 / n
    lats = b.north - (np.arange(n) + 0.5) * py
    wall = (lats >= lat0 + 10000 / M_PER_DEG) & (lats <= lat0 + 12000 / M_PER_DEG)
    vals[wall, :] = 1000.0
    regional = Grid(vals, b)
    local = _flat(Bounds(lon0 - 0.005, lat0 - 0.005, lon0 + 0.005, lat0 + 0.005), 50)
    prof = horizon_profile([Level(local, 5.0, 500.0), Level(regional, 25.0, 30000.0)], lon0, lat0)
    expected = math.degrees(math.atan((1000 - 2 - 1e8 / (2 * 3396190)) / 10000))
    assert prof[0] == pytest.approx(expected, abs=0.3)
    assert prof[180] <= 0.01
    assert prof[90] <= 0.01


def test_regional_offset_applies():
    lon0, lat0 = 137.5, -4.8
    regional = _flat(Bounds(lon0 - 0.3, lat0 - 0.3, lon0 + 0.3, lat0 + 0.3), 600, value=-100.0)
    local = _flat(Bounds(lon0 - 0.005, lat0 - 0.005, lon0 + 0.005, lat0 + 0.005), 50)
    low = horizon_profile([Level(local, 5.0, 500.0), Level(regional, 100.0, 20000.0)], lon0, lat0)
    assert low.max() < 0
    raised = horizon_profile([Level(local, 5.0, 500.0), Level(regional, 100.0, 20000.0, offset_m=200.0)], lon0, lat0)
    assert raised.max() > 0


def test_nan_ground_point_marked():
    site = Bounds(137.49, -4.81, 137.49 + 300 / M_PER_DEG, -4.81 + 300 / M_PER_DEG)
    vals = np.zeros((30, 30), dtype=np.float32)
    vals[:10, :10] = np.nan  # north-west cell has no ground height
    h, _, _, missing = horizon_grid([Level(Grid(vals, site), 5.0, 1000.0)], site)
    assert h[0, 0].tolist() == [255] * 360
    assert [0, 0] in missing


def test_solar_horizon_runtime():
    site = Bounds(137.40, -4.80, 137.40 + 2000 / M_PER_DEG, -4.80 + 2000 / M_PER_DEG)
    rng = np.random.default_rng(1)
    local = Grid(rng.normal(-4300, 2, size=(2000, 2000)).astype(np.float32), site)
    mid = Grid(np.full((2000, 2000), -4300.0, dtype=np.float32), Bounds(137.30, -4.90, 137.50, -4.70))
    regional = Grid(np.full((384, 384), -4300.0, dtype=np.float32), Bounds(136.0, -6.5, 139.0, -3.5))
    t0 = time.monotonic()
    h, _, _, _ = horizon_grid([Level(local, 5.0, 6000.0), Level(mid, 20.0, 10000.0), Level(regional, 463.0, 120000.0)], site)
    assert time.monotonic() - t0 < 120
    assert h.shape == (20, 20, 360)


def test_solar_step_writes_files(tmp_path):
    import json as _json
    from pathlib import Path as _Path

    from conftest import FakeSession
    from martian_map.catalog import Catalog, new_entry
    from martian_map.grids import write_grid
    from martian_map.http import Fetcher
    from martian_map.scenario import load_scenario
    from martian_map.snapshot import Step, run_snapshot
    from martian_map.sources import solar

    repo = _Path(__file__).resolve().parents[1]
    data = _json.loads((repo / "scenario" / "gale.json").read_text())
    site_b = [137.40, -4.80, 137.40 + 300 / M_PER_DEG, -4.80 + 300 / M_PER_DEG]
    data["sites"] = [{"id": "s1", "name": "s1", "note": "t", "bounds": site_b}]
    p = tmp_path / "sc.json"
    p.write_text(_json.dumps(data))
    sc = load_scenario(p)

    def seed(ctx):
        out = []
        for eid, b, n in (("elevation_1m_s1", Bounds(*site_b), 30), ("elevation_10m_study", sc.study_area, 50),
                          ("elevation_463m_region", sc.gale_region, 40)):
            f = write_grid(Grid(np.zeros((n, n), dtype=np.float32), b), ctx.path(f"elevation/{eid}.f32"), ctx.data_root, "f32")
            extra = {"alignment": {"regional_vs_local": {"median_offset_m": -5.0}}} if "463" in eid else {}
            out.append(new_entry(eid, eid, "e", ["terrain"], "elevation", "derived", "local", files=[f], **extra))
        return out

    seed_step = Step("seed", ("elevation_1m_s1", "elevation_10m_study", "elevation_463m_region"), seed)
    report = run_snapshot(sc, tmp_path / "d", Fetcher(session=FakeSession({})), steps=[seed_step, *solar.solar_steps(sc)],
                          log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(tmp_path / "d" / "catalog.json")
    hz = cat.get("horizon_s1")
    meta = hz["files"][0]["grid"]
    assert (meta["width"], meta["height"], meta["bands"], meta["step_deg"]) == (3, 3, 360, 0.25)
    assert hz["files"][0]["bytes"] == 3 * 3 * 360
    assert hz["evidence_type"] == "derived"
    assert hz["regional_offset_m"] == -5.0
    st = cat.get("sun_table_s1")
    assert st["evidence_type"] == "model"
    table = _json.loads((tmp_path / "d" / st["files"][0]["path"]).read_text())
    assert len(table["sunlit_fraction"]) == 24 and len(table["sunlit_fraction"][0]) == 48
    assert table["sunlit_fraction"][6][24] == 1.0  # Ls 90, noon, flat ground: sunlit everywhere
    assert table["sunlit_fraction"][6][0] == 0.0  # midnight
