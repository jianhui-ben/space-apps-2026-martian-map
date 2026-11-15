import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from conftest import FakeResponse
from martian_map.catalog import Catalog
from martian_map.http import FetchError, Fetcher
from martian_map.scenario import Bounds, load_scenario
from martian_map.snapshot import run_snapshot
from martian_map.sources import arcgis
from martian_map.sources.arcgis import esri_to_geojson, query_features

FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(__file__).resolve().parents[1]
LAYER = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Test/FeatureServer/0"


class PagedSession:
    """Serves query pages keyed by resultOffset; ``no_paging`` mimics servers that reject it."""

    def __init__(self, pages, no_paging=False):
        self.pages = pages
        self.no_paging = no_paging
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        if "resultOffset" in q and self.no_paging:
            body = {"error": {"code": 400, "message": "Pagination is not supported.", "details": []}}
        else:
            body = self.pages[int(q.get("resultOffset", 0))]
        return FakeResponse(200, json.dumps(body).encode(), {"Content-Type": "application/json"})


def _pt(x, y, **attrs):
    return {"attributes": attrs, "geometry": {"x": x, "y": y}}


def _fetcher(session):
    return Fetcher(session=session, sleep=lambda s: None)


B = Bounds(136.0, -6.5, 139.0, -3.5)


def test_paging():
    pages = {
        0: {"features": [_pt(1, 1, a=1), _pt(2, 2, a=2)], "exceededTransferLimit": True},
        2: {"features": [_pt(3, 3, a=3)]},
    }
    s = PagedSession(pages)
    fc = query_features(_fetcher(s), LAYER, B, page_size=2)
    assert len(s.calls) == 2
    assert [f["properties"]["a"] for f in fc["features"]] == [1, 2, 3]
    assert fc["type"] == "FeatureCollection"
    assert fc["features"][0]["geometry"] == {"type": "Point", "coordinates": [1, 1]}


def test_no_paging_fallback():
    s = PagedSession({0: {"features": [_pt(1, 1, a=1)]}}, no_paging=True)
    fc = query_features(_fetcher(s), LAYER, B)
    assert len(fc["features"]) == 1
    assert "resultOffset" not in s.calls[-1]


def test_no_paging_truncated_fails():
    s = PagedSession({0: {"features": [_pt(1, 1)], "exceededTransferLimit": True}}, no_paging=True)
    with pytest.raises(FetchError, match="more features"):
        query_features(_fetcher(s), LAYER, B)


def test_arcgis_error_object_fails():
    s = PagedSession({0: {"error": {"code": 400, "message": "Invalid query"}}})
    with pytest.raises(FetchError, match="Invalid query"):
        query_features(_fetcher(s), LAYER, B)


def test_rings_to_polygon_with_hole():
    outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]  # clockwise in lon/lat
    hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]  # counter-clockwise
    g = esri_to_geojson({"rings": [outer, hole]})
    assert g["type"] == "Polygon" and len(g["coordinates"]) == 2
    other = [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]]
    g2 = esri_to_geojson({"rings": [outer, other]})
    assert g2["type"] == "MultiPolygon" and len(g2["coordinates"]) == 2


def test_paths_to_lines():
    assert esri_to_geojson({"paths": [[[0, 0], [1, 1]]]})["type"] == "LineString"
    assert esri_to_geojson({"paths": [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]})["type"] == "MultiLineString"


def test_geology_step_entry(tmp_path):
    page = json.loads((FIXTURES / "arcgis_units_page.json").read_text())
    empty = {"features": []}

    class S:
        def get(self, url, **kw):
            body = page if "/FeatureServer/3/" in url else empty
            return FakeResponse(200, json.dumps(body).encode(), {"Content-Type": "application/json"})

    sc = load_scenario(REPO / "scenario" / "gale.json")
    report = run_snapshot(sc, tmp_path, _fetcher(S()), steps=[arcgis.geology_step], log=lambda m: None)
    assert report.failed == []
    cat = Catalog.load(tmp_path / "catalog.json")
    units = cat.get("geology_units")
    assert units["evidence_type"] == "interpretation"
    assert units["coverage"]["bounds"] == sc.gale_region.as_list()
    assert units["files"][0]["path"] == "vectors/geology_units.geojson"
    fc = json.loads((tmp_path / "vectors" / "geology_units.geojson").read_text())
    assert len(fc["features"]) == 2 and fc["features"][0]["properties"]["Unit"]
    assert "1:20,000,000" in " ".join(units["limitations"])
    assert cat.get("geology_contacts")["files"][0]["path"] == "vectors/geology_contacts.geojson"
