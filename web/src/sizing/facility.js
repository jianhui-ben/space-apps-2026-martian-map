// Equipment counts, power, heat, support loads and reference-environment layouts. Port of sizing/facility.py.
import { calc, known, unknown } from './quantity.js';

const sum = (v) => v.reduce((a, b) => a + b, 0);
const unique = (items) => [...new Set(items)].sort();

export function estimateFacility(ctx, work, deployment) {
  const r = ctx.request, p = ctx.param, a = ctx.answer, s = {};
  const put = (key, unit, inputs, fn) => (s[key] = calc(unit, inputs, fn));
  s.retained_data_gb_per_sol = work.retained_data_gb_per_sol;
  s.active_workers = work.active_workers;
  put('workers', 'count', [work.active_workers, p('worker_spares')], (n, sp) => n + sp);
  let rawret = a(r.retention.raw, 'retention.raw');
  let prodret = a(r.retention.products, 'retention.products');
  // Keep pending job inputs even when the owner's archival retention is short.
  const buffers = [];
  for (const job of r.jobs) {
    const cadence = job.cadence;
    if (cadence === 'unknown') buffers.push(unknown('sol', ['input:jobs.' + job.id + '.cadence']));
    else if (cadence === 'phase_end') buffers.push(work.duration);
    else {
      // A full sol plus the deadline conservatively bounds each recurring input window.
      const deadline = a(job.deadline, 'jobs.' + job.id + '.deadline');
      buffers.push(calc('sol', [deadline, work.sol_hours], (h, sol) => 1 + h / sol));
    }
  }
  const pending = calc('sol', buffers, (...v) => Math.max(...v));
  rawret = calc('sol', [rawret, pending], Math.max);
  // Unknown cadence also makes product retention policy unresolved.
  prodret = calc('sol', [prodret, pending], (retention) => retention);
  // Conservatively retain all phase-end products; otherwise bound retention by duration.
  const phaseEnd = r.jobs.some((j) => j.cadence === 'phase_end');
  put('required_storage_tb', 'TB', [s.retained_data_gb_per_sol, rawret, prodret, work.duration, work.product_gb_total, p('copies'), p('working_days'), p('storage_headroom')],
    (d, rr, pr, dur, products, copies, working, head) => ((d * Math.min(rr, dur) + products * (phaseEnd ? (pr > 0 ? 1 : 0) : Math.min(pr, dur) / dur)) * copies + d * Math.min(working, dur)) * head / 1000);
  put('storage_units', 'count', [s.required_storage_tb, p('storage_unit_tb')], (tb, unit) => Math.max(1, Math.ceil(tb / unit)));
  put('it_peak_kw', 'kW', [s.workers, p('worker_peak_kw'), s.storage_units, p('storage_unit_kw'), p('essential_kw')], (n, k, ns, ks, e) => n * k + ns * ks + e);
  put('it_average_kw', 'kW', [s.workers, p('worker_idle_kw'), p('worker_peak_kw'), work.work_hours, work.modeled_horizon_hours, s.storage_units, p('storage_unit_kw'), p('essential_kw')],
    (n, idle, peak, wh, horizon, ns, ks, e) => n * idle + (peak - idle) * wh / horizon + ns * ks + e);
  put('facility_peak_kw', 'kW', [s.it_peak_kw, p('support_fraction')], (v, f) => v * (1 + f));
  put('facility_average_kw', 'kW', [s.it_average_kw, p('support_fraction')], (v, f) => v * (1 + f));
  put('essential_kw', 'kW', [p('essential_kw'), s.storage_units, p('storage_unit_kw'), p('support_fraction')], (e, n, k, f) => (e + n * k) * (1 + f));
  put('energy_kwh_per_sol', 'kWh/sol', [s.facility_average_kw, work.sol_hours], (pw, h) => pw * h);
  s.heat_rejection_kw = s.facility_peak_kw;
  s.survival_kw = unknown('kW', ['engineering:shutdown_survival_design']);
  const base = a(r.infrastructure.available_base_power, 'infrastructure.available_base_power');
  const strategy = r.infrastructure.power_strategy;
  if (strategy === 'solar_storage') s.required_solar_average_kw = s.facility_average_kw;
  else if (strategy === 'hybrid') put('required_solar_average_kw', 'kW', [s.facility_average_kw, base], (load, b) => Math.max(0, load - b));
  else if (strategy === 'base_connection') s.required_solar_average_kw = known(0, 'kW', ['input:infrastructure.power_strategy'], false);
  else s.required_solar_average_kw = unknown('kW', ['input:infrastructure.power_strategy']);
  s.base_connection_required_kw = strategy === 'base_connection' ? s.facility_peak_kw : base;
  put('solar_panel_area_m2', 'm2', [s.required_solar_average_kw, p('solar_net_mean_w_m2')], (kw, flux) => kw * 1000 / flux);
  put('solar_plot_m2', 'm2', [s.solar_panel_area_m2, p('solar_land_coverage')], (area, coverage) => area / coverage);
  put('radiator_emitting_area_m2', 'm2', [s.heat_rejection_kw, p('radiator_net_w_m2')], (heat, flux) => heat * 1000 / flux);
  put('radiator_plot_m2', 'm2', [s.radiator_emitting_area_m2, p('radiator_plot_factor')], (area, f) => area * f);
  const backup = a(r.infrastructure.backup_duration, 'infrastructure.backup_duration');
  put('battery_nameplate_kwh', 'kWh', [s.essential_kw, backup, p('battery_usable_fraction'), p('battery_efficiency')], (kw, h, usable, eff) => kw * h / (usable * eff));
  put('battery_units', 'count', [s.battery_nameplate_kwh, p('battery_unit_kwh')], (need, cap) => Math.ceil(need / cap));
  put('modules', 'count', [s.workers, s.storage_units, s.battery_units, p('equipment_per_module')], (n, ns, nb, cap) => Math.max(1, Math.ceil((n + ns + nb) / cap)));
  put('core_area_m2', 'm2', [s.modules, p('module_length_m'), p('module_width_m'), p('module_clearance_m')], (n, l, w, c) => n * (l + 2 * c) * (w + 2 * c));
  put('full_reference_plot_m2', 'm2', [s.core_area_m2, s.solar_plot_m2, s.radiator_plot_m2], (...v) => sum(v));
  put('equipment_mass_kg', 'kg', [s.workers, p('worker_mass_kg'), s.storage_units, p('storage_unit_mass_kg'), s.battery_units, p('battery_unit_mass_kg')], (n, w, ns, st, nb, b) => n * w + ns * st + nb * b);
  put('core_mass_kg', 'kg', [s.modules, p('module_empty_mass_kg'), s.equipment_mass_kg], (n, m, e) => n * m + e);
  // Uniform payload allocation is a declared reference assumption, not a load case analysis.
  put('reference_module_mass_kg', 'kg', [s.core_mass_kg, s.modules], (m, n) => m / n);
  put('required_allowable_bearing_kpa', 'kPa', [s.reference_module_mass_kg, p('gravity'), p('support_count'), p('support_area_m2'), p('pressure_allowance_factor')], (m, g, n, area, f) => m * g * f / (n * area * 1000));
  for (const [key, param] of [['pad_slope_limit_deg', 'pad_slope_deg'], ['local_slope_limit_deg', 'local_slope_deg'], ['roughness_limit_m', 'roughness_m'],
    ['corridor_width_m', 'corridor_width_m'], ['service_distance_limit_m', 'max_service_distance_m'], ['vehicle_grade_limit_deg', 'vehicle_grade_deg']]) s[key] = p(param);
  s.network_transfer_gbps = p('transfer_gbps');
  s.foundation_settlement_limit_m = unknown('m', ['engineering:foundation_movement_allowance']);
  s.subsurface_ice_policy = unknown('policy', ['engineering:ice_response_and_ground_thermal_model']);
  const layout = { status: 'unresolved', requires_site_refinement: true, missing_inputs: [], components: [] };
  const required = ['modules', 'core_area_m2', 'solar_plot_m2', 'radiator_plot_m2', 'full_reference_plot_m2'];
  const missing = required.filter((k) => s[k].status === 'unresolved').flatMap((k) => s[k].missing_inputs);
  if (missing.length) layout.missing_inputs = unique(missing);
  else {
    const l = p('module_length_m').value, w = p('module_width_m').value, c = p('module_clearance_m').value;
    const n = Math.trunc(s.modules.value);
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      layout.components.push({ id: `module_${i + 1}`, kind: 'module', x_m: cursor + c, y_m: c, length_m: l, width_m: w, clearance_m: c });
      cursor += l + 2 * c;
    }
    let y = w + 2 * c;
    for (const [key, kind] of [['solar_plot_m2', 'solar'], ['radiator_plot_m2', 'radiator']]) {
      const area = s[key].value;
      if (area > 0) {
        const side = Math.sqrt(area);
        layout.components.push({ id: kind, kind, x_m: 0, y_m: y, length_m: side, width_m: side });
        y += side;
      }
    }
    Object.assign(layout, {
      status: 'reference_layout', net_allocated_area_m2: s.full_reference_plot_m2.value,
      bounding_width_m: Math.max(cursor, ...layout.components.map((x) => x.length_m)), bounding_height_m: y,
      limitations: ['Coordinates are local metres, not Mars placements.', 'Array and radiator areas depend on unvalidated reference fluxes.',
        'External utility corridors, delivery staging, setbacks and future expansion remain unresolved.'],
    });
  }
  if (deployment === 'base_integrated') {
    layout.status = 'requires_existing_base_layout';
    layout.missing_inputs = ['base:available_internal_space_and_support'];
  }
  return { specifications: s, layout, deployment,
    foundation_basis: { ground_strength_measured: false, assumptions: ['Uniform payload distribution across modules', 'Equal static support reactions', 'Screening pressure allowance; not a geotechnical safety certification'] },
    limitations: ['Not a Mars-qualified equipment design.', 'Core mass excludes site-dependent shielding, array/radiator structures and foundations.', 'Backup covers essential service demand only; no seasonal dispatch validation.'] };
}
