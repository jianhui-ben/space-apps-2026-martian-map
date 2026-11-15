"""Drives the in-page test runner and app flows in headless Chromium."""

from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import pytest

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    pytest.skip("playwright is not installed", allow_module_level=True)

WEB = Path(__file__).resolve().parent.parent / "web"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
CHROMIUM_ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
]


def _load_serve():
    spec = importlib.util.spec_from_file_location("web_serve", WEB / "serve.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def server_url():
    data = os.environ.get("MARTIAN_MAP_DATA")
    srv = _load_serve().make_server(WEB, Path(data) if data else None)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:%d" % srv.server_address[1]
    srv.shutdown()
    srv.server_close()


@pytest.fixture(scope="session")
def _browser():
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=CHROMIUM_ARGS)
        except Exception as exc:  # browser not installed or cannot start
            pytest.skip("Chromium will not launch: %s" % str(exc).splitlines()[0])
        yield browser
        browser.close()


@pytest.fixture
def page(_browser):
    pg = _browser.new_page()
    pg.console_errors = []
    pg.on(
        "console",
        lambda m: pg.console_errors.append(m.text) if m.type == "error" else None,
    )
    pg.on("pageerror", lambda e: pg.console_errors.append("pageerror: %s" % e))
    yield pg
    pg.close()


def run_suite(page, url, suite, grep=None, timeout_ms=120000):
    """Open the runner page for a suite and return window.__results."""
    target = "%s/tests/runner.html?suite=%s" % (url, suite)
    if grep:
        target += "&grep=%s" % grep
    page.goto(target)
    page.wait_for_function("window.__results && window.__results.done", timeout=timeout_ms)
    return page.evaluate("window.__results")


def wait_ready(page, timeout_ms=120000):
    """Wait for the app's window.__map.ready promise."""
    page.wait_for_function("window.__map !== undefined", timeout=timeout_ms)
    page.evaluate("window.__map.ready")


def record_request_hosts(page):
    """Return a live set of hostnames of every request the page makes."""
    hosts = set()
    page.on("request", lambda r: hosts.add(urlparse(r.url).hostname))
    return hosts


def test_unit_suite(page, server_url):
    r = run_suite(page, server_url, "unit")
    assert r["failed"] == [] and r["passed"] > 0 and page.console_errors == []


def test_real_suite(page, server_url):
    if not os.environ.get("MARTIAN_MAP_DATA"):
        pytest.skip("MARTIAN_MAP_DATA is not set")
    r = run_suite(page, server_url, "real")
    assert r["failed"] == [] and r["passed"] > 0 and page.console_errors == []


# ---------- globe (Task 7) ----------
# Headless SwiftShader draws 1-5 frames per second and Trek tiles take 0.5-1 s each, so waits are long.

GLOBE_HOSTS = {"127.0.0.1", "trek.nasa.gov"}
TILE_WAIT_MS = 90000
GALE = (137.44, -4.57)  # inside the HiRISE box


def _open_globe(page, server_url, query=""):
    if not os.environ.get("MARTIAN_MAP_DATA"):
        pytest.skip("MARTIAN_MAP_DATA is not set")
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(server_url + "/" + query)
    wait_ready(page, timeout_ms=60000)
    _start(page)  # landing -> the intake -> Find area -> the facility step -> "Assess locations →" (Task 9); the defaults


def _find_area(page):
    """The intake's "Find area" -> the facility step, ready for location matching (the sizing may wait for its coefficients)."""
    page.locator("#brief-find").click()
    page.locator("#facility").wait_for(state="visible", timeout=30000)
    page.locator("#facility-assess").wait_for(state="visible", timeout=10000)


def _to_facility(page):
    """Landing -> the Twin Trails construction intake, its editable defaults as they are -> Find area -> the facility step
    (Task 9)."""
    page.locator("#landing-start").click()
    page.locator("#brief").wait_for(state="visible", timeout=10000)
    _find_area(page)


def _start(page):
    _to_facility(page)
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    page.locator("#panel").wait_for(state="visible", timeout=10000)


def _layers(page):
    return page.evaluate(
        "Object.fromEntries(Object.entries(__map.globe.stats.layers).map(([k, v]) => [k, {...v}]))"
    )


def settle_tiles(page, quiet_s=4.0, timeout_s=90):
    """Wait until the globe's tile request counts stop changing (the spike's settle())."""
    t0 = time.time()
    last, since = None, time.time()
    while time.time() - t0 < timeout_s:
        layers = _layers(page)
        now = (sum(v["ok"] + v["bad"] for v in layers.values()), sum(v["pending"] for v in layers.values()))
        if now != last or now[1] > 0:
            last, since = now, time.time()
        elif time.time() - since >= quiet_s:
            return True
        page.wait_for_timeout(500)
    return False


def _fly(page, lon, lat, alt_m):
    page.evaluate("([lon, lat, alt]) => __map.globe.flyTo(lon, lat, alt, 0)", [lon, lat, alt_m])


def _shot(page, name):
    ARTIFACTS.mkdir(exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / name))


def test_globe_loads_without_cdns(page, server_url):
    hosts = record_request_hosts(page)
    _open_globe(page, server_url, "?debug=1")
    page.wait_for_function("__map.globe.stats.layers.viking.ok > 4", timeout=TILE_WAIT_MS)
    settle_tiles(page)
    _shot(page, "globe-whole.png")
    alt = page.evaluate("__map.globe.altitude()")
    assert 8.5e6 < alt < 9.5e6, alt
    assert hosts <= GLOBE_HOSTS, hosts
    assert "trek.nasa.gov" in hosts
    assert page.console_errors == []


def test_globe_zoom_reaches_ctx(page, server_url):
    _open_globe(page, server_url)
    box = page.evaluate("__map.catalog.areas.gale_region")
    _fly(page, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 30000)  # mostly CTX, HiRISE edge at the top
    page.wait_for_function("__map.globe.stats.layers.ctx.ok > 4", timeout=TILE_WAIT_MS)
    settle_tiles(page)
    _shot(page, "globe-ctx.png")
    layers = _layers(page)
    assert layers["ctx"]["maxZ"] >= 11, layers  # CTX tops out at z12
    # Task 9c: the warm grade is the Viking layer's only; the CTX photo over it is untouched
    at = [440, 360]  # the middle of the map, inside the CTX box
    graded = page.evaluate(_PIXEL_JS, at)
    page.evaluate("__map.globe.grade.value.set(1, 1, 1, 1)")  # the identity grade
    plain = page.evaluate(_PIXEL_JS, at)
    page.evaluate("__map.globe.setGrade(true)")
    assert max(abs(a - b) for a, b in zip(graded, plain)) <= 1, (graded, plain)
    assert 25000 < page.evaluate("__map.globe.altitude()") < 35000
    assert page.console_errors == []


def test_globe_zoom_reaches_hirise(page, server_url):
    _open_globe(page, server_url)
    # Task 9b: the canvas is the map area right of the panel (880 x 720 here, not 1280 x 800), so the same screen
    # detail, and HiRISE's z15, needs a slightly lower view than the 5 km used over the full window
    _fly(page, *GALE, 4000)
    page.wait_for_function("__map.globe.stats.layers.hirise.maxZ >= 15", timeout=TILE_WAIT_MS)
    settle_tiles(page)
    _shot(page, "globe-hirise.png")
    layers = _layers(page)
    assert layers["hirise"]["maxZ"] >= 15 and layers["hirise"]["ok"] > 0, layers
    assert page.console_errors == []


_PIXEL_JS = """([x, y]) => {
    const g = __map.globe, gl = g.renderer.getContext(), px = new Uint8Array(4);
    g.renderer.render(g.scene, g.camera);
    gl.readPixels(x, gl.drawingBufferHeight - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px.slice(0, 3));
}"""


def test_globe_relief_toggle(page, server_url):
    _open_globe(page, server_url)
    assert page.evaluate("__map.globe.overlays.relief.opacity") == 0  # off at start
    page.wait_for_function("__map.globe.stats.layers.relief.ok > 4", timeout=TILE_WAIT_MS)
    settle_tiles(page)
    at = [500, 300]  # on the planet, west of Gale, outside the CTX box
    off = page.evaluate(_PIXEL_JS, at)
    page.evaluate("__map.globe.setRelief(true)")
    assert page.evaluate("__map.globe.overlays.relief.opacity") == 0.6
    on = page.evaluate(_PIXEL_JS, at)
    page.evaluate("__map.globe.setRelief(false)")
    assert page.evaluate("__map.globe.overlays.relief.opacity") == 0
    again = page.evaluate(_PIXEL_JS, at)
    dist = lambda a, b: max(abs(p - q) for p, q in zip(a, b))
    assert dist(off, on) > 20, (off, on)  # the shader honours run-time opacity
    assert dist(off, again) <= 2, (off, again)
    assert page.console_errors == []


def test_three_pins_present(page, server_url):
    _open_globe(page, server_url)
    pins = page.locator(".pin")
    assert pins.count() == 3
    texts = {k: page.locator(".pin[data-region=%s]" % k).inner_text() for k in ("gale", "jezero", "arcadia")}
    assert "Gale" in texts["gale"] and "needs confirmation" not in texts["gale"]
    assert "Jezero" in texts["jezero"] and "needs confirmation" not in texts["jezero"]
    assert "Arcadia" in texts["arcadia"] and "needs confirmation" not in texts["arcadia"]
    for k in texts:  # all three face the camera in the opening view
        page.locator(".pin[data-region=%s]" % k).wait_for(state="visible", timeout=30000)
    box = page.evaluate("__map.catalog.areas.gale_region")
    page.locator(".pin[data-region=gale]").click()
    page.wait_for_function(
        """([lon, lat]) => { const p = __map.globe.camera.position, d = 180 / Math.PI;
            return Math.abs(__map.globe.altitude() - 250000) < 5000 && Math.abs(Math.atan2(p.y, p.x) * d - lon) < 0.05
                && Math.abs(Math.asin(p.z / p.length()) * d - lat) < 0.05; }""",
        arg=[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], timeout=60000)  # over the gale_region centre
    page.locator(".pin[data-region=jezero]").wait_for(state="hidden", timeout=30000)  # over the horizon
    assert page.console_errors == []


def test_globe_region_pins_from_catalog(page, server_url):
    _open_globe(page, server_url)
    assert page.locator(".pin").count() == 3
    texts = page.locator(".pin").all_inner_texts()
    joined = "\n".join(texts)
    for name in ("Gale crater", "Jezero crater", "Arcadia Planitia"):
        assert name in joined, (name, texts)
    assert "needs confirmation" not in joined, texts
    assert "3 sites" in page.locator(".pin[data-region=gale]").inner_text()
    assert "2 sites" in page.locator(".pin[data-region=jezero]").inner_text()
    assert page.evaluate("__map.catalog.regions.map(r => r.id).sort().join()") == "arcadia,gale,jezero"
    page.locator(".pin[data-region=arcadia]").click()
    page.wait_for_function(
        """() => { const p = __map.globe.camera.position, d = 180 / Math.PI, lon = Math.atan2(p.y, p.x) * d;
            return Math.abs(__map.globe.altitude() - 250000) < 5000 && Math.abs(lon - (-167.1)) < 0.05; }""",
        timeout=60000)
    assert page.console_errors == []


def test_globe_wheel_over_pin_zooms(page, server_url):
    _open_globe(page, server_url)
    box = page.locator(".pin[data-region=gale] .dot").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    for _ in range(5):
        page.mouse.wheel(0, -300)
        page.wait_for_timeout(100)
    page.wait_for_function("__map.globe.altitude() < 8.5e6", timeout=30000)
    assert page.console_errors == []


# ---------- site view (Task 8) ----------
# __map.openSite (R15) loads the site, places the layout on the best spot, opens the 3D view and flies in tilted.

SITE = "near_base_north"


def _assert_arrival_alt(page, site_id):
    """R23 as built: the fly-in ends above the layout centre, 700 m for the 60 m reference compound and proportionally
    closer for a smaller sized one (never below 250 m), so the sized layout's handles show on arrival."""
    alt = page.evaluate("__map.globe.altitude()")
    w = page.evaluate("(id) => __map.layoutStore.get(id).footprints.find((f) => f.id === 'compound').w", site_id)
    want = max(250, 700 * min(1, w / 60))
    assert 0.86 * want < alt < 1.14 * want, (alt, want, w)


def _open_site(page, server_url, site_id=SITE):
    _open_globe(page, server_url)
    page.evaluate("(id) => __map.openSite(id).then(() => true)", site_id)
    page.wait_for_function("__map.siteView.debug.drape().done", timeout=TILE_WAIT_MS)
    assert settle_tiles(page)


def _site_box(page):
    return page.evaluate("__map.siteView.debug.site().bounds")


def _bt05(page, site_id=SITE):
    return page.evaluate("(id) => __map.results(id).get('BT-05').value", site_id)


def test_site_open_near_base_north(page, server_url):
    hosts = record_request_hosts(page)
    _open_site(page, server_url)
    _shot(page, "site-near_base_north.png")
    s = page.evaluate("__map.siteView.debug.stats()")
    assert s["terrain"] > 100000 and s["tripTerrain"] > 50000, s  # 4 m site lattice, 8 m trip lattice
    assert s["terrainSkirt"] > 0 and s["tripSkirt"] > 0, s
    d = page.evaluate("__map.siteView.debug.drape()")
    assert d["mode"] == "hirise" and d["site"]["ok"] > 0 and d["site"]["bad"] == 0, d
    assert d["site"]["z"] == 15 and d["trip"]["z"] == 14, d
    _assert_arrival_alt(page, SITE)
    tilt = page.evaluate("""() => { const c = __map.globe.camera, f = new c.position.constructor();
        c.getWorldDirection(f); return 180 / Math.PI * f.angleTo(c.position.clone().normalize().negate()); }""")
    assert 50 < tilt < 60, tilt
    assert page.evaluate("__map.siteView.root.scale.y") == 2
    assert page.evaluate("__map.siteView.root.parent.matrix.equals(__map.siteView.frame.matrix)")
    assert page.evaluate("__map.results('%s').get('BT-01').value" % SITE) > 1
    assert page.evaluate("__map.siteView.problems") == [], page.evaluate("__map.siteView.problems")
    assert d["site"]["missing"] == 0 and d["trip"]["missing"] < 0.005, d  # every drawn vertex has imagery
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_site_drag_changes_bt05(page, server_url):
    _open_site(page, server_url)
    before = _bt05(page)
    assert before is not None
    p = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    assert 0 < p["x"] < 1280 and 0 < p["y"] < 800, p
    mid = page.evaluate("(() => { const r = __map.globe.renderer.domElement.getBoundingClientRect(); return r.left + r.width / 2; })()")
    dx = 250 if p["x"] < mid else -250  # toward the middle of the map, where the site is
    page.mouse.move(p["x"], p["y"])
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(p["x"] + dx * i / 10, p["y"])
        page.wait_for_timeout(60)
    page.mouse.up()
    page.wait_for_function("__map.siteView.debug.finals() > 0", timeout=30000)
    after = _bt05(page)
    assert after is not None and after != before, (before, after)
    q = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    # 250 px is about 300 m down there, so the layout follows the pointer (clampPlacement keeps it in the box)
    assert (q["x"] - p["x"]) * dx > 0 and abs(q["x"] - p["x"]) > 50, (p, q)
    box = _site_box(page)
    for f in page.evaluate("__map.layoutStore.get('%s').footprints" % SITE):
        for lon, lat in f["polygon"]:
            assert box[0] - 1e-9 <= lon <= box[2] + 1e-9 and box[1] - 1e-9 <= lat <= box[3] + 1e-9, (f["id"], lon, lat)
    assert page.evaluate("__map.results('%s').get('BT-01').value !== null" % SITE)  # rechecked on drag end
    settle_tiles(page, quiet_s=2.0, timeout_s=30)
    _shot(page, "site-dragged.png")
    assert page.console_errors == []


def test_site_no_zfight_at_edge(page, server_url):
    _open_site(page, server_url)
    box = _site_box(page)
    edge = ((box[0] + box[2]) / 2, box[1])  # middle of the south edge, looking north across it
    page.evaluate("([lon, lat]) => __map.globe.flyTo(lon, lat, 500, 0, {tiltDeg: 62, targetAltM: __map.siteView.debug.groundAt(lon, lat)})", list(edge))
    assert settle_tiles(page)
    page.wait_for_timeout(1500)
    _shot(page, "site-edge.png")
    # the same edge without the trip mesh: the site's skirts run down to the globe
    page.evaluate("__map.siteView.tripTerrain.visible = false")
    page.wait_for_timeout(1500)
    _shot(page, "site-edge-skirts.png")
    page.evaluate("__map.siteView.tripTerrain.visible = true")
    s = page.evaluate("__map.siteView.debug.stats()")
    assert s["terrainSkirt"] > 0 and s["tripSkirt"] > 0, s
    names = page.evaluate("__map.siteView.terrain.children.concat(__map.siteView.tripTerrain.children).map(c => c.name)")
    assert names.count("skirt") == 2, names
    assert page.console_errors == []


def test_site_hover_readout(page, server_url):
    _open_site(page, server_url)
    readout = page.locator("#readout")
    c = page.evaluate("__map.siteView.debug.lonLatScreen(__map.siteView.frame.lon0, __map.siteView.frame.lat0)")
    page.mouse.move(c["x"], c["y"])
    readout.wait_for(state="visible", timeout=20000)
    text = readout.inner_text()
    assert "°" in text and " m" in text, text
    for word in ("Elevation", "Slope", "Roughness"):
        assert word in text, text
    assert readout.locator(".ev").count() >= 3, text
    _shot(page, "site-hover.png")
    page.mouse.move(640, 8)  # the top of the screen looks far past the trip area, at the bare globe
    readout.wait_for(state="hidden", timeout=20000)
    assert page.console_errors == []


def test_site_arcadia_elevation_ramp(page, server_url):
    hosts = record_request_hosts(page)
    _open_site(page, server_url, "arcadia_north")
    d = page.evaluate("__map.siteView.debug.drape()")
    assert d["mode"] == "elevation", d  # no HiRISE layer covers Arcadia (R16)
    s = page.evaluate("__map.siteView.debug.stats()")
    assert s["terrain"] > 100000 and s["tripTerrain"] > 50000, s
    _shot(page, "site-arcadia_north.png")
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def _drag(page, a, b, steps=8):
    page.mouse.move(a[0], a[1])
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps)
        page.wait_for_timeout(60)
    page.mouse.up()


def test_site_rotate_layout(page, server_url):
    _open_site(page, server_url)
    placement = "__map.layoutStore.get('%s').placement" % SITE
    page.evaluate("""() => { const p = %s, v = __map.siteView;
        return __map.globe.flyTo(p.centerLon, p.centerLat, 400, 0, {tiltDeg: 45, targetAltM: v.debug.groundAt(p.centerLon, p.centerLat)}); }""" % placement)
    handle = page.locator(".site-handle")
    assert not handle.is_visible()  # Task 9b: the handles sit on the selected footprint only
    c = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    page.mouse.click(c["x"], c["y"])  # a click selects the layout without moving it
    handle.wait_for(state="visible", timeout=20000)  # close in, the handle shows beside the compound
    assert page.evaluate("__map.siteView.debug.selected()") == "compound"
    p0 = page.evaluate(placement)
    assert p0["rotationDeg"] == 0
    c = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    h = page.evaluate("__map.siteView.debug.handleScreen()")
    r = h["x"] - c["x"]
    assert r > 20, (c, h)  # east of the compound on screen
    # the handle starts due east; dragging it round to due south turns the layout a quarter turn clockwise
    _drag(page, (h["x"], h["y"]), (c["x"], c["y"] + r))
    page.wait_for_function("__map.siteView.debug.finals() >= 1", timeout=30000)
    p1 = page.evaluate(placement)
    assert 60 < p1["rotationDeg"] < 120, p1
    assert abs(p1["centerLon"] - p0["centerLon"]) < 1e-9 and abs(p1["centerLat"] - p0["centerLat"]) < 1e-9, (p0, p1)
    # R + drag on the compound turns it by the change in bearing around its centre: south back to east
    c = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    page.keyboard.down("r")
    _drag(page, (c["x"], c["y"] + 12), (c["x"] + 12, c["y"]))  # inside the compound (about 66 x 47 px here)
    page.keyboard.up("r")
    page.wait_for_function("__map.siteView.debug.finals() >= 2", timeout=30000)
    p2 = page.evaluate(placement)
    turned = (p2["rotationDeg"] - p1["rotationDeg"] + 540) % 360 - 180
    assert -120 < turned < -60, (p1, p2)
    assert abs(p2["centerLon"] - p0["centerLon"]) < 1e-9 and abs(p2["centerLat"] - p0["centerLat"]) < 1e-9, (p0, p2)
    assert page.evaluate("__map.results('%s').get('BT-01').value !== null" % SITE)
    _shot(page, "site-rotated.png")
    assert page.console_errors == []


def _errors_besides_404s(page):
    return [e for e in page.console_errors if "Failed to load resource" not in e]


def test_site_tile_failures_are_reported(page, server_url):
    """HiRISE tiles that fail show the elevation ramp and are listed in view.problems (fix round 1); the site's drape,
    not the hidden globe layer, reports them (R33)."""
    _open_globe(page, server_url)
    failed = []

    def fail_even_z15(route):
        m = re.search(r"/(\d+)/(\d+)/(\d+)\.png$", route.request.url)
        if m and m.group(1) == "15" and int(m.group(3)) % 2 == 0:
            failed.append(route.request.url)
            route.fulfill(status=404, body="gone")
        else:
            route.continue_()

    page.route(re.compile(r"curiosity_hirise_mosaic"), fail_even_z15)
    page.evaluate("(id) => __map.openSite(id).then(() => true)", SITE)
    page.wait_for_function("__map.siteView.debug.drape().done", timeout=TILE_WAIT_MS)
    settle_tiles(page, quiet_s=2.0, timeout_s=60)
    assert failed, "no z15 tile was failed"
    d = page.evaluate("__map.siteView.debug.drape()")
    assert d["site"]["bad"] > 0 and 0.2 < d["site"]["missing"] < 0.8, d
    problems = page.evaluate("__map.siteView.problems")
    img = [p for p in problems if p["kind"] == "imagery_incomplete"]
    assert len(img) == 1 and img[0]["datasetId"] == "imagery_hirise_gray", problems
    assert "of the site" in img[0]["message"] and "tiles failed to load" in img[0]["message"], img
    _shot(page, "site-imagery-gaps.png")  # failed tiles show as elevation-ramp squares, not as tan ground
    # R33 hides the globe's tiles while a site is open, so the globe's HiRISE layer fetches nothing here: the site's own
    # drape (above) is the imagery in use, and it is the one that counts and reports the failures
    assert page.evaluate("__map.globe.tiles.group.visible") is False
    assert d["site"]["bad"] <= len(failed), (d, len(failed))  # every failure it counts is one the route served
    assert _errors_besides_404s(page) == []  # no uncaught errors, from the drape or the globe's overlay


def test_site_without_elevation_rejects(page, server_url):
    """No elevation grid: __map.openSite rejects with the reason and opens nothing (fix round 1)."""
    _open_globe(page, server_url)
    page.route(re.compile(r"/data/elevation/elevation_1m_%s\.f32$" % SITE), lambda r: r.fulfill(status=404, body="gone"))
    out = page.evaluate("(id) => __map.openSite(id).then(() => 'opened', (e) => 'rejected: ' + e.message)", SITE)
    assert out.startswith("rejected: %s cannot be opened: it has no elevation grid (elevation_1m_%s: HTTP 404" % (SITE, SITE)), out
    assert page.evaluate("__map.siteView") is None
    assert page.locator("#readout").count() == 0
    assert _errors_besides_404s(page) == []


# ---------- app flow: landing, brief, priority list, site card (Tasks 9, 9b and 9d) ----------
# The landing comes first, then the construction brief and the facility step; the globe pins carry each region's rows once its sites are checked; the
# results panel lists the region the camera is over; a candidate card opens the site card in the same panel.

FLOW_TIMEOUT_MS = 180000  # a region's sites load (about 50-170 MB each) and are checked on first entry


def _boot(page, server_url):
    if not os.environ.get("MARTIAN_MAP_DATA"):
        pytest.skip("MARTIAN_MAP_DATA is not set")
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(server_url + "/")
    wait_ready(page, timeout_ms=60000)
    page.locator("#landing").wait_for(state="visible", timeout=30000)


def _wait_list(page, region):
    page.wait_for_function(
        """(r) => { const p = document.getElementById('panel');
            return p && p.dataset.region === r && p.dataset.state === 'ready' && p.querySelectorAll('.site-row').length > 0; }""",
        arg=region, timeout=FLOW_TIMEOUT_MS)


def _enter(page, region):
    page.locator(".pin[data-region=%s] .pin-head" % region).click()
    _wait_list(page, region)


def _rows(page):
    return page.evaluate("""() => [...document.querySelectorAll('#panel .site-row')].map((r) => ({
        site: r.dataset.site, prio: r.querySelector('.prio').textContent.trim(),
        icons: [...r.querySelectorAll('.icon')].map((i) => i.dataset.factor + ':' + i.dataset.icon),
        verdict: r.querySelector('.verdict').textContent }))""")


# The plain verdict (Task 9c) for each of a region's priority rows, from the app's own plain.js.
_PLAIN_VERDICTS_JS = """async (region) => { const { plainVerdict } = await import('/src/plain.js');
    return __map.store.get('priority').get(region).map((r) => [r.siteId, r.priority, plainVerdict(r, __map.results(r.siteId), __map.metrics)]); }"""


def _open_details(page, factor):
    """Open a factor row's Details on the site card (Task 9c: the metric lines live there)."""
    d = page.locator('#card .factor[data-factor="%s"] > details' % factor)
    if not d.evaluate("(d) => d.open"):
        d.locator(":scope > summary").click()
    page.wait_for_function("(f) => document.querySelector('#card .factor[data-factor=\"' + f + '\"] > details').open", arg=factor)


def _open_row(page, site_id, via=None):
    page.locator(via or '#panel .site-row[data-site="%s"]' % site_id).click()
    page.wait_for_function(
        "(id) => __map.siteView && __map.siteView.site.id === id && document.getElementById('card').dataset.site === id",
        arg=site_id, timeout=FLOW_TIMEOUT_MS)
    page.evaluate("__map.opening.then(() => true)")  # the fly-in has ended
    page.wait_for_function("__map.siteView.debug.drape().done", timeout=TILE_WAIT_MS)


def _tilt(page):
    return page.evaluate("""() => { const c = __map.globe.camera, f = new c.position.constructor();
        c.getWorldDirection(f); return 180 / Math.PI * f.angleTo(c.position.clone().normalize().negate()); }""")


def test_flow_intake_to_priority_list(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    _start(page)
    assert page.evaluate("__map.store.get('setup').source") == "brief"  # the facility calculated from the brief
    assert page.locator("#panel .site-row").count() == 0  # whole planet: no region in view yet
    cards = page.locator("#panel .region-card")
    assert cards.count() == 3, cards.all_inner_texts()
    assert "3 candidate sites" in page.locator('#panel .region-card[data-region="gale"]').inner_text()
    page.locator('#panel .region-card[data-region="gale"]').click()  # a region card flies there
    _wait_list(page, "gale")
    rows = _rows(page)
    assert len(rows) == 3, rows
    assert {r["site"] for r in rows} == {"near_base_north", "near_base_west", "curiosity_recent"}, rows
    for r in rows:
        assert re.fullmatch(r"\d+", r["prio"]), r
        assert [i.split(":")[0] for i in r["icons"]] == ["BT", "GI", "SC", "TC", "IR"], r
        assert all(i.split(":")[1] in "✓✗?—" for i in r["icons"]), r
        assert r["verdict"].startswith(("No failures", "Not recommended: ")), r  # plain words (Task 9c)
        assert not re.search(r"\b(BT|GI|SC|TC|IR)-\d\d\b", r["verdict"]), r
    prios = [int(r["prio"]) for r in rows]
    assert prios == sorted(prios), rows
    want = page.evaluate(_PLAIN_VERDICTS_JS, "gale")
    assert [[r["site"], int(r["prio"]), r["verdict"]] for r in rows] == want  # the list is prioritize()'s, nothing else
    names = page.evaluate("[...document.querySelectorAll('#panel .cols .fc')].map((c) => c.textContent)")
    assert names[:5] == ["Terrain", "Ground & ice", "Solar", "Thermal", "Routes"], names  # plain names, never codes
    # the Gale pin steps aside while its list is on screen; its rows are there for the globe view
    assert page.locator(".pin[data-region=gale] .pin-row").count() == 3
    page.locator(".pin[data-region=gale]").wait_for(state="hidden", timeout=20000)
    # site markers carry the same priorities on the map
    page.locator('.site-pin[data-site="near_base_north"]').wait_for(state="visible", timeout=20000)
    marks = page.evaluate("[...document.querySelectorAll('.site-pin')].filter((m) => m.offsetParent && getComputedStyle(m).display !== 'none')"
                          ".map((m) => [m.dataset.site, m.querySelector('.sprio').textContent])")
    assert sorted(marks) == sorted([r["site"], r["prio"]] for r in rows), marks
    assert settle_tiles(page)
    _shot(page, "flow-gale-list.png")
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_flow_jezero_list_has_two_rows(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "jezero")
    rows = _rows(page)
    assert len(rows) == 2 and {r["site"] for r in rows} == {"jezero_north", "jezero_south"}, rows
    assert all(len(r["icons"]) == 5 for r in rows), rows
    assert page.console_errors == []


def test_flow_globe_rows(page, server_url):
    _boot(page, server_url)
    _start(page)
    for region in ("gale", "jezero", "arcadia"):  # first entry to each region checks its sites
        b = page.evaluate("(id) => __map.catalog.regions.find((r) => r.id === id).bounds", region)
        _fly(page, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 250000)
        _wait_list(page, region)
    _fly(page, 128.0, 14.0, 1.05e7)  # the whole planet with all three regions facing the camera
    page.wait_for_function("document.getElementById('panel').dataset.region === undefined || document.getElementById('panel').dataset.region === ''", timeout=20000)
    for region, n in (("gale", 3), ("jezero", 2), ("arcadia", 2)):
        pin = page.locator(".pin[data-region=%s]" % region)
        pin.wait_for(state="visible", timeout=30000)
        rows = pin.locator(".pin-row")
        assert rows.count() == n, region
        for i in range(n):
            assert rows.nth(i).locator(".icon").count() == 5, (region, i)
            assert re.fullmatch(r"\d+", rows.nth(i).locator(".prio").inner_text().strip()), (region, i)
        assert pin.locator(".pin-row").first.is_visible(), region
    assert settle_tiles(page)
    assert _pin_cards_on_map(page) == 3  # the cards with their rows, too
    _shot(page, "flow-globe-rows.png")
    assert page.console_errors == []


def test_flow_card_sections(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    _assert_arrival_alt(page, SITE)
    assert 50 < _tilt(page) < 60
    for region in ("gale", "jezero", "arcadia"):  # region pins are hidden while a site is open
        assert not page.locator(".pin[data-region=%s]" % region).is_visible(), region
    card = page.locator("#card")
    _open_details(page, "BT")  # Task 9c: the metric lines live in each factor row's Details
    for sec, title in (("met", "Met"), ("open", "Open")):
        assert card.locator('.factor[data-factor="BT"] [data-section="%s"] h4' % sec).text_content().startswith(title), sec
    assert card.locator('[data-section="why"] h3').text_content() == "Why this priority"
    assert card.locator('[data-section="met"] .line').count() >= 3
    assert card.locator(".ev").count() > 10 and card.locator(".ev-assumption").count() > 0
    assert card.locator('[data-section="met"] .line[data-metric="BT-04"] .ev-derived').count() == 1
    assert card.locator('[data-section="met"] .line[data-metric="BT-04"] .target').inner_text().startswith("≤ 5°")
    crit = page.evaluate("__map.store.get('priority').get('gale').find((r) => r.siteId === '%s').criticalUnknowns" % SITE)
    assert crit, crit
    marked = page.evaluate("[...document.querySelectorAll('#card [data-section=open] .line.critical')].map((l) => l.dataset.metric)")
    assert sorted(marked) == sorted(crit), (marked, crit)
    settled = page.evaluate("""() => [...document.querySelectorAll('#card [data-section=open] .line')]
        .map((l) => [l.dataset.metric, (l.querySelector('.settled') || {}).textContent || ''])""")
    assert all(t.startswith("settled by: ") and len(t) > 15 for m, t in settled if not m.startswith("power")), settled
    gi01 = [t for m, t in settled if m == "GI-01"]
    assert gi01 == ["settled by: Soil/rock characterization and appropriate probing/load tests"], gi01
    why = page.evaluate("__map.store.get('priority').get('gale').find((r) => r.siteId === '%s').whyHere" % SITE)
    assert why in card.locator('[data-section="why"]').text_content()  # the technical text, in its Details
    assert "HiRISE" in page.locator("#view-key").text_content()  # the legend's text is the photo view's key now
    assert settle_tiles(page)
    page.wait_for_timeout(1500)
    _shot(page, "flow-card-near_base_north.png")
    page.locator("#references-open").click()  # one References page: what is on screen, then every source
    page.wait_for_function("document.querySelector('#references [data-part=\"screen\"]').innerText.includes('HiRISE')", timeout=10000)
    refs = page.evaluate("Object.keys(__map.catalog.raw.references).length")
    assert page.locator('#references [data-part="all"] .ref').count() == refs
    page.locator("#references-close").click()
    page.locator('#references [data-part="all"]').wait_for(state="hidden", timeout=5000)
    page.locator("#card .back").click()  # back to the region
    page.wait_for_function("__map.siteView === null && document.getElementById('card').children.length === 0", timeout=20000)
    _wait_list(page, "gale")
    page.locator('.site-pin[data-site="%s"]' % SITE).wait_for(state="visible", timeout=30000)  # the region view again
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_flow_card_arcadia_north(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "arcadia")
    page.locator('.site-pin[data-site="arcadia_north"]').wait_for(state="visible", timeout=20000)
    _open_row(page, "arcadia_north", via='.site-pin[data-site="arcadia_north"]')  # the map marker opens it too
    assert page.evaluate("__map.siteView.debug.drape().mode") == "elevation"
    key = page.locator("#view-key").text_content()
    assert "elevation" in key.lower() and "no hirise" in key.lower(), key  # Task 9c: the photo view's key, not a legend
    assert re.search(r"−?[\d,]+ m\).*−?[\d,]+ m\)", key), key  # the ramp's range, in metres
    assert page.locator('#card [data-section="why"]').count() == 1
    assert settle_tiles(page)
    page.wait_for_timeout(1500)
    _shot(page, "flow-card-arcadia_north.png")
    assert page.console_errors == []


def test_flow_base_only_marks_solar_na(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    before = page.evaluate("__map.store.get('priority').get('gale')")
    assert any(f["id"] == "solar" for f in page.evaluate("__map.layoutStore.get('%s').footprints" % SITE))
    page.evaluate("__map.applySetup({loadKw: 150, power: 'base_only'})")  # test-only: the UI offers no power choice
    page.wait_for_function("__map.store.get('setup').power === 'base_only'", timeout=10000)
    page.wait_for_function(
        "() => [...document.querySelectorAll('#panel .site-row .icon[data-factor=SC]')].every((i) => i.dataset.icon === '—')",
        timeout=30000)
    after = page.evaluate("__map.store.get('priority').get('gale')")
    assert len(after) == 3
    for loaded in ("near_base_north", "near_base_west", "curiosity_recent"):  # every loaded site is re-placed
        assert not any(f["id"] == "solar" for f in page.evaluate("__map.layoutStore.get('%s').footprints" % loaded)), loaded
        res = page.evaluate("(id) => [...__map.results(id).values()].filter((r) => r.id.startsWith('SC-')).map((r) => r.status)", loaded)
        assert len(res) == 13 and set(res) == {"not_applicable"}, (loaded, res)
    sc = page.evaluate("""() => [...document.querySelectorAll('#card .line[data-metric^="SC-"]')]
        .map((l) => [l.dataset.metric, l.closest('[data-section]').dataset.section, l.textContent])""")
    assert len(sc) == 13 and all(s == "na" and "not applicable" in t.lower() for m, s, t in sc), sc
    solar = page.locator('#card .factor[data-factor="SC"]')  # Task 9c: the factor row in plain words
    assert solar.locator(".f-icon").text_content() == "—" and solar.locator(".f-text").text_content() == "not applicable here"
    _open_details(page, "SC")
    # the priority was recomputed: solar fieldwork items were critical unknowns under top-up and are gone now
    assert all(any(c.startswith("SC-") for c in r["criticalUnknowns"]) for r in before), before
    assert all(not any(c.startswith("SC-") for c in r["criticalUnknowns"]) for r in after), after
    page.locator('#card [data-section="na"] summary').first.click()
    page.wait_for_timeout(1500)
    _shot(page, "flow-base-only.png")
    assert page.console_errors == []


_STEEP_JS = """(id) => {
    // the steepest 10 m cell where the whole layout fits round the compound without clamping
    const s = __map.site(id), g = s.grids.slope10, b = s.bounds, k = 111194.9 * Math.cos(s.bounds[1] * Math.PI / 180);
    const mLon = 80 / k, mLatN = 140 / 111194.9, mLatS = 180 / 111194.9;
    let best = null;
    for (let r = 0; r < g.height; r += 2) for (let c = 0; c < g.width; c += 2) {
        const v = g.data[r * g.width + c];
        if (!(v > 15)) continue;
        const lon = g.bounds[0] + (c + 0.5) * g.pixelDeg[0], lat = g.bounds[3] - (r + 0.5) * g.pixelDeg[1];
        if (lon < b[0] + mLon || lon > b[2] - mLon || lat < b[1] + mLatS || lat > b[3] - mLatN) continue;
        if (!best || v > best.v) best = { lon, lat, v };
    }
    return best;
}"""


def test_drag_failure_reads_plainly(page, server_url):
    """Task 9c (and Task 9's drag flow): a steep spot fails Terrain, and every place says so in plain words."""
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    assert not [r for r in _rows(page) if r["site"] == SITE][0]["verdict"].startswith("Not recommended")
    steep = page.evaluate(_STEEP_JS, SITE)
    assert steep is not None and steep["v"] > 15, steep
    box = _site_box(page)
    _fly(page, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 7000)  # straight down: the whole site on screen
    assert settle_tiles(page, quiet_s=2.0, timeout_s=60)
    a = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    b = page.evaluate("([lon, lat]) => __map.siteView.debug.lonLatScreen(lon, lat)", [steep["lon"], steep["lat"]])
    assert 0 < a["x"] < 1280 and 0 < a["y"] < 800 and 0 < b["x"] < 1280 and 0 < b["y"] < 800, (a, b)
    _drag(page, (a["x"], a["y"]), (b["x"], b["y"]), steps=12)
    page.wait_for_function("__map.siteView.debug.finals() > 0", timeout=30000)
    page.wait_for_function("(id) => __map.results(id).get('BT-05').status === 'not_met'", arg=SITE, timeout=30000)
    lead = "Not recommended: too steep in places under the compound"
    page.wait_for_function(
        """([id, lead]) => { const r = document.querySelector('#panel .site-row[data-site="' + id + '"]');
            return r && r.querySelector('.verdict').textContent.startsWith(lead); }""", arg=[SITE, lead], timeout=30000)
    rows = _rows(page)
    assert rows[-1]["site"] == SITE and rows[-1]["icons"][0] == "BT:✗", rows  # failures go last
    assert rows[-1]["verdict"].startswith(lead), rows
    assert page.locator("#card .card-head .verdict").text_content().startswith(lead)
    terrain = page.locator('#card .factor[data-factor="BT"]')
    assert terrain.locator(".f-icon").text_content() == "✗"
    assert "too steep in places under the compound" in terrain.locator(".f-text").text_content()
    assert not re.search(r"\b(BT|GI|SC|TC|IR)-\d\d\b", terrain.locator(".f-text").text_content())
    assert terrain.locator('details [data-section="failed"] .line[data-metric="BT-05"]').count() == 1  # the detail is a click away
    pin = page.locator('.pin[data-region=gale] .pin-row[data-site="%s"]' % SITE)
    assert pin.locator(".icon[data-factor=BT]").get_attribute("data-icon") == "✗"
    assert pin.locator(".nr").text_content().startswith(lead)
    assert page.console_errors == []


# ---------- ARES design guidance (Task 9b) and the construction brief (Task 9d) ----------

LANDING_HEADLINE = ["Your project.", "Your next frontier."]  # the Twin Trails heading's two lines beside its globe (Task 9)
LANDING_SUPPORT = "Start with the construction your robots will do. Find where its supporting facility could be built."
LANDING_ACTION = "Define construction project"  # design-reference/mars-construction-twin-trails.html
LANDING_CONTINUE = "Continue project brief"
ASSUMPTIONS = ("Base services included. Firm power plus supplemental solar assumed; capacity unverified. "
               "Facility sizing requires workload validation.")
FACILITY = "150 kW IT, 225 kW total; compound 60 × 60 m, radiator 60 × 64 m, solar 100 × 100 m"
MET = "rgb(184, 223, 194)"  # #B8DFC2
CONFLICT = "rgb(255, 177, 155)"  # #FFB19B
UNRESOLVED = "rgb(227, 199, 143)"  # #E3C78F

_TINY_TEXT_JS = """() => {
    // every rendered text node, with its computed size; closed disclosures and hidden pins are not rendered
    const out = [], range = document.createRange();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim() || !n.parentElement) continue;
        range.selectNodeContents(n);
        if (!range.getClientRects().length) continue;
        const cs = getComputedStyle(n.parentElement);
        if (cs.visibility === 'hidden') continue;
        if (parseFloat(cs.fontSize) < 12) out.push([n.parentElement.className, n.textContent.trim().slice(0, 40), cs.fontSize]);
    }
    return out;
}"""

_SMALL_TARGETS_JS = """() => [...document.querySelectorAll('button, [role=button], summary')]
    .filter((b) => !b.classList.contains('sr-only') && getComputedStyle(b).visibility !== 'hidden')
    .map((b) => [b, b.getBoundingClientRect()])
    .filter(([b, r]) => r.width > 0 && r.height > 0 && (r.width < 43.5 || r.height < 43.5))
    .map(([b, r]) => [b.id || b.className, b.textContent.trim().slice(0, 30), Math.round(r.width), Math.round(r.height)])"""


_PIN_CARDS_OFF_MAP_JS = """() => {
    // every visible region pin card must lie inside the map area (the canvas) and clear of the globe buttons
    const map = __map.globe.renderer.domElement.getBoundingClientRect();
    const ctl = document.getElementById('controls').getBoundingClientRect();
    const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return [...document.querySelectorAll('.pin .label')].map((c) => [c.closest('.pin').dataset.region, c.getBoundingClientRect()])
        .filter(([, r]) => r.width > 0 && r.height > 0)
        .filter(([, r]) => r.left < map.left - 0.5 || r.right > map.right + 0.5 || r.top < map.top - 0.5 || r.bottom > map.bottom + 0.5 || hits(r, ctl))
        .map(([id, r]) => [id, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
}"""


def _pin_cards_on_map(page):
    page.wait_for_timeout(600)  # pins.js places the cards a few times a second
    shown = page.evaluate("[...document.querySelectorAll('.pin .label')].filter((c) => c.getBoundingClientRect().width > 0).length")
    off = page.evaluate(_PIN_CARDS_OFF_MAP_JS)
    assert off == [], off
    return shown


def _no_tiny_text_or_small_targets(page, where):
    tiny = page.evaluate(_TINY_TEXT_JS)
    assert tiny == [], (where, tiny)
    small = page.evaluate(_SMALL_TARGETS_JS)
    assert small == [], (where, small)


def _camera_lon(page):
    return page.evaluate("(() => { const p = __map.globe.camera.position; return Math.atan2(p.y, p.x) * 180 / Math.PI; })()")


def test_landing_matches_mockup(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    landing = page.locator("#landing")
    assert landing.locator("h1").text_content() == " ".join(LANDING_HEADLINE)
    assert _texts(page, "#landing h1 > span") == LANDING_HEADLINE
    assert landing.locator("p.support").text_content() == LANDING_SUPPORT
    primaries = page.locator("button.primary:visible")
    assert primaries.count() == 1, primaries.all_inner_texts()  # one main action
    assert primaries.first.text_content() == LANDING_ACTION and primaries.first.get_attribute("id") == "landing-start"
    h1 = page.evaluate("""(() => { const s = getComputedStyle(document.querySelector('#landing h1'));
        return [s.fontFamily, s.textTransform, s.webkitTextStrokeWidth, s.webkitTextStrokeColor, s.color]; })()""")
    assert "Audiowide" in h1[0] and h1[1] == "uppercase" and h1[2] == "1px" and h1[3] == "rgb(237, 196, 155)", h1
    header = page.locator("#header")
    assert header.locator(".wordmark").text_content() == "ARES"
    assert header.locator(".tagline").text_content() == "Mars data center explorer"
    assert header.locator(".base-context").text_content() == "Gale, Jezero and Arcadia bases · Demo"  # no region in view
    hb = header.bounding_box()
    assert 72 <= hb["height"] <= 88, hb
    assert page.locator("#panel").is_hidden() and page.locator("#brief").is_hidden()
    steps = page.evaluate("[...document.querySelectorAll('#stepper [data-step]')].map((s) => [s.textContent.trim(), !!s.querySelector('button'), s.getAttribute('aria-current')])")
    assert steps == [["1 Construction brief", False, None], ["2 Facility specifications", False, None], ["3 Location assessment", False, None]], steps
    page.wait_for_function("__map.globe.stats.layers.viking.ok > 4", timeout=TILE_WAIT_MS)  # the globe is live behind it
    settle_tiles(page)
    assert _pin_cards_on_map(page) == 3  # all three region cards face the camera, inside the map, clear of the buttons
    _shot(page, "landing.png")
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_design_tokens_and_fonts(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(7, 11, 15)"
    fonts = page.evaluate("""async () => { await document.fonts.ready;
        const loaded = (f) => [...document.fonts].some((x) => x.family.replace(/["']/g, '') === f && x.status === 'loaded');
        return [document.fonts.check("28px Audiowide") && loaded('Audiowide'),
                document.fonts.check("14px 'Space Grotesk'") && loaded('Space Grotesk'),
                getComputedStyle(document.body).fontFamily]; }""")
    assert fonts[0] and fonts[1] and fonts[2].startswith('"Space Grotesk"'), fonts
    page.wait_for_function("__map.globe.stats.layers.viking.ok > 4", timeout=TILE_WAIT_MS)
    _no_tiny_text_or_small_targets(page, "landing")
    page.locator("#landing-start").click()
    page.locator("#brief").wait_for(state="visible", timeout=10000)
    assert page.evaluate("getComputedStyle(document.getElementById('brief')).backgroundColor") == "rgb(17, 25, 32)"
    panel = page.evaluate("""(() => { const s = getComputedStyle(document.getElementById('brief'));
        return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius]; })()""")
    assert panel == ["1px", "rgb(53, 64, 72)", "12px"], panel
    find = page.evaluate("""(() => { const s = getComputedStyle(document.getElementById('brief-find'));
        return [s.backgroundColor, s.color, parseFloat(s.borderTopLeftRadius)]; })()""")
    assert find[0] == "rgb(237, 196, 155)" and find[1] == "rgb(29, 33, 31)" and 7 <= find[2] <= 8, find
    _no_tiny_text_or_small_targets(page, "brief")
    page.locator("#brief details[data-defaults] > summary").click()  # the planning defaults, open
    _no_tiny_text_or_small_targets(page, "brief defaults")
    _find_area(page)
    page.locator("#facility details.assumptions summary").click()
    _no_tiny_text_or_small_targets(page, "facility")
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    _no_tiny_text_or_small_targets(page, "results")
    page.locator('#panel .region-card[data-region="gale"]').click()
    _wait_list(page, "gale")
    page.locator('.site-pin[data-site="near_base_north"]').wait_for(state="visible", timeout=20000)
    _no_tiny_text_or_small_targets(page, "gale list")
    vals = page.evaluate("getComputedStyle(document.querySelector('#panel .site-row .prio')).fontVariantNumeric")
    assert "tabular-nums" in vals, vals
    assert page.evaluate("getComputedStyle(document.querySelector('#panel h2')).fontFamily").startswith("Audiowide")
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_globe_keyboard_buttons(page, server_url):
    _open_globe(page, server_url)
    controls = page.locator("#controls")
    for b in ("#globe-west", "#globe-east", "#globe-north", "#globe-south", "#globe-in", "#globe-out"):
        assert controls.locator(b).is_visible(), b
        assert controls.locator(b).get_attribute("aria-label"), b
    assert "Drag to explore" in controls.inner_text()
    idle = "!__map.globe.flying()"
    alt0 = page.evaluate("__map.globe.altitude()")
    page.locator("#globe-in").click()
    page.wait_for_function(idle, timeout=20000)
    assert abs(page.evaluate("__map.globe.altitude()") / alt0 - 0.6) < 0.01
    lon0 = _camera_lon(page)
    page.locator("#globe-east").click()
    page.wait_for_function(idle, timeout=20000)
    lon1 = _camera_lon(page)
    assert 3 < lon1 - lon0 < 20, (lon0, lon1)  # 10% of the view's ground width, east
    # the same from the keyboard while the map has focus
    page.focus("#app canvas")
    alt1 = page.evaluate("__map.globe.altitude()")
    page.keyboard.press("-")
    page.wait_for_function(idle, timeout=20000)
    assert abs(page.evaluate("__map.globe.altitude()") / alt1 - 1 / 0.6) < 0.01
    page.keyboard.press("+")
    page.wait_for_function(idle, timeout=20000)
    assert abs(page.evaluate("__map.globe.altitude()") / alt1 - 1) < 0.01
    page.keyboard.press("ArrowLeft")
    page.wait_for_function(idle, timeout=20000)
    assert _camera_lon(page) < lon1 - 3
    lat0 = page.evaluate("(() => { const p = __map.globe.camera.position; return Math.asin(p.z / p.length()) * 180 / Math.PI; })()")
    page.keyboard.press("ArrowUp")
    page.wait_for_function(idle, timeout=20000)
    lat1 = page.evaluate("(() => { const p = __map.globe.camera.position; return Math.asin(p.z / p.length()) * 180 / Math.PI; })()")
    assert lat1 > lat0 + 3, (lat0, lat1)
    # keys typed in a field never move the globe
    page.locator("#results-edit").click()
    page.locator("#brief details[data-defaults] > summary").click()  # the project name sits in the planning defaults
    page.locator('#brief [data-input="name"]').focus()
    lon2 = _camera_lon(page)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(500)
    assert abs(_camera_lon(page) - lon2) < 1e-6
    # reduced motion: a fly-to jumps
    page.emulate_media(reduced_motion="reduce")
    alt = page.evaluate("""async () => { const g = __map.globe;
        g.flyTo(77.45, 18.44, 300000, 1600);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return g.altitude(); }""")
    assert abs(alt - 300000) < 3000, alt
    assert page.console_errors == []


_FOOTPRINT_CENTRE = "(id) => __map.layoutStore.get(id).footprints.find((f) => f.id === 'compound').center"


def test_card_status_labels_and_footprints(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    page.locator(".base-pin").wait_for(state="visible", timeout=20000)  # the base marker in the region view
    assert page.locator(".base-pin").text_content().strip() == "Gale crater base"
    assert page.locator("#header .base-context").text_content() == "Gale crater base · Demo"
    _open_row(page, SITE)
    assert page.locator("#panel").is_hidden() and page.locator("#card").is_visible()  # the card replaces the results
    assert page.locator("#card .back").text_content() == "← Back to Gale crater"
    lines = page.evaluate("""() => [...document.querySelectorAll('#card .line')].map((l) => ({
        metric: l.dataset.metric, section: l.closest('[data-section]').dataset.section,
        words: l.querySelector('.words').textContent, icon: (l.querySelector('.st-icon') || {}).textContent,
        ideal: !!l.querySelector('.badge-ideal'), colour: getComputedStyle(l.querySelector('.words')).color }))""")
    met = [x for x in lines if x["section"] == "met"]
    assert len(met) >= 3, met
    assert all(x["words"] == "Meets screening criterion" and x["icon"] == "✓" and x["colour"] == MET for x in met), met
    assert any(x["ideal"] for x in met), met  # BT-04 0.4° meets its ideal too
    opened = [x for x in lines if x["section"].startswith("open") and not x["metric"].startswith("power")]
    assert opened and all(x["words"].startswith("Unresolved: needs ") and x["icon"] == "?" and x["colour"] == UNRESOLVED
                          for x in opened), opened[:3]
    nxt = page.locator("#card .next-check").text_content()
    crit = page.evaluate("__map.store.get('priority').get('gale').find((r) => r.siteId === '%s').criticalUnknowns" % SITE)
    name = page.evaluate("(id) => __map.metrics.find((m) => m.id === id).name", crit[0])
    assert name in nxt and crit[0] not in nxt and "settled by" in nxt.lower(), (nxt, crit)  # Task 9c: words, not ids
    fps = page.evaluate("__map.siteView.debug.footprints()")
    assert sorted(f["id"] for f in fps) == ["compound", "radiator", "solar"], fps
    for f in fps:  # upright, translucent 5 m boxes, coloured by their own checks
        assert f["box"] and abs(f["heightM"] - 5) < 1e-3 and f["opacity"] == 0.35, f
        assert f["colour"] == "#b8dfc2", f  # BT-02, BT-04, BT-05, SC-10 and TC-08 all meet at near_base_north
    tags = page.evaluate("[...document.querySelectorAll('.fp-tag')].map((t) => [t.dataset.footprint, t.textContent])")
    assert sorted(tags) == [["compound", "✓ Compound"], ["radiator", "✓ Radiator"], ["solar", "✓ Solar"]], tags
    base = page.locator(".base-pin:visible")  # site.js draws it on the terrain; the globe's own is hidden
    assert base.count() == 1 and base.text_content().strip() == "Gale crater base"
    assert settle_tiles(page)
    page.wait_for_timeout(1500)
    _no_tiny_text_or_small_targets(page, "site card")
    _shot(page, "card-near_base_north.png")
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_keyboard_moves_layout(page, server_url):
    _open_site(page, server_url)
    centre = lambda: page.evaluate(_FOOTPRINT_CENTRE, SITE)
    page.focus("#app canvas")
    assert page.evaluate("__map.siteView.debug.selected()") is None
    page.keyboard.press("Tab")  # Tab from the map selects the layout
    page.wait_for_function("__map.siteView.debug.selected() === 'compound'", timeout=5000)
    page.locator(".site-move").wait_for(state="visible", timeout=10000)  # the handles sit on the selected footprint
    assert page.locator(".site-handle").is_visible()
    c0, n0 = centre(), page.evaluate("__map.siteView.debug.finals()")
    cam0 = page.evaluate("__map.globe.camera.position.toArray()")
    page.evaluate("(id) => { window.__bt01 = __map.results(id).get('BT-01'); }", SITE)
    page.keyboard.press("ArrowRight")
    page.wait_for_function("(n) => __map.siteView.debug.finals() > n", arg=n0, timeout=10000)
    c1 = centre()
    k = 3396190 * math.pi / 180
    east = (c1["lon"] - c0["lon"]) * k * math.cos(math.radians(c0["lat"]))
    north = (c1["lat"] - c0["lat"]) * k
    assert abs(east - 5) < 0.5 and abs(north) < 0.5, (east, north)
    assert page.evaluate("__map.globe.camera.position.toArray()") == cam0  # the arrows moved the layout, not the camera
    assert page.evaluate("(id) => { const r = __map.results(id).get('BT-01'); return r !== window.__bt01 && r.value !== null; }", SITE)
    n1 = page.evaluate("__map.siteView.debug.finals()")
    page.keyboard.press("]")
    page.wait_for_function("(n) => __map.siteView.debug.finals() > n", arg=n1, timeout=10000)
    p = page.evaluate("__map.layoutStore.get('%s').placement" % SITE)
    assert abs(p["rotationDeg"] - 15) < 1e-9, p
    c2 = centre()
    assert abs(c2["lon"] - c1["lon"]) < 1e-9 and abs(c2["lat"] - c1["lat"]) < 1e-9, (c1, c2)  # turns about the compound
    page.keyboard.press("[")
    page.wait_for_function("__map.layoutStore.get('%s').placement.rotationDeg === 0" % SITE, timeout=10000)
    page.keyboard.press("Escape")
    page.wait_for_function("__map.siteView.debug.selected() === null", timeout=5000)
    page.locator(".site-move").wait_for(state="hidden", timeout=5000)
    c3, lon3 = centre(), _camera_lon(page)
    page.keyboard.press("ArrowRight")  # nothing selected: the arrows nudge the globe again
    page.wait_for_function("!__map.globe.flying()", timeout=20000)
    assert centre() == c3 and _camera_lon(page) > lon3, (c3, lon3)
    assert page.console_errors == []


def test_conflict_highlights_footprint(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    steep = page.evaluate(_STEEP_JS, SITE)
    assert steep is not None and steep["v"] > 15, steep
    box = _site_box(page)
    _fly(page, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 7000)  # straight down: the whole site on screen
    assert settle_tiles(page, quiet_s=2.0, timeout_s=60)
    a = page.evaluate("__map.siteView.debug.footprintScreen('compound')")
    b = page.evaluate("([lon, lat]) => __map.siteView.debug.lonLatScreen(lon, lat)", [steep["lon"], steep["lat"]])
    _drag(page, (a["x"], a["y"]), (b["x"], b["y"]), steps=12)
    page.wait_for_function("(id) => __map.results(id).get('BT-05').status === 'not_met'", arg=SITE, timeout=30000)
    page.wait_for_function("__map.siteView.debug.footprints().find((f) => f.id === 'compound').colour === '#ffb19b'", timeout=10000)
    _open_details(page, "BT")  # Task 9c: the metric lines live in the factor row's Details
    line = page.locator('#card [data-section="failed"] .line[data-metric="BT-05"]')
    line.wait_for(state="visible", timeout=10000)
    text = line.inner_text()
    assert "Local pad slope" in text and "over the 10° target" in text and "on the compound" in text, text
    assert page.evaluate("getComputedStyle(document.querySelector('#card .line[data-metric=\"BT-05\"] .words')).color") == CONFLICT
    assert page.locator('#card .line[data-metric="BT-05"] .st-icon').text_content() == "✗"
    page.wait_for_function("document.querySelector('.fp-tag[data-footprint=\"compound\"]').textContent === '✗ Compound'", timeout=10000)
    # a closer, tilted look at the highlighted compound for the screenshot
    page.evaluate("""(id) => { const c = __map.layoutStore.get(id).footprints.find((f) => f.id === 'compound').center;
        return __map.globe.flyTo(c.lon, c.lat, 700, 0, {tiltDeg: 55, targetAltM: __map.siteView.debug.groundAt(c.lon, c.lat)}); }""", SITE)
    assert settle_tiles(page, quiet_s=2.0, timeout_s=60)
    page.wait_for_timeout(1500)
    _shot(page, "card-conflict.png")
    assert page.console_errors == []


# ---------- plain-language card, factor bar, References, warm globe (Task 9c) ----------

MOCKUP_DISC = (128, 65, 47)  # the mockup's globe disc, measured: hue 14°, saturation 0.47
METRIC_ID = re.compile(r"\b(BT|GI|SC|TC|IR)-\d\d\b")
TERRAIN_KEY = ("Slope over 10 m: green ≤ 5° (ideal pad), amber 5–10° (usable), red > 10°. "
               "From the 1 m HiRISE elevation model (derived).")
SLOPE_COLOURS = ((184, 223, 194), (227, 199, 143), (255, 177, 155))  # ≤ 5°, 5–10°, > 10°

_DISC_MEAN_JS = """() => {
    // the mean colour of the globe disc: every drawn pixel the planet covers fully (the clear colour is transparent)
    const g = __map.globe, gl = g.renderer.getContext();
    g.renderer.render(g.scene, g.camera);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, r = 0, gg = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 255) continue;
        n++; r += px[i]; gg += px[i + 1]; b += px[i + 2];
    }
    return n ? [r / n, gg / n, b / n, n] : null;
}"""

# The text a reader sees in an element with every closed disclosure folded: closed <details> show only their summary.
_VISIBLE_TEXT_JS = """(sel) => {
    const root = document.querySelector(sel), out = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        let hidden = false;
        for (let e = n.parentElement; e && e !== root.parentElement; e = e.parentElement) {
            if (e.tagName !== 'DETAILS' || e.open) continue;
            const sum = e.querySelector(':scope > summary');
            if (!(sum && sum.contains(n))) { hidden = true; break; }
        }
        if (!hidden && n.textContent.trim()) out.push(n.textContent.trim());
    }
    return out.join(' | ');
}"""


def test_globe_colour_matches_mockup(page, server_url):
    _boot(page, server_url)
    page.wait_for_function("__map.globe.stats.layers.viking.ok > 4", timeout=TILE_WAIT_MS)
    assert settle_tiles(page)
    mean = page.evaluate(_DISC_MEAN_JS)
    assert mean and mean[3] > 100000, mean  # the disc, not a sliver
    assert all(abs(m - t) <= 12 for m, t in zip(mean[:3], MOCKUP_DISC)), (mean, MOCKUP_DISC)
    assert page.evaluate("__map.globe.stats.gradeSkipped") == 0  # the grade found its shader line on every tile
    _shot(page, "landing.png")
    assert page.console_errors == []


def _stage_has_one_references(page, where):
    controls = page.evaluate("""() => [...document.querySelectorAll('summary, button')]
        .filter((b) => b.getClientRects().length).map((b) => b.textContent.trim())""")
    assert not [c for c in controls if c in ("Legend", "What the chips mean", "Credits")], (where, controls)
    assert page.locator("#legend, #chips-key, #credits-box").count() == 0, where
    refs = page.locator("details#references")
    assert refs.count() == 1 and page.locator("#references-open").is_visible(), where
    assert page.locator("#references-open").text_content().strip() == "References", where


def test_references_replaces_legend_and_chips(page, server_url):
    _boot(page, server_url)
    _stage_has_one_references(page, "landing")
    page.locator("#landing-start").click()
    page.locator("#brief").wait_for(state="visible", timeout=10000)
    _stage_has_one_references(page, "brief")
    _find_area(page)
    _stage_has_one_references(page, "facility")
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    _stage_has_one_references(page, "explore")
    _enter(page, "gale")
    _open_row(page, SITE)
    _stage_has_one_references(page, "site")
    page.locator("#references-open").click()
    body = page.locator("#references .disc-body")
    body.wait_for(state="visible", timeout=5000)
    parts = page.evaluate("[...document.querySelectorAll('#references [data-part]')].map((p) => [p.dataset.part, p.querySelector('h3').textContent])")
    assert parts == [["read", "How to read the map"], ["screen", "Data on screen"], ["all", "All the data"],
                     ["demo", "Demo parts"]], parts  # Task 12: the demo parts, last (spec, Visual design)
    read = page.locator('#references [data-part="read"]').inner_text()
    for icon in "✓✗?—":
        assert icon in read, (icon, read)
    for label in ("Meets screening criterion", "Requirement conflict", "Unresolved"):
        assert label in read, (label, read)
    assert page.locator('#references [data-part="read"] .swatch').count() >= 3  # the footprint colours
    chips = page.evaluate("[...document.querySelectorAll('#references [data-part=read] .evrow .ev')].map((c) => c.textContent)")
    assert chips == ["observation", "derived", "model", "interpretation", "assumption", "reference", "caveat"], chips
    assert "Globe colour: Viking MDIM 2.1 mosaic, colour-graded warmer for display." in read
    screen = page.locator('#references [data-part="screen"]')
    assert screen.locator(".ref").count() >= 3 and "HiRISE" in screen.inner_text()
    refs = page.evaluate("Object.keys(__map.catalog.raw.references).length")
    assert refs >= 32 and page.locator('#references [data-part="all"] .ref').count() == refs
    assert page.locator('#references [data-part="all"] h4').count() >= 2  # grouped
    links = page.evaluate("[...document.querySelectorAll('#references a')].map((a) => [a.getAttribute('href'), a.rel])")
    assert links and all(h.startswith("https://") and "noopener" in rel for h, rel in links), links
    _no_tiny_text_or_small_targets(page, "references")
    _shot(page, "references.png")
    page.keyboard.press("Escape")
    body.wait_for(state="hidden", timeout=5000)
    assert page.console_errors == []


def test_card_plain_first(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    rows = page.evaluate("""() => [...document.querySelectorAll('#card .factor')].map((f) => [f.dataset.factor,
        f.querySelector('.f-icon').textContent, f.querySelector('.f-name').textContent, f.querySelector('.f-text').textContent])""")
    assert [r[2] for r in rows] == ["Terrain", "Ground & ice", "Solar", "Thermal", "Routes"], rows
    assert all(r[1] in "✓✗?—" and len(r[3]) > 8 for r in rows), rows
    want = page.evaluate("""async (id) => { const { factorSentence } = await import('/src/plain.js');
        return ['BT', 'GI', 'SC', 'TC', 'IR'].map((f) => factorSentence(f, __map.results(id), __map.metrics, { siteId: id })); }""", SITE)
    assert [[r[1], r[3]] for r in rows] == [[w["icon"], w["text"]] for w in want], (rows, want)
    verdict = page.locator("#card .card-head .verdict").text_content()
    assert verdict.startswith("No failures"), verdict  # near_base_north fails nothing at its best spot
    seen = page.evaluate(_VISIBLE_TEXT_JS, "#card")
    assert not METRIC_ID.search(seen), METRIC_ID.search(seen) and seen[max(0, METRIC_ID.search(seen).start() - 60):][:120]
    for words in ("About this site", "Next check"):  # the compact panel: their summaries show, the rest is collapsed
        assert words in seen, (words, seen)
    everything = page.locator("#card").text_content()
    for words in ("Why this priority", "Settled by"):  # still on the card, behind About this site and Next check
        assert words in everything, (words, everything[:400])
    assert page.locator("#card > .card-body > .facility, #card > .card-body > .howto").count() == 0  # moved into Terrain's Details
    _no_tiny_text_or_small_targets(page, "plain card")
    assert settle_tiles(page)
    page.wait_for_timeout(1000)
    _shot(page, "card-plain.png")
    _open_details(page, "BT")
    terrain = page.locator('#card .factor[data-factor="BT"] > details').inner_text()
    for mid in ("BT-04", "BT-05", "BT-01"):
        assert mid in terrain, (mid, terrain[:400])
    assert "Facility" in terrain and "arrow keys" in terrain  # the facility line and the drag help
    assert "settled by" in terrain
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_site_panel_compact(page, server_url):
    """The open-site panel at 1280x800: the three looks and the five one-line factor rows show without scrolling;
    the rest (About this site, Next check, each row's Details) is collapsed, and each row's sentence is its hover tip."""
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    boxes = page.evaluate("""() => {
        const r = (s) => [...document.querySelectorAll(s)].map((e) => { const b = e.getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; });
        const body = document.querySelector('#card .card-body').getBoundingClientRect();
        return { looks: r('#factors .look'), rows: r('#card .factor[data-factor]:not([data-factor=other])'),
                 body: { top: body.top, bottom: body.bottom }, vw: innerWidth, vh: innerHeight }; }""")
    assert len(boxes["looks"]) == 3 and len(boxes["rows"]) == 5, boxes
    for b in boxes["looks"] + boxes["rows"]:
        assert b["top"] >= 0 and b["left"] >= 0 and b["bottom"] <= boxes["vh"] and b["right"] <= boxes["vw"], (b, boxes)
    for b in boxes["rows"]:  # inside the card body as drawn, not under its scroll, and one line each (no wrapping)
        assert b["bottom"] <= boxes["body"]["bottom"] + 0.5 and b["bottom"] - b["top"] < 60, (b, boxes["body"])
    assert page.locator("#card details.about").count() == 1
    assert page.locator("#card details.about > summary").text_content() == "About this site"
    assert not page.evaluate("document.querySelector('#card details.about').open")  # closed by default
    assert "Why this priority" in page.locator("#card details.about").text_content()  # collapsed, not deleted
    tips = page.evaluate("[...document.querySelectorAll('#card .factor[data-factor]')].map((f) => [f.dataset.factor, f.dataset.tip || ''])")
    assert len(tips) >= 5 and all(t.strip() for _, t in tips), tips
    heads = page.evaluate("[...document.querySelectorAll('#card .factor .f-head')].map((h) => h.textContent)")
    assert len(heads) == 5 and all(0 < len(h.split()) <= 5 for h in heads), heads
    assert not METRIC_ID.search(" ".join(t for _, t in tips) + " ".join(heads))
    assert "Photo: HiRISE" in page.locator("#view-key").text_content()  # the look's caption, a tip now
    _no_tiny_text_or_small_targets(page, "compact panel")
    _shot(page, "site-panel-compact.png")
    assert page.console_errors == []


_TERRAIN_POINT_JS = """(id) => {
    // a point on the site's terrain beside the layout, clear of every footprint: 90 m east of the compound, else west
    const c = __map.layoutStore.get(id).footprints.find((f) => f.id === 'compound').center, b = __map.site(id).bounds;
    const k = 3396190 * Math.PI / 180 * Math.cos(c.lat * Math.PI / 180);
    for (const dx of [90, -90]) {
        const lon = c.lon + dx / k;
        if (lon > b[0] && lon < b[2]) {
            const g = __map.site(id).grids.slope10, col = Math.floor((lon - g.bounds[0]) / g.pixelDeg[0]),
                  row = Math.floor((g.bounds[3] - c.lat) / g.pixelDeg[1]);
            const s = __map.siteView.debug.lonLatScreen(lon, c.lat), r = __map.globe.renderer.domElement.getBoundingClientRect();
            return { lon, lat: c.lat, slope: g.data[row * g.width + col], x: Math.round(s.x - r.left), y: Math.round(s.y - r.top) };
        }
    }
    return null;
}"""


def test_factor_view_terrain(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    assert page.locator("#factors").is_hidden()  # R33: no view control and no factor overlay in the region view
    assert page.evaluate("__map.store.get('view')") is None
    _open_row(page, SITE)
    assert settle_tiles(page)
    assert page.locator("#factors .seg").count() == 0  # the looks only: factor views come from the card rows
    p = page.evaluate(_TERRAIN_POINT_JS, SITE)
    assert p and 0 < p["x"] < 880 and 0 < p["y"] < 720 and p["slope"] == p["slope"], p
    before = page.evaluate(_PIXEL_JS, [p["x"], p["y"]])
    view = page.locator('#card .factor[data-factor="BT"] .view')
    view.click()  # the Terrain row's View
    page.wait_for_function("__map.store.get('view') === 'BT'", timeout=5000)
    page.wait_for_function("__map.siteView.debug.slope().on", timeout=10000)
    page.wait_for_function("document.querySelector('#card .factor[data-factor=\"BT\"] .view').getAttribute('aria-pressed') === 'true'", timeout=5000)
    assert view.text_content() == "Viewing" and page.locator("#view-hide").is_visible()
    s = page.evaluate("__map.siteView.debug.slope()")
    assert s["share"] > 0.95, s  # nearly every drawn vertex of the site has a slope colour
    after = page.evaluate(_PIXEL_JS, [p["x"], p["y"]])
    want = SLOPE_COLOURS[0 if p["slope"] <= 5 else 1 if p["slope"] <= 10 else 2]
    dist = lambda a, b: math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))
    assert dist(after, want) < dist(before, want) - 15, (before, after, want, p)  # the ground shifts toward its class
    assert page.locator("#view-key").text_content() == TERRAIN_KEY
    assert settle_tiles(page)
    page.wait_for_timeout(1000)
    _shot(page, "view-terrain.png")
    view.click()  # the row's View again: off, the photo restored exactly
    page.wait_for_function("!__map.siteView.debug.slope().on", timeout=10000)
    assert page.evaluate("__map.store.get('view')") is None
    again = page.evaluate(_PIXEL_JS, [p["x"], p["y"]])
    assert max(abs(a - b) for a, b in zip(before, again)) <= 2, (before, again)
    view.click()  # and "Hide factor view" turns it off too
    page.wait_for_function("__map.siteView.debug.slope().on", timeout=10000)
    page.locator("#view-hide").click()
    page.wait_for_function("!__map.siteView.debug.slope().on && __map.store.get('view') === null", timeout=10000)
    view.click()
    page.locator("#card .back").click()  # closing the site ends the factor view; the region gets none
    _wait_list(page, "gale")
    assert page.evaluate("__map.store.get('view')") is None
    assert page.evaluate("!__map.globe.scene.getObjectByName('slope-patch:gale')")
    assert page.console_errors == []


# ---------- the three looks and the factor views (Task 12, R32 and R33) ----------

LOOK_NAMES = (("diorama", "Diorama"), ("survey", "Survey sheet"), ("hud", "Helmet HUD"))


_LOOK_STATE = {  # R33: each look its own scene
    "diorama": {"exaggeration": 2, "contours": 0, "walls": "solid", "floor": "plinth", "background": "#070b0f", "shadows": True},
    "survey": {"exaggeration": 2, "contours": 10, "walls": "solid", "floor": "none", "background": "#e9e6dd", "shadows": False},
    "hud": {"exaggeration": 2.5, "contours": 5, "walls": "lines", "floor": "grid", "background": "#06101a", "shadows": False},
}
_LOOK_CAMERA = {"diorama": (2600, 50), "survey": (1500, 8), "hud": (150, 76)}


def test_three_looks(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    assert settle_tiles(page)
    looks = page.evaluate("[...document.querySelectorAll('#factors .look')].map((b) => [b.dataset.look, b.textContent, b.getAttribute('aria-pressed')])")
    assert looks == [[k, n, "true" if k == "diorama" else "false"] for k, n in LOOK_NAMES], looks
    assert page.evaluate("__map.store.get('look')") == "diorama"
    assert page.evaluate("__map.siteView.debug.look().tiles") is False  # the globe tiles are hidden: a lifted-out block
    centre = []
    for look, _ in LOOK_NAMES:
        page.locator('#factors .look[data-look="%s"]' % look).click()
        page.wait_for_function("(l) => __map.siteView.debug.look().look === l", arg=look, timeout=10000)
        page.evaluate("new Promise((r) => setTimeout(r, 1200))")
        page.wait_for_function("!__map.globe.flying()", timeout=20000)
        st = page.evaluate("__map.siteView.debug.look()")
        assert {k: st[k] for k in _LOOK_STATE[look]} == _LOOK_STATE[look], (look, st)
        alt, tilt = _LOOK_CAMERA[look]
        cam_alt = page.evaluate("__map.globe.altitude()") - page.evaluate("__map.siteView.flyTarget().targetAltM")
        assert abs(cam_alt - alt) < alt * 0.25 + 30, (look, cam_alt)
        assert abs(_tilt(page) - tilt) < 6, (look, _tilt(page))
        key = page.locator("#view-key").text_content()
        assert {"diorama": "Photo: HiRISE", "survey": "Survey sheet", "hud": "Helmet HUD"}[look] in key, key
        fps = page.evaluate("__map.siteView.debug.footprints().map((f) => f.colour)")  # the assessment colours in every look
        assert set(fps) <= {"#b8dfc2", "#ffb19b", "#e3c78f"}, fps
        page.wait_for_timeout(800)
        centre.append(page.evaluate(_PIXEL_JS, [640, 300]))
        _shot(page, "look-%s.png" % look)
    d, sv, hd = centre
    dist = lambda a, b: max(abs(x - y) for x, y in zip(a, b))
    assert dist(d, sv) > 40 and dist(sv, hd) > 40 and dist(d, hd) > 20, centre  # three clearly different scenes
    assert sv[2] > sv[0], centre  # the survey's blue slope ramp
    page.locator("#card .back").click()
    _wait_list(page, "gale")
    page.wait_for_function("(() => { const f = document.getElementById('factors'); return f.hidden || f.querySelector('.looks').hidden; })()", timeout=10000)
    assert page.evaluate("__map.globe.tiles.group.visible")  # the globe is back
    assert page.console_errors == []


def _tab(page, view):
    """Click a factor row's View on the site card (R33) and wait for the store and the key to show it."""
    page.locator('#card .factor[data-factor="%s"] .view' % view).click()
    page.wait_for_function("(v) => __map.store.get('view') === v && document.getElementById('view-key').dataset.view === v",
                           arg=view, timeout=10000)


def _key(page):
    return page.locator("#view-key").text_content()


def _view_options(page):
    """Open the factor view's own panel (its layer and case choices, a chart), collapsed under the key."""
    d = page.locator("#factors .view-more")
    if not d.evaluate("(d) => d.open"):
        d.locator(":scope > summary").click()


def _key_has(page, text):
    page.wait_for_function("(t) => document.getElementById('view-key').textContent.includes(t)", arg=text, timeout=30000)


def test_factor_views_site(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    assert settle_tiles(page)
    for f in ("GI", "SC", "TC", "IR"):  # every factor row has its View now
        assert page.locator('#card .factor[data-factor="%s"] .view' % f).count() == 1, f
    p = page.evaluate(_TERRAIN_POINT_JS, SITE)
    base = page.evaluate(_PIXEL_JS, [p["x"], p["y"]])
    # Ground & ice: the GRS tint over the terrain, a Demo view, with the site's own bin in the key
    _tab(page, "GI")
    page.wait_for_function("__map.siteView.debug.look().overlay", timeout=30000)
    k = _key(page)
    assert "wt% H₂O" in k and "5.4 ± 0.4" in k and "Demo" in k and "SWIM" in k, k
    page.wait_for_timeout(800)
    assert page.evaluate(_PIXEL_JS, [p["x"], p["y"]]) != base  # the tint is drawn
    _shot(page, "view-ground.png")
    _view_options(page)
    page.locator('#view-panel .choice[data-layer="ti"]').click()
    page.wait_for_function("__map.view('GI').debug().layer === 'ti'", timeout=10000)
    _key_has(page, "Thermal inertia")
    # Solar: the worst-season noon sun with shadows, and the skyline chart
    _tab(page, "SC")
    page.wait_for_function("__map.siteView.debug.look().shadows", timeout=10000)
    page.wait_for_function("__map.view('SC').debug().tilt", timeout=10000)  # the GI overlay went; the sun-on-ground tint is the Solar view's own
    k = _key(page)
    assert "worst-season noon sun" in k and "Demo" in k, k
    assert page.locator("#view-panel svg.skyline path.sun").count() == 2
    page.wait_for_timeout(1500)
    _shot(page, "view-solar.png")
    # Thermal: a THEMIS case over the terrain, a selector with the missing case marked
    _tab(page, "TC")
    assert page.evaluate("__map.siteView.debug.look().sunAt") is None  # the Solar sun went with its view
    page.wait_for_function("__map.siteView.debug.look().overlay", timeout=30000)
    cases = page.evaluate("[...document.querySelectorAll('#view-panel .choice')].map((b) => [b.dataset.case, b.disabled, b.textContent])")
    assert [c[0] for c in cases] == ["dayAph", "dayPeri", "nightAph", "nightPeri"], cases
    assert "Surface temperature" in _key(page), _key(page)
    _view_options(page)
    page.locator('#view-panel .choice[data-case="nightPeri"]').click()
    page.wait_for_function("__map.view('TC').debug().caseKey === 'nightPeri'", timeout=10000)
    _key_has(page, "night, perihelion")
    page.wait_for_timeout(800)
    _shot(page, "view-thermal.png")
    # Routes: the cable to the base with its length, the rover's path and stops, the trip-area slope
    _tab(page, "IR")
    page.wait_for_function("__map.view('IR').debug().vectors >= 2", timeout=60000)
    bt21 = page.evaluate("__map.results('%s').get('BT-21').display" % SITE)
    k = _key(page)
    assert ("Cable to the base (cyan): %s in a straight line" % bt21) in k and "Demo" in k, k
    assert page.evaluate("__map.siteView.root.getObjectByName('cable') !== undefined")
    page.wait_for_timeout(800)
    _shot(page, "view-routes.png")
    # the active tab again: back to the look, exactly as it was
    page.locator('#card .factor[data-factor="IR"] .view').click()  # the row's View again: off
    page.wait_for_function("__map.store.get('view') === null", timeout=10000)
    page.wait_for_function("!__map.siteView.root.getObjectByName('cable')", timeout=10000)
    page.wait_for_timeout(800)
    again = page.evaluate(_PIXEL_JS, [p["x"], p["y"]])
    assert max(abs(a - b) for a, b in zip(again, base)) <= 3, (base, again)
    # References lists the demo parts
    page.locator("#references-open").click()
    demo = page.locator('#references [data-part="demo"]').inner_text()
    assert "Ground & ice" in demo and "Routes" in demo and "Solar" in demo, demo
    # R33: a factor with no orbital estimate here shows a seeded simulated one, chip and words, listed as a demo part
    ir = page.locator('#card .factor[data-factor="IR"]')
    assert ir.locator(".sim-chip").count() == 1 and ir.locator(".f-text").text_content().startswith("Simulated for the demo: ")
    assert "Routes estimate" in demo, demo
    icons = page.evaluate("[...document.querySelectorAll('#card .factor')].map((f) => f.dataset.icon)")
    # R36, by availability: Terrain and Thermal each have an orbital estimate not computed yet (?), Ground & ice has no
    # orbital estimate (simulated, chip), Solar's are all computed and met
    assert [icons[0], icons[2], icons[3]] == ["?", "✓", "?"], icons
    assert page.locator('#card .factor[data-factor="GI"] .sim-chip').count() == 1
    assert "is not estimated yet" in page.locator('#card .factor[data-factor="BT"] .f-text').text_content()
    assert "is not estimated yet" in page.locator('#card .factor[data-factor="TC"] .f-text').text_content()
    page.locator("#references-close").click()
    # the views never touch a status or the priority
    before = page.evaluate("JSON.stringify([...__map.results('%s')].map(([k, r]) => [k, r.status]))" % SITE)
    for v in ("GI", "SC", "TC", "IR"):
        _tab(page, v)
        page.wait_for_timeout(300)
    after = page.evaluate("JSON.stringify([...__map.results('%s')].map(([k, r]) => [k, r.status]))" % SITE)
    assert before == after
    assert page.console_errors == []


def _hover_rows(page, xy, factor):
    """Hover a screen point and return the readout's row labels and text once the factor's probe has its data."""
    page.mouse.move(xy["x"] + 3, xy["y"] + 3)
    page.mouse.move(xy["x"], xy["y"])
    page.wait_for_function("(f) => { const r = document.getElementById('readout'); return r && !r.hidden && r.dataset.factor === f; }",
                           arg=factor, timeout=20000)
    page.wait_for_timeout(1500)  # the probe's loads; hover again to read them
    page.mouse.move(xy["x"] + 2, xy["y"])
    page.mouse.move(xy["x"], xy["y"])
    page.wait_for_timeout(400)
    labels = page.evaluate("[...document.querySelectorAll('#readout dt')].map((d) => d.textContent)")
    return labels, page.locator("#readout").inner_text()


def test_factor_probe_rows(page, server_url):
    """Each factor view's hover reads that factor's own data at the point, not the same terrain rows."""
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    assert settle_tiles(page)
    c = page.evaluate("__map.siteView.debug.lonLatScreen(__map.siteView.frame.lon0, __map.siteView.frame.lat0)")
    specific = {
        "BT": {"On a dune field", "Buildable here"},
        "GI": {"Geologic unit", "Nearest mineral find", "Thermal inertia", "Ground ice depth"},
        "SC": {"Ground faces", "Worst-season noon sun", "Sun above skyline"},
        "TC": {"Surface temperature", "Temperature case"},
        "IR": {"To the base", "Grade from the base", "To Curiosity's path"},
    }
    seen = {}
    for f in ("BT", "GI", "SC", "TC", "IR"):
        _tab(page, f)
        labels, text = _hover_rows(page, c, f)
        seen[f] = labels
        assert len(specific[f] & set(labels)) >= 2, (f, labels)
        assert "Position" not in labels, labels  # the position is the small line under the title
        assert not re.search(r"\b(BT|GI|SC|TC|IR)-\d\d\b", text), text  # no metric ids in visible text
        if f == "GI":
            assert "Simulated" in text, text  # the ice depth is labelled, never data
        if f == "TC":
            assert re.search(r"\d+ K", text) or "no data" in text, text
            _shot(page, "probe-thermal.png")
        if f == "SC":
            _shot(page, "probe-solar.png")
    assert len({tuple(v) for v in seen.values()}) == 5, seen
    assert page.console_errors == []


def test_factor_views_jezero(page, server_url):
    _boot(page, server_url)
    _start(page)
    # Jezero: its own data, and needs confirmation (never Gale's) where it has none
    _enter(page, "jezero")
    _open_row(page, "jezero_north")
    res = page.evaluate("Object.fromEntries([...__map.results('jezero_north')].filter(([k]) => ['BT-15', 'BT-16', 'GI-05', 'TC-01', 'SC-01'].includes(k)).map(([k, r]) => [k, [r.status, r.value]]))")
    assert res["BT-15"][0] == "needs_confirmation" and res["BT-16"][0] == "needs_confirmation", res
    assert res["GI-05"][1] != 5.415 and res["SC-01"][0] in ("met", "not_met"), res
    ids = page.evaluate("Object.values(__map.env('jezero').ids)")
    assert ids and all(i.endswith("__jezero") for i in ids), ids
    _tab(page, "TC")
    k = _key(page)
    assert "Demo" in k and "1 of 4" in k, k
    cases = page.evaluate("[...document.querySelectorAll('#view-panel .choice')].map((b) => [b.dataset.case, b.disabled])")
    assert cases == [["dayAph", True], ["dayPeri", True], ["nightAph", False], ["nightPeri", True]], cases
    assert "(missing)" in page.locator('#view-panel .choice[data-case="dayAph"]').text_content()
    page.wait_for_function("__map.siteView.debug.look().overlay", timeout=30000)
    _open_details(page, "BT")
    assert "no dune fields mapped here" in page.locator('#card .line[data-metric="BT-15"]').text_content()
    assert settle_tiles(page)
    page.wait_for_timeout(1000)
    _shot(page, "view-thermal-jezero.png")
    page.locator("#view-hide").click()  # Hide factor view
    page.wait_for_function("__map.store.get('view') === null && !__map.siteView.debug.look().overlay", timeout=10000)
    # back in the region view: no factor overlays (R33)
    page.locator("#card .back").click()
    _wait_list(page, "jezero")
    assert page.evaluate("!__map.globe.scene.children.some((o) => /^(patch|geology|rover|cables):/.test(o.name) && o.visible)")
    assert page.console_errors == []


# ---------- the construction brief and the facility step (Task 9: the Twin Trails intake) ----------

BRIEF_TITLE = "Construction site"  # design-reference/mars-construction-twin-trails.html
BRIEF_INTRO = "A few project details. A place to begin."
DEFAULTS_SUMMARY = "Planning defaults · optional to customize"
READY = "Ready for location matching."
PLANNING_CONTEXT = "Gale crater · Construction planning"
STEPS = ["1 Construction brief", "2 Facility specifications", "3 Location assessment"]
FACILITY_LABEL = "Illustrative reference — not calculated from your project."
SIZED_LABEL = "Calculated from your brief with screening assumptions — not a validated design."
GALE_SCENARIO = Path(__file__).resolve().parent.parent / "scenario" / "gale.json"
REQUIREMENT_ROWS = ["Buildable terrain", "Ground & ice evidence", "Solar conditions", "Thermal conditions", "Investigation routes"]


def _steps(page):
    """The stepper: [text, clickable, current] per step."""
    return page.evaluate("""() => [...document.querySelectorAll('#stepper [data-step]')].map((s) => [
        s.textContent.replace(/\\s+/g, ' ').trim(), !!s.querySelector('button'), s.getAttribute('aria-current') === 'step'])""")


def _texts(page, sel):
    return [t.strip() for t in page.locator(sel).all_text_contents()]


def _field_names(page, sel):
    """The intake's field labels inside sel, in panel order."""
    return _texts(page, sel + " .construction-field > .field-name")


def _computers(text):
    """The facility list's computer count ("4 computers (3 active, 1 spare)"), or None."""
    m = re.search(r"(?<!\d)(\d+) computers? \(\d+ active, \d+ spare\)", text)
    return int(m.group(1)) if m else None


def test_brief_intake_and_copy(page, server_url):
    hosts = record_request_hosts(page)
    _boot(page, server_url)
    assert page.locator("#landing p.support").text_content() == LANDING_SUPPORT
    page.locator("#landing-start").click()
    brief = page.locator("#brief")
    brief.wait_for(state="visible", timeout=10000)
    assert page.evaluate("__map.store.get('stage')") == "brief"
    assert page.locator("#landing").is_hidden() and page.locator("#brief-summary").is_hidden()  # one panel, no summary beside it
    assert page.locator("#header .base-context").text_content() == PLANNING_CONTEXT
    assert _steps(page) == [[STEPS[0], False, True], [STEPS[1], False, False], [STEPS[2], False, False]]
    # the editable defaults (state.js defaultBrief); the fleet they make is scenario/gale.json construction_project's
    b = page.evaluate("__map.store.get('brief')")
    assert b == {"workType": "earthworks", "robots": 20, "hours": 12, "duration": 180, "deadline": 4,
                 "name": "Gale landing pad & access road", "surveyPercent": 20, "excPercent": 50, "surveyActive": 100,
                 "otherActive": 80, "cadence": "Once per sol", "precision": "Earthworks check", "rawRetention": 30,
                 "productRetention": 180, "power": "Solar + storage", "basePower": 0, "backup": 12}, b
    fleet = page.evaluate("async () => (await import('/src/ui/brief.js')).toSizingBrief(__map.store.get('brief')).fleet")
    cp = json.loads(GALE_SCENARIO.read_text())["construction_project"]
    assert {f["role"].lower(): f["count"] for f in fleet} == {f["role"]: f["count"] for f in cp["fleet"]}, fleet
    assert b["hours"] == cp["operating_hours_per_sol"]
    # the panel's copy, verbatim
    assert brief.locator("#brief-title").text_content() == BRIEF_TITLE
    close = brief.locator("#brief-close")
    assert close.text_content() == "Close" and close.get_attribute("aria-label") == "Close construction brief"
    assert brief.locator(".panel-intro").text_content() == BRIEF_INTRO
    assert _texts(page, "#brief .input-section > h3") == ["01 · The construction", "02 · The schedule"]
    assert _field_names(page, "#brief .input-section") == [
        "Type of work", "Construction robots", "Working time", "Project duration", "Results needed within"]
    assert _texts(page, "#brief .input-section small.required") == ["Required"] * 5
    assert page.evaluate("[...document.querySelector('#brief [data-input=workType]').options].map((o) => [o.value, o.text])") == [
        ["earthworks", "Site preparation & earthworks"], ["survey", "Surveying & terrain mapping"]]
    assert [page.locator('#brief [data-input="%s"]' % k).input_value() for k in ("robots", "hours", "duration", "deadline")] == [
        "20", "12", "180", "4"]
    assert _texts(page, "#brief .input-section .unit") == ["robots", "h / sol", "sols", "hours"]
    assert brief.locator(".input-caption").text_content() == "Editable defaults · required fields are marked"
    assert _texts(page, "#brief button.primary") == ["Find area"]
    # the planning defaults: closed until asked for, every assumption editable
    d = brief.locator("details[data-defaults]")
    assert not d.evaluate("(d) => d.open") and d.locator("summary").text_content().startswith(DEFAULTS_SUMMARY)
    d.locator("summary").click()
    assert "Change any assumption below. Your edits are used in the calculation." in d.inner_text()
    assert _texts(page, "#brief .default-group > h3") == ["Robot mix", "Processing & retention", "Power & backup"]
    assert _field_names(page, "#brief details[data-defaults]") == [
        "Project name", "Survey share", "Excavation share", "Survey robots active together", "Other robots active together",
        "Processing frequency", "Processing precision", "Keep raw data", "Keep processed outputs",
        "Power approach", "Available base power", "Essential backup duration"]
    assert page.locator('#brief [data-input="name"]').input_value() == "Gale landing pad & access road"
    assert page.evaluate("[...document.querySelector('#brief [data-input=power]').options].map((o) => o.text)") == [
        "Solar + storage", "Hybrid", "Base connection"]
    page.wait_for_function("__map.globe.stats.layers.viking.ok > 4", timeout=TILE_WAIT_MS)  # the globe stays live beside it
    settle_tiles(page)
    _no_tiny_text_or_small_targets(page, "brief")
    _shot(page, "brief-intake.png")
    # Find area checks the values first: the message beside it, the field marked, the brief kept, nothing sized
    page.locator('#brief [data-input="excPercent"]').fill("90")
    page.locator("#brief-find").click()
    assert brief.locator(".form-error").text_content() == "Survey and excavation shares must add up to 100% or less."
    assert page.locator('#brief [data-input="surveyPercent"]').get_attribute("aria-invalid") == "true"
    page.locator('#brief [data-input="excPercent"]').fill("50")
    page.locator('#brief [data-input="robots"]').fill("0")
    page.locator("#brief-find").click()
    assert brief.locator(".form-error").text_content() == "Construction robots: enter a whole number from 1 to 1,000 robots."
    assert page.locator('#brief [data-input="robots"]').get_attribute("aria-invalid") == "true"
    assert page.locator('#brief [data-input="surveyPercent"]').get_attribute("aria-invalid") is None
    assert page.evaluate("[__map.store.get('stage'), __map.store.get('setup')]") == ["brief", {"loadKw": 150, "power": "topup"}]
    page.locator('#brief [data-input="robots"]').fill("20")
    _find_area(page)
    assert page.locator("#facility-title").text_content() == READY
    assert page.evaluate("__map.store.get('setup').source") == "brief"
    assert hosts <= GLOBE_HOSTS, hosts
    assert page.console_errors == []


def test_facility_step_is_calculated(page, server_url):
    _boot(page, server_url)
    _to_facility(page)
    fac = page.locator("#facility")
    assert page.evaluate("__map.store.get('stage')") == "facility"
    assert page.locator("#brief").is_hidden() and page.locator("#brief-summary").is_hidden()
    assert page.locator("#header .base-context").text_content() == PLANNING_CONTEXT
    assert _steps(page) == [[STEPS[0], True, False], [STEPS[1], False, True], [STEPS[2], False, False]]
    assert fac.locator("h2").text_content() == READY
    assert fac.locator(".panel-intro").text_content() == "Your construction requirements have been calculated."
    assert fac.locator(".sizing").count() == 0  # the "planned" line is gone
    assert fac.locator(".illustrative").text_content() == SIZED_LABEL
    text = fac.inner_text()
    assert FACILITY_LABEL not in text and "Results are kept for the whole project" in text and _computers(text) == 4, text
    assert fac.locator(".facility-list .ev-assumption").count() >= 10
    # what the facility needs from a site: the five requirement rows, each sized from the brief
    assert fac.locator(".site-needs h3").text_content() == "What the facility needs from a site"
    assert _texts(page, "#facility .site-needs .factor-name") == REQUIREMENT_ROWS
    assert fac.locator(".site-needs .factor-value.sized").count() == 5
    assert "≤ 3 km from base" in fac.locator(".site-needs").inner_text()
    fac.locator("details.assumptions summary").click()
    assert _texts(page, "#facility .form-actions button") == ["Edit brief", "Assess locations →"]
    assert _texts(page, "#facility button.primary") == ["Assess locations →"]
    _no_tiny_text_or_small_targets(page, "facility")
    _shot(page, "facility.png")
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    page.locator("#panel").wait_for(state="visible", timeout=10000)
    assert fac.is_hidden()
    page.wait_for_function("document.querySelector('#header .base-context').textContent === 'Gale, Jezero and Arcadia bases · Demo'",
                           timeout=5000)  # Task 9b's base context, from the next frame's render
    assert page.locator("#panel .brief-line").text_content() == "Gale landing pad & access road · 20 robots"
    assert page.locator("#panel .focus-line, #panel .answers").count() == 0  # the old intake's lines are gone
    assert _steps(page) == [[STEPS[0], True, False], [STEPS[1], True, False], [STEPS[2], False, True]]
    assert page.evaluate("__map.store.get('setup').source") == "brief"
    assert page.console_errors == []


def test_stepper_keeps_values(page, server_url):
    _boot(page, server_url)
    page.locator("#landing-start").click()
    page.locator("#brief").wait_for(state="visible", timeout=10000)
    page.locator("#brief details[data-defaults] > summary").click()
    page.locator('#brief [data-input="name"]').fill("North field utility trench")
    # "Back to globe" returns to the landing; its action now continues the brief
    assert page.locator("#home-link").text_content() == "Back to globe"
    page.locator("#home-link").click()
    page.wait_for_function("__map.store.get('stage') === 'landing'", timeout=10000)
    assert page.locator("#home-link").count() == 0 and page.locator("#brief").is_hidden()
    assert page.locator("#landing-start").text_content() == LANDING_CONTINUE
    page.locator("#landing-start").click()
    page.locator("#brief").wait_for(state="visible", timeout=10000)
    assert page.locator('#brief [data-input="name"]').input_value() == "North field utility trench"
    page.locator('#brief [data-input="robots"]').fill("22")
    _find_area(page)
    # Edit brief on the facility step: the brief as it was left
    page.locator("#facility-edit").click()
    page.wait_for_function("__map.store.get('stage') === 'brief'", timeout=10000)
    assert page.locator('#brief [data-input="robots"]').input_value() == "22"
    _find_area(page)
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    assert page.locator("#panel .brief-line").text_content() == "North field utility trench · 22 robots"
    assert page.locator("#home-link").count() == 0  # the globe is already here
    # step 1 from step 3: the brief as it was left, every value kept
    page.locator('#stepper [data-step="1"] button').click()
    page.wait_for_function("__map.store.get('stage') === 'brief'", timeout=10000)
    assert page.locator("#panel").is_hidden() and page.locator("#brief").is_visible()
    assert page.locator('#brief [data-input="name"]').input_value() == "North field utility trench"
    assert page.locator('#brief [data-input="robots"]').input_value() == "22"
    assert page.evaluate("__map.store.get('brief').robots") == 22
    assert _steps(page)[2] == [STEPS[2], False, False]  # a later step is reached by Find area, not jumped to
    # step 2 from step 3 too, and back to step 3 through it
    _find_area(page)
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    page.locator('#stepper [data-step="2"] button').click()
    page.wait_for_function("__map.store.get('stage') === 'facility'", timeout=10000)
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    assert page.locator("#panel .brief-line").text_content() == "North field utility trench · 22 robots"
    assert page.console_errors == []


def test_flow_brief_sizes_and_ranks(page, server_url):
    """The intake's defaults size the facility and the Gale list ranks the sites against it: the two near the base first,
    curiosity_recent set aside for its cable route (BT-21). Fewer robots size a smaller facility, and every site is
    checked again against it."""
    _boot(page, server_url)
    _to_facility(page)
    fac = page.locator("#facility")
    assert fac.locator("#facility-title").text_content() == READY
    workers = "__map.store.get('setup').sizing.assessed.specifications.workers.value"
    n0 = page.evaluate(workers)
    assert isinstance(n0, int) and n0 > 0 and _computers(fac.inner_text()) == n0, (n0, fac.inner_text())
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    _enter(page, "gale")
    # curiosity_recent's grids (169 MB) load when it is opened: until then the list ranks 2 of 3 and shows it unranked
    assert page.evaluate("__map.store.get('priority').get('gale').length") == 2
    late = [r for r in _rows(page) if r["site"] == "curiosity_recent"]
    assert len(late) == 1 and late[0]["prio"] == "·" and all(i.endswith(":?") for i in late[0]["icons"]), late
    assert re.fullmatch(r"Large site \(\d+ MB\): checked when you open it", late[0]["verdict"]), late
    assert "Ranked 2 of 3 sites" in page.locator("#panel").inner_text()
    page.evaluate("__map.openSite('curiosity_recent').then(() => true)")  # loads, checks and ranks it
    page.evaluate("__map.closeSite().then(() => true)")
    page.wait_for_function("__map.store.get('priority').get('gale').length === 3", timeout=FLOW_TIMEOUT_MS)
    _wait_list(page, "gale")
    prio = page.evaluate("__map.store.get('priority').get('gale').map((r) => [r.siteId, r.priority, r.failures])")
    near = [p for p in prio if p[0] in ("near_base_north", "near_base_west")]
    aside = [p for p in prio if p[0] == "curiosity_recent"]
    assert len(prio) == 3 and len(near) == 2 and all(p[2] == [] for p in near), prio
    assert len(aside) == 1 and aside[0][2] == ["BT-21"] and aside[0][1] > max(p[1] for p in near), prio
    bt21 = page.evaluate("(() => { const r = __map.results('curiosity_recent').get('BT-21'); return [r.status, r.display]; })()")
    m = re.fullmatch(r"(\d+) m of (\d+) m", bt21[1])
    assert bt21[0] == "not_met" and m and int(m.group(2)) == 3000 and int(m.group(1)) > 10000, bt21  # ~11 km; the limit is 3 km
    rows = _rows(page)
    assert [r["site"] for r in rows][-1] == "curiosity_recent" and rows[-1]["verdict"].startswith("Not recommended: "), rows
    assert all(r["verdict"].startswith("No failures") for r in rows[:-1]), rows
    page.evaluate("""() => { window.__before = Object.fromEntries(['near_base_north', 'near_base_west', 'curiosity_recent']
        .map((id) => [id, { bt04: __map.results(id).get('BT-04'), sc03: __map.results(id).get('SC-03').value }])); }""")
    # Edit the brief: fewer robots, Find area, Assess locations
    page.locator("#results-edit").click()
    page.wait_for_function("__map.store.get('stage') === 'brief'", timeout=10000)
    assert page.locator('#brief [data-input="robots"]').input_value() == "20"
    page.locator('#brief [data-input="robots"]').fill("12")
    _find_area(page)
    n1 = page.evaluate(workers)
    assert n1 < n0 and _computers(fac.inner_text()) == n1, (n0, n1, fac.inner_text())
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    _wait_list(page, "gale")
    again = page.evaluate("""() => Object.entries(window.__before).map(([id, b]) => [id,
        __map.results(id).get('BT-04') !== b.bt04, __map.results(id).get('SC-03').value, b.sc03])""")
    assert all(a[1] for a in again), again  # every site checked again, against the new facility
    assert any(a[2] != a[3] for a in again), again  # the smaller panels change what the site's sun supplies
    assert page.evaluate("__map.store.get('priority').get('gale').length") == 3
    assert page.locator("#panel .brief-line").text_content() == "Gale landing pad & access road · 12 robots"
    assert page.console_errors == []


# ---------- the Diorama's plaque, callouts and profiles (Task 10) ----------

_METRIC_ID = re.compile(r"\b(BT|GI|SC|TC|IR)-\d\d\b")
_DIORAMA_JS = """() => {
    const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    const plaque = document.getElementById('diorama-plaque'), prof = document.getElementById('diorama-profiles');
    const callouts = [...document.querySelectorAll('#labels .callout')];
    return {
        plaque: vis(plaque) ? plaque.innerText : null,
        profiles: vis(prof) ? prof.querySelectorAll('svg polyline').length : 0,
        profileText: vis(prof) ? prof.innerText : '',
        callouts: callouts.length,
        shown: callouts.filter((c) => vis(c) && !c.classList.contains('culled')).map((c) => c.innerText),
        where: callouts.map((c) => c.dataset.footprint),
    };
}"""


def _diorama(page):
    return page.evaluate(_DIORAMA_JS)


def _wait_diorama(page, on):
    page.wait_for_function(
        "(on) => { const p = document.getElementById('diorama-plaque'); const n = document.querySelectorAll('#labels .callout').length;"
        " return on ? (!!p && !p.hidden && n >= 3) : ((!p || p.hidden) && n === 0); }",
        arg=on, timeout=20000)


def test_diorama_plaque_callouts_profiles(page, server_url):
    _boot(page, server_url)
    _start(page)
    _enter(page, "gale")
    _open_row(page, SITE)
    assert settle_tiles(page)
    _wait_diorama(page, True)
    page.wait_for_timeout(1500)  # the declutter pass runs on the frame loop
    d = _diorama(page)
    _shot(page, "diorama-extras.png")
    name = page.locator("#card .card-head h2").text_content()
    prio = page.locator("#card .prio-badge").text_content()
    verdict = page.locator("#card .verdict").text_content()
    assert name in d["plaque"] and prio in d["plaque"] and verdict in d["plaque"], (d["plaque"], name, prio, verdict)
    assert sorted(d["where"]) == ["compound", "radiator", "solar"], d
    assert len(d["shown"]) >= 2, d  # at 1280x800 the declutter may hide the third behind the profile panel
    factor_names = ("Terrain", "Solar", "Thermal")
    assert sum(any(f in t for t in d["shown"]) for f in factor_names) >= 2, d["shown"]
    assert d["profiles"] == 2 and "West" in d["profileText"] and "South" in d["profileText"], d
    visible = d["plaque"] + " ".join(d["shown"]) + d["profileText"]
    assert not _METRIC_ID.search(visible), visible
    for look in ("survey", "hud"):
        page.locator('#factors .look[data-look="%s"]' % look).click()
        page.wait_for_function("(l) => __map.siteView.debug.look().look === l", arg=look, timeout=10000)
        _wait_diorama(page, False)
        assert _diorama(page)["profiles"] == 0
    page.locator('#factors .look[data-look="diorama"]').click()
    _wait_diorama(page, True)
    assert _diorama(page)["profiles"] == 2
    page.locator("#card .back").click()
    _wait_list(page, "gale")
    _wait_diorama(page, False)
    assert page.console_errors == []


# ---------- end to end: the whole app, hooked up ----------

E2E_FACTORS = ("BT", "GI", "SC", "TC", "IR")


def _no_metric_ids(page, sel, where):
    """No metric id in an element's visible text (closed <details> folded)."""
    seen = page.evaluate(_VISIBLE_TEXT_JS, sel)
    m = _METRIC_ID.search(seen)
    assert not m, (where, seen[max(0, m.start() - 60):][:120])


def _assert_card(page, site_id):
    card = page.locator("#card")
    assert card.get_attribute("data-site") == site_id
    assert card.locator(".card-head h2").text_content().strip(), site_id
    assert re.search(r"\d", card.locator(".prio-badge").text_content()), site_id
    assert card.locator(".card-head .verdict").text_content().strip(), site_id
    assert [f.get_attribute("data-factor") for f in card.locator(".factor").all()] == list(E2E_FACTORS), site_id
    _no_metric_ids(page, "#card", site_id)
    _no_metric_ids(page, "#panel", site_id)


def test_e2e_full_flow(page, server_url):
    """Landing to brief to facility to globe to region to every Gale site, its looks and factor views, then Jezero and
    References: every step is wired to the next, with no console or page errors anywhere."""
    t0 = time.time()
    _boot(page, server_url)
    # 1. landing -> the construction intake (its defaults) -> Find area -> facility, ready -> Assess locations
    page.locator("#landing-start").click()
    page.locator("#brief").wait_for(state="visible", timeout=10000)
    assert page.evaluate("__map.store.get('stage')") == "brief"
    _find_area(page)
    assert page.locator("#facility-title").text_content() == READY
    page.locator("#facility-assess").click()
    page.wait_for_function("__map.store.get('stage') === 'explore'", timeout=10000)
    page.locator("#panel").wait_for(state="visible", timeout=10000)
    assert page.evaluate("__map.store.get('stage')") == "explore"

    # 2. the globe's three region pins; Gale's candidate list with five factor icons per site, each with a tip
    assert page.locator(".pin").count() == 3
    for region, name in (("gale", "Gale"), ("jezero", "Jezero"), ("arcadia", "Arcadia")):
        assert name in page.locator(".pin[data-region=%s]" % region).inner_text(), region
    _enter(page, "gale")
    rows = page.locator("#panel .site-row")
    assert rows.count() == 3
    gale_sites = [r.get_attribute("data-site") for r in rows.all()]
    for i in range(3):
        icons = rows.nth(i).locator(".icon")
        assert icons.count() == 5, gale_sites[i]
        tips = [icons.nth(j).get_attribute("data-tip") or "" for j in range(5)]
        assert all(t.strip() for t in tips), (gale_sites[i], tips)

    # 3. each Gale site in turn: the card's name, priority, verdict and five factor rows; no metric ids on screen
    for i, site in enumerate(gale_sites):
        if i:
            page.locator("#card .back").click()
            _wait_list(page, "gale")
        _open_row(page, site)
        _assert_card(page, site)
        if i:
            continue
        # 4a. the first site: Diorama -> Survey sheet -> Helmet HUD -> Diorama; the plaque only in the Diorama
        assert page.evaluate("__map.store.get('look')") == "diorama"
        _wait_diorama(page, True)
        for look in ("survey", "hud", "diorama"):
            before = page.evaluate("__map.store.get('look')")
            page.locator('#factors .look[data-look="%s"]' % look).click()
            page.wait_for_function("(l) => __map.store.get('look') === l && __map.siteView.debug.look().look === l",
                                   arg=look, timeout=10000)
            assert page.evaluate("__map.store.get('look')") != before
            _wait_diorama(page, look == "diorama")
            page.wait_for_function("!__map.globe.flying()", timeout=20000)
            _shot(page, "e2e-look-%s.png" % look)
        # 4b. each factor row's View: the store's view, the readout's own rows at the site centre, then View off
        c = page.evaluate("__map.siteView.debug.lonLatScreen(__map.siteView.frame.lon0, __map.siteView.frame.lat0)")
        seen = {}
        for f in E2E_FACTORS:
            _tab(page, f)
            assert page.evaluate("__map.store.get('view')") == f
            labels, text = _hover_rows(page, c, f)
            assert labels, (f, text)
            assert not _METRIC_ID.search(text), (f, text)
            seen[f] = tuple(labels)
            page.locator('#card .factor[data-factor="%s"] .view' % f).click()
            page.wait_for_function(
                "(f) => __map.store.get('view') === null && document.getElementById('view-key').dataset.view !== f"
                " && document.querySelector('#card .factor[data-factor=\"' + f + '\"] .view').getAttribute('aria-pressed') === 'false'",
                arg=f, timeout=10000)
        assert len(set(seen.values())) == 5, seen

    # 5. back to the region list, back to the whole globe, then Jezero and its first site
    page.locator("#card .back").click()
    page.wait_for_function("__map.siteView === null && document.getElementById('card').children.length === 0", timeout=20000)
    _wait_list(page, "gale")
    for _ in range(12):  # zoom out until the panel lists the regions again
        if page.locator("#panel .region-card").count() == 3:
            break
        page.locator("#globe-out").click()
        page.wait_for_function("!__map.globe.flying()", timeout=20000)
    page.locator('#panel .region-card[data-region="jezero"]').wait_for(state="visible", timeout=20000)
    page.locator('#panel .region-card[data-region="jezero"]').click()
    _wait_list(page, "jezero")
    jrows = page.locator("#panel .site-row")
    assert jrows.count() == 2
    assert all(r.locator(".icon").count() == 5 for r in jrows.all())
    first = jrows.first.get_attribute("data-site")
    _open_row(page, first)
    _assert_card(page, first)

    # 6. References lists the datasets with links; Escape closes it
    page.locator("#references-open").click()
    page.locator('#references [data-part="all"]').wait_for(state="visible", timeout=10000)
    assert page.locator('#references [data-part="all"] .ref').count() >= 10
    hrefs = page.evaluate("[...document.querySelectorAll('#references [data-part=all] a[href]')].map((a) => a.href)")
    assert len(hrefs) >= 10 and all(h.startswith("http") for h in hrefs), hrefs[:5]
    page.keyboard.press("Escape")
    page.locator('#references [data-part="all"]').wait_for(state="hidden", timeout=5000)
    assert not page.evaluate("document.getElementById('references').open")

    # 7. no console errors and no page errors anywhere on the way
    assert page.console_errors == [], page.console_errors
    print("e2e flow: %.1f s" % (time.time() - t0))
