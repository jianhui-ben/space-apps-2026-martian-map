"""Vector layers from ArcGIS feature/map services: geology, map index, minerals, dunes.

Queries ask for Mars geographic coordinates (``outSR=104905``) in Esri JSON
and convert them to GeoJSON here. ``f=geojson`` would label the output as
Earth WGS84, so it isn't used.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from ..catalog import file_record, new_entry
from ..http import FetchError, Fetcher, atomic_write, build_url
from ..scenario import Bounds
from ..snapshot import Step, StepContext, _now

SIM3292 = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer"
PGM_INDEX = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PGM_Map_Database_MARS_INTERACTIVE2/FeatureServer/1"
# Trek's getLayerServices for Hydrous_Mineral_Detections_CRISM_clon0 points at this service (checked 2026-11-14).
MINERALS = "https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0"
DUNES = "https://trek.nasa.gov/mars/trekarcgis/rest/services/Dune_Field/MapServer/0"
PGM_PAGE = "https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars"
TREK_PAGE = "https://trek.nasa.gov/mars/"


def _signed_area(ring: List[List[float]]) -> float:
    return 0.5 * sum(x1 * y2 - x2 * y1 for (x1, y1, *_), (x2, y2, *_) in zip(ring, ring[1:] + ring[:1]))


def esri_to_geojson(geom: Dict[str, Any]) -> Dict[str, Any]:
    if geom is None:
        return None
    if "x" in geom and "y" in geom:
        return {"type": "Point", "coordinates": [geom["x"], geom["y"]]}
    if "points" in geom:
        return {"type": "MultiPoint", "coordinates": geom["points"]}
    if "paths" in geom:
        paths = geom["paths"]
        if len(paths) == 1:
            return {"type": "LineString", "coordinates": paths[0]}
        return {"type": "MultiLineString", "coordinates": paths}
    if "rings" in geom:
        polygons: List[List[List[List[float]]]] = []
        for ring in geom["rings"]:
            if _signed_area(ring) <= 0 or not polygons:  # Esri outer rings are clockwise
                polygons.append([ring])
            else:  # counter-clockwise: a hole in the latest outer ring
                polygons[-1].append(ring)
        if len(polygons) == 1:
            return {"type": "Polygon", "coordinates": polygons[0]}
        return {"type": "MultiPolygon", "coordinates": polygons}
    raise FetchError(f"unsupported Esri geometry keys: {sorted(geom)}")


def _query(fetcher: Fetcher, layer_url: str, bounds: Bounds, out_fields: str, paging: Dict[str, int]) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "geometry": ",".join(repr(float(v)) for v in bounds.as_list()),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 104905,
        "outSR": 104905,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": out_fields,
        "returnGeometry": "true",
    }
    params.update(paging)
    params["f"] = "json"
    return fetcher.get_json(build_url(layer_url + "/query", params))


def query_features(
    fetcher: Fetcher,
    layer_url: str,
    bounds: Bounds,
    out_fields: str = "*",
    page_size: int = 1000,
    max_features: int = 20000,
) -> Dict[str, Any]:
    """All features intersecting ``bounds`` as a GeoJSON FeatureCollection (lon/lat degrees)."""
    features: List[Dict[str, Any]] = []
    offset = 0
    while True:
        body = _query(fetcher, layer_url, bounds, out_fields, {"resultOffset": offset, "resultRecordCount": page_size})
        err = body.get("error") if isinstance(body, dict) else None
        if err and "pagination is not supported" in str(err.get("message", "")).lower() and offset == 0:
            body = _query(fetcher, layer_url, bounds, out_fields, {})
            err = body.get("error")
            if not err and body.get("exceededTransferLimit"):
                raise FetchError(f"{layer_url}: the area has more features than one request returns, and the server can't page")
            if not err:
                features.extend(body.get("features") or [])
                break
        if err:
            raise FetchError(f"{layer_url}: ArcGIS error {err.get('code')}: {err.get('message')}")
        page = body.get("features") or []
        features.extend(page)
        if len(features) > max_features:
            raise FetchError(f"{layer_url}: more than {max_features} features; refusing to continue")
        if not body.get("exceededTransferLimit") or not page:
            break
        offset += len(page)
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": f.get("attributes") or {}, "geometry": esri_to_geojson(f.get("geometry"))}
            for f in features
        ],
    }


def _vector_entry(ctx: StepContext, dataset_id: str, layer_url: str, bounds: Bounds, meta: Dict[str, Any]) -> Dict[str, Any]:
    fc = query_features(ctx.fetcher, layer_url, bounds)
    path = ctx.path(f"vectors/{dataset_id}.geojson")
    atomic_write(path, json.dumps(fc, separators=(",", ":")).encode("utf-8"))
    return new_entry(
        dataset_id,
        meta["title"],
        meta["summary"],
        meta["factors"],
        meta.get("category", "geology"),
        meta["evidence_type"],
        "local",
        files=[file_record(path, ctx.data_root, "geojson", feature_count=len(fc["features"]))],
        coverage={"bounds": bounds.as_list()},
        resolution_m=meta.get("resolution_m"),
        limitations=meta.get("limitations", []),
        tags=meta.get("tags", []),
        source={
            "name": meta["source_name"],
            "page_url": meta["page_url"],
            "request_url": layer_url + "/query",
            "fetched_at": _now(),
            "credit": meta["credit"],
            "license": meta.get("license", "US Government work; credit the authors"),
        },
    )


GEOLOGY_LIMITS = [
    "1:20,000,000 global map: units are much larger than a candidate site.",
    "Orbital interpretation; not ground-validated.",
]
SIM_SOURCE = dict(
    source_name="USGS SIM 3292, Geologic Map of Mars (Tanaka et al., 2014)",
    page_url="https://pubs.usgs.gov/sim/3292/",
    credit="Tanaka et al. 2014, USGS Scientific Investigations Map 3292",
    license="USGS product, generally public domain (usgs.gov copyrights page could not be fetched to confirm)",
)


def _geology(ctx: StepContext) -> List[Dict[str, Any]]:
    region = ctx.scenario.region_bounds
    layers = [
        ("geology_units", 3, "Geologic units (rock types)",
         "What the rock is, from the global geologic map: each area has a unit name and description.",
         ["geology", "units", "rock"]),
        ("geology_contacts", 1, "Geologic contacts (unit boundaries)",
         "Lines where one geologic unit meets another.", ["geology", "contacts"]),
        ("geology_structures", 2, "Geologic structures (ridges, scarps, channels)",
         "Mapped landforms such as ridges, scarps and channels.", ["geology", "structures"]),
    ]
    return [
        _vector_entry(ctx, did, f"{SIM3292}/{n}", region, dict(
            title=title, summary=summary, factors=["ground"], evidence_type="interpretation",
            resolution_m=None, limitations=GEOLOGY_LIMITS, tags=tags, **SIM_SOURCE))
        for did, n, title, summary, tags in layers
    ]


def _region_inputs(ctx: StepContext) -> Dict[str, Any]:
    return {"gale_region": ctx.scenario.region_bounds.as_list()}


geology_step = Step("geology", ("geology_units", "geology_contacts", "geology_structures"), _geology,
                    inputs=_region_inputs)


def _geology_index(ctx: StepContext) -> List[Dict[str, Any]]:
    return [_vector_entry(ctx, "geology_map_index", PGM_INDEX, ctx.scenario.study_area, dict(
        title="Geologic maps covering the study area",
        summary="The list (and outlines) of published geologic maps that cover the study area, including unfinished ones.",
        factors=["ground"], evidence_type="reference", category="reference",
        limitations=["An index of maps, not geology itself; the 1:60K Aeolis Mons map is listed as In Progress."
                     if ctx.scenario.is_gale else "An index of maps, not geology itself."],
        tags=["geology", "maps", "index"], source_name="USGS-NASA Planetary Geologic Mapping Program map database",
        page_url=PGM_PAGE, credit="USGS Astrogeology Science Center"))]


geology_index_step = Step("geology_index", ("geology_map_index",), _geology_index,
                          inputs=lambda ctx: {"study_area": ctx.scenario.study_area.as_list()})


def _minerals(ctx: StepContext) -> List[Dict[str, Any]]:
    return [_vector_entry(ctx, "minerals_detections", MINERALS, ctx.scenario.region_bounds, dict(
        title="Water-related mineral detections",
        summary="Places where orbiters (CRISM, OMEGA) detected minerals that formed with water, such as clays and sulfates.",
        factors=["ground"], evidence_type="interpretation", category="minerals",
        limitations=["Points from a global survey; positions are approximate and many outcrops are not listed.",
                     "Detections of minerals, not evidence of ice or of ground strength."],
        tags=["minerals", "crism", "omega", "clay", "sulfate"], source_name="Mars Trek: Hydrous mineral detections (OMEGA, CRISM)",
        page_url=TREK_PAGE, credit="NASA/JPL-Caltech/JHUAPL; ESA/IAS (via Mars Trek)"))]


minerals_step = Step("minerals", ("minerals_detections",), _minerals, inputs=_region_inputs)


def _dunes(ctx: StepContext) -> List[Dict[str, Any]]:
    return [_vector_entry(ctx, "dune_fields", DUNES, ctx.scenario.region_bounds, dict(
        title="Sand dune fields",
        summary="Outlines of mapped sand-dune fields: loose, moving sand that is hard to drive on and build on.",
        factors=["terrain", "ground"], evidence_type="interpretation", category="terrain",
        limitations=["Global survey outlines; small dunes and sand patches inside a site are not mapped."],
        tags=["dunes", "sand", "loose ground"], source_name="Mars Trek: Dune fields (Mars Global Digital Dune Database)",
        page_url=TREK_PAGE, credit="USGS/NASA (via Mars Trek)"))]


dunes_step = Step("dunes", ("dune_fields",), _dunes, inputs=_region_inputs)

__all__ = [
    "dunes_step",
    "esri_to_geojson",
    "geology_index_step",
    "geology_step",
    "minerals_step",
    "query_features",
]
