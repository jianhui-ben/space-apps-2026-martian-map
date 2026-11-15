# What data we have

This project compares candidate sites for a data center near an imagined future base in **Gale crater** on
Mars (see the [project plan](project-plan.md)). This page explains, in plain words, every dataset the map
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
| id | what it is | factors | evidence | access |
|---|---|---|---|---|
| `communications` | Line of sight to orbiters and Earth. | routes | reference | not_used |
| `dune_change_imagery` | Two HiRISE photos of the same 1.5 km of the Bagnold Dunes, eight years apart, on the same 1 m grid, and how far each 64 m square of sand moved between them. | terrain | observation | local |
| `dune_fields` | Outlines of mapped sand-dune fields: loose, moving sand that is hard to drive on and build on. | terrain, ground | interpretation | local |
| `dust_climate_mcd` | Modelled dust in the air above the base (visible optical depth) and the sunlight reaching the ground, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | solar | model | local |
| `dust_extinction_navcam` | How hazy the air near the ground inside the crater was, measured by Curiosity's Navcam looking across the crater to its rim, as extinction per km (visibility is roughly 3.9 divided by this, in km). | solar, routes | observation | local |
| `elevation_10m_study` | Height of the ground every 10 m across the study area (10 m screening), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_curiosity_recent` | Height of the ground every 1 m across the site Curiosity recent path (boxwork area), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_near_base_north` | Height of the ground every 1 m across the site Near base, north (crater floor), in metres. | terrain, routes, solar | derived | local |
| `elevation_1m_near_base_west` | Height of the ground every 1 m across the site Near base, west (crater floor, on Curiosity's early path), in metres. | terrain, routes, solar | derived | local |
| `elevation_2m_trip_area` | Height of the ground every 2 m across the trip area (the base and the near-base sites, for route planning), in metres. | terrain, routes, solar | derived | local |
| `elevation_463m_region` | Coarse ground height for the whole crater, its rim and Mount Sharp, used to work out which hills block the sun. | solar, terrain | derived | local |
| `elevation_point_service` | Ask Mars Trek for the ground height at any clicked point in the study area. | terrain, routes | derived | live |
| `geology_1to60k` | A detailed geologic map of Aeolis Mons (Mount Sharp). | ground | reference | not_used |
| `geology_contacts` | Lines where one geologic unit meets another. | ground | interpretation | local |
| `geology_map_index` | The list (and outlines) of published geologic maps that cover the study area, including unfinished ones. | ground | reference | local |
| `geology_structures` | Mapped landforms such as ridges, scarps and channels. | ground | interpretation | local |
| `geology_units` | What the rock is, from the global geologic map: each area has a unit name and description. | ground | interpretation | local |
| `horizon_curiosity_recent` | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `horizon_near_base_north` | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `horizon_near_base_west` | How high the hills and crater walls rise in every direction, at every 100 m point across the site. | solar | derived | local |
| `ice_swim` | Maps of where buried ice is likely, from several orbiters. | ground | derived | pending |
| `imagery_ctx` | A wider, less sharp photo map covering the whole crater, about 10 m per pixel at the top zoom. | terrain | observation | live |
| `imagery_ctx_mmgis` | The same kind of CTX photo map, served in the MMGIS (Web Mercator) tile grid, about 6 m per pixel. | terrain | observation | live |
| `imagery_hirise_color` | The sharpest colour photo map of Curiosity's area, about 0.32 m per pixel; boulders are visible. | terrain, routes | observation | live |
| `imagery_hirise_gray` | A sharp black-and-white photo map of the study area, about 0.64 m per pixel at the top zoom. | terrain | observation | live |
| `imagery_viking` | A global colour photo map for context, 232 m per pixel. | terrain | observation | live |
| `labels` | Transparent tiles with the names of places Curiosity visited. | routes | reference | live |
| `map_config` | JPL's configuration for the Curiosity map: the list of its layers and their tile addresses. |  | reference | local |
| `minerals_detections` | Places where orbiters (CRISM, OMEGA) detected minerals that formed with water, such as clays and sulfates. | ground | interpretation | local |
| `named_sites` | Outlines of named places Curiosity studied, such as drill sites. | routes | reference | local |
| `optical_depth_history` | How much sunlight the dust and haze above Gale blocked, measured by Curiosity pointing its Mastcam at the Sun, about every few sols for six Mars years, at two wavelengths (880 and 440 nm), with an uncertainty for each value. | solar, thermal | observation | local |
| `perseverance_photos` | Photos from the Perseverance rover. |  | reference | not_used |
| `photos_curiosity_index` | Photos taken by Curiosity at each stop. |  | reference | not_used |
| `radiation_rad` | How much radiation reached the ground at Gale each day, measured by Curiosity's RAD instrument: one sol every 100 sols from 1 to 4800, in microgray per day. | routes | observation | local |
| `relief_mola` | A global shaded-relief map coloured by height, 463 m per pixel, for context. | terrain | derived | live |
| `roughness_1m_curiosity_recent` | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `roughness_1m_near_base_north` | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `roughness_1m_near_base_west` | How bumpy the ground is (metres left over after removing the overall tilt in each 10 x 10 m box; the requirements' detrended roughness, BT-08). | terrain, routes | derived | local |
| `route_animation` | NASA's animated map of Curiosity's planned route. |  | reference | not_used |
| `rover_path` | The line Curiosity actually drove since landing: ground proven to carry a 900 kg rover. | routes, ground | observation | local |
| `rover_position` | Curiosity's latest position. The live link always has today's position. | routes | observation | local |
| `rover_stops` | Every place Curiosity stopped, with its height and how tilted the rover was (roll, pitch, tilt). | routes, ground | observation | local |
| `scenario` | The team's assumptions: base location, candidate sites, facility size and mobility limits. | terrain, ground, solar, thermal, routes | assumption | local |
| `slope_10m_study` | How steep the ground is, in degrees, every 10 m across the study area (10 m screening). | terrain, routes | derived | local |
| `slope_10m_window_curiosity_recent` | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_10m_window_near_base_north` | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_10m_window_near_base_west` | How steep the ground is, in degrees, from a flat plane fitted to every 10 x 10 m box (the requirements' local pad slope, BT-05). | terrain, routes | derived | local |
| `slope_1m_curiosity_recent` | How steep the ground is, in degrees, every 1 m across the site Curiosity recent path (boxwork area). | terrain, routes | derived | local |
| `slope_1m_near_base_north` | How steep the ground is, in degrees, every 1 m across the site Near base, north (crater floor). | terrain, routes | derived | local |
| `slope_1m_near_base_west` | How steep the ground is, in degrees, every 1 m across the site Near base, west (crater floor, on Curiosity's early path). | terrain, routes | derived | local |
| `slope_2m_trip_area` | How steep the ground is, in degrees, every 2 m across the trip area (the base and the near-base sites, for route planning). | terrain, routes | derived | local |
| `space_weather_donki` | Every solar particle storm NASA's space-weather database recorded from Curiosity's landing to today, with the spacecraft that saw it, to find the dates when radiation at Gale could have jumped. | routes | observation | local |
| `sun_table_curiosity_recent` | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `sun_table_near_base_north` | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `sun_table_near_base_west` | Where the sun is in the sky through the year and the day, and how much of the site is in sunlight. | solar | model | local |
| `surface_dust_tes` | A coarse global picture of how dusty the surface is, which affects solar panels and ground conditions. | solar | derived | live |
| `temperature_climate_mcd` | Modelled ground-surface temperature, air temperature 2 m above the ground and air pressure at the base, for every hour of the Martian day through the year, in a typical, a clear, a dusty and a dust-storm year. | thermal | model | local |
| `themis_temp_day_aphelion` | Surface temperature (kelvin) seen from orbit at about 17.0 h local time, season Ls 67, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_day_perihelion` | Surface temperature (kelvin) seen from orbit at about 17.9 h local time, season Ls 259, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_night_aphelion` | Surface temperature (kelvin) seen from orbit at about 6.9 h local time, season Ls 73, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temp_night_perihelion` | Surface temperature (kelvin) seen from orbit at about 6.8 h local time, season Ls 253, every ~100 m across the study area. | thermal, ground | observation | local |
| `themis_temperature_list` | Every THEMIS surface-temperature image covering the study area, with its date, season (Ls) and local time. | thermal | observation | local |
| `thermal_day` | A picture of how warm the ground looks from orbit in the afternoon (bright = warmer), 100 m per pixel. | thermal | observation | live |
| `thermal_inertia_tes` | A coarse global picture of how quickly the ground heats and cools: low hints at dust or sand, high at rock. | ground, thermal | derived | live |
| `thermal_inertia_themis_1km` | How slowly the ground warms and cools, as numbers on a 1 km grid over all of Gale: high means rock or bedrock, low means dust or sand. The best available stand-in for how rocky the ground is. | terrain, ground, thermal | derived | local |
| `thermal_night` | A picture of how warm the ground looks at night; rock and coarse ground stay warmer than dust and sand. | thermal, ground | observation | live |
| `trek_data_stream` | Whole-file downloads of Trek products. |  | reference | not_used |
| `trek_login_tools` | Mars Trek's analysis tools. |  | reference | not_used |
| `water_dan_curiosity` | Curiosity's DAN instrument measures hydrogen (water) in the top metre of ground along its path. | ground | reference | not_used |
| `water_odyssey_grs` | How much water is held in the top few tens of centimetres of soil and rock, as a percent of weight, measured from orbit in 5 degree cells (about 300 km). | ground | derived | local |
| `weather_rems` | Daily air and ground temperature, air pressure, UV level and sunrise/sunset measured by Curiosity, by season. | thermal, solar | observation | local |
| `worldview` | NASA's Earth satellite imagery browser. |  | reference | not_used |
<!-- catalog-table:end -->
