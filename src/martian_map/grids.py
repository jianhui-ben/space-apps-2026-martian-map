"""Gridded data (elevation, slope, ...) on a lon/lat box, plus raw-file IO.

Conventions used everywhere in the snapshot:

* ``values[0, :]`` is the **north** edge; columns run west to east.
* Files are raw little-endian (``.f32`` float32, ``.u8`` uint8) with no header;
  the catalog records width, height, bounds and pixel size.
* Missing data is NaN (float grids) or a recorded ``nodata`` value (uint8).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

from .catalog import file_record
from .http import atomic_write
from .scenario import Bounds

GRID_CRS = "IAU Mars 2000 sphere r=3396190 m, equirectangular (Esri wkid 104905)"
_DTYPES = {"f32": "<f4", "u8": "u1"}


@dataclass(frozen=True)
class Grid:
    values: np.ndarray
    bounds: Bounds

    @property
    def shape(self) -> Tuple[int, int]:
        return self.values.shape[0], self.values.shape[1]

    @property
    def pixel_deg(self) -> Tuple[float, float]:
        h, w = self.shape
        return ((self.bounds.east - self.bounds.west) / w, (self.bounds.north - self.bounds.south) / h)

    def index_of(self, lon: float, lat: float) -> Optional[Tuple[int, int]]:
        """(row, col) of the pixel containing the point, or None if outside."""
        if not self.bounds.contains(lon, lat):
            return None
        px, py = self.pixel_deg
        h, w = self.shape
        col = min(int(math.floor((lon - self.bounds.west) / px)), w - 1)
        row = min(int(math.floor((self.bounds.north - lat) / py)), h - 1)
        return row, col

    def sample(self, lon: float, lat: float) -> float:
        idx = self.index_of(lon, lat)
        if idx is None:
            return float("nan")
        return float(self.values[idx])

    def window(self, bounds: Bounds) -> "Grid":
        """Crop to the pixels overlapping ``bounds`` (snapped outward to pixel edges)."""
        inter = self.bounds.intersection(bounds)
        if inter is None:
            raise ValueError(f"window {bounds.as_list()} does not overlap grid {self.bounds.as_list()}")
        px, py = self.pixel_deg
        h, w = self.shape
        eps = 1e-9
        c0 = max(0, int(math.floor((inter.west - self.bounds.west) / px + eps)))
        c1 = min(w, int(math.ceil((inter.east - self.bounds.west) / px - eps)))
        r0 = max(0, int(math.floor((self.bounds.north - inter.north) / py + eps)))
        r1 = min(h, int(math.ceil((self.bounds.north - inter.south) / py - eps)))
        snapped = Bounds(
            self.bounds.west + c0 * px,
            self.bounds.north - r1 * py,
            self.bounds.west + c1 * px,
            self.bounds.north - r0 * py,
        )
        return Grid(self.values[r0:r1, c0:c1], snapped)


def parse_bsq_f32(body: bytes, width: int, height: int, trailer_max: int = 16) -> np.ndarray:
    """Little-endian float32, band-sequential, one band, row 0 = north.

    Trek's ImageServer appends a 1-bit-per-pixel validity mask (``ceil(w*h/8)``
    bytes, verified 2026-11-14 on 4x4, 8x8 and 16x3 exports); a short trailer of
    up to ``trailer_max`` bytes is also tolerated. Both are ignored: missing
    pixels carry -3.4e38, which callers turn into NaN.
    """
    n = width * height * 4
    extra = len(body) - n
    if not (0 <= extra <= trailer_max or extra == math.ceil(width * height / 8)):
        raise ValueError(f"export length {len(body)} bytes does not match {width}x{height} float32 ({n} bytes)")
    return np.frombuffer(body[:n], dtype="<f4").reshape(height, width).astype(np.float32)


def write_grid(grid: Grid, path: Path, data_root: Path, dtype: str, nodata: Any = None) -> Dict[str, Any]:
    if dtype not in _DTYPES:
        raise ValueError(f"unsupported grid dtype {dtype!r}")
    arr = np.ascontiguousarray(grid.values.astype(_DTYPES[dtype]))
    atomic_write(Path(path), arr.tobytes())
    h, w = grid.shape
    px, py = grid.pixel_deg
    return file_record(
        path,
        data_root,
        dtype,
        grid={
            "width": w,
            "height": h,
            "bounds": grid.bounds.as_list(),
            "pixel_deg": [px, py],
            "dtype": dtype,
            "byte_order": "little",
            "nodata": nodata if nodata is not None else ("NaN" if dtype == "f32" else None),
            "crs": GRID_CRS,
        },
    )


def read_grid(data_root: Path, rec: Dict[str, Any]) -> Grid:
    meta = rec["grid"]
    arr = np.fromfile(Path(data_root) / rec["path"], dtype=_DTYPES[meta["dtype"]])
    arr = arr.reshape(meta["height"], meta["width"])
    if meta["dtype"] == "f32":
        arr = arr.astype(np.float32)
    return Grid(arr, Bounds.from_list(meta["bounds"]))


def nodata_report(mask: np.ndarray, bounds: Bounds, block: int = 64, max_boxes: int = 20) -> Dict[str, Any]:
    """How much of the grid has data, and boxes that together cover every missing pixel."""
    h, w = mask.shape
    px = (bounds.east - bounds.west) / w
    py = (bounds.north - bounds.south) / h
    covered = 1.0 - float(mask.mean()) if mask.size else 0.0
    nby, nbx = math.ceil(h / block), math.ceil(w / block)
    boxes = []
    for br in range(nby):
        r0, r1 = br * block, min((br + 1) * block, h)
        has = [bool(mask[r0:r1, bc * block : min((bc + 1) * block, w)].any()) for bc in range(nbx)]
        bc = 0
        while bc < nbx:
            if not has[bc]:
                bc += 1
                continue
            start = bc
            while bc < nbx and has[bc]:
                bc += 1
            c0, c1 = start * block, min(bc * block, w)
            boxes.append([bounds.west + c0 * px, bounds.north - r1 * py, bounds.west + c1 * px, bounds.north - r0 * py])
    return {"covered_fraction": covered, "gaps": boxes[:max_boxes], "truncated": len(boxes) > max_boxes}


__all__ = ["GRID_CRS", "Grid", "nodata_report", "parse_bsq_f32", "read_grid", "write_grid"]
