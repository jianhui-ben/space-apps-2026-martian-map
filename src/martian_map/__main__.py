"""Allow ``python -m martian_map``."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
