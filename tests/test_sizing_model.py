import copy
import json
import pytest
from test_sizing_contracts import request,q
from martian_map.sizing import build_requirements,load_bundle


def spec(result,key,case=0):
    return result['facility_options'][case]['specifications'][key]


def test_ingestion_is_count_times_active_hours_and_rate():
    result=build_requirements(request())
    assert spec(result,'retained_data_gb_per_sol')['value']==96
    assert result['model_bundle']['evidence_status']=='engineering_assumption'
    assert result['assumptions']
    json.dumps(result,allow_nan=False)


def test_storage_has_separate_retention_and_replication():
    r=request(); b=load_bundle();b['parameters']['product_fraction']['value']=0
    # 96 GB/sol * 30 sols * 2 copies, plus 2 sols working data; 25% headroom.
    expected=(96*30*2+96*2)*1.25/1000
    assert spec(build_requirements(r,b),'required_storage_tb')['value']==pytest.approx(expected)


def test_tighter_deadline_requires_more_parallel_workers():
    slow=request();slow['jobs'][0]['deadline']=q(8,'hour')
    fast=request();fast['jobs'][0]['deadline']=q(1,'hour')
    # Job is explicitly tiled under the screening profile; node-hour cost may be partitioned.
    a=build_requirements(slow);b=build_requirements(fast)
    assert spec(b,'workers')['value']>spec(a,'workers')['value']


def test_unknown_cannot_generate_fixed_facility():
    r=request();r['operations']['hours_per_sol']=q(None,'hour_per_sol')
    result=build_requirements(r)
    assert spec(result,'retained_data_gb_per_sol')['status']=='unresolved'
    assert spec(result,'facility_peak_kw')['status']=='unresolved'
    assert all(x['definition_status']!='specified' for x in result['location_requirements'] if x['metric_id']=='BT-02')


def test_evidence_only_does_not_use_assumed_robot_benchmarks():
    result=build_requirements(request(),evidence_only=True)
    assert spec(result,'workers')['status']=='unresolved'
    assert spec(result,'it_peak_kw')['status']=='unresolved'
    assert result['mode']=='evidence_only'


def test_more_work_cannot_reduce_demand():
    r=request();r['jobs'][0]['deadline']=q(2,'hour');a=build_requirements(r);r['fleet'][0]['count']=q(8,'count');r['fleet'][0]['active_count']=q(8,'count');b=build_requirements(r)
    for k in ['retained_data_gb_per_sol','required_storage_tb','workers','facility_peak_kw','core_area_m2']:
        assert spec(b,k)['value']>=spec(a,k)['value']


def test_range_produces_named_scenarios_not_a_fake_average():
    r=request();r['operations']['hours_per_sol']={'state':'range','min':8,'max':12,'unit':'hour_per_sol'}
    result=build_requirements(r)
    assert {s['id'] for s in result['scenarios']}=={'low_endpoint','high_endpoint'}
    assert {o['specifications']['retained_data_gb_per_sol']['value'] for o in result['facility_options']}=={64,96}


def test_request_and_bundle_are_not_mutated_and_hash_is_stable():
    r=request();b=load_bundle();rr=copy.deepcopy(r);bb=copy.deepcopy(b)
    a=build_requirements(r,b);c=build_requirements(r,b)
    assert a==c and r==rr and b==bb


def test_missing_benchmark_parameter_propagates():
    b=load_bundle();del b['parameters']['cost_terrain_map'];out=build_requirements(request(),b)
    assert spec(out,'workers')['status']=='unresolved'
    assert 'model:cost_terrain_map' in spec(out,'workers')['missing_inputs']


def test_memory_or_capacity_exhaustion_is_not_small_facility():
    b=load_bundle();b['parameters']['memory_terrain_map']['value']=1000
    result=build_requirements(request(),b)
    assert spec(result,'workers')['status']=='unresolved'
    assert any(x['code']=='no_supported_configuration' for x in result['input_issues'])


def test_ground_pressure_uses_loaded_modules_and_mars_gravity():
    result=build_requirements(request());o=result['facility_options'][0]
    assert spec(result,'required_allowable_bearing_kpa')['value']>0
    assert o['foundation_basis']['ground_strength_measured'] is False
    assert o['layout']['status']=='reference_layout'
    assert o['layout']['requires_site_refinement'] is True

def test_phase_end_keeps_input_until_processing_even_with_zero_retention():
    r=request();r['retention']['raw']=q(0,'sol');r['retention']['products']=q(0,'sol')
    r['jobs'][0].update(cadence='phase_end',deadline=q(8760,'hour'))
    out=build_requirements(r)
    assert spec(out,'required_storage_tb')['value'] >= 96*180/1000

def test_unknown_cadence_cannot_resolve_storage():
    r=request();r['jobs'][0]['cadence']='unknown'
    assert spec(build_requirements(r),'required_storage_tb')['status']=='unresolved'

def test_saturated_link_is_not_fixed_by_more_workers():
    r=request();r['fleet'][0]['count']=q(8,'count');r['fleet'][0]['active_count']=q(8,'count')
    assert spec(build_requirements(r),'workers')['status']=='unresolved'
