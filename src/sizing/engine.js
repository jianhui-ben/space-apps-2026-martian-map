// Scenarios x deployments as sizing/pipeline.py: one option per combination.
import { createContext } from './quantity.js';
import { estimateWorkloads } from './workloads.js';
import { estimateFacility } from './facility.js';

function hasRange(value) {
  if (Array.isArray(value)) return value.some(hasRange);
  if (value && typeof value === 'object') return value.state === 'range' || Object.values(value).some(hasRange);
  return false;
}

export function buildOptions(request, bundle) {
  const scenarios = hasRange(request) ? [['low_endpoint', 'min'], ['high_endpoint', 'max']] : [['owner_case', 'min']];
  const deployment = request.infrastructure.deployment;
  const deployments = deployment === 'compare_both' ? ['dedicated', 'base_integrated'] : [deployment];
  const options = [];
  for (const [scenario, endpoint] of scenarios) {
    for (const d of deployments) {
      const ctx = createContext(request, bundle, endpoint);
      const workload = estimateWorkloads(ctx);
      const option = estimateFacility(ctx, workload, d);
      options.push({ id: scenario + '_' + d, scenario_id: scenario, deployment: d, specifications: option.specifications, layout: option.layout, workload });
    }
  }
  return options;
}

export async function loadBundle(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('coefficient bundle not found: ' + url);
  return response.json();
}
