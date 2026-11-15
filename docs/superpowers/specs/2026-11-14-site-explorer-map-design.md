# Mars data-center site explorer: 3D map design

Deadline: NASA Space Apps closes 2026-11-15, 23:59 local time. Decisions agreed with jianhuib on
2026-11-14.

Inputs: the teammate's requirement docs on `main` (`docs/project-plan.md`,
`docs/reference-facility.md`, `docs/requirements/*.md`: 72 metrics, BT/GI/SC/TC/IR, plus
`metric-data-availability.md`), the priority rules in the recommender version of
`docs/project-plan.md` (branch `docs/site-recommender`), the data session's `data/catalog.json`, and
the teammate's approved ARES interface design: `docs/design-guidance.md` with the mockup
`design-reference/mars-copy-balance.html` (Mission brief layout, Cinematic outline typography,
Practical guidance copy). The interface follows that guide; this spec says where the map applies it.

## What we're building

A 3D map of Mars that recommends candidate sites for the base's computing facility in priority
order, shows the reasoning for each, and plans what to check on the ground. It stays as simple as
a map: set up the facility, see the priority list, try the layout on real terrain, and get an
investigation route for everything orbital data can't settle. It ships as a public GitHub Pages
site plus a recorded video.

## The experience

```
Landing ──► 1 Construction brief ──► 2 Facility specifications ──► 3 Location assessment
                                                                   (Globe ──► Region + priority list ──► Site card ──► …)
```

All of it is one continuous map: the user zooms from the whole planet down to a site. Every screen
keeps the ARES header (wordmark left, base context right) and one working panel on the left; the
map takes the rest. A three-step stepper under the header (Construction brief · Facility
specifications · Location assessment) shows where the user is. This follows the teammate's
construction-driven reframe: `docs/design-guidance.md` §7, `docs/construction-project-inputs.md`,
and the "Guided brief" variant of `design-reference/mars-construction-twin-trails.html`.

**Landing:** "Describe your construction project to explore locations for its supporting data
center.", with one primary action that starts the brief. The globe is live behind it.

**1 Construction brief** (the left panel, globe still interactive): the Guided brief's four tabs,
pre-filled with its editable example ("Gale landing pad & access road", 20 robots):
- **Project:** name, what you're building (multi-select), and survey area and road length as
  known / range / unknown. The construction location is the study region with the site not yet
  selected.
- **Robots:** groups by main task (survey, excavation, transport, assembly, inspection), each with
  total and active counts, and the fleet total.
- **Operations:**
  - operating time (h / sol), project duration and construction precision;
  - "results needed within" (hours), the required processing outputs and their frequency;
  - what to do if a result is late.
- **Review before sizing:** the brief summary, "Still to confirm", and the five factors marked
  "Awaiting sizing".

A "Project brief" summary sits beside the tabs. Every quantity accepts known, range or unknown.
The brief is recorded and shown; it never changes a status or the priority, because the sizing
model is planned and not implemented.

**2 Facility specifications:**
- The facility calculated from the brief is listed, labelled exactly "Calculated from your brief
  with screening assumptions — not a validated design.", and the step states that results are kept
  for the whole project. The map places that facility's outlines.
- The reference label applies to the legacy reference facility only; it is never presented as an
  estimate from the brief.

**3 Location assessment:** the globe, regions, priority list and site cards below. Their headers
carry the brief's name.

**Globe:** Mars in Viking colour, colour-graded to the mockup's warm rust brown. The grading is
for display only, and the References page says so. Pins for Gale, Jezero and Arcadia Planitia, one
per region in the catalog. Each pin shows its sites in priority order, one row per site with the five
factor icons. A region without site data would read
"needs confirmation". Drag to spin, scroll to zoom toward the cursor; the mockup's arrow and +/−
buttons do the same from the keyboard. The globe never spins on its own.

```
        ● Jezero  1 jezero_north …  1 jezero_south …
  ● Gale  1  near_base_north  ✓ ✓ ✓ ? —  · 2 critical unknowns
          1  near_base_west   ✓ ✓ ? ? —  · 2 critical unknowns   (equal: trade-off named)
          2  curiosity_recent ✗ ✓ ? ? —  not recommended (BT-21)        ● Arcadia  1 arcadia_north …
```

**Region + priority list:** CTX imagery streams in as you zoom. Site pins carry their priority and
icons; the left panel ("Explore areas", with the focus line and "Compare the tradeoffs, then select
an area to see what needs checking.") holds the priority list. Each candidate card shows its
priority, name and one reason to investigate it in plain words; selecting it shows its next check.
The list updates live when a layout or a field record changes.

**Three looks, five factor views.** The panel's only view control is the three looks. They are the
universal ways to read a 3D model, taken from `design-reference/map-prototype/` and its
screenshots. Each look is its own scene, with its own camera and background, and the globe fades
while a site is open:

- **Diorama:** the site lifted out as a terrain block, with solid brown sides, a soft shadow on a
  dark plinth, the warm tinted photo and an oblique camera. This is the lift-out.
- **Survey sheet:** a light paper scene, terrain coloured by the slope blue ramp with the 5° tick,
  dark 10 m contours, light block sides and a steep, near top-down camera.
- **Helmet HUD:** a dark scene with the dimmed true-grey photo, cyan 5 m contours, cyan line walls,
  a grid floor and a low oblique camera.

The panels keep the ARES style in every look, and nothing glows. Footprints always use the
assessment colours. The five factors live only in the site card's vertical list. Each row's "View"
lays that factor's data over the current look (site scale), and selecting it again turns it off.

The five factors are the project plan's own:

| Factor (on screen) | Requirement doc | Its view of the same map |
|---|---|---|
| Terrain | Buildable terrain (BT) | Slope colouring (10 m window) with the 5° and 10° limits marked; dune fields |
| Ground & ice | Ground and ice evidence (GI) | Odyssey GRS water-equivalent hydrogen tint, geology units, THEMIS thermal inertia |
| Solar | Solar conditions (SC) | Terrain lit by the sun from the site's sun table; a skyline chart of horizon and sun paths |
| Thermal | Thermal conditions (TC) | THEMIS surface temperature (day/night, aphelion/perihelion) where it covers |
| Routes | Investigation routes (IR) | The cable route to the base with its length, the rover's traverse and stops, trip-area slope |

- Each view has a one-line key in the panel saying what the colours mean and where the data comes
  from.
- Where the data behind a view is thin, the view is labelled **Demo** and its key says what it rests
  on. Thin data means coarse (Odyssey GRS pixels are hundreds of km), partial (some THEMIS cases
  only), model-based, or not collected yet (SWIM ice). The References page lists every demo part. A
  demo view is for showing the idea; it never changes a status or the priority.
- A view never borrows another region's data. Where a region has none, it says so ("No
  thermal-imaging data covers this site: needs confirmation").

**Site card:** HiRISE imagery on 3D terrain from the site's 1 m elevation grid, set into the globe
surface. The facility layout is placed on the best spot automatically; the user can drag and
rotate it, and the checks and priority update live. The left panel becomes the site card, in plain
words first and expert detail on demand:

- **Header:** priority and a plain verdict, e.g. "Not recommended: the layout is too steep" or "No
  failures; 4 factors still need field checks".
- **Five factor rows**, one per factor, each with its icon and a plain sentence:
  - "Terrain: meets the screening criteria";
  - "Ground & ice: not settled from orbit: needs a ground-strength test and an ice survey";
  - "Solar: …".

  A row's "View" switches the map to that factor's view. Its "Details" disclosure lists the
  factor's metrics: id, name, value, baseline/ideal target, evidence chip and what settles it.
  Metric ids such as BT-04 appear only inside Details.
- **Why this priority:** in plain words.
- **Next check.**
- **"Lift out as diorama"**, which turns the site into the prototype's block view (sides, plaque,
  callouts, profile chart).

Plain sentences come from a short phrase per computed metric, e.g. BT-05 "too steep in places
under the compound" and BT-02 "the layout doesn't fit on usable ground". Unresolved metrics are
summarised by what settles them.

```
┌ Near base, north · Gale crater · Priority 1 ─────────────────────┐
│ No failures; 4 factors still need field checks                   │
│ ✓ Terrain       meets the screening criteria        View  Details│
│ ? Ground & ice  needs a ground-strength test, ice survey  View ▸  │
│ ? Solar         shading 3% (model); energy needs design  View ▸   │
│ ? Thermal       2 of 4 temperature cases observed    View ▸       │
│ ? Routes        cable 634 m to base; route not planned  View ▸    │
│ Why this priority: no failures; less grading and a shorter cable │
│ than Near base, west                                             │
│ Next check: ground-strength test at the compound                 │
└──────────────────────────────────────────────────────────────────┘
```

**Trip plan and walk** (built in the navigation lane, see *Integration with the navigation lane*):
"Plan route" turns the site's open field checks into stops and plans a route from the base, on
foot (EVA) or rover-assisted, with travel time and flagged segments. The trip panel sits in the
site panel; the route is drawn on the site terrain. "Walk" switches the same map into a
first-person helmet view along the route and back.

**Record:** at a stop, enter a field result (a value or pass/fail, plus a note). The metric
switches to a field-backed status. Records export and import as JSON; nothing is stored on a server.
Tags from the walk are saved as notes labelled SIMULATED and never change a status.

**Compare:** "Compare" lifts two sites out side by side as diorama blocks on a shared height
scale, with their cards next to each other.

## Facility setup

One fixed case, the reference facility from `docs/reference-facility.md`: 150 kW IT (225 kW
total facility load), firm base power plus a solar top-up. The user doesn't choose a size or power
option. It is shown as "Illustrative reference — not calculated from your project." wherever its
numbers appear. That label applies to the reference facility only; the facility calculated from the
brief carries "Calculated from your brief with screening assumptions — not a validated design." Every number is a scenario assumption and sits in the intake's Assumptions disclosure: "Base
services included. Firm power plus supplemental solar assumed; capacity unverified. Facility sizing
requires workload validation." The disclosure then lists the facility and its plots.

Placed footprints:

- core compound 60 × 60 m (six 12 × 4 m modules);
- radiator plot 60 × 64 m, north of the compound;
- solar plot 100 × 100 m, south of it.

## Status rules

- Each metric has one status: `met` (with an "ideal" badge if it also meets ideal), `not met`,
  `needs fieldwork`, `needs design input`, `needs confirmation` (no data here) or `not applicable`.
- On screen, each status has the design guide's colour and label:
  - met: `#B8DFC2`, "Meets screening criterion", with an "ideal" badge;
  - not met: `#FFB19B`, naming the specific conflict (e.g. "Pad slope 6.4° over the 5° target");
  - unresolved: `#E3C78F`, "Unresolved" plus the missing measurement (needs fieldwork / design
    input / data);
  - not applicable: quiet text, with a reason.

  Colour is never the only cue: each status also has its label and icon.
- If a value's uncertainty straddles the threshold, the status is `needs fieldwork`.
- **Factor icon** covers only metrics orbital data can settle at the site: ✗ if any is not met,
  ? if any is unresolved, ✓ if all are met, — if none apply. Field-check metrics never make it ?;
  they show as "N field checks to confirm". If a factor has no orbital estimate at a site, the
  card shows a deterministic **simulated** estimate (✓/✗/?), with a "Simulated" chip and "Simulated
  for the demo: …". Simulated values never change a status, the priority or the verdict, and the
  References page lists them under Demo parts. A factor view with no data shows a simulated
  overlay labelled "Simulated view: data not collected for this site". Icons carry the factor's plain name
  (Terrain, Ground & ice, Solar, Thermal, Routes), never a BT/GI/SC/TC/IR code. Counts of fieldwork
  and design items live in the factor's Details.
- Thresholds are the teammate's baseline and ideal benchmarks, shown next to every value. Where a
  design-dependent benchmark needs a number we don't have, it comes from the facility assumptions or
  `data/scenario.json` and is labelled an assumption (e.g. BT-08 `R_allow` = 0.3 m).
- `web/metrics.json` holds all 72 metrics, transcribed from the teammate's docs: id, factor, name,
  unit, P/D, baseline, ideal, availability label and where it applies (compound, radiator plot,
  solar plot, route, whole site). The starting status comes from the availability label:
  - "estimate today": computed (launch set below), otherwise `needs confirmation`;
  - "partial" or "field data needed": `needs fieldwork`;
  - "planning calculation": `needs design input`.
- Every value carries its evidence label (observation, derived, model, interpretation,
  assumption, reference). Missing data never reads as fine. No blended score or weights. No
  invented reactor site. Routes are planning scenarios, not certified safe. No fake boulders or
  subsurface layers.

## Priority list

The four steps from the project plan, applied in order to the sites in a region. No weights, no
score; each card says which step placed it.

1. **Failures last.** A site with any "fails current target" goes below every site without one,
   marked "not recommended under the stated requirements" and naming the target. Those sites
   share the lowest priority.
2. **Then critical unknowns.** A critical unknown is an unresolved metric that could still turn
   into a failure at this site: needs fieldwork, or an estimate whose uncertainty straddles the
   target. "Needs design input" items stay open but don't separate sites. Fewer critical unknowns
   goes higher.
3. **Then effort and risk.** Compared on grading (BT-06), cable length (BT-21), shading (SC-01)
   and dune setback (BT-15). A site goes higher only if it's no worse on all of them and better
   on at least one.
4. **Otherwise equal.** Sites no step separates share a priority, and their cards name the
   trade-off.

## Metrics computed in the browser (launch set)

| Metric | From | How |
|---|---|---|
| BT-01 connected area ratio | slope grid | usable connected area under the layout vs required area |
| BT-02 complete layout fit, SC-10 array fit, TC-08 radiator fit | grid + footprints | every footprint on usable terrain, no overlap; SC-10 and TC-08 report the solar and radiator plots |
| BT-04 overall pad slope | elevation grid | plane fit over the core compound |
| BT-05 max local pad slope | `slope_10m_window` | max under the compound |
| BT-06 max grading or support correction | elevation grid | largest deviation from the compound's fitted plane |
| BT-08 detrended roughness | `roughness_1m` (10 m boxes) | max under each footprint; flagged near the noise floor |
| BT-21 utility route length | layout + base | cable length to base |
| SC-01 terrain-shading loss | `horizon` + `sun_table` | share of daytime sun blocked at the solar plot |
| SC-03 average solar contribution, SC-04 worst-season adequacy | `sun_table` + dust (Mars Climate Database, Mastcam optical depth) + facility load | array output against the facility load, yearly average and worst season (model) |
| TC-01 surface temperature cases | THEMIS day/night grids where they cover the radiator plot, Mars Climate Database otherwise | day/night × aphelion/perihelion; cooling metrics stay "needs design input" |
| BT-15 dune setback, BT-16 dune movement | `dune_fields` + measured dune shifts | distance from layout to the nearest dune edge and measured movement rate; status stays "needs fieldwork" |
| GI-05 ice | Odyssey GRS hydrogen | background value only; SWIM ice data is pending, so "needs confirmation" |

Route metrics (BT-18, IR-*) come from the navigation lane's route object and are shown in the
same panel.

**Best spot** (initial layout position): inside a catalog site, every footprint on usable terrain,
then fewest cells over the slope limit, then nearest to the base. Searched on a 5 m grid. It
places the layout within a site; the priority list compares sites.

## Data the map reads

Only `data/catalog.json` and the files it lists:

- `areas`: region bounds, `base` point, `sites` (today: `near_base_north`, `near_base_west`,
  `curiosity_recent` at Gale), `trip_area` (2 m elevation and slope around base and near-base
  sites). `areas.regions` lists Gale, Jezero and Arcadia, each with its own base, sites and trip
  area; their datasets carry a `__jezero` / `__arcadia` suffix and are found the same way (by
  metric id and coverage area). CTX and HiRISE imagery is Gale-only; Jezero and Arcadia sites are
  shaded from their elevation.
- The catalog is in the repo; the files it lists (about 560 MB, mostly elevation) are snapshot
  output in the local `data/` folder, which `serve.py --data` and `package.py` read.
- Per site: `elevation_1m`, `slope_1m`, `slope_10m_window`, `roughness_1m`, `horizon` and
  `sun_table` datasets. Each has `metrics` (requirement ids it informs) and `method`. The map finds
  data by metric id, not by hard-coded dataset name.
- Grid files: f32 with `grid {width, height, bounds, pixel_deg, byte_order, nodata, crs}`; overlay
  PNGs with `bounds` and `legend`.
- Live layers: a `live` block `{url_template, scheme, min_zoom, max_zoom, cors}`. Schemes `wmts-eq`
  (Trek), `tms-webmercator` (MMGIS), `arcgis`, `json-api`. The globe's image layers come from these.
- `references` (credit lines): the References page's "data on screen" and "all the data" parts.
- `alignment` flags: a caveat chip wherever a flagged dataset's values appear.

## Visual design

Everything follows `docs/design-guidance.md`. These are the places the map applies it:

- **Theme:** dark only, with the guide's tokens (`space` `#070B0F`, `panel` `#111920`, `accent`
  `#EDC49B` and the rest).
- **Panels:** opaque, 1 px border, 12 px radius. One working panel on the left (about 360 px)
  carries the intake, then the results, then the site card, so the map keeps the largest share.
- **Header:** about 80 px tall.
  - Left: the outlined "ARES" wordmark and "Mars data center explorer".
  - Right: base context, the base of the region in view and "Demo".
- **References**, one disclosure at the bottom left on every screen, replaces the separate
  legend, chip key and credits. It has three parts:
  - how to read the map: status colours and icons, footprint colours and the evidence chips;
  - the data on screen, each source with its NASA/USGS link;
  - all the data, grouped, with links;
  - **demo parts:** which views or layers are illustrative because the data isn't fully
    collected, and what each one rests on.

  The current view's one-line key stays in the panel.
- **Text:**
  - Audiowide only for the wordmark, the landing headline and panel headings.
  - Space Grotesk for the rest, never under 12 px.
  - Tabular numerals for values.
  - Sentence case.
- **Controls:**
  - One filled accent button per task region.
  - Secondary buttons with a quiet border.
  - Visible focus rings and touch targets of at least 44 × 44 px.
- **Footprints:** upright and translucent. Move and rotate controls sit on the selected footprint.
  - A failing check highlights the footprint it concerns and explains the problem in the card.
  - Dragging a footprint never moves the camera, and camera gestures never move a footprint.
  - Keyboard: arrows move the selected layout and `[` `]` rotate it.
- **The base** stays visible as a marker in region and site views.
- **Motion:**
  - Fly-tos are brief and become instant under reduced motion.
  - No automatic spin, starfields, glowing text or console framing.
- **Lift-out diorama and compare** use the same tokens and type.
- **Imagery that fails to load** shows an honest fallback, never a stand-in that looks like terrain.

## Tech stack

- **three.js 0.170**, as in the prototype, for every level.
- **NASA-AMMOS `3d-tiles-renderer` 0.5.4** for the continuous globe (proven in
  `prototypes/globe-spike/`): Mars sphere (r = 3,396,190 m) via `GeneratedSurfacePlugin`
  (EPSG:4326); Viking, CTX and HiRISE stacked with `ImageOverlayPlugin`, each fenced to its
  coverage box; `GlobeControls`. Vendored, with the three addons it needs, as a browser-ready copy
  that imports the app's own `three`.
- CTX and HiRISE are greyscale: tint them to the Viking colour (edges stay hard). The site
  terrain gets skirts down to the globe surface so it doesn't read as a raised slab.
- Plain ES modules and an import map; no framework, no build step. Libraries and fonts live in
  `web/vendor/`.
- Fonts: Audiowide (display) and Space Grotesk (everything else), vendored as woff2 with their OFL
  licences; no font CDN.
- Python only for `web/serve.py` (local, 127.0.0.1) and `web/package.py` (Pages build), plus
  Playwright screenshot checks.

## Code layout

- Branch `feat/site-explorer-map`. `web/` at the repo root: `index.html`, `src/*.js`, `vendor/`,
  `metrics.json`, `serve.py` (`--data` path to the data folder), `package.py`.
- Modules: `catalog`, `state`, `globe`, `site` (terrain mesh, embed and lift-out), `checks` (live
  terrain metrics, Web Worker if slow), `layout`, `records`,
  `ui/` (landing and intake, pins, panel, factor bar and views, callouts, readout, references). `src/route/` and `src/walk/`
  belong to the navigation lane.
- Reuse from `design-reference/map-prototype/`: terrain mesh, block sides, callout collision culling,
  hover readout, profile chart, evidence chips, palette.
- Site meshes sit in a local east-north-up frame at the site centre. Use a log depth buffer if
  planet-to-metre depth precision shows artefacts.
- When a site is open, the trip-area grid (2 m, covering the base and both near-base sites) is
  drawn as lower-detail terrain around the site box, so the base and the route have ground under them.

## Integration with the navigation lane

Names are provisional until both designs are approved.

- The map provides: `loadCatalog`, `getSite` (grids found by metric id, plus `tripArea`: the
  finest elevation grid covering base and site, and `catalog` and `baseUrl` so the route module
  can load its own files), `buildTerrainMesh`, `siteFrame`
  (`toLocal`/`toLonLat`/`heightAt`, true-scale metres), `layout.footprints` with
  `onLayoutChange`, and `statuses` with `onStatusChange`.
- The navigation lane provides: `planRoute({site, layout, base, mode, statuses, order})`,
  `drawRoute(route, siteRoot)` returning a THREE.Group, `renderTripPanel(route, container,
  {onChange})`, `enterWalk(route, siteContext)` / `exitWalk()` with `siteContext = {renderer, scene,
  root, terrain, tripTerrain, frame, hudRoot, site, onTag}`. Stops have stable ids and
  `metricIds`; route metrics use the map's status words.
- Route results (including IR-05/IR-06 "doesn't fit one excursion") show on the site card but
  don't affect priority, because their limits are placeholders.
- `web/vendor/three/` (r170) is shared; the navigation lane imports `three` from it.
- Vertical exaggeration is a y-scale on the site root group; it's set to 1 during the walk.
- The map re-plans on site open, layout drag end, trip-panel change and saved field
  record, never on a route-derived metric. Until `src/route/` exists, "Plan route" is hidden.
- `src/route/datasets.json` and `src/walk/datasets.json` list the catalog dataset ids the
  navigation lane needs; `package.py` ships those files along with the map's own (including the
  2 m trip-area grids unchanged).

## Publishing

- `web/package.py` builds `web/dist/`: the app, a trimmed catalog and only the files the map uses,
  shrunk for the web (1 m grids to 2 m, overlays as JPG/PNG). Under 100 MB per file, about 300 MB total.
- Deploy `web/dist/` to the `gh-pages` branch, after jianhuib's go-ahead. Relative URLs, so the
  same build runs locally and on Pages. After deploy, check the page and a data file load anonymously.
- Trek tiles load straight from the browser (CORS allowed). An optional local tile cache in
  `serve.py` is for recording the video only.

## Priorities

- **Must:** ARES landing and intake; continuous globe with three pins; Gale sites with auto-placed layout, live
  checks, priority list and site cards, lift-out diorama; trip-area terrain and the hooks for the trip panel
  and walk; evidence labels and credits; `web/metrics.json`; GitHub Pages build and deploy.
- **Should:** the five factor views; SC-03/SC-04 solar energy, TC-01 temperatures, dune setback;
  record field results.
- **Stretch:** compare two sites side by side; region relief from `elevation_463m_region`; local
  tile cache.

## Verification

Headless Chromium screenshots of globe, region, site and lifted diorama; zero console
errors; a scripted hover and a scripted layout drag that changes a metric. Run the same checks on
`web/dist/` locally, then on the live Pages URL.

