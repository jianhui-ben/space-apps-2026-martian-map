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
