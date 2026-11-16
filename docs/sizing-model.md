# Construction-to-facility sizing model v1

Implemented entry point: `martian_map.sizing.build_requirements(request, bundle=None, evidence_only=False)`.
This is a **conditional screening model**, not a validated Mars engineering design or a site-feasibility classifier.
It turns an owner brief into workload, equipment, power, heat, reference layout and support-load estimates, then supplies the existing five location-assessment categories.

## Run

```sh
python -m pip install -e .
python -m martian_map size --input examples/sizing/construction-brief.json --output /tmp/facility-requirements.json
python -m martian_map size --input examples/sizing/construction-brief.json --evidence-only
```

`--model-bundle path.json` replaces the explicit coefficient bundle. `--input-format guided` accepts the selected Guided brief mock's exported state object. The adapter does not supply missing product retention, base power or backup duration: these become questions for the owner. This release supplies an adapter, not an HTTP service or a browser event binding. A UI backend can call:

```python
from martian_map.sizing import from_guided_brief, build_requirements
requirements = build_requirements(from_guided_brief(ui_state))
```

The web app does not call Python: `web/src/sizing/` is a browser port of the same engine (`request.js` maps the construction brief to a request as `from_guided_brief` does, plus product retention, base power and backup duration; `workloads.js` and `facility.js` port the workload and facility estimates; `index.js` `sizeBrief` returns the sized options, the missing answers or a plain reason it cannot size). It reads `web/sizing/screening-v1.json`, a byte-for-byte copy of `resources/screening-v1.json` that the Pages build ships. `tests/test_sizing_web_parity.py` checks the copy is identical and rebuilds `web/tests/fixtures/sizing.json` from the Python engine with `web/tools/sizing_fixtures.py` (a fixed list of briefs, each with its request and specifications), failing when the checked-in file is stale; regenerate it with `python web/tools/sizing_fixtures.py`. The JS unit suite checks the port's requests and specifications against those fixtures.

`from_intake(state)` turns a flat intake state (total robots, robot shares, active shares, type of work, schedule, processing, retention, power and backup; `examples/sizing/intake-default.json`) into a request, for scripts and the CLI examples.

Scale assumption: the coefficient bundle assumes a site data backbone for fleets of thousands of robots (100 Gbps shared link, up to 20,000 workers, up to 200,000 modeled tiles). Processing all project data at phase end for thousands of robots exceeds the tile bound and is reported as unresolved.

Malformed requests fail with field-level issues. CLI errors return exit code 2 and JSON on stderr. Successful partial results return 0; **this does not mean a site is feasible**. Output files are replaced atomically, and the input cannot also be the output.

## Input contract

The packaged `resources/request.schema.json` is the strict versioned contract. Quantities are specified (`state`, `value`, `unit`), ranges (`state`, `min`, `max`, `unit`) or unknown (`state: unknown`). Unknown is never zero. Counts are nonnegative integers; active robots cannot exceed the fleet total. Units are explicit and enforced.

- Project: name, structure types (multiple choice), duration in sols, survey area in m²; optional road length in metres.
- Fleet rows: role (survey, excavation, transport, assembly, inspection, unknown), total count and simultaneously active count.
- Operations: hours per sol; coarse survey, earthworks check or precision assembly.
- Jobs: terrain map, progress comparison, inspection analysis, fleet plan; once per sol, every N operating hours or phase end; deadline in hours.
- Retention: raw and product retention in sols, separately.
- Infrastructure: dedicated, base integrated or compare both; solar/storage, hybrid, base connection or unknown; available base kW and essential backup hours.

One operating phase and one project-wide schedule per job type are supported. Jobs share source ingestion; repeated analysis does not create another raw sensor stream. Range inputs produce simultaneous low/high endpoint scenarios, **not confidence bounds**. Structure types, survey area and road length are descriptive metadata in v1: the repo has no calibrated complexity/area model. They must not be interpreted as demand drivers yet. Advanced multi-phase/dependency fields from the broader design document are rejected rather than silently ignored.

## What is actually available in the repository

The metric registry is derived from `docs/requirements/metric-data-availability.md` and the catalog's dataset associations. It contains 21 buildable-terrain, 12 ground/ice, 13 solar, 12 thermal and 14 investigation-route metrics. Dataset IDs in the result are **catalog references only**. This engine does not download, read or verify payload coverage, resolution or freshness, and does not claim catalog entries are measurements. Candidate assessment must check those separately.

The repository's legacy facility document supplies provisional module dimensions and solar/radiator flux ranges. Scenario slope/roughness limits are provisional policies. Neither source establishes robot processing cost, qualified hardware, soil bearing strength or an actual facility design. The 150 kW and 200 × 200 m legacy examples are not used as robot-count defaults.

`resources/screening-v1.json` exposes every coefficient with units, evidence status and a source. Robot stream rates, processing costs, tileability, equipment capacities, support geometry and allowances are explicit engineering assumptions. Physical constants are separately labeled: [Mars solar day](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html), [JPL physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html). In evidence-only mode assumed coefficients become unresolved, so missing benchmarks cannot produce seemingly validated dimensions. A custom bundle can replace assumptions with measured/vendor values and traceable sources; this is the calibration boundary, not automatic verification of those sources.

## Calculation sequence

1. **Streams:** active robots × operating hours/sol × retained GB/active-robot-hour, by role. Stream rates describe retained data after onboard filtering, not raw camera wire rates.
2. **Jobs:** select the relevant source roles. Mapping/progress use survey streams; inspection uses inspection and assembly streams; fleet planning has fixed processing overhead. Each window is divided into independently executable reference tiles. Tile time = (GB × worker-hours/GB + fixed worker-hours) × precision factor. These costs and parallelism require benchmark calibration.
3. **Schedule:** enumerate bounded jobs, resetting recurring windows each sol. When every recurring job's deadline falls before the next sol starts (operating hours + deadline ≤ sol length), sols are independent, so one representative sol (plus a shorter last sol, and the phase-end window in its own slot) gives the same schedule as enumerating the whole project. Otherwise the whole project is enumerated. Serialize reads on the shared link and schedule tiles on worker slots in release/deadline order. Find the smallest sufficient worker count by doubling, then halving the gap, up to the configured worker limit. Memory overflow, too much enumeration or missed deadlines produce unresolved capacity, never a small fallback facility. This conservative schedule is not an optimizer or a fault-tolerance simulation. Add configured spare workers after sizing active capacity. Power averaging includes the completion tail after project end.
4. **Storage:** retained raw data plus retained products, replicated; raw capacity covers pending-job inputs even when archival retention is shorter (full phase for phase-end jobs; a conservative full sol plus deadline for recurring jobs); add unreplicated working data and headroom, then round up to storage units. Phase-end products conservatively keep the full product total when product retention is positive. If any phase-end job is selected this rule applies to all products. Product volume is a fraction of unique source data, not a calibrated per-output format model.
5. **Electricity and heat:** peak worker/storage/base IT power plus support overhead; average worker power combines idle draw with scheduled compute-hours. Peak facility electricity is the conservative heat-rejection envelope. Robot charging, construction machinery, habitat demand and shutdown-survival heating are not included. Battery capacity protects essential storage/base services for the requested duration, not continued construction processing.
6. **Physical envelope:** reference worker/storage/battery slots determine module count; module dimensions plus clearances determine core allocation. Modules are drawn as a compact near-square grid block; the solar square sits east of the block and the radiator square north of it, one clearance apart (`block_width_m`, `block_height_m`, `bounding_width_m`, `bounding_height_m`). Reference solar area = required mean solar kW × 1000 / net mean W/m². Reference radiator area = rejected kW × 1000 / net rejection W/m². Add array/radiator plot factors. Layout coordinates are local metres, not placements on Mars. Solar and radiator values must be recalculated at each candidate site.
7. **Support load:** reference module plus uniformly allocated equipment mass × Mars gravity × pressure allowance / total support area. This is a preliminary required allowable bearing pressure, **not measured ground strength**. Shielding, structures outside the core, foundations, unequal reactions, dynamic loads and settlement require further design. Slot counts are not a validated transport or structural envelope.

Base-integrated variants retain the dedicated reference quantities for comparison, but their layout is unresolved until the existing base's space and services are supplied. Hybrid subtracts supplied base contribution from mean power; seasonal generation and power dispatch remain unresolved. A base-connection strategy has zero requested solar contribution but still requires verification of available peak base capacity. No architecture is declared operationally adequate.

## Five-category output and evaluator handoff

| Category | Derived demand supplied | Candidate assessment still required |
|---|---|---|
| Buildable terrain | Reference core/array/radiator geometry, slope/roughness policies, corridor width | Complete external works and setbacks, terrain resolution, obstacles, grading, layout fit |
| Ground and ice | Reference support-pressure demand | Bearing/settlement evidence, ice response, foundation and ground-heating model |
| Solar/electrical | Mean solar contribution, energy/sol, peak supply, reference array and battery capacity | Seasonal/dust/shading cases, dispatch, base capacity, losses and essential energy |
| Thermal | Heat rejection and reference radiator area | Environmental envelope, actual rejection performance, cold protection, ground interaction |
| Investigation routes | Reference service distance, vehicle grade and link capacity context | Route objectives, validated mobility, instruments, time/resources, communication coverage and safe return |

`facility_options[].categories` contains the five summaries. `location_requirements` contains one record per metric per scenario/deployment. Seven metrics have scalar demand criteria where the model can define them (BT-04/05/08/17, GI-01, SC-03, TC-03); the remainder carry explicit missing engineering inputs. `specified` describes a criterion, never a site result. Every record stays `not_assessed`. Full layout metrics remain undefined until missing external works and clearances are supplied. GI-07 and TC-10 carry their coupled ground-thermal dependency.

An evaluator must resolve missing design inputs, verify dataset evidence and candidate coverage, refine power/cooling/layout at the candidate, then compare the site's capability against each demand. It must not interpret an absent criterion as a pass, or average away a failed mandatory requirement. Route-category scalar context is not a substitute for the investigation-route metrics.

Every resolved quantity carries units, provenance IDs and an assumption flag. Results also include the input hash, model version/hash, source ledger, unresolved dependencies, input issues and candidate-dependent sizing tasks. No timestamps or random state are used, so identical request/model inputs give identical output.

## Example and verification

The checked-in example is the app's default construction intake (`examples/sizing/intake-default.json`, converted by `from_intake`): 3,500 robots doing earthworks (700 survey, all active; 1,750 excavation and 1,050 transport, 80% active), 12 operating hours/sol, a 180-sol project, a terrain map, progress comparison and fleet plan once per sol with a 4-hour turnaround. Under the **unvalidated screening coefficients**, it produces 389 workers, about 269 kW facility peak and about 1.48 ha of net reference component allocation in a block about 152 × 141 m. A facility of about 1 ha (about 500 active survey robots) is the smallest that makes the choice between the candidate sites meaningful. This area excludes external works and is not an approved building site size. The full generated result is in `examples/sizing/facility-requirements.json`.

Tests cover invalid inputs/units, unknown and range propagation, hand-calculated storage/ingestion, deadline and memory constraints, deterministic output, assumption-free mode, all 72 metric records and the CLI. Run `python -m pytest` after installing test dependencies. The broader design remains the roadmap; this document describes the implemented subset.
