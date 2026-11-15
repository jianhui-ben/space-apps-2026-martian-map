# Buildable Terrain Requirements

## Purpose and benchmark status

Evaluate whether the surface geometry and access of a candidate Mars site can accommodate a proposed data center and its supporting infrastructure. Compare candidates and identify measurements needed to resolve uncertainties.

This is a draft screening specification for the project, not a Mars construction standard. No universal data-center construction limits were identified in the reviewed sources. Passing these criteria means meeting the stated terrain-screening scenario; it does not authorize construction or establish foundation strength, thermal performance, power adequacy, or commercial feasibility.

**Baseline** means the minimum target for passing this screening scenario. **Ideal** means a preferred condition with less preparation or additional margin. A baseline failure means redesign, mitigation, or another candidate is needed under the current scenario; it does not mean construction is physically impossible.

Benchmark labels:

- **P — proposed project target:** A tunable comparison assumption, not a measured fact or NASA limit. All numerical margins and preferences below are proposed and not yet approved.
- **D — design-dependent limit:** A benchmark expressed against an engineering input. Without that input, the metric is unresolved, not passed. Numerical ideal margins attached to these limits are also proposed preferences.

NASA lander and rover criteria are useful examples of evaluating slopes, rocks, and access at relevant scales, but their thresholds must not be adopted as data-center building limits.

## Assessment inputs and conventions

Use the selected construction-derived facility option and its complete layout, as specified in [facility-to-location requirements](../facility-to-location-requirements.md). Obtain module, solar, cooling, storage, staging, clearance, utility, and expansion geometry from that option. Slope, support adjustment, grading, and loaded delivery-vehicle limits come from equipment/design assumptions, not robot count. Calculate `A_required` from the actual layout; the [legacy reference facility](../reference-facility.md) is an illustrative comparison only. A total area alone cannot establish connected layout fit.

Before applying the requirements, define:

- Georeferenced footprints for buildings, arrays, cooling equipment, storage, service areas, utility corridors, and clearances. Assess the complete layout, not only the server building.
- A designated building-pad polygon and separate equipment zones. The provisional building-pad slope targets do not automatically apply to arrays or other equipment.
- Required connected area `A_required`, derived from the layout without double-counting overlaps. Include operating clearances and access but exclude optional expansion reserve.
- Equipment dimensions, permissible foundation/support tolerances, grading design, and construction capability.
- Construction vehicle and payload envelope: width `W`, lateral clearance `C`, turning radius, allowable longitudinal and cross slopes, and allowable step height. These limits must reflect loaded operation on the assumed ground conditions.
- Candidate base/delivery location, required destinations, utility engineering limits, and service-life duration `T`.
- Design-specific hazard exclusion polygons and uncertainty buffers. These require suitable hazard evidence and analysis.

Measure terrain in a consistent Mars coordinate system and projected metric reference suitable for the selected region. Report slope in degrees; percent grade is `100 × tan(angle)`. Record grid spacing separately from positional accuracy and vertical uncertainty.

Compare the existing surface first. Any proposed grading, obstacle removal, or route works must have a separate post-mitigation scenario, with effort and unresolved assumptions recorded.

## 1. Enough usable space in the right shape

**What it is:** The amount, dimensions, and connectivity of land available for the facility layout.

**Why it matters:** A site may have enough total area but be too narrow, fragmented, or obstructed to fit buildings and supporting equipment. Connected area reduces layout compromises and difficult connections.

**Measure:** Usable polygons after terrain exclusions, layout fit, connectivity, and expansion space. A patch is provisionally usable only if its applicable terrain constraints pass; unknown areas are shown separately. Refine these polygons as ground and hazard evidence improves.

| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |
|---|---|---|---|---|
| BT-01 Connected area ratio | `A_connected / A_required`, using the connected terrain component serving the layout | **P:** ≥ 1.0 | **P:** ≥ 1.3 | Orbital imagery and terrain model; detailed local survey for final boundaries |
| BT-02 Complete layout fit | Share of required footprint and clearance polygons fully accommodated, % | **D:** 100%; no overlap with incompatible uses or exclusion zones | 100%, plus the specified expansion layout also fits | Layout assumptions plus mapped terrain; field-check critical edges |
| BT-03 Required spatial connections | Required building/equipment/service-zone connections accommodated by valid corridors, % | **D:** 100% | 100%, with a separate alternate corridor to each designated critical zone | Terrain, layout, and corridor constraints |

**Map output:** Connected usable patches, dimensioned layout overlays, blocked connections, expansion areas, and unresolved boundary segments. Area ratio alone cannot override a failed layout fit.

**Field measurements:** Survey narrow sections, unresolved obstacles, and critical clearances using close-range stereo imagery or a laser survey. Do not infer load-bearing capacity from usable-area geometry.

## 2. Gentle slopes and manageable elevation differences

**What it is:** Overall site tilt and changes in elevation across a proposed pad or equipment zone.

**Why it matters:** Slopes affect leveling, foundation/support configuration, placement of equipment, and vehicle movement. A low average slope can conceal a steep edge or step.

**Measure:** Fit a plane over the building pad for overall tilt. For local screening, fit planes in 10 m × 10 m windows and record all window slopes and their maximum. Use this scale only with adequate valid samples, vertical precision, and artifact review; do not upsample coarse data to imply finer evidence. Smaller critical features are addressed by roughness and obstacle metrics and require local survey.

| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |
|---|---|---|---|---|
| BT-04 Overall building-pad slope | Inclination of fitted pad plane, degrees | **P:** ≤ 5° for initial comparative screening | **P:** ≤ 2° | Suitable orbital terrain model; local elevation survey |
| BT-05 Maximum local pad slope | Maximum valid 10 m-window plane slope, degrees | **P:** ≤ 10°; all unresolved/invalid windows remain flagged | **P:** ≤ 5° | Fine terrain model plus local checks; cannot clear smaller steps |
| BT-06 Maximum grading or support correction | Largest required vertical adjustment from measured ground to the proposed design surface, m | **D:** ≤ design limit `D_allow` | **D/P:** ≤ 0.5 × `D_allow` | Existing terrain and an explicit pad/support design; field elevations |
| BT-07 Earthmoving demand | Cut and fill volumes reported separately, m³; each divided by its equipment/logistics budget | **D:** Each ratio ≤ 1.0, with a feasible material-source/disposal plan | **D/P:** Each ratio ≤ 0.5 | Proposed grading surface; ground/material investigation and equipment assumptions |

The 5°/2° and 10°/5° targets are deliberately provisional preferences to test in the prototype, not claims of construction safety. A uniform 5° slope rises approximately 8.75 m over 100 m; a 2° slope rises approximately 3.49 m. Passing the slope preference never overrides an excessive grading requirement. Do not subtract cut from fill and report only the net volume: both operations require work, and excavated material may not be reusable.

**Map output:** Overall tilt, local-slope map, elevation profiles, steep-window flags, and proposed grading/support adjustments.

**Field measurements:** Detailed elevations at foundation/support positions and abrupt transitions. Construction acceptance requires the design-specific geometry and tolerances, even if the provisional orbital screen passes.

## 3. Low surface roughness

**What it is:** Small-scale bumps, pits, ridges, and steps after removing the overall slope.

**Why it matters:** Roughness can interfere with supports, increase preparation effort, and create wheel or track obstacles on terrain that is level on average.

**Measure:** Within fixed 10 m × 10 m screening windows, subtract the fitted plane and calculate root-mean-square residual height. Use finer surveys for support interfaces and vehicle-scale features. Store window size and resolution with every result; only compare like scales.

| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |
|---|---|---|---|---|
| BT-08 Detrended roughness | Maximum window RMS residual height across the zone, m | **D:** ≤ zone-specific preparation tolerance `R_allow` | **D/P:** ≤ 0.5 × `R_allow` | Orbital estimate if uncertainty permits; detailed local survey otherwise |
| BT-09 Support-interface variation | Maximum peak-to-valley height over each actual support/contact footprint, m | **D:** ≤ allowable support adjustment `H_support` | **D/P:** ≤ 0.5 × `H_support` | Local high-resolution geometry; commonly unresolved from orbit |
| BT-10 Abrupt step height | Largest measured step on a required vehicle path, m | **D:** ≤ validated loaded-vehicle step limit `H_step` | **D/P:** ≤ 0.5 × `H_step` | Close-range survey and vehicle capability evidence |

There is no defensible universal centimetre-scale roughness threshold without defining the support system and vehicle. For illustration only, if `H_step = 0.20 m`, the baseline is ≤ 0.20 m and the ideal is ≤ 0.10 m; this is not an adopted rover capability.

**Map output:** Roughness at its measured scale, steps and depressions, support locations requiring measurement, and unresolvable areas. Mean roughness must not conceal a single critical obstruction.

**Field measurements:** Survey small steps and support surfaces; assess traction and sinkage separately under ground properties. A geometry survey alone does not verify trafficability.

## 4. Manageable obstacles

**What it is:** Rocks, crater rims, scarps, and other features that interfere with the proposed layout or movement.

**Why it matters:** Obstacle position can be more important than abundance. One large rock can block a required footprint even when most of the site is clear.

**Measure:** Obstacle location, width, height, clearance envelope, and intersection with the planned layout. Use one declared detection-size threshold for comparable density estimates; smaller unresolved objects remain an evidence gap. Embedded depth and removability require field evidence.

| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |
|---|---|---|---|---|
| BT-11 Unresolved blocking obstacles | Count intersecting required footprint/clearance polygons with neither avoidance nor a feasible removal plan | **D:** 0 before a screened pass; uncertain removability remains unresolved | 0 blockers and no obstacle-removal work required | Images and terrain, then dimensions/material checks locally |
| BT-12 Obstacle removal demand | Estimated removal effort divided by the defined removal budget, with machine-hour and mass estimates retained | **D:** ≤ 1.0 and each operation within equipment capability | **P:** 0 required removals | Obstacle survey plus excavation/lifting and disposal plan |
| BT-13 Residual clearance margin | Minimum distance between obstacle envelope and required operating envelope, including positional uncertainty, m | **D:** ≥ 0; required operational clearances are already included in the envelope | **D/P:** ≥ extra design reserve `C_extra` | Registered imagery, layout, local geometry |

Record obstacle count, size distribution, and area fraction as diagnostic metrics. Do not invent an overall rock-cover percentage that declares a building site usable irrespective of rock position.

**Map output:** Obstacle footprints, detection threshold, blocked layout areas, and distinguishable avoid/remove/investigate actions.

**Field measurements:** Confirm size and embedded depth where relevant; assess removal feasibility without assuming an astronaut can simply move an observed rock.

## 5. Separation from hazardous terrain

**What it is:** The relationship of the site to rockfall sources, unstable slopes, scarp edges, migrating dunes, and other terrain that could affect the facility during its service life.

**Why it matters:** A flat footprint can still lie in the path of hazardous material or next to terrain that changes. Distance alone is not a hazard model.

**Measure:** Distances to mapped hazard boundaries, intersections with exclusion envelopes, observed changes over time, and potential encroachment during the defined service life.

| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |
|---|---|---|---|---|
| BT-14 Hazard-envelope overlap | Required footprint/corridor area intersecting assessed exclusion envelopes, m² | **D:** 0; missing hazard envelopes make the result unresolved | 0, including the planned expansion layout | Orbital hazard mapping plus site-specific assessment |
| BT-15 Setback adequacy | Actual distance from relevant hazard source divided by assessed minimum setback `S_required` | **D:** ≥ 1.0 for every applicable hazard | **D/P:** ≥ 1.5, where additional separation is practical | Hazard-specific modeling, terrain, local geological evidence |
| BT-16 Mobile-terrain clearance | Distance to moving-material front minus estimated upper-bound encroachment over `T` and uncertainty buffer, m | **D:** > 0 | **D/P:** > specified additional lifecycle reserve `B_extra` | Registered repeat observations and a justified movement model |

No fixed 50 m or 100 m setback is assigned: appropriate distances depend on scarp geometry, materials, runout, movement, and uncertainty. Where a constant-rate estimate is justified, encroachment may be modeled as `v_upper × T`; record its validity assumptions. No detected movement over a short or coarse observation period is not evidence of zero future movement. A larger setback multiplier is a preference, not a validated risk reduction.

**Map output:** Hazard sources, exclusion envelopes, observation dates, movement evidence, setback margins, and unassessed zones.

**Field measurements:** Inspect fractures, loose blocks, and material conditions; deploy or revisit monitoring. A single survey cannot certify long-term stability.

## 6. Practical access and infrastructure connections

**What it is:** Corridors linking the facility, delivery area, base, and equipment zones, including room for loaded vehicles and utilities.

**Why it matters:** A footprint is not useful if construction equipment cannot reach it or if utilities cannot be installed and maintained. These are construction/service routes, distinct from astronaut excursion time and consumable planning.

**Measure:** Narrowest clear width, turning geometry, longitudinal grade, cross-slope, clearance, connection length, and route alternatives. Use the loaded vehicle/payload swept envelope, not just nominal vehicle width.

| ID and metric | Definition and unit | Baseline benchmark | Ideal benchmark | Evidence |
|---|---|---|---|---|
| BT-17 Corridor width | Minimum usable width along route, m | **D:** ≥ `W + 2C` on straight sections; turns pass swept-envelope checks | **D/P:** ≥ `W + 4C`; turns retain the same additional clearance margin | Terrain and obstacle mapping, vehicle envelope, field verification |
| BT-18 Grade and cross-slope utilization | Maximum measured longitudinal/cross slopes divided separately by respective validated vehicle limits | **D:** Both ratios ≤ 1.0 | **D/P:** Both ratios ≤ 0.7 | Route profiles; loaded mobility assumptions; local survey/testing |
| BT-19 Turning fit | Share of required maneuvers fitting the validated swept envelope including clearance, % | **D:** 100% | 100%, without special multi-stage maneuvers | Vehicle geometry and local mapped obstacles |
| BT-20 Route redundancy | Number of assessed routes between designated delivery/base point and facility without a shared critical chokepoint | **P:** ≥ 1 | **P:** ≥ 2 | Route network and common-failure review |
| BT-21 Utility route utilization | Proposed cable/pipe length divided by design allowance, evaluated for each service | **D:** ≤ 1.0; bend, elevation, loss, and maintenance constraints also pass | **D/P:** ≤ 0.8 with all other constraints passing | Terrain and an explicit utility design |

For illustration only, a 4 m-wide transported load with `C = 1 m` would need a 6 m straight corridor at baseline and 8 m for the proposed ideal. These dimensions are not adopted mission equipment specifications. A corridor can pass geometry and still fail ground-strength or traction tests.

**Map output:** Corridor envelopes, narrow and steep segments, turns, connections, chokepoints, and unverified segments. Mark hypothetical endpoints as assumptions.

**Field measurements:** Verify small obstacles, clearance, traction, sinkage, and loaded maneuverability. Resolve any unknown segment before labeling a complete route as assessed.

## Evidence and decision rules

Each metric record must include its ID, candidate/zone, value, unit, measurement footprint or baseline, source, date, method, resolution, uncertainty, applicable assumption version, baseline, ideal target, status, and next required measurement.

Allowed statuses:

- **Meets ideal screening target:** Evidence supports the ideal threshold under the scenario.
- **Meets baseline screening target:** Evidence supports baseline but not ideal.
- **Fails current screening target:** Evidence establishes a baseline exceedance; identify possible redesign or mitigation separately.
- **Unresolved:** Input, measurement, coverage, engineering limit, or adequate precision is missing; also use when uncertainty straddles a threshold.
- **Not applicable:** Explicitly justified by the selected architecture; do not silently omit a factor.

For a maximum limit, use a documented upper uncertainty bound to claim a pass; for a minimum, use a lower bound. If no defensible bound exists for a threshold-sensitive measurement, report unresolved. A critical metric with incomplete coverage cannot pass based only on observed portions. An ideal rating requires the evidence quality needed to support it.

Keep baseline failures and unknowns visible; no weighted average may cancel them. Any overall terrain-screened pass requires all applicable baseline criteria to pass. A pass remains conditional on the separate ground/ice, power, thermal, and mission assessments.

HiRISE imagery commonly has 0.25–0.5 m pixels, and derived terrain models commonly use 1–2 m elevation-grid spacing. This does not establish centimetre-scale roughness or foundation tolerances. Product artifacts and shadows must be reviewed; interpolation and upsampling do not create new evidence. Coverage of a selected candidate region is not yet verified.

## Validation before adopting benchmarks

1. Select a facility layout and realistic construction/vehicle scenario; populate the design-dependent inputs.
2. Inspect available imagery, terrain accuracy, artifacts, and coverage for the same candidate region.
3. Test sensitivity to the proposed slope targets and margin preferences. Record whether candidate rankings change materially.
4. Obtain relevant engineering review of tolerances, mobility limits, grading capabilities, hazard envelopes, and uncertainties before calling them construction requirements.
5. Identify the smallest field measurements that could resolve each remaining uncertainty. Simulated field results in a prototype must remain clearly labeled.

## Sources and their scope

- [HiRISE terrain-model documentation](https://www.uahirise.org/dtm/about.php): source imagery, typical grid spacing, and artifacts; not construction thresholds.
- [USGS CTX terrain products](https://stac.astrogeology.usgs.gov/docs/data/mars/ctxdtms/): potential regional terrain evidence; not confirmation of local coverage.
- [USGS Mars Science Laboratory landing-site assessment](https://pubs.usgs.gov/publication/70047380): examples of mission-specific terrain evaluation, not transferable building limits.
- [USGS InSight landing-site assessment](https://pubs.usgs.gov/publication/70190673): examples of evaluating slope and obstacles at defined scales, not a data-center standard.
- [USGS research on active terrain](https://www.usgs.gov/publications/revealing-active-mars-hirise-digital-terrain-models): repeat imagery and terrain observations for surface changes.

The proposed project targets and ideal margins in this document are authored scenario choices. None is attributed to these sources as a NASA-approved Mars data-center benchmark.
