# Martian Map: Interplanetary Survival Guide (NASA Space Apps 2026)

A starter toolkit for the NASA Space Apps Challenge 2026 challenge
[Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).
It pulls public Mars map layers from NASA/JPL **Mars Trek** and adds small,
tested helpers for planning a "Marswalk" route.

## The challenge

From the challenge page (difficulty: Intermediate; topics: Human Exploration,
Mars, Planets & Moons, Software, Space Exploration):

> Your challenge is to create a layered, integrated view of a location or route
> on the Martian surface that pulls together data from multiple NASA science
> missions and could help a human explorer plan and carry out a successful
> Marswalk while conducting new and exciting science along the way.

The page explains that NASA's Mars data paints a detailed picture of the
planet, but it is not yet layered together for planning specific human
missions. Tools like JPL's Mars Trek and the USGS-NASA Planetary Geologic
Mapping Program work well for regional and global views. They are not built
for the hyperlocal areas an astronaut will cover on a single surface
excursion.

### Goals (from the challenge objectives)

- Build a map, tool or interface that a Mars astronaut could use during a surface exploration mission, using NASA data and tools.
- Choose science goals and a location. The page's example: boxwork formations, which Curiosity studied in 2025 in the Mount Sharp region.
- Consider layering or combining at least three kinds of data. The page lists optical, thermal, spectral, topographic, geophysical, atmospheric, radiation and chemical as examples.
- Put astronaut safety first. That includes the radiation and space-weather environment, and the reduced mobility of a suited crew carrying equipment.
- If possible, include a route map that reaches the science targets while avoiding significant obstacles such as large rock formations.

Optional considerations from the page: the display could live in the habitat,
on a tablet, or on a helmet heads-up display (HUD). The map can be static,
interactive, or a generator for many sites. You can borrow ideas from Earth,
Moon and planetary maps. You can pick a past, future or no specific time
frame. You can add point-of-view imagery from surface missions. You can also
plan for rovers or for crews working in pairs.

## Our project: computing infrastructure for Mars construction

Help construction owners identify feasible locations for the data center their Mars project may need. Owners describe what they are building, their robot fleet, work schedule, and required map/inspection turnaround. They do not need to specify server counts or facility dimensions.

**Construction project inputs → estimated data-center specifications → requirements for five Mars location assessments.**

The planned estimator will translate activities into shared computing and storage demand, equipment, power, cooling, and physical layouts. The map will compare each option against buildable terrain, ground and ice evidence, solar conditions, thermal conditions, and investigation routes. Results distinguish requirements met, failed, and unresolved, with traceable assumptions and evidence.

Gale crater is the demonstration region. The construction project, base, and facility are hypothetical. A smaller installation inside the base remains a valid outcome. Site conditions may change power/cooling layouts and require reassessment.

**Today:** the repository supplies Mars datasets, derived terrain/solar layers, and evidence mappings. **Planned:** construction intake, sizing algorithm, automatic location requirements, and integrated assessment. The existing numerical facility is an illustrative comparison case, not a computed requirement.

### Requirement documents

| Document | What it covers |
|---|---|
| [Project plan](docs/project-plan.md) | Objective, scenario, the five factors and shared evidence rules |
| [Construction inputs](docs/construction-project-inputs.md) | Owner inputs, unknowns, and example scenario |
| [Sizing script design](docs/construction-sizing-script-design.md) | UI field formats, JSON contracts, sizing stages, and feasibility handoff |
| [Data-center sizing](docs/data-center-sizing.md) | Planned estimation method, assumptions, and validation |
| [Facility-to-location requirements](docs/facility-to-location-requirements.md) | Traceability from facility outputs to five assessment categories |
| [Reference facility](docs/reference-facility.md) | Legacy numerical comparison case; not estimator output |
| [Design guidance](docs/design-guidance.md) | Visual and writing conventions for the ARES site-planning app: colors, typography, layout, components, copy |
| [Selected guided flow](design-reference/mars-guided-flow.html) | Interactive globe introduction → Guided brief → review; preserves entries when returning to the globe; sizing is not connected |
| [Intake comparison](design-reference/mars-construction-intake.html) | Earlier Guided brief / Project worksheet alternatives; Guided brief selected |
| [Earlier design reference](design-reference/mars-copy-balance.html) | Historical landing-page copy comparison; visual reference only for the former population/research intake |
| [3D map prototype](design-reference/map-prototype/) | 3D map prototype in three looks (diorama, survey sheet, helmet HUD) with screenshots, run steps and the map's tech stack (three.js r170, 3d-tiles-renderer 0.5.4, fonts) vendored |
| [Buildable terrain](docs/requirements/buildable-terrain.md) | 21 metrics (BT-01 to BT-21): area, slope, roughness, obstacles, hazards, access |
| [Ground and ice](docs/requirements/ground-and-ice.md) | 12 metrics (GI-01 to GI-12): bearing capacity, settlement, ice, excavation |
| [Solar conditions](docs/requirements/solar-conditions.md) | 13 metrics (SC-01 to SC-13): shading, energy output, dust, storage, array layout |
| [Thermal conditions](docs/requirements/thermal-conditions.md) | 12 metrics (TC-01 to TC-12): heat rejection, cold protection, radiators |
| [Investigation routes](docs/requirements/investigation-routes.md) | 14 metrics (IR-01 to IR-14): stop purpose, mobility, time, consumables, contingencies |
| [Metric data availability](docs/requirements/metric-data-availability.md) | Which of the 72 metrics can be estimated from existing data and which need fieldwork |

Each metric has a baseline and an ideal target. All the numbers are proposed
project targets or depend on engineering designs not yet defined. None of
them is a NASA standard.

## What this repo does today

- **`python -m martian_map snapshot`** downloads or computes every dataset the map needs for the Gale study
  into `data/`, and writes the index [`data/catalog.json`](data/catalog.json). The index labels every layer
  as observation, derived, model, interpretation, assumption or reference, as the project plan requires.
  - Terrain: 10 m screening and 1 m site elevation, slope and bumpiness, sand dunes, and live HiRISE/CTX photo maps.
  - Ground: geologic map, mineral detections, and Curiosity's driven path.
  - Solar: crater-wide elevation, per-site skylines and sun tables.
  - Thermal: four THEMIS temperature images, plus Curiosity's daily weather.
  - Routes: assumptions, place names, and a live height lookup.
- **`python -m martian_map snapshot --scenario scenario/jezero.json`** (or `arcadia.json`) does the same for
  Jezero crater and Arcadia Planitia, for comparison. Their files go in `data/regions/<id>/`, and their entries
  are added to the same index, with ids ending in `__jezero` or `__arcadia`.
- **`python -m martian_map data fetch`** downloads a copy of all the data files (about 780 MB) from the GitHub
  release named in [`data/release.json`](data/release.json), checked against the index, instead of
  re-running the snapshot.
- **`python -m martian_map catalog check|search|table`** inspects the index.
- **[`scenario/gale.json`](scenario/gale.json)** holds the team's assumptions: base, candidate sites and placeholder
  limits. [`scenario/jezero.json`](scenario/jezero.json) and [`scenario/arcadia.json`](scenario/arcadia.json)
  hold the same for the other two regions.
- **[docs/data-sources.md](docs/data-sources.md)** explains what each dataset tells you, and what it can't, in plain
  language. **[docs/data-extraction.md](docs/data-extraction.md)** explains how to fetch, refresh and read it.
- **Older helpers:**
  - `martian_map.trek` is a small Mars Trek tile client;
  - `martian_map.geo` and `martian_map.traverse` are pure coordinate and walking-route helpers;
  - the `layers`, `tile`, `traverse` and `demo` commands use them.

## Setup

Requires Python 3.9+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .          # makes `python -m martian_map` importable
```

No API key is needed. Mars Trek tile services are public. This project does
not read or store any credentials.

## Run

```bash
python -m martian_map layers
python -m martian_map tile --lat -4.72 --lon 137.39 --zoom 7 --layer themis --dry-run
python -m martian_map tile --lat -4.72 --lon 137.39 --zoom 7 --layer viking      # saves into data/tiles/
python -m martian_map traverse --waypoints "-4.70,137.38,-4150;-4.71,137.39,-4120;-4.725,137.40,-3820" --max-range 10
python -m martian_map demo                                                      # live: 3 layers + sample traverse
```

Conventions: latitude is planetocentric. Longitude is east-positive and accepts
any value (for example 137.4 or -222.6). Tiles follow Mars Trek's
equirectangular `default028mm` grid: at zoom `z` the grid has `2^(z+1) x 2^z`
tiles of 256 px each.

Exit codes: `0` on success, `1` on a network or data error, `2` on a usage or
validation error.

### 3D map (`web/`)

The map app is plain ES modules with vendored libraries (three.js r170, NASA-AMMOS
3d-tiles-renderer 0.5.4, Audiowide and Space Grotesk). There is no build step. It needs the
data files in `data/`: fetch them with `python -m martian_map data fetch`, or run the snapshot.

```bash
python3 web/serve.py --data data --port 8770               # http://127.0.0.1:8770/ (binds loopback only)
python3 web/package.py --data data --out web/dist          # static GitHub Pages build, at most 300 MB
```

From another machine, tunnel in with `ssh -L 8770:127.0.0.1:8770 <host>`.

The flow is landing → construction brief → facility (illustrative reference) → location assessment:

- the globe, then each region's priority list and the site cards;
- the factor rows on each site card, with details on demand;
- a draggable facility layout on 1 m HiRISE terrain.

The design is in `docs/superpowers/specs/2026-11-14-site-explorer-map-design.md`, and the look follows
`docs/design-guidance.md`. The browser tests need `pip install -r requirements-web.txt` and
`python -m playwright install chromium`:

```bash
MARTIAN_MAP_DATA=data pytest tests/test_web_map.py tests/test_web_tools.py \
  tests/test_web_package.py tests/test_web_dist.py
```

## Tests

```bash
pytest                    # offline: HTTP is mocked, recorded capabilities live in tests/fixtures/
pytest --run-network      # also runs the live Mars Trek test (marked @pytest.mark.network)
```

## Project layout

```
.
├── src/martian_map/
│   ├── __init__.py
│   ├── __main__.py      # python -m martian_map
│   ├── cli.py           # layers / tile / traverse / demo commands
│   ├── geo.py           # pure coordinate and tile math
│   ├── traverse.py      # pure Marswalk planning helpers
│   ├── trek.py          # Mars Trek WMTS client (injectable HTTP session)
│   ├── http.py          # polite downloader (allowlist, rate limit, size caps)
│   ├── scenario.py      # loads scenario/gale.json
│   ├── catalog.py       # the data index (data/catalog.json)
│   ├── snapshot.py      # runs the data steps and writes the index
│   ├── grids.py, png.py, terrain.py, horizon.py, sun.py, alignment.py, pds3.py, geotiff.py
│   ├── references.py    # who made each dataset (feeds docs/data-references.md)
│   ├── metrics.py       # which requirement metrics each dataset supports
│   └── sources/         # one module per data source (elevation, arcgis, rover, weather, solar, themis,
│                        #   thermal_inertia, water, static)
├── tests/               # pytest suite + recorded WMTS capabilities fixtures
├── data/                # downloaded data (not committed) + catalog.json (committed); see data/README.md
├── scenario/            # gale.json: the team's assumptions (committed)
├── design-reference/    # HTML design mockups; map-prototype/ = 3D map prototype + vendored tech stack
├── docs/
│   ├── project-plan.md          # objective, scenario, five factors, shared evidence rules
│   ├── reference-facility.md    # legacy facility comparison case
│   ├── design-guidance.md       # UI visual and writing conventions
│   ├── data-sources.md          # what data we have, in plain words
│   ├── data-extraction.md       # how the data gets into data/
│   ├── data-references.md       # who made each dataset; NASA / partner / other (for the submission)
│   ├── metric-data-coverage.md  # which datasets feed each of the 72 requirement metrics
│   └── requirements/            # one spec per factor + metric data availability; images/
├── notebooks/           # exploration notebooks (optional)
├── pyproject.toml
├── requirements.txt
└── LICENSE
```

## Data sources

These resources are linked from the challenge's Resources tab:

- [JPL Mars Trek](https://trek.nasa.gov/mars/): NASA's web portal for exploring Mars, with data from various landing sites. This repo uses its public tile services under `https://trek.nasa.gov/tiles/Mars/EQ/`.
- [USGS-NASA Planetary Geologic Mapping Program, interactive Mars maps](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars): a standardized geologic map of Mars.
- [Curiosity's proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/): an example route-map visual for the boxwork example.
- [NASA Worldview](https://worldview.earthdata.nasa.gov/): Earth satellite imagery, linked for inspiration on layered maps.
- [Mars Perseverance raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/): more than a million surface images, useful for point-of-view context.

**Every dataset the map uses, who made it, how to credit it, and which are NASA data:**
[docs/data-references.md](docs/data-references.md). That page is written to be copied into the
submission form's "NASA Data" and "Space Agency Partner Data and Other References" fields.

The challenge page notes that NASA does not endorse non-U.S. Government
entities. Participants must follow each third-party site's own data-use terms.

## Use of AI tools

The data pipeline code in `src/martian_map/`, its tests and the docs were written with an AI coding
assistant (Claude Code by Anthropic), working from the team's plan and decisions. No data values were
generated by AI; every number comes from the sources in [docs/data-references.md](docs/data-references.md)
or is computed from them. See that page for details.

## Team / Author

- [jianhui-ben](https://github.com/jianhui-ben). Add teammates here.

## Next steps / ideas

- **More layers:** add spectral (CRISM), higher-resolution local mosaics (CTX, HiRISE), and a DEM so slopes come from sampled terrain rather than waypoint pairs.
- **Real route planning:** sample elevation along each leg, add a rock-abundance or obstacle layer, and search for a least-cost path that respects suited-crew mobility.
- **Safety overlays:** add radiation and space-weather context, communications line of sight, and a "return to habitat" reserve on every leg.
- **Science targets:** mark boxwork outcrops and other targets on lower Mount Sharp. Link point-of-view rover images (Curiosity, Perseverance) to each waypoint.
- **Display formats:** build a habitat planning view, a tablet view, and a minimal HUD layout.
- **Generalise:** build the same layered view for a second, less-studied site, as the challenge suggests.

## License

[MIT](LICENSE) © 2026 jianhui-ben


### Construction sizing engine

The offline sizing engine now converts a construction brief into conditional equipment, power, heat, reference footprint and ground-load requirements, with a handoff for all five location categories. Run:

```sh
python -m martian_map size --input examples/sizing/construction-brief.json --output /tmp/facility-requirements.json
```

See [the implemented model, assumptions and UI adapter](docs/sizing-model.md). Coefficients remain explicit screening assumptions; `--evidence-only` leaves unvalidated estimates unresolved. This engine does not declare a candidate site feasible.
