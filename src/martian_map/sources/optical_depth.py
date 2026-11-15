"""Measured dust in the air over Gale: Curiosity's own records.

* ``optical_depth_history``: how much of the Sun's light the whole column of air
  blocks (optical depth, tau), measured by pointing Curiosity's Mastcam at the Sun,
  at 880 nm and 440 nm, from sol 33 (2012) to sol 3953 (2023), Mars years 31-37,
  with an uncertainty for each value. Published by Lemmon et al. (2024) on
  Mendeley Data (CC BY 4.0); we check every file against the archive's SHA-256.
* ``dust_extinction_navcam``: how hazy the air near the ground is (line-of-sight
  extinction across the crater, per km), from Navcam images, in NASA's Planetary
  Data System (Atmospheres Node; Moores and Dong 2024).

Tau counts dust and water-ice cloud together and is for the crater floor at
Curiosity, not exactly the base; it is the measured record that the climate
model's dust cases (``dust_climate_mcd``) can be checked against.
"""

from __future__ import annotations

import hashlib
import json
import re
import statistics
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlsplit

from ..catalog import file_record, new_entry
from ..http import FetchError, atomic_write
from ..snapshot import Step, StepContext, _now

MENDELEY_ID = "tbh3pg39xc"
MENDELEY_API = f"https://data.mendeley.com/public-api/datasets/{MENDELEY_ID}"
MENDELEY_PAGE = f"https://data.mendeley.com/datasets/{MENDELEY_ID}"
MENDELEY_S3_HOST = "prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com"
NAVCAM_BASE = "https://atmos.nmsu.edu/PDS/data/PDS4/msl_ice-dust/data_derived/"
NAVCAM_LABEL_URL = NAVCAM_BASE + "line_of_sight.xml"
NAVCAM_CSV_URL = NAVCAM_BASE + "line_of_sight.csv"
NAVCAM_PAGE = "https://atmos.nmsu.edu/PDS/data/PDS4/msl_ice-dust/"
LEMMON_CITATION = ("Lemmon, M. T., et al. (2024). The Mars Science Laboratory record of optical depth measurements "
                   "via solar imaging. Icarus, 408, 115821. https://doi.org/10.1016/j.icarus.2023.115821. Data: "
                   "Lemmon, M. (2024). Mars Science Laboratory aerosol optical depths, Mendeley Data, V3. "
                   "https://doi.org/10.17632/tbh3pg39xc.3")
NAVCAM_CITATION = ("Moores, J., and Dong, E. (2024). Mars Science Laboratory Atmospheric Ice and Dust Bundle. NASA "
                   "Planetary Data System. https://doi.org/10.17189/aytb-wq72")
CAMERA = {880: "ML", 440: "MR"}  # Mastcam left (880 nm filter) and right (440 nm filter)
SOLS_PER_MARS_YEAR = 668.6
MY31_LS0_SOL = -280.0  # about when Mars year 31 began, in Curiosity sols (landing: sol 0, Ls 150.7)
NAVCAM_FIELDS = ["Sol", "Ls", "MY", "LTST", "Extinction", "Error"]


def mars_years(rows: Sequence[Dict[str, Any]]) -> List[int]:
    """Mars year (Clancy et al. numbering) of each row from its sol and Ls. The linear Ls-to-sol estimate is
    off by at most a few tens of sols, far less than the half year that would change the answer."""
    return [31 + round((r["sol"] - (MY31_LS0_SOL + r["ls"] / 360.0 * SOLS_PER_MARS_YEAR)) / SOLS_PER_MARS_YEAR)
            for r in rows]


def _num(text: str) -> Optional[float]:
    text = text.strip()
    if not text or set(text) == {"*"}:  # "******" = the value overflowed its column
        return None
    v = float(text)
    return None if v == -1 else v


def parse_mastcam_tau(text: str, wavelength_nm: int) -> Dict[str, Any]:
    """Rows of a Lemmon Mastcam tau file: product_id, sol, ltst_h, ls, my, tau, sigma (None where missing)."""
    lines = text.replace("\r\n", "\n").split("\n")
    head = next((i for i, ln in enumerate(lines) if ln.replace(" ", "").startswith("Product_ID,Sol,L_s,tau,sigma")),
                None)
    if head is None:
        raise ValueError("Mastcam tau file has no 'Product_ID, Sol, L_s, tau, sigma' header")
    declared = re.search(r"Lines of data in this table:\s*(\d+)", "\n".join(lines[:head]))
    rows = []
    for ln in lines[head + 1:]:
        if not ln.strip():
            continue
        parts = ln.split(",")
        if len(parts) != 5:
            raise ValueError(f"Mastcam tau row has {len(parts)} columns: {ln[:60]!r}")
        pid = parts[0].strip()
        if pid[4:6] != CAMERA[wavelength_nm]:
            raise ValueError(f"{pid}: camera {pid[4:6]} does not match {wavelength_nm} nm ({CAMERA[wavelength_nm]})")
        sol = float(parts[1])
        rows.append({"product_id": pid, "sol": sol, "ltst_h": round((sol % 1) * 24, 3), "ls": float(parts[2]),
                     "tau": _num(parts[3]), "sigma": _num(parts[4])})
    if declared and int(declared.group(1)) != len(rows):
        raise ValueError(f"Mastcam tau file has {len(rows)} rows; its header says {declared.group(1)}")
    for r, my in zip(rows, mars_years(rows)):
        r["my"] = my
    return {"wavelength_nm": wavelength_nm, "header": [ln.strip() for ln in lines[:head]], "rows": rows}


def seasonal_summary(rows: Sequence[Dict[str, Any]], bin_deg: int = 30, key: str = "tau") -> List[Dict[str, Any]]:
    out = []
    for lo in range(0, 360, bin_deg):
        vals = sorted(r[key] for r in rows if r.get(key) is not None and lo <= r["ls"] < lo + bin_deg)
        out.append({"ls_from": lo, "ls_to": lo + bin_deg, "n": len(vals),
                    "median": round(statistics.median(vals), 3) if vals else None,
                    "p90": vals[min(len(vals) - 1, int(0.9 * len(vals)))] if vals else None,
                    "max": vals[-1] if vals else None})
    return out


def parse_navcam_los(label: str, csv_text: str) -> List[Dict[str, Any]]:
    """Navcam line-of-sight extinction rows; 999 = saturated and -999 = invalid (per the PDS4 label)."""
    names = re.findall(r"<Field_Delimited>\s*<name>([^<]+)</name>", label)
    if names != NAVCAM_FIELDS:
        raise ValueError(f"Navcam table fields {names}; expected {NAVCAM_FIELDS}")
    records = re.search(r"<records>(\d+)</records>", label)
    lines = [ln for ln in csv_text.replace("\r\n", "\n").split("\n") if ln.strip()]
    if not records or int(records.group(1)) != len(lines):
        raise ValueError(f"Navcam table has {len(lines)} rows; its label says {records and records.group(1)} records")
    rows = []
    for ln in lines:
        sol, ls, my, ltst, ext, err = (p.strip() for p in ln.split(","))
        e, s = float(ext), float(err)
        flag = "saturated" if e == 999 else "invalid" if e == -999 else None
        rows.append({"sol": int(sol), "ls": float(ls), "my": int(my), "ltst_h": float(ltst),
                     "extinction_per_km": None if flag else e, "error_per_km": None if flag or s == -999 else s,
                     "flag": flag})
    return rows


def _newest_file(meta: Dict[str, Any], wavelength_nm: int) -> Dict[str, Any]:
    pat = re.compile(rf"msl-tau-{wavelength_nm}-arch-(\d+)\.txt")
    found = [(int(m.group(1)), f) for f in meta.get("files", []) for m in [pat.fullmatch(f.get("filename", ""))] if m]
    if not found:
        raise ValueError(f"Mendeley dataset {MENDELEY_ID} has no msl-tau-{wavelength_nm}-arch-<sol>.txt file")
    return max(found, key=lambda x: x[0])[1]


def _download(ctx: StepContext, f: Dict[str, Any]) -> Tuple[bytes, str]:
    details = f["content_details"]
    first = ctx.fetcher.get_bytes(details["download_url"], 64 << 10, ok_status=(200, 302))
    body, url = first.body, details["download_url"]
    if first.status == 302:
        url = first.location
        if urlsplit(url).hostname != MENDELEY_S3_HOST:
            raise FetchError(f"Mendeley sent the download to an unexpected host: {urlsplit(url).hostname}")
        body = ctx.fetcher.get_bytes(url, 4 << 20).body
    digest = hashlib.sha256(body).hexdigest()
    if digest != details["sha256_hash"]:
        raise ValueError(f"{f['filename']}: sha256 {digest} does not match the archive's {details['sha256_hash']}")
    return body, url


def _optical_depth(ctx: StepContext) -> List[Dict[str, Any]]:
    meta = json.loads(ctx.fetcher.get_bytes(MENDELEY_API, 1 << 20).body)
    doi = (meta.get("doi") or {}).get("id") or f"10.17632/{MENDELEY_ID}"
    series: Dict[str, Any] = {}
    raw_files = []
    for wl in (880, 440):
        f = _newest_file(meta, wl)
        body, url = _download(ctx, f)
        raw = ctx.path(f"climate/{f['filename']}")
        atomic_write(raw, body)
        raw_files.append(file_record(raw, ctx.data_root, "text"))
        parsed = parse_mastcam_tau(body.decode("ascii", "replace"), wl)
        series[str(wl)] = {"file": f["filename"], "sha256": f["content_details"]["sha256_hash"],
                           "rows": parsed["rows"], "by_season": seasonal_summary(parsed["rows"])}
    rows880 = series["880"]["rows"]
    taus = sorted(r["tau"] for r in rows880 if r["tau"] is not None)
    peak = max((r for r in rows880 if r["tau"] is not None), key=lambda r: r["tau"])
    jpath = ctx.path("climate/mastcam_tau.json")
    atomic_write(jpath, json.dumps({
        "what": "column aerosol (dust + water ice) optical depth over Curiosity, from Mastcam solar images",
        "fields": {"sol": "Curiosity sol with a fraction for the time of day",
                   "ltst_h": "sol fraction x 24 h; read as local true solar time, but if the file counts mean solar "
                             "time it can differ by up to about 40 minutes",
                   "ls": "solar longitude (season), degrees", "my": "Mars year", "tau": "optical depth (unitless)",
                   "sigma": "1-sigma uncertainty of tau; null where the file overflowed"},
        "source": {"doi": doi, "version": meta.get("version"), "page_url": MENDELEY_PAGE, "license": "CC BY 4.0",
                   "citation": LEMMON_CITATION},
        "series": series}, separators=(",", ":")).encode("utf-8"))
    sols = [r["sol"] for r in rows880]
    sigma_median = statistics.median(r["sigma"] for r in rows880 if r["sigma"] is not None)
    mendeley_source = {"name": f"Mars Science Laboratory aerosol optical depths (Lemmon), Mendeley Data V"
                               f"{meta.get('version')}", "page_url": MENDELEY_PAGE, "request_url": MENDELEY_API,
                       "doi": doi, "fetched_at": _now(), "credit": "M. Lemmon; NASA/JPL-Caltech/MSSS (Mastcam images)",
                       "license": "CC BY 4.0", "citation": LEMMON_CITATION}
    return [
        new_entry(
            "optical_depth_history", "Measured dust in the air over Gale (Curiosity Mastcam, 2012-2023)",
            "How much sunlight the dust and haze above Gale blocked, measured by Curiosity pointing its Mastcam at "
            "the Sun, about every few sols for six Mars years, at two wavelengths (880 and 440 nm), with an "
            "uncertainty for each value.",
            ["solar", "thermal"], "climate", "observation", "local",
            evidence_note="measured from Mastcam solar images by the MSL team (Lemmon et al. 2024)",
            files=[file_record(jpath, ctx.data_root, "json")] + raw_files,
            coverage={"point": [137.4, -4.7], "note": "over Curiosity on the crater floor and Mount Sharp"},
            positional_accuracy="Curiosity's position on each sol (within about 10 km of the base until 2014)",
            uncertainty={"value": "per value", "basis": f"sigma column; median {sigma_median:.3f} at 880 nm"},
            observation_time={"start_sol": min(sols), "end_sol": max(sols),
                              "mars_years": sorted({r["my"] for r in rows880})},
            ranges={"tau_880": {"median": round(statistics.median(taus), 3), "min": taus[0], "max": taus[-1],
                                "max_at": {"sol": peak["sol"], "ls": peak["ls"], "my": peak["my"]}}},
            limitations=[
                "Counts dust and water-ice cloud together (total aerosol), for the whole column of air down to "
                "Curiosity; not a dust-only value.",
                "Measured where Curiosity was, which moved from the landing site up Mount Sharp (to about 700 m "
                "higher by 2023); the air column above the base is a little thicker.",
                "Gaps of days to weeks between measurements, longer during solar conjunctions.",
                "Orbital dust maps covering Mars years 24-36 (Montabone et al., LMD) exist but are not fetched "
                "(CC BY-SA, coarser cells).",
            ],
            tags=["dust", "optical depth", "tau", "haze", "aerosol", "dust storm", "measured", "curiosity",
                  "mastcam", "history"],
            source=mendeley_source,
        ),
    ]


def _get_with_retry(ctx: StepContext, url: str, max_bytes: int, tries: int = 3) -> bytes:
    """The PDS Atmospheres server drops some connections; try a few times before giving up."""
    for attempt in range(tries):
        try:
            return ctx.fetcher.get_bytes(url, max_bytes, timeout_s=60).body
        except FetchError:
            if attempt == tries - 1:
                raise
    raise AssertionError("unreachable")


def _navcam(ctx: StepContext) -> List[Dict[str, Any]]:
    label = _get_with_retry(ctx, NAVCAM_LABEL_URL, 256 << 10).decode("utf-8", "replace")
    csv_body = _get_with_retry(ctx, NAVCAM_CSV_URL, 1 << 20)
    los = parse_navcam_los(label, csv_body.decode("ascii", "replace"))
    lpath = ctx.path("climate/navcam_line_of_sight.json")
    atomic_write(lpath, json.dumps({
        "what": "line-of-sight extinction across Gale crater near the ground, from Curiosity Navcam images",
        "fields": {"extinction_per_km": "km^-1; null when flagged", "error_per_km": "km^-1",
                   "flag": "saturated (999: too hazy to measure, the far rim was not visible) or invalid (-999) "
                           "in the PDS table"},
        "visibility_note": "visual range is roughly 3.9 / extinction (km) for a 2% contrast threshold",
        "by_season": seasonal_summary(los, 30, "extinction_per_km"), "rows": los,
        "source": {"doi": "10.17189/aytb-wq72", "page_url": NAVCAM_PAGE, "citation": NAVCAM_CITATION}},
        separators=(",", ":")).encode("utf-8"))
    good = [r for r in los if r["extinction_per_km"] is not None]
    raw_csv = ctx.path("climate/navcam_line_of_sight.csv")
    atomic_write(raw_csv, csv_body)
    return [
        new_entry(
            "dust_extinction_navcam", "Haze near the ground across Gale (Curiosity Navcam)",
            "How hazy the air near the ground inside the crater was, measured by Curiosity's Navcam looking across "
            "the crater to its rim, as extinction per km (visibility is roughly 3.9 divided by this, in km).",
            ["solar", "routes"], "climate", "observation", "local",
            evidence_note="measured from Navcam images by Moores and Dong (2024), archived in NASA PDS",
            files=[file_record(lpath, ctx.data_root, "json"), file_record(raw_csv, ctx.data_root, "csv")],
            coverage={"point": [137.4, -4.7], "note": "the air between Curiosity and the crater rim"},
            uncertainty={"value": "per value", "basis": "error_per_km column (km^-1)"},
            observation_time={"start_sol": los[0]["sol"], "end_sol": los[-1]["sol"],
                              "mars_years": sorted({r["my"] for r in los})},
            ranges={"extinction_per_km": [min(r["extinction_per_km"] for r in good),
                                          max(r["extinction_per_km"] for r in good)] if good else None,
                    "too_hazy_to_measure": sum(r["flag"] == "saturated" for r in los),
                    "invalid_rows": sum(r["flag"] == "invalid" for r in los)},
            limitations=["Haze in the lower few km of air along one line of sight, not the whole column.",
                         "Rows flagged saturated in the PDS table were too hazy to measure (mostly in the dusty "
                         "season); they have no value, so the highest extinction listed is a lower bound for the "
                         "haziest days. Rows flagged invalid have no value either."],
            tags=["dust", "haze", "visibility", "extinction", "navcam", "curiosity", "measured"],
            source={"name": "MSL Atmospheric Ice and Dust Bundle, line-of-sight extinction (NASA PDS Atmospheres)",
                    "page_url": NAVCAM_PAGE, "request_url": NAVCAM_CSV_URL, "doi": "10.17189/aytb-wq72",
                    "fetched_at": _now(), "credit": "Moores and Dong; NASA/JPL-Caltech (Navcam); NASA PDS",
                    "license": "NASA PDS data; generally not subject to US copyright", "citation": NAVCAM_CITATION},
        ),
    ]


optical_depth_step = Step("optical_depth", ("optical_depth_history",), _optical_depth,
                          inputs=lambda ctx: {"mendeley": MENDELEY_ID})
navcam_dust_step = Step("navcam_dust", ("dust_extinction_navcam",), _navcam,
                        inputs=lambda ctx: {"url": NAVCAM_CSV_URL})

__all__ = ["MENDELEY_API", "NAVCAM_CSV_URL", "mars_years", "navcam_dust_step", "optical_depth_step",
           "parse_mastcam_tau", "parse_navcam_los", "seasonal_summary"]
