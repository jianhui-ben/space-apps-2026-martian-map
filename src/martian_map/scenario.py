"""The team's scenario assumptions (``scenario/<region>.json``): areas, base, sites, placeholders.

Gale (``scenario/gale.json``) is the main study. Other regions (Jezero, Arcadia)
add ``region`` {id, name}, ``region_bounds``, ``rover`` and ``elevation`` (the
USGS elevation models to read, since Mars Trek has no 1 m model there).

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
_REGION_ID_RE = re.compile(r"^[a-z][a-z0-9]{0,15}$")
ROVERS = ("curiosity", "perseverance")


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
    region_bounds: Bounds
    study_area: Bounds
    base: Tuple[float, float]
    sites: Tuple[Site, ...]
    assumptions: Dict[str, Dict[str, Any]]
    path: Path
    trip_area: Optional["Bounds"] = None  # optional box for route planning between the base and the sites
    region_id: str = "gale"
    region_name: str = "Gale crater"
    rover: Optional[str] = "curiosity"  # whose drive path and stops to fetch; None = no rover here
    elevation: Optional[Dict[str, Any]] = None  # {"study": {...}, "fine": {...}} COG sources; None = Mars Trek (Gale)

    @property
    def gale_region(self) -> Bounds:
        """The region box (named for Gale, where it began)."""
        return self.region_bounds

    @property
    def is_gale(self) -> bool:
        return self.region_id == "gale"

    @property
    def region_area(self) -> str:
        """The coverage-area name of the region box: ``gale_region`` at Gale, ``region`` elsewhere."""
        return "gale_region" if self.is_gale else "region"

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

    region = data.get("region") or {"id": "gale", "name": "Gale crater"}
    if not isinstance(region, dict) or not isinstance(region.get("id"), str) or not _REGION_ID_RE.fullmatch(region["id"]):
        raise ScenarioError(f"scenario region must be {{\"id\": ..., \"name\": ...}} with an id matching "
                            f"{_REGION_ID_RE.pattern}, got {region!r}")
    region_bounds = _bounds(data, "region_bounds" if "region_bounds" in data else "gale_region")
    study_area = _bounds(data, "study_area")
    rover = data.get("rover", "curiosity" if region["id"] == "gale" else None)
    if rover is not None and rover not in ROVERS:
        raise ScenarioError(f"scenario rover {rover!r} must be one of {', '.join(ROVERS)} or null")
    elevation = _elevation(data.get("elevation"))
    if elevation is None and region["id"] != "gale":
        raise ScenarioError("scenario elevation (study and fine models) is required outside Gale; Mars Trek's 1 m "
                            "elevation model covers Gale only")
    fine = Bounds.from_list(elevation["fine"]["bounds"]) if elevation else None

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
        if "__" in sid:
            raise ScenarioError(f"site id {sid!r} must not contain '__' (it separates the region in merged ids)")
        longest = f"slope_10m_window_{sid}" + ("" if region["id"] == "gale" else f"__{region['id']}")
        if len(longest) > 64:
            raise ScenarioError(f"site id {sid!r} is too long: dataset ids such as {longest!r} must be at most 64 "
                                "characters")
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
        if fine is not None and not fine.contains_bounds(b):
            raise ScenarioError(f"site {sid} {b.as_list()} is outside the 1 m elevation model {fine.as_list()}")
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
        if fine is not None and not fine.contains_bounds(trip_area):
            raise ScenarioError(f"trip_area {trip_area.as_list()} is outside the 1 m elevation model {fine.as_list()}")
        w, h = trip_area.size_m()
        if max(w, h) > MAX_SITE_SIDE_M:
            raise ScenarioError(f"trip_area is {w:.0f} x {h:.0f} m; each side must be at most {MAX_SITE_SIDE_M:.0f} m")

    assumptions = data.get("assumptions") or {}
    if not isinstance(assumptions, dict) or not all(isinstance(v, dict) for v in assumptions.values()):
        raise ScenarioError("scenario assumptions must be an object of objects")

    return Scenario(
        name=str(data.get("name") or path.stem),
        region_bounds=region_bounds,
        study_area=study_area,
        base=(float(base["lon"]), float(base["lat"])),
        sites=tuple(sites),
        assumptions=assumptions,
        path=path,
        trip_area=trip_area,
        region_id=region["id"],
        region_name=str(region.get("name") or region["id"]),
        rover=rover,
        elevation=elevation,
    )


def _elevation(raw: Any) -> Optional[Dict[str, Any]]:
    """Validate ``elevation``: a coarse ``study`` model and a 1 m ``fine`` model, each a COG ``url`` and ``name``."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or not all(isinstance(raw.get(k), dict) for k in ("study", "fine")):
        raise ScenarioError("scenario elevation must have study and fine objects")
    for key in ("study", "fine"):
        src = raw[key]
        if not str(src.get("url") or "").startswith("https://") or not str(src.get("name") or "").strip():
            raise ScenarioError(f"scenario elevation.{key} needs an https url and a name")
    res = raw["study"].get("resolution_m")
    if not isinstance(res, int) or not 2 <= res <= 100:
        raise ScenarioError("scenario elevation.study.resolution_m must be a whole number of metres (2-100)")
    try:
        Bounds.from_list(raw["fine"].get("bounds"))
    except ValueError as exc:
        raise ScenarioError(f"scenario elevation.fine.bounds: {exc}") from None
    return raw


__all__ = ["Bounds", "MARS_SPHERE_RADIUS_M", "ROVERS", "Scenario", "ScenarioError", "Site", "load_scenario"]
