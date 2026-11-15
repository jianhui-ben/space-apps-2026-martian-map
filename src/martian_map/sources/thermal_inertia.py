"""THEMIS thermal inertia at 1 km (Huang 2026, Zenodo record 23527756), cut to the Gale region.

Thermal inertia says how slowly the ground warms up and cools down. Solid rock
and bedrock keep their heat through the night (high values); dust and fine sand
lose it fast (low values). It is the best numeric stand-in for "how rocky" that
covers Gale: no direct rock-count map exists there.

The map is derived from NASA Mars Odyssey THEMIS night-time images by a
researcher outside NASA, so it is listed under "other references", with THEMIS
as the NASA source it is built from.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List

import numpy as np

from ..catalog import new_entry
from ..geotiff import equirect_bounds, read_geotiff
from ..grids import Grid, write_grid
from ..png import write_overlay
from ..scenario import MARS_SPHERE_RADIUS_M, Bounds
from ..snapshot import Step, StepContext, _now

RECORD = "23527756"
DOI = "https://doi.org/10.5281/zenodo.23527756"
FULL_PRODUCT_DOI = "https://doi.org/10.57760/sciencedb.016s5"
PAGE = f"https://zenodo.org/records/{RECORD}"
FILES = f"https://zenodo.org/api/records/{RECORD}/files"
TILE = "THEMIS_TI_2026_MC23_ti_1km.tif"  # Mars Chart 23 (Aeolis): 135-180 E, 0-30 S, which holds Gale
TILE_URL = f"{FILES}/{TILE}/content"
SUMS_URL = f"{FILES}/SHA256SUMS.txt/content"
MC23 = Bounds(135.0, -30.0, 180.0, 0.0)
MAX_TILE_BYTES = 32 << 20
SCALE = 0.1
NODATA = 65535
CREDIT = "Huang, J. (2026), from NASA Mars Odyssey THEMIS night-time images (NASA/JPL-Caltech/Arizona State University)"
CITATION = ("Huang, J. (2026). A new global thermal inertia map of Mars from THEMIS nighttime images: 1 km browse "
            "version [Data set]. Zenodo. https://doi.org/10.5281/zenodo.23527756")
# low (dust, sand) -> high (rock, bedrock); units J m^-2 K^-1 s^-1/2
TI_STOPS = [(50.0, (94, 60, 153)), (150.0, (178, 171, 210)), (250.0, (247, 247, 247)), (400.0, (253, 184, 99)),
            (700.0, (230, 97, 1))]


def _expected_sha256(sums: str, name: str) -> str:
    for line in sums.splitlines():
        m = re.fullmatch(r"\s*([0-9a-fA-F]{64})\s+\*?(\S+)\s*", line)
        if m and m.group(2) == name:
            return m.group(1).lower()
    raise ValueError(f"{name} is not listed in SHA256SUMS.txt")


def _thermal_inertia(ctx: StepContext) -> List[Dict[str, Any]]:
    region = ctx.scenario.gale_region
    sums = ctx.fetcher.get_bytes(SUMS_URL, 64 << 10).body.decode("utf-8", "replace")
    expected = _expected_sha256(sums, TILE)
    body = ctx.fetcher.get_bytes(TILE_URL, MAX_TILE_BYTES).body
    if hashlib.sha256(body).hexdigest() != expected:
        raise ValueError(f"{TILE}: SHA-256 checksum does not match SHA256SUMS.txt")
    gt = read_geotiff(body)
    sheet = equirect_bounds(gt, MARS_SPHERE_RADIUS_M)
    if not sheet.contains_bounds(region) or abs(sheet.west - MC23.west) > 0.05 or abs(sheet.north - MC23.north) > 0.05:
        raise ValueError(f"{TILE} covers {[round(v, 3) for v in sheet.as_list()]}, which does not cover the expected "
                         f"MC-23 sheet {MC23.as_list()} and the Gale region {region.as_list()}")
    raw = gt.bands[0]
    values = np.where(raw == NODATA, np.nan, raw.astype(np.float32) * np.float32(SCALE)).astype(np.float32)
    upper = gt.bands[1] if gt.bands.shape[0] > 1 else None
    grid = Grid(values, sheet).window(region)
    rel = "thermal/thermal_inertia_themis_1km"
    f32 = write_grid(grid, ctx.path(f"{rel}.f32"), ctx.data_root, "f32")
    png = write_overlay(grid.values, np.isnan(grid.values), grid.bounds, ctx.path(f"{rel}.png"), ctx.data_root,
                        TI_STOPS, "J m-2 K-1 s-1/2")
    png["role"] = "overlay"
    finite = grid.values[np.isfinite(grid.values)]
    stats = ({"min": float(finite.min()), "median": float(np.median(finite)), "max": float(finite.max())}
             if finite.size else None)
    upper_note = None
    if upper is not None:
        up = Grid(upper.astype(np.float32), sheet).window(region).values
        valid = up[up != NODATA]
        if valid.size:
            upper_note = float(np.mean(valid))
    covered = float(finite.size) / grid.values.size if grid.values.size else 0.0
    return [new_entry(
        "thermal_inertia_themis_1km", "Thermal inertia from THEMIS night images (1 km)",
        "How slowly the ground warms and cools, as numbers on a 1 km grid over all of Gale: high means rock or "
        "bedrock, low means dust or sand. The best available stand-in for how rocky the ground is.",
        ["terrain", "ground", "thermal"], "thermal", "derived", "local",
        evidence_note="computed by the author from THEMIS night-time temperatures with a thermal model (KRC 3.6.5)",
        files=[f32, png],
        coverage={"bounds": grid.bounds.as_list(), "covered_fraction": covered},
        resolution_m=1000, smallest_feature_m=3000,
        positional_accuracy="about 1 km; images aligned to the USGS controlled THEMIS night mosaics",
        uncertainty={"value": "12-24%", "basis": "absolute level, from the dataset README; surface layering and "
                                                  "rock-dust mixtures add a site-dependent part"},
        stats=stats, units="J m-2 K-1 s-1/2", mean_upper_limit_percent=upper_note,
        limitations=[
            "One number per 1 km cell (median of 100 m cells): a 3 km site gets only about 3 x 4 cells.",
            "A stand-in for rockiness, not a count of rocks or boulders.",
            "Absolute values uncertain by about 12-24%; best for comparing places with each other.",
            "Dusty, low-value ground: the dust correction is incomplete and image strips can show.",
            "Cells where every 100 m value was only an upper limit are left empty.",
        ],
        tags=["thermal inertia", "rock", "rocky", "bedrock", "dust", "sand", "themis", "ground"],
        source={"name": f"THEMIS-derived thermal inertia, 1 km browse version, sheet MC-23 ({TILE})",
                "page_url": PAGE, "request_url": TILE_URL, "fetched_at": _now(), "credit": CREDIT,
                "license": "CC BY 4.0", "doi": DOI, "full_product_doi": FULL_PRODUCT_DOI, "citation": CITATION,
                "sha256_verified": True},
    )]


thermal_inertia_step = Step("thermal_inertia", ("thermal_inertia_themis_1km",), _thermal_inertia,
                            inputs=lambda ctx: {"gale_region": ctx.scenario.gale_region.as_list(), "tile": TILE})

__all__ = ["SUMS_URL", "TILE", "TILE_URL", "thermal_inertia_step"]
