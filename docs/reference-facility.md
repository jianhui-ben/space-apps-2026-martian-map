# Mars Base Computing Facility Reference Scenario

## Purpose and status

Retain the earlier base-support facility as an illustrative comparison case for testing layouts and sensitivities. The current product goal is to derive facility specifications from a construction owner's project inputs; see [construction inputs](construction-project-inputs.md), [sizing method](data-center-sizing.md), and [location requirements](facility-to-location-requirements.md).

**Legacy example, not estimator output:** The 50-person base, 20 robots, 60/150/250 kW IT allocations, module counts, and land reserves below have not been derived from construction workloads. Do not use them as defaults, minimum capacity, or evidence that a particular fleet needs this facility. All numbers remain proposed assumptions rather than approved engineering specifications or NASA mission plans.

The estimator must instead produce equipment configurations, normal/peak/essential electrical loads, subsystem heat loads, storage, module geometry and mass, support loads, power/cooling layouts, access, and expansion needs. Missing equipment or engineering parameters remain unknown. Site-specific refinements must be recorded separately from initial demand estimates.

Do not enlarge the facility solely to justify a map. Compare this dedicated installation with a smaller computing service integrated into the base. If that alternative meets the demonstrated workload with less infrastructure, preserve it as a valid outcome.

## Base and activities

Assume an established research and operations base supported by repeated cargo deliveries, an existing power system, workshops, and service vehicles. This is a later development stage, not a first landing expedition.

| Driver | Proposed reference assumption | Information needed to validate demand |
|---|---|---|
| Population | 50 residents, with a growth scenario of 100 | Concurrent users, shifts, applications, visiting crews |
| Robotics | 20 mobile robots or vehicles conducting exploration, inspection, and construction support | Sensor rates, operating hours, onboard processing, retained data, central analysis jobs |
| Science | 12 instrument or experiment systems across several laboratories | Data production, analysis algorithms, turnaround requirements |
| Industrial activity | Pilot resource-processing and construction operations | Monitoring streams, offline simulations, maintenance models |
| Data intake | Test 0.5, 2, and 5 TB per sol of retained input after edge filtering | Measured or justified per-instrument and per-robot volumes |
| Planning horizon | Five Earth years of facility operation, with phased expansion | Hardware replacement, demand growth, cargo and maintenance plan |

Robot collision avoidance, vehicle safety, life-support control, and other safety-critical functions retain independent local controllers. Central analysis can support those systems but is not their sole control path. Normal habitat services must not rely exclusively on the data-center building remaining available.

## Services and operating model

- Essential shared services: operational records, local communications support, identity, procedures, scheduling, equipment histories, and selected telemetry. Prioritize recoverability and local availability.
- Routine services: mapping, robotic fleet analysis, scientific processing, storage ingestion, and diagnostics.
- Deferrable services: simulation, large image-processing batches, model training/fine-tuning, and reprocessing archives. Schedule around available power and maintenance.
- Data services: local archives, working datasets, backups, and delayed synchronization with Earth. No assumption of immediate Earth connectivity.

Proposed resilience objective: essential services continue through one compute-module outage, and an independent base-side copy supports a reduced service during loss of the entire facility. Full science and batch capacity need not survive every failure. Redundant equipment and failover capacity must be included when validating the load budget; this is not a certified uptime commitment.

## Preliminary demand envelope

These are allocated electrical budgets to test, not measurements derived from headcount. Low, expected, and peak are coincident operating scenarios, not daily averages or energy forecasts. The next sizing exercise must replace allocations with counts, hardware measurements, utilization, concurrency, and task benchmarks.

| IT service group | Low activity, kW | Expected activity, kW | Peak activity, kW |
|---|---:|---:|---:|
| Essential services and network | 15 | 25 | 40 |
| Storage and ingestion | 15 | 25 | 40 |
| Routine CPU processing and science | 10 | 20 | 40 |
| Accelerated computing and batch work | 20 | 80 | 130 |
| **Total IT load** | **60** | **150** | **250** |
| Provisional non-IT allowance | 40 | 75 | 100 |
| **Total facility load** | **100** | **225** | **350** |

Non-IT allowances cover conversion losses, pumps, environmental control, equipment protection, and other support loads. They are not validated PUE values and exclude the rest of the base, the power plant's own support requirements, and construction activity. Cold standby and shutdown-survival demand remain separate, unquantified design cases. The 100 kW low-activity case must not be treated as a demonstrated essential-only requirement.

Reference check: an Earth-based NVIDIA DGX H100/H200 has eight GPUs and a specified maximum system input of 10.2 kW. Twelve equivalent server power envelopes would total 122.4 kW, making a 130 kW accelerated-compute allocation understandable in hardware terms. This does not prove that this base needs twelve nodes, that these nodes are Mars-qualified, or that future hardware will have the same performance/power ratio. Additional storage and network loads are accounted for in their own groups rather than added again to the accelerated allocation.

Storage must be sized independently. For intake `D` TB/sol, retained duration `N` sols, copy factor `C`, and working capacity `W` TB, application-level provisioned capacity is at least `D × N × C + W`, before device redundancy, metadata, spare capacity, and operational headroom. At 2 TB/sol, 350 sols, two copies, and 500 TB working space, this is 1,900 TB. One copy should have a distinct failure domain; two copies in one module do not protect against losing that module. The 40 kW storage allowance is not validated by this capacity calculation.

## Power and cooling architecture

### Power

Assume a future firm base-power connection plus a dedicated supplemental solar array. The base power allocation must be secured in the scenario; it is not presumed surplus capacity. NASA's fission selection supports considering firm power, not assuming a generator of any particular size is available for computing.

Use a dispatch model: available firm allocation plus solar and storage must cover the actual load. When it cannot, shed batch work, reduce routine services, and preserve defined essential functions. Test firm supply limits, solar variability, storage limits, and outage duration together.

Initial energy trade: explore an array providing 100 kW average electrical output under a specified reference period. Assuming net average output of 20–60 W/m² of panel gives approximately 1,670–5,000 m² of panels. Both the output range and 100 kW target are sensitivity assumptions, not a site measurement or a reliability claim. With an illustrative 50% panel coverage of the array plot, reserve about 3,340–10,000 m² of land. Shade, spacing, access, cleaning, degradation, and charging losses require explicit modeling; avoid double-counting losses in the net-output assumption.

At 225 kW expected facility operation, 100 kW average solar would still leave an average 125 kW balance before additional storage/dispatch losses if that operating state persisted. Instantaneous deficits can be much larger, including at night. The scenario does not assert continuous 350 kW supply.

Propose 30 minutes of essential-service ride-through as a storage test case. Usable energy is `essential facility kW × 0.5 h`; installed storage must also cover losses, allowable discharge, temperature, aging, and reserves. Define essential demand before choosing a battery capacity. Battery storage is not presumed sufficient for a long dust storm.

### Cooling

Assume enclosed environmentally controlled equipment modules, liquid heat collection/transfer where appropriate, and external heat rejection. Enclosure pressure, internal airflow, coolant choice, freeze protection, radiator temperature, redundancy, and maintainability require engineering design.

Peak IT operation produces approximately 250 kW of heat; supporting equipment adds heat at different locations. Use 350 kW as a conservative initial all-facility heat-accounting envelope, not proof that one loop carries it all. Allocate heat by subsystem before sizing loops and radiators.

For a layout sensitivity exercise only, assumed net radiator rejection of 100–250 W/m² gives 1,400–3,500 m² of effective emitting area for 350 kW. These assumed fluxes require thermal validation and must account for orientation, sky/ground view, sunlight, dust, and operating temperatures. Emitting area is not land footprint. Do not infer free cooling from cold air or nearby ice.

## Spatial layout for terrain screening

Use modular installation and phased deployment. Modules are conceptual geometry, not an established pressure-vessel, cargo, or structural design. Landed masses, support loads, shielding, and cargo envelopes remain unresolved.

| Element | Initial geometric assumption | Site-selection implication |
|---|---|---|
| Compute/storage modules | Four modules, each 12 × 4 m, partitioning essential services, science/batch compute, and primary storage | Several support pads, replacement access, and utility connections; distribution must be engineered for resilience |
| Electrical/cooling support modules | Two modules, each 12 × 4 m | Support pads, cable/coolant interfaces, and design-specific separation |
| Core service compound | 60 × 60 m layout test envelope (3,600 m²), including the six modules and proposed internal access | Tests connected usable area; does not establish actual mandatory clearances |
| Radiator equipment plot | Start with 3,000–6,000 m² of layout reserve | Tests thermal-equipment placement and access; must be reconciled to actual radiator geometry |
| Supplemental solar plot | Approximately 3,340–10,000 m² in the stated energy sensitivity | Broad land requirement, shadowing, installation access, and cable routes |
| External links and reserve | Draw actual corridors; initially explore candidate precincts of roughly 2–4 hectares | Allows non-overlapping layout and expansion tests; acreage alone never constitutes a pass |
| Off-site essential-service fallback | Small independent installation within the assumed base | Mitigates whole-site failures; its load and cost belong in the base budget |

The 2–4 hectare precinct is a search envelope, not a computed requirement or a guarantee of fit. Derive `A_required` from an actual layout with valid clearances, equipment geometry, access, and no double counting. Keep optional expansion outside current `A_required`. A candidate can use connected nearby zones rather than one completely level slab. Plot placement must also respect hazard exclusions and actual thermal/electrical constraints.

Search initially within approximately 1–3 km route distance of the hypothetical base as a comparison assumption, not a universal safe excursion distance. A closer candidate is valid. Crew/vehicle limits, visibility, cable losses, and servicing must determine admissible routes. Reactor location and exclusion zones belong to the assumed base architecture and must not be invented as part of the data-center layout.

## Why exploration is meaningful

The survey must reduce an uncertainty that could change a design or site decision:

| Investigation | Decision it can change |
|---|---|
| Geometry of the core compound and equipment plots | Whether the complete facility fits with manageable preparation |
| Ground strength, layering, and possible ice beneath supports and routes | Foundation concept, module placement, excavation, or candidate rejection |
| Solar illumination and local dust monitoring | Array position, realistic output, cleaning needs, and permissible batch-compute duty cycle |
| Thermal observations and instrumented test panels | Radiator concept, position, area, or required operating limits |
| Construction/service corridor inspection | Equipment delivery, maintenance access, utility routing, and astronaut investigation stops |

Astronauts are already present at the assumed base. Assign robots and orbital data wherever sufficient; use crewed work where adaptive sampling, inspection, or instrument deployment adds value. No claim is made that the facility inherently requires a human survey before any construction.

## Alternatives and scale checks

- **Base-integrated alternative:** Deliver essential services and selected science processing using a smaller installation inside existing infrastructure. It may be preferable if workload, cargo, power, or maintenance capacity does not justify a dedicated site.
- **Reference dedicated installation:** The 60/150/250 kW IT envelope and multi-zone layout above, for an established, data-intensive base.
- **Growth case:** Test demand and infrastructure expansion separately; do not claim the current plot, generator, cooling, or storage supports doubled population or compute automatically.

Population alone does not justify 250 kW. Before freezing the reference design, document job types, data volumes, utilization, completion deadlines, edge-versus-central processing, and service priorities. Reduce the installation if the smaller alternative satisfies them.

## Decisions still required

1. Validate workload allocations, concurrency, data rates, retention, and minimum service levels.
2. Define firm power allocation, dispatch strategy, storage, and survival mode; validate cooling and heating loads across operating states.
3. Establish module masses, foundations, shielding, pressure/environmental design, construction vehicles, cargo feasibility, and repair strategy.
4. Convert panel/radiator surface estimates into actual site layouts and evaluate utilities and hazard constraints.
5. Choose a region based on overlapping data coverage and investigation value; define the hypothetical base consistently.
6. Populate design-dependent terrain benchmarks only after the relevant engineering inputs exist. Provisional terrain preferences remain screening assumptions.

## Evidence and source boundaries

- [NVIDIA DGX H100/H200 specifications](https://docs.nvidia.com/dgx/dgxh100-user-guide/introduction-to-dgxh100.html): an Earth-hardware reference for eight GPUs and 10.2 kW maximum system power, not Mars qualification or workload demand.
- [NASA Mars surface-power decision](https://www.nasa.gov/wp-content/uploads/2024/12/acr24-mars-surface-power-decision.pdf): rationale for fission as primary crewed-mission power, not support for this proposed facility capacity.
- [NASA Mars power considerations](https://www.nasa.gov/wp-content/uploads/2024/01/mars-surface-power-generation-challenges-and-considerations.pdf): environmental and mission power context, including dust-related solar limitations.

All population, fleet, instrument, workload, area, service, lifetime, and performance assumptions in this document are project proposals. The scenario has not been demonstrated feasible or economically preferred.
