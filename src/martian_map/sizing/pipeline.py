"""Pure construction brief to conditional facility requirements handoff."""
import json
from .contracts import Context,digest
from .profiles import load_bundle,validate_bundle,RESOURCES
from .validation import validate_request
from .workloads import estimate_workloads
from .facility import estimate_facility

# These are demand thresholds, never measurements of a candidate site.
MAPPINGS={
 'BT-04':('pad_slope_limit_deg','maximum'),
 'BT-05':('local_slope_limit_deg','maximum'),
 'BT-08':('roughness_limit_m','maximum'),
 'BT-17':('corridor_width_m','minimum'),
 'GI-01':('required_allowable_bearing_kpa','minimum'),
 'SC-03':('required_solar_average_kw','minimum'),
 'TC-03':('heat_rejection_kw','minimum'),
}
CATEGORIES={
 'terrain':('Buildable terrain',['core_area_m2','full_reference_plot_m2','pad_slope_limit_deg','corridor_width_m']),
 'ground':('Ground and ice',['required_allowable_bearing_kpa','foundation_settlement_limit_m','subsurface_ice_policy']),
 'solar':('Solar and electrical supply',['required_solar_average_kw','solar_panel_area_m2','energy_kwh_per_sol','battery_nameplate_kwh','base_connection_required_kw']),
 'thermal':('Thermal control',['heat_rejection_kw','radiator_emitting_area_m2','survival_kw']),
 'routes':('Investigation routes',['service_distance_limit_m','vehicle_grade_limit_deg','network_transfer_gbps']),
}

def _has_range(value):
    if isinstance(value,dict):return value.get('state')=='range' or any(_has_range(v) for v in value.values())
    return isinstance(value,list) and any(_has_range(v) for v in value)


def build_requirements(request,bundle=None,*,evidence_only=False):
    request=validate_request(request);bundle=validate_bundle(bundle) if bundle is not None else load_bundle()
    registry=json.loads((RESOURCES/'metrics.json').read_text())
    scenarios=[('low_endpoint','min'),('high_endpoint','max')] if _has_range(request) else [('owner_case','min')]
    deployments=['dedicated','base_integrated'] if request['infrastructure']['deployment']=='compare_both' else [request['infrastructure']['deployment']]
    options=[];requirements=[];provenance={};issues=[]
    for scenario,endpoint in scenarios:
        for deployment in deployments:
            ctx=Context(request,bundle,endpoint,evidence_only)
            work=estimate_workloads(ctx);option=estimate_facility(ctx,work,deployment)
            option.update(id=scenario+'_'+deployment,scenario_id=scenario,workload=work)
            option['categories']=[{'id':k,'name':name,'demand':{s:option['specifications'][s] for s in specs},
                'assessment_status':'not_assessed'} for k,(name,specs) in CATEGORIES.items()]
            options.append(option);issues.extend(ctx.issues);provenance.update(ctx.provenance)
            for metric in registry:
                record={'id':option['id']+'.'+metric['id'],'option_id':option['id'],'metric_id':metric['id'],
                    'category':metric['category'],'name':metric['name'],'assessment_status':'not_assessed',
                    'definition_status':'missing_inputs','criterion':None,'missing_inputs':[metric['required_design_input']],
                    'dataset_ids':metric['dataset_ids'],'evidence_status':'catalog_references_only',
                    'evidence_note':'Catalog association is not a verified local payload or a ground measurement.',
                    'provenance_ids':[]}
                if metric['id'] in MAPPINGS:
                    key,op=MAPPINGS[metric['id']];quantity=option['specifications'][key]
                    record.update(criterion={'operator':op,'quantity':quantity,'specification':key},
                                  provenance_ids=quantity['provenance_ids'],missing_inputs=quantity.get('missing_inputs',[]),
                                  definition_status='specified' if quantity['status']=='resolved' else 'missing_inputs')
                if metric['id'] in ('BT-01','BT-02'):
                    record['reference_layout']=option['layout'];record['missing_inputs']=['engineering:complete_layout_including_external_works']
                if metric['id'] in ('GI-07','TC-10'):record['dependencies']=['GI-07','TC-10']
                requirements.append(record)
    assumptions=[{'id':k,**v} for k,v in sorted(provenance.items()) if v.get('status') in ('engineering_assumption','synthetic_demo')]
    return {'schema_version':'facility-requirements/1','request_id':request['request_id'],
        'project_revision':request['project_revision'],'input_hash':digest(request),
        'mode':'evidence_only' if evidence_only else 'conditional_screening',
        'status':'partial','model_bundle':{k:bundle[k] for k in ('id','version','hash','evidence_status')},
        'scenarios':[{'id':s,'range_selection':e,'note':'Simultaneous endpoints, not confidence intervals or guaranteed demand bounds.'} for s,e in scenarios],
        'facility_options':options,'location_requirements':requirements,
        'candidate_sizing_tasks':['Resolve full layout and site-specific shielding/foundations.',
          'Recompute array area and battery dispatch using candidate seasonal irradiance, shading and dust.',
          'Recompute radiators and survival loads using candidate thermal conditions.',
          'Verify bearing, settlement and coupled ground/ice heating through investigation.',
          'Plan investigation routes with measured mobility, instruments, communication and return reserves.'],
        'input_issues':issues,'assumptions':assumptions,'provenance':provenance,'sources':bundle['sources'],
        'limitations':['No site feasibility determination has been performed.',
          'One operating phase with project-wide jobs; robot safety and control remain onboard.',
          'Reference layout areas are incomplete conditional estimates, not certified land requirements.',
          'Survey area and structure types describe the project; calibrated area/complexity cost models are not available.']}
