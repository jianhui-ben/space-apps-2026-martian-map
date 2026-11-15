import copy
import pytest
from martian_map.sizing import build_requirements, load_bundle, from_guided_brief
from martian_map.sizing.validation import RequestError, validate_request


def q(value, unit):
    return {'state':'unknown'} if value is None else {'state':'specified','value':value,'unit':unit}


def request():
    return {
        'schema_version':'construction-sizing/1', 'request_id':'test', 'project_revision':1,
        'project':{'id':'gale_build','name':'Landing pad','structure_types':['landing_pad'],
                   'duration':q(180,'sol'), 'survey_area':q(20000,'m2')},
        'fleet':[{'id':'survey','role':'survey','count':q(4,'count'),'active_count':q(4,'count')}],
        'operations':{'hours_per_sol':q(12,'hour_per_sol'),'precision':'earthworks_check'},
        'jobs':[{'id':'map','type':'terrain_map','cadence':'once_per_sol','deadline':q(1,'hour')}],
        'retention':{'raw':q(30,'sol'),'products':q(180,'sol')},
        'infrastructure':{'deployment':'dedicated','power_strategy':'solar_storage',
            'available_base_power':q(0,'kW'),'backup_duration':q(12,'hour')},
    }


def test_valid_request_and_no_mutation():
    r=request(); before=copy.deepcopy(r)
    validate_request(r)
    assert r==before


@pytest.mark.parametrize('value',[True,-1,1.5,float('nan'),float('inf')])
def test_invalid_robot_count(value):
    r=request();r['fleet'][0]['count']=q(value,'count')
    with pytest.raises(RequestError):validate_request(r)


def test_active_count_cannot_exceed_pool():
    r=request();r['fleet'][0]['active_count']=q(5,'count')
    with pytest.raises(RequestError,match='active'):validate_request(r)


def test_invalid_unit_and_unknown_property_rejected():
    r=request();r['operations']['hours_per_sol']=q(12,'day')
    with pytest.raises(RequestError):validate_request(r)
    r=request();r['phases']=[]
    with pytest.raises(RequestError):validate_request(r)


def test_unknown_and_range_are_not_zero():
    r=request();r['operations']['hours_per_sol']={'state':'range','min':8,'max':12,'unit':'hour_per_sol'}
    validate_request(r)
    r['fleet'][0]['count']=q(None,'count');validate_request(r)


def test_guided_import_preserves_unknown_fields():
    r=from_guided_brief({'name':'Gale','types':['Landing pad'],
      'fleet':[{'id':1,'role':'Survey','count':4,'active':3}],
      'q':{'hours':{'mode':'known','value':12},'deadline':{'mode':'range','min':1,'max':4},'duration':{'mode':'unknown'}},
      'jobs':{'map':True},'cadence':{'map':'Once per sol'},'power':'Unknown'})
    validate_request(r)
    assert r['fleet'][0]['active_count']['value']==3
    assert r['project']['duration']=={'state':'unknown'}
    assert r['jobs'][0]['deadline']['state']=='range'
    assert r['infrastructure']['power_strategy']=='unknown'


def test_bundle_is_explicit_about_assumptions():
    b=load_bundle()
    assert b['evidence_status']=='engineering_assumption'
    assert b['sources']
    assert all(p.get('source') for p in b['parameters'].values())
