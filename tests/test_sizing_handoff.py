import json
from test_sizing_contracts import request
from martian_map.sizing import build_requirements

def test_all_metrics_have_demand_or_explicit_gap():
    out=build_requirements(request()); rows=out['location_requirements']
    assert len(rows)==72 and len({x['metric_id'] for x in rows})==72
    assert {x['category'] for x in rows}=={'terrain','ground','solar','thermal','routes'}
    assert all(x['assessment_status']=='not_assessed' for x in rows)
    assert all(x['criterion'] is not None or x['missing_inputs'] for x in rows)
    assert all(x['evidence_status']=='catalog_references_only' for x in rows)

def test_ground_and_thermal_remain_coupled():
    out=build_requirements(request())
    for row in out['location_requirements']:
        if row['metric_id'] in ('GI-07','TC-10'):assert row['dependencies']==['GI-07','TC-10']

def test_cli_writes_machine_readable_handoff(tmp_path):
    from martian_map.cli import main
    src=tmp_path/'in.json';dst=tmp_path/'out.json';src.write_text(json.dumps(request()))
    assert main(['size','--input',str(src),'--output',str(dst)])==0
    out=json.loads(dst.read_text());assert out['schema_version']=='facility-requirements/1'
