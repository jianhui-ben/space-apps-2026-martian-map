# Brief-driven facility sizing and site assessment

Status: approved 2026-11-15. Branch `feat/brief-sizing`, based on `feat/site-explorer-map` at `51cfd7e`.

## Intent

The construction brief should decide the facility, and the facility should decide which of the hand-picked sites work.
Today the brief is only recorded: the Review tab says "Awaiting sizing" for every assessment category, Facility
specifications shows the fixed 150 kW reference facility, and the map checks that fixed facility at every site.

After this change:

1. The Review tab shows what the facility needs from a site, category by category, worked out from the brief.
2. Facility specifications shows the facility calculated from the brief.
3. Location assessment places that facility on each hand-picked site, checks the requirements there, sets aside the
   sites that fail one, and ranks the rest with the existing priority logic.

Changing the brief changes the answer.

## Goals

- Run the sizing calculator (`src/martian_map/sizing`, model `screening-v1`) in the browser, from the brief.
- Do not let the brief continue until every answer the size depends on is given (decision: keep the example's unknown
  answers; block Continue rather than pre-fill them).
- Replace "Awaiting sizing" with the calculated requirements, and the reference facility with the calculated one.
- Build the facility outlines on the map from the calculated facility.
- At every site, size the solar plot and the radiator for that site's sunlight and temperatures, place the outline,
  and score BT-04, BT-05, BT-08, BT-17, BT-21, GI-01, SC-03 and TC-03 from the calculated facility.
- Rank sites with the existing `prioritize()` using those results.

## Non-goals

- Finding new candidate sites. The seven scenario sites stay the only candidates.
- Changing the Python engine's model, coefficients or contract.
- Multiple construction phases, base-integrated layouts, planned routes, ground-strength evidence.
- Changing `from_guided_brief` in `src/martian_map/sizing`: the browser adds the new brief fields itself (section 1).

## Anti-goals

- An unknown never reads as met. A brief that cannot be sized never falls back to the 150 kW reference facility.
- Calculated values are never presented as a validated design: every value that rests on screening coefficients
  carries the existing assumption chip.
- The "Simulated" demo parts still never change a status, the priority or a verdict.

## Constraints

- The site is static (GitHub Pages): the calculator must run in the browser. The Python engine stays the reference,
  and the browser copy must give the same numbers.
- The map session keeps working on `feat/site-explorer-map`. New logic goes in new files; shared files change only at
  the touch points listed below. The map session is told the branch name, base and touch points before building starts.
- Deadline 2026-11-15 23:59 local.
- The repository is public: no internal references or local paths in code or docs.
- Nothing ships half-done: the branch is merged only when sections 1–7 work together. Until then the map on `main`
  keeps the reference facility, so the facility shown and the facility checked never differ.

## Approach

A JavaScript port of the v1 engine (quantity propagation, workloads, facility) in `web/src/sizing/`, checked against
outputs the Python engine produces for a fixed set of briefs. The coefficient file is copied into `web/` and a test
keeps it identical to the Python resource. The rest of the app consumes the port's result through the existing `setup`
and Result objects.

## Design

### 1. The calculator in the browser

Files in `web/src/sizing/`:

- `quantity.js`: `known(value, unit, provenance, assumption)`, `unknown(unit, missingInputs)`, `calc(unit, inputs, fn)`,
  the same semantics as `sizing/contracts.py` (any unresolved input makes the output unresolved and carries the union of
  missing inputs; assumption flags propagate).
- `workloads.js`, `facility.js`: line-for-line ports of `estimate_workloads` and `estimate_facility`, including the
  release-order tiled scheduler and its bounds (`max_workers`, `max_jobs`).
- `request.js`: `fromBrief(brief)`, the browser twin of `from_guided_brief` plus the new brief fields (section 2), and
  the request checks that matter for the brief (active ≤ total, interval rules). Range inputs give the engine's
  `low_endpoint` / `high_endpoint` scenarios; otherwise one `owner_case` scenario.
- `index.js`: `sizeBrief(brief) -> Sizing`.

```
Sizing = {
  status: 'sized' | 'needs_answers' | 'cannot_size',
  missing: [{ input, label, tab }],        // brief answers the size still needs, in brief order
  problems: [{ reason, message, tab }],    // when every answer is given but the facility still cannot be sized
  options: [{ id, scenario, deployment, specifications, layout }],   // as build_requirements' facility_options
  assessed: option | null,                 // the option the map places and checks (below)
}
```

Each specification value has the Python shape: `{status: 'resolved'|'unresolved', value, unit, missing_inputs,
provenance_ids, assumption}`.

`assessed` is the dedicated-installation option. With ranges, it is the scenario whose `full_reference_plot_m2` is
larger (the high endpoint on a tie), because terrain fit is the main site filter.

Coefficients: `web/sizing/screening-v1.json`, a copy of `src/martian_map/sizing/resources/screening-v1.json`.

`cannot_size` covers results that stay unresolved with every answer given. Each engine reason maps to a plain message
and the tab that can fix it:

| Engine reason | Message | Tab |
|---|---|---|
| `equipment:worker_search_limit` | "The results can't be ready within {deadline} with up to {max_workers} computers. Allow more time or ask for fewer outputs." | Operations |
| `model:max_jobs` | "This schedule needs more processing jobs than the model handles ({max_jobs}). Shorten the project or run outputs less often." | Operations |
| `fleet_role:…` | "{Output} needs {roles} robots. Add a group or untick the output." | Robots |
| `equipment:worker_memory` | "One job needs more memory than a computer has." | Operations |
| base power below the facility peak (Base connection) | "Base power available ({b} kW) is below the facility's {peak} kW peak. Raise it, or choose Hybrid or Solar + storage." | Operations |

With a range, the brief is sized only when both scenarios are; otherwise the message names the end that fails.

Parity: `web/tools/sizing_fixtures.py` converts each brief of a fixed list with the Python `from_guided_brief`, then
sets `infrastructure.backup_duration`, `infrastructure.available_base_power` and `retention.products` from the new
brief fields exactly as `fromBrief` does, runs `build_requirements`, and writes `web/tests/fixtures/sizing.json`
(brief, request and specifications for each). The JS tests check `fromBrief(brief)` against the stored request and
the port's output against the stored specifications. The Python reference therefore covers the engine; the mapping of
the two new fields is covered by the JS tests and documented in the fixture tool. The list covers: the example with
its open answers filled (180 sols, raw data 30 sols, solar + storage, 4 h backup); each power strategy (with a base
power value for hybrid and base connection); each precision level; a phase-end inspection job with an inspection
robot group; a range on duration and on the deadline; a brief whose deadline cannot be met within `max_workers`.

### 2. The brief: answers the size depends on

`sizeBrief` runs on every brief change. When its status is `needs_answers`:

- Review's Continue does not proceed. It shows the existing alert with "Answer these to size the facility: …" (plain
  labels, in brief order) and opens the tab and disclosure holding the first missing answer, as the existing tab
  checks do.
- "Still to confirm" lists the missing answers. Survey area and road length move to a separate line, "Recorded, not used
  in sizing yet: …", shown only when they are unknown.

Brief fields the calculator needs that the brief does not ask today, added to "Retention, infrastructure & continuity":

| Field | Kind | Default | Engine input |
|---|---|---|---|
| Essential backup | Known / Range / Unknown, hours | Unknown | `infrastructure.backup_duration` |
| Base power available | Known / Range / Unknown, kW; only when Available power is Base connection or Hybrid, and then required | Unknown | `infrastructure.available_base_power` |

Product retention is not asked: the calculator keeps results for the whole project (`retention.products` = project
duration), and Facility specifications says so.

With the example brief, the missing answers are: Project duration, Keep raw survey data, Available power, Essential
backup. Labels come from the field labels; the mapping from engine input to brief field lives in `request.js`.

### 3. Review: "What happens next"

When sized, the disclosure's lead text becomes "Worked out from this brief with screening assumptions:" followed by a
summary line and one row per category (values from `assessed`, rounded for display; each row carries the assumption
chip):

```
13 computers · 9.6 kW peak · 17 TB storage · 2 modules
Buildable terrain     636 m² of flat ground · pad ≤ 5° · bumps ≤ 0.3 m
Ground & ice          ground must hold ≥ 6.2 kPa
Solar conditions      ≥ 3.9 kW on average · 97 m² of panels
Thermal conditions    get rid of 9.6 kW of heat · 55 m² of radiator
Investigation routes  ≤ 3 km from base · grade ≤ 10° · 4 m corridor
```

With Base connection, the solar row reads "No solar plot: the base supplies {base} kW, the facility peaks at
{facility peak} kW". The solar and thermal areas are the engine's generic sizes; the rows add "resized at each site".
When not sized, each row reads "Needs: {labels of the missing answers that row depends on}", or the `cannot_size`
message.

### 4. Facility specifications

The calculated facility replaces the reference line and the "Illustrative reference — not calculated from your
project." label. It lists, from `assessed`: computers (active + spare), storage (TB and units), IT and facility peak
kW, facility average kW, energy per sol, heat rejection, solar panel and plot area (or "base supplies"), radiator
emitting and plot area, battery kWh and units, modules, core area, total plot, required ground bearing. Label:
"Calculated from your brief with screening assumptions — not a validated design." Results are kept for the whole
project (stated). With ranges, both scenarios are shown and the assessed one is marked. With "Compare both", a line
says the base-integrated option needs the base's space and services. With "Inside the base", the map still places
the dedicated outline, and the step says so.

### 5. The facility on the map

On Review's Continue, the store's `setup` becomes `{ source: 'brief', power, sizing }`, `power` mapped from the brief:
Solar + storage → `solar_batteries`, Hybrid → `topup`, Base connection → `base_only`.

The engine sizes the solar plot and the radiator for generic conditions (40 W/m² of panel output, 175 W/m² of
rejection). Checked against real data, those generic sizes are too small at every candidate (the panels would give at
most 0.8 of the demand at Gale, 0.73 at Jezero and 0.59 at Arcadia). So each site gets its own plot sizes before
placement, `siteSizing(site, setup, env)`:

- Solar panel W/m² at the site: the existing `pvSeries` for 1 m² of panel at the site box centre's horizon point,
  with the climate-model climatology flux, averaged over the year. Panel area = `required_solar_average_kw` × 1000 ÷
  that; solar plot = panel area ÷ `solar_land_coverage`. Without the sun table, horizon or climate data, the site keeps
  the engine's generic size and SC-03 reads needs confirmation.
- Radiator net W/m² at the site: ε σ (T_r⁴ − T_sink⁴) with ε = 0.85 and T_r = 300 K (assumptions, constants in
  `requirements.js`), and T_sink = the warmest 2 m air temperature in any of the region's climate-model scenarios
  (`env.mcdThermal`). Emitting area = `heat_rejection_kw` × 1000 ÷ that; radiator plot = area × `radiator_plot_factor`.
  Absorbed sunlight and nearby surfaces are not modelled, and the note says so. Without the climate data, the engine's
  generic size is kept and TC-03 reads needs confirmation.

`footprintSpecs(setup, site)` for this setup:

- `compound`: `modules × (module_length_m + 2 × module_clearance_m)` by `module_width_m + 2 × module_clearance_m`
  (the engine's reference layout: modules in a row, 18 m × 10 m each with the v1 coefficients).
- `solar`: a square of the site's solar plot, when solar is used.
- `radiator`: a square of the site's radiator plot.

The existing arrangement (radiator north, solar south, 10 m gaps), best spot, dragging and clamping are unchanged.
`FIXED_SETUP` remains only for the existing test hook and is never shown.

### 6. Site checks

New `web/src/requirements.js`: `briefChecks(site, layout, setup, env) -> Map<metricId, Result>`, run with the existing
checks; its Results replace same-id Results from the other check modules. Limits come from `assessed.specifications`.
Every Result uses the existing statuses and Result shape.

| Metric | Value at the site | Status |
|---|---|---|
| BT-04 overall pad slope | existing computation | met / not met against `pad_slope_limit_deg`; ideal from the scenario as today |
| BT-05 steepest 10 m patch | existing computation | against `local_slope_limit_deg` |
| BT-08 bumpiness | existing computation | against `roughness_limit_m` |
| BT-17 corridor | none yet | needs design input; target "≥ {corridor_width_m} m, grade ≤ {vehicle_grade_limit_deg}°"; note: needs a planned route; route planning comes from the navigation lane |
| BT-21 distance to base | existing straight-line distance ÷ `service_distance_limit_m` | met if ≤ 1.0, ideal ≤ 0.8 |
| GI-01 ground bearing | none | needs fieldwork; target "≥ {required_allowable_bearing_kpa} kPa"; note: ground strength has not been measured at any candidate |
| SC-03 average solar | the site's panel W/m² and the panel area sized from it | met when sized from site data; needs confirmation when the site data are missing. Not applicable with Base connection (existing rule) |
| TC-03 heat rejection | the site's net W/m² and the radiator area sized from it | met when sized from site data; not met if the net flux is zero or below (too warm for a 300 K radiator); needs confirmation without climate data |

Whether the site-sized plots fit is decided by the existing accommodation checks, SC-10 (solar plot) and TC-08
(radiator), and the compound by BT-04/05/08. A larger facility therefore makes a site harder to fit.

These Results carry `assumption: true` where a limit or coefficient is a screening assumption. GI-01 counts as a
critical unknown at every site through the existing rule for needs-fieldwork.

### 7. Ranking

`prioritize()` is unchanged. A site with any not-met Result is set aside, as today; the rest are grouped by critical
unknowns and layered on the existing indicators. When every site is set aside, the list says "No candidate meets every
requirement for this facility" above the set-aside sites.

### Touch points in shared files

| File | Change |
|---|---|
| `web/src/ui/brief.js` | Review rows and lead text; Continue gate; "Still to confirm" split; the two new fields |
| `web/src/state.js` | the new fields in `defaultBrief()`; the brief-sourced `setup` |
| `web/src/ui/landing.js` | the facility step shows the calculated facility |
| `web/src/layout.js` | `footprintSpecs(setup, site)` for the brief-sourced setup |
| `web/src/checks.js` | BT-04/05/08 limits from the setup when brief-sourced |
| `web/src/environment.js` | SC-03 baseline from the setup when brief-sourced |
| `web/src/main.js` | set `setup` on Review's Continue; size each site's plots before its best spot; run `briefChecks` with the other checks |
| `web/src/ui/list.js` | the "No candidate meets every requirement" line |

### Tests

- Parity: the JS port matches `web/tests/fixtures/sizing.json` (resolved values within 1e-9 relative; same unresolved
  set and missing inputs). A pytest regenerates the fixtures and fails when the checked-in file is stale, and asserts
  the coefficient copy is identical to the Python resource.
- Brief: the example brief's missing answers are exactly Project duration, Keep raw survey data, Available power,
  Essential backup; Continue is blocked and opens the first one; after answering, Review shows the rows above.
- `cannot_size`: a deadline no worker count meets; inspection reports without inspection or assembly robots; base
  power below the peak; each gives its message and tab.
- Footprints from a sized facility and site sizes; the radiator flux against a hand calculation; site panel W/m²
  against `pvSeries` for 1 m².
- Real data: every Gale site gets all eight Results; Curiosity recent path is not met on BT-21 (11–16 km from the base);
  the near-base sites have SC-03 and TC-03 met.

## Calls made in this design

- Product retention equals the project duration; not asked.
- Two new brief fields (Essential backup; Base power available, only for Base connection and Hybrid).
- The assessed option is the dedicated installation; with ranges, the larger total plot.
- BT-21 gains the sizing's 3 km service distance as its allowance.
- Solar plot and radiator are resized for each site's conditions; fit, not the generic size, decides.
- The radiator model uses ε 0.85, T_r 300 K and the region's warmest climate-model air temperature as the sink.
- Briefs that are fully answered but cannot be sized block Continue with a plain reason and the tab to fix it.
- Base power available is required for Base connection and Hybrid; for Base connection it must cover the peak.
- The parity fixtures add the two new fields after `from_guided_brief`; the Python adapter is not changed.
- "Inside the base" still places the dedicated outline on the map, and says so.

## Left to the builder

File-internal structure, CSS, copy not given above, the exact fixture brief list beyond the cases named, and test
helpers.

## Changes during implementation

What was built differs from the design above in these places:

- **The brief UI is the Twin Trails intake** (`design-reference/mars-construction-twin-trails.html`), not the tabs,
  unknown answers and Continue gate of sections 2 and 3. One "Construction site" panel asks for the type of work,
  the construction robots, the working time, the project duration and the turnaround ("Results needed within"). A
  "Planning defaults · optional to customize" disclosure holds the editable assumptions: project name, robot mix
  (survey and excavation shares, active shares), processing frequency and precision, raw data and processed output
  retention, power approach, base power and essential backup. Every field has a default, so the defaults are sized as
  they are. "Find area" checks the values (the first problem shows beside the button and its field is marked), then
  sizes the brief and opens the facility step: "Ready for location matching." with the calculated facility, the five
  "What the facility needs from a site" rows, "Edit brief" and "Assess locations →"; or, when the brief cannot be
  sized, "Review your brief." with the reasons and "Edit brief" only. Product retention is asked ("Keep processed
  outputs") and feeds `retention.products`; the facility step says how long processed outputs are kept when it
  differs from the project duration.
- **Solar sizing per site.** For Solar + storage the site's panels are sized for the worst season of the
  climatology (the lowest season-mean output at the site); for Hybrid they are sized for the year's average.
- **SC-03 and SC-04 for a facility sized from the brief.** SC-03 is met when the panels are sized from the site's own
  data; its value is the panel area × the site's annual-mean output, against the required average from the brief.
  SC-04 is the worst-season output of those panels over the required average.
- **Site fly-in.** The arrival altitude is scaled to the sized compound's width (with a floor), so a small facility's
  handles are visible when the fly-in ends; the looks and a setup change keep the standard camera.
- **Pages build.** The published site ships `web/sizing/` (the coefficient copy) with `src` and `vendor`.
- **Labels and reasons in the intake's terms.** Missing answers use the intake's field names (Working time, Project
  duration, Results needed within, Keep raw data, Keep processed outputs, Power approach, Essential backup duration,
  Available base power, Construction robots). The `cannot_size` reasons read: "The results can't be ready within
  {deadline} with up to {max_workers} computers. Allow more time or process less often."; "This schedule needs more
  processing jobs than the model handles ({max_jobs}). Shorten the project or process less often."; "{Output} needs
  {roles} robots: raise Construction robots or the robot shares in Planning defaults."; "Available base power ({b} kW)
  is below the facility's {peak} kW peak. Raise it, or choose Hybrid or Solar + storage." "Review your brief." leads
  with the mockup's schedule line only for the first two; otherwise with "This brief can't be sized as entered."
  Keeping no raw data or processed outputs, and no backup, are answers (0 is sized).
- **The map's facility from the start.** When the coefficients load, the brief as it stands (the defaults) is sized
  and becomes the setup, so a site opened from the landing's pins is checked against it; the reference facility is
  the setup only before that (or if the load fails) and for the test hook. The setup keeps the sizing brief it was
  sized from (`setup.brief`), and the facility step describes that brief.
