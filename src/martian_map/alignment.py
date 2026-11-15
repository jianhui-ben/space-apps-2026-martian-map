"""Checks that layers agree before they are combined (a shared requirement of the project plan).

Nothing is corrected silently: offsets are measured, recorded in the catalog,
and flagged when large.
"""

from __future__ import annotations

from typing import Any, Dict, List

import numpy as np

from .grids import Grid
from .scenario import Bounds

ROVER_MEDIAN_FLAG_M = 2.0
ROVER_SPREAD_FLAG_M = 5.0
REGIONAL_FLAG_M = 10.0


def _waypoint_points(waypoints: Dict[str, Any]):
    for f in waypoints.get("features", []):
        p = f.get("properties") or {}
        lon, lat = p.get("lon"), p.get("lat")
        if lon is None or lat is None:
            coords = (f.get("geometry") or {}).get("coordinates") or [None, None]
            lon, lat = coords[0], coords[1]
        h = p.get("elev_geoid")
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and isinstance(h, (int, float)):
            yield float(lon), float(lat), float(h)


def dem_vs_rover(grid: Grid, waypoints: Dict[str, Any]) -> Dict[str, Any]:
    """Elevation grid minus Curiosity's own stop heights (``elev_geoid``) inside the grid."""
    offsets: List[float] = []
    for lon, lat, h in _waypoint_points(waypoints):
        v = grid.sample(lon, lat)
        if np.isfinite(v):
            offsets.append(v - h)
    if not offsets:
        return {"n": 0, "median_offset_m": None, "p90_abs_dev_m": None, "flag": None,
                "note": "no rover heights in this area"}
    arr = np.array(offsets)
    med = float(np.median(arr))
    spread = float(np.percentile(np.abs(arr - med), 90))
    return {
        "n": int(arr.size),
        "median_offset_m": med,
        "p90_abs_dev_m": spread,
        "flag": bool(abs(med) > ROVER_MEDIAN_FLAG_M or spread > ROVER_SPREAD_FLAG_M),
        "note": "grid height minus rover stop height (elev_geoid), at rover stops inside the grid",
    }


def regional_vs_local(regional: Grid, local: Grid) -> Dict[str, Any]:
    """Mean of the local grid over each regional pixel it fully covers, minus the regional value."""
    px, py = regional.pixel_deg
    h, w = regional.shape
    offsets: List[float] = []
    for r in range(h):
        north = regional.bounds.north - r * py
        south = north - py
        if south < local.bounds.south or north > local.bounds.north:
            continue
        for c in range(w):
            west = regional.bounds.west + c * px
            east = west + px
            if west < local.bounds.west or east > local.bounds.east:
                continue
            reg = float(regional.values[r, c])
            if not np.isfinite(reg):
                continue
            block = local.window(Bounds(west, south, east, north)).values
            if block.size == 0 or np.isnan(block).mean() >= 0.10:
                continue
            offsets.append(float(np.nanmean(block)) - reg)
    if not offsets:
        return {"n": 0, "median_offset_m": None, "flag": None, "note": "no overlapping regional pixels"}
    med = float(np.median(offsets))
    return {
        "n": len(offsets),
        "median_offset_m": med,
        "flag": bool(abs(med) > REGIONAL_FLAG_M),
        "note": "mean local height minus regional height, over regional pixels fully inside the local grid",
    }


__all__ = ["dem_vs_rover", "regional_vs_local"]
