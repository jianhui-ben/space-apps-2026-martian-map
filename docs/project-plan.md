# Mars Data Center Site Investigation Project Plan

## Project objective

Develop a NASA-data-informed map that helps future astronauts investigate and compare candidate sites for a Mars-based data center. The map will combine terrain, geological, and environmental evidence, identify uncertainties, and guide surface investigations under explicit assumptions about the facility’s power, cooling, communications, and logistics requirements.

## Initial assessment scenario

For the first demonstration, assess a modular computing and data-storage facility supporting an established hypothetical Mars base. Services include base operations, scientific processing, robotics support, archives, and optional AI workloads. Safety-critical equipment retains independent local control.

The [reference facility scenario](reference-facility.md) proposes a 50-person, data-intensive base; low/expected/peak IT allocations of 60/150/250 kW; six equipment/support modules; and separate solar, cooling, and service areas. A roughly 2–4 hectare precinct is a preliminary search envelope, not a derived land requirement. These numbers are adjustable scenario assumptions, not validated demand or user-approved engineering limits. Workload validation and comparison with a smaller base-integrated installation determine whether the dedicated facility is justified.

The initial scenario supersedes the earlier AI-training-only pilot. Facility dimensions, power and cooling allocations, reliability, cargo, and supporting infrastructure require engineering validation before site suitability can be established.

## Intended outcome

Produce an evidence-backed comparison of candidate sites and a practical astronaut investigation plan identifying where to go, what to measure, and which uncertainties those measurements could resolve. The assessment may identify a preferred candidate, insufficient evidence, or no suitable site under the stated requirements.

Site suitability does not establish the commercial or economic viability of a Mars-based data center.

## Initial requirements and assessment context

The initial map will address five connected factors: buildable terrain, ground and ice evidence, solar conditions, thermal conditions, and investigation routes. The broader assessment framework remains relevant to future work, including communications, radiation, resource access, construction logistics, scientific preservation, maintenance, and expansion. These broader factors are not all initial map features.

For this assessment, an ideal site is one that meets the assumed facility requirements with less construction effort, operational risk, and uncertainty. It is not necessarily the flattest, sunniest, or coldest location. A promising site must be distinguished from a well-understood site.

### 1. Buildable terrain

Detailed specification: [Buildable Terrain Requirements](requirements/buildable-terrain.md), covering six terrain subfactors, 21 metric definitions, baseline and ideal screening benchmarks, evidence requirements, and field-verification needs. Numerical project targets are provisional; design-dependent construction limits remain to be established.

**Why it matters:** The site must accommodate the building and supporting infrastructure: power equipment, energy storage, cooling equipment, cables, access paths, and future expansion. Slopes and obstacles affect leveling, excavation, transportation, and maintenance. A flat patch large enough for a building may still be unsuitable for the complete facility.

**Ideal conditions:** Enough connected usable area for the proposed layout; slopes within the assumed construction and equipment limits; few major obstacles or unstable edges; practical paths between infrastructure elements and the base; and room for maintenance and expansion.

**Data needed:** High-resolution imagery, elevation models, derived slopes and roughness, visible obstacle locations, and assumed equipment footprints and clearances.

**Map requirements:** Show usable-area boundaries, slope, roughness, visible obstacles, and whether a proposed facility layout fits. Flag features that cannot be resolved at the available data resolution.

**Investigation needs:** Inspect small obstacles, clearances, and terrain transitions. Flatness must not be treated as evidence of strong or stable ground.

### 2. Ground and ice evidence

Detailed specification: [Ground and Ice Evidence Requirements](requirements/ground-and-ice.md), with a comparison illustration, six subfactors, 12 metrics, baseline/ideal benchmarks, and local verification needs.

**Why it matters:** Foundations, heavy equipment, trenches, and vehicle traffic require suitable ground. Weak or uneven materials may settle, while hard or fractured materials affect excavation and anchoring. Buried ice may be a resource, but disturbance or heating may affect the stability of ice-bearing ground.

**Ideal conditions:** Ground that supports proposed loads with acceptable settlement; reasonably consistent subsurface conditions; materials compatible with available excavation and anchoring equipment; no unresolved ice-related instability beneath critical infrastructure; and sufficient evidence to inform foundation design.

**Data needed:** Geological maps, imagery of exposed rock and surface deposits, ice evidence and depth estimates, ground-temperature observations, and local measurements of soil strength, material properties, and subsurface structure.

**Map requirements:** Show geological units, evidence of loose deposits or buried ice, uncertainty, and locations for probing, sampling, or subsurface surveys. Distinguish direct observations from interpretations. Do not equate more ice with greater suitability or use orbital evidence to claim foundation approval.

**Investigation needs:** Confirm material properties, ground strength, and ice presence and depth. Test whether disturbance could affect stability. Nearby ice may be useful without being desirable beneath a foundation; this remains design-dependent.

### 3. Solar conditions

Detailed specification: [Solar Conditions Requirements](requirements/solar-conditions.md), with a comparison illustration, six subfactors, 13 metrics, time-dependent energy criteria, and stated dust scenarios.

**Why it matters:** If solar energy contributes to the power supply, local illumination, terrain shadows, seasons, and dust affect generation and the need for storage or backup. Strong midday sunlight does not establish reliable energy availability over the operating period.

**Ideal conditions:** High usable electrical output across the intended operating period, including difficult seasons; limited terrain shading; sufficient accessible array area; manageable dust and cleaning requirements; and energy shortfalls that the assumed storage, backup, or workload flexibility can accommodate.

**Data needed:** Sun position over time, terrain-derived horizons and shadows, atmospheric dust scenarios, surface dust observations, panel orientation and performance assumptions, facility demand, and storage or backup assumptions.

**Map requirements:** Show illumination and shadows over time, candidate array areas, and estimated generation under explicit dust and equipment assumptions. Distinguish average energy availability from supply reliability. Continuous-operation scenarios must assess weak generation periods; interruptible-training scenarios must assess usable energy, interruption duration, and recovery requirements.

**Investigation needs:** Deploy illumination, dust, and panel-output monitoring. A short excursion can establish monitoring sites but cannot validate a full seasonal energy model. Hours of sunshine alone must not be used as a power-sufficiency measure.

### 4. Thermal conditions

Detailed specification: [Thermal Conditions Requirements](requirements/thermal-conditions.md), with a comparison illustration, six subfactors, 12 metrics, thermal-design dependencies, and monitoring requirements.

**Why it matters:** Operating servers generate heat that the cooling system must reject, while equipment also needs protection from cold and temperature cycling. Cold surroundings do not automatically provide effective cooling in Mars's thin atmosphere. Surface-temperature observations alone do not establish cooling capacity.

**Ideal conditions:** The chosen cooling system can reject the required heat; sufficient area and suitable placement exist for heat-rejection equipment; temperature extremes and cycling are manageable; unwanted solar heating and interactions with nearby equipment are limited; and cooling, cold protection, and maintenance demands remain acceptable.

**Data needed:** Surface and air temperatures, observation times and seasons, thermal inertia, ground thermal properties, pressure and wind where available, dust conditions, and assumed cooling-system specifications and orientation.

**Map requirements:** Show observed surface temperatures with their time and seasonal context, thermal differences between materials, candidate cooling-equipment areas, and proposed monitoring locations. Initially present thermal conditions and uncertainties rather than an unsupported cooling-efficiency score. Do not rank sites solely by lowest temperature or treat surface temperature as air temperature.

**Investigation needs:** Measure local temperature profiles and deploy environmental sensors or instrumented thermal test equipment. Evaluate cooling performance against a specified design; distinguish it from the surface's response to heating and cooling.

### 5. Investigation routes

Detailed specification: [Investigation Routes Requirements](requirements/investigation-routes.md), with a comparison illustration, six subfactors, 14 metrics, investigation objectives, resource budgets, and return/contingency requirements.

**Why it matters:** Crews or robots must reach candidate sites, collect useful evidence, and return within operational limits. Route design affects both investigation effort and the ability to resolve uncertainties. Accessibility also informs potential future servicing, but does not establish suitability of the ground or facility.

**Ideal conditions:** Candidate sites are accessible from the assumed base; routes avoid terrain beyond assumed mobility limits; travel and measurement tasks fit mission budgets; practical return and support options exist; and each stop answers a question that could change the site assessment.

**Data needed:** Detailed terrain and obstacles, ground-condition evidence, assumed base and shelter locations, suit and rover capabilities, travel-speed estimates, task durations, consumable budgets and reserves, and communication or environmental constraints where supported.

**Map requirements:** Show candidate routes, difficult or unverified segments, measurement stops, travel and task-time estimates, and return options. Associate each stop with an investigation question and planned measurement. Make mission assumptions explicit; routes are planning scenarios, not operationally certified safe paths.

**Investigation needs:** Verify access and terrain conditions, collect decision-relevant measurements, and identify instruments requiring later retrieval or long-duration monitoring. Prefer routes that resolve meaningful uncertainties within mission constraints rather than simply minimizing distance.

### Shared requirements for evidence and comparison

- Every layer must distinguish observations, derived estimates, models, and scenario assumptions, including hypothetical infrastructure.
- Display source, spatial resolution, positional accuracy where available, observation time and season, coverage gaps, uncertainty, and ground-validation status. Check coordinate alignment before combining layers.
- Establish facility-specific limits before assigning numerical suitability scores. Record unmet requirements and critical unknowns separately; do not hide them inside an average score.
- Compare sites through requirements met, requirements failed, unresolved questions, and next useful measurements. Missing evidence must not automatically mean safe or unsuitable.
- Explain tradeoffs between the five factors. Good access cannot compensate for unsuitable foundations, and favorable terrain cannot establish adequate power or cooling.
- Check dataset coverage and resolution in the same region before selecting demonstration sites. Candidate sources include CTX/HiRISE imagery and terrain models, geological maps, THEMIS thermal products, and SWIM ice products; availability at a useful local scale remains to be verified.

### Assumptions to define before site ranking

The reference facility provides provisional workload, power, layout, lifetime, and operating assumptions. These require validation; exact footprints, minimum service levels, power allocation, cooling performance, foundations, cargo and construction capabilities, base location, and expansion feasibility remain unresolved. The investigation scenario must also define crew or robot capabilities, instruments, time and consumable budgets, and return constraints. The detailed terrain specification proposes screening targets and design-dependent benchmarks; these are not validated construction limits or user-approved numerical thresholds. No ranking weights have been agreed yet.

## Supporting references

- [NASA Mars science objectives](https://science.nasa.gov/planetary-science/programs/mars-exploration/mars-science-objectives/) — context on ground ice and infrastructure stability.
- [NASA Mars surface power considerations](https://www.nasa.gov/wp-content/uploads/2024/01/mars-surface-power-generation-challenges-and-considerations.pdf) — seasonal and dust-related power challenges.
- [THEMIS instrument description](https://themis.asu.edu/factsheet) — surface thermal and material observations.
- [USGS CTX data documentation](https://stac.astrogeology.usgs.gov/docs/data/mars/ctx/) — imagery, terrain products, and alignment considerations.
- [SWIM project](https://swim.psi.edu/) — subsurface ice mapping evidence.

## Challenge reference

[NASA Space Apps Challenge 2026 — Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=details)
