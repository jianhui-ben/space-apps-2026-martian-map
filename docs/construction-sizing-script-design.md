# Construction inputs to location requirements: script design

> Implementation status (2026-11-15): the single-phase conditional screening engine is now implemented. See [sizing-model.md](sizing-model.md) for the supported API, assumptions and remaining scope; this document retains the broader target design.

Status: proposed implementation design, 2026-11-15. The owner-input → sizing → location-requirements workflow is agreed. The interfaces and implementation choices below are design proposals. This document does not implement the estimator or select engineering coefficients.

## 1. Goal and boundary

Accept construction-project information from a UI, validate and normalize it, estimate supporting computing infrastructure where sufficient model inputs exist, and emit a versioned requirement package for a separate Mars site-feasibility algorithm.

Flow: UI form → JSON request → validation → workload model → equipment/facility options → five-category requirement package → downstream feasibility assessment.

The script owns demand estimates and requirement definitions. It does not download Mars data, pick a site, certify a foundation, solve candidate-specific solar/cooling performance, or assign meets/fails results. It can return a useful partial package when evidence or engineering inputs are missing. A numerical output must never be invented merely to complete the flow.

The owner describes construction work. Technical profiles supply sensor rates, benchmark runtimes, equipment properties, and policy assumptions. Those profiles are a separate, versioned input to the calculation, not hidden constants.

## 2. Approaches and selected design

| Approach | Benefit | Limitation |
|---|---|---|
| Calculate entirely in the UI | Simple initial deployment | Duplicates Python models, makes provenance and offline regression harder |
| Python engine with JSON contracts and CLI; thin future API adapter | Fits the existing repository, one calculation implementation, usable by UI and automated tests | A browser UI needs a backend adapter or explicit JSON import/export |
| Build a full asynchronous web service first | Supports hosted requests and job management | Adds deployment and queue scope before the model is validated |

Use the second approach. Build a synchronous, deterministic Python library and CLI first. Specify the future HTTP adapter against the same request/response schema, without requiring a web framework in the calculation package. A browser cannot invoke the CLI directly; initial integration can export a request and import the response, or call the separately hosted adapter.

Use repository-compatible Python 3.9+ types and dataclasses. Add a JSON Schema validator dependency for boundary validation; keep cross-field checks in Python. Schema draft/version and dependency version will be pinned during implementation. JSON Schema documents are the canonical wire contracts; domain objects are internal. Do not generate production coefficients with an LLM.

## 3. UI behavior and field formats

Use selects for categories, numeric inputs for measurements, repeatable rows for fleets/phases/jobs, and map controls for locations. Avoid sliders for counts or engineering measurements: users need exact values and explicit units.

A numeric answer control offers **Known value**, **Estimated range**, or **Unknown** when the field permits uncertainty. Units are selected from a small field-specific list. The form must not preselect an assumed numerical answer as if it came from the owner. Display any applied profile defaults in an assumptions review before calculation.

### Project and locations

| Wire field | UI control | Options/type | Required behavior |
|---|---|---|---|
| project.id | Generated identifier | Stable string | Required; not manually typed |
| project.name | Short text | 1–120 characters | Required |
| project.structure_types | Multi-select | landing_pad, road, habitat, power_installation, utility_network, other | At least one |
| project.other_description | Short text | Description | Required when other selected; text alone cannot select a workload coefficient |
| project.start_epoch | Optional date/time | UTC timestamp | Unknown allowed; seasonal assessment later needs a dated or explicit seasonal scenario |
| project.duration | Number + unit | sol or earth_day | Positive value/range or unknown |
| locations.work_sites | Repeatable map polygons | Mars lon/lat geometry and stable site ID | Unknown allowed; blocks spatial comparisons dependent on these locations |
| locations.base | Map point or coordinate pair | Mars lon/lat | Unknown allowed |
| locations.delivery_points | Repeatable map points | Mars lon/lat and IDs | Unknown allowed |
| project.survey_area | Number + unit | m2 or km2 | Needed by area-scaled survey profiles; separate from facility footprint |
| project.road_length | Number + unit | m or km | Conditional on road work; may remain unknown |
| project.excavation_volume | Number + unit | m3 | Conditional on excavation profile; may remain unknown |

Map coordinates use explicitly declared Mars planetocentric latitude and east-positive longitude, not a terrestrial GeoJSON CRS assumption. Accept -180..360 input longitude and normalize to -180..180; reject out-of-range latitude. V1 accepts simple closed non-self-intersecting polygons that do not cross the antimeridian; unsupported geometry gets a field error. Do not use an Earth area formula to derive survey area. V1 uses the owner's survey-area answer; polygon-derived area is a later validated Mars geometry feature.

### Fleet and activities

| Wire field | UI control | Options/type | Required behavior |
|---|---|---|---|
| fleet[].id | Generated identifier | Stable group ID | Required; phases refer to this ID |
| fleet[].label | Short text | Optional descriptive name | Display only |
| fleet[].roles | Multi-select | survey, excavation, transport, assembly, inspection, other | At least one; roles alone do not create duplicate robots or jobs |
| fleet[].count | Integer input + Unknown choice | Nonnegative whole number or unknown | Required answer object; unknown keeps the group addressable and produces a validation dependency |
| fleet[].profile_id | Select | Compatible versioned robot profiles plus unknown | Unknown allowed; explain which estimates it blocks |
| phases[].id / name | Generated ID / text | Unique phase | At least one phase |
| phases[].start / duration | Number + unit | sol or earth_day; start relative to project start | Needed for phase overlap; unknown allowed |
| phases[].assignments[].fleet_id | Select | Existing fleet group | Required for each assignment |
| phases[].assignments[].activity | Select | survey, excavation, transport, assembly, inspection, idle | Required |
| phases[].assignments[].active_count | Integer input + Unknown choice | 0..fleet group count when known | Required answer object for each assignment; unknown blocks its activity data-rate estimate |
| phases[].assignments[].operating_hours_per_sol | Number | Earth hours per sol | Positive and at most configured sol_seconds / 3600; unknown allowed |
| phases[].assignments[].shift_start_hour | Number | Earth hours after local sol boundary | Needed for exact overlap; unknown allowed |
| phases[].assignments[].work_site_id | Select | Work-site ID or unknown | Optional until spatial requirements need it |

A fleet group is one physical pool. Multiple activity rows reference that pool. Reject schedules that assign more robots concurrently than a known pool contains. An unknown pool count remains referenceable by fleet_id, but capacity validation is unresolved even when active_count is known; the UI may show the known active count as a lower bound on pool size. Never invent the missing total. If timing or active counts are unknown, report unresolved concurrency rather than multiplying roles by fleet size. V1 shifts cannot wrap past a sol boundary; the UI can split a wrapping shift into two rows.

### Required outputs, quality, and deadlines

| Wire field | UI control | Options/type | Required behavior |
|---|---|---|---|
| jobs[].id | Generated identifier | Stable job ID | Required |
| jobs[].type | Select | terrain_map, progress_comparison, inspection_analysis, fleet_plan, engineering_simulation, archive_ingest, other | Owner chooses only required outputs; do not automatically enable all jobs |
| jobs[].phase_ids | Multi-select | Phase IDs | At least one |
| jobs[].scope | Select + reference | One fleet_group, one work_site, or project | Defines one shared job rather than one copy per robot |
| jobs[].input_bindings | Profile-assisted source selectors | Named input slots bound to robot streams or upstream job outputs | UI proposes unambiguous compatible bindings; unresolved slots stay explicit |
| jobs[].trigger | Select + number | every_n_operating_hours, once_per_sol, phase_end | Positive cadence where applicable; unknown allowed |
| jobs[].deadline | Number + unit | minute or hour after collection closes (or a non-sensor trigger) | Positive or unknown |
| jobs[].quality | Select | coarse_survey, earthworks_check, precision_assembly, custom, unknown | Selects a compatible task profile, not a universal numerical tolerance |
| jobs[].tolerance | Number + unit | mm, cm, m | Required for custom; otherwise optional override/unknown; not the data-center foundation tolerance |
| jobs[].late_action | Single choice | pause_dependent_work, continue_with_previous_result, defer_nonessential_work, unknown | Owner defines operational consequence |
| jobs[].priority | Single choice | essential, routine, deferrable | Reviewed owner classification; does not turn robot safety loops into central jobs |
| jobs[].profile_id | Select | Compatible task profiles or unknown | Requires a technical profile for numerical runtime estimates |

If the same survey supports several outputs, reference the same input dataset stream. Do not store or ingest the raw stream once for every consumer. Prevent duplicate project-wide jobs generated from multiple robot rows. Units and hardware-dependent memory requirements come from profiles.

### Retention, infrastructure, resilience, and growth

| Wire field | UI control | Options/type | Required behavior |
|---|---|---|---|
| retention.raw / products / logs | Number + unit for each | sol or earth_day | Positive/range/unknown; explicit zero means do not retain after processing |
| continuity.recoverable_data_loss | Number + unit | minute or hour | Zero allowed; unknown is different from zero |
| continuity.allowed_service_outage | Number + unit | minute or hour | Zero allowed; unknown allowed |
| continuity.failure_case | Single choice | none_requested, one_compute_node, one_module, unknown | Selects failure case, not a guaranteed availability percentage |
| infrastructure.mode | Single choice | base_integrated, dedicated, compare_both | Default compare_both, clearly labeled as a tool choice |
| infrastructure.power_strategy | Single choice | base_connection, solar_storage, hybrid, compare_options, unknown | No strategy implies free or unlimited base power |
| infrastructure.available_base_power | Number + unit | kW | Value/range/unknown; no constant supply inference without a stated availability schedule |
| infrastructure.base_power_schedule_id | Select | Versioned supply scenario or unknown | Required to establish temporal supply |
| infrastructure.existing_compute_profile_id | Select | Catalog configuration, none, unknown | Only credit verified compatibility and explicitly allocated resources |
| infrastructure.network_profile_id | Select | Approved network capability or unknown | Defines throughput, outage/buffering assumptions and connection limits |
| infrastructure.delivery_profile_id | Select | Vehicle/cargo capability or unknown | Provides loaded geometry, mass limits, slope and turning capability |
| infrastructure.investigation_profile_id | Select | Robot/crew mission capability or unknown | Supplies instruments, mission resources and return constraints, separately from construction fleet |
| infrastructure.maintenance_profile_id | Select | Maintenance/environmental-support package or unknown | Supplies service clearances and access assumptions |
| growth.mode | Single choice | none_planned, explicit_future_phase, unknown | No generic percentage uplift hidden in sizing |
| growth.future_phase_ids | Multi-select | Future phase IDs | Required if explicit growth selected |

An advanced technical panel can select a reviewed foundation, cooling, array, battery, and deployment template from the model bundle. Owners may leave these unknown. Geometry and acceptance limits must come from those templates or remain unresolved. Crew count, budget, or robot count is not a substitute for them.

## 4. Wire representation and normalization

Request envelope fields: schema_version, request_id, project_revision, project, locations, fleet, phases, jobs, retention, continuity, infrastructure, growth, model_bundle_id, and optional technical_overrides. IDs are stable across UI edits; project_revision changes after edits. Reject unknown object properties to catch misspellings. Invalid known values are errors; legitimate unknown answers are missing information, not malformed requests.

For numeric fields that allow uncertainty use this discriminated union:

```json
{"state":"specified","value":12,"unit":"hour_per_sol"}
```

```json
{"state":"range","min":8,"max":12,"unit":"hour_per_sol"}
```

```json
{"state":"unknown"}
```

Only documented optional fields may be omitted; an unknown field must not contain value/min/max. A known zero is represented as specified with value 0 and an allowed unit. Fleet counts and active counts use `{state: specified, value: integer, unit: count}` or `{state: unknown}`; v1 does not allow count ranges. The state object is required, even for unknown counts. Reject booleans as numbers, NaN/infinity, negative quantities where forbidden, reversed ranges, unsupported units, and orphan references. Not-applicable states are derived from explicit scope choices rather than used as a universal escape from validation.

For nonnumeric fields, profile selectors use the literal enum value `unknown` when no catalog ID is known. Categorical fields allow `unknown` only where listed in the input tables. Optional start_epoch may be null; omitted optional fields normalize to unknown with a recorded reason. Locations use `{state: specified, value: ...}` or `{state: unknown}`; known point values are `{lon, lat}`, and known work-site/delivery lists contain objects with stable IDs and geometry. An empty specified delivery list means no delivery points have been designated, not unknown coordinates. A referenced site ID must exist even if that site's geometry is unknown. Fleet, phase, and job arrays may not contain null entries. Top-level blocks are required, with explicit unknown answers or empty arrays only where their scope permits it. A submitted project needs at least one fleet group, one phase, and one requested job; draft form persistence is a UI concern outside this API.

`jobs[].scope` is `{kind: project}` or `{kind: fleet_group|work_site, ref_id: ...}`. Each job has exactly one scope; separate intended outputs use separate job IDs. Infrastructure numeric values, retention, continuity durations, and phase times all use the quantity union. technical_overrides contains only approved model field paths with quantity/enum values and an override reason; reject unknown paths and require compatibility checks.

The normalized internal model uses seconds, metres, square/cubic metres, bytes, watts, joules, kilograms, kelvin, and degrees as appropriate. Display units may be kW, kWh, GB/TB. Define decimal GB/TB versus binary GiB/TiB explicitly. Earth hours are 3600 seconds; Earth days 86400 seconds. sol_seconds is a sourced, versioned model-bundle constant; never silently treat a sol as 24 hours. Relative schedule times do not require an Earth date, but seasonal site evaluation does.

Enumerations use stable machine codes from this document, with independent UI labels. Changes to meaning or units require a schema version change. Keep provenance in a separate normalized ledger keyed by JSON Pointer: origin (owner/model/equipment/derived), source ID/version, original answer, normalization, and dependencies.

## 5. Model bundle and missing scientific inputs

A model bundle is an immutable manifest with ID, version, content hash, validity notes, sol duration, scenario policy, and catalogs:

- Robot profiles: supported roles, sensor streams, collection duty cycle, raw rate, onboard filtering, retained rate, local autonomy, buffering, onboard electrical loads excluded from data-center IT load.
- Task profiles: input stream references, input-size/fidelity scaling rule, domain of validity, output size, per-job CPU/GPU/RAM/storage/network needs, benchmark runtime per supported hardware configuration, and source/validation status.
- Equipment profiles: compatible hardware/software, capacity, idle/active electricity, throughput, dimensions, loaded mass, support interface, environmental limits, deployment/maintenance constraints, and suitability status.
- Infrastructure templates: module arrangement, power conversion/support loads, panel and battery properties, radiator/cooling model, foundations and anchors, service spaces, staging, connections, access and expansion rules.
- Requirement policy registry: explicit applicability, inputs, evaluator contract, units, and limit source for each existing metric ID.

Each coefficient has a source reference and status: measured, vendor_specification, engineering_assumption, or synthetic_demo. Benchmarks have a declared valid input domain; extrapolation outside it is blocked unless a separately named sensitivity scenario permits it. No production numeric defaults are provided by this design. Missing profiles return partial/blocked results. Synthetic bundles may exercise the entire pipeline, but every output carries synthetic_demo and is excluded from evidence-backed feasibility conclusions.

Technical overrides must pass the same schema and provenance checks. Users cannot inject arbitrary Python expressions; scaling functions and evaluators come from an allowlisted implementation registry.

## 6. Processing stages

### A. Validate and resolve scenarios

Validate JSON structure, cross-field constraints, IDs, units, schedules, and model compatibility. Preserve unknowns. For ranges, produce named low/high endpoint scenarios and an owner-specified expected scenario only if supplied. Endpoint cases are sensitivity cases, not statistical confidence bounds or guaranteed global extrema. Represent correlations through explicit scenario overrides; do not combine incompatible best/worst assumptions. Cap enumeration in the bundle; return unresolved cases if the cap is exceeded.

### B. Build data streams and job instances

Data per phase/sol = sum(active units × collection seconds × retained bytes per second), respecting activity intervals and unique stream IDs. Add output data, fixed instruments and service logs separately. Generate job release times from triggers; release occurs only after required input collection/transfer and upstream jobs complete. Unknown collection or transfer timing blocks deadline guarantees.

#### Stream binding and dependencies

Each robot profile defines named stream keys and the activities that produce them. A concrete raw stream is identified by fleet_id + phase_id + assignment_id + stream_key; add a stable generated ID to every assignment. The same concrete stream is counted and retained once regardless of how many jobs consume it. Data rates for pooled active units aggregate under that stream; do not create duplicate raw streams for each consumer.

Task profiles declare named required input slots, accepted stream/output types, and output keys. `jobs[].input_bindings` maps each slot to one or more sources: `{kind: robot_stream, fleet_id, stream_key}` or `{kind: job_output, job_id, output_key, window_policy: same_window}`. Binding sources resolve within each job's phase and scope to the relevant assignments. A missing slot is represented by `{slot, state: unknown}`; a resolved slot by `{slot, state: specified, sources: [...]}`. Profile-assisted UI selection is allowed only when exactly one compatible source set exists; ambiguous choices remain unknown and require a selection. Bindings are technical selections, not sensor-rate questions for the owner.

An upstream job binding creates a dependency edge. Validate source IDs, output types, intersecting phase membership, and acyclic dependencies. V1 supports only matching collection windows (`same_window`): linked jobs must share the same phase and nominal trigger windows. Reject a declared incompatible binding with a field error; missing bindings remain partial. Do not silently consume the latest stale result. Future latest-available policies require an explicit maximum data age and a versioned extension. Downstream jobs may have different processing durations/deadlines even when their input windows match.

#### Exact trigger rules

Generate instances by (job_id, phase_id, scope, window_index), once per explicitly linked phase. A project-scoped job remains one shared job for that phase, not one job per assignment. If owners intend a single output after several phases, define a separate final phase/job instead of using phase_end across several phase IDs. Detect overlapping duplicate definitions for the same type/profile, scope, bindings, and trigger and require a distinct purpose or removal; do not silently multiply workload.

The operating clock advances over the union of active intervals of that job's input-producing assignments within the phase. Simultaneous robots do not accelerate the clock. `every_n_operating_hours` closes a collection window each time that clock accumulates n hours, continuing across sol boundaries within the phase; v1 also emits one final partial window at phase end if it contains data. `once_per_sol` closes one window at the last input-producing interval of each active sol, including a final partial sol. `phase_end` closes one window at the end of each referenced phase. A time window with zero collected data creates no analysis job; always-on services are sized separately. Profiles for jobs without sensor inputs declare their operating calendar; a missing calendar is unresolved.

Nominal trigger time closes the input window. Actual release waits for transfer and upstream computation to finish. The end-to-end owner deadline is measured from the time the required raw collection window closes, so upstream/transfer delays consume the turnaround budget; label the UI accordingly. For jobs with no sensor inputs it is measured from the nominal trigger. Missing timing leaves deadline compliance unresolved. This replaces any interpretation that each dependency gets a fresh full deadline after waiting.

### C. Size compute and network

Enumerate compatible configurations within explicit bundle search bounds. For v1, reserve a separately sized essential-service partition; schedule batch jobs non-preemptively by earliest deadline with stable job-ID tie breaks. A worker runs one batch job at a time, and must meet that job's full CPU/GPU/RAM requirements. Model dedicated worker pools by benchmarked configuration; do not convert all jobs into generic GPU-hours. Account for input transfer, storage bandwidth and shared-network reservations. Re-evaluate the declared failure case with unavailable resources.

This conservative scheduler establishes whether the tested configuration meets modeled deadlines; failure to find a schedule does not prove that no better scheduler or hardware could work. Return no_supported_configuration separately from a site failure. Search order is deterministic: enumerate a bounded catalog, reject capacity/deadline conflicts, then retain nondominated options by mean facility electricity, deployed mass, and provisional equipment footprint. Unknown comparisons stay unordered; do not choose an allegedly optimal option on missing dimensions. Retain an option per requested deployment/power strategy where supported, with stable tie breaks by configuration ID.

### D. Size storage and continuity

Integrate raw/products/log ingestion over phase schedules and retention windows. Cap retained duration by elapsed production history; evaluate peak live data across the project. Add working space and checkpoints. Apply copy policy, device redundancy and explicit headroom once. Size throughput separately from capacity. Compute backup replication and recovery feasibility against data-loss/outage requirements. A one-module failure needs copies and service capacity in a distinct failure domain, not merely extra disks in the same module.

### E. Derive facility specifications

Use selected equipment and template geometry to emit module counts, dimensions, loaded masses, support locations, service/staging clearances, layout constraints, connection limits and expansion variants. Calculate a load timeline by subsystem and operating mode, including essential and shutdown-survival demand only where supported. Attribute heat to rejection paths. Do not silently include the construction robots' charging power in the data-center IT load; export it as a separate external site load only if the project requests shared power infrastructure.

Initial solar/radiator dimensions may be estimated only under a named reference environment and marked conditional. Without such a model, emit the required energy/heat service plus a candidate-sizing task rather than an invented complete area. Record an equipment-only area separately from the full complex footprint. The latter remains unknown until support systems and access geometry exist.

### F. Generate location requirements

Generate requirement records for all 72 metric IDs, scoped by facility option, relevant component, and operating case. Multiple records per metric are allowed. Every metric must have a record or an explicit applicability reason. Use the five existing category codes: terrain, ground, solar, thermal, routes. Never apply an unrelated fixed legacy limit as a result of robot sizing.

The runtime registry contains one explicit policy per metric, authored from the existing requirement documents. It does not parse natural-language benchmarks at runtime. Engineering/design-dependent criteria use resolved design inputs; proposed comparison targets require an explicitly selected policy ID. In particular SC-03 does not automatically inherit the old 100 kW target, and the old 200 × 200 m footprint is not a universal requirement. GI-07 and TC-10 refer to one shared ground-deformation evidence/model dependency.

## 7. Script interfaces and integration

Proposed library entry point:

```python
build_requirements(request: dict, bundle: ModelBundle) -> dict
```

The core performs no network requests and does not mutate files. Reject malformed inputs through structured validation exceptions; missing but valid information returns a response package. Bundle loading and output persistence belong to adapters.

Proposed CLI, not currently available:

```text
python -m martian_map size --input project.json --model-bundle models/demo-v1 --output requirements.json
```

Use `--input -` for stdin and `--output -` for stdout. Machine JSON goes to stdout; diagnostics go to stderr. Write output files atomically. Exit 0 means a valid package was produced, including partial/blocked packages; it does not mean site feasibility. Exit 2 means invalid request/schema, exit 1 means bundle/I/O/internal failure. No implicit snapshot refresh or writes to data/catalog.json.

Future API adapter: POST /v1/construction-requirements accepts the same request and returns the same response. HTTP 200 for a valid ready/partial/blocked package; 422 for request validation; server/configuration failures use 5xx with a stable error code. Model bundle IDs resolve from a server allowlist, never client filesystem paths. The browser submits on explicit Calculate; edits invalidate the prior result. Echo request_id and project_revision so stale responses cannot replace a newer revision. Async jobs, user accounts, hosting and persistence are outside this script scope.

## 8. Response and downstream handoff

Response top-level fields:

| Field | Meaning |
|---|---|
| schema_version, request_id, project_revision | Wire version and UI correlation |
| model_bundle | ID, version, content hash and evidence status |
| normalized_input_hash | Canonical normalized inputs for reproducibility |
| status | ready, partial, blocked (definitions below) |
| input_issues | Paths, stable codes, severity, explanations and affected outputs |
| scenarios | Defined input variants and their assumptions |
| facility_options | Configuration, derived quantities, geometry, load/heat timelines, provenance and unresolved fields |
| location_requirements | Typed records described below |
| candidate_sizing_tasks | Site-dependent solar, cooling or layout requests |
| assumptions, provenance | Explicit source/dependency ledgers |

A derived quantity is `{status: resolved, value, unit, provenance_ids}` or `{status: unresolved, unit, missing_inputs}`; never place null or zero where an unresolved numeric result is expected. Scenario variants carry separate values rather than averaging uncertain inputs. Reference-environment estimates include `conditional_on` IDs.

`ready` means every applicable requirement record is specified and all candidate-sizing tasks have well-formed inputs; it does not mean a location meets them or that synthetic evidence is validated. `partial` means some evaluable criteria or sizing tasks exist but others have missing dependencies. `blocked` means no evaluable criteria/tasks can be produced. A complete illustrative package can be ready with evidence_status=synthetic_demo; the UI must display both fields independently.

Each requirement record contains:

- requirement_id, category, metric_id, facility_option_id, scenario_id, component_ids, operating_case.
- definition_status: specified, missing_inputs, or not_applicable. There is no meets/fails assessment in this producer's output.
- criterion: an allowlisted typed evaluator specification, or null with missing_inputs/reason. Types: scalar_compare (operator, threshold, unit, measurement_key), ratio_compare (numerator/denominator keys, comparator, dimensionless limit), layout_fit (component/constraint references), connectivity (nodes and permitted connections), or capability_check (design/vehicle/mission capability references). Quantities and geometry remain in referenced option records to avoid contradictory copies.
- applicability_reason, criticality from an explicit policy, limit_source, provenance_ids, evidence_needs, and missing_inputs. Evidence needs name the measurement, spatial/temporal domain, required resolution/accuracy if justified, and whether local measurement is necessary. Unknown evidence-quality requirements stay explicit.
- evaluator_id and evaluator_version. Unsupported evaluators are unresolved downstream, never silently skipped.

Example record for an incomplete but valid request:

```json
{
  "requirement_id": "option_a.BT-02.layout",
  "category": "terrain",
  "metric_id": "BT-02",
  "facility_option_id": "option_a",
  "scenario_id": "owner_case",
  "component_ids": [],
  "operating_case": "initial_deployment",
  "definition_status": "missing_inputs",
  "criterion": null,
  "applicability_reason": "A complete computing installation must fit at a candidate site.",
  "criticality": "required",
  "limit_source": "policy:complete_layout_v1",
  "provenance_ids": ["input:fleet", "model:deployment_template"],
  "evidence_needs": [{"measurement":"usable_terrain_geometry","resolution_status":"unresolved"}],
  "missing_inputs": ["facility_options.option_a.complete_component_geometry"],
  "evaluator_id": "layout_fit",
  "evaluator_version": "1"
}
```

The downstream request combines this immutable package with candidate IDs, candidate-specific evidence/catalog versions, placement proposals and environmental cases. The feasibility algorithm owns results `{requirement_id, assessment: meets|fails|unresolved|not_applicable, evidence_refs, reason}`. A missing-input record always yields unresolved, not not_applicable. Out-of-scope records preserve their reason. Unsupported policy versions invalidate that assessment, not the original inputs.

Candidate sizing tasks contain task_id, facility_option_id, kind (solar_storage, heat_rejection, layout), input_refs, required_evidence_keys, allowed_template_ids, and missing_inputs. They request a site-specific calculation, not a favorable result. Candidate-refined facilities get a new option revision and parent ID; previous assessments must be invalidated where dependencies change. The downstream orchestrator owns iteration and stopping criteria; it must report unresolved if its iteration limit is reached. The input-to-requirements script itself does not loop through sites.

## 9. Proposed repository changes for implementation

| Path | Responsibility |
|---|---|
| schemas/construction-request.schema.json | UI/CLI request structure, numeric union, enums and references |
| schemas/location-requirements.schema.json | Response, quantities, criteria, issues and sizing tasks |
| schemas/model-bundle.schema.json | Versioned profile/equipment/policy formats |
| src/martian_map/sizing/contracts.py | Typed models and serialization |
| src/martian_map/sizing/validation.py | Schema and cross-field validation, unit normalization |
| src/martian_map/sizing/profiles.py | Bundle loading, source validation and compatibility |
| src/martian_map/sizing/workloads.py | Streams, jobs, phase calendars and uncertainty cases |
| src/martian_map/sizing/capacity.py | Scheduling, compute/storage/network configurations |
| src/martian_map/sizing/facility.py | Equipment, loads, heat and geometry |
| src/martian_map/sizing/requirements.py | Metric policies, provenance and candidate-sizing tasks |
| src/martian_map/sizing/pipeline.py | Pure orchestration entry point |
| src/martian_map/cli.py | Add size command and error/output handling |
| models/demo-v1/ | Clearly synthetic profiles and all-72-metric registry for contract tests |
| tests/test_sizing_*.py and tests/fixtures/sizing/ | Validation, arithmetic, scheduling, propagation and round-trip fixtures |
| pyproject.toml / requirements.txt | Schema validation dependency; Python compatibility retained |

Add package initialization as needed. Reuse metric IDs from metrics.py for registry coverage checks; retain its dataset mapping role. Leave snapshot acquisition and data/catalog.json unchanged. Keep scenario/gale.json as geographic context and the earlier illustrative metadata; do not force the unvalidated construction_project block through load_scenario as a production request. Create a dedicated versioned request fixture and an explicit migration function only if importing that legacy block is needed. It must return missing values and provenance, not inferred answers.

No frontend framework or API server exists in this repo today. Their code paths are deliberately not invented here; their integration target is the schemas and adapter contract above.

## 10. Acceptance tests and delivery sequence

1. Contract/validation: every documented control has a schema field; invalid enum, unknown property, boolean-as-number, bad unit, non-finite value, dangling ID, overallocated fleet and overlapping shifts produce stable field errors. Unknown answers are accepted and propagated. Round-trip UI JSON preserves IDs and provenance.
2. Synthetic arithmetic: use clearly synthetic profiles to check rate × time × active count, phase retention, shared-stream deduplication, copy factors, unit conversions and subsystem power sums. No real robot performance claims arise from fixtures.
3. Deadline tests: two simultaneous jobs that each fit alone must trigger additional workers or a schedule conflict when their shared deadline cannot be met. Test RAM insufficiency, network/storage bottlenecks, dependencies, essential partitions and declared failure cases.
4. Unknown tests: twenty robots with no task profiles must not generate the legacy 150 kW or 200 × 200 m facility. Missing radiator or foundation inputs must produce partial requirements, not fictional dimensions or passes.
5. Mapping tests: cover all 72 IDs in the registry, all five categories in each package, all referenced evaluators, shared GI-07/TC-10 dependency, and explicit applicability. No unselected legacy benchmark is applied.
6. Handoff tests: validate generated response against schema; a stub feasibility consumer rejects incompatible versions, propagates missing-input records to unresolved and preserves IDs. Stale UI revisions are ignored. Synthetic evidence cannot be presented as an evidence-backed site decision.
7. Regression: existing scenario, catalog, metric and CLI tests continue to pass. New command does not change downloaded data or require a network connection.

Deliver contracts and the pure pipeline first, then synthetic end-to-end fixtures, then calibrated profiles and hardware data, and finally UI/API wiring and downstream integration. Numerical model calibration is a separate deliverable: the script can be complete as software while real facility estimates remain unavailable for uncalibrated jobs. Document that distinction in release notes.

## 11. Design review

A builder review identified ambiguous multi-phase triggers, unbound shared streams/job dependencies, and an undefined unknown-fleet representation. Sections 3–6 now define each explicitly. These are implementation choices within the agreed workflow, not newly supplied owner engineering data.

## 12. Decisions and remaining dependencies

The agreed product flow and five categories are fixed. This design proposes mixed UI controls, JSON contracts, Python core/CLI, explicit unknowns, conservative scheduling, versioned profiles, and a separate feasibility consumer. Hosting, UI framework, authentication and detailed deployment remain implementation/deployment choices outside this script.

Real robot sensor profiles, representative processing benchmarks, equipment suitability, infrastructure templates and engineering limits still need evidence. Until then the system supports partial answers or clearly synthetic demonstrations. The model bundle must not silently substitute the previous illustrative facility for those missing inputs.
