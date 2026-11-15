"""Generate the Python reference fixtures that the browser sizing port is tested against.

Run from the repository root: PYTHONPATH=src python web/tools/sizing_fixtures.py
It writes web/tests/fixtures/sizing.json. tests/test_sizing_web_parity.py fails when that file is stale.
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))

from martian_map.sizing import build_requirements  # noqa: E402
from martian_map.sizing.validation import from_guided_brief, validate_request  # noqa: E402

OUT = ROOT / 'web' / 'tests' / 'fixtures' / 'sizing.json'


def default_brief():
    """The earlier tabbed brief's example, in the shape fromBrief reads, plus the backup and base-power quantities: the
    parity cases' starting point. (The app's intake, web/src/ui/brief.js toSizingBrief, builds the same shape.)"""
    return {
        'name': 'Gale landing pad & access road',
        'types': ['Landing pad', 'Road'],
        'other': '',
        'location': 'Gale study region — site not selected',
        'fleet': [
            {'id': 1, 'role': 'Survey', 'count': 4, 'active': 4},
            {'id': 2, 'role': 'Excavation', 'count': 10, 'active': 8},
            {'id': 3, 'role': 'Transport', 'count': 6, 'active': 4},
        ],
        'phase': 'Site preparation',
        'quality': 'Earthworks check',
        'jobs': {'map': True, 'progress': True, 'inspection': False, 'plan': True},
        'cadence': {'map': 'Once per sol', 'progress': 'Once per sol', 'inspection': 'At phase end', 'plan': 'Every 4 hours'},
        'late': 'Pause dependent work',
        'power': 'Unknown',
        'continuity': 'Unknown',
        'deployment': 'Compare both',
        'q': {
            'area': {'mode': 'unknown', 'value': 20000, 'min': 10000, 'max': 30000, 'unit': 'm²'},
            'road': {'mode': 'unknown', 'value': 1000, 'min': 500, 'max': 2000, 'unit': 'm'},
            'hours': {'mode': 'known', 'value': 12, 'min': 8, 'max': 12, 'unit': 'h / sol'},
            'deadline': {'mode': 'known', 'value': 1, 'min': 1, 'max': 4, 'unit': 'hours'},
            'duration': {'mode': 'unknown', 'value': 180, 'min': 90, 'max': 180, 'unit': 'sols'},
            'retention': {'mode': 'unknown', 'value': 30, 'min': 7, 'max': 30, 'unit': 'sols'},
            'backup': {'mode': 'unknown', 'value': 4, 'min': 2, 'max': 8, 'unit': 'hours'},
            'basePower': {'mode': 'unknown', 'value': 20, 'min': 10, 'max': 40, 'unit': 'kW'},
        },
    }


def _q(brief, key, unit):
    v = brief['q'].get(key, {})
    if v.get('mode') == 'known':
        return {'state': 'specified', 'value': v.get('value'), 'unit': unit}
    if v.get('mode') == 'range':
        return {'state': 'range', 'min': v.get('min'), 'max': v.get('max'), 'unit': unit}
    return {'state': 'unknown'}


def request_for(brief):
    request = from_guided_brief(brief)
    infra = request['infrastructure']
    infra['backup_duration'] = _q(brief, 'backup', 'hour')
    infra['available_base_power'] = (
        _q(brief, 'basePower', 'kW') if brief.get('power') in ('Base connection', 'Hybrid') else {'state': 'unknown'})
    request['retention']['products'] = copy.deepcopy(request['project']['duration'])
    return validate_request(request)


def _known(brief, key, value):
    brief['q'][key].update(mode='known', value=value)


def _cases():
    def make(**changes):
        b = default_brief()
        for k, v in changes.items():
            b[k] = v
        return b

    def filled(**changes):
        b = make(**{'power': 'Solar + storage', **changes})
        _known(b, 'duration', 180)
        _known(b, 'retention', 30)
        _known(b, 'backup', 4)
        return b

    cases = {}
    cases['example_filled'] = filled()
    cases['example_default'] = default_brief()
    b = filled(power='Hybrid')
    _known(b, 'basePower', 2)
    cases['hybrid'] = b
    b = filled(power='Base connection')
    _known(b, 'basePower', 20)
    cases['base_connection'] = b
    b = filled(power='Base connection')
    _known(b, 'basePower', 5)
    cases['base_too_small'] = b
    cases['precision_assembly'] = filled(quality='Precision assembly')
    cases['coarse_survey'] = filled(quality='Coarse survey')
    b = filled()
    b['jobs']['inspection'] = True
    b['cadence']['inspection'] = 'At phase end'
    b['fleet'].append({'id': 4, 'role': 'Inspection', 'count': 2, 'active': 2})
    cases['inspection_phase_end'] = b
    b = filled()
    b['q']['duration'].update(mode='range', min=90, max=180)
    b['q']['deadline'].update(mode='range', min=1, max=4)
    cases['ranges'] = b
    b = filled()
    _known(b, 'deadline', 0.01)
    cases['deadline_impossible'] = b
    b = filled()
    b['jobs']['inspection'] = True
    cases['inspection_without_robots'] = b
    cases['inside_base'] = filled(deployment='Inside the base')
    return cases


def build():
    data = []
    for name, brief in _cases().items():
        request = request_for(brief)
        result = build_requirements(request)
        options = [{'id': o['id'], 'scenario_id': o['scenario_id'], 'deployment': o['deployment'],
                    'specifications': o['specifications'], 'layout_status': o['layout']['status']}
                   for o in result['facility_options']]
        data.append({'name': name, 'brief': brief, 'request': request, 'options': options})
    return json.dumps(data, sort_keys=True, indent=1) + '\n'


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build())
    print('wrote', OUT.relative_to(ROOT))
