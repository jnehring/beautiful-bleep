# SPDX-License-Identifier: MIT
"""python3 -m unittest scripts/release/test_release.py"""
import argparse
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from unittest import mock
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import release  # noqa: E402
from release import next_version  # noqa: E402


class NextVersion(unittest.TestCase):
    def test_levels(self):
        have = ["1.0.0", "1.4.2", "1.4.10", "2.0.0", "2.3.1"]
        for level, want in {"x": "3.0.0", "1.x": "1.5.0", "2.x": "2.4.0", "1.4.x": "1.4.11", "2.3.x": "2.3.2",
                            "major": "3.0.0", "minor": "2.4.0", "patch": "2.3.2", "3.x": "3.0.0", "1.9.x": "1.9.0"}.items():
            self.assertEqual(next_version(level, have), want, level)

    def test_numeric_not_lexical(self):
        self.assertEqual(next_version("1.4.x", ["1.4.9", "1.4.10"]), "1.4.11")

    def test_nothing_published(self):
        for level, want in {"x": "0.1.0", "0.x": "0.1.0", "0.0.x": "0.1.0", "1.x": "1.0.0", "patch": "0.1.0", "minor": "0.1.0"}.items():
            self.assertEqual(next_version(level, []), want, level)

    def test_bad_levels(self):
        for level in ("", "1", "1.2.3", "x.1", "1.x.2", "1.2.3.x", "big"):
            with self.assertRaises(ValueError, msg=level):
                next_version(level, ["1.0.0"])


if __name__ == "__main__":
    unittest.main()


class DevVersions(unittest.TestCase):
    def test_the_version_after_the_public_one(self):
        self.assertEqual(release.dev_version(["1.4.2", "1.4.3"], "202610271432"), "1.4.4-dev.202610271432")
        self.assertEqual(release.dev_version([], "202610271432"), "0.1.0-dev.202610271432")

    def test_the_build_time_is_the_commit_time_in_utc(self):
        with mock.patch.object(release.subprocess, "run") as run:
            run.return_value.stdout = "1792000000\n"   # 2026-10-14 17:46:40 UTC
            self.assertEqual(release.build_time(), "202610141746")


class Pinning(unittest.TestCase):
    def test_plain_http_is_for_localhost_only(self):
        release.Registry("https://library.example", "t")
        release.Registry("http://localhost:8080", "t")
        release.Registry("http://127.0.0.1:8080", "t")
        for url in ("http://library.example", "ftp://library.example", "library.example"):
            with self.assertRaises(release.RegistryError):
                release.Registry(url, "t")


class Retries(unittest.TestCase):
    """A request that did not get through (no connection) is sent again; one the server answered or may have carried out is not."""

    def _open(self, effects, data=None):
        with mock.patch.object(release.urllib.request, "urlopen", side_effect=effects) as urlopen, \
                mock.patch.object(release.time, "sleep") as sleep, redirect_stderr(io.StringIO()):
            try:
                return release.open_retrying("https://library.example/api/registry/token", data), urlopen.call_count, sleep.call_count
            except Exception as e:
                return e, urlopen.call_count, sleep.call_count

    def test_a_connection_that_times_out_is_tried_again(self):
        gone = release.urllib.error.URLError(TimeoutError(60, "Operation timed out"))
        result, calls, sleeps = self._open([gone, gone, "answer"])
        self.assertEqual((result, calls, sleeps), ("answer", 3, 2))

    def test_it_gives_up_after_the_last_retry(self):
        gone = release.urllib.error.URLError(ConnectionRefusedError())
        result, calls, _ = self._open([gone] * 10)
        self.assertIsInstance(result, release.urllib.error.URLError)
        self.assertEqual(calls, len(release.RETRY_WAITS) + 1)

    def test_an_error_status_is_not_retried(self):
        refused = release.urllib.error.HTTPError("u", 409, "conflict", {}, io.BytesIO(b""))
        result, calls, _ = self._open([refused, "answer"])
        self.assertIs(result, refused)
        self.assertEqual(calls, 1)

    def test_a_break_while_waiting_for_the_answer_is_not_retried(self):
        result, calls, _ = self._open([ConnectionResetError(), "answer"])
        self.assertIsInstance(result, ConnectionResetError)
        self.assertEqual(calls, 1)

    def test_a_file_body_is_rewound_before_a_retry(self):
        body = io.BytesIO(b"package")
        body.read()
        self._open([release.urllib.error.URLError(TimeoutError()), "answer"], body)
        self.assertEqual(body.tell(), 0)


class FakeLibrary:
    """The few calls release_modules makes; `published` is {slug: {version: entry.json}}."""

    def __init__(self, published):
        self.published, self.token, self.released = published, "t", []

    def check_token(self): pass
    def versions(self, slug, kind="plugin"): return [v for v in self.published.get(slug, {}) if "-dev" not in v]   # the public ones
    def entry(self, slug, version, kind="plugin"): return self.published.get(slug, {}).get(version)
    def newest(self, slug, kind="plugin", dev=False):
        have = self.published.get(slug, {})
        return {"version": max(have, key=lambda v: (release.parse_version(v.split("-")[0]), "-dev" in v, v)), "files": list(have[max(have, key=lambda v: (release.parse_version(v.split("-")[0]), "-dev" in v, v))]["files"])} if have else None

    def release(self, slug, version, channel, title, notes, files, kind="plugin", summary="", category="", image=None, license="", origin=None):
        self.licenses = getattr(self, "licenses", {}) | {slug: (license, origin)}
        self.released.append((slug, version, kind, title, files[0]["declaration"]))
        self.tiles = getattr(self, "tiles", {}) | {slug: (summary, category, image)}


class SourcePlugins(unittest.TestCase):
    """The Max for Live device is taken from the sources: one zip for every platform, nothing to add from another machine."""

    def run_main(self, *argv, published=None):
        lib = FakeLibrary(published or {})
        lib.added = []
        lib.add_platform = lambda slug, version, files: lib.added.append((slug, version))
        out = io.StringIO()
        with mock.patch.object(release, "Registry", return_value=lib), mock.patch.object(release, "read_token", return_value="t"), \
                redirect_stdout(out), redirect_stderr(io.StringIO()):
            code = release.main([*argv, "--registry", "https://library.example", "--yes"])
            self.names = {}   # the zips it wrote into build/release
            for z in (release.ROOT / "build" / "release").glob("bleep-live-link-*-any.zip"):
                with zipfile.ZipFile(z) as f:
                    self.names[z.name] = sorted(f.namelist())
        return code, lib, out.getvalue()

    def test_it_is_released_for_any_platform_with_its_two_files(self):
        code, lib, _ = self.run_main("bleep-live-link", "--level", "0.x")
        self.assertEqual(code, 0)
        slug, version, kind, title, declared = lib.released[0]
        self.assertEqual((slug, version, title), ("bleep-live-link", "0.1.0", "Bleep Live Link (Max for Live)"))
        self.assertEqual((declared["platform"], declared["path"]), ("any", "bleep-live-link-0.1.0-any.zip"))
        self.assertEqual(self.names["bleep-live-link-0.1.0-any.zip"], ["Bleep Live Link/Bleep Live Link.amxd", "Bleep Live Link/live-link.js"])
        self.assertIn("GPL-3.0-only", lib.licenses["bleep-live-link"][0])
        self.assertEqual(lib.tiles["bleep-live-link"][1], "Max for Live")

    def test_adding_a_platform_skips_it(self):
        code, lib, out = self.run_main("bleep-live-link", "--add-platform", "0.1.0", published={"bleep-live-link": {"0.1.0": {"files": []}}})
        self.assertEqual((code, lib.added), (0, []))
        self.assertIn("nothing to add", out)

    def test_it_is_in_the_list(self):
        out = io.StringIO()
        with redirect_stdout(out):
            release.main(["--list"])
        self.assertIn("bleep-live-link", out.getvalue())


class ReleaseModules(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.digests = {}
        for slug in ("alpha", "beta"):
            self.make(slug, b"code of " + slug.encode())

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, slug, code):
        with zipfile.ZipFile(self.dir / f"{slug}.bleepmod", "w") as z:
            z.writestr("module.json", json.dumps({"name": slug.title(), "slug": slug, "summary": f"About {slug}.", "category": "Sources"}))
            z.writestr("module.wasm", code)
            if slug == "alpha":
                z.writestr("doc/alpha.png", b"\x89PNG\r\n\x1a\nalpha")
        self.digests[slug] = release.sha256(self.dir / f"{slug}.bleepmod")

    def run_release(self, published, *names, force=False, dry=False, level="patch", dev=False):
        library = FakeLibrary(published)
        args = argparse.Namespace(packages=self.dir, package=False, plugins=list(names), level=level, channel="dev" if dev else "stable", notes="", force=force,
                                  dry_run=dry, yes=True, registry="http://library", dev=dev, build_time="202610271432")
        out = io.StringIO()
        with redirect_stdout(out):
            code = release.release_modules(args, library)
        return code, library, out.getvalue()

    def entry(self, slug):
        return {"files": [{"sha256": self.digests[slug]}]}

    def test_first_release_of_everything(self):
        code, library, out = self.run_release({}, level="x")
        self.assertEqual(code, 0)
        self.assertEqual(sorted((s, v) for s, v, *_ in library.released), [("alpha", "0.1.0"), ("beta", "0.1.0")])
        self.assertIn("2 to release, 0 unchanged", out)

    def test_unchanged_modules_are_skipped_and_changed_ones_count_up(self):
        published = {"alpha": {"1.2.3": self.entry("alpha")}, "beta": {"1.0.0": self.entry("beta")}}
        self.make("beta", b"new code of beta")  # alpha is as published, beta changed
        code, library, out = self.run_release(published)
        self.assertEqual([(s, v) for s, v, *_ in library.released], [("beta", "1.0.1")])
        self.assertIn("alpha", out)
        self.assertIn("unchanged", out)

    def test_force_releases_unchanged_too(self):
        published = {"alpha": {"1.2.3": self.entry("alpha")}, "beta": {"1.0.0": self.entry("beta")}}
        _, library, _ = self.run_release(published, force=True)
        self.assertEqual(sorted((s, v) for s, v, *_ in library.released), [("alpha", "1.2.4"), ("beta", "1.0.1")])

    def test_the_newest_version_is_the_one_compared(self):
        published = {"alpha": {"1.0.0": self.entry("alpha"), "2.0.0": {"files": [{"sha256": "old"}]}}}
        _, library, _ = self.run_release(published, "alpha")
        self.assertEqual([(s, v) for s, v, *_ in library.released], [("alpha", "2.0.1")])  # 1.0.0 matches, but 2.0.0 is what clients get

    def test_what_is_declared_and_titled(self):
        _, library, _ = self.run_release({}, "alpha", level="x")
        slug, version, kind, title, decl = library.released[0]
        self.assertEqual((kind, title, decl["path"], decl["platform"]), ("module", "Alpha", "alpha-0.1.0.bleepmod", "any"))
        self.assertEqual(decl["sha256"], release.sha256(self.dir / "alpha.bleepmod"))

    def test_the_tile_is_summary_category_and_screenshot_of_the_package(self):
        _, library, _ = self.run_release({}, "alpha", "beta", level="x")
        self.assertEqual(library.tiles["alpha"], ("About alpha.", "Sources", b"\x89PNG\r\n\x1a\nalpha"))
        self.assertEqual(library.tiles["beta"], ("About beta.", "Sources", None))  # no screenshot: the library draws a placeholder

    def test_the_licence_of_the_package_goes_to_the_store(self):
        _, library, _ = self.run_release({}, "alpha", level="x")
        self.assertEqual(library.licenses["alpha"], ("MIT", None))  # a package that states none is MIT (package-module.py)

    def test_development_builds_count_from_the_public_version_and_carry_the_build_time(self):
        published = {"alpha": {"1.2.3": self.entry("alpha")}, "beta": {"1.0.0": self.entry("beta")}}
        self.make("beta", b"new code of beta")
        _, library, out = self.run_release(published, dev=True)
        self.assertEqual([(s, v) for s, v, *_ in library.released], [("beta", "1.0.1-dev.202610271432")])   # alpha: as published
        self.assertIn("1 to release, 1 unchanged", out)
        _, library, _ = self.run_release({}, "alpha", dev=True)
        self.assertEqual([(s, v) for s, v, *_ in library.released], [("alpha", "0.1.0-dev.202610271432")])

    def test_a_package_equal_to_the_newest_development_build_is_not_released_again(self):
        published = {"alpha": {"1.2.3": {"files": [{"sha256": "old"}]}, "1.2.4-dev.202610271400": self.entry("alpha")}}
        _, library, _ = self.run_release(published, "alpha", dev=True)
        self.assertEqual(library.released, [])

    def test_a_dry_run_releases_nothing(self):
        code, library, out = self.run_release({}, dry=True)
        self.assertEqual((code, library.released), (0, []))
        self.assertIn("Dry run", out)

    def test_a_module_without_a_package_is_an_error(self):
        with self.assertRaises(SystemExit):
            self.run_release({}, "gamma")
