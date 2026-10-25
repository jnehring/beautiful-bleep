# SPDX-License-Identifier: MIT
"""The settings of the scripts, in one place.

Layers, later ones win:
    config/bleep.json          shared defaults, committed
    config/bleep.local.json    this machine's: token file, JUCE checkout, Live set (git-ignored)
    environment                $BLEEP_JUCE_DIR, $BLEEP_RELEASE_TOKEN (the token itself), $BLEEP_REGISTRY_URL, ...
    command line               whatever the command takes

`config/library.json` stays what the apps are built with (library URL); its libraryUrl is the
registry default when nothing else names one.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
SHARED = CONFIG_DIR / "bleep.json"
LOCAL = CONFIG_DIR / "bleep.local.json"

# key -> environment variable that overrides it
ENV = {
    "juceDir": "BLEEP_JUCE_DIR",
    "liveSet": "BLEEP_LIVE_SET",
    "registry": "BLEEP_REGISTRY_URL",
    "releaseTokenFile": "BLEEP_RELEASE_TOKEN_FILE",
    "webOnly": "BLEEP_WEB_ONLY",
    "localModules": "BLEEP_LOCAL_MODULES",
}
# Keys that name files and may start with ~
PATHS = {"juceDir", "liveSet", "releaseTokenFile", "localModules"}


def _read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
    except OSError:
        return {}
    except ValueError as e:
        raise SystemExit(f"{path.name}: not valid JSON: {e}")
    return {k: v for k, v in data.items() if not k.startswith("_")}


def load() -> dict:
    """The effective settings. Paths are expanded (~) and relative ones are taken from the repository root."""
    s = {}
    s.update(_read(SHARED))
    s.update(_read(LOCAL))
    for key, var in ENV.items():
        if os.environ.get(var):
            s[key] = os.environ[var]
    if not s.get("registry"):
        s["registry"] = _read(CONFIG_DIR / "library.json").get("libraryUrl", "")
    for key in PATHS:
        if s.get(key) and s[key] != "off":
            p = Path(str(s[key])).expanduser()
            s[key] = str(p if p.is_absolute() else ROOT / p)
    return s


def get(key: str, default=None):
    return load().get(key) or default
