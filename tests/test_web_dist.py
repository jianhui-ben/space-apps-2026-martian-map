"""Browser test: the GitHub Pages build (web/dist) runs from plain static files."""

from __future__ import annotations

import importlib.util
import os
import threading
from pathlib import Path
from urllib.parse import urlparse

import pytest

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    pytest.skip("playwright is not installed", allow_module_level=True)

WEB = Path(__file__).resolve().parent.parent / "web"
CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
ALLOWED_HOSTS = {"127.0.0.1", "trek.nasa.gov"}


def _load(name):
    spec = importlib.util.spec_from_file_location("web_" + name, WEB / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def dist(tmp_path_factory):
    data = os.environ.get("MARTIAN_MAP_DATA")
    if not data:
        pytest.skip("MARTIAN_MAP_DATA is not set")
    out = tmp_path_factory.mktemp("dist") / "dist"
    _load("package").build(WEB, Path(data), out)
    return out


@pytest.fixture(scope="module")
def dist_url(dist):
    srv = _load("serve").make_server(dist, dist / "data")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % srv.server_address[1]
    srv.shutdown()
    srv.server_close()


@pytest.fixture(scope="module")
def _browser():
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=CHROMIUM_ARGS)
        except Exception as exc:
            pytest.skip("Chromium will not launch: %s" % str(exc).splitlines()[0])
        yield browser
        browser.close()


def test_dist_runs_from_static_files(_browser, dist_url):
    page = _browser.new_page()
    errors, hosts = [], set()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
    page.on("request", lambda r: hosts.add(urlparse(r.url).hostname))
    try:
        page.goto(dist_url + "/")
        page.wait_for_function("window.__map !== undefined", timeout=120000)
        page.evaluate("window.__map.ready")

        got = page.evaluate(
            """async () => {
              const cat = await (await fetch('./data/catalog.json')).json();
              const d = cat.datasets.find((x) => x.id === 'elevation_1m_near_base_north');
              const f = d.files.find((x) => x.format === 'f32');
              const buf = await (await fetch('./data/' + f.path)).arrayBuffer();
              return { n: cat.datasets.length, res: d.resolution_m, w: f.grid.width, h: f.grid.height,
                       bytes: buf.byteLength, declared: f.bytes };
            }"""
        )
        assert got["n"] > 10
        assert got["res"] == 2
        assert got["bytes"] == got["declared"] == got["w"] * got["h"] * 4
        assert page.evaluate("window.__map.catalog !== null")
        assert errors == []
        assert hosts <= ALLOWED_HOSTS, hosts
    finally:
        page.close()
