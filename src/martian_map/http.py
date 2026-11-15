"""A small, polite HTTP fetcher shared by every data-snapshot step.

Rules it enforces on every request:

* HTTPS only, and only to hosts on an allowlist.
* Never Trek's full-file ``data/stream`` endpoint (multi-GB, ignores byte ranges).
* No redirects are followed, every request has a timeout, a wall-clock
  deadline and a byte cap, and TLS verification stays on (requests' default).
* At most one request per ``min_interval_s`` seconds to the same host.

The HTTP session, clock and sleep are injectable so tests run offline.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import __version__

USER_AGENT = f"martian-map/{__version__} (+https://github.com/jianhui-ben/space-apps-2026-martian-map)"

DEFAULT_ALLOWED_HOSTS = frozenset(
    {
        "trek.nasa.gov",
        "mars.nasa.gov",
        "services.arcgis.com",
        "oderest.rsl.wustl.edu",
        "stac.astrogeology.usgs.gov",
        "swim.psi.edu",
        "www-mars.lmd.jussieu.fr",
        # THEMIS team archive (Arizona State University PDS node): ODE lists THEMIS IRPBT product
        # files here (checked 2026-11-14).
        "static.mars.asu.edu",
        "zenodo.org",
        "pds-geosciences.wustl.edu",
        # Curiosity Mastcam optical depths (Lemmon, Mendeley Data): the API redirects downloads to this S3 bucket,
        # and every file is checked against the API's SHA-256 (checked 2026-11-15).
        "data.mendeley.com",
        "prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com",
        # NASA PDS Atmospheres Node (New Mexico State University): Navcam dust extinction.
        "atmos.nmsu.edu",
        # USGS Astrogeology analysis-ready data (public S3): HiRISE orthophotos as cloud-optimised GeoTIFFs,
        # read with range requests (checked 2026-11-15).
        "astrogeo-ard.s3-us-west-2.amazonaws.com",
        # NASA PDS Planetary Plasma Interactions node (UCLA): Curiosity RAD dose, read with range requests.
        "pds-ppi.igpp.ucla.edu",
        # NASA CCMC DONKI space weather database (solar particle events).
        "ccmc.gsfc.nasa.gov",
    }
)
DENY_SUBSTRINGS = ("/data/stream",)
REDACT_PARAMS = frozenset({"api_key", "apikey", "token", "access_token"})

_DIGITS_RE = re.compile(r"[0-9]+")


class FetchError(RuntimeError):
    """Raised when a request is refused, fails, or returns unusable data."""


@dataclass(frozen=True)
class FetchResult:
    body: bytes
    content_type: str
    url: str
    status: int = 200
    content_type_full: str = ""
    location: str = ""  # the Location header of a redirect the caller chose to accept (ok_status)


def build_url(base: str, params: Mapping[str, object]) -> str:
    """``base?k=v&...`` with keys in the given order."""
    if not params:
        return base
    return f"{base}?{urlencode([(k, str(v)) for k, v in params.items()])}"


def redact_url(url: str) -> str:
    """Replace secret-looking query values (api_key, token, ...) with ``REDACTED``."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    if not any(k.lower() in REDACT_PARAMS for k, _ in pairs):
        return url
    query = urlencode([(k, "REDACTED" if k.lower() in REDACT_PARAMS else v) for k, v in pairs])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def atomic_write(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` via a ``.part`` file, so readers never see half a file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + ".part")
    try:
        part.write_bytes(data)
        os.replace(part, path)
    finally:
        if part.exists():
            part.unlink()


def _default_session():
    import requests  # lazy, so pure helpers work without it

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


class Fetcher:
    """Polite GET client. ``session`` is anything with a requests-compatible ``get``."""

    def __init__(
        self,
        session=None,
        allowed_hosts: Iterable[str] = DEFAULT_ALLOWED_HOSTS,
        min_interval_s: float = 1.0,
        timeout_s: float = 20.0,
        deadline_s: float = 180.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._session = session if session is not None else _default_session()
        self._allowed = frozenset(h.lower() for h in allowed_hosts)
        self._min_interval_s = min_interval_s
        self._timeout_s = timeout_s
        self._deadline_s = deadline_s
        self._clock = clock
        self._sleep = sleep
        self._last_request_at: Dict[str, float] = {}

    def _check_url(self, url: str) -> str:
        parts = urlsplit(url)
        if parts.scheme != "https":
            raise FetchError(f"refusing non-HTTPS URL: {redact_url(url)}")
        host = (parts.hostname or "").lower()
        if host not in self._allowed:
            raise FetchError(f"refusing host {host!r} (not on the allowlist): {redact_url(url)}")
        for bad in DENY_SUBSTRINGS:
            if bad in url:
                raise FetchError(f"refusing denylisted endpoint {bad!r}: {redact_url(url)}")
        return host

    def _wait_turn(self, host: str) -> None:
        last: Optional[float] = self._last_request_at.get(host)
        if last is not None:
            wait = max(0.0, self._min_interval_s - (self._clock() - last))
            if wait > 0:
                self._sleep(wait)
        self._last_request_at[host] = self._clock()

    def get_bytes(self, url: str, max_bytes: int, timeout_s: Optional[float] = None,
                  headers: Optional[Dict[str, str]] = None, ok_status: Tuple[int, ...] = (200,)) -> FetchResult:
        """GET with every safety rule. ``timeout_s`` overrides the per-request timeout for slow servers;
        ``headers``/``ok_status`` allow byte-range requests (206)."""
        host = self._check_url(url)
        shown = redact_url(url)
        self._wait_turn(host)
        started = self._clock()
        kwargs: Dict[str, Any] = {"timeout": timeout_s or self._timeout_s, "stream": True, "allow_redirects": False}
        if headers:
            kwargs["headers"] = dict(headers)
        try:
            resp = self._session.get(url, **kwargs)
        except Exception as exc:  # requests raises many subclasses; surface them uniformly
            raise FetchError(f"request to {shown} failed: {exc.__class__.__name__}: {exc}") from exc
        try:
            status = getattr(resp, "status_code", None)
            if status not in ok_status:
                raise FetchError(f"GET {shown} returned HTTP {status}")
            full_type = resp.headers.get("Content-Type") or ""
            content_type = full_type.split(";")[0].strip().lower()
            declared = (resp.headers.get("Content-Length") or "").strip()
            if _DIGITS_RE.fullmatch(declared) and int(declared) > max_bytes:
                raise FetchError(f"GET {shown}: response is {declared} bytes, over the {max_bytes}-byte cap")
            chunks = []
            total = 0
            try:
                for chunk in resp.iter_content(chunk_size=64 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise FetchError(f"GET {shown}: response exceeded the {max_bytes}-byte cap")
                    if self._clock() - started > self._deadline_s:
                        raise FetchError(f"GET {shown}: response took longer than {self._deadline_s:g} s")
                    chunks.append(chunk)
            except FetchError:
                raise
            except Exception as exc:  # e.g. ChunkedEncodingError, read timeout mid-body
                raise FetchError(f"reading {shown} failed: {exc.__class__.__name__}: {exc}") from exc
            return FetchResult(b"".join(chunks), content_type, url, status=status, content_type_full=full_type,
                               location=resp.headers.get("Location") or "")
        finally:
            close = getattr(resp, "close", None)
            if callable(close):
                close()

    def download(self, url: str, path: Path, max_bytes: int, timeout_s: Optional[float] = None,
                 deadline_s: Optional[float] = None, ok_status: Tuple[int, ...] = (200,)) -> FetchResult:
        """Like :meth:`get_bytes`, but streams the body to ``path`` (via a ``.part`` file) instead of memory.

        The returned result has an empty ``body``; a redirect the caller accepted (``ok_status``) writes nothing.
        """
        host = self._check_url(url)
        shown = redact_url(url)
        self._wait_turn(host)
        started = self._clock()
        limit = deadline_s or self._deadline_s
        try:
            resp = self._session.get(url, timeout=timeout_s or self._timeout_s, stream=True, allow_redirects=False)
        except Exception as exc:
            raise FetchError(f"request to {shown} failed: {exc.__class__.__name__}: {exc}") from exc
        path = Path(path)
        part = path.with_suffix(path.suffix + ".part")
        try:
            status = getattr(resp, "status_code", None)
            if status not in ok_status:
                raise FetchError(f"GET {shown} returned HTTP {status}")
            full_type = resp.headers.get("Content-Type") or ""
            result = FetchResult(b"", full_type.split(";")[0].strip().lower(), url, status=status,
                                 content_type_full=full_type, location=resp.headers.get("Location") or "")
            if status != 200:
                return result
            declared = (resp.headers.get("Content-Length") or "").strip()
            if _DIGITS_RE.fullmatch(declared) and int(declared) > max_bytes:
                raise FetchError(f"GET {shown}: response is {declared} bytes, over the {max_bytes}-byte cap")
            path.parent.mkdir(parents=True, exist_ok=True)
            total = 0
            try:
                with open(part, "wb") as out:
                    for chunk in resp.iter_content(chunk_size=1 << 20):
                        total += len(chunk)
                        if total > max_bytes:
                            raise FetchError(f"GET {shown}: response exceeded the {max_bytes}-byte cap")
                        if self._clock() - started > limit:
                            raise FetchError(f"GET {shown}: response took longer than {limit:g} s")
                        out.write(chunk)
            except FetchError:
                raise
            except Exception as exc:
                raise FetchError(f"reading {shown} failed: {exc.__class__.__name__}: {exc}") from exc
            os.replace(part, path)
            return result
        finally:
            if part.exists():
                part.unlink()
            close = getattr(resp, "close", None)
            if callable(close):
                close()

    def get_json(self, url: str, max_bytes: int = 50 * 2**20) -> Any:
        result = self.get_bytes(url, max_bytes)
        text = result.body.lstrip()
        looks_json = text[:1] in (b"{", b"[")
        if not (result.content_type in ("application/json", "text/json") or looks_json):
            raise FetchError(f"GET {redact_url(url)}: expected JSON, got {result.content_type!r}")
        try:
            return json.loads(result.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise FetchError(f"GET {redact_url(url)}: body is not valid JSON ({exc})") from exc


__all__ = [
    "DEFAULT_ALLOWED_HOSTS",
    "DENY_SUBSTRINGS",
    "FetchError",
    "FetchResult",
    "Fetcher",
    "atomic_write",
    "build_url",
    "redact_url",
]
