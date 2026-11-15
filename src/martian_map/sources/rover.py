"""Curiosity's driven path, stops, current position and named sites, from JPL's MMGIS map.

Files are saved exactly as received (after checking they are GeoJSON), so the
web app can load them directly.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..catalog import file_record, new_entry
from ..http import FetchError, atomic_write
from ..snapshot import Step, StepContext, _now

MMGIS_JSON = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json"
TRAVERSE = f"{MMGIS_JSON}/MSL_traverse.json"
WAYPOINTS = f"{MMGIS_JSON}/MSL_waypoints.json"
CURRENT = f"{MMGIS_JSON}/MSL_waypoints_current.json"
SURFACE_SITES = f"{MMGIS_JSON}/MSL_SurfaceSites.json"
CONFIG = "https://mars.nasa.gov/maps/location/api/configure/get?mission=Curiosity"
PAGE = "https://mars.nasa.gov/maps/location/?mission=Curiosity"
CREDIT = "NASA/JPL-Caltech (MSL MMGIS)"
LICENSE = "NASA media are generally not subject to US copyright; credit NASA/JPL-Caltech."
MAX_BYTES = 20 * 2**20


def _fetch(ctx: StepContext, url: str, geojson: bool):
    raw = ctx.fetcher.get_bytes(url, MAX_BYTES).body
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise FetchError(f"{url}: not valid JSON ({exc})") from exc
    if geojson and not (isinstance(data, dict) and data.get("type") == "FeatureCollection"
                        and isinstance(data.get("features"), list)):
        raise FetchError(f"{url}: expected a GeoJSON FeatureCollection")
    return raw, data


def _max_sol(fc: Dict[str, Any]) -> Optional[int]:
    sols = [f.get("properties", {}).get("sol") for f in fc.get("features", [])]
    sols = [int(s) for s in sols if isinstance(s, (int, float)) or (isinstance(s, str) and s.isdigit())]
    return max(sols) if sols else None


def _save(ctx: StepContext, name: str, raw: bytes, fmt: str, **extra) -> Dict[str, Any]:
    path = ctx.path(f"rover/{name}")
    atomic_write(path, raw)
    return file_record(path, ctx.data_root, fmt, **extra)


def _source(url: str, as_of: Optional[str]) -> Dict[str, Any]:
    src = {"name": "JPL MMGIS 'Where is Curiosity' map", "page_url": PAGE, "request_url": url,
           "fetched_at": _now(), "credit": CREDIT, "license": LICENSE}
    if as_of:
        src["as_of"] = as_of
    return src


def _rover(ctx: StepContext) -> List[Dict[str, Any]]:
    entries = []
    raw, fc = _fetch(ctx, TRAVERSE, True)
    sol = _max_sol(fc)
    entries.append(new_entry(
        "rover_path", "Curiosity's driven path",
        "The line Curiosity actually drove since landing: ground proven to carry a 900 kg rover.",
        ["routes", "ground"], "route", "observation", "local",
        files=[_save(ctx, "MSL_traverse.json", raw, "geojson", feature_count=len(fc["features"]))],
        ground_validated={"value": True, "note": "Curiosity drove here"},
        source=_source(TRAVERSE, f"sol {sol}" if sol is not None else None),
        limitations=["Shows where the rover could go, not that the ground can carry a building."],
        tags=["curiosity", "rover", "traverse", "path"],
    ))
    raw, fc = _fetch(ctx, WAYPOINTS, True)
    sol = _max_sol(fc)
    entries.append(new_entry(
        "rover_stops", "Curiosity's stops",
        "Every place Curiosity stopped, with its height and how tilted the rover was (roll, pitch, tilt).",
        ["routes", "ground"], "route", "observation", "local",
        files=[_save(ctx, "MSL_waypoints.json", raw, "geojson", feature_count=len(fc["features"]))],
        ground_validated={"value": True, "note": "measured by the rover on the ground"},
        source=_source(WAYPOINTS, f"sol {sol}" if sol is not None else None),
        limitations=["Rover tilt is measured at each stop only, not between stops.",
                     "Heights (elev_geoid) are the rover team's, relative to the Mars areoid."],
        tags=["curiosity", "rover", "waypoints", "stops", "tilt"],
    ))
    raw, fc = _fetch(ctx, CURRENT, True)
    sol = _max_sol(fc)
    entries.append(new_entry(
        "rover_position", "Where Curiosity is now",
        "Curiosity's latest position. The live link always has today's position.",
        ["routes"], "route", "observation", "local",
        files=[_save(ctx, "MSL_waypoints_current.json", raw, "geojson")],
        live={"url_template": CURRENT, "scheme": "json-api", "min_zoom": None, "max_zoom": None, "cors": "*"},
        ground_validated={"value": True, "note": "the rover's own position"},
        source=_source(CURRENT, f"sol {sol}" if sol is not None else None),
        tags=["curiosity", "rover", "position"],
    ))
    raw, fc = _fetch(ctx, SURFACE_SITES, True)
    entries.append(new_entry(
        "named_sites", "Named places at Curiosity's sites",
        "Outlines of named places Curiosity studied, such as drill sites.",
        ["routes"], "reference", "reference", "local",
        files=[_save(ctx, "MSL_SurfaceSites.json", raw, "geojson", feature_count=len(fc["features"]))],
        source=_source(SURFACE_SITES, None), tags=["names", "sites", "curiosity"],
    ))
    raw, _ = _fetch(ctx, CONFIG, False)
    entries.append(new_entry(
        "map_config", "MMGIS map configuration",
        "JPL's configuration for the Curiosity map: the list of its layers and their tile addresses.",
        [], "reference", "reference", "local",
        files=[_save(ctx, "mmgis_config.json", raw, "json")],
        source=_source(CONFIG, None), tags=["mmgis", "config", "tiles"],
    ))
    return entries


rover_step = Step("rover", ("rover_path", "rover_stops", "rover_position", "named_sites", "map_config"), _rover)

__all__ = ["CONFIG", "CURRENT", "SURFACE_SITES", "TRAVERSE", "WAYPOINTS", "rover_step"]
