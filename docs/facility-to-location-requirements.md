# Facility specifications to Mars location requirements

## Purpose and status

Define the planned handoff from [data-center sizing](data-center-sizing.md) to the existing five assessment categories and 72 metric IDs. Requirement generation and integrated assessment are not implemented. Keep the existing metrics; the new workflow supplies their missing facility/design inputs rather than treating every metric as a downloaded measurement.

The [script design](construction-sizing-script-design.md) defines the machine-readable producer/consumer contract. The sizing script emits requirement definitions and missing-input reasons; only the downstream feasibility algorithm assigns assessment results.

## Requirement record

Each record needs: requirement ID and related metric IDs; facility option/version; component or zone; required value/range and unit; operating/seasonal case; limit source; owner-input and sizing dependencies; evidence resolution/coverage needs; a downstream assessment reference (initially absent); and the next useful measurement. Limits may originate from engineering design, equipment specifications, or explicitly provisional policy. Missing limits remain unresolved.

## Mapping

| Category | Facility inputs | Location checks and existing metrics | Evidence limitations |
|---|---|---|---|
| Buildable terrain | Module/array/radiator/storage polygons, clearances, staging, expansion, grading budget, support adjustment limits, loaded vehicle geometry and mobility limits | Connected area and layout BT-01–03; slopes/grading/roughness BT-04–08; obstacles/hazards BT-09–16; access and utilities BT-17–21 | Raster resolution may miss support-scale features; area alone does not prove layout fit |
| Ground and ice | Loaded masses, contact areas, support geometry, foundation/anchor concept, movement limits, excavation/utility depths, thermal influence | Support/settlement GI-01–04; ice and investigation depth GI-05–06; deformation/influence GI-07–08; remaining excavation/evidence checks GI-09–12 | Surface appearance and orbital minerals do not establish bearing strength or local ice structure |
| Solar | Electrical load over time, essential demand, generation allocation, panel geometry/performance, storage and dispatch, allowable cable runs | Apply SC-01–13 to illumination, delivered energy, dust, storage, array accommodation, connections and validation | Sun tables alone do not establish electrical output; future dust and panel deposition remain uncertain |
| Thermal | Subsystem heat loads, temperature limits, cooling-loop design, radiator geometry/properties, allowable separation, survival mode | Apply TC-01–12 to environmental cases, rejection, operating/cold limits, layout, connections, ground interaction and validation | Orbital surface temperature is not air temperature or demonstrated radiator performance |
| Investigation routes | Candidate uncertainty locations, measurement objectives, assumed base/shelters, independent mission/vehicle/instrument limits | Apply IR-01–14 to objectives, mobility, time, resources, communications, return and contingencies | Construction fleet count cannot establish EVA resources or certify heavy delivery access |

Consult the individual requirement documents for exact metric definitions. This table groups inputs; it does not replace those definitions. Preserve GI-07/TC-10 as views of the same ground-deformation assessment, not independent evidence.

## Result semantics

- **Meets:** sufficient evidence supports the specified criterion for this version and operating case; this is a screening result, not construction certification.
- **Fails:** the tested design conflicts with a stated criterion. Explain redesign or mitigation options without asserting impossibility for all designs.
- **Unresolved:** the limit, equipment parameter, model validation, coverage, or local evidence is insufficient. Unknown must never become a pass or automatically become a failure.

Display unmet requirements and unknowns separately. Do not average away a critical failure. Optional or inapplicable components must be explicitly scoped out with a reason, rather than fabricated as passed checks.

## Candidate refinement

Site illumination can change solar and storage layouts; thermal conditions can change radiator size; placement affects connections, access, ground loads, and grading. Regenerate affected requirements after each revision and preserve prior results for comparison. Geographic candidate boxes remain search areas, not facility footprints. Identify required fieldwork before making an overall feasibility claim.
