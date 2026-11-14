# Metric Data Availability Reference

This reference classifies all 72 metrics across the five requirements documents by what can be assessed from existing remote data, what requires design or mission inputs, and what needs local measurements. Availability reviewed on November 14, 2026. No candidate site has been selected or its data coverage verified.

Not every metric is a measurement of Mars. Some are calculated from imagery, some need local tests, and others evaluate the proposed facility or mission plan. None inherently requires an astronaut rather than a capable robot. **Fieldwork** means local measurements collected by astronauts, robots, or deployed instruments; instrument capability and mission constraints determine who performs it.

## Availability labels

- **Estimate today:** Existing remote data can support an estimate where coverage, accuracy, and resolution are adequate. The result may still require design assumptions and calculation.
- **Partial:** Relevant evidence exists, but does not fully establish the site-specific metric.
- **Field data needed:** Necessary local measurements are generally unavailable for an unvisited candidate site.
- **Planning calculation:** Calculated from designs, budgets, models, or an evidence register; not a downloadable Mars dataset.

These labels describe potential availability, not a claim that all inputs have been acquired. Existing rover observations can provide local evidence at visited locations, but should not be generalized to an arbitrary candidate site. Field verification becomes especially important where uncertainty could change acceptance. A calculated estimate is not construction or mission approval.

## 1. Buildable terrain

Source requirements: [Buildable Terrain Requirements](buildable-terrain.md). Existing imagery and elevation models are strongest for large-scale geometry. HiRISE terrain models commonly have 1–2 m grid spacing; they cannot automatically resolve small steps or foundation-contact surfaces. [HiRISE documentation](https://www.uahirise.org/dtm/about.php)

| Metric | What we measure or calculate | Available today? | What local fieldwork would add |
|---|---|---|---|
| BT-01 Connected area ratio | Connected usable area compared with required facility area | Estimate today: terrain and imagery, plus layout assumptions | Verify unresolved obstacles and boundaries; ground suitability remains separate |
| BT-02 Complete layout fit | Whether every required footprint and clearance fits | Estimate today: overlay the design on mapped terrain | Check small obstacles and critical clearances |
| BT-03 Required spatial connections | Whether usable corridors connect all required equipment zones | Partial: candidate connections can be mapped | Confirm narrow passages, surface conditions, and access |
| BT-04 Overall building-pad slope | Overall tilt across the proposed building pad | Estimate today: suitable elevation model | Refine elevations if uncertainty could change acceptance |
| BT-05 Maximum local pad slope | Steepest modeled slope within the specified local windows | Estimate today: fine terrain model, subject to accuracy | Resolve steep transitions or features smaller than the model |
| BT-06 Maximum grading or support correction | Largest height adjustment needed to reach the proposed design surface | Estimate today: terrain plus pad/support design | Detailed elevations at actual support locations |
| BT-07 Earthmoving demand | Volumes of material to cut and fill | Partial: geometric volumes can be estimated | Identify material properties, excavability, and whether spoil is reusable |
| BT-08 Detrended roughness | Local bumps and depressions after removing overall slope | Partial: roughness at resolvable scales | Measure finer surface irregularities |
| BT-09 Support-interface variation | Height variation beneath each actual support footprint | Field data needed: usually too fine for orbital models | Close-range survey of contact surfaces |
| BT-10 Abrupt step height | Largest step along a required vehicle path | Partial: large steps are visible; small critical ones may not be | Measure vehicle-scale steps and depressions |
| BT-11 Unresolved blocking obstacles | Obstacles intersecting required footprints without a feasible avoidance/removal plan | Partial: larger obstacles can be identified | Check dimensions, embedded depth, and removability |
| BT-12 Obstacle removal demand | Removal effort compared with equipment and work budgets | Partial: rough size estimates exist; effort is design-dependent | Test material, embedded depth, lifting/excavation difficulty |
| BT-13 Residual clearance margin | Smallest remaining clearance around operating envelopes | Estimate today: for sufficiently resolved obstacles and a defined layout | Verify tight clearances and hidden features |
| BT-14 Hazard-envelope overlap | Facility area intersecting assessed hazard zones | Partial: hazard sources can be mapped; exclusion zones need analysis | Investigate unstable material, fractures, and local conditions |
| BT-15 Setback adequacy | Actual separation compared with the required hazard setback | Partial: distance is measurable; required setback is not a ready-made dataset | Supply material and stability evidence for hazard analysis |
| BT-16 Mobile-terrain clearance | Remaining clearance after predicted dune or other material movement | Partial: repeat imagery may show movement | Monitor changes and constrain future encroachment |
| BT-17 Corridor width | Narrowest usable width along a construction/service route | Estimate today: where imagery resolves corridor boundaries | Check small obstructions and usable ground |
| BT-18 Grade and cross-slope utilization | Route slopes compared with loaded-vehicle limits | Estimate today: terrain plus vehicle assumptions | Validate difficult segments and actual mobility conditions |
| BT-19 Turning fit | Whether the vehicle and payload can make required turns | Estimate today: vehicle geometry plus mapped obstacles | Verify tight turns and ground conditions |
| BT-20 Route redundancy | Number of usable routes without a shared critical bottleneck | Partial: alternatives can be identified remotely | Verify that alternatives are actually traversable |
| BT-21 Utility route utilization | Cable/pipe route length and geometry compared with design limits | Estimate today: terrain plus utility design | Verify trench conditions, obstacles, and installation details |

Substantial terrain screening can begin today. The main gaps are small-scale geometry, material behavior, and confirmation that proposed routes and construction methods work.

## 2. Ground and ice evidence

Source requirements: [Ground and Ice Evidence Requirements](ground-and-ice.md). Remote evidence helps identify where to investigate, but usually cannot establish foundation properties. The cited SWIM products include approximately 3-km ice-consistency pixels, far larger than a module foundation. [USGS ice-mapping study](https://www.usgs.gov/publications/refined-mapping-subsurface-water-ice-mars-support-future-missions)

| Metric | What we measure or calculate | Available today? | What local fieldwork would add |
|---|---|---|---|
| GI-01 Bearing-capacity adequacy | Allowable ground pressure compared with foundation loading | Field data needed: geological appearance does not establish bearing capacity | Soil/rock characterization and appropriate probing/load tests |
| GI-02 Other support-limit utilization | Resistance to sliding, uplift, anchor loading, and other forces | Field data needed, plus foundation design | Material and anchor tests supporting engineering calculations |
| GI-03 Total settlement utilization | Predicted support settlement compared with its allowance | Field data needed, followed by modeling | Layering, compressibility, load response, and monitoring |
| GI-04 Differential movement utilization | Uneven movement between supports compared with tolerances | Field data needed, followed by modeling | Spatial variability across the footprint |
| GI-05 Unresolved ice interactions | Critical structures potentially interacting with ice without an assessed response | Partial: possible regional ice interactions can be flagged | Confirm local ice and evaluate disturbance/heating effects |
| GI-06 Investigated depth coverage | Characterized depth compared with the required investigation depth | Field data needed for foundation-scale characterization | Depth profiles, radar where suitable, probes or cores |
| GI-07 Thermally induced deformation utilization | Ground movement caused by heating or ice changes compared with allowances | Field data needed, plus a coupled thermal/ground model | Temperature profiles, ice/material properties, displacement monitoring |
| GI-08 Unassessed influence overlap | Critical footprint overlapping an unassessed ground-change zone | Partial: preliminary overlap can be mapped under assumptions | Refine the extent and response of affected ground |
| GI-09 Construction-budget utilization | Excavation energy, time, and handling demands compared with budgets | Partial: geometry helps; material behavior is missing | Excavation trials and material testing |
| GI-10 Unresolved excavation stability cases | Proposed excavations lacking a supported stability assessment | Planning calculation: identify unassessed cases now | Ground investigation needed to resolve them |
| GI-11 Critical-zone evidence completion | Percentage of required zones with adequate ground characterization | Planning calculation: audit existing evidence against a sampling plan | Complete the missing characterization |
| GI-12 Decision-critical unresolved hypotheses | Remaining plausible ground interpretations that could reverse the decision | Planning calculation: list and test hypotheses against existing evidence | Targeted measurements to distinguish competing interpretations |

This factor provides a strong justification for local investigation. Astronauts do not directly measure settlement suitability; they collect inputs that support engineering predictions.

## 3. Solar conditions

Source requirements: [Solar Conditions Requirements](solar-conditions.md). Many solar metrics can be modeled today, but a proposed array's actual performance is not an existing observation. Local dust deposition, maintenance performance, and validation remain important gaps.

| Metric | What we measure or calculate | Available today? | What local fieldwork would add |
|---|---|---|---|
| SC-01 Terrain-shading energy loss | Electricity lost to terrain shadows relative to an unobstructed reference | Estimate today: terrain, Sun geometry, and proposed array model | Verify local horizon and shadow timing where uncertain |
| SC-02 Row-shading energy loss | Electricity lost because array rows shade one another | Planning calculation: primarily array layout and electrical design | Installation verification; no astronaut measurement inherently required |
| SC-03 Average solar contribution | Average net electrical output over the reference period | Estimate today: environmental scenarios plus array design | Calibrate with irradiance, panel temperature, dust, and electrical measurements |
| SC-04 Worst-season energy adequacy | Seasonal solar output compared with the assigned energy requirement | Estimate today: seasonal modeling plus demand assumptions | Validate seasonal conditions; one visit is insufficient |
| SC-05 Soiling-loss allowance utilization | Deposited-dust losses compared with the allowed loss | Partial: historical mission evidence exists, but not a universal local rate | Paired cleaned/soiled panel monitoring at the site |
| SC-06 Cleaning-resource utilization | Energy, time, and consumables needed for cleaning | Planning calculation with unverified local inputs | Representative cleaning trials and access checks |
| SC-07 Unserved essential energy | Essential electricity demand that the combined supply cannot meet | Planning calculation: requires demand, firm supply, solar, and storage models | Improve environmental inputs; this is not itself a field measurement |
| SC-08 Storage-limit violations | Times storage exceeds its energy, power, temperature, or reserve limits | Planning calculation: requires storage and operating specifications | Environmental and system tests for validation |
| SC-09 Flexible-work completion | Computing work completed by deadline under available power | Planning calculation: requires workload performance and scheduling | No terrain measurement directly establishes this; hardware/workload tests are central |
| SC-10 Array layout accommodation | Whether the panel/support/access layout fits | Estimate today: layout plus mapped terrain | Verify support ground, obstacles, and maintenance access |
| SC-11 Electrical-route loss | Electricity lost in the proposed connections and conversion | Planning calculation: cable routes, conductors, voltage, and load | Installation and performance verification later |
| SC-12 Required scenario coverage | Whether all required seasons, dust cases, and operating states were evaluated | Planning calculation: audit of the modeling plan | Measurements may fill evidence gaps, but the metric is an audit |
| SC-13 Validation-error utilization | Difference between predicted and independently observed performance | Partial: general models can be checked against existing mission data; our site/array cannot yet be validated directly | Local test-panel and irradiance observations |

Astronauts can deploy and service monitoring equipment. They are not needed to calculate Sun positions, array shadows, or electrical losses.

## 4. Thermal conditions

Source requirements: [Thermal Conditions Requirements](thermal-conditions.md). Existing surface-temperature observations are useful context, not measurements of air temperature or a future cooling system. THEMIS infrared observations are approximately 100 m/pixel, limiting their usefulness for distinguishing conditions within the core compound. [THEMIS fact sheet](https://themis.asu.edu/factsheet)

| Metric | What we measure or calculate | Available today? | What local fieldwork would add |
|---|---|---|---|
| TC-01 Environmental case coverage | Whether required thermal conditions have bounded input data | Partial: remote observations and models cover some conditions | Fill local air, ground-depth, seasonal, and extreme-condition gaps |
| TC-02 Enclosure external-envelope margin | Environmental conditions compared with enclosure operating limits | Planning calculation using partial environmental evidence | Validate local conditions; enclosure qualification also requires engineering tests |
| TC-03 Heat-rejection adequacy | Available cooling capacity compared with heat that must be removed | Planning calculation: requires radiator/cooling design and environmental model | Instrumented heat-rejection tests to validate local performance |
| TC-04 Operating-temperature margin | Predicted equipment temperatures compared with allowable limits | Planning calculation: requires equipment and coupled thermal models | Validate environmental inputs and system behavior |
| TC-05 Cold-protection resource utilization | Heater power and energy compared with available allocations | Planning calculation: requires insulation, survival loads, and supply assumptions | Cold-condition monitoring and representative system tests |
| TC-06 Thermal-cycle utilization | Temperature swings, ramp rates, and cycles compared with qualified limits | Partial: environmental cycling can be modeled; equipment response needs design/testing | Local monitoring; laboratory/component qualification remains necessary |
| TC-07 Adverse-environment rejection penalty | Cooling lost because of unfavorable exposure, nearby surfaces, or dust | Estimate today for geometry; partial for local environmental effects | Measure dust/optical changes and validate thermal performance |
| TC-08 Thermal-layout accommodation | Whether radiator placement meets space, access, and thermal constraints | Estimate today under a specified design | Verify ground, nearby surfaces, and critical environmental assumptions |
| TC-09 Connection-resource utilization | Pumping, pressure, and unwanted heat exchange compared with budgets | Planning calculation: requires pipe routes, coolant, and insulation design | Route/environment verification and engineering tests |
| TC-10 Ground-interaction utilization | Ground deformation caused by facility heat compared with allowances | Field data needed, followed by modeling | Subsurface properties, temperature profiles, ice evidence and movement |
| TC-11 Required monitoring completion | Percentage of required locations, depths, and time regimes adequately covered | Planning calculation: audit existing observations and accepted models | Install sensors and complete missing observations |
| TC-12 Model validation utilization | Temperature and heat-rejection prediction errors compared with tolerances | Partial: some environmental models can be checked today; proposed facility cannot be locally validated yet | Independent local measurements and equipment tests |

TC-10 and GI-07 share the same underlying ground-deformation assessment. They are two views of the same evidence, not independent measurements. Local temperature measurements are valuable, but several thermal metrics are chiefly equipment-design questions, not properties directly measurable from the landscape.

## 5. Investigation routes

Source requirements: [Investigation Routes Requirements](investigation-routes.md). Most route metrics are planning calculations. Terrain evidence supplies part of the input; suit, vehicle, instrument, and mission assumptions supply the rest. NASA EVA decision-support research treats timelines and consumables as modeled quantities updated as an excursion progresses. [NASA-hosted research](https://ntrs.nasa.gov/api/citations/20230007488/downloads/ICES%202023%20PersEIDS.pdf)

| Metric | What we measure or calculate | Available today? | What local fieldwork would add |
|---|---|---|---|
| IR-01 Stop-to-decision traceability | Whether each stop answers a defined question with a suitable measurement | Planning calculation: define this now | Record whether the planned measurement succeeded |
| IR-02 Mandatory objective coverage | Whether the excursion can accomplish its required measurements | Planning calculation: task plan plus capability and resource assumptions | Actual task completion and instrument performance |
| IR-03 Mobility-limit utilization | Terrain demands compared with crew/vehicle limits | Partial: geometry can be estimated; traction and small obstacles may be unknown | Local reconnaissance and mobility verification |
| IR-04 Assessed route coverage | Percentage of route with sufficient evidence for critical mobility checks | Planning calculation: audit available route evidence | Reconnaissance of unverified segments |
| IR-05 Planned-time utilization | Travel, tasks, and return time compared with available duration | Planning calculation: requires speed and task-duration assumptions | Actual travel/task timing to refine the model |
| IR-06 Return-time feasibility | Time needed to return from each state compared with remaining allowed time | Planning calculation: simulate now | Updated location, progress, and route conditions during the mission |
| IR-07 Resource utilization | Planned oxygen, battery, and other consumable use compared with budgets | Planning calculation: requires specified suit/vehicle and activity models | Mission telemetry and activity-specific validation |
| IR-08 Return-resource feasibility | Resources needed to stop work and return compared with remaining supplies | Planning calculation: simulate now | Actual remaining supplies and current conditions |
| IR-09 Instrument and payload readiness | Whether equipment can perform tasks within payload/resource limits | Planning calculation: instrument specifications and test evidence | Deployment trials and verification in actual conditions |
| IR-10 Longest unsupported communication interval | Longest time without required local communications | Estimate today under an assumed network: terrain, antennas, relays, and link model | Local link tests; terrain visibility alone does not prove connectivity |
| IR-11 Navigation-error utilization | Position uncertainty compared with the precision needed | Planning calculation with partial evidence: requires navigation architecture | Landmark surveys and localization trials |
| IR-12 Environmental-limit utilization | Weather, exposure, and visibility compared with mission limits | Partial: historical conditions and scenarios exist; future excursion conditions do not | Local monitoring and mission-time updates |
| IR-13 Required contingency coverage | Whether defined disruptions have workable responses | Planning calculation: evaluate specified scenarios now | Verify shelter, rescue, vehicle, and route assumptions |
| IR-14 Independent return options | Number of usable return options without shared critical failures | Partial: alternative paths can be mapped and modeled | Verify their traversability and support arrangements |

## Implications for the investigation map

The 72 metrics are an assessment framework, not 72 things astronauts need to measure.

| Work we can start now | Work requiring local evidence | Work requiring facility/mission design |
|---|---|---|
| Terrain geometry, approximate layout fit, shadow modeling, preliminary corridors, and evidence-gap mapping | Ground strength, local ice structure, fine obstacles, traction, dust accumulation, and local thermal validation | Foundations, cooling capacity, electrical losses, storage behavior, computing schedules, suit resources, and contingency limits |

The astronaut investigation map should concentrate on missing local evidence that could change the choice between candidate sites. Remote analysis and engineering assumptions help decide where to investigate and why those measurements matter. Laboratory qualification, computer simulation, robotic reconnaissance and crewed fieldwork are complementary; they should not all be labeled as astronaut measurements.
