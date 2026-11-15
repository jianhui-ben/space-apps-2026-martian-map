import json
from pathlib import Path

from martian_map import cli
from martian_map.catalog import Catalog, new_entry

REPO = Path(__file__).resolve().parents[1]


def _catalog_with_missing_file(tmp_path):
    e = new_entry("slope_x", "Slope", "Steepness.", ["terrain"], "elevation", "derived", "local",
                  files=[{"path": "elevation/slope_x.f32", "format": "f32", "bytes": 8, "sha256": "0" * 64}])
    live = new_entry("imagery_hirise_color", "HiRISE colour", "Sharpest colour photo map.", ["terrain"], "imagery",
                     "observation", "live", tags=["hirise"])
    Catalog(entries=[e, live]).save(tmp_path / "catalog.json")


def test_cli_catalog_check_fresh_clone(tmp_path, capsys):
    _catalog_with_missing_file(tmp_path)
    assert cli.main(["catalog", "check", "--data-root", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "not downloaded" in out
    assert "slope_x" in out
    assert cli.main(["catalog", "check", "--strict", "--data-root", str(tmp_path)]) == 1


def test_cli_search(tmp_path, capsys):
    _catalog_with_missing_file(tmp_path)
    assert cli.main(["catalog", "search", "hirise", "--data-root", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "imagery_hirise_color" in out
    assert "slope_x" not in out


def test_cli_table(tmp_path, capsys):
    _catalog_with_missing_file(tmp_path)
    assert cli.main(["catalog", "table", "--data-root", str(tmp_path)]) == 0
    assert "| `slope_x` |" in capsys.readouterr().out


def test_cli_snapshot_static_only(tmp_path, capsys):
    code = cli.main(["snapshot", "--only", "static", "--data-root", str(tmp_path),
                     "--scenario", str(REPO / "scenario" / "gale.json")])
    assert code == 0
    raw = json.loads((tmp_path / "catalog.json").read_text())
    assert any(d["id"] == "thermal_day" for d in raw["datasets"])


def test_cli_snapshot_unknown_only_exits_2(tmp_path, capsys):
    code = cli.main(["snapshot", "--only", "elevation_site_curiosity", "--data-root", str(tmp_path),
                     "--scenario", str(REPO / "scenario" / "gale.json")])
    assert code == 2
    err = capsys.readouterr().err
    assert "elevation_site_curiosity" in err and "elevation_site_curiosity_recent" in err
    assert not (tmp_path / "catalog.json").exists()
