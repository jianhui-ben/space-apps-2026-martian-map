import numpy as np
import pytest

from tiff_helpers import make_geotiff, to_bigtiff
from martian_map.geotiff import GeoTiffError, equirect_bounds, read_geotiff, read_tags, read_window

R = 3396190.0


def _bands(h=37, w=45):
    rng = np.random.default_rng(1)
    b1 = rng.integers(0, 60000, size=(h, w), dtype=np.uint16)
    b1[0, 0] = 65535
    b2 = rng.integers(0, 101, size=(h, w), dtype=np.uint16)
    return np.stack([b1, b2])


@pytest.mark.parametrize("compression,predictor,tile", [(50000, 2, (16, 16)), (8, 2, (16, 16)), (1, 1, None), (8, 1, None)])
def test_read_round_trip(compression, predictor, tile):
    bands = _bands()
    gt = read_geotiff(make_geotiff(bands, compression=compression, predictor=predictor, tile=tile))
    assert gt.bands.shape == (2, 37, 45)
    assert np.array_equal(gt.bands, bands)
    assert gt.pixel_scale == (1000.0, 1000.0)
    assert gt.nodata == "65535"


def test_float32_strips():
    vals = np.linspace(-5, 5, 6 * 7, dtype=np.float32).reshape(1, 6, 7)
    gt = read_geotiff(make_geotiff(vals, compression=8, predictor=1, tile=None, nodata=None))
    assert gt.bands.dtype == np.float32 and np.array_equal(gt.bands, vals) and gt.nodata is None


def test_equirect_bounds_mc23_corner():
    gt = read_geotiff(make_geotiff(_bands(1779, 2668)[:, :, :], tile=(256, 256)))
    b = equirect_bounds(gt, R)
    deg = R * np.pi / 180
    assert b.west == pytest.approx(8002000 / deg) and b.north == pytest.approx(0.0)
    assert b.east == pytest.approx((8002000 + 2668000) / deg)
    assert b.south == pytest.approx(-1779000 / deg)
    assert b.west == pytest.approx(135.0, abs=0.01)


def test_pixel_is_point_shifts_half_pixel():
    gt = read_geotiff(make_geotiff(_bands(4, 4), pixel_is_point=True))
    b = equirect_bounds(gt, R)
    deg = R * np.pi / 180
    assert b.west == pytest.approx((8002000 - 500) / deg)
    assert b.north == pytest.approx(500 / deg)


def test_not_a_tiff_rejected():
    with pytest.raises(GeoTiffError, match="not a TIFF"):
        read_geotiff(b"<html>error</html>")


def test_bigtiff_malformed_header_rejected():
    with pytest.raises(GeoTiffError, match="BigTIFF"):
        read_geotiff(b"II" + (43).to_bytes(2, "little") + b"\0" * 12)


def test_bigtiff_reads_like_classic():
    bands = (np.arange(40 * 36, dtype=np.uint16).reshape(1, 40, 36) * 7) % 5000
    classic = make_geotiff(bands, compression=8, tile=(16, 16), pixel_scale=(1.01, 1.01))
    big = to_bigtiff(classic)
    assert big[2:4] == (43).to_bytes(2, "little")
    a, b = read_geotiff(classic), read_geotiff(big)
    assert np.array_equal(a.bands, b.bands) and np.array_equal(b.bands, bands)
    assert b.pixel_scale == (1.01, 1.01) and b.tiepoint == a.tiepoint


def test_read_window_reads_only_needed_tiles():
    bands = (np.arange(64 * 64, dtype=np.uint16).reshape(1, 64, 64) * 3) % 4000
    data = to_bigtiff(make_geotiff(bands, compression=8, tile=(16, 16)))
    reads = []

    def read(off, n):
        reads.append((off, n))
        return data[off:off + n]

    bo, tags = read_tags(read)
    before = len(reads)
    win = read_window(read, bo, tags, 20, 5, 16, 16)  # rows 20-35, cols 5-20: tiles (1,0) (1,1) (2,0) (2,1)
    assert np.array_equal(win, bands[:, 20:36, 5:21])
    assert len(reads) - before == 4
    with pytest.raises(GeoTiffError, match="outside"):
        read_window(read, bo, tags, 60, 0, 8, 8)


def test_unknown_compression_rejected():
    data = bytearray(make_geotiff(_bands(4, 4), compression=1, predictor=1))
    i = data.find((259).to_bytes(2, "little") + (3).to_bytes(2, "little"))
    data[i + 8:i + 10] = (5).to_bytes(2, "little")  # LZW
    with pytest.raises(GeoTiffError, match="compression 5"):
        read_geotiff(bytes(data))


def test_truncated_chunk_rejected():
    data = make_geotiff(_bands(), compression=50000)
    with pytest.raises(GeoTiffError):
        read_geotiff(data[:-40])
