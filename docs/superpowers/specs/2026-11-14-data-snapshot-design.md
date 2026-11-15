# Data snapshot and catalog: design (revision 2, aligned with PROJECT_PLAN.md; approved 2026-11-14)

Date: 2026-11-14. Deadline: NASA Space Apps closes 2026-11-15, 23:59 local time. Team: two people.

Revision 2 replaces the first version, which was built around an astronaut *walk* on Curiosity's path.
The team's [project plan](../../project-plan.md) changed the goal to **comparing candidate sites for a
Mars data center near an assumed base**. The team chose **Gale crater** as the base region.

## Why

The app is a data-heavy web map. For candidate sites near an assumed base at Gale, it shows evidence on
the plan's five factors:

1. buildable terrain;
2. ground and ice;
3. solar;
4. thermal;
5. investigation routes.

It also shows how sure we are about each one. The runtime code needs one place to look up every
dataset: what it is, where the file is (or its live web address), how to read it, what area it
covers and **what kind of evidence it is**. The owner isn't a space expert, so the docs must be
plain-language.

## Goals

1. **One command, `python -m martian_map snapshot`,** downloads or computes every dataset marked
   *local* into `data/`, for the areas defined in the scenario file.
2. **`data/catalog.json`, committed,** indexes every data source: local, live (loads from the web as
   the map moves) and not used (with the reason). Every entry carries the plan's evidence labels (see
   *Catalog format*).
3. **`scenario/gale.json`, committed and hand-edited by the team,** holds every **assumption**: base
   location, candidate sites, placeholder facility footprint, mobility limits and any thresholds. Each
   value is marked as an assumption. The snapshot reads its areas from this file.
4. **A Python helper, `martian_map.catalog`,** loads the index, looks entries up and searches them by
   words, factor, category or area. The web app reads the same JSON directly.
5. **The two data docs are rewritten in plain language and organised around the five factors:**
   `docs/data-sources.md` covers what data we have and what it can and can't tell us;
   `docs/data-extraction.md` covers how we get it and how to refresh it.

## Non-goals

- Downloading map imagery tiles (option A, already decided): imagery stays live and is listed in the
  catalog.
- Suitability scores, site ranking, layout-fit checks or route-finding. These are analysis that runs on
  top of this data, and the plan says thresholds aren't agreed yet.
- Communications: listed as `not_used` (line of sight comes from our elevation plus design inputs).
  *Update 2026-11-15:* radiation (RAD) and space weather (DONKI) were first non-goals. The requirement
  metrics (IR-12) later asked for them, so both are now fetched (`radiation_rad`, `space_weather_donki`).
- The Curiosity photo index. It's not needed by the five factors, so it's an optional later item.
- A database, server or proxy. Committing downloaded data: `data/` stays git-ignored except
  `catalog.json` and `README.md`.

## Anti-goals

- **Hiding the kind of evidence.** For example, presenting a computed slope or a climate model as if
  it were a measurement, or calling a flat area "solid ground". (Plan: "Every layer must distinguish
  observations, derived estimates, models, and scenario assumptions.")
- **Missing data shown as "fine".** A dataset with no coverage at a site must say so (plan: "Missing
  evidence must not automatically mean safe or unsuitable").
- **Baking thresholds into the data.** The snapshot outputs plain measurements such as slope degrees
  and roughness metres, never good/bad classes.
- **Hammering NASA servers:**
  - no bulk downloads or crawling;
  - never Trek's `data/stream` (multi-GB, ignores byte ranges);
  - at most ~1 request per second per host.
- **A catalog that drifts from the files, or any API key in the repo or in `data/`.**

## Constraints

- Python 3.9. The only new dependency is `numpy`.
- Every request has a timeout and a size cap, uses a host allowlist, doesn't follow redirects and
  verifies TLS. This is the same pattern as `src/martian_map/trek.py`.
- Re-runs skip a file that exists locally and matches its catalog hash, with no network call.
  `--refresh` fetches everything again, and `--only <id,...>` fetches chosen datasets. A failed dataset
  is recorded with `status: "failed"` and the error; the run carries on, then exits non-zero.
- Tests use the existing `FakeSession` pattern, with `@pytest.mark.network` for live tests.

## Approach

A `snapshot` command inside the existing Python package. Each dataset is a small fetch-or-compute step
plus its catalog entry, written together so the files and the index can't drift apart. A shell script
or a notebook was considered and rejected: the catalog would drift, and the result would be hard to
re-run and test.

## Areas (all in `scenario/gale.json`)

| Area | Box (lon °E, lat °) | Purpose |
|---|---|---|
| `gale_region` | 136.0 to 139.0, -6.5 to -3.5 (~180 km square) | Whole crater, its rim and Mount Sharp. Used for horizons and shadows, and for coarse maps (geology, thermal inertia). |
| `study_area` | 137.122 to 137.730, -4.925 to -4.249 (~36 × 40 km) | Exactly where Trek's 1 m elevation model exists. Used for **screening layers** at 10 m, to find and compare sites. |
| `base` *(assumption)* | point 137.4416, -4.5895 | Curiosity's landing spot (Bradbury Landing, first waypoint). It sits inside a landing area NASA already judged safe. Placeholder until the team decides. |
| `sites[]` *(assumption)* | 2–3 boxes of about 2 × 2 km | Candidate sites, each with full 1 m detail. **The team picks them after the screening layers exist.** Until then the file holds one placeholder: the Curiosity recent-path box (137.362–137.414, -4.843 to -4.766), chosen because it has the most ground truth. |

The facility footprint, slope and roughness limits, and walking or driving speed are in the scenario
file as clearly marked placeholders. Nothing in the snapshot depends on their values.

## Datasets, by factor

Evidence types follow the plan. Each dataset gets **one** primary type *(our call)*, plus an optional
`evidence_note`:
- **observation:** measured;
- **derived:** computed from observations, such as an elevation model from stereo photos, or slope;
- **model:** a simulation such as a climate model;
- **interpretation:** a map someone drew from observations, such as geologic units or mineral
  detections;
- **assumption:** from the scenario file;
- **reference:** context only, not evidence (labels, place names, map indexes).

`local` means stored in `data/`; `live` means listed in the catalog only, and the app loads it.

### 1. Buildable terrain

| id | Plain meaning | Evidence | Access | Source | Size (est.) |
|---|---|---|---|---|---|
| `elevation_10m_study` | Ground height every 10 m across the study area | derived | local | Trek ImageServer `Gale_DEM_SMG_1m`, exportImage resampled to 10 m (`format=bsq`, F32, ≤4100-row chunks) | ~58 MB |
| `slope_10m_study` | Steepness (degrees) every 10 m, for screening | derived | local + PNG overlay | computed from the above | ~58 MB |
| `elevation_1m_<site>` | Ground height every 1 m at each site | derived | local | the same ImageServer at full resolution | ~16 MB per site |
| `slope_1m_<site>`, `roughness_1m_<site>` | Steepness, and bumpiness (metres) left after removing the overall tilt in a 5 × 5 m window | derived | local + PNG overlays | computed | ~16 MB each |
| `dune_fields` | Mapped sand-dune fields (loose ground) | interpretation | local (gale_region) | Trek `Dune_Field` MapServer | small |
| `imagery_hirise_color` / `_gray`, `imagery_ctx` | Photo maps (0.32 m / 0.64 m / ~6–10 m) | observation | live | MMGIS TMS / Trek WMTS | — |

Each grid records its **smallest resolvable feature**. The 1 m elevation model can't show rocks smaller
than a few metres, and the docs and catalog say so. No rock-abundance product was found for Gale
(Trek search, 2026-11-14), so that's a listed gap.

### 2. Ground and ice

| id | Plain meaning | Evidence | Access | Source |
|---|---|---|---|---|
| `geology_units` / `_contacts` / `_structures` | What the rock is, from the global geologic map (1:20M, very coarse) | interpretation | local (gale_region) | USGS SIM 3292 FeatureServer 1–3 |
| `geology_map_index` | Which geologic maps cover the study area (the 1:60K Mount Sharp map is unfinished) | reference | local | USGS PGM index |
| `minerals_detections` | Places where orbiters saw water-related minerals | interpretation | local (gale_region) | Trek `Hydrous_Mineral_Detections_CRISM_clon0` |
| `thermal_inertia_tes` | How quickly the ground heats and cools; low values hint at loose dust or sand, high at rock (~3 km grid) | derived | local if the PDS TES `TIMAP` product parses cleanly, otherwise live picture tiles | ODE `MGS TES TIMAP`; Trek `TES_Thermal_Inertia` tiles |
| `rover_path`, `rover_stops` | Ground Curiosity actually drove over: real evidence the ground supports a 900 kg rover | observation (ground-validated) | local | MMGIS `MSL_traverse.json`, `MSL_waypoints.json` |
| `ice_swim` | Subsurface ice evidence | derived | **pending** | swim.psi.edu returned error 523 four times on 2026-11-14, the last at 23:48 UTC. Still pending, with that reason. Coverage at Gale is unverified (it's near the equator, so likely none). |

### 3. Solar

| id | Plain meaning | Evidence | Access | Source |
|---|---|---|---|---|
| `elevation_463m_region` | Coarse ground height for the whole crater, used to work out which hills block the sun | derived | local | Trek ImageServer `mola128_mola64_merge_90Nto90S_SimpleC_clon0` |
| `horizon_<site>` | How high the skyline is in every direction (360 values) at **every point of a 100 m grid** across each site *(our call)*, enough to map shadows at 100 m | derived | local | computed from `elevation_463m_region` plus the site's 1 m elevation |
| `sun_table_<site>` | Where the sun is in the sky at each site, every 15° of season (Ls) × every 30 min of local time, plus whether the skyline blocks it | model (standard formula) + derived | local, computed *(our call)* | Python port of the Mars24 algorithm (Allison & McEwen 2000; the builder cites the primary source and tests against its worked example). The browser just reads the table and needs no astronomy code. |
| `weather_rems` | Curiosity's daily sunrise/sunset, UV level and sky-clearness note, with season (Ls) | observation (ground) | local | REMS JSON |
| `dust_climate_mcd` | Typical dust in the air and sunlight on the ground by season | model | local, **done** 2026-11-15 | Mars Climate Database web interface: every hour of 24 seasons at the base, 4 dust cases |
| `surface_dust_tes` | How dusty the surface is (dust cover index) | derived | live tiles | Trek `tes_ruffdust`, `TES_Dust` |

### 4. Thermal

| id | Plain meaning | Evidence | Access | Source |
|---|---|---|---|---|
| `weather_rems` (shared) | Daily min/max air and ground temperature and air pressure at Curiosity, by season. Wind and humidity are missing. | observation (ground) | local | REMS JSON |
| `themis_temperature_list` | List of the ~100 orbiter temperature images over the study area, each with season (Ls) and local time | observation (metadata) | local | ODE `ODY THEMIS IRPBT2` |
| `themis_temperature_samples` | 4 of those images (day/night × two seasons), cropped to the study area | observation | local, **must-have** (owner decision 2026-11-14) | ODE product files (~11 MB each before cropping) |
| `thermal_day` / `thermal_night` | THEMIS day/night maps. These are **pictures only**, with no temperature numbers. | observation (qualitative) | live | Trek THEMIS WMTS |
| `temperature_climate_mcd` | Typical surface and air temperature by season and time of day | model | local, **done** 2026-11-15 | Mars Climate Database (same query; no below-ground temperatures in the service) |
| `thermal_inertia_tes` (shared) | see factor 2 | | | |

### 5. Investigation routes

| id | Plain meaning | Evidence | Access | Source |
|---|---|---|---|---|
| `scenario` | Base, sites, footprint, mobility limits | assumption | committed file | `scenario/gale.json` |
| `slope_*`, `roughness_*` (shared) | Terrain a route must cross | derived | local | above |
| `rover_path` (shared) | A proven drivable line | observation | local | above |
| `named_sites` | Named places at Curiosity's sites | reference | local | MMGIS `MSL_SurfaceSites.json` |
| `labels` | Place-name labels | reference | live | MMGIS label tiles |
| `elevation_point_service` | Height at any clicked point | derived | live | Trek ImageServer `identify` |

### Not used (catalog entries with reasons)

- **Later factors in the plan:** communications. (Radiation and space weather were here, and are now
  fetched for IR-12: see the update under Non-goals.)
- **Optional later:** Curiosity photo index.
- **Other reasons:**
  - Perseverance photos: wrong site.
  - Worldview: Earth only.
  - USGS 1:60K Mount Sharp map: unfinished.
  - Trek login-only tools.
  - Trek `data/stream`: multi-GB.
  - NASA route animation: a reference image only.

## Catalog format (`data/catalog.json`)

Generated by `snapshot` and never hand-edited; the file starts with a note saying so. Top level:
`version`, `generated_at`, `scenario_file`, `areas`, `datasets[]`. Each dataset has:

- **Basics:**
  - `id`, `title`, `summary` (one plain sentence);
  - `factors[]` (terrain / ground / solar / thermal / routes);
  - `category`, `tags[]`;
  - `access` (local / live / computed / not_used / pending), `status` (ok / failed / not_downloaded),
    `reason`.
- **Evidence** (the plan's shared requirements):
  - `evidence_type` (observation / derived / model / interpretation / assumption);
  - `ground_validated` (bool plus a note);
  - `resolution_m`, `smallest_feature_m`, `positional_accuracy` (or "unknown");
  - `observation_time` (date range, season Ls range, local time where relevant);
  - `uncertainty` {`value`, `unit`, `basis`} *(our call)*: for example the elevation model's vertical
    precision, taken from source metadata or a cited paper, otherwise `"unknown"`. Slope and roughness
    carry a **noise floor** computed from it. Roughness below the noise floor is marked as not
    distinguishable from noise;
  - `coverage` {`bounds`, `gaps`}. `gaps` is **computed** from each grid's no-data mask (the fraction
    and the bounding boxes of the holes), not written by hand *(our call)*;
  - `alignment`: results of the alignment checks below;
  - `limitations[]`, plain sentences such as "pictures only, no temperatures" or "can't see rocks
    under ~3 m".
- **`files[]`:** `path`, `format`, `bytes`, `sha256`. Grids also carry `grid` {`width`, `height`,
  `bounds` [W,S,E,N], `pixel_deg`, `dtype`, `byte_order`, `nodata`, `crs`}. Overlays carry `bounds`
  and `legend`.
- **`live`:** `url_template`, `scheme` (wmts-eq / tms-webmercator / arcgis / json-api), `min_zoom`,
  `max_zoom`, `cors`.
- **`source`:** `name`, `page_url`, `request_url` (with any key removed), `fetched_at`, `as_of` (for
  example the latest sol), `credit`, `license`.

`crs` records each dataset's coordinate system. Trek data is equirectangular on the 3,396.19 km Mars
sphere (wkid 104905); MMGIS tiles are Web Mercator.

**Alignment checks** *(our call)*. The plan says to check alignment before combining layers, so
`snapshot` runs these checks and records them in the catalog:
- **1 m elevation model vs Curiosity's own heights** at waypoints inside the study area (`elev_geoid`):
  median offset and spread;
- **regional 463 m model vs 1 m model** over their overlap: median offset.

On a mismatch the snapshot doesn't silently fix anything. It records the offset and flags it. The
horizon step, the only place that merges the two models, shifts the regional model by the measured
offset and notes this in its catalog entry.

**Coverage report** *(our call)*. The catalog has a `coverage_report` table: for every area (study
area and each site) × dataset, it records the fraction covered and the resolution. The screening step
also writes a no-data overlay, so sites are never picked inside a hole. `snapshot` warns when a site
in the scenario file has less than 95% elevation coverage.

Commands:
- `catalog check` reports each file as ok, not downloaded, or different from the catalog. It exits
  non-zero only with `--strict`.
- `catalog search <words> [--factor F]` prints matching entries.

## Computed layers

- **Slope:**
  - uses neighbouring heights;
  - east–west spacing is corrected for latitude, on the 3,396.19 km sphere the elevation model uses
    (`geo.py` keeps its own 3,389.5 km mean radius; the difference is ~0.2%);
  - the 10 m screening slope is smoother than the 1 m slope, and the catalog says so.
- **Roughness:** inside each 5 × 5 m window, remove the best-fit tilted plane and take the standard
  deviation of what's left, in metres. A smooth slope scores 0, so only bumps score high. No threshold
  is applied.
- **Horizon:** at each point of a 100 m grid across a site, scan outward in 360 directions over the
  local and regional elevation models and record the highest angle to the skyline (uint8, 0.25° steps).
  With the sun table, that gives shadows, sunrise and sunset for any season. Shadows from features
  smaller than 100 m apart aren't mapped, and the catalog says so.
- **Overlays:** PNG with bounds and a colour legend, written by a small built-in PNG writer (zlib, no
  Pillow).
- **Data files:** grids are raw little-endian float32 `.f32` files, readable by JS as a
  `Float32Array` and by numpy as `fromfile`.

## Build order (two people, one day)

1. **Index first:** catalog format, `martian_map.catalog`, `scenario/gale.json`, the `catalog`
   commands, and the live and not-used entries. Both of you can build app code against it straight
   away.
2. **Screening:** `elevation_10m_study` and `slope_10m_study` with overlays. Then the team picks
   2–3 candidate sites.
3. **Site detail:** per-site 1 m elevation, slope and roughness with overlays.
4. **Ground:** geology, minerals, dunes, rover path, stops and named sites.
5. **Thermal and solar basics:** REMS, the THEMIS temperature list, `elevation_463m_region`,
   alignment checks, horizons, sun tables, and the 4 THEMIS temperature samples (day/night × two
   seasons, cropped to the study area; includes PDS3 IMG and label parsing).
6. **Docs:** both rewritten around the five factors, with a glossary, and a table generated from the
   catalog between markers.
7. **Stretch, dropped first if late:** the two Mars Climate Database tables, numeric TES thermal
   inertia, the SWIM retry. *Status 2026-11-15:* the MCD tables are done. Numeric thermal inertia comes
   from `thermal_inertia_themis_1km` instead of TES. SWIM is still unreachable.
8. **Added for the requirement metrics (2026-11-14), done 2026-11-15:**
   - measured dust (`optical_depth_history`, `dust_extinction_navcam`);
   - radiation (`radiation_rad`, `space_weather_donki`);
   - moving sand (`dune_change_imagery`);
   - the 2 m trip-area grid for route planning.

## Tests

- Unit tests:
  - slope on synthetic planes;
  - roughness is 0 on a plane and positive on bumps;
  - horizon on a synthetic hill;
  - the sun table against the Mars24 worked example;
  - the coverage-gap computation;
  - the PNG writer (decode it back);
  - raw float parsing and chunk stitching;
  - key stripping;
  - scenario loading and validation;
  - catalog load, search and check.
- Fetchers tested with `FakeSession`.
- One `@pytest.mark.network` smoke test.

## Left to the builder

- Module layout.
- Rate-limiter details.
- PNG colour ramps.
- Exact zoom ranges, read from capabilities.
- The bsq byte layout: a 4×4 test returned 66 bytes, not 64, so verify against `identify` at a known
  point.
- Parsing PDS3 IMG and labels: THEMIS (must-have) and TES (stretch).
- Whether to keep raw responses next to trimmed ones.

## Follow-ups (not this work)

- Analysis on top of this data:
  - does the facility layout fit;
  - requirements met and failed per site;
  - route options from the base;
  - illumination over time.
- Move the CLI demo route into the study area.
- Hosting: which small `data/` files the web app must ship.
