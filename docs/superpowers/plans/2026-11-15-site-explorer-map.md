# Site Explorer Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, browser-only 3D Mars map that zooms from the globe to Gale's candidate sites, places the
data-center layout on real terrain, recommends sites in priority order with a reasoned site card, and hosts
the navigation lane's trip planner and walk.

**Architecture:** Plain ES modules under `web/src/`, an import map, vendored three.js r170 and
NASA-AMMOS `3d-tiles-renderer` 0.5.4. Pure logic (catalog, layout, checks, status, priority, records) is
DOM-free and unit-tested in headless Chromium through a tiny in-page runner driven by pytest. Rendering
modules (globe, site, diorama, UI) are checked by Playwright flows and screenshots. Python only serves files
locally and packages the GitHub Pages build.

**Tech Stack:** three.js r170, 3d-tiles-renderer 0.5.4 (GeneratedSurfacePlugin, ImageOverlayPlugin,
XYZTilesOverlay, GlobeControls), CSS2DRenderer, Python 3.9 + pytest + Playwright 1.60.0 (Chromium headless
shell, SwiftShader).

**Spec:** `docs/superpowers/specs/2026-11-14-site-explorer-map-design.md`. Reference code:
`prototypes/terrain-diorama/web/app.js` (diorama look) and `prototypes/globe-spike/web/app.js` (globe,
site placement, drape, drag; proven 2026-11-15).

## Global Constraints

- No Node, no bundler, no framework. Every library is vendored under `web/vendor/`; at run time the only
  network requests go to the app's own origin and to catalog `live` layers whose `cors` is `"*"`.
- `web/vendor/three/` (r170) is shared with the navigation lane; never change those files.
- Never create or edit files under `web/src/route/` or `web/src/walk/` (navigation lane).
- Local servers bind `127.0.0.1` only.
- Committed files contain no absolute local paths, secrets or internal links. The snapshot data folder is
  passed as `--data <dir>` or `MARTIAN_MAP_DATA=<dir>`.
- Mars sphere radius `R = 3396190` m (IAU Mars 2000, the catalog CRS).
- Internal status codes: `met`, `not_met`, `needs_fieldwork`, `needs_design_input`, `needs_confirmation`,
  `not_applicable`, plus `ideal: boolean` on `met`. Display words: meets ideal, meets baseline, fails current
  target, unresolved (needs fieldwork / design input / data), not applicable (with a reason).
- Evidence labels: `observation`, `derived`, `model`, `interpretation`, `assumption`, `reference`.
- Every scenario number on screen carries an `assumption` chip. Missing or failed data never reads as fine.
- No blended score, no weights. Site order comes only from `prioritize()` (Task 6).
- Simulated walk tags are notes labelled SIMULATED and never change a status.
- Pages build: each file < 100 MB, total ≤ 300 MB, relative URLs only. First push to `gh-pages` only after
  jianhuib's explicit go-ahead.
- Python that reads snapshot data runs with `-I`.

**Commands used by every task:**
- Unit suite: `.venv/bin/python -m pytest tests/test_web_map.py tests/test_web_tools.py -v -k "not real"`
- Real-data suite and app flows: `MARTIAN_MAP_DATA=<snapshot data folder> .venv/bin/python -m pytest tests/test_web_map.py -v`
- Screenshots go to `tests/artifacts/` (gitignored).

## Review Focus

1. **Gaps in the elevation grid under the layout** (NaN cells): they must count as unusable and, above 5%
   of a footprint, turn terrain metrics into `needs_confirmation`; never a silent pass. Test in Task 5.
2. **Dragging or rotating the layout across the site edge:** every footprint must stay inside the site
   bounds (clamped), and the checks must never sample outside the grid. Test in Task 4.
3. **The 1 m → 2 m reduction in the Pages build hiding a failure:** slope and roughness reduce by max,
   elevation by mean, so one steep 1 m cell stays steep. Test in Task 13.
4. **A data file or tile fetch failing** (NASA host down, file missing from the build): the app keeps
   running, the affected metrics read `needs_confirmation` with "data failed to load", and there are no
   uncaught errors. Test in Task 3.
5. **Importing a malformed or foreign records file:** rejected with a message and no state change;
   simulated tags never alter a status. Test in Task 11.

---

## File Structure

| File | Responsibility |
|---|---|
| `requirements-web.txt` | `pytest`, `playwright==1.60.0` |
| `web/serve.py` | loopback dev server: `/data/*` from `--data`, everything else from `web/` |
| `web/package.py` | builds `web/dist/` for GitHub Pages |
| `web/tools/build_metrics.py` | parses the requirement docs into `web/metrics.json` |
| `web/metrics.json` | the 72 metrics (generated, committed) |
| `web/datasets.json` | catalog datasets the map ships |
| `web/index.html` | page shell, import map, panels' DOM roots |
| `web/styles.css` | diorama look carried over from the prototype |
| `web/src/main.js` | boot: catalog → store → globe → UI wiring; `window.__map` debug hooks |
| `web/src/catalog.js` | load catalog, find grids by metric id, build `Site` |
| `web/src/state.js` | tiny store with keyed subscriptions |
| `web/src/layout.js` | footprint sizes, placement, clamping, cell iteration, best spot |
| `web/src/status.js` | status rules, display words, factor icons, initial statuses |
| `web/src/checks.js` | terrain metrics (BT-01/02/04/05/06/08/21, SC-10, TC-08) |
| `web/src/environment.js` | SC-01/03/04, TC-01, BT-15/16, GI-05 |
| `web/src/priority.js` | the four priority steps, verdicts, "why here" |
| `web/src/records.js` | field results + simulated tags, localStorage, export/import |
| `web/src/frame.js` | `siteFrame(site)`: sphere ENU frame, y-up |
| `web/src/globe.js` | TilesRenderer on Mars, overlays, GlobeControls, flyTo, pins |
| `web/src/site.js` | terrain + trip meshes, drape, skirts, exaggeration, layout meshes, drag/rotate |
| `web/src/diorama.js` | lift-out: walls, plaque, callouts, profile chart |
| `web/src/layers.js` | region layers (geology, dunes, traverse, THEMIS, slope) |
| `web/src/nav.js` | host side of the navigation lane |
| `web/src/ui/*.js` | `setup`, `pins`, `list` (priority list), `card` (site card), `chips`, `callouts`, `credits`, `legend` |
| `web/tests/harness.js`, `runner.html`, `suites.js`, `fixtures.js` | in-page test runner |
| `web/tests/*.test.js` | unit and real-data tests |
| `web/tests/fixtures/route-stub/` | stand-in navigation lane module for host tests |
| `tests/test_web_map.py` | pytest driver: server, Playwright, suites, app flows |
| `tests/test_web_tools.py` | pytest for `build_metrics.py`, `package.py`, `serve.py` |

## Shared Types (every task uses these names)

```js
// Grid: one raster from the catalog
{ datasetId, data /* Float32Array | Uint8Array */, width, height, bounds /* [w,s,e,n] deg */,
  pixelDeg /* [dx,dy] */, nodata /* NaN | number */, resolutionM, evidence, bands? }
// Site
{ id, name, bounds, base: {lon, lat}, grids: { elevation, slope10, roughness }, tripArea /* Grid|null */,
  horizon /* Grid with bands=360 | null */, sunTable /* object | null */, catalog, baseUrl,
  loadErrors /* {datasetId: message} */ }
// Setup
{ loadKw: 60 | 150 | 250, power: 'topup' | 'base_only' | 'solar_batteries' | 'solar_fission' }   // the app uses FIXED_SETUP = {loadKw: 150, power: 'topup'} (Task 9b)
// Placement and Layout
{ centerLon, centerLat, rotationDeg }
{ placement, footprints: [{ id: 'compound'|'radiator'|'solar', w, h, center: {lon, lat}, rotationDeg,
  polygon: [[lon,lat] x4] }] }
// Result (one metric at one site)
{ id, value /* number|null */, unit, display, target: { baseline, ideal, label }, status, ideal,
  evidence, note, assumption /* bool */, straddles /* bool */, appliesTo /* from metrics.json */ }
```

---

### Task 1: Test runner, loopback server and pytest driver

**Files:**
- Create: `requirements-web.txt`, `web/serve.py`, `web/tests/harness.js`, `web/tests/runner.html`,
  `web/tests/suites.js`, `web/tests/fixtures.js`, `web/tests/smoke.test.js`, `tests/test_web_map.py`,
  `tests/test_web_tools.py`

**Interfaces:**
- Produces: `make_server(web_dir: Path, data_dir: Path | None, port: int = 0) -> ThreadingHTTPServer`
  (in `web/serve.py`, bound to `127.0.0.1`, `Cache-Control: no-store`, `/data/…` → `data_dir`).
  CLI: `python web/serve.py --data <dir> [--port 8770]`.
- Produces (JS): `test(name, fn)`, `skip(name, reason)`, `assert(cond, msg)`, `assertEq(a, b, msg)`,
  `assertClose(a, b, tol, msg)`, `runAll()` → sets `window.__results = {passed, failed: [{name, message}],
  skipped: [name], done: true}`.
- Produces (JS fixtures): `makeGrid({width, height, bounds, fn: (col, row) => value, nodata = NaN})`,
  `fixtureCatalog()`, `fixtureSite(overrides)`. The fixture site is 400 × 400 cells at 1 m, centred on
  (137.44, -4.57), base 300 m south of its south edge.
- Produces (pytest): fixtures `server_url` (session; serves `web/` and `MARTIAN_MAP_DATA` if set),
  `page` (Chromium launched with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`,
  collecting console errors), helpers `run_suite(page, url, suite) -> dict`, `wait_ready(page)` (awaits
  `window.__map.ready`) and `record_request_hosts(page) -> set[str]` (hostnames of every request). The module skips when
  Playwright can't be imported or Chromium won't launch; the `real` suite skips when `MARTIAN_MAP_DATA`
  is unset.

- [ ] **Step 1: Install test tools.** `.venv/bin/pip install -r requirements-web.txt`. Browsers are
  already in `~/.cache/ms-playwright`; if not, `.venv/bin/python -m playwright install chromium-headless-shell`.
- [ ] **Step 2: Write failing tests.**

```python
# tests/test_web_tools.py
def test_server_binds_loopback_only(tmp_path):
    srv = serve.make_server(WEB, tmp_path)
    assert srv.server_address[0] == "127.0.0.1"
def test_server_maps_data_prefix(tmp_path):  # GET /data/x.json returns tmp_path/x.json, no-store header
def test_server_rejects_traversal(tmp_path):  # GET /data/../serve.py is 404
# tests/test_web_map.py
def test_unit_suite(page, server_url):
    r = run_suite(page, server_url, "unit")
    assert r["failed"] == [] and r["passed"] > 0 and page.console_errors == []
def test_real_suite(page, server_url):  # same for "real"; skipped without MARTIAN_MAP_DATA
```

```js
// web/tests/smoke.test.js
test('harness: assertClose tolerates', () => assertClose(1.0, 1.04, 0.05));
test('fixtures: makeGrid samples fn', () => { const g = makeGrid({width: 3, height: 2, bounds: [0,0,3,2], fn: (c, r) => c + 10 * r}); assertEq(g.data[4], 11); });
```

- [ ] **Step 3: Run, see them fail.** `.venv/bin/python -m pytest tests/test_web_tools.py tests/test_web_map.py -v`
  → FAIL (no `serve.py`, no runner).
- [ ] **Step 4: Implement** the server (subclass `SimpleHTTPRequestHandler`; `translate_path` maps `/data/`
  to `data_dir`; resolved paths outside the roots → 404), the harness, `runner.html?suite=unit|real[&grep=]`
  (import map: `three` → `../vendor/three/three.module.js`, `three/addons/` → `../vendor/three/addons/`,
  `3d-tiles-renderer/three` and `/three/plugins` → `../vendor/3d-tiles-renderer/…` once Task 7 vendors them)
  and `suites.js` (`export const SUITES = {unit: [...], real: [...]}` of module URLs).
- [ ] **Step 5: Run, see them pass.** Same command → PASS (real suite PASS or SKIP).
- [ ] **Step 6: Commit.** Add `tests/artifacts/` to `.gitignore`, then `git add .gitignore requirements-web.txt web/serve.py web/tests tests/test_web_map.py tests/test_web_tools.py && git commit -m "test: in-page runner, loopback server and pytest driver for the map"`

### Task 2: `web/metrics.json` from the requirement docs

**Files:**
- Create: `web/tools/build_metrics.py`, `web/metrics.json`
- Test: `tests/test_web_tools.py`

**Interfaces:**
- Produces: `web/metrics.json` = `{"metrics": [{id, factor, name, definition, unit, pd, baseline, ideal,
  availability, appliesTo}]}` sorted by id.
  - `factor`: `BT|GI|SC|TC|IR`.
  - `pd`: `"P" | "D" | "D/P" | null`, from the leading `**P:**`/`**D:**`/`**D/P:**` of the baseline cell.
  - `baseline`, `ideal`: cell text with `**` removed.
  - `unit`: text after the last comma of "Definition and unit" if it is ≤ 6 characters, else `""`.
  - `availability`: `estimate_today | partial | field_needed | planning`, from the "Available today?" cell
    of `docs/requirements/metric-data-availability.md`. Match the text before the first `:` by prefix:
    "Estimate today…" → `estimate_today`, "Partial" → `partial`, "Field data needed" → `field_needed`,
    "Planning calculation…" → `planning`.
  - `appliesTo`: by factor, BT → `layout`, GI → `compound`, SC → `solar`, TC → `radiator`, IR → `route`.
    Overrides: BT-17, BT-18, BT-19, BT-20 → `route`; GI-06 → `layout`.
- CLI: `.venv/bin/python -I web/tools/build_metrics.py --docs docs/requirements --out web/metrics.json`.

- [ ] **Step 1: Write failing tests.**

```python
def test_metrics_json_has_all_72():
    m = build_metrics.build(DOCS)
    assert len(m) == 72 and len({x["id"] for x in m}) == 72
def test_metrics_fields_for_bt01():
    bt01 = by_id(build_metrics.build(DOCS), "BT-01")
    assert bt01["pd"] == "P" and bt01["baseline"] == "P: ≥ 1.0" and bt01["ideal"] == "P: ≥ 1.3"
    assert bt01["availability"] == "estimate_today" and bt01["appliesTo"] == "layout"
def test_availability_values_closed_set():  # every entry in the 4 values; GI-01 field_needed; SC-02 planning
def test_committed_metrics_json_is_current():  # build() == json.load(web/metrics.json)["metrics"]
```

- [ ] **Step 2: Run, see them fail.** `.venv/bin/python -m pytest tests/test_web_tools.py -k metrics -v`
- [ ] **Step 3: Implement** `build(docs_dir: Path) -> list[dict]` and `main()`. Parse the tables whose
  header row is `| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |`
  in the five factor docs. The id is the first token of column 1; the name is the rest.
- [ ] **Step 4: Generate and pass.** Run the CLI, then the tests → PASS.
- [ ] **Step 5: Commit.** `git add web/tools web/metrics.json tests/test_web_tools.py && git commit -m "feat(map): metrics.json from the requirement docs"`

### Task 3: Catalog loading and `Site`

**Files:**
- Create: `web/src/catalog.js`, `web/datasets.json`
- Test: `web/tests/catalog.test.js` (unit), `web/tests/catalog.real.test.js` (real)

**Interfaces:**
- Produces: `loadCatalog(baseUrl = './data/', {fetch} = {}) -> Promise<Catalog>` and
  `catalogFromRaw(raw, scenario, baseUrl, fetchImpl) -> Catalog`, where `Catalog = {raw, baseUrl, fetch,
  byId: Map, areas, sites: [{id, name, bounds}], scenario}`. `scenario` is `baseUrl + 'scenario.json'`.
  Every file load goes through `catalog.fetch(new URL(file.path, baseUrl))`.
- Produces: `findGrid(catalog, metricId, areaId) -> datasetEntry | null`. Picks datasets whose `metrics`
  include `metricId`, whose `coverage.area === areaId` and that have an `f32` file; finest `resolution_m` wins.
- Produces: `findTripGrid(catalog, site) -> datasetEntry | null`. Picks datasets whose `metrics` include
  `BT-17`, that have an `f32` file, and whose bounds contain both `areas.base` and the site box; finest
  `resolution_m` wins.
- Produces: `loadGrid(catalog, entry, format = 'f32') -> Promise<Grid>`. Reads `u8` with `grid.bands`
  for the horizon.
- Produces: `getSite(catalog, siteId) -> Promise<Site>`.
  - `elevation` = findGrid(…, 'BT-04', id); `slope10` = 'BT-05'; `roughness` = 'BT-08'; `tripArea` = findTripGrid.
  - `horizon` = the `u8` file of the dataset with metric `SC-01` and `coverage.area === id`.
  - `sunTable` = the JSON file of the dataset with metric `SC-03` and `coverage.area === id`.
  - It never rejects for one failed file: that grid is `null` and `loadErrors[datasetId]` holds the message.
- Produces: `sampleGrid(grid, lon, lat) -> number` (bilinear, `NaN` if any corner is nodata or the point is
  outside), `cellOf(grid, lon, lat) -> {col, row} | null`, `cellCenter(grid, col, row) -> {lon, lat}`.
- `web/datasets.json`: plain array of dataset ids and `{id, formats}` objects (same form the navigation
  lane's manifests use):
  - every `elevation_1m_<site>`, `slope_10m_window_<site>`, `roughness_1m_<site>`, `horizon_<site>` and
    `sun_table_<site>`;
  - `elevation_2m_trip_area`, `slope_2m_trip_area`, `dust_climate_mcd`, `temperature_climate_mcd`,
    `optical_depth_history`;
  - the four `themis_temp_*`, `dune_fields`, `dune_change_imagery`, `water_odyssey_grs`, `geology_units`,
    `geology_contacts`, `rover_path`, `rover_stops`;
  - `{"id": "slope_10m_study", "formats": ["png"]}`.

- [ ] **Step 1: Write failing tests.**

```js
test('findGrid picks elevation by metric, not name', async () => { const c = fixtureCatalog(); assertEq(findGrid(c, 'BT-04', 'site_a').id, 'elev_a_fine'); });
test('findTripGrid needs base and site inside, finest wins', ...);  // fixture has 10 m study + 2 m trip; picks 2 m
test('sampleGrid bilinear and NaN-aware', ...);                     // plane z = col → value at half-cell = 0.5; NaN corner → NaN
test('getSite survives a missing file', async () => { const s = await getSite(fixtureCatalogWithMissing(), 'site_a'); assertEq(s.grids.roughness, null); assert(s.loadErrors.rough_a); });
// catalog.real.test.js
test('real: near_base_north grids and 2 m trip area', async () => { const s = await getSite(await loadCatalog('/data/'), 'near_base_north'); assertEq(s.grids.elevation.width, 2003); assertEq(s.tripArea.datasetId, 'elevation_2m_trip_area'); assertEq(s.horizon.bands, 360); });
```

- [ ] **Step 2: Run, see them fail.** `.venv/bin/python -m pytest tests/test_web_map.py -v` → the new tests FAIL.
- [ ] **Step 3: Implement** `catalog.js` as specified. `fixtureCatalog()` builds its catalog with
  `catalogFromRaw` and an in-memory `fetchImpl` that serves the fixture grids' `ArrayBuffer`s by path and
  returns 404 for the path the "missing" fixture names.
- [ ] **Step 4: Run, see them pass.** `MARTIAN_MAP_DATA=<snapshot data> .venv/bin/python -m pytest tests/test_web_map.py -v` → PASS.
- [ ] **Step 5: Commit.** `git add web/src/catalog.js web/datasets.json web/tests && git commit -m "feat(map): catalog loading and site grids by metric id"`

### Task 4: Layout footprints, placement, clamping and best spot

**Files:**
- Create: `web/src/layout.js`
- Test: `web/tests/layout.test.js`

**Interfaces:**
- Consumes: `Site`, `Grid`, `sampleGrid`, `cellOf`, `cellCenter` (Task 3).
- Produces: `footprintSpecs(setup) -> [{id, w, h}]` in metres.
  - Facility load `L = {60: 100, 150: 225, 250: 350}[loadKw]` kW.
  - `compound`: 60 × 60.
  - `radiator`: `w = 60`, `h = 6000 * L / 350 / 60`.
  - `solar`: `topup` and `solar_fission` → 100 × 100; `solar_batteries` → square of side
    `sqrt(10000 * L / 100)`; `base_only` → none.
- Produces: `placeLayout(specs, placement) -> Layout`. In local metres before rotation (x east, y north):
  compound at (0, 0); radiator at (0, 30 + 10 + h/2); solar at (0, -(30 + 10 + h/2)). The group rotates
  about the compound centre by `rotationDeg` (clockwise from north). Metres convert to degrees with
  `R` and `cos(lat)`.
- Produces: `clampPlacement(site, specs, placement) -> placement`, the nearest placement whose four
  corners all lie inside `site.bounds`.
- Produces: `cellsUnder(grid, footprint, cb(col, row))`. Visits every cell whose centre lies inside the
  rotated rectangle and never visits outside the grid.
- Produces: `bestSpot(site, specs) -> placement`, with rotation 0, searched on a 5 m grid of compound centres.
  Keep candidates where every footprint cell has finite `slope10 ≤ 10`. Among them minimise the count of
  cells with `slope10 > 5`; break ties by the shortest distance from the compound centre to `site.base`.
  If none qualifies, return the candidate with the fewest unusable cells. Use summed-area tables, built
  once per site, so each candidate is O(1) per footprint:

```js
// sat[(r+1)*(W+1)+(c+1)] = count of flagged cells in rows < r+1, cols < c+1
const rectCount = (sat, W, c0, r0, c1, r1) => sat[(r1+1)*(W+1)+(c1+1)] - sat[r0*(W+1)+(c1+1)] - sat[(r1+1)*(W+1)+c0] + sat[r0*(W+1)+c0];
```

- Produces: `createLayoutStore() -> {get(siteId), set(siteId, placement, {final}), onLayoutChange(cb(siteId, layout, {final}))}`.
  `final` is true for drag end and programmatic sets, false for per-frame drag updates.

- [ ] **Step 1: Write failing tests.**

```js
test('specs 150 kW top-up', () => { const s = byId(footprintSpecs({loadKw: 150, power: 'topup'})); assertClose(s.radiator.h, 64.29, 0.01); assertEq(s.solar.w, 100); });
test('specs base_only has no solar plot', ...);
test('specs solar_batteries 250 kW side', ...);       // sqrt(35000) = 187.08
test('radiator sits north of compound at rotation 0', ...); // radiator.center.lat > compound.center.lat
test('clamp keeps all corners inside after drag past east edge', ...);
test('clamp handles 45 degree rotation at a corner', ...);
test('cellsUnder never leaves the grid', ...);         // footprint half outside → visited cells all in range
test('bestSpot finds the only flat patch', ...);       // fixture: slope 12 everywhere except a 200 x 300 m flat patch
test('bestSpot breaks ties toward the base', ...);     // two identical flat patches → the one nearer base
```

- [ ] **Step 2: Run, see them fail.** `… pytest tests/test_web_map.py -k unit -v` → FAIL.
- [ ] **Step 3: Implement** `layout.js` as specified.
- [ ] **Step 4: Run, see them pass.** Same command → PASS. Then check timing on the real 1 m site:
  `bestSpot` < 500 ms (add a real-suite test asserting it).
- [ ] **Step 5: Commit.** `git commit -m "feat(map): layout footprints, clamping and best spot"`

### Task 5: Status rules and terrain checks

**Files:**
- Create: `web/src/status.js`, `web/src/checks.js`
- Test: `web/tests/status.test.js`, `web/tests/checks.test.js`, `web/tests/checks.real.test.js`

**Interfaces:**
- Consumes: `metrics.json` (Task 2), `Site`, `Layout`, `cellsUnder` (Tasks 3–4), `catalog.scenario.assumptions`.
- Produces (`status.js`):
  - `STATUS` constants.
  - `statusFor({value, baseline, ideal, compare: '<=' | '>=', uncertainty = 0, availability}) -> {status, ideal, straddles}`:
    - `straddles` when `|value - baseline| < uncertainty` → `needs_fieldwork`.
    - `availability === 'partial'` can return `not_met` (when the value fails by more than its
      uncertainty) but never `met`; otherwise it returns `needs_fieldwork`.
  - `initialStatuses(metrics, setup) -> Map<id, Result>`:
    - `estimate_today` → `needs_confirmation` until computed;
    - `partial` and `field_needed` → `needs_fieldwork`;
    - `planning` → `needs_design_input`;
    - SC-* → `not_applicable` ("no solar plot in this power option") when `power === 'base_only'`.
  - `displayWords(result) -> string`.
  - `factorIcon(results, metrics, factor) -> '✗' | '?' | '✓' | '—'`. Count only metrics whose availability
    is `estimate_today` and whose status isn't `not_applicable`: ✗ if any `not_met`, ? if any unresolved,
    ✓ if all `met`, — if none apply.
  - `mergeResults(initial, computed, fieldRecords) -> Map`. Precedence: field records, then computed
    values, then initial statuses.
- Produces (`checks.js`): `terrainChecks(site, layout, setup, scenario) -> Map<id, Result>`.

  | Id | Value | Target / status |
  |---|---|---|
  | BT-01 | usable connected area: 4-neighbour flood fill over cells with finite `slope10 ≤ 10`, from the compound centre cell, ÷ sum of footprint areas | `>=` 1.0, ideal 1.3 |
  | BT-02 | % of compound cells usable (finite, `slope10 ≤ 10`) | 100% → `met`, else `not_met`; chip `assumption` (layout) |
  | SC-10 | same rule as BT-02 over the solar plot | as BT-02 |
  | TC-08 | same rule as BT-02 over the radiator plot | as BT-02 |
  | BT-04 | degrees of the least-squares plane over compound elevations (local metres) | `<=` 5, ideal 2, uncertainty `atan(p / 30)` |
  | BT-05 | max `slope10` under the compound | `<=` 10, ideal 5, uncertainty `atan(p / 5)` |
  | BT-06 | max \|z − plane\| under the compound, m | `needs_design_input` (no `D_allow`); value shown |
  | BT-08 | max `roughness` under each footprint, m | `<=` `max_roughness_m` (0.3, `assumption`), uncertainty `p`, partial |
  | BT-21 | straight-line distance from compound centre to base, m | `needs_design_input` (no allowance); value shown |

  `p = scenario.assumptions.dem_vertical_precision_m.value` (0.25). If more than 5% of a footprint's cells
  are NaN, that footprint's metrics are `needs_confirmation` with note "elevation gaps under the layout".
  A metric whose input grid is `null` is `needs_confirmation` with note "data failed to load".
- BT-01 runs on drag end only; everything else runs per drag frame.
- Evidence: `derived` for computed values, `assumption` chip whenever the target comes from `scenario.json`.

- [ ] **Step 1: Write failing tests.**

```js
test('statusFor straddle → needs_fieldwork', () => assertEq(statusFor({value: 4.8, baseline: 5, ideal: 2, compare: '<=', uncertainty: 0.48}).status, 'needs_fieldwork'));
test('statusFor partial never met', ...);  // value 0.1, baseline 0.3, partial → needs_fieldwork; value 0.9 → not_met
test('factorIcon ignores fieldwork-only metrics', ...);
test('base_only marks SC not_applicable', ...);
test('BT-04 on a 3 degree tilted plane', ...);   // fixture elevation = x * tan(3°) → 3.0 ± 0.05, met, ideal false
test('BT-05 reads the slope10 max', ...);
test('BT-06 measures deviation from plane', ...); // plane + one 0.8 m bump → 0.8 ± 0.05
test('BT-02 falls to 75% when a quarter is steep', ...);
test('NaN gap over 5% → needs_confirmation', ...);          // Review Focus 1
test('null roughness grid → BT-08 needs_confirmation "data failed to load"', ...); // Review Focus 4
test('BT-21 is the distance to base', ...);       // fixture base 300 m south of site edge
// checks.real.test.js
test('real: near_base_north best spot meets BT-02 and BT-05', ...);
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** `status.js` and `checks.js`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(map): status rules and terrain checks"`

### Task 6: Priority list

**Files:**
- Create: `web/src/priority.js`
- Test: `web/tests/priority.test.js`

**Interfaces:**
- Consumes: `Map<id, Result>` per site (Task 5), `metrics.json`.
- Produces: `prioritize(sites: [{id, results: Map}], metrics) -> [{siteId, priority, verdict, step, whyHere,
  failures: [id], criticalUnknowns: [id], equalWith: [siteId], tradeoff: string | null}]`, sorted by
  priority. Priorities are dense (1, 1, 2).
  1. Sites with any `not_met` form the last group:
     verdict `not recommended under the stated requirements (BT-05: 14.1° > 10°)`, `step = 1`.
  2. The others are grouped by `criticalUnknowns.length`, ascending, where a critical unknown is any
     applicable `needs_fieldwork` result or any `straddles` result. `step = 2` for a site placed above or
     below a neighbour by this count.
  3. Within one count, rank by Pareto layers over `[BT-06 value, BT-21 value, SC-01 value or 0, -(BT-15 value)]`.
     Null or NaN values make two sites incomparable. Each non-dominated layer is one priority; `step = 3`.
  4. Sites in the same layer share a priority (`step = 4`). `tradeoff` names the first two indicators
     where they differ in opposite directions, e.g. "less grading, longer cable".
- `whyHere` is one sentence built from `step`, e.g. "No failures; 2 critical unknowns, fewer than
  near_base_west (3)".

- [ ] **Step 1: Write failing tests.**

```js
test('failure goes last', ...);              // C has BT-05 not_met → C priority 2 of [A, B, C], step 1
test('fewer critical unknowns ranks higher', ...);
test('dominance separates equal unknowns', ...); // A less grading and shorter cable → A 1, B 2, step 3
test('trade-off means equal priority', ...);   // A less grading, longer cable → both 1, tradeoff "less grading, longer cable"
test('missing BT-21 makes sites incomparable → equal', ...);
test('no weights: reordering inputs gives the same output', ...);
```

- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(map): priority list in four reasoned steps"`

### Task 7: Globe with continuous zoom, vendored libraries and pins

**Files:**
- Create: `web/vendor/3d-tiles-renderer/` (npm `3d-tiles-renderer@0.5.4` `build/` files + LICENSE),
  `web/vendor/three/addons/` (r170 `examples/jsm` files the library imports, keeping their relative
  layout), `web/vendor/fonts/` (copied from `prototypes/terrain-diorama/web/vendor/fonts/`),
  `web/index.html`, `web/styles.css`, `web/src/globe.js`, `web/src/main.js`, `web/src/ui/pins.js`
- Test: `tests/test_web_map.py::test_globe_*`

**Interfaces:**
- Consumes: `Catalog` (Task 3); the `live` blocks with `scheme: 'wmts-eq'` and `cors: '*'`.
- Produces: `createGlobe(container, catalog) -> Globe`, where
  `Globe = {renderer, scene, camera, tiles, controls, labels /* CSS2DRenderer */, altitude() -> m,
  flyTo(lon, lat, altM, ms = 1200) -> Promise, addPin({lon, lat, el}) -> CSS2DObject, onFrame(cb),
  setTilesVisible(bool)}`.
- Port from `prototypes/globe-spike/web/app.js` lines 18–77:
  - the renderer with `logarithmicDepthBuffer`;
  - `tiles.ellipsoid.radius.set(R, R, R)`;
  - `GeneratedSurfacePlugin` with the Viking `XYZTilesOverlay` (`projection: 'EPSG:4326'`, `.jpg`);
  - `ImageOverlayPlugin` with Viking (8 levels), CTX (13) and HiRISE (17);
  - `bounded()` via `tiling.setContentBounds` on the CTX and HiRISE coverage boxes;
  - `GlobeControls.setEllipsoid`.
- Build overlay URLs from the catalog's `live.url_template` (the `{z}/{y}/{x}` order), not hard-coded strings.
- Tint the CTX and HiRISE overlays with `color: 0xd9a77a`. Leave their edges hard.
- Produces: `globe.setRelief(on)`. MOLA shaded relief (`relief_mola` live layer) is an extra overlay
  whose `opacity` toggles between 0 and 0.6. If the plugin ignores runtime opacity, delete and re-add the
  overlay instead.
- Pins: Gale (from `areas.gale_region` centre), Jezero (77.58° E, 18.38° N) and Arcadia Planitia
  (184.3° E = -175.7°, 47.2° N).
- `main.js` sets `window.__map = {store, globe, catalog, ready /* Promise */}`.
- Vendoring:
  1. Download `https://registry.npmjs.org/3d-tiles-renderer/-/3d-tiles-renderer-0.5.4.tgz` into a new
     empty temp folder and unpack it with `tar`.
  2. Copy the ES module build files that `package.json` `exports["./three"]` and
     `exports["./three/plugins"]` point to, plus anything they import relatively.
  3. List every bare `three/...` import they make and vendor exactly those r170 files from
     `https://unpkg.com/three@0.170.0/examples/jsm/`.
  4. Map the bare specifiers in the import map.

- [ ] **Step 1: Write failing tests.**

```python
def test_globe_loads_without_cdns(page, server_url):
    hosts = record_request_hosts(page); page.goto(server_url + "/?debug=1"); wait_ready(page)
    assert hosts <= {"127.0.0.1", "trek.nasa.gov"} and page.console_errors == []
def test_globe_zoom_reaches_hirise(page, server_url):
    # page.evaluate("__map.globe.flyTo(137.44, -4.57, 5000, 0)"); wait for idle tiles
    # assert max requested HiRISE level >= 15; screenshot to tests/artifacts/globe-hirise.png
def test_three_pins_present(page, server_url):  # 3 elements .pin, Jezero and Arcadia say "needs confirmation"
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Vendor the libraries, then implement `globe.js`, `pins.js`, `index.html` (with the import map) and `main.js`.**
- [ ] **Step 4: Run, see them pass.** Look at the screenshot (whole globe and HiRISE close-up) before moving on.
- [ ] **Step 5: Commit.** `git commit -m "feat(map): continuous Mars globe with vendored 3d-tiles-renderer and region pins"`

### Task 8: Site frame, terrain, trip surround and draggable layout

**Files:**
- Create: `web/src/frame.js`, `web/src/site.js`
- Test: `web/tests/frame.test.js`, `tests/test_web_map.py::test_site_*`

**Interfaces:**
- Consumes: `Globe` (Task 7), `Site`, `Layout`, `createLayoutStore`, `clampPlacement` (Tasks 3–4).
- Produces: `siteFrame(site) -> Frame = {lon0, lat0, elevRef, matrix /* Matrix4 local→world */,
  toLocal(lon, lat, h) -> Vector3, toLonLat(v) -> {lon, lat}, heightAt(x, z) -> number}`. It needs no
  globe: it uses its own sphere math with `R`.
  - Local axes: x east, y up, z south.
  - `elevRef` = min finite elevation over the site grid and `tripArea`.
  - `toLocal` returns true-scale metres: y = h − elevRef, curvature included.
  - `matrix = ENU(lat0, lon0, 0) × makeRotationX(+π/2)`.
  - `heightAt` samples the site grid inside the site box, the `tripArea` grid outside it, and returns NaN
    elsewhere.
- `site.js` re-exports `siteFrame` (`export { siteFrame } from './frame.js'`), because the route module
  imports it from `../site.js` when `site.frame` is absent. `getSite` never sets a `frame` key.
- Produces: `openSite(globe, site, {layoutStore, onLayoutChange}) -> SiteView = {root, terrain,
  tripTerrain, frame, setExaggeration(k), dispose()}`.
  - `root` is the exaggerated inner group (`scale.y = k`, default 2), a child of the placement group whose
    `matrix = frame.matrix`. The navigation lane adds to `root`.
  - `terrain`: site elevation decimated to stride `ceil(4 / resolutionM)` cells, HiRISE drape.
  - `tripTerrain`: `tripArea` at stride 4, skipping cells whose centre is inside the site box, drape at
    zoom 14.
  - Both get skirts down to y = 0.
  - The site drape is HiRISE zoom 15, composited into one canvas (max 4096 px). Port `hiriseFrame` and the
    drape from the spike.
  - Layout meshes: footprint outlines plus translucent fills draped by `frame.heightAt`, rebuilt on change.
  - Drag (pointer on a footprint) moves the placement through `toLonLat` of the terrain raycast hit. The
    rotate handle (or `R` + drag) changes `rotationDeg`. Placements pass through `clampPlacement`.
    `onLayoutChange` fires per frame (throttled to animation frames) and once more with `{final: true}`
    on pointer up.
  - Hover readout (`web/src/ui/readout.js`): with the pointer over the terrain, a small panel shows
    lon/lat, elevation (m), `slope10` (°) and roughness (m) at that point, each with its evidence chip.

- [ ] **Step 1: Write failing tests.**

```js
test('frame: 100 m north is z ≈ -100', () => { const f = siteFrame(fixtureSite()); const v = f.toLocal(f.lon0, f.lat0 + 100 / R * 180 / Math.PI, f.elevRef); assertClose(v.z, -100, 0.01); assertClose(v.y, 0, 0.01); });
test('frame: toLonLat inverts toLocal', ...);   // round trip within 1e-9 deg
test('frame: matrix matches the sphere position', ...); // matrix·toLocal(p) == sphere ECEF of (lat, lon, R + h - elevRef) within 0.01 m
test('frame: heightAt uses trip grid outside the site box and NaN beyond', ...);
```

```python
def test_site_drag_changes_bt05(page, server_url):  # real data
    # open near_base_north; read card BT-05 value; synthesise pointer drag of the compound by 250 px;
    # assert the BT-05 value text changed and the compound stays inside the site box; screenshot
def test_site_no_zfight_at_edge(page, server_url):  # screenshot at the site box edge for review
def test_site_hover_readout(page, server_url):  # scripted hover over the terrain → readout shows "°" and "m"; moving off hides it
```

- [ ] **Step 2–4: Fail, implement, pass.** Look at the edge screenshot: no flicker, skirts visible.
- [ ] **Step 5: Commit.** `git commit -m "feat(map): site frame, terrain with trip surround and draggable layout"`

### Task 9: Setup screen, priority list and site card

**Files:**
- Create: `web/src/state.js`, `web/src/ui/setup.js`, `web/src/ui/list.js`, `web/src/ui/card.js`,
  `web/src/ui/chips.js`, `web/src/ui/credits.js`, `web/src/ui/legend.js`
- Modify: `web/src/main.js`, `web/index.html`, `web/styles.css`
- Test: `web/tests/state.test.js`, `tests/test_web_map.py::test_flow_*`

**Interfaces:**
- Consumes: everything above.
- Produces: `createStore(initial) -> {get(key), set(key, value), subscribe(key, cb) -> unsubscribe}`. Keys:
  `setup`, `layouts` (siteId → placement), `results` (siteId → Map), `priority`, `records`, `openSiteId`.
- Flow:
  1. Setup overlay first. Load buttons 60 / 150 / 250 kW (default 150) and four power cards (default
     `topup`), each showing its plot sizes with `assumption` chips.
  2. Globe. Clicking Gale flies to the region (altitude 250 km). The list panel appears when the altitude
     is under 2,000 km and the camera target lies within `gale_region` ± 5°.
  3. On first entry to Gale, all three sites load (`getSite`), get `bestSpot` and terrain checks, and the
     priority list fills in. Rows show the priority number, five factor icons, the critical-unknown count
     and the verdict.
  4. Clicking a row or pin flies to the site (altitude 4 km, tilted) and calls `openSite`. The card shows
     Met / Failed / Open (critical marked ⚠, each with "settled by: <fieldwork column text>") / Why here,
     with value, `baseline / ideal` and evidence chip on each line. "Back to Gale" closes the site.
- Live: a layout change recomputes that site's results, then `prioritize`, then the list, the card and the pins.
- Credits: the button lists `references` for the layers on screen. "About the data" lists all catalog `references`.
- Chips: one per `evidence` label; plus a "caveat" chip on any value from a dataset whose `alignment.flag`
  is set (tooltip: the alignment note).
- Power notes on the card: `solar_fission` adds the row "Reactor link: base decision, needs confirmation";
  `solar_batteries` shows the SC-04 dust-storm note as a warning.

- [ ] **Step 1: Write failing tests.**

```python
def test_flow_setup_to_priority_list(page, server_url):  # real data
    # choose 150 kW, top-up; click Gale; wait for list; assert 3 rows, priorities are ints, each row has 5 icons
def test_flow_card_sections(page, server_url):  # open near_base_north: Met/Failed/Open/Why here present; chips present
def test_flow_base_only_marks_solar_na(page, server_url):  # change setup → SC rows "not applicable", list recomputed
def test_flow_drag_updates_priority_text(page, server_url):  # drag compound onto steep ground → BT-05 fails → row verdict "not recommended"
```

- [ ] **Step 2–4: Fail, implement, pass.** Take screenshots of the setup screen, the list and the card.
- [ ] **Step 5: Commit.** `git commit -m "feat(map): setup, priority list and reasoned site card"`

### Task 9b: ARES design guidance and the teammate's intake (inserted by controller ruling R22)

The teammate's approved design is `docs/design-guidance.md` with the mockup
`design-reference/mars-copy-balance.html` (its Practical guidance variant). jianhuib chose the
teammate's intake only: the facility is fixed, and the UI offers no load or power choice. The spec's
*The experience*, *Facility setup*, *Status rules* and *Visual design* sections are binding.

**Files:**
- Create: `web/src/ui/landing.js` (landing and intake), `web/src/ui/controls.js` (globe keyboard
  buttons).
- Delete: `web/src/ui/setup.js`.
- Modify: `web/index.html`, `web/styles.css`, `web/src/main.js`, `web/src/state.js`,
  `web/src/ui/{list,card,chips,legend,credits,pins}.js`, `web/src/site.js` (footprints, keyboard,
  base marker, fly-in target only), `web/src/globe.js` (reduced motion, keyboard nudges only),
  `web/tests/ui.test.js`, `tests/test_web_map.py`.
- Fonts are already vendored in `web/vendor/fonts/` (see its README for files and unicode ranges).
  Do not remove the Public Sans or Barlow files; the navigation lane uses them.

**Interfaces and values:**
- `FIXED_SETUP = {loadKw: 150, power: 'topup'}` in `state.js`. Every setup-taking function keeps its
  signature and gets `FIXED_SETUP`. `__map.applySetup` may stay as a test-only hook.
- Store keys: `stage` (`'landing' | 'intake' | 'explore'`) and `intake =
  {population: 50, workloads: ['robot', 'archive'], flex: 'flexible'}` (the mockup's defaults).
- `focusLine(intake) -> string`, the mockup's rule, checked in this order:
  1. `flex === 'deadline'` → "Firm-power access and service continuity"
  2. `ai` → "Power availability and heat-rejection space"
  3. `robot` → "Data links and accessible service routes"
  4. `archive` → "Storage resilience and expansion space"
  5. none → "Base-integrated services and practical access"
- **Landing** (left column about 300 px, globe live to the right):
  - the headline "Your research. Your next frontier." (Audiowide, uppercase, 1 px accent outline);
  - "Define your facility's needs to explore candidate sites near your base.";
  - one primary button, "Define data center →".
- **Intake panel** (about 360 px, left), copied from the mockup's Practical variant:
  - heading "Data center", with a "Close" text action;
  - "Base services are included. Choose the research work this facility will support.";
  - "Base population" number input (1–10000, unit "people"), with "Include your planned near-term
    crew size." On an invalid entry, show "Enter a whole number greater than zero." and block
    "Find areas →";
  - "Research workloads · select any": three option rows with a native checkbox and the whole row
    clickable (title, example, impact):
    - AI & simulation / Model training, large simulations / Power + heat rejection;
    - Robotics & imaging / Mapping, sensor and image analysis / Processing + data ingestion;
    - Science archives / Retain experiments and datasets / Storage + redundancy;
  - "Can heavy jobs wait?" with the pills "Yes, flexible" and "No, time-critical", and the help line
    "Flexible research jobs can run when power is available.";
  - an "Assumptions" disclosure containing "Base services included. Firm power plus supplemental
    solar assumed; capacity unverified. Facility sizing requires workload validation.", then the
    facility line (150 kW IT, 225 kW total; compound 60 × 60 m, radiator 60 × 64 m, solar
    100 × 100 m), with an assumption chip;
  - primary button "Find areas →".
- **Results panel** ("Explore areas"; "Edit" reopens the intake with its values kept):
  - sub line: the base context;
  - the focus line;
  - "Compare the tradeoffs, then select an area to see what needs checking.";
  - with no region in view, one card per region (name, site count) that flies to it;
  - in a region, Task 9's priority rows as candidate cards: priority, name, one reason to
    investigate it (the verdict). Selecting a card shows its next check (the first critical unknown
    and what settles it) and opens the site;
  - the site card replaces the results in the same panel, with "← Back to <region>".
- **Header**, about 80 px:
  - left: the "ARES" wordmark (outlined Audiowide, 28 px, tracking 3 px) and "Mars data center
    explorer";
  - right: the base context, "Gale crater base · Demo" (the base of the region in view), or
    "Gale, Jezero and Arcadia bases · Demo" when no region is in view.
- **Credits** is a disclosure at the bottom left. The legend and "What the chips mean" go into
  disclosures too.
- **Tokens:** exactly the guide's §2. Assessment colours: met `#B8DFC2`, conflict `#FFB19B`,
  unresolved `#E3C78F`.
- **Status labels on card lines:**
  - met → "Meets screening criterion", plus an "ideal" badge;
  - not met → the specific conflict, e.g. "Pad slope 6.4° over the 5° target";
  - unresolved → "Unresolved: " plus what is missing ("needs fieldwork", "needs design input",
    "needs data");
  - not applicable → its reason.

  Factor icons keep ✓ ✗ ? — and gain these colours.
- **Type:** Audiowide only for the wordmark, the landing headline and panel headings (21–22 px).
  Space Grotesk 400/500 for the rest. Nothing visible under 12 px. Tabular numerals for values.
- **Controls:**
  - Every button and pill is at least 44 × 44 px, with visible focus rings.
  - Primary buttons are filled accent with `accent-ink` text and a 7–8 px radius.
  - Panels are opaque `panel` colour, with a 1 px `border` and 12 px radius.
- **Globe keyboard buttons** (bottom right; ← → ↑ ↓ + −, with the hint "Drag to explore"):
  - arrows rotate the camera about the planet by 10% of the current view's ground width;
  - + and − scale the altitude by 0.6 and 1/0.6;
  - all of them also work from the keyboard while the map has focus and no layout is selected.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, `flyTo` jumps in one frame.
- **Fly-in** (ruling R23): ends 700 m above the layout centre, tilted 55°. The layout is centred in
  the map area right of the panel.
- **Footprints:**
  - Upright and translucent: each plot is a box 5 m tall (display only, under the exaggeration),
    with fill opacity 0.35 and a solid top edge.
  - Colour by the footprint's own checks: compound from BT-02, BT-04 and BT-05; solar from SC-10;
    radiator from TC-08. met → `#B8DFC2`, conflict → `#FFB19B`, otherwise `#E3C78F`.
  - A conflicting footprint's Failed line names that plot.
  - Move and rotate handles sit on the selected footprint.
  - Keyboard: click or Tab selects the layout. Arrows move it 5 m (clamped like a drag); `[` and `]`
    rotate it 15°; Esc deselects. A keyboard move is final, so BT-01 recomputes.
  - Camera gestures never move a footprint.
- **Base marker** in region and site views: a small labelled pin, "<Region> base".

**Tests (TDD: write them first, see them fail):**

```js
// web/tests/ui.test.js
test('focusLine follows the mockup order', ...);   // deadline beats ai; ai beats robot; none → base-integrated text
test('status label texts', ...);                   // met / not met with the conflict / unresolved / N/A
test('population validation', ...);                // 0, 1.5, '' → "Enter a whole number greater than zero."; 50 ok
```

```python
# tests/test_web_map.py (real data)
def test_landing_matches_mockup(page, server_url):         # headline, support line, one primary button; header "ARES" + base context; screenshot landing.png
def test_intake_fields_and_assumptions(page, server_url):  # population 50, robot+archive checked, flexible pressed; Assumptions text exact; invalid population blocks with the error text; Find areas → explore stage; focus line "Data links and accessible service routes"; Edit keeps values; screenshot intake.png
def test_design_tokens_and_fonts(page, server_url):        # body bg rgb(7, 11, 15); panel bg rgb(17, 25, 32); document.fonts.check for Audiowide and Space Grotesk is true; all requests are to 127.0.0.1 or trek.nasa.gov; no visible text node under 12 px; every visible button ≥ 44 × 44
def test_globe_keyboard_buttons(page, server_url):         # "+" lowers altitude by ≈0.6×; "→" changes the camera longitude; with reduced motion emulated, flyTo lands at its altitude within 2 frames
def test_card_status_labels_and_footprints(page, server_url):  # near_base_north: met line "Meets screening criterion"; footprint meshes are 5 m tall boxes with opacity 0.35; base marker visible; screenshot card-near_base_north.png
def test_keyboard_moves_layout(page, server_url):          # select layout; ArrowRight moves the compound centre 5 m east (±0.5); "]" rotates 15°; BT-01 recomputed
def test_conflict_highlights_footprint(page, server_url):  # drag the compound onto a steep cell (as test_flow_drag_updates_priority_text); compound colour #FFB19B; Failed line names the compound; screenshot card-conflict.png
```

- Update every existing flow test to go landing → intake → "Find areas →" instead of `#setup-apply`.
- `test_flow_base_only_marks_solar_na` may drive `__map.applySetup`. The fly-in assertions become
  600–800 m and 50–60°.

**Commands:** as Task 9 (unit: `-k "not real"`; real: `MARTIAN_MAP_DATA=<data> … tests/test_web_map.py tests/test_web_tools.py`).

**Commit:** `feat(map): ARES design guidance, teammate's intake, upright footprints`

### Task 9c: Plain-language card, factor bar, References page, warm globe (controller ruling R27)

jianhuib's review of the 9b build (2026-11-15):
1. Make the globe more brown, like the mockup.
2. Drop the legend.
3. Drop "What the chips mean", or fold it into one References section together with credits, on
   every page, explaining the map and linking the NASA sources.
4. Make it obvious which of the five factors fails or is unresolved, with one view per factor.
5. Metric ids like BT-04 are hard to read: keep the map concise and put metric detail behind a
   disclosure.

The spec's *Globe*, *Five factors, five views*, *Site card*, *Status rules* (factor icon) and *Visual
design* (References) are binding. This task builds everything except the four non-terrain views,
which Task 12 adds.

**Files:**
- Create:
  - `web/src/plain.js`: plain phrases and sentences;
  - `web/src/ui/factors.js`: the factor bar, the view registry and the per-view key line;
  - `web/src/ui/references.js`.
- Delete: `web/src/ui/credits.js` and `web/src/ui/legend.js`. Move what is still needed into
  `references.js` and the view keys.
- Modify:
  - `web/src/ui/{card,list,pins}.js`, `web/src/main.js`, `web/index.html`, `web/styles.css`;
  - `web/src/globe.js`: the colour grade only;
  - `web/src/site.js`: the terrain view's slope colouring only;
  - `web/tests/ui.test.js`, `tests/test_web_map.py`.

**Interfaces and values:**
- `FACTORS` in `plain.js`:
  `[{id: 'BT', name: 'Terrain', doc: 'Buildable terrain'}, {id: 'GI', name: 'Ground & ice', doc: 'Ground
  and ice evidence'}, {id: 'SC', name: 'Solar', doc: 'Solar conditions'}, {id: 'TC', name: 'Thermal',
  doc: 'Thermal conditions'}, {id: 'IR', name: 'Routes', doc: 'Investigation routes'}]`.
  Every UI place that showed BT/GI/SC/TC/IR shows `name` instead, including the pin rows and list
  column headers.
- `PLAIN` in `plain.js`: the failure phrase for each computed metric.

  | Metric | Phrase |
  |---|---|
  | BT-01 | "not enough connected flat ground" |
  | BT-02 | "the layout doesn't fit on usable ground" |
  | BT-04 | "the building pad is too tilted" |
  | BT-05 | "too steep in places under the compound" |
  | BT-06 | "too much grading needed" |
  | BT-08 | "too rough under the layout" |
  | BT-21 | "the cable route to the base is too long" |
  | SC-10 | "the solar plot doesn't fit on usable ground" |
  | TC-08 | "the radiator plot doesn't fit on usable ground" |

  Task 12 adds SC-01, SC-03, SC-04, TC-01, BT-15, BT-16 and GI-05. A metric with no phrase falls back
  to its lowercased name.
- `plainVerdict(row, results) -> string`:
  - a failing site: "Not recommended: " + the first two failure phrases joined with " and ", + ", and
    N more" when there are more;
  - otherwise: "No failures; N factors still need field checks", where N is the factors with any
    critical unknown, or "No failures found from orbit" when N = 0.

  It replaces the verdict text in the card header, the candidate cards and the pin rows. The
  `prioritize()` output is unchanged; the card's Details keeps the old technical text.
- `factorSentence(factorId, results) -> {icon, text}`:
  - met → "meets the screening criteria";
  - failed → its failure phrases;
  - unresolved → "not settled from orbit: N field checks, starting with <first critical unknown's
    name, lowercased>";
  - none apply → "not applicable here".
- **Site card**, top to bottom:
  - header: name, region, priority badge, "equal with …" and `plainVerdict`;
  - five factor rows: icon, factor name, `factorSentence`, a "View" button and a closed "Details"
    disclosure holding Task 9's metric lines for that factor (Met, Failed, Open, N/A; ids, values,
    targets, chips, settled by). The facility line and drag help move into the Terrain row's Details;
  - "Why this priority" in plain words: step 1 "it fails a requirement"; step 2 "fewer / more
    unresolved checks than <peer>"; step 3 "less grading / a shorter cable than <peer>"; step 4 "no
    rule separates it from <peer>", plus the trade-off;
  - "Next check": the first critical unknown's name and what settles it.
- **Factor bar** (`ui/factors.js`):
  - a segmented control under the header in region and site views: Photo · Terrain · Ground & ice ·
    Solar · Thermal · Routes;
  - each segment shows its factor icon for the open site;
  - store key `view` (`'photo' | 'BT' | 'GI' | 'SC' | 'TC' | 'IR'`), default `'photo'`; a row's
    "View" sets it;
  - `registerView(id, {apply(ctx), clear(ctx), key(ctx) -> {text, source, missing}})`, where
    `ctx = {globe, siteView, site, regionId}`. Views that aren't registered are not shown in the bar.
    This task registers `photo` and `BT`.
- **Terrain view:**
  - The site terrain is coloured by `slope_10m_window`: ≤ 5° `#B8DFC2`, 5–10° `#E3C78F`, > 10°
    `#FFB19B`, blended at about 0.55 over the photo or ramp so the ground still reads.
  - In the region view, the region's slope study PNG (`slope_10m_study`, or `slope_20m_study__<region>`)
    goes on the globe as an overlay patch at h = +40 m.
  - Its key: "Slope over 10 m: green ≤ 5° (ideal pad), amber 5–10° (usable), red > 10°. From the
    1 m HiRISE elevation model (derived)."
  - With no slope grid: "No slope data here: needs confirmation".
- **References** (`ui/references.js`), a single disclosure at the bottom left on every screen.
  - **"How to read the map":** factor icons ✓ ✗ ? —, the three status colours with their labels,
    footprint colours, and one line per evidence chip (observation, derived, model, interpretation,
    assumption, reference, caveat). Use Task 9's chip texts.
  - **"Data on screen":** Task 9's `referencesFor` output, each with its https link.
  - **"All the data":** the 32+ catalog references, grouped, with links.
  - A note: "Globe colour: Viking MDIM 2.1 mosaic, colour-graded warmer for display."
  - The current view's key line sits in the panel under the factor bar.
- **Globe colour grade:** a warm display grade on the Viking imagery. The mean colour of the visible
  globe disc on the landing view must land within 12 of `(128, 65, 47)` in each channel: the mockup
  measures `(128, 65, 47)`, hue 14°, saturation 0.47, and we measure `(104, 84, 83)`, hue 1°,
  saturation 0.11.
  - Apply it to the globe tiles only, not to CTX, HiRISE or the site terrain, e.g. a material colour
    multiply plus a saturation lift in the tiles' `load-model` material.
  - A thin warm rim, as in the mockup, is allowed. No glow on text.

**Tests (TDD: write them first, see them fail):**

```js
// web/tests/ui.test.js
test('plainVerdict for failing, unresolved and clean sites', ...);   // two phrases + "and N more"; "No failures; 3 factors still need field checks"
test('factorSentence per status', ...);                               // met / failed phrase / "not settled from orbit: 9 field checks, starting with bearing capacity" / N/A
test('no factor codes outside Details', ...);                         // card model text outside details has no /\b(BT|GI|SC|TC|IR)-\d\d\b/
test('registerView: unregistered views are not in the bar', ...);
```

```python
# tests/test_web_map.py (real data)
def test_globe_colour_matches_mockup(page, server_url):        # landing: disc mean within 12 of (128, 65, 47) per channel; screenshot landing.png
def test_references_replaces_legend_and_chips(page, server_url):  # no "Legend" or "What the chips mean" controls on any stage; one "References" disclosure on landing, intake, explore, site; it has the three parts; every link is https
def test_card_plain_first(page, server_url):                  # near_base_north: five factor rows with names; visible text outside Details has no metric ids; opening Terrain Details shows BT-04 etc.; screenshot card-plain.png
def test_factor_view_terrain(page, server_url):               # Terrain "View" → store view 'BT'; slope colouring on (a sampled terrain pixel shifts toward green/amber/red); key line text; screenshot view-terrain.png
def test_drag_failure_reads_plainly(page, server_url):        # drag onto a steep cell (as before): header "Not recommended: too steep in places under the compound…"; Terrain row ✗ with the phrase; the pin row's Terrain icon ✗
```

Update the tests from Task 9 and 9b that read the old card sections, credits or legend, so they go
through the factor rows' Details and the References disclosure.

**Commands:** as Task 9b.

**Commit:** `feat(map): plain-language card, factor bar and terrain view, References page, warm globe`

### Task 9d: Construction-driven intake (controller ruling R28)

The teammate's ad650cf reframes the app as construction inputs → estimated facility → five location
requirements → candidate comparison (`docs/design-guidance.md` §7, `docs/construction-project-inputs.md`,
`docs/data-center-sizing.md`). jianhuib chose the "Guided brief" variant of
`design-reference/mars-construction-intake.html`. The spec's *The experience* (Landing, 1–3) and
*Facility setup* sections are binding. The sizing model is planned, not implemented: build no
estimate.

**Files:**
- Modify: `web/src/ui/landing.js`, which becomes the landing plus the brief; split a
  `ui/brief.js` out if it grows past about 400 lines. Also `web/src/state.js`, `web/src/main.js`,
  `web/index.html`, `web/styles.css`, `web/src/ui/{list,card}.js` (headers and copy only),
  `web/tests/ui.test.js` and `tests/test_web_map.py`.

**Interfaces and values:**
- Store key `brief` replaces `intake`. It holds the mockup's editable example values, which match
  `scenario/gale.json` `construction_project`:
  - project "Gale landing pad & access road", building Landing pad + Road;
  - survey area and road length unknown;
  - robot groups survey 4, excavation 10, transport 6 (fleet 20), 16 active together;
  - 12 h / sol, turnaround 1 hour.

  Quantities are `{mode: 'known' | 'range' | 'unknown', value?, min?, max?, unit}`.
- Stages: `stage` becomes `'landing' | 'brief' | 'facility' | 'explore'`. Inside the brief, a tab
  index runs 0–3 (Project, Robots, Operations, Review).
- **Copy (verbatim):** take every string from the Guided brief variant: headings, tab names, field
  labels, options and help lines. In particular:
  - "Plan the work. Find its foundation." and "Start with the construction your robots will do.";
  - "Group robots by their main task. Active units work at the same time.";
  - "Onboard driving and safety remain with each robot.";
  - "Turnaround starts when survey collection finishes. A sol is a Mars day.";
  - "Review before sizing";
  - "The sizing model will translate this brief into a facility option and the requirements
    below.";
  - the five factors as "Awaiting sizing";
  - "Start with what you know.".

  The landing support line is "Describe your construction project to explore locations for its
  supporting data center." The help line under scheduling outputs, if there is one, is "Flexible
  processing jobs can run when power is available."
- **Stepper** under the header: "1 Construction brief · 2 Facility specifications · 3 Location
  assessment", with the current step marked. Earlier steps are clickable; values are kept.
- **Header right:** "Gale crater · Construction planning" during the brief and facility steps, then
  Task 9b's base context.
- **Facility specifications step:**
  - the heading "Facility specifications";
  - the line "Sizing model: planned. It will estimate compute, storage, power, heat rejection
    and footprint from your brief.";
  - a card holding Task 9b's facility line (150 kW IT, 225 kW total; compound 60 × 60 m, radiator
    60 × 64 m, solar 100 × 100 m) under the exact label "Illustrative reference — not calculated
    from your project.", with an assumption chip;
  - the primary button "Assess locations →", which flies to the globe and opens the explore panel.
- The same label sits beside the facility line wherever it appears: the Terrain row's Details and
  the References note.
- **Location assessment** keeps Tasks 9, 9b and 9c's panels. Their headers show the brief's name
  ("Gale landing pad & access road · 20 robots"). The old intake, `focusLine` and the old copy go.
- **Accessibility:** native inputs, labels on every control, the known/range/unknown pickers as
  native selects, robot groups with add and remove buttons that have accessible names, 44 px
  targets, and focus kept when tabs change.

**Tests (TDD: write them first, see them fail):**

```js
// web/tests/ui.test.js
test('brief defaults match the mockup example', ...);        // name, builds, groups 4/10/6, fleet 20, active 16, 12 h/sol, 1 h
test('quantity modes', ...);                                  // known needs a value; range needs min ≤ max; unknown needs nothing
test('review lists what is still to confirm', ...);           // the unknowns → "Survey area, Road length, …"
```

```python
# tests/test_web_map.py (real data)
def test_brief_tabs_and_copy(page, server_url):          # landing → brief; the 4 tabs walk with Continue/Back; key strings exact; the summary updates when a robot count changes; screenshots brief-project.png, brief-review.png
def test_facility_step_is_illustrative(page, server_url):   # the facility step shows the exact label "Illustrative reference — not calculated from your project."; no other number on it claims to come from the brief; "Assess locations →" → explore stage
def test_stepper_keeps_values(page, server_url):         # change the project name, go to step 3, click step 1: the value is kept
```

Update the Task 9b and 9c flow tests from intake to brief: `_open_globe` walks the brief and the
facility step.

**Commands:** as Task 9b.

**Commit:** `feat(map): construction brief intake and illustrative facility step`

### Task 10: Lift out as diorama

**Files:**
- Create: `web/src/diorama.js`, `web/src/ui/callouts.js`
- Test: `tests/test_web_map.py::test_diorama_*`

**Interfaces:**
- Consumes: `SiteView` (Task 8), `Result` maps (Task 5).
- Produces: `liftOut(globe, siteView, results) -> Promise<Diorama>` and `Diorama.back() -> Promise`.
  - Animate exaggeration 2 → 3 over 800 ms.
  - Hide the tiles with `globe.setTilesVisible(false)`.
  - Add block walls from the terrain's edge loops (port `edgeLoops` and `wallObject` from the diorama
    prototype), a plaque (site name, priority, verdict) and callouts at the compound (BT-04/05), solar
    plot (SC-01) and radiator plot (TC-01), with the prototype's `declutter()`.
  - Switch to `OrbitControls` around the site centre.
  - `back()` reverses all of it and restores `GlobeControls`.
- The profile chart (port `renderProfiles`) shows an east-west and a north-south elevation profile through
  the compound.

- [ ] **Step 1: Write failing tests.**

```python
def test_diorama_lift_and_back(page, server_url):  # lift: tiles hidden, walls present, 3+ callouts visible; back: tiles visible; no console errors; screenshots
```

- [ ] **Step 2–4: Fail, implement, pass.** Compare the screenshot with the prototype's look.
- [ ] **Step 5: Commit.** `git commit -m "feat(map): lift the site out as a diorama"`

### Task 11: Navigation lane hooks and field records

**Files:**
- Create: `web/src/nav.js`, `web/src/records.js`, `web/tests/fixtures/route-stub/route/index.js`,
  `web/tests/fixtures/route-stub/walk/index.js`, `web/tests/records.test.js`
- Modify: `web/src/ui/card.js`, `web/src/main.js`
- Test: `tests/test_web_map.py::test_nav_*`

**Interfaces:**
- Consumes (navigation lane, by dynamic import):
  - `./route/index.js`: `planRoute({site, layout, base, mode, statuses, order, assumptions?})`,
    `drawRoute(route, siteRoot) -> THREE.Group`, `renderTripPanel(route, container, {onChange})`.
  - `./walk/index.js`: `enterWalk(route, siteContext)`, `exitWalk() -> result`.
- Produces: `loadNavigation(base = './src/') -> Promise<{route, walk} | null>`. It returns null when the
  import fails, and the "Plan route" button stays hidden.
- Host behaviour:
  - "Plan route for N field checks" calls `planRoute` with `statuses` = the site's results minus any id
    present in the last `route.metrics`. It then calls `drawRoute(route, siteView.root)`, replacing the
    previous Group, and `renderTripPanel(route, cardTripEl, {onChange})`.
  - `onChange`:
    - `{mode}` and `{order}` → re-plan with that value merged in;
    - `{assumptions}` → re-plan;
    - `{action: 'reorder'}` → re-plan without `order`;
    - `{action: 'walk'}` → `setExaggeration(1)` and `enterWalk(route, {renderer, scene, root, terrain,
      tripTerrain, frame, hudRoot, site, onTag, onExit})`, with globe controls disabled.
  - `onExit(result)` restores the controls and the exaggeration, then saves `result.tags` as simulated tags.
  - Re-plan also on layout drag end (`final`), setup change and saved field record, never on a change to
    a route-derived id.
  - `route.metrics` show in the card under "Route" without entering `prioritize`; `route.notOnTrip`
    lists the fieldwork ids this excursion doesn't reach.
- Produces: `createRecords(storage = localStorage, key = 'martian-map.records.v1') -> {list(), addField({siteId,
  stopId, metricId, value, pass, note}), addSimTag({siteId, lon, lat, note}), exportJson() -> string,
  importJson(text) -> {ok, error}, subscribe(cb)}`.
  - Field records override that metric's status in `mergeResults`: a `pass` of true → `met`, false →
    `not_met`, evidence `observation`, note "field result".
  - Simulated tags are `{kind: 'simulated_tag', lon, lat, note}`. They show as SIMULATED notes on the map
    and never reach `mergeResults`.
  - `importJson` accepts only `{version: 1, records: [...]}` whose items have known kinds.
- Test mode: `index.html?navstub=1` makes `main.js` call `loadNavigation('./tests/fixtures/route-stub/')`.
  The stub returns a fixed two-stop route and records its calls on `window.__routeCalls`. Without the flag
  the base is `./src/`; while `web/src/route/` doesn't exist the import fails and the button stays hidden.

- [ ] **Step 1: Write failing tests.**

```js
test('records: field result overrides status', ...);
test('records: simulated tag never changes status', ...);       // Review Focus 5
test('records: malformed import rejected, state unchanged', ...); // Review Focus 5
test('records: export → import round trip', ...);
```

```python
def test_nav_hidden_without_module(page, server_url):  # no route module → no "Plan route" button, no console errors
def test_nav_plan_draw_and_replan(page, server_url):  # stub: click Plan route → planRoute called once with statuses lacking stub's route ids; drag end → called again
def test_nav_walk_enter_exit_restores(page, server_url):  # stub enterWalk then onExit → exaggeration back to 2, tag listed as SIMULATED
```

- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(map): navigation lane hooks and field records"`

### Task 12: Environment metrics and the four remaining factor views (Should; runs right after 9c, ruling R27)

Rescoped by rulings R27 and R32. The spec's *Three looks, five factor views* section is binding.

**First, from ruling R32 (jianhuib's review of 9c), the view control becomes two rows.**

- **Top row, looks:** Diorama · Survey sheet · Helmet HUD.
  - Store key `look` (`'diorama' | 'survey' | 'hud'`), default `'diorama'`. It replaces the
    `'photo'` view.
  - Theme constants come from `design-reference/map-prototype/web/app.js` `THEMES`: drape layer,
    contour interval, colour and opacity, wall/skirt colours and mode (solid or lines), ground
    (shadow / grid / none), hemisphere and sun light, exposure and exaggeration.
  - Footprints keep the assessment colours in every look.
  - Diorama is today's tinted photo.
  - Survey: the photo is replaced by a light paper-toned hillshade (computed from the elevation
    grid, for example `#e9e6dd` lit to `#bdbdb4`), with 10 m contours.
  - HUD: the true-grey photo dimmed to 0.72, with cyan `0x6fe3ff` 5 m contours at 0.55 opacity and
    line walls. No glow and no bloom.
  - The looks apply to the site terrain, the trip surround and (later) the lifted diorama. In the
    region view the looks row is hidden.
- **Second row, factor tabs:** Terrain · Ground & ice · Solar · Thermal · Routes, all five always shown,
  each with the open site's icon.
  - Store key `view` becomes `null | 'BT' | 'GI' | 'SC' | 'TC' | 'IR'`, default `null`. Clicking the
    active tab sets it back to `null`.
  - A factor's overlay sits on top of the current look.
  - `key(ctx)` may return `demo: '<what it rests on>'`. The tab and key then show a "Demo" chip,
    and References gains a "Demo parts" section listing each view's demo text.
  - Demo views never touch statuses.

**Then the four remaining factor views (R27).**
- `addRegionLayers` becomes four `registerView` registrations (`GI`, `SC`, `TC`, `IR`) on Task 9c's
  factor bar, at both region and site scale.
- Every dataset is found per region through `datasetsInRegion` and the `__jezero` / `__arcadia`
  suffixes, never Gale's by name. A region without the data reads `needs_confirmation`, and its view
  says "No … data here: needs confirmation".
- Each view registers its key line, and Task 9c's `PLAIN` gains phrases for this task's metrics.

Views:
- **GI:** the `water_odyssey_grs` PNG tint, `geology_units` outlines, and the
  `thermal_inertia_themis_1km` PNG, each optional.
- **SC:** the site terrain relit by a directional light at the worst-season noon sun from
  `sunTable`, with shadows on. The panel shows a skyline chart: the horizon profile from `horizon`,
  plus the sun paths at aphelion and perihelion.
- **TC:** the THEMIS case PNGs as curved patches, with a case selector (day/night ×
  aphelion/perihelion). A missing case is listed as missing.
- **IR:** a line from the compound to the base with its length (BT-21), `rover_path` and
  `rover_stops` where present, and the trip-area slope.

The original text follows, kept for its metric formulas:

**Files:**
- Create: `web/src/environment.js`, `web/src/layers.js`
- Modify: `web/src/main.js`, `web/src/ui/legend.js`
- Test: `web/tests/environment.test.js`, `web/tests/environment.real.test.js`

**Interfaces:**
- Consumes: `Site.horizon`, `Site.sunTable`, catalog datasets `dust_climate_mcd` (`climate/mcd_gale_solar.json`),
  `temperature_climate_mcd` (`climate/mcd_gale_thermal.json`), the four `themis_temp_*`, `dune_fields`,
  `dune_change_imagery`, `water_odyssey_grs`.
- Produces: `environmentChecks(site, layout, setup, env) -> Map<id, Result>`, where `env` comes from
  `loadEnvironment(catalog) -> Promise<{mcdSolar, mcdThermal, themis: {dayAph, dayPeri, nightAph,
  nightPeri}, dunes, duneShifts, grs}>`.
  - **Sunlit factor** at (ls, t): the share of horizon points inside the solar plot (or the nearest one)
    where the sun elevation from `sunTable.elevation_deg[ls][t]` exceeds `horizonDeg(point, azimuth)`.
    Horizon: u8 × 0.25° = horizon elevation, 255 = nodata. Bands are azimuth (0 = north, clockwise, 1° each).
  - **SC-01**: `1 − Σ sin⁺(el)·sunlit / Σ sin⁺(el)` over all 24 × 48 (ls, t), in %. Target `<=` 10, ideal 5;
    evidence `model`.
  - **PV(ls, t)**, kW: `flux(ls, t) × sunlit × η × A_panel / 1000`.
    - `flux` is the MCD `surface_solar_flux_down_w_m2`, linearly interpolated from its 25 local times
      onto the sun table's 48.
    - `η = 0.20` and `A_panel = solar plot area / 2`, both `assumption` (they reproduce
      `docs/reference-facility.md`'s 20–60 W/m² net).
  - **SC-03**: mean PV over the climatology scenario.
    - `topup` and `solar_fission` → `>=` 100 kW (P), ideal 120;
    - `solar_batteries` → `>=` L (assumption);
    - `base_only` → `not_applicable`.
  - **SC-04**: `min over ls of mean_t PV(ls) / L`, for `solar_batteries` only, `>=` 1.0, ideal 1.2. The
    note gives the same ratio under the `dust_storm` scenario. Other solar options → `needs_design_input`;
    `base_only` → `not_applicable`.
  - **TC-01**: the radiator plot's mean THEMIS K for each of the four cases where finite. The value is
    "k of 4 cases observed". Status `needs_fieldwork` (partial); the note gives min/max K and the MCD
    surface temperature range for the cases not observed.
  - **BT-15**: metres from the nearest footprint edge to the nearest `dune_fields` polygon edge (0 inside),
    partial.
  - **BT-16**: `dune_change_imagery` `summary.sand_edges.moving_rate_m_per_earth_year` (0.406), with the
    published 0.4 m/yr in the note, partial.
  - **GI-05**: the GRS bin containing the site centre, `h2o_wt_pct ± sigma_wt_pct`, `needs_confirmation`
    (note "SWIM ice data pending"), evidence `observation`.
- Produces: `addRegionLayers(globe, catalog) -> {set(id, visible), ids}`. Layers are visible in the region
  view and hidden while a site is open:
  - `geology_units` and `geology_contacts`: GeoJSON outlines as lines on the sphere at h = +60 m;
  - `dune_fields` outlines;
  - the `rover_path` line and `rover_stops` points;
  - THEMIS day/night PNG overlays and the `slope_10m_study` PNG: curved patches (64 × 64 segments) at
    h = +40 m, each with its `legend`.

- [ ] **Step 1: Write failing tests.**

```js
test('SC-01 zero with a flat horizon', ...);    // horizon all 0 → 0%
test('SC-01 blocks the low eastern sun', ...);  // horizon 30° east → > 0, < 50%
test('PV scales with plot area and η', ...);
test('SC-04 only for solar_batteries', ...);
test('BT-15 is 0 inside a dune polygon', ...);
// environment.real.test.js
test('real: near_base_north SC-01 under 10% and SC-03 a finite kW', ...);
test('real: GI-05 reads the Gale GRS bin', ...);
```

- [ ] **Step 2–4: Fail, implement, pass.** Wire `environmentChecks` into `mergeResults` next to
  `terrainChecks`; a screenshot of the region with geology and dune layers on.
- [ ] **Step 5: Commit.** `git commit -m "feat(map): solar, thermal, dune and ice metrics; region layers"`

### Task 13: GitHub Pages build

**Files:**
- Create: `web/package.py`
- Test: `tests/test_web_tools.py::test_package_*`, `tests/test_web_map.py::test_dist_*`

**Interfaces:**
- Consumes: `web/datasets.json`, `web/src/route/datasets.json` and `web/src/walk/datasets.json` (each
  optional), the snapshot data folder.
- Produces: `build(web_dir, data_dir, out_dir) -> {files: int, bytes: int}`. CLI:
  `.venv/bin/python -I web/package.py --data <dir> --out web/dist`.
  1. Copy `web/index.html`, `styles.css`, `metrics.json`, `datasets.json`, `src/` and `vendor/`; skip
     `tests/`, `tools/`, `dist/`, `serve.py` and `package.py`.
  2. Write `dist/data/catalog.json` with only the manifest datasets and the `live` datasets (metadata
     only), keeping `areas`, `references` and `scenario_file`. Copy `scenario.json`.
  3. Datasets whose f32 grid has `resolution_m < 2` are reduced to 2 m blocks:
     - elevation (metric BT-04) by NaN-aware mean;
     - slope, slope10 and roughness by NaN-aware max.

     Rewrite `grid.width/height/pixel_deg`, `resolution_m` and `bytes` and `sha256`. Copy everything else
     unchanged; `{id, formats}` entries copy only those formats.
  4. Write `.nojekyll`.
  5. Fail with a clear message if a manifest id isn't in the catalog, a listed file is missing, a file is
     ≥ 100 MB or the total is > 300 MB.

- [ ] **Step 1: Write failing tests.**

```python
def test_package_reduces_conservatively(tmp_path):  # Review Focus 3: 4x4 slope grid, one cell 30° → 2x2 output has 30° in that block; elevation block = mean
def test_package_fails_on_unknown_id(tmp_path): ...
def test_package_size_limits(tmp_path): ...       # fake 101 MB file → error naming it
def test_package_writes_nojekyll_and_trimmed_catalog(tmp_path): ...
def test_dist_runs_from_static_files(page, tmp_path):  # build real dist; serve dist with make_server(dist, None); flows from Task 9 pass; requested hosts ⊆ {127.0.0.1, trek.nasa.gov}
```

- [ ] **Step 2–4: Fail, implement, pass.** Print the build size; expect ≈ 160 MB.
- [ ] **Step 5: Commit.** `git commit -m "feat(map): GitHub Pages build"` (`web/dist/` is gitignored: add it to `.gitignore`).

### Task 14: Deploy to GitHub Pages (gated)

**Files:** none committed to the branch.

- [ ] **Step 1: Stop and ask jianhuib for the go-ahead.** Say what becomes public: the app, the trimmed NASA
  data, at `https://jianhui-ben.github.io/space-apps-2026-martian-map/`. Also check push credentials:
  `git ls-remote origin` works anonymously, so test push access with
  `git push --dry-run origin HEAD:refs/heads/gh-pages-check`. If push fails, hand jianhuib the one-time
  credential setup (SSH key or a fine-grained token limited to this repo) to do in their own terminal.
- [ ] **Step 2: Publish.** In a new temp folder: `git init`, copy `web/dist/`, commit, then
  `git push --force origin HEAD:gh-pages`. If Pages isn't on, jianhuib enables Settings → Pages → Deploy
  from branch `gh-pages` / root.
- [ ] **Step 3: Verify anonymously.** Both of these must return 200:
  `curl -s -o /dev/null -w '%{http_code}' https://jianhui-ben.github.io/space-apps-2026-martian-map/` and
  `…/data/catalog.json`. Then run `test_flow_setup_to_priority_list` against the live URL
  (`MAP_URL=<live url> … -k flow_setup`).

### Stretch (only after Tasks 1–14)

- Compare two sites side by side: two `liftOut` dioramas on a shared height scale, with both cards.
- Region relief: a curved mesh from `elevation_463m_region` (exaggeration 3) under the region overlays.
- Local tile cache in `serve.py` for recording the video (`/trek/` proxy, host allowlist `trek.nasa.gov`, loopback only).

## Execution Order and Parallelism

Ruling R27 sets the order 9b → 9c → 12 → 10 → 11 → 13 → 14; ruling R28 inserts 9d after 9c. Merge origin/main (ad650cf) into the branch before 9d.


Tasks 1 → 2 → 3 → 4 → 5 → 6 are pure logic and fast. Task 7 (globe) can start after Task 3. Tasks 8 → 9 → 10 →
11 follow in order. Task 12 can run after Task 9. Task 13 after Task 11. Task 14 needs the go-ahead.
