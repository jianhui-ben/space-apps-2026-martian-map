"""Small client for NASA/JPL Mars Trek WMTS tile services.

Mars Trek (https://trek.nasa.gov/mars/) is the first NASA resource listed by
the Space Apps 2026 "Interplanetary Survival Guide: Martian Map" challenge.
Its global layers are published as public, key-less OGC WMTS (RESTful)
services under ``https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/``.

No API key or credential is used anywhere in this module.

The HTTP layer is injectable (``session=``) so tests can run fully offline.
"""

from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from xml.parsers import expat

from . import __version__
from .geo import TileBounds, TileIndex, lonlat_to_tile, matrix_size, tile_bounds, validate_lat

TREK_TILE_ROOT = "https://trek.nasa.gov/tiles/Mars/EQ"
TILE_MATRIX_SET = "default028mm"
DEFAULT_TIMEOUT_S = 20.0  # per connect / per socket read (requests semantics)
DEFAULT_DEADLINE_S = 60.0  # wall-clock budget for reading one whole response
USER_AGENT = f"martian-map/{__version__} (+https://github.com/jianhui-ben/space-apps-2026-martian-map)"

# Hard caps on how much we read from the network, so a misbehaving endpoint
# cannot fill memory or disk.
MAX_CAPABILITIES_BYTES = 1 * 1024 * 1024
MAX_TILE_BYTES = 8 * 1024 * 1024

_LAYER_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
_ASCII_DIGITS_RE = re.compile(r"[0-9]+")

_WMTS_NS = {
    "wmts": "http://www.opengis.net/wmts/1.0",
    "ows": "http://www.opengis.net/ows/1.1",
}

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"


class TrekError(RuntimeError):
    """Raised when a Mars Trek request fails or returns unexpected data."""


@dataclass(frozen=True)
class TrekLayer:
    """A Mars Trek WMTS layer in the equirectangular (EQ) projection."""

    layer_id: str
    title: str
    data_kind: str
    fmt: str = "jpg"
    max_zoom: int = 7
    lat_min: float = -90.0
    lat_max: float = 90.0

    def __post_init__(self) -> None:
        if not isinstance(self.layer_id, str) or not _LAYER_ID_RE.fullmatch(self.layer_id) or ".." in self.layer_id:
            raise ValueError(f"unsafe or invalid layer id: {self.layer_id!r}")
        if self.fmt not in ("jpg", "png"):
            raise ValueError(f"unsupported tile format: {self.fmt!r}")

    @property
    def base_url(self) -> str:
        return f"{TREK_TILE_ROOT}/{self.layer_id}/1.0.0"

    @property
    def capabilities_url(self) -> str:
        return f"{self.base_url}/WMTSCapabilities.xml"

    def tile_url(self, tile: TileIndex) -> str:
        """RESTful WMTS tile URL: ``.../{Style}/{TileMatrixSet}/{z}/{row}/{col}.{fmt}``."""
        self.check_tile(tile)
        return f"{self.base_url}/default/{TILE_MATRIX_SET}/{tile.zoom}/{tile.row}/{tile.col}.{self.fmt}"

    def check_tile(self, tile: TileIndex) -> None:
        if tile.zoom > self.max_zoom:
            raise ValueError(f"zoom {tile.zoom} exceeds max zoom {self.max_zoom} for layer {self.layer_id}")
        tile_bounds(tile)  # raises if row/col are outside the matrix

    def covers_lat(self, lat: float) -> bool:
        return self.lat_min <= validate_lat(lat) <= self.lat_max


# Three layers that give three different kinds of data, as the challenge
# suggests (optical, topographic, thermal). Zoom limits and formats were read
# from each layer's live WMTSCapabilities.xml on 2026-11-14.
LAYERS: Dict[str, TrekLayer] = {
    "viking": TrekLayer(
        layer_id="Mars_Viking_MDIM21_ClrMosaic_global_232m",
        title="Viking MDIM 2.1 color mosaic (232 m/px)",
        data_kind="optical",
        fmt="jpg",
        max_zoom=7,
    ),
    "mola": TrekLayer(
        layer_id="Mars_MGS_MOLA_ClrShade_merge_global_463m",
        title="MGS MOLA color shaded relief (463 m/px)",
        data_kind="topographic",
        fmt="jpg",
        max_zoom=7,
    ),
    "themis": TrekLayer(
        layer_id="THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018",
        title="Mars Odyssey THEMIS daytime IR controlled mosaic (100 m/px)",
        data_kind="thermal",
        fmt="png",
        max_zoom=9,
        lat_min=-65.0,
        lat_max=65.0,
    ),
}


@dataclass(frozen=True)
class TileMatrixInfo:
    identifier: str
    matrix_width: int
    matrix_height: int
    tile_width: int
    tile_height: int
    top_left: Tuple[float, float] = (-180.0, 90.0)


@dataclass(frozen=True)
class Capabilities:
    title: str
    formats: List[str]
    resource_template: Optional[str]
    wgs84_bbox: Optional[Tuple[float, float, float, float]]
    tile_matrices: List[TileMatrixInfo] = field(default_factory=list)

    @property
    def max_zoom(self) -> Optional[int]:
        ids = [int(m.identifier) for m in self.tile_matrices if m.identifier.isdigit()]
        return max(ids) if ids else None


@dataclass(frozen=True)
class TileResult:
    layer: TrekLayer
    tile: TileIndex
    bounds: TileBounds
    url: str
    path: Optional[Path]
    num_bytes: int
    content_type: str


def _floats(text: Optional[str]) -> List[float]:
    return [float(x) for x in (text or "").split()]


class _DTDFound(Exception):
    pass


def _raise_dtd(*_args) -> None:
    raise _DTDFound()


def _reject_dtd(xml_bytes: bytes) -> None:
    """Raise TrekError if the document declares a DTD or any entity.

    Uses expat itself (which honours the document's declared encoding, e.g.
    UTF-16), so the check sees exactly what the real parser would see.
    """
    scanner = expat.ParserCreate()
    scanner.StartDoctypeDeclHandler = _raise_dtd
    scanner.EntityDeclHandler = _raise_dtd
    scanner.UnparsedEntityDeclHandler = _raise_dtd
    scanner.ExternalEntityRefHandler = _raise_dtd
    try:
        scanner.Parse(bytes(xml_bytes), True)
    except _DTDFound:
        raise TrekError("capabilities document contains a DTD; refusing to parse") from None
    except expat.ExpatError as exc:
        raise TrekError(f"capabilities document is not valid XML: {exc}") from None


def parse_capabilities(xml_bytes: bytes) -> Capabilities:
    """Parse the subset of a WMTS GetCapabilities document we need.

    Any DTD or entity declaration is rejected before parsing: a capabilities
    document never needs one, and refusing them rules out entity-expansion
    and external-entity tricks. Only the ``default028mm`` tile matrix set is
    read.
    """
    if not isinstance(xml_bytes, (bytes, bytearray)):
        raise TypeError("xml_bytes must be bytes")
    if len(xml_bytes) > MAX_CAPABILITIES_BYTES:
        raise TrekError("capabilities document is too large")
    _reject_dtd(xml_bytes)
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise TrekError(f"capabilities document is not valid XML: {exc}") from None

    layer = root.find("wmts:Contents/wmts:Layer", _WMTS_NS)
    if layer is None:
        raise TrekError("capabilities document has no Layer")
    title = (layer.findtext("ows:Title", default="", namespaces=_WMTS_NS) or "").strip()
    formats = [(f.text or "").strip() for f in layer.findall("wmts:Format", _WMTS_NS)]
    res = layer.find("wmts:ResourceURL", _WMTS_NS)
    template = res.get("template") if res is not None else None

    bbox = None
    wgs = layer.find("ows:WGS84BoundingBox", _WMTS_NS)
    if wgs is not None:
        lower = _floats(wgs.findtext("ows:LowerCorner", namespaces=_WMTS_NS))
        upper = _floats(wgs.findtext("ows:UpperCorner", namespaces=_WMTS_NS))
        if len(lower) == 2 and len(upper) == 2:
            bbox = (lower[0], lower[1], upper[0], upper[1])

    matrices: List[TileMatrixInfo] = []
    for tms in root.findall("wmts:Contents/wmts:TileMatrixSet", _WMTS_NS):
        if (tms.findtext("ows:Identifier", default="", namespaces=_WMTS_NS) or "").strip() != TILE_MATRIX_SET:
            continue
        for tm in tms.findall("wmts:TileMatrix", _WMTS_NS):
            try:
                corner = _floats(tm.findtext("wmts:TopLeftCorner", namespaces=_WMTS_NS))
                if len(corner) != 2:
                    raise ValueError("TopLeftCorner")
                matrices.append(
                    TileMatrixInfo(
                        identifier=(tm.findtext("ows:Identifier", namespaces=_WMTS_NS) or "").strip(),
                        matrix_width=int(float(tm.findtext("wmts:MatrixWidth", namespaces=_WMTS_NS))),
                        matrix_height=int(float(tm.findtext("wmts:MatrixHeight", namespaces=_WMTS_NS))),
                        tile_width=int(float(tm.findtext("wmts:TileWidth", namespaces=_WMTS_NS))),
                        tile_height=int(float(tm.findtext("wmts:TileHeight", namespaces=_WMTS_NS))),
                        top_left=(corner[0], corner[1]),
                    )
                )
            except (TypeError, ValueError):
                raise TrekError("capabilities document has a malformed TileMatrix") from None
    return Capabilities(
        title=title, formats=formats, resource_template=template, wgs84_bbox=bbox, tile_matrices=matrices
    )


def check_grid(caps: Capabilities) -> List[str]:
    """Return mismatches between ``caps`` and the grid :mod:`martian_map.geo` assumes."""
    if not caps.tile_matrices:
        return [f"no '{TILE_MATRIX_SET}' tile matrix set"]
    problems = []
    for m in caps.tile_matrices:
        if not m.identifier.isdigit():
            continue
        z = int(m.identifier)
        try:
            expected = matrix_size(z)
        except ValueError:
            problems.append(f"zoom {z} is outside the supported range")
            continue
        if (m.matrix_width, m.matrix_height) != expected:
            problems.append(f"zoom {z}: matrix {m.matrix_width}x{m.matrix_height}, expected {expected[0]}x{expected[1]}")
        if (m.tile_width, m.tile_height) != (256, 256):
            problems.append(f"zoom {z}: tile size {m.tile_width}x{m.tile_height}, expected 256x256")
        if m.top_left != (-180.0, 90.0):
            problems.append(f"zoom {z}: top-left corner {m.top_left}, expected (-180.0, 90.0)")
    return problems


def _default_session():
    import requests  # imported lazily so pure helpers work without it

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


class TrekClient:
    """Fetch capabilities and tiles from Mars Trek.

    ``session`` is anything with a ``requests.Session``-compatible ``get``
    method; tests pass a fake one.
    """

    def __init__(
        self,
        session=None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        deadline_s: float = DEFAULT_DEADLINE_S,
    ) -> None:
        self._session = session if session is not None else _default_session()
        self._timeout_s = timeout_s
        self._deadline_s = deadline_s

    def _get(self, url: str, max_bytes: int) -> Tuple[bytes, str]:
        if not url.startswith(TREK_TILE_ROOT + "/"):
            raise TrekError(f"refusing to fetch a URL outside {TREK_TILE_ROOT}: {url}")
        started = time.monotonic()
        try:
            resp = self._session.get(url, timeout=self._timeout_s, stream=True, allow_redirects=False)
        except Exception as exc:  # requests raises many subclasses; surface them uniformly
            raise TrekError(f"request to {url} failed: {exc.__class__.__name__}: {exc}") from exc
        try:
            status = getattr(resp, "status_code", None)
            if status != 200:
                raise TrekError(f"GET {url} returned HTTP {status}")
            content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            declared = (resp.headers.get("Content-Length") or "").strip()
            if _ASCII_DIGITS_RE.fullmatch(declared) and int(declared) > max_bytes:
                raise TrekError(f"GET {url}: response is {declared} bytes, over the {max_bytes}-byte cap")
            chunks = []
            total = 0
            try:
                for chunk in resp.iter_content(chunk_size=64 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise TrekError(f"GET {url}: response exceeded the {max_bytes}-byte cap")
                    if time.monotonic() - started > self._deadline_s:
                        raise TrekError(f"GET {url}: response took longer than {self._deadline_s:g} s")
                    chunks.append(chunk)
            except TrekError:
                raise
            except Exception as exc:  # e.g. ChunkedEncodingError, read timeout, SSLError mid-body
                raise TrekError(f"reading {url} failed: {exc.__class__.__name__}: {exc}") from exc
            return b"".join(chunks), content_type
        finally:
            close = getattr(resp, "close", None)
            if callable(close):
                close()

    def get_capabilities(self, layer: TrekLayer) -> Capabilities:
        body, _ = self._get(layer.capabilities_url, MAX_CAPABILITIES_BYTES)
        return parse_capabilities(body)

    def get_tile_bytes(self, layer: TrekLayer, tile: TileIndex) -> Tuple[bytes, str]:
        url = layer.tile_url(tile)
        body, content_type = self._get(url, MAX_TILE_BYTES)
        if not content_type.startswith("image/"):
            raise TrekError(f"GET {url}: expected an image, got Content-Type {content_type!r}")
        magic = _PNG_MAGIC if layer.fmt == "png" else _JPEG_MAGIC
        if not body.startswith(magic):
            raise TrekError(f"GET {url}: body is not a {layer.fmt.upper()} image")
        return body, content_type

    def fetch_tile(
        self,
        layer: TrekLayer,
        lat: float,
        lon: float,
        zoom: int,
        out_dir: Optional[Path] = None,
    ) -> TileResult:
        """Fetch the tile that covers (lat, lon); save it under ``out_dir`` if given."""
        if not layer.covers_lat(lat):
            raise ValueError(f"layer {layer.layer_id} covers lat {layer.lat_min}..{layer.lat_max}, not {lat}")
        tile = lonlat_to_tile(lat, lon, zoom)
        url = layer.tile_url(tile)
        body, content_type = self.get_tile_bytes(layer, tile)
        path = None
        if out_dir is not None:
            path = Path(out_dir) / tile_filename(layer, tile)
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
            except OSError as exc:
                raise TrekError(f"could not save tile to {path}: {exc.__class__.__name__}: {exc}") from exc
        return TileResult(
            layer=layer,
            tile=tile,
            bounds=tile_bounds(tile),
            url=url,
            path=path,
            num_bytes=len(body),
            content_type=content_type,
        )


def tile_filename(layer: TrekLayer, tile: TileIndex) -> str:
    """Deterministic, path-safe file name for a tile (no directory parts)."""
    return f"{layer.layer_id}_z{tile.zoom}_r{tile.row}_c{tile.col}.{layer.fmt}"
