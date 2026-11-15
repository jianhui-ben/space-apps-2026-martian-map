import json
import re
from pathlib import Path

import pytest

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.http import Fetcher
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import radiation as rad

SCENARIO = Path(__file__).resolve().parents[1] / "scenario" / "gale.json"


def _sol_txt(sol, obs):
    """A RAD RDR text file with ``obs`` = [(qc, duration, dose_b, dose_e)], and the byte offsets a label points to."""
    parts = [f"[FILE]\r\nSTART_SOL={sol}\r\n\r\n"]
    ptrs = []
    for i, (qc, dur, b, e) in enumerate(obs):
        dline = "" if dur is None else f"OBS_DURATION={dur}\r\n"
        head = (f"[OBSERVATION: {i:02d}]\r\nSTART_OBS_UTC=\"2015-150 {i:02d}:31:08\"\r\n{dline}"
                f"QC=\"{qc}\"\r\n\r\n[COUNTERS: {i:02d}]\r\n\r\n[COUNTER_L1: {i:02d}]\r\n\r\n")
        parts.append(head)
        l1 = len("".join(parts)) + 1
        parts.append(" ch name\r\n" + "x" * 300 + "\r\n\r\n[DOSIMETRY_TOTAL_DOSE_B: %02d]\r\n\r\n" % i)
        ob = len("".join(parts)) + 1
        parts.append(f"{b:7.5f}\r\n\r\n[DOSIMETRY_TOTAL_DOSE_E: {i:02d}]\r\n\r\n")
        oe = len("".join(parts)) + 1
        parts.append(f"{e:7.5f}\r\n\r\n[PHA: {i:02d}]\r\n" + "y" * 200 + "\r\n")
        ptrs.append((l1, ob, oe))
    txt = "".join(parts).encode("latin-1")
    name = f"RAD_RDR_2015_150_01_31_{sol:04d}_V00.TXT"
    lbl = [f'PRODUCT_ID = "RAD_RDR_2015_150_01_31_{sol:04d}_V00"', 'START_TIME = 2015-150T01:31:08']
    for i, (l1, ob, oe) in enumerate(ptrs):
        lbl += [f'^OBS{i:03d}_L1_TABLE         = ("{name}",{l1} <BYTES>)',
                f'^OBS{i:03d}_TOT_DOSE_B_ELEMENT =\r\n              ("{name}",{ob} <BYTES>)',
                'OBJECT = X\r\n  UNIT = "microGray / Hour"\r\nEND_OBJECT = X',
                f'^OBS{i:03d}_TOT_DOSE_E_ELEMENT =\r\n              ("{name}",{oe} <BYTES>)',
                'OBJECT = Y\r\n  UNIT = "microGray / Hour"\r\nEND_OBJECT = Y']
    return txt, "\r\n".join(lbl).encode("latin-1")


OBS = [("00000000", 960, 8.0, 9.0), ("00000000", 960, 10.0, 11.0), ("00000100", 960, 99.0, 99.0)]


def test_parse_label_pointers():
    _, lbl = _sol_txt(1000, OBS)
    p = rad.parse_label(lbl.decode())
    assert len(p["observations"]) == 3 and p["txt_name"] == "RAD_RDR_2015_150_01_31_1000_V00.TXT"
    assert set(p["observations"][0]) == {"obs", "l1", "dose_b", "dose_e"}
    assert p["unit"] == "microGray / Hour"


def test_parse_observation_header_takes_the_last_block():
    text = '[OBSERVATION: 00]\r\nQC="00000000"\r\nOBS_DURATION=5\r\n...[OBSERVATION: 01]\r\nSTART_OBS_UTC="2015-150 02:00:00"' \
           '\r\nOBS_DURATION=961\r\nQC="00000001"\r\n\r\n[COUNTERS: 01]'
    h = rad.parse_obs_header(text)
    assert h == {"obs": 1, "start_utc": "2015-150 02:00:00", "duration_s": 961, "qc": "00000001"}


def test_multipart_split():
    body = (b"\r\n--b1\r\nContent-type: text/plain\r\nContent-range: bytes 10-12/99\r\n\r\nabc\r\n--b1\r\n"
            b"Content-type: text/plain\r\nContent-range: bytes 40-41/99\r\n\r\nxy\r\n--b1--\r\n")
    assert rad.split_multipart(body, "multipart/byteranges; boundary=b1") == {10: b"abc", 40: b"xy"}
    with pytest.raises(ValueError, match="multipart"):
        rad.split_multipart(b"abc", "text/plain")


def test_pick_sols_spaced_and_single_product():
    index = ['"MSL-M-RAD-3-RDR-V1.0","/DATA/S/RAD_RDR_2012_220_00_00_%04d_V00.LBL","RAD_RDR_2012_220_00_00_%04d_V00",'
             '"MSLRAD_1001",2014-01-01T00:00:00  ,"MARS       ",2012-220T00:00:00,UNK      ' % (s, s)
             for s in (1, 2, 100, 100, 101, 205, 300)]
    index.insert(0, '"MSL-M-RAD-3-RDR-V1.0","/DATA/C/RAD_RDR_2011_340_17_59_C010_V00.LBL","RAD_RDR_2011_340_17_59_C010_V00",'
                    '"MSLRAD_1001",2014-01-01T00:00:00  ,"MARS       ",2011-340T17:59:00,UNK      ')
    picked = rad.pick_sols("HEADER\n" + "\n".join(index), every=100)
    assert [p["sol"] for p in picked] == [1, 101, 205, 300]  # sol 100 has two products, so 101 is used
    assert picked[0]["path"] == "/DATA/S/RAD_RDR_2012_220_00_00_0001_V00.LBL"


def test_early_header_without_duration():
    h = rad.parse_obs_header('[OBSERVATION: 00]\r\nSTART_OBS_UTC="2013-058 02:42:33"\r\nQC=00000000\r\n')
    assert h == {"obs": 0, "start_utc": "2013-058 02:42:33", "duration_s": None, "qc": "00000000"}


EARLY = [("00000000", None, 8.0, 9.0), ("00000000", None, 12.0, 13.0)]


class RadSession:
    def __init__(self, sols, early=()):
        self.files = {}
        index = ["HEADER"]
        for sol in sols:
            txt, lbl = _sol_txt(sol, EARLY if sol in early else OBS)
            stem = f"/DATA/SOL_X/RAD_RDR_2015_150_01_31_{sol:04d}_V00"
            self.files[rad.BASE + stem + ".LBL"] = lbl
            self.files[rad.BASE + stem + ".TXT"] = txt
            index.append(f'"MSL-M-RAD-3-RDR-V1.0","{stem}.LBL","RAD_RDR_2015_150_01_31_{sol:04d}_V00","MSLRAD_1002",'
                         f'2014-06-27T19:29:44  ,"MARS       ",2015-150T01:31:08,UNK      ')
        self.files[rad.INDEX_URL] = "\n".join(index).encode()
        self.calls = []

    def get(self, url, headers=None, **kw):
        self.calls.append((url, headers))
        body = self.files[url]
        rng = (headers or {}).get("Range")
        if not rng:
            return FakeResponse(200, body, {"Content-Type": "text/plain"})
        out = b""
        for a, b in re.findall(r"(\d+)-(\d+)", rng):
            a, b = int(a), int(b)
            out += (b"\r\n--BND\r\nContent-type: text/plain\r\nContent-range: bytes %d-%d/%d\r\n\r\n" % (a, b, len(body))
                    + body[a:b + 1])
        out += b"\r\n--BND--\r\n"
        return FakeResponse(206, out, {"Content-Type": "multipart/byteranges; boundary=BND"})


def test_step_writes_daily_dose_from_qc_ok_observations(tmp_path, monkeypatch):
    monkeypatch.setattr(rad, "EVERY_SOLS", 100)
    session = RadSession([10, 120, 230], early=(120,))
    report = run_snapshot(load_scenario(SCENARIO), tmp_path, Fetcher(session=session, sleep=lambda s: None),
                          steps=[rad.radiation_step], log=lambda m: None)
    assert report.failed == []
    e = Catalog.load(tmp_path / "catalog.json").get("radiation_rad")
    assert e["access"] == "local" and e["evidence_type"] == "observation"
    data = json.loads((tmp_path / e["files"][0]["path"]).read_text())
    s = data["sols"][0]
    assert s["sol"] == 10 and s["observations"] == 3 and s["qc_ok"] == 2
    assert s["dose_b_ugy_per_day"] == pytest.approx(9.0 * 24) and s["dose_e_ugy_per_day"] == pytest.approx(10.0 * 24)
    assert len(data["sols"]) == 3
    early = data["sols"][1]
    assert early["weighting"] == "equal" and early["dose_e_ugy_per_day"] == pytest.approx(11.0 * 24)
    assert early["hours_covered"] is None and s["weighting"] == "duration"
    assert not any(h is None and u.endswith(".TXT") for u, h in session.calls)  # text files only by range
    assert any("dose equivalent" in lim for lim in e["limitations"])
