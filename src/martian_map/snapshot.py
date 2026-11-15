"""Run the data-snapshot steps and write ``data/catalog.json``.

Each :class:`Step` fetches or computes one or more datasets and returns their
catalog entries. A step that fails is recorded (``status: "failed"``) and the
run carries on. A step is skipped when every dataset it produces is already on
disk, matches the previous catalog's sizes and hashes, and was made from the same
inputs (scenario areas, input files: see :func:`step_fingerprint`).
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple

import numpy as np

from .catalog import Catalog, file_state, new_entry, validate_entry
from .http import Fetcher
from .scenario import Bounds, Scenario


class SnapshotError(ValueError):
    """The snapshot request itself is invalid (for example an unknown ``--only`` id)."""


@dataclass
class StepContext:
    scenario: Scenario
    data_root: Path
    fetcher: Fetcher
    refresh: bool
    previous: Optional[Catalog]
    log: Callable[[str], None]
    catalog: Catalog = field(default_factory=lambda: Catalog(entries=[]))
    warnings: List[str] = field(default_factory=list)
    failures: List[Tuple[str, str]] = field(default_factory=list)

    def fail(self, dataset_id: str, message: str) -> None:
        """Record that one dataset failed while the step carries on with the others."""
        self.failures.append((dataset_id, message))
        self.log(f"{dataset_id}: FAILED: {message}")

    def path(self, rel: str) -> Path:
        p = Path(self.data_root) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        self.log(f"warning: {message}")

    def is_fresh(self, entry_id: str, fingerprint: Optional[str] = None) -> bool:
        """True when the previous run produced this entry from the same inputs and its files are intact."""
        if self.refresh or self.previous is None:
            return False
        try:
            entry = self.previous.get(entry_id)
        except KeyError:
            return False
        files = entry.get("files") or []
        if entry.get("status") != "ok" or not files:
            return False
        if fingerprint is not None and entry.get("inputs_sha256") != fingerprint:
            return False
        return all(file_state(self.data_root, rec) == "ok" for rec in files)

    def entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        """The entry as it stands in the catalog being built (None if absent)."""
        try:
            return self.catalog.get(entry_id)
        except KeyError:
            return None


@dataclass(frozen=True)
class Step:
    id: str
    dataset_ids: Tuple[str, ...]
    run: Callable[[StepContext], List[Dict[str, Any]]]
    stretch: bool = False
    # What the output depends on besides code: scenario areas, input files' hashes. JSON-serialisable.
    inputs: Optional[Callable[[StepContext], Any]] = None


def step_fingerprint(step: Step, ctx: StepContext) -> str:
    """Hash of the step's inputs; when it changes (say a site box moved) the step runs again."""
    payload = {"step": step.id, "inputs": step.inputs(ctx) if step.inputs else None}
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class SnapshotReport:
    catalog: Catalog
    failed: List[Tuple[str, str]]
    warnings: List[str]


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def failed_entry(dataset_id: str, message: str, previous: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if previous is not None:
        entry = dict(previous)
        entry["status"] = "failed"
        entry["error"] = message
        return entry
    return new_entry(
        dataset_id,
        dataset_id,
        "Not available: the snapshot step that produces this dataset failed.",
        [],
        "unknown",
        "reference",
        "pending",
        status="failed",
        error=message,
        reason=f"snapshot step failed: {message}",
    )


def _areas(scenario: Scenario) -> Dict[str, Any]:
    return {
        "gale_region": scenario.gale_region.as_list(),
        "study_area": scenario.study_area.as_list(),
        "base": {"lon": scenario.base[0], "lat": scenario.base[1]},
        "sites": {s.id: s.bounds.as_list() for s in scenario.sites},
        **({"trip_area": scenario.trip_area.as_list()} if scenario.trip_area else {}),
    }


def _grid_fractions(entry: Dict[str, Any], areas: Sequence[Tuple[str, Bounds]],
                    data_root: Optional[Path]) -> Optional[Dict[str, float]]:
    """Share of each area holding real (finite) values in the entry's first float grid; None if unavailable."""
    if data_root is None:
        return None
    rec = next((f for f in entry.get("files") or []
                if f.get("format") == "f32" and isinstance(f.get("grid"), dict)), None)
    if rec is None or not (Path(data_root) / rec["path"]).is_file():
        return None
    from .grids import read_grid

    try:
        grid = read_grid(data_root, rec)
    except (ValueError, OSError):
        return None
    px, py = grid.pixel_deg
    out = {}
    for name, area in areas:
        if grid.bounds.intersection(area) is None:
            out[name] = 0.0
            continue
        finite = int(np.isfinite(grid.window(area).values).sum())
        expected = (area.east - area.west) / px * (area.north - area.south) / py
        out[name] = min(1.0, finite / expected) if expected > 0 else 0.0
    return out


def build_coverage_report(catalog: Catalog, scenario: Scenario,
                          data_root: Optional[Path] = None) -> List[Dict[str, Any]]:
    """One row per (study area or site) x (local or live dataset): how much of the area it covers.

    With ``data_root``, gridded datasets are measured from their files (cells with real values),
    so an image that misses a site reports "none" there even if its box spans the site.
    """
    areas: List[Tuple[str, Bounds]] = [("study_area", scenario.study_area)] + [(s.id, s.bounds) for s in scenario.sites]
    listed = [e for e in sorted(catalog.entries, key=lambda x: x["id"]) if e.get("access") in ("local", "live")]
    measured = {e["id"]: _grid_fractions(e, areas, data_root) for e in listed}
    rows = []
    for area_name, area in areas:
        for e in listed:
            cov = e.get("coverage") or {}
            fraction = None
            grid_fraction = (measured.get(e["id"]) or {}).get(area_name)
            if grid_fraction is not None:
                fraction = float(grid_fraction)
                covers = "full" if fraction >= 0.999 else ("partial" if fraction > 0 else "none")
            elif cov.get("area") == area_name and isinstance(cov.get("covered_fraction"), (int, float)):
                fraction = float(cov["covered_fraction"])
                covers = "full" if fraction >= 0.999 else ("partial" if fraction > 0 else "none")
            elif cov.get("bounds"):
                try:
                    b = Bounds.from_list(cov["bounds"])
                except ValueError:
                    covers = "unknown"
                else:
                    covers = "full" if b.contains_bounds(area) else ("partial" if b.intersects(area) else "none")
            else:
                covers = "unknown"
            rows.append(
                {
                    "area": area_name,
                    "dataset_id": e["id"],
                    "covers": covers,
                    "covered_fraction": fraction,
                    "resolution_m": e.get("resolution_m"),
                }
            )
    return rows


def _selected(step: Step, only: Optional[Set[str]], include_stretch: bool) -> bool:
    if only:
        return step.id in only or any(d in only for d in step.dataset_ids)
    return include_stretch or not step.stretch


def run_snapshot(
    scenario: Scenario,
    data_root: Path,
    fetcher: Fetcher,
    only: Optional[Set[str]] = None,
    refresh: bool = False,
    include_stretch: bool = False,
    log: Callable[[str], None] = print,
    steps: Optional[Sequence[Step]] = None,
) -> SnapshotReport:
    data_root = Path(data_root)
    if steps is None:
        from .sources import all_steps

        steps = all_steps(scenario)
    if only:
        valid = {s.id for s in steps} | {d for s in steps for d in s.dataset_ids}
        unknown = sorted(only - valid)
        if unknown:
            raise SnapshotError(
                f"unknown --only id(s): {', '.join(unknown)}. "
                f"Step ids: {', '.join(s.id for s in steps)}. "
                f"Dataset ids: {', '.join(sorted({d for s in steps for d in s.dataset_ids}))}."
            )
        refresh = True  # --only always re-runs what it names
    data_root.mkdir(parents=True, exist_ok=True)
    catalog_path = data_root / "catalog.json"
    previous = Catalog.load(catalog_path) if catalog_path.exists() else None
    catalog = Catalog(entries=[dict(e) for e in previous.entries] if previous else [])
    ctx = StepContext(scenario, data_root, fetcher, refresh, previous, log, catalog=catalog)

    failed: List[Tuple[str, str]] = []
    produced: Set[str] = set()
    for step in steps:
        if not _selected(step, only, include_stretch):
            continue
        fingerprint = step_fingerprint(step, ctx)
        if step.dataset_ids and all(ctx.is_fresh(d, fingerprint) for d in step.dataset_ids):
            log(f"{step.id}: up to date, skipped")
            continue
        log(f"{step.id}: running")
        ctx.failures = []
        try:
            entries = step.run(ctx)
            for e in entries:
                validate_entry(e)
            for e in entries:
                if e["id"] in step.dataset_ids:
                    e["inputs_sha256"] = fingerprint
                catalog.upsert(e)
                produced.add(e["id"])
            failed.extend((step.id, f"{d}: {m}") for d, m in ctx.failures)
        except Exception as exc:  # record and carry on: one bad source must not stop the run
            message = str(exc) or exc.__class__.__name__
            failed.append((step.id, message))
            log(f"{step.id}: FAILED: {message}")
            for d in step.dataset_ids:
                catalog.upsert(failed_entry(d, message, ctx.entry(d)))

    known = produced | {d for s in steps for d in s.dataset_ids}
    for e in [e for e in catalog.entries if e["id"] not in known]:
        catalog.entries.remove(e)
        log(f"{e['id']}: no step makes this any more (site renamed or removed?); "
            "removed from the catalog, its files stay in data/")

    from .metrics import metrics_for
    from .references import REFERENCES, references_for

    for e in catalog.entries:
        e["references"] = references_for(e["id"])
        e["metrics"] = metrics_for(e["id"])
        if e.get("access") in ("local", "live") and not e["references"]:
            ctx.warn(f"{e['id']}: no reference recorded in references.py")
    used = {r for e in catalog.entries if e.get("access") in ("local", "live") for r in e["references"]}
    catalog.references = {r: REFERENCES[r] for r in REFERENCES if r in used}

    catalog.areas = _areas(scenario)
    catalog.generated_at = _now()
    catalog.scenario_file = scenario.path.as_posix()
    catalog.coverage_report = build_coverage_report(catalog, scenario, data_root)
    catalog.save(catalog_path)
    return SnapshotReport(catalog=catalog, failed=failed, warnings=list(ctx.warnings))


__all__ = [
    "SnapshotError",
    "SnapshotReport",
    "Step",
    "StepContext",
    "build_coverage_report",
    "failed_entry",
    "run_snapshot",
    "step_fingerprint",
]
