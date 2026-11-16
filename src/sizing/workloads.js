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

const byRelease = (x, y) => cmp(x.release, y.release) || cmp(x.deadline, y.deadline) || cmp(x.id, y.id);
export const testing = { forceFull: false }; // tests: simulate every sol, never skip repeated ones

// Tileability is an explicit screening assumption, not benchmark evidence.
function tiles(id, release, volume, dl, cost, fixed, prec, gbps, tile) {
  const count = Math.max(1, Math.ceil(volume / tile)), per = volume / count, out = [];
  for (let n = 0; n < count; n++) out.push({ id: `${id}:${release}:${n}`, release, deadline: release + dl, runtime: (per * cost + fixed) * prec, transfer: per * 8 / gbps / 3600, gb: per });
  return out;
}
function dayJobs(specs, day, dayhours, sh) {
  const jobs = [];
  for (const [j, gb, dl, cost, fixed, prec, gbps, tile, iv, h] of specs) {
    const step = j.cadence === 'every_n_operating_hours' ? iv : dayhours;
    for (let n = 0; n < Math.ceil(dayhours / step); n++) {
      const span = Math.min(step, dayhours - n * step);
      for (const t of tiles(j.id, day * sh + Math.min((n + 1) * step, dayhours), gb * span / h, dl, cost, fixed, prec, gbps, tile)) jobs.push(t);
    }
  }
  return jobs;
}
function phaseJobs(specs, d, sh) {
  const jobs = [];
  for (const [j, gb, dl, cost, fixed, prec, gbps, tile] of specs) for (const t of tiles(j.id, d * sh, gb * d, dl, cost, fixed, prec, gbps, tile)) jobs.push(t);
  return jobs;
}
function countDay(specs, dayhours) {
  let n = 0;
  for (const [j, gb, , , , , , tile, iv, h] of specs) {
    const step = j.cadence === 'every_n_operating_hours' ? iv : dayhours;
    for (let k = 0; k < Math.ceil(dayhours / step); k++) { const span = Math.min(step, dayhours - k * step); n += Math.max(1, Math.ceil(gb * span / h / tile)); }
  }
  return n;
}
const countPhase = (specs, d) => specs.reduce((n, [, gb, , , , , , tile]) => n + Math.max(1, Math.ceil(gb * d / tile)), 0);

// Schedule jobs (release/deadline shifted by offset) on the worker heap; the link free time, or null on a miss.
function run(jobs, offset, slots, link) {
  for (const job of jobs) {
    link = Math.max(link, job.release + offset) + job.transfer;
    const free = heapPop(slots);
    const finish = Math.max(free, link) + job.runtime;
    if (finish > job.deadline + offset + 1e-9) return null;
    heapPush(slots, finish);
  }
  return link;
}

// Latest finish over the project, or null on a missed deadline. Sols run in order carrying worker and link state; a
// worker or link free before the next sol's start is equivalent to one free at that start, so once a sol starts from
// the same clipped state as the one before, the remaining full sols repeat it and are skipped.
function schedulePlan(plan, n) {
  const [full, day, last, phase, sh] = plan;
  let slots = new Array(n).fill(0), link = 0, prev = null, k = 0;
  while (k < full) {
    link = run(day, k * sh, slots, link);
    if (link === null) return null;
    k += 1;
    if (testing.forceFull) continue;
    const start = k * sh;
    const state = [slots.map((v) => Math.max(0, v - start)).sort((x, y) => x - y), Math.max(0, link - start)];
    if (prev !== null && state[0].every((x, i) => Math.abs(x - prev[0][i]) <= 1e-9) && Math.abs(state[1] - prev[1]) <= 1e-9) {
      const jump = (full - k) * sh;
      slots = state[0].map((v) => start + jump + v); // ascending: already a min-heap
      link = start + jump + state[1];
      break;
    }
    prev = state;
  }
  for (const jobs of [last, phase]) {
    if (jobs.length) { link = run(jobs, 0, slots, link); if (link === null) return null; }
  }
  return slots.length ? slots.reduce((m, v) => (v > m ? v : m), 0) : 0;
}

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
  const recurringSpecs = [], phaseSpecs = [], products = [], allrefs = [];
  let missing = [], horizonInputs = null;
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
    if (j.cadence === 'phase_end') phaseSpecs.push([j, gb, dl, cost, fixed, prec, gbps, tile]);
    else recurringSpecs.push([j, gb, dl, cost, fixed, prec, gbps, tile, iv, h]);
    horizonInputs = [h, d, sh, maxJobs];
  }
  let plan = null;
  if (!missing.length && horizonInputs) {
    const [h, d, sh, maxJobs] = horizonInputs;
    const full = d >= 1 ? Math.floor(d) : 0, rest = d - full;
    // Count tiles before building any: an enormous brief is reported, never allocated.
    const count = (testing.forceFull ? full : Math.min(full, 1)) * countDay(recurringSpecs, h) + (rest > 0 ? countDay(recurringSpecs, h * rest) : 0) + countPhase(phaseSpecs, d);
    if (count > maxJobs) {
      missing.push('model:max_jobs');
      ctx.issue('search_bound_exceeded', 'Tiled work exceeds configured bound.');
    } else {
      const day = full ? dayJobs(recurringSpecs, 0, h, sh).sort(byRelease) : [];
      const last = rest > 0 ? dayJobs(recurringSpecs, full, h * rest, sh).sort(byRelease) : [];
      const phase = phaseJobs(phaseSpecs, d, sh).sort(byRelease);
      plan = [full, day, last, phase, sh];
    }
  }
  if (poolUnknown.length) missing.push(...poolUnknown);
  const workers = p('max_workers');
  if (workers.status === 'unresolved') missing.push(...workers.missing_inputs);
  let nworkers = null, latest = null;
  if (!missing.length) {
    // Each tile's read is serialized on the shared link; transfer is conservatively
    // completed before a dedicated worker executes it. Repeated reads are not new ingestion.
    const feasible = (n) => (plan ? schedulePlan(plan, n) : 0);
    const limitN = Math.trunc(workers.value);
    let lo = 0, hi = 1, end = null;
    // Double until a count works, then halve the gap: the smallest sufficient count in about 2 log2(n) passes.
    while (hi <= limitN) { end = feasible(hi); if (end !== null) break; lo = hi; hi *= 2; }
    if (hi > limitN && lo < limitN) { end = feasible(limitN); if (end !== null) hi = limitN; }
    if (hi <= limitN && end !== null) {
      latest = end;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2), e = feasible(mid);
        if (e === null) lo = mid; else { hi = mid; latest = e; }
      }
      nworkers = hi;
    } else {
      missing.push('equipment:worker_search_limit');
      ctx.issue('no_supported_configuration', 'No tested worker count meets modeled deadlines and shared-link capacity.');
    }
  }
  const workerResult = missing.length ? unknown('count', missing, allrefs) : known(nworkers, 'count', [...allrefs, 'model:max_workers']);
  const horizon = missing.length ? unknown('hour', missing, allrefs) : known(Math.max(duration.value * sol.value, latest), 'hour', allrefs);
  const work = missing.length ? unknown('worker_hour', missing, allrefs) : known(plan[0] * sum(plan[1].map((j) => j.runtime)) + sum(plan[2].map((j) => j.runtime)) + sum(plan[3].map((j) => j.runtime)), 'worker_hour', allrefs);
  const outputGb = calc('GB', products, (...v) => sum(v));
  return { retained_data_gb_per_sol: total, active_workers: workerResult, work_hours: work,
    modeled_horizon_hours: horizon, product_gb_total: outputGb, streams, duration, sol_hours: sol,
    jobs_modeled: plan ? plan[1].length + plan[2].length + plan[3].length : 0,
    scheduler: 'release-order conservative tiled schedule, sol by sol, skipping sols that start from the same state; not optimal',
    schedule_status: missing.length ? 'unresolved' : 'meets_assumed_deadlines' };
}
