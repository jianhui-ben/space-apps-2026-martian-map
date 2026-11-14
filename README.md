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

## Our project: Mars data center site investigation

We are focusing the challenge on one question: where on Mars could a future
data center be built, and what would astronauts need to check on the ground
to find out? The full plan is in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).

In short, we will build a map based on NASA data. It will help astronauts
compare candidate sites for a modular computing and data-storage facility
that supports an established, hypothetical Mars base. Its services include
base operations, scientific processing, robotics support, archives and
optional AI workloads. The first version of the map covers five connected
factors:

1. **Buildable terrain:** usable area, slope, roughness and obstacles for the whole facility layout.
2. **Ground and ice evidence:** geological units, loose deposits, buried ice and what would need probing.
3. **Solar conditions:** illumination, terrain shadows, seasons and dust effects on power.
4. **Thermal conditions:** observed surface temperatures and where cooling equipment could go.
5. **Investigation routes:** routes from the base, measurement stops and return options.

The goal is an evidence-backed comparison of the sites and a practical
investigation plan: where to go, what to measure and which uncertainties each
measurement could resolve. Every layer will separate observations from
estimates, models and assumptions. Sites are compared by which requirements
they meet, which they fail and which questions are still open, not by a single
averaged score. The facility's size, power, cooling and other requirements
are still assumptions, and no ranking thresholds have been agreed yet. Site
suitability also does not show that a Mars data center would be commercially
viable.

### Requirement documents

| Document | What it covers |
|---|---|
| [Project plan](docs/PROJECT_PLAN.md) | Objective, scenario, the five factors and shared evidence rules |
| [Reference facility](docs/REFERENCE_FACILITY.md) | Assumed base, workloads, 60/150/250 kW IT load, power, cooling and layout |
| [Buildable terrain](docs/BUILDABLE_TERRAIN_REQUIREMENTS.md) | 21 metrics (BT-01 to BT-21): area, slope, roughness, obstacles, hazards, access |
| [Ground and ice](docs/GROUND_AND_ICE_REQUIREMENTS.md) | 12 metrics (GI-01 to GI-12): bearing capacity, settlement, ice, excavation |
| [Solar conditions](docs/SOLAR_CONDITIONS_REQUIREMENTS.md) | 13 metrics (SC-01 to SC-13): shading, energy output, dust, storage, array layout |
| [Thermal conditions](docs/THERMAL_CONDITIONS_REQUIREMENTS.md) | 12 metrics (TC-01 to TC-12): heat rejection, cold protection, radiators |
| [Investigation routes](docs/INVESTIGATION_ROUTES_REQUIREMENTS.md) | 14 metrics (IR-01 to IR-14): stop purpose, mobility, time, consumables, contingencies |
| [Metric data availability](docs/reference/METRIC_DATA_AVAILABILITY.md) | Which of the 72 metrics can be estimated from existing data and which need fieldwork |

Each metric has a baseline and an ideal target. All the numbers are proposed
project targets or depend on engineering designs not yet defined. None of
them is a NASA standard.

## What this repo does today

- `martian_map.trek`: a small client for Mars Trek's public, key-less WMTS tile services. It reads a layer's capabilities, checks the tile grid, and downloads the tile that covers a given point. Three layers are built in, one per data kind:
  - `viking`: Viking MDIM 2.1 color mosaic, 232 m/px (optical)
  - `mola`: MGS MOLA color shaded relief, 463 m/px (topographic)
  - `themis`: Mars Odyssey THEMIS daytime IR mosaic, 100 m/px, latitudes ±65° (thermal)
- `martian_map.geo`: pure helpers. Longitude normalisation, great-circle distance on Mars, and conversion between lat/lon and Mars Trek tile/pixel coordinates.
- `martian_map.traverse`: pure helpers for a simple Marswalk plan. It computes leg distances, average slopes, a slope hazard class (`ok` / `caution` / `avoid`), the walking time and a range check.
- A CLI (`python -m martian_map`) that ties these together, including a `demo` at lower Mount Sharp in Gale crater.

> The traverse model is a transparent starting point, not a validated planning
> tool. It uses the average slope between waypoints, and the demo route's
> elevations are illustrative placeholders. They are not DEM samples.

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
│   └── trek.py          # Mars Trek WMTS client (injectable HTTP session)
├── tests/               # pytest suite + recorded WMTS capabilities fixtures
├── data/                # downloaded tiles and caches (not committed; see data/README.md)
├── docs/                # project plan, requirement specs, reference facility, data-source notes
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

The challenge page notes that NASA does not endorse non-U.S. Government
entities. Participants must follow each third-party site's own data-use terms.

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
