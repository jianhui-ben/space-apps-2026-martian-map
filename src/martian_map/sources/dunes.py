"""Is the sand moving? Two HiRISE photos of the Bagnold Dunes taken eight years apart.

The USGS made a HiRISE elevation model of this part of Gale
(DTEEC_040770_1755_039280_1755) and, with it, orthophotos: photos corrected for
the terrain and put on the same 1 m pixel grid. Two of them, from 2007-04-22
(PSP_003453_1750) and 2015-04-08 (ESP_040770_1755), line up pixel for pixel, so
moving sand shows as a shift between them while rock stays put.

We read a 1.5 km square of the dune band (about 1.5 km south of the
``near_base_west`` site) from each cloud-optimised GeoTIFF with HTTP range
requests (a few MB instead of 90 MB), save both crops as pictures, check that
rock did not move (phase correlation in 64 m squares), and measure how far the
edges of the dark sand moved. The published rates for these dunes are about
0.4 m per Earth year (Silvestro et al. 2013), at most about 1 m per year.
"""

from __future__ import annotations

import json
import math
import statistics
from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from ..catalog import file_record, new_entry
from ..cog import RangeReader
from ..geotiff import georef, read_tags, read_window
from ..grids import Grid, write_grid
from ..http import atomic_write
from ..png import write_overlay
from ..scenario import Bounds
from ..snapshot import Step, StepContext, _now

R_M = 3396190.0
DTM_ID = "DTEEC_040770_1755_039280_1755_A01"
COG_BASE = ("https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/hirise/controlled/dtm/"
            "ESP_040770_1755_ESP_039280_1755/")
STAC_PAGE = "https://stac.astrogeology.usgs.gov/browser-dev/#/collections/mro_hirise_socet_dtms"
HIRISE_DTM_PAGE = "https://www.uahirise.org/dtm/ESP_040770_1755"
EPOCHS: List[Dict[str, str]] = [
    {"id": "PSP_003453_1750", "date": "2007-04-22", "url": COG_BASE + "PSP_003453_1750_RED_C_02_ORTHO.tif"},
    {"id": "ESP_040770_1755", "date": "2015-04-08", "url": COG_BASE + "ESP_040770_1755_RED_C_02_ORTHO.tif"},
]
CROP = Bounds(137.388, -4.669, 137.413, -4.644)  # dune band where both photos have data
WINDOW_PX = 64
MIN_PEAK = 0.15  # phase-correlation peak below this = not enough texture to trust the shift
MOVING_PX = 1.5
SAND_LEVEL = 50  # stretched brightness (1-255) below which a pixel counts as dark sand
EDGE_FRACTION = (0.15, 0.85)  # squares with this much sand contain a sand edge
PUBLISHED_RATES = [
    {"value_m_per_earth_year": 0.4, "what": "dune migration, south-west part of the Bagnold field",
     "source": "Silvestro, S., et al. (2013). Pervasive aeolian activity along rover Curiosity's traverse in Gale "
               "Crater, Mars. Geology, 41(4), 483-486. https://doi.org/10.1130/G34162.1"},
    {"value_m_per_earth_year": 1.0, "what": "upper bound for the Bagnold Dunes from orbital images",
     "source": "NASA/JPL-Caltech, PIA20284 caption (2016)"},
]


def window_for_bounds(tags: Dict[int, list], bounds: Bounds, radius_m: float) -> Tuple[int, int, int, int]:
    """(row0, col0, rows, cols) of ``bounds`` in an equirectangular (centre 0, standard parallel 0) image."""
    (sx, sy), tie, point = georef(tags)
    i, j, _, x, y, _ = tie
    west, north = x - i * sx, y + j * sy
    if point:
        west, north = west - sx / 2, north + sy / 2
    m_per_deg = radius_m * math.pi / 180.0
    col0 = round((bounds.west * m_per_deg - west) / sx)
    row0 = round((north - bounds.north * m_per_deg) / sy)
    cols = round((bounds.east - bounds.west) * m_per_deg / sx)
    rows = round((bounds.north - bounds.south) * m_per_deg / sy)
    if col0 < 0 or row0 < 0 or col0 + cols > tags[256][0] or row0 + rows > tags[257][0]:
        raise ValueError(f"crop {bounds.as_list()} is outside the image")
    return row0, col0, rows, cols


def _subpixel(c: np.ndarray, r: int, k: int) -> Tuple[float, float]:
    h, w = c.shape

    def fit(m1: float, m0: float, p1: float) -> float:
        d = m1 - 2 * m0 + p1
        return 0.0 if d == 0 else 0.5 * (m1 - p1) / d

    dy = fit(c[(r - 1) % h, k], c[r, k], c[(r + 1) % h, k])
    dx = fit(c[r, (k - 1) % w], c[r, k], c[r, (k + 1) % w])
    return dy, dx


def phase_shifts(a: np.ndarray, b: np.ndarray, win: int = WINDOW_PX, step: Optional[int] = None,
                 max_shift: Optional[int] = None, nodata: Optional[float] = None) -> List[Dict[str, float]]:
    """How far each ``win`` x ``win`` square moved from image ``a`` to image ``b`` (pixels; dx east, dy south),
    by phase correlation, with the correlation peak (0-1) as the confidence."""
    step = step or win
    max_shift = max_shift if max_shift is not None else win // 4
    taper = np.outer(np.hanning(win), np.hanning(win))
    out = []
    for r in range(0, a.shape[0] - win + 1, step):
        for c in range(0, a.shape[1] - win + 1, step):
            wa = a[r:r + win, c:c + win].astype(np.float64)
            wb = b[r:r + win, c:c + win].astype(np.float64)
            if nodata is not None and ((wa == nodata).any() or (wb == nodata).any()):
                continue
            if wa.std() == 0 or wb.std() == 0:
                continue
            fa = np.fft.fft2((wa - wa.mean()) * taper)
            fb = np.fft.fft2((wb - wb.mean()) * taper)
            cross = fb * np.conj(fa)
            cross /= np.maximum(np.abs(cross), 1e-12)
            corr = np.real(np.fft.ifft2(cross))
            lim = np.full(corr.shape, -np.inf)
            idx = np.r_[0:max_shift + 1, win - max_shift:win]
            lim[np.ix_(idx, idx)] = corr[np.ix_(idx, idx)]
            pr, pc = np.unravel_index(int(np.argmax(lim)), corr.shape)
            sy, sx = _subpixel(corr, pr, pc)
            dy = (pr if pr <= win // 2 else pr - win) + sy
            dx = (pc if pc <= win // 2 else pc - win) + sx
            out.append({"row": r, "col": c, "dx": round(float(dx), 3), "dy": round(float(dy), 3),
                        "peak": round(float(corr[pr, pc]), 3),
                        # a peak on the edge of the search box is probably not the true shift
                        "at_limit": bool(max(abs(dx), abs(dy)) > max_shift - 0.5)})
    return out


def summarize_shifts(shifts: Sequence[Dict[str, float]], pixel_m: float, years: float, min_peak: float = MIN_PEAK,
                     moving_px: float = MOVING_PX) -> Dict[str, Any]:
    confident = [s for s in shifts if s["peak"] >= min_peak]
    used = [s for s in confident if not s.get("at_limit")]
    mag = [math.hypot(s["dx"], s["dy"]) for s in used]
    moving = [(s, m) for s, m in zip(used, mag) if m >= moving_px]
    still = [m for m in mag if m < moving_px]
    all_med = statistics.median(mag) * pixel_m if mag else None
    out: Dict[str, Any] = {"windows_measured": len(shifts), "windows_used": len(used),
                           "at_search_limit": len(confident) - len(used), "moving_windows": len(moving),
                           "moving_fraction": round(len(moving) / len(used), 3) if used else None,
                           "all_median_m": round(all_med, 3) if all_med is not None else None,
                           "all_rate_m_per_earth_year": round(all_med / years, 3) if all_med is not None else None,
                           "still_median_m": round(statistics.median(still) * pixel_m, 3) if still else None,
                           "still_max_m": round(max(still) * pixel_m, 3) if still else None,
                           "moving_median_m": None, "moving_rate_m_per_earth_year": None,
                           "moving_direction_deg": None}
    out["direction_consistency"] = None
    if moving:
        med = statistics.median(m for _, m in moving) * pixel_m
        east = sum(s["dx"] / m for s, m in moving)
        north = sum(-s["dy"] / m for s, m in moving)
        out.update(moving_median_m=round(med, 3), moving_rate_m_per_earth_year=round(med / years, 3),
                   moving_direction_deg=round(math.degrees(math.atan2(east, north)) % 360, 1),
                   # 1 = every moving square went the same way, 0 = no common direction
                   direction_consistency=round(math.hypot(east, north) / len(moving), 3))
    return out


def sand_mask(img: np.ndarray, level: float = SAND_LEVEL, k: int = 4) -> np.ndarray:
    """1 where the (k x k averaged) stretched brightness is below ``level``: dark sand; 0 elsewhere."""
    x = img.astype(np.float64)
    c = np.pad(np.cumsum(np.cumsum(x, 0), 1), ((1, 0), (1, 0)))
    mean = (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    return (mean < level).astype(np.float64)


def sand_edge_shifts(a_u8: np.ndarray, b_u8: np.ndarray, win: int) -> List[Dict[str, float]]:
    """Shifts of the sand edges: phase correlation of the two sand masks, in squares that contain an edge."""
    ma, mb = sand_mask(a_u8), sand_mask(b_u8)
    lo, hi = EDGE_FRACTION
    return [s for s in phase_shifts(ma, mb, win=win, step=win // 2)
            if lo < ma[s["row"]:s["row"] + win, s["col"]:s["col"] + win].mean() < hi]


def _pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{x:.0%}"


def _gap_km(a: Bounds, b: Bounds) -> float:
    dlon = max(0.0, b.west - a.east, a.west - b.east)
    dlat = max(0.0, b.south - a.north, a.south - b.north)
    lat = math.radians((a.south + a.north) / 2)
    return round(math.hypot(dlon * math.cos(lat), dlat) * R_M * math.pi / 180 / 1000, 2)


def _stretch(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    vals = img[~mask]
    lo, hi = (np.percentile(vals, [0.5, 99.5]) if vals.size else (0, 1))
    out = np.clip((img.astype(np.float64) - lo) / max(hi - lo, 1) * 254 + 1, 1, 255)
    out[mask] = 0
    return out.astype(np.uint8)


def _dunes(ctx: StepContext) -> List[Dict[str, Any]]:
    crops, stretched, files, pixel_m, requests = [], [], [], None, 0
    for ep in EPOCHS:
        read = RangeReader(ctx, ep["url"])
        bo, tags = read_tags(read)
        (sx, _), _, _ = georef(tags)
        if pixel_m is not None and abs(sx - pixel_m) > 1e-6:
            raise ValueError("the two orthophotos are on different pixel grids")
        pixel_m = sx
        row0, col0, rows, cols = window_for_bounds(tags, CROP, R_M)
        img = read_window(read, bo, tags, row0, col0, rows, cols)[0]
        requests += read.requests
        crops.append(img)
        mask = img == 0
        stretched.append(_stretch(img, mask))
        grid = Grid(stretched[-1].astype(np.float32), CROP)
        u8 = write_grid(Grid(stretched[-1], CROP), ctx.path(f"dunes/hirise_{ep['date']}.u8"), ctx.data_root,
                        "u8", nodata=0)
        png = write_overlay(grid.values, mask, CROP, ctx.path(f"dunes/hirise_{ep['date']}.png"), ctx.data_root,
                            [(1.0, (0, 0, 0)), (255.0, (255, 255, 255))], "brightness (stretched)")
        png["role"] = "overlay"
        u8["observation"], png["observation"] = ep["id"], ep["id"]
        files += [png, u8]
    assert pixel_m is not None
    years = (date.fromisoformat(EPOCHS[1]["date"]) - date.fromisoformat(EPOCHS[0]["date"])).days / 365.25
    nodata_frac = [round(float((c == 0).mean()), 4) for c in crops]
    shifts = phase_shifts(crops[0], crops[1], win=WINDOW_PX, nodata=0)
    edges = sand_edge_shifts(stretched[0], stretched[1], WINDOW_PX)
    sand = [float(sand_mask(x).mean()) for x in stretched]
    movement = {"registration": summarize_shifts(shifts, pixel_m, years),
                "sand_edges": summarize_shifts(edges, pixel_m, years),
                "sand_fraction": [round(x, 3) for x in sand],
                "years_between": round(years, 3), "window_m": round(WINDOW_PX * pixel_m, 1),
                "method": "registration: phase correlation of the photos in squares of window_m (rock and texture "
                          "should not move); sand_edges: phase correlation of dark-sand masks (stretched brightness "
                          f"< {SAND_LEVEL}) in squares that are {EDGE_FRACTION[0]:.0%}-{EDGE_FRACTION[1]:.0%} sand, "
                          f"squares overlapping by half; 'moving' = shift of at least {MOVING_PX} px"}
    jpath = ctx.path("dunes/dune_shifts.json")
    atomic_write(jpath, json.dumps({
        "what": "shift of each square of the crop between the two orthophotos (phase correlation)",
        "pixel_m": pixel_m, "window_px": WINDOW_PX, "crop_bounds": CROP.as_list(), "epochs": EPOCHS,
        "fields": {"row, col": "top-left pixel of the square in the crop", "dx": "pixels east", "dy": "pixels south",
                   "peak": "correlation peak, 0-1; below %.2f is not used" % MIN_PEAK},
        "summary": movement, "published_rates": PUBLISHED_RATES, "shifts": shifts, "sand_edge_shifts": edges},
        separators=(",", ":"))
        .encode("utf-8"))
    files.insert(0, file_record(jpath, ctx.data_root, "json"))
    distances = {s.id: _gap_km(CROP, s.bounds) for s in ctx.scenario.sites}
    reg, edge = movement["registration"], movement["sand_edges"]
    rate = edge["moving_rate_m_per_earth_year"]
    return [new_entry(
        "dune_change_imagery", "Repeat photos of the dunes, 2007 and 2015 (HiRISE), and how far the sand moved",
        "Two HiRISE photos of the same 1.5 km of the Bagnold Dunes, eight years apart, on the same 1 m grid, and "
        "how far each 64 m square of sand moved between them.",
        ["terrain"], "imagery", "observation", "local",
        evidence_note="photos measured from orbit; the shifts are computed by this project",
        files=files, coverage={"bounds": CROP.as_list(), "nodata_fraction": nodata_frac},
        resolution_m=round(pixel_m, 2), smallest_feature_m=5,
        positional_accuracy="the two photos are orthorectified on the same elevation model and grid; rock "
                            "shifts by %s m (median), at most %s m" % (reg["still_median_m"], reg["still_max_m"]),
        uncertainty={"value": "about 0.3 px", "basis": "phase-correlation shifts are good to a few tenths of a "
                                                       "pixel where the sand has texture"},
        observation_time={"dates": [e["date"] for e in EPOCHS]},
        movement=movement, published_rates=PUBLISHED_RATES, distance_to_sites_km=distances,
        limitations=[
            "One 1.5 km patch of the dune band, not every dune near the sites.",
            "The sand surface itself is too smooth and changes shape too much to match square by square; only the "
            "edges of the sand are tracked, so the rate is an indication, not a survey.",
            f"Most sand edges barely moved: over all {edge['windows_used']} usable squares the median shift is "
            f"{edge['all_median_m']} m in {movement['years_between']} years ({edge['all_rate_m_per_earth_year']} m "
            f"per Earth year). The {edge['moving_windows']} squares ({_pct(edge['moving_fraction'])}) that moved at "
            f"least {MOVING_PX} px shifted a median {edge['moving_median_m']} m ({rate} m per Earth year), like "
            "the published rate for these dunes (about 0.4 m per year, up to 1 m, towards the south-west). Taking "
            "only the squares that moved sets a floor of about "
            f"{MOVING_PX * pixel_m / years:.2f} m per year on that number, so treat it as indicative.",
            f"Direction consistency {edge['direction_consistency']} (1 = all the same way): the direction is not "
            "reliable. Shifts at the edge of the search box are left out as probably wrong "
            f"({edge['at_search_limit']} squares).",
            "Different sun angles and haze in the two photos change shadows and the dark-sand outline a little.",
        ],
        tags=["dunes", "sand", "moving sand", "migration", "hirise", "repeat images", "change", "bagnold"],
        source={"name": f"HiRISE orthophotos from the USGS elevation model {DTM_ID} ({len(EPOCHS)} dates)",
                "page_url": HIRISE_DTM_PAGE, "request_url": EPOCHS[0]["url"], "catalog_url": STAC_PAGE,
                "fetched_at": _now(), "range_requests": requests,
                "credit": "NASA/JPL-Caltech/University of Arizona (HiRISE); USGS Astrogeology (orthophotos)",
                "license": "NASA PDS data; generally not subject to US copyright",
                "citation": "McEwen, A. S., et al. (2007). Mars Reconnaissance Orbiter's High Resolution Imaging "
                            "Science Experiment (HiRISE). J. Geophys. Res., 112, E05S02."},
    )]


dune_change_step = Step("dune_change", ("dune_change_imagery",), _dunes,
                        inputs=lambda ctx: {"epochs": [e["url"] for e in EPOCHS], "crop": CROP.as_list(),
                                            "window_px": WINDOW_PX,
                                            "sites": {s.id: s.bounds.as_list() for s in ctx.scenario.sites}})

__all__ = ["CROP", "EPOCHS", "RangeReader", "dune_change_step", "phase_shifts", "summarize_shifts",
           "window_for_bounds"]
