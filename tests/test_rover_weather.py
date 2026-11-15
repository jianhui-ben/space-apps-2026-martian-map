import json
from pathlib import Path

from conftest import FakeResponse, FakeSession
from martian_map.catalog import Catalog
from martian_map.http import Fetcher
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import rover, weather
from martian_map.sources.weather import trim_rems_row

REPO = Path(__file__).resolve().parents[1]

REAL_ROW = {
    "id": "4746", "terrestrial_date": "2026-08-25", "sol": "4995", "ls": "341", "season": "Month 12",
    "min_temp": "-71", "max_temp": "-5", "pressure": "777", "pressure_string": "Higher", "abs_humidity": "--",
    "wind_speed": "--", "wind_direction": "--", "atmo_opacity": "Sunny", "sunrise": "06:46", "sunset": "18:51",
    "local_uv_irradiance_index": "Moderate", "min_gts_temp": "-84", "max_gts_temp": "4",
}


def _json(obj):
    return FakeResponse(200, json.dumps(obj).encode(), {"Content-Type": "application/json"})


def _fc(*sols):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"sol": s, "RMC": f"1_{s}"}, "geometry": {"type": "Point", "coordinates": [137.4, -4.8]}}
        for s in sols]}


def _rover_routes(waypoints=None):
    return {
        rover.TRAVERSE: _json(_fc(10, 20)),
        rover.WAYPOINTS: _json(waypoints if waypoints is not None else _fc(3, 4000, 5073)),
        rover.CURRENT: _json(_fc(5073)),
        rover.SURFACE_SITES: _json(_fc()),
        rover.CONFIG: _json({"msv": {"view": [-4.8, 137.4, 14]}, "layers": []}),
    }


def _run(tmp_path, routes, steps):
    sc = load_scenario(REPO / "scenario" / "gale.json")
    f = Fetcher(session=FakeSession(routes), sleep=lambda s: None)
    return run_snapshot(sc, tmp_path, f, steps=steps, log=lambda m: None)


def test_rover_step_writes_and_as_of(tmp_path):
    report = _run(tmp_path, _rover_routes(), [rover.rover_step])
    assert report.failed == []
    cat = Catalog.load(tmp_path / "catalog.json")
    for i in ("rover_path", "rover_stops", "rover_position", "named_sites", "map_config"):
        assert cat.get(i)["status"] == "ok", i
    stops = cat.get("rover_stops")
    assert stops["source"]["as_of"] == "sol 5073"
    assert stops["evidence_type"] == "observation"
    assert cat.get("rover_path")["ground_validated"]["value"] is True
    assert cat.get("rover_position")["live"]["url_template"] == rover.CURRENT
    assert cat.get("named_sites")["evidence_type"] == "reference"
    assert (tmp_path / "rover" / "MSL_waypoints.json").read_bytes() == json.dumps(_fc(3, 4000, 5073)).encode()


def test_rover_rejects_non_geojson(tmp_path):
    report = _run(tmp_path, _rover_routes(waypoints={"foo": 1}), [rover.rover_step])
    assert report.failed and report.failed[0][0] == "rover"
    assert "FeatureCollection" in report.failed[0][1]


def test_rems_trim():
    t = trim_rems_row(REAL_ROW)
    assert t["sol"] == 4995 and t["ls"] == 341
    assert t["ground_min_c"] == -84 and t["ground_max_c"] == 4
    assert t["air_min_c"] == -71 and t["air_max_c"] == -5
    assert t["pressure_pa"] == 777
    assert t["sunrise"] == "06:46" and t["sky"] == "Sunny" and t["uv_index"] == "Moderate"
    assert t["date"] == "2026-08-25"
    assert "wind_speed" not in t and "abs_humidity" not in t
    blank = trim_rems_row(dict(REAL_ROW, min_temp="--", pressure="--"))
    assert blank["air_min_c"] is None and blank["pressure_pa"] is None


def test_weather_step(tmp_path):
    older = dict(REAL_ROW, sol="10", terrestrial_date="2012-08-16", ls="155")
    routes = {weather.REMS_URL: _json({"descriptions": {}, "soles": [REAL_ROW, older]})}
    report = _run(tmp_path, routes, [weather.weather_step])
    assert report.failed == []
    e = Catalog.load(tmp_path / "catalog.json").get("weather_rems")
    assert e["evidence_type"] == "observation" and e["ground_validated"]["value"] is True
    assert e["observation_time"]["sols"] == [10, 4995]
    assert e["source"]["as_of"] == "sol 4995 (2026-08-25)"
    assert any("not at candidate sites" in x for x in e["limitations"])
    rows = json.loads((tmp_path / "weather" / "rems.json").read_text())
    assert [r["sol"] for r in rows] == [10, 4995]
    assert sorted(f["path"] for f in e["files"]) == ["weather/rems.json", "weather/rems_raw.json"]
