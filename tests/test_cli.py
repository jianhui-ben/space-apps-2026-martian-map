import io

import pytest

from conftest import FIXTURES, JPEG_BYTES, PNG_BYTES, FakeResponse, FakeSession
from martian_map import cli
from martian_map.geo import lonlat_to_tile
from martian_map.trek import LAYERS, TrekClient


def _run(argv, capsys):
    code = cli.main(argv)
    out = capsys.readouterr()
    return code, out.out, out.err


def _demo_session(zoom=7):
    site = cli.DEMO_SITE
    routes = {}
    for key, layer in LAYERS.items():
        caps = (FIXTURES / f"{key}_wmts_capabilities.xml").read_bytes()
        routes[layer.capabilities_url] = FakeResponse(200, caps, {"Content-Type": "application/xml"})
        tile = lonlat_to_tile(site["lat"], site["lon"], min(zoom, layer.max_zoom))
        body, ctype = (PNG_BYTES, "image/png") if layer.fmt == "png" else (JPEG_BYTES, "image/jpeg")
        routes[layer.tile_url(tile)] = FakeResponse(200, body, {"Content-Type": ctype})
    return FakeSession(routes)


def test_layers(capsys):
    code, out, _ = _run(["layers"], capsys)
    assert code == 0
    for key in ("viking", "mola", "themis"):
        assert key in out
    assert "WMTSCapabilities.xml" in out


def test_tile_dry_run_makes_no_request(capsys, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("dry run must not build a client")

    monkeypatch.setattr(cli, "TrekClient", boom)
    code, out, _ = _run(["tile", "--lat", "-4.72", "--lon", "137.39", "--zoom", "7", "--dry-run"], capsys)
    assert code == 0
    assert "tile: z=7 row=67 col=225" in out
    assert out.strip().endswith("/7/67/225.jpg")


def test_tile_fetch_with_fake_client(tmp_path):
    tile = lonlat_to_tile(-4.72, 137.39, 7)
    session = FakeSession({LAYERS["viking"].tile_url(tile): FakeResponse(200, JPEG_BYTES, {"Content-Type": "image/jpeg"})})
    args = cli.build_parser().parse_args(["tile", "--lat", "-4.72", "--lon", "137.39", "--out", str(tmp_path)])
    out = io.StringIO()
    assert cli.cmd_tile(args, client=TrekClient(session=session), out=out) == 0
    assert "saved:" in out.getvalue()
    assert len(list(tmp_path.iterdir())) == 1


def test_tile_zoom_above_layer_max_is_usage_error(capsys):
    code, _, err = _run(["tile", "--lat", "0", "--lon", "0", "--zoom", "8", "--layer", "viking", "--dry-run"], capsys)
    assert code == 2
    assert "max zoom" in err


@pytest.mark.parametrize("value", ["nan", "inf", "abc"])
def test_tile_rejects_non_finite_coordinates(capsys, value):
    with pytest.raises(SystemExit) as exc:
        cli.main(["tile", "--lat", value, "--lon", "0", "--dry-run"])
    assert exc.value.code == 2


def test_traverse(capsys):
    code, out, _ = _run(["traverse", "--waypoints", "0,0,0;0.01,0,10;0.02,0,400", "--max-range", "1"], capsys)
    assert code == 0
    assert "total:" in out
    assert "flagged legs: 1" in out
    assert "within range limit: NO" in out


def test_traverse_bad_waypoints_is_usage_error(capsys):
    code, _, err = _run(["traverse", "--waypoints", "1,2"], capsys)
    assert code == 2
    assert "at least two waypoints" in err


@pytest.mark.parametrize("flag", ["--speed", "--max-range"])
def test_traverse_rejects_negative_numbers(flag, capsys):
    with pytest.raises(SystemExit) as exc:
        cli.main(["traverse", "--waypoints", "0,0;0,1", flag, "-1"])
    assert exc.value.code == 2
    assert "must be" in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [
        ["traverse", "--waypoints", "-4.70,137.38,-4150;-4.71,137.39,-4120;-4.725,137.40,-3820", "--max-range", "10"],
        ["traverse", "--waypoints=-4.70,137.38,-4150;-4.71,137.39,-4120;-4.725,137.40,-3820", "--max-range", "10"],
    ],
)
def test_traverse_accepts_southern_first_waypoint(argv, capsys):
    """The README example: a first waypoint with a negative latitude."""
    code, out, err = _run(argv, capsys)
    assert code == 0, err
    assert "total:" in out and "WP2" in out


def test_tile_accepts_exponent_negative_coordinates(capsys):
    code, out, err = _run(["tile", "--lat", "-1e-3", "--lon", "-2.5e1", "--zoom", "3", "--dry-run"], capsys)
    assert code == 0, err
    assert "tile: z=3" in out


def test_join_dash_values_leaves_other_tokens_alone():
    argv = ["tile", "--lat", "-4", "--dry-run", "--", "--lat", "-1,2"]
    assert cli._join_dash_values(argv) == ["tile", "--lat=-4", "--dry-run", "--", "--lat", "-1,2"]
    assert cli._join_dash_values(["tile", "--lat", "--dry-run"]) == ["tile", "--lat", "--dry-run"]


def test_traverse_error_names_waypoint_like_the_table(capsys):
    code, _, err = _run(["traverse", "--waypoints", "0,0;95,0"], capsys)
    assert code == 2
    assert "WP1" in err and "lat must be in [-90, 90]" in err


def test_tile_dry_run_checks_layer_latitude_coverage(capsys):
    code, out, err = _run(["tile", "--layer", "themis", "--lat", "80", "--lon", "0", "--zoom", "3", "--dry-run"], capsys)
    assert code == 2
    assert "covers lat" in err
    assert out == ""  # nothing half-printed before the error


@pytest.mark.parametrize("cmd", [["demo"], ["tile", "--lat", "0", "--lon", "0", "--dry-run"]])
@pytest.mark.parametrize("zoom", ["-1", "25", "x"])
def test_zoom_validated_before_any_request(cmd, zoom, monkeypatch, capsys):
    def boom(*a, **k):
        raise AssertionError("must not build a client")

    monkeypatch.setattr(cli, "TrekClient", boom)
    with pytest.raises(SystemExit) as exc:
        cli.main(cmd + ["--zoom", zoom])
    assert exc.value.code == 2


def test_tile_unwritable_out_is_reported_not_crashing(tmp_path, capsys):
    blocker = tmp_path / "a-file"
    blocker.write_text("x")
    tile = lonlat_to_tile(0, 0, 3)
    session = FakeSession({LAYERS["viking"].tile_url(tile): FakeResponse(200, JPEG_BYTES, {"Content-Type": "image/jpeg"})})
    args = cli.build_parser().parse_args(["tile", "--lat", "0", "--lon", "0", "--zoom", "3", "--out", str(blocker)])
    with pytest.raises(cli.TrekError, match="could not save tile"):
        cli.cmd_tile(args, client=TrekClient(session=session), out=io.StringIO())


def test_demo_unwritable_out_reports_each_layer_and_still_plans(tmp_path):
    blocker = tmp_path / "a-file"
    blocker.write_text("x")
    args = cli.build_parser().parse_args(["demo", "--out", str(blocker)])
    out = io.StringIO()
    code = cli.cmd_demo(args, client=TrekClient(session=_demo_session()), out=out)
    assert code == 1
    assert out.getvalue().count("could not save tile") == 3
    assert "total:" in out.getvalue()


def test_demo_survives_mid_body_network_error(tmp_path):
    import requests

    session = _demo_session()
    tile = lonlat_to_tile(cli.DEMO_SITE["lat"], cli.DEMO_SITE["lon"], 7)
    session.routes[LAYERS["mola"].tile_url(tile)] = FakeResponse(
        200, JPEG_BYTES, {"Content-Type": "image/jpeg"}, fail_after=requests.exceptions.ChunkedEncodingError("drop")
    )
    args = cli.build_parser().parse_args(["demo", "--out", str(tmp_path)])
    out = io.StringIO()
    code = cli.cmd_demo(args, client=TrekClient(session=session), out=out)
    text = out.getvalue()
    assert code == 1
    assert text.count("grid ok") == 2 and "ChunkedEncodingError" in text
    assert "total:" in text


def test_demo_end_to_end_offline(tmp_path):
    args = cli.build_parser().parse_args(["demo", "--out", str(tmp_path)])
    out = io.StringIO()
    code = cli.cmd_demo(args, client=TrekClient(session=_demo_session()), out=out)
    text = out.getvalue()
    assert code == 0, text
    assert text.count("grid ok") == 3
    for kind in ("optical", "topographic", "thermal"):
        assert kind in text
    assert len(list(tmp_path.iterdir())) == 3
    assert "illustrative" in text
    assert "flagged legs: 1" in text


def test_demo_reports_failures_with_exit_1(tmp_path):
    args = cli.build_parser().parse_args(["demo", "--out", str(tmp_path)])
    out = io.StringIO()
    code = cli.cmd_demo(args, client=TrekClient(session=FakeSession()), out=out)
    assert code == 1
    assert out.getvalue().count("FAILED") == 3
    assert "total:" in out.getvalue()  # the offline traverse still runs


def test_python_dash_m_entry_point():
    import runpy
    import sys

    argv = sys.argv
    sys.argv = ["martian_map", "layers"]
    try:
        with pytest.raises(SystemExit) as exc:
            runpy.run_module("martian_map", run_name="__main__")
    finally:
        sys.argv = argv
    assert exc.value.code == 0
