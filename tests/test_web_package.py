"""Unit tests for web/package.py, the GitHub Pages build. Small fake data only."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

WEB = Path(__file__).resolve().parent.parent / "web"


def _load():
    spec = importlib.util.spec_from_file_location("web_package", WEB / "package.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


package = _load()

BOUNDS = [137.0, -4.0, 137.0004, -3.9996]


def _grid(w, h):
    return {
        "width": w, "height": h, "bounds": BOUNDS,
        "pixel_deg": [(BOUNDS[2] - BOUNDS[0]) / w, (BOUNDS[3] - BOUNDS[1]) / h],
        "dtype": "f32", "byte_order": "little", "nodata": "NaN", "crs": "test",
    }


def _f32_entry(data_dir, rel, arr):
    p = data_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    raw = np.asarray(arr, dtype="<f4").tobytes()
    p.write_bytes(raw)
    h, w = np.asarray(arr).shape
    return {"path": rel, "format": "f32", "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(), "grid": _grid(w, h)}


def _dataset(did, files, res=1, metrics=(), access="local"):
    return {"id": did, "title": did, "access": access, "files": files,
            "resolution_m": res, "metrics": list(metrics)}


def _make(tmp_path, datasets, manifest, extra_catalog=None):
    web = tmp_path / "web"
    data = tmp_path / "data"
    (web / "src").mkdir(parents=True)
    (web / "vendor").mkdir()
    (web / "tests").mkdir()
    (web / "tools").mkdir()
    (web / "dist").mkdir()
    for name, text in {"index.html": "<html></html>", "styles.css": "a{}", "metrics.json": "{}",
                       "serve.py": "x", "package.py": "x"}.items():
        (web / name).write_text(text)
    (web / "datasets.json").write_text(json.dumps(manifest))
    (web / "src" / "main.js").write_text("//")
    (web / "vendor" / "v.js").write_text("//")
    (web / "tests" / "t.js").write_text("//")
    (web / "tools" / "b.py").write_text("#")
    (web / "dist" / "old.txt").write_text("old")
    data.mkdir(exist_ok=True)
    cat = {"version": 1, "scenario_file": "scenario/x.json", "areas": {"a": 1}, "references": [{"id": "r"}],
           "coverage_report": {}, "datasets": datasets}
    cat.update(extra_catalog or {})
    (data / "catalog.json").write_text(json.dumps(cat))
    (data / "scenario.json").write_text('{"sites": []}')
    return web, data, tmp_path / "out"


def test_package_reduces_conservatively(tmp_path):
    data_dir = tmp_path / "data"
    slope = np.zeros((4, 4), dtype="<f4")
    slope[1, 2] = 30.0
    slope[3, 0] = np.nan
    elev = np.arange(16, dtype="<f4").reshape(4, 4)
    elev[0, 0] = np.nan
    ds = [
        _dataset("slope_1m_s", [_f32_entry(data_dir, "elevation/slope_1m_s.f32", slope)], 1, ["BT-05"]),
        _dataset("elevation_1m_s", [_f32_entry(data_dir, "elevation/elevation_1m_s.f32", elev)], 1, ["BT-04"]),
        _dataset("elevation_2m_s", [_f32_entry(data_dir, "elevation/elevation_2m_s.f32", elev)], 2, ["BT-17"]),
    ]
    web, data, out = _make(tmp_path, ds, ["slope_1m_s", "elevation_1m_s", "elevation_2m_s"])
    res = package.build(web, data, out)
    assert res["files"] > 0 and res["bytes"] > 0

    cat = json.loads((out / "data/catalog.json").read_text())
    by = {d["id"]: d for d in cat["datasets"]}

    s = by["slope_1m_s"]
    f = s["files"][0]
    out_slope = np.frombuffer((out / "data" / f["path"]).read_bytes(), dtype="<f4").reshape(2, 2)
    assert out_slope[0, 1] == 30.0  # the 30 degree cell survives in its block
    assert out_slope[0, 0] == 0.0 and out_slope[1, 1] == 0.0
    assert out_slope[1, 0] == 0.0  # NaN-aware: the NaN cell does not poison the block
    assert (f["grid"]["width"], f["grid"]["height"]) == (2, 2)
    assert s["resolution_m"] == 2
    assert f["bytes"] == 16
    assert f["sha256"] == hashlib.sha256((out / "data" / f["path"]).read_bytes()).hexdigest()
    assert f["grid"]["pixel_deg"][0] == pytest.approx(2 * _grid(4, 4)["pixel_deg"][0])
    assert f["grid"]["bounds"] == BOUNDS

    e = by["elevation_1m_s"]["files"][0]
    out_elev = np.frombuffer((out / "data" / e["path"]).read_bytes(), dtype="<f4").reshape(2, 2)
    assert out_elev[0, 0] == pytest.approx((1 + 4 + 5) / 3)  # NaN ignored in the mean
    assert out_elev[1, 1] == pytest.approx((10 + 11 + 14 + 15) / 4)

    # 2 m datasets are copied unchanged
    u = by["elevation_2m_s"]["files"][0]
    assert (u["grid"]["width"], u["grid"]["height"]) == (4, 4)
    assert (out / "data" / u["path"]).read_bytes() == (data / u["path"]).read_bytes()


def test_package_reduces_odd_sizes(tmp_path):
    data_dir = tmp_path / "data"
    arr = np.ones((3, 5), dtype="<f4")
    ds = [_dataset("roughness_1m_s", [_f32_entry(data_dir, "e/r.f32", arr)], 1, ["BT-08"])]
    web, data, out = _make(tmp_path, ds, ["roughness_1m_s"])
    package.build(web, data, out)
    f = json.loads((out / "data/catalog.json").read_text())["datasets"][0]["files"][0]
    assert (f["grid"]["width"], f["grid"]["height"]) == (3, 2)
    assert f["bytes"] == 3 * 2 * 4 == (out / "data" / f["path"]).stat().st_size


def test_package_fails_on_unknown_id(tmp_path):
    web, data, out = _make(tmp_path, [], ["no_such_dataset"])
    with pytest.raises(package.PackageError, match="no_such_dataset"):
        package.build(web, data, out)


def test_package_fails_on_missing_file(tmp_path):
    f = {"path": "x/missing.png", "format": "png", "bytes": 3, "sha256": "0"}
    web, data, out = _make(tmp_path, [_dataset("d", [f])], ["d"])
    with pytest.raises(package.PackageError, match="missing.png"):
        package.build(web, data, out)


def test_package_size_limits(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "big").mkdir(parents=True)
    big = data_dir / "big" / "huge.bin"
    with open(big, "wb") as fh:
        fh.truncate(101 * 1024 * 1024)  # sparse
    f = {"path": "big/huge.bin", "format": "bin", "bytes": big.stat().st_size, "sha256": "0"}
    web, data, out = _make(tmp_path, [_dataset("d", [f])], ["d"])
    with pytest.raises(package.PackageError, match="huge.bin"):
        package.build(web, data, out)


def test_package_total_limit(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "big").mkdir(parents=True)
    ds = []
    for i in range(4):
        p = data_dir / "big" / ("part%d.bin" % i)
        with open(p, "wb") as fh:
            fh.truncate(90 * 1024 * 1024)
        ds.append(_dataset("d%d" % i, [{"path": "big/part%d.bin" % i, "format": "bin",
                                        "bytes": p.stat().st_size, "sha256": "0"}]))
    web, data, out = _make(tmp_path, ds, ["d0", "d1", "d2", "d3"])
    with pytest.raises(package.PackageError, match="300"):
        package.build(web, data, out)


def test_package_writes_nojekyll_and_trimmed_catalog(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "x").mkdir(parents=True)
    (data_dir / "x/a.png").write_bytes(b"png")
    (data_dir / "x/a.json").write_text("{}")
    (data_dir / "x/unused.png").write_bytes(b"u")
    files = [
        {"path": "x/a.png", "format": "png", "bytes": 3, "sha256": "0"},
        {"path": "x/a.json", "format": "json", "bytes": 2, "sha256": "0"},
    ]
    ds = [
        _dataset("kept", files),
        _dataset("fmt", files),
        _dataset("dropped", [{"path": "x/unused.png", "format": "png", "bytes": 1, "sha256": "0"}]),
        _dataset("tiles", [], access="live"),
    ]
    web, data, out = _make(tmp_path, ds, ["kept", {"id": "fmt", "formats": ["png"]}])
    (web / "src" / "route").mkdir()
    (web / "src" / "route" / "datasets.json").write_text(json.dumps(["tiles"]))
    package.build(web, data, out)

    assert (out / ".nojekyll").is_file()
    cat = json.loads((out / "data/catalog.json").read_text())
    by = {d["id"]: d for d in cat["datasets"]}
    assert set(by) == {"kept", "fmt", "tiles"}
    assert [f["format"] for f in by["fmt"]["files"]] == ["png"]
    assert [f["format"] for f in by["kept"]["files"]] == ["png", "json"]
    assert cat["areas"] == {"a": 1} and cat["references"] == [{"id": "r"}]
    assert cat["scenario_file"] == "scenario/x.json"
    assert (out / "data/scenario.json").is_file()
    assert (out / "data/x/a.png").is_file() and not (out / "data/x/unused.png").exists()

    # web files copied, dev-only ones skipped
    for name in ("index.html", "styles.css", "metrics.json", "datasets.json", "src/main.js", "vendor/v.js",
                 "src/route/datasets.json"):
        assert (out / name).is_file(), name
    for name in ("tests", "tools", "dist", "serve.py", "package.py"):
        assert not (out / name).exists(), name


def test_package_replaces_old_output(tmp_path):
    web, data, out = _make(tmp_path, [], [])
    out.mkdir()
    (out / "stale.txt").write_text("x")
    package.build(web, data, out)
    assert not (out / "stale.txt").exists()
