// Site sizing and the brief's own site checks (pure): the solar plot and radiator sized for one site's conditions, and
// BT-17, BT-21, GI-01 and TC-03 against the facility the brief produced. Every result resting on a screening assumption says so.
import { pvSeries, plotPoints } from './environment.js';
import { STATUS, statusFor } from './status.js';

const R = 3396190;
const RAD = Math.PI / 180;
const M_PER_DEG = R * RAD;
export const EMISSIVITY = 0.85; // radiator surface (assumption)
export const RADIATOR_K = 300; // radiator temperature (assumption)
export const SIGMA = 5.670374419e-8;

const META = {
  'BT-17': { unit: 'm', pd: 'D', appliesTo: 'route' },
  'BT-21': { unit: '', pd: 'D', appliesTo: 'layout' },
  'GI-01': { unit: '', pd: 'D', appliesTo: 'compound' },
  'TC-03': { unit: '', pd: 'D', appliesTo: 'radiator' },
};
const fmt = (v, d) => v.toFixed(d);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const kelvin = (v) => String(Math.round(v * 10) / 10);

function result(id, o) {
  const m = META[id];
  return {
    id, value: o.value === undefined ? null : o.value, unit: m.unit, display: o.display || '—',
    target: { baseline: o.baseline, ideal: o.ideal === undefined ? '' : o.ideal, label: m.pd },
    status: o.status, ideal: !!o.isIdeal, evidence: o.evidence || 'derived', note: o.note || '',
    assumption: !!o.assumption, straddles: false, appliesTo: m.appliesTo,
  };
}

// Net W/m2 a radiator at RADIATOR_K sheds to a sink at tSinkK.
export const radiatorFluxWm2 = (tSinkK) => EMISSIVITY * SIGMA * (RADIATOR_K ** 4 - tSinkK ** 4);

// The warmest 2 m air temperature over every scenario, season and time; NaN without data.
export function warmestAirK(mcdThermal) {
  let max = NaN;
  for (const s of Object.values((mcdThermal && mcdThermal.scenarios) || {})) {
    for (const row of s.air_temperature_2m_k || []) for (const v of row) if (Number.isFinite(v) && !(v <= max)) max = v;
  }
  return max;
}

// PV output (W per m2 of panel) at the horizon cell containing the site centre: {annual, worst} = the year mean and the
// lowest season mean of the climatology; NaN for each when an input is missing.
export function siteSolarWm2(site, env) {
  const clim = env && env.mcdSolar && env.mcdSolar.scenarios && env.mcdSolar.scenarios.climatology;
  if (!site || !site.horizon || !site.sunTable || !clim) return { annual: NaN, worst: NaN };
  const [w, s, e, n] = site.bounds;
  const cell = plotPoints(site.horizon, { w: 0, h: 0, center: { lon: (w + e) / 2, lat: (s + n) / 2 }, rotationDeg: 0 });
  const series = pvSeries(site.sunTable, site.horizon, cell, clim, 1);
  const kw = series.flatMap((x) => x.kw);
  return { annual: kw.length ? 1000 * mean(kw) : NaN, worst: series.length ? 1000 * Math.min(...series.map((x) => mean(x.kw))) : NaN };
}
// Year-mean PV output (W per m2 of panel); NaN when an input is missing.
export const sitePanelWm2 = (site, env) => siteSolarWm2(site, env).annual;

const specValue = (setup, key) => {
  const v = setup && setup.sizing && setup.sizing.assessed && setup.sizing.assessed.specifications[key];
  return v && v.status === 'resolved' ? v.value : NaN;
};

// The solar and radiator sizes for this site. A size is 'site' only when its areas are finite; otherwise the engine's
// generic size is kept (From: 'generic'), which is NaN when that is unresolved too.
export function siteSizing(site, setup, env) {
  const P = (setup && setup.sizing && setup.sizing.params) || {}, S = (k) => specValue(setup, k);
  // A solar-plus-storage facility must carry its demand in the worst season, so its panels are sized for that; a top-up
  // is sized on the annual mean.
  const { annual: panelWm2, worst: worstWm2 } = siteSolarWm2(site, env);
  const solarBasis = setup && setup.power === 'solar_batteries' ? 'worst_season' : 'annual_mean';
  const basisWm2 = solarBasis === 'worst_season' ? worstWm2 : panelWm2;
  const panelSite = Number.isFinite(basisWm2) && basisWm2 > 0 ? S('required_solar_average_kw') * 1000 / basisWm2 : NaN;
  const solarSite = Number.isFinite(panelSite) && Number.isFinite(panelSite / P.solar_land_coverage);
  const solarPanelM2 = solarSite ? panelSite : S('solar_panel_area_m2');
  const solarPlotM2 = solarSite ? panelSite / P.solar_land_coverage : S('solar_plot_m2');

  const tSinkK = warmestAirK(env && env.mcdThermal);
  const radiatorWm2 = Number.isFinite(tSinkK) ? radiatorFluxWm2(tSinkK) : NaN;
  const heatW = S('heat_rejection_kw') * 1000;
  const areaSite = radiatorWm2 > 0 ? heatW / radiatorWm2 : Number.isFinite(radiatorWm2) && Number.isFinite(heatW) ? Infinity : NaN;
  const radiatorSite = (Number.isFinite(areaSite) && Number.isFinite(areaSite * P.radiator_plot_factor)) || areaSite === Infinity;
  const radiatorAreaM2 = radiatorSite ? areaSite : S('radiator_emitting_area_m2');
  const radiatorPlotM2 = radiatorSite ? areaSite * P.radiator_plot_factor : S('radiator_plot_m2');
  return { solarPanelM2, solarPlotM2, panelWm2, worstWm2, solarBasis, solarFrom: solarSite ? 'site' : 'generic', radiatorAreaM2, radiatorPlotM2, radiatorWm2, tSinkK,
    radiatorFrom: radiatorSite ? 'site' : 'generic' };
}

// briefChecks(site, layout, setup, size) -> Map<id, Result> for BT-17, BT-21, GI-01 and TC-03; size is siteSizing's result.
export function briefChecks(site, layout, setup, size) {
  const out = new Map(), S = (k) => specValue(setup, k);
  const corridor = S('corridor_width_m'), grade = S('vehicle_grade_limit_deg'), limit = S('service_distance_limit_m'), bearing = S('required_allowable_bearing_kpa');

  out.set('BT-17', result('BT-17', { status: STATUS.NEEDS_DESIGN_INPUT, baseline: '≥ ' + corridor + ' m, grade ≤ ' + grade + '°',
    note: 'needs a planned route; route planning is not part of this screening' }));

  const compound = ((layout && layout.footprints) || []).find((f) => f.id === 'compound');
  const bl21 = '≤ ' + limit + ' m', id21 = '≤ ' + fmt(0.8 * limit, 0) + ' m (0.8 of it)';
  if (compound && site.base && limit > 0) {
    const kx = M_PER_DEG * Math.cos(compound.center.lat * RAD);
    const d = Math.hypot((site.base.lon - compound.center.lon) * kx, (site.base.lat - compound.center.lat) * M_PER_DEG);
    const ratio = d / limit, s = statusFor({ value: ratio, baseline: 1.0, ideal: 0.8, compare: '<=' });
    out.set('BT-21', result('BT-21', { value: ratio, display: fmt(d, 0) + ' m of ' + limit + ' m', baseline: bl21, ideal: id21, status: s.status, isIdeal: s.ideal,
      assumption: true, note: 'straight line from the compound centre to the base, against the service distance allowance (assumption)' }));
  } else {
    out.set('BT-21', result('BT-21', { status: STATUS.NEEDS_CONFIRMATION, baseline: bl21, ideal: id21, note: 'no compound or base position to measure from' }));
  }

  out.set('GI-01', result('GI-01', { status: STATUS.NEEDS_FIELDWORK, baseline: '≥ ' + fmt(bearing, 1) + ' kPa', assumption: true,
    note: 'ground strength has not been measured at any candidate' }));

  const bl03 = 'radiator rejects the facility heat';
  if (size.radiatorFrom === 'site' && size.radiatorWm2 > 0 && Number.isFinite(size.radiatorAreaM2)) {
    out.set('TC-03', result('TC-03', { value: 1.0, display: fmt(size.radiatorWm2, 0) + ' W/m² · ' + fmt(size.radiatorAreaM2, 0) + ' m² of radiator', baseline: bl03,
      status: STATUS.MET, evidence: 'model', assumption: true,
      note: 'sized with emissivity ' + EMISSIVITY + ', a ' + RADIATOR_K + ' K radiator and the warmest air in the climate model (' + kelvin(size.tSinkK)
        + ' K) as the sink; absorbed sunlight and nearby surfaces are not modelled' }));
  } else if (size.radiatorFrom === 'site' && !(size.radiatorWm2 > 0)) {
    out.set('TC-03', result('TC-03', { value: 0, display: 'too warm for a ' + RADIATOR_K + ' K radiator', baseline: bl03, status: STATUS.NOT_MET,
      evidence: 'model', assumption: true,
      note: 'the warmest air in the climate model (' + kelvin(size.tSinkK) + ' K) is as warm as the ' + RADIATOR_K + ' K radiator, so it sheds no heat' }));
  } else {
    out.set('TC-03', result('TC-03', { status: STATUS.NEEDS_CONFIRMATION, baseline: bl03, note: 'no climate model temperatures here: needs confirmation' }));
  }
  return out;
}
