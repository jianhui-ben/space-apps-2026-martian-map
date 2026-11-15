"""Curiosity's daily weather (REMS) from NASA's public weather feed."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..catalog import file_record, new_entry
from ..http import FetchError, atomic_write
from ..snapshot import Step, StepContext, _now

REMS_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json"
PAGE = "https://mars.nasa.gov/msl/weather/"


def _num(value: Any) -> Optional[int]:
    if value is None:
        return None
    s = str(value).strip()
    if s in ("", "--"):
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _text(value: Any) -> Optional[str]:
    s = str(value).strip() if value is not None else ""
    return None if s in ("", "--") else s


def trim_rems_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "sol": _num(row.get("sol")),
        "date": _text(row.get("terrestrial_date")),
        "ls": _num(row.get("ls")),
        "air_min_c": _num(row.get("min_temp")),
        "air_max_c": _num(row.get("max_temp")),
        "ground_min_c": _num(row.get("min_gts_temp")),
        "ground_max_c": _num(row.get("max_gts_temp")),
        "pressure_pa": _num(row.get("pressure")),
        "sunrise": _text(row.get("sunrise")),
        "sunset": _text(row.get("sunset")),
        "uv_index": _text(row.get("local_uv_irradiance_index")),
        "sky": _text(row.get("atmo_opacity")),
    }


def _weather(ctx: StepContext) -> List[Dict[str, Any]]:
    raw = ctx.fetcher.get_bytes(REMS_URL, 20 * 2**20).body
    try:
        data = json.loads(raw.decode("utf-8"))
        soles = data["soles"]
    except (UnicodeDecodeError, ValueError, KeyError, TypeError) as exc:
        raise FetchError(f"{REMS_URL}: unexpected weather feed format ({exc})") from exc
    rows = sorted((trim_rems_row(r) for r in soles), key=lambda r: (r["sol"] is None, r["sol"]))
    rows = [r for r in rows if r["sol"] is not None]
    if not rows:
        raise FetchError(f"{REMS_URL}: no weather rows")
    raw_path = ctx.path("weather/rems_raw.json")
    atomic_write(raw_path, raw)
    trimmed = ctx.path("weather/rems.json")
    atomic_write(trimmed, json.dumps(rows, separators=(",", ":")).encode("utf-8"))
    first, last = rows[0], rows[-1]
    return [new_entry(
        "weather_rems", "Curiosity's daily weather (REMS)",
        "Daily air and ground temperature, air pressure, UV level and sunrise/sunset measured by Curiosity, by season.",
        ["thermal", "solar"], "weather", "observation", "local",
        files=[file_record(trimmed, ctx.data_root, "json", rows=len(rows), role="trimmed"),
               file_record(raw_path, ctx.data_root, "json", role="raw")],
        ground_validated={"value": True, "note": "measured on the surface by Curiosity's weather station"},
        observation_time={"sols": [first["sol"], last["sol"]], "dates": [first["date"], last["date"]],
                          "ls_note": "per-row ls field (season, degrees)"},
        resolution_m=None,
        limitations=[
            "Measured at Curiosity's position on each day, not at candidate sites.",
            'Wind and humidity are missing ("--") in this feed.',
            'Sky note ("Sunny") is a label, not a dust measurement.',
        ],
        tags=["weather", "temperature", "pressure", "uv", "rems", "sunrise", "sunset"],
        source={"name": "NASA Mars Science Laboratory REMS weather feed", "page_url": PAGE, "request_url": REMS_URL,
                "fetched_at": _now(), "as_of": f"sol {last['sol']} ({last['date']})",
                "credit": "NASA/JPL-Caltech/CAB (CSIC-INTA)",
                "license": "NASA media are generally not subject to US copyright; credit NASA/JPL-Caltech/CAB."},
    )]


weather_step = Step("weather", ("weather_rems",), _weather)

__all__ = ["REMS_URL", "trim_rems_row", "weather_step"]
