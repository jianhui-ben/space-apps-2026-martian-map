"""Construction-driven screening estimates; no site approval is implied."""
from .profiles import load_bundle
from .validation import from_guided_brief

def build_requirements(*args, **kwargs):
    from .pipeline import build_requirements as build
    return build(*args, **kwargs)
