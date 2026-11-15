// Single-phase stream accounting and conservative tiled-job scheduling. Port of sizing/workloads.py.
import { calc, known, unknown } from './quantity.js';

// Binary min-heap of numbers (slot free times).
function heapPush(h, v) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (h[parent] <= h[i]) break;
    [h[parent], h[i]] = [h[i], h[parent]];
    i = parent;
  }
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l] < h[m]) m = l;
      if (r < h.length && h[r] < h[m]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

const sum = (v) => v.reduce((a, b) => a + b, 0);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function estimateWorkloads(ctx) {
  const r = ctx.request, p = ctx.param, a = ctx.answer;
  const hours = a(r.operations.hours_per_sol, 'operations.hours_per_sol');
  const duration = a(r.project.duration, 'project.duration');
  const precision = p('precision_' + r.operations.precision);
  const rates = Object.create(null), streams = [], poolUnknown = [];
  r.fleet.forEach((f, i) => {
    const active = a(f.active_count, `fleet.${i}.active_count`), count = a(f.count, `fleet.${i}.count`);
    if (count.status === 'unresolved') poolUnknown.push(...count.missing_inputs);
    const stream = calc('GB/sol', [active, hours, p('rate_' + f.role)], (n, h, rate) => n * h * rate);
    streams.push({ id: f.id, role: f.role, quantity: stream });
    (rates[f.role] ||= []).push(stream);
  });
  const total = calc('GB/sol', streams.map((s) => s.quantity), (...v) => sum(v));
  const jobs = [], products = [], allrefs = [];
  let missing = [];
  const sol = p('sol_hours'), limit = p('max_jobs'), memory = p('worker_memory_gb'), transfer = p('transfer_gbps'), tileSize = p('tile_size_gb');
  for (const j of r.jobs) {
    const roles = Object.hasOwn(ctx.bundle.job_roles, j.type) ? ctx.bundle.job_roles[j.type] : [];
    const inputs = roles.flatMap((role) => (Object.hasOwn(rates, role) ? rates[role] : []));
    let data = calc('GB/sol', inputs, (...x) => sum(x));
    // A requested sensor analysis cannot be justified by absent source robots.
    if (roles.length && !inputs.length) data = unknown('GB/sol', ['fleet_role:' + roles.join(',')]);
    const deadline = a(j.deadline, 'jobs.' + j.id + '.deadline');
    const interval = 'interval' in j ? a(j.interval, 'jobs.' + j.id + '.interval') : hours;
    const params = [hours, duration, sol, limit, memory, transfer, tileSize, precision, data, deadline, interval,
      p('cost_' + j.type), p('fixed_' + j.type), p('memory_' + j.type)];
    for (const x of params) allrefs.push(...(x.provenance_ids || []));
    products.push(calc('GB', [data, duration, p('product_fraction')], (d, t, f) => d * t * f));
    const bad = params.filter((x) => x.status === 'unresolved').flatMap((x) => x.missing_inputs);
    if (j.cadence === 'unknown') bad.push('input:jobs.' + j.id + '.cadence');
    if (bad.length) { missing.push(...bad); continue; }
    const [h, d, sh, maxJobs, ram, gbps, tile, prec, gb, dl, iv, cost, fixed, jobram] = params.map((x) => x.value);
    if (jobram > ram) {
      missing.push('equipment:worker_memory');
      ctx.issue('no_supported_configuration', 'Job memory exceeds the supported worker configuration.');
      continue;
    }
    const windows = [];
    if (j.cadence === 'phase_end') windows.push([d * sh, gb * d]);
    else {
      for (let day = 0; day < Math.ceil(d); day++) {
        const dayhours = h * Math.min(1, d - day);
        const step = j.cadence === 'every_n_operating_hours' ? iv : dayhours;
        const count = Math.ceil(dayhours / step);
        if (windows.length + count > maxJobs) {
          missing.push('model:max_jobs');
          ctx.issue('search_bound_exceeded', 'Job enumeration exceeds configured bound.');
          break;
        }
        for (let n = 0; n < count; n++) {
          const span = Math.min(step, dayhours - n * step);
          windows.push([day * sh + Math.min((n + 1) * step, dayhours), gb * span / h]);
        }
      }
    }
    for (const [release, volume] of windows) {
      // Tileability is an explicit screening assumption, not benchmark evidence.
      const count = Math.max(1, Math.ceil(volume / tile));
      if (jobs.length + count > maxJobs) {
        missing.push('model:max_jobs');
        ctx.issue('search_bound_exceeded', 'Tiled work exceeds configured bound.');
        break;
      }
      const per = volume / count;
      for (let n = 0; n < count; n++) {
        jobs.push({ id: `${j.id}:${release}:${n}`, release, deadline: release + dl,
          runtime: (per * cost + fixed) * prec, transfer: per * 8 / gbps / 3600, gb: per });
      }
    }
  }
  if (poolUnknown.length) missing.push(...poolUnknown);
  const workers = p('max_workers');
  if (workers.status === 'unresolved') missing.push(...workers.missing_inputs);
  let nworkers, slots;
  if (!missing.length) {
    // Each tile's read is serialized on the shared link; transfer is conservatively
    // completed before a dedicated worker executes it. Repeated reads are not new ingestion.
    jobs.sort((x, y) => cmp(x.release, y.release) || cmp(x.deadline, y.deadline) || cmp(x.id, y.id));
    let found = false;
    for (nworkers = 1; nworkers <= Math.trunc(workers.value); nworkers++) {
      slots = new Array(nworkers).fill(0);
      let linkFree = 0, ok = true;
      for (const job of jobs) {
        linkFree = Math.max(linkFree, job.release) + job.transfer;
        const free = heapPop(slots);
        const finish = Math.max(free, linkFree) + job.runtime;
        if (finish > job.deadline + 1e-9) { ok = false; break; }
        heapPush(slots, finish);
      }
      if (ok) { found = true; break; }
    }
    if (!found) {
      missing.push('equipment:worker_search_limit');
      ctx.issue('no_supported_configuration', 'No tested worker count meets modeled deadlines and shared-link capacity.');
    }
  }
  const workerResult = missing.length ? unknown('count', missing, allrefs) : known(nworkers, 'count', [...allrefs, 'model:max_workers']);
  const horizon = missing.length ? unknown('hour', missing, allrefs) : known(Math.max(duration.value * sol.value, Math.max(...slots)), 'hour', allrefs);
  const work = missing.length ? unknown('worker_hour', missing, allrefs) : known(sum(jobs.map((j) => j.runtime)), 'worker_hour', allrefs);
  const outputGb = calc('GB', products, (...v) => sum(v));
  return { retained_data_gb_per_sol: total, active_workers: workerResult, work_hours: work,
    modeled_horizon_hours: horizon, product_gb_total: outputGb, streams, duration, sol_hours: sol,
    jobs_modeled: jobs.length, scheduler: 'release-order conservative tiled schedule; not optimal',
    schedule_status: missing.length ? 'unresolved' : 'meets_assumed_deadlines' };
}
