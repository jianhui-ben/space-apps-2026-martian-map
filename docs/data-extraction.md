# How we get the data

This page explains how the project's data gets into `data/`, how to refresh it, and what to do when
something goes wrong. For *what* each dataset means, see [data-sources.md](data-sources.md).

## One-time setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

No accounts or API keys are needed. Every source used today is public.

## Download everything

```bash
python -m martian_map snapshot
```

The command:

1. reads the areas from `scenario/gale.json`;
2. downloads or computes each dataset into a folder under `data/`;
3. rewrites the index, `data/catalog.json`.

| Folder | What's in it | Size (2026-11-15) |
|---|---|---|
| `data/elevation/` | ground height, steepness and bumpiness grids plus their coloured overlays | ~530 MB (each 1 m site grid is 16–56 MB, each 2 m trip-area grid 15 MB) |
| `data/vectors/` | geology, mineral detections, dune outlines, geologic map index (GeoJSON) | ~12 MB |
| `data/thermal/` | four orbiter temperature images, the list of all of them, and the 1 km thermal inertia grid | ~3 MB |
| `data/water/` | Mars Odyssey water map (5 degree cells), as a grid and a JSON table | ~0.3 MB |
| `data/weather/` | Curiosity's daily weather | ~3 MB |
| `data/rover/` | Curiosity's path, stops, position and map settings | ~2 MB |
| `data/solar/` | skylines and sun tables per site | ~0.9 MB |
| `data/climate/` | Mars Climate Database tables, Curiosity's measured dust (Mastcam) and near-ground haze (Navcam) | ~1 MB |
| `data/dunes/` | the 2007 and 2015 HiRISE dune photos and the measured sand shifts | ~8 MB |
| `data/radiation/` | Curiosity RAD daily dose (sampled sols) and NASA DONKI solar storm list | ~0.1 MB |
| `data/catalog.json` | the index (this one file is committed to git) | ~0.1 MB |

A full first run takes about 15 minutes, about 560 MB in all. The slow steps:

- the elevation downloads (about 25 s) and the skyline calculation (about 30 s per site);
- the climate database, 14 requests of 5–25 s each (about 2.5 min); when it is busy a request can take
  over two minutes or be refused, so the step tries each request three times;
- Curiosity's radiation record, 49 sampled sols (about 4 min);
- the solar storm list, 88 requests (about 1.5 min).

The temperature images are 35–54 MB each. The radiation and dune steps read only the bytes they need from
large files (HTTP range requests), so they download a few MB instead of gigabytes.

## Jezero crater and Arcadia Planitia

Two more regions use the same steps, for comparison with Gale:

```bash
python -m martian_map snapshot --scenario scenario/jezero.json
python -m martian_map snapshot --scenario scenario/arcadia.json
```

- Each run writes its files to `data/regions/<id>/`, with that region's own index
  `data/regions/<id>/catalog.json`, then merges every region into `data/catalog.json`.
- A first run takes about 10 minutes and 200-230 MB per region.
- In the merged index the other regions' ids end in `__jezero` or `__arcadia`, their file paths start with
  `regions/<id>/`, and every entry has `region` and `dataset` (the id without the ending). Gale's ids stay
  as they were. `areas.regions` lists each region's areas.
- Re-running Gale keeps the other regions, even on a fresh clone where their folders are missing.
- `--only` takes the plain ids, for example `--only elevation_site_jezero_north`.
- Mars Trek has no 1 m elevation model at Jezero or Arcadia. The heights come from USGS Astrogeology
  elevation models named in the scenario's `elevation` section: a HiRISE model (1 m, for the sites and
  the trip area) and a CTX model (about 20 m, for the study area). They are cloud-optimised GeoTIFFs,
  read with range requests, so a run fetches only the parts that cover the boxes.
- Some steps run only at Gale, because they use Curiosity's instruments or Gale's dunes: weather (REMS),
  measured dust (Mastcam, Navcam), moving sand, radiation (RAD) and the solar storm list (DONKI, which is
  the same for all of Mars). In the other regions these are listed as `not_used`, and each one names
  the Gale dataset that stands in for it.
- Perseverance's path and stops come from its own map (MMGIS, `mission=M20`). Arcadia has no rover.

## Re-running, refreshing and adding a site

- **Re-running is cheap.** A dataset is skipped when its files are on disk, match the index, and were
  made from the same boxes in `scenario/gale.json`, so a second run makes almost no requests.
- **Editing a box re-fetches what depends on it.** Moving a site box re-makes that site's elevation,
  slope, roughness, skyline and sun table. Moving the study area or the Gale region re-makes the layers
  cut to that box.
- **Renaming or removing a site** drops its old entries from the index on the next run. Their files stay
  in `data/` until you delete them.
- **`--refresh`** downloads everything again, for example to pick up Curiosity's newest position and
  weather. Use it after changing the step code.
- **`--only ID,ID`** always re-runs the chosen steps or datasets, for example `--only rover,weather`.
  An id it doesn't know is an error, and the error lists the valid ids.
- **To add or move a candidate site:**
  1. Add or edit a box in `sites` in `scenario/gale.json`. It must lie inside the study area and be at
     most 5 km on each side.
  2. Run `python -m martian_map snapshot` (it finds what changed), or just that site's steps:
     `python -m martian_map snapshot --only elevation_site_<id>,alignment,solar_<id>`.
  3. The run warns if less than 95% of the box has 1 m elevation data. If so, move the box and run again.
- **`--stretch`** also runs the optional extras, once they exist.

## Checking and searching

```bash
python -m martian_map catalog check            # is every file present and unchanged?
python -m martian_map catalog check --strict   # same, but exit 1 if anything is missing
python -m martian_map catalog search slope --factor terrain
python -m martian_map catalog table --write docs/data-sources.md   # refresh the table in data-sources.md
```

On a fresh clone, `catalog check` reports files as "not downloaded". That's expected: only the index is in
git. Run `snapshot` to fetch them.

## How the app should read the data

- **Find datasets in `data/catalog.json`**, not by hard-coding paths.
  - Each `local` entry lists its `files`.
  - Each `live` entry has a `live.url_template`, such as a tile address with `{z}/{x}/{y}`.
- **Grid files (`.f32`, `.u8`) are raw numbers with no header.** Read them as a `Float32Array` or
  `Uint8Array` in JavaScript (or `numpy.fromfile` in Python). Each file's `grid` section gives the
  `width`, `height`, edge coordinates (`bounds` = west, south, east, north), and the no-data value.
  Row 0 is the north edge.
- **Overlays (`.png`)** have `bounds` and a colour `legend`, so the map can lay them on top of the photos
  directly.
- **Tile grids differ.** Trek tiles (`wmts-eq`) and MMGIS tiles (`tms-webmercator`) use different map
  layouts, so one map view can't show both without conversion. See the `limitations` of each entry.

## The be-polite rules

The downloader (`src/martian_map/http.py`) follows these rules for every request:

- **Only approved hosts, over HTTPS**, with certificate checks on: NASA, USGS, the PDS archives, the
  THEMIS team archive and Zenodo (for the thermal inertia map). Downloads with a published checksum are
  checked against it (the THEMIS images' MD5, the thermal inertia sheet's SHA-256).
- **At most one request per second to each host.**
- **A time limit and a size limit on every download.** It never uses Trek's whole-file download
  (`data/stream`), which sends several gigabytes and ignores size limits.
- **Files are written in one step**, so an interrupted run never leaves half a file that looks complete.
- **Downloaded orbiter images are checked against the checksum** in their own label.

## When something goes wrong

- **A step fails.** The run carries on with the others, prints `failed: ...`, and exits with code 1. The
  failed dataset is marked `status: "failed"` with the error in the index. Fix the cause and re-run with
  `--only <that step>`.
- **Certificate errors** ("unable to get local issuer certificate"). Some sites send an incomplete
  certificate chain; this happened with the Space Apps site. Never turn verification off. Instead:
  1. Find the missing piece's address:
     `openssl s_client -connect HOST:443 -servername HOST </dev/null | openssl x509 -noout -ext authorityInfoAccess`
     (the "CA Issuers" URL).
  2. Download that certificate and check it against the system's trusted roots:
     `openssl x509 -inform DER -in inter.cer -out inter.pem && openssl verify -CAfile /etc/pki/tls/certs/ca-bundle.crt inter.pem`.
  3. Use the system bundle plus that file as the CA bundle, for example with `curl --cacert`, or the
     `REQUESTS_CA_BUNDLE` environment variable for Python.

  None of the hosts the snapshot uses needed this on 2026-11-14.
- **A server is down.** SWIM (the ice maps) returned errors all day on 2026-11-14. Such sources stay
  `pending` in the index until they can be fetched.
- **Heights don't match between layers.** That's the recorded alignment offset; see "Checks on how well the
  layers line up" in [data-sources.md](data-sources.md).

---

## Appendix: endpoint details (research notes, 2026-11-14)

These are the technical notes from the first research pass. They are kept for reference: request formats,
sample `curl` commands and what each endpoint returned. Some sources described here are not used; the index
marks them `not_used` with the reason.

Focus site: Gale crater / lower Mount Sharp, about lat -4.7, lon 137.4 E (planetocentric, east-positive).
This note covers how to reach each challenge resource from code: endpoints, formats, auth, CORS and a sample request.
For the three global Trek layers already wired into `martian_map.trek`, see `data-sources.md`.

**Legend.** "LV" means live-verified on 2026-11-14 with the request shown; responses came back with no key and no login.
"docs:" means read from the cited page and not exercised. CORS is "yes" only when a response carried
`Access-Control-Allow-Origin` (ACAO) for a request sent with an `Origin:` header.

Trek EQ tiles use `2^(z+1)` x `2^z` tiles of 256 px, so ground resolution at the equator is
`2*pi*3396190 / (2^(z+1)*256)` m/px: z12 = 10.2, z14 = 2.54, z16 = 0.64.
MMGIS tiles are spherical-Mercator TMS: z13 = 10.2 and z18 = 0.32 m/px.

### 1. Summary

| Source | Data kinds at Gale | Best resolution at Gale | Access mechanism | Auth | CORS | Verdict |
|---|---|---|---|---|---|---|
| **JPL Mars Trek** | optical (HiRISE, CTX), topographic (HiRISE DEM), thermal (THEMIS, TES), spectral (CRISM/OMEGA detections) | HiRISE mosaic tiles at z16 = 0.64 m/px; DEM with 1 m float elevations | WMTS REST tiles; ArcGIS ImageServer (identify, exportImage to GeoTIFF); ArcGIS MapServer query (GeoJSON); Solr-style JSON search | none for reads; analysis tools need a login | tiles: yes (`*`); ArcGIS: yes (echoes Origin); search, abstract and profile endpoints: **no** | **Core source.** The only listed resource with walking-scale imagery and elevation. |
| **USGS PGM interactive maps** | geologic units, contacts, structures (vector) | 1:20M global map (SIM 3292); a 1:60K Aeolis Mons map is "In Progress" | ArcGIS Online FeatureServer query (JSON, GeoJSON, PBF); 809 MB GIS zip; planetarymaps WMS (global rasters) | none | yes (`*`) | **Context layer only.** One build-time query. |
| **Curiosity's proposed path** (PIA23179) | annotated route visual | none (3.0 MB animated GIF) | static asset | none | yes (`*`) | Visual reference. Use the MMGIS data behind it instead (next row). |
| ↳ **MMGIS "Where is Curiosity"** (not listed, sits behind it) | actual traverse and waypoints with rover roll/pitch/tilt; HiRISE colour basemap | 0.32 m/px colour tiles (z18) | static GeoJSON plus TMS tiles | none | yes (`*`) | **Must use.** Ground-truth route plus a slope proxy, updated daily. |
| **NASA Worldview / GIBS** | Earth only | none | WMTS | none | yes (`*`) | No Mars data. Architecture reference only. |
| **Perseverance raw images** | point-of-view photos (Jezero, not Gale) | full-frame PNG/JPG | JSON API (`/rss/api/`) | none | API: yes; image files: **no** | Wrong site. The same pattern applies to the MSL API (next row). |
| ↳ **Curiosity raw images API** (not listed) | point-of-view photos at Gale; `site`/`drive` join to waypoints | full-frame JPG | JSON API (`/api/v1/raw_image_items/`) | none | API: yes; image files: **no** | **Must use** for point-of-view photos. |

### 2. Per-source detail

#### 2.1 JPL Mars Trek (https://trek.nasa.gov/mars/)

**Gale products** (LV, from the Trek search service; bounding boxes are lon/lat):

| Layer id | What | Bbox | Max z / res | Formats |
|---|---|---|---|---|
| `curiosity_hirise_mosaic` | HiRISE orthomosaic, greyscale | 137.122–137.730 E, -4.925 to -4.249 | z16 = 0.64 m/px | WMTS png |
| `Gale_DEM_SMG_1m` | HiRISE DEM, 1 m float32 (ImageServer pixel 1.687e-5° = 1.0 m) | same as above | WMTS z14 (8-bit visual); **ImageServer float32 at 1 m** | WMTS png, ImageServer GeoTIFF/JSON |
| `Gale_CTX_BlockAdj_dd` | CTX mosaic | 135.18–139.24 E, -6.57 to -2.81 | z12 = 10.2 m/px | WMTS png |
| `curiosity_ctx_mosaic` | CTX mosaic, landing region | 136.28–139.39 E, -7.21 to -3.58 | z10 = 40.7 m/px | WMTS png |
| `mars_pahrump_patch_8k_256m` | small "Pahrump Hills" patch (catalogued as HRSC) | about 256 m square near 137.378 E, -4.663 | (not checked) | WMTS |
| `THEMIS_DayIR_…_100m_v2_oct2018`, `THEMIS_NightIR_…` | thermal IR, day and night | ±65° lat | 100 m native | WMTS |
| `TES_Thermal_Inertia`, TES mineral layers | global thermal inertia and mineralogy | global | coarse (not checked) | WMTS |
| `Hydrous_Mineral_Detections_CRISM_clon0` | CRISM/OMEGA hydrous-mineral detection points | global | 6 points near Gale, given to 0.1° | ArcGIS MapServer (GeoJSON) |

- The WMTS tiles of the DEM are **8-bit stretched greyscale images, not elevations** (LV: the z14 tile was a 1.7 KB grey+alpha PNG). Get real heights from the ImageServer.
- No slope or rock product covers Gale. A `key=Slope` search returns only CTX slope maps at other sites, and `key=CRISM` returns no CRISM browse tiles over Gale (LV).
- The FGDC metadata endpoint returns placeholders (`Use_Constraints: TBD`, `Access_Constraints: PRIVATE`), so Trek publishes no machine-readable licence (LV).

**Endpoints and discovery.** Found in https://trek.nasa.gov/mars/jpl/config/config.json and https://trek.nasa.gov/tiles/apidoc/config/config.json (LV).
- Search: `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?key=&bbox=W,S,E,N&start=&rows=&facetKeys=itemType&facetValues=product`.
  It returns Solr JSON (`response.docs[]` with `productLabel`, `item_UUID`, `bbox`, `serviceTypes`, `fileSize`).
  `bbox` matches products lying **within** the box, so use a box larger than the product.
- Services for an item: `…/ws/index/getLayerServices?uuid=<item_UUID>` returns the WMTS `endPoint` and, for the DEM, also
  `https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer`.
- Tiles: `https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{row}/{col}.png` (capabilities at `…/1.0.0/WMTSCapabilities.xml`).
- ImageServer (ArcGIS 10.61; `Image,Metadata,Mensuration`; `maxImageWidth` 15000 x `maxImageHeight` 4100): use `identify` for a point height and `exportImage` for an F32 GeoTIFF window.
- Elevation profile: `…/TrekServices/ws/elevationProfile/multiDEM/interpolated?path=[[lon,lat],…]&numberOfPoints=&radiusInMeters=3390000`. The path must be URL-encoded.
  For the test segment it sampled **only MOLA**, not the 1 m DEM; it returns JSON labelled `text/html` and sends no ACAO (LV).
- Full-file download: `…/TrekWS/rest/cat/data/stream?label=<layer>`. The DEM file is 5.8 GB per `fileSize`.
  **It ignores Range and sends no Content-Length** (LV), so never probe it from the app.
- Login-gated: `rest/path`, `rest/rock/detect`, `rest/slope`, `rest/transform/.../subset` all take an OpenAM `iPlanetDirectoryPro` token plus an email (docs: the Trek app bundle `https://trek.nasa.gov/mars/dojo/dojo.js`). Not evaluated.

**Auth, limits and terms.** Reads need no key. No rate-limit headers were seen (LV).
Licensing: NASA media "generally are not subject to copyright in the United States" (LV: https://www.nasa.gov/nasa-brand-center/images-and-media/). Credit the instrument teams, e.g. HiRISE as NASA/JPL-Caltech/University of Arizona.

**Samples (LV):**
```sh
curl -s 'https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=80&facetKeys=itemType&facetValues=product&bbox=134,-8,141,-1'
# 200 application/json, 14 KB, numFound 5 (the 5 Gale products above). No ACAO.
curl -s 'https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/16/34479/115561.png'
# 200 image/png, 54 KB, 256x256 grey+alpha HiRISE texture at (137.4, -4.7). ACAO: *
curl -s 'https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer/identify?geometry=%7B%22x%22%3A137.4%2C%22y%22%3A-4.7%7D&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json'
# 200 JSON: {"name":"Pixel","value":"-4285",...}. ACAO echoes the request Origin, with Allow-Credentials: true
curl -s -o w.tif 'https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer/exportImage?bbox=137.395,-4.705,137.405,-4.695&bboxSR=104905&size=64,64&format=tiff&pixelType=F32&f=image'
# 200 image/tiff, 66 KB, 64x64 float32 with GeoTIFF tags (33550/33922/34735). Use size ~593x593 for the full 1 m.
```

#### 2.2 USGS-NASA Planetary Geologic Mapping (https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)

- The Hub page embeds a Web AppBuilder app, `MARS_App_PGM_website` (item `f693b580b2464e6989f32e4266199552`).
  Its web map `6136a40d6f6a40508e3b4dd2dd64f82a` has one operational layer: a footprint index of published maps,
  `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PGM_Map_Database_MARS_INTERACTIVE2/FeatureServer/1` (LV).
- Maps covering (137.4, -4.7) (LV): **Geologic Map of Mars, SIM 3292, 1:20M, 2014** (Tanaka et al.); older 1:15M to 1:25M global maps; the 1:5M Aeolis quadrangle (I-1111, 1978); and **"Aeolis Mons" 1:60K, MapStatus "In Progress"** (no data or links).
- SIM 3292 as live vectors: `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer/{0..3}`.
  The layers are 0 landing sites, 1 contacts, 2 structures and 3 units. They are stored in a Robinson Mars-sphere projection; query with `inSR=104905` (LV).
  Unit at the focus: **Htu, "Hesperian transition undivided unit"**. An envelope of 136.8–138.0 E, -5.3 to -4.1 returns 2 polygons (Htu, AHi) (LV).
- Bulk: `https://pubs.usgs.gov/sim/3292/downloads/sim3292_database.zip` (HEAD: 200 application/zip, 808,910,442 bytes; LV).
- WMS: `https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map` lists 14 global layers (THEMIS, MDIM, MOLA, HRSC-MOLA blend, quad charts) with ACAO `*` (LV). That is no finer than Trek at Gale.
- Auth: none. CORS: `*` on services.arcgis.com and planetarymaps (LV). The index layer allows `maxRecordCount` 2000 and JSON, geoJSON or PBF (LV).
  Terms: USGS products are generally public domain (docs: https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits; that page returned 403 to curl, so unverified).

```sh
curl -sG 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer/3/query' \
  --data-urlencode 'geometry=137.4,-4.7' --data-urlencode 'geometryType=esriGeometryPoint' --data-urlencode 'inSR=104905' \
  --data-urlencode 'outFields=Unit,UnitDesc' --data-urlencode 'returnGeometry=false' --data-urlencode 'f=json'
# 200 application/json, 3.4 KB, Unit "Htu". ACAO: *
```

#### 2.3 Curiosity's proposed path up Mount Sharp, and the MMGIS data behind it

- The resource page (https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) is **PIA23179, an animated GIF**:
  `https://assets.science.nasa.gov/content/dam/science/psd/mars/downloadable_items/4/42763_PIA23179-combo-rev_main.gif` (200 image/gif, 3,002,192 B, ACAO `*`; LV).
  Credit: NASA/JPL-Caltech/ESA/University of Arizona/JHUAPL/MSSS/USGS Astrogeology. It carries no vector data.
- The MMGIS map at https://mars.nasa.gov/maps/location/?mission=Curiosity is driven by
  `https://mars.nasa.gov/maps/location/api/configure/get?mission=Curiosity` (JSON, LV). That config lists the following layers, all ACAO `*` (LV):

| Layer | URL | Content |
|---|---|---|
| Rover path | `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json` | GeoJSON, 1,317 LineString/MultiLineString features with z, `Length` in m; 1.36 MB |
| Waypoints | `…/json/MSL_waypoints.json` | GeoJSON, 1,389 points: `sol`, `site`, `drive`, `RMC`, `lon`, `lat`, `elev_geoid`, **`roll`, `pitch`, `tilt`**, `dist_total_m`; 665 KB |
| Current position | `…/json/MSL_waypoints_current.json` | 1 point: sol 5073, RMC 125_2490, (137.3889, -4.8260), tilt 12.45°, 38.6 km driven |
| Surface view | `…/json/MSL_SurfaceSites.json` | 4 named site polygons (e.g. "Dingo Gap", "Mary Anning & Groken Drill Sites") |
| Basemap | `…/Layers/MSL_Gale_HiRISE-LRGB_78quads/{z}/{x}/{y}.png` | **HiRISE colour, TMS z10–18** (z18 = 0.32 m/px); bbox 137.327–137.479 E, -4.876 to -4.555 |
| Gale Crater Map | `…/Layers/MSL_CTX_ortho_mosaic_6m/{z}/{x}/{y}.png` | CTX, TMS z6–13 |
| Labels | `…/Layers/MSL_WebGIS_PlaceText/{z}/{x}/{y}.png` | place names, z4–17 |

- Both JSON files had `Last-Modified: Fri, 13 Nov 2026`, so they are refreshed as the rover drives.
  Tiles are TMS, with y flipped: `y_tms = 2^z - 1 - y_xyz`. The projection is Leaflet's default spherical Mercator (config `projection.custom: false`) (LV).
- Auth: none. No rate-limit headers. JSON is served with `access-control-max-age: 3000` (LV).

```sh
curl -s 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json'
# 200 application/json, 665,124 B, FeatureCollection with 1,389 Points; last one sol 5073. ACAO: *
curl -s 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/18/231123/127645.png'
# 200 image/png, 144 KB, 256x256 RGBA colour HiRISE at (137.4, -4.7); individual boulders visible. ACAO: *
```

#### 2.4 NASA Worldview (https://worldview.earthdata.nasa.gov/)

Worldview is a client over NASA GIBS. The GIBS EPSG:4326 capabilities document (5.3 MB) has 3,950 identifiers,
no occurrence of "Mars", and only `CRS84` (LV: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml`, ACAO `*`).
It is worth copying as an architecture: static WMTS tile pyramids on a CDN with ACAO `*`, plus one JSON layer catalogue (`/config/wv.json`) that drives the UI.

#### 2.5 Mars Perseverance raw images (https://mars.nasa.gov/mars2020/multimedia/raw-images/), and the Curiosity equivalent

Perseverance is at Jezero, so only the API pattern carries over. For Gale, use the **MSL** API.

**Mars 2020** (docs: page bundle `https://mars.nasa.gov/js/raw-images/m20/static/js/main.1a396d7e.chunk.js`; LV):
`https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&ver=1.2&num=<n>&page=<p>&order=sol desc&search=|NAVCAM_LEFT&condition_2=<sol>:sol:gte&condition_3=<sol>:sol:lte`
- Quirk: `condition_1=…:sol:gte` is **silently ignored**. The web app moves the sol bounds to `condition_2` and `condition_3` (LV).
- The response has `total_results` and `total_images` (1,055,868), plus `images[]` with `image_files.{small,medium,large,full_res}`, `camera.instrument`,
  the CAHVORE camera model, `extended.{mastAz,mastEl,xyz,dimension}`, `site`, `drive`, `attitude` and `credit` ("NASA/JPL-Caltech").
  Headers were ACAO `*` and `cache-control: max-age=60`.
- The bundle also references bulk zips `/download_all/all_raw_images_{0..7}.zip`; not checked.

**Curiosity / MSL** (docs: `https://mars.nasa.gov/assets/public_manifest-7200d3ca….js`; LV):
`https://mars.nasa.gov/api/v1/raw_image_items/?order=sol desc&per_page=<n>&page=<p>&condition_1=msl:mission&condition_2=<sol>:sol:gte&condition_3=<sol>:sol:lte&search=NAV_LEFT_B|NAV_RIGHT_B`
- Condition indices are sequential here (`condition_N` with `:sol:gte`, `:sol:lte`, `:date_received:gte`, `:sol:in`).
  The response is `{items[], more, total, page, per_page}`. Items carry `imageid`, `sol`, `instrument`, `https_url`, `site`, `drive`, `xyz`,
  `extended.{mast_az,mast_el,sample_type}`, `date_taken` and `image_credit`. Headers were ACAO `*` and `cache-control: max-age=120`.
- **Join to the map:** Navcam items on sol 5073 have `site` 125 and `drive` 2490, which equals waypoint `RMC` "125_2490" (LV). That gives every photo a lat/lon.
- Image files on `mars.nasa.gov/msl-raw-images/…` and `…/mars2020-raw-images/…` return 200 `image/jpeg` with **no ACAO**, even with an Origin header (LV).
  They work in `<img>`, but canvas or WebGL pixel access needs a proxy.
- Not working: `extended=sample_type::full` returned 0 items (syntax unknown).
- Auth: none. No rate-limit headers (LV).

```sh
curl -sG 'https://mars.nasa.gov/api/v1/raw_image_items/' --data-urlencode 'order=sol desc' --data-urlencode 'per_page=2' --data-urlencode 'page=0' \
  --data-urlencode 'condition_1=msl:mission' --data-urlencode 'condition_2=5070:sol:gte' --data-urlencode 'search=NAV_LEFT_B|NAV_RIGHT_B'
# 200 application/json, 3.5 KB, total 720; item sol 5073 NAV_LEFT_B, site 125, drive 2490, https_url …/NLB_847853302EDR_F1252490NCAM00354M_.JPG. ACAO: *
```

### 3. Gaps: adjacent sources the objectives need

| Need | Source and endpoint | Finding |
|---|---|---|
| **Slope / DEM as COG** | USGS Astrogeology STAC: `https://stac.astrogeology.usgs.gov/api/collections/mro_hirise_socet_dtms/items?bbox=137.35,-4.75,137.45,-4.65` | 5 HiRISE DTMs over the focus at about 1.01 m gsd, each with `dtm` and `hillshade` **cloud-optimised GeoTIFF** assets on `astrogeo-ard.s3-us-west-2.amazonaws.com`. A Range GET returned **206 with ACAO `*`** (156 MB file), so a browser can read windows directly with geotiff.js. Licence CC0-1.0 (LV). |
| **HiRISE DTM / CRISM search** | PDS Geosciences ODE REST: `https://oderest.rsl.wustl.edu/live2/?query=product&target=mars&ihid=MRO&iid=HIRISE&pt=DTM&westernlon=137.35&easternlon=137.45&minlat=-4.75&maxlat=-4.65&results=fp&output=JSON` | ACAO `*`. Returns the same 5 DTMs, with PDS `.IMG` and ortho `.JP2` URLs on hirise.lpl.arizona.edu (no ACAO, 0.3–0.8 GB each). **CRISM:** with `iid=CRISM`, `pt=MTRDR` gives 11 products and `pt=TRDR` gives 741 for the same box (`results=c`). `pt` is mandatory (LV). |
| **Atmosphere / surface temperature / UV** | REMS daily weather: `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` | ACAO `*`, 1.7 MB, 4,745 sols. Latest is sol 4995 (2026-08-25), with min/max air and ground temperature, pressure, `local_uv_irradiance_index` and opacity. Humidity and wind are "--" (LV). |
| **Radiation** | MSL RAD in PDS PPI: `https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/` | An Apache listing; the newest folder is `DATA/SOL_04710_04843/` (2026-07-29), so the archive is about 6 months behind. ASCII "Level 1A" calibrated records per the RDR SIS (LV via `AAREADME.TXT`). There is **no ready dose-rate JSON**, so dose needs processing or a literature constant. |
| **Space weather** | NASA DONKI: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/CME?startDate=…&endDate=…` (keyless) or `https://api.nasa.gov/DONKI/CME?...` | The kauai host **timed out on connect** from this network (unverified). api.nasa.gov answers 403 `API_KEY_MISSING` with ACAO `*`, so it needs a key; keep the key server-side (LV). |
| **Geology at walking scale** | PGM "Aeolis Mons" 1:60K | Listed as "In Progress", with no service (LV, §2.2). |

### 4. Recommended ingestion approach

1. **Build time (Python, like `trek.py`), committed as static files:**
   - The Trek layer manifest from `searchItems` and `getLayerServices`. These send no ACAO, so the browser can't call them.
   - SIM 3292 unit polygons clipped to the Gale bbox, as GeoJSON.
   - A REMS weather JSON trimmed to the needed columns.
   - CRISM and DTM footprints from ODE or STAC.
   - Any RAD summary.
2. **Build time, slope:** read the route corridor from the 1 m DEM. Use either a STAC COG window or ImageServer `exportImage` chunks (≤15000x4100 px F32).
   Compute slope and hazard classes, then publish small PNG tiles or a COG. Ship a precomputed corridor even though the browser could read COGs live.
3. **Live in the browser** (all LV with ACAO `*` or an echoed Origin):
   - Trek WMTS tiles (HiRISE z16, CTX, THEMIS).
   - MMGIS HiRISE colour tiles (z18).
   - `MSL_waypoints_current.json` and `MSL_traverse.json`.
   - The MSL raw-image API, for photos at a clicked waypoint via `site`/`drive` ↔ `RMC`.
   - ImageServer `identify` for point heights.
4. **Proxy only for:**
   - Trek search, abstract and elevation-profile endpoints.
   - Raw-image files, but only if pixels are read in canvas or WebGL (`<img>` is fine).
   - api.nasa.gov, so the key never ships to the browser.
5. **Be polite:** no service advertised rate limits.
   - Cache tiles in a service worker.
   - Honour `cache-control` (raw API 60–120 s, MSL images 36000 s).
   - Debounce `identify` calls.
   - **Never** hit Trek `data/stream` from the app (multi-GB, Range ignored).

### 5. Open questions / not verified

- **Trek HiRISE mosaic native resolution and DEM vertical datum.** Trek metadata is placeholder.
  The DEM value -4285 m at (137.4, -4.7) is close to a MOLA profile value of -4286 m about 0.6 km away, which suggests areoid heights. Not confirmed.
- **MMGIS tile georeferencing.** Spherical Mercator was inferred from config, and the tile at the computed index showed plausible terrain. It was not checked against a known feature.
- **Login-gated Trek tools** (path, rock detection, slope, subset) were not evaluated. No ready rock-abundance product for Gale was found.
  Obstacle detection will have to come from 0.3 m HiRISE imagery or a DEM-roughness proxy.
- **RAD dose rate.** Deriving it from the RDR files needs the SIS (`DOCUMENT/RAD_RDR_SIS.PDF`), which was not read.
  Literature values (e.g. Hassler et al. 2014, Science, doi:10.1126/science.1244797) were not re-checked here.
- **DONKI keyless endpoint** was unreachable from this desktop. Retry from another network.
- **STAC CTX DTM search** (`mro_ctx_controlled_usgs_dtms`) reported 3,932 matches for a 0.1° box. The bbox filter looks broken for that collection.
- **Trek `Gale_HRSC_DEMi_25m`** is listed in `https://trek.nasa.gov/tiles/Mars/rasters/eq/list.json`, but its ImageServer returns "not found" (LV).
- **Licensing pages** could not be fetched: USGS copyrights (403), JPL image-use policy (403), and HiRISE usage (404 at uahirise.org/usage.php). The NASA media guideline was verified.
- **Chemistry** (APXS/ChemCam in PDS Geosciences) was not investigated.
- **MSL raw API:** the `extended=` filter syntax is unknown, and the `/api/v1/raw_image_items/msl/latest/` endpoint seen in the bundle was not called.
