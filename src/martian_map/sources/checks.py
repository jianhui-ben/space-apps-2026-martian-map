"""The alignment step: compare elevation layers with each other and with Curiosity's heights."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..alignment import dem_vs_rover, regional_vs_local
from ..grids import Grid, read_grid
from ..snapshot import Step, StepContext


def _grid(ctx: StepContext, entry: Optional[Dict[str, Any]]) -> Optional[Grid]:
    if not entry or entry.get("status") != "ok":
        return None
    for rec in entry.get("files", []):
        if rec.get("format") == "f32" and "grid" in rec:
            return read_grid(ctx.data_root, rec)
    return None


def _alignment(ctx: StepContext) -> List[Dict[str, Any]]:
    updated: List[Dict[str, Any]] = []
    stops = ctx.entry("rover_stops")
    waypoints = None
    if stops and stops.get("status") == "ok" and stops.get("files"):
        waypoints = json.loads((ctx.data_root / stops["files"][0]["path"]).read_text(encoding="utf-8"))

    targets = ["elevation_10m_study"] + [f"elevation_1m_{s.id}" for s in ctx.scenario.sites]
    for eid in targets:
        entry = ctx.entry(eid)
        grid = _grid(ctx, entry)
        if grid is None or waypoints is None:
            continue
        result = dem_vs_rover(grid, waypoints)
        entry = dict(entry, alignment=dict(entry.get("alignment") or {}, dem_vs_rover=result))
        if result.get("flag"):
            ctx.warn(f"{eid}: differs from Curiosity's heights by a median {result['median_offset_m']:.1f} m "
                     f"(spread {result['p90_abs_dev_m']:.1f} m)")
        updated.append(entry)

    region = ctx.entry("elevation_463m_region")
    regional = _grid(ctx, region)
    local = _grid(ctx, ctx.entry("elevation_10m_study"))
    if regional is not None and local is not None:
        result = regional_vs_local(regional, local)
        result["local_dataset"] = "elevation_10m_study"
        region = dict(region, alignment=dict(region.get("alignment") or {}, regional_vs_local=result))
        if result.get("flag"):
            ctx.warn(f"elevation_463m_region: differs from the 10 m model by a median {result['median_offset_m']:.1f} m")
        updated.append(region)
    return updated


alignment_step = Step("alignment", (), _alignment)

__all__ = ["alignment_step"]
