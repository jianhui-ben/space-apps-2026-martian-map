"""The sizing model scales to construction fleets of thousands of robots (integration design, Part 1)."""
import copy
import json
import time
from pathlib import Path

import pytest

from martian_map.sizing import build_requirements, from_intake
from martian_map.sizing.validation import RequestError

FIX = Path(__file__).parent / "fixtures"

# The default intake (design: "The default brief and why"); web/src/state.js DEFAULT_INTAKE must equal it.
DEFAULT_INTAKE = json.loads((FIX / "sizing_default_intake.json").read_text())


def intake(**changes):
    s = copy.deepcopy(DEFAULT_INTAKE)
    s.update(changes)
    return s


def option(result):
    return result["facility_options"][0]


def spec(result, key):
    return option(result)["specifications"][key]


def test_default_intake_resolves():
    r = build_requirements(from_intake(DEFAULT_INTAKE))
    assert option(r)["layout"]["status"] == "reference_layout"
    assert 230 <= spec(r, "facility_peak_kw")["value"] <= 280
    assert 12000 <= spec(r, "full_reference_plot_m2")["value"] <= 15000


def test_ten_thousand_robots_resolves_quickly():
    t = time.time()
    r = build_requirements(from_intake(intake(robots=10000)))
    assert time.time() - t < 5
    assert option(r)["layout"]["status"] == "reference_layout"
    assert spec(r, "facility_peak_kw")["value"] > 600


def test_layout_is_compact():
    layout = option(build_requirements(from_intake(DEFAULT_INTAKE)))["layout"]
    w, h = layout["bounding_width_m"], layout["bounding_height_m"]
    assert max(w, h) / min(w, h) <= 2


def test_small_briefs_unchanged():
    request = json.loads((FIX / "sizing_small_request.json").read_text())
    expected = json.loads((FIX / "sizing_small_expected.json").read_text())
    specs = option(build_requirements(request))["specifications"]
    for key, value in expected.items():
        if key == "network_transfer_gbps":  # the raised backbone assumption itself
            continue
        assert specs[key]["value"] == pytest.approx(value, rel=1e-9), key


def test_impossible_turnaround_unresolved():
    r = build_requirements(from_intake(intake(deadline=0.01)))
    assert spec(r, "active_workers")["status"] == "unresolved"
    assert "no_supported_configuration" in [i["code"] for i in r["input_issues"]]


def test_intake_shares_validated():
    with pytest.raises(RequestError):
        from_intake(intake(surveyPercent=60, excPercent=50))


def test_intake_fleet_counts():
    req = from_intake(DEFAULT_INTAKE)
    fleet = {f["role"]: (f["count"]["value"], f["active_count"]["value"]) for f in req["fleet"]}
    assert fleet == {"survey": (700, 700), "excavation": (1750, 1400), "transport": (1050, 840)}
    assert req["infrastructure"]["deployment"] == "dedicated"
    assert [j["type"] for j in req["jobs"]] == ["terrain_map", "progress_comparison", "fleet_plan"]


def test_survey_only_intake():
    req = from_intake(intake(workType="survey", robots=100))
    assert [(f["role"], f["count"]["value"]) for f in req["fleet"]] == [("survey", 100)]
    assert [j["type"] for j in req["jobs"]] == ["terrain_map"]


@pytest.mark.parametrize("deadline", [4, 12, 13, 24, 48])
def test_looser_turnaround_never_needs_more_workers(deadline):
    """Allowing more time for results can only help (review finding: 13 h used to become unsized)."""
    r = build_requirements(from_intake(intake(deadline=deadline)))
    assert spec(r, "active_workers")["status"] == "resolved", r["input_issues"]
    base = build_requirements(from_intake(intake(deadline=4)))
    assert spec(r, "active_workers")["value"] <= spec(base, "active_workers")["value"]


def test_long_working_day_resolves():
    r = build_requirements(from_intake(intake(hours=22, deadline=6)))
    assert spec(r, "active_workers")["status"] == "resolved", r["input_issues"]


def test_huge_duration_is_bounded_quickly():
    t = time.time()
    r = build_requirements(from_intake(intake(deadline=24, duration=10000)))
    assert time.time() - t < 10
    assert option(r)["layout"]["status"] in ("reference_layout", "unresolved")


def test_spillover_matches_full_enumeration():
    """With work spilling into the next sol, skipping repeated sols gives the full enumeration's answer."""
    from martian_map.sizing import load_bundle
    import martian_map.sizing.workloads as w
    req = from_intake(intake(robots=1500, deadline=20, duration=12.5))
    fast = build_requirements(req)
    slow_bundle = copy.deepcopy(load_bundle())
    w._FORCE_FULL = True
    try:
        slow = build_requirements(req, slow_bundle)
    finally:
        w._FORCE_FULL = False
    for key in ("active_workers", "facility_peak_kw", "facility_average_kw", "required_storage_tb"):
        assert spec(fast, key)["value"] == pytest.approx(spec(slow, key)["value"], rel=1e-12), key


def test_intake_needs_an_active_survey_robot():
    with pytest.raises(RequestError) as e:
        from_intake(intake(robots=4))  # 20% of 4 rounds down to no survey robot
    assert any(i["path"] == "/robots" for i in e.value.issues)
