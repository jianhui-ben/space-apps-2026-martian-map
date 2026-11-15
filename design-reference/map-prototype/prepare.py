"""PROTOTYPE - throwaway. Builds the data files for the 3D terrain-diorama prototype.

Fetches real NASA/JPL Mars Trek data for two candidate sites at Gale crater
(1 m elevation model + HiRISE photo mosaic), then derives slope, roughness,
textures and callout features for the browser viewer in ``web/``.

    .venv/bin/python -I design-reference/map-prototype/prepare.py          # fetch + build
    .venv/bin/python -I design-reference/map-prototype/prepare.py build    # rebuild from cache only

Downloads go to ``cache/raw/<site>/`` (git-ignored). Requests: 1 per second per
host, timeouts and size caps, no redirects, Trek hosts only. No API keys.
"""

from __future__ import annotations

import json
import math
import sys
import time
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))  # -I drops the script dir from sys.path; add the package explicitly

import numpy as np  # noqa: E402
import requests  # noqa: E402
from PIL import Image  # noqa: E402

from martian_map.geo import TileIndex, lonlat_to_tile, tile_bounds  # noqa: E402
from martian_map.trek import TrekClient, TrekLayer  # noqa: E402

Image.MAX_IMAGE_PIXELS = 64_000_000

R_MARS = 3396190.0
M_PER_DEG = math.pi / 180.0 * R_MARS
RAW = HERE / "cache" / "raw"
OUT = HERE / "web" / "data"

DEM_URL = "https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer/exportImage"
HIRISE = TrekLayer("curiosity_hirise_mosaic", "HiRISE mosaic, Curiosity region", "optical", fmt="png", max_zoom=16)
TILE_ZOOM = 16  # 0.64 m/px
TEX_PX = 3072  # photo texture size per site
GRID_N = 1000  # 2 m grid for the 3D mesh and hover readout (from the 1 m DEM)
DEM_N = 2000  # 1 m

# ---- Scenario ASSUMPTIONS (placeholders until the team decides) ----
BASE = {"name": "Assumed base: Bradbury Landing", "lon": 137.4416, "lat": -4.5895}
SITES = [
    {"id": "A", "name": "Aeolis Palus", "subtitle": "Crater floor at Bradbury Landing", "lon": 137.4416, "lat": -4.5895},
    {"id": "B", "name": "Mount Sharp foothills", "subtitle": "Curiosity's recent path", "lon": 137.388, "lat": -4.8045},
]
SITE_M = 2000.0
SLOPE_LIMIT_DEG = 5.0
FIT_MAX_STEEP_FRAC = 0.05
# Layout in metres from the layout's NW corner (x east, y south).
FOOTPRINTS = [
    {"id": "solar", "label": "Solar arrays", "x0": 0, "y0": 0, "x1": 400, "y1": 250, "height_m": 3},
    {"id": "dc", "label": "Data center", "x0": 20, "y0": 290, "x1": 140, "y1": 370, "height_m": 12},
    {"id": "heat", "label": "Heat rejection", "x0": 200, "y0": 280, "x1": 380, "y1": 380, "height_m": 4},
]
LAYOUT_W, LAYOUT_H = 400, 380
EDGE_MARGIN_M = 120

# Sequential ramp (dataviz reference palette, blue 100 -> 700).
BLUE = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
        "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]


def site_bbox(site):
    half_lat = SITE_M / 2 / M_PER_DEG
    half_lon = half_lat / math.cos(math.radians(site["lat"]))
    return {"west": site["lon"] - half_lon, "east": site["lon"] + half_lon,
            "south": site["lat"] - half_lat, "north": site["lat"] + half_lat}


# ---------------------------------------------------------------- fetch

def _get_capped(session, url, params, max_bytes, timeout=60):
    if not url.startswith("https://trek.nasa.gov/"):
        raise RuntimeError(f"refusing non-Trek URL {url}")
    resp = session.get(url, params=params, timeout=timeout, stream=True, allow_redirects=False)
    try:
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code} for {resp.url}")
        buf, total = [], 0
        for chunk in resp.iter_content(256 * 1024):
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"response over {max_bytes} bytes")
            buf.append(chunk)
        return b"".join(buf), resp.headers.get("Content-Type", "")
    finally:
        resp.close()


def tile_range(bb):
    nw = lonlat_to_tile(bb["north"], bb["west"], TILE_ZOOM)
    se = lonlat_to_tile(bb["south"], bb["east"], TILE_ZOOM)
    return range(nw.row, se.row + 1), range(nw.col, se.col + 1)


def fetch_site(site, session, client):
    d = RAW / site["id"]
    (d / "tiles").mkdir(parents=True, exist_ok=True)
    bb = site_bbox(site)
    dem_path = d / "dem_1m.tif"
    if not dem_path.exists():
        params = {
            "bbox": f"{bb['west']},{bb['south']},{bb['east']},{bb['north']}",
            "bboxSR": 104905, "imageSR": 104905, "size": f"{DEM_N},{DEM_N}",
            "format": "tiff", "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation", "f": "image",
        }
        body, ctype = _get_capped(session, DEM_URL, params, 40 * 1024 * 1024, timeout=120)
        if not ctype.startswith("image/tiff") or not body.startswith(b"II*\x00"):
            raise RuntimeError(f"DEM: unexpected response {ctype!r}")
        dem_path.write_bytes(body)
        print(f"[{site['id']}] DEM {len(body) / 1e6:.1f} MB", flush=True)
        time.sleep(1.0)
    rows, cols = tile_range(bb)
    todo = [(r, c) for r in rows for c in cols if not (d / "tiles" / f"{r}_{c}.png").exists()]
    print(f"[{site['id']}] {len(rows) * len(cols)} tiles, {len(todo)} to fetch", flush=True)
    for i, (r, c) in enumerate(todo):
        try:
            body, _ = client.get_tile_bytes(HIRISE, TileIndex(zoom=TILE_ZOOM, row=r, col=c))
            (d / "tiles" / f"{r}_{c}.png").write_bytes(body)
        except Exception as exc:  # a missing tile becomes a gap, filled with shaded relief
            (d / "tiles" / f"{r}_{c}.missing").write_text(str(exc))
        if i % 20 == 0:
            print(f"[{site['id']}] tile {i + 1}/{len(todo)}", flush=True)
        time.sleep(1.0)


# ---------------------------------------------------------------- build helpers

def shift_sum(a, r, axis, weights=None):
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r, r)
    p = np.pad(a, pad, mode="edge")
    n = a.shape[axis]
    out = np.zeros_like(a)
    for d in range(-r, r + 1):
        w = 1.0 if weights is None else weights(d)
        sl = [slice(None), slice(None)]
        sl[axis] = slice(r + d, r + d + n)
        out += w * p[tuple(sl)]
    return out


def plane_fit_5(z, dx, dy):
    """Slope (deg) and roughness (RMS m) from a least-squares plane in each 5 x 5 window."""
    r, n = 2, 25.0
    zc = z - z.mean()
    sx = shift_sum(zc, r, 1)
    sz = shift_sum(sx, r, 0)
    szz = shift_sum(shift_sum(zc * zc, r, 1), r, 0)
    sxz = shift_sum(shift_sum(zc, r, 1, lambda d: d * dx), r, 0)
    syz = shift_sum(sx, r, 0, lambda d: -d * dy)  # rows run south; make y north-positive
    sxx = 50.0 * dx * dx
    syy = 50.0 * dy * dy
    b, c = sxz / sxx, syz / syy
    ss = (szz - sz * sz / n) - b * b * sxx - c * c * syy
    rough = np.sqrt(np.maximum(ss, 0) / n)
    slope = np.degrees(np.arctan(np.hypot(b, c)))
    return slope.astype(np.float32), rough.astype(np.float32)


def block_mean(a, k):
    h, w = a.shape
    return a[: h // k * k, : w // k * k].reshape(h // k, k, w // k, k).mean(axis=(1, 3))


def hillshade(z, dx, dy, az=315.0, alt=35.0, exag=2.0):
    gy, gx = np.gradient(z * exag, dy, dx)
    gy = -gy  # north-positive
    azr, altr = math.radians(az), math.radians(alt)
    lx, ly, lz = math.sin(azr) * math.cos(altr), math.cos(azr) * math.cos(altr), math.sin(altr)
    nz = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    return np.clip((-gx * lx - gy * ly + lz) * nz, 0, 1)


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255.0


def ramp(values, vmax, shade):
    stops = np.stack([hex_rgb(h) for h in BLUE])
    t = np.clip(values / vmax, 0, 1) * (len(stops) - 1)
    i0 = np.floor(t).astype(int).clip(0, len(stops) - 2)
    f = (t - i0)[..., None]
    rgb = stops[i0] * (1 - f) + stops[i0 + 1] * f
    return rgb * (0.62 + 0.38 * shade[..., None])


def save_rgb(path, rgb, size=None, quality=None):
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    if quality:
        im.save(path, quality=quality, optimize=True)
    else:
        im.save(path, optimize=True)


def stitch_photo(site, bb, fallback):
    d = RAW / site["id"] / "tiles"
    rows, cols = tile_range(bb)
    H, W = len(rows) * 256, len(cols) * 256
    grey = np.zeros((H, W), np.float32)
    alpha = np.zeros((H, W), np.float32)
    for i, r in enumerate(rows):
        for j, c in enumerate(cols):
            p = d / f"{r}_{c}.png"
            if p.exists():
                la = np.asarray(Image.open(p).convert("LA"), dtype=np.float32) / 255.0
                grey[i * 256:(i + 1) * 256, j * 256:(j + 1) * 256] = la[..., 0]
                alpha[i * 256:(i + 1) * 256, j * 256:(j + 1) * 256] = la[..., 1]
    tb = tile_bounds(TileIndex(zoom=TILE_ZOOM, row=rows[0], col=cols[0]))
    span = tb.east - tb.west
    x0 = (bb["west"] - tb.west) / span * 256
    x1 = (bb["east"] - tb.west) / span * 256
    y0 = (tb.north - bb["north"]) / span * 256
    y1 = (tb.north - bb["south"]) / span * 256
    box = (x0, y0, x1, y1)
    g = np.asarray(Image.fromarray(grey).resize((TEX_PX, TEX_PX), Image.LANCZOS, box=box), np.float32)
    a = np.asarray(Image.fromarray(alpha).resize((TEX_PX, TEX_PX), Image.BILINEAR, box=box), np.float32)
    valid = a > 0.5
    coverage = float(valid.mean())
    if valid.any():
        lo, hi = np.percentile(g[valid], [0.5, 99.5])
        g = np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1)
    fb = np.asarray(Image.fromarray(fallback.astype(np.float32)).resize((TEX_PX, TEX_PX), Image.BILINEAR), np.float32)
    g = np.where(valid, g, fb * 0.8 + 0.1)
    return g, coverage


def tint(g):
    # Cosmetic Mars tint for a greyscale photo: dark rust -> ochre -> pale tan.
    stops = np.array([[0.16, 0.08, 0.05], [0.47, 0.24, 0.13], [0.74, 0.45, 0.27], [0.88, 0.66, 0.46], [0.98, 0.88, 0.74]])
    t = np.clip(g, 0, 1) * (len(stops) - 1)
    i0 = np.floor(t).astype(int).clip(0, len(stops) - 2)
    f = (t - i0)[..., None]
    return stops[i0] * (1 - f) + stops[i0 + 1] * f


def components(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    sizes = [0]
    for sy in range(h):
        row = mask[sy]
        for sx in np.flatnonzero(row & (lab[sy] == 0)):
            if lab[sy, sx]:
                continue
            k = len(sizes)
            q = deque([(sy, sx)])
            lab[sy, sx] = k
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = k
                        q.append((yy, xx))
            sizes.append(n)
    return lab, sizes


def integral(a):
    return np.pad(np.cumsum(np.cumsum(a, 0), 1), ((1, 0), (1, 0)))


def rect_sum(ii, y0, x0, y1, x1):
    return ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0]


# ---------------------------------------------------------------- build

def analyse(site):
    bb = site_bbox(site)
    z = np.asarray(Image.open(RAW / site["id"] / "dem_1m.tif"), dtype=np.float64)
    if z.shape != (DEM_N, DEM_N) or not np.isfinite(z).all() or (np.abs(z) > 1e5).any():
        raise RuntimeError(f"[{site['id']}] DEM has gaps or wrong shape {z.shape}")
    dx = (bb["east"] - bb["west"]) * M_PER_DEG * math.cos(math.radians(site["lat"])) / DEM_N
    dy = (bb["north"] - bb["south"]) * M_PER_DEG / DEM_N
    slope, rough = plane_fit_5(z, dx, dy)
    return {"site": site, "bb": bb, "z": z, "dx": dx, "dy": dy, "slope": slope, "rough": rough}


def build_site(s, slope_max, rough_max):
    site, bb, z, dx, dy, slope, rough = (s[k] for k in ("site", "bb", "z", "dx", "dy", "slope", "rough"))
    out = OUT / site["id"]
    out.mkdir(parents=True, exist_ok=True)
    W, H = DEM_N * dx, DEM_N * dy
    k = DEM_N // GRID_N

    zg = block_mean(z, k).astype(np.float32)
    zg.astype("<f4").tofile(out / "elev_2m.f32")
    block_mean(slope, k).astype("<f4").tofile(out / "slope_2m.f32")
    block_mean(rough, k).astype("<f4").tofile(out / "rough_2m.f32")

    hs = hillshade(z, dx, dy)
    save_rgb(out / "hillshade.jpg", np.repeat(hs[..., None], 3, 2) * 0.85 + 0.1, quality=88)
    save_rgb(out / "slope.jpg", ramp(slope, slope_max, hs), quality=90)
    save_rgb(out / "rough.jpg", ramp(rough, rough_max, hs), quality=90)
    g, coverage = stitch_photo(site, bb, hs)
    save_rgb(out / "photo_grey.jpg", np.repeat(g[..., None], 3, 2), quality=88)
    save_rgb(out / "photo_tint.jpg", tint(g), quality=88)

    # --- features on a 5 m grid ---
    c5 = 5 // 1
    s5 = block_mean(slope, c5)
    m5 = DEM_N // c5
    cell5x, cell5y = dx * c5, dy * c5
    flat = s5 <= SLOPE_LIMIT_DEG
    lab, sizes = components(flat)
    features = []
    if len(sizes) > 1:
        kbig = int(np.argmax(sizes))
        ys, xs = np.nonzero(lab == kbig)
        cy, cx = ys.mean(), xs.mean()
        j = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
        features.append({"kind": "flat", "title": "Largest connected area under 5°",
                         "value": f"{sizes[kbig] * cell5x * cell5y / 1e4:.0f} ha",
                         "x": (xs[j] + 0.5) * cell5x, "y": (ys[j] + 0.5) * cell5y, "evidence": "derived"})
    flat_frac = float(flat.mean())

    s10 = block_mean(slope, 10)
    r10 = block_mean(rough, 10)
    iy, ix = np.unravel_index(int(np.argmax(s10)), s10.shape)
    features.append({"kind": "steep", "title": "Steepest 10 m patch", "value": f"{s10[iy, ix]:.0f}°",
                     "x": (ix + 0.5) * dx * 10, "y": (iy + 0.5) * dy * 10, "evidence": "derived"})
    iy, ix = np.unravel_index(int(np.argmax(r10)), r10.shape)
    features.append({"kind": "rough", "title": "Roughest 10 m patch", "value": f"{r10[iy, ix]:.2f} m RMS",
                     "x": (ix + 0.5) * dx * 10, "y": (iy + 0.5) * dy * 10, "evidence": "derived"})

    # --- layout placement: least steep ground for the whole layout (placeholder sizes) ---
    steep_ii = integral((s5 > SLOPE_LIMIT_DEG).astype(np.float64))
    fp_cells = [(round(f["y0"] / cell5y), round(f["x0"] / cell5x), round(f["y1"] / cell5y), round(f["x1"] / cell5x)) for f in FOOTPRINTS]
    lw, lh = round(LAYOUT_W / cell5x), round(LAYOUT_H / cell5y)
    mg = round(EDGE_MARGIN_M / cell5x)
    best = None
    for oy in range(mg, m5 - lh - mg, 2):
        for ox in range(mg, m5 - lw - mg, 2):
            steep = sum(rect_sum(steep_ii, oy + a, ox + b, oy + c, ox + d) for a, b, c, d in fp_cells)
            dist = math.hypot(ox + lw / 2 - m5 / 2, oy + lh / 2 - m5 / 2)
            key = (steep, dist)
            if best is None or key < best[0]:
                best = (key, ox, oy)
    _, ox, oy = best
    lx0, ly0 = ox * cell5x, oy * cell5y
    footprints = []
    for f in FOOTPRINTS:
        x0, y0, x1, y1 = lx0 + f["x0"], ly0 + f["y0"], lx0 + f["x1"], ly0 + f["y1"]
        i0, i1, j0, j1 = int(y0 / dy), int(y1 / dy), int(x0 / dx), int(x1 / dx)
        zs = z[i0:i1, j0:j1]
        ss = s5[int(y0 / cell5y):int(y1 / cell5y), int(x0 / cell5x):int(x1 / cell5x)]  # same 5 m slope the placement used
        steep_frac = float((ss > SLOPE_LIMIT_DEG).mean())
        footprints.append({**f, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                           "pad_elev": float(np.median(zs)), "steep_frac": steep_frac,
                           "mean_slope": float(ss.mean()), "p99_slope": float(np.percentile(ss, 99)),
                           "relief_m": float(np.percentile(zs, 99.5) - np.percentile(zs, 0.5)),
                           "fits": steep_frac <= FIT_MAX_STEEP_FRAC, "evidence": "assumption"})

    # --- transect W-E through the data center ---
    dcf = next(f for f in footprints if f["id"] == "dc")
    ty = (dcf["y0"] + dcf["y1"]) / 2
    row = min(int(ty / (dy * k)), GRID_N - 1)
    step = 2
    tx = ((np.arange(0, GRID_N, step) + 0.5) * dx * k).round(1)
    t_el = zg[row, ::step]
    t_sl = block_mean(slope, k)[row, ::step]

    # --- base location relative to the site ---
    bx = (BASE["lon"] - bb["west"]) / (bb["east"] - bb["west"]) * W
    by = (bb["north"] - BASE["lat"]) / (bb["north"] - bb["south"]) * H
    cx, cy = W / 2, H / 2
    dist = math.hypot(bx - cx, by - cy)
    bearing = (math.degrees(math.atan2(bx - cx, -(by - cy))) + 360) % 360
    inside = 0 <= bx <= W and 0 <= by <= H

    meta = {
        "id": site["id"], "name": site["name"], "subtitle": site["subtitle"],
        "center": {"lon": site["lon"], "lat": site["lat"]}, "bbox": bb,
        "size_m": [W, H], "grid": {"n": GRID_N, "cell_m": [dx * k, dy * k]},
        "elev": {"min": float(z.min()), "max": float(z.max()), "mean": float(z.mean())},
        "stats": {"relief_m": float(np.percentile(z, 99.5) - np.percentile(z, 0.5)),
                  "median_slope": float(np.median(slope)), "p90_slope": float(np.percentile(slope, 90)),
                  "median_rough": float(np.median(rough)), "flat_frac": flat_frac},
        "photo": {"coverage": coverage, "layer": HIRISE.layer_id, "zoom": TILE_ZOOM},
        "features": features, "footprints": footprints,
        "transect": {"y": ty, "x": tx.tolist(), "elev": [round(float(v), 2) for v in t_el],
                     "slope": [round(float(v), 2) for v in t_sl]},
        "base": {**BASE, "inside": inside, "x": bx, "y": by, "dist_km": dist / 1000, "bearing_deg": bearing},
        "scales": {"slope_max": slope_max, "rough_max": rough_max},
        "assumptions": {"slope_limit_deg": SLOPE_LIMIT_DEG, "fit_max_steep_frac": FIT_MAX_STEEP_FRAC,
                        "note": "Site boxes, base, footprint sizes and the 5° limit are placeholders, not agreed requirements."},
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"[{site['id']}] built: relief {meta['stats']['relief_m']:.1f} m, median slope {meta['stats']['median_slope']:.1f}°, "
          f"flat {flat_frac:.0%}, photo coverage {coverage:.0%}, fits {[f['fits'] for f in footprints]}", flush=True)


def build():
    analysed = [analyse(s) for s in SITES]
    slope_max = 30.0
    rough_max = float(np.ceil(max(np.percentile(a["rough"], 99) for a in analysed) * 20) / 20)
    for a in analysed:
        build_site(a, slope_max, rough_max)
    (OUT / "sites.json").write_text(json.dumps({"sites": [s["id"] for s in SITES], "base": BASE}, indent=1))


def main(argv):
    mode = argv[1] if len(argv) > 1 else "all"
    if mode in ("all", "fetch"):
        session = requests.Session()
        session.headers["User-Agent"] = "martian-map-prototype (+https://github.com/jianhui-ben/space-apps-2026-martian-map)"
        client = TrekClient(session=session)
        for s in SITES:
            fetch_site(s, session, client)
    if mode in ("all", "build"):
        build()


if __name__ == "__main__":
    main(sys.argv)
