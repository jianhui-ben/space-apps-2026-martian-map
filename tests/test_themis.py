import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from conftest import FakeResponse
from martian_map.http import Fetcher
from martian_map.scenario import Bounds
from martian_map.sources.themis import list_products, parse_ode_products, select_samples

FIXTURES = Path(__file__).parent / "fixtures"
STUDY = Bounds(137.122, -4.925, 137.730, -4.249)


def _p(name, solar_time, ls, bounds=(136.0, -6.0, 138.5, 6.0)):
    return {"pdsid": name, "utc_start": "2014-01-01T00:00:00", "ls": ls, "solar_time_h": solar_time,
            "map_resolution_m": 100.0, "bounds": list(bounds), "file_url": f"https://static.mars.asu.edu/{name}.IMG",
            "kbytes": 1000}


def test_parse_ode_fixture():
    page = json.loads((FIXTURES / "ode_pbt_page.json").read_text())
    prods = parse_ode_products(page)
    assert len(prods) == 3
    p = prods[0]
    assert p["pdsid"] == "I55967002PBT"
    assert p["ls"] == 168.049 and p["solar_time_h"] == 6.137
    assert abs(p["map_resolution_m"] - 100.0) < 0.1
    assert p["file_url"].startswith("https://static.mars.asu.edu/") and p["file_url"].endswith(".IMG")
    assert p["bounds"] == [135.967, -5.719, 138.152, 6.393]


def test_select_samples():
    prods = [
        _p("day_a_far", 15.0, 120.0),
        _p("day_a_close", 15.0, 75.0),
        _p("day_a_partial", 15.0, 71.0, bounds=(137.6, -6.0, 138.5, 6.0)),  # covers only ~20% of the study area
        _p("night_a", 4.0, 60.0),
        _p("day_p", 14.0, 250.0),
        _p("noon_ignored", 10.0, 251.0),
    ]
    picks, notes = select_samples(prods, STUDY)
    assert picks["day_aphelion"]["pdsid"] == "day_a_close"
    assert picks["night_aphelion"]["pdsid"] == "night_a"
    assert picks["day_perihelion"]["pdsid"] == "day_p"
    assert "night_perihelion" not in picks
    assert "night_perihelion" in notes


def test_select_samples_season_window():
    # only images within 45 degrees of Ls of the target season count
    picks, notes = select_samples([_p("just_in", 15.0, 116.0), _p("too_far", 15.0, 117.0, bounds=(136.0, -6.0, 138.5, 6.0))], STUDY)
    assert picks["day_aphelion"]["pdsid"] == "just_in"
    picks2, notes2 = select_samples([_p("too_far", 15.0, 117.0)], STUDY)
    assert "day_aphelion" not in picks2 and "45 degrees" in notes2["day_aphelion"]


class OdeSession:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        body = self.pages.get(int(q.get("offset", 0)), {"ODEResults": {"Status": "Success", "Products": "No Products Found"}})
        return FakeResponse(200, json.dumps(body).encode(), {"Content-Type": "application/json"})


def test_themis_list_paging():
    page = json.loads((FIXTURES / "ode_pbt_page.json").read_text())
    one = page["ODEResults"]["Products"]["Product"][0]
    two = page["ODEResults"]["Products"]["Product"][1]
    pages = {0: {"ODEResults": {"Products": {"Product": [one, two]}}}, 2: {"ODEResults": {"Products": {"Product": one}}}}
    s = OdeSession(pages)
    prods = list_products(Fetcher(session=s, sleep=lambda x: None), STUDY, limit=2)
    assert len(s.calls) == 2
    assert [p["pdsid"] for p in prods] == ["I55967002PBT", "I56136001PBT", "I55967002PBT"]


def test_select_samples_skips_oversized():
    big = dict(_p("big", 15.0, 71.0), kbytes=70000)
    small = dict(_p("small", 15.0, 80.0), kbytes=30000)
    picks, _ = select_samples([big, small], STUDY, max_bytes=64 * 2**20)
    assert picks["day_aphelion"]["pdsid"] == "small"


def _tiny_pbt_img(value=250.0):
    """A small sinusoidal THEMIS-like PDS3 image (1 km pixels) covering the study area."""
    import hashlib

    import numpy as np

    lines, samples, rec = 100, 60, 240
    data = np.full((lines, samples), value, dtype="<f4").tobytes()
    md5 = hashlib.md5(data).hexdigest()
    label = (
        "PDS_VERSION_ID = PDS3\r\nRECORD_TYPE = FIXED_LENGTH\r\nRECORD_BYTES = 240\r\nLABEL_RECORDS = 6\r\n"
        "^IMAGE = 7\r\nSTART_TIME = 2014-01-01T00:00:00\r\nLOCAL_TIME = 4.000\r\nSOLAR_LONGITUDE = 71.000\r\n"
        "OBJECT = IMAGE_MAP_PROJECTION\r\n MAP_PROJECTION_TYPE = \"SINUSOIDAL\"\r\n A_AXIS_RADIUS = 3396.190\r\n"
        " POSITIVE_LONGITUDE_DIRECTION = \"EAST\"\r\n CENTER_LATITUDE = 0.000\r\n CENTER_LONGITUDE = 137.400\r\n"
        " MAP_SCALE = 1.000\r\n MAP_RESOLUTION = 59.275\r\n SAMPLE_PROJECTION_OFFSET = 30.0\r\n"
        " LINE_PROJECTION_OFFSET = -240.0\r\nEND_OBJECT = IMAGE_MAP_PROJECTION\r\n"
        f"OBJECT = IMAGE\r\n LINES = {lines}\r\n LINE_SAMPLES = {samples}\r\n SAMPLE_TYPE = PC_REAL\r\n"
        f" SAMPLE_BITS = 32\r\n NULL_CONSTANT = 0\r\n MD5_CHECKSUM = \"{md5}\"\r\nEND_OBJECT = IMAGE\r\nEND\r\n"
    ).encode()
    assert len(label) <= 6 * rec
    return label.ljust(6 * rec, b" ") + data


def test_samples_step_records_each_failure(tmp_path, monkeypatch):
    from conftest import FakeSession
    from martian_map.catalog import Catalog
    from martian_map.scenario import load_scenario
    from martian_map.snapshot import run_snapshot
    from martian_map.sources import themis

    repo = Path(__file__).resolve().parents[1]
    sc = load_scenario(repo / "scenario" / "gale.json")
    prods = [_p("day_a", 15.0, 71.0), _p("night_a", 4.0, 71.0)]
    monkeypatch.setattr(themis, "_products_for", lambda ctx: prods)
    session = FakeSession({prods[1]["file_url"]: FakeResponse(200, _tiny_pbt_img(), {"Content-Type": "application/octet-stream"})})
    report = run_snapshot(sc, tmp_path, Fetcher(session=session, sleep=lambda s: None),
                          steps=[themis.themis_samples_step], log=lambda m: None)
    cat = Catalog.load(tmp_path / "catalog.json")
    day = cat.get("themis_temp_day_aphelion")
    assert day["status"] == "failed" and "404" in day["error"]
    night = cat.get("themis_temp_night_aphelion")
    assert night["status"] == "ok" and night["access"] == "local"
    assert night["coverage"]["covered_fraction"] > 0.9
    assert night["stats_k"]["median"] == 250.0
    assert night["observation_time"]["ls"] == 71.0
    assert cat.get("themis_temp_night_perihelion")["access"] == "pending"
    assert [f for f in report.failed if "themis_temp_day_aphelion" in f[1]]
