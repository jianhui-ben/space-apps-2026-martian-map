import pytest

from conftest import JPEG_BYTES, PNG_BYTES, FakeResponse, FakeSession
from martian_map.geo import TileIndex, lonlat_to_tile
from martian_map.trek import (
    LAYERS,
    MAX_TILE_BYTES,
    TREK_TILE_ROOT,
    TrekClient,
    TrekError,
    TrekLayer,
    check_grid,
    parse_capabilities,
    tile_filename,
)

VIKING = LAYERS["viking"]
THEMIS = LAYERS["themis"]


def _img(body=JPEG_BYTES, ctype="image/jpeg", **headers):
    return FakeResponse(200, body, {"Content-Type": ctype, **headers})


# --- capabilities parsing (recorded live documents in tests/fixtures) ---


def test_parse_viking_capabilities(viking_caps_xml):
    caps = parse_capabilities(viking_caps_xml)
    assert caps.title == VIKING.layer_id
    assert caps.formats == ["image/jpeg"]
    assert caps.max_zoom == VIKING.max_zoom == 7
    assert caps.wgs84_bbox == (-180.0, -90.0, 180.0, 90.0)
    assert caps.resource_template.endswith("/{TileMatrix}/{TileRow}/{TileCol}.jpg")
    assert check_grid(caps) == []


def test_parse_themis_capabilities(themis_caps_xml):
    caps = parse_capabilities(themis_caps_xml)
    assert caps.formats == ["image/png"]
    assert caps.max_zoom == THEMIS.max_zoom == 9
    west, south, east, north = caps.wgs84_bbox
    assert south == pytest.approx(THEMIS.lat_min, abs=0.01)
    assert north == pytest.approx(THEMIS.lat_max, abs=0.01)
    assert check_grid(caps) == []


def test_parse_mola_capabilities(mola_caps_xml):
    caps = parse_capabilities(mola_caps_xml)
    assert caps.title == LAYERS["mola"].layer_id
    assert caps.max_zoom == LAYERS["mola"].max_zoom == 7
    assert check_grid(caps) == []


def test_check_grid_reports_mismatch(viking_caps_xml):
    bad = viking_caps_xml.replace(b"<MatrixWidth>2.0</MatrixWidth>", b"<MatrixWidth>3.0</MatrixWidth>", 1)
    assert check_grid(parse_capabilities(bad)) == ["zoom 0: matrix 3x1, expected 2x1"]


def test_check_grid_reports_top_left_mismatch(viking_caps_xml):
    bad = viking_caps_xml.replace(b"<TopLeftCorner>-180.0 90.0</TopLeftCorner>", b"<TopLeftCorner>0.0 90.0</TopLeftCorner>", 1)
    assert check_grid(parse_capabilities(bad)) == ["zoom 0: top-left corner (0.0, 90.0), expected (-180.0, 90.0)"]


def test_only_default028mm_matrix_set_is_read(viking_caps_xml):
    renamed = viking_caps_xml.replace(
        b"<ows:Identifier>default028mm</ows:Identifier>", b"<ows:Identifier>other</ows:Identifier>"
    )
    caps = parse_capabilities(renamed)
    assert caps.tile_matrices == []
    assert caps.max_zoom is None
    assert check_grid(caps) == ["no 'default028mm' tile matrix set"]


@pytest.mark.parametrize(
    "doc",
    [
        b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>',
        b"<x><!ENTITY a 'b'></x>",
    ],
)
def test_parse_capabilities_rejects_dtd(doc):
    with pytest.raises(TrekError, match="DTD|not valid XML"):
        parse_capabilities(doc)


def test_parse_capabilities_rejects_utf16_dtd():
    doc = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;">]><x>&b;</x>'
    data = doc.encode("utf-16")
    assert b"<!DOCTYPE" not in data  # a plain byte search would miss it
    with pytest.raises(TrekError, match="DTD"):
        parse_capabilities(data)


def test_parse_capabilities_rejects_external_entity():
    doc = b'<?xml version="1.0"?><!DOCTYPE x SYSTEM "file:///etc/passwd"><x/>'
    with pytest.raises(TrekError, match="DTD"):
        parse_capabilities(doc)


@pytest.mark.parametrize("doc", [b"not xml", b"<Capabilities xmlns='http://www.opengis.net/wmts/1.0'/>"])
def test_parse_capabilities_rejects_bad_documents(doc):
    with pytest.raises(TrekError):
        parse_capabilities(doc)


def test_parse_capabilities_rejects_str():
    with pytest.raises(TypeError):
        parse_capabilities("<x/>")


# --- layer definitions and URLs ---


def test_tile_url_format():
    tile = lonlat_to_tile(-4.72, 137.39, 7)
    assert VIKING.tile_url(tile) == (
        f"{TREK_TILE_ROOT}/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/7/67/225.jpg"
    )
    assert THEMIS.tile_url(tile).endswith("/7/67/225.png")


def test_tile_url_rejects_zoom_above_layer_max():
    with pytest.raises(ValueError, match="max zoom"):
        VIKING.tile_url(TileIndex(8, 0, 0))


def test_tile_url_rejects_out_of_matrix_tile():
    with pytest.raises(ValueError):
        VIKING.tile_url(TileIndex(1, 0, 4))


@pytest.mark.parametrize("bad_id", ["../etc", "a/b", "a..b", "", "x?y=1", "a b", "-lead", "abc\n", "abc\r\n", None])
def test_layer_id_must_be_path_safe(bad_id):
    with pytest.raises(ValueError):
        TrekLayer(layer_id=bad_id, title="t", data_kind="k")


def test_layer_rejects_unknown_format():
    with pytest.raises(ValueError):
        TrekLayer(layer_id="ok", title="t", data_kind="k", fmt="gif")


def test_builtin_layers_cover_three_data_kinds():
    assert {layer.data_kind for layer in LAYERS.values()} == {"optical", "topographic", "thermal"}


def test_tile_filename_has_no_directory_parts():
    name = tile_filename(VIKING, TileIndex(7, 67, 225))
    assert "/" not in name and "\\" not in name
    assert name == "Mars_Viking_MDIM21_ClrMosaic_global_232m_z7_r67_c225.jpg"


# --- client with mocked HTTP ---


def test_get_capabilities_uses_safe_request_options(viking_caps_xml):
    session = FakeSession({VIKING.capabilities_url: FakeResponse(200, viking_caps_xml, {"Content-Type": "application/xml"})})
    caps = TrekClient(session=session, timeout_s=5).get_capabilities(VIKING)
    assert caps.max_zoom == 7
    (call,) = session.calls
    assert call["timeout"] == 5
    assert call["allow_redirects"] is False
    assert call["stream"] is True


def test_fetch_tile_saves_file(tmp_path):
    tile = lonlat_to_tile(-4.72, 137.39, 7)
    resp = _img()
    session = FakeSession({VIKING.tile_url(tile): resp})
    result = TrekClient(session=session).fetch_tile(VIKING, -4.72, 137.39, 7, out_dir=tmp_path / "tiles")
    assert result.tile == tile
    assert result.path == tmp_path / "tiles" / tile_filename(VIKING, tile)
    assert result.path.read_bytes() == JPEG_BYTES
    assert result.num_bytes == len(JPEG_BYTES)
    assert result.bounds.contains(-4.72, 137.39)
    assert resp.closed


def test_fetch_tile_without_out_dir_does_not_write(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    tile = lonlat_to_tile(0, 0, 3)
    session = FakeSession({THEMIS.tile_url(tile): _img(PNG_BYTES, "image/png")})
    result = TrekClient(session=session).fetch_tile(THEMIS, 0, 0, 3)
    assert result.path is None
    assert list(tmp_path.iterdir()) == []


def test_fetch_tile_outside_layer_latitude_coverage():
    with pytest.raises(ValueError, match="covers lat"):
        TrekClient(session=FakeSession()).fetch_tile(THEMIS, 70.0, 0.0, 3)


def test_http_error_raises_trek_error():
    with pytest.raises(TrekError, match="HTTP 404"):
        TrekClient(session=FakeSession()).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_redirect_is_not_followed():
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: FakeResponse(302, b"", {"Location": "http://evil.example/"})})
    with pytest.raises(TrekError, match="HTTP 302"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_wrong_content_type_rejected():
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: FakeResponse(200, b"<html>", {"Content-Type": "text/html; charset=utf-8"})})
    with pytest.raises(TrekError, match="expected an image"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_wrong_magic_bytes_rejected():
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: _img(PNG_BYTES, "image/jpeg")})
    with pytest.raises(TrekError, match="not a JPG"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_declared_oversize_rejected():
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: _img(**{"Content-Length": str(MAX_TILE_BYTES + 1)})})
    with pytest.raises(TrekError, match="cap"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_streamed_oversize_rejected(monkeypatch):
    monkeypatch.setattr("martian_map.trek.MAX_TILE_BYTES", 100)
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: _img(JPEG_BYTES + b"\x00" * 200)})
    with pytest.raises(TrekError, match="exceeded"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


@pytest.mark.parametrize("value", ["²", "12x", "-5", ""])
def test_odd_content_length_is_ignored_not_crashing(value):
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: _img(**{"Content-Length": value})})
    body, _ = TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))
    assert body == JPEG_BYTES


def test_lowercase_headers_are_honoured():
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: FakeResponse(200, JPEG_BYTES, {"content-type": "image/jpeg", "content-length": str(MAX_TILE_BYTES + 1)})})
    with pytest.raises(TrekError, match="cap"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_error_while_streaming_body_is_wrapped():
    import requests

    url = VIKING.tile_url(TileIndex(0, 0, 0))
    resp = FakeResponse(200, JPEG_BYTES, {"Content-Type": "image/jpeg"}, fail_after=requests.exceptions.ChunkedEncodingError("dropped"))
    session = FakeSession({url: resp})
    with pytest.raises(TrekError, match="ChunkedEncodingError: dropped"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))
    assert resp.closed


def test_total_deadline_enforced(monkeypatch):
    clock = iter([0.0, 100.0, 200.0])
    monkeypatch.setattr("martian_map.trek.time.monotonic", lambda: next(clock))
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: _img()})
    with pytest.raises(TrekError, match="longer than 30 s"):
        TrekClient(session=session, deadline_s=30).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_fetch_tile_unwritable_out_dir_raises_trek_error(tmp_path):
    blocker = tmp_path / "a-file"
    blocker.write_text("x")
    tile = lonlat_to_tile(0, 0, 3)
    session = FakeSession({VIKING.tile_url(tile): _img()})
    with pytest.raises(TrekError, match="could not save tile"):
        TrekClient(session=session).fetch_tile(VIKING, 0, 0, 3, out_dir=blocker)


def test_transport_exception_wrapped():
    url = VIKING.tile_url(TileIndex(0, 0, 0))
    session = FakeSession({url: ConnectionError("boom")})
    with pytest.raises(TrekError, match="ConnectionError: boom"):
        TrekClient(session=session).get_tile_bytes(VIKING, TileIndex(0, 0, 0))


def test_client_refuses_urls_outside_mars_trek():
    with pytest.raises(TrekError, match="refusing"):
        TrekClient(session=FakeSession())._get("https://example.com/x", 10)
    with pytest.raises(TrekError, match="refusing"):
        TrekClient(session=FakeSession())._get(TREK_TILE_ROOT + ".evil.example/x", 10)


def test_default_session_sets_user_agent():
    client = TrekClient()
    assert client._session.headers["User-Agent"].startswith("martian-map/")


# --- live (opt-in) ---


@pytest.mark.network
def test_live_viking_capabilities_and_tile(tmp_path):
    client = TrekClient(timeout_s=20)
    caps = client.get_capabilities(VIKING)
    assert check_grid(caps) == []
    result = client.fetch_tile(VIKING, -4.72, 137.39, 5, out_dir=tmp_path)
    assert result.num_bytes > 1000
