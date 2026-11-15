"""Elevation, and the terrain layers computed from it.

At Gale the heights come from Mars Trek's ArcGIS ImageServer (the 1 m Gale
DEM). Other regions name their own models in the scenario's ``elevation``: a
USGS HiRISE DTM (1 m, for the sites and the trip area) and a CTX DTM (about
20 m, for the study area), read as cloud-optimised GeoTIFFs (see ``cog.py``).

Export layout, verified live 2026-11-14 (4x4, 8x8 and 16x3 exports, each corner
compared with ``identify`` at the pixel centre; values agree within 0.06 m,
the difference being bilinear resampling):

* ``format=bsq&pixelType=F32`` returns little-endian float32, row 0 = north,
  followed by a 1-bit-per-pixel validity mask of ``ceil(w*h/8)`` bytes.
* Pixels outside the elevation model are -3.4028e38 (``identify`` says
  "NoData"); anything outside [-9000, 22000] m or non-finite becomes NaN.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from ..catalog import new_entry
from ..cog import read_cog_grid
from ..grids import Grid, nodata_report, parse_bsq_f32, write_grid
from ..http import Fetcher, build_url
from ..png import write_overlay
from ..scenario import Bounds, Scenario, Site
from ..snapshot import Step, StepContext, _now
from ..terrain import noise_floor, pixel_size_m, slope_deg, window_plane_fit

IMAGESERVER = "https://trek.nasa.gov/mars/trekarcgis/rest/services/{service}/ImageServer"
GALE_DEM = "Gale_DEM_SMG_1m"
GALE_DEM_PIXEL_DEG = 1.6870604858114447e-05
MOLA = "mola128_mola64_merge_90Nto90S_SimpleC_clon0"
MAX_EXPORT_W = 15000
VALID_RANGE = (-9000.0, 22000.0)

TREK_PAGE = "https://trek.nasa.gov/mars/"
LICENSE = (
    "NASA media are generally not subject to US copyright "
    "(https://www.nasa.gov/nasa-brand-center/images-and-media/); credit the instrument team."
)
HIRISE_CREDIT = "NASA/JPL-Caltech/University of Arizona"
SLOPE_STOPS = [(0.0, (26, 152, 80)), (10.0, (254, 224, 139)), (20.0, (244, 109, 67)), (35.0, (165, 0, 38))]
WINDOW_M = 10.0  # BT-05 / BT-08 screening window
ROUGH_STOPS = [(0.0, (255, 255, 255)), (0.3, (253, 174, 97)), (1.0, (127, 39, 4))]
NODATA_STOPS = [(0.0, (0, 0, 0)), (1.0, (255, 0, 255))]


def export_url(service: str, bounds: Bounds, width: int, height: int) -> str:
    return build_url(
        IMAGESERVER.format(service=service) + "/exportImage",
        {
            "bbox": ",".join(repr(float(v)) for v in bounds.as_list()),
            "bboxSR": 104905,
            "imageSR": 104905,
            "size": f"{width},{height}",
            "format": "bsq",
            "pixelType": "F32",
            "interpolation": "RSP_BilinearInterpolation",
            "f": "image",
        },
    )


def _clean(values: np.ndarray) -> np.ndarray:
    v = values.astype(np.float32)
    bad = ~np.isfinite(v) | (v < VALID_RANGE[0]) | (v > VALID_RANGE[1])
    v[bad] = np.nan
    return v


def export_grid(fetcher: Fetcher, service: str, bounds: Bounds, pixel_deg: float, max_rows: int = 1024) -> Grid:
    """Download ``bounds`` at ``pixel_deg`` in bands of at most ``max_rows`` rows, stitched north to south."""
    width = max(1, int(round((bounds.east - bounds.west) / pixel_deg)))
    height = max(1, int(round((bounds.north - bounds.south) / pixel_deg)))
    if width > MAX_EXPORT_W:
        raise ValueError(f"export of {width} columns exceeds the ImageServer limit of {MAX_EXPORT_W}")
    py = (bounds.north - bounds.south) / height
    bands = []
    for r0 in range(0, height, max_rows):
        rows = min(max_rows, height - r0)
        north = bounds.north - r0 * py
        band_bounds = Bounds(bounds.west, north - rows * py, bounds.east, north)
        url = export_url(service, band_bounds, width, rows)
        n = width * rows
        body = fetcher.get_bytes(url, n * 4 + math.ceil(n / 8) + 64).body
        bands.append(parse_bsq_f32(body, width, rows))
    return Grid(_clean(np.vstack(bands)), bounds)


def identify(fetcher: Fetcher, service: str, lon: float, lat: float) -> float:
    url = build_url(
        IMAGESERVER.format(service=service) + "/identify",
        {
            "geometry": f'{{"x":{lon!r},"y":{lat!r}}}',
            "geometryType": "esriGeometryPoint",
            "returnGeometry": "false",
            "returnCatalogItems": "false",
            "f": "json",
        },
    )
    value = fetcher.get_json(url).get("value")
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def service_pixel_deg(fetcher: Fetcher, service: str) -> float:
    info = fetcher.get_json(build_url(IMAGESERVER.format(service=service), {"f": "json"}))
    return float(info["pixelSizeX"])


def _precision(scenario: Scenario) -> Tuple[float, Dict[str, Any]]:
    sigma = float(scenario.assumptions.get("dem_vertical_precision_m", {}).get("value", 0.25))
    where = ("Trek's Gale_DEM_SMG_1m metadata states no vertical precision (checked 2026-11-14)" if scenario.is_gale
             else "the USGS elevation models state no vertical precision (checked 2026-11-15)")
    return sigma, {
        "value": sigma,
        "unit": "m",
        "basis": f"assumption: scenario dem_vertical_precision_m placeholder; {where}",
    }


def study_resolution(scenario: Scenario) -> int:
    """Metres per pixel of the study-area grid: 10 at Gale, the scenario's study model elsewhere."""
    return int(scenario.elevation["study"]["resolution_m"]) if scenario.elevation else 10


def study_dataset(scenario: Scenario) -> str:
    """Dataset id of the study-area elevation grid (``elevation_10m_study`` at Gale)."""
    return f"elevation_{study_resolution(scenario)}m_study"


STAC_ITEMS = "https://stac.astrogeology.usgs.gov/api/collections/{collection}/items/{item}"


def read_elevation(ctx: StepContext, which: str, bounds: Bounds, resolution_m: int) -> Tuple[Grid, Dict[str, Any]]:
    """Heights over ``bounds`` at ``resolution_m`` from the ``study`` or ``fine`` model, and the source record."""
    src = ctx.scenario.elevation[which] if ctx.scenario.elevation else None
    if src is None:
        grid = export_grid(ctx.fetcher, GALE_DEM, bounds, resolution_m * GALE_DEM_PIXEL_DEG)
        req = export_url(GALE_DEM, grid.bounds, grid.shape[1], min(grid.shape[0], 1024))
        return grid, _source("Mars Trek ImageServer Gale_DEM_SMG_1m (MRO HiRISE, Gale Crater DEM)", req, HIRISE_CREDIT)
    grid = read_cog_grid(ctx, src["url"], bounds, decimate=resolution_m if which == "fine" else 1)
    instrument = "MRO HiRISE" if which == "fine" else "MRO CTX"
    credit = (HIRISE_CREDIT if which == "fine" else "NASA/JPL-Caltech/MSSS") + "; USGS Astrogeology"
    return grid, {
        "name": f"USGS Astrogeology analysis-ready elevation model {src['name']} ({instrument})",
        "page_url": src.get("page_url") or "https://stac.astrogeology.usgs.gov/",
        "request_url": src["url"],
        "fetched_at": _now(),
        "credit": credit,
        "license": LICENSE,
    }


def _rover_name(scenario: Scenario) -> Optional[str]:
    return scenario.rover.capitalize() if scenario.rover else None


def _elev_stops(values: np.ndarray):
    finite = values[np.isfinite(values)]
    lo, hi = (float(np.percentile(finite, 2)), float(np.percentile(finite, 98))) if finite.size else (0.0, 1.0)
    lo, hi = math.floor(lo), math.ceil(hi)
    if hi - lo < 3:
        hi = lo + 3
    third = (hi - lo) / 3.0
    return [(lo, (40, 90, 60)), (lo + third, (170, 160, 100)), (lo + 2 * third, (160, 110, 70)), (hi, (245, 245, 245))]


def _coverage(grid: Grid, area: str) -> Dict[str, Any]:
    rep = nodata_report(np.isnan(grid.values), grid.bounds)
    return {"area": area, "bounds": grid.bounds.as_list(), **rep}


def _source(service_label: str, request_url: str, credit: str) -> Dict[str, Any]:
    return {
        "name": service_label,
        "page_url": TREK_PAGE,
        "request_url": request_url,
        "fetched_at": _now(),
        "credit": credit,
        "license": LICENSE,
    }


def _write_triplet(ctx: StepContext, grid: Grid, stem: str, stops, unit: str) -> List[Dict[str, Any]]:
    f32 = write_grid(grid, ctx.path(f"elevation/{stem}.f32"), ctx.data_root, "f32")
    png = write_overlay(grid.values, np.isnan(grid.values), grid.bounds, ctx.path(f"elevation/{stem}.png"),
                        ctx.data_root, stops, unit)
    png["role"] = "overlay"
    return [f32, png]


def _terrain_entries(ctx: StepContext, grid: Grid, area: str, suffix: str, resolution_m: int,
                     with_roughness: bool, label: str, src: Dict[str, Any], model: str = "fine") -> List[Dict[str, Any]]:
    sigma, uncertainty = _precision(ctx.scenario)
    dx, dy = pixel_size_m(grid)
    coverage = _coverage(grid, area)
    gale = ctx.scenario.elevation is None
    rover = _rover_name(ctx.scenario)
    common = dict(
        coverage=coverage,
        resolution_m=resolution_m,
        uncertainty=uncertainty,
        source=src,
        ground_validated={"value": False, "note": f"compared with {rover}'s own heights in the alignment check"
                          if rover else "no rover has driven here, so no ground check"},
        observation_time={"note": "mosaic of HiRISE stereo pairs; acquisition dates not given by Trek", "created": "2020-06-25"}
        if gale else {"note": f"from the stereo images named in {ctx.scenario.elevation[model]['name']}; their dates are "
                              "on the source page"},
    )
    small = {1: 3, 2: 6}.get(resolution_m, 3 * resolution_m)
    resampled = (f"Resampled to {resolution_m} m by the map server (bilinear) from the 1 m model." if gale
                 else f"Averaged to {resolution_m} m from the 1 m model ({resolution_m} x {resolution_m} pixel blocks; "
                      "a block with any missing pixel is left empty).")
    common_limits = [
        f"Features smaller than about {small} m can't be seen in this elevation grid."
        if resolution_m != 1
        else "Rocks and features smaller than about 3 m can't be seen in the 1 m elevation model.",
        *([resampled] if resolution_m == 2 else []),
        "Heights come from stereo photos taken from orbit, not direct measurement.",
        "The source states no vertical precision; noise floors use the scenario's placeholder value.",
        *([] if gale else ["The 1 m (HiRISE) and coarse (CTX) models are separate products and can disagree by tens "
                           "of metres in absolute height; compare heights within one model (slopes are unaffected)."]),
    ]
    nf = noise_floor(sigma, dx)

    elev_files = _write_triplet(ctx, grid, f"elevation_{suffix}", _elev_stops(grid.values), "m")
    if resolution_m != 1:
        missing = np.isnan(grid.values).astype(np.float32)
        nd_name = "study_nodata.png" if area == "study_area" else f"{area}_nodata.png"
        nd = write_overlay(missing, missing == 0, grid.bounds, ctx.path(f"elevation/{nd_name}"), ctx.data_root,
                           NODATA_STOPS, "missing")
        nd["role"] = "nodata_overlay"
        elev_files.append(nd)
    entries = [
        new_entry(
            f"elevation_{suffix}", f"Ground height, {label}",
            f"Height of the ground every {resolution_m} m across the {label}, in metres.",
            ["terrain", "routes", "solar"], "elevation", "derived", "local",
            files=elev_files, smallest_feature_m=small, limitations=common_limits,
            tags=["elevation", "height", "dem", "ctx" if model == "study" and not gale else "hirise"], **common,
        )
    ]
    slope = slope_deg(grid.values, dx, dy)
    pixel_method = {"metric": None, "kind": "pixel slope by central differences", "baseline_m": round(2 * dx, 3),
                    "note": "not the BT-05 measure; use slope_10m_window_<site> for that"}
    slope_limits = list(common_limits) + [
        f"Slopes below about {nf['slope_deg']:.1f} degrees can't be told apart from elevation noise "
        "(based on an assumed precision; real noise is smoother, so this is cautious)."
    ]
    if resolution_m != 1:
        slope_limits.insert(0, f"Computed on a {resolution_m} m grid: smoother than the 1 m slope"
                               + ("; for screening only." if resolution_m >= 10 else "."))
    entries.append(
        new_entry(
            f"slope_{suffix}", f"Steepness, {label}",
            f"How steep the ground is, in degrees, every {resolution_m} m across the {label}.",
            ["terrain", "routes"], "elevation", "derived", "local",
            files=_write_triplet(ctx, Grid(slope.astype(np.float32), grid.bounds), f"slope_{suffix}", SLOPE_STOPS, "deg"),
            smallest_feature_m=small, limitations=slope_limits, noise_floor=nf, method=pixel_method,
            tags=["slope", "steepness", "terrain"], **common,
        )
    )
    if with_roughness:
        wpx = max(3, int(round(WINDOW_M / dx)))
        nf_w = noise_floor(sigma, dx, window=wpx)
        win_slope, rough = window_plane_fit(grid.values, wpx, dx, dy)

        def method(metric: str) -> Dict[str, Any]:
            return {"metric": metric, "window_m": round(wpx * dx, 3), "window_px": wpx, "grid_m": round(dx, 4),
                    "step_px": 1, "fit": "least-squares plane in each window",
                    "result_at": "window's first row + window_px // 2, first column + window_px // 2"}

        entries.append(
            new_entry(
                f"slope_10m_window_{area}", f"Local pad slope in 10 m windows, {label}",
                "How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box "
                "(the requirements' local pad slope, BT-05).",
                ["terrain", "routes"], "elevation", "derived", "local",
                files=_write_triplet(ctx, Grid(win_slope.astype(np.float32), grid.bounds),
                                     f"slope_10m_window_{area}", SLOPE_STOPS, "deg"),
                smallest_feature_m=10, noise_floor=nf_w, method=method("BT-05"),
                limitations=common_limits + [
                    f"Slopes below about {nf_w['slope_window_deg']:.1f} degrees can't be told apart from "
                    "elevation noise (based on the placeholder precision).",
                    "Boxes with any missing height are left empty, never shown as flat.",
                    "Averages over 10 m: steps and edges smaller than that need slope_1m and roughness.",
                ],
                tags=["slope", "steepness", "pad", "BT-05", "terrain"], **common,
            )
        )
        entries.append(
            new_entry(
                f"roughness_{suffix}", f"Bumpiness, {label}",
                "How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; "
                "the requirements' detrended roughness, BT-08).",
                ["terrain", "routes"], "elevation", "derived", "local",
                files=_write_triplet(ctx, Grid(rough.astype(np.float32), grid.bounds), f"roughness_{suffix}",
                                     ROUGH_STOPS, "m"),
                smallest_feature_m=small, noise_floor=nf_w, method=method("BT-08"),
                limitations=common_limits + [
                    f"Bumpiness below about {nf['roughness_m']:.2f} m can't be told apart from elevation noise.",
                    "An estimate of obstacles from heights, not a map of rocks.",
                ],
                tags=["roughness", "bumpiness", "obstacles", "terrain"], **common,
            )
        )
    return entries


def _study(ctx: StepContext) -> List[Dict[str, Any]]:
    res = study_resolution(ctx.scenario)
    grid, src = read_elevation(ctx, "study", ctx.scenario.study_area, res)
    return _terrain_entries(ctx, grid, "study_area", f"{res}m_study", res, False, f"study area ({res} m screening)",
                            src, model="study")


def _model_inputs(ctx: StepContext, which: str) -> Dict[str, Any]:
    return {"model": ctx.scenario.elevation[which]["url"]} if ctx.scenario.elevation else {}


def study_step_for(scenario: Scenario) -> Step:
    res = study_resolution(scenario)
    return Step("elevation_study", (f"elevation_{res}m_study", f"slope_{res}m_study"), _study,
                inputs=lambda ctx: {"study_area": ctx.scenario.study_area.as_list(), **_model_inputs(ctx, "study")})


study_step = Step("elevation_study", ("elevation_10m_study", "slope_10m_study"), _study,
                  inputs=lambda ctx: {"study_area": ctx.scenario.study_area.as_list()})


def _site_step(site: Site) -> Step:
    def run(ctx: StepContext) -> List[Dict[str, Any]]:
        current = ctx.scenario.site(site.id)
        grid, src = read_elevation(ctx, "fine", current.bounds, 1)
        entries = _terrain_entries(ctx, grid, current.id, f"1m_{current.id}", 1, True, f"site {current.name}", src)
        fraction = entries[0]["coverage"]["covered_fraction"]
        if fraction < 0.95:
            ctx.warn(
                f"site {current.id}: only {fraction:.0%} of the site has 1 m elevation (below 95%); "
                f"consider moving the site box in scenario/{ctx.scenario.path.name}"
            )
        return entries

    ids = tuple(f"{k}_1m_{site.id}" for k in ("elevation", "slope", "roughness")) + (f"slope_10m_window_{site.id}",)
    return Step(f"elevation_site_{site.id}", ids, run,
                inputs=lambda ctx: {"site": ctx.scenario.site(site.id).bounds.as_list(), **_model_inputs(ctx, "fine")})


def site_steps(scenario: Scenario) -> List[Step]:
    return [_site_step(s) for s in scenario.sites]


TRIP_RESOLUTION_M = 2


def _trip(ctx: StepContext) -> List[Dict[str, Any]]:
    area = ctx.scenario.trip_area
    if area is None:
        raise ValueError("the scenario has no trip_area")
    grid, src = read_elevation(ctx, "fine", area, TRIP_RESOLUTION_M)
    entries = _terrain_entries(ctx, grid, "trip_area", f"{TRIP_RESOLUTION_M}m_trip_area", TRIP_RESOLUTION_M, False,
                               "trip area (the base and the near-base sites, for route planning)", src)
    fraction = entries[0]["coverage"]["covered_fraction"]
    if fraction < 0.95:
        ctx.warnings.append(f"trip_area: only {fraction:.0%} of the box has elevation data")
    return entries


def trip_steps(scenario: Scenario) -> List[Step]:
    """The 2 m route-planning grid, if the scenario defines ``trip_area``."""
    if scenario.trip_area is None:
        return []
    suffix = f"{TRIP_RESOLUTION_M}m_trip_area"
    return [Step("elevation_trip_area", (f"elevation_{suffix}", f"slope_{suffix}"), _trip,
                 inputs=lambda ctx: {"trip_area": ctx.scenario.trip_area.as_list(), "resolution_m": TRIP_RESOLUTION_M,
                                     **_model_inputs(ctx, "fine")})]


def _region(ctx: StepContext) -> List[Dict[str, Any]]:
    pixel = service_pixel_deg(ctx.fetcher, MOLA)
    sc = ctx.scenario
    grid = export_grid(ctx.fetcher, MOLA, sc.region_bounds, pixel)
    files = _write_triplet(ctx, grid, "elevation_463m_region", _elev_stops(grid.values), "m")
    req = export_url(MOLA, grid.bounds, grid.shape[1], grid.shape[0])
    title = "Ground height, whole Gale region (coarse)" if sc.is_gale else f"Ground height, whole {sc.region_name} region (coarse)"
    summary = ("Coarse ground height for the whole crater, its rim and Mount Sharp, used to work out which hills block the sun."
               if sc.is_gale else f"Coarse ground height for the whole {sc.region_name} region around the study area, used "
                                  "to work out which distant hills and crater walls block the sun.")
    return [
        new_entry(
            "elevation_463m_region", title, summary,
            ["solar", "terrain"], "elevation", "derived", "local",
            files=files, coverage=_coverage(grid, sc.region_area), resolution_m=463, smallest_feature_m=1400,
            uncertainty={"value": "unknown", "basis": "MOLA gridded heights; precision not stated by Trek"},
            source=_source("Mars Trek ImageServer " + MOLA + " (MGS MOLA)", req, "NASA/GSFC MOLA Science Team"),
            limitations=["Coarse (463 m per pixel): only for distant hills and crater walls, not for site terrain."],
            tags=["elevation", "mola", "region", "horizon"],
        )
    ]


region_step = Step("elevation_region", ("elevation_463m_region",), _region,
                   inputs=lambda ctx: {"gale_region": ctx.scenario.region_bounds.as_list()})

__all__ = [
    "GALE_DEM",
    "GALE_DEM_PIXEL_DEG",
    "MOLA",
    "export_grid",
    "export_url",
    "identify",
    "region_step",
    "service_pixel_deg",
    "site_steps",
    "read_elevation",
    "study_dataset",
    "study_resolution",
    "study_step",
    "study_step_for",
]
