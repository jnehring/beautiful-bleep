# SPDX-License-Identifier: MIT
import json
from pathlib import Path

import pytest

from bleep_agent.catalog import build_catalog, repo_root
from bleep_agent.presets import PresetLibrary

REPO = repo_root()


@pytest.fixture(scope="session")
def repo() -> Path:
    return REPO


@pytest.fixture(scope="session")
def catalog():
    return build_catalog(REPO)


@pytest.fixture(scope="session")
def library():
    return PresetLibrary.from_demo_patches(REPO / "patch" / "board" / "ui" / "demo-patches.json")


@pytest.fixture
def synth(library):
    """A small mono synth patch (Additive Osc: Tilt Sweep): sequencer -> osc -> vca (adsr) -> mixer -> reverb -> out."""
    from bleep_agent.patch import Patch

    return Patch(library.entries[0].preset)
