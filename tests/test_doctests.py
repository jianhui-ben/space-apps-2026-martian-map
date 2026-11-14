import doctest

import pytest

from martian_map import geo, traverse


@pytest.mark.parametrize("module", [geo, traverse])
def test_module_doctests(module):
    result = doctest.testmod(module)
    assert result.failed == 0
    assert result.attempted > 0
