import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / 'web' / 'tools' / 'sizing_fixtures.py'
FIXTURE = REPO / 'web' / 'tests' / 'fixtures' / 'sizing.json'


def _tool():
    spec = importlib.util.spec_from_file_location('sizing_fixtures', TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_coefficients_copy_is_identical():
    py = REPO / 'src' / 'martian_map' / 'sizing' / 'resources' / 'screening-v1.json'
    assert (REPO / 'web' / 'sizing' / 'screening-v1.json').read_bytes() == py.read_bytes()


def test_fixtures_are_fresh():
    assert _tool().build() == FIXTURE.read_text()


def test_fixture_cases_present():
    names = {c['name'] for c in json.loads(FIXTURE.read_text())}
    assert names >= {'example_filled', 'example_default', 'hybrid', 'base_connection', 'base_too_small',
                     'precision_assembly', 'coarse_survey', 'inspection_phase_end', 'ranges',
                     'deadline_impossible', 'inspection_without_robots', 'inside_base'}


def test_example_filled_values():
    case = next(c for c in json.loads(FIXTURE.read_text()) if c['name'] == 'example_filled')
    spec = next(o for o in case['options'] if o['id'] == 'owner_case_dedicated')['specifications']
    assert spec['workers']['value'] == 11  # with the 100 Gbps site data backbone (was 13 at 1 Gbps)
    assert spec['modules']['value'] == 2
    assert round(spec['full_reference_plot_m2']['value'], 2) == 605.25
    assert round(spec['facility_peak_kw']['value'], 2) == 8.32
