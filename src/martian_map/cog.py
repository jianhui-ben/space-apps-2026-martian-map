"""Read part of a cloud-optimised GeoTIFF (COG) over HTTP, a few tiles at a time.

The USGS Astrogeology analysis-ready elevation models (HiRISE and CTX DTMs, found
through its STAC catalogue) are COGs on S3. They use an equirectangular projection
centred on 0 degrees with standard parallel 0 on a 3,396,190 m sphere, so pixel
positions convert to degrees with one scale factor (checked 2026-11-15 against
the STAC items' ``proj:transform`` for Jezero and Arcadia DTMs).

:class:`RangeReader` caches the file's first bytes (where a COG keeps its
directory and tile tables) and fetches the tiles a window needs in a few merged
range requests. :func:`read_cog_grid` turns a lon/lat box into a :class:`Grid`.
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, Tuple

import numpy as np

from .geotiff import georef, read_tags, read_window, window_chunks
from .grids import Grid
from .http import FetchError
from .scenario import Bounds

HEAD_BYTES = 1 << 16
GAP_BYTES = 1 << 18  # fetch the bytes between two tiles rather than start a new request
MAX_REQUEST_BYTES = 16 << 20
MARS_RADIUS_M = 3396190.0
VALID_RANGE = (-9000.0, 22000.0)  # metres; anything else (fill values, NaN) becomes NaN


class RangeReader:
    """``read(offset, length)`` over HTTP range requests, with the file's first bytes cached."""

    def __init__(self, ctx, url: str):
        self.ctx, self.url, self.requests = ctx, url, 0
        self.head = self._get(0, HEAD_BYTES, short_ok=True)
        self._blocks: Dict[int, bytes] = {}

    def _get(self, off: int, n: int, short_ok: bool = False) -> bytes:
        self.requests += 1
        res = self.ctx.fetcher.get_bytes(self.url, n + 1024, headers={"Range": f"bytes={off}-{off + n - 1}"},
                                         ok_status=(206,), timeout_s=60)
        if len(res.body) != n and not (short_ok and len(res.body) < n):
            raise FetchError(f"range {off}-{off + n - 1} of {self.url} returned {len(res.body)} bytes")
        return res.body

    def prefetch(self, ranges: Iterable[Tuple[int, int]]) -> None:
        """Fetch (offset, length) ranges before they are read, merging near neighbours into one request."""
        runs = []
        for off, n in sorted(r for r in ranges if r[1] > 0 and r[0] + r[1] > len(self.head)):
            if runs:
                start, length = runs[-1]
                if off - (start + length) <= GAP_BYTES and off + n - start <= MAX_REQUEST_BYTES:
                    runs[-1] = (start, max(length, off + n - start))
                    continue
            runs.append((off, n))
        for off, n in runs:
            self._blocks[off] = self._get(off, n)

    def __call__(self, off: int, n: int) -> bytes:
        if off + n <= len(self.head):
            return self.head[off:off + n]
        for start, data in self._blocks.items():
            if start <= off and off + n <= start + len(data):
                return data[off - start:off - start + n]
        return self._get(off, n)


def read_cog_grid(ctx, url: str, bounds: Bounds, decimate: int = 1, radius_m: float = MARS_RADIUS_M) -> Grid:
    """Heights covering ``bounds`` (snapped outward to whole pixels), NaN where the model has none.

    Parts of the box beyond the image are NaN too. ``decimate=k`` averages k x k pixel blocks;
    a block with any missing pixel is missing.
    """
    if decimate < 1:
        raise ValueError("decimate must be at least 1")
    read = RangeReader(ctx, url)
    bo, tags = read_tags(read)
    (sx, sy), tie, point = georef(tags)
    i, j, _, x, y, _ = tie
    west, north = x - i * sx, y + j * sy
    if point:
        west, north = west - sx / 2, north + sy / 2
    m = radius_m * math.pi / 180.0
    eps = 1e-6
    c0 = math.floor((bounds.west * m - west) / sx + eps)
    c1 = math.ceil((bounds.east * m - west) / sx - eps)
    r0 = math.floor((north - bounds.north * m) / sy + eps)
    r1 = math.ceil((north - bounds.south * m) / sy - eps)
    c1 += (c0 - c1) % decimate
    r1 += (r0 - r1) % decimate
    width, height = tags[256][0], tags[257][0]
    ca, cb, ra, rb = max(c0, 0), min(c1, width), max(r0, 0), min(r1, height)
    if ca >= cb or ra >= rb:
        raise ValueError(f"bounds {bounds.as_list()} does not overlap the image {url}")
    read.prefetch(window_chunks(bo, tags, ra, ca, rb - ra, cb - ca))
    values = read_window(read, bo, tags, ra, ca, rb - ra, cb - ca)[0].astype(np.float32)
    if 42113 in tags:
        try:
            values[values == np.float32(float(tags[42113][0]))] = np.nan
        except ValueError:
            pass
    with np.errstate(invalid="ignore"):
        values[~((values >= VALID_RANGE[0]) & (values <= VALID_RANGE[1]))] = np.nan
    out = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
    out[ra - r0:rb - r0, ca - c0:cb - c0] = values
    if decimate > 1:
        h, w = out.shape
        out = out.astype(np.float64).reshape(h // decimate, decimate, w // decimate, decimate).mean(axis=(1, 3))
        out = out.astype(np.float32)
    ctx.log(f"{url.rsplit('/', 1)[-1]}: {cb - ca}x{rb - ra} px in {read.requests} requests")
    return Grid(out, Bounds((west + c0 * sx) / m, (north - r1 * sy) / m, (west + c1 * sx) / m, (north - r0 * sy) / m))


__all__ = ["MARS_RADIUS_M", "RangeReader", "read_cog_grid"]
