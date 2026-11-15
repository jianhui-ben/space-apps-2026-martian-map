import json

import pytest

from martian_map.catalog import CATALOG_NOTE, Catalog, CatalogError, file_record, new_entry
from martian_map.scenario import Bounds


def _local(tmp_path, eid="slope_site", title="Slope at site", summary="How steep the ground is.", **kw):
    f = tmp_path / f"{eid}.f32"
    f.write_bytes(b"\x00" * 8)
    return new_entry(
        eid, title, summary, ["terrain"], "elevation", "derived", "local",
        files=[file_record(f, tmp_path, "f32")], **kw,
    )


def test_new_entry_defaults(tmp_path):
    e = _local(tmp_path)
    assert e["status"] == "ok"
    assert e["uncertainty"] == {"value": "unknown"}
    assert e["positional_accuracy"] == "unknown"
    assert e["ground_validated"] == {"value": False, "note": ""}
    assert e["files"][0]["path"] == "slope_site.f32"
    assert e["files"][0]["bytes"] == 8


def test_invalid_enums_rejected():
    base = dict(id="x", title="X", summary="s", factors=["terrain"], category="c", evidence_type="derived", access="live")
    for key, bad in (("evidence_type", "guess"), ("factors", ["cooling"]), ("access", "cached")):
        kw = dict(base)
        kw[key] = bad
        with pytest.raises(CatalogError):
            new_entry(**kw)


def test_bad_id_and_empty_summary_rejected():
    with pytest.raises(CatalogError):
        new_entry("Bad Id", "X", "s", ["terrain"], "c", "derived", "live")
    with pytest.raises(CatalogError):
        new_entry("ok_id", "X", "  ", ["terrain"], "c", "derived", "live")


def test_not_used_requires_reason():
    with pytest.raises(CatalogError):
        new_entry("worldview", "Worldview", "Earth only.", [], "reference", "reference", "not_used")
    e = new_entry("worldview", "Worldview", "Earth only.", [], "reference", "reference", "not_used", reason="Earth data only")
    assert e["reason"] == "Earth data only"


def test_local_ok_requires_file():
    with pytest.raises(CatalogError):
        new_entry("x", "X", "s", ["terrain"], "c", "derived", "local")


def test_round_trip(tmp_path):
    cat = Catalog(entries=[_local(tmp_path)], areas={"study_area": [0, 0, 1, 1]}, generated_at="2026-11-14T00:00:00Z",
                  scenario_file="scenario/gale.json", coverage_report=[])
    out = tmp_path / "catalog.json"
    cat.save(out)
    raw = json.loads(out.read_text())
    assert list(raw)[:2] == ["_note", "version"]
    assert raw["_note"] == CATALOG_NOTE
    again = Catalog.load(out)
    assert again.entries == cat.entries
    assert again.areas == cat.areas


def _cat(entries):
    return Catalog(entries=entries, areas={}, generated_at="", scenario_file="", coverage_report=[])


def test_search_words_all_must_match(tmp_path):
    a = _local(tmp_path, "slope_site", "Slope at SITE", "steepness")
    b = _local(tmp_path, "slope_region", "Slope region", "steepness")
    cat = _cat([a, b])
    assert [e["id"] for e in cat.search("slope site")] == ["slope_site"]
    assert len(cat.search("SLOPE")) == 2
    c = new_entry("thermal_day", "THEMIS day", "Picture", ["thermal"], "imagery", "observation", "live",
                  limitations=["Pictures only: no temperatures"], tags=["themis"])
    cat.upsert(c)
    assert [e["id"] for e in cat.search("temperatures")] == ["thermal_day"]
    assert [e["id"] for e in cat.search("themis")] == ["thermal_day"]


def test_search_factor_and_bounds(tmp_path):
    a = _local(tmp_path, "a_site", coverage={"bounds": [137.3, -4.9, 137.4, -4.8]})
    b = new_entry("b_thermal", "B", "s", ["thermal"], "c", "observation", "live", coverage={"bounds": [100, 10, 101, 11]})
    c = new_entry("c_nobounds", "C", "s", ["terrain"], "c", "reference", "live")
    cat = _cat([a, b, c])
    assert [e["id"] for e in cat.search(factor="thermal")] == ["b_thermal"]
    hits = cat.search(bounds=Bounds(137.35, -4.85, 137.5, -4.7))
    assert [e["id"] for e in hits] == ["a_site"]


def test_get_and_upsert(tmp_path):
    cat = _cat([_local(tmp_path)])
    assert cat.get("slope_site")["title"] == "Slope at site"
    with pytest.raises(KeyError):
        cat.get("nope")
    changed = dict(cat.get("slope_site"), title="New")
    cat.upsert(changed)
    assert cat.get("slope_site")["title"] == "New"
    assert len(cat.entries) == 1


def test_check_states(tmp_path):
    ok = _local(tmp_path, "ok_one")
    missing = _local(tmp_path, "gone")
    (tmp_path / "gone.f32").unlink()
    changed = _local(tmp_path, "changed")
    (tmp_path / "changed.f32").write_bytes(b"\x01" * 8)
    states = {r.dataset_id: r.state for r in _cat([ok, missing, changed]).check(tmp_path)}
    assert states == {"ok_one": "ok", "gone": "not_downloaded", "changed": "different"}


def test_markdown_table(tmp_path):
    b = new_entry("b_live", "B layer", "Bee | pipe.", ["thermal"], "c", "observation", "live")
    a = _local(tmp_path, "a_local", "A layer", "Ay.")
    table = _cat([b, a]).markdown_table()
    lines = table.strip().splitlines()
    assert lines[0] == "| id | what it is | factors | evidence | access |"
    assert lines[2].startswith("| `a_local` |")
    assert lines[3].startswith("| `b_live` |")
    assert "Bee \\| pipe." in lines[3]
    assert len(lines) == 4


def test_update_doc_table(tmp_path):
    from martian_map.catalog import update_doc_table

    doc = tmp_path / "d.md"
    doc.write_text("intro\n<!-- catalog-table:start -->\nold\n<!-- catalog-table:end -->\noutro\n")
    assert update_doc_table(doc, "| new |\n") is True
    assert doc.read_text() == "intro\n<!-- catalog-table:start -->\n| new |\n<!-- catalog-table:end -->\noutro\n"
    assert update_doc_table(doc, "| new |\n") is False
    bare = tmp_path / "bare.md"
    bare.write_text("no markers\n")
    with pytest.raises(CatalogError, match="markers"):
        update_doc_table(bare, "| x |\n")
