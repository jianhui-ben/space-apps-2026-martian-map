# `martian_map.sizing`

Turns a construction owner's project brief into estimated data-center
requirements, then into one requirement record for each of the 72 location
metrics across the five factors (terrain, ground and ice, solar, thermal,
routes).

This is a **screening model**. Its numbers rest on explicit, unvalidated
engineering assumptions. It never decides whether a site is feasible: every
metric record comes out as `not_assessed`. The full method, assumptions and
limits are in [docs/sizing-model.md](../../../docs/sizing-model.md).

## Use it

From the command line (run from the repo root):

```sh
python -m martian_map size --input examples/sizing/construction-brief.json --output /tmp/facility-requirements.json
```

| Option | What it does |
|---|---|
| `--input PATH` | The construction brief (JSON). Required. |
| `--output PATH` | Where to write the result. Without it, the result goes to stdout. Must differ from the input. |
| `--input-format request\|guided` | `request` (default) follows `resources/request.schema.json`. `guided` accepts the state exported by the Guided brief mockup. |
| `--model-bundle PATH` | Replace the default coefficients (`resources/screening-v1.json`) with your own, for example measured or vendor values. |
| `--evidence-only` | Treat every assumed coefficient as unknown, so only owner inputs and verified values produce numbers. |

Exit code `0` means a result was produced, not that a site is feasible.
Exit code `2` means invalid input; the error and field-level issues are
printed as JSON on stderr.

From the app's intake form state (see `examples/sizing/intake-default.json`):

```python
from martian_map.sizing import build_requirements, from_intake
result = build_requirements(from_intake(state))
```

From Python:

```python
from martian_map.sizing import build_requirements, from_guided_brief

result = build_requirements(request)                      # request follows the schema
result = build_requirements(from_guided_brief(ui_state))  # state from the Guided brief UI
result = build_requirements(request, evidence_only=True)
```

The result is a JSON-compatible dict. Identical inputs always give identical
output.

## How the code is laid out

| File | Role |
|---|---|
| `__init__.py` | Public API: `build_requirements`, `from_guided_brief`, `load_bundle` |
| `pipeline.py` | Runs the steps for each scenario and deployment option, and builds the 72 metric records |
| `validation.py` | Checks requests against the schema and rules such as "active robots ≤ total"; converts Guided brief and intake form state (`from_intake`) |
| `contracts.py` | Quantity values (known, range or unknown) and their provenance; unknown never becomes zero |
| `profiles.py` | Loads and checks a coefficient bundle: units, sources, evidence status, value ranges |
| `workloads.py` | Robot data streams, job scheduling against deadlines, and compute worker count |
| `facility.py` | Storage, power, heat, battery, reference layout and support pressure |
| `cli.py` | The `size` command: reads JSON, writes the result atomically |
| `resources/request.schema.json` | The versioned input contract |
| `resources/screening-v1.json` | The default coefficients. Each has a unit, a source and an evidence status |
| `resources/metrics.json` | The 72-metric registry, taken from `docs/requirements/metric-data-availability.md` |

## Calculation steps

1. **Streams:** active robots × operating hours × retained data rate, by robot role.
2. **Jobs:** split each job into tiles and schedule them on compute workers to meet each deadline, over one representative sol when sols are independent.
3. **Storage:** retained raw data and products, replicated, plus working space and headroom.
4. **Power and heat:** peak and average electricity; peak electricity is the heat to reject.
5. **Layout:** module count, core area, and reference solar and radiator areas, drawn as a compact block.
6. **Support load:** the ground bearing pressure the supports would need.

If a workload can't meet its deadlines within the worker limit, the result
is unresolved, never a small facility that looks feasible.

## What it doesn't do

- Download data or check that catalog datasets cover a candidate site. Dataset IDs in the output are references only.
- Size for more than one operating phase, or for dependencies between jobs.
- Include robot charging, construction machinery, habitat power or shutdown-survival heating.
- Turn structure types, survey area or road length into demand. In v1 they only describe the project.

## Tests

```sh
python -m pytest tests/test_sizing_contracts.py tests/test_sizing_model.py tests/test_sizing_handoff.py
```
