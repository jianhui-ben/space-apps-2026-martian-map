"""Pure geometry helpers for Mars maps. No I/O lives here.

Conventions
-----------
* Latitude is planetocentric, in degrees, in [-90, 90].
* Longitude is east-positive, in degrees. Any finite value is accepted and
  normalised to [-180, 180), which is what NASA Mars Trek's equirectangular
  ("EQ") tile services use.
* Tile indices follow the Mars Trek ``default028mm`` WMTS tile matrix set:
  at zoom ``z`` the globe is ``2**(z + 1)`` tiles wide and ``2**z`` tiles tall,
  with the top-left corner at (lon -180, lat 90). Every tile is square in
  degrees (``180 / 2**z`` on a side) and 256 x 256 pixels.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple

# IAU/IAG mean radius of Mars (Archinal et al., 2018), in km.
MARS_MEAN_RADIUS_KM = 3389.5

# Pixel size of one Mars Trek tile.
TILE_SIZE_PX = 256

# Highest zoom this module will compute tile indices for. Mars Trek global
# layers go up to roughly zoom 7-9; local high-resolution mosaics go further.
MAX_ZOOM = 24


@dataclass(frozen=True)
class TileIndex:
    """A tile address in the Mars Trek EQ grid."""

    zoom: int
    row: int
    col: int


@dataclass(frozen=True)
class TileBounds:
    """Geographic bounds of a tile, in degrees."""

    west: float
    south: float
    east: float
    north: float

    def contains(self, lat: float, lon: float) -> bool:
        lon = normalize_lon_180(lon)
        return self.south <= lat <= self.north and self.west <= lon <= self.east


def _require_finite(name: str, value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number, got {type(value).__name__}")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite, got {value!r}")
    return float(value)


def validate_lat(lat: float) -> float:
    """Return ``lat`` as a float, or raise if it is not in [-90, 90]."""
    lat = _require_finite("lat", lat)
    if not -90.0 <= lat <= 90.0:
        raise ValueError(f"lat must be in [-90, 90], got {lat}")
    return lat


def validate_zoom(zoom: int) -> int:
    """Return ``zoom`` or raise if it is not an int in [0, MAX_ZOOM]."""
    if isinstance(zoom, bool) or not isinstance(zoom, int):
        raise TypeError(f"zoom must be an int, got {type(zoom).__name__}")
    if not 0 <= zoom <= MAX_ZOOM:
        raise ValueError(f"zoom must be in [0, {MAX_ZOOM}], got {zoom}")
    return zoom


def normalize_lon_180(lon: float) -> float:
    """Normalise an east-positive longitude to [-180, 180).

    >>> normalize_lon_180(190.0)
    -170.0
    >>> normalize_lon_180(180.0)
    -180.0
    """
    lon = _require_finite("lon", lon)
    if -180.0 <= lon < 180.0:
        return lon  # already normalised; avoid floating-point drift from the modulo
    result = ((lon + 180.0) % 360.0) - 180.0
    # Floating-point modulo can return exactly 180.0 for inputs a hair below
    # -180; fold that back into the half-open interval.
    return -180.0 if result >= 180.0 else result


def lon_to_360(lon: float) -> float:
    """Convert an east-positive longitude to [0, 360)."""
    result = normalize_lon_180(lon) % 360.0
    # A tiny negative input (e.g. -1e-20) rounds to exactly 360.0; fold it to 0.
    return 0.0 if result >= 360.0 else result


def haversine_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    radius_km: float = MARS_MEAN_RADIUS_KM,
) -> float:
    """Great-circle distance between two points on a spherical Mars, in km."""
    lat1, lat2 = validate_lat(lat1), validate_lat(lat2)
    lon1, lon2 = normalize_lon_180(lon1), normalize_lon_180(lon2)
    radius_km = _require_finite("radius_km", radius_km)
    if radius_km <= 0:
        raise ValueError("radius_km must be positive")
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    # Clamp guards against a tiny overshoot above 1.0 for antipodal points.
    return 2.0 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def matrix_size(zoom: int) -> Tuple[int, int]:
    """Return ``(columns, rows)`` of the tile matrix at ``zoom``."""
    zoom = validate_zoom(zoom)
    return 2 ** (zoom + 1), 2 ** zoom


def tile_span_deg(zoom: int) -> float:
    """Width and height of one tile at ``zoom``, in degrees."""
    _, rows = matrix_size(zoom)
    return 180.0 / rows


def lonlat_to_tile(lat: float, lon: float, zoom: int) -> TileIndex:
    """Return the tile that contains (lat, lon) at ``zoom``.

    Points exactly on a tile edge belong to the tile to their east/south,
    except on the south pole and the antimeridian, which fold into the last
    row and the first column respectively.
    """
    lat = validate_lat(lat)
    lon = normalize_lon_180(lon)
    cols, rows = matrix_size(zoom)
    span = 180.0 / rows
    col = min(int((lon + 180.0) // span), cols - 1)
    row = min(int((90.0 - lat) // span), rows - 1)
    # ``lon + 180`` / ``90 - lat`` can round across a tile edge for values a
    # hair west of / north of it (e.g. lon=-1e-20). Step back so the chosen
    # tile always contains the point.
    if col > 0 and -180.0 + col * span > lon:
        col -= 1
    if row > 0 and 90.0 - row * span < lat:
        row -= 1
    return TileIndex(zoom=zoom, row=row, col=col)


def tile_bounds(tile: TileIndex) -> TileBounds:
    """Geographic bounds of ``tile``."""
    cols, rows = matrix_size(tile.zoom)
    if not (0 <= tile.row < rows and 0 <= tile.col < cols):
        raise ValueError(
            f"tile row/col out of range for zoom {tile.zoom}: "
            f"row={tile.row} (0..{rows - 1}), col={tile.col} (0..{cols - 1})"
        )
    span = 180.0 / rows
    west = -180.0 + tile.col * span
    north = 90.0 - tile.row * span
    return TileBounds(west=west, south=north - span, east=west + span, north=north)


def pixel_in_tile(lat: float, lon: float, zoom: int, tile_size: int = TILE_SIZE_PX) -> Tuple[int, int]:
    """Pixel ``(x, y)`` of (lat, lon) inside its own tile (origin top-left)."""
    tile = lonlat_to_tile(lat, lon, zoom)
    bounds = tile_bounds(tile)
    span = bounds.east - bounds.west
    fx = (normalize_lon_180(lon) - bounds.west) / span
    fy = (bounds.north - validate_lat(lat)) / span
    x = min(int(fx * tile_size), tile_size - 1)
    y = min(int(fy * tile_size), tile_size - 1)
    return x, y


def km_per_pixel(zoom: int, lat: float = 0.0, radius_km: float = MARS_MEAN_RADIUS_KM) -> float:
    """Approximate east-west ground distance of one pixel at ``lat``, in km."""
    lat = validate_lat(lat)
    deg_per_px = tile_span_deg(zoom) / TILE_SIZE_PX
    return math.radians(deg_per_px) * radius_km * math.cos(math.radians(lat))
