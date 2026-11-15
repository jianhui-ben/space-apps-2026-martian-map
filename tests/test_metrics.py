from pathlib import Path

from conftest import FakeSession
from martian_map import cli
from martian_map.catalog import Catalog, new_entry
from martian_map.http import Fetcher
from martian_map.metrics import DATASET_METRICS, coverage_markdown, metrics_for, parse_availability
from martian_map.scenario import load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import static

REPO = Path(__file__).resolve().parents[1]
AVAILABILITY = REPO / "docs" / "requirements" / "metric-data-availability.md"


def _metrics():
    return parse_availability(AVAILABILITY.read_text(encoding="utf-8"))


def test_parse_availability_finds_all_72_metrics():
    ms = _metrics()
    assert len(ms) == 72
    ids = [m["id"] for m in ms]
    assert ids[0] == "BT-01" and "IR-14" in ids and len(set(ids)) == 72
    bt05 = next(m for m in ms if m["id"] == "BT-05")
    assert bt05["name"] == "Maximum local pad slope" and bt05["label"] == "Estimate today"
    assert {m["label"] for m in ms} <= {"Estimate today", "Partial", "Field data needed", "Planning calculation"}


def test_mapping_uses_only_real_metric_ids():
    valid = {m["id"] for m in _metrics()}
    for pattern, ids in DATASET_METRICS:
        assert set(ids) <= valid, (pattern, set(ids) - valid)


def test_metrics_for_site_patterns():
    assert "BT-05" in metrics_for("slope_10m_window_new_site")
    assert "BT-08" in metrics_for("roughness_1m_new_site")
    assert "SC-01" in metrics_for("horizon_new_site")
    assert metrics_for("relief_mola") == []


def _local(eid):
    return new_entry(eid, eid, "s", ["terrain"], "c", "derived", "local",
                     files=[{"path": "x", "format": "f32", "bytes": 1, "sha256": "0" * 64}])


def test_coverage_markdown_flags_gaps():
    cat = Catalog(entries=[_local("slope_10m_window_site"),
                           new_entry("dune_change_imagery", "D", "s", ["terrain"], "imagery", "observation", "pending",
                                     reason="r")])
    md = coverage_markdown(cat, _metrics())
    row = next(line for line in md.splitlines() if line.startswith("| BT-05"))
    assert "`slope_10m_window_site`" in row and "Estimate today" in row
    bt16 = next(line for line in md.splitlines() if line.startswith("| BT-16"))
    assert "`dune_change_imagery`" in bt16
    assert "No data yet" in md and "BT-16" in md.split("No data yet")[1]


def test_snapshot_attaches_metrics_and_search(tmp_path):
    scenario = load_scenario(REPO / "scenario" / "gale.json")
    fetcher = Fetcher(session=FakeSession({}), sleep=lambda s: None)
    run_snapshot(scenario, tmp_path, fetcher, steps=[static.static_step], log=lambda m: None)
    cat = Catalog.load(tmp_path / "catalog.json")
    assert "GI-05" in cat.get("ice_swim")["metrics"]
    assert [e["id"] for e in cat.search(metric="IR-10")] == ["communications"]


def test_cli_metrics_write(tmp_path, capsys):
    Catalog(entries=[_local("slope_10m_window_site")]).save(tmp_path / "catalog.json")
    doc = tmp_path / "cov.md"
    doc.write_text("top\n<!-- metrics:start -->\n<!-- metrics:end -->\n")
    code = cli.main(["catalog", "metrics", "--write", str(doc), "--requirements", str(AVAILABILITY),
                     "--data-root", str(tmp_path)])
    assert code == 0 and "| BT-05" in doc.read_text()
    assert cli.main(["catalog", "search", "--metric", "BT-05", "--data-root", str(tmp_path)]) == 0
    assert "slope_10m_window_site" in capsys.readouterr().out
