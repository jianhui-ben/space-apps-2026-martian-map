"""Solar particle storms since Curiosity landed, from NASA's DONKI space-weather database (CCMC).

DONKI lists solar energetic particle (SEP) events seen by spacecraft near Earth
(GOES, SOHO) and by STEREO. The web service answers at most 60 days per request,
so we walk from Curiosity's landing (2012-08-06) to today in 60-day windows.
These are events in the inner solar system, not measurements at Mars: use them to
see when a storm could have reached Gale and to pick dates to look up in the RAD
record (``radiation_rad``).
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Dict, List, Tuple

from ..catalog import file_record, new_entry
from ..http import atomic_write, build_url
from ..snapshot import Step, StepContext, _now

SEP_URL = "https://ccmc.gsfc.nasa.gov/DONKI/WS/get/SEP"
PAGE = "https://ccmc.gsfc.nasa.gov/tools/DONKI/"
START = date(2012, 8, 6)  # Curiosity landed
WINDOW_DAYS = 60


def _today() -> date:
    return date.today()


def windows(start: date, end: date, days: int = WINDOW_DAYS) -> List[Tuple[date, date]]:
    """Back-to-back [start, end] date windows of at most ``days`` days (both ends included)."""
    out, a = [], start
    while a <= end:
        b = min(a + timedelta(days=days - 1), end)
        out.append((a, b))
        a = b + timedelta(days=1)
    return out


def _space_weather(ctx: StepContext) -> List[Dict[str, Any]]:
    end = _today()
    seen: Dict[str, Dict[str, Any]] = {}
    for a, b in windows(START, end):
        body = ctx.fetcher.get_bytes(build_url(SEP_URL, {"startDate": a.isoformat(), "endDate": b.isoformat()}),
                                     4 << 20, timeout_s=60).body
        for ev in (json.loads(body) if body.strip() else []):
            seen.setdefault(ev["sepID"], {
                "sepID": ev["sepID"], "eventTime": ev.get("eventTime"),
                "instruments": [i.get("displayName") for i in ev.get("instruments") or []],
                "linkedEvents": [x.get("activityID") for x in ev.get("linkedEvents") or []],
                "link": ev.get("link")})
    events = sorted(seen.values(), key=lambda e: e["eventTime"] or "")
    by_year: Dict[str, Dict[str, int]] = {}
    for e in events:
        y = by_year.setdefault((e["eventTime"] or "????")[:4], {"events": 0, "above_100_mev": 0})
        y["events"] += 1
        y["above_100_mev"] += any(">100 MeV" in (i or "") for i in e["instruments"])
    path = ctx.path("radiation/donki_sep_events.json")
    atomic_write(path, json.dumps({
        "what": "solar energetic particle events in NASA DONKI, from Curiosity's landing to the fetch date",
        "span": [START.isoformat(), end.isoformat()], "by_year": by_year, "events": events,
        "source": {"service": SEP_URL, "page_url": PAGE}}, separators=(",", ":")).encode("utf-8"))
    return [new_entry(
        "space_weather_donki", "Solar particle storms since 2012 (NASA DONKI)",
        "Every solar particle storm NASA's space-weather database recorded from Curiosity's landing to today, "
        "with the spacecraft that saw it, to find the dates when radiation at Gale could have jumped.",
        ["routes"], "radiation", "observation", "local",
        evidence_note="events detected by spacecraft near Earth and by STEREO, catalogued by NASA CCMC forecasters",
        files=[file_record(path, ctx.data_root, "json")],
        observation_time={"start": START.isoformat(), "end": end.isoformat()},
        ranges={"events": len(events), "above_100_mev": sum(y["above_100_mev"] for y in by_year.values())},
        limitations=[
            "Seen near Earth or by STEREO, not at Mars: Mars is often far round the Sun from Earth, so an event "
            "listed here may never have reached Gale, and some that did are missing.",
            "A list of events, not doses: the dose at Gale is in radiation_rad (sampled) and in published RAD "
            "event studies (for example the 2017-09-10 storm).",
        ],
        tags=["radiation", "space weather", "solar storm", "solar particle event", "sep", "donki", "sun"],
        source={"name": "NASA CCMC Space Weather Database Of Notifications, Knowledge, Information (DONKI), SEP "
                        "events", "page_url": PAGE, "request_url": SEP_URL, "fetched_at": _now(),
                "credit": "NASA Community Coordinated Modeling Center (CCMC), Goddard Space Flight Center",
                "license": "NASA data; generally not subject to US copyright"},
    )]


space_weather_step = Step("space_weather", ("space_weather_donki",), _space_weather,
                          inputs=lambda ctx: {"start": START.isoformat(), "service": SEP_URL})

__all__ = ["SEP_URL", "START", "space_weather_step", "windows"]
