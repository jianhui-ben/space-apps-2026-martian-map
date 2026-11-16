"""Equipment counts, power, heat, support loads and reference-environment layouts."""
import math
from .contracts import calc,known,unknown


def estimate_facility(ctx,work,deployment):
    r=ctx.request;p=ctx.param;a=ctx.answer;s={}
    def put(key,unit,inputs,fn):s[key]=calc(unit,inputs,fn);return s[key]
    s['retained_data_gb_per_sol']=work['retained_data_gb_per_sol'];s['active_workers']=work['active_workers']
    put('workers','count',[work['active_workers'],p('worker_spares')],lambda n,sp:n+sp)
    rawret=a(r['retention']['raw'],'retention.raw');prodret=a(r['retention']['products'],'retention.products')
    # Keep pending job inputs even when the owner's archival retention is short.
    buffers=[]
    for job in r['jobs']:
        cadence=job['cadence']
        if cadence=='unknown':buffers.append(unknown('sol',['input:jobs.'+job['id']+'.cadence']))
        elif cadence=='phase_end':buffers.append(work['duration'])
        else:
            # A full sol plus the deadline conservatively bounds each recurring input window.
            deadline=a(job['deadline'],'jobs.'+job['id']+'.deadline')
            buffers.append(calc('sol',[deadline,work['sol_hours']],lambda h,sol:1+h/sol))
    pending=calc('sol',buffers,lambda *v:max(v))
    rawret=calc('sol',[rawret,pending],max)
    # Unknown cadence also makes product retention policy unresolved.
    prodret=calc('sol',[prodret,pending],lambda retention,buffer:retention)
    # Conservatively retain all phase-end products; otherwise bound retention by duration.
    phase_end=any(j['cadence']=='phase_end' for j in r['jobs'])
    put('required_storage_tb','TB',[s['retained_data_gb_per_sol'],rawret,prodret,work['duration'],work['product_gb_total'],p('copies'),p('working_days'),p('storage_headroom')],
        lambda d,rr,pr,dur,products,copies,working,head:((d*min(rr,dur)+products*((1 if pr>0 else 0) if phase_end else min(pr,dur)/dur))*copies+d*min(working,dur))*head/1000)
    put('storage_units','count',[s['required_storage_tb'],p('storage_unit_tb')],lambda tb,unit:max(1,math.ceil(tb/unit)))
    put('it_peak_kw','kW',[s['workers'],p('worker_peak_kw'),s['storage_units'],p('storage_unit_kw'),p('essential_kw')],lambda n,k,ns,ks,e:n*k+ns*ks+e)
    put('it_average_kw','kW',[s['workers'],p('worker_idle_kw'),p('worker_peak_kw'),work['work_hours'],work['modeled_horizon_hours'],s['storage_units'],p('storage_unit_kw'),p('essential_kw')],lambda n,idle,peak,wh,horizon,ns,ks,e:n*idle+(peak-idle)*wh/horizon+ns*ks+e)
    put('facility_peak_kw','kW',[s['it_peak_kw'],p('support_fraction')],lambda v,f:v*(1+f))
    put('facility_average_kw','kW',[s['it_average_kw'],p('support_fraction')],lambda v,f:v*(1+f))
    put('essential_kw','kW',[p('essential_kw'),s['storage_units'],p('storage_unit_kw'),p('support_fraction')],lambda e,n,k,f:(e+n*k)*(1+f))
    put('energy_kwh_per_sol','kWh/sol',[s['facility_average_kw'],work['sol_hours']],lambda p,h:p*h)
    s['heat_rejection_kw']=s['facility_peak_kw']
    s['survival_kw']=unknown('kW',['engineering:shutdown_survival_design'])
    base=a(r['infrastructure']['available_base_power'],'infrastructure.available_base_power')
    strategy=r['infrastructure']['power_strategy']
    if strategy=='solar_storage':s['required_solar_average_kw']=s['facility_average_kw']
    elif strategy=='hybrid':put('required_solar_average_kw','kW',[s['facility_average_kw'],base],lambda load,b:max(0,load-b))
    elif strategy=='base_connection':s['required_solar_average_kw']=known(0,'kW',['input:infrastructure.power_strategy'],False)
    else:s['required_solar_average_kw']=unknown('kW',['input:infrastructure.power_strategy'])
    s['base_connection_required_kw']=s['facility_peak_kw'] if strategy=='base_connection' else base
    put('solar_panel_area_m2','m2',[s['required_solar_average_kw'],p('solar_net_mean_w_m2')],lambda kw,flux:kw*1000/flux)
    put('solar_plot_m2','m2',[s['solar_panel_area_m2'],p('solar_land_coverage')],lambda area,coverage:area/coverage)
    put('radiator_emitting_area_m2','m2',[s['heat_rejection_kw'],p('radiator_net_w_m2')],lambda heat,flux:heat*1000/flux)
    put('radiator_plot_m2','m2',[s['radiator_emitting_area_m2'],p('radiator_plot_factor')],lambda area,f:area*f)
    backup=a(r['infrastructure']['backup_duration'],'infrastructure.backup_duration')
    put('battery_nameplate_kwh','kWh',[s['essential_kw'],backup,p('battery_usable_fraction'),p('battery_efficiency')],lambda kw,h,usable,eff:kw*h/(usable*eff))
    put('battery_units','count',[s['battery_nameplate_kwh'],p('battery_unit_kwh')],lambda need,cap:math.ceil(need/cap))
    put('modules','count',[s['workers'],s['storage_units'],s['battery_units'],p('equipment_per_module')],lambda n,ns,nb,cap:max(1,math.ceil((n+ns+nb)/cap)))
    put('core_area_m2','m2',[s['modules'],p('module_length_m'),p('module_width_m'),p('module_clearance_m')],lambda n,l,w,c:n*(l+2*c)*(w+2*c))
    put('full_reference_plot_m2','m2',[s['core_area_m2'],s['solar_plot_m2'],s['radiator_plot_m2']],lambda *v:sum(v))
    put('equipment_mass_kg','kg',[s['workers'],p('worker_mass_kg'),s['storage_units'],p('storage_unit_mass_kg'),s['battery_units'],p('battery_unit_mass_kg')],lambda n,w,ns,st,nb,b:n*w+ns*st+nb*b)
    put('core_mass_kg','kg',[s['modules'],p('module_empty_mass_kg'),s['equipment_mass_kg']],lambda n,m,e:n*m+e)
    # Uniform payload allocation is a declared reference assumption, not a load case analysis.
    put('reference_module_mass_kg','kg',[s['core_mass_kg'],s['modules']],lambda m,n:m/n)
    put('required_allowable_bearing_kpa','kPa',[s['reference_module_mass_kg'],p('gravity'),p('support_count'),p('support_area_m2'),p('pressure_allowance_factor')],lambda m,g,n,area,f:m*g*f/(n*area*1000))
    for key,param,unit in [('pad_slope_limit_deg','pad_slope_deg','deg'),('local_slope_limit_deg','local_slope_deg','deg'),('roughness_limit_m','roughness_m','m'),('corridor_width_m','corridor_width_m','m'),('service_distance_limit_m','max_service_distance_m','m'),('vehicle_grade_limit_deg','vehicle_grade_deg','deg')]:s[key]=p(param)
    s['network_transfer_gbps']=p('transfer_gbps')
    s['foundation_settlement_limit_m']=unknown('m',['engineering:foundation_movement_allowance'])
    s['subsurface_ice_policy']=unknown('policy',['engineering:ice_response_and_ground_thermal_model'])
    layout={'status':'unresolved','requires_site_refinement':True,'missing_inputs':[],'components':[]}
    required=['modules','core_area_m2','solar_plot_m2','radiator_plot_m2','full_reference_plot_m2']
    missing=[v for k in required if s[k]['status']=='unresolved' for v in s[k]['missing_inputs']]
    if missing:layout['missing_inputs']=sorted(set(missing))
    else:
        l=p('module_length_m')['value'];w=p('module_width_m')['value'];c=p('module_clearance_m')['value']
        n=int(s['modules']['value'])
        # A compact block: modules in a near-square grid (cell = module plus clearance on every side), the solar
        # square east of the block and the radiator square north of it, one clearance apart.
        cell_x=l+2*c;cell_y=w+2*c
        cols=max(1,min(n,round(math.sqrt(n*cell_y/cell_x))));rows=math.ceil(n/cols)
        for i in range(n):
            col,row=i%cols,i//cols
            layout['components'].append({'id':f'module_{i+1}','kind':'module','x_m':col*cell_x+c,'y_m':row*cell_y+c,'length_m':l,'width_m':w,'clearance_m':c})
        block_w=cols*cell_x;block_h=rows*cell_y
        layout.update(block_width_m=block_w,block_height_m=block_h)
        right=block_w;top=block_h
        for key,kind in [('solar_plot_m2','solar'),('radiator_plot_m2','radiator')]:
            area=s[key]['value']
            if area>0:
                side=math.sqrt(area)
                if kind=='solar':layout['components'].append({'id':kind,'kind':kind,'x_m':block_w+c,'y_m':0,'length_m':side,'width_m':side});right=max(right,block_w+c+side);top=max(top,side)
                else:layout['components'].append({'id':kind,'kind':kind,'x_m':0,'y_m':block_h+c,'length_m':side,'width_m':side});top=max(top,block_h+c+side);right=max(right,side)
        layout.update(status='reference_layout',net_allocated_area_m2=s['full_reference_plot_m2']['value'],bounding_width_m=right,bounding_height_m=top,
                      limitations=['Coordinates are local metres, not Mars placements.','Array and radiator areas depend on unvalidated reference fluxes.','External utility corridors, delivery staging, setbacks and future expansion remain unresolved.'])
    if deployment=='base_integrated':
        layout['status']='requires_existing_base_layout';layout['missing_inputs']=['base:available_internal_space_and_support']
    return {'specifications':s,'layout':layout,'deployment':deployment,'foundation_basis':{'ground_strength_measured':False,'assumptions':['Uniform payload distribution across modules','Equal static support reactions','Screening pressure allowance; not a geotechnical safety certification']},
            'limitations':['Not a Mars-qualified equipment design.','Core mass excludes site-dependent shielding, array/radiator structures and foundations.','Backup covers essential service demand only; no seasonal dispatch validation.']}
