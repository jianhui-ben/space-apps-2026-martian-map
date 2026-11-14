import math

import pytest

from martian_map.geo import (
    MARS_MEAN_RADIUS_KM,
    MAX_ZOOM,
    TileIndex,
    haversine_km,
    km_per_pixel,
    lon_to_360,
    lonlat_to_tile,
    matrix_size,
    normalize_lon_180,
    pixel_in_tile,
    tile_bounds,
    tile_span_deg,
    validate_lat,
)


@pytest.mark.parametrize(
    "lon, expected",
    [(0, 0.0), (179.5, 179.5), (180, -180.0), (-180, -180.0), (190, -170.0), (360, 0.0), (-190, 170.0), (540, -180.0)],
)
def test_normalize_lon_180(lon, expected):
    assert normalize_lon_180(lon) == pytest.approx(expected)
    assert -180.0 <= normalize_lon_180(lon) < 180.0


@pytest.mark.parametrize("lon", [137.4, -4.6, 0.1, -179.99, 179.99])
def test_normalize_lon_leaves_in_range_values_exact(lon):
    assert normalize_lon_180(lon) == lon


def test_normalize_lon_tiny_negative_stays_in_range():
    assert -180.0 <= normalize_lon_180(-180.0 - 1e-15) < 180.0


@pytest.mark.parametrize("lon, expected", [(-1, 359.0), (137.4, 137.4), (-180, 180.0), (0, 0.0)])
def test_lon_to_360(lon, expected):
    assert lon_to_360(lon) == pytest.approx(expected)


@pytest.mark.parametrize("tiny", [-1e-20, -1e-17, -5e-15])
def test_lon_to_360_tiny_negative_stays_in_range(tiny):
    assert 0.0 <= lon_to_360(tiny) < 360.0


@pytest.mark.parametrize("zoom", [0, 3, 7, 12, 24])
@pytest.mark.parametrize("lat, lon", [(0.0, -1e-20), (1e-20, 0.0), (0.0, -5e-15), (-1e-20, 90.0 - 1e-14)])
def test_tile_contains_point_just_across_an_edge(lat, lon, zoom):
    assert tile_bounds(lonlat_to_tile(lat, lon, zoom)).contains(lat, lon)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_non_finite_rejected(bad):
    with pytest.raises(ValueError):
        normalize_lon_180(bad)
    with pytest.raises(ValueError):
        validate_lat(bad)


@pytest.mark.parametrize("bad", [True, "10", None])
def test_non_numbers_rejected(bad):
    with pytest.raises(TypeError):
        validate_lat(bad)


@pytest.mark.parametrize("lat", [-90.0001, 90.5, 1000])
def test_lat_out_of_range(lat):
    with pytest.raises(ValueError):
        validate_lat(lat)


def test_haversine_known_distances():
    quarter = math.pi * MARS_MEAN_RADIUS_KM / 2
    assert haversine_km(0, 0, 0, 90) == pytest.approx(quarter)
    assert haversine_km(90, 0, -90, 0) == pytest.approx(2 * quarter)
    assert haversine_km(0, 0, 0, 180) == pytest.approx(2 * quarter)
    assert haversine_km(-4.6, 137.4, -4.6, 137.4) == 0.0


def test_haversine_symmetric_and_wraps_antimeridian():
    a = haversine_km(10, 179.9, 10, -179.9)
    b = haversine_km(10, -179.9, 10, 179.9)
    assert a == pytest.approx(b)
    assert a < 15  # 0.2 deg of longitude, not 359.8


def test_haversine_rejects_bad_radius():
    with pytest.raises(ValueError):
        haversine_km(0, 0, 1, 1, radius_km=0)


@pytest.mark.parametrize("zoom, size", [(0, (2, 1)), (1, (4, 2)), (7, (256, 128)), (9, (1024, 512))])
def test_matrix_size_matches_mars_trek_capabilities(zoom, size):
    assert matrix_size(zoom) == size
    assert tile_span_deg(zoom) == pytest.approx(180.0 / size[1])


@pytest.mark.parametrize("zoom", [-1, MAX_ZOOM + 1])
def test_zoom_out_of_range(zoom):
    with pytest.raises(ValueError):
        matrix_size(zoom)


@pytest.mark.parametrize("zoom", [1.0, True, "3"])
def test_zoom_must_be_int(zoom):
    with pytest.raises(TypeError):
        matrix_size(zoom)


def test_lonlat_to_tile_corners():
    assert lonlat_to_tile(90, -180, 0) == TileIndex(0, 0, 0)
    assert lonlat_to_tile(-90, 179.9999, 0) == TileIndex(0, 0, 1)
    assert lonlat_to_tile(-90, 179.9999, 3) == TileIndex(3, 7, 15)
    # The antimeridian (lon 180) folds into the first column.
    assert lonlat_to_tile(0, 180, 2).col == 0


def test_lonlat_to_tile_gale_crater():
    # Curiosity / Gale crater, near -4.6 N, 137.4 E. Checked against the live
    # Mars Trek service: these tiles exist and cover the site.
    assert lonlat_to_tile(-4.6, 137.4, 5) == TileIndex(5, 16, 56)
    assert lonlat_to_tile(-4.72, 137.39, 7) == TileIndex(7, 67, 225)


@pytest.mark.parametrize("lat, lon", [(-4.72, 137.39), (45.0, -120.25), (-89.9, 0.1), (0.0, 0.0), (12.3, 359.0)])
@pytest.mark.parametrize("zoom", [0, 3, 7, 12])
def test_tile_bounds_contain_point(lat, lon, zoom):
    tile = lonlat_to_tile(lat, lon, zoom)
    b = tile_bounds(tile)
    assert b.contains(lat, lon)
    assert b.east - b.west == pytest.approx(tile_span_deg(zoom))
    assert b.north - b.south == pytest.approx(tile_span_deg(zoom))


def test_tile_bounds_rejects_out_of_range():
    with pytest.raises(ValueError):
        tile_bounds(TileIndex(0, 1, 0))
    with pytest.raises(ValueError):
        tile_bounds(TileIndex(0, 0, 2))
    with pytest.raises(ValueError):
        tile_bounds(TileIndex(2, -1, 0))


def test_pixel_in_tile():
    assert pixel_in_tile(90, -180, 0) == (0, 0)
    assert pixel_in_tile(-90, 179.9999999, 0) == (255, 255)
    assert pixel_in_tile(0, -90, 0) == (128, 128)


def test_km_per_pixel():
    equator_z0 = math.radians(180.0 / 256) * MARS_MEAN_RADIUS_KM
    assert km_per_pixel(0) == pytest.approx(equator_z0)
    assert km_per_pixel(1) == pytest.approx(equator_z0 / 2)
    assert km_per_pixel(0, lat=60) == pytest.approx(equator_z0 / 2)
