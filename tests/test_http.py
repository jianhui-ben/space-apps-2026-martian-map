import os

import pytest

from conftest import FakeResponse, FakeSession
from martian_map import http
from martian_map.http import FetchError, Fetcher, atomic_write, build_url, redact_url


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def _fetcher(routes=None, **kwargs):
    session = FakeSession(routes or {})
    fc = FakeClock()
    f = Fetcher(session=session, clock=fc.clock, sleep=fc.sleep, **kwargs)
    return f, session, fc


def test_rejects_non_https():
    f, session, _ = _fetcher()
    with pytest.raises(FetchError):
        f.get_bytes("http://trek.nasa.gov/x", 10)
    assert session.calls == []


def test_rejects_unlisted_host():
    f, session, _ = _fetcher()
    with pytest.raises(FetchError):
        f.get_bytes("https://example.com/x", 10)
    assert session.calls == []


def test_rejects_data_stream():
    f, session, _ = _fetcher()
    with pytest.raises(FetchError):
        f.get_bytes("https://trek.nasa.gov/TrekWS/rest/cat/data/stream?label=x", 10)
    assert session.calls == []


def test_size_cap():
    url = "https://trek.nasa.gov/big"
    f, _, _ = _fetcher({url: FakeResponse(200, b"x" * 2000, {"Content-Type": "application/octet-stream"})})
    with pytest.raises(FetchError, match="cap"):
        f.get_bytes(url, 1000)


def test_non_200_raises():
    f, _, _ = _fetcher()
    with pytest.raises(FetchError, match="404"):
        f.get_bytes("https://trek.nasa.gov/missing", 1000)


def test_rate_limit_same_host():
    a1 = "https://trek.nasa.gov/a"
    a2 = "https://trek.nasa.gov/b"
    b1 = "https://mars.nasa.gov/c"
    ok = {"Content-Type": "text/plain"}
    f, _, fc = _fetcher({a1: FakeResponse(200, b"1", ok), a2: FakeResponse(200, b"2", ok), b1: FakeResponse(200, b"3", ok)})
    f.get_bytes(a1, 10)
    f.get_bytes(a2, 10)
    assert fc.sleeps == [1.0]
    f.get_bytes(b1, 10)
    assert fc.sleeps == [1.0]


def test_get_json_rejects_html():
    url = "https://trek.nasa.gov/page"
    f, _, _ = _fetcher({url: FakeResponse(200, b"<html><body>error</body></html>", {"Content-Type": "text/html"})})
    with pytest.raises(FetchError):
        f.get_json(url)


def test_get_json_parses():
    j = "https://trek.nasa.gov/j"
    t = "https://trek.nasa.gov/t"
    h = "https://trek.nasa.gov/h"
    f, _, _ = _fetcher(
        {
            j: FakeResponse(200, b'{"a": 1}', {"Content-Type": "application/json"}),
            t: FakeResponse(200, b"[1, 2]", {"Content-Type": "text/plain"}),
            h: FakeResponse(200, b' {"b": 2}', {"Content-Type": "text/html; charset=utf-8"}),
        }
    )
    assert f.get_json(j) == {"a": 1}
    assert f.get_json(t) == [1, 2]
    assert f.get_json(h) == {"b": 2}


def test_redact_url():
    assert (
        redact_url("https://api.nasa.gov/x?api_key=SECRET&startDate=1")
        == "https://api.nasa.gov/x?api_key=REDACTED&startDate=1"
    )
    trek = "https://trek.nasa.gov/s?key=Gale&rows=5"
    assert redact_url(trek) == trek


def test_build_url_keeps_order():
    assert build_url("https://trek.nasa.gov/s", {"b": 1, "a": "x y"}) == "https://trek.nasa.gov/s?b=1&a=x+y"


def test_atomic_write_leaves_no_partial(tmp_path, monkeypatch):
    target = tmp_path / "sub" / "out.bin"

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(http.os, "replace", boom)
    with pytest.raises(OSError):
        atomic_write(target, b"data")
    assert not target.exists()


def test_atomic_write_writes(tmp_path):
    target = tmp_path / "sub" / "out.bin"
    atomic_write(target, b"data")
    assert target.read_bytes() == b"data"
    assert not (tmp_path / "sub" / "out.bin.part").exists()


def test_redirect_not_followed():
    url = "https://trek.nasa.gov/moved"
    f, session, _ = _fetcher({url: FakeResponse(302, b"", {"Location": "https://example.com/"})})
    with pytest.raises(FetchError, match="302"):
        f.get_bytes(url, 100)
    assert session.calls[0]["allow_redirects"] is False


def test_get_bytes_timeout_override():
    from conftest import FakeResponse, FakeSession

    url = "https://trek.nasa.gov/slow"
    session = FakeSession({url: FakeResponse(200, b"ok", {"Content-Type": "text/plain"})})
    f = Fetcher(session=session, sleep=lambda s: None)
    f.get_bytes(url, 100)
    f.get_bytes(url, 100, timeout_s=90)
    assert session.calls[0]["timeout"] == 20 and session.calls[1]["timeout"] == 90
