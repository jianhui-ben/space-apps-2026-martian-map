import json
from pathlib import Path

import pytest

from martian_map.catalog import Catalog, file_record, new_entry
from martian_map.http import Fetcher
from martian_map.scenario import ScenarioError, load_scenario
from martian_map.snapshot import Step, merge_regions, run_snapshot

ROOT = Path(__file__).resolve().parents[1]
GALE = ROOT / "scenario" / "gale.json"


def _jezero(tmp_path, **changes):
    raw = {
        "name": "test Jezero",
        "region": {"id": "jezero", "name": "Jezero crater"},
        "region_bounds": [76.5, 17.5, 78.5, 19.5],
        "study_area": [77.3, 18.3, 77.6, 18.6],
        "base": {"lon": 77.45, "lat": 18.44},
        "rover": "perseverance",
        "elevation": {
            "study": {"url": "https://astrogeo-ard.s3-us-west-2.amazonaws.com/ctx.tif", "name": "CTX DTM X",
                      "resolution_m": 20},
            "fine": {"url": "https://astrogeo-ard.s3-us-west-2.amazonaws.com/hirise.tif", "name": "HiRISE DTM Y",
                     "bounds": [77.38, 18.30, 77.50, 18.55]},
        },
        "sites": [{"id": "jz_a", "name": "A", "bounds": [77.40, 18.40, 77.42, 18.42]}],
        "assumptions": {},
    }
    raw.update(changes)
    p = tmp_path / "jezero.json"
    p.write_text(json.dumps(raw))
    return load_scenario(p)


def test_gale_scenario_defaults():
    sc = load_scenario(GALE)
    assert sc.region_id == "gale" and sc.region_name == "Gale crater" and sc.rover == "curiosity"
    assert sc.elevation is None and sc.region_bounds == sc.gale_region


def test_region_scenario_fields(tmp_path):
    sc = _jezero(tmp_path)
    assert sc.region_id == "jezero" and sc.rover == "perseverance"
    assert sc.region_bounds.as_list() == [76.5, 17.5, 78.5, 19.5]
    assert sc.elevation["study"]["resolution_m"] == 20


def test_sites_must_sit_on_the_fine_elevation_model(tmp_path):
    with pytest.raises(ScenarioError, match="1 m elevation model"):
        _jezero(tmp_path, sites=[{"id": "jz_b", "name": "B", "bounds": [77.52, 18.40, 77.54, 18.42]}])


def test_unknown_rover_rejected(tmp_path):
    with pytest.raises(ScenarioError, match="rover"):
        _jezero(tmp_path, rover="sojourner")


def _step(dataset_id, text):
    def run(ctx):
        path = ctx.path(f"misc/{dataset_id}.json")
        path.write_text(json.dumps({"text": text}))
        return [new_entry(dataset_id, f"{dataset_id} title", "summary", ["terrain"], "elevation", "derived", "local",
                          files=[file_record(path, ctx.data_root, "json")])]
    return Step(dataset_id, (dataset_id,), run)


def _run(sc, root, steps):
    return run_snapshot(sc, root, Fetcher(session=object(), sleep=lambda s: None), steps=steps, log=lambda m: None)


def test_regions_merge_into_the_root_catalog_and_survive_a_gale_run(tmp_path):
    data = tmp_path / "data"
    gale = load_scenario(GALE)
    _run(gale, data, [_step("elevation_10m_study", "gale")])
    jz = _jezero(tmp_path)
    report = _run(jz, data / "regions" / "jezero", [_step("elevation_20m_study", "jezero")])
    assert report.catalog.get("elevation_20m_study")["region"] == "jezero"
    merge_regions(data)

    root = Catalog.load(data / "catalog.json")
    e = root.get("elevation_20m_study__jezero")
    assert e["dataset"] == "elevation_20m_study" and e["region"] == "jezero"
    assert e["files"][0]["path"] == "regions/jezero/misc/elevation_20m_study.json"
    assert root.get("elevation_10m_study")["region"] == "gale"
    assert set(root.areas["regions"]) == {"gale", "jezero"}
    assert root.areas["regions"]["jezero"]["name"] == "Jezero crater"
    assert root.areas["regions"]["jezero"]["region"] == [76.5, 17.5, 78.5, 19.5]
    assert root.areas["gale_region"] == gale.region_bounds.as_list()  # Gale's top-level keys stay
    assert all(r.state == "ok" for r in root.check(data))

    _run(gale, data, [_step("elevation_10m_study", "gale again")])  # a Gale re-run keeps the other regions
    merge_regions(data)
    root = Catalog.load(data / "catalog.json")
    assert root.get("elevation_20m_study__jezero")["region"] == "jezero"
    assert set(root.areas["regions"]) == {"gale", "jezero"}
    assert not any(r["dataset_id"] == "elevation_20m_study__jezero" and r.get("region") == "gale"
                   for r in root.coverage_report)


def test_region_catalog_entries_get_region_references(tmp_path):
    jz = _jezero(tmp_path)
    data = tmp_path / "data"
    report = _run(jz, data / "regions" / "jezero", [_step("elevation_1m_jz_a", "x")])
    refs = report.catalog.get("elevation_1m_jz_a")["references"]
    assert "usgs_hirise_dtm_jezero" in refs and "mars_trek" not in refs
    assert "usgs_hirise_dtm_jezero" in report.catalog.references


# --- elevation from cloud-optimised GeoTIFFs ---------------------------------------------------------------------

import math  # noqa: E402

import numpy as np  # noqa: E402
from tiff_helpers import RangeSession, make_geotiff, to_bigtiff  # noqa: E402

M_PER_DEG = 3396190.0 * math.pi / 180.0
FINE_URL = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/test/hirise.tif"
STUDY_URL = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/test/ctx.tif"


def _cog(bounds, px_m, offset=0.0, predictor=2):
    w = round((bounds[2] - bounds[0]) * M_PER_DEG / px_m)
    h = round((bounds[3] - bounds[1]) * M_PER_DEG / px_m)
    yy, xx = np.mgrid[0:h, 0:w]
    heights = (-2500.0 + offset + 0.05 * xx * px_m + 0.02 * yy * px_m).astype(np.float32)[None]
    return to_bigtiff(make_geotiff(heights, pixel_scale=(px_m, px_m),
                                   tiepoint_xy=(bounds[0] * M_PER_DEG, bounds[3] * M_PER_DEG),
                                   compression=8, predictor=predictor, tile=(64, 64), nodata="-32767"))


def _cog_scenario(tmp_path):
    return _jezero(
        tmp_path, study_area=[77.39, 18.39, 77.42, 18.42], base={"lon": 77.402, "lat": 18.402},
        elevation={"study": {"url": STUDY_URL, "name": "CTX DTM X", "resolution_m": 20},
                   "fine": {"url": FINE_URL, "name": "HiRISE DTM Y", "bounds": [77.40, 18.40, 77.41, 18.41]}},
        sites=[{"id": "jz_a", "name": "A", "bounds": [77.4005, 18.4005, 77.4030, 18.4030]}],
        trip_area={"bounds": [77.401, 18.401, 77.404, 18.404]})


def test_region_elevation_reads_the_scenario_models(tmp_path):
    from martian_map.sources import elevation

    sc = _cog_scenario(tmp_path)
    session = RangeSession({FINE_URL: _cog([77.40, 18.40, 77.41, 18.41], 1.0),
                            STUDY_URL: _cog([77.38, 18.38, 77.43, 18.43], 20.0, offset=35.0, predictor=3)})
    steps = [elevation.study_step_for(sc), *elevation.site_steps(sc), *elevation.trip_steps(sc)]
    report = run_snapshot(sc, tmp_path / "jz", Fetcher(session=session, sleep=lambda s: None), steps=steps,
                          log=lambda m: None)
    assert report.failed == []
    cat = report.catalog
    assert {"elevation_20m_study", "slope_20m_study", "elevation_1m_jz_a", "slope_10m_window_jz_a",
            "elevation_2m_trip_area"} <= {e["id"] for e in cat.entries}
    study = cat.get("elevation_20m_study")
    assert study["resolution_m"] == 20 and study["source"]["request_url"] == STUDY_URL
    assert "CTX DTM X" in study["source"]["name"]
    site = cat.get("elevation_1m_jz_a")
    assert site["source"]["request_url"] == FINE_URL and site["coverage"]["covered_fraction"] == 1.0
    slope = cat.get("slope_1m_jz_a")
    from martian_map.grids import read_grid
    g = read_grid(tmp_path / "jz", slope["files"][0])
    assert np.nanmedian(g.values) == pytest.approx(math.degrees(math.atan(math.hypot(0.05, 0.02))), abs=0.2)
    trip = cat.get("elevation_2m_trip_area")
    assert any("2 x 2" in lim for lim in trip["limitations"])
    assert elevation.study_dataset(sc) == "elevation_20m_study"
    assert elevation.study_dataset(load_scenario(GALE)) == "elevation_10m_study"


def test_region_horizon_levels_the_study_model_to_the_site_model(tmp_path):
    from martian_map.catalog import new_entry as _entry
    from martian_map.grids import Grid, write_grid
    from martian_map.scenario import Bounds
    from martian_map.sources import solar

    m = 3396190.0 * math.pi / 180.0
    site_b = [77.4005, 18.4005, 77.4005 + 300 / m, 18.4005 + 300 / m]
    sc = _cog_scenario(tmp_path)
    raw = json.loads(sc.path.read_text())
    raw["sites"] = [{"id": "s1", "name": "s1", "bounds": site_b}]
    raw.pop("trip_area")
    sc.path.write_text(json.dumps(raw))
    sc = load_scenario(sc.path)

    def seed(ctx):
        out = []
        for eid, b, n, h in (("elevation_1m_s1", Bounds(*site_b), 30, 0.0), ("elevation_20m_study", sc.study_area, 50, 35.0),
                             ("elevation_463m_region", sc.region_bounds, 40, 35.0)):
            f = write_grid(Grid(np.full((n, n), h, dtype=np.float32), b), ctx.path(f"elevation/{eid}.f32"),
                           ctx.data_root, "f32")
            extra = {"alignment": {"regional_vs_local": {"median_offset_m": 0.0}}} if "463" in eid else {}
            out.append(_entry(eid, eid, "e", ["terrain"], "elevation", "derived", "local", files=[f], **extra))
        return out

    seed_step = Step("seed", ("elevation_1m_s1", "elevation_20m_study", "elevation_463m_region"), seed)
    report = _run(sc, tmp_path / "d", [seed_step, *solar.solar_steps(sc)])
    assert report.failed == []
    hz = report.catalog.get("horizon_s1")
    assert hz["study_offset_m"] == pytest.approx(-35.0)
    angles = np.fromfile(tmp_path / "d" / hz["files"][0]["path"], dtype=np.uint8)
    assert angles.max() <= 4  # flat once levelled (<= 1 degree); unlevelled, the 35 m step would rise ~10 degrees


def test_perseverance_rover_step(tmp_path):
    from conftest import FakeResponse, FakeSession
    from martian_map.sources import rover

    def js(obj):
        return FakeResponse(200, json.dumps(obj).encode(), {"Content-Type": "application/json"})

    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"sol": 13, "elev_geoid": -2569.9},
         "geometry": {"type": "Point", "coordinates": [77.4509, 18.4446]}}]}
    urls = rover.mission_urls("perseverance")
    assert urls["traverse"] == "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
    routes = {urls[k]: js(fc) for k in ("traverse", "waypoints", "current", "surface_sites")}
    routes[urls["config"]] = js({"msv": {"mission": "M20"}, "layers": []})
    sc = _jezero(tmp_path)
    report = run_snapshot(sc, tmp_path / "jz", Fetcher(session=FakeSession(routes), sleep=lambda s: None),
                          steps=[rover.rover_step], log=lambda m: None)
    assert report.failed == []
    stops = report.catalog.get("rover_stops")
    assert stops["title"] == "Perseverance's stops" and stops["files"][0]["path"] == "rover/M20_waypoints.json"
    assert stops["references"] == ["m20_mmgis"]
    assert "1,025 kg" in report.catalog.get("rover_path")["summary"]


def test_region_step_list(tmp_path):
    from martian_map.sources import all_steps

    gale_ids = [s.id for s in all_steps(load_scenario(GALE))]
    jz = all_steps(_jezero(tmp_path))
    ids = [s.id for s in jz]
    assert "weather" in gale_ids and "radiation" in gale_ids
    assert "rover" in ids and "weather" not in ids and "radiation" not in ids and "dune_change" not in ids
    static = next(s for s in jz if s.id == "static")
    assert {"radiation_rad", "weather_rems", "space_weather_donki", "ice_swim", "relief_mola", "scenario"} <= set(
        static.dataset_ids)
    assert "imagery_hirise_color" not in static.dataset_ids  # Gale-only layer
    assert next(s for s in jz if s.id == "elevation_study").dataset_ids == ("elevation_20m_study", "slope_20m_study")
    arcadia = _jezero(tmp_path, region={"id": "arcadia", "name": "Arcadia Planitia"}, rover=None)
    a_ids = [s.id for s in all_steps(arcadia)]
    assert "rover" not in a_ids
    a_static = next(s for s in all_steps(arcadia) if s.id == "static")
    assert "rover_path" in a_static.dataset_ids


def test_gale_only_entries_point_to_gale(tmp_path):
    from martian_map.sources import static

    sc = _jezero(tmp_path)
    report = _run(sc, tmp_path / "jz", [static.region_static_step(sc)])
    rad = report.catalog.get("radiation_rad")
    assert rad["access"] == "not_used" and "radiation_rad (Gale)" in rad["reason"]
    assert rad["metrics"]  # the map still finds it by metric
    assert report.catalog.get("ice_swim")["access"] == "pending"
    assert report.catalog.get("scenario")["source"]["page_url"] == "scenario/jezero.json"


def test_cli_snapshot_writes_region_under_regions_and_merges(tmp_path, monkeypatch):
    import argparse
    import io

    from martian_map import cli, sources

    data = tmp_path / "data"
    _run(load_scenario(GALE), data, [_step("elevation_10m_study", "gale")])
    sc = _jezero(tmp_path)
    monkeypatch.setattr(sources, "all_steps", lambda scenario: [_step("elevation_20m_study", "jz")])
    args = argparse.Namespace(scenario=sc.path, data_root=data, only=None, refresh=False, stretch=False)
    out = io.StringIO()
    assert cli.cmd_snapshot(args, fetcher=Fetcher(session=object(), sleep=lambda s: None), out=out) == 0
    assert (data / "regions" / "jezero" / "catalog.json").is_file()
    root = Catalog.load(data / "catalog.json")
    assert root.get("elevation_20m_study__jezero")["region"] == "jezero"
    assert "regions/jezero/catalog.json" in out.getvalue()


def test_merge_keeps_regions_whose_folder_is_missing(tmp_path):
    """On a fresh clone only data/catalog.json exists: a Gale run must not drop the other regions from it."""
    import shutil

    data = tmp_path / "data"
    gale = load_scenario(GALE)
    _run(gale, data, [_step("elevation_10m_study", "gale")])
    _run(_jezero(tmp_path), data / "regions" / "jezero", [_step("elevation_20m_study", "jezero")])
    merge_regions(data)
    shutil.rmtree(data / "regions")
    _run(gale, data, [_step("elevation_10m_study", "gale again")])
    root = merge_regions(data)
    assert root.get("elevation_20m_study__jezero")["region"] == "jezero"
    assert set(root.areas["regions"]) == {"gale", "jezero"}
    assert "jezero" in {r.get("region") for r in root.coverage_report} or not root.coverage_report


def _merged_catalog():
    gale = new_entry("slope_10m_window_site", "g", "s", ["terrain"], "c", "derived", "local",
                     files=[{"path": "x", "format": "f32", "bytes": 1, "sha256": "0" * 64}], metrics=["BT-05"],
                     references=["mro_hirise"])
    gale["region"], gale["dataset"] = "gale", gale["id"]
    jz = dict(gale, id="slope_10m_window_jezero_north__jezero", dataset="slope_10m_window_jezero_north",
              region="jezero", references=["usgs_hirise_dtm_jezero"])
    rad = new_entry("radiation_rad__jezero", "r", "s", ["routes"], "c", "reference", "not_used", reason="r",
                    metrics=["IR-12"])
    rad["region"], rad["dataset"] = "jezero", "radiation_rad"
    return Catalog(entries=[jz, gale, rad], areas={"regions": {"gale": {"name": "Gale crater"},
                                                                  "jezero": {"name": "Jezero crater"}}})


def test_table_has_a_region_column_when_regions_are_merged():
    lines = _merged_catalog().markdown_table().strip().splitlines()
    assert lines[0] == "| id | region | what it is | factors | evidence | access |"
    assert lines[2].startswith("| `slope_10m_window_site` | gale |")  # Gale first
    assert lines[3].startswith("| `radiation_rad__jezero` | jezero |")


def test_metric_and_reference_docs_group_other_regions():
    from martian_map.metrics import coverage_markdown
    from martian_map.references import references_markdown

    metrics = [{"id": "BT-05", "name": "Local pad slope", "measure": "m", "available": "Estimate today",
                "label": "Estimate today"},
               {"id": "IR-12", "name": "Radiation", "measure": "m", "available": "Partial", "label": "Partial"}]
    md = coverage_markdown(_merged_catalog(), metrics)
    row = next(line for line in md.splitlines() if line.startswith("| BT-05"))
    assert "`slope_10m_window_site`" in row and "Jezero crater: 1" in row and "__jezero" not in row
    ir = next(line for line in md.splitlines() if line.startswith("| IR-12"))
    assert "Jezero crater: 1" in ir
    refs = references_markdown(_merged_catalog())
    assert "Datasets, Jezero crater: `slope_10m_window_jezero_north`" in refs


def test_climate_retries_a_slow_mcd_request(monkeypatch):
    from martian_map.http import FetchError
    from martian_map.sources import climate

    calls = []

    class Res:
        body = b"ok"

    class F:
        def get_bytes(self, url, max_bytes, timeout_s=None, **kw):
            calls.append(timeout_s)
            if len(calls) == 1:
                raise FetchError("Read timed out")
            return Res()

    class C:
        fetcher = F()
        log = staticmethod(lambda m: None)

    assert climate._get(C(), "https://www-mars.lmd.jussieu.fr/x", 1024) == b"ok"
    assert len(calls) == 2


def test_gale_top_level_areas_keep_their_old_keys(tmp_path):
    data = tmp_path / "data"
    _run(load_scenario(GALE), data, [_step("elevation_10m_study", "gale")])
    _run(_jezero(tmp_path), data / "regions" / "jezero", [_step("elevation_20m_study", "jezero")])
    root = merge_regions(data)
    assert set(root.areas) == {"gale_region", "study_area", "base", "sites", "trip_area", "regions"}
    assert root.areas["regions"]["gale"]["name"] == "Gale crater" and root.areas["regions"]["gale"]["rover"] == "curiosity"
    _run(load_scenario(GALE), data, [_step("elevation_10m_study", "again")])
    root = merge_regions(data)
    assert set(root.areas) == {"gale_region", "study_area", "base", "sites", "trip_area", "regions"}
    assert set(root.areas["regions"]) == {"gale", "jezero"}


def test_gale_study_elevation_keeps_hirise_tag(tmp_path):
    from martian_map.sources import elevation

    sc = load_scenario(GALE)

    class Ctx:
        scenario = sc
        data_root = tmp_path

        def path(self, rel):
            p = tmp_path / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            return p

    from martian_map.grids import Grid
    g = Grid(np.zeros((8, 8), dtype=np.float32), sc.study_area)
    entries = elevation._terrain_entries(Ctx(), g, "study_area", "10m_study", 10, False, "study", {}, model="study")
    assert "hirise" in entries[0]["tags"] and "ctx" not in entries[0]["tags"]


def test_scenario_rejects_ids_that_cannot_merge(tmp_path):
    with pytest.raises(ScenarioError, match="__"):
        _jezero(tmp_path, sites=[{"id": "jz__a", "name": "A", "bounds": [77.40, 18.40, 77.42, 18.42]}])
    with pytest.raises(ScenarioError, match="64"):  # 17 + 32 + 2 + 16 = 67 characters
        _jezero(tmp_path, region={"id": "abcdefghijklmnop", "name": "x"},
                sites=[{"id": "a" * 32, "name": "A", "bounds": [77.40, 18.40, 77.42, 18.42]}])
    with pytest.raises(ScenarioError, match="elevation"):
        _jezero(tmp_path, elevation=None)


def test_references_are_rebuilt_from_the_entries(tmp_path):
    data = tmp_path / "data"
    _run(load_scenario(GALE), data, [_step("elevation_10m_study", "gale")])
    root = Catalog.load(data / "catalog.json")
    from martian_map.references import REFERENCES
    root.references["msl_rad"] = REFERENCES["msl_rad"]  # no entry uses it
    root.save(data / "catalog.json")
    assert "msl_rad" not in merge_regions(data).references


def test_no_rover_entries_cite_no_rover_map(tmp_path):
    from martian_map.references import references_for

    assert references_for("rover_path", "arcadia") == []
    assert references_for("rover_path", "jezero") == ["m20_mmgis"]


def test_jezero_rover_measured_datasets_are_pending_not_unmeasured(tmp_path):
    from martian_map.sources import static

    sc = _jezero(tmp_path)
    report = _run(sc, tmp_path / "jz", [static.region_static_step(sc)])
    for eid in ("weather_rems", "optical_depth_history"):
        e = report.catalog.get(eid)
        assert e["access"] == "pending" and "Perseverance" in e["reason"], eid
    assert "nothing like it" not in report.catalog.get("weather_rems")["reason"]
    assert "(Gale only)" not in report.catalog.get("space_weather_donki")["title"]
    assert "outside SWIM" not in report.catalog.get("ice_swim")["reason"]


def test_missing_thermal_sheet_fails_one_step_not_the_run(tmp_path):
    from martian_map.sources import thermal_inertia

    sc = _jezero(tmp_path, region={"id": "utopia", "name": "Utopia"})
    report = _run(sc, tmp_path / "u", [thermal_inertia.thermal_inertia_step])
    assert report.failed and report.failed[0][0] == "thermal_inertia"
