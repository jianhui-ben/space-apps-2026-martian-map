import hashlib
import json
from pathlib import Path

import pytest

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.http import Fetcher
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import optical_depth as od

FIXTURES = Path(__file__).parent / "fixtures"
SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"
TAU880 = (FIXTURES / "msl_tau_880_excerpt.txt").read_bytes()
TAU440 = (FIXTURES / "msl_tau_440_excerpt.txt").read_bytes()
LOS_CSV = (FIXTURES / "navcam_line_of_sight_excerpt.csv").read_bytes()
LOS_XML = (FIXTURES / "navcam_line_of_sight.xml").read_text().replace("<records>592</records>", "<records>8</records>")


def test_parse_mastcam_tau_880():
    t = od.parse_mastcam_tau(TAU880.decode(), 880)
    r = t["rows"][0]
    assert (r["sol"], r["ls"], r["tau"], r["sigma"]) == (33.5036, 168.5, 0.716, 0.035)
    assert r["ltst_h"] == pytest.approx(0.5036 * 24, abs=1e-3)
    assert r["my"] == 31 and r["product_id"].startswith("0033ML")
    assert len(t["rows"]) == 6


def test_parse_mastcam_tau_440_overflow_sigma_and_camera_check():
    t = od.parse_mastcam_tau(TAU440.decode(), 440)
    assert t["rows"][-1]["sigma"] is None and t["rows"][-1]["tau"] == 1.214
    assert t["rows"][-1]["my"] == 36  # sol 3616 is in Mars year 36
    with pytest.raises(ValueError, match="camera"):
        od.parse_mastcam_tau(TAU880.decode(), 440)


def test_mars_year_rolls_over_when_ls_wraps():
    rows = [{"sol": s, "ls": ls} for s, ls in ((100, 200.0), (400, 355.0), (420, 5.0), (1100, 10.0))]
    assert od.mars_years(rows) == [31, 31, 32, 33]


def test_seasonal_summary_bins():
    rows = [{"ls": ls, "tau": tau} for ls, tau in ((10, 0.4), (20, 0.6), (185, 1.0), (195, 3.0), (205, 2.0))]
    bins = {b["ls_from"]: b for b in od.seasonal_summary(rows, 30)}
    assert bins[0]["n"] == 2 and bins[0]["median"] == pytest.approx(0.5)
    assert bins[180]["max"] == 3.0 and bins[180]["n"] == 3
    assert bins[90]["n"] == 0 and bins[90]["median"] is None


def test_parse_navcam_line_of_sight():
    rows = od.parse_navcam_los(LOS_XML, LOS_CSV.decode())
    assert rows[0] == {"sol": 117, "ls": 218.94, "my": 31, "ltst_h": 13.99, "extinction_per_km": 0.0825,
                       "error_per_km": 0.0029, "flag": None}
    assert rows[-2]["flag"] == "saturated" and rows[-2]["extinction_per_km"] is None
    assert rows[-1]["flag"] == "invalid"
    with pytest.raises(ValueError, match="records"):
        od.parse_navcam_los(LOS_XML.replace("<records>8</records>", "<records>9</records>"), LOS_CSV.decode())


def _meta(files):
    return {"doi": {"id": "10.17632/tbh3pg39xc.3"}, "version": 3, "name": "Mars Science Laboratory aerosol optical depths",
            "data_licence": {"short_name": "CC BY 4.0"},
            "files": [{"filename": name, "content_details": {
                "download_url": f"https://data.mendeley.com/public-files/datasets/tbh3pg39xc/files/{i}/file_downloaded",
                "sha256_hash": hashlib.sha256(body).hexdigest(), "size": len(body)}}
                for i, (name, body) in enumerate(files)]}


class OdSession:
    def __init__(self, files, tamper=False):
        self.files = files
        self.tamper = tamper
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        if url == od.MENDELEY_API:
            return FakeResponse(200, json.dumps(_meta(self.files)).encode(), {"Content-Type": "application/json"})
        if url.startswith("https://data.mendeley.com/public-files/"):
            i = url.split("/files/")[1].split("/")[0]
            return FakeResponse(302, b"", {"Location": f"https://{od.MENDELEY_S3_HOST}/obj-{i}"})
        if url.startswith(f"https://{od.MENDELEY_S3_HOST}/obj-"):
            body = self.files[int(url.rsplit("-", 1)[1])][1]
            return FakeResponse(200, body + (b"x" if self.tamper else b""), {"Content-Type": "binary/octet-stream"})
        if url == od.NAVCAM_LABEL_URL:
            return FakeResponse(200, LOS_XML.encode(), {"Content-Type": "application/xml"})
        if url == od.NAVCAM_CSV_URL:
            return FakeResponse(200, LOS_CSV, {"Content-Type": "text/csv"})
        return FakeResponse(404, b"", {})


FILES = [("msl-tau-880-arch-3778.txt", b"old"), ("msl-tau-440-arch-3953.txt", TAU440),
         ("msl-tau-880-arch-3953.txt", TAU880)]


def test_step_writes_history_and_extinction(tmp_path):
    session = OdSession(FILES)
    report = run_snapshot(load_scenario(SCENARIO), tmp_path, Fetcher(session=session, sleep=lambda s: None),
                          steps=[od.optical_depth_step, od.navcam_dust_step], log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(tmp_path / "catalog.json")
    h = cat.get("optical_depth_history")
    assert h["access"] == "local" and h["evidence_type"] == "observation"
    data = json.loads((tmp_path / h["files"][0]["path"]).read_text())
    assert set(data["series"]) == {"880", "440"} and len(data["series"]["880"]["rows"]) == 6
    assert data["source"]["doi"] == "10.17632/tbh3pg39xc.3"
    assert "obj-0" not in " ".join(session.calls)  # the newest archive file is chosen, not the old one
    n = cat.get("dust_extinction_navcam")
    assert n["access"] == "local" and "near the ground" in n["summary"]
    assert n["ranges"]["too_hazy_to_measure"] == 1 and n["ranges"]["invalid_rows"] == 1
    assert any("too hazy" in lim and "lower bound" in lim for lim in n["limitations"])


def test_step_rejects_checksum_mismatch(tmp_path):
    report = run_snapshot(load_scenario(SCENARIO), tmp_path,
                          Fetcher(session=OdSession(FILES, tamper=True), sleep=lambda s: None),
                          steps=[od.optical_depth_step], log=lambda m: None)
    assert report.failed and "sha256" in report.failed[0][1]
