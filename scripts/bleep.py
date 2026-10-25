#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""One command for building, running, testing and releasing Bleep.

    ./bleep build   [bus|plugins|app|web|modules|agent-data ...]   default: everything (bus plugins web)
    ./bleep run     app|ui|site|play|live [...]
    ./bleep test    [py|js|script|presets|bus|native|check ...]    default: py js check (fast, no compiler)
    ./bleep check   [repo|api-docs|account]                        default: repo api-docs
    ./bleep docs    [build|help-index|screenshots]
    ./bleep release plugins|modules|community [...]
    ./bleep package [module ...]                                   packages and installs into the data folder (--no-install: only package)
    ./bleep config                                                 show the effective settings

Settings (JUCE checkout, token file, registry, Live set) come from config/bleep.json, then
config/bleep.local.json, then the environment, then the command line: scripts/settings.py.
`./bleep <command> --help` shows the options of one command. Every command works from any directory.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import settings  # noqa: E402

ROOT = settings.ROOT
SCRIPTS = ROOT / "scripts"
BUILD = ROOT / "build"
PY = sys.executable

# Web tests that need the built site (./bleep build web) and get its folder as argument.
WEB_TESTS_NEED_SITE = {"graph-test", "voices-test", "play-presets-test"}
# Web tests that are not run by `test js`: smoke scripts that need a built plugin or a running host.
WEB_TESTS_SKIP = {"bridge-smoke", "host-smoke", "list-types", "spec-json"}


def run(cmd, **kw):
    """Runs a command, echoing it; stops this script when it fails."""
    cmd = [str(c) for c in cmd]
    print("+ " + " ".join(cmd), flush=True)
    r = subprocess.run(cmd, **kw)
    if r.returncode:
        sys.exit(r.returncode)
    return r


def have(tool):
    return shutil.which(tool) is not None


def cfg_name(args, s):
    return "Debug" if getattr(args, "debug", False) else s.get("buildConfig", "Release")


# ---- cmake builds -----------------------------------------------------------------------------------------------

def cmake(source: Path, build_dir: Path, config: str, defines: dict, target=None, test=False, clean=False):
    """Configure + build (+ ctest) one CMake tree, with Ninja for a fresh build dir and ccache when installed."""
    if clean:
        shutil.rmtree(build_dir, ignore_errors=True)
    conf = ["cmake", "-S", source, "-B", build_dir, f"-DCMAKE_BUILD_TYPE={config}"]
    if have("ninja") and not (build_dir / "CMakeCache.txt").exists():
        conf += ["-G", "Ninja"]
    if have("ccache"):
        conf += [f"-DCMAKE_{lang}_COMPILER_LAUNCHER=ccache" for lang in ("C", "CXX", "OBJCXX")]
    conf += [f"-D{k}={v}" for k, v in defines.items() if v != ""]
    run(conf, stdout=subprocess.DEVNULL if defines.get("_quiet") else None)
    build = ["cmake", "--build", build_dir, "--config", config, "--parallel"]
    if target:
        build += ["--target", target]
    run(build)
    if test:
        ctest = ["ctest", "--test-dir", build_dir, "-C", config, "--output-on-failure"]
        # The demo-patch and cell-preset shards render side by side; the rest runs one at a time (some tests share ports and folders).
        run([*ctest, "-R", "demo-patches|cell-plugin-presets", "--parallel", min(os.cpu_count() or 2, 6)])
        run([*ctest, "-E", "demo-patches|cell-plugin-presets"])


def onoff(b):
    return "ON" if b else "OFF"


def patch_defines(args, s, *, tests, app, install=False):
    return {
        "BLEEP_JUCE_DIR": args.juce or s.get("juceDir", ""),
        "BLEEP_FORMATS": "VST3",
        "BLEEP_BUILD_TESTS": onoff(tests),
        "BLEEP_BUILD_APP": onoff(app),
        "BLEEP_COPY_PLUGINS": onoff(install),
        "BLEEP_UI_DEV": onoff(args.ui_dev),
    }


def build_bus(args, s):
    cmake(ROOT / "bus", BUILD / "bus", cfg_name(args, s), {}, test=not args.no_test, clean=args.clean)
    print(f"\nBleep Bus built in {BUILD / 'bus'}")


def live_running():
    """Whether Ableton Live is running (macOS): the same test `run live` uses."""
    if sys.platform != "darwin":
        return False
    return bool(subprocess.run("pgrep -f '\\.app/Contents/MacOS/Live$' | head -1", shell=True, capture_output=True, text=True).stdout.strip())


def live_user_library():
    """Live's User Library: BLEEP_LIVE_USER_LIBRARY, else the default place (a library moved in Live's settings needs the variable)."""
    env = os.environ.get("BLEEP_LIVE_USER_LIBRARY")
    if env:
        return Path(env).expanduser()
    base = Path.home() / ("Music" if sys.platform == "darwin" else "Documents")
    return base / "Ableton" / "User Library"


def install_live_link_device(library=None):
    """Copies the Bleep Live Link device and its script into Live's User Library, so it shows up in Live's browser
    under User Library > Presets > Audio Effects > Max Audio Effect > bleep-live-link.
    A script that is already a link to the repo's copy is left alone (that is a development setup)."""
    src = ROOT / "patch" / "bridges" / "ableton" / "live-link"
    library = library or live_user_library()
    if not library.is_dir():
        print(f"Live's User Library not found at {library}: the Bleep Live Link device was not installed "
              "(set BLEEP_LIVE_USER_LIBRARY if you moved it).")
        return
    dest = library / "Presets" / "Audio Effects" / "Max Audio Effect" / "bleep-live-link"
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("Bleep Live Link.amxd", "live-link.js"):
        target = dest / name
        if target.exists() and (src / name).samefile(target):
            continue
        shutil.copy2(src / name, target)
    print(f"installed the Bleep Live Link device in {dest}")


def build_plugins(args, s):
    """The plugins as VST3 (and the standalone app unless --no-app), then the DSP, engine and bridge tests.
    Copies them to the user plugin folders unless told not to (--no-install). It also copies while Live is running:
    overwriting a plugin Live has loaded can crash it, so that is warned about."""
    config = cfg_name(args, s)
    install = args.install is not False
    if install and live_running():
        print("Ableton Live is running: the plugins are copied over ones it may have loaded, which can crash it. "
              "Quit Live first, or use --no-install.\n")
    d = patch_defines(args, s, tests=not (args.plugins_only or args.no_test_build), app=not args.no_app, install=install)
    cmake(ROOT / "patch", BUILD / "patch", config, d, test=not (args.no_test or args.plugins_only), clean=args.clean)
    if install:
        install_live_link_device()
    print("\nBleep plugins built (VST3):")
    for p in sorted((BUILD / "patch").glob(f"*_artefacts/{config}/*")):
        if p.suffix in (".app", ".vst3", ".exe"):
            print(f"  {p.relative_to(ROOT)}")
        elif p.is_dir():
            for q in sorted(p.iterdir()):
                if q.suffix in (".vst3", ".component", ".clap"):
                    print(f"  {q.relative_to(ROOT)}")


def build_app(args, s):
    """Only the standalone app, in its own build dir: build/patch is configured with other options and sharing it recompiled both."""
    config = cfg_name(args, s)
    cmake(ROOT / "patch", BUILD / "app", config, {
        "BLEEP_JUCE_DIR": args.juce or s.get("juceDir", ""), "BLEEP_FORMATS": "VST3",
        "BLEEP_BUILD_APP": "ON", "BLEEP_UI_DEV": onoff(args.ui_dev)}, target="BleepApp", clean=args.clean)


def app_bundle(config):
    return BUILD / "app" / "BleepApp_artefacts" / config / "Bleep App.app"


def build_web(args, s, modules=True, ui=True):
    cmd = [SCRIPTS / "build" / "build-web.sh"]
    if args.docker or s.get("webDocker"):
        cmd.append("--docker")
    if not modules:
        cmd.append("--no-modules")
    if not ui:
        cmd.append("--modules-only")
    if args.out:
        cmd.append(args.out)
    env = dict(os.environ)
    if s.get("juceDir"):
        env.setdefault("BLEEP_JUCE_DIR", s["juceDir"])
    for key, var in (("webOnly", "BLEEP_WEB_ONLY"), ("localModules", "BLEEP_LOCAL_MODULES")):
        if s.get(key):
            env.setdefault(var, s[key])
    run(cmd, env=env)


def build_agent_data(args, s):
    env = dict(os.environ)
    for var in ("GOOGLE_API_KEY", "OPENAI_API_KEY"):  # only these two lines of website/.env are read; the file is not sourced
        envfile = ROOT / "website" / ".env"
        if not env.get(var) and envfile.exists():
            for line in envfile.read_text().splitlines():
                if line.startswith(var + "="):
                    env[var] = line.split("=", 1)[1].strip().strip("\"'")
    py = os.environ.get("PYTHON", PY)
    if subprocess.run([py, "-c", "import bleep_agent"], capture_output=True).returncode:
        sys.exit("bleep_agent is not installed: python3 -m venv .venv-agent && .venv-agent/bin/pip install -e agent  (then PYTHON=.venv-agent/bin/python)")
    run([py, "-m", "bleep_agent.cli", "data", *args.extra], env=env, cwd=ROOT)


def ensure_hooks():
    """Points git at .githooks/ (the pre-commit check that demo-types.json is current) unless the clone has chosen hooks already."""
    if not (ROOT / ".githooks").is_dir() or not have("git"):
        return
    cur = subprocess.run(["git", "-C", str(ROOT), "config", "--get", "core.hooksPath"], capture_output=True, text=True).stdout.strip()
    if not cur:
        run(["git", "-C", ROOT, "config", "core.hooksPath", ".githooks"])
        print("git hooks: core.hooksPath = .githooks (pre-commit keeps patch/board/ui/demo-types.json current)")


# What a bare `./bleep build` builds. The plugins build includes the standalone app and web includes the modules;
# agent-data is left out: it calls paid model APIs.
ALL_BUILD_TARGETS = ["bus", "plugins", "web"]


def cmd_build(args, s):
    ensure_hooks()
    targets = args.targets or ALL_BUILD_TARGETS
    for t in targets:
        print(f"\n== build {t}")
        if t == "bus":
            build_bus(args, s)
        elif t == "plugins":
            build_plugins(args, s)
        elif t == "app":
            build_app(args, s)
        elif t == "web":
            build_web(args, s, modules=not args.no_modules)
        elif t == "modules":
            build_web(args, s, ui=False)
        elif t == "agent-data":
            build_agent_data(args, s)


# ---- run ------------------------------------------------------------------------------------------------------

def quit_app(name, bundle_id):
    if sys.platform != "darwin":
        return
    if subprocess.run(["pgrep", "-x", name], capture_output=True).returncode:
        return
    print(f"Asking the running {name} to quit…")
    subprocess.run(["osascript", "-e", f'tell application id "{bundle_id}" to quit'], capture_output=True)
    import time
    for _ in range(60):
        if subprocess.run(["pgrep", "-x", name], capture_output=True).returncode:
            return
        time.sleep(0.5)
    sys.exit("The app is still running (unsaved changes?). Quit it, then run this again.")


def run_app(args, s):
    config = cfg_name(args, s)
    if not args.no_build:
        build_app(args, s)
    app = app_bundle(config)
    binary = app / "Contents" / "MacOS" / "Bleep App"
    if not binary.exists():
        sys.exit(f"no app at {app.relative_to(ROOT)}: build it first (without --no-build)")
    quit_app("Bleep App", "com.brilliantbleep.patch.app")
    extra = (["--smoke"] if args.smoke else []) + [str(Path(p).resolve()) for p in args.project]
    print(f"Starting {app.relative_to(ROOT)} ({config}{', UI from source' if args.ui_dev else ''})")
    if sys.platform != "darwin":
        os.execv(str(binary), [str(binary), *extra])
    # Registered with LaunchServices first, or the Dock shows a generic icon.
    app.touch()
    subprocess.run(["/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", str(app)],
                   capture_output=True)
    proc = subprocess.Popen([str(binary), *extra])
    import time
    time.sleep(4)  # the window must be up: activating earlier does not take, and the terminal's menu bar stays
    if proc.poll() is None:
        subprocess.run(["osascript", "-e", f'tell application "System Events" to set frontmost of (first process whose unix id is {proc.pid}) to true'],
                       capture_output=True)
    try:
        sys.exit(proc.wait())
    except KeyboardInterrupt:
        proc.terminate()
        sys.exit(130)


def run_live(args, s):
    """Rebuilds the plugins, quits Ableton Live (never forced), replaces the VST3s and reopens the set."""
    if sys.platform != "darwin":
        sys.exit("run live supports macOS only")
    live_set = args.set or s.get("liveSet")
    if not live_set or not Path(live_set).expanduser().is_file():
        sys.exit("usage: ./bleep run live <set.als>   (or liveSet in config/bleep.local.json)")
    live_set = Path(live_set).expanduser().resolve()
    config = cfg_name(args, s)
    # Built without the CMake copy step: it would overwrite plugins Live has loaded.
    build_plugins(argparse.Namespace(**{**vars(args), "no_test": True, "plugins_only": True, "no_test_build": True, "no_app": args.no_app,
                                        "install": False, "clean": False}), s)
    pid = subprocess.run("pgrep -f '\\.app/Contents/MacOS/Live$' | head -1", shell=True, capture_output=True, text=True).stdout.strip()
    live_app = ""
    if pid:
        out = subprocess.run(["ps", "-o", "command=", "-p", pid], capture_output=True, text=True).stdout.strip()
        live_app = out.removesuffix("/Contents/MacOS/Live")
        print(f"quitting {Path(live_app).name} …")
        subprocess.run(["osascript", "-e", "on run argv", "-e", "tell application (item 1 of argv) to quit", "-e", "end run", live_app], capture_output=True)
        import time
        for waited in range(300):
            if subprocess.run(["kill", "-0", pid], capture_output=True).returncode:
                break
            time.sleep(1)
            if waited == 5:
                print("waiting for Live to quit (answer its save dialog if it shows one) …")
        else:
            sys.exit("Live is still running; giving up without touching the plugins.")
    if not live_app:
        apps = sorted(Path("/Applications").glob("Ableton Live*.app"))
        if not apps:
            sys.exit("no Ableton Live found in /Applications")
        live_app = str(apps[-1])
    dest = Path.home() / "Library/Audio/Plug-Ins/VST3"
    dest.mkdir(parents=True, exist_ok=True)
    for bundle in sorted((BUILD / "patch").glob(f"*_artefacts/{config}/VST3/*.vst3")):
        shutil.rmtree(dest / bundle.name, ignore_errors=True)  # new files, not an overwrite in place
        subprocess.run(["ditto", str(bundle), str(dest / bundle.name)], check=True)
        print(f"installed {bundle.name}")
    print(f"opening {live_set.name} in {Path(live_app).name}")
    run(["open", "-a", live_app, live_set])


def run_site(args, s):
    compose = ["docker", "compose", "-f", ROOT / "website" / "docker-compose.yml"]
    if args.action == "up":
        run([*compose, "up", "--build", "-d"])
        print(f"site: http://localhost:{os.environ.get('BLEEP_SITE_PORT', '8080')}")
    elif args.action == "rebuild":
        run([*compose, "build", "--no-cache"])
        run([*compose, "up", "-d"])
    elif args.action == "down":
        run([*compose, "down"])
    else:
        run([*compose, "logs", "-f"])


def run_play(args, s):
    """The dev site's Bleep Play: regenerates demo-types.json, rebuilds the modules and the board UI + web engine."""
    d = BUILD / "patch"
    defines = {"BLEEP_JUCE_DIR": args.juce or s.get("juceDir", ""), "BLEEP_FORMATS": "VST3", "BLEEP_BUILD_TESTS": "ON"}
    if not (d / "CMakeCache.txt").exists():
        run(["cmake", "-S", ROOT / "patch", "-B", d, "-DCMAKE_BUILD_TYPE=Release", *[f"-D{k}={v}" for k, v in defines.items()]])
    run(["cmake", "--build", d, "--config", "Release", "--target", "bleep_dump_types", "--parallel"])
    dump = next((p for p in d.rglob("bleep_dump_types") if p.is_file() and os.access(p, os.X_OK)), None)
    if dump is None:
        sys.exit("bleep_dump_types was not built")
    run([dump, "--write", "patch/board/ui/demo-types.json"], cwd=ROOT)
    build_web(args, s, ui=False)
    run(["docker", "compose", "-f", "website/docker-compose.yml", "-f", "website/docker-compose.dev.yml", "--env-file", "website/.env",
         "run", "--rm", "play"], cwd=ROOT)
    print("Bleep Play updated: modules and board UI. Reload the page.")


def cmd_run(args, s):
    {"app": run_app, "live": run_live, "site": run_site, "play": run_play}.get(args.what, lambda a, s: None)(args, s)
    if args.what == "ui":
        os.execv(PY, [PY, str(SCRIPTS / "run" / "ui-server.py"), *args.extra])


# ---- test / check / docs ------------------------------------------------------------------------------------------

def test_py(args, s):
    """The unit tests of the scripts: release, the settings and this command."""
    failed = [f for f in ("release", "tests")
              if subprocess.run([PY, "-m", "unittest", "discover", "-s", f, "-p", "test_*.py"], cwd=SCRIPTS).returncode]
    if failed:
        sys.exit("failed: scripts/" + ", scripts/".join(failed))


def test_js(args, s):
    tests = sorted(p for p in (ROOT / "patch" / "web" / "test").glob("*-test.mjs") if p.stem not in WEB_TESTS_SKIP)
    site = Path(args.site) if args.site else BUILD / "web" / "site"
    failed = []
    for t in tests:
        extra = []
        if t.stem in WEB_TESTS_NEED_SITE:
            if not site.is_dir():
                print(f"skip {t.name}: needs the built site (./bleep build web)")
                continue
            extra = [site]
        if subprocess.run(["node", str(t), *map(str, extra)], cwd=ROOT).returncode:
            failed.append(t.name)
        else:
            print(f"ok   {t.name}")
    if failed:
        sys.exit("failed: " + ", ".join(failed))


def test_script(args, s):
    if not (ROOT / "patch/script/node_modules").exists():
        run(["npm", "ci", "--no-audit", "--no-fund"], cwd=ROOT / "patch" / "script")
    run(["npm", "test"], cwd=ROOT / "patch" / "script")


def test_presets(args, s):
    for f in ("build.mjs", "build-modules.mjs", "build-docs.mjs"):
        run(["node", ROOT / "patch" / "presets" / f, "--check"])


def test_bus(args, s):
    run(["ctest", "--test-dir", BUILD / "bus", "-C", cfg_name(args, s), "--output-on-failure"])


def test_native(args, s):
    """Builds the DSP, engine and host tests of patch/ (no plugins, no JUCE needed) and runs them."""
    cmake(ROOT / "patch", BUILD / "patch-tests", cfg_name(args, s), {"BLEEP_BUILD_PLUGINS": "OFF", "BLEEP_JUCE_DIR": s.get("juceDir", "")}, test=True)


def check_repo(args, s):
    run([PY, SCRIPTS / "check" / "check-repo.py"])


def check_api_docs(args, s):
    run([PY, SCRIPTS / "check" / "check-api-docs.py"])


def check_account(args, s):
    run([PY, SCRIPTS / "check" / "account-live.py", *args.extra])


CHECKS = {"repo": check_repo, "api-docs": check_api_docs, "account": check_account}
TESTS = {"py": test_py, "js": test_js, "script": test_script, "presets": test_presets, "bus": test_bus, "native": test_native}
DEFAULT_TESTS = ["py", "js", "presets"]


def cmd_test(args, s):
    names = args.suites or DEFAULT_TESTS + ["check"]
    if "all" in names:
        names = ["bus", "native", "py", "js", "script", "presets", "check"]
    for n in names:
        print(f"\n== test {n}")
        if n == "check":
            check_repo(args, s)
            check_api_docs(args, s)
        else:
            TESTS[n](args, s)


def cmd_check(args, s):
    for n in args.what or ["repo", "api-docs"]:
        CHECKS[n](args, s)


def cmd_docs(args, s):
    what = args.what or "build"
    if what == "build":
        run([PY, SCRIPTS / "docs" / "build-docs.py", *args.extra])
    elif what == "help-index":
        run([PY, SCRIPTS / "docs" / "build-help-index.py", *args.extra])
    else:
        run([PY, SCRIPTS / "docs" / "module-screenshots.py", *args.extra])


# ---- package / release ----------------------------------------------------------------------------------------------

def default_data_dir():
    """The folder the app and the plugins read installed modules from (library::defaultDataDir): BLEEP_DATA_DIR, else per platform."""
    if os.environ.get("BLEEP_DATA_DIR"):
        return Path(os.environ["BLEEP_DATA_DIR"]).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Bleep"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home())) / "Bleep"
    return Path.home() / ".local" / "share" / "Bleep"


def cmd_package(args, s):
    """Packages the modules and, by default, installs them into the data folder (modules/local), where the app
    and the plugins read modules from. --no-install only packages; --install DATA installs somewhere else."""
    cmd = [PY, SCRIPTS / "release" / "package-module.py", *args.modules]
    if not args.no_install:
        cmd += ["--install", str(args.install or default_data_dir())]
    run(cmd)


def cmd_release(args, s):
    """plugins: build when asked, then release.py. modules: build the .wasm files, package them, release what changed."""
    if args.what == "community":
        run([PY, SCRIPTS / "release" / "community-publish.py", *args.extra])
        return
    base = [PY, SCRIPTS / "release" / "release.py"]
    common = []  # registry, token file and channel are read from the settings by release.py itself
    if args.dry_run:
        common.append("--dry-run")
    if args.yes:
        common.append("-y")
    if args.what == "plugins":
        names = args.names or ["--all"]
        if args.build:
            build_plugins(argparse.Namespace(debug=False, juce=None, ui_dev=False, plugins_only=True, no_test=True, no_test_build=True,
                                             no_app=False, install=False, clean=False), s)
        tail = ["--add-platform", args.add_platform] if args.add_platform else ["--level", args.level or ""]
        if not args.add_platform and not args.level:
            sys.exit("--level is required: x, 1.x, 1.4.x, major, minor or patch (or --add-platform VERSION)")
        run([*base, *names, *tail, *common, *(["--notes", args.notes] if args.notes else [])])
    else:
        if not args.level:
            sys.exit("--level is required: x, 1.x, 1.4.x, major, minor or patch")
        if not args.no_build:
            build_web(argparse.Namespace(docker=False, out=None), s, ui=False)
        run([*base, "--modules", "--package", *args.names, "--level", args.level, *common, *(["--force"] if args.force else []),
             *(["--notes", args.notes] if args.notes else [])])


def cmd_config(args, s):
    print(f"shared: {settings.SHARED.relative_to(ROOT)}\nlocal:  {settings.LOCAL.relative_to(ROOT)} "
          f"({'present' if settings.LOCAL.exists() else 'absent; copy config/bleep.local.example.json'})\n")
    for k, v in sorted(s.items()):
        print(f"  {k:18} {v}")


# ---- command line -------------------------------------------------------------------------------------------------------

def parser():
    ap = argparse.ArgumentParser(prog="bleep", description=__doc__.split("\n")[0], epilog=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def native_opts(p):
        p.add_argument("--debug", action="store_true")
        p.add_argument("--juce", help="local JUCE checkout (or juceDir in the config; otherwise JUCE 8.0.9 is downloaded)")
        p.add_argument("--ui-dev", action="store_true", help="the plugins and the app read the board UI from patch/ (Cmd-R in the board window)")
        p.add_argument("--clean", action="store_true")

    b = sub.add_parser("build", help="build bus, plugins, app, web, modules or agent-data")
    b.add_argument("targets", nargs="*", choices=["bus", "plugins", "app", "web", "modules", "agent-data", []], metavar="TARGET",
                   help="bus | plugins | app | web | modules | agent-data (default: bus plugins web)")
    native_opts(b)
    b.add_argument("--no-test", action="store_true", help="skip ctest after the build")
    b.add_argument("--plugins-only", action="store_true", help="no test targets (they compile every module in), no ctest")
    b.add_argument("--no-test-build", action="store_true", help=argparse.SUPPRESS)
    b.add_argument("--no-app", action="store_true", help="plugins without the standalone app")
    b.add_argument("--install", action=argparse.BooleanOptionalAction, default=None,
                   help="plugins: copy the plugins into the user plugin folders (the default, also while Ableton Live is running, "
                        "which can crash a Live that has them loaded); --no-install only builds")
    b.add_argument("--docker", action="store_true", help="web/modules: build in the Emscripten Docker image (or webDocker in the config)")
    b.add_argument("--no-modules", action="store_true", help="web: only the board UI and the web engine")
    b.add_argument("--out", help="web/modules: output folder")
    b.add_argument("extra", nargs="*", help=argparse.SUPPRESS)
    b.set_defaults(fn=cmd_build)

    r = sub.add_parser("run", help="run app, ui, site, play or live")
    r.add_argument("what", choices=["app", "ui", "site", "play", "live"])
    native_opts(r)
    r.add_argument("--no-build", action="store_true", help="app: start the last build as it is")
    r.add_argument("--smoke", action="store_true", help="app: start without audio inputs and Link, print a report, quit")
    r.add_argument("--no-app", action="store_true", help="live: skip the standalone app when rebuilding")
    r.add_argument("--docker", action="store_true", help="play: modules in the Emscripten image")
    r.add_argument("--out", help=argparse.SUPPRESS)
    r.add_argument("--action", choices=["up", "down", "logs", "rebuild"], default="up", help="site")
    r.add_argument("--set", help="live: the Ableton set to reopen (or liveSet in the config)")
    r.add_argument("project", nargs="*", help="app: a .bleepboard project to open")
    r.add_argument("extra", nargs="*", help=argparse.SUPPRESS)
    r.set_defaults(fn=cmd_run)

    t = sub.add_parser("test", help="run the unit tests: py js script presets bus native check, or all")
    t.add_argument("suites", nargs="*", choices=["py", "js", "script", "presets", "bus", "native", "check", "all", []], metavar="SUITE")
    t.add_argument("--debug", action="store_true")
    t.add_argument("--site", help="js: the built site for the tests that need it (default build/web/site)")
    t.set_defaults(fn=cmd_test)

    c = sub.add_parser("check", help="repo rules, api docs, live account sign-in")
    c.add_argument("what", nargs="*", choices=["repo", "api-docs", "account", []], metavar="CHECK")
    c.add_argument("extra", nargs="*", help=argparse.SUPPRESS)
    c.set_defaults(fn=cmd_check)

    d = sub.add_parser("docs", help="build the single-file docs, the help index or the module screenshots")
    d.add_argument("what", nargs="?", choices=["build", "help-index", "screenshots"])
    d.add_argument("extra", nargs="*")
    d.set_defaults(fn=cmd_docs)

    p = sub.add_parser("package", help="package built modules as .bleepmod files")
    p.add_argument("modules", nargs="*")
    p.add_argument("--install", metavar="DATA", help="install into DATA/modules/local instead of the default data folder (the app's and the plugins')")
    p.add_argument("--no-install", action="store_true", help="only package: do not install (the default is to install)")
    p.set_defaults(fn=cmd_package)

    rl = sub.add_parser("release", help="release plugins or modules to the library, or share a community module")
    rl.add_argument("what", choices=["plugins", "modules", "community"])
    rl.add_argument("names", nargs="*", help="plugin ids or module slugs (default: all)")
    rl.add_argument("--level", help="x, 1.x, 1.4.x, major, minor or patch")
    rl.add_argument("--add-platform", metavar="VERSION|latest", help="plugins: add this machine's build to a published version")
    rl.add_argument("--build", action="store_true", help="plugins: build first")
    rl.add_argument("--no-build", action="store_true", help="modules: do not rebuild the .wasm files first")
    rl.add_argument("--force", action="store_true", help="modules: release even if the content did not change")
    rl.add_argument("--notes", default="")
    rl.add_argument("--dry-run", action="store_true")
    rl.add_argument("-y", "--yes", action="store_true")
    rl.set_defaults(fn=cmd_release)

    sub.add_parser("config", help="show the effective settings").set_defaults(fn=cmd_config)
    return ap


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    ap = parser()
    # `release community` and `docs`, `check account`, `run ui`, `build agent-data` pass their options through untouched.
    passthrough = len(argv) >= 2 and (argv[0], argv[1]) in {("release", "community"), ("run", "ui"), ("check", "account")} or \
        len(argv) >= 1 and argv[0] in {"docs"} or len(argv) >= 2 and (argv[0], argv[1]) == ("build", "agent-data")
    if passthrough:
        head, rest = argv[:2] if argv[0] != "docs" else argv[:1], argv[2:] if argv[0] != "docs" else argv[1:]
        if argv[0] == "docs" and rest and rest[0] in ("build", "help-index", "screenshots"):
            head, rest = argv[:2], argv[2:]
        args = ap.parse_args(head)
        args.extra = rest
    else:
        args, rest = ap.parse_known_args(argv)
        # argparse closes a "*" positional that matched nothing before an option: names after the options are the same list.
        late = [a for a in rest if not a.startswith("-")]
        if rest != late or not hasattr(args, "names") and not hasattr(args, "targets") and not hasattr(args, "modules") and late:
            ap.error("unrecognized arguments: " + " ".join(rest))
        for field in ("names", "targets", "modules"):
            if late and hasattr(args, field):
                getattr(args, field).extend(late)
                break
    args.fn(args, settings.load())


if __name__ == "__main__":
    main()
