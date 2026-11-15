"""Offline JSON CLI; no downloading or feasibility assertions."""
import json
import os
from pathlib import Path
import sys
import tempfile
from . import build_requirements,from_guided_brief,load_bundle
from .validation import RequestError

def run(args):
    try:
        source=Path(args.input)
        if args.output and source.resolve()==Path(args.output).resolve():raise ValueError('Output must differ from input.')
        request=json.loads(source.read_text())
        if args.input_format=='guided':request=from_guided_brief(request)
        result=build_requirements(request,load_bundle(args.model_bundle),evidence_only=args.evidence_only)
        text=json.dumps(result,indent=2,allow_nan=False)+'\n'
        if args.output:
            dest=Path(args.output);temp=None
            try:
                with tempfile.NamedTemporaryFile(mode='w',dir=dest.parent,delete=False) as handle:
                    temp=handle.name;handle.write(text)
                os.replace(temp,dest)
            finally:
                if temp and os.path.exists(temp):os.unlink(temp)
        else:sys.stdout.write(text)
        return 0
    except (ValueError,OSError,TypeError,KeyError) as exc:
        print(json.dumps({'error':str(exc),'issues':getattr(exc,'issues',[])}),file=sys.stderr)
        return 2
