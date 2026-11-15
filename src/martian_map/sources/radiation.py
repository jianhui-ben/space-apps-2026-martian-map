"""Radiation dose on the ground at Gale, measured by Curiosity's Radiation Assessment Detector (RAD).

The RAD archive in NASA's Planetary Data System (PPI node) has one text file per
sol (about 65 MB, every ~16-minute observation with counters, spectra and dose)
and a label that says where each value sits in the file. We sample one sol every
``EVERY_SOLS`` sols across the mission, read the label, and fetch only the dose
values and observation headers with HTTP multi-range requests (a few kB per sol
instead of 65 MB). For each sampled sol we keep the duration-weighted mean dose
rate of the observations that passed quality control (QC = 0), in silicon
(detector B) and in plastic (detector E, closer to human tissue).
"""

from __future__ import annotations

import csv
import io
import json
import re
import statistics
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..catalog import file_record, new_entry
from ..http import FetchError, atomic_write
from ..snapshot import Step, StepContext, _now

BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0"
INDEX_URL = BASE + "/INDEX/INDEX.TAB"
PAGE = "https://pds-ppi.igpp.ucla.edu/search/view/?f=yes&id=pds://PPI/MSL-M-RAD-3-RDR-V1.0"
EVERY_SOLS = 100
MAX_RANGES = 100  # per request
HEADER_BYTES = 700  # the observation header sits just before its first counter table
CITATION = ("Peterson, J., Rafkin, S., Zeitlin, C., Ehresmann, B., Weigle, G., Jeffers, S., and Hassler, D. (2013). "
            "MSL Mars Radiation Assessment Detector RDR V1.0, MSL-M-RAD-3-RDR-V1.0, NASA Planetary Data System. "
            "Hassler, D. M., et al. (2014). Mars' surface radiation environment measured with the Mars Science "
            "Laboratory's Curiosity rover. Science, 343(6169), 1244797.")

_PRODUCT = re.compile(r"RAD_RDR_(\d{4})_(\d{3})_(\d\d)_(\d\d)_(\d{4})_V(\d\d)$")
_PTR = re.compile(r'\^OBS(\d{3})_(L1_TABLE|TOT_DOSE_B_ELEMENT|TOT_DOSE_E_ELEMENT)\s*=\s*\(\s*"([^"]+)"\s*,\s*(\d+)\s*'
                  r"<BYTES>\s*\)")
_FLOAT = re.compile(r"[-+]?\d+\.\d*(?:[eE][-+]?\d+)?|[-+]?\d+(?:[eE][-+]?\d+)?")


def pick_sols(index_text: str, every: int = EVERY_SOLS) -> List[Dict[str, Any]]:
    """One product per ``every`` sols: the first sol at or after each multiple of ``every`` that has exactly one
    product (sols split into several files are skipped)."""
    by_sol: Dict[int, List[Dict[str, Any]]] = {}
    for row in csv.reader(io.StringIO(index_text)):
        if len(row) < 7:
            continue
        pid = row[2].strip().strip('"')
        m = _PRODUCT.match(pid)
        if not m:  # header row, or cruise products (C010 ...)
            continue
        by_sol.setdefault(int(m.group(5)), []).append(
            {"sol": int(m.group(5)), "product_id": pid, "path": row[1].strip().strip('"'), "start": row[6].strip()})
    singles = sorted(s for s, ps in by_sol.items() if len(ps) == 1)
    out = []
    if not singles:
        return out
    for t in range(0, singles[-1] + 1, every):
        s = next((x for x in singles if t <= x < t + every), None)
        if s is not None:
            out.append(by_sol[s][0])
    return out


def parse_label(text: str) -> Dict[str, Any]:
    obs: Dict[int, Dict[str, int]] = {}
    names = set()
    for num, kind, name, off in _PTR.findall(text):
        names.add(name)
        key = {"L1_TABLE": "l1", "TOT_DOSE_B_ELEMENT": "dose_b", "TOT_DOSE_E_ELEMENT": "dose_e"}[kind]
        obs.setdefault(int(num), {"obs": int(num)})[key] = int(off)
    units = set(re.findall(r'UNIT\s*=\s*"(microGray / Hour)"', text))
    complete = [o for _, o in sorted(obs.items()) if {"l1", "dose_b", "dose_e"} <= set(o)]
    if not complete:
        raise ValueError("RAD label has no observations with L1 counters and both total doses")
    if len(names) != 1:
        raise ValueError(f"RAD label points into {len(names)} files; expected one")
    return {"txt_name": names.pop(), "observations": complete, "unit": units.pop() if units else None}


def parse_obs_header(text: str) -> Dict[str, Any]:
    """The last [OBSERVATION: nn] block in ``text``: obs, start_utc, duration_s, qc."""
    blocks = list(re.finditer(r"\[OBSERVATION:\s*(\d+)\]", text))
    if not blocks:
        raise ValueError("no [OBSERVATION] block before the counter table")
    body = text[blocks[-1].end():]

    def field(name: str, required: bool = True) -> Optional[str]:
        m = re.search(rf"^{name}=(.*?)\s*$", body, re.M)
        if not m:
            if required:
                raise ValueError(f"observation header has no {name}")
            return None
        return m.group(1).strip().strip('"')

    duration = field("OBS_DURATION", required=False)  # missing in the 2012-2014 software version
    return {"obs": int(blocks[-1].group(1)), "start_utc": field("START_OBS_UTC"),
            "duration_s": int(duration) if duration is not None else None, "qc": field("QC")}


def split_multipart(body: bytes, content_type: str) -> Dict[int, bytes]:
    """{start offset: bytes} for each part of a multipart/byteranges response."""
    m = re.search(r"multipart/byteranges;\s*boundary=\"?([^\";]+)\"?", content_type or "", re.I)
    if not m:
        raise ValueError(f"expected a multipart/byteranges response, got {content_type!r}")
    sep = b"--" + m.group(1).encode()
    parts: Dict[int, bytes] = {}
    for chunk in body.split(sep)[1:]:
        if chunk.startswith(b"--"):
            break
        head, _, data = chunk.partition(b"\r\n\r\n")
        cr = re.search(rb"Content-range:\s*bytes\s+(\d+)-(\d+)/", head, re.I)
        if not cr:
            raise ValueError("multipart part has no Content-range")
        a, b = int(cr.group(1)), int(cr.group(2))
        parts[a] = data[:b - a + 1]
    return parts


def _slice(parts: Dict[int, bytes], a: int, b: int) -> bytes:
    """Bytes a..b from whichever part holds them (servers may merge nearby ranges)."""
    for start, data in parts.items():
        if start <= a and b < start + len(data):
            return data[a - start:b - start + 1]
    raise ValueError(f"the server did not return bytes {a}-{b}")


def _ranges(ctx: StepContext, url: str, ranges: Sequence[Tuple[int, int]]) -> Dict[int, bytes]:
    parts: Dict[int, bytes] = {}
    for i in range(0, len(ranges), MAX_RANGES):
        batch = ranges[i:i + MAX_RANGES]
        spec = ",".join(f"{a}-{b}" for a, b in batch)
        res = ctx.fetcher.get_bytes(url, sum(b - a + 1 for a, b in batch) + 400 * len(batch) + 4096,
                                    headers={"Range": f"bytes={spec}"}, ok_status=(206,), timeout_s=60)
        if len(batch) == 1:
            parts[batch[0][0]] = res.body
        else:
            parts.update(split_multipart(res.body, res.content_type_full))
    return parts


def _first_float(data: bytes) -> float:
    m = _FLOAT.search(data.decode("latin-1"))
    if not m:
        raise ValueError(f"no number in {data[:40]!r}")
    return float(m.group(0))


def _sol_dose(ctx: StepContext, product: Dict[str, Any]) -> Dict[str, Any]:
    lbl_url = BASE + product["path"]
    label = parse_label(ctx.fetcher.get_bytes(lbl_url, 4 << 20, timeout_s=90).body.decode("latin-1"))
    if label["unit"] != "microGray / Hour":
        raise ValueError(f"RAD dose unit is {label['unit']!r}, expected microGray / Hour")
    txt_url = lbl_url.rsplit("/", 1)[0] + "/" + label["txt_name"]
    want: List[Tuple[int, int]] = []
    for o in label["observations"]:  # label offsets are 1-based
        want.append((max(0, o["l1"] - 1 - HEADER_BYTES), o["l1"] - 2))
        want.append((o["dose_b"] - 1, o["dose_b"] + 9))
        want.append((o["dose_e"] - 1, o["dose_e"] + 9))
    parts = _ranges(ctx, txt_url, want)
    rows = []
    for o in label["observations"]:
        head = parse_obs_header(_slice(parts, max(0, o["l1"] - 1 - HEADER_BYTES), o["l1"] - 2).decode("latin-1"))
        if head["obs"] != o["obs"]:
            raise ValueError(f"sol {product['sol']}: header for observation {head['obs']}, expected {o['obs']}")
        rows.append({**head, "dose_b": _first_float(_slice(parts, o["dose_b"] - 1, o["dose_b"] + 9)),
                     "dose_e": _first_float(_slice(parts, o["dose_e"] - 1, o["dose_e"] + 9))})
    ok = [r for r in rows if set(r["qc"]) == {"0"} and (r["duration_s"] is None or r["duration_s"] > 0)]
    timed = bool(ok) and all(r["duration_s"] is not None for r in ok)
    weight = {id(r): (r["duration_s"] if timed else 1) for r in ok}
    total = sum(weight.values())

    def daily(key: str):
        return round(sum(r[key] * weight[id(r)] for r in ok) / total * 24, 2) if total else None

    return {"sol": product["sol"], "product_id": product["product_id"], "start_utc": product["start"],
            "observations": len(rows), "qc_ok": len(ok),
            "hours_covered": round(total / 3600, 2) if timed else None,
            "weighting": "duration" if timed else "equal",
            "dose_b_ugy_per_day": daily("dose_b"), "dose_e_ugy_per_day": daily("dose_e")}


def _radiation(ctx: StepContext) -> List[Dict[str, Any]]:
    index = ctx.fetcher.get_bytes(INDEX_URL, 4 << 20, timeout_s=90).body.decode("latin-1")
    products = pick_sols(index, EVERY_SOLS)
    if not products:
        raise ValueError("RAD index lists no surface sols")
    sols = []
    for p in products:
        try:
            sols.append(_sol_dose(ctx, p))
        except (FetchError, ValueError) as exc:  # one bad sol should not lose the rest
            ctx.warnings.append(f"radiation sol {p['sol']}: {exc}")
            ctx.log(f"radiation: sol {p['sol']} skipped: {exc}")
    good = [s for s in sols if s["dose_e_ugy_per_day"] is not None]
    if not good:
        raise ValueError("no sampled RAD sol had quality-controlled dose values")
    path = ctx.path("radiation/rad_daily_dose.json")
    atomic_write(path, json.dumps({
        "what": "daily dose rate on the ground at Gale from Curiosity RAD, one sampled sol every %d sols" % EVERY_SOLS,
        "fields": {"dose_b_ugy_per_day": "absorbed dose in silicon (detector B), microgray per Earth day",
                   "dose_e_ugy_per_day": "absorbed dose in plastic (detector E, tissue-like), microgray per Earth day",
                   "qc_ok": "observations with QC = 0 used in the mean (weighted by duration)",
                   "hours_covered": "hours of QC = 0 observations in the sol (null when durations are missing)",
                   "weighting": "duration-weighted mean, or equal weights for early files without OBS_DURATION"},
        "source": {"dataset": "MSL-M-RAD-3-RDR-V1.0", "index_url": INDEX_URL, "citation": CITATION},
        "sols": sols}, indent=None, separators=(",", ":")).encode("utf-8"))
    e_vals = [s["dose_e_ugy_per_day"] for s in good]
    return [new_entry(
        "radiation_rad", "Radiation dose on the ground at Gale (Curiosity RAD, sampled across the mission)",
        "How much radiation reached the ground at Gale each day, measured by Curiosity's RAD instrument: one sol "
        f"every {EVERY_SOLS} sols from {good[0]['sol']} to {good[-1]['sol']}, in microgray per day.",
        ["routes"], "radiation", "observation", "local",
        evidence_note="measured on the surface by Curiosity's Radiation Assessment Detector",
        files=[file_record(path, ctx.data_root, "json")],
        coverage={"point": [137.4, -4.7], "note": "where Curiosity was on each sol"},
        uncertainty={"value": "a few percent", "basis": "RAD dosimetry calibration (Hassler et al. 2014); the "
                                                        "sampled sols also miss short solar storms"},
        observation_time={"sols": [s["sol"] for s in good], "first_utc": good[0]["start_utc"],
                          "last_utc": good[-1]["start_utc"]},
        ranges={"dose_e_ugy_per_day": {"min": min(e_vals), "median": round(statistics.median(e_vals), 1),
                                       "max": max(e_vals)}},
        limitations=[
            "Absorbed dose only: no dose equivalent (the biological weighting), which needs RAD's particle "
            "spectra and published quality factors (about 3 to 4 times the absorbed dose; Hassler et al. 2014).",
            f"One sol every {EVERY_SOLS} sols: short solar particle events lasting a few days are mostly missed; see "
            "space_weather_donki for when they happened.",
            "The dose under the rover's body and at Curiosity's location, not at the base; it changes a little with "
            "air pressure (season and altitude) and strongly with the 11-year solar cycle.",
            "Rover position fields in the archive are empty (0), so locations come from the rover path.",
        ],
        tags=["radiation", "dose", "rad", "curiosity", "cosmic rays", "solar particle", "measured", "safety"],
        sampled_sols=len(products), skipped_sols=len(products) - len(good),
        source={"name": "MSL Radiation Assessment Detector RDR (MSL-M-RAD-3-RDR-V1.0), NASA PDS PPI node",
                "page_url": PAGE, "request_url": INDEX_URL, "fetched_at": _now(),
                "credit": "NASA/JPL-Caltech/SwRI (RAD)", "license": "NASA PDS data; generally not subject to US "
                                                                    "copyright", "citation": CITATION},
    )]


radiation_step = Step("radiation", ("radiation_rad",), _radiation,
                      inputs=lambda ctx: {"every_sols": EVERY_SOLS, "index": INDEX_URL})

__all__ = ["BASE", "INDEX_URL", "parse_label", "parse_obs_header", "pick_sols", "radiation_step", "split_multipart"]
