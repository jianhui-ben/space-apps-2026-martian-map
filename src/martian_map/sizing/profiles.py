"""Load explicit, editable coefficients and validate their provenance."""
import copy
import hashlib
import json
import math
from pathlib import Path

RESOURCES = Path(__file__).with_name('resources')

class BundleError(ValueError):
    pass

def load_bundle(path=None):
    path=Path(path) if path else RESOURCES/'screening-v1.json'
    try: bundle=json.loads(path.read_text())
    except (OSError,ValueError) as exc:raise BundleError(str(exc)) from exc
    return validate_bundle(bundle)

def validate_bundle(bundle):
    b=copy.deepcopy(bundle)
    if not isinstance(b,dict) or not all(k in b for k in ('id','version','evidence_status','sources','parameters','job_roles')):
        raise BundleError('bundle requires identity, sources, parameters and job_roles')
    if not isinstance(b['sources'],dict) or not isinstance(b['parameters'],dict):raise BundleError('bundle sources/parameters must be objects')
    canonical=json.loads((RESOURCES/'screening-v1.json').read_text())
    if b['job_roles']!=canonical['job_roles']:
        raise BundleError('v1 requires the documented job-to-source-role mapping')
    for name,p in b['parameters'].items():
        if name not in canonical['parameters']:raise BundleError(f'{name}: unsupported parameter')
        if isinstance(p,dict) and p.get('unit')!=canonical['parameters'][name]['unit']:
            raise BundleError(f'{name}: unexpected unit')
        if not isinstance(p,dict) or p.get('source') not in b['sources']:raise BundleError(f'{name}: missing source')
        if p.get('status') not in ('engineering_assumption','physical_constant','measured','vendor_specification','synthetic_demo'):raise BundleError(f'{name}: unknown evidence status')
        v=p.get('value')
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0:raise BundleError(f'{name}: expected nonnegative finite value')
        if not p.get('unit'):raise BundleError(f'{name}: missing unit')
        if name not in ('worker_spares','product_fraction','support_fraction') and not name.startswith(('cost_', 'fixed_')) and v==0:raise BundleError(f'{name}: must be positive')
        if name in ('copies','support_count','max_workers','worker_spares','equipment_per_module','max_jobs') and int(v)!=v:raise BundleError(f'{name}: must be integer')
        if name in ('solar_land_coverage','battery_efficiency','battery_usable_fraction','solar_energy_fraction') and v>1:raise BundleError(f'{name}: fraction exceeds one')
    if b['parameters'].get('worker_idle_kw',{}).get('value',0)>b['parameters'].get('worker_peak_kw',{}).get('value',float('inf')):raise BundleError('idle power exceeds peak power')
    b.pop('hash',None)
    b['hash']=hashlib.sha256(json.dumps(b,sort_keys=True,allow_nan=False).encode()).hexdigest()
    return b
