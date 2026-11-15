"""Build web/metrics.json from the requirement docs (read-only inputs)."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

FACTOR_DOCS = {
    "BT": "buildable-terrain.md",
    "GI": "ground-and-ice.md",
    "SC": "solar-conditions.md",
    "TC": "thermal-conditions.md",
    "IR": "investigation-routes.md",
}
APPLIES_TO = {"BT": "layout", "GI": "compound", "SC": "solar", "TC": "radiator", "IR": "route"}
APPLIES_OVERRIDES = {
    "BT-17": "route", "BT-18": "route", "BT-19": "route", "BT-20": "route",
    "GI-06": "layout",
}
AVAILABILITY_PREFIXES = [
    ("estimate today", "estimate_today"),
    ("partial", "partial"),
    ("field data needed", "field_needed"),
    ("planning calculation", "planning"),
]
METRIC_HEADER = "| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |"
AVAIL_HEADER = "| Metric | What we measure or calculate | Available today? | What local fieldwork would add |"
ID_RE = re.compile(r"^([A-Z]{2}-\d+)\s+(.*)$")
PD_RE = re.compile(r"^\*\*(D/P|P|D):\*\*")


def _cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _table_rows(path, header):
    """Yield cell lists for the rows of every table whose header line equals `header`."""
    in_table = False
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s == header:
            in_table = True
            continue
        if not in_table:
            continue
        if not s.startswith("|"):
            in_table = False
            continue
        if set(s.replace("|", "").strip()) <= set("-: "):
            continue
        yield _cells(s)


def _availability(cell):
    head = cell.split(":", 1)[0].strip().lower()
    for prefix, value in AVAILABILITY_PREFIXES:
        if head.startswith(prefix):
            return value
    raise ValueError("unknown availability: %r" % cell)


def _unit(definition):
    if "," not in definition:
        return ""
    tail = definition.rsplit(",", 1)[1].strip()
    return tail if len(tail) <= 6 else ""


def build(docs_dir):
    docs_dir = Path(docs_dir)
    avail, fieldwork = {}, {}
    for cells in _table_rows(docs_dir / "metric-data-availability.md", AVAIL_HEADER):
        m = ID_RE.match(cells[0])
        if m:
            avail[m.group(1)] = _availability(cells[2])
            fieldwork[m.group(1)] = cells[3].replace("**", "").strip()
    out = []
    for factor, fname in FACTOR_DOCS.items():
        for cells in _table_rows(docs_dir / fname, METRIC_HEADER):
            m = ID_RE.match(cells[0])
            if not m:
                continue
            mid, name = m.group(1), m.group(2).strip()
            pdm = PD_RE.match(cells[2])
            out.append({
                "id": mid,
                "factor": factor,
                "name": name,
                "definition": cells[1],
                "unit": _unit(cells[1]),
                "pd": pdm.group(1) if pdm else None,
                "baseline": cells[2].replace("**", ""),
                "ideal": cells[3].replace("**", ""),
                "availability": avail[mid],
                "fieldwork": fieldwork[mid],  # "What local fieldwork would add": the card's "settled by"
                "appliesTo": APPLIES_OVERRIDES.get(mid, APPLIES_TO[factor]),
            })
    out.sort(key=lambda x: x["id"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    metrics = build(Path(args.docs))
    Path(args.out).write_text(
        json.dumps({"metrics": metrics}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote %d metrics to %s" % (len(metrics), args.out))


if __name__ == "__main__":
    main()
