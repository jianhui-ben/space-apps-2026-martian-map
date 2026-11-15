# What data we have

This project compares candidate sites for a data center near an imagined future base in **Gale crater** on
Mars (see the [project plan](project-plan.md)), with Jezero crater and Arcadia Planitia for comparison. This page explains, in plain words, every dataset the map
uses: what it shows, what it can't tell you, and where the gaps are.

Everything is listed in one index file, [`data/catalog.json`](../data/catalog.json). The app reads that file to find each
dataset. `python -m martian_map snapshot` downloads the data into `data/` and rewrites the index;
[data-extraction.md](data-extraction.md) explains how. Who made each dataset, how to credit it and which
are NASA data is in [data-references.md](data-references.md). Which datasets feed each of the 72 requirement
metrics (BT, GI, SC, TC, IR) is in [metric-data-coverage.md](metric-data-coverage.md).

## The kinds of evidence

The project plan asks every layer to say what *kind* of evidence it is, so nobody mistakes a guess for a
measurement. Every entry in the index has one of these labels (`evidence_type`):

| Label | Meaning | Example here |
|---|---|---|
| **observation** | Something an instrument measured. | Curiosity's daily temperatures; an orbiter's temperature image. |
| **derived** | Worked out from observations. | Ground height made from pairs of orbital photos; slope computed from height. |
| **model** | A simulation or a formula, not a measurement. | Where the sun is in the sky in each season. |
| **interpretation** | A map a scientist drew from observations. | The geologic map's rock units; sand-dune outlines. |
| **assumption** | Something our team decided. | The base location and the candidate site boxes. |
| **reference** | Context only, not evidence. | Place-name labels; the list of which geologic maps exist. |

Each entry also records how sharp the data is (`resolution_m`), the smallest thing it can show
(`smallest_feature_m`), how sure we are (`uncertainty`), when it was observed (`observation_time`), which
part of each area it covers (`coverage`), whether anyone checked it on the ground (`ground_validated`), and
plain-language `limitations`. The index's `coverage_report` lists, for the study area and every site, how
much of it each dataset covers; for grids this is measured from the file, counting only cells with real values.

## The areas

All areas are set in [`scenario/gale.json`](../scenario/gale.json):

- **Gale region**, about 180 km across: the whole crater, its rim and Mount Sharp (the 5 km-high mountain
  in the middle). It's used for coarse maps and for working out which hills block the sun.
- **Study area**, about 36 × 40 km: the plains where Curiosity landed, plus the lower slopes of Mount Sharp. It
  is exactly the area covered by the sharpest elevation data, so every candidate site must sit inside it.
- **Base**, an assumption: Curiosity's landing spot, inside an area NASA already judged safe to land.
- **Candidate sites**, assumptions: boxes of up to 5 km a side. There are three, each with 1 m heights,
  slopes, bumpiness, a skyline and a sun table:

  | Site | Where | Distance from base | Local pad slope (BT-05, 10 m boxes) | Bumpiness (95% below) |
  |---|---|---|---|---|
  | `near_base_north` | 2 × 2 km of crater floor just north of the base | 0.3–2.5 km | median 2.6°; 97% of boxes within 10°, 81% within 5° | 0.14 m |
  | `near_base_west` | 2 × 2 km just west, crossed by about 1.8 km of Curiosity's 2013 drive | 0.3–2.9 km | median 3.1°; 98% within 10°, 79% within 5° | 0.14 m |
  | `curiosity_recent` | Curiosity's 2025–26 path on Mount Sharp's lower slopes, kept as a hard contrast | 10–13 km | median 11°; 43% within 10°, 12% within 5° | 0.30 m |

  The two near-base boxes were picked on 2026-11-14 by screening the 10 m slope map for flat, dune-free
  crater floor within the reference facility's 1–3 km search distance. They are starting points, not
  approved sites. In `near_base_west` the 1 m heights agree with Curiosity's own to within about 2 m.
- **Trip area**, an assumption: a 3.6 × 4.3 km box around the base and both near-base sites, with heights
  and slopes every 2 m (`elevation_2m_trip_area`, `slope_2m_trip_area`) for planning walking and rover
  routes between them.

## Two more regions: Jezero crater and Arcadia Planitia

To compare Gale with other places, the snapshot also covers two more regions in the same layout. Their
areas are set in [`scenario/jezero.json`](../scenario/jezero.json) and
[`scenario/arcadia.json`](../scenario/arcadia.json), and their files are in `data/regions/<id>/`. Their
entries are in the same index:

- **Ids:** they end in `__jezero` or `__arcadia`, for example `slope_10m_window_jezero_north__jezero`.
  Gale's ids don't change.
- **Region fields:** every entry has `region` (`gale`, `jezero` or `arcadia`) and `dataset` (the id
  without the ending), so the map finds the same kind of layer the same way in every region.
- **Areas:** `areas.regions` lists each region's box, study area, base, sites and trip area.

| | Gale crater | Jezero crater | Arcadia Planitia |
|---|---|---|---|
| Where | 4.6 S, 137.4 E | 18.4 N, 77.5 E | 39.1 N, 193 E (-167 E) |
| Ground | crater floor below Mount Sharp | crater floor east of an old river delta | flat northern lowland plain |
| Base (assumption) | Curiosity's landing spot | Perseverance's landing spot | middle of the 1 m elevation model |
| 1 m heights | Mars Trek Gale model (HiRISE) | USGS HiRISE model DTEEC_045994_1985 | USGS HiRISE model DTEEC_035862_2195 |
| Study-area heights | 10 m, from the same 1 m model | 20 m CTX model (covers 90% of the study area) | 20 m CTX model (91%) |
| Rover | Curiosity | Perseverance | none |
| Thermal inertia, median over the region | see `thermal_inertia_themis_1km` | 244 (mixed sand and rock) | 125 (dust and fine sand) |
| Water in the top layer (Mars Odyssey) | see `water_odyssey_grs` | 3.5% | 4.6-4.9% |
| Buried ice | not expected | not expected | expected within metres of the surface; the ice maps (SWIM) are still unreachable |

**Candidate sites.** Each region has two 2 × 2 km near-base sites, picked on 2026-11-15 the same way as
Gale's: screened on the 20 m slope map for flat ground inside the 1 m model, 0.3-3 km from the base. The
numbers below are from the 1 m heights:

| Site | Distance from base | Local pad slope (BT-05, 10 m boxes) | Bumpiness (95% below) |
|---|---|---|---|
| `jezero_north` | 0.3-2.7 km | median 1.6°; 98% of boxes within 10°, 92% within 5° | 0.09 m |
| `jezero_south` | 0.3-2.9 km | median 3.1°; 97% within 10°, 77% within 5° | 0.12 m |
| `arcadia_north` | 0.3-2.9 km | median 2.7°; 97% within 10°, 83% within 5° | 0.31 m |
| `arcadia_south` | 0.3-3.1 km | median 3.0°; 98% within 10°, 77% within 5° | 0.37 m |

Arcadia's plain is flat overall but bumpier at the metre scale than Gale's or Jezero's floor (cracked,
patterned ground). Both Arcadia sites are just above the 0.3 m bumpiness placeholder.

**Two elevation models.** In the new regions the 1 m (HiRISE) and 20 m (CTX) heights are separate
products:

- At Jezero the CTX heights read higher than the others: 41-44 m above HiRISE over the two sites, and a
  median 47 m above Perseverance's own heights.
- HiRISE agrees with Perseverance: the median difference is 0.4 m at the 13 stops in `jezero_north` and
  -0.4 m at the 34 in `jezero_south`.
- Slopes are not affected.
- Skylines shift the CTX grid to match the 1 m grid over each site. Each skyline entry records the shift
  in `study_offset_m`.

**Measured only at Gale, or not fetched yet.**

- **Not fetched yet:** Perseverance measures weather (MEDA) and dust in the air (Mastcam-Z, MEDA) at
  Jezero, but this snapshot doesn't fetch them yet. They are listed as `pending` (`weather_rems__jezero`,
  `optical_depth_history__jezero`).
- **Gale only:** Curiosity's radiation dose (RAD, the only one measured on the ground on Mars), its Navcam
  haze record and Gale's moving dunes. Arcadia has no rover, so its weather and dust are Gale only too.
  These are listed as `not_used`, and each entry names the Gale dataset that stands in for it.
- **The same everywhere:** the solar storm list (DONKI) covers all of Mars; see `space_weather_donki`.

**What else differs:**

- No mapped dune fields fall inside either new region.
- Arcadia has no hydrous-mineral detections.
- Fewer THEMIS temperature images match the seasons there. Jezero has one of the four; Arcadia has two.
- Arcadia's 1 m model has a gap about 1 km wide east of the base, so its north site sits west of it.

## 1. Buildable terrain: is the ground flat and smooth enough?

**What we have**
- **Ground height every 10 m across the whole study area** (`elevation_10m_study`) and **every 1 m at each
  site** (`elevation_1m_<site>`). These come from pairs of HiRISE photos (HiRISE is the sharpest camera
  orbiting Mars).
- **Local pad slope in degrees** (`slope_10m_window_<site>`): the requirements' measure **BT-05**. A flat
  plane is fitted to every 10 × 10 m box of the 1 m heights, and its tilt is the slope. Boxes with any
  missing height stay empty, never "flat".
- **Pixel-to-pixel steepness in degrees** (`slope_10m_study`, `slope_1m_<site>`): noisier, but shows short
  steps and edges that a 10 m box smooths out. The 10 m study-area version is for screening only.
- **Bumpiness in metres** (`roughness_1m_<site>`): the requirements' **BT-08**. It is how much the ground goes
  up and down within each 10 × 10 m box once the overall tilt is removed. A smooth slope scores 0; ridges, pits and boulder piles
  score higher.
- **Sand dune outlines** (`dune_fields`): loose, moving sand that is hard to drive on and build on.
- **Is the sand moving?** (`dune_change_imagery`, for **BT-16**): two HiRISE photos of the same 1.5 km of the
  Bagnold Dunes, taken in 2007 and 2015 and put on the same 1 m grid by the USGS. Rock lines up between them
  to a median of 0.14 m (at most about 1 m). Most sand edges barely moved: the median over all of them is
  about 1 m in 8 years (0.12 m a year). The 29% that clearly moved shifted a median **3.2 m (about 0.4 m a
  year)**, like the published rate for these dunes (about 0.4 m a year, at most about 1 m). Picking only
  the edges that moved pushes that number up, so treat it as an indication. The direction varied too much to
  trust; published studies say south-west. This dune band is **1.5 km from `near_base_west`** and 3.6 km
  from `near_base_north`: even at 1 m a year, sand would take more than a thousand years to cross that gap.
- **Photo maps** that load live from NASA: HiRISE colour (0.32 m per pixel, around Curiosity's path), HiRISE
  black-and-white (0.64 m, whole study area) and CTX (about 6–10 m, whole crater).
- Each height, slope and bumpiness grid comes with a coloured picture (an *overlay*) the map can lay on top of
  the photos. `study_nodata.png` shows where elevation data is missing.

**What it can tell you**
- Where the broad flat areas are. The screening slope map shows flat plains in the north, steep crater rims,
  and steep lower Mount Sharp in the south-east.
- How steep and bumpy each site is, metre by metre.

**What it can't tell you**
- **Small rocks.** The 1 m height grid can't see anything smaller than about 3 m, and no rock map
  exists for Gale. The closest stand-in is thermal inertia (next section): it says whether a 1 km patch
  is mostly rock or mostly dust, not where the boulders are. Small obstacles have to be checked in the
  photos or on the ground.
- **Whether flat ground is strong.** Flat is not the same as solid (the plan says this too).
- **Fine detail versus noise.** The source doesn't say how precise its heights are, so we assume 0.25 m
  (a placeholder in the scenario file). With that assumption, the 10 m-box slope is reliable down to about
  0.7°, but pixel-to-pixel slopes below about 10° and bumpiness below 0.25 m can't be told apart from noise.
  At the placeholder site the bumpiness is mostly 0.03–0.3 m (median 0.08 m), largely below that line.
- **The placeholder site is steep.** Its 10 m-box slopes have a median of 11°; only 44% of boxes meet the
  proposed 10° limit (BT-05) and 12% meet the 5° ideal. It sits on Mount Sharp's lower slopes, so real
  candidate sites should come from the flatter plains to the north.

## 2. Ground and ice: what is the ground made of, and is there ice?

**What we have**
- **The global geologic map** (`geology_units`, `geology_contacts`, `geology_structures`): rock types and
  their boundaries. The study area is mostly unit **Htu** ("Hesperian transition undivided").
- **Which geologic maps exist** for the area (`geology_map_index`). A detailed 1:60,000 Mount Sharp map is
  listed as *in progress*, with no data yet.
- **Water-related mineral detections** (`minerals_detections`): spots where orbiters saw clays or sulfates.
- **Curiosity's driven path and stops** (`rover_path`, `rover_stops`): the only ground checked in person. The
  ground carried a 900 kg rover along this line, and each stop records how tilted the rover was.
- **Thermal inertia as numbers, every 1 km** (`thermal_inertia_themis_1km`): how slowly the ground warms and
  cools. Rock and bedrock stay warm through the night (high values); dust and fine sand cool fast (low
  values). This is our stand-in for "how rocky". Across the study area most values are 175–350 (median
  258); at the placeholder site they're 239–306 (median 288, from 24 cells). Those are middle values:
  neither loose dust (below about 100) nor bare bedrock (many hundreds). It was made by a researcher from
  NASA THEMIS night images (Huang 2026), and the absolute level is uncertain by about 12–24%.
- **Water in the top layer of the ground** (`water_odyssey_grs`): NASA's Mars Odyssey measured, from orbit,
  how much water is held in the top few tens of centimetres. The two cells over Gale read **about 5.4% water
  by weight** (±0.4%). That water is bound in minerals and soil, not ice, and each cell is about 300 km
  across, so it says nothing about one site versus another.
- **Thermal inertia picture** (`thermal_inertia_tes`, live, very coarse): the same idea from an older
  instrument, as colours only.

**What it can't tell you**
- **Fine-scale geology.** The geologic map is drawn at 1:20,000,000, so its units are far bigger than a site.
- **Ground strength.** Nothing here measures how much weight the ground can carry.
- **Ice.** Ice is **not expected** near the surface at Gale. The crater is 4.6° south of the equator, and
  buried ice stays frozen near the surface mostly beyond about 30–40° latitude. The orbital water map
  agrees: it shows a few percent of water held in minerals, the normal level for the low latitudes. No
  dataset here maps ice at site scale, so "not expected" is a judgement, not a measurement. The ice
  maps the plan names (SWIM) were unreachable on 2026-11-14 (`ice_swim` is *pending*).
- **Water under Curiosity's wheels.** Curiosity's DAN instrument measures hydrogen in the top metre along
  its path, but NASA's archive holds raw neutron counts, not water amounts. Turning counts into water
  needs the instrument team's model, so it is listed as not used (`water_dan_curiosity`).

## 3. Solar: how much sunlight reaches each site?

**What we have**
- **A coarse height map of the whole crater** (`elevation_463m_region`, 463 m per pixel), used to find the
  distant hills and crater walls that block the sun.
- **The skyline at each site** (`horizon_<site>`): for every point on a 100 m grid, how high the
  terrain rises in each of 360 directions. At the placeholder site, Mount Sharp raises the eastern skyline
  to about 15°.
- **A sun table for each site** (`sun_table_<site>`): where the sun is every half hour, for 24 points through
  the Mars year, and what fraction of the site is in sunlight. For example, at Ls 90 (the start of
  northern summer, which is winter at Gale, just south of the equator) only 29% of the placeholder site
  is sunlit at 06:30, because Mount Sharp shades it in the morning.
- **Curiosity's daily weather** (`weather_rems`): sunrise and sunset times, UV level, and a sky label.
- **Surface dust** (`surface_dust_tes`, live picture, very coarse).

- **Typical dust and sunlight by season, from a climate model** (`dust_climate_mcd`): the Mars Climate
  Database's values at the base for every hour of the day in 24 seasons, in four cases: a typical year, a
  clear year, a dusty year and a global dust storm. In a typical year the noon sunlight on flat ground runs
  from about 410 W/m² (around Ls 75) to 620 W/m² (around Ls 195); in a dust storm it drops to at most
  180 W/m².
- **Measured dust in the air over Gale, 2012–2023** (`optical_depth_history`): Curiosity pointed its Mastcam at
  the Sun every few sols for six Mars years and measured how much light the haze blocked (optical depth,
  at 880 and 440 nm, each with its uncertainty). The median is 0.76; the clearest season is Ls 60–150
  (about 0.45) and the haziest Ls 210–240 (about 1.2). The 2018 global dust storm reached **8.6**, when
  almost no direct sunlight got through.
- **Haze near the ground** (`dust_extinction_navcam`): how far you could see across the crater, from Navcam
  images (NASA PDS). On 20 days in the dusty season it was too hazy to measure at all, so the haziest
  value listed is a lower bound.

**What it can't tell you**
- **How much power panels would make.** "Sunlit" means the sun is above the skyline. The climate model and
  the dust record give the dust and sunlight on flat open ground; panel angle, the skyline and dust settling
  on the panels (SC-05) still need the array design.
- **Shadows from small features.** Anything closer together than 100 m isn't mapped.

## 4. Thermal: how hot and cold does the ground get?

**What we have**
- **Four orbiter temperature images** (`themis_temp_day_aphelion`, `…_night_aphelion`,
  `…_day_perihelion`, `…_night_perihelion`): surface temperature in kelvin, about 100 m per pixel, at two
  seasons:
  - *aphelion* is when Mars is farthest from the sun (colder), around Ls 70;
  - *perihelion* is when it's closest (warmer), around Ls 250.

  Mars Odyssey's orbit means the "day" images are from **late afternoon** (about 17–18 h local time) and
  the "night" images are from **dawn** (about 7 h). Typical values are 216–226 K in the afternoon and
  187–206 K at dawn (about −57 to −47 °C and −86 to −67 °C). Each image covers between 24% and 88% of
  the study area. At the placeholder site, the dawn image near aphelion has **no data at all** and the
  afternoon one near aphelion covers about half; the two perihelion images cover all of it.
- **A list of all 165 such images** over the study area, with their seasons and times
  (`themis_temperature_list`).
- **Curiosity's daily air and ground temperatures and air pressure** (`weather_rems`), measured on the ground
  but only where the rover was each day.
- **THEMIS day and night pictures** (`thermal_day`, `thermal_night`, live). These are colour pictures, not
  temperature numbers.
- **Typical temperatures and air pressure by season and hour, from a climate model**
  (`temperature_climate_mcd`): the Mars Climate Database at the base, 2 m above the ground, every hour in 24
  seasons, in a typical, a clear, a dusty and a dust-storm year. In a typical year the ground surface runs
  from about 179 K to 292 K (−94 to +19 °C) and the air from 185 K to 258 K (−88 to −15 °C); the air pressure
  from 700 to 980 Pa. A dust storm narrows the daily swing (ground 211–261 K).

**What it can't tell you**
- **Cooling capacity.** Surface temperature is not air temperature, and cold surroundings don't
  automatically mean good cooling in Mars's thin air.
- **Temperatures below the ground.** The climate database's web service gives none, so ground temperature
  by depth (GI-07, TC-10) still needs thermal inertia and a heat model.
- **Site-to-site differences.** The climate model is one point with cells a few hundred km across; the
  THEMIS images are four moments, not a record.

## 5. Investigation routes: how do crews get there and back?

**What we have**
- **The assumptions** (`scenario`): base location, candidate sites, a placeholder facility size, slope and
  bumpiness limits, and walking and driving speeds. All of these are marked as placeholders until the team
  agrees on values.
- **Slope and bumpiness** (above), for the ground a route must cross.
- **Curiosity's path** (above): a line we know a rover could drive.
- **Place names** (`named_sites`, `labels`), and a **live height lookup** for any clicked point
  (`elevation_point_service`).
- **Heights and slopes every 2 m between the base and the near-base sites** (`elevation_2m_trip_area`,
  `slope_2m_trip_area`), for route planning.
- **Radiation on the ground** (`radiation_rad`, for **IR-12**): Curiosity's RAD instrument, one sol every 100
  across the mission. The dose follows the Sun's 11-year cycle: about 210 microgray a day in 2012–2015,
  up to 320 in 2020 (quiet Sun, more cosmic rays) and 150–160 in 2024–2026 (active Sun).
- **Solar storm records** (`space_weather_donki`): the 438 solar particle events NASA's DONKI database listed
  from Curiosity's landing to today, 19 of them above 100 MeV. Seen near Earth, so they show when a storm
  could have reached Gale, not that it did.
- **Haze near the ground** (`dust_extinction_navcam`, above), for visibility limits.

**What it can't tell you**
- **A safe route.** Routes built on this data are planning scenarios, not certified safe paths.
- **Radiation risk to people.** RAD gives absorbed dose; the biologically weighted dose (dose equivalent) is
  about 3–4 times higher and needs the published RAD analyses.

## Checks on how well the layers line up

The plan says to check that layers line up before combining them. The snapshot does this automatically and
stores the results under `alignment` in the index:

- **The 1 m height map reads higher than Curiosity's own height measurements:** by a median of 9 m across
  the study area and 18 m at the placeholder site. **This is flagged and not corrected.** It may be a
  difference in the reference level for "zero height", or a small sideways shift between the two maps.
  Compare heights between the two only with this in mind.
- **The coarse crater-wide height map agrees with the 10 m map** to within about 5 m. The skyline
  calculation shifts the coarse map by that amount.

## Still missing (pending)

Every dataset the requirement metrics asked for has been fetched except one, which stays in the index with
`access: "pending"` and a reason so the app can show it as a gap:

- **Ice maps** (SWIM, `ice_swim`): the server was unreachable (see section 2). Ice is not expected at Gale.

## Not used, and why

These are in the index with `access: "not_used"` and a reason:

- **No separate dataset needed:** communications coverage (IR-10). Line of sight comes from our elevation
  grids plus an assumed antenna and relay network, which is a design input.
- **Optional later:** a Curiosity photo index.
- **Not suitable:**
  - Perseverance photos (wrong crater);
  - NASA Worldview (Earth only);
  - the unfinished 1:60K Mount Sharp map;
  - Trek's analysis tools (they need a login);
  - Trek's full-file downloads (several GB each);
  - NASA's route animation (a picture, not data);
  - Curiosity's DAN neutron counts (raw counts, not water amounts; see section 2).
- **Unreachable:** the SWIM ice maps (`ice_swim`, pending).

## Glossary

- **Areoid:** Mars's "sea level", the reference surface heights are measured from.
- **Aphelion / perihelion:** when Mars is farthest from / closest to the sun (around Ls 71 / Ls 251).
- **CORS:** a web rule that decides whether a browser page may load data from another website. Entries record
  it under `live.cors`.
- **CTX:** a Mars Reconnaissance Orbiter camera, about 6 m per pixel, covering wide areas.
- **Curiosity:** NASA's rover in Gale crater since 2012.
- **DAN:** Curiosity's neutron instrument, which senses hydrogen (and so water) in the top metre of ground.
- **Dose (microgray, µGy):** radiation energy absorbed per kilogram. 1 µGy = one millionth of a joule per kg.
- **Elevation model (DEM):** a grid of ground heights.
- **Equirectangular:** a simple map layout where longitude and latitude are spaced evenly. Mars Trek tiles use it.
- **GRS:** Mars Odyssey's Gamma Ray Spectrometer; measures elements, including hydrogen, from orbit.
- **HiRISE:** the sharpest camera orbiting Mars, about 0.3 m per pixel.
- **Kelvin (K):** temperature scale where 0 K is absolute zero. °C = K − 273.15.
- **Ls (solar longitude):** the season on Mars, in degrees: 0 = northern spring starts, 90 = northern
  summer, 180 = northern autumn, 270 = northern winter.
- **MMGIS:** JPL's web map of Curiosity's mission; source of the rover path and colour photo map.
- **Mars Climate Database (MCD):** a database of climate-model runs for Mars, checked against spacecraft
  data, made by the LMD laboratory in Paris with ESA and CNES support.
- **Mars Trek:** NASA/JPL's Mars mapping portal; source of most layers here.
- **MOLA:** a laser altimeter that measured heights over all of Mars (coarse, about 463 m per pixel here).
- **Optical depth (tau):** how much the haze blocks sunlight. 0 is perfectly clear; 1 lets through about a
  third of the direct sunlight; 5 or more is a dust storm.
- **Orthophoto:** a photo corrected for the terrain so that every pixel sits at its true map position.
- **Overlay:** a coloured picture with known edges, laid on top of the map.
- **RAD:** Curiosity's Radiation Assessment Detector.
- **REMS:** Curiosity's weather station.
- **Roughness / bumpiness:** how much the ground goes up and down in a small box after removing the overall tilt.
- **Thermal inertia:** how slowly the ground warms up and cools down. High for rock, low for dust and sand.
  Its unit is J m⁻² K⁻¹ s⁻½; you can read it as a plain number.
- **Weight percent (wt%):** grams per 100 grams of soil. 5 wt% water means 5 g of water in 100 g of soil.
- **Slope:** how steep the ground is, in degrees (0° is flat).
- **Sol:** a Mars day, about 24 h 40 min. Curiosity counts sols from its landing.
- **THEMIS:** a heat-sensing camera on Mars Odyssey that measures surface temperature.
- **Tile:** a small square image; maps load many tiles as you pan and zoom.
- **Web Mercator:** the map layout most web maps use. MMGIS tiles use it, so they don't line up with Trek
  tiles without conversion.

## All datasets

This table is generated from the index by `python -m martian_map catalog table --write docs/data-sources.md`.
Don't edit it by hand.

<!-- catalog-table:start -->
| id | region | what it is | factors | evidence | access |
|---|---|---|---|---|---|
| `communications` | gale | Line of sight to orbiters and Earth. | routes | reference | not_used |
| `dune_change_imagery` | gale | Two HiRISE photos of the same 1.5 km of the Bagnold Dunes, eight years apart, on the same 1 m grid, and how far each 64 m square of sand moved between them. | terrain | observation | local |
| `dune_fields` | gale | Outlines of mapped sand-dune fields: loose, moving sand that is hard to drive on and build on. | terrain, ground | interpretation | local |
| `dust_climate_mcd` | gale | Modelled dust in the air above the base (visible optical depth) and the sunlight reaching the ground, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | solar | model | local |
| `dust_extinction_navcam` | gale | How hazy the air near the ground inside the crater was, measured by Curiosity's Navcam looking across the crater to its rim, as extinction per km (visibility is roughly 3.9 divided by this, in km). | solar, routes | observation | local |
| `elevation_10m_study` | gale | Height of the ground every 10 m across the study area (10 m screening), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_curiosity_recent` | gale | Height of the ground every 1 m across the site Curiosity recent path (boxwork area), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_near_base_north` | gale | Height of the ground every 1 m across the site Near base, north (crater floor), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_near_base_west` | gale | Height of the ground every 1 m across the site Near base, west (crater floor, on Curiosity's early path), in metres. | terrain, routes, solar | derived | local |
| `elevation_2m_trip_area` | gale | Height of the ground every 2 m across the trip area (the base and the near-base sites, for route planning), in metres. | terrain, routes, solar | derived | local |
| `elevation_463m_region` | gale | Coarse ground height for the whole crater, its rim and Mount Sharp, used to work out which hills block the sun. | solar, terrain | derived | local |
| `elevation_point_service` | gale | Ask Mars Trek for the ground height at any clicked point in the study area. | terrain, routes | derived | live |
| `geology_1to60k` | gale | A detailed geologic map of Aeolis Mons (Mount Sharp). | ground | reference | not_used |
| `geology_contacts` | gale | Lines where one geologic unit meets another. | ground | interpretation | local |
| `geology_map_index` | gale | The list (and outlines) of published geologic maps that cover the study area, including unfinished ones. | ground | reference | local |
| `geology_structures` | gale | Mapped landforms such as ridges, scarps and channels. | ground | interpretation | local |
| `geology_units` | gale | What the rock is, from the global geologic map: each area has a unit name and description. | ground | interpretation | local |
| `horizon_curiosity_recent` | gale | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `horizon_near_base_north` | gale | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `horizon_near_base_west` | gale | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `ice_swim` | gale | Maps of where buried ice is likely, from several orbiters. | ground | derived | pending |
| `imagery_ctx` | gale | A wider, less sharp photo map covering the whole crater, about 10 m per pixel at the top zoom. | terrain | observation | live |
| `imagery_ctx_mmgis` | gale | The same kind of CTX photo map, served in the MMGIS (Web Mercator) tile grid, about 6 m per pixel. | terrain | observation | live |
| `imagery_hirise_color` | gale | The sharpest colour photo map of Curiosity's area, about 0.32 m per pixel; boulders are visible. | terrain, routes | observation | live |
| `imagery_hirise_gray` | gale | A sharp black-and-white photo map of the study area, about 0.64 m per pixel at the top zoom. | terrain | observation | live |
| `imagery_viking` | gale | A global colour photo map for context, 232 m per pixel. | terrain | observation | live |
| `labels` | gale | Transparent tiles with the names of places Curiosity visited. | routes | reference | live |
| `map_config` | gale | JPL's configuration for the Curiosity map: the list of its layers and their tile addresses. |  | reference | local |
| `minerals_detections` | gale | Places where orbiters (CRISM, OMEGA) detected minerals that formed with water, such as clays and sulfates. | ground | interpretation | local |
| `named_sites` | gale | Outlines of named places Curiosity studied, such as drill sites. | routes | reference | local |
| `optical_depth_history` | gale | How much sunlight the dust and haze above Gale blocked, measured by Curiosity pointing its Mastcam at the Sun, about every few sols for six Mars years, at two wavelengths (880 and 440 nm), with an uncertainty for each value. | solar, thermal | observation | local |
| `perseverance_photos` | gale | Photos from the Perseverance rover. |  | reference | not_used |
| `photos_curiosity_index` | gale | Photos taken by Curiosity at each stop. |  | reference | not_used |
| `radiation_rad` | gale | How much radiation reached the ground at Gale each day, measured by Curiosity's RAD instrument: one sol every 100 sols from 1 to 4800, in microgray per day. | routes | observation | local |
| `relief_mola` | gale | A global shaded-relief map coloured by height, 463 m per pixel, for context. | terrain | derived | live |
| `roughness_1m_curiosity_recent` | gale | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `roughness_1m_near_base_north` | gale | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `roughness_1m_near_base_west` | gale | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `route_animation` | gale | NASA's animated map of Curiosity's planned route. |  | reference | not_used |
| `rover_path` | gale | The line Curiosity actually drove since landing: ground proven to carry a 900 kg rover. | routes, ground | observation | local |
| `rover_position` | gale | Curiosity's latest position. The live link always has today's position. | routes | observation | local |
| `rover_stops` | gale | Every place Curiosity stopped, with its height and how tilted the rover was (roll, pitch, tilt). | routes, ground | observation | local |
| `scenario` | gale | The team's assumptions: base location, candidate sites, facility size and mobility limits. | terrain, ground, solar, thermal, routes | assumption | local |
| `slope_10m_study` | gale | How steep the ground is, in degrees, every 10 m across the study area (10 m screening). | terrain, routes | derived | local |
| `slope_10m_window_curiosity_recent` | gale | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_10m_window_near_base_north` | gale | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_10m_window_near_base_west` | gale | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_1m_curiosity_recent` | gale | How steep the ground is, in degrees, every 1 m across the site Curiosity recent path (boxwork area). | terrain, routes | derived | local |
| `slope_1m_near_base_north` | gale | How steep the ground is, in degrees, every 1 m across the site Near base, north (crater floor). | terrain, routes | derived | local |
| `slope_1m_near_base_west` | gale | How steep the ground is, in degrees, every 1 m across the site Near base, west (crater floor, on Curiosity's early path). | terrain, routes | derived | local |
| `slope_2m_trip_area` | gale | How steep the ground is, in degrees, every 2 m across the trip area (the base and the near-base sites, for route planning). | terrain, routes | derived | local |
| `space_weather_donki` | gale | Every solar particle storm NASA's space-weather database recorded from Curiosity's landing to today, with the spacecraft that saw it, to find the dates when radiation at Gale could have jumped. | routes | observation | local |
| `sun_table_curiosity_recent` | gale | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `sun_table_near_base_north` | gale | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `sun_table_near_base_west` | gale | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `surface_dust_tes` | gale | A coarse global picture of how dusty the surface is, which affects solar panels and ground conditions. | solar | derived | live |
| `temperature_climate_mcd` | gale | Modelled ground-surface temperature, air temperature 2 m above the ground and air pressure at the base, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | thermal | model | local |
| `themis_temp_day_aphelion` | gale | Surface temperature (kelvin) seen from orbit at about 17.0 h local time, season Ls 67, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_day_perihelion` | gale | Surface temperature (kelvin) seen from orbit at about 17.9 h local time, season Ls 259, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_night_aphelion` | gale | Surface temperature (kelvin) seen from orbit at about 6.9 h local time, season Ls 73, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_night_perihelion` | gale | Surface temperature (kelvin) seen from orbit at about 6.8 h local time, season Ls 253, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temperature_list` | gale | Every THEMIS surface-temperature image covering the study area, with its date, season (Ls) and local time. | thermal | observation | local |
| `thermal_day` | gale | A picture of how warm the ground looks from orbit in the afternoon (bright = warmer), 100 m per pixel. | thermal | observation | live |
| `thermal_inertia_tes` | gale | A coarse global picture of how quickly the ground heats and cools: low hints at dust or sand, high at rock. | ground, thermal | derived | live |
| `thermal_inertia_themis_1km` | gale | How slowly the ground warms and cools, as numbers on a 1 km grid over all of Gale: high means rock or bedrock, low means dust or sand. The best available stand-in for how rocky the ground is. | terrain, ground, thermal | derived | local |
| `thermal_night` | gale | A picture of how warm the ground looks at night; rock and coarse ground stay warmer than dust and sand. | thermal, ground | observation | live |
| `trek_data_stream` | gale | Whole-file downloads of Trek products. |  | reference | not_used |
| `trek_login_tools` | gale | Mars Trek's analysis tools. |  | reference | not_used |
| `water_dan_curiosity` | gale | Curiosity's DAN instrument measures hydrogen (water) in the top metre of ground along its path. | ground | reference | not_used |
| `water_odyssey_grs` | gale | How much water is held in the top few tens of centimetres of soil and rock, as a percent of weight, measured from orbit in 5 degree cells (about 300 km). | ground | derived | local |
| `weather_rems` | gale | Daily air and ground temperature, air pressure, UV level and sunrise/sunset measured by Curiosity, by season. | thermal, solar | observation | local |
| `worldview` | gale | NASA's Earth satellite imagery browser. |  | reference | not_used |
| `dune_change_imagery__arcadia` | arcadia | Not measured at Arcadia Planitia: sand movement measured only for Gale's Bagnold Dunes. | terrain, routes | reference | not_used |
| `dune_fields__arcadia` | arcadia | Outlines of mapped sand-dune fields: loose, moving sand that is hard to drive on and build on. | terrain, ground | interpretation | local |
| `dust_climate_mcd__arcadia` | arcadia | Modelled dust in the air above the base (visible optical depth) and the sunlight reaching the ground, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | solar | model | local |
| `dust_extinction_navcam__arcadia` | arcadia | Not measured at Arcadia Planitia: near-ground haze measured by Curiosity's Navcam at Gale. | solar | reference | not_used |
| `elevation_1m_arcadia_north__arcadia` | arcadia | Height of the ground every 1 m across the site Near base, north (plain), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_arcadia_south__arcadia` | arcadia | Height of the ground every 1 m across the site Near base, south (plain), in metres. | terrain, routes, solar | derived | local |
| `elevation_20m_study__arcadia` | arcadia | Height of the ground every 20 m across the study area (20 m screening), in metres. | terrain, routes, solar | derived | local |
| `elevation_2m_trip_area__arcadia` | arcadia | Height of the ground every 2 m across the trip area (the base and the near-base sites, for route planning), in metres. | terrain, routes, solar | derived | local |
| `elevation_463m_region__arcadia` | arcadia | Coarse ground height for the whole Arcadia Planitia region around the study area, used to work out which distant hills and crater walls block the sun. | solar, terrain | derived | local |
| `geology_contacts__arcadia` | arcadia | Lines where one geologic unit meets another. | ground | interpretation | local |
| `geology_map_index__arcadia` | arcadia | The list (and outlines) of published geologic maps that cover the study area, including unfinished ones. | ground | reference | local |
| `geology_structures__arcadia` | arcadia | Mapped landforms such as ridges, scarps and channels. | ground | interpretation | local |
| `geology_units__arcadia` | arcadia | What the rock is, from the global geologic map: each area has a unit name and description. | ground | interpretation | local |
| `horizon_arcadia_north__arcadia` | arcadia | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `horizon_arcadia_south__arcadia` | arcadia | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `ice_swim__arcadia` | arcadia | Maps of where buried ice is likely, from several orbiters. | ground | derived | pending |
| `imagery_viking__arcadia` | arcadia | A global colour photo map for context, 232 m per pixel. | terrain | observation | live |
| `minerals_detections__arcadia` | arcadia | Places where orbiters (CRISM, OMEGA) detected minerals that formed with water, such as clays and sulfates. | ground | interpretation | local |
| `optical_depth_history__arcadia` | arcadia | Not measured at Arcadia Planitia: dust in the air measured by Curiosity's Mastcam at Gale. | solar | reference | not_used |
| `radiation_rad__arcadia` | arcadia | Not measured at Arcadia Planitia: radiation dose measured on the ground, which only Curiosity's RAD has done on Mars (at Gale). | routes | reference | not_used |
| `relief_mola__arcadia` | arcadia | A global shaded-relief map coloured by height, 463 m per pixel, for context. | terrain | derived | live |
| `roughness_1m_arcadia_north__arcadia` | arcadia | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `roughness_1m_arcadia_south__arcadia` | arcadia | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `rover_path__arcadia` | arcadia | No rover has driven at Arcadia Planitia. | routes | reference | not_used |
| `rover_stops__arcadia` | arcadia | No rover has driven at Arcadia Planitia. | routes | reference | not_used |
| `scenario__arcadia` | arcadia | The team's assumptions: base location, candidate sites, facility size and mobility limits. | terrain, ground, solar, thermal, routes | assumption | local |
| `slope_10m_window_arcadia_north__arcadia` | arcadia | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_10m_window_arcadia_south__arcadia` | arcadia | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_1m_arcadia_north__arcadia` | arcadia | How steep the ground is, in degrees, every 1 m across the site Near base, north (plain). | terrain, routes | derived | local |
| `slope_1m_arcadia_south__arcadia` | arcadia | How steep the ground is, in degrees, every 1 m across the site Near base, south (plain). | terrain, routes | derived | local |
| `slope_20m_study__arcadia` | arcadia | How steep the ground is, in degrees, every 20 m across the study area (20 m screening). | terrain, routes | derived | local |
| `slope_2m_trip_area__arcadia` | arcadia | How steep the ground is, in degrees, every 2 m across the trip area (the base and the near-base sites, for route planning). | terrain, routes | derived | local |
| `space_weather_donki__arcadia` | arcadia | The same for all of Mars: the record of solar storms, which is the same for all of Mars. | routes | reference | not_used |
| `sun_table_arcadia_north__arcadia` | arcadia | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `sun_table_arcadia_south__arcadia` | arcadia | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `surface_dust_tes__arcadia` | arcadia | A coarse global picture of how dusty the surface is, which affects solar panels and ground conditions. | solar | derived | live |
| `temperature_climate_mcd__arcadia` | arcadia | Modelled ground-surface temperature, air temperature 2 m above the ground and air pressure at the base, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | thermal | model | local |
| `themis_temp_day_aphelion__arcadia` | arcadia | Surface temperature (kelvin) seen from orbit at about 17.6 h local time, season Ls 95, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_day_perihelion__arcadia` | arcadia | No suitable THEMIS image was found for this time and season. | thermal | observation | pending |
| `themis_temp_night_aphelion__arcadia` | arcadia | Surface temperature (kelvin) seen from orbit at about 6.6 h local time, season Ls 61, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_night_perihelion__arcadia` | arcadia | No suitable THEMIS image was found for this time and season. | thermal | observation | pending |
| `themis_temperature_list__arcadia` | arcadia | Every THEMIS surface-temperature image covering the study area, with its date, season (Ls) and local time. | thermal | observation | local |
| `thermal_day__arcadia` | arcadia | A picture of how warm the ground looks from orbit in the afternoon (bright = warmer), 100 m per pixel. | thermal | observation | live |
| `thermal_inertia_tes__arcadia` | arcadia | A coarse global picture of how quickly the ground heats and cools: low hints at dust or sand, high at rock. | ground, thermal | derived | live |
| `thermal_inertia_themis_1km__arcadia` | arcadia | How slowly the ground warms and cools, as numbers on a 1 km grid over all of Arcadia Planitia: high means rock or bedrock, low means dust or sand. The best available stand-in for how rocky the ground is. | terrain, ground, thermal | derived | local |
| `thermal_night__arcadia` | arcadia | A picture of how warm the ground looks at night; rock and coarse ground stay warmer than dust and sand. | thermal, ground | observation | live |
| `water_odyssey_grs__arcadia` | arcadia | How much water is held in the top few tens of centimetres of soil and rock, as a percent of weight, measured from orbit in 5 degree cells (about 300 km). | ground | derived | local |
| `weather_rems__arcadia` | arcadia | Not measured at Arcadia Planitia: daily weather measured by Curiosity's REMS station at Gale. | thermal | reference | not_used |
| `dune_change_imagery__jezero` | jezero | Not measured at Jezero crater: sand movement measured only for Gale's Bagnold Dunes. | terrain, routes | reference | not_used |
| `dune_fields__jezero` | jezero | Outlines of mapped sand-dune fields: loose, moving sand that is hard to drive on and build on. | terrain, ground | interpretation | local |
| `dust_climate_mcd__jezero` | jezero | Modelled dust in the air above the base (visible optical depth) and the sunlight reaching the ground, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | solar | model | local |
| `dust_extinction_navcam__jezero` | jezero | Not measured at Jezero crater: near-ground haze measured by Curiosity's Navcam at Gale. | solar | reference | not_used |
| `elevation_1m_jezero_north__jezero` | jezero | Height of the ground every 1 m across the site Near base, north (crater floor), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_jezero_south__jezero` | jezero | Height of the ground every 1 m across the site Near base, south (crater floor, toward Perseverance's early drive), in metres. | terrain, routes, solar | derived | local |
| `elevation_20m_study__jezero` | jezero | Height of the ground every 20 m across the study area (20 m screening), in metres. | terrain, routes, solar | derived | local |
| `elevation_2m_trip_area__jezero` | jezero | Height of the ground every 2 m across the trip area (the base and the near-base sites, for route planning), in metres. | terrain, routes, solar | derived | local |
| `elevation_463m_region__jezero` | jezero | Coarse ground height for the whole Jezero crater region around the study area, used to work out which distant hills and crater walls block the sun. | solar, terrain | derived | local |
| `geology_contacts__jezero` | jezero | Lines where one geologic unit meets another. | ground | interpretation | local |
| `geology_map_index__jezero` | jezero | The list (and outlines) of published geologic maps that cover the study area, including unfinished ones. | ground | reference | local |
| `geology_structures__jezero` | jezero | Mapped landforms such as ridges, scarps and channels. | ground | interpretation | local |
| `geology_units__jezero` | jezero | What the rock is, from the global geologic map: each area has a unit name and description. | ground | interpretation | local |
| `horizon_jezero_north__jezero` | jezero | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `horizon_jezero_south__jezero` | jezero | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `ice_swim__jezero` | jezero | Maps of where buried ice is likely, from several orbiters. | ground | derived | pending |
| `imagery_viking__jezero` | jezero | A global colour photo map for context, 232 m per pixel. | terrain | observation | live |
| `map_config__jezero` | jezero | JPL's configuration for the Perseverance map: the list of its layers and their tile addresses. |  | reference | local |
| `minerals_detections__jezero` | jezero | Places where orbiters (CRISM, OMEGA) detected minerals that formed with water, such as clays and sulfates. | ground | interpretation | local |
| `named_sites__jezero` | jezero | Outlines of named places on Perseverance's map, such as its landing site. | routes | reference | local |
| `optical_depth_history__jezero` | jezero | Measured by Perseverance at Jezero crater; not fetched yet. | solar | observation | pending |
| `radiation_rad__jezero` | jezero | Not measured at Jezero crater: radiation dose measured on the ground, which only Curiosity's RAD has done on Mars (at Gale). | routes | reference | not_used |
| `relief_mola__jezero` | jezero | A global shaded-relief map coloured by height, 463 m per pixel, for context. | terrain | derived | live |
| `roughness_1m_jezero_north__jezero` | jezero | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `roughness_1m_jezero_south__jezero` | jezero | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `rover_path__jezero` | jezero | The line Perseverance actually drove since landing: ground proven to carry a 1,025 kg rover. | routes, ground | observation | local |
| `rover_position__jezero` | jezero | Perseverance's latest position. The live link always has today's position. | routes | observation | local |
| `rover_stops__jezero` | jezero | Every place Perseverance stopped, with its height and how tilted the rover was (roll, pitch, tilt). | routes, ground | observation | local |
| `scenario__jezero` | jezero | The team's assumptions: base location, candidate sites, facility size and mobility limits. | terrain, ground, solar, thermal, routes | assumption | local |
| `slope_10m_window_jezero_north__jezero` | jezero | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_10m_window_jezero_south__jezero` | jezero | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_1m_jezero_north__jezero` | jezero | How steep the ground is, in degrees, every 1 m across the site Near base, north (crater floor). | terrain, routes | derived | local |
| `slope_1m_jezero_south__jezero` | jezero | How steep the ground is, in degrees, every 1 m across the site Near base, south (crater floor, toward Perseverance's early drive). | terrain, routes | derived | local |
| `slope_20m_study__jezero` | jezero | How steep the ground is, in degrees, every 20 m across the study area (20 m screening). | terrain, routes | derived | local |
| `slope_2m_trip_area__jezero` | jezero | How steep the ground is, in degrees, every 2 m across the trip area (the base and the near-base sites, for route planning). | terrain, routes | derived | local |
| `space_weather_donki__jezero` | jezero | The same for all of Mars: the record of solar storms, which is the same for all of Mars. | routes | reference | not_used |
| `sun_table_jezero_north__jezero` | jezero | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `sun_table_jezero_south__jezero` | jezero | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `surface_dust_tes__jezero` | jezero | A coarse global picture of how dusty the surface is, which affects solar panels and ground conditions. | solar | derived | live |
| `temperature_climate_mcd__jezero` | jezero | Modelled ground-surface temperature, air temperature 2 m above the ground and air pressure at the base, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | thermal | model | local |
| `themis_temp_day_aphelion__jezero` | jezero | No suitable THEMIS image was found for this time and season. | thermal | observation | pending |
| `themis_temp_day_perihelion__jezero` | jezero | No suitable THEMIS image was found for this time and season. | thermal | observation | pending |
| `themis_temp_night_aphelion__jezero` | jezero | Surface temperature (kelvin) seen from orbit at about 6.7 h local time, season Ls 67, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_night_perihelion__jezero` | jezero | No suitable THEMIS image was found for this time and season. | thermal | observation | pending |
| `themis_temperature_list__jezero` | jezero | Every THEMIS surface-temperature image covering the study area, with its date, season (Ls) and local time. | thermal | observation | local |
| `thermal_day__jezero` | jezero | A picture of how warm the ground looks from orbit in the afternoon (bright = warmer), 100 m per pixel. | thermal | observation | live |
| `thermal_inertia_tes__jezero` | jezero | A coarse global picture of how quickly the ground heats and cools: low hints at dust or sand, high at rock. | ground, thermal | derived | live |
| `thermal_inertia_themis_1km__jezero` | jezero | How slowly the ground warms and cools, as numbers on a 1 km grid over all of Jezero crater: high means rock or bedrock, low means dust or sand. The best available stand-in for how rocky the ground is. | terrain, ground, thermal | derived | local |
| `thermal_night__jezero` | jezero | A picture of how warm the ground looks at night; rock and coarse ground stay warmer than dust and sand. | thermal, ground | observation | live |
| `water_odyssey_grs__jezero` | jezero | How much water is held in the top few tens of centimetres of soil and rock, as a percent of weight, measured from orbit in 5 degree cells (about 300 km). | ground | derived | local |
| `weather_rems__jezero` | jezero | Measured by Perseverance at Jezero crater; not fetched yet. | thermal | observation | pending |
<!-- catalog-table:end -->
