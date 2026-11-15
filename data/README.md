# data/

Downloaded and computed data for the data-center site study: Gale crater, plus Jezero crater and Arcadia
Planitia for comparison. Every dataset is described in [`catalog.json`](catalog.json), which is the only file
here (besides this README) that is committed to git. Recreate everything with:

```bash
python -m martian_map snapshot                                  # Gale
python -m martian_map snapshot --scenario scenario/jezero.json   # Jezero
python -m martian_map snapshot --scenario scenario/arcadia.json  # Arcadia Planitia
```

| Folder | Contents |
|---|---|
| `elevation/` | ground height, steepness and bumpiness grids (`.f32`) and coloured overlays (`.png`) |
| `vectors/` | geology, mineral detections, dune outlines, geologic map index (`.geojson`) |
| `thermal/` | orbiter (THEMIS) temperature images (`.f32` kelvin + `.png`), the list of all images, and the 1 km thermal inertia grid |
| `water/` | Mars Odyssey water map, 5 degree cells (`.f32` weight percent + `.png` + `.json` table) |
| `weather/` | Curiosity's daily weather (trimmed `rems.json` and the raw feed) |
| `rover/` | Curiosity's path, stops, current position, named sites, MMGIS map settings |
| `solar/` | per-site skylines (`horizon_<site>.u8`) and sun tables (`sun_table_<site>.json`) |
| `scenario.json` | a copy of `scenario/gale.json` (edit the original, not this copy) |
| `regions/<id>/` | the same folders for `jezero` and `arcadia`, with each region's own `catalog.json`; their entries are merged into the main `catalog.json` with ids ending in `__<id>` |
| `tiles/` | single map tiles saved by the older `tile`/`demo` commands |

Grid files are raw little-endian numbers with no header; read the shape and edges from the file's `grid`
entry in `catalog.json`. See [docs/data-extraction.md](../docs/data-extraction.md) for how to read them.
