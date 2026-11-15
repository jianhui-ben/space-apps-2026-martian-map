import copy
import json
from pathlib import Path

import pytest

from martian_map.scenario import Bounds, ScenarioError, load_scenario

REPO_SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"


def _write(tmp_path, data):
    p = tmp_path / "s.json"
    p.write_text(json.dumps(data))
    return p


def _base_data():
    return json.loads(REPO_SCENARIO.read_text())


def test_load_repo_scenario():
    sc = load_scenario(REPO_SCENARIO)
    assert [s.id for s in sc.sites] == ["curiosity_recent", "near_base_north", "near_base_west"]
    base = sc.base
    for s in sc.sites[1:]:  # near-base candidates: about 2 x 2 km, not containing the base
        w, h = s.bounds.size_m()
        assert 1900 < w < 2100 and 1900 < h < 2100
        assert not s.bounds.contains(*base)
    assert sc.study_area.contains(137.4416, -4.5895)
    assert sc.base == (137.4416, -4.5895)
    for name, a in sc.assumptions.items():
        assert "value" in a and "note" in a, name


def test_site_outside_study_area_rejected(tmp_path):
    data = _base_data()
    data["sites"] = [{"id": "far", "name": "far", "bounds": [138.0, -5.0, 138.02, -4.98], "note": "x"}]
    with pytest.raises(ScenarioError, match="outside study_area"):
        load_scenario(_write(tmp_path, data))


def test_site_too_large_rejected(tmp_path):
    data = _base_data()
    data["sites"] = [{"id": "huge", "name": "huge", "bounds": [137.30, -4.80, 137.40, -4.70], "note": "x"}]
    with pytest.raises(ScenarioError, match="5000"):
        load_scenario(_write(tmp_path, data))


def test_bad_site_id_rejected(tmp_path):
    data = _base_data()
    data["sites"][0]["id"] = "Site 1"
    with pytest.raises(ScenarioError, match="id"):
        load_scenario(_write(tmp_path, data))


def test_duplicate_site_id_rejected(tmp_path):
    data = _base_data()
    data["sites"].append(copy.deepcopy(data["sites"][0]))
    with pytest.raises(ScenarioError, match="duplicate"):
        load_scenario(_write(tmp_path, data))


def test_base_outside_study_area_rejected(tmp_path):
    data = _base_data()
    data["base"] = {"lon": 138.5, "lat": -5.5, "note": "x"}
    with pytest.raises(ScenarioError, match="base"):
        load_scenario(_write(tmp_path, data))


def test_bounds_validation():
    with pytest.raises(ValueError):
        Bounds(10, 0, 5, 1)
    with pytest.raises(ValueError):
        Bounds(0, 1, 1, 0)
    with pytest.raises(ValueError):
        Bounds(0, -91, 1, 0)


def test_bounds_size_m():
    w, h = Bounds(137.362, -4.843, 137.414, -4.766).size_m()
    assert w == pytest.approx(3072, rel=0.01)
    assert h == pytest.approx(4564, rel=0.01)


def test_bounds_geometry():
    a = Bounds(0, 0, 2, 2)
    b = Bounds(1, 1, 3, 3)
    assert a.intersects(b)
    assert a.intersection(b) == Bounds(1, 1, 2, 2)
    assert a.intersection(Bounds(5, 5, 6, 6)) is None
    assert not a.intersects(Bounds(5, 5, 6, 6))
    assert a.center() == (1, 1)
    assert a.as_list() == [0, 0, 2, 2]


def test_trip_area_must_be_inside_study_area(tmp_path):
    import json as _json
    data = _json.loads((Path(__file__).resolve().parents[1] / "scenario" / "gale.json").read_text())
    data["trip_area"] = {"bounds": [137.0, -4.62, 137.461, -4.548]}
    p = tmp_path / "s.json"
    p.write_text(_json.dumps(data))
    with pytest.raises(ScenarioError, match="trip_area"):
        load_scenario(p)


def test_gale_trip_area_covers_base_and_near_sites():
    sc = load_scenario(Path(__file__).resolve().parents[1] / "scenario" / "gale.json")
    assert sc.trip_area.contains(*sc.base)
    for sid in ("near_base_north", "near_base_west"):
        assert sc.trip_area.contains_bounds(sc.site(sid).bounds)
