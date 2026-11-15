# Data references for the submission

The Space Apps project form has two fields this page fills in:

- **NASA Data:** "what NASA data and resources you used". At least one is needed for a Global Award.
- **Space Agency Partner Data and Other References:** "all of the data, resources, and tools used",
  including code, text and images, even open-source ones.

The lists below are generated from the index ([`data/catalog.json`](../data/catalog.json)), so every
dataset the map uses appears under the mission or archive it came from. Each source says who made it, the
credit line to show, its licence, and the paper to cite where there is one. Every link was opened on
2026-11-14 (the test `tests/test_references.py::test_reference_urls_reachable` re-checks them).

To refresh this page after a snapshot:

```bash
python -m martian_map catalog references --write docs/data-references.md
```

Things to know when reading the lists:

- **NASA data** includes NASA missions and instruments, NASA archives (the Planetary Data System), NASA
  tools (Mars Trek, MMGIS, Mars24), and the USGS products made for the NASA Planetary Geologic Mapping
  Program, which the challenge lists as a NASA resource. Some NASA instruments were built by partners
  (Curiosity's REMS weather station by Spain's Centro de Astrobiología); that's noted in the entry.
- **Space Agency Partner data** is data from or supported by a partner space agency: ESA's Mars Express
  OMEGA instrument (part of the mineral layer), and the Mars Climate Database, made by the LMD laboratory
  (France) with ESA and CNES support. The MCD's terms ask users to quote it and to keep the LMD team
  informed: email the team about the project before or after submitting.
- **Other** covers work by people outside NASA. The thermal inertia map (Huang 2026) and the Mastcam dust
  record (Lemmon 2024) are researchers' products *built from* NASA THEMIS and Curiosity Mastcam images, so
  those NASA instruments are listed for the same datasets too. Anything our code computes (slope,
  roughness, skylines, sun tables, sand movement) is listed as computed by this project, with the NASA
  data it was computed from.

<!-- references:start -->
### NASA data and resources

- **NASA Mars Trek (Solar System Treks)**. NASA Solar System Treks Project, NASA/JPL-Caltech. <https://trek.nasa.gov/mars/>
  - What we use it for: Map service for HiRISE, CTX, THEMIS, TES, MOLA and Viking layers, the Gale 1 m elevation model, and the mineral and dune layers.
  - Credit: NASA/JPL-Caltech, Solar System Treks Project. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `dune_fields`, `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_2m_trip_area`, `elevation_463m_region`, `elevation_point_service`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`, `imagery_ctx`, `imagery_hirise_gray`, `imagery_viking`, `minerals_detections`, `relief_mola`, `roughness_1m_curiosity_recent`, `roughness_1m_near_base_north`, `roughness_1m_near_base_west`, `slope_10m_study`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`, `slope_1m_curiosity_recent`, `slope_1m_near_base_north`, `slope_1m_near_base_west`, `slope_2m_trip_area`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`, `surface_dust_tes`, `thermal_day`, `thermal_inertia_tes`, `thermal_night`
  - Datasets, Arcadia Planitia: `dune_fields`, `elevation_463m_region`, `horizon_arcadia_north`, `horizon_arcadia_south`, `imagery_viking`, `minerals_detections`, `relief_mola`, `sun_table_arcadia_north`, `sun_table_arcadia_south`, `surface_dust_tes`, `thermal_day`, `thermal_inertia_tes`, `thermal_night`
  - Datasets, Jezero crater: `dune_fields`, `elevation_463m_region`, `horizon_jezero_north`, `horizon_jezero_south`, `imagery_viking`, `minerals_detections`, `relief_mola`, `sun_table_jezero_north`, `sun_table_jezero_south`, `surface_dust_tes`, `thermal_day`, `thermal_inertia_tes`, `thermal_night`
- **Mars Reconnaissance Orbiter HiRISE camera**. NASA/JPL-Caltech/University of Arizona. <https://www.uahirise.org/>
  - What we use it for: Sharpest photos and the 1 m elevation model of Gale.
  - Credit: NASA/JPL-Caltech/University of Arizona. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: McEwen, A. S., et al. (2007). Mars Reconnaissance Orbiter's High Resolution Imaging Science Experiment (HiRISE). J. Geophys. Res., 112, E05S02.
  - Datasets: `dune_change_imagery`, `elevation_10m_study`, `elevation_1m_curiosity_recent`, `elevation_1m_near_base_north`, `elevation_1m_near_base_west`, `elevation_2m_trip_area`, `elevation_point_service`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`, `imagery_hirise_color`, `imagery_hirise_gray`, `roughness_1m_curiosity_recent`, `roughness_1m_near_base_north`, `roughness_1m_near_base_west`, `slope_10m_study`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`, `slope_1m_curiosity_recent`, `slope_1m_near_base_north`, `slope_1m_near_base_west`, `slope_2m_trip_area`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`
- **Mars Reconnaissance Orbiter Context Camera (CTX)**. NASA/JPL-Caltech/Malin Space Science Systems. <https://www.msss.com/all_projects/mro-ctx.php>
  - What we use it for: Photo map of the whole crater.
  - Credit: NASA/JPL-Caltech/MSSS. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Malin, M. C., et al. (2007). Context Camera Investigation on board the Mars Reconnaissance Orbiter. J. Geophys. Res., 112, E05S04.
  - Datasets: `imagery_ctx`, `imagery_ctx_mmgis`
- **Mars Reconnaissance Orbiter CRISM spectrometer**. NASA/JPL-Caltech/Johns Hopkins University Applied Physics Laboratory. <https://science.nasa.gov/mission/mars-reconnaissance-orbiter/>
  - What we use it for: Detections of water-bearing minerals.
  - Credit: NASA/JPL-Caltech/JHUAPL. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Murchie, S., et al. (2007). Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) on Mars Reconnaissance Orbiter (MRO). J. Geophys. Res., 112, E05S03.
  - Datasets: `minerals_detections`
  - Datasets, Arcadia Planitia: `minerals_detections`
  - Datasets, Jezero crater: `minerals_detections`
- **Mars Global Surveyor Mars Orbiter Laser Altimeter (MOLA)**. NASA Goddard Space Flight Center, MOLA Science Team. <https://pds-geosciences.wustl.edu/missions/mgs/mola.html>
  - What we use it for: Regional (463 m) heights for the far skyline, and the shaded-relief layer.
  - Credit: NASA/GSFC MOLA Science Team. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Smith, D. E., et al. (2001). Mars Orbiter Laser Altimeter: Experiment summary after the first year of global mapping of Mars. J. Geophys. Res., 106(E10), 23689-23722.
  - Datasets: `elevation_463m_region`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`, `relief_mola`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`
  - Datasets, Arcadia Planitia: `elevation_463m_region`, `horizon_arcadia_north`, `horizon_arcadia_south`, `relief_mola`, `sun_table_arcadia_north`, `sun_table_arcadia_south`
  - Datasets, Jezero crater: `elevation_463m_region`, `horizon_jezero_north`, `horizon_jezero_south`, `relief_mola`, `sun_table_jezero_north`, `sun_table_jezero_south`
- **Mars Global Surveyor Thermal Emission Spectrometer (TES)**. NASA/JPL-Caltech/Arizona State University. <https://pds-geosciences.wustl.edu/missions/mgs/tes.html>
  - What we use it for: Global thermal inertia and surface dust pictures.
  - Credit: NASA/JPL-Caltech/Arizona State University. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Christensen, P. R., et al. (2001). Mars Global Surveyor Thermal Emission Spectrometer experiment: Investigation description and surface science results. J. Geophys. Res., 106(E10), 23823-23871.
  - Datasets: `surface_dust_tes`, `thermal_inertia_tes`
  - Datasets, Arcadia Planitia: `surface_dust_tes`, `thermal_inertia_tes`
  - Datasets, Jezero crater: `surface_dust_tes`, `thermal_inertia_tes`
- **Mars Odyssey Thermal Emission Imaging System (THEMIS)**. NASA/JPL-Caltech/Arizona State University. <https://themis.asu.edu/>
  - What we use it for: Surface temperature images and infrared pictures; the source of the 1 km thermal inertia map.
  - Credit: NASA/JPL-Caltech/Arizona State University. Licence: NASA PDS data; generally not subject to US copyright. Credit the THEMIS team.
  - Reference: Christensen, P. R., et al. (2004). The Thermal Emission Imaging System (THEMIS) for the Mars 2001 Odyssey Mission. Space Sci. Rev., 110, 85-130.
  - Datasets: `themis_temp_day_aphelion`, `themis_temp_day_perihelion`, `themis_temp_night_aphelion`, `themis_temp_night_perihelion`, `themis_temperature_list`, `thermal_day`, `thermal_inertia_themis_1km`, `thermal_night`
  - Datasets, Arcadia Planitia: `themis_temp_day_aphelion`, `themis_temp_night_aphelion`, `themis_temperature_list`, `thermal_day`, `thermal_inertia_themis_1km`, `thermal_night`
  - Datasets, Jezero crater: `themis_temp_night_aphelion`, `themis_temperature_list`, `thermal_day`, `thermal_inertia_themis_1km`, `thermal_night`
- **Mars Odyssey Gamma Ray Spectrometer (GRS)**. NASA/JPL-Caltech/University of Arizona (GRS team). <https://pds-geosciences.wustl.edu/missions/odyssey/grs_elements.html>
  - What we use it for: Water held in the top layer of the ground, 5 degree cells.
  - Credit: NASA/JPL-Caltech/University of Arizona. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Boynton, W. V., et al. (2007). Concentration of H, Si, Cl, K, Fe, and Th in the low and mid latitude regions of Mars. J. Geophys. Res. Planets. Data set ODY-M-GRS-5-ELEMENTS-V1.0, NASA PDS.
  - Datasets: `water_odyssey_grs`
  - Datasets, Arcadia Planitia: `water_odyssey_grs`
  - Datasets, Jezero crater: `water_odyssey_grs`
- **Viking Orbiter images**. NASA/JPL-Caltech/USGS. <https://nssdc.gsfc.nasa.gov/planetary/viking.html>
  - What we use it for: Global colour background map.
  - Credit: NASA/JPL-Caltech/USGS. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `imagery_viking`
  - Datasets, Arcadia Planitia: `imagery_viking`
  - Datasets, Jezero crater: `imagery_viking`
- **Mars Science Laboratory 'Where is Curiosity?' map (MMGIS)**. NASA/JPL-Caltech. <https://mars.nasa.gov/maps/location/?mission=Curiosity>
  - What we use it for: Curiosity's path, stops, current position, named places and its photo map layers.
  - Credit: NASA/JPL-Caltech. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `imagery_ctx_mmgis`, `imagery_hirise_color`, `labels`, `map_config`, `named_sites`, `rover_path`, `rover_position`, `rover_stops`
- **Curiosity Rover Environmental Monitoring Station (REMS)**. NASA/JPL-Caltech; instrument from Centro de Astrobiologia (CSIC-INTA), Spain. <https://science.nasa.gov/mission/msl-curiosity/science-instruments/>
  - What we use it for: Curiosity's daily weather on the ground.
  - Credit: NASA/JPL-Caltech/CAB (CSIC-INTA). Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Gomez-Elvira, J., et al. (2012). REMS: The Environmental Sensor Suite for the Mars Science Laboratory Rover. Space Sci. Rev., 170, 583-640.
  - Datasets: `weather_rems`
- **Curiosity Rover Mast Camera (Mastcam)**. NASA/JPL-Caltech/Malin Space Science Systems. <https://science.nasa.gov/mission/msl-curiosity/science-instruments/>
  - What we use it for: Solar images from which the measured dust record (optical depth) over Gale was made.
  - Credit: NASA/JPL-Caltech/MSSS. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Malin, M. C., et al. (2017). The Mars Science Laboratory (MSL) Mast cameras and Descent imager: Investigation and instrument descriptions. Earth and Space Science, 4, 506-539.
  - Datasets: `optical_depth_history`
- **Curiosity Navcam atmospheric ice and dust bundle (NASA PDS Atmospheres Node)**. NASA Planetary Data System Atmospheres Node (New Mexico State University); data by J. Moores and E. Dong from NASA/JPL-Caltech Navcam images. <https://atmos.nmsu.edu/PDS/data/PDS4/msl_ice-dust/>
  - What we use it for: Haze near the ground across the crater (line-of-sight extinction), 2012-2022.
  - Credit: NASA/JPL-Caltech; Moores and Dong (2024), NASA PDS. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Moores, J., and Dong, E. (2024). Mars Science Laboratory Atmospheric Ice and Dust Bundle. NASA Planetary Data System. https://doi.org/10.17189/aytb-wq72
  - Datasets: `dust_extinction_navcam`
- **Curiosity Rover Radiation Assessment Detector (RAD)**. NASA/JPL-Caltech; instrument by Southwest Research Institute and the University of Kiel (with DLR). <https://science.nasa.gov/mission/msl-curiosity/science-instruments/>
  - What we use it for: Radiation dose measured on the ground at Gale.
  - Credit: NASA/JPL-Caltech/SwRI. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Peterson, J., et al. (2013). MSL Mars Radiation Assessment Detector RDR V1.0, MSL-M-RAD-3-RDR-V1.0, NASA Planetary Data System. Hassler, D. M., et al. (2014). Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover. Science, 343(6169), 1244797.
  - Datasets: `radiation_rad`
- **NASA Planetary Data System, Planetary Plasma Interactions (PPI) Node**. NASA Planetary Data System, University of California, Los Angeles. <https://pds-ppi.igpp.ucla.edu/>
  - What we use it for: Archive the RAD dose records were read from.
  - Credit: NASA PDS PPI Node. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `radiation_rad`
- **NASA DONKI space weather database (Community Coordinated Modeling Center)**. NASA Goddard Space Flight Center, Community Coordinated Modeling Center (CCMC). <https://ccmc.gsfc.nasa.gov/tools/DONKI/>
  - What we use it for: List of solar particle storms since 2012, to find when radiation at Gale could have jumped.
  - Credit: NASA CCMC. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `space_weather_donki`
- **NASA Planetary Data System Geosciences Node and Orbital Data Explorer (ODE)**. NASA Planetary Data System, Washington University in St. Louis. <https://ode.rsl.wustl.edu/mars/>
  - What we use it for: Archive the THEMIS temperature images and the Odyssey water table were downloaded from.
  - Credit: NASA PDS Geosciences Node. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `themis_temp_day_aphelion`, `themis_temp_day_perihelion`, `themis_temp_night_aphelion`, `themis_temp_night_perihelion`, `themis_temperature_list`, `water_odyssey_grs`
  - Datasets, Arcadia Planitia: `themis_temp_day_aphelion`, `themis_temp_night_aphelion`, `themis_temperature_list`, `water_odyssey_grs`
  - Datasets, Jezero crater: `themis_temp_night_aphelion`, `themis_temperature_list`, `water_odyssey_grs`
- **Mars24 Sunclock algorithm**. NASA Goddard Institute for Space Studies. <https://www.giss.nasa.gov/tools/mars24/help/algorithm.html>
  - What we use it for: Formulas for where the sun is in the Martian sky.
  - Credit: NASA GISS. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Allison, M., and McEwen, M. (2000). A post-Pathfinder evaluation of areocentric solar coordinates with improved timing recipes for Mars seasonal/diurnal climate studies. Planet. Space Sci., 48, 215-235.
  - Datasets: `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`
  - Datasets, Arcadia Planitia: `sun_table_arcadia_north`, `sun_table_arcadia_south`
  - Datasets, Jezero crater: `sun_table_jezero_north`, `sun_table_jezero_south`
- **Geologic Map of Mars (USGS SIM 3292)**. U.S. Geological Survey Astrogeology Science Center, for the NASA Planetary Geologic Mapping Program. <https://pubs.usgs.gov/sim/3292/>
  - What we use it for: Geologic units, contacts and structures.
  - Credit: Tanaka et al. 2014, USGS. Licence: U.S. Government work; public domain. Credit the authors.
  - Reference: Tanaka, K. L., et al. (2014). Geologic map of Mars. U.S. Geological Survey Scientific Investigations Map 3292.
  - Datasets: `geology_contacts`, `geology_structures`, `geology_units`
  - Datasets, Arcadia Planitia: `geology_contacts`, `geology_structures`, `geology_units`
  - Datasets, Jezero crater: `geology_contacts`, `geology_structures`, `geology_units`
- **USGS-NASA Planetary Geologic Mapping Program interactive Mars maps**. U.S. Geological Survey Astrogeology Science Center, for the NASA Planetary Geologic Mapping Program. <https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars>
  - What we use it for: Index of published and in-progress geologic maps.
  - Credit: USGS Astrogeology Science Center. Licence: U.S. Government work; public domain.
  - Datasets: `geology_map_index`
  - Datasets, Arcadia Planitia: `geology_map_index`
  - Datasets, Jezero crater: `geology_map_index`
- **HiRISE elevation model and orthophotos DTEEC_040770_1755_039280_1755 (USGS Astrogeology)**. U.S. Geological Survey Astrogeology Science Center and the HiRISE team, from NASA MRO HiRISE images; served as analysis-ready cloud-optimised GeoTIFFs. <https://www.uahirise.org/dtm/ESP_040770_1755>
  - What we use it for: Two orthophotos of the Bagnold Dunes on the same 1 m grid (2007 and 2015), used to measure moving sand.
  - Credit: NASA/JPL-Caltech/University of Arizona; USGS Astrogeology. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets: `dune_change_imagery`
- **HiRISE elevation model DTEEC_045994_1985_046060_1985_U01, Jezero crater (USGS Astrogeology)**. HiRISE team (University of Arizona) and the U.S. Geological Survey Astrogeology Science Center, from NASA MRO HiRISE stereo images; served as analysis-ready cloud-optimised GeoTIFFs. <https://www.uahirise.org/dtm/ESP_045994_1985>
  - What we use it for: 1 m elevation of the Jezero sites and trip area (Perseverance's landing area).
  - Credit: NASA/JPL-Caltech/University of Arizona; USGS Astrogeology. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets, Jezero crater: `elevation_1m_jezero_north`, `elevation_1m_jezero_south`, `elevation_2m_trip_area`, `horizon_jezero_north`, `horizon_jezero_south`, `roughness_1m_jezero_north`, `roughness_1m_jezero_south`, `slope_10m_window_jezero_north`, `slope_10m_window_jezero_south`, `slope_1m_jezero_north`, `slope_1m_jezero_south`, `slope_2m_trip_area`, `sun_table_jezero_north`, `sun_table_jezero_south`
- **CTX elevation model F05_037818_1977_XN_17N282W__F04_037330_2008_XN_20N282W, Jezero crater (USGS Astrogeology)**. U.S. Geological Survey Astrogeology Science Center (Ames Stereo Pipeline, tied to MOLA), from NASA MRO CTX stereo images. <https://doi.org/10.5066/P9JKVWR3>
  - What we use it for: 20 m elevation of the Jezero study area (most of the crater floor and the delta).
  - Credit: NASA/JPL-Caltech/MSSS; USGS Astrogeology. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Laura, J. R., Adoram-Kershner, L. A., Meyer, D. P., Wheeler, B. H., Bauck, K. H., and Fergason, R. L. (2023). Mars Reconnaissance Orbiter (MRO) Context Camera (CTX) orthoimage generated using Ames stereo pipeline derived digital terrain models. U.S. Geological Survey, doi:10.5066/P9JKVWR3.
  - Datasets, Jezero crater: `elevation_20m_study`, `horizon_jezero_north`, `horizon_jezero_south`, `slope_20m_study`, `sun_table_jezero_north`, `sun_table_jezero_south`
- **HiRISE elevation model DTEEC_035862_2195_035928_2195_A01, Arcadia Planitia (USGS Astrogeology)**. HiRISE team (University of Arizona) and the U.S. Geological Survey Astrogeology Science Center, from NASA MRO HiRISE stereo images; served as analysis-ready cloud-optimised GeoTIFFs. <https://www.uahirise.org/dtm/ESP_035862_2195>
  - What we use it for: 1 m elevation of the Arcadia Planitia sites and trip area.
  - Credit: NASA/JPL-Caltech/University of Arizona; USGS Astrogeology. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets, Arcadia Planitia: `elevation_1m_arcadia_north`, `elevation_1m_arcadia_south`, `elevation_2m_trip_area`, `horizon_arcadia_north`, `horizon_arcadia_south`, `roughness_1m_arcadia_north`, `roughness_1m_arcadia_south`, `slope_10m_window_arcadia_north`, `slope_10m_window_arcadia_south`, `slope_1m_arcadia_north`, `slope_1m_arcadia_south`, `slope_2m_trip_area`, `sun_table_arcadia_north`, `sun_table_arcadia_south`
- **CTX elevation model D22_035862_2182_XN_38N167W__D22_035928_2192_XN_39N167W, Arcadia Planitia (USGS Astrogeology)**. U.S. Geological Survey Astrogeology Science Center (Ames Stereo Pipeline, tied to MOLA), from NASA MRO CTX stereo images. <https://doi.org/10.5066/P9JKVWR3>
  - What we use it for: 20 m elevation of the Arcadia Planitia study area.
  - Credit: NASA/JPL-Caltech/MSSS; USGS Astrogeology. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Reference: Laura, J. R., Adoram-Kershner, L. A., Meyer, D. P., Wheeler, B. H., Bauck, K. H., and Fergason, R. L. (2023). Mars Reconnaissance Orbiter (MRO) Context Camera (CTX) orthoimage generated using Ames stereo pipeline derived digital terrain models. U.S. Geological Survey, doi:10.5066/P9JKVWR3.
  - Datasets, Arcadia Planitia: `elevation_20m_study`, `horizon_arcadia_north`, `horizon_arcadia_south`, `slope_20m_study`, `sun_table_arcadia_north`, `sun_table_arcadia_south`
- **Mars 2020 'Where is Perseverance?' map (MMGIS)**. NASA/JPL-Caltech. <https://mars.nasa.gov/maps/location/?mission=M20>
  - What we use it for: Perseverance's path, stops, current position and named places at Jezero.
  - Credit: NASA/JPL-Caltech. Licence: NASA data; generally not subject to US copyright. Credit as shown.
  - Datasets, Jezero crater: `map_config`, `named_sites`, `rover_path`, `rover_position`, `rover_stops`
- **Mars Global Digital Dune Database**. U.S. Geological Survey, NASA-funded; served by NASA Mars Trek. <https://pubs.usgs.gov/of/2007/1158/>
  - What we use it for: Outlines of dune fields (loose sand).
  - Credit: Hayward et al., USGS. Licence: U.S. Government work; public domain. Credit the authors.
  - Reference: Hayward, R. K., et al. (2007). Mars Global Digital Dune Database and initial science results. J. Geophys. Res., 112, E11007.
  - Datasets: `dune_fields`
  - Datasets, Arcadia Planitia: `dune_fields`
  - Datasets, Jezero crater: `dune_fields`

### Space Agency Partner data

- **ESA Mars Express OMEGA spectrometer**. European Space Agency (ESA); instrument by IAS and CNES, France. <https://www.esa.int/missions/about-us/directorates/science/mars-express>
  - What we use it for: Detections of water-bearing minerals, combined with CRISM in the Mars Trek layer.
  - Credit: ESA/IAS/CNES (OMEGA). Licence: ESA data; free for research and education. Credit ESA and the OMEGA team.
  - Reference: Bibring, J.-P., et al. (2004). OMEGA: Observatoire pour la Mineralogie, l'Eau, les Glaces et l'Activite. ESA SP-1240, 37-49.
  - Datasets: `minerals_detections`
  - Datasets, Arcadia Planitia: `minerals_detections`
  - Datasets, Jezero crater: `minerals_detections`
- **Mars Climate Database (MCD)**. Laboratoire de Meteorologie Dynamique (LMD, CNRS/Sorbonne Universite), with the University of Oxford and IAA Granada; developed with support from ESA and CNES. <https://www-mars.lmd.jussieu.fr/mcd_python/>
  - What we use it for: Typical temperatures, air pressure, dust and sunlight at the base for every hour and season, in typical, clear, dusty and dust-storm years (climate model).
  - Credit: Mars Climate Database (c) LMD/OU/IAA/ESA/CNES. Licence: Free for scientific use if the origin is quoted and the LMD team is kept informed.
  - Reference: Forget, F., et al. (1999). Improved general circulation models of the Martian atmosphere from the surface to above 80 km. J. Geophys. Res., 104(E10), 24155-24175. Millour, E., et al. (2018). The Mars Climate Database (version 5.3). From Mars Express to ExoMars Scientific Workshop, ESAC.
  - Datasets: `dust_climate_mcd`, `temperature_climate_mcd`
  - Datasets, Arcadia Planitia: `dust_climate_mcd`, `temperature_climate_mcd`
  - Datasets, Jezero crater: `dust_climate_mcd`, `temperature_climate_mcd`

### Other data, references and tools

- **THEMIS-derived thermal inertia map of Mars, 1 km browse version (Huang 2026)**. Jun Huang, China University of Geosciences; derived from NASA Mars Odyssey THEMIS images. <https://zenodo.org/records/23527756>
  - What we use it for: Numeric thermal inertia, our stand-in for how rocky the ground is.
  - Credit: Huang, J. (2026), from NASA/JPL-Caltech/ASU THEMIS data. Licence: CC BY 4.0
  - Reference: Huang, J. (2026). A new global thermal inertia map of Mars from THEMIS nighttime images: 1 km browse version [Data set]. Zenodo. https://doi.org/10.5281/zenodo.23527756
  - Datasets: `thermal_inertia_themis_1km`
  - Datasets, Arcadia Planitia: `thermal_inertia_themis_1km`
  - Datasets, Jezero crater: `thermal_inertia_themis_1km`
- **Mars Science Laboratory aerosol optical depths (Lemmon 2024, Mendeley Data)**. Mark Lemmon, Space Science Institute; measured from NASA Curiosity Mastcam solar images. <https://data.mendeley.com/datasets/tbh3pg39xc/3>
  - What we use it for: Measured dust and haze over Gale (optical depth at 880 and 440 nm), 2012-2023.
  - Credit: Lemmon, M. (2024), from NASA/JPL-Caltech/MSSS Mastcam images. Licence: CC BY 4.0
  - Reference: Lemmon, M. T., et al. (2024). The Mars Science Laboratory record of optical depth measurements via solar imaging. Icarus, 408, 115821. Data: Lemmon, M. (2024). Mars Science Laboratory aerosol optical depths. Mendeley Data, V3. https://doi.org/10.17632/tbh3pg39xc.3
  - Datasets: `optical_depth_history`
- **Computed by this project (martian_map)**. Our team, from the NASA data listed above. <https://github.com/jianhui-ben/space-apps-2026-martian-map>
  - What we use it for: Slope, roughness, skylines, sun tables, sand movement, coverage and the scenario assumptions.
  - Credit: martian_map team. Licence: MIT
  - Datasets: `dune_change_imagery`, `horizon_curiosity_recent`, `horizon_near_base_north`, `horizon_near_base_west`, `roughness_1m_curiosity_recent`, `roughness_1m_near_base_north`, `roughness_1m_near_base_west`, `scenario`, `slope_10m_study`, `slope_10m_window_curiosity_recent`, `slope_10m_window_near_base_north`, `slope_10m_window_near_base_west`, `slope_1m_curiosity_recent`, `slope_1m_near_base_north`, `slope_1m_near_base_west`, `slope_2m_trip_area`, `sun_table_curiosity_recent`, `sun_table_near_base_north`, `sun_table_near_base_west`
  - Datasets, Arcadia Planitia: `horizon_arcadia_north`, `horizon_arcadia_south`, `roughness_1m_arcadia_north`, `roughness_1m_arcadia_south`, `scenario`, `slope_10m_window_arcadia_north`, `slope_10m_window_arcadia_south`, `slope_1m_arcadia_north`, `slope_1m_arcadia_south`, `slope_20m_study`, `slope_2m_trip_area`, `sun_table_arcadia_north`, `sun_table_arcadia_south`
  - Datasets, Jezero crater: `horizon_jezero_north`, `horizon_jezero_south`, `roughness_1m_jezero_north`, `roughness_1m_jezero_south`, `scenario`, `slope_10m_window_jezero_north`, `slope_10m_window_jezero_south`, `slope_1m_jezero_north`, `slope_1m_jezero_south`, `slope_20m_study`, `slope_2m_trip_area`, `sun_table_jezero_north`, `sun_table_jezero_south`
<!-- references:end -->

### Other references (published results we compare with, not data we use)

- Silvestro, S., et al. (2013). Pervasive aeolian activity along rover Curiosity's traverse in Gale Crater,
  Mars. Geology, 41(4), 483-486. https://doi.org/10.1130/G34162.1 (Bagnold Dunes move about 0.4 m a year;
  compared with `dune_change_imagery`).
- NASA/JPL-Caltech (2016). PIA20284, Full-circle panorama beside Namib Dune on Mars.
  https://science.nasa.gov/photojournal/full-circle-panorama-beside-namib-dune-on-mars/ (dunes move up to
  about 1 m a year).
- Hassler, D. M., et al. (2014). Mars' surface radiation environment measured with the Mars Science
  Laboratory's Curiosity rover. Science, 343(6169), 1244797 (dose rate about 0.21 mGy a day; compared with
  `radiation_rad`).

### Software and tools

- **Python** (PSF License) with **NumPy** (BSD), **Requests** (Apache 2.0), **zstandard** (BSD) and
  **pytest** (MIT).
- Data formats read by our own code: NASA PDS3 labels and tables, Esri JSON, GeoTIFF, Mars Trek tiles.
- Map tile and layer conventions from NASA Mars Trek and JPL MMGIS (see above).

### Use of AI tools (draft: check the wording before submitting)

The form asks where AI tools were used, and the rules say code and data made with AI must say so in
their description and metadata.

- **Code and documentation:** the data-download pipeline in `src/martian_map/`, its tests and these docs
  were written with an AI coding assistant (Claude Code by Anthropic), working from the team's project
  plan and decisions. The team chose the challenge, the idea, the sites and the assumptions.
- **Data:** no data was generated by AI. Every number comes from the NASA and other sources above, or is
  computed from them by the code. The index records this: `this_project` in `references` carries an
  `ai_assistance` note, and the index's `_note` says the same.
- **Images:** the coloured map overlays are drawn by our code straight from the data; no AI image
  generator was used. If the demo uses any AI-generated image or video, it needs a visible watermark.

### Considered but not used

Sources we looked at and decided against (for example Curiosity's DAN neutron counts, the SWIM ice maps,
Perseverance photos) are listed with reasons in [data-sources.md](data-sources.md#not-used-and-why). They
are not data the project uses, so they don't belong in the submission lists.
