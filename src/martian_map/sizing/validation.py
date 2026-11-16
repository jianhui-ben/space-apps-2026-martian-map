"""Strict versioned requests, known/range/unknown quantities, UI conversion."""
import copy
import json
import math
from pathlib import Path
from jsonschema import Draft202012Validator

RESOURCES = Path(__file__).with_name('resources')

class RequestError(ValueError):
    def __init__(self, issues):
        self.issues = issues
        super().__init__('; '.join(f"{i['path']}: {i['message']}" for i in issues))

def validate_request(request):
    schema = json.loads((RESOURCES / 'request.schema.json').read_text())
    issues = []
    def issue(path, text):
        issues.append({'path':path, 'code':'invalid_input', 'message':text})
    def finite(value, path=''):
        if isinstance(value, float) and not math.isfinite(value): issue(path, 'must be finite')
        elif isinstance(value, dict):
            for k,v in value.items(): finite(v,path+'/'+k)
        elif isinstance(value, list):
            for i,v in enumerate(value): finite(v,path+'/'+str(i))
    finite(request)
    for error in Draft202012Validator(schema).iter_errors(request):
        issue('/'+'/'.join(map(str,error.absolute_path)),error.message)
    if issues: raise RequestError(issues)
    def check_q(q, path):
        if q['state']=='range' and q['min']>q['max']: issue(path,'minimum exceeds maximum')
    def walk(value,path=''):
        if isinstance(value,dict):
            if 'state' in value: check_q(value,path)
            for k,v in value.items(): walk(v,path+'/'+k)
        elif isinstance(value,list):
            for i,v in enumerate(value):walk(v,path+'/'+str(i))
    walk(request)
    seen=set()
    for i,f in enumerate(request['fleet']):
        if f['id'] in seen:issue('/fleet/'+str(i)+'/id','duplicate fleet id')
        seen.add(f['id'])
        if f['count']['state']=='specified' and f['active_count']['state']=='specified' and f['active_count']['value']>f['count']['value']:
            issue('/fleet/'+str(i)+'/active_count','active count exceeds fleet total')
    seen=set();types=set()
    for i,j in enumerate(request['jobs']):
        if j['id'] in seen:issue('/jobs/'+str(i)+'/id','duplicate job id')
        seen.add(j['id'])
        if j['type'] in types:issue('/jobs/'+str(i)+'/type','duplicate project-shared job type; v1 uses one schedule per output')
        types.add(j['type'])
        if j['cadence']=='every_n_operating_hours' and 'interval' not in j:issue('/jobs/'+str(i)+'/interval','interval required for recurring jobs')
        if j['cadence']!='every_n_operating_hours' and 'interval' in j:issue('/jobs/'+str(i)+'/interval','interval only applies to recurring jobs')
    if issues:raise RequestError(issues)
    return copy.deepcopy(request)


def from_guided_brief(state):
    """Import the selected mock's private state. Unknowns are not inferred."""
    if not isinstance(state,dict): raise RequestError([{'path':'','code':'invalid_input','message':'guided state must be an object'}])
    def q(key,unit):
        v=state.get('q',{}).get(key,{})
        if v.get('mode')=='known':return {'state':'specified','value':v.get('value'),'unit':unit}
        if v.get('mode')=='range':return {'state':'range','min':v.get('min'),'max':v.get('max'),'unit':unit}
        return {'state':'unknown'}
    def count(v):return {'state':'unknown'} if v is None else {'state':'specified','value':v,'unit':'count'}
    types={'Landing pad':'landing_pad','Road':'road','Habitat':'habitat','Power installation':'power_installation','Utility network':'utility_network','Other':'other'}
    outputs={'map':'terrain_map','progress':'progress_comparison','inspection':'inspection_analysis','plan':'fleet_plan'}
    jobs=[]
    for key,enabled in state.get('jobs',{}).items():
        if not enabled:continue
        if key not in outputs: raise RequestError([{'path':'/jobs/'+key,'code':'invalid_input','message':'unsupported guided output'}])
        cadence=state.get('cadence',{}).get(key,'Unknown')
        j={'id':key,'type':outputs[key],'cadence':{'Once per sol':'once_per_sol','Every 4 hours':'every_n_operating_hours','At phase end':'phase_end','Unknown':'unknown'}.get(cadence,'unknown'),'deadline':q('deadline','hour')}
        if cadence=='Every 4 hours':j['interval']={'state':'specified','value':4,'unit':'hour'}
        jobs.append(j)
    result={'schema_version':'construction-sizing/1','request_id':'guided-brief','project_revision':1,
      'project':{'id':'guided_project','name':state.get('name',''),'structure_types':[types.get(t,t) for t in state.get('types',[])], 'duration':q('duration','sol'),'survey_area':q('area','m2')},
      'fleet':[{'id':str(f.get('id',i)),'role':str(f.get('role','unknown')).lower(),'count':count(f.get('count')),'active_count':count(f.get('active'))} for i,f in enumerate(state.get('fleet',[]))],
      'operations':{'hours_per_sol':q('hours','hour_per_sol'),'precision':{'Coarse survey':'coarse_survey','Earthworks check':'earthworks_check','Precision assembly':'precision_assembly'}.get(state.get('quality'),'unknown')},
      'jobs':jobs,'retention':{'raw':q('retention','sol'),'products':{'state':'unknown'}},
      'infrastructure':{'deployment':{'Inside the base':'base_integrated','Dedicated installation':'dedicated'}.get(state.get('deployment'),'compare_both'),'power_strategy':{'Base connection':'base_connection','Solar + storage':'solar_storage','Hybrid':'hybrid'}.get(state.get('power'),'unknown'),'available_base_power':{'state':'unknown'},'backup_duration':{'state':'unknown'}}}
    if 'Road' in state.get('types',[]):result['project']['road_length']=q('road','m')
    return validate_request(result)


INTAKE_CADENCE={'Once per sol':'once_per_sol','Every 4 hours':'every_n_operating_hours','At phase end':'phase_end'}
INTAKE_PRECISION={'Coarse survey':'coarse_survey','Earthworks check':'earthworks_check','Precision assembly':'precision_assembly'}
INTAKE_POWER={'Solar + storage':'solar_storage','Hybrid':'hybrid','Base connection':'base_connection'}


def from_intake(state):
    """The construction intake's form state (web/src/ui/intake.js) as a sizing request.

    Mirrors the Twin Trails mockup's profile: robot counts from the total and the shares (rounded down; transport takes
    the remainder; survey-only work is an all-survey fleet), active counts from the active shares, a terrain map always
    and progress comparison plus fleet plan for earthworks, one processing cadence and turnaround for every output."""
    if not isinstance(state,dict):raise RequestError([{'path':'','code':'invalid_input','message':'intake state must be an object'}])
    issues=[]
    def number(key,minimum=0,integer=False):
        v=state.get(key)
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<minimum or (integer and int(v)!=v):
            issues.append({'path':'/'+key,'code':'invalid_input','message':f'{key} must be a{"n integer" if integer else " number"} ≥ {minimum}'});return 0
        return v
    survey_only=state.get('workType')=='survey'
    if state.get('workType') not in ('earthworks','survey'):issues.append({'path':'/workType','code':'invalid_input','message':'unsupported type of work'})
    n=number('robots',1,True);hours=number('hours',0.1);duration=number('duration',0.1);deadline=number('deadline',0.01)
    sp=number('surveyPercent');ep=number('excPercent');sa=number('surveyActive');oa=number('otherActive')
    raw=number('rawRetention');prod=number('productRetention');backup=number('backup');base=number('basePower')
    for key,v in (('surveyPercent',sp),('excPercent',ep),('surveyActive',sa),('otherActive',oa)):
        if v>100:issues.append({'path':'/'+key,'code':'invalid_input','message':f'{key} must be at most 100'})
    if not survey_only and sp+ep>100:issues.append({'path':'/surveyPercent','code':'invalid_input','message':'Survey and excavation shares must add up to 100% or less.'})
    for key,table in (('cadence',INTAKE_CADENCE),('precision',INTAKE_PRECISION),('power',INTAKE_POWER)):
        if state.get(key) not in table:issues.append({'path':'/'+key,'code':'invalid_input','message':f'unsupported {key}'})
    if issues:raise RequestError(issues)
    n=int(n);survey=n if survey_only else math.floor(n*sp/100);exc=0 if survey_only else math.floor(n*ep/100);transport=n-survey-exc
    if math.floor(survey*sa/100)<1:raise RequestError([{'path':'/robots','code':'invalid_input','message':'The terrain map needs at least one active survey robot: raise the robot count, the survey share or the survey robots active together.'}])
    spec=lambda v,unit:{'state':'specified','value':v,'unit':unit}
    fleet=[{'id':role,'role':role,'count':spec(count,'count'),'active_count':spec(math.floor(count*share/100),'count')}
           for role,count,share in (('survey',survey,sa),('excavation',exc,oa),('transport',transport,oa)) if count>0]
    cadence=INTAKE_CADENCE[state['cadence']]
    kinds=[('map','terrain_map')]+([] if survey_only else [('progress','progress_comparison'),('plan','fleet_plan')])
    jobs=[]
    for jid,kind in kinds:
        j={'id':jid,'type':kind,'cadence':cadence,'deadline':spec(deadline,'hour')}
        if cadence=='every_n_operating_hours':j['interval']=spec(4,'hour')
        jobs.append(j)
    request={'schema_version':'construction-sizing/1','request_id':'intake','project_revision':1,
        'project':{'id':'intake_project','name':str(state.get('name') or 'Construction project')[:100],
                   'structure_types':['other'],'duration':spec(duration,'sol'),'survey_area':{'state':'unknown'}},
        'fleet':fleet,'operations':{'hours_per_sol':spec(hours,'hour_per_sol'),'precision':INTAKE_PRECISION[state['precision']]},
        'jobs':jobs,'retention':{'raw':spec(raw,'sol'),'products':spec(prod,'sol')},
        'infrastructure':{'deployment':'dedicated','power_strategy':INTAKE_POWER[state['power']],
                          'available_base_power':spec(base,'kW'),'backup_duration':spec(backup,'hour')}}
    return validate_request(request)
