# Construction project owner inputs

## Purpose and status

Specify the planned intake for locating computing infrastructure that supports Mars construction. This is a product specification, not an implemented form or sizing algorithm. Owners describe their operation; they are not expected to know data-center dimensions or server specifications.

## UI and script contract

The [script design](construction-sizing-script-design.md) specifies each input control, allowed choices, numeric units, conditional requirements, JSON representation, validation, and the output contract for the feasibility algorithm. Categories use select controls; counts and measurements use numeric fields; fleets/phases/jobs use repeatable rows; locations use map controls. Unknown values remain explicit. This document is the owner-facing overview; the script design is the implementation contract.

## Inputs

| Group | Owner information | Units or choices | Handling unknowns |
|---|---|---|---|
| Project | Name, structures being built, phases | Landing pad, road, habitat, utilities, other | Ask for the primary activity first |
| Work extent | Site polygons, surveyed area, road length, excavation volume if known | Coordinates, m², m, m³ | Use explicit scenario ranges; do not invent precise extents |
| Locations | Construction sites, assumed base, delivery points | Mars coordinates; distinguish these from data-center candidates | Missing locations block distance/access assessment |
| Fleet | Robot role and count, simultaneously active units | Survey, excavation, transport, assembly, inspection; integer counts | Unspecified role uses multiple profile options, not a universal per-robot load |
| Schedule | Operating hours, shifts, simultaneous phases, seasonal interruptions | Hours per sol; phase start/end sols | State assumed schedule and sensitivity |
| Outputs | Maps, inspection reports, excavation plans, simulations | Needed output per activity | Do not automatically include all workloads |
| Turnaround | Frequency and deadline for each output, consequences of delay | Jobs per sol; minutes/hours to completion | Ask whether work can wait; separate urgent and deferrable jobs |
| Precision | Required construction/inspection tolerance and survey detail | m, mm, or named task class | Task profile may supply a provisional range; engineering acceptance stays unresolved |
| Duration | Project length, expansion, data retention needs | Sols or Earth years explicitly labeled | Show storage sensitivity to retention |
| Existing support | Available computing, electrical allocation over time, network, backup, maintenance and cargo limits | Known values or unknown | Unknown supply is not unlimited supply |
| Continuity | Work that must continue during failures and tolerable downtime/data loss | Service-specific durations and recovery requirements | Do not promise redundancy or availability without a design |

Robot suppliers or technical staff can later supply sensor formats/rates, onboard filtering, compute capabilities, sample datasets, and measured job runtimes. Start with owner-friendly task profiles; expose their assumptions and replace them as evidence arrives.

## Input rules

Record each field's value or range, unit, origin, and confidence. Distinguish zero, unknown, and not applicable. Counts must be nonnegative integers; simultaneous active counts cannot exceed fleet counts. Durations and task deadlines must be positive where used. Operating hours cannot exceed the modeled sol duration. Validate coordinates and phase overlaps. No unknown may silently become zero demand.

Avoid double-counting a robot that performs several roles or a shared map produced once for several robots. Account for collection schedules separately from processing schedules. Construction robots, investigation vehicles, and module delivery equipment are separate capabilities unless explicitly identified as the same resource.

## Demonstration scenario

`scenario/gale.json` includes an illustrative landing-pad/access-road project with 4 survey, 10 excavation, and 6 transport robots, 12 operating hours per sol, and a one-hour requested map turnaround. These are examples, not owner-validated engineering inputs. Extent, precision, duration, sensor details, and infrastructure remain unknown. No capacity or footprint may be claimed from this incomplete example.

The existing scenario loader does not validate or consume the new construction-project block. Future implementation must add a schema and validation before using it for estimation.

## Handoff

The intake feeds [data-center sizing](data-center-sizing.md). Preserve the original answers, identify material unknowns, and request the missing detail that most changes the capacity estimate. The result is an estimate with assumptions, not a mandated dedicated facility.
