// sizeBrief: the brief to a sized facility, a list of answers still needed, or a plain reason it cannot be sized.
import { fromBrief } from './request.js';
import { buildOptions } from './engine.js';
import { createContext } from './quantity.js';
import { estimateWorkloads } from './workloads.js';
import { estimateFacility } from './facility.js';

export const SIZE_KEYS = ['workers', 'required_storage_tb', 'facility_peak_kw', 'facility_average_kw', 'heat_rejection_kw',
  'required_solar_average_kw', 'solar_panel_area_m2', 'solar_plot_m2', 'radiator_emitting_area_m2', 'radiator_plot_m2',
  'battery_units', 'modules', 'core_area_m2', 'full_reference_plot_m2', 'required_allowable_bearing_kpa'];

// Labels of the brief answers, the intake's field names (ui/brief.js); per-job and fleet inputs are built in labelFor.
export const INPUT_LABELS = {
  'input:project.duration': 'Project duration',
  'input:retention.products': 'Keep processed outputs', // the project duration when the brief does not ask for it
  'input:retention.raw': 'Keep raw data',
  'input:infrastructure.power_strategy': 'Power approach',
  'input:infrastructure.backup_duration': 'Essential backup duration',
  'input:infrastructure.available_base_power': 'Available base power',
  'input:operations.hours_per_sol': 'Working time',
};
const ORDER = Object.keys(INPUT_LABELS).filter((k) => k !== 'input:retention.products');
const OUTPUT_LABELS = { map: 'Terrain maps', progress: 'Progress comparisons', inspection: 'Inspection reports', plan: 'Fleet work plans' };
const POWER = { 'Solar + storage': 'solar_batteries', 'Hybrid': 'topup', 'Base connection': 'base_only' };
const QUANTITIES = ['duration', 'area', 'hours', 'deadline', 'retention', 'products', 'road', 'backup', 'basePower'];
const SCENARIO_END = { low_endpoint: 'low', high_endpoint: 'high' };

const valid = (n) => Number.isFinite(n) && n > 0;
const ZERO_OK = new Set(['retention', 'products', 'backup']); // keeping nothing, or no backup, is an answer
const UNKNOWN = { mode: 'unknown' };

// The app calls this on every keystroke and the port does not validate: a half-entered answer counts as unanswered.
function sanitize(brief, solHours) {
  const b = structuredClone(brief);
  for (const key of QUANTITIES) {
    const v = (b.q || {})[key];
    if (!v) continue;
    const cap = key === 'hours' ? solHours : Infinity;
    const good = ZERO_OK.has(key) ? (n) => Number.isFinite(n) && n >= 0 : valid;
    const ok = v.mode === 'known' ? good(v.value) && v.value <= cap
      : v.mode === 'range' ? good(v.min) && good(v.max) && v.min <= v.max && v.max <= cap : true;
    if (!ok) b.q[key] = UNKNOWN;
  }
  for (const f of b.fleet || []) {
    const whole = (n) => Number.isInteger(n) && n >= 0;
    if (!whole(f.count) || !whole(f.active) || f.active > f.count) { f.count = null; f.active = null; }
  }
  return b;
}

function labelFor(marker, request) {
  if (Object.hasOwn(INPUT_LABELS, marker)) return { label: INPUT_LABELS[marker], tab: 2, rank: [1, ORDER.indexOf(marker === 'input:retention.products' ? 'input:project.duration' : marker), 0] };
  let m = /^input:jobs\.([^.]+)\.(deadline|cadence)$/.exec(marker);
  if (m) {
    const at = request.jobs.findIndex((j) => j.id === m[1]);
    const out = OUTPUT_LABELS[m[1]] ?? m[1];
    return { label: m[2] === 'deadline' ? 'Results needed within' : out + ' frequency', tab: 2, rank: [1, ORDER.length + (m[2] === 'deadline' ? 0 : 1), at] };
  }
  m = /^input:fleet\.(\d+)\.(count|active_count)$/.exec(marker);
  if (m) return { label: 'Construction robots', tab: 1, rank: [0, 0, Number(m[1])] };
  return { label: marker, tab: 2, rank: [2, 0, 0] }; // nothing is silently dropped
}

// The plain label of one input marker (for "Needs: …" on a requirement row).
export const markerLabel = (marker) => labelFor(marker, { jobs: [] }).label;

// The dedicated option of a scenario, computed when the request only asks for the base-integrated one.
const dedicatedFor = (request, bundle, scenarioId) => {
  const ctx = createContext(request, bundle, scenarioId === 'high_endpoint' ? 'max' : 'min');
  return { id: scenarioId + '_dedicated', scenario_id: scenarioId, deployment: 'dedicated', ...estimateFacility(ctx, estimateWorkloads(ctx), 'dedicated') };
};

// Markers of every unresolved or absent size result. One with no marker still counts, as unresolved:<key>, so it never reads as met.
export function unresolvedMarkers(specifications) {
  const out = new Set();
  for (const k of SIZE_KEYS) {
    const spec = specifications?.[k];
    if (spec?.status === 'resolved') continue;
    const markers = spec?.missing_inputs ?? [];
    if (markers.length) markers.forEach((m) => out.add(m));
    else out.add('unresolved:' + k);
  }
  return [...out];
}

const hoursText = (n) => n + (n === 1 ? ' hour' : ' hours');
const outputOfRoles = (request, bundle, roles) => request.jobs.find((j) => (bundle.job_roles[j.type] || []).join(',') === roles);
const roleText = (roles) => roles.split(',').map((r) => r[0].toUpperCase() + r.slice(1)).join(' or ');

// Problems for one scenario's unresolved markers (no input: ones are left).
function problemsFor(markers, request, bundle, endpoint, p) {
  const out = [];
  for (const marker of markers) {
    let m;
    if (marker === 'equipment:worker_search_limit') {
      const deadlines = request.jobs.map((j) => (j.deadline.state === 'specified' ? j.deadline.value : j.deadline[endpoint])).filter(Number.isFinite);
      out.push({ reason: marker, tab: 2, message: `The results can't be ready within ${hoursText(Math.min(...deadlines))} with up to ${p.max_workers} computers. Allow more time or process less often.` });
    } else if (marker === 'model:max_jobs') {
      out.push({ reason: marker, tab: 2, message: `This schedule needs more processing jobs than the model handles (${p.max_jobs}). Shorten the project or process less often.` });
    } else if ((m = /^fleet_role:(.+)$/.exec(marker))) {
      const job = outputOfRoles(request, bundle, m[1]);
      out.push({ reason: marker, tab: 1, message: `${OUTPUT_LABELS[job?.id] ?? 'An output'} needs ${roleText(m[1])} robots: raise Construction robots or the robot shares in Planning defaults.` });
    } else if (marker === 'equipment:worker_memory') {
      out.push({ reason: marker, tab: 2, message: 'One job needs more memory than a computer has.' });
    } else out.push({ reason: marker, tab: 2, message: `The facility can't be sized from these answers (${marker}).` });
  }
  return out;
}

export function sizeBrief(brief, bundle) {
  const P = (k) => bundle.parameters[k].value;
  const params = Object.fromEntries(['solar_land_coverage', 'radiator_plot_factor', 'module_length_m', 'module_width_m', 'module_clearance_m'].map((k) => [k, P(k)]));
  const clean = sanitize(brief, P('sol_hours'));
  const request = fromBrief(clean);
  const options = buildOptions(request, bundle);
  const scenarios = [...new Set(options.map((o) => o.scenario_id))];
  const dedicated = scenarios.map((id) => options.find((o) => o.scenario_id === id && o.deployment === 'dedicated') ?? dedicatedFor(request, bundle, id));

  // Unresolved size results per scenario, from the dedicated options.
  const unresolved = dedicated.map((o) => unresolvedMarkers(o.specifications));
  const found = new Map(); // by label, so a duplicated answer shows once
  const asked = (clean.q || {}).products; // product retention asked on its own, not taken from the duration
  for (const marker of unresolved.flat()) {
    if (!marker.startsWith('input:')) continue;
    const l = labelFor(marker, request);
    if (!asked && marker === 'input:retention.products') l.label = INPUT_LABELS['input:project.duration']; // kept for the whole project
    if (!found.has(l.label)) found.set(l.label, { input: marker, ...l });
  }
  if ((clean.power === 'Base connection' || clean.power === 'Hybrid') && request.infrastructure.available_base_power.state === 'unknown') {
    found.set(INPUT_LABELS['input:infrastructure.available_base_power'], { input: 'input:infrastructure.available_base_power', ...labelFor('input:infrastructure.available_base_power', request) });
  }
  const missing = [...found.values()].sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2])
    .map(({ input, label, tab }) => ({ input, label, tab }));

  // Not enough answers, or every answer given but a result still unresolved or the base too weak.
  const grouped = new Map();
  const note = (p, scenarioId) => { const k = p.reason + '|' + p.message; (grouped.get(k) ?? grouped.set(k, { ...p, ends: new Set() }).get(k)).ends.add(scenarioId); };
  if (!missing.length) {
    dedicated.forEach((o, i) => {
      const endpoint = o.scenario_id === 'high_endpoint' ? 'max' : 'min';
      const left = unresolved[i].filter((x) => !x.startsWith('input:'));
      problemsFor(left, request, bundle, endpoint, { max_workers: P('max_workers'), max_jobs: P('max_jobs') }).forEach((p) => note(p, o.scenario_id));
      const base = request.infrastructure.available_base_power, peak = o.specifications.facility_peak_kw;
      if (clean.power === 'Base connection' && !left.length && peak.status === 'resolved') {
        const b = base.state === 'specified' ? base.value : base[endpoint];
        if (Number.isFinite(b) && b < peak.value) note({ reason: 'base_power_below_peak', tab: 2, message: `Available base power (${b.toFixed(1)} kW) is below the facility's ${peak.value.toFixed(1)} kW peak. Raise it, or choose Hybrid or Solar + storage.` }, o.scenario_id);
      }
    });
  }
  const problems = [...grouped.values()].map(({ ends, ...p }) => (scenarios.length > 1 && ends.size < scenarios.length
    ? { ...p, message: p.message + ` (at the ${SCENARIO_END[[...ends][0]]} end of your ranges)` } : p));
  const status = missing.length ? 'needs_answers' : problems.length ? 'cannot_size' : 'sized';

  // Terrain fit is the main site filter, so the larger plot is assessed (the high end on a tie).
  const plot = (o) => (o.specifications.full_reference_plot_m2.status === 'resolved' ? o.specifications.full_reference_plot_m2.value : -Infinity);
  const assessed = dedicated.reduce((best, o) => (best === null || plot(o) >= plot(best) ? o : best), null);
  return { status, missing, problems, options, assessed, params };
}

// The brief-sourced setup the map places and checks.
export function briefSetup(sizing, brief) {
  return { source: 'brief', power: POWER[brief.power] ?? null, sizing, brief }; // brief: what was sized (the facility step shows it)
}
