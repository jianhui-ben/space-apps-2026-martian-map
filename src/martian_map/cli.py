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

# Illustrative demo site: lower Mount Sharp (Aeolis Mons) in Gale crater, the
# region the challenge cites for Curiosity's 2025 boxwork study. Coordinates
# are approximate; elevations are ILLUSTRATIVE placeholders, not DEM samples.
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
    return p


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
    except TrekError as exc:
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
