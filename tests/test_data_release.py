import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from conftest import FakeResponse, FakeSession
from martian_map import data_release as dr
from martian_map.catalog import Catalog, file_record, new_entry
from martian_map.http import Fetcher

REPO = "jianhui-ben/space-apps-2026-martian-map"
TAG = "data-test"


def _entry(root: Path, eid: str, rel: str, region: str, body: bytes, dataset: str = None):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    e = new_entry(eid, eid, "s", ["terrain"], "elevation", "derived", "local", files=[file_record(path, root, "f32")])
    e["region"], e["dataset"] = region, dataset or eid
    return e


def _data_root(tmp_path: Path) -> Path:
    root = tmp_path / "data"
    entries = [
        _entry(root, "elevation_10m_study", "elevation/elevation_10m_study.f32", "gale", b"\x01" * 400),
        _entry(root, "rover_path", "rover/MSL_traverse.json", "gale", b'{"type":"FeatureCollection"}'),
        _entry(root, "elevation_20m_study__jezero", "regions/jezero/elevation/elevation_20m_study.f32", "jezero",
               b"\x02" * 300, dataset="elevation_20m_study"),
        new_entry("ice_swim", "ice", "s", ["ground"], "ice", "derived", "pending", reason="r"),
    ]
    entries[-1]["region"] = "gale"
    Catalog(entries=entries, areas={"regions": {"gale": {}, "jezero": {}}}).save(root / "catalog.json")
    (root / "regions" / "jezero" / "catalog.json").write_text('{"datasets": []}\n')
    return root


def test_pack_writes_one_zip_per_region_and_a_manifest(tmp_path):
    root = _data_root(tmp_path)
    out = tmp_path / "dist"
    manifest = dr.pack(root, out, TAG, REPO)
    assert manifest["tag"] == TAG and manifest["repo"] == REPO
    assets = {a["region"]: a for a in manifest["assets"]}
    assert set(assets) == {"gale", "jezero"}
    gale = zipfile.ZipFile(out / assets["gale"]["name"])
    assert sorted(gale.namelist()) == ["DATA-NOTICE.md", "elevation/elevation_10m_study.f32", "rover/MSL_traverse.json"]
    jz = zipfile.ZipFile(out / assets["jezero"]["name"])
    assert sorted(jz.namelist()) == ["DATA-NOTICE.md", "regions/jezero/catalog.json",
                                     "regions/jezero/elevation/elevation_20m_study.f32"]
    for a in manifest["assets"]:
        body = (out / a["name"]).read_bytes()
        assert a["bytes"] == len(body) and a["sha256"] == hashlib.sha256(body).hexdigest()
    assert json.loads((root / "release.json").read_text()) == manifest
    again = dr.pack(root, tmp_path / "dist2", TAG, REPO)  # same inputs, same zips
    assert [a["sha256"] for a in again["assets"]] == [a["sha256"] for a in manifest["assets"]]


def test_pack_refuses_when_a_file_does_not_match_the_catalog(tmp_path):
    root = _data_root(tmp_path)
    (root / "rover" / "MSL_traverse.json").write_text("changed")
    with pytest.raises(dr.ReleaseError, match="rover/MSL_traverse.json"):
        dr.pack(root, tmp_path / "dist", TAG, REPO)


def _served(tmp_path, zips):
    """Routes for GitHub's release download: github.com redirects to the asset host."""
    routes = {}
    for name, body in zips.items():
        page = f"https://github.com/{REPO}/releases/download/{TAG}/{name}"
        cdn = f"https://release-assets.githubusercontent.com/github-production-release-asset/1/{name}?sig=x"
        routes[page] = FakeResponse(302, b"", {"Location": cdn})
        routes[cdn] = FakeResponse(200, body, {"Content-Type": "application/octet-stream",
                                               "Content-Length": str(len(body))})
    return routes


def _fresh_clone(tmp_path, root):
    """Only what git holds: catalog.json and release.json."""
    fresh = tmp_path / "clone" / "data"
    fresh.mkdir(parents=True)
    for name in ("catalog.json", "release.json"):
        (fresh / name).write_bytes((root / name).read_bytes())
    return fresh


def test_fetch_downloads_checks_and_unpacks(tmp_path):
    root = _data_root(tmp_path)
    manifest = dr.pack(root, tmp_path / "dist", TAG, REPO)
    zips = {a["name"]: (tmp_path / "dist" / a["name"]).read_bytes() for a in manifest["assets"]}
    fresh = _fresh_clone(tmp_path, root)
    session = FakeSession(_served(tmp_path, zips))
    report = dr.fetch(fresh, Fetcher(session=session, allowed_hosts=dr.RELEASE_HOSTS, sleep=lambda s: None),
                      log=lambda m: None)
    assert report["files_ok"] == 3 and report["problems"] == []
    assert (fresh / "regions" / "jezero" / "catalog.json").is_file()
    assert all(r.state == "ok" for r in Catalog.load(fresh / "catalog.json").check(fresh))
    only = _fresh_clone(tmp_path / "b", root)
    dr.fetch(only, Fetcher(session=FakeSession(_served(tmp_path, zips)), allowed_hosts=dr.RELEASE_HOSTS,
                           sleep=lambda s: None), regions={"jezero"}, log=lambda m: None)
    assert (only / "regions" / "jezero" / "elevation" / "elevation_20m_study.f32").is_file()
    assert not (only / "elevation").exists()


def test_fetch_rejects_a_zip_whose_checksum_differs(tmp_path):
    root = _data_root(tmp_path)
    manifest = dr.pack(root, tmp_path / "dist", TAG, REPO)
    zips = {a["name"]: (tmp_path / "dist" / a["name"]).read_bytes() for a in manifest["assets"]}
    name = next(a["name"] for a in manifest["assets"] if a["region"] == "gale")
    body = bytearray(zips[name])
    body[len(body) // 2] ^= 0xFF  # one changed byte
    zips[name] = bytes(body)
    fresh = _fresh_clone(tmp_path, root)
    with pytest.raises(dr.ReleaseError, match="SHA-256"):
        dr.fetch(fresh, Fetcher(session=FakeSession(_served(tmp_path, zips)), allowed_hosts=dr.RELEASE_HOSTS,
                                sleep=lambda s: None), regions={"gale"}, log=lambda m: None)
    assert not (fresh / "elevation").exists() and not list(fresh.rglob("*.part"))


def test_fetch_only_unpacks_files_the_catalog_lists(tmp_path):
    root = _data_root(tmp_path)
    manifest = dr.pack(root, tmp_path / "dist", TAG, REPO)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../outside.txt", "x")
        z.writestr("/abs.txt", "x")
        z.writestr("elevation/elevation_10m_study.f32", b"\x01" * 400)
        z.writestr("rover/MSL_traverse.json", b'{"type":"FeatureCollection"}')
        z.writestr("extra/not_listed.bin", "x")
    body = buf.getvalue()
    for a in manifest["assets"]:
        if a["region"] == "gale":
            a["sha256"], a["bytes"] = hashlib.sha256(body).hexdigest(), len(body)
            name = a["name"]
    (root / "release.json").write_text(json.dumps(manifest))
    fresh = _fresh_clone(tmp_path, root)
    report = dr.fetch(fresh, Fetcher(session=FakeSession(_served(tmp_path, {name: body})),
                                     allowed_hosts=dr.RELEASE_HOSTS, sleep=lambda s: None),
                      regions={"gale"}, log=lambda m: None)
    assert not (tmp_path / "clone" / "outside.txt").exists() and not (fresh / "extra").exists()
    assert sorted(report["skipped"]) == ["../outside.txt", "/abs.txt", "extra/not_listed.bin"]
    assert report["files_ok"] == 2


def test_fetch_refuses_other_hosts(tmp_path):
    root = _data_root(tmp_path)
    manifest = dr.pack(root, tmp_path / "dist", TAG, REPO)
    name = manifest["assets"][0]["name"]
    page = f"https://github.com/{REPO}/releases/download/{TAG}/{name}"
    session = FakeSession({page: FakeResponse(302, b"", {"Location": "https://evil.example.com/x.zip"})})
    fresh = _fresh_clone(tmp_path, root)
    with pytest.raises(Exception, match="allowlist"):
        dr.fetch(fresh, Fetcher(session=session, allowed_hosts=dr.RELEASE_HOSTS, sleep=lambda s: None),
                 log=lambda m: None)


class UploadSession:
    def __init__(self):
        self.calls = []

    def post(self, url, headers=None, data=None, json=None, timeout=None):
        body = data.read() if hasattr(data, "read") else data
        self.calls.append({"url": url, "headers": dict(headers or {}), "json": json, "bytes": len(body or b"")})
        if url.endswith("/releases"):
            return FakeResponse(201, b'{"id": 42, "html_url": "https://github.com/x/releases/tag/data-test"}',
                                {"Content-Type": "application/json"})
        return FakeResponse(201, b'{"state": "uploaded"}', {"Content-Type": "application/json"})


def test_publish_creates_the_release_and_uploads_each_zip(tmp_path):
    root = _data_root(tmp_path)
    dist = tmp_path / "dist"
    manifest = dr.pack(root, dist, TAG, REPO)
    session = UploadSession()
    logs = []
    url = dr.publish(manifest, dist, token="secret-token", session=session, log=logs.append)
    assert url.endswith("/tag/data-test")
    create = session.calls[0]
    assert create["url"] == f"https://api.github.com/repos/{REPO}/releases"
    assert create["json"]["tag_name"] == TAG and create["headers"]["Authorization"] == "Bearer secret-token"
    uploads = session.calls[1:]
    assert [u["url"] for u in uploads] == [f"https://uploads.github.com/repos/{REPO}/releases/42/assets?name={a['name']}"
                                          for a in manifest["assets"]]
    assert [u["bytes"] for u in uploads] == [a["bytes"] for a in manifest["assets"]]
    assert not any("secret-token" in m for m in logs)


def test_publish_checks_the_zips_match_the_manifest(tmp_path):
    root = _data_root(tmp_path)
    dist = tmp_path / "dist"
    manifest = dr.pack(root, dist, TAG, REPO)
    (dist / manifest["assets"][0]["name"]).write_bytes(b"other")
    with pytest.raises(dr.ReleaseError, match="does not match"):
        dr.publish(manifest, dist, token="t", session=UploadSession(), log=lambda m: None)


def test_cli_data_commands(tmp_path, monkeypatch, capsys):
    from martian_map import cli

    root = _data_root(tmp_path)
    dist = tmp_path / "dist"
    assert cli.main(["data", "pack", "--tag", TAG, "--data-root", str(root), "--out", str(dist)]) == 0
    assert (root / "release.json").is_file()
    monkeypatch.delenv("GITHUB_PERSONAL_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert cli.main(["data", "publish", "--data-root", str(root), "--dist", str(dist)]) == 2
    assert "GITHUB_PERSONAL_ACCESS_TOKEN" in capsys.readouterr().err
    seen = {}
    monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "tok")
    monkeypatch.setattr(dr, "publish", lambda manifest, d, token, log: seen.update(token=token) or "https://x/tag")
    assert cli.main(["data", "publish", "--data-root", str(root), "--dist", str(dist)]) == 0
    assert seen["token"] == "tok" and "tok" not in capsys.readouterr().out
    monkeypatch.setattr(dr, "fetch", lambda root_, fetcher, regions, log: seen.update(regions=regions, hosts=fetcher._allowed)
                        or {"files_ok": 3, "problems": [], "skipped": []})
    assert cli.main(["data", "fetch", "--data-root", str(root), "--region", "jezero"]) == 0
    assert seen["regions"] == {"jezero"} and seen["hosts"] == dr.RELEASE_HOSTS
