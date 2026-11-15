"""Minimal reader for PDS3 images with attached labels (THEMIS projected brightness temperature).

Supports single-band images, the common sample types, scaling, null values,
the label's MD5 checksum, and resampling SINUSOIDAL / EQUIRECTANGULAR /
SIMPLE CYLINDRICAL map projections onto a lon/lat grid.

Pixel convention: 0-based ``row = floor(LINE_PROJECTION_OFFSET - y / MAP_SCALE)``
and ``col = floor(SAMPLE_PROJECTION_OFFSET + x / MAP_SCALE)``. The half-pixel
convention could not be confirmed against the dataset's DSMAP catalog (the
archive served it empty on 2026-11-14), so positions are good to about one
pixel.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any, Dict, List, Tuple

import numpy as np

from .grids import Grid
from .scenario import Bounds

_DTYPES = {
    "PC_REAL": "<f",
    "IEEE_REAL": ">f",
    "REAL": ">f",
    "LSB_INTEGER": "<i",
    "MSB_INTEGER": ">i",
    "INTEGER": ">i",
    "LSB_UNSIGNED_INTEGER": "<u",
    "MSB_UNSIGNED_INTEGER": ">u",
    "UNSIGNED_INTEGER": ">u",
}
_UNIT_RE = re.compile(r"^(.*?)\s*<([^>]*)>\s*$")
_END_RE = re.compile(rb"(?:^|\r?\n)END[ \t]*(?:\r?\n|$)")


def _scalar(text: str) -> Any:
    t = text.strip()
    if len(t) >= 2 and t[0] == t[-1] == '"':
        return t[1:-1].strip()
    m = _UNIT_RE.match(t)
    if m:
        return {"value": _scalar(m.group(1)), "unit": m.group(2).strip()}
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t)
    except ValueError:
        return t


def _value(text: str) -> Any:
    t = text.strip()
    if t.startswith("(") and t.endswith(")"):
        inner = t[1:-1]
        return [_scalar(x) for x in inner.split(",")] if inner.strip() else []
    return _scalar(t)


def parse_label(text: str) -> Dict[str, Any]:
    root: Dict[str, Any] = {}
    stack: List[Dict[str, Any]] = [root]
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = re.sub(r"/\*.*?\*/", "", lines[i]).strip()
        i += 1
        if not line:
            continue
        if line == "END":
            break
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if val.startswith("(") and ")" not in val:  # list continued over several lines
            while i < len(lines) and ")" not in val:
                val += " " + lines[i].strip()
                i += 1
        elif val.startswith('"') and val.count('"') == 1:  # quoted text over several lines
            while i < len(lines) and val.count('"') < 2:
                val += " " + lines[i].strip()
                i += 1
        if key in ("OBJECT", "GROUP"):
            child: Dict[str, Any] = {}
            stack[-1][_scalar(val)] = child
            stack.append(child)
        elif key in ("END_OBJECT", "END_GROUP"):
            if len(stack) > 1:
                stack.pop()
        else:
            stack[-1][key] = _value(val)
    return root


def split_attached(data: bytes, search_bytes: int = 1 << 20) -> Tuple[str, int]:
    """(label text, byte offset just after the label records)."""
    m = _END_RE.search(data[:search_bytes])
    if not m:
        raise ValueError("no PDS3 label END line found")
    text = data[: m.end()].decode("ascii", errors="replace")
    rb = re.search(r"^\s*RECORD_BYTES\s*=\s*(\d+)", text, re.M)
    lr = re.search(r"^\s*LABEL_RECORDS\s*=\s*(\d+)", text, re.M)
    offset = int(lr.group(1)) * int(rb.group(1)) if rb and lr else m.end()
    return text, offset


def _image_span(label: Dict[str, Any]) -> Tuple[int, int, int, int, np.dtype]:
    img = label.get("IMAGE")
    if not isinstance(img, dict):
        raise ValueError("label has no IMAGE object")
    bands = int(img.get("BANDS", 1))
    if bands != 1:
        raise ValueError(f"only single-band images are supported (BANDS = {bands})")
    stype = str(img.get("SAMPLE_TYPE"))
    if stype not in _DTYPES:
        raise ValueError(f"unsupported SAMPLE_TYPE {stype!r}")
    bits = int(img.get("SAMPLE_BITS"))
    dtype = np.dtype(f"{_DTYPES[stype]}{bits // 8}")
    pointer = label.get("^IMAGE")
    if isinstance(pointer, dict) and str(pointer.get("unit", "")).upper() == "BYTES":
        start = int(pointer["value"]) - 1
    else:
        start = (int(pointer) - 1) * int(label["RECORD_BYTES"])
    lines, samples = int(img["LINES"]), int(img["LINE_SAMPLES"])
    return start, lines, samples, dtype.itemsize, dtype


def read_image(data: bytes, label: Dict[str, Any]) -> np.ndarray:
    start, lines, samples, size, dtype = _image_span(label)
    n = lines * samples
    if len(data) < start + n * size:
        raise ValueError(f"image data is shorter than the label says ({len(data)} < {start + n * size} bytes)")
    raw = np.frombuffer(data[start : start + n * size], dtype=dtype).reshape(lines, samples)
    img = label["IMAGE"]
    null = np.zeros(raw.shape, dtype=bool)
    for key in ("NULL_CONSTANT", "MISSING_CONSTANT", "CORE_NULL", "NULL"):
        if isinstance(img.get(key), (int, float)):
            null |= raw == img[key]
    out = raw.astype(np.float64) * float(img.get("SCALING_FACTOR", 1.0)) + float(img.get("OFFSET", 0.0))
    out[null | ~np.isfinite(out)] = np.nan
    return out.astype(np.float32)


def verify_md5(data: bytes, label: Dict[str, Any]) -> None:
    expected = str((label.get("IMAGE") or {}).get("MD5_CHECKSUM") or "").lower()
    if not expected:
        return
    start, lines, samples, size, _ = _image_span(label)
    actual = hashlib.md5(data[start : start + lines * samples * size]).hexdigest()
    if actual != expected:
        raise ValueError(f"image MD5 {actual} does not match the label's MD5_CHECKSUM {expected}")


def _lon180(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def map_bounds(label: Dict[str, Any]) -> Bounds:
    proj = label.get("IMAGE_MAP_PROJECTION") or {}
    west, east = float(proj["WESTERNMOST_LONGITUDE"]), float(proj["EASTERNMOST_LONGITUDE"])
    if str(proj.get("POSITIVE_LONGITUDE_DIRECTION", "EAST")).upper() == "WEST":
        west, east = -east, -west
    return Bounds(_lon180(west), float(proj["MINIMUM_LATITUDE"]), _lon180(east), float(proj["MAXIMUM_LATITUDE"]))


def reproject_to_lonlat(image: np.ndarray, proj: Dict[str, Any], target: Bounds, pixel_deg: float) -> Grid:
    """Nearest-neighbour resample of a map-projected image onto a lon/lat grid over ``target``."""
    ptype = str(proj.get("MAP_PROJECTION_TYPE", "")).upper()
    if ptype not in ("SINUSOIDAL", "EQUIRECTANGULAR", "SIMPLE CYLINDRICAL", "SIMPLE_CYLINDRICAL"):
        raise ValueError(f"unsupported map projection {ptype!r}")
    r_km = float(proj["A_AXIS_RADIUS"])
    scale = float(proj["MAP_SCALE"])
    lpo, spo = float(proj["LINE_PROJECTION_OFFSET"]), float(proj["SAMPLE_PROJECTION_OFFSET"])
    lon0 = float(proj["CENTER_LONGITUDE"])
    if str(proj.get("POSITIVE_LONGITUDE_DIRECTION", "EAST")).upper() != "EAST":
        raise ValueError("only east-positive map projections are supported")
    nx = max(1, int(round((target.east - target.west) / pixel_deg)))
    ny = max(1, int(round((target.north - target.south) / pixel_deg)))
    lons = target.west + (np.arange(nx) + 0.5) * (target.east - target.west) / nx
    lats = target.north - (np.arange(ny) + 0.5) * (target.north - target.south) / ny
    lon_g, lat_g = np.meshgrid(lons, lats)
    dlon = np.radians(((lon_g - lon0 + 180.0) % 360.0) - 180.0)
    phi = np.radians(lat_g)
    if ptype == "SINUSOIDAL":
        x = r_km * dlon * np.cos(phi)
    elif ptype == "EQUIRECTANGULAR":
        x = r_km * dlon * math.cos(math.radians(float(proj.get("CENTER_LATITUDE", 0.0))))
    else:
        x = r_km * dlon
    y = r_km * phi
    row = np.floor(lpo - y / scale).astype(np.int64)
    col = np.floor(spo + x / scale).astype(np.int64)
    h, w = image.shape
    inside = (row >= 0) & (row < h) & (col >= 0) & (col < w)
    out = np.full((ny, nx), np.nan, dtype=np.float32)
    out[inside] = image[row[inside], col[inside]]
    return Grid(out, target)


__all__ = ["map_bounds", "parse_label", "read_image", "reproject_to_lonlat", "split_attached", "verify_md5"]
