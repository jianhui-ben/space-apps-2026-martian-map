"""Which requirement metrics each dataset supports (docs/requirements/, 72 metrics).

The metric list and the teammate's availability labels are read from
``docs/requirements/metric-data-availability.md``; this module only says which of
our datasets feed which metric. "Supports" means the dataset is an input to the
metric's estimate, not that it settles it: most metrics also need design inputs
or fieldwork (see the availability labels). The mapping is our reading of the
requirement documents; the teammate should check it.
"""

from __future__ import annotations

import re
from fnmatch import fnmatchcase
from typing import Any, Dict, List

LABELS = ("Estimate today", "Partial", "Field data needed", "Planning calculation")
FACTORS = {"BT": "Buildable terrain", "GI": "Ground and ice", "SC": "Solar conditions",
           "TC": "Thermal conditions", "IR": "Investigation routes"}

_TERRAIN_LAYOUT = ["BT-01", "BT-02", "BT-03", "BT-04", "BT-06", "BT-07", "BT-13", "BT-15", "BT-17", "BT-18", "BT-19",
                   "BT-21", "SC-10", "TC-08", "TC-09", "IR-03"]

# First matching pattern wins.
DATASET_METRICS: List[tuple] = [
    ("elevation_point_service", ["BT-04", "BT-06", "IR-03"]),
    ("elevation_1m_*", _TERRAIN_LAYOUT + ["BT-10", "GI-09", "IR-10", "IR-14"]),
    ("elevation_2m_trip_area", ["BT-17", "BT-18", "IR-03", "IR-04", "IR-05", "IR-06"]),
    ("slope_2m_trip_area", ["BT-18", "IR-03", "IR-04"]),
    ("elevation_10m_study", ["BT-01", "BT-03", "BT-17", "BT-18", "BT-20", "BT-21", "IR-03", "IR-10", "IR-14"]),
    ("elevation_463m_region", ["SC-01", "IR-10"]),
    ("slope_10m_window_*", ["BT-01", "BT-05", "SC-10", "TC-08"]),
    ("slope_1m_*", ["BT-10", "BT-18", "IR-03"]),
    ("slope_10m_study", ["BT-01", "BT-18", "BT-20", "IR-03", "IR-14"]),
    ("roughness_*", ["BT-08", "BT-11", "IR-03"]),
    ("horizon_*", ["SC-01", "TC-07", "IR-10"]),
    ("sun_table_*", ["SC-01", "SC-03", "SC-04", "SC-12", "TC-07", "IR-12"]),
    ("imagery_hirise_*", ["BT-11", "BT-12", "BT-13", "BT-14", "BT-17", "BT-19", "IR-03", "IR-04", "IR-11"]),
    ("imagery_ctx*", ["BT-14", "BT-20", "IR-14"]),
    ("dune_fields", ["BT-14", "BT-15", "BT-16"]),
    ("dune_change_imagery", ["BT-14", "BT-15", "BT-16"]),
    ("geology_map_index", ["GI-11"]),
    ("geology_*", ["BT-14", "GI-11", "GI-12"]),
    ("minerals_detections", ["GI-12"]),
    ("thermal_inertia_themis_1km", ["BT-11", "GI-07", "GI-12", "TC-01", "TC-10"]),
    ("thermal_inertia_tes", ["GI-12"]),
    ("water_odyssey_grs", ["GI-05", "GI-12"]),
    ("water_dan_curiosity", ["GI-05", "GI-12"]),
    ("ice_swim", ["GI-05", "GI-08"]),
    ("themis_temp_*", ["TC-01", "TC-11", "TC-12"]),
    ("themis_temperature_list", ["TC-01", "TC-11"]),
    ("thermal_day", ["TC-01"]),
    ("thermal_night", ["TC-01"]),
    ("surface_dust_tes", ["SC-05", "TC-07"]),
    ("weather_rems", ["TC-01", "TC-06", "TC-11", "TC-12", "IR-12"]),
    ("rover_path", ["BT-18", "GI-11", "IR-03", "IR-04"]),
    ("rover_stops", ["BT-18", "GI-11", "IR-03", "IR-04"]),
    ("named_sites", ["IR-11"]),
    ("optical_depth_history", ["SC-03", "SC-04", "SC-05", "SC-12", "SC-13", "TC-07", "TC-12", "IR-12"]),
    ("dust_extinction_navcam", ["IR-12", "TC-07"]),
    ("dust_climate_mcd", ["SC-03", "SC-04", "SC-12", "TC-07", "IR-12"]),
    ("temperature_climate_mcd", ["TC-01", "TC-02", "TC-03", "TC-05", "TC-06", "TC-11", "TC-12", "IR-12"]),
    ("radiation_rad", ["IR-12"]),
    ("space_weather_donki", ["IR-12"]),
    ("communications", ["IR-10"]),
    ("scenario", ["BT-01", "BT-02", "BT-04", "BT-05", "BT-08", "BT-10", "IR-05"]),
]


def metrics_for(dataset_id: str) -> List[str]:
    for pattern, ids in DATASET_METRICS:
        if fnmatchcase(dataset_id, pattern):
            return list(ids)
    return []


_ROW = re.compile(r"^\|\s*((?:BT|GI|SC|TC|IR)-\d{2})\s+([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|")


def parse_availability(markdown: str) -> List[Dict[str, Any]]:
    """Metric rows of metric-data-availability.md: id, name, what is measured, availability text and label."""
    out = []
    for line in markdown.splitlines():
        m = _ROW.match(line)
        if not m:
            continue
        available = m.group(4)
        label = next((lab for lab in LABELS if available.lower().startswith(lab.lower())), None)
        if label is None:
            raise ValueError(f"{m.group(1)}: availability {available[:40]!r} doesn't start with one of {LABELS}")
        out.append({"id": m.group(1), "name": m.group(2), "measure": m.group(3), "available": available,
                    "label": label})
    return out


def coverage_markdown(catalog: Any, metrics: List[Dict[str, Any]]) -> str:
    from .catalog import region_name, region_order

    have: Dict[str, List[str]] = {}
    pending: Dict[str, List[str]] = {}
    others: Dict[str, Dict[str, Dict[str, int]]] = {"have": {}, "pending": {}}  # metric -> region -> count
    for e in sorted(catalog.entries, key=lambda x: x["id"]):
        ok = e.get("access") in ("local", "live") and e.get("status", "ok") == "ok"
        kind = "have" if ok else ("pending" if e.get("access") in ("pending", "not_used") or e.get("status") != "ok"
                                  else None)
        if kind is None:
            continue
        region = e.get("region", "gale")
        for mid in e.get("metrics") or metrics_for(e.get("dataset", e["id"])):
            if region == "gale":
                (have if kind == "have" else pending).setdefault(mid, []).append(e["id"])
            else:
                counts = others[kind].setdefault(mid, {})
                counts[region] = counts.get(region, 0) + 1
    order = region_order(catalog)

    def also(kind: str, mid: str) -> str:
        counts = others[kind].get(mid) or {}
        return "; ".join(f"{region_name(catalog, r)}: {counts[r]}" for r in sorted(counts, key=lambda r: order.get(r, 99)))
    lines: List[str] = []
    gaps = []
    for prefix, factor in FACTORS.items():
        lines += [f"### {factor}", "",
                  "| Metric | Available today? (teammate) | Data we have | Not available yet |", "|---|---|---|---|"]
        for m in (x for x in metrics if x["id"].startswith(prefix)):
            ours = "; ".join(x for x in (", ".join(f"`{d}`" for d in have.get(m["id"], [])), also("have", m["id"])) if x) \
                or "none"
            missing = "; ".join(x for x in (", ".join(f"`{d}`" for d in pending.get(m["id"], [])),
                                            also("pending", m["id"])) if x)
            lines.append(f"| {m['id']} {m['name']} | {m['label']} | {ours} | {missing} |")
            if m["label"] in ("Estimate today", "Partial") and not have.get(m["id"]):
                gaps.append(m)
        lines.append("")
    lines += ["### No data yet for metrics that could be estimated today", ""]
    if gaps:
        lines += [f"- **{m['id']} {m['name']}** ({m['label']}): {m['available']}" for m in gaps]
    else:
        lines.append("None: every metric marked Estimate today or Partial has at least one dataset.")
    return "\n".join(lines).rstrip() + "\n"


__all__ = ["DATASET_METRICS", "FACTORS", "LABELS", "coverage_markdown", "metrics_for", "parse_availability"]
