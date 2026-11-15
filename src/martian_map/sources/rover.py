"""The rover's driven path, stops, current position and named sites, from JPL's MMGIS map.

Curiosity at Gale, Perseverance at Jezero (the scenario's ``rover``); both maps
publish the same GeoJSON layers.

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
MISSIONS = {
    "curiosity": {"name": "Curiosity", "code": "MSL", "mission": "Curiosity", "mass": "900 kg"},
    "perseverance": {"name": "Perseverance", "code": "M20", "mission": "M20", "mass": "1,025 kg"},
}


def mission_urls(rover: str) -> Dict[str, str]:
    m = MISSIONS[rover]
    base = f"https://mars.nasa.gov/mmgis-maps/{m['code']}/Layers/json/{m['code']}"
    return {"traverse": f"{base}_traverse.json", "waypoints": f"{base}_waypoints.json",
            "current": f"{base}_waypoints_current.json", "surface_sites": f"{base}_SurfaceSites.json",
            "config": f"https://mars.nasa.gov/maps/location/api/configure/get?mission={m['mission']}",
            "page": f"https://mars.nasa.gov/maps/location/?mission={m['mission']}"}
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


def _source(url: str, as_of: Optional[str], rover: str = "curiosity") -> Dict[str, Any]:
    m = MISSIONS[rover]
    src = {"name": f"JPL MMGIS 'Where is {m['name']}' map", "page_url": mission_urls(rover)["page"], "request_url": url,
           "fetched_at": _now(), "credit": f"NASA/JPL-Caltech ({m['code']} MMGIS)", "license": LICENSE}
    if as_of:
        src["as_of"] = as_of
    return src


def _rover(ctx: StepContext) -> List[Dict[str, Any]]:
    rover = ctx.scenario.rover
    if rover is None:
        raise ValueError("the scenario has no rover")
    m, urls = MISSIONS[rover], mission_urls(rover)
    name, code, tag = m["name"], m["code"], rover
    entries = []
    raw, fc = _fetch(ctx, urls["traverse"], True)
    sol = _max_sol(fc)
    entries.append(new_entry(
        "rover_path", f"{name}'s driven path",
        f"The line {name} actually drove since landing: ground proven to carry a {m['mass']} rover.",
        ["routes", "ground"], "route", "observation", "local",
        files=[_save(ctx, f"{code}_traverse.json", raw, "geojson", feature_count=len(fc["features"]))],
        ground_validated={"value": True, "note": f"{name} drove here"},
        source=_source(urls["traverse"], f"sol {sol}" if sol is not None else None, rover),
        limitations=["Shows where the rover could go, not that the ground can carry a building."],
        tags=[tag, "rover", "traverse", "path"],
    ))
    raw, fc = _fetch(ctx, urls["waypoints"], True)
    sol = _max_sol(fc)
    entries.append(new_entry(
        "rover_stops", f"{name}'s stops",
        f"Every place {name} stopped, with its height and how tilted the rover was (roll, pitch, tilt).",
        ["routes", "ground"], "route", "observation", "local",
        files=[_save(ctx, f"{code}_waypoints.json", raw, "geojson", feature_count=len(fc["features"]))],
        ground_validated={"value": True, "note": "measured by the rover on the ground"},
        source=_source(urls["waypoints"], f"sol {sol}" if sol is not None else None, rover),
        limitations=["Rover tilt is measured at each stop only, not between stops.",
                     "Heights (elev_geoid) are the rover team's, relative to the Mars areoid."],
        tags=[tag, "rover", "waypoints", "stops", "tilt"],
    ))
    raw, fc = _fetch(ctx, urls["current"], True)
    sol = _max_sol(fc)
    entries.append(new_entry(
        "rover_position", f"Where {name} is now",
        f"{name}'s latest position. The live link always has today's position.",
        ["routes"], "route", "observation", "local",
        files=[_save(ctx, f"{code}_waypoints_current.json", raw, "geojson")],
        live={"url_template": urls["current"], "scheme": "json-api", "min_zoom": None, "max_zoom": None, "cors": "*"},
        ground_validated={"value": True, "note": "the rover's own position"},
        source=_source(urls["current"], f"sol {sol}" if sol is not None else None, rover),
        tags=[tag, "rover", "position"],
    ))
    raw, fc = _fetch(ctx, urls["surface_sites"], True)
    entries.append(new_entry(
        "named_sites", f"Named places at {name}'s sites",
        f"Outlines of named places {name} studied, such as drill sites."
        if rover == "curiosity" else f"Outlines of named places on {name}'s map, such as its landing site.",
        ["routes"], "reference", "reference", "local",
        files=[_save(ctx, f"{code}_SurfaceSites.json", raw, "geojson", feature_count=len(fc["features"]))],
        source=_source(urls["surface_sites"], None, rover), tags=["names", "sites", tag],
    ))
    raw, _ = _fetch(ctx, urls["config"], False)
    entries.append(new_entry(
        "map_config", "MMGIS map configuration",
        f"JPL's configuration for the {name} map: the list of its layers and their tile addresses.",
        [], "reference", "reference", "local",
        files=[_save(ctx, "mmgis_config.json", raw, "json")],
        source=_source(urls["config"], None, rover), tags=["mmgis", "config", "tiles"],
    ))
    return entries


rover_step = Step("rover", ("rover_path", "rover_stops", "rover_position", "named_sites", "map_config"), _rover,
                  inputs=lambda ctx: None if ctx.scenario.rover == "curiosity" else {"rover": ctx.scenario.rover})

__all__ = ["CONFIG", "CURRENT", "MISSIONS", "SURFACE_SITES", "TRAVERSE", "WAYPOINTS", "mission_urls", "rover_step"]
