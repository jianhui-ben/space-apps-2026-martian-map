"""Per-site skylines (horizons) and sun tables, from the local, study and regional elevation grids."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import numpy as np

from ..catalog import file_record, new_entry
from ..grids import GRID_CRS, Grid, read_grid
from ..horizon import NODATA, STEP_DEG, Level, horizon_grid
from ..http import atomic_write
from ..scenario import Scenario, Site
from ..snapshot import Step, StepContext, _now
from ..sun import sun_table, sunlit_fraction

SPACING_M = 100.0
OBSERVER_HEIGHT_M = 2.0
SHADOW_LIMIT = "Shadows from features closer together than 100 m are not mapped."


def _grid(ctx: StepContext, entry_id: str) -> Grid:
    entry = ctx.entry(entry_id)
    if not entry or entry.get("status") != "ok":
        raise RuntimeError(f"needs {entry_id} first (run the elevation steps)")
    for rec in entry.get("files", []):
        if rec.get("format") == "f32" and "grid" in rec:
            return read_grid(ctx.data_root, rec)
    raise RuntimeError(f"{entry_id} has no elevation grid file")


def _regional_offset(ctx: StepContext) -> Optional[float]:
    entry = ctx.entry("elevation_463m_region") or {}
    result = (entry.get("alignment") or {}).get("regional_vs_local") or {}
    value = result.get("median_offset_m")
    return float(value) if isinstance(value, (int, float)) else None


def _solar(site: Site):
    def run(ctx: StepContext) -> List[Dict[str, Any]]:
        current = ctx.scenario.site(site.id)
        local = _grid(ctx, f"elevation_1m_{current.id}")
        study = _grid(ctx, "elevation_10m_study")
        region = _grid(ctx, "elevation_463m_region")
        offset = _regional_offset(ctx)
        levels = [
            Level(local, 5.0, 6000.0),
            Level(study, 20.0, 10000.0),
            Level(region, 463.0, 120000.0, offset_m=offset or 0.0),
        ]
        hz, lons, lats, missing = horizon_grid(levels, current.bounds, SPACING_M, OBSERVER_HEIGHT_M)
        ny, nx, nb = hz.shape
        hz_path = ctx.path(f"solar/horizon_{current.id}.u8")
        atomic_write(hz_path, np.ascontiguousarray(hz).tobytes())
        px = (current.bounds.east - current.bounds.west) / nx
        py = (current.bounds.north - current.bounds.south) / ny
        hz_rec = file_record(hz_path, ctx.data_root, "u8", grid={
            "width": nx, "height": ny, "bands": nb, "layout": "row (north first), column (west first), azimuth",
            "bounds": current.bounds.as_list(), "pixel_deg": [px, py], "dtype": "u8", "byte_order": "little",
            "nodata": NODATA, "crs": GRID_CRS, "step_deg": STEP_DEG, "azimuth_count": nb,
            "azimuth_origin": "0 = north, clockwise, 1 degree per band",
        })
        valid = hz.reshape(-1, nb)
        valid = valid[(valid != NODATA).any(axis=1)].astype(np.float64) * STEP_DEG
        _, clat = current.bounds.center()
        table = sun_table(clat)
        table["sunlit_fraction"] = sunlit_fraction(table, valid)
        table["sunlit_fraction_note"] = "fraction of the site's 100 m horizon points with the sun above their skyline"
        table["site"] = current.id
        table["horizon_points"] = int(valid.shape[0])
        st_path = ctx.path(f"solar/sun_table_{current.id}.json")
        atomic_write(st_path, json.dumps(table, separators=(",", ":")).encode("utf-8"))

        total = ny * nx
        coverage = {"area": current.id, "bounds": current.bounds.as_list(),
                    "covered_fraction": (total - len(missing)) / total if total else 0.0}
        source = {"name": "computed by martian_map from the elevation grids", "page_url": "docs/data-sources.md",
                  "fetched_at": _now(), "credit": "derived from NASA/JPL-Caltech/University of Arizona and NASA/GSFC MOLA data"}
        offset_note = (f"The regional (463 m) heights were shifted by {offset:+.1f} m to match the 1 m model "
                       "(measured in the alignment check)." if offset is not None
                       else "No alignment offset was available; regional heights used as-is.")
        hz_entry = new_entry(
            f"horizon_{current.id}", f"Skyline around site {current.name}",
            "How high the hills and crater walls rise in every direction, at every 100 m point across the site.",
            ["solar"], "solar", "derived", "local",
            files=[hz_rec], coverage=coverage, resolution_m=100, smallest_feature_m=100,
            regional_offset_m=offset, nodata_points=missing,
            limitations=[SHADOW_LIMIT, f"Seen from {OBSERVER_HEIGHT_M:g} m above the ground.", offset_note,
                         "Angles are stored in 0.25 degree steps (value x 0.25 = degrees); 255 means no ground height."],
            tags=["horizon", "skyline", "shadow", "sun"], source=source,
        )
        st_entry = new_entry(
            f"sun_table_{current.id}", f"Sun position and sunlight at site {current.name}",
            "Where the sun is in the sky through the year and the day, and how much of the site is in sunlight.",
            ["solar"], "solar", "model", "local",
            evidence_note="sun position from a standard formula; shadows from derived elevation",
            files=[file_record(st_path, ctx.data_root, "json")], coverage=coverage, resolution_m=100,
            limitations=[SHADOW_LIMIT,
                         "Sunlit means the sun is above the skyline; it ignores dust, haze and panel angle.",
                         "Seasons every 15 degrees of Ls and times every half Mars-hour of local true solar time."],
            tags=["sun", "sunlight", "solar", "season", "shadow"], source=source,
        )
        return [hz_entry, st_entry]

    def inputs(ctx: StepContext) -> Dict[str, Any]:
        grids = (f"elevation_1m_{site.id}", "elevation_10m_study", "elevation_463m_region")
        return {
            "site": ctx.scenario.site(site.id).bounds.as_list(),
            "grids": {g: [f.get("sha256") for f in (ctx.entry(g) or {}).get("files") or []] for g in grids},
            "regional_offset_m": _regional_offset(ctx),
        }

    return Step(f"solar_{site.id}", (f"horizon_{site.id}", f"sun_table_{site.id}"), run, inputs=inputs)


def solar_steps(scenario: Scenario) -> List[Step]:
    return [_solar(s) for s in scenario.sites]


__all__ = ["solar_steps"]
