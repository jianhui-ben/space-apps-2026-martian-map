"""Orbiter surface temperatures (Mars Odyssey THEMIS, band 9 brightness temperature).

* ``themis_list``: every THEMIS projected-brightness-temperature image over the
  study area, with its season (Ls) and local time, from the PDS Orbital Data
  Explorer (ODE).
* ``themis_samples``: four of them (day and night, near aphelion and
  perihelion), checked against their MD5, resampled onto the study area's
  lon/lat grid and saved in kelvin.
"""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from ..catalog import file_record, new_entry
from ..grids import Grid, write_grid
from ..http import Fetcher, FetchError, atomic_write, build_url
from ..pds3 import parse_label, read_image, reproject_to_lonlat, split_attached, verify_md5
from ..png import write_overlay
from ..scenario import MARS_SPHERE_RADIUS_M, Bounds
from ..snapshot import Step, StepContext, _now, failed_entry

ODE_URL = "https://oderest.rsl.wustl.edu/live2/"
ODE_PAGE = "https://ode.rsl.wustl.edu/mars/"
MAX_IMG_BYTES = 64 * 2**20
TARGETS = {"aphelion": 71.0, "perihelion": 251.0}
DAY_HOURS = (12.0, 18.0)
NIGHT_HOURS = (0.0, 7.0)
TEMP_STOPS = [(160.0, (49, 54, 149)), (200.0, (116, 173, 209)), (240.0, (254, 224, 144)), (280.0, (244, 109, 67)),
              (310.0, (165, 0, 38))]
CREDIT = "NASA/JPL-Caltech/Arizona State University (THEMIS)"


def _f(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _lon180(lon: float) -> float:
    return lon - 360.0 if lon > 180.0 else lon


def parse_ode_products(page: Dict[str, Any]) -> List[Dict[str, Any]]:
    res = (page or {}).get("ODEResults") or {}
    if res.get("Error"):
        raise FetchError(f"ODE error: {res['Error']}")
    prods = res.get("Products")
    if not isinstance(prods, dict):
        return []  # e.g. "No Products Found"
    items = prods.get("Product") or []
    items = items if isinstance(items, list) else [items]
    out = []
    for p in items:
        files = (p.get("Product_files") or {}).get("Product_file") or []
        files = files if isinstance(files, list) else [files]
        img = next((x for x in files if str(x.get("FileName", "")).upper().endswith(".IMG")), None)
        if img is None:
            continue
        px_per_deg = _f(p.get("Map_resolution"))
        out.append({
            "pdsid": str(img["FileName"]).rsplit(".", 1)[0],
            "utc_start": p.get("UTC_start_time"),
            "ls": _f(p.get("Solar_longitude")),
            "solar_time_h": _f(p.get("Solar_time")),
            "map_resolution_m": (MARS_SPHERE_RADIUS_M * math.pi / 180.0 / px_per_deg) if px_per_deg else None,
            "pixels_per_degree": px_per_deg,
            "bounds": [_lon180(float(p["Westernmost_longitude"])), float(p["Minimum_latitude"]),
                       _lon180(float(p["Easternmost_longitude"])), float(p["Maximum_latitude"])],
            "file_url": img.get("URL"),
            "kbytes": int(_f(img.get("KBytes")) or 0),
        })
    return out


def list_products(fetcher: Fetcher, bounds: Bounds, limit: int = 100, max_products: int = 2000) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    offset = 0
    while True:
        url = build_url(ODE_URL, {
            "query": "product", "target": "mars", "ihid": "ODY", "iid": "THEMIS", "pt": "IRPBT2",
            "westernlon": bounds.west, "easternlon": bounds.east, "minlat": bounds.south, "maxlat": bounds.north,
            "results": "mf", "limit": limit, "offset": offset, "output": "JSON",
        })
        page = parse_ode_products(fetcher.get_json(url))
        out.extend(page)
        if len(page) < limit or len(out) >= max_products:
            return out
        offset += limit


def _overlap(product: Dict[str, Any], area: Bounds) -> float:
    try:
        inter = Bounds.from_list(product["bounds"]).intersection(area)
    except ValueError:
        return 0.0
    if inter is None:
        return 0.0
    return ((inter.east - inter.west) * (inter.north - inter.south)) / ((area.east - area.west) * (area.north - area.south))


def _ls_distance(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def select_samples(
    products: List[Dict[str, Any]], study: Bounds, max_bytes: int = MAX_IMG_BYTES
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    """Pick day/night x aphelion/perihelion images. Returns (picks, notes for keys with no pick).

    Images larger than ``max_bytes`` are skipped. Only images within 45 degrees of Ls of the
    target count as "near" that season. Among them,
    images covering at least half the study area are preferred; ties go to the most coverage,
    then the closest season.
    """
    picks: Dict[str, Dict[str, Any]] = {}
    notes: Dict[str, str] = {}
    for when, (lo, hi) in (("day", DAY_HOURS), ("night", NIGHT_HOURS)):
        pool = [p for p in products if p.get("solar_time_h") is not None and lo <= p["solar_time_h"] <= hi
                and p.get("ls") is not None and p.get("file_url")
                and not (p.get("kbytes") and p["kbytes"] * 1024 > max_bytes)]
        for season, target in TARGETS.items():
            key = f"{when}_{season}"
            near = [p for p in pool if _ls_distance(p["ls"], target) <= 45.0]
            if not near:
                notes[key] = f"no {when} image within 45 degrees of Ls {target:g} over the study area"
                continue
            good = [p for p in near if _overlap(p, study) >= 0.5] or near
            picks[key] = min(good, key=lambda p: (-round(_overlap(p, study), 3), _ls_distance(p["ls"], target)))
    return picks, notes


def _list(ctx: StepContext) -> List[Dict[str, Any]]:
    prods = list_products(ctx.fetcher, ctx.scenario.study_area)
    path = ctx.path("thermal/themis_pbt_list.json")
    atomic_write(path, json.dumps(prods, indent=1).encode("utf-8"))
    ls_values = [p["ls"] for p in prods if p.get("ls") is not None]
    return [new_entry(
        "themis_temperature_list", "List of orbiter temperature images over the study area",
        "Every THEMIS surface-temperature image covering the study area, with its date, season (Ls) and local time.",
        ["thermal"], "thermal", "observation", "local",
        evidence_note="metadata only; see themis_temp_* for the images themselves",
        files=[file_record(path, ctx.data_root, "json", products=len(prods))],
        coverage={"bounds": ctx.scenario.study_area.as_list()}, resolution_m=100,
        observation_time={"products": len(prods), "ls_range": [min(ls_values), max(ls_values)] if ls_values else None},
        tags=["themis", "temperature", "thermal", "list"],
        source={"name": "PDS Orbital Data Explorer (ODY THEMIS IRPBT2)", "page_url": ODE_PAGE, "request_url": ODE_URL,
                "fetched_at": _now(), "credit": CREDIT, "license": "NASA PDS data; credit the THEMIS team"},
    )]


themis_list_step = Step("themis_list", ("themis_temperature_list",), _list,
                        inputs=lambda ctx: {"study_area": ctx.scenario.study_area.as_list()})

SAMPLE_KEYS = ("day_aphelion", "night_aphelion", "day_perihelion", "night_perihelion")


def _products_for(ctx: StepContext) -> List[Dict[str, Any]]:
    entry = ctx.entry("themis_temperature_list")
    if entry and entry.get("status") == "ok" and entry.get("files"):
        return json.loads((ctx.data_root / entry["files"][0]["path"]).read_text(encoding="utf-8"))
    return list_products(ctx.fetcher, ctx.scenario.study_area)


def _samples(ctx: StepContext) -> List[Dict[str, Any]]:
    study = ctx.scenario.study_area
    picks, notes = select_samples(_products_for(ctx), study)
    entries = []
    for key in SAMPLE_KEYS:
        eid = f"themis_temp_{key}"
        when, season = key.split("_")
        title = f"Orbiter surface temperature, {'afternoon' if when == 'day' else 'night/dawn'}, near {season}"
        if key not in picks:
            entries.append(new_entry(eid, title, "No suitable THEMIS image was found for this time and season.",
                                     ["thermal"], "thermal", "observation", "pending", reason=notes.get(key, "none found")))
            continue
        try:
            entries.append(_sample_entry(ctx, eid, title, key, picks[key]))
        except Exception as exc:  # one bad image must not sink the other three
            message = str(exc) or exc.__class__.__name__
            ctx.fail(eid, message)
            entries.append(failed_entry(eid, message, ctx.entry(eid)))
    return entries


def _sample_entry(ctx: StepContext, eid: str, title: str, key: str, p: Dict[str, Any]) -> Dict[str, Any]:
    study = ctx.scenario.study_area
    when, season = key.split("_")
    raw = ctx.fetcher.get_bytes(p["file_url"], MAX_IMG_BYTES).body
    text, _ = split_attached(raw)
    label = parse_label(text)
    verify_md5(raw, label)
    image = read_image(raw, label)
    pixel = 1.0 / float(label["IMAGE_MAP_PROJECTION"]["MAP_RESOLUTION"])
    grid = reproject_to_lonlat(image, label["IMAGE_MAP_PROJECTION"], study, pixel)
    f32 = write_grid(grid, ctx.path(f"thermal/{eid}.f32"), ctx.data_root, "f32")
    png = write_overlay(grid.values, np.isnan(grid.values), grid.bounds, ctx.path(f"thermal/{eid}.png"),
                        ctx.data_root, TEMP_STOPS, "K")
    png["role"] = "overlay"
    finite = grid.values[np.isfinite(grid.values)]
    covered = float(finite.size) / grid.values.size if grid.values.size else 0.0
    return new_entry(
        eid, title,
        f"Surface temperature (kelvin) seen from orbit at about {p['solar_time_h']:.1f} h local time, "
        f"season Ls {p['ls']:.0f}, every ~100 m across the study area.",
        ["thermal", "ground"], "thermal", "observation", "local",
        evidence_note="brightness temperature of the surface seen from orbit; not air temperature",
        files=[f32, png],
        coverage={"area": "study_area", "bounds": study.as_list(), "covered_fraction": covered},
        resolution_m=p.get("map_resolution_m"), smallest_feature_m=300,
        positional_accuracy="about 1 pixel (100 m); see pds3.py",
        observation_time={"utc": label.get("START_TIME"), "ls": label.get("SOLAR_LONGITUDE"),
                          "local_solar_time_h": label.get("LOCAL_TIME")},
        stats_k={"min": float(finite.min()), "median": float(np.median(finite)), "max": float(finite.max())}
        if finite.size else None,
        limitations=[
            "Surface temperature at one moment, not air temperature and not cooling capacity.",
            "About 100 m pixels: material differences inside a site are only partly visible.",
            "Resampled (nearest pixel) from the image's sinusoidal map projection onto a lon/lat grid.",
        ],
        tags=["themis", "temperature", "thermal", "infrared", when, season],
        source={"name": f"THEMIS IR projected brightness temperature {p['pdsid']} (band 9, 12.57 um)",
                "page_url": ODE_PAGE, "request_url": p["file_url"], "fetched_at": _now(), "credit": CREDIT,
                "license": "NASA PDS data; credit the THEMIS team", "pdsid": p["pdsid"], "md5_verified": True},
    )


def _samples_inputs(ctx: StepContext) -> Dict[str, Any]:
    files = (ctx.entry("themis_temperature_list") or {}).get("files") or []
    return {"study_area": ctx.scenario.study_area.as_list(), "list": [f.get("sha256") for f in files]}


themis_samples_step = Step("themis_samples", tuple(f"themis_temp_{k}" for k in SAMPLE_KEYS), _samples,
                           inputs=_samples_inputs)

__all__ = ["list_products", "parse_ode_products", "select_samples", "themis_list_step", "themis_samples_step"]
