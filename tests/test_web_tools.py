"""Tests for the loopback dev server (web/serve.py)."""

from __future__ import annotations

import http.client
import importlib.util
import threading
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parent.parent / "web"


def _load_serve():
    spec = importlib.util.spec_from_file_location("web_serve", WEB / "serve.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def serve():
    return _load_serve()


def _get(srv, path):
    t = threading.Thread(target=srv.handle_request, daemon=True)
    t.start()
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
    conn.request("GET", path)  # path sent as given, no client-side normalisation
    resp = conn.getresponse()
    body = resp.read()
    headers = {k.lower(): v for k, v in resp.getheaders()}
    conn.close()
    t.join(5)
    return resp.status, headers, body


def test_server_binds_loopback_only(serve, tmp_path):
    srv = serve.make_server(WEB, tmp_path)
    try:
        assert srv.server_address[0] == "127.0.0.1"
    finally:
        srv.server_close()


def test_server_maps_data_prefix(serve, tmp_path):
    (tmp_path / "x.json").write_text('{"ok": true}')
    srv = serve.make_server(WEB, tmp_path)
    try:
        status, headers, body = _get(srv, "/data/x.json")
    finally:
        srv.server_close()
    assert status == 200
    assert body == b'{"ok": true}'
    assert headers["cache-control"] == "public, max-age=86400"


def test_server_caches_data_but_not_app_code_or_errors(serve, tmp_path):
    srv = serve.make_server(WEB, tmp_path)
    try:
        _, app, _ = _get(srv, "/index.html")
        status, missing, _ = _get(srv, "/data/nope.json")
    finally:
        srv.server_close()
    assert app["cache-control"] == "no-store"
    assert status == 404 and missing["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "path",
    [
        "/data/../secret.txt",
        "/data/%2e%2e/secret.txt",
        "/data/..%2fsecret.txt",
        "/data/../data2/x.txt",
    ],
)
def test_server_rejects_traversal(serve, tmp_path, path):
    data = tmp_path / "data"
    data.mkdir()
    (tmp_path / "secret.txt").write_text("SENTINEL")
    (tmp_path / "data2").mkdir()
    (tmp_path / "data2" / "x.txt").write_text("SENTINEL")
    srv = serve.make_server(WEB, data)
    try:
        status, _, body = _get(srv, path)
    finally:
        srv.server_close()
    assert status == 404
    assert b"SENTINEL" not in body


def test_server_without_data_dir_404s_data(serve):
    srv = serve.make_server(WEB, None)
    try:
        status, _, _ = _get(srv, "/data/x.json")
    finally:
        srv.server_close()
    assert status == 404


# ---- build_metrics -------------------------------------------------------

DOCS = WEB.parent / "docs" / "requirements"


def _load_build_metrics():
    spec = importlib.util.spec_from_file_location(
        "web_build_metrics", WEB / "tools" / "build_metrics.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build_metrics = None


def _bm():
    global build_metrics
    if build_metrics is None:
        build_metrics = _load_build_metrics()
    return build_metrics


def _by_id(metrics, mid):
    return next(x for x in metrics if x["id"] == mid)


def test_metrics_json_has_all_72():
    m = _bm().build(DOCS)
    assert len(m) == 72 and len({x["id"] for x in m}) == 72
    assert [x["id"] for x in m] == sorted(x["id"] for x in m)


def test_metrics_fields_for_bt01():
    bt01 = _by_id(_bm().build(DOCS), "BT-01")
    assert bt01["pd"] == "P" and bt01["baseline"] == "P: ≥ 1.0" and bt01["ideal"] == "P: ≥ 1.3"
    assert bt01["availability"] == "estimate_today" and bt01["appliesTo"] == "layout"
    assert bt01["factor"] == "BT" and bt01["name"] == "Connected area ratio"


def test_metrics_applies_to_overrides():
    m = _bm().build(DOCS)
    for mid in ("BT-17", "BT-18", "BT-19", "BT-20"):
        assert _by_id(m, mid)["appliesTo"] == "route"
    assert _by_id(m, "GI-06")["appliesTo"] == "layout"
    assert _by_id(m, "GI-01")["appliesTo"] == "compound"
    assert _by_id(m, "TC-01")["appliesTo"] == "radiator"


def test_metrics_availability_values_closed_set():
    m = _bm().build(DOCS)
    allowed = {"estimate_today", "partial", "field_needed", "planning"}
    assert all(x["availability"] in allowed for x in m)
    assert _by_id(m, "GI-01")["availability"] == "field_needed"
    assert _by_id(m, "SC-02")["availability"] == "planning"


def test_metrics_fieldwork_column():
    """R20: the site card's "settled by" text is the availability doc's fieldwork column."""
    m = _bm().build(DOCS)
    assert _by_id(m, "GI-01")["fieldwork"] == "Soil/rock characterization and appropriate probing/load tests"
    assert _by_id(m, "BT-08")["fieldwork"] == "Measure finer surface irregularities"
    assert all(isinstance(x["fieldwork"], str) and x["fieldwork"].strip() for x in m)
    assert not any("**" in x["fieldwork"] or "|" in x["fieldwork"] for x in m)


def test_committed_metrics_json_is_current():
    import json
    raw = (WEB / "metrics.json").read_text(encoding="utf-8")
    assert raw.endswith("\n")
    assert _bm().build(DOCS) == json.loads(raw)["metrics"]
