"""Sun position tests.

Worked examples from NASA GISS Mars24 "Algorithm and Worked Examples"
(https://www.giss.nasa.gov/tools/mars24/help/algorithm.html, page updated
2025-01-07, read 2026-11-14): example 1 "Near Coincident Earth and Mars Times"
(0°W 0°N) and example 2 "MER-A Spirit Landing" (184.702°W, -14.640°N
planetographic).
"""

import numpy as np
import pytest

from martian_map.sun import planetographic_lat, solar_declination_deg, sun_elevation_azimuth, sun_table, sunlit_fraction


def test_declination_worked_example():
    assert solar_declination_deg(277.18758) == pytest.approx(-25.22825, abs=1e-4)
    # example 2 agrees to 2.5e-4 deg (page rounding / formula revisions); 1e-3 deg is far below the sun's 0.35 deg disk
    assert solar_declination_deg(327.32416) == pytest.approx(-13.42065, abs=1e-3)


def test_elevation_azimuth_worked_examples():
    el, az = sun_elevation_azimuth(0.0, 277.18758, 23.64840)
    assert el == pytest.approx(90 - 154.26182, abs=0.01)
    assert az == pytest.approx(191.03905, abs=0.01)
    el2, az2 = sun_elevation_azimuth(-14.640, 327.32416, 0.00025)
    assert el2 == pytest.approx(90 - 151.93895, abs=0.01)
    assert az2 == pytest.approx(179.99383, abs=0.05)


def test_declination_identities():
    assert solar_declination_deg(0.0) == pytest.approx(0.0, abs=1e-9)
    assert solar_declination_deg(90.0) == pytest.approx(25.44, abs=0.01)
    assert solar_declination_deg(270.0) == pytest.approx(-25.44, abs=0.01)


def test_noon_elevation():
    el, az = sun_elevation_azimuth(-4.8, 0.0, 12.0)
    assert el == pytest.approx(85.2, abs=0.05)
    assert az == pytest.approx(0.0, abs=0.01) or az == pytest.approx(360.0, abs=0.01)


def test_morning_sun_in_the_east():
    _, az = sun_elevation_azimuth(-4.8, 0.0, 8.0)
    assert 80 < az < 100


def test_planetographic_lat():
    assert planetographic_lat(0.0) == 0.0
    assert planetographic_lat(-4.8) == pytest.approx(-4.857, abs=0.002)


def test_sun_table_shape():
    t = sun_table(-4.8)
    assert len(t["ls"]) == 24 and t["ls"][0] == 0 and t["ls"][-1] == 345
    assert len(t["ltst_h"]) == 48 and t["ltst_h"][-1] == 23.5
    assert len(t["elevation_deg"]) == 24 and len(t["elevation_deg"][0]) == 48
    assert t["latitude_planetographic_deg"] == pytest.approx(-4.857, abs=0.002)


def test_sunlit_fraction():
    t = {"ls": [0], "ltst_h": [0.0, 1.0, 2.0], "elevation_deg": [[20.0, 40.0, -5.0]], "azimuth_deg": [[90.0, 90.0, 90.0]]}
    horizon = np.full((10, 360), 30.0)
    assert sunlit_fraction(t, horizon) == [[0.0, 1.0, 0.0]]
    horizon[:5, 90] = 50.0
    assert sunlit_fraction(t, horizon) == [[0.0, 0.5, 0.0]]
