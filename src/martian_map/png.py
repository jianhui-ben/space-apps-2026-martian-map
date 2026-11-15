"""Minimal PNG writer and colour ramps for map overlays (no Pillow needed).

Overlays are what the web app drapes on the map: a PNG plus its lon/lat
bounds and a legend. Missing data is always fully transparent.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path
from typing import Any, Dict, Sequence, Tuple

import numpy as np

from .catalog import file_record
from .http import atomic_write
from .scenario import Bounds

Stop = Tuple[float, Tuple[int, int, int]]


def _chunk(ctype: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body) & 0xFFFFFFFF)


def encode_png_rgba(rgba: np.ndarray) -> bytes:
    if rgba.ndim != 3 or rgba.shape[2] != 4 or rgba.dtype != np.uint8:
        raise ValueError("expected an (H, W, 4) uint8 array")
    h, w, _ = rgba.shape
    raw = np.empty((h, w * 4 + 1), dtype=np.uint8)
    raw[:, 0] = 0  # filter type 0 (none) on every row
    raw[:, 1:] = rgba.reshape(h, w * 4)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw.tobytes(), 6))
        + _chunk(b"IEND", b"")
    )


def colorize(values: np.ndarray, stops: Sequence[Stop], mask: np.ndarray) -> np.ndarray:
    """Linear colour ramp between stops (clamped). Masked or non-finite pixels get alpha 0."""
    xs = [float(v) for v, _ in stops]
    if any(b <= a for a, b in zip(xs, xs[1:])):
        raise ValueError("colour stops must be strictly increasing")
    v = np.asarray(values, dtype=np.float64)
    hide = np.asarray(mask, dtype=bool) | ~np.isfinite(v)
    vv = np.where(hide, xs[0], v)
    rgba = np.zeros(v.shape + (4,), dtype=np.uint8)
    for ch in range(3):
        ys = [float(c[ch]) for _, c in stops]
        rgba[..., ch] = np.clip(np.rint(np.interp(vv, xs, ys)), 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(hide, 0, 255).astype(np.uint8)
    return rgba


def _hex(rgb: Tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def write_overlay(
    values: np.ndarray,
    mask: np.ndarray,
    bounds: Bounds,
    path: Path,
    data_root: Path,
    stops: Sequence[Stop],
    unit: str,
    max_px: int = 2048,
) -> Dict[str, Any]:
    h, w = values.shape
    step = max(1, math.ceil(max(h, w) / max_px))
    rgba = colorize(values[::step, ::step], stops, mask[::step, ::step])
    atomic_write(Path(path), encode_png_rgba(rgba))
    return file_record(
        path,
        data_root,
        "png",
        bounds=bounds.as_list(),
        legend={"unit": unit, "stops": [[float(v), _hex(c)] for v, c in stops]},
    )


__all__ = ["colorize", "encode_png_rgba", "write_overlay"]
