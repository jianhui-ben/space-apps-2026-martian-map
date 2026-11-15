"""Terrain measurements computed from an elevation grid: slope and roughness.

These are plain measurements (degrees, metres). No thresholds or good/bad
classes live here; those are scenario assumptions.
"""

from __future__ import annotations

import math
from typing import Dict, Optional, Tuple

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .grids import Grid
from .scenario import MARS_SPHERE_RADIUS_M


def pixel_size_m(grid: Grid, radius_m: float = MARS_SPHERE_RADIUS_M) -> Tuple[float, float]:
    """(east-west, north-south) pixel size in metres, east-west taken at the centre latitude."""
    px, py = grid.pixel_deg
    _, lat = grid.bounds.center()
    k = radius_m * math.pi / 180.0
    return px * k * math.cos(math.radians(lat)), py * k


def slope_deg(elev: np.ndarray, dx_m: float, dy_m: float) -> np.ndarray:
    """Slope in degrees by central differences. NaN on the border and wherever data is missing."""
    z = np.asarray(elev, dtype=np.float64)
    out = np.full(z.shape, np.nan)
    if z.shape[0] < 3 or z.shape[1] < 3:
        return out
    gx = (z[1:-1, 2:] - z[1:-1, :-2]) / (2.0 * dx_m)
    gy = (z[:-2, 1:-1] - z[2:, 1:-1]) / (2.0 * dy_m)
    s = np.degrees(np.arctan(np.hypot(gx, gy)))
    s[np.isnan(z[1:-1, 1:-1])] = np.nan  # the pixel itself must have data too
    out[1:-1, 1:-1] = s
    return out


def window_plane_fit(elev: np.ndarray, window: int, dx_m: float, dy_m: float,
                     chunk_rows: int = 64) -> Tuple[np.ndarray, np.ndarray]:
    """Fit a tilted plane in every ``window`` x ``window`` box (sliding one pixel at a time).

    Returns (slope of the fitted plane in degrees, RMS height left over after removing it in metres).
    This is the requirements' measure for local pad slope (BT-05) and detrended roughness (BT-08)
    with a 10 m window. Each box's result is stored at (first row + window // 2, first column +
    window // 2), so for an even window it sits just south-east of the box centre. Boxes with any
    missing height give NaN (they stay flagged, never "flat").
    """
    if window < 3:
        raise ValueError("window must be at least 3 pixels")
    z = np.asarray(elev, dtype=np.float64)
    out_s = np.full(z.shape, np.nan)
    out_r = np.full(z.shape, np.nan)
    if z.shape[0] < window or z.shape[1] < window:
        return out_s, out_r
    coords = np.arange(window, dtype=np.float64) - (window - 1) / 2.0
    xk = np.broadcast_to(coords, (window, window))  # column offset (east), pixels
    yk = xk.T  # row offset (south), pixels
    sxx = float((xk * xk).sum())
    view = sliding_window_view(z, (window, window))
    h0 = window // 2
    for r0 in range(0, view.shape[0], chunk_rows):
        win = view[r0 : r0 + chunk_rows]
        centred = win - win.mean(axis=(-2, -1), keepdims=True)
        b = (centred * xk).sum(axis=(-2, -1), keepdims=True) / sxx  # metres of height per pixel east
        c = (centred * yk).sum(axis=(-2, -1), keepdims=True) / sxx  # metres per pixel south
        res = centred - b * xk - c * yk
        rows = slice(h0 + r0, h0 + r0 + win.shape[0])
        cols = slice(h0, h0 + view.shape[1])
        out_r[rows, cols] = np.sqrt((res * res).mean(axis=(-2, -1)))
        out_s[rows, cols] = np.degrees(np.arctan(np.hypot(b[..., 0, 0] / dx_m, c[..., 0, 0] / dy_m)))
    return out_s, out_r


def roughness_m(elev: np.ndarray, window: int = 5, chunk_rows: int = 64) -> np.ndarray:
    """RMS height left over after fitting a tilted plane in each ``window`` x ``window`` box.

    A smooth slope of any angle scores 0; bumps, ridges and pits score high.
    NaN near the border and wherever the box has missing data.
    """
    return window_plane_fit(elev, window, 1.0, 1.0, chunk_rows)[1]


def noise_floor(vertical_precision_m: float, dx_m: float, window: Optional[int] = None) -> Dict[str, float]:
    """Smallest slope and roughness distinguishable from elevation noise of the given precision.

    ``slope_deg`` is for the pixel-to-pixel slope. With ``window`` (pixels), ``slope_window_deg`` is
    for the plane fitted over the window: noise averages out over its many cells, so it is far smaller.
    """
    sigma = float(vertical_precision_m)
    out: Dict[str, float] = {
        "slope_deg": math.degrees(math.atan(math.sqrt(2.0) * sigma / (2.0 * dx_m))),
        "roughness_m": sigma,
    }
    if window:
        sxx = window * window * (window * window - 1) / 12.0  # sum of squared offsets, in pixels^2
        out["slope_window_deg"] = math.degrees(math.atan(math.sqrt(2.0) * sigma / (dx_m * math.sqrt(sxx))))
        out["window_m"] = window * dx_m
    return out


__all__ = ["MARS_SPHERE_RADIUS_M", "noise_floor", "pixel_size_m", "roughness_m", "slope_deg", "window_plane_fit"]
