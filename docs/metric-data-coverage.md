# Which data supports each requirement metric

The five requirement documents in [requirements/](requirements/) define 72 metrics. This page lists,
for each one, your teammate's judgement of what can be assessed today (from
[metric-data-availability.md](requirements/metric-data-availability.md)) next to the datasets in our index
that feed it.

"Data we have" means the dataset is an input to the metric's estimate, not that it settles it. Most metrics
also need a facility or mission design, or fieldwork. "Not available yet" lists datasets in the index that
are still pending or that we decided not to use. The mapping lives in `src/martian_map/metrics.py`; it is our
reading of the requirements, so please correct it there if a link is wrong.

To find data for one metric: `python -m martian_map catalog search --metric BT-05`.
To refresh this page: `python -m martian_map catalog metrics --write docs/metric-data-coverage.md`.

<!-- metrics:start -->
### Buildable terrain

| Metric | Available today? (teammate) | Data we have | Not available yet |
|---|---|---|---|
| BT-01 Connected area ratio | Estimate today | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `scenario`, `slope_10m_study`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`; Arcadia Planitia: 5; Jezero crater: 5 |  |
| BT-02 Complete layout fit | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `scenario`; Arcadia Planitia: 3; Jezero crater: 3 |  |
| BT-03 Required spatial connections | Partial | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| BT-04 Overall building-pad slope | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_point_service`, `scenario`; Arcadia Planitia: 3; Jezero crater: 3 |  |
| BT-05 Maximum local pad slope | Estimate today | `scenario`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`; Arcadia Planitia: 3; Jezero crater: 3 |  |
| BT-06 Maximum grading or support correction | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_point_service`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| BT-07 Earthmoving demand | Partial | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| BT-08 Detrended roughness | Partial | `roughness_1m_curiosity_recent`, `roughness_1m_near_base_north`, `roughness_1m_near_base_west`, `scenario`; Arcadia Planitia: 3; Jezero crater: 3 |  |
| BT-09 Support-interface variation | Field data needed | none |  |
| BT-10 Abrupt step height | Partial | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `scenario`, `slope_1m_curiosity_recent`, `slope_1m_near_base_north`, `slope_1m_near_base_west`; Arcadia Planitia: 5; Jezero crater: 5 |  |
| BT-11 Unresolved blocking obstacles | Partial | `imagery_hirise_color`, `imagery_hirise_gray`, `roughness_1m_curiosity_recent`, `roughness_1m_near_base_north`, `roughness_1m_near_base_west`, `thermal_inertia_themis_1km`; Arcadia Planitia: 3; Jezero crater: 3 |  |
| BT-12 Obstacle removal demand | Partial | `imagery_hirise_color`, `imagery_hirise_gray` |  |
| BT-13 Residual clearance margin | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `imagery_hirise_color`, `imagery_hirise_gray`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| BT-14 Hazard-envelope overlap | Partial | `dune_change_imagery`, `dune_fields`, `geology_contacts`, `geology_structures`, `geology_units`, `imagery_ctx`, `imagery_ctx_mmgis`, `imagery_hirise_color`, `imagery_hirise_gray`; Arcadia Planitia: 4; Jezero crater: 4 | `geology_1to60k`; Arcadia Planitia: 1; Jezero crater: 1 |
| BT-15 Setback adequacy | Partial | `dune_change_imagery`, `dune_fields`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`; Arcadia Planitia: 3; Jezero crater: 3 | Arcadia Planitia: 1; Jezero crater: 1 |
| BT-16 Mobile-terrain clearance | Partial | `dune_change_imagery`, `dune_fields`; Arcadia Planitia: 1; Jezero crater: 1 | Arcadia Planitia: 1; Jezero crater: 1 |
| BT-17 Corridor width | Estimate today | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_2m_trip_area`, `imagery_hirise_color`, `imagery_hirise_gray`; Arcadia Planitia: 3; Jezero crater: 3 |  |
| BT-18 Grade and cross-slope utilization | Estimate today | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_2m_trip_area`, `rover_path`, `rover_stops`, `slope_10m_study`, `slope_1m_curiosity_recent`, `slope_1m_near_base_north`, `slope_1m_near_base_west`, `slope_2m_trip_area`; Arcadia Planitia: 6; Jezero crater: 8 | Arcadia Planitia: 2 |
| BT-19 Turning fit | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `imagery_hirise_color`, `imagery_hirise_gray`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| BT-20 Route redundancy | Partial | `elevation_10m_study`, `imagery_ctx`, `imagery_ctx_mmgis`, `slope_10m_study` |  |
| BT-21 Utility route utilization | Estimate today | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`; Arcadia Planitia: 2; Jezero crater: 2 |  |

### Ground and ice

| Metric | Available today? (teammate) | Data we have | Not available yet |
|---|---|---|---|
| GI-01 Bearing-capacity adequacy | Field data needed | none |  |
| GI-02 Other support-limit utilization | Field data needed | none |  |
| GI-03 Total settlement utilization | Field data needed | none |  |
| GI-04 Differential movement utilization | Field data needed | none |  |
| GI-05 Unresolved ice interactions | Partial | `water_odyssey_grs`; Arcadia Planitia: 1; Jezero crater: 1 | `ice_swim`, `water_dan_curiosity`; Arcadia Planitia: 1; Jezero crater: 1 |
| GI-06 Investigated depth coverage | Field data needed | none |  |
| GI-07 Thermally induced deformation utilization | Field data needed | `thermal_inertia_themis_1km`; Arcadia Planitia: 1; Jezero crater: 1 |  |
| GI-08 Unassessed influence overlap | Partial | none | `ice_swim`; Arcadia Planitia: 1; Jezero crater: 1 |
| GI-09 Construction-budget utilization | Partial | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| GI-10 Unresolved excavation stability cases | Planning calculation | none |  |
| GI-11 Critical-zone evidence completion | Planning calculation | `geology_contacts`, `geology_map_index`, `geology_structures`, `geology_units`, `rover_path`, `rover_stops`; Arcadia Planitia: 4; Jezero crater: 6 | `geology_1to60k`; Arcadia Planitia: 2 |
| GI-12 Decision-critical unresolved hypotheses | Planning calculation | `geology_contacts`, `geology_structures`, `geology_units`, `minerals_detections`, `thermal_inertia_tes`, `thermal_inertia_themis_1km`, `water_odyssey_grs`; Arcadia Planitia: 7; Jezero crater: 7 | `geology_1to60k`, `water_dan_curiosity` |

### Solar conditions

| Metric | Available today? (teammate) | Data we have | Not available yet |
|---|---|---|---|
| SC-01 Terrain-shading energy loss | Estimate today | `elevation_463m_region`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`; Arcadia Planitia: 5; Jezero crater: 5 |  |
| SC-02 Row-shading energy loss | Planning calculation | none |  |
| SC-03 Average solar contribution | Estimate today | `dust_climate_mcd`, `optical_depth_history`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`; Arcadia Planitia: 3; Jezero crater: 3 | Arcadia Planitia: 1; Jezero crater: 1 |
| SC-04 Worst-season energy adequacy | Estimate today | `dust_climate_mcd`, `optical_depth_history`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`; Arcadia Planitia: 3; Jezero crater: 3 | Arcadia Planitia: 1; Jezero crater: 1 |
| SC-05 Soiling-loss allowance utilization | Partial | `optical_depth_history`, `surface_dust_tes`; Arcadia Planitia: 1; Jezero crater: 1 | Arcadia Planitia: 1; Jezero crater: 1 |
| SC-06 Cleaning-resource utilization | Planning calculation | none |  |
| SC-07 Unserved essential energy | Planning calculation | none |  |
| SC-08 Storage-limit violations | Planning calculation | none |  |
| SC-09 Flexible-work completion | Planning calculation | none |  |
| SC-10 Array layout accommodation | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`; Arcadia Planitia: 4; Jezero crater: 4 |  |
| SC-11 Electrical-route loss | Planning calculation | none |  |
| SC-12 Required scenario coverage | Planning calculation | `dust_climate_mcd`, `optical_depth_history`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`; Arcadia Planitia: 3; Jezero crater: 3 | Arcadia Planitia: 1; Jezero crater: 1 |
| SC-13 Validation-error utilization | Partial | `optical_depth_history` | Arcadia Planitia: 1; Jezero crater: 1 |

### Thermal conditions

| Metric | Available today? (teammate) | Data we have | Not available yet |
|---|---|---|---|
| TC-01 Environmental case coverage | Partial | `temperature_climate_mcd`, `themis_temp_day_aphelion`, `themis_temp_day_perihelion`, `themis_temp_night_aphelion`, `themis_temp_night_perihelion`, `themis_temperature_list`, `thermal_day`, `thermal_inertia_themis_1km`, `thermal_night`, `weather_rems`; Arcadia Planitia: 7; Jezero crater: 6 | Arcadia Planitia: 3; Jezero crater: 4 |
| TC-02 Enclosure external-envelope margin | Planning calculation | `temperature_climate_mcd`; Arcadia Planitia: 1; Jezero crater: 1 |  |
| TC-03 Heat-rejection adequacy | Planning calculation | `temperature_climate_mcd`; Arcadia Planitia: 1; Jezero crater: 1 |  |
| TC-04 Operating-temperature margin | Planning calculation | none |  |
| TC-05 Cold-protection resource utilization | Planning calculation | `temperature_climate_mcd`; Arcadia Planitia: 1; Jezero crater: 1 |  |
| TC-06 Thermal-cycle utilization | Partial | `temperature_climate_mcd`, `weather_rems`; Arcadia Planitia: 1; Jezero crater: 1 | Arcadia Planitia: 1; Jezero crater: 1 |
| TC-07 Adverse-environment rejection penalty | Estimate today | `dust_climate_mcd`, `dust_extinction_navcam`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`, `optical_depth_history`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`, `surface_dust_tes`; Arcadia Planitia: 6; Jezero crater: 6 | Arcadia Planitia: 2; Jezero crater: 2 |
| TC-08 Thermal-layout accommodation | Estimate today | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`; Arcadia Planitia: 4; Jezero crater: 4 |  |
| TC-09 Connection-resource utilization | Planning calculation | `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| TC-10 Ground-interaction utilization | Field data needed | `thermal_inertia_themis_1km`; Arcadia Planitia: 1; Jezero crater: 1 |  |
| TC-11 Required monitoring completion | Planning calculation | `temperature_climate_mcd`, `themis_temp_day_aphelion`, `themis_temp_day_perihelion`, `themis_temp_night_aphelion`, `themis_temp_night_perihelion`, `themis_temperature_list`, `weather_rems`; Arcadia Planitia: 4; Jezero crater: 3 | Arcadia Planitia: 3; Jezero crater: 4 |
| TC-12 Model validation utilization | Partial | `optical_depth_history`, `temperature_climate_mcd`, `themis_temp_day_aphelion`, `themis_temp_day_perihelion`, `themis_temp_night_aphelion`, `themis_temp_night_perihelion`, `weather_rems`; Arcadia Planitia: 3; Jezero crater: 2 | Arcadia Planitia: 4; Jezero crater: 5 |

### Investigation routes

| Metric | Available today? (teammate) | Data we have | Not available yet |
|---|---|---|---|
| IR-01 Stop-to-decision traceability | Planning calculation | none |  |
| IR-02 Mandatory objective coverage | Planning calculation | none |  |
| IR-03 Mobility-limit utilization | Partial | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_2m_trip_area`, `elevation_point_service`, `imagery_hirise_color`, `imagery_hirise_gray`, `roughness_1m_curiosity_recent`, `roughness_1m_near_base_north`, `roughness_1m_near_base_west`, `rover_path`, `rover_stops`, `slope_10m_study`, `slope_1m_curiosity_recent`, `slope_1m_near_base_north`, `slope_1m_near_base_west`, `slope_2m_trip_area`; Arcadia Planitia: 8; Jezero crater: 10 | Arcadia Planitia: 2 |
| IR-04 Assessed route coverage | Planning calculation | `elevation_2m_trip_area`, `imagery_hirise_color`, `imagery_hirise_gray`, `rover_path`, `rover_stops`, `slope_2m_trip_area`; Arcadia Planitia: 2; Jezero crater: 4 | Arcadia Planitia: 2 |
| IR-05 Planned-time utilization | Planning calculation | `elevation_2m_trip_area`, `scenario`; Arcadia Planitia: 2; Jezero crater: 2 |  |
| IR-06 Return-time feasibility | Planning calculation | `elevation_2m_trip_area`; Arcadia Planitia: 1; Jezero crater: 1 |  |
| IR-07 Resource utilization | Planning calculation | none |  |
| IR-08 Return-resource feasibility | Planning calculation | none |  |
| IR-09 Instrument and payload readiness | Planning calculation | none |  |
| IR-10 Longest unsupported communication interval | Estimate today | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_463m_region`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`; Arcadia Planitia: 5; Jezero crater: 5 | `communications` |
| IR-11 Navigation-error utilization | Planning calculation | `imagery_hirise_color`, `imagery_hirise_gray`, `named_sites`; Jezero crater: 1 |  |
| IR-12 Environmental-limit utilization | Partial | `dust_climate_mcd`, `dust_extinction_navcam`, `optical_depth_history`, `radiation_rad`, `space_weather_donki`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`, `temperature_climate_mcd`, `weather_rems`; Arcadia Planitia: 4; Jezero crater: 4 | Arcadia Planitia: 5; Jezero crater: 5 |
| IR-13 Required contingency coverage | Planning calculation | none |  |
| IR-14 Independent return options | Partial | `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `imagery_ctx`, `imagery_ctx_mmgis`, `slope_10m_study`; Arcadia Planitia: 2; Jezero crater: 2 |  |

### No data yet for metrics that could be estimated today

- **GI-08 Unassessed influence overlap** (Partial): Partial: preliminary overlap can be mapped under assumptions
<!-- metrics:end -->
