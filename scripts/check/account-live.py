#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""The app's sign-in against a real API: starts website/api on a scratch database, runs `bleep_library_test --account-live` (the real HTTP
stack of patch/library/Account.cpp), and confirms the device code as a user on the site, the way a browser would.

    scripts/check/account-live.py [path to bleep_library_test]
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "website" / "api"
PORT = 8765
BIN = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build/patch/bleep_library_test_artefacts/bleep_library_test"


def main() -> int:
    import httpx

    work = Path(tempfile.mkdtemp(prefix="bleep-account-live-"))
    env = dict(os.environ, BLEEP_DATABASE_URL=f"sqlite:///{work}/api.db", BLEEP_COOKIE_SECURE="false")
    py = API / ".venv" / "bin" / "python"
    # tables from the models, as in the tests (the migrations are checked against Postgres)
    subprocess.run([str(py), "-c", "from app import models; from app.db import Base, engine; Base.metadata.create_all(engine)"], cwd=API, env=env, check=True)
    server = subprocess.Popen([str(py), "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"], cwd=API, env=env)
    base = f"http://127.0.0.1:{PORT}"
    try:
        for _ in range(50):
            try:
                if httpx.get(base + "/api/health").status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.2)
        browser = httpx.Client(base_url=base)
        r = browser.post("/api/auth/register", json={"email": "live@example.com", "password": "correct-horse-1", "display_name": "Live"})
        r.raise_for_status()
        app = subprocess.Popen([str(BIN), "--account-live", base, str(work / "data")], stdout=subprocess.PIPE, text=True,
                               env=dict(os.environ, BLEEP_DATA_DIR=str(work / "data")))
        code = None
        for line in app.stdout:
            print("  app:", line.rstrip())
            if line.startswith("CODE "):
                code = line.split()[1]
                break
        assert code, "the app printed no code"
        browser.post("/api/auth/device/approve", json={"user_code": code}).raise_for_status()   # what the /device/ page does
        for line in app.stdout:
            print("  app:", line.rstrip())
        return app.wait()
    finally:
        server.terminate()


if __name__ == "__main__":
    sys.exit(main())
