from pathlib import Path

import pytest

from conftest import FakeSession
from martian_map.catalog import Catalog, file_record, new_entry, validate_entry
from martian_map.http import FetchError, Fetcher, atomic_write
from martian_map.scenario import load_scenario
from martian_map.snapshot import Step, build_coverage_report, run_snapshot
from martian_map.sources import static

REPO = Path(__file__).resolve().parents[1]
SCENARIO = REPO / "scenario" / "gale.json"


@pytest.fixture
def scenario():
    return load_scenario(SCENARIO)


def _fetcher():
    return Fetcher(session=FakeSession({}), sleep=lambda s: None)


def _writer_step(step_id, dataset_id, counter):
    def run(ctx):
        counter[step_id] = counter.get(step_id, 0) + 1
        p = ctx.path(f"test/{dataset_id}.bin")
        atomic_write(p, b"hello")
        return [new_entry(dataset_id, dataset_id, "test data", ["terrain"], "test", "derived", "local",
                          files=[file_record(p, ctx.data_root, "bin")])]

    return Step(step_id, (dataset_id,), run)


def _bad_step():
    def run(ctx):
        raise FetchError("boom")

    return Step("bad", ("bad_data",), run)


def test_failed_step_recorded_and_run_continues(tmp_path, scenario):
    counter = {}
    report = run_snapshot(scenario, tmp_path, _fetcher(), steps=[_bad_step(), _writer_step("good", "good_data", counter)],
                          log=lambda m: None)
    cat = Catalog.load(tmp_path / "catalog.json")
    assert cat.get("good_data")["status"] == "ok"
    bad = cat.get("bad_data")
    assert bad["status"] == "failed"
    assert bad["error"] == "boom"
    validate_entry(bad)
    assert report.failed == [("bad", "boom")]


def test_only_runs_selected_and_keeps_others(tmp_path, scenario):
    counter = {}
    steps = [_writer_step("a", "a_data", counter), _writer_step("b", "b_data", counter)]
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, log=lambda m: None)
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, only={"b_data"}, refresh=True, log=lambda m: None)
    assert counter == {"a": 1, "b": 2}
    cat = Catalog.load(tmp_path / "catalog.json")
    assert {e["id"] for e in cat.entries} == {"a_data", "b_data"}


def test_fresh_step_skipped(tmp_path, scenario):
    counter = {}
    steps = [_writer_step("a", "a_data", counter)]
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, log=lambda m: None)
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, log=lambda m: None)
    assert counter == {"a": 1}


def test_is_fresh_false_on_hash_mismatch(tmp_path, scenario):
    counter = {}
    steps = [_writer_step("a", "a_data", counter)]
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, log=lambda m: None)
    (tmp_path / "test" / "a_data.bin").write_bytes(b"HELLO")
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, log=lambda m: None)
    assert counter == {"a": 2}


def test_step_without_datasets_always_runs(tmp_path, scenario):
    calls = []
    step = Step("touch", (), lambda ctx: calls.append(1) or [])
    run_snapshot(scenario, tmp_path, _fetcher(), steps=[step], log=lambda m: None)
    run_snapshot(scenario, tmp_path, _fetcher(), steps=[step], log=lambda m: None)
    assert calls == [1, 1]


def test_stretch_steps_need_flag(tmp_path, scenario):
    counter = {}
    s = _writer_step("s", "s_data", counter)
    stretch = Step(s.id, s.dataset_ids, s.run, stretch=True)
    run_snapshot(scenario, tmp_path, _fetcher(), steps=[stretch], log=lambda m: None)
    assert counter == {}
    run_snapshot(scenario, tmp_path, _fetcher(), steps=[stretch], include_stretch=True, log=lambda m: None)
    assert counter == {"s": 1}


LIVE_IDS = {
    "imagery_hirise_color", "imagery_hirise_gray", "imagery_ctx", "imagery_ctx_mmgis", "thermal_day", "thermal_night",
    "thermal_inertia_tes", "surface_dust_tes", "imagery_viking", "relief_mola", "labels", "elevation_point_service",
}
NOT_USED_IDS = {
    "communications", "photos_curiosity_index", "perseverance_photos",
    "worldview", "geology_1to60k", "trek_login_tools", "trek_data_stream", "route_animation", "water_dan_curiosity",
}
PENDING_IDS = {"ice_swim"}


def test_static_entries_complete(tmp_path, scenario):
    report = run_snapshot(scenario, tmp_path, _fetcher(), steps=[static.static_step], log=lambda m: None)
    cat = report.catalog
    ids = {e["id"] for e in cat.entries}
    assert LIVE_IDS | NOT_USED_IDS | PENDING_IDS | {"scenario"} <= ids
    for e in cat.entries:
        validate_entry(e)
    for i in LIVE_IDS:
        live = cat.get(i)["live"]
        assert live["url_template"].startswith("https://")
        assert live["scheme"] in ("wmts-eq", "tms-webmercator", "arcgis")
    for i in NOT_USED_IDS:
        assert cat.get(i)["access"] == "not_used"
    for i in PENDING_IDS:
        assert cat.get(i)["access"] == "pending"
    assert "IR-10" in cat.get("communications")["reason"] and "later factor" not in cat.get("communications")["reason"]
    sc = cat.get("scenario")
    assert sc["evidence_type"] == "assumption"
    assert [f["path"] for f in sc["files"]] == ["scenario.json"]
    assert (tmp_path / "scenario.json").read_bytes() == SCENARIO.read_bytes()
    assert "Pictures only" in " ".join(cat.get("thermal_day")["limitations"])
    assert "y_tms" in " ".join(cat.get("imagery_hirise_color")["limitations"])
    assert cat.areas["study_area"] == scenario.study_area.as_list()
    assert cat.areas["sites"]["curiosity_recent"] == scenario.sites[0].bounds.as_list()


def test_coverage_report(scenario):
    site = scenario.sites[0].bounds
    full = new_entry("full_one", "F", "s", ["terrain"], "c", "observation", "live", coverage={"bounds": [130, -10, 140, 0]})
    part = new_entry("part_one", "P", "s", ["terrain"], "c", "observation", "live",
                     coverage={"bounds": [site.west, site.south, (site.west + site.east) / 2, site.north]})
    none = new_entry("none_one", "N", "s", ["terrain"], "c", "reference", "live")
    gridded = new_entry("grid_one", "G", "s", ["terrain"], "c", "derived", "live",
                        coverage={"area": "curiosity_recent", "bounds": site.as_list(), "covered_fraction": 0.9})
    unused = new_entry("unused_one", "U", "s", [], "c", "reference", "not_used", reason="x")
    cat = Catalog(entries=[full, part, none, gridded, unused])
    rows = {(r["area"], r["dataset_id"]): r for r in build_coverage_report(cat, scenario)}
    assert rows[("study_area", "full_one")]["covers"] == "full"
    assert rows[("curiosity_recent", "part_one")]["covers"] == "partial"
    assert rows[("curiosity_recent", "none_one")]["covers"] == "unknown"
    assert rows[("curiosity_recent", "grid_one")]["covers"] == "partial"
    assert rows[("curiosity_recent", "grid_one")]["covered_fraction"] == 0.9
    assert not any(k[1] == "unused_one" for k in rows)


# --- final-review fixes -------------------------------------------------------------------------------------------

MOVED_SITE = [{"id": "curiosity_recent", "name": "moved", "note": "test",
               "bounds": [137.30, -4.70, 137.35, -4.65]}]


def _changed_scenario(tmp_path, **changes):
    import json

    raw = json.loads(SCENARIO.read_text())
    raw.update(changes)
    p = tmp_path / "changed.json"
    p.write_text(json.dumps(raw))
    return load_scenario(p)


def _ctx(scenario, root, entries=()):
    from martian_map.snapshot import StepContext

    return StepContext(scenario, root, _fetcher(), False, None, lambda m: None,
                       catalog=Catalog(entries=[dict(e) for e in entries]))


def _changed_steps(a, b, root):
    from martian_map.snapshot import step_fingerprint
    from martian_map.sources import all_steps

    fa = {s.id: step_fingerprint(s, _ctx(a, root)) for s in all_steps(a)}
    fb = {s.id: step_fingerprint(s, _ctx(b, root)) for s in all_steps(b)}
    return {k for k in fa if fa[k] != fb.get(k)}


def test_scenario_change_reruns_step(tmp_path, scenario):
    counter = {}
    base = _writer_step("a", "a_data", counter)
    step = Step(base.id, base.dataset_ids, base.run,
                inputs=lambda ctx: ctx.scenario.site("curiosity_recent").bounds.as_list())
    data = tmp_path / "data"
    run_snapshot(scenario, data, _fetcher(), steps=[step], log=lambda m: None)
    run_snapshot(scenario, data, _fetcher(), steps=[step], log=lambda m: None)
    assert counter == {"a": 1}
    moved = _changed_scenario(tmp_path, sites=MOVED_SITE)
    run_snapshot(moved, data, _fetcher(), steps=[step], log=lambda m: None)
    assert counter == {"a": 2}


def test_moving_a_site_changes_only_that_sites_steps(tmp_path, scenario):
    import json

    sites = json.loads(SCENARIO.read_text())["sites"]
    sites = [dict(s, bounds=MOVED_SITE[0]["bounds"]) if s["id"] == "curiosity_recent" else s for s in sites]
    moved = _changed_scenario(tmp_path, sites=sites)
    assert _changed_steps(scenario, moved, tmp_path) == {"elevation_site_curiosity_recent", "solar_curiosity_recent",
                                                         "dune_change"}  # its distances to the sites change


def test_moving_the_region_changes_region_steps(tmp_path, scenario):
    moved = _changed_scenario(tmp_path, gale_region=[136.0, -6.5, 139.5, -3.5])
    assert _changed_steps(scenario, moved, tmp_path) == {"elevation_region", "geology", "minerals", "dunes",
                                                         "thermal_inertia", "water"}


def test_moving_the_study_area_changes_study_steps(tmp_path, scenario):
    moved = _changed_scenario(tmp_path, study_area=[137.12, -4.925, 137.730, -4.249])
    assert _changed_steps(scenario, moved, tmp_path) == {
        "elevation_study", "geology_index", "themis_list", "themis_samples"}


def test_solar_fingerprint_follows_elevation_files_and_offset(tmp_path, scenario):
    from martian_map.snapshot import step_fingerprint
    from martian_map.sources import solar

    step = solar.solar_steps(scenario)[0]

    def elev(sha):
        return new_entry("elevation_1m_curiosity_recent", "E", "s", ["terrain"], "elevation", "observation", "local",
                         files=[{"path": "elevation/x.f32", "format": "f32", "bytes": 4, "sha256": sha}])

    def region(offset):
        return new_entry("elevation_463m_region", "R", "s", ["terrain"], "elevation", "observation", "live",
                         alignment={"regional_vs_local": {"median_offset_m": offset}})

    fp = lambda entries: step_fingerprint(step, _ctx(scenario, tmp_path, entries))
    assert fp([elev("a" * 64)]) != fp([elev("b" * 64)])
    assert fp([elev("a" * 64), region(-5.3)]) != fp([elev("a" * 64), region(-2.0)])


def test_entries_no_step_makes_are_dropped(tmp_path, scenario):
    counter = {}
    a, b = _writer_step("a", "a_data", counter), _writer_step("b", "b_data", counter)
    run_snapshot(scenario, tmp_path, _fetcher(), steps=[a, b], log=lambda m: None)
    logs = []
    run_snapshot(scenario, tmp_path, _fetcher(), steps=[a], log=logs.append)
    cat = Catalog.load(tmp_path / "catalog.json")
    assert {e["id"] for e in cat.entries} == {"a_data"}
    assert (tmp_path / "test" / "b_data.bin").exists()
    assert any("b_data" in m and "removed" in m for m in logs)


def test_only_reruns_a_fresh_step(tmp_path, scenario):
    counter = {}
    steps = [_writer_step("a", "a_data", counter), _writer_step("b", "b_data", counter)]
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, log=lambda m: None)
    run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, only={"a"}, log=lambda m: None)
    assert counter == {"a": 2, "b": 1}


def test_only_unknown_id_rejected(tmp_path, scenario):
    from martian_map.snapshot import SnapshotError

    steps = [_writer_step("a", "a_data", {})]
    with pytest.raises(SnapshotError, match="typo") as err:
        run_snapshot(scenario, tmp_path, _fetcher(), steps=steps, only={"a", "typo"}, log=lambda m: None)
    assert "a_data" in str(err.value)
    assert not (tmp_path / "catalog.json").exists()


def test_coverage_report_reads_grid_mask(tmp_path, scenario):
    import math

    import numpy as np

    from martian_map.grids import Grid, write_grid

    study, site = scenario.study_area, scenario.sites[0].bounds
    grid = Grid(np.ones((100, 120), dtype=np.float32), study)
    px, py = grid.pixel_deg
    c0, c1 = int((site.west - study.west) / px) - 1, int(math.ceil((site.east - study.west) / px)) + 1
    r0, r1 = int((study.north - site.north) / py) - 1, int(math.ceil((study.north - site.south) / py)) + 1
    grid.values[r0:r1, c0:c1] = np.nan  # the image misses the site entirely
    themis_like = new_entry("themis_like", "T", "s", ["thermal"], "thermal", "observation", "local",
                            files=[write_grid(grid, tmp_path / "t.f32", tmp_path, "f32")],
                            coverage={"area": "study_area", "bounds": study.as_list(), "covered_fraction": 0.5})
    site_grid = Grid(np.ones((40, 30), dtype=np.float32), site)
    site_only = new_entry("site_only", "S", "s", ["terrain"], "elevation", "observation", "local",
                          files=[write_grid(site_grid, tmp_path / "s.f32", tmp_path, "f32")],
                          coverage={"area": "curiosity_recent", "bounds": site.as_list(), "covered_fraction": 1.0})
    rows = {(r["area"], r["dataset_id"]): r
            for r in build_coverage_report(Catalog(entries=[themis_like, site_only]), scenario, tmp_path)}
    assert rows[("curiosity_recent", "themis_like")]["covers"] == "none"
    assert rows[("curiosity_recent", "themis_like")]["covered_fraction"] == 0.0
    whole = rows[("study_area", "themis_like")]
    assert whole["covers"] == "partial"
    assert whole["covered_fraction"] == pytest.approx(1 - float(np.isnan(grid.values).mean()), abs=1e-6)
    assert rows[("curiosity_recent", "site_only")]["covers"] == "full"
    sx, sy = site.east - site.west, site.north - site.south
    tx, ty = study.east - study.west, study.north - study.south
    part = rows[("study_area", "site_only")]
    assert part["covers"] == "partial"
    assert part["covered_fraction"] == pytest.approx(sx * sy / (tx * ty), rel=1e-3)
