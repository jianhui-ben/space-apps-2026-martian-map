"""Data-source steps for the snapshot, in the design's build order."""

from __future__ import annotations

from typing import List

from ..scenario import Scenario
from ..snapshot import Step
from .checks import alignment_step


def all_steps(scenario: Scenario) -> List[Step]:
    from . import (arcgis, climate, dunes, elevation, optical_depth, radiation, rover, solar, space_weather, static,
                   themis, thermal_inertia, water, weather)

    steps: List[Step] = [static.static_step]
    steps += [elevation.study_step, *elevation.site_steps(scenario), *elevation.trip_steps(scenario),
              elevation.region_step]
    steps += [arcgis.geology_step, arcgis.geology_index_step, arcgis.minerals_step, arcgis.dunes_step]
    steps += [rover.rover_step, weather.weather_step]
    steps += [alignment_step]
    steps += solar.solar_steps(scenario)
    steps += [themis.themis_list_step, themis.themis_samples_step]
    steps += [thermal_inertia.thermal_inertia_step, water.water_step]
    steps += [climate.climate_step, optical_depth.optical_depth_step, optical_depth.navcam_dust_step]
    steps += [dunes.dune_change_step, radiation.radiation_step, space_weather.space_weather_step]
    return steps


__all__ = ["alignment_step", "all_steps"]
