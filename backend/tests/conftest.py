import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SNIPEX_STORAGE", tempfile.mkdtemp(prefix="snipex-test-storage-"))
os.environ.setdefault("SNIPEX_RATE_LIMIT", "1000")

from tests.samples import build  # noqa: E402


@pytest.fixture(scope="session")
def samples(tmp_path_factory):
    return build(tmp_path_factory.mktemp("samples"))
