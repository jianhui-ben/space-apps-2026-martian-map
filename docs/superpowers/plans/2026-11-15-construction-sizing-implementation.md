# Construction sizing implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver an offline Python sizing model accepting construction/UI JSON and emitting traceable requirements for five Mars location factors.

**Architecture:** Pure calculation package, explicit screening-assumption bundle and evidence-only mode, JSON schemas, CLI and guided-brief adapter. Geographic evidence is indexed from the repository catalog; no local data file or benchmark is presumed present.

**Tech stack:** Python 3.9+, jsonschema, pytest, existing argparse CLI.

**Spec:** ../../construction-sizing-script-design.md

## Global constraints

- No automatic 150 kW/200 × 200 m fallback and no fabricated measured robot benchmarks.
- Numerical screening estimates are conditional engineering assumptions. Evidence-only mode propagates missing parameters.
- All 72 metric IDs covered; producer emits definitions, not site passes.
- V1 implements the current UI's one-phase, project-shared processing cycle. Multi-phase/dependency-graph optimization and calibrated hardware libraries remain explicit future extensions; unsupported fields are rejected.
- Preserve existing repository edits; stage/test in a temporary copy, then copy only changed files with original-hash checks. No branch switch, commit, push, or data download is required.

## Review focus

- Unknown, zero, booleans, NaN and ranges cannot silently become ordinary demand.
- Robot active count, cadence and deadlines must affect capacity without duplicated streams.
- A finite workload that exceeds equipment or deadline bounds must not become a small feasible facility.
- Solar average power/radiator sensitivity areas do not prove seasonal supply or thermal adequacy.
- Catalog metadata must not claim local measurements were inspected when payload files are missing.

## Tasks

### 1. Request, profiles and provenance
Files: sizing/contracts.py, sizing/profiles.py, sizing/validation.py, package schemas and model JSON, tests/test_sizing_contracts.py.
- [ ] Write tests for invalid numbers/counts/units, unknown and range propagation, UI conversion, and missing profiles.
- [ ] Run tests red, implement typed boundary and source-aware parameter resolution, run green.

### 2. Workload and facility calculations
Files: sizing/workloads.py, sizing/facility.py, sizing/pipeline.py, tests/test_sizing_model.py.
Interface: build_requirements(request, bundle=None, catalog=None, evidence_only=False) -> JSON-compatible dict.
- [ ] Write tests for hand-calculated ingestion/storage, tight deadlines, worker memory, monotonic demand, missing inputs and complete outputs.
- [ ] Run red, implement bounded deterministic configurations and electricity/heat/layout sensitivities, run green.

### 3. Five-category requirement handoff
Files: sizing/requirements.py, bundled metric registry, tests/test_sizing_requirements.py.
- [ ] Test all metric IDs, dependency provenance, five summaries, catalog-only availability, unresolved geotechnical/mission checks and no site pass.
- [ ] Run red, implement registry and records plus site-sizing tasks, run green.

### 4. CLI, examples and documentation
Files: cli.py, sizing/cli.py, pyproject.toml, requirements.txt, examples/sizing/, docs/sizing-model.md and related status docs.
- [ ] Test stdin/stdout, file output, structured errors, guided UI import, evidence-only and report validation.
- [ ] Run red, implement adapters and examples, run green.
- [ ] Run full offline suite, independent review, fix substantive findings and rerun affected checks.
- [ ] Install only changed/new files after checking original repository hashes; verify installed commands and document limitations.

## Execution ledger

- Repository contains newer data-release code and already committed design specs; preserve both.
- Ruling: use isolated staging rather than switch the dirty main checkout. User authorized implementation; no approval gate or branch integration is added.
- Ruling: ship a bounded one-phase screening implementation matching the current mock; reject unsupported advanced contract fields instead of silently pretending to implement the entire future design.


## Implemented scope and verification

Implemented strict request validation, Guided brief adapter, versioned model bundle, workload scheduling, storage/power/layout estimates, all 72 metric records in five categories, CLI, example and model documentation. Requirement generation lives in pipeline.py rather than a separate requirements.py. Catalog payload validation is deliberately delegated to the next evaluator: the output explicitly labels registry associations as catalog references only; no catalog-path argument is exposed. The response is documented by the example and handoff tests. Broad future design features remain explicit limitations.

Fresh review found missing pending-input retention and unknown cadence propagation in storage. Both are fixed with regression tests. Final installation and full-suite verification follow.
