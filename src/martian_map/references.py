"""Where every dataset comes from: one record per mission, instrument, archive or tool.

Each catalog entry lists the reference ids it relies on (``entry["references"]``)
and the catalog carries the records it uses (``catalog.references``).
``references_markdown`` turns them into the lists the Space Apps submission form
asks for: NASA data and resources, Space Agency Partner data, and other
references. Every URL here was opened on 2026-11-14 (see
``tests/test_references.py::test_reference_urls_reachable``).
"""

from __future__ import annotations

from fnmatch import fnmatchcase
from typing import Any, Dict, List, Optional

GROUPS = {
    "nasa": "NASA data and resources",
    "partner": "Space Agency Partner data",
    "other": "Other data, references and tools",
}

_NASA_LICENSE = "NASA data; generally not subject to US copyright. Credit as shown."

REFERENCES: Dict[str, Dict[str, Any]] = {
    # --- NASA -----------------------------------------------------------------------------------------------------
    "mars_trek": dict(
        group="nasa", title="NASA Mars Trek (Solar System Treks)",
        provider="NASA Solar System Treks Project, NASA/JPL-Caltech",
        credit="NASA/JPL-Caltech, Solar System Treks Project", license=_NASA_LICENSE,
        url="https://trek.nasa.gov/mars/",
        role="Map service for HiRISE, CTX, THEMIS, TES, MOLA and Viking layers, the Gale 1 m elevation model, "
             "and the mineral and dune layers."),
    "mro_hirise": dict(
        group="nasa", title="Mars Reconnaissance Orbiter HiRISE camera",
        provider="NASA/JPL-Caltech/University of Arizona", credit="NASA/JPL-Caltech/University of Arizona",
        license=_NASA_LICENSE, url="https://www.uahirise.org/",
        citation="McEwen, A. S., et al. (2007). Mars Reconnaissance Orbiter's High Resolution Imaging Science "
                 "Experiment (HiRISE). J. Geophys. Res., 112, E05S02.",
        role="Sharpest photos and the 1 m elevation model of Gale."),
    "mro_ctx": dict(
        group="nasa", title="Mars Reconnaissance Orbiter Context Camera (CTX)",
        provider="NASA/JPL-Caltech/Malin Space Science Systems", credit="NASA/JPL-Caltech/MSSS",
        license=_NASA_LICENSE, url="https://www.msss.com/all_projects/mro-ctx.php",
        citation="Malin, M. C., et al. (2007). Context Camera Investigation on board the Mars Reconnaissance "
                 "Orbiter. J. Geophys. Res., 112, E05S04.",
        role="Photo map of the whole crater."),
    "mro_crism": dict(
        group="nasa", title="Mars Reconnaissance Orbiter CRISM spectrometer",
        provider="NASA/JPL-Caltech/Johns Hopkins University Applied Physics Laboratory",
        credit="NASA/JPL-Caltech/JHUAPL", license=_NASA_LICENSE,
        url="https://science.nasa.gov/mission/mars-reconnaissance-orbiter/",
        citation="Murchie, S., et al. (2007). Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) on Mars "
                 "Reconnaissance Orbiter (MRO). J. Geophys. Res., 112, E05S03.",
        role="Detections of water-bearing minerals."),
    "mgs_mola": dict(
        group="nasa", title="Mars Global Surveyor Mars Orbiter Laser Altimeter (MOLA)",
        provider="NASA Goddard Space Flight Center, MOLA Science Team", credit="NASA/GSFC MOLA Science Team",
        license=_NASA_LICENSE, url="https://pds-geosciences.wustl.edu/missions/mgs/mola.html",
        citation="Smith, D. E., et al. (2001). Mars Orbiter Laser Altimeter: Experiment summary after the first year "
                 "of global mapping of Mars. J. Geophys. Res., 106(E10), 23689-23722.",
        role="Regional (463 m) heights for the far skyline, and the shaded-relief layer."),
    "mgs_tes": dict(
        group="nasa", title="Mars Global Surveyor Thermal Emission Spectrometer (TES)",
        provider="NASA/JPL-Caltech/Arizona State University", credit="NASA/JPL-Caltech/Arizona State University",
        license=_NASA_LICENSE, url="https://pds-geosciences.wustl.edu/missions/mgs/tes.html",
        citation="Christensen, P. R., et al. (2001). Mars Global Surveyor Thermal Emission Spectrometer experiment: "
                 "Investigation description and surface science results. J. Geophys. Res., 106(E10), 23823-23871.",
        role="Global thermal inertia and surface dust pictures."),
    "ody_themis": dict(
        group="nasa", title="Mars Odyssey Thermal Emission Imaging System (THEMIS)",
        provider="NASA/JPL-Caltech/Arizona State University", credit="NASA/JPL-Caltech/Arizona State University",
        license="NASA PDS data; generally not subject to US copyright. Credit the THEMIS team.",
        url="https://themis.asu.edu/",
        citation="Christensen, P. R., et al. (2004). The Thermal Emission Imaging System (THEMIS) for the Mars 2001 "
                 "Odyssey Mission. Space Sci. Rev., 110, 85-130.",
        role="Surface temperature images and infrared pictures; the source of the 1 km thermal inertia map."),
    "ody_grs": dict(
        group="nasa", title="Mars Odyssey Gamma Ray Spectrometer (GRS)",
        provider="NASA/JPL-Caltech/University of Arizona (GRS team)",
        credit="NASA/JPL-Caltech/University of Arizona", license=_NASA_LICENSE,
        url="https://pds-geosciences.wustl.edu/missions/odyssey/grs_elements.html",
        citation="Boynton, W. V., et al. (2007). Concentration of H, Si, Cl, K, Fe, and Th in the low and mid "
                 "latitude regions of Mars. J. Geophys. Res. Planets. Data set ODY-M-GRS-5-ELEMENTS-V1.0, NASA PDS.",
        role="Water held in the top layer of the ground, 5 degree cells."),
    "viking": dict(
        group="nasa", title="Viking Orbiter images", provider="NASA/JPL-Caltech/USGS", credit="NASA/JPL-Caltech/USGS",
        license=_NASA_LICENSE, url="https://nssdc.gsfc.nasa.gov/planetary/viking.html",
        role="Global colour background map."),
    "msl_mmgis": dict(
        group="nasa", title="Mars Science Laboratory 'Where is Curiosity?' map (MMGIS)",
        provider="NASA/JPL-Caltech", credit="NASA/JPL-Caltech", license=_NASA_LICENSE,
        url="https://mars.nasa.gov/maps/location/?mission=Curiosity",
        role="Curiosity's path, stops, current position, named places and its photo map layers."),
    "msl_rems": dict(
        group="nasa", title="Curiosity Rover Environmental Monitoring Station (REMS)",
        provider="NASA/JPL-Caltech; instrument from Centro de Astrobiologia (CSIC-INTA), Spain",
        credit="NASA/JPL-Caltech/CAB (CSIC-INTA)", license=_NASA_LICENSE,
        url="https://science.nasa.gov/mission/msl-curiosity/science-instruments/",
        citation="Gomez-Elvira, J., et al. (2012). REMS: The Environmental Sensor Suite for the Mars Science "
                 "Laboratory Rover. Space Sci. Rev., 170, 583-640.",
        role="Curiosity's daily weather on the ground."),
    "msl_mastcam": dict(
        group="nasa", title="Curiosity Rover Mast Camera (Mastcam)",
        provider="NASA/JPL-Caltech/Malin Space Science Systems", credit="NASA/JPL-Caltech/MSSS",
        license=_NASA_LICENSE, url="https://science.nasa.gov/mission/msl-curiosity/science-instruments/",
        citation="Malin, M. C., et al. (2017). The Mars Science Laboratory (MSL) Mast cameras and Descent imager: "
                 "Investigation and instrument descriptions. Earth and Space Science, 4, 506-539.",
        role="Solar images from which the measured dust record (optical depth) over Gale was made."),
    "msl_navcam_dust": dict(
        group="nasa", title="Curiosity Navcam atmospheric ice and dust bundle (NASA PDS Atmospheres Node)",
        provider="NASA Planetary Data System Atmospheres Node (New Mexico State University); data by J. Moores and "
                 "E. Dong from NASA/JPL-Caltech Navcam images",
        credit="NASA/JPL-Caltech; Moores and Dong (2024), NASA PDS", license=_NASA_LICENSE,
        url="https://atmos.nmsu.edu/PDS/data/PDS4/msl_ice-dust/",
        citation="Moores, J., and Dong, E. (2024). Mars Science Laboratory Atmospheric Ice and Dust Bundle. NASA "
                 "Planetary Data System. https://doi.org/10.17189/aytb-wq72",
        role="Haze near the ground across the crater (line-of-sight extinction), 2012-2022."),
    "msl_rad": dict(
        group="nasa", title="Curiosity Rover Radiation Assessment Detector (RAD)",
        provider="NASA/JPL-Caltech; instrument by Southwest Research Institute and the University of Kiel (with DLR)",
        credit="NASA/JPL-Caltech/SwRI", license=_NASA_LICENSE,
        url="https://science.nasa.gov/mission/msl-curiosity/science-instruments/",
        citation="Peterson, J., et al. (2013). MSL Mars Radiation Assessment Detector RDR V1.0, MSL-M-RAD-3-RDR-V1.0, "
                 "NASA Planetary Data System. Hassler, D. M., et al. (2014). Mars' surface radiation environment "
                 "measured with the Mars Science Laboratory's Curiosity rover. Science, 343(6169), 1244797.",
        role="Radiation dose measured on the ground at Gale."),
    "pds_ppi": dict(
        group="nasa", title="NASA Planetary Data System, Planetary Plasma Interactions (PPI) Node",
        provider="NASA Planetary Data System, University of California, Los Angeles", credit="NASA PDS PPI Node",
        license=_NASA_LICENSE, url="https://pds-ppi.igpp.ucla.edu/",
        role="Archive the RAD dose records were read from."),
    "ccmc_donki": dict(
        group="nasa", title="NASA DONKI space weather database (Community Coordinated Modeling Center)",
        provider="NASA Goddard Space Flight Center, Community Coordinated Modeling Center (CCMC)",
        credit="NASA CCMC", license=_NASA_LICENSE, url="https://ccmc.gsfc.nasa.gov/tools/DONKI/",
        role="List of solar particle storms since 2012, to find when radiation at Gale could have jumped."),
    "pds_geosciences": dict(
        group="nasa", title="NASA Planetary Data System Geosciences Node and Orbital Data Explorer (ODE)",
        provider="NASA Planetary Data System, Washington University in St. Louis",
        credit="NASA PDS Geosciences Node", license=_NASA_LICENSE, url="https://ode.rsl.wustl.edu/mars/",
        role="Archive the THEMIS temperature images and the Odyssey water table were downloaded from."),
    "mars24": dict(
        group="nasa", title="Mars24 Sunclock algorithm",
        provider="NASA Goddard Institute for Space Studies", credit="NASA GISS", license=_NASA_LICENSE,
        url="https://www.giss.nasa.gov/tools/mars24/help/algorithm.html",
        citation="Allison, M., and McEwen, M. (2000). A post-Pathfinder evaluation of areocentric solar coordinates "
                 "with improved timing recipes for Mars seasonal/diurnal climate studies. Planet. Space Sci., 48, "
                 "215-235.",
        role="Formulas for where the sun is in the Martian sky."),
    "usgs_pgm_geology": dict(
        group="nasa", title="Geologic Map of Mars (USGS SIM 3292)",
        provider="U.S. Geological Survey Astrogeology Science Center, for the NASA Planetary Geologic Mapping Program",
        credit="Tanaka et al. 2014, USGS", license="U.S. Government work; public domain. Credit the authors.",
        url="https://pubs.usgs.gov/sim/3292/",
        citation="Tanaka, K. L., et al. (2014). Geologic map of Mars. U.S. Geological Survey Scientific "
                 "Investigations Map 3292.",
        role="Geologic units, contacts and structures."),
    "usgs_pgm_index": dict(
        group="nasa", title="USGS-NASA Planetary Geologic Mapping Program interactive Mars maps",
        provider="U.S. Geological Survey Astrogeology Science Center, for the NASA Planetary Geologic Mapping Program",
        credit="USGS Astrogeology Science Center", license="U.S. Government work; public domain.",
        url="https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars",
        role="Index of published and in-progress geologic maps."),
    "usgs_hirise_dtm": dict(
        group="nasa", title="HiRISE elevation model and orthophotos DTEEC_040770_1755_039280_1755 (USGS Astrogeology)",
        provider="U.S. Geological Survey Astrogeology Science Center and the HiRISE team, from NASA MRO HiRISE images; "
                 "served as analysis-ready cloud-optimised GeoTIFFs",
        credit="NASA/JPL-Caltech/University of Arizona; USGS Astrogeology", license=_NASA_LICENSE,
        url="https://www.uahirise.org/dtm/ESP_040770_1755",
        role="Two orthophotos of the Bagnold Dunes on the same 1 m grid (2007 and 2015), used to measure moving sand."),
    "usgs_hirise_dtm_jezero": dict(
        group="nasa", title="HiRISE elevation model DTEEC_045994_1985_046060_1985_U01, Jezero crater (USGS Astrogeology)",
        provider="HiRISE team (University of Arizona) and the U.S. Geological Survey Astrogeology Science Center, from "
                 "NASA MRO HiRISE stereo images; served as analysis-ready cloud-optimised GeoTIFFs",
        credit="NASA/JPL-Caltech/University of Arizona; USGS Astrogeology", license=_NASA_LICENSE,
        url="https://www.uahirise.org/dtm/ESP_045994_1985",
        role="1 m elevation of the Jezero sites and trip area (Perseverance's landing area)."),
    "usgs_ctx_dtm_jezero": dict(
        group="nasa", title="CTX elevation model F05_037818_1977_XN_17N282W__F04_037330_2008_XN_20N282W, Jezero crater "
                            "(USGS Astrogeology)",
        provider="U.S. Geological Survey Astrogeology Science Center (Ames Stereo Pipeline, tied to MOLA), from NASA MRO "
                 "CTX stereo images", credit="NASA/JPL-Caltech/MSSS; USGS Astrogeology", license=_NASA_LICENSE,
        url="https://doi.org/10.5066/P9JKVWR3",
        citation="Laura, J. R., Adoram-Kershner, L. A., Meyer, D. P., Wheeler, B. H., Bauck, K. H., and Fergason, R. L. "
                 "(2023). Mars Reconnaissance Orbiter (MRO) Context Camera (CTX) orthoimage generated using Ames "
                 "stereo pipeline derived digital terrain models. U.S. Geological Survey, doi:10.5066/P9JKVWR3.",
        role="20 m elevation of the Jezero study area (most of the crater floor and the delta)."),
    "usgs_hirise_dtm_arcadia": dict(
        group="nasa", title="HiRISE elevation model DTEEC_035862_2195_035928_2195_A01, Arcadia Planitia "
                            "(USGS Astrogeology)",
        provider="HiRISE team (University of Arizona) and the U.S. Geological Survey Astrogeology Science Center, from "
                 "NASA MRO HiRISE stereo images; served as analysis-ready cloud-optimised GeoTIFFs",
        credit="NASA/JPL-Caltech/University of Arizona; USGS Astrogeology", license=_NASA_LICENSE,
        url="https://www.uahirise.org/dtm/ESP_035862_2195",
        role="1 m elevation of the Arcadia Planitia sites and trip area."),
    "usgs_ctx_dtm_arcadia": dict(
        group="nasa", title="CTX elevation model D22_035862_2182_XN_38N167W__D22_035928_2192_XN_39N167W, Arcadia "
                            "Planitia (USGS Astrogeology)",
        provider="U.S. Geological Survey Astrogeology Science Center (Ames Stereo Pipeline, tied to MOLA), from NASA MRO "
                 "CTX stereo images", credit="NASA/JPL-Caltech/MSSS; USGS Astrogeology", license=_NASA_LICENSE,
        url="https://doi.org/10.5066/P9JKVWR3",
        citation="Laura, J. R., Adoram-Kershner, L. A., Meyer, D. P., Wheeler, B. H., Bauck, K. H., and Fergason, R. L. "
                 "(2023). Mars Reconnaissance Orbiter (MRO) Context Camera (CTX) orthoimage generated using Ames "
                 "stereo pipeline derived digital terrain models. U.S. Geological Survey, doi:10.5066/P9JKVWR3.",
        role="20 m elevation of the Arcadia Planitia study area."),
    "m20_mmgis": dict(
        group="nasa", title="Mars 2020 'Where is Perseverance?' map (MMGIS)",
        provider="NASA/JPL-Caltech", credit="NASA/JPL-Caltech", license=_NASA_LICENSE,
        url="https://mars.nasa.gov/maps/location/?mission=M20",
        role="Perseverance's path, stops, current position and named places at Jezero."),
    "mgd3": dict(
        group="nasa", title="Mars Global Digital Dune Database",
        provider="U.S. Geological Survey, NASA-funded; served by NASA Mars Trek", credit="Hayward et al., USGS",
        license="U.S. Government work; public domain. Credit the authors.", url="https://pubs.usgs.gov/of/2007/1158/",
        citation="Hayward, R. K., et al. (2007). Mars Global Digital Dune Database and initial science results. "
                 "J. Geophys. Res., 112, E11007.",
        role="Outlines of dune fields (loose sand)."),
    # --- Space Agency Partners ------------------------------------------------------------------------------------
    "mex_omega": dict(
        group="partner", title="ESA Mars Express OMEGA spectrometer",
        provider="European Space Agency (ESA); instrument by IAS and CNES, France", credit="ESA/IAS/CNES (OMEGA)",
        license="ESA data; free for research and education. Credit ESA and the OMEGA team.",
        url="https://www.esa.int/missions/about-us/directorates/science/mars-express",
        citation="Bibring, J.-P., et al. (2004). OMEGA: Observatoire pour la Mineralogie, l'Eau, les Glaces et "
                 "l'Activite. ESA SP-1240, 37-49.",
        role="Detections of water-bearing minerals, combined with CRISM in the Mars Trek layer."),
    "mcd": dict(
        group="partner", title="Mars Climate Database (MCD)",
        provider="Laboratoire de Meteorologie Dynamique (LMD, CNRS/Sorbonne Universite), with the University of "
                 "Oxford and IAA Granada; developed with support from ESA and CNES",
        credit="Mars Climate Database (c) LMD/OU/IAA/ESA/CNES",
        license="Free for scientific use if the origin is quoted and the LMD team is kept informed.",
        url="https://www-mars.lmd.jussieu.fr/mcd_python/",
        citation="Forget, F., et al. (1999). Improved general circulation models of the Martian atmosphere from "
                 "the surface to above 80 km. J. Geophys. Res., 104(E10), 24155-24175. Millour, E., et al. (2018). "
                 "The Mars Climate Database (version 5.3). From Mars Express to ExoMars Scientific Workshop, ESAC.",
        role="Typical temperatures, air pressure, dust and sunlight at the base for every hour and season, in "
             "typical, clear, dusty and dust-storm years (climate model)."),
    # --- Other ----------------------------------------------------------------------------------------------------
    "huang_ti_2026": dict(
        group="other", title="THEMIS-derived thermal inertia map of Mars, 1 km browse version (Huang 2026)",
        provider="Jun Huang, China University of Geosciences; derived from NASA Mars Odyssey THEMIS images",
        credit="Huang, J. (2026), from NASA/JPL-Caltech/ASU THEMIS data", license="CC BY 4.0",
        url="https://zenodo.org/records/23527756",
        citation="Huang, J. (2026). A new global thermal inertia map of Mars from THEMIS nighttime images: 1 km "
                 "browse version [Data set]. Zenodo. https://doi.org/10.5281/zenodo.23527756",
        role="Numeric thermal inertia, our stand-in for how rocky the ground is."),
    "lemmon_tau_2024": dict(
        group="other", title="Mars Science Laboratory aerosol optical depths (Lemmon 2024, Mendeley Data)",
        provider="Mark Lemmon, Space Science Institute; measured from NASA Curiosity Mastcam solar images",
        credit="Lemmon, M. (2024), from NASA/JPL-Caltech/MSSS Mastcam images", license="CC BY 4.0",
        url="https://data.mendeley.com/datasets/tbh3pg39xc/3",
        citation="Lemmon, M. T., et al. (2024). The Mars Science Laboratory record of optical depth measurements via "
                 "solar imaging. Icarus, 408, 115821. Data: Lemmon, M. (2024). Mars Science Laboratory aerosol "
                 "optical depths. Mendeley Data, V3. https://doi.org/10.17632/tbh3pg39xc.3",
        role="Measured dust and haze over Gale (optical depth at 880 and 440 nm), 2012-2023."),
    "this_project": dict(
        group="other", title="Computed by this project (martian_map)",
        provider="Our team, from the NASA data listed above", credit="martian_map team", license="MIT",
        url="https://github.com/jianhui-ben/space-apps-2026-martian-map",
        ai_assistance="The code that downloads and computes these datasets was written with an AI coding "
                      "assistant (Claude Code by Anthropic). No data values were generated by AI.",
        role="Slope, roughness, skylines, sun tables, sand movement, coverage and the scenario assumptions."),
}

# First matching pattern wins. Site datasets end in the site id, hence the wildcards.
DATASET_REFERENCES: List[tuple] = [
    ("imagery_hirise_color", ["mro_hirise", "msl_mmgis"]),
    ("imagery_hirise_gray", ["mro_hirise", "mars_trek"]),
    ("imagery_ctx", ["mro_ctx", "mars_trek"]),
    ("imagery_ctx_mmgis", ["mro_ctx", "msl_mmgis"]),
    ("imagery_viking", ["viking", "mars_trek"]),
    ("thermal_day", ["ody_themis", "mars_trek"]),
    ("thermal_night", ["ody_themis", "mars_trek"]),
    ("thermal_inertia_tes", ["mgs_tes", "mars_trek"]),
    ("surface_dust_tes", ["mgs_tes", "mars_trek"]),
    ("relief_mola", ["mgs_mola", "mars_trek"]),
    ("labels", ["msl_mmgis"]),
    ("elevation_point_service", ["mro_hirise", "mars_trek"]),
    ("elevation_463m_region", ["mgs_mola", "mars_trek"]),
    ("elevation_*", ["mro_hirise", "mars_trek"]),
    ("slope_*", ["mro_hirise", "mars_trek", "this_project"]),
    ("roughness_*", ["mro_hirise", "mars_trek", "this_project"]),
    ("horizon_*", ["mro_hirise", "mgs_mola", "mars_trek", "this_project"]),
    ("sun_table_*", ["mars24", "mro_hirise", "mgs_mola", "mars_trek", "this_project"]),
    ("geology_map_index", ["usgs_pgm_index"]),
    ("geology_*", ["usgs_pgm_geology"]),
    ("minerals_detections", ["mro_crism", "mex_omega", "mars_trek"]),
    ("dune_fields", ["mgd3", "mars_trek"]),
    ("rover_*", ["msl_mmgis"]),
    ("named_sites", ["msl_mmgis"]),
    ("map_config", ["msl_mmgis"]),
    ("weather_rems", ["msl_rems"]),
    ("themis_*", ["ody_themis", "pds_geosciences"]),
    ("thermal_inertia_themis_1km", ["huang_ti_2026", "ody_themis"]),
    ("water_odyssey_grs", ["ody_grs", "pds_geosciences"]),
    ("*_climate_mcd", ["mcd"]),
    ("optical_depth_history", ["lemmon_tau_2024", "msl_mastcam"]),
    ("dune_change_imagery", ["mro_hirise", "usgs_hirise_dtm", "this_project"]),
    ("radiation_rad", ["msl_rad", "pds_ppi"]),
    ("space_weather_donki", ["ccmc_donki"]),
    ("dust_extinction_navcam", ["msl_navcam_dust"]),
    ("scenario", ["this_project"]),
]


def _region_references(fine: str, study: str, rover: Optional[str]) -> List[tuple]:
    rover_refs = ([("rover_*", [rover]), ("named_sites", [rover]), ("map_config", [rover])] if rover
                  else [("rover_*", [])])  # no rover: never fall back to Curiosity's map
    return rover_refs + [
        ("elevation_463m_region", ["mgs_mola", "mars_trek"]),
        ("elevation_*m_study", [study]),
        ("slope_*m_study", [study, "this_project"]),
        ("elevation_*", [fine]),
        ("slope_*", [fine, "this_project"]),
        ("roughness_*", [fine, "this_project"]),
        ("horizon_*", [fine, study, "mgs_mola", "mars_trek", "this_project"]),
        ("sun_table_*", ["mars24", fine, study, "mgs_mola", "mars_trek", "this_project"]),
    ]


# Regions other than Gale: their own elevation models and rover; checked before DATASET_REFERENCES.
REGION_REFERENCES: Dict[str, List[tuple]] = {
    "jezero": _region_references("usgs_hirise_dtm_jezero", "usgs_ctx_dtm_jezero", "m20_mmgis"),
    "arcadia": _region_references("usgs_hirise_dtm_arcadia", "usgs_ctx_dtm_arcadia", None),
}


def references_for(dataset_id: str, region: str = "gale") -> List[str]:
    """Reference ids for a dataset id in a region, or [] if none is recorded."""
    for pattern, refs in REGION_REFERENCES.get(region, []) + DATASET_REFERENCES:
        if fnmatchcase(dataset_id, pattern):
            return list(refs)
    return []


def _cell(text: Any) -> str:
    return str(text).replace("\n", " ").strip()


def references_markdown(catalog: Any) -> str:
    """Lists for the submission form, from the datasets the app uses (local or live) and their references."""
    from .catalog import region_name, region_order

    used: Dict[str, Dict[str, List[str]]] = {}  # reference -> region -> dataset names
    for e in sorted(catalog.entries, key=lambda x: x["id"]):
        if e.get("access") not in ("local", "live"):
            continue
        region = e.get("region", "gale")
        name = e["id"] if region == "gale" else e.get("dataset", e["id"])
        for rid in e.get("references") or references_for(e.get("dataset", e["id"]), region):
            used.setdefault(rid, {}).setdefault(region, []).append(name)
    order = region_order(catalog)
    lines: List[str] = []
    for group, heading in GROUPS.items():
        lines.append(f"### {heading}")
        lines.append("")
        rids = [r for r in REFERENCES if r in used and REFERENCES[r]["group"] == group]
        if not rids:
            lines.append("None.")
        for rid in rids:
            r = REFERENCES[rid]
            lines.append(f"- **{_cell(r['title'])}**. {_cell(r['provider'])}. <{r['url']}>")
            lines.append(f"  - What we use it for: {_cell(r['role'])}")
            lines.append(f"  - Credit: {_cell(r['credit'])}. Licence: {_cell(r['license'])}")
            if r.get("citation"):
                lines.append(f"  - Reference: {_cell(r['citation'])}")
            for region in sorted(used[rid], key=lambda g: order.get(g, 99)):
                ids = ", ".join(f"`{d}`" for d in used[rid][region])
                label = "Datasets" if region == "gale" else f"Datasets, {region_name(catalog, region)}"
                lines.append(f"  - {label}: {ids}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


__all__ = ["DATASET_REFERENCES", "GROUPS", "REFERENCES", "references_for", "references_markdown"]
