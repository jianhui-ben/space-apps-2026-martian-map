"""Marswalk traverse planning helpers. Pure functions, no I/O.

This is a deliberately simple, transparent model meant as a starting point
for the hackathon, not a validated mission-planning tool:

* Leg distance is the great-circle distance between waypoints.
* Leg slope is the *average* grade between two waypoints with known
  elevations. Local slopes along the leg can be much steeper; a real tool
  should sample a DEM along the path.
* Duration is distance divided by a constant suited walking speed.

Every threshold is a parameter so a team can swap in better numbers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

from .geo import MARS_MEAN_RADIUS_KM, haversine_km, normalize_lon_180, validate_lat

# Planning assumptions (illustrative defaults, all overridable).
DEFAULT_WALKING_SPEED_KMH = 1.5
DEFAULT_CAUTION_SLOPE_DEG = 15.0
DEFAULT_MAX_SLOPE_DEG = 25.0

HAZARD_OK = "ok"
HAZARD_CAUTION = "caution"
HAZARD_AVOID = "avoid"
HAZARD_UNKNOWN = "unknown"


@dataclass(frozen=True)
class Waypoint:
    lat: float
    lon: float
    elevation_m: Optional[float] = None
    name: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "lat", validate_lat(self.lat))
        object.__setattr__(self, "lon", normalize_lon_180(self.lon))
        if self.elevation_m is not None:
            elev = self.elevation_m
            if isinstance(elev, bool) or not isinstance(elev, (int, float)) or not math.isfinite(elev):
                raise ValueError(f"elevation_m must be a finite number, got {elev!r}")
            object.__setattr__(self, "elevation_m", float(elev))

    def label(self, index: int) -> str:
        return self.name or f"WP{index}"


@dataclass(frozen=True)
class Leg:
    start: Waypoint
    end: Waypoint
    distance_km: float
    slope_deg: Optional[float]
    hazard: str


@dataclass(frozen=True)
class TraverseSummary:
    legs: List[Leg]
    total_distance_km: float
    estimated_hours: float
    max_slope_deg: Optional[float]
    flagged_leg_indices: List[int] = field(default_factory=list)
    within_range: Optional[bool] = None


def parse_waypoints(text: str) -> List[Waypoint]:
    """Parse ``"lat,lon[,elevation_m][;lat,lon[,elevation_m]...]"``.

    Waypoints are numbered from 0 (WP0, WP1, ...) in errors and in the CLI table.

    >>> [ (w.lat, w.lon, w.elevation_m) for w in parse_waypoints("-4.6,137.4;-4.7,137.5,-4400") ]
    [(-4.6, 137.4, None), (-4.7, 137.5, -4400.0)]
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("waypoints string is empty")
    waypoints: List[Waypoint] = []
    for i, chunk in enumerate(text.split(";")):
        chunk = chunk.strip()
        if not chunk:
            raise ValueError(f"waypoint WP{i} is empty")
        parts = [p.strip() for p in chunk.split(",")]
        if len(parts) not in (2, 3):
            raise ValueError(f"waypoint WP{i} must be 'lat,lon' or 'lat,lon,elevation_m', got {chunk!r}")
        try:
            numbers = [float(p) for p in parts]
        except ValueError:
            raise ValueError(f"waypoint WP{i} has a non-numeric value: {chunk!r}") from None
        if not all(math.isfinite(n) for n in numbers):
            raise ValueError(f"waypoint WP{i} has a non-finite value: {chunk!r}")
        elev = numbers[2] if len(numbers) == 3 else None
        try:
            waypoints.append(Waypoint(lat=numbers[0], lon=numbers[1], elevation_m=elev))
        except ValueError as exc:
            raise ValueError(f"waypoint WP{i}: {exc}") from None
    return waypoints


def slope_deg(rise_m: float, run_km: float) -> float:
    """Average slope angle, in degrees, for a height change over a ground distance."""
    if run_km < 0:
        raise ValueError("run_km must be non-negative")
    run_m = run_km * 1000.0
    if run_m == 0:
        return 0.0 if rise_m == 0 else 90.0
    return math.degrees(math.atan2(abs(rise_m), run_m))


def classify_slope(
    slope: Optional[float],
    caution_deg: float = DEFAULT_CAUTION_SLOPE_DEG,
    max_deg: float = DEFAULT_MAX_SLOPE_DEG,
) -> str:
    """Map a slope to ``ok`` / ``caution`` / ``avoid`` (``unknown`` if None)."""
    if caution_deg > max_deg:
        raise ValueError("caution_deg must not exceed max_deg")
    if slope is None:
        return HAZARD_UNKNOWN
    if slope >= max_deg:
        return HAZARD_AVOID
    if slope >= caution_deg:
        return HAZARD_CAUTION
    return HAZARD_OK


def plan_traverse(
    waypoints: Sequence[Waypoint],
    walking_speed_kmh: float = DEFAULT_WALKING_SPEED_KMH,
    caution_slope_deg: float = DEFAULT_CAUTION_SLOPE_DEG,
    max_slope_deg: float = DEFAULT_MAX_SLOPE_DEG,
    max_range_km: Optional[float] = None,
    radius_km: float = MARS_MEAN_RADIUS_KM,
) -> TraverseSummary:
    """Summarise a multi-leg Marswalk route.

    A leg is flagged when its hazard is ``caution`` or ``avoid``.
    ``within_range`` is ``None`` unless ``max_range_km`` is given.
    """
    if len(waypoints) < 2:
        raise ValueError("a traverse needs at least two waypoints")
    if not (isinstance(walking_speed_kmh, (int, float)) and math.isfinite(walking_speed_kmh) and walking_speed_kmh > 0):
        raise ValueError("walking_speed_kmh must be a positive number")
    if max_range_km is not None and not (math.isfinite(max_range_km) and max_range_km >= 0):
        raise ValueError("max_range_km must be a non-negative number")
    # Validate thresholds once, up front, even if no leg has elevations.
    classify_slope(None, caution_slope_deg, max_slope_deg)

    legs: List[Leg] = []
    flagged: List[int] = []
    for i, (a, b) in enumerate(zip(waypoints, waypoints[1:])):
        dist = haversine_km(a.lat, a.lon, b.lat, b.lon, radius_km=radius_km)
        slope = None
        if a.elevation_m is not None and b.elevation_m is not None:
            slope = slope_deg(b.elevation_m - a.elevation_m, dist)
        hazard = classify_slope(slope, caution_slope_deg, max_slope_deg)
        if hazard in (HAZARD_CAUTION, HAZARD_AVOID):
            flagged.append(i)
        legs.append(Leg(start=a, end=b, distance_km=dist, slope_deg=slope, hazard=hazard))

    total = sum(leg.distance_km for leg in legs)
    slopes = [leg.slope_deg for leg in legs if leg.slope_deg is not None]
    return TraverseSummary(
        legs=legs,
        total_distance_km=total,
        estimated_hours=total / walking_speed_kmh,
        max_slope_deg=max(slopes) if slopes else None,
        flagged_leg_indices=flagged,
        within_range=None if max_range_km is None else total <= max_range_km,
    )
