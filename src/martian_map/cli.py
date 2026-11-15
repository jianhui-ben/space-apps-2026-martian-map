"""Command-line interface: ``python -m martian_map <command> ...``."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import List, Optional, Sequence

from . import __version__
from .geo import MAX_ZOOM, km_per_pixel, lonlat_to_tile, tile_bounds
from .traverse import (
    DEFAULT_CAUTION_SLOPE_DEG,
    DEFAULT_MAX_SLOPE_DEG,
    DEFAULT_WALKING_SPEED_KMH,
    TraverseSummary,
    Waypoint,
    parse_waypoints,
    plan_traverse,
)
from .trek import LAYERS, TrekClient, TrekError, check_grid
from .http import FetchError

# Illustrative demo site: lower Mount Sharp (Aeolis Mons) in Gale crater, the
# region the challenge cites for Curiosity's 2025 boxwork study. Coordinates
# are approximate; elevations are ILLUSTRATIVE placeholders, not DEM samples.
DATA_REPO = "jianhui-ben/space-apps-2026-martian-map"
DEMO_SITE = {"name": "Lower Mount Sharp, Gale crater (approx.)", "lat": -4.72, "lon": 137.39}
DEMO_WAYPOINTS = [
    Waypoint(lat=-4.700, lon=137.380, elevation_m=-4150.0, name="Habitat"),
    Waypoint(lat=-4.710, lon=137.390, elevation_m=-4120.0, name="Ridge base"),
    Waypoint(lat=-4.725, lon=137.400, elevation_m=-3820.0, name="Boxwork outcrop"),
    Waypoint(lat=-4.735, lon=137.395, elevation_m=-3800.0, name="Overlook"),
]


def _finite_float(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a number: {text!r}") from None
    if not math.isfinite(value):
        raise argparse.ArgumentTypeError(f"must be finite: {text!r}")
    return value


def _zoom(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not an integer: {text!r}") from None
    if not 0 <= value <= MAX_ZOOM:
        raise argparse.ArgumentTypeError(f"must be in 0..{MAX_ZOOM}: {text!r}")
    return value


def _positive_float(text: str) -> float:
    value = _finite_float(text)
    if value <= 0:
        raise argparse.ArgumentTypeError(f"must be positive: {text!r}")
    return value


def _nonneg_float(text: str) -> float:
    value = _finite_float(text)
    if value < 0:
        raise argparse.ArgumentTypeError(f"must be non-negative: {text!r}")
    return value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m martian_map",
        description="Starter tools for planning a Marswalk with NASA Mars Trek data.",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("layers", help="list the built-in Mars Trek layers")

    t = sub.add_parser("tile", help="locate (and optionally download) the tile covering a point")
    t.add_argument("--lat", type=_finite_float, required=True, help="planetocentric latitude, degrees")
    t.add_argument("--lon", type=_finite_float, required=True, help="east-positive longitude, degrees")
    t.add_argument("--zoom", type=_zoom, default=7)
    t.add_argument("--layer", choices=sorted(LAYERS), default="viking")
    t.add_argument("--out", type=Path, default=Path("data/tiles"), help="where to save tiles (default: data/tiles)")
    t.add_argument("--dry-run", action="store_true", help="print the tile and URL without fetching")

    r = sub.add_parser("traverse", help="summarise a multi-leg Marswalk route")
    r.add_argument(
        "--waypoints",
        required=True,
        help="'lat,lon[,elev_m];lat,lon[,elev_m];...' (elevation optional)",
    )
    r.add_argument("--speed", type=_positive_float, default=DEFAULT_WALKING_SPEED_KMH, help="walking speed, km/h")
    r.add_argument("--caution-slope", type=_nonneg_float, default=DEFAULT_CAUTION_SLOPE_DEG)
    r.add_argument("--max-slope", type=_nonneg_float, default=DEFAULT_MAX_SLOPE_DEG)
    r.add_argument("--max-range", type=_nonneg_float, default=None, help="flag the route if longer than this, km")

    d = sub.add_parser("demo", help="end-to-end example at lower Mount Sharp (live Mars Trek data)")
    d.add_argument("--zoom", type=_zoom, default=7)
    d.add_argument("--out", type=Path, default=Path("data/tiles"))
    d.add_argument("--max-range", type=_nonneg_float, default=10.0)

    s = sub.add_parser("snapshot", help="download or compute every local dataset into data/ and write data/catalog.json")
    s.add_argument("--only", default=None, help="comma-separated step or dataset ids; always re-runs them")
    s.add_argument("--refresh", action="store_true", help="fetch again even if files are up to date")
    s.add_argument("--stretch", action="store_true", help="also run stretch steps")
    s.add_argument("--data-root", type=Path, default=Path("data"))
    s.add_argument("--scenario", type=Path, default=Path("scenario/gale.json"),
                   help="scenario/gale.json (written to data/), or another region such as scenario/jezero.json "
                        "(written to data/regions/<id>/ and merged into data/catalog.json)")

    c = sub.add_parser("catalog", help="inspect data/catalog.json")
    csub = c.add_subparsers(dest="catalog_command", required=True)
    cc = csub.add_parser("check", help="check every local file against the catalog")
    cc.add_argument("--strict", action="store_true", help="exit 1 if any file is missing or different")
    cs = csub.add_parser("search", help="find datasets by words, factor or category")
    cs.add_argument("words", nargs="*")
    cs.add_argument("--factor", default=None)
    cs.add_argument("--category", default=None)
    cs.add_argument("--metric", default=None, help="requirement metric id, e.g. BT-05")
    ct = csub.add_parser("table", help="print the catalog as a markdown table")
    ct.add_argument("--write", type=Path, default=None, help="replace the table between the markers in this file")
    cr = csub.add_parser("references", help="print the data references for the submission (NASA / partner / other)")
    cr.add_argument("--write", type=Path, default=None, help="replace the text between the references markers in this file")
    cm = csub.add_parser("metrics", help="which datasets support each requirement metric (BT/GI/SC/TC/IR)")
    cm.add_argument("--write", type=Path, default=None, help="replace the text between the metrics markers in this file")
    cm.add_argument("--requirements", type=Path, default=Path("docs/requirements/metric-data-availability.md"))
    for sp in (cc, cs, ct, cr, cm):
        sp.add_argument("--data-root", type=Path, default=Path("data"))

    dd = sub.add_parser("data", help="share the data files as GitHub Release assets (pack, publish, fetch)")
    dsub = dd.add_subparsers(dest="data_command", required=True)
    dp = dsub.add_parser("pack", help="zip each region's files, checked against the index, and write data/release.json")
    dp.add_argument("--tag", required=True, help="release tag, for example data-2026-11-15")
    dp.add_argument("--out", type=Path, default=Path("dist"))
    dp.add_argument("--repo", default=DATA_REPO)
    du = dsub.add_parser("publish", help="create the release and upload the zips (needs GITHUB_PERSONAL_ACCESS_TOKEN)")
    du.add_argument("--dist", type=Path, default=Path("dist"))
    df = dsub.add_parser("fetch", help="download the release's zips, check them and unpack them into data/")
    df.add_argument("--region", default=None, help="comma-separated region ids (gale, jezero, arcadia); default all")
    for sp in (dp, du, df):
        sp.add_argument("--data-root", type=Path, default=Path("data"))
    return p


def cmd_snapshot(args, fetcher=None, out=None) -> int:
    from .http import Fetcher
    from .scenario import load_scenario
    from .snapshot import REGIONS_DIR, SnapshotError, merge_regions, run_snapshot

    out = out if out is not None else sys.stdout
    scenario = load_scenario(args.scenario)
    only = {x.strip() for x in args.only.split(",") if x.strip()} if args.only else None
    root = args.data_root if scenario.is_gale else args.data_root / REGIONS_DIR / scenario.region_id
    try:
        report = run_snapshot(
            scenario,
            root,
            fetcher if fetcher is not None else Fetcher(),
            only=only,
            refresh=args.refresh,
            include_stretch=args.stretch,
            log=lambda m: print(m, file=out),
        )
    except SnapshotError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    merged = merge_regions(args.data_root)
    print(f"catalog: {root / 'catalog.json'} ({len(report.catalog.entries)} datasets)", file=out)
    if not scenario.is_gale or len(merged.areas.get("regions", {})) > 1:
        print(f"merged: {args.data_root / 'catalog.json'} ({len(merged.entries)} datasets, regions: "
              f"{', '.join(sorted(merged.areas.get('regions', {})))})", file=out)
    for w in report.warnings:
        print(f"warning: {w}", file=out)
    for step_id, message in report.failed:
        print(f"failed: {step_id}: {message}", file=out)
    return 1 if report.failed else 0


_STATE_LABEL = {"ok": "ok", "not_downloaded": "not downloaded", "different": "different (re-run snapshot)"}


def cmd_catalog(args, out=None) -> int:
    from .catalog import Catalog

    out = out if out is not None else sys.stdout
    path = args.data_root / "catalog.json"
    if not path.is_file():
        print(f"error: no catalog at {path}; run python -m martian_map snapshot first", file=sys.stderr)
        return 1
    catalog = Catalog.load(path)
    if args.catalog_command == "check":
        results = catalog.check(args.data_root)
        bad = 0
        for r in results:
            if r.state != "ok":
                bad += 1
            print(f"{_STATE_LABEL[r.state]:<28} {r.dataset_id:<34} {r.path}", file=out)
        print(f"{len(results) - bad}/{len(results)} files ok", file=out)
        return 1 if (args.strict and bad) else 0
    if args.catalog_command == "search":
        hits = catalog.search(" ".join(args.words), factor=args.factor, category=args.category, metric=args.metric)
        for e in hits:
            print(f"{e['id']:<34} [{e.get('access')}, {e.get('evidence_type')}] {e.get('title')}", file=out)
        print(f"{len(hits)} match(es)", file=out)
        return 0
    if args.catalog_command == "table":
        table = catalog.markdown_table()
        if args.write is not None:
            from .catalog import update_doc_table

            changed = update_doc_table(args.write, table)
            print(f"{args.write}: {'updated' if changed else 'already up to date'}", file=out)
        else:
            out.write(table)
        return 0
    if args.catalog_command == "metrics":
        from .catalog import METRICS_END, METRICS_START, update_doc_table
        from .metrics import coverage_markdown, parse_availability

        md = coverage_markdown(catalog, parse_availability(args.requirements.read_text(encoding="utf-8")))
        if args.write is not None:
            changed = update_doc_table(args.write, md, METRICS_START, METRICS_END)
            print(f"{args.write}: {'updated' if changed else 'already up to date'}", file=out)
        else:
            out.write(md)
        return 0
    if args.catalog_command == "references":
        from .catalog import REFERENCES_END, REFERENCES_START, update_doc_table
        from .references import references_markdown

        md = references_markdown(catalog)
        if args.write is not None:
            changed = update_doc_table(args.write, md, REFERENCES_START, REFERENCES_END)
            print(f"{args.write}: {'updated' if changed else 'already up to date'}", file=out)
        else:
            out.write(md)
        return 0
    return 2  # pragma: no cover


def _print_traverse(summary: TraverseSummary, out=None) -> None:
    out = out if out is not None else sys.stdout
    print(f"{'#':>2}  {'from':<16} {'to':<16} {'km':>7} {'slope':>7}  hazard", file=out)
    for i, leg in enumerate(summary.legs):
        slope = "n/a" if leg.slope_deg is None else f"{leg.slope_deg:5.1f}d"
        print(
            f"{i:>2}  {leg.start.label(i):<16} {leg.end.label(i + 1):<16} "
            f"{leg.distance_km:7.3f} {slope:>7}  {leg.hazard}",
            file=out,
        )
    max_slope = "n/a" if summary.max_slope_deg is None else f"{summary.max_slope_deg:.1f} deg"
    print(f"total: {summary.total_distance_km:.3f} km, ~{summary.estimated_hours:.2f} h walking, max slope {max_slope}", file=out)
    if summary.flagged_leg_indices:
        print(f"flagged legs: {', '.join(str(i) for i in summary.flagged_leg_indices)}", file=out)
    if summary.within_range is not None:
        print(f"within range limit: {'yes' if summary.within_range else 'NO'}", file=out)


def cmd_layers(_args, out=None) -> int:
    out = out if out is not None else sys.stdout
    for key, layer in sorted(LAYERS.items()):
        print(f"{key:<7} {layer.data_kind:<12} z0-{layer.max_zoom}  {layer.title}", file=out)
        print(f"        {layer.capabilities_url}", file=out)
    return 0


def cmd_tile(args, client: Optional[TrekClient] = None, out=None) -> int:
    out = out if out is not None else sys.stdout
    layer = LAYERS[args.layer]
    if not layer.covers_lat(args.lat):
        raise ValueError(f"layer {args.layer} covers lat {layer.lat_min}..{layer.lat_max}, not {args.lat}")
    tile = lonlat_to_tile(args.lat, args.lon, args.zoom)
    layer.check_tile(tile)  # fail on zoom > layer max before printing anything
    b = tile_bounds(tile)
    print(f"layer: {layer.layer_id} ({layer.data_kind})", file=out)
    print(f"tile: z={tile.zoom} row={tile.row} col={tile.col}", file=out)
    print(f"bounds: lon {b.west:.4f}..{b.east:.4f}, lat {b.south:.4f}..{b.north:.4f}", file=out)
    print(f"scale: ~{km_per_pixel(tile.zoom, args.lat):.3f} km/px at this latitude", file=out)
    print(f"url: {layer.tile_url(tile)}", file=out)
    if args.dry_run:
        return 0
    client = client or TrekClient()
    result = client.fetch_tile(layer, args.lat, args.lon, args.zoom, out_dir=args.out)
    print(f"saved: {result.path} ({result.num_bytes} bytes, {result.content_type})", file=out)
    return 0


def cmd_traverse(args, out=None) -> int:
    out = out if out is not None else sys.stdout
    waypoints = parse_waypoints(args.waypoints)
    summary = plan_traverse(
        waypoints,
        walking_speed_kmh=args.speed,
        caution_slope_deg=args.caution_slope,
        max_slope_deg=args.max_slope,
        max_range_km=args.max_range,
    )
    _print_traverse(summary, out=out)
    return 0


def cmd_demo(args, client: Optional[TrekClient] = None, out=None) -> int:
    out = out if out is not None else sys.stdout
    client = client or TrekClient()
    site = DEMO_SITE
    print(f"site: {site['name']}  lat {site['lat']}, lon {site['lon']}E, zoom {args.zoom}", file=out)
    print("", file=out)
    print("== layers (one per data kind) ==", file=out)
    failures = 0
    for key in ("viking", "mola", "themis"):
        layer = LAYERS[key]
        try:
            caps = client.get_capabilities(layer)
            problems = check_grid(caps)
            grid = "grid ok" if not problems else "GRID MISMATCH: " + "; ".join(problems)
            zoom = min(args.zoom, layer.max_zoom)
            result = client.fetch_tile(layer, site["lat"], site["lon"], zoom, out_dir=args.out)
            print(
                f"[{layer.data_kind:<11}] {key:<7} caps max z={caps.max_zoom}, {grid}; "
                f"tile z{result.tile.zoom}/r{result.tile.row}/c{result.tile.col} "
                f"{result.num_bytes} B -> {result.path}",
                file=out,
            )
        except (TrekError, ValueError) as exc:
            failures += 1
            print(f"[{layer.data_kind:<11}] {key:<7} FAILED: {exc}", file=out)
    print("", file=out)
    print("== sample traverse (elevations are illustrative, not measured) ==", file=out)
    summary = plan_traverse(DEMO_WAYPOINTS, max_range_km=args.max_range)
    _print_traverse(summary, out=out)
    return 1 if failures else 0


# Options whose values may start with "-" (southern latitudes, western
# longitudes). argparse only recognises simple negative numbers such as
# "-4.7", so "-4.7,137.4;..." or "-1e-3" would be read as an unknown flag.
_VALUE_OPTIONS = ("--waypoints", "--lat", "--lon")


def _join_dash_values(argv: List[str]) -> List[str]:
    """Rewrite ``--opt -value`` as ``--opt=-value`` for :data:`_VALUE_OPTIONS`."""
    out: List[str] = []
    i = 0
    while i < len(argv):
        token = argv[i]
        if token == "--":
            out.extend(argv[i:])
            break
        if token in _VALUE_OPTIONS and i + 1 < len(argv) and argv[i + 1].startswith("-") and not argv[i + 1].startswith("--"):
            out.append(f"{token}={argv[i + 1]}")
            i += 2
            continue
        out.append(token)
        i += 1
    return out


def cmd_data(args, out=None) -> int:
    import os

    from . import data_release as dr
    from .http import Fetcher

    out = out if out is not None else sys.stdout
    log = lambda m: print(m, file=out)  # noqa: E731
    try:
        if args.data_command == "pack":
            manifest = dr.pack(args.data_root, args.out, args.tag, args.repo, log=log)
            log(f"wrote {args.data_root / dr.RELEASE_FILE}; commit it, push, then run: python -m martian_map data publish")
            return 0 if manifest["assets"] else 1
        if args.data_command == "publish":
            token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN") or os.environ.get("GITHUB_TOKEN")
            if not token:
                print("error: set GITHUB_PERSONAL_ACCESS_TOKEN (a token that can create releases on the repo)",
                      file=sys.stderr)
                return 2
            url = dr.publish(dr.load_manifest(args.data_root), args.dist, token=token, log=log)
            log(f"published: {url}")
            return 0
        regions = {r.strip() for r in args.region.split(",") if r.strip()} if args.region else None
        report = dr.fetch(args.data_root, Fetcher(allowed_hosts=dr.RELEASE_HOSTS), regions=regions, log=log)
        log(f"{report['files_ok']} files ok" + (f"; problems: {', '.join(report['problems'])}" if report["problems"] else ""))
        return 1 if report["problems"] else 0
    except dr.ReleaseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    raw = list(argv) if argv is not None else sys.argv[1:]
    args = parser.parse_args(_join_dash_values(raw))
    try:
        if args.command == "layers":
            return cmd_layers(args)
        if args.command == "tile":
            return cmd_tile(args)
        if args.command == "traverse":
            return cmd_traverse(args)
        if args.command == "demo":
            return cmd_demo(args)
        if args.command == "snapshot":
            return cmd_snapshot(args)
        if args.command == "catalog":
            return cmd_catalog(args)
        if args.command == "data":
            return cmd_data(args)
    except (TrekError, FetchError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except (ValueError, TypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    parser.error(f"unknown command {args.command!r}")
    return 2  # pragma: no cover


def _entry() -> None:  # console_scripts entry point
    sys.exit(main())


__all__: List[str] = ["main", "build_parser"]
