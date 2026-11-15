"""Water in the top layer of the ground, from NASA Mars Odyssey's Gamma Ray Spectrometer (GRS).

The PDS table ``H2O_SR_5X5`` gives the water content (weight percent, assuming
the hydrogen it detects is held as water) on a 5 x 5 degree grid, smoothed over
about 10 degrees. Around Gale that is one or two cells, so this is regional
background: it says how much water is bound in minerals and soil across the
area, not where a base could find ice.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import numpy as np

from ..catalog import file_record, new_entry
from ..grids import Grid, write_grid
from ..http import atomic_write
from ..png import write_overlay
from ..scenario import Bounds
from ..snapshot import Step, StepContext, _now

GRS_BASE = "https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/"
GRS_LABEL_URL = GRS_BASE + "h2o_sr_5x5.lbl"
GRS_TABLE_URL = GRS_BASE + "h2o_sr_5x5.tab"
GRS_PAGE = "https://pds-geosciences.wustl.edu/missions/odyssey/grs_elements.html"
CREDIT = "NASA/JPL-Caltech/University of Arizona (Mars Odyssey GRS); NASA Planetary Data System Geosciences Node"
CITATION = ("Boynton, W. V., et al. (2007). Concentration of H, Si, Cl, K, Fe, and Th in the low and mid latitude "
            "regions of Mars. J. Geophys. Res. Planets. Data: ODY-M-GRS-5-ELEMENTS-V1.0, NASA PDS.")
BIN_DEG = 5.0
COLUMNS = ["LATITUDE", "LONGITUDE", "CONCENTRATION", "SIGMA", "SIGMA WITH CFS"]
WATER_STOPS = [(2.0, (255, 255, 204)), (4.0, (161, 218, 180)), (6.0, (65, 182, 196)), (10.0, (34, 94, 168)),
               (20.0, (12, 44, 132))]
ICE_NOTE = ("Not an ice map: Gale is 4.6 degrees south of the equator, outside the latitudes where buried ice "
            "is stable near the surface. The water here is bound in minerals and soil.")


def _label_value(label: str, key: str) -> Optional[str]:
    m = re.search(rf"^\s*{re.escape(key)}\s*=\s*(.+?)\s*$", label, re.M)
    return m.group(1).strip().strip('"') if m else None


def parse_grs_table(label: str, table: str) -> List[Dict[str, Any]]:
    """Every 5-degree bin as {lat, lon (-180..180), h2o_wt_pct, sigma_wt_pct, sigma_cfs_wt_pct}; None = no value."""
    blocks = re.findall(r"OBJECT\s*=\s*COLUMN(.*?)END_OBJECT", label, re.S)
    cols = [re.sub(r"\s+", " ", m.group(1)) for b in blocks for m in [re.search(r'NAME\s*=\s*"([^"]+)"', b)] if m]
    if cols != COLUMNS:
        raise ValueError(f"unexpected GRS table columns {cols}; expected {COLUMNS}")
    if len(re.findall(r'UNIT\s*=\s*"WEIGHT PERCENT"', label)) != 3:
        raise ValueError("GRS water columns are not all in WEIGHT PERCENT")
    rows = int(_label_value(label, "ROWS") or 0)
    missing = float(_label_value(label, "NOT_APPLICABLE_CONSTANT") or 9999.999)
    lines = [ln for ln in table.splitlines() if ln.strip()]
    if len(lines) != rows:
        raise ValueError(f"GRS table has {len(lines)} rows; its label says {rows}")
    bins = []
    for ln in lines:
        parts = ln.split()
        if len(parts) != 5:
            raise ValueError(f"GRS table row has {len(parts)} values, expected 5: {ln[:60]!r}")
        lat, lon, conc, sig, sig_cfs = (float(p) for p in parts)
        if lon > 180:
            lon -= 360
        bins.append({"lat": lat, "lon": lon,
                     **{k: (None if v == missing else v) for k, v in
                        (("h2o_wt_pct", conc), ("sigma_wt_pct", sig), ("sigma_cfs_wt_pct", sig_cfs))}})
    return bins


def bins_grid(bins: List[Dict[str, Any]]) -> Grid:
    rows, cols = int(180 / BIN_DEG), int(360 / BIN_DEG)
    values = np.full((rows, cols), np.nan, dtype=np.float32)
    for b in bins:
        if b["h2o_wt_pct"] is None:
            continue
        r = int((90.0 - b["lat"]) // BIN_DEG)
        c = int((b["lon"] + 180.0) // BIN_DEG)
        values[r, c] = b["h2o_wt_pct"]
    return Grid(values, Bounds(-180.0, -90.0, 180.0, 90.0))


def _water(ctx: StepContext) -> List[Dict[str, Any]]:
    label = ctx.fetcher.get_bytes(GRS_LABEL_URL, 256 << 10).body.decode("ascii", "replace")
    table = ctx.fetcher.get_bytes(GRS_TABLE_URL, 4 << 20).body.decode("ascii", "replace")
    bins = parse_grs_table(label, table)
    grid = bins_grid(bins)
    region = ctx.scenario.gale_region
    half = BIN_DEG / 2
    gale = [b for b in bins if Bounds(b["lon"] - half, b["lat"] - half, b["lon"] + half, b["lat"] + half)
            .intersects(region)]
    f32 = write_grid(grid, ctx.path("water/odyssey_grs_h2o_5x5.f32"), ctx.data_root, "f32")
    png = write_overlay(grid.values, np.isnan(grid.values), grid.bounds, ctx.path("water/odyssey_grs_h2o_5x5.png"),
                        ctx.data_root, WATER_STOPS, "wt% H2O")
    png["role"] = "overlay"
    jpath = ctx.path("water/odyssey_grs_h2o_5x5.json")
    atomic_write(jpath, json.dumps({"bin_deg": BIN_DEG, "units": "weight percent H2O",
                                    "lon_convention": "east-positive, -180..180, bin centres", "bins": bins},
                                   separators=(",", ":")).encode("utf-8"))
    vals = [b["h2o_wt_pct"] for b in gale if b["h2o_wt_pct"] is not None]
    return [new_entry(
        "water_odyssey_grs", "Water in the top layer of the ground (Mars Odyssey, 5 degree cells)",
        "How much water is held in the top few tens of centimetres of soil and rock, as a percent of weight, "
        "measured from orbit in 5 degree cells (about 300 km).",
        ["ground"], "water", "derived", "local",
        evidence_note="computed by the GRS team from gamma-ray spectra measured from orbit, 2002-2005",
        files=[f32, png, file_record(jpath, ctx.data_root, "json")],
        coverage={"bounds": [-180.0, -90.0, 180.0, 90.0]},
        resolution_m=296000, smallest_feature_m=600000,
        positional_accuracy="5 degree bins, smoothed over about 10 degrees",
        uncertainty={"value": "per cell", "basis": "sigma_wt_pct in each bin (1 standard deviation)"},
        gale_bins=gale,
        gale_range_wt_pct=[min(vals), max(vals)] if vals else None,
        limitations=[
            ICE_NOTE,
            "Each cell is about 300 km across (smoothed over about 600 km): all of Gale is one or two cells.",
            "Assumes the hydrogen it detects is in water; it cannot tell water in minerals from ice.",
            "Senses only the top few tens of centimetres.",
            "No values near the poles (there the signal is dominated by ice and the table leaves them empty).",
        ],
        tags=["water", "hydrogen", "h2o", "ice", "grs", "odyssey", "ground"],
        source={"name": "Mars Odyssey Gamma Ray Spectrometer, water concentration H2O_SR_5X5 (ODY-M-GRS-5-ELEMENTS-V1.0)",
                "page_url": GRS_PAGE, "request_url": GRS_TABLE_URL, "fetched_at": _now(), "credit": CREDIT,
                "license": "NASA PDS data; generally not subject to US copyright; credit the GRS team",
                "citation": CITATION},
    )]


water_step = Step("water", ("water_odyssey_grs",), _water, inputs=lambda ctx: {"gale_region": ctx.scenario.gale_region.as_list()})

__all__ = ["GRS_LABEL_URL", "GRS_TABLE_URL", "bins_grid", "parse_grs_table", "water_step"]
