"""Build the static GitHub Pages site: web/ plus a trimmed, size-limited copy of the data folder.

Usage: python -I web/package.py --data <dir> --out web/dist

The output lays data out under data/ so the app's relative URLs (./data/catalog.json, ./data/<path>) work from
plain static files. Datasets listed in the manifests (web/datasets.json and, when present,
web/src/route/datasets.json and web/src/walk/datasets.json) are copied, plus the catalog's `live` datasets
(metadata only). 1 m height and slope grids are reduced to 2 m blocks to stay inside the Pages size limits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_TOTAL_BYTES = 300 * 1024 * 1024
MANIFESTS = ("datasets.json", "src/route/datasets.json", "src/walk/datasets.json")
WEB_FILES = ("index.html", "styles.css", "metrics.json", "datasets.json")
WEB_DIRS = ("src", "vendor")
REDUCE_BELOW_M = 2
BLOCK = 2


class PackageError(Exception):
    """A build rule failed; the message says which dataset or file."""


def _manifest_entries(web_dir: Path) -> Dict[str, Optional[set]]:
    """Dataset id -> set of formats to copy (None means every file), merged over the manifests."""
    wanted: Dict[str, Optional[set]] = {}
    for rel in MANIFESTS:
        path = web_dir / rel
        if not path.is_file():
            continue
        for item in json.loads(path.read_text()):
            if isinstance(item, str):
                wanted[item] = None
            else:
                formats = item.get("formats")
                if item["id"] in wanted and wanted[item["id"]] is None:
                    continue
                if formats is None:
                    wanted[item["id"]] = None
                else:
                    wanted[item["id"]] = (wanted.get(item["id"]) or set()) | set(formats)
    return wanted


def _block_reduce(arr: np.ndarray, how: str) -> np.ndarray:
    """Reduce to BLOCK x BLOCK blocks ignoring NaN; edge blocks use the cells they have. all-NaN stays NaN."""
    h, w = arr.shape
    h2, w2 = -(-h // BLOCK), -(-w // BLOCK)
    pad = np.full((h2 * BLOCK, w2 * BLOCK), np.nan, dtype=np.float32)
    pad[:h, :w] = arr
    blocks = pad.reshape(h2, BLOCK, w2, BLOCK).transpose(0, 2, 1, 3).reshape(h2, w2, BLOCK * BLOCK)
    valid = ~np.isnan(blocks)
    if how == "mean":
        count = valid.sum(axis=2)
        total = np.where(valid, blocks, 0.0).astype(np.float64).sum(axis=2)
        out = np.full((h2, w2), np.nan, dtype=np.float64)
        np.divide(total, count, out=out, where=count > 0)
    else:
        out = np.where(valid, blocks, -np.inf).max(axis=2).astype(np.float64)
        out[~valid.any(axis=2)] = np.nan
    return out.astype("<f4")


def _reduce_file(dataset: dict, entry: dict, src: Path, dst: Path) -> dict:
    grid = entry["grid"]
    if grid.get("dtype", "f32") != "f32" or grid.get("byte_order", "little") != "little":
        raise PackageError("%s: only little-endian f32 grids can be reduced" % entry["path"])
    w, h = grid["width"], grid["height"]
    raw = src.read_bytes()
    if len(raw) != w * h * 4:
        raise PackageError("%s: expected %d bytes, found %d" % (entry["path"], w * h * 4, len(raw)))
    arr = np.frombuffer(raw, dtype="<f4").reshape(h, w).astype(np.float32)
    nodata = grid.get("nodata", "NaN")
    if nodata not in ("NaN", None):
        arr = np.where(arr == np.float32(nodata), np.nan, arr)
    how = "mean" if "BT-04" in (dataset.get("metrics") or []) else "max"
    out = _block_reduce(arr, how)
    if nodata not in ("NaN", None):
        out = np.where(np.isnan(out), np.float32(nodata), out).astype("<f4")
    data = out.tobytes()
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(data)
    new = dict(entry)
    new["bytes"] = len(data)
    new["sha256"] = hashlib.sha256(data).hexdigest()
    new["grid"] = dict(grid, width=out.shape[1], height=out.shape[0],
                       pixel_deg=[p * BLOCK for p in grid["pixel_deg"]])
    return new


def _copy_web(web_dir: Path, out_dir: Path) -> None:
    for name in WEB_FILES:
        if (web_dir / name).is_file():
            shutil.copy2(web_dir / name, out_dir / name)
    for name in WEB_DIRS:
        if (web_dir / name).is_dir():
            shutil.copytree(web_dir / name, out_dir / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def _dist_files(out_dir: Path) -> List[Path]:
    return [p for p in out_dir.rglob("*") if p.is_file()]


def build(web_dir, data_dir, out_dir) -> Dict[str, int]:
    web_dir, data_dir, out_dir = Path(web_dir), Path(data_dir), Path(out_dir)
    catalog = json.loads((data_dir / "catalog.json").read_text())
    by_id = {d["id"]: d for d in catalog["datasets"]}
    wanted = _manifest_entries(web_dir)
    for did in wanted:
        if did not in by_id:
            raise PackageError("manifest dataset %r is not in the catalog" % did)

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    _copy_web(web_dir, out_dir)
    data_out = out_dir / "data"
    data_out.mkdir()

    kept = []
    for d in catalog["datasets"]:
        did = d["id"]
        is_live = d.get("access") == "live"
        if did not in wanted and not is_live:
            continue
        nd = dict(d)
        if did in wanted:
            formats = wanted[did]
            files = [f for f in d.get("files", []) if formats is None or f["format"] in formats]
            reduce_it = (d.get("resolution_m") or REDUCE_BELOW_M) < REDUCE_BELOW_M
            new_files = []
            for f in files:
                src = data_dir / f["path"]
                if not src.is_file():
                    raise PackageError("dataset %s: file %s is missing" % (did, f["path"]))
                if f.get("format") == "f32" and reduce_it and f.get("grid"):
                    new_files.append(_reduce_file(d, f, src, data_out / f["path"]))
                    nd["resolution_m"] = d["resolution_m"] * BLOCK
                else:
                    (data_out / f["path"]).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, data_out / f["path"])
                    new_files.append(f)
            nd["files"] = new_files
        kept.append(nd)

    trimmed = dict(catalog, datasets=kept)
    (data_out / "catalog.json").write_text(json.dumps(trimmed, indent=1) + "\n")
    scenario = data_dir / "scenario.json"
    if scenario.is_file():
        shutil.copy2(scenario, data_out / "scenario.json")
    (out_dir / ".nojekyll").write_text("")

    files = _dist_files(out_dir)
    total = 0
    for p in files:
        size = p.stat().st_size
        total += size
        if size >= MAX_FILE_BYTES:
            raise PackageError("%s is %.1f MB; GitHub Pages files must be under 100 MB" % (p.relative_to(out_dir), size / 1e6))
    if total > MAX_TOTAL_BYTES:
        raise PackageError("build is %.1f MB; the limit is 300 MB" % (total / 1e6))
    return {"files": len(files), "bytes": total}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, required=True, help="the data folder (catalog.json and its files)")
    ap.add_argument("--out", type=Path, default=Path("web/dist"))
    args = ap.parse_args()
    web_dir = Path(__file__).resolve().parent
    try:
        res = build(web_dir, args.data, args.out)
    except PackageError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    biggest = max(_dist_files(args.out), key=lambda p: p.stat().st_size)
    print("built %s: %d files, %.1f MB (largest %s, %.1f MB)" % (
        args.out, res["files"], res["bytes"] / 1e6, biggest.relative_to(args.out), biggest.stat().st_size / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
