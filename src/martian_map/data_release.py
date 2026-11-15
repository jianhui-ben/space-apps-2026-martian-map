"""Share the downloaded data as GitHub Release assets, so teammates don't have to re-run the snapshot.

Only the index (``data/catalog.json``) is in git; the files it lists are about 1 GB. ``pack`` zips them
per region (Gale, Jezero, Arcadia), checking every file against the index first, and writes
``data/release.json`` (committed): the release tag and each zip's size and SHA-256. ``publish`` creates
the release and uploads the zips (run it in your own terminal, with your GitHub token). ``fetch``
downloads the zips named in ``release.json``, checks their SHA-256, and unpacks only the files the index
lists, so a fresh clone gets exactly the data the index describes.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from .catalog import Catalog, file_state
from .http import USER_AGENT, Fetcher, atomic_write

RELEASE_FILE = "release.json"
NOTICE = "DATA-NOTICE.md"
# github.com answers a release download with a redirect to its asset host.
RELEASE_HOSTS = frozenset({"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"})
MAX_ASSET_BYTES = 2 << 30  # GitHub's limit per release file
ZIP_TIME = (1980, 1, 1, 0, 0, 0)  # fixed, so the same data gives the same zip
API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"


class ReleaseError(RuntimeError):
    """The data release can't be packed, published or fetched as asked."""


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _region_files(catalog: Catalog) -> Dict[str, List[str]]:
    """Region id -> the file paths its entries list (relative to the data folder), sorted."""
    out: Dict[str, Set[str]] = {}
    for e in catalog.entries:
        for rec in e.get("files") or []:
            out.setdefault(e.get("region", "gale"), set()).add(rec["path"])
    return {r: sorted(p) for r, p in out.items()}


def _state_catalog(region: str) -> Optional[str]:
    """Each region other than Gale keeps its own index, so its re-runs can skip what is already there."""
    return None if region == "gale" else f"regions/{region}/catalog.json"


def _notice(catalog: Catalog, region: str, tag: str, repo: str) -> str:
    refs = sorted({r for e in catalog.entries if e.get("region", "gale") == region
                   for r in e.get("references") or []})
    lines = [f"# Martian Map data, {region} ({tag})", "",
             f"Files described by data/catalog.json in https://github.com/{repo}. Check them with",
             "`python -m martian_map catalog check --strict`. Full credits, licences and citations:",
             f"https://github.com/{repo}/blob/main/docs/data-references.md", "", "## Sources", ""]
    for rid in refs:
        r = catalog.references.get(rid) or {}
        if r:
            lines.append(f"- {r.get('title', rid)}. Credit: {r.get('credit', '')}. Licence: {r.get('license', '')}")
    return "\n".join(lines) + "\n"


def asset_name(region: str, tag: str) -> str:
    return f"martian-map-{region}-{tag}.zip"


def pack(data_root: Path, out_dir: Path, tag: str, repo: str, log: Callable[[str], None] = print) -> Dict[str, Any]:
    """Zip each region's files into ``out_dir`` and write ``data/release.json``; returns the manifest."""
    data_root, out_dir = Path(data_root), Path(out_dir)
    catalog = Catalog.load(data_root / "catalog.json")
    bad = [f"{r.path} ({r.state})" for r in catalog.check(data_root) if r.state != "ok"]
    if bad:
        raise ReleaseError("files differ from the index (re-run the snapshot first): " + ", ".join(bad[:10]))
    out_dir.mkdir(parents=True, exist_ok=True)
    assets = []
    regions = _region_files(catalog)
    order = ["gale"] + sorted(r for r in regions if r != "gale")
    for region in (r for r in order if r in regions):
        names = list(regions[region])
        extra = _state_catalog(region)
        if extra and (data_root / extra).is_file():
            names.append(extra)
        target = out_dir / asset_name(region, tag)
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for name in [NOTICE] + sorted(names):
                info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                if name == NOTICE:
                    z.writestr(info, _notice(catalog, region, tag, repo))
                    continue
                with open(data_root / name, "rb") as src, z.open(info, "w") as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
        raw = sum((data_root / n).stat().st_size for n in names)
        assets.append({"region": region, "name": target.name, "files": len(names), "bytes": target.stat().st_size,
                       "unpacked_bytes": raw, "sha256": _sha256(target)})
        log(f"{target.name}: {len(names)} files, {raw / 2**20:.0f} MB -> {target.stat().st_size / 2**20:.0f} MB")
    manifest = {"repo": repo, "tag": tag, "catalog_generated_at": catalog.generated_at, "assets": assets,
                "note": "Zips of the files data/catalog.json lists, per region; fetch them with "
                        "python -m martian_map data fetch"}
    atomic_write(data_root / RELEASE_FILE, (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    return manifest


def load_manifest(data_root: Path) -> Dict[str, Any]:
    path = Path(data_root) / RELEASE_FILE
    if not path.is_file():
        raise ReleaseError(f"no {path}: no data release is recorded; run the snapshot instead")
    return json.loads(path.read_text(encoding="utf-8"))


def _download(fetcher: Fetcher, url: str, path: Path, log: Callable[[str], None]) -> None:
    for _ in range(5):  # github.com -> asset host
        res = fetcher.download(url, path, MAX_ASSET_BYTES, timeout_s=60, deadline_s=3600,
                               ok_status=(200, 301, 302, 303, 307, 308))
        if res.status == 200:
            return
        if not res.location:
            raise ReleaseError(f"{url}: redirect without a Location")
        url = res.location
    raise ReleaseError(f"{url}: too many redirects")


def _safe_target(data_root: Path, name: str) -> Path:
    target = (data_root / name).resolve()
    if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or \
            not str(target).startswith(str(data_root.resolve()) + os.sep):
        raise ReleaseError(f"refusing to write {name!r} outside the data folder")
    return target


def fetch(data_root: Path, fetcher: Fetcher, regions: Optional[Iterable[str]] = None,
          log: Callable[[str], None] = print) -> Dict[str, Any]:
    """Download, check and unpack the release's zips (all regions, or ``regions``) into ``data_root``."""
    data_root = Path(data_root)
    manifest = load_manifest(data_root)
    catalog = Catalog.load(data_root / "catalog.json")
    listed = _region_files(catalog)
    wanted = set(regions) if regions else {a["region"] for a in manifest["assets"]}
    unknown = wanted - {a["region"] for a in manifest["assets"]}
    if unknown:
        raise ReleaseError(f"no zip for region(s) {', '.join(sorted(unknown))} in {RELEASE_FILE}")
    skipped: List[str] = []
    staging = data_root / ".download"
    try:
        for asset in (a for a in manifest["assets"] if a["region"] in wanted):
            region = asset["region"]
            allowed = set(listed.get(region, []))
            if _state_catalog(region):
                allowed.add(_state_catalog(region))
            url = f"https://github.com/{manifest['repo']}/releases/download/{manifest['tag']}/{asset['name']}"
            zpath = staging / asset["name"]
            log(f"{asset['name']}: downloading {asset['bytes'] / 2**20:.0f} MB")
            _download(fetcher, url, zpath, log)
            if zpath.stat().st_size != asset["bytes"] or _sha256(zpath) != asset["sha256"]:
                raise ReleaseError(f"{asset['name']}: size or SHA-256 does not match {RELEASE_FILE}; not unpacked")
            with zipfile.ZipFile(zpath) as z:
                for info in z.infolist():
                    name = info.filename
                    if name == NOTICE:
                        continue
                    if info.is_dir() or name not in allowed:
                        skipped.append(name)
                        continue
                    target = _safe_target(data_root, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    part = target.with_suffix(target.suffix + ".part")
                    with z.open(info) as src, open(part, "wb") as dst:
                        shutil.copyfileobj(src, dst, 1 << 20)
                    os.replace(part, target)
            zpath.unlink()
            log(f"{asset['name']}: unpacked")
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    recs = [rec for e in catalog.entries if e.get("region", "gale") in wanted for rec in e.get("files") or []]
    states = {rec["path"]: file_state(data_root, rec) for rec in recs}
    problems = sorted(f"{p} ({s})" for p, s in states.items() if s != "ok")
    if skipped:
        log(f"skipped {len(skipped)} zip entries the index does not list: {', '.join(sorted(skipped)[:5])}")
    return {"files_ok": sum(s == "ok" for s in states.values()), "problems": problems, "skipped": skipped}


def _default_upload_session():
    import requests

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


def _json(resp) -> Dict[str, Any]:
    body = getattr(resp, "_body", None)
    if body is None:
        body = resp.content
    try:
        return json.loads(body.decode("utf-8") if isinstance(body, bytes) else body)
    except ValueError:
        return {}


def publish(manifest: Dict[str, Any], dist: Path, token: str, session=None,
            log: Callable[[str], None] = print) -> str:
    """Create the GitHub release named in ``manifest`` and upload its zips; returns the release page URL."""
    dist = Path(dist)
    for a in manifest["assets"]:
        path = dist / a["name"]
        if not path.is_file() or path.stat().st_size != a["bytes"] or _sha256(path) != a["sha256"]:
            raise ReleaseError(f"{path} does not match {RELEASE_FILE}; run `data pack` again")
    session = session or _default_upload_session()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    repo, tag = manifest["repo"], manifest["tag"]
    sizes = ", ".join(f"{a['region']} {a['unpacked_bytes'] / 2**20:.0f} MB" for a in manifest["assets"])
    body = (f"Data files for the Martian Map snapshot ({sizes} unpacked). They are the files data/catalog.json "
            f"lists, checked against it. Get them with `python -m martian_map data fetch`. Credits and licences: "
            f"docs/data-references.md and the DATA-NOTICE.md in each zip.")
    resp = session.post(f"{API}/repos/{repo}/releases", headers=headers, timeout=60,
                        json={"tag_name": tag, "target_commitish": "main", "name": f"Data snapshot {tag}",
                              "body": body, "draft": False, "prerelease": False})
    if resp.status_code != 201:
        raise ReleaseError(f"creating release {tag} returned HTTP {resp.status_code}: "
                           f"{_json(resp).get('message', '')} (a release with this tag may already exist)")
    release = _json(resp)
    for a in manifest["assets"]:
        log(f"uploading {a['name']} ({a['bytes'] / 2**20:.0f} MB)")
        with open(dist / a["name"], "rb") as f:
            up = session.post(f"{UPLOADS}/repos/{repo}/releases/{release['id']}/assets?name={a['name']}",
                              headers={**headers, "Content-Type": "application/zip",
                                       "Content-Length": str(a["bytes"])}, data=f, timeout=3600)
        if up.status_code != 201:
            raise ReleaseError(f"uploading {a['name']} returned HTTP {up.status_code}: {_json(up).get('message', '')}")
    return release.get("html_url", f"https://github.com/{repo}/releases/tag/{tag}")


__all__ = ["NOTICE", "RELEASE_FILE", "RELEASE_HOSTS", "ReleaseError", "asset_name", "fetch", "load_manifest", "pack",
           "publish"]
