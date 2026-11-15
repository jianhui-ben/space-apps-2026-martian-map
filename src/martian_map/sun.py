"""Where the sun is in the Martian sky, by season and local solar time.

Formulas from NASA GISS Mars24 "Algorithm and Worked Examples"
(https://www.giss.nasa.gov/tools/mars24/help/algorithm.html; Allison 1997,
Allison & McEwen 2000):

* D-1 solar declination: ``asin(0.42565 sin Ls) + 0.25 deg sin Ls``
* D-5 zenith angle: ``Z = acos(sin d sin phi + cos d cos phi cos H)``
* D-6 azimuth: ``A = atan2(sin H, cos phi tan d - sin phi cos H)``

Mars24's hour angle is ``H = lon_west - subsolar_lon_west``, which equals
``-15 deg x (LTST - 12 h)``. Latitudes in D-5/D-6 are planetographic.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import numpy as np

MARS_EQUATORIAL_RADIUS_KM = 3396.19
MARS_POLAR_RADIUS_KM = 3376.20


def planetographic_lat(lat_planetocentric_deg: float) -> float:
    if lat_planetocentric_deg == 0:
        return 0.0
    k = (MARS_EQUATORIAL_RADIUS_KM / MARS_POLAR_RADIUS_KM) ** 2
    return math.degrees(math.atan(math.tan(math.radians(lat_planetocentric_deg)) * k))


def solar_declination_deg(ls_deg: float) -> float:
    s = math.sin(math.radians(ls_deg))
    return math.degrees(math.asin(0.42565 * s)) + 0.25 * s


def sun_elevation_azimuth(lat_deg: float, ls_deg: float, ltst_h: float) -> Tuple[float, float]:
    """(elevation, azimuth) in degrees for a planetographic latitude; azimuth from north, clockwise."""
    d = math.radians(solar_declination_deg(ls_deg))
    phi = math.radians(lat_deg)
    h = math.radians(-15.0 * (ltst_h - 12.0))
    cos_z = math.sin(d) * math.sin(phi) + math.cos(d) * math.cos(phi) * math.cos(h)
    elevation = 90.0 - math.degrees(math.acos(max(-1.0, min(1.0, cos_z))))
    azimuth = math.degrees(math.atan2(math.sin(h), math.cos(phi) * math.tan(d) - math.sin(phi) * math.cos(h))) % 360.0
    return elevation, azimuth


def sun_table(lat_deg: float, ls_step: float = 15.0, time_step_h: float = 0.5) -> Dict[str, Any]:
    """Sun elevation and azimuth for every season step x local-time step at a planetocentric latitude."""
    lat_g = planetographic_lat(lat_deg)
    ls_values = [round(i * ls_step, 6) for i in range(int(round(360 / ls_step)))]
    times = [round(i * time_step_h, 6) for i in range(int(round(24 / time_step_h)))]
    elev: List[List[float]] = []
    azim: List[List[float]] = []
    for ls in ls_values:
        row_e, row_a = [], []
        for t in times:
            e, a = sun_elevation_azimuth(lat_g, ls, t)
            row_e.append(round(e, 3))
            row_a.append(round(a, 3))
        elev.append(row_e)
        azim.append(row_a)
    return {
        "latitude_planetocentric_deg": lat_deg,
        "latitude_planetographic_deg": lat_g,
        "ls": ls_values,
        "ltst_h": times,
        "elevation_deg": elev,
        "azimuth_deg": azim,
        "method": "Mars24 eqs. D-1, D-5, D-6 (https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)",
    }


def sunlit_fraction(table: Dict[str, Any], horizon_deg: np.ndarray) -> List[List[float]]:
    """Fraction of horizon points where the sun is above the skyline, per (season, time) cell."""
    hz = np.asarray(horizon_deg, dtype=np.float64)
    out: List[List[float]] = []
    for row_e, row_a in zip(table["elevation_deg"], table["azimuth_deg"]):
        row = []
        for e, a in zip(row_e, row_a):
            if e <= 0 or hz.shape[0] == 0:
                row.append(0.0)
                continue
            col = hz[:, int(round(a)) % hz.shape[1]]
            valid = np.isfinite(col)
            row.append(round(float((e > col[valid]).mean()) if valid.any() else 0.0, 4))
        out.append(row)
    return out


__all__ = ["planetographic_lat", "solar_declination_deg", "sun_elevation_azimuth", "sun_table", "sunlit_fraction"]
