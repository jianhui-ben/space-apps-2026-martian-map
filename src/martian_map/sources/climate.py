"""Typical temperatures, pressure, dust and sunlight at the base, from the Mars Climate Database (MCD).

The MCD (LMD, Paris, with Oxford, IAA Granada, ESA and CNES) is a database of
global climate-model runs checked against spacecraft observations. Its web
service returns tables for one point: every hour of the Martian day across the
year (24 seasons, Ls 0-345 every 15 degrees), for several dust cases. We ask
for the base point at 2 m above the ground in four cases:

* ``climatology``: a typical year (dust as observed, averaged over Mars years 24-35);
* ``cold`` / ``warm``: the clearest and the dustiest of those years;
* ``dust_storm``: a global dust storm, which the MCD only models from Ls 180 to 360,
  so we take four seasons (Ls 180, 225, 270, 315).

These are model values for a typical year at the base point, not measurements;
the MCD has no below-ground temperatures. The web interface is "intended for
moderate use only": the snapshot makes 14 requests once and keeps the result.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Sequence, Tuple

from ..catalog import file_record, new_entry
from ..http import atomic_write, build_url
from ..snapshot import Step, StepContext, _now

MCD_PAGE = "https://www-mars.lmd.jussieu.fr/mcd_python/"
CGI_URL = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
TXT_BASE = "https://www-mars.lmd.jussieu.fr/mcd_python/txt/"
CREDIT = "Mars Climate Database (c) LMD/OU/IAA/ESA/CNES"
CITATION = ("Forget, F., et al. (1999). Improved general circulation models of the Martian atmosphere from the "
            "surface to above 80 km. J. Geophys. Res., 104(E10), 24155-24175. Millour, E., et al. (2018). The Mars "
            "Climate Database (version 5.3). Scientific Workshop: From Mars Express to ExoMars, ESAC Madrid.")
TERMS = ("Free for scientific use if the origin is quoted and the LMD team is kept informed; the web interface is "
         "intended for moderate use only.")
TIMEOUT_S = 90.0
ALTITUDE_M = 2.0

# MCD variable -> (our key, a piece of the name the MCD prints for it, unit)
VARIABLES: Dict[str, Tuple[str, str, str]] = {
    "tsurf": ("surface_temperature_k", "surface temperature", "K"),
    "t": ("air_temperature_2m_k", "temperature (k)", "K"),
    "ps": ("surface_pressure_pa", "surface pressure", "Pa"),
    "dod": ("dust_optical_depth_monthly", "monthly mean dust column", "visible optical depth (unitless)"),
    "fluxsurf_dn_sw": ("surface_solar_flux_down_w_m2", "solar flux on horizontal surface", "W/m2"),
    "tauref": ("dust_optical_depth_daily", "daily mean dust column", "visible optical depth (unitless)"),
}
THERMAL_VARS = ("tsurf", "t", "ps", "dod")
SOLAR_VARS = ("fluxsurf_dn_sw", "tauref")
# our scenario id -> (MCD dust code, seasons: "all" or a list of Ls)
SCENARIOS: Dict[str, Tuple[int, Any]] = {
    "climatology": (1, "all"),
    "cold": (8, "all"),
    "warm": (7, "all"),
    "dust_storm": (5, [180, 225, 270, 315]),
}
SCENARIO_NOTES = {
    "climatology": "typical year: dust as observed, averaged over Mars years 24-35",
    "cold": "clear year: the least dusty of the observed years (less dust: more sunlight, wider day-night swing)",
    "warm": "dusty year: the dustiest observed years without a global storm",
    "dust_storm": "global dust storm: the MCD holds the dust at optical depth 5 and only models it from Ls 180 to 360",
}

_NUM = r"[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?"


def _floats(text: str) -> List[float]:
    return [float(x) for x in re.findall(_NUM, text)]


def parse_mcd_text(text: str) -> List[Dict[str, Any]]:
    """Blocks of an MCD text download: name, scenario, latitude, longitude, ls, local_time_h and
    values[season][local time]. Handles both the year table (``ls=all``) and the one-season list."""
    blocks: List[Dict[str, Any]] = []
    header: List[str] = []
    rows: List[str] = []

    def flush() -> None:
        if not header and not rows:
            return
        blocks.append(_block(header, rows))

    in_header = False
    for line in text.splitlines():
        if line.startswith("#"):
            if not in_header and rows:
                flush()
                header, rows = [], []
            in_header = True
            header.append(line)
        elif line.strip():
            in_header = False
            rows.append(line)
    flush()
    if not blocks:
        raise ValueError("MCD text has no data blocks")
    return blocks


def _block(header: Sequence[str], rows: Sequence[str]) -> Dict[str, Any]:
    head = "\n".join(header)
    name = re.search(r"### Columns? 2\+? (?:are|is) (.+?)\s*$", head, re.M)
    point = re.search(rf"Latitude ({_NUM})N\. Longitude ({_NUM})E", head)
    scenario = re.search(r"### (MCD_v[\w.]+) with (.+?) scenario", head)
    if not (name and point):
        raise ValueError(f"MCD block header not understood: {head[:200]!r}")
    out: Dict[str, Any] = {"name": name.group(1).strip(), "latitude": float(point.group(1)),
                           "longitude": float(point.group(2)),
                           "model": scenario.group(1) if scenario else None,
                           "scenario": scenario.group(2) if scenario else ""}
    if any("||" in r for r in rows):  # year table: "---- || lt ...", then "+LLL || values"
        lt_row = next((r for r in rows if r.lstrip().startswith("----") and "||" in r), None)
        if lt_row is None:
            raise ValueError("MCD year table has no local-time row")
        out["local_time_h"] = _floats(lt_row.split("||", 1)[1])
        ls, values = [], []
        for r in rows:
            if r is lt_row or "||" not in r:
                continue
            key, vals = r.split("||", 1)
            ls.append(float(key.strip().lstrip("+")))
            values.append(_floats(vals))
        out["ls"], out["values"] = ls, values
    else:  # one season: "lt value" rows, season in the header
        season = re.search(rf"### Ls ({_NUM})deg", head)
        if season is None:
            raise ValueError("MCD one-season table has no Ls in its header")
        pairs = [_floats(r) for r in rows]
        if any(len(p) != 2 for p in pairs):
            raise ValueError("MCD one-season table rows must be 'local time, value'")
        out["ls"] = [float(season.group(1))]
        out["local_time_h"] = [p[0] for p in pairs]
        out["values"] = [[p[1] for p in pairs]]
    width = len(out["local_time_h"])
    if not out["values"] or any(len(v) != width for v in out["values"]):
        raise ValueError(f"MCD table for {out['name']!r} has rows of the wrong length")
    return out


def txt_url(html: str) -> str:
    """The text-download link in an MCD results page; ValueError (with the page's own message) if there is none."""
    m = re.search(r"""href=['"]\.\./txt/([0-9a-f]+)\.txt['"]""", html)
    if not m:
        msg = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
        raise ValueError(f"MCD page has no data link: {msg[:200]!r}")
    return f"{TXT_BASE}{m.group(1)}.txt"


def check_point(blocks: Sequence[Dict[str, Any]], lat: float, lon: float, tol: float = 0.01) -> None:
    """Raise if any block is for another place (the CGI returns an old test file when a parameter is missing)."""
    for b in blocks:
        if abs(b["latitude"] - lat) > tol or abs(b["longitude"] - lon) > tol:
            raise ValueError(f"MCD returned {b['latitude']}N {b['longitude']}E, not the requested point {lat}N {lon}E")


def query(variables: Sequence[str], dust: int, ls: Any, lat: float, lon: float) -> Dict[str, Any]:
    q: Dict[str, Any] = {f"var{i + 1}": v for i, v in enumerate(variables)}
    q.update(datekeyhtml=1, ls=ls, localtime="all", latitude=lat, longitude=lon, altitude=ALTITUDE_M, zkey=3,
             isfixedlt="off", dust=dust, hrkey=1, averaging="off",
             # Leaving any of these out makes the CGI return a stale test file instead of our point.
             dpi=80, islog="off", colorm="jet", proj="cyl", iswind="off")
    return q


def _fetch(ctx: StepContext, variables: Sequence[str], dust: int, ls: Any, lat: float, lon: float):
    page = ctx.fetcher.get_bytes(build_url(CGI_URL, query(variables, dust, ls, lat, lon)), 1 << 20,
                                 timeout_s=TIMEOUT_S).body.decode("utf-8", "replace")
    link = txt_url(page)
    text = ctx.fetcher.get_bytes(link, 4 << 20, timeout_s=TIMEOUT_S).body.decode("utf-8", "replace")
    blocks = parse_mcd_text(text)
    check_point(blocks, lat, lon)
    if len(blocks) != len(variables):
        raise ValueError(f"MCD returned {len(blocks)} tables for {len(variables)} variables")
    for v, b in zip(variables, blocks):
        if VARIABLES[v][1] not in b["name"].lower():
            raise ValueError(f"MCD table {b['name']!r} is not {v}")
        if ls != "all" and b["ls"] != [float(ls)]:
            raise ValueError(f"MCD returned Ls {b['ls']} for Ls {ls}")
    return link, blocks


def _scenario_tables(ctx: StepContext, variables: Sequence[str], dust: int, seasons: Any, lat: float,
                     lon: float) -> Dict[str, Any]:
    calls = [("all", _fetch(ctx, variables, dust, "all", lat, lon))] if seasons == "all" else [
        (ls, _fetch(ctx, variables, dust, ls, lat, lon)) for ls in seasons]
    first = calls[0][1][1][0]
    out: Dict[str, Any] = {"mcd_scenario": first["scenario"], "model": first["model"], "dust_code": dust,
                           "local_time_h": first["local_time_h"], "ls": [], "data_urls": [c[1][0] for c in calls]}
    for v in variables:
        out[VARIABLES[v][0]] = []
    for _, (_, blocks) in calls:
        keep = [i for i, ls in enumerate(blocks[0]["ls"]) if ls < 360.0]  # Ls 360 repeats Ls 0
        out["ls"] += [blocks[0]["ls"][i] for i in keep]
        for v, b in zip(variables, blocks):
            if b["local_time_h"] != out["local_time_h"]:
                raise ValueError("MCD tables use different local times")
            out[VARIABLES[v][0]] += [b["values"][i] for i in keep]
    return out


def _range(rows: List[List[float]]) -> List[float]:
    flat = [x for r in rows for x in r]
    return [round(min(flat), 2), round(max(flat), 2)]


def _climate(ctx: StepContext) -> List[Dict[str, Any]]:
    lon, lat = (round(x, 2) for x in ctx.scenario.base)
    thermal: Dict[str, Any] = {}
    solar: Dict[str, Any] = {}
    for sid, (dust, seasons) in SCENARIOS.items():
        thermal[sid] = _scenario_tables(ctx, THERMAL_VARS, dust, seasons, lat, lon)
        solar[sid] = _scenario_tables(ctx, SOLAR_VARS, dust, seasons, lat, lon)
        solar[sid]["dust_optical_depth_monthly"] = thermal[sid]["dust_optical_depth_monthly"]
        thermal[sid]["note"] = solar[sid]["note"] = SCENARIO_NOTES[sid]
    model = thermal["climatology"]["model"]
    common = {"source": "Mars Climate Database web interface", "model": model, "credit": CREDIT,
              "point": {"lat": lat, "lon": lon, "altitude_above_ground_m": ALTITUDE_M,
                        "note": "the scenario's base point, rounded to 0.01 degree"},
              "layout": "each variable is values[i][j]: season ls[i] (degrees of solar longitude), "
                        "local time local_time_h[j] (Martian hours; 24 is the end of the sol)"}
    tpath = ctx.path("climate/mcd_gale_thermal.json")
    spath = ctx.path("climate/mcd_gale_solar.json")
    for path, names, tables in ((tpath, THERMAL_VARS, thermal), (spath, SOLAR_VARS + ("dod",), solar)):
        units = {VARIABLES[v][0]: VARIABLES[v][2] for v in names}
        atomic_write(path, json.dumps({**common, "units": units, "scenarios": tables},
                                      separators=(",", ":")).encode("utf-8"))
    tsum = {sid: {"surface_temperature_k": _range(s["surface_temperature_k"]),
                  "air_temperature_2m_k": _range(s["air_temperature_2m_k"]),
                  "surface_pressure_pa": _range(s["surface_pressure_pa"])} for sid, s in thermal.items()}
    ssum = {sid: {"surface_solar_flux_down_w_m2": _range(s["surface_solar_flux_down_w_m2"]),
                  "dust_optical_depth_daily": _range(s["dust_optical_depth_daily"])} for sid, s in solar.items()}
    source = {"name": f"Mars Climate Database ({model}), web interface, point {lat}N {lon}E, 2 m above the ground",
              "page_url": MCD_PAGE, "request_url": CGI_URL, "fetched_at": _now(), "credit": CREDIT,
              "license": TERMS, "citation": CITATION}
    model_note = ("computed by a global climate model (LMD Mars GCM) run with the dust observed by spacecraft; "
                  "interpolated to the point with high-resolution topography")
    common_limits = [
        "Model values for a typical year at one point, not measurements; the MCD is checked against spacecraft "
        "and lander data, but local slopes, shadows and rock or sand cover are not in it.",
        "Climate-model cells are a few hundred km across; the MCD adjusts pressure and temperature for the "
        "local height, but Gale's crater walls and winds are smoothed.",
        "The dust storm case only covers Ls 180-360 (the MCD has no storm runs for the rest of the year).",
    ]
    return [
        new_entry(
            "temperature_climate_mcd", "Typical temperatures by season and time of day (Mars Climate Database)",
            "Modelled ground-surface temperature, air temperature 2 m above the ground and air pressure at the "
            "base, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a "
            "dust-storm year.",
            ["thermal"], "climate", "model", "local",
            evidence_note=model_note, files=[file_record(tpath, ctx.data_root, "json")],
            coverage={"point": [lon, lat]}, resolution_m=None, smallest_feature_m=None,
            positional_accuracy="one point (the base), model cells of a few hundred km",
            uncertainty={"value": "a few K", "basis": "MCD validation against lander and orbiter temperatures; "
                                                      "larger at night and in dusty seasons"},
            observation_time={"note": "climatology of Mars years 24-35 (1998-2021)"},
            ranges=tsum,
            limitations=["No below-ground temperatures: the web interface gives none, so ground temperature "
                         "by depth (GI-07, TC-10) still needs thermal inertia and a heat model."] + common_limits,
            tags=["temperature", "air temperature", "surface temperature", "pressure", "climate", "model", "mcd",
                  "season", "day night", "dust storm"],
            source=source,
        ),
        new_entry(
            "dust_climate_mcd", "Typical dust in the air and sunlight on the ground by season (Mars Climate Database)",
            "Modelled dust in the air above the base (visible optical depth) and the sunlight reaching the ground, "
            "for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm "
            "year.",
            ["solar"], "climate", "model", "local",
            evidence_note=model_note, files=[file_record(spath, ctx.data_root, "json")],
            coverage={"point": [lon, lat]}, resolution_m=None, smallest_feature_m=None,
            positional_accuracy="one point (the base), model cells of a few hundred km",
            uncertainty={"value": "unknown", "basis": "the dust follows the observed dust record; year-to-year "
                                                      "spread is shown by the cold, warm and storm cases"},
            observation_time={"note": "dust scenarios built from Mars years 24-35 (1998-2021)"},
            ranges=ssum,
            limitations=["Sunlight is on flat ground with an open sky: the skyline and panel tilt are not "
                         "included (use the sun tables for those).",
                         "Dust optical depth is for visible light, as a model typical of each season; measured "
                         "dust by date is a separate dataset."] + common_limits,
            tags=["dust", "optical depth", "tau", "sunlight", "solar flux", "irradiance", "climate", "model", "mcd",
                  "season", "dust storm"],
            source=source,
        ),
    ]


climate_step = Step("climate", ("temperature_climate_mcd", "dust_climate_mcd"), _climate,
                    inputs=lambda ctx: {"base": [round(x, 2) for x in ctx.scenario.base],
                                        "scenarios": {k: [d, s] for k, (d, s) in SCENARIOS.items()},
                                        "vars": [list(THERMAL_VARS), list(SOLAR_VARS)], "altitude_m": ALTITUDE_M})

__all__ = ["CGI_URL", "check_point", "climate_step", "parse_mcd_text", "query", "txt_url"]
