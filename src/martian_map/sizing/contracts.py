"""Quantity propagation and provenance; unknown never means zero."""
import hashlib
import json
import math


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def known(value,unit,refs,conditional=True):
    if not math.isfinite(value):raise ValueError('non-finite derived quantity')
    return {'status':'resolved','value':value,'unit':unit,'provenance_ids':sorted(set(refs)),
            'conditional':conditional}


def unknown(unit,missing,refs=()):
    return {'status':'unresolved','unit':unit,'missing_inputs':sorted(set(missing)),
            'provenance_ids':sorted(set(refs))}


def calc(unit,inputs,fn):
    refs=[ref for x in inputs for ref in x.get('provenance_ids',[])]
    missing=[m for x in inputs if x['status']=='unresolved' for m in x['missing_inputs']]
    if missing:return unknown(unit,missing,refs)
    return known(fn(*[x['value'] for x in inputs]),unit,refs,any(x.get('conditional',False) for x in inputs))


class Context:
    def __init__(self,request,bundle,endpoint,evidence_only=False):
        self.request=request;self.bundle=bundle;self.endpoint=endpoint;self.evidence_only=evidence_only
        self.provenance={};self.issues=[]
    def param(self,key):
        ref='model:'+key;p=self.bundle['parameters'].get(key)
        if p is None:return unknown('unknown',[ref])
        self.provenance[ref]={'origin':'model','source':p['source'],'model_version':self.bundle['version'],**p}
        if self.evidence_only and p['status'] in ('engineering_assumption','synthetic_demo'):
            return unknown(p['unit'],[ref],[ref])
        return known(p['value'],p['unit'],[ref],p['status'] in ('engineering_assumption','synthetic_demo'))
    def answer(self,q,path):
        ref='input:'+path;self.provenance[ref]={'origin':'owner','path':path,'answer':q}
        if q['state']=='unknown':return unknown('unknown',[ref],[ref])
        value=q['value'] if q['state']=='specified' else q[self.endpoint]
        return known(value,q['unit'],[ref],False)
    def issue(self,code,message):
        self.issues.append({'code':code,'message':message})
