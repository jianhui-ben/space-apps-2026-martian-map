"""Skyline (horizon) angles: how high the terrain rises in each direction from a point.

Rays are marched outward over several elevation grids, finest first. Each
:class:`Level` says how far out its grid is used and at what step; a coarser
level never overrides a finer one where the finer one applies. Mars's
curvature is included (``drop = d^2 / 2R``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence, Tuple

import numpy as np

from .grids import Grid
from .scenario import MARS_SPHERE_RADIUS_M, Bounds

STEP_DEG = 0.25
NODATA = 255


@dataclass(frozen=True)
class Level:
    grid: Grid
    step_m: float
    max_distance_m: float
    offset_m: float = 0.0  # added to this grid's heights (e.g. a measured alignment offset)


def _sample(grid: Grid, lons: np.ndarray, lats: np.ndarray) -> np.ndarray:
    px, py = grid.pixel_deg
    h, w = grid.shape
    col = np.floor((lons - grid.bounds.west) / px).astype(np.int64)
    row = np.floor((grid.bounds.north - lats) / py).astype(np.int64)
    inside = (col >= 0) & (col < w) & (row >= 0) & (row < h)
    out = np.full(lons.shape, np.nan)
    out[inside] = grid.values[row[inside], col[inside]]
    return out


class _Rays:
    """Per-level ray offsets, computed once and reused for every point."""

    def __init__(self, levels: Sequence[Level], lat: float, n_azimuth: int, radius_m: float):
        az = np.radians(np.arange(n_azimuth) * 360.0 / n_azimuth)
        cos_lat = math.cos(math.radians(lat))
        self.levels = list(levels)
        self.radius_m = radius_m
        self.parts = []
        for lev in self.levels:
            d = np.arange(lev.step_m, lev.max_distance_m + 1e-9, lev.step_m)
            dlat = np.degrees(np.outer(np.cos(az), d) / radius_m)
            dlon = np.degrees(np.outer(np.sin(az), d) / (radius_m * cos_lat))
            drop = d * d / (2.0 * radius_m)
            self.parts.append((d, dlat, dlon, drop))

    def profile(self, lon: float, lat: float, observer_height_m: float) -> np.ndarray:
        ground = float("nan")
        for lev in self.levels:
            v = _sample(lev.grid, np.array([lon]), np.array([lat]))[0]
            if np.isfinite(v):
                ground = v + lev.offset_m
                break
        n_az = self.parts[0][1].shape[0] if self.parts else 360
        if not np.isfinite(ground):
            return np.full(n_az, np.nan)
        h0 = ground + observer_height_m
        best = np.full(n_az, -90.0)
        for k, (lev, (d, dlat, dlon, drop)) in enumerate(zip(self.levels, self.parts)):
            lons = lon + dlon
            lats = lat + dlat
            h = _sample(lev.grid, lons, lats) + lev.offset_m
            for finer, (fd, *_rest) in zip(self.levels[:k], self.parts[:k]):
                b = finer.grid.bounds
                covered = (lons >= b.west) & (lons <= b.east) & (lats >= b.south) & (lats <= b.north)
                covered &= d[None, :] <= finer.max_distance_m
                h[covered] = np.nan
            angle = np.degrees(np.arctan((h - h0 - drop[None, :]) / d[None, :]))
            angle[~np.isfinite(angle)] = -90.0
            best = np.maximum(best, angle.max(axis=1))
        return best


def horizon_profile(
    levels: Sequence[Level],
    lon: float,
    lat: float,
    observer_height_m: float = 2.0,
    n_azimuth: int = 360,
    radius_m: float = MARS_SPHERE_RADIUS_M,
) -> np.ndarray:
    """Skyline angle (degrees) per azimuth (0 = north, clockwise). NaN if the point has no ground height."""
    return _Rays(levels, lat, n_azimuth, radius_m).profile(lon, lat, observer_height_m)


def horizon_grid(
    levels: Sequence[Level],
    site_bounds: Bounds,
    spacing_m: float = 100.0,
    observer_height_m: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[List[int]]]:
    """Skylines at the centres of ``spacing_m`` cells across a site.

    Returns (uint8 array [rows, cols, 360] in 0.25 degree steps, cell-centre
    longitudes, cell-centre latitudes north to south, [row, col] of cells
    with no ground height, whose values are all 255).
    """
    w_m, h_m = site_bounds.size_m()
    nx = max(1, math.ceil(w_m / spacing_m - 1e-6))
    ny = max(1, math.ceil(h_m / spacing_m - 1e-6))
    lons = site_bounds.west + (np.arange(nx) + 0.5) * (site_bounds.east - site_bounds.west) / nx
    lats = site_bounds.north - (np.arange(ny) + 0.5) * (site_bounds.north - site_bounds.south) / ny
    rays = _Rays(levels, float(np.mean(lats)), 360, MARS_SPHERE_RADIUS_M)
    out = np.zeros((ny, nx, 360), dtype=np.uint8)
    missing: List[List[int]] = []
    for r, lat in enumerate(lats):
        for c, lon in enumerate(lons):
            prof = rays.profile(float(lon), float(lat), observer_height_m)
            if not np.isfinite(prof).any():
                out[r, c] = NODATA
                missing.append([r, c])
                continue
            out[r, c] = np.clip(np.rint(np.nan_to_num(prof, nan=0.0) / STEP_DEG), 0, NODATA - 1).astype(np.uint8)
    return out, lons, lats, missing


__all__ = ["Level", "NODATA", "STEP_DEG", "horizon_grid", "horizon_profile"]
