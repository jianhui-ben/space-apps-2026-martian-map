# Brief-driven facility sizing and site assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The construction brief sizes the facility in the browser, and the map checks that facility, with plots sized per site, at each hand-picked site and ranks the sites.

**Architecture:** A JavaScript port of the Python sizing engine (`web/src/sizing/`) is checked against fixtures the Python engine writes. A pure module (`web/src/requirements.js`) sizes each site's solar and radiator plots and produces the new Results. The brief, facility step, layout, checks and main wiring consume a brief-sourced `setup = {source: 'brief', power, sizing}` through the existing single-`setup` call shape.

**Tech Stack:** Vanilla ES modules in the browser; tests in the in-browser harness (`web/tests/harness.js`, `web/tests/suites.js`) driven by pytest + Playwright (`tests/test_web_map.py`); Python 3.9 for the fixture tool.

**Spec:** `docs/superpowers/specs/2026-11-15-brief-driven-site-assessment-design.md`

## Global Constraints

- The site is static (GitHub Pages): no Python at runtime. `src/martian_map/sizing` is not modified.
- An unknown never reads as met. A brief that cannot be sized never falls back to the 150 kW reference facility.
- Every value resting on screening coefficients carries the existing assumption chip (`assumptionChip` in `web/src/ui/chips.js`).
- "Simulated" demo values never change a status, the priority or a verdict; a factor with a real Result never uses its simulated value.
- Every setup-taking function keeps one `setup` argument (`footprintSpecs`, `initialStatuses`, `terrainChecks`, `environmentChecks`). The brief-sourced setup is `{ source: 'brief', power, sizing }`; functions branch on `setup.source === 'brief'`. `FIXED_SETUP` stays for the `__map.applySetup` test hook only.
- `FACILITY_LABEL` stays exported from `web/src/ui/landing.js` with its current text (the navigation lane imports it).
- The placed layout keeps parts `compound`, `radiator` and (when solar is used) `solar`, each with its footprint and lon/lat. `getSite`'s result is unchanged.
- Public repository: no internal references or absolute local paths in code, tests or docs.
- Tasks 5–8 start only after rebasing onto the map lane's Task 12 tip (the map session sends the SHA). Tasks 1–4 touch no existing `web/src` file except `web/tests/suites.js`.
- Copy fixed by the spec, verbatim:
  - "Answer these to size the facility: {labels}." (labels joined with ", ")
  - "Still to confirm" / "Recorded, not used in sizing yet: {labels}"
  - "Worked out from this brief with screening assumptions:"
  - "Calculated from your brief with screening assumptions — not a validated design."
  - "No candidate meets every requirement for this facility"
  - Field labels "Essential backup" (hours) and "Base power available" (kW)

## Review Focus

1. A Range answer (e.g. duration 90–180 sols): sized only when both ends size; the map uses the scenario with the larger `full_reference_plot_m2` (high on a tie). Test in Task 3.
2. "Inside the base": the engine returns only a base-integrated option; `sizeBrief` must still produce the dedicated option for the map. Test in Task 3.
3. Base connection: no solar plot; SC-03/SC-04 not applicable; base power below the facility peak blocks Continue. Tests in Tasks 3 and 7.
4. A site without a horizon grid, sun table or climate data keeps the engine's generic plot sizes and reads needs confirmation, never met. Test in Task 4.
5. Editing the brief after reaching Location assessment (Edit → change robots → Continue twice) re-sizes and re-checks every loaded site. Test in Task 8.

---

### Task 1: Coefficients copy and Python parity fixtures

**Files:**
- Create: `web/sizing/screening-v1.json` (byte copy of `src/martian_map/sizing/resources/screening-v1.json`)
- Create: `web/tools/sizing_fixtures.py`
- Create: `web/tests/fixtures/sizing.json` (generated)
- Test: `tests/test_sizing_web_parity.py`

**Interfaces:**
- Produces: `web/tests/fixtures/sizing.json` = `[{name, brief, request, options: [{id, scenario_id, deployment, specifications, layout_status}]}]`, sorted keys, `indent=1`, trailing newline.
- Produces: `request_for(brief) -> dict` in `sizing_fixtures.py` = `from_guided_brief(brief)` then:
  - `infrastructure.backup_duration` ← `brief.q.backup` (unit `hour`, known/range/unknown as `from_guided_brief`'s `q()` does)
  - `infrastructure.available_base_power` ← `brief.q.basePower` (unit `kW`) when `brief.power` is "Base connection" or "Hybrid", else unknown
  - `retention.products` ← a copy of `request.project.duration`
  - then `validate_request` again.
- Brief shape: the app's `defaultBrief()` (`web/src/state.js`) plus `q.backup = {mode, value, min, max, unit: 'hours'}` and `q.basePower = {mode, value, min, max, unit: 'kW'}`.

- [ ] **Step 1: Write the failing tests** in `tests/test_sizing_web_parity.py`:
  - `test_coefficients_copy_is_identical`: bytes of `web/sizing/screening-v1.json` == bytes of the Python resource.
  - `test_fixtures_are_fresh`: `sizing_fixtures.build()` (imported from `web/tools/sizing_fixtures.py` by path) returns a JSON string equal to the checked-in `web/tests/fixtures/sizing.json`.
  - `test_fixture_cases_present`: names include `example_filled`, `example_default`, `hybrid`, `base_connection`, `base_too_small`, `precision_assembly`, `coarse_survey`, `inspection_phase_end`, `ranges`, `deadline_impossible`, `inspection_without_robots`, `inside_base`.
  - `test_example_filled_values`: in `example_filled`'s `owner_case_dedicated` option, `workers` == 13, `modules` == 2, `round(full_reference_plot_m2, 2)` == 635.89, `round(facility_peak_kw, 2)` == 9.62.
- [ ] **Step 2: Run** `pytest tests/test_sizing_web_parity.py -q`. Expected: FAIL (files missing).
- [ ] **Step 3: Implement `build() -> str` and a `__main__` that writes the file** in `web/tools/sizing_fixtures.py`. The cases, all starting from `defaultBrief()`'s values (duplicate them in the tool as a dict, with a comment pointing at `web/src/state.js`):
  - `example_filled`: duration 180 known, retention 30 known, power "Solar + storage", backup 4 known.
  - `example_default`: unchanged (backup and basePower unknown).
  - `hybrid`: as `example_filled` with power "Hybrid", basePower 2 known.
  - `base_connection`: power "Base connection", basePower 20 known. `base_too_small`: basePower 5 known.
  - `precision_assembly` / `coarse_survey`: `quality` changed.
  - `inspection_phase_end`: jobs.inspection true (cadence "At phase end"), plus a fleet group `{id: 4, role: 'Inspection', count: 2, active: 2}`.
  - `ranges`: duration range 90–180, deadline range 1–4.
  - `deadline_impossible`: deadline 0.01 known.
  - `inspection_without_robots`: jobs.inspection true, no inspection or assembly group.
  - `inside_base`: deployment "Inside the base".
  Run `build_requirements(request_for(brief))`; keep `facility_options[*]` with `id, scenario_id, deployment, specifications` and `layout.status` as `layout_status`.
- [ ] **Step 4: Generate and run.** `python web/tools/sizing_fixtures.py` then `pytest tests/test_sizing_web_parity.py -q`. Expected: 4 passed.
- [ ] **Step 5: Commit** `feat(sizing): coefficient copy and Python parity fixtures for the browser port`.

### Task 2: The sizing engine in JavaScript

**Files:**
- Create: `web/src/sizing/quantity.js`, `web/src/sizing/workloads.js`, `web/src/sizing/facility.js`, `web/src/sizing/request.js`, `web/src/sizing/engine.js`
- Modify: `web/tests/suites.js` (add `./sizing.test.js` to `unit`)
- Test: `web/tests/sizing.test.js`

**Interfaces:**
- Consumes: `web/tests/fixtures/sizing.json`, `web/sizing/screening-v1.json` (Task 1).
- Produces:
  - `quantity.js`: `known(value, unit, refs, conditional = true)` (throws on non-finite), `unknown(unit, missing, refs = [])`, `calc(unit, inputs, fn)`, `createContext(request, bundle, endpoint)` → `{ param(key), answer(q, path), issue(code, message), issues }`. Same semantics as `sizing/contracts.py` (sorted, de-duplicated refs and missing inputs).
  - `workloads.js`: `estimateWorkloads(ctx)`; `facility.js`: `estimateFacility(ctx, work, deployment)`. Line-for-line ports of `workloads.py` / `facility.py`, including the release-order tiled scheduler (a binary min-heap of slot free times) and the `max_jobs` / `max_workers` bounds.
  - `request.js`: `fromBrief(brief) -> request`, equal (deep) to `request_for(brief)` from Task 1.
  - `engine.js`: `buildOptions(request, bundle) -> option[]` (scenarios × deployments as `pipeline.py`: `owner_case`, or `low_endpoint`/`high_endpoint` when any quantity is a range; `dedicated`/`base_integrated` for `compare_both`). `option = { id, scenario_id, deployment, specifications, layout, workload }`. `loadBundle(url) -> Promise<bundle>` fetches the coefficient JSON.

- [ ] **Step 1: Write the failing tests** in `web/tests/sizing.test.js`, loading both JSON files with `fetch(new URL(..., import.meta.url))`:
  - `test('fromBrief matches the Python request for every fixture')`: `assertEq(JSON.stringify(sortKeys(fromBrief(c.brief))), JSON.stringify(sortKeys(c.request)))`.
  - `test('engine matches Python for every fixture')`: for each case and each option id: same set of option ids; for every specification key, same `status`; resolved values within `1e-9` relative (`Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))`); same `unit`; same `missing_inputs` when unresolved; same layout status.
  - `test('known rejects non-finite')`.
- [ ] **Step 2: Run** `pytest tests/test_web_map.py::test_unit_suite -q`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the five modules.** Keep the Python summation order (left to right, starting from 0) so the values match to the last bit.
- [ ] **Step 4: Run** `pytest tests/test_web_map.py::test_unit_suite -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sizing): the v1 sizing engine in the browser, matching the Python engine`.

### Task 3: `sizeBrief`: sized, needs answers, cannot size

**Files:**
- Create: `web/src/sizing/index.js`
- Test: `web/tests/sizing.test.js` (extend)

**Interfaces:**
- Consumes: Task 2's `fromBrief`, `buildOptions`, `estimateWorkloads`, `estimateFacility`, `createContext`.
- Produces:
  - `sizeBrief(brief, bundle) -> Sizing`, with `Sizing = { status: 'sized'|'needs_answers'|'cannot_size', missing: [{input, label, tab}], problems: [{reason, message, tab}], options, assessed }`.
  - `SIZE_KEYS` = `['workers','required_storage_tb','facility_peak_kw','facility_average_kw','heat_rejection_kw','required_solar_average_kw','solar_panel_area_m2','solar_plot_m2','radiator_emitting_area_m2','radiator_plot_m2','battery_units','modules','core_area_m2','full_reference_plot_m2','required_allowable_bearing_kpa']`. The brief is sized when all of these are resolved in every scenario's dedicated option.
  - `sizing.params`: `{ solar_land_coverage, radiator_plot_factor, module_length_m, module_width_m, module_clearance_m }`, the bundle's values, so later tasks never reload the bundle.
  - `briefSetup(sizing, brief) -> { source: 'brief', power, sizing }`, with power "Solar + storage" → `solar_batteries`, "Hybrid" → `topup`, "Base connection" → `base_only`.
  - `INPUT_LABELS`: `input:project.duration` → "Project duration"; `input:retention.raw` → "Keep raw survey data"; `input:infrastructure.power_strategy` → "Available power"; `input:infrastructure.backup_duration` → "Essential backup"; `input:infrastructure.available_base_power` → "Base power available"; `input:operations.hours_per_sol` → "Operating time"; `input:jobs.<id>.deadline` → "Results needed within"; `input:jobs.<id>.cadence` → "{output label} frequency"; `input:fleet.<i>.count|active_count` → "Robot group {i+1} numbers". Tab: fleet → 1, all others → 2. Order: brief order (tab, then the order above), de-duplicated.

Rules:
- `missing` = the `input:` entries among the SIZE_KEYS missing inputs, plus "Base power available" when power is Base connection or Hybrid and `q.basePower` is unknown.
- When `missing` is empty and something is still unresolved, or for Base connection with base power below `facility_peak_kw` in some scenario, the status is `cannot_size`, with `problems` from the spec's table (messages verbatim, `{deadline}` as "{n} hour(s)", `{max_workers}` and `{max_jobs}` from the bundle, `{Output}` the output label, `{roles}` "Inspection or Assembly", `{b}` and `{peak}` rounded to one decimal). Tabs: Operations = 2, Robots = 1. With a range and one failing end, the message ends with " (at the {low|high} end of your ranges)".
- `assessed`: the dedicated option; with ranges, the scenario with the larger `full_reference_plot_m2` (high on a tie). When the request's deployment is `base_integrated`, also compute a dedicated option (same request and context, `estimateFacility(ctx, work, 'dedicated')`) and use it as `assessed`; `options` keeps the engine's list.

- [ ] **Step 1: Write the failing tests:**
  - `example_default` → `status === 'needs_answers'`, `missing.map(m => m.label)` deep-equals `['Project duration', 'Keep raw survey data', 'Available power', 'Essential backup']`, every `tab === 2`.
  - `example_filled` → `sized`; `assessed.specifications.workers.value === 13`.
  - `deadline_impossible` → `cannot_size`, `problems[0].reason === 'equipment:worker_search_limit'`, message starts "The results can't be ready within 0.01 hours with up to 256 computers.", tab 2.
  - `inspection_without_robots` → `cannot_size`, message "Inspection reports needs Inspection or Assembly robots. Add a group or untick the output.", tab 1.
  - `base_too_small` → `cannot_size`, message "Base power available (5.0 kW) is below the facility's 9.6 kW peak. Raise it, or choose Hybrid or Solar + storage."
  - `base_connection` with `q.basePower` unknown → `needs_answers` with "Base power available".
  - `ranges` → `sized`; `assessed.scenario_id` is the scenario with the larger plot.
  - `inside_base` → `sized`; `assessed.deployment === 'dedicated'`.
  - `briefSetup` power mapping for the three choices.
- [ ] **Step 2: Run** the unit suite. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `web/src/sizing/index.js`.
- [ ] **Step 4: Run** the unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sizing): sizeBrief statuses, plain reasons and the brief-sourced setup`.

### Task 4: Site sizing and the new Results (pure)

**Files:**
- Create: `web/src/requirements.js`
- Modify: `web/tests/suites.js` (add `./requirements.test.js`)
- Test: `web/tests/requirements.test.js`

**Interfaces:**
- Consumes: `pvSeries`, `ETA` from `web/src/environment.js` (import only; do not edit); `statusFor`, `STATUS` from `web/src/status.js`; a brief-sourced setup (Task 3).
- Produces:
  - Constants `EMISSIVITY = 0.85`, `RADIATOR_K = 300`, `SIGMA = 5.670374419e-8`.
  - `radiatorFluxWm2(tSinkK) -> number` = ε σ (T_r⁴ − T_sink⁴).
  - `warmestAirK(mcdThermal) -> number` = max of `air_temperature_2m_k` over every scenario, season and time; `NaN` without data.
  - `sitePanelWm2(site, env) -> number` = 1000 × mean over all entries of `pvSeries(site.sunTable, site.horizon, [centreCell], env.mcdSolar.scenarios.climatology, 1)`. `centreCell` is the horizon cell containing the site box centre. `NaN` when any input is missing.
  - `siteSizing(site, setup, env) -> { solarPanelM2, solarPlotM2, panelWm2, solarFrom, radiatorAreaM2, radiatorPlotM2, radiatorWm2, tSinkK, radiatorFrom }`. `*From` is `'site'` or `'generic'`; generic uses `assessed.specifications.solar_panel_area_m2 / solar_plot_m2 / radiator_emitting_area_m2 / radiator_plot_m2`. Site formulas are as in spec section 5, with `solar_land_coverage` and `radiator_plot_factor` from the sizing's bundle values. A radiator flux ≤ 0 counts as `'site'` with infinite area (TC-03 not met).
  - `briefChecks(site, layout, setup, size) -> Map<id, Result>` for `BT-17`, `BT-21`, `GI-01`, `TC-03` (SC-03 stays in `environment.js`, Task 7). Results have the shape `checks.js` uses: `{id, value, unit, display, target: {baseline, ideal, label}, status, ideal, evidence, note, assumption, straddles, appliesTo}`.
    - BT-17: `needs_design_input`, baseline "≥ 4 m, grade ≤ 10°" (from `corridor_width_m` / `vehicle_grade_limit_deg`), note "needs a planned route; route planning comes from the navigation lane".
    - BT-21: value = straight-line compound-centre-to-base distance ÷ `service_distance_limit_m`; met ≤ 1.0, ideal ≤ 0.8; display "{d} m of {limit} m"; `assumption: true`.
    - GI-01: `needs_fieldwork`, baseline "≥ {bearing} kPa" (one decimal), note "ground strength has not been measured at any candidate".
    - TC-03: when `radiatorFrom === 'site'` and the flux > 0: met, value 1.0, display "{flux} W/m² · {area} m² of radiator", `evidence: 'model'`, `assumption: true`, note naming ε 0.85, 300 K, the sink temperature in K, and "absorbed sunlight and nearby surfaces are not modelled". Flux ≤ 0: not met, display "too warm for a 300 K radiator". Generic: `needs_confirmation`.

- [ ] **Step 1: Write the failing tests:**
  - `assertClose(radiatorFluxWm2(258), 176.85, 0.01)`.
  - `warmestAirK` on a fixture with two scenarios returns the max; `{}` → `NaN`.
  - `siteSizing` with fixture site and env: the solar plot equals `required_solar_average_kw * 1000 / panelWm2 / 0.5` (within 1e-9); without `site.horizon` → `solarFrom === 'generic'` and the generic plot.
  - `briefChecks` BT-21: base 1500 m from the compound → value 0.5, met and ideal; 13 000 m → not met.
  - GI-01 `needs_fieldwork` with baseline "≥ 6.2 kPa"; BT-17 `needs_design_input`.
  - TC-03: met for T_sink 258 K; not met for T_sink 305 K; `needs_confirmation` when generic.
- [ ] **Step 2: Run** the unit suite. Expected: FAIL.
- [ ] **Step 3: Implement** `web/src/requirements.js`. Build sites and envs with `web/tests/fixtures.js` helpers (`makeGrid`, `fixtureSite`).
- [ ] **Step 4: Run** the unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): per-site plot sizing and the brief's BT-17/BT-21/GI-01/TC-03 results`.

### Task 5: The brief asks for and checks the answers the size needs

*Start of the integration phase: rebase `feat/brief-sizing` onto the map lane's Task 12 tip, run both suites, then begin.*

**Files:**
- Modify: `web/src/state.js` (`defaultBrief()`: `q.backup = {mode: 'unknown', value: 4, min: 1, max: 8, unit: 'hours'}`, `q.basePower = {mode: 'unknown', value: 20, min: 10, max: 50, unit: 'kW'}`)
- Modify: `web/src/ui/brief.js`
- Test: `web/tests/ui.test.js`

**Interfaces:**
- Consumes: `sizeBrief`, Sizing (Task 3).
- Produces: `createBrief(el, side, { onChange, onTab, onDone, size })`. `size(brief) -> Sizing` is injected by `main.js` (Task 6); when absent, the Review behaves as today. `reviewRows(b, sizing)` and `stillToConfirmText(b, sizing)` take the Sizing.

- [ ] **Step 1: Write the failing tests** (DOM tests in `ui.test.js`, with `size` bound to the real `sizeBrief` and the bundle):
  - Default brief, Review, Continue: `onDone` not called; the alert reads exactly "Answer these to size the facility: Project duration, Keep raw survey data, Available power, Essential backup."; the Operations tab is current; the "Retention, infrastructure & continuity" disclosure is open.
  - "Still to confirm" shows those four labels; "Recorded, not used in sizing yet: Survey area, Road length" is shown.
  - "Base power available" appears only when Available power is "Base connection" or "Hybrid".
  - After filling in duration 180, retention 30, "Solar + storage" and backup 4: the review lead reads "Worked out from this brief with screening assumptions:"; the summary line is "13 computers · 9.6 kW peak · 17 TB storage · 2 modules"; the Buildable terrain row contains "636 m² of flat ground · pad ≤ 5° · bumps ≤ 0.3 m"; Ground & ice "ground must hold ≥ 6.2 kPa"; Solar "≥ 3.9 kW on average · 97 m² of panels · resized at each site"; Thermal "get rid of 9.6 kW of heat · 55 m² of radiator · resized at each site"; Investigation routes "≤ 3 km from base · grade ≤ 10° · 4 m corridor"; each row has an assumption chip; Continue calls `onDone`.
  - `deadline_impossible`: Continue shows its `cannot_size` message and opens Operations.
- [ ] **Step 2: Run** the unit suite. Expected: FAIL.
- [ ] **Step 3: Implement.** Display rounding: m² to whole numbers; kW and kPa to one decimal; TB whole when ≥ 10, else one decimal; km = metres ÷ 1000 with up to one decimal. Base connection solar row: "No solar plot: the base supplies {base} kW, the facility peaks at {peak} kW". Unsized rows: "Needs: {labels}" (the missing inputs of that row's specs) or the `cannot_size` message.
- [ ] **Step 4: Run** the unit suite. Expected: PASS (existing brief tests included; update any that asserted "Awaiting sizing").
- [ ] **Step 5: Commit** `feat(brief): ask for and require the answers the facility size needs; show the calculated requirements`.

### Task 6: Calculated facility on the facility step and on the map

**Files:**
- Modify: `web/src/ui/landing.js`, `web/src/layout.js`, `web/src/main.js`
- Modify: `docs/superpowers/specs/2026-11-14-site-explorer-map-design.md` (step 2 and Facility setup sections) and `docs/design-guidance.md` §7: the reference label applies to the reference facility only; the calculated facility uses the sized label.
- Test: `web/tests/layout.test.js`, `web/tests/ui.test.js`

**Interfaces:**
- Consumes: `briefSetup`, `loadBundle`, `sizeBrief`; `siteSizing` (Task 4).
- Produces:
  - `footprintSpecs(setup, size = null)`. For a brief setup: compound `w = modules × (module_length_m + 2 × module_clearance_m)`, `h = module_width_m + 2 × module_clearance_m`; radiator a square of `size ? size.radiatorPlotM2 : radiator_plot_m2`; solar a square of `size ? size.solarPlotM2 : solar_plot_m2`, only when power ≠ `base_only` and the area > 0. Other setups are unchanged.
  - `facilityLabel(setup) -> string` in `landing.js`: the sized label for a brief setup, else `FACILITY_LABEL`. `facilityEl(setup, opts)` lists the calculated facility (spec section 4) for a brief setup. With ranges it shows both scenarios and marks the assessed one; with "Compare both" it adds "Inside the base: needs the base's space and services"; with "Inside the base" it says the map places the dedicated outline.
  - `main.js`: loads the bundle at start; passes `size: (b) => sizeBrief(b, bundle)` to `createBrief`; on the brief's `onDone`, `store.set('setup', briefSetup(sizeBrief(brief, bundle), brief))` before going to `facility`. A setup change re-places and re-checks loaded sites (the `applySetup` path).

- [ ] **Step 1: Write the failing tests:**
  - `footprintSpecs(briefSetup(example_filled))`: compound 36 × 10; radiator side `sqrt(radiator_plot_m2)`; solar side `sqrt(solar_plot_m2)`. With a size `{solarPlotM2: 400, radiatorPlotM2: 100}`: solar 20 × 20, radiator 10 × 10. With `base_connection`: no solar part.
  - `facilityLabel(FIXED_SETUP) === FACILITY_LABEL`; for a brief setup it is the sized label. The facility step for a brief setup shows "13 computers" and "Results are kept for the whole project", and not the reference label.
- [ ] **Step 2: Run** the unit suite. Expected: FAIL.
- [ ] **Step 3: Implement**, then update the two docs.
- [ ] **Step 4: Run** the unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): the facility step and the map use the facility sized from the brief`.

### Task 7: Checks from the sizing, site-sized SC-03, and the ranking line

**Files:**
- Modify: `web/src/checks.js` (BT-04/05/08 limits), `web/src/environment.js` (SC-03 in place; SC-04's load), `web/src/main.js` (size each site before its best spot; merge `briefChecks`), `web/src/ui/list.js` (the line)
- Test: `web/tests/checks.test.js`, `web/tests/environment.test.js`, `web/tests/ui.test.js`, `web/tests/checks.real.test.js` or `web/tests/environment.real.test.js`

**Interfaces:**
- Consumes: `siteSizing`, `briefChecks` (Task 4), the brief setup (Task 3), `footprintSpecs(setup, size)` (Task 6).
- Produces:
  - `terrainChecks(site, layout, setup, scenario, opts)`: for a brief setup, BT-04 limit = `pad_slope_limit_deg`, BT-05 = `local_slope_limit_deg`, BT-08 = `roughness_limit_m` from `setup.sizing.assessed.specifications`; ideals from the scenario as today.
  - `environmentChecks(site, layout, setup, env)`: for a brief setup, SC-03 uses the placed solar plot's panel area (half the plot) and compares against `required_solar_average_kw`: baseline "≥ {x} kW (from your brief)", no ideal, note adds "panels sized for this site: {area} m²". SC-04 uses `required_solar_average_kw` as the load. Other setups are unchanged.
  - Per site in `main.js`: `size = siteSizing(site, setup, env)` → `footprintSpecs(setup, size)` → best spot → `terrainChecks` + `environmentChecks` + `briefChecks(site, layout, setup, size)`, merged so `briefChecks` wins on the same id.
  - `list.js`: when every row of the region has failures, "No candidate meets every requirement for this facility" appears above them.

- [ ] **Step 1: Write the failing tests:**
  - `terrainChecks` with a brief setup whose sizing has `pad_slope_limit_deg` 3: BT-04's baseline reads "≤ 3°".
  - `environmentChecks` SC-03 for a brief setup: met when the site PV ≥ demand; baseline text "≥ 3.9 kW (from your brief)".
  - List: all rows failed → the line is present; one clean row → absent.
  - Real data (`MARTIAN_MAP_DATA`): with the `example_filled` brief setup, every Gale site has BT-17, BT-21, GI-01, SC-03 and TC-03 Results; `curiosity_recent` BT-21 is `not_met`; `near_base_north` and `near_base_west` have SC-03 and TC-03 `met`.
- [ ] **Step 2: Run** both suites (`test_unit_suite`, and `test_real_suite` with `MARTIAN_MAP_DATA` set to a folder holding the data snapshot). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): check each site against the facility sized from the brief`.

### Task 8: End-to-end flow, Pages build, docs

**Files:**
- Modify: `tests/test_web_map.py` (new flow test), `web/package.py` (only if `web/sizing/` is not already included), `docs/sizing-model.md` (one paragraph: the browser port and its parity test)
- Test: `tests/test_web_map.py`

- [ ] **Step 1: Write the failing test** `test_flow_brief_sizes_and_ranks(page, server_url)` (needs `MARTIAN_MAP_DATA`):
  1. Start the brief and go to Review. Continue shows "Answer these to size the facility: …".
  2. Fill duration 180, retention 30, "Solar + storage" and backup 4. Continue goes to Facility specifications, which shows "13 computers".
  3. Continue to Location assessment. The Gale list shows the near-base sites ranked and `curiosity_recent` set aside, failing BT-21.
  4. Edit the brief: Survey robots active 4 → 2, then Continue twice. The facility step's computer count changes, and the sites are re-checked (their BT-04 Result object is a new one).
  - Also `test_pages_build_includes_sizing`: the built dist contains `sizing/screening-v1.json`.
- [ ] **Step 2: Run** `pytest tests/test_web_map.py -k "brief_sizes or pages_build_includes_sizing" -q`. Expected: FAIL.
- [ ] **Step 3: Fix** whatever the flow exposes; include `web/sizing/` in the Pages build if needed; update `docs/sizing-model.md`.
- [ ] **Step 4: Run** the full checks: `pytest -q` (Python), `pytest tests/test_web_map.py -q` (with `MARTIAN_MAP_DATA` set), and `pytest tests/test_sizing_web_parity.py -q`. Expected: all pass, no console errors.
- [ ] **Step 5: Commit** `test(map): end-to-end brief → facility → ranked sites; Pages build includes the sizing coefficients`.
