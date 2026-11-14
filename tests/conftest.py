"""Shared pytest fixtures. The default suite never touches the network."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

import pytest
from requests.structures import CaseInsensitiveDict

FIXTURES = Path(__file__).parent / "fixtures"

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def pytest_addoption(parser):
    parser.addoption(
        "--run-network",
        action="store_true",
        default=False,
        help="also run tests marked @pytest.mark.network (they hit live NASA endpoints)",
    )


def pytest_collection_modifyitems(config, items):
    if config.getoption("--run-network"):
        return
    skip = pytest.mark.skip(reason="network test; pass --run-network to enable")
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)


class FakeResponse:
    """Mimics the parts of ``requests.Response`` the client uses.

    Headers are case-insensitive, like requests. ``fail_after`` makes
    ``iter_content`` raise that exception after the first chunk, the way
    requests does when a connection drops mid-body.
    """

    def __init__(
        self,
        status_code: int = 200,
        body: bytes = b"",
        headers: Optional[Dict[str, str]] = None,
        fail_after: Optional[Exception] = None,
    ):
        self.status_code = status_code
        self._body = body
        self.headers = CaseInsensitiveDict(headers or {})
        self._fail_after = fail_after
        self.closed = False

    def iter_content(self, chunk_size: int = 1024):
        for i in range(0, len(self._body), chunk_size):
            yield self._body[i : i + chunk_size]
            if self._fail_after is not None:
                raise self._fail_after

    def close(self):
        self.closed = True


class FakeSession:
    """Maps URL -> FakeResponse (or an Exception to raise). Records every call."""

    def __init__(self, routes: Optional[Dict[str, object]] = None):
        self.routes = dict(routes or {})
        self.calls: List[Dict[str, object]] = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        target = self.routes.get(url)
        if target is None:
            return FakeResponse(404, b"not found", {"Content-Type": "text/html"})
        if isinstance(target, Exception):
            raise target
        return target


@pytest.fixture
def viking_caps_xml() -> bytes:
    return (FIXTURES / "viking_wmts_capabilities.xml").read_bytes()


@pytest.fixture
def mola_caps_xml() -> bytes:
    return (FIXTURES / "mola_wmts_capabilities.xml").read_bytes()


@pytest.fixture
def themis_caps_xml() -> bytes:
    return (FIXTURES / "themis_wmts_capabilities.xml").read_bytes()
