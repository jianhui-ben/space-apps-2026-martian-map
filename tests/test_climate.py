import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.http import Fetcher
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import climate

FIXTURES = Path(__file__).parent / "fixtures"
SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"


def test_parse_2d_table():
    blocks = climate.parse_mcd_text((FIXTURES / "mcd_gale_climatology_2d.txt").read_text())
    assert [b["name"] for b in blocks][:3] == ["Surface temperature (K)", "Temperature (K)", "Surface pressure (Pa)"]
    b = blocks[0]
    assert b["ls"][:3] == [0.0, 15.0, 30.0] and b["ls"][-1] == 360.0
    assert b["local_time_h"] == [float(h) for h in range(25)]
    assert len(b["values"]) == 25 and len(b["values"][0]) == 25
    assert 150 < min(min(r) for r in b["values"]) < max(max(r) for r in b["values"]) < 320
    assert b["latitude"] == pytest.approx(-4.59) and b["longitude"] == pytest.approx(137.44)


def test_parse_1d_single_season():
    blocks = climate.parse_mcd_text((FIXTURES / "mcd_gale_storm_ls270.txt").read_text())
    b = blocks[0]
    assert b["ls"] == [270.0] and b["local_time_h"][0] == 0.0 and len(b["values"]) == 1 and len(b["values"][0]) == 25
    assert "dust storm" in b["scenario"]


def test_txt_link_and_stale_test_file_rejected():
    html = (FIXTURES / "mcd_cgi_response.html").read_text()
    assert re.fullmatch(r"https://www-mars\.lmd\.jussieu\.fr/mcd_python/txt/[0-9a-f]+\.txt", climate.txt_url(html))
    with pytest.raises(ValueError, match="no data link"):
        climate.txt_url("<html>dates must be within the dust storm season</html>")
    stale = (FIXTURES / "mcd_gale_climatology_2d.txt").read_text().replace("-4.59N", "0.00N").replace("137.44E", "0.00E")
    with pytest.raises(ValueError, match="not the requested point"):
        climate.check_point(climate.parse_mcd_text(stale), -4.59, 137.44)


def _fake_text(q):
    """MCD-style text for the requested variables, with values that identify scenario and variable."""
    names = {"tsurf": "Surface temperature (K)", "t": "Temperature (K)", "ps": "Surface pressure (Pa)",
             "dod": "Monthly mean dust column visible optical depth above surface",
             "fluxsurf_dn_sw": "Incident solar flux on horizontal surface (W/m2)",
             "tauref": "Daily mean dust column visible optical depth above surface"}
    out = []
    lts = [float(h) for h in range(25)]
    for k in ("var1", "var2", "var3", "var4"):
        v = q.get(k)
        if not v:
            continue
        base = 200.0 + int(q["dust"]) + list(names).index(v)
        head = [f"### MCD_v6.2 with test scenario {q['dust']}."]
        if q["ls"] == "all":
            head += [f"### Latitude {q['latitude']}N. Longitude {q['longitude']}E. Altitude 2.0 m ALS.",
                     "### Column 1 is Areocentric longitude (degrees)", f"### Columns 2+ are {names[v]}"]
            rows = ["---- || " + " ".join(f"{h:14.5e}" for h in lts), "-" * 35]
            rows += [f"+{ls:03d} || " + " ".join(f"{base + ls / 1000:14.5e}" for _ in lts) for ls in range(0, 361, 15)]
        else:
            head += [f"### Ls {float(q['ls']):.1f}deg. Latitude {q['latitude']}N. Longitude {q['longitude']}E. Altitude 2.0 m ALS.",
                     "### Column 1 is Local time (Martian hour)", f"### Column 2 is {names[v]}"]
            rows = [f"{h:14.5e} {base + float(q['ls']) / 1000:14.5e}" for h in lts]
        out += ["#" * 20] + head + ["#" * 20] + rows
    return "\n".join(out) + "\n"


class McdSession:
    def __init__(self):
        self.calls = []
        self.texts = {}

    def get(self, url, **kw):
        self.calls.append({"url": url, **kw})
        parts = urlsplit(url)
        if parts.path.endswith("mcdcgi.py"):
            q = {k: v[0] for k, v in parse_qs(parts.query).items()}
            key = f"{len(self.texts):032x}"
            self.texts[key] = _fake_text(q)
            body = f"<html><a href='../txt/{key}.txt'>data</a></html>".encode()
            return FakeResponse(200, body, {"Content-Type": "text/html"})
        key = parts.path.rsplit("/", 1)[-1][:-4]
        return FakeResponse(200, self.texts[key].encode(), {"Content-Type": "text/plain"})


def test_climate_step_writes_both_tables(tmp_path):
    sc = load_scenario(SCENARIO)
    session = McdSession()
    report = run_snapshot(sc, tmp_path, Fetcher(session=session, sleep=lambda s: None), steps=[climate.climate_step],
                          log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(tmp_path / "catalog.json")
    t = cat.get("temperature_climate_mcd")
    d = cat.get("dust_climate_mcd")
    assert t["access"] == d["access"] == "local" and t["evidence_type"] == "model"
    import json
    tt = json.loads((tmp_path / t["files"][0]["path"]).read_text())
    assert set(tt["scenarios"]) == {"climatology", "cold", "warm", "dust_storm"}
    clim = tt["scenarios"]["climatology"]
    assert len(clim["ls"]) == 24 and clim["ls"][-1] == 345.0  # Ls 360 duplicate dropped
    assert clim["surface_temperature_k"][1][0] == pytest.approx(201.015)  # dust code 1, var index 0, Ls 15
    storm = tt["scenarios"]["dust_storm"]
    assert storm["ls"] == [180.0, 225.0, 270.0, 315.0]
    dd = json.loads((tmp_path / d["files"][0]["path"]).read_text())
    assert "surface_solar_flux_down_w_m2" in dd["scenarios"]["climatology"]
    cgi = [c for c in session.calls if "mcdcgi.py" in c["url"]]
    assert len(cgi) == 3 * 2 + 4 * 2
    assert all(c["timeout"] >= 60 for c in cgi)
    q = parse_qs(urlsplit(cgi[0]["url"]).query)
    for k in ("dpi", "islog", "colorm", "proj", "iswind"):
        assert k in q  # leaving any out returns a stale test file
    assert any("no below-ground" in lim.lower() for lim in t["limitations"])
    assert "warmer nights" not in tt["scenarios"]["cold"]["note"]
