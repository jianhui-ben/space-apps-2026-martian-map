import math

import pytest

from martian_map.geo import MARS_MEAN_RADIUS_KM
from martian_map.traverse import (
    HAZARD_AVOID,
    HAZARD_CAUTION,
    HAZARD_OK,
    HAZARD_UNKNOWN,
    Waypoint,
    classify_slope,
    parse_waypoints,
    plan_traverse,
    slope_deg,
)

KM_PER_DEG = math.pi * MARS_MEAN_RADIUS_KM / 180.0


def test_parse_waypoints_mixed_elevation():
    wps = parse_waypoints(" -4.6, 137.4 ; -4.7,137.5,-4400 ")
    assert [(w.lat, w.lon, w.elevation_m) for w in wps] == [(-4.6, 137.4, None), (-4.7, 137.5, -4400.0)]


def test_parse_waypoints_normalises_longitude():
    assert parse_waypoints("0,200;0,10")[0].lon == pytest.approx(-160.0)


@pytest.mark.parametrize(
    "text",
    ["", "   ", "1", "1,2,3,4", "a,b", "1,2;", ";1,2", "nan,1;1,2", "1,inf;1,2", "91,0;0,0"],
)
def test_parse_waypoints_rejects_bad_input(text):
    with pytest.raises(ValueError):
        parse_waypoints(text)


def test_waypoint_rejects_bad_elevation():
    with pytest.raises(ValueError):
        Waypoint(0, 0, elevation_m=float("nan"))
    with pytest.raises(ValueError):
        Waypoint(0, 0, elevation_m=True)


def test_waypoint_label():
    assert Waypoint(0, 0).label(3) == "WP3"
    assert Waypoint(0, 0, name="Camp").label(3) == "Camp"


def test_slope_deg():
    assert slope_deg(0, 1) == 0.0
    assert slope_deg(1000, 1) == pytest.approx(45.0)
    assert slope_deg(-1000, 1) == pytest.approx(45.0)  # descents count too
    assert slope_deg(0, 0) == 0.0
    assert slope_deg(5, 0) == 90.0
    with pytest.raises(ValueError):
        slope_deg(1, -1)


@pytest.mark.parametrize(
    "slope, expected",
    [(None, HAZARD_UNKNOWN), (0, HAZARD_OK), (14.99, HAZARD_OK), (15, HAZARD_CAUTION), (24.9, HAZARD_CAUTION), (25, HAZARD_AVOID), (60, HAZARD_AVOID)],
)
def test_classify_slope(slope, expected):
    assert classify_slope(slope) == expected


def test_classify_slope_rejects_inverted_thresholds():
    with pytest.raises(ValueError):
        classify_slope(5, caution_deg=30, max_deg=20)


def test_plan_traverse_totals_and_flags():
    # Three legs of 1 deg of latitude each along a meridian.
    wps = [
        Waypoint(0, 0, 0.0),
        Waypoint(1, 0, 100.0),  # ~1.7 deg: ok
        Waypoint(2, 0, 100.0 + KM_PER_DEG * 1000 * math.tan(math.radians(20))),  # 20 deg: caution
        Waypoint(3, 0, None),  # unknown
    ]
    s = plan_traverse(wps, walking_speed_kmh=2.0, max_range_km=200)
    assert [leg.hazard for leg in s.legs] == [HAZARD_OK, HAZARD_CAUTION, HAZARD_UNKNOWN]
    assert s.total_distance_km == pytest.approx(3 * KM_PER_DEG)
    assert s.estimated_hours == pytest.approx(3 * KM_PER_DEG / 2.0)
    assert s.max_slope_deg == pytest.approx(20.0)
    assert s.flagged_leg_indices == [1]
    assert s.within_range is True


def test_plan_traverse_range_and_no_elevations():
    s = plan_traverse([Waypoint(0, 0), Waypoint(0, 1)], max_range_km=1.0)
    assert s.within_range is False
    assert s.max_slope_deg is None
    assert s.flagged_leg_indices == []
    assert plan_traverse([Waypoint(0, 0), Waypoint(0, 1)]).within_range is None


def test_plan_traverse_avoid_leg_is_flagged():
    steep = KM_PER_DEG * 1000 * math.tan(math.radians(30))
    s = plan_traverse([Waypoint(0, 0, 0.0), Waypoint(1, 0, steep)])
    assert s.legs[0].hazard == HAZARD_AVOID
    assert s.flagged_leg_indices == [0]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"walking_speed_kmh": 0},
        {"walking_speed_kmh": -1},
        {"walking_speed_kmh": float("nan")},
        {"max_range_km": -1},
        {"max_range_km": float("nan")},
        {"caution_slope_deg": 30, "max_slope_deg": 20},
    ],
)
def test_plan_traverse_rejects_bad_parameters(kwargs):
    with pytest.raises(ValueError):
        plan_traverse([Waypoint(0, 0), Waypoint(0, 1)], **kwargs)


def test_plan_traverse_needs_two_waypoints():
    with pytest.raises(ValueError):
        plan_traverse([Waypoint(0, 0)])
