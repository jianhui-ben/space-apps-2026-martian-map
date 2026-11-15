from pathlib import Path

import pytest

from conftest import FakeSession
from martian_map import cli
from martian_map.catalog import Catalog, new_entry
from martian_map.http import Fetcher
from martian_map.references import GROUPS, REFERENCES, references_for, references_markdown
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import all_steps, static

REPO = Path(__file__).resolve().parents[1]
SCENARIO = REPO / "scenario" / "gale.json"


def _used_ids(scenario):
    """Every dataset id the snapshot makes that the app uses (local or live)."""
    unused = {e["id"] for e in static.not_used_entries() + static.pending_entries()}
    return {d for s in all_steps(scenario) for d in s.dataset_ids} - unused


def test_every_used_dataset_has_known_references():
    scenario = load_scenario(SCENARIO)
    for d in sorted(_used_ids(scenario)):
        refs = references_for(d)
        assert refs, f"{d} has no reference"
        assert all(r in REFERENCES for r in refs), (d, refs)


def test_site_ids_resolve_by_pattern():
    assert "mro_hirise" in references_for("slope_1m_some_new_site")
    assert "mars24" in references_for("sun_table_some_new_site")
    assert references_for("no_such_dataset") == []


def test_reference_records_complete():
    for rid, r in REFERENCES.items():
        assert r["group"] in GROUPS, rid
        for key in ("title", "provider", "credit", "license", "url"):
            assert str(r.get(key) or "").strip(), (rid, key)
        assert r["url"].startswith(("https://", "http://")), rid


def test_groups_are_honest():
    assert REFERENCES["mex_omega"]["group"] == "partner"
    assert REFERENCES["huang_ti_2026"]["group"] == "other"
    assert REFERENCES["this_project"]["group"] == "other"
    assert REFERENCES["ody_themis"]["group"] == "nasa"
    assert "ody_themis" in references_for("thermal_inertia_themis_1km")  # built from NASA data, listed as such


def _entry(eid, access="local"):
    if access == "local":
        return new_entry(eid, eid, "s", ["terrain"], "c", "observation", "local",
                         files=[{"path": "x", "format": "f32", "bytes": 1, "sha256": "0" * 64}])
    return new_entry(eid, eid, "s", ["terrain"], "c", "observation", access, reason="r")


def test_markdown_groups_and_lists_datasets():
    cat = Catalog(entries=[_entry("minerals_detections"), _entry("thermal_inertia_themis_1km"),
                           _entry("ice_swim", "pending")])
    md = references_markdown(cat)
    nasa, partner, other = (md.index(f"### {GROUPS[g]}") for g in ("nasa", "partner", "other"))
    assert nasa < partner < other
    assert "Mars Express OMEGA" in md[partner:other]
    assert "Huang" in md[other:]
    assert "`minerals_detections`" in md and "`ice_swim`" not in md


def test_snapshot_attaches_references(tmp_path):
    scenario = load_scenario(SCENARIO)
    fetcher = Fetcher(session=FakeSession({}), sleep=lambda s: None)
    report = run_snapshot(scenario, tmp_path, fetcher, steps=[static.static_step], log=lambda m: None)
    cat = Catalog.load(tmp_path / "catalog.json")
    assert cat.get("imagery_hirise_gray")["references"] == ["mro_hirise", "mars_trek"]
    assert set(cat.references) >= {"mro_hirise", "mars_trek", "this_project"}
    assert cat.references["mro_hirise"]["provider"].startswith("NASA")
    assert not any("no reference" in w for w in report.warnings)


def test_cli_references_write(tmp_path, capsys):
    Catalog(entries=[_entry("weather_rems")]).save(tmp_path / "catalog.json")
    doc = tmp_path / "refs.md"
    doc.write_text("top\n<!-- references:start -->\nold\n<!-- references:end -->\nbottom\n")
    assert cli.main(["catalog", "references", "--write", str(doc), "--data-root", str(tmp_path)]) == 0
    text = doc.read_text()
    assert "REMS" in text and "old" not in text and text.startswith("top\n") and text.endswith("bottom\n")


@pytest.mark.network
def test_reference_urls_reachable():
    import requests

    bad = []
    for rid, r in REFERENCES.items():
        try:
            code = requests.get(r["url"], timeout=30, headers={"User-Agent": "martian-map-tests"}).status_code
        except requests.RequestException as exc:
            code = type(exc).__name__
        if code != 200:
            bad.append((rid, r["url"], code))
    assert not bad, bad
