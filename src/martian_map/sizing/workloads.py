"""Single-phase stream accounting and conservative tiled-job scheduling."""
import heapq
import math
from .contracts import calc,known,unknown


def estimate_workloads(ctx):
    r=ctx.request;p=ctx.param;a=ctx.answer
    hours=a(r['operations']['hours_per_sol'],'operations.hours_per_sol')
    duration=a(r['project']['duration'],'project.duration')
    precision=p('precision_'+r['operations']['precision'])
    rates={};streams=[];pool_unknown=[]
    for i,f in enumerate(r['fleet']):
        active=a(f['active_count'],f'fleet.{i}.active_count');count=a(f['count'],f'fleet.{i}.count')
        if count['status']=='unresolved':pool_unknown+=count['missing_inputs']
        stream=calc('GB/sol',[active,hours,p('rate_'+f['role'])],lambda n,h,rate:n*h*rate)
        streams.append({'id':f['id'],'role':f['role'],'quantity':stream})
        rates.setdefault(f['role'],[]).append(stream)
    total=calc('GB/sol',[s['quantity'] for s in streams],lambda *v:sum(v))
    jobs=[];products=[];missing=[];allrefs=[]
    sol=p('sol_hours');limit=p('max_jobs');memory=p('worker_memory_gb');transfer=p('transfer_gbps');tile_size=p('tile_size_gb')
    for j in r['jobs']:
        roles=ctx.bundle['job_roles'].get(j['type'],[])
        inputs=[x for role in roles for x in rates.get(role,[])]
        data=calc('GB/sol',inputs,lambda *x:sum(x))
        # A requested sensor analysis cannot be justified by absent source robots.
        if roles and not inputs:data=unknown('GB/sol',['fleet_role:'+','.join(roles)])
        deadline=a(j['deadline'],'jobs.'+j['id']+'.deadline')
        interval=a(j['interval'],'jobs.'+j['id']+'.interval') if 'interval' in j else hours
        params=[hours,duration,sol,limit,memory,transfer,tile_size,precision,data,deadline,interval,
                p('cost_'+j['type']),p('fixed_'+j['type']),p('memory_'+j['type'])]
        allrefs.extend(ref for x in params for ref in x.get('provenance_ids',[]))
        products.append(calc('GB',[data,duration,p('product_fraction')],lambda d,t,f:d*t*f))
        bad=[v for x in params if x['status']=='unresolved' for v in x['missing_inputs']]
        if j['cadence']=='unknown':bad.append('input:jobs.'+j['id']+'.cadence')
        if bad:missing.extend(bad);continue
        h,d,sh,max_jobs,ram,gbps,tile,prec,gb,dl,iv,cost,fixed,jobram=[x['value'] for x in params]
        if jobram>ram:
            missing.append('equipment:worker_memory');ctx.issue('no_supported_configuration','Job memory exceeds the supported worker configuration.');continue
        windows=[]
        if j['cadence']=='phase_end':windows=[(d*sh,gb*d)]
        else:
            for day in range(math.ceil(d)):
                dayhours=h*min(1,d-day)
                step=iv if j['cadence']=='every_n_operating_hours' else dayhours
                count=math.ceil(dayhours/step)
                if len(windows)+count>max_jobs:
                    missing.append('model:max_jobs');ctx.issue('search_bound_exceeded','Job enumeration exceeds configured bound.');break
                for n in range(count):
                    span=min(step,dayhours-n*step)
                    windows.append((day*sh+min((n+1)*step,dayhours),gb*span/h))
        for release,volume in windows:
            # Tileability is an explicit screening assumption, not benchmark evidence.
            count=max(1,math.ceil(volume/tile))
            if len(jobs)+count>max_jobs:
                missing.append('model:max_jobs');ctx.issue('search_bound_exceeded','Tiled work exceeds configured bound.');break
            per=volume/count
            for n in range(count):
                jobs.append({'id':f"{j['id']}:{release}:{n}",'release':release,'deadline':release+dl,
                             'runtime':(per*cost+fixed)*prec,'transfer':per*8/gbps/3600,'gb':per})
    if pool_unknown:missing.extend(pool_unknown)
    workers=p('max_workers')
    if workers['status']=='unresolved':missing.extend(workers['missing_inputs'])
    if not missing:
        # Each tile's read is serialized on the shared link; transfer is conservatively
        # completed before a dedicated worker executes it. Repeated reads are not new ingestion.
        jobs.sort(key=lambda j:(j['release'],j['deadline'],j['id']))
        for nworkers in range(1,int(workers['value'])+1):
            slots=[0.0]*nworkers;heapq.heapify(slots);link_free=0;ok=True
            for job in jobs:
                link_free=max(link_free,job['release'])+job['transfer']
                free=heapq.heappop(slots)
                finish=max(free,link_free)+job['runtime']
                if finish>job['deadline']+1e-9:ok=False;break
                heapq.heappush(slots,finish)
            if ok:break
        else:
            missing.append('equipment:worker_search_limit');ctx.issue('no_supported_configuration','No tested worker count meets modeled deadlines and shared-link capacity.')
    worker_result=unknown('count',missing,allrefs) if missing else known(nworkers,'count',allrefs+['model:max_workers'])
    horizon=unknown('hour',missing,allrefs) if missing else known(max(duration['value']*sol['value'],max(slots)),'hour',allrefs)
    work=unknown('worker_hour',missing,allrefs) if missing else known(sum(j['runtime'] for j in jobs),'worker_hour',allrefs)
    output_gb=calc('GB',products,lambda *v:sum(v))
    return {'retained_data_gb_per_sol':total,'active_workers':worker_result,'work_hours':work,
            'modeled_horizon_hours':horizon,'product_gb_total':output_gb,'streams':streams,'duration':duration,'sol_hours':sol,
            'jobs_modeled':len(jobs),'scheduler':'release-order conservative tiled schedule; not optimal',
            'schedule_status':'unresolved' if missing else 'meets_assumed_deadlines'}
