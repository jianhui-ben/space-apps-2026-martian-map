"""The team's scenario assumptions (``scenario/gale.json``): areas, base, sites, placeholders.

Everything in a scenario is an *assumption*, not data. The snapshot reads its
areas from here; nothing in the downloaded data depends on the placeholder
values in ``assumptions``.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

MARS_SPHERE_RADIUS_M = 3_396_190.0
MAX_SITE_SIDE_M = 5000.0
_SITE_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


class ScenarioError(ValueError):
    """The scenario file is missing, malformed, or inconsistent."""


@dataclass(frozen=True)
class Bounds:
    """A lon/lat box in degrees east and planetocentric latitude."""

    west: float
    south: float
    east: float
    north: float

    def __post_init__(self) -> None:
        for name in ("west", "south", "east", "north"):
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"bounds {name} must be a finite number, got {value!r}")
        if not self.west < self.east:
            raise ValueError(f"bounds west ({self.west}) must be less than east ({self.east})")
        if not self.south < self.north:
            raise ValueError(f"bounds south ({self.south}) must be less than north ({self.north})")
        if self.south < -90 or self.north > 90:
            raise ValueError(f"bounds latitudes must be within [-90, 90], got {self.south}..{self.north}")

    @classmethod
    def from_list(cls, values: Sequence[float]) -> "Bounds":
        if not isinstance(values, (list, tuple)) or len(values) != 4:
            raise ValueError(f"bounds must be [west, south, east, north], got {values!r}")
        return cls(*values)

    def contains(self, lon: float, lat: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north

    def intersects(self, other: "Bounds") -> bool:
        return self.west < other.east and other.west < self.east and self.south < other.north and other.south < self.north

    def intersection(self, other: "Bounds") -> Optional["Bounds"]:
        if not self.intersects(other):
            return None
        return Bounds(
            max(self.west, other.west),
            max(self.south, other.south),
            min(self.east, other.east),
            min(self.north, other.north),
        )

    def contains_bounds(self, other: "Bounds") -> bool:
        return self.west <= other.west and self.south <= other.south and self.east >= other.east and self.north >= other.north

    def as_list(self) -> List[float]:
        return [self.west, self.south, self.east, self.north]

    def center(self) -> Tuple[float, float]:
        return ((self.west + self.east) / 2, (self.south + self.north) / 2)

    def size_m(self, radius_m: float = MARS_SPHERE_RADIUS_M) -> Tuple[float, float]:
        """(width at the centre latitude, height) in metres on a sphere."""
        _, lat = self.center()
        k = radius_m * math.pi / 180.0
        return ((self.east - self.west) * k * math.cos(math.radians(lat)), (self.north - self.south) * k)


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    bounds: Bounds
    note: str


@dataclass(frozen=True)
class Scenario:
    name: str
    gale_region: Bounds
    study_area: Bounds
    base: Tuple[float, float]
    sites: Tuple[Site, ...]
    assumptions: Dict[str, Dict[str, Any]]
    path: Path
    trip_area: Optional["Bounds"] = None  # optional box for route planning between the base and the sites

    def site(self, site_id: str) -> Site:
        for s in self.sites:
            if s.id == site_id:
                return s
        raise KeyError(site_id)


def _bounds(data: Dict[str, Any], key: str) -> Bounds:
    try:
        return Bounds.from_list(data[key])
    except KeyError:
        raise ScenarioError(f"scenario is missing {key!r}") from None
    except ValueError as exc:
        raise ScenarioError(f"scenario {key}: {exc}") from None


def load_scenario(path: Path) -> Scenario:
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ScenarioError(f"cannot read scenario file {path}: {exc}") from None
    except ValueError as exc:
        raise ScenarioError(f"scenario file {path} is not valid JSON: {exc}") from None
    if not isinstance(data, dict):
        raise ScenarioError("scenario must be a JSON object")

    gale_region = _bounds(data, "gale_region")
    study_area = _bounds(data, "study_area")

    base = data.get("base")
    if not isinstance(base, dict) or not all(isinstance(base.get(k), (int, float)) for k in ("lon", "lat")):
        raise ScenarioError("scenario base must be an object with numeric lon and lat")
    if not study_area.contains(base["lon"], base["lat"]):
        raise ScenarioError(f"base ({base['lon']}, {base['lat']}) is outside study_area {study_area.as_list()}")

    sites: List[Site] = []
    seen = set()
    for raw in data.get("sites") or []:
        if not isinstance(raw, dict):
            raise ScenarioError("each site must be a JSON object")
        sid = raw.get("id")
        if not isinstance(sid, str) or not _SITE_ID_RE.fullmatch(sid):
            raise ScenarioError(f"site id {sid!r} must match {_SITE_ID_RE.pattern} (lowercase letters, digits, _)")
        if sid in seen:
            raise ScenarioError(f"duplicate site id {sid!r}")
        seen.add(sid)
        try:
            b = Bounds.from_list(raw.get("bounds"))
        except ValueError as exc:
            raise ScenarioError(f"site {sid}: {exc}") from None
        if not study_area.contains_bounds(b):
            raise ScenarioError(
                f"site {sid} {b.as_list()} is outside study_area {study_area.as_list()} "
                "(the only area with 1 m elevation)"
            )
        w, h = b.size_m()
        if max(w, h) > MAX_SITE_SIDE_M:
            raise ScenarioError(f"site {sid} is {w:.0f} x {h:.0f} m; each side must be at most {MAX_SITE_SIDE_M:.0f} m")
        sites.append(Site(id=sid, name=str(raw.get("name") or sid), bounds=b, note=str(raw.get("note") or "")))

    trip_area = None
    if data.get("trip_area") is not None:
        raw = data["trip_area"]
        try:
            trip_area = Bounds.from_list(raw.get("bounds") if isinstance(raw, dict) else None)
        except (ValueError, TypeError) as exc:
            raise ScenarioError(f"trip_area: {exc}") from None
        if not study_area.contains_bounds(trip_area):
            raise ScenarioError(f"trip_area {trip_area.as_list()} is outside study_area {study_area.as_list()}")
        w, h = trip_area.size_m()
        if max(w, h) > MAX_SITE_SIDE_M:
            raise ScenarioError(f"trip_area is {w:.0f} x {h:.0f} m; each side must be at most {MAX_SITE_SIDE_M:.0f} m")

    assumptions = data.get("assumptions") or {}
    if not isinstance(assumptions, dict) or not all(isinstance(v, dict) for v in assumptions.values()):
        raise ScenarioError("scenario assumptions must be an object of objects")

    return Scenario(
        name=str(data.get("name") or path.stem),
        gale_region=gale_region,
        study_area=study_area,
        base=(float(base["lon"]), float(base["lat"])),
        sites=tuple(sites),
        assumptions=assumptions,
        path=path,
        trip_area=trip_area,
    )


__all__ = ["Bounds", "MARS_SPHERE_RADIUS_M", "Scenario", "ScenarioError", "Site", "load_scenario"]
