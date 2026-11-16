"""Single-phase stream accounting and conservative tiled-job scheduling."""
import heapq
import math
from .contracts import calc,known,unknown

_FORCE_FULL=False  # tests: simulate every sol, never skip repeated ones


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
    recurring_specs=[];phase_specs=[];products=[];missing=[];allrefs=[];horizon_inputs=None
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
        if j['cadence']=='phase_end':
            phase_specs.append((j,gb,dl,cost,fixed,prec,gbps,tile))
        else:
            recurring_specs.append((j,gb,dl,cost,fixed,prec,gbps,tile,iv,h))
        horizon_inputs=(h,d,sh,max_jobs)
    plan=None
    if not missing and horizon_inputs:
        h,d,sh,max_jobs=horizon_inputs
        full=math.floor(d) if d>=1 else 0;rest=d-full
        # Count tiles before building any: an enormous brief is reported, never allocated.
        count=(full if _FORCE_FULL else min(full,1))*_count_day(recurring_specs,h)+(_count_day(recurring_specs,h*rest) if rest>0 else 0)+_count_phase(phase_specs,d)
        if count>max_jobs:
            missing.append('model:max_jobs');ctx.issue('search_bound_exceeded','Tiled work exceeds configured bound.')
        else:
            key=lambda j:(j['release'],j['deadline'],j['id'])
            day=sorted(_day_jobs(recurring_specs,0,h,sh),key=key) if full else []
            last=sorted(_day_jobs(recurring_specs,full,h*rest,sh),key=key) if rest>0 else []
            phase=sorted(_phase_jobs(phase_specs,d,sh),key=key)
            plan=(full,day,last,phase,sh)
    if pool_unknown:missing.extend(pool_unknown)
    workers=p('max_workers')
    if workers['status']=='unresolved':missing.extend(workers['missing_inputs'])
    nworkers=None;latest=None
    if not missing:
        # Each tile's read is serialized on the shared link; transfer is conservatively
        # completed before a dedicated worker executes it. Repeated reads are not new ingestion.
        feasible=lambda n:_schedule_plan(plan,n) if plan else 0.0
        limit_n=int(workers['value']);lo=0;hi=1;end=None
        # Double until a count works, then halve the gap: the smallest sufficient count in about 2 log2(n) passes.
        while hi<=limit_n:
            end=feasible(hi)
            if end is not None:break
            lo=hi;hi*=2
        else:
            if lo<limit_n:
                end=feasible(limit_n)
                if end is not None:hi=limit_n
        if hi<=limit_n and end is not None:
            latest=end
            while hi-lo>1:
                mid=(lo+hi)//2;e=feasible(mid)
                if e is None:lo=mid
                else:hi=mid;latest=e
            nworkers=hi
        else:
            missing.append('equipment:worker_search_limit');ctx.issue('no_supported_configuration','No tested worker count meets modeled deadlines and shared-link capacity.')
    worker_result=unknown('count',missing,allrefs) if missing else known(nworkers,'count',allrefs+['model:max_workers'])
    horizon=unknown('hour',missing,allrefs) if missing else known(max(duration['value']*sol['value'],latest),'hour',allrefs)
    work=unknown('worker_hour',missing,allrefs) if missing else known(plan[0]*sum(j['runtime'] for j in plan[1])+sum(j['runtime'] for j in plan[2])+sum(j['runtime'] for j in plan[3]),'worker_hour',allrefs)
    output_gb=calc('GB',products,lambda *v:sum(v))
    return {'retained_data_gb_per_sol':total,'active_workers':worker_result,'work_hours':work,
            'modeled_horizon_hours':horizon,'product_gb_total':output_gb,'streams':streams,'duration':duration,'sol_hours':sol,
            'jobs_modeled':(len(plan[1])+len(plan[2])+len(plan[3])) if plan else 0,'scheduler':'release-order conservative tiled schedule, sol by sol, skipping sols that start from the same state; not optimal',
            'schedule_status':'unresolved' if missing else 'meets_assumed_deadlines'}


def _tiles(spec_id,release,volume,dl,cost,fixed,prec,gbps,tile):
    # Tileability is an explicit screening assumption, not benchmark evidence.
    count=max(1,math.ceil(volume/tile));per=volume/count
    return [{'id':f"{spec_id}:{release}:{n}",'release':release,'deadline':release+dl,
             'runtime':(per*cost+fixed)*prec,'transfer':per*8/gbps/3600,'gb':per} for n in range(count)]


def _day_jobs(specs,day,dayhours,sh):
    jobs=[]
    for j,gb,dl,cost,fixed,prec,gbps,tile,iv,h in specs:
        step=iv if j['cadence']=='every_n_operating_hours' else dayhours
        for n in range(math.ceil(dayhours/step)):
            span=min(step,dayhours-n*step)
            jobs+=_tiles(j['id'],day*sh+min((n+1)*step,dayhours),gb*span/h,dl,cost,fixed,prec,gbps,tile)
    return jobs


def _phase_jobs(specs,d,sh):
    return [t for j,gb,dl,cost,fixed,prec,gbps,tile in specs for t in _tiles(j['id'],d*sh,gb*d,dl,cost,fixed,prec,gbps,tile)]


def _count_day(specs,dayhours):
    n=0
    for j,gb,dl,cost,fixed,prec,gbps,tile,iv,h in specs:
        step=iv if j['cadence']=='every_n_operating_hours' else dayhours
        for k in range(math.ceil(dayhours/step)):
            span=min(step,dayhours-k*step);n+=max(1,math.ceil(gb*span/h/tile))
    return n


def _count_phase(specs,d):
    return sum(max(1,math.ceil(gb*d/tile)) for j,gb,dl,cost,fixed,prec,gbps,tile in specs)


def _run(jobs,offset,slots,link):
    """Schedule jobs (release/deadline shifted by offset) on the worker heap; the link free time, or None on a miss."""
    for job in jobs:
        link=max(link,job['release']+offset)+job['transfer']
        free=heapq.heappop(slots)
        finish=max(free,link)+job['runtime']
        if finish>job['deadline']+offset+1e-9:return None
        heapq.heappush(slots,finish)
    return link


def _schedule_plan(plan,nworkers):
    """Latest finish over the project, or None when a job misses its deadline with nworkers dedicated workers.

    Sols are simulated in order, carrying worker and link state. A worker or the link free before the next sol's
    start is equivalent to one free at that start (every release is later), so once a sol starts from the same
    clipped state as the one before, every remaining full sol repeats it exactly and is skipped."""
    full,day,last,phase,sh=plan
    slots=[0.0]*nworkers;heapq.heapify(slots);link=0.0;prev=None;k=0
    while k<full:
        link=_run(day,k*sh,slots,link)
        if link is None:return None
        k+=1
        if _FORCE_FULL:continue
        start=k*sh
        state=(sorted(max(0.0,v-start) for v in slots),max(0.0,link-start))
        if prev is not None and all(abs(a-b)<=1e-9 for a,b in zip(state[0],prev[0])) and abs(state[1]-prev[1])<=1e-9:
            jump=(full-k)*sh
            slots=[start+jump+v for v in state[0]];heapq.heapify(slots);link=start+jump+state[1];k=full
            break
        prev=state
    for jobs in (last,phase):
        if jobs:
            link=_run(jobs,0,slots,link)
            if link is None:return None
    return max(slots) if slots else 0.0
