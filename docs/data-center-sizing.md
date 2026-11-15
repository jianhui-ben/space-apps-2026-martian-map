# Construction-to-data-center sizing specification

## Purpose and status

Translate [construction inputs](construction-project-inputs.md) into facility options that can be assessed on Mars. This algorithm is planned, not implemented. No calibrated robot profiles, benchmark library, or Mars-qualified equipment catalog is supplied by this document. Existing 60/150/250 kW figures are a [legacy comparison](reference-facility.md), not outputs or calibration targets.

See the [script design](construction-sizing-script-design.md) for UI formats, JSON contracts, module boundaries, validation, and acceptance tests.

## Estimation stages

1. **Activities to jobs:** Assign versioned role/task profiles for sensing, onboard filtering, shared mapping, inspection, scheduling, storage, and explicitly requested simulation. Retain independent onboard safety control. Exclude work already done onboard and work intentionally deferred to Earth. Include bootstrap computing before permanent construction begins.
2. **Jobs to capacity:** Estimate input volumes and job runtime/memory from representative benchmarks at the requested fidelity. Schedule jobs against arrival times, concurrency, and deadlines. Report unmet deadlines and unbenchmarked jobs rather than inventing GPU requirements.
3. **Capacity to equipment:** Select configurations with suitable CPU/GPU performance, RAM, usable storage, throughput, networking, and requested failure tolerance. Preserve a base-integrated option. Equipment suitability, environmental protection, maintainability, and delivery constraints require evidence; Earth performance alone does not establish Mars qualification.
4. **Equipment to infrastructure:** Calculate time-dependent IT and support electricity, essential-service and survival modes, subsystem heat loads, power connections/generation/storage, and cooling options. Supply and losses must be modeled explicitly.
5. **Infrastructure to layout:** Use actual or provisional equipment geometry, loaded mass, support locations, service clearances, cable/pipe limits, staging, transport access, and expansion. Generate component layouts, not just a summed area.
6. **Layout to site requirements:** Emit the contract in [facility-to-location requirements](facility-to-location-requirements.md), evaluate candidates, and refine solar/cooling/layout parameters for each site.

## Calculation rules

- Retained robot data per sol = sum of active units × collection hours per sol × retained bytes per hour for each non-overlapping activity. Include fixed instruments and products separately; do not count shared outputs once per robot.
- Compute demand uses measured runtime per job, job frequency, memory, hardware configuration, and completion deadline. Total accelerator-hours divided by available hours is only a lower bound: memory, sequential work, bursts, failures, and I/O can require more capacity.
- Storage = retained daily data × retention duration × copy factor + working products + software/logs, followed by explicit device redundancy and operational headroom. Separate raw/processed retention and avoid applying copy factors twice. Copies in the same failure domain do not protect against its loss.
- Network demand depends on transfer windows and simultaneous streams, not only daily totals. Specify lost-connectivity behavior and local buffering.
- Electrical demand includes equipment operating modes and separately itemized conversion, cooling, and environmental-support loads. Storage energy derives from essential power over the required outage duration, adjusted for usable capacity, efficiency, temperature, and aging assumptions.
- Attribute heat to each subsystem and rejection path. Determine radiator performance from a thermal model including operating temperature and site conditions. Do not derive cooling capacity from ambient cold alone.
- Estimate panel output using seasonal irradiance, orientation, shadows, dust, efficiency, and system losses. Do not size solar from IT peak power alone or assume batteries cover an unspecified dust storm.
- Facility area comes from feasible geometry and clearances. Radiator emitting area is not land area; solar panel area is not array-plot area.

## Output contract

For each option record an ID/version, input snapshot, profile and equipment versions, assumptions, missing inputs, and uncertainty range. Emit compute/memory, usable storage, network needs, equipment count and mass, normal/peak/essential/survival electrical demand, energy by operating period, subsystem heat loads, component geometry, support loads, proposed power/cooling configuration, connections, access, and expansion allowances. Distinguish unknown specifications from calculated values.

Report low-demand, expected-demand, and high-demand scenarios only when their input assumptions are defined. These are scenario bounds, not statistical confidence intervals. Engineering limits such as permissible settlement come from design evidence, not inferred robot workload.

## Site feedback and stopping rule

Keep an initial facility option separate from each candidate-specific revision. Refine solar/storage, radiators, connections, and layout with the candidate evidence; rerun affected metrics. If no consistent layout and resource balance is found within a declared iteration budget, report unresolved or infeasible under the tested assumptions. Do not present an unconverged estimate as a fit.

## Validation before implementation claims

Benchmark representative mapping/inspection jobs and sensor samples; verify units, retention arithmetic, energy balance, and no double-counting. Test deadline bursts, unavailable profiles, zero optional workloads, growth, outages, and missing equipment geometry. Test that increased demand cannot silently reduce service capacity at identical quality. Compare integrated and dedicated options. Review thermal, electrical, structural, and mission limits with the relevant engineering expertise. Report calibration limits with every estimate.
