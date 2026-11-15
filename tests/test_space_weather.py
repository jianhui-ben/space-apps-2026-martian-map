import json
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.http import Fetcher
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import space_weather as sw

SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"


def test_windows_cover_the_span_in_at_most_60_days():
    w = sw.windows(date(2012, 8, 6), date(2013, 1, 1))
    assert w[0][0] == date(2012, 8, 6) and w[-1][1] == date(2013, 1, 1)
    assert all((b - a).days <= 59 for a, b in w)
    assert all((w[i + 1][0] - w[i][1]).days == 1 for i in range(len(w) - 1))


class DonkiSession:
    def __init__(self):
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        if q["startDate"] == "2012-08-06":
            ev = [{"sepID": "2012-08-19T20:21:00-SEP-001", "eventTime": "2012-08-19T20:21Z",
                   "instruments": [{"displayName": "STEREO A: IMPACT 13-100 MeV"}],
                   "link": "https://ccmc.gsfc.nasa.gov/DONKI/view/SEP/966/-1", "linkedEvents": None}]
            return FakeResponse(200, json.dumps(ev).encode(), {"Content-Type": "application/json"})
        if q["startDate"] == "2012-10-05":
            ev = [{"sepID": "2012-11-01T00:00:00-SEP-001", "eventTime": "2012-11-01T00:00Z",
                   "instruments": [{"displayName": "GOES13: SEM/EPS >100 MeV"}], "link": "x", "linkedEvents": []}]
            return FakeResponse(200, json.dumps(ev).encode(), {"Content-Type": "application/json"})
        return FakeResponse(200, b"", {"Content-Type": "application/json"})  # DONKI returns an empty body for none


def test_step_lists_events_and_counts_by_year(tmp_path, monkeypatch):
    monkeypatch.setattr(sw, "_today", lambda: date(2013, 1, 1))
    session = DonkiSession()
    report = run_snapshot(load_scenario(SCENARIO), tmp_path, Fetcher(session=session, sleep=lambda s: None),
                          steps=[sw.space_weather_step], log=lambda m: None)
    assert report.failed == []
    e = Catalog.load(tmp_path / "catalog.json").get("space_weather_donki")
    assert e["access"] == "local"
    data = json.loads((tmp_path / e["files"][0]["path"]).read_text())
    assert [x["sepID"] for x in data["events"]] == ["2012-08-19T20:21:00-SEP-001", "2012-11-01T00:00:00-SEP-001"]
    assert data["by_year"] == {"2012": {"events": 2, "above_100_mev": 1}}
    assert len(session.calls) == len(sw.windows(sw.START, date(2013, 1, 1)))
    assert any("not at Mars" in lim for lim in e["limitations"])
