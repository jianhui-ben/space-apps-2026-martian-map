# Data sources and design notes

## Mars Trek WMTS (used by `martian_map.trek`)

- Root: `https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/`
- Capabilities: `<root>/WMTSCapabilities.xml` (OGC WMTS 1.0.0, RESTful encoding)
- Tile: `<root>/default/default028mm/{z}/{row}/{col}.{jpg|png}`
- Grid: equirectangular. Top-left corner is (-180, 90). At zoom z the grid is `2^(z+1)` columns by `2^z` rows of 256 px tiles.
- No API key. Requests use a timeout, do not follow redirects, are size-capped, and are restricted to the Trek tile root.

| key    | layer id                                         | kind        | format | max z | coverage |
|--------|--------------------------------------------------|-------------|--------|-------|----------|
| viking | `Mars_Viking_MDIM21_ClrMosaic_global_232m`       | optical     | jpg    | 7     | global   |
| mola   | `Mars_MGS_MOLA_ClrShade_merge_global_463m`       | topographic | jpg    | 7     | global   |
| themis | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | thermal     | png    | 9     | ±65° lat |

Zoom limits, formats and coverage were read from each layer's live capabilities
on 2026-11-14. Copies of the Viking and THEMIS documents are in `tests/fixtures/`.

## Challenge resources

See the "Data sources" section of the top-level README.
