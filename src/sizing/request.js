// Brief to sizing request. Port of from_guided_brief plus the app's backup, base power and product retention inputs.
const TYPES = { 'Landing pad': 'landing_pad', 'Road': 'road', 'Habitat': 'habitat', 'Power installation': 'power_installation', 'Utility network': 'utility_network', 'Other': 'other' };
const OUTPUTS = { map: 'terrain_map', progress: 'progress_comparison', inspection: 'inspection_analysis', plan: 'fleet_plan' };
const CADENCE = { 'Once per sol': 'once_per_sol', 'Every 4 hours': 'every_n_operating_hours', 'At phase end': 'phase_end', 'Unknown': 'unknown' };
const PRECISION = { 'Coarse survey': 'coarse_survey', 'Earthworks check': 'earthworks_check', 'Precision assembly': 'precision_assembly' };
const DEPLOYMENT = { 'Inside the base': 'base_integrated', 'Dedicated installation': 'dedicated' };
const POWER = { 'Base connection': 'base_connection', 'Solar + storage': 'solar_storage', 'Hybrid': 'hybrid' };

const pick = (map, key, fallback) => (Object.hasOwn(map, key) ? map[key] : fallback);

export function fromBrief(brief) {
  const q = (key, unit) => {
    const v = (brief.q || {})[key] || {};
    if (v.mode === 'known') return { state: 'specified', value: v.value ?? null, unit };
    if (v.mode === 'range') return { state: 'range', min: v.min ?? null, max: v.max ?? null, unit };
    return { state: 'unknown' };
  };
  const count = (v) => (v == null ? { state: 'unknown' } : { state: 'specified', value: v, unit: 'count' });
  const jobs = [];
  const enabledJobs = brief.jobs || {};
  for (const key of Object.keys(enabledJobs)) {
    if (enabledJobs[key] && !Object.hasOwn(OUTPUTS, key)) throw new Error('unsupported guided output: ' + key);
  }
  // Canonical output order, so the request does not depend on the key order of a serialised brief.
  for (const key of Object.keys(OUTPUTS)) {
    if (!enabledJobs[key]) continue;
    const cadence = (brief.cadence || {})[key] ?? 'Unknown';
    const j = { id: key, type: OUTPUTS[key], cadence: pick(CADENCE, cadence, 'unknown'), deadline: q('deadline', 'hour') };
    if (cadence === 'Every 4 hours') j.interval = { state: 'specified', value: 4, unit: 'hour' };
    jobs.push(j);
  }
  const types = brief.types || [];
  const request = {
    schema_version: 'construction-sizing/1', request_id: 'guided-brief', project_revision: 1,
    project: { id: 'guided_project', name: brief.name ?? '', structure_types: types.map((t) => pick(TYPES, t, t)), duration: q('duration', 'sol'), survey_area: q('area', 'm2') },
    fleet: (brief.fleet || []).map((f, i) => ({ id: String(f.id ?? i), role: String(f.role ?? 'unknown').toLowerCase(), count: count(f.count), active_count: count(f.active) })),
    operations: { hours_per_sol: q('hours', 'hour_per_sol'), precision: pick(PRECISION, brief.quality, 'unknown') },
    jobs, retention: { raw: q('retention', 'sol'), products: { state: 'unknown' } },
    infrastructure: { deployment: pick(DEPLOYMENT, brief.deployment, 'compare_both'), power_strategy: pick(POWER, brief.power, 'unknown'),
      available_base_power: { state: 'unknown' }, backup_duration: { state: 'unknown' } },
  };
  if (types.includes('Road')) request.project.road_length = q('road', 'm');
  const infra = request.infrastructure;
  infra.backup_duration = q('backup', 'hour');
  infra.available_base_power = brief.power === 'Base connection' || brief.power === 'Hybrid' ? q('basePower', 'kW') : { state: 'unknown' };
  // Processed outputs are kept for the asked time (the Twin Trails intake asks it), else for the whole project.
  request.retention.products = (brief.q || {}).products ? q('products', 'sol') : structuredClone(request.project.duration);
  return request;
}
