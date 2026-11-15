"""Catalog entries that need no download: live layers, sources we decided not to
use, sources still pending, and a copy of the scenario file.

Live URL templates, zoom ranges and CORS behaviour were verified on 2026-11-14
(see docs/data-extraction.md, section 2; the two TES zoom limits were read from
their WMTSCapabilities.xml the same day).
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..catalog import file_record, new_entry
from ..http import atomic_write
from ..scenario import Scenario
from ..snapshot import Step, StepContext

TREK_EQ = "https://trek.nasa.gov/tiles/Mars/EQ"
TREK_TILE = "/1.0.0/default/default028mm/{z}/{y}/{x}.png"
MMGIS = "https://mars.nasa.gov/mmgis-maps/MSL/Layers"
VERIFIED = "URL, zoom range and CORS verified 2026-11-14 (docs/data-extraction.md section 2)."
GLOBAL = [-180.0, -90.0, 180.0, 90.0]

TMS_NOTE = (
    "Web Mercator tiles with y counted from the bottom (TMS): y_tms = 2^z - 1 - y_xyz. "
    "Trek layers use a different grid (equirectangular)."
)
WMTS_NOTE = "Equirectangular tiles: at zoom z the grid is 2^(z+1) columns by 2^z rows; {y} is the row from the top."
PICTURES_NOTE = "Pictures only: colours, not temperature or thermal-inertia numbers."


def _trek(layer: str) -> str:
    return f"{TREK_EQ}/{layer}{TREK_TILE}"


def _live(eid, title, summary, factors, evidence, url, scheme, zmin, zmax, cors, bounds, resolution_m, limitations,
          tags, credit, page_url, category="imagery", **extra) -> Dict[str, Any]:
    return new_entry(
        eid, title, summary, factors, category, evidence, "live",
        live={"url_template": url, "scheme": scheme, "min_zoom": zmin, "max_zoom": zmax, "cors": cors},
        coverage={"bounds": bounds} if bounds else {},
        resolution_m=resolution_m,
        limitations=limitations,
        tags=tags,
        source={"name": credit, "page_url": page_url},
        notes=VERIFIED,
        **extra,
    )


def live_entries() -> List[Dict[str, Any]]:
    trek_page = "https://trek.nasa.gov/mars/"
    mmgis_page = "https://mars.nasa.gov/maps/location/?mission=Curiosity"
    return [
        _live("imagery_hirise_color", "HiRISE colour photo map (Curiosity area)",
              "The sharpest colour photo map of Curiosity's area, about 0.32 m per pixel; boulders are visible.",
              ["terrain", "routes"], "observation", f"{MMGIS}/MSL_Gale_HiRISE-LRGB_78quads/{{z}}/{{x}}/{{y}}.png",
              "tms-webmercator", 10, 18, "*", [137.327, -4.876, 137.479, -4.555], 0.32,
              [TMS_NOTE, "Covers only a strip around Curiosity's path, not the whole study area."],
              ["hirise", "photo", "color", "mmgis"], "NASA/JPL-Caltech/University of Arizona (MMGIS)", mmgis_page),
        _live("imagery_hirise_gray", "HiRISE grey photo map (Gale landing area)",
              "A sharp black-and-white photo map of the study area, about 0.64 m per pixel at the top zoom.",
              ["terrain"], "observation", _trek("curiosity_hirise_mosaic"), "wmts-eq", 0, 16, "*",
              [137.1224669, -4.9254743, 137.7298129, -4.2489588], 0.64, [WMTS_NOTE],
              ["hirise", "photo", "trek"], "NASA/JPL-Caltech/University of Arizona (Mars Trek)", trek_page),
        _live("imagery_ctx", "CTX photo map (all of Gale)",
              "A wider, less sharp photo map covering the whole crater, about 10 m per pixel at the top zoom.",
              ["terrain"], "observation", _trek("Gale_CTX_BlockAdj_dd"), "wmts-eq", 0, 12, "*",
              [135.1842593, -6.5732988, 139.2413012, -2.8077809], 10.2, [WMTS_NOTE],
              ["ctx", "photo", "trek"], "NASA/JPL-Caltech/MSSS (Mars Trek)", trek_page),
        _live("imagery_ctx_mmgis", "CTX photo map (MMGIS)",
              "The same kind of CTX photo map, served in the MMGIS (Web Mercator) tile grid, about 6 m per pixel.",
              ["terrain"], "observation", f"{MMGIS}/MSL_CTX_ortho_mosaic_6m/{{z}}/{{x}}/{{y}}.png",
              "tms-webmercator", 6, 13, "*", None, 10.2, [TMS_NOTE], ["ctx", "photo", "mmgis"],
              "NASA/JPL-Caltech/MSSS (MMGIS)", mmgis_page),
        _live("thermal_day", "THEMIS daytime infrared picture",
              "A picture of how warm the ground looks from orbit in the afternoon (bright = warmer), 100 m per pixel.",
              ["thermal"], "observation", _trek("THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018"), "wmts-eq", 0, 9,
              "*", [-180.0, -65.0, 180.0, 65.0], 100.0,
              [PICTURES_NOTE, "A mosaic of many orbits, so time of day and season vary from place to place.", WMTS_NOTE],
              ["themis", "infrared", "temperature"], "NASA/JPL-Caltech/Arizona State University (Mars Trek)", trek_page),
        _live("thermal_night", "THEMIS night-time infrared picture",
              "A picture of how warm the ground looks at night; rock and coarse ground stay warmer than dust and sand.",
              ["thermal", "ground"], "observation", _trek("THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018"),
              "wmts-eq", 0, 9, "*", [-180.0, -65.0, 180.0, 65.0], 100.0,
              [PICTURES_NOTE, "A mosaic of many orbits, so time of night and season vary from place to place.", WMTS_NOTE],
              ["themis", "infrared", "temperature", "night"], "NASA/JPL-Caltech/Arizona State University (Mars Trek)",
              trek_page),
        _live("thermal_inertia_tes", "TES thermal inertia picture (global)",
              "A coarse global picture of how quickly the ground heats and cools: low hints at dust or sand, high at rock.",
              ["ground", "thermal"], "derived", _trek("TES_Thermal_Inertia"), "wmts-eq", 0, 1, "*", GLOBAL, 3000.0,
              [PICTURES_NOTE, "Very coarse: one value covers several kilometres, larger than any candidate site.", WMTS_NOTE],
              ["tes", "thermal inertia"], "NASA/JPL-Caltech/Arizona State University (Mars Trek)", trek_page),
        _live("surface_dust_tes", "TES dust cover picture (global)",
              "A coarse global picture of how dusty the surface is, which affects solar panels and ground conditions.",
              ["solar"], "derived", _trek("tes_ruffdust"), "wmts-eq", 0, 2, "*",
              [-179.9879778, -89.9639494, 179.9541072, 90.0], 3000.0,
              ["Pictures only: colours, not dust-index numbers.", "Very coarse: kilometres per value.", WMTS_NOTE],
              ["tes", "dust"], "NASA/JPL-Caltech/Arizona State University (Mars Trek)", trek_page),
        _live("imagery_viking", "Viking colour map (global context)",
              "A global colour photo map for context, 232 m per pixel.", ["terrain"], "observation",
              _trek("Mars_Viking_MDIM21_ClrMosaic_global_232m").replace(".png", ".jpg"), "wmts-eq", 0, 7, "*", GLOBAL,
              232.0, [WMTS_NOTE], ["viking", "photo", "global"], "NASA/JPL-Caltech/USGS (Mars Trek)", trek_page),
        _live("relief_mola", "MOLA shaded relief (global context)",
              "A global shaded-relief map coloured by height, 463 m per pixel, for context.", ["terrain"], "derived",
              _trek("Mars_MGS_MOLA_ClrShade_merge_global_463m").replace(".png", ".jpg"), "wmts-eq", 0, 7, "*", GLOBAL,
              463.0, [WMTS_NOTE, "Picture of heights, not height numbers; see elevation_463m_region for numbers."],
              ["mola", "relief", "global"], "NASA/JPL-Caltech/GSFC (Mars Trek)", trek_page),
        _live("labels", "Place-name labels (Curiosity area)",
              "Transparent tiles with the names of places Curiosity visited.", ["routes"], "reference",
              f"{MMGIS}/MSL_WebGIS_PlaceText/{{z}}/{{x}}/{{y}}.png", "tms-webmercator", 4, 17, "*", None, None,
              [TMS_NOTE], ["names", "labels", "mmgis"], "NASA/JPL-Caltech (MMGIS)", mmgis_page, category="reference"),
        _live("elevation_point_service", "Height at any point (live)",
              "Ask Mars Trek for the ground height at any clicked point in the study area.", ["terrain", "routes"],
              "derived",
              "https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer/identify"
              '?geometry={"x":{lon},"y":{lat}}&geometryType=esriGeometryPoint&returnGeometry=false'
              "&returnCatalogItems=false&f=json",
              "arcgis", None, None, "echoes Origin", [137.1224711, -4.9254743, 137.7298129, -4.2489631], 1.0,
              ["Returns the 1 m elevation model's value; the same limits as elevation_1m_* apply.",
               "URL-encode the geometry parameter."],
              ["elevation", "height", "identify"], "NASA/JPL-Caltech (Mars Trek ImageServer)", trek_page,
              category="elevation"),
    ]


def _not_used(eid, title, summary, reason, factors=(), page_url="") -> Dict[str, Any]:
    return new_entry(eid, title, summary, list(factors), "not_used", "reference", "not_used", reason=reason,
                     source={"page_url": page_url} if page_url else {})




def not_used_entries() -> List[Dict[str, Any]]:
    return [
        _not_used("communications", "Communications coverage", "Line of sight to orbiters and Earth.",
                  "no separate dataset: IR-10 (longest gap in communications) is computed from the elevation "
                  "grids plus an assumed antenna and relay network, which is a design input", ["routes"]),
        _not_used("photos_curiosity_index", "Curiosity photo index", "Photos taken by Curiosity at each stop.",
                  "optional later; not needed by the five factors",
                  page_url="https://mars.nasa.gov/msl/multimedia/raw-images/"),
        _not_used("perseverance_photos", "Perseverance rover photos", "Photos from the Perseverance rover.",
                  "rover is at Jezero crater, not Gale",
                  page_url="https://mars.nasa.gov/mars2020/multimedia/raw-images/"),
        _not_used("worldview", "NASA Worldview", "NASA's Earth satellite imagery browser.",
                  "Earth data only; layout inspiration", page_url="https://worldview.earthdata.nasa.gov/"),
        _not_used("geology_1to60k", "Detailed Mount Sharp geologic map (1:60K)",
                  "A detailed geologic map of Aeolis Mons (Mount Sharp).",
                  "USGS lists the 1:60K Aeolis Mons map as In Progress, no data", ["ground"],
                  page_url="https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars"),
        _not_used("trek_login_tools", "Trek path, rock and slope tools", "Mars Trek's analysis tools.",
                  "Trek path, rock and slope tools need a login", page_url="https://trek.nasa.gov/mars/"),
        _not_used("trek_data_stream", "Trek full-file downloads", "Whole-file downloads of Trek products.",
                  "multi-GB full-file download that ignores byte ranges"),
        _not_used("route_animation", "Curiosity's proposed path up Mount Sharp (PIA23179)",
                  "NASA's animated map of Curiosity's planned route.",
                  "NASA route animation PIA23179 is a reference image, not data",
                  page_url="https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/"),
        _not_used("water_dan_curiosity", "Water under Curiosity's wheels (DAN neutron instrument)",
                  "Curiosity's DAN instrument measures hydrogen (water) in the top metre of ground along its path.",
                  "the NASA PDS archive (msl-m-dan-3_4-rdr-v1) holds neutron counts, not water percentages; turning "
                  "counts into water needs the DAN team's model, so use their published results instead",
                  ["ground"], page_url="https://pds-geosciences.wustl.edu/missions/msl/dan.htm"),
    ]


def pending_entries() -> List[Dict[str, Any]]:
    return [
        new_entry("ice_swim", "Subsurface ice maps (SWIM)", "Maps of where buried ice is likely, from several orbiters.",
                  ["ground"], "ice", "derived", "pending",
                  reason="swim.psi.edu returned HTTP 523 (server unreachable) four times on 2026-11-14, last at "
                         "23:48 UTC, and no copy was found on Zenodo; SWIM maps the mid-latitudes, so Gale (4.6 S) is "
                         "likely outside it",
                  limitations=["Ice is not expected near the surface at Gale: it is 4.6 degrees south of the equator, "
                               "and buried ice is stable near the surface mostly poleward of about 30-40 degrees.",
                               "Orbital water evidence for Gale: water_odyssey_grs (water bound in soil and minerals)."],
                  source={"page_url": "https://swim.psi.edu/"}),
    ]


def scenario_entry(ctx: StepContext) -> Dict[str, Any]:
    target = ctx.path("scenario.json")
    atomic_write(target, ctx.scenario.path.read_bytes())
    return new_entry(
        "scenario", "Scenario assumptions",
        "The team's assumptions: base location, candidate sites, facility size and mobility limits.",
        ["terrain", "ground", "solar", "thermal", "routes"], "assumptions", "assumption", "local",
        files=[file_record(target, ctx.data_root, "json")],
        coverage={"bounds": ctx.scenario.study_area.as_list()},
        limitations=["Every value is an assumption to be agreed by the team, not data.",
                     "This is a copy; edit scenario/gale.json in the repo and re-run the snapshot."],
        source={"name": "team", "page_url": "scenario/gale.json"},
        tags=["assumptions", "base", "sites"],
    )


def static_entries(ctx: StepContext) -> List[Dict[str, Any]]:
    return live_entries() + not_used_entries() + pending_entries() + [scenario_entry(ctx)]


static_step = Step(
    "static",
    tuple(e["id"] for e in live_entries() + not_used_entries() + pending_entries()) + ("scenario",),
    static_entries,
)

__all__ = ["live_entries", "not_used_entries", "pending_entries", "static_entries", "static_step"]
