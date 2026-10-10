# SPDX-License-Identifier: MIT
"""python3 -m unittest scripts/release/test_release.py"""
import argparse
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import release  # noqa: E402
from release import next_version  # noqa: E402
from app import signing  # noqa: E402


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


class FakeStore:
    """The few calls release_modules makes; `published` is {slug: {version: entry.json}}."""

    def __init__(self, published):
        self.published, self.token, self.released = published, "t", []

    def check_token(self): pass
    def roots(self): return [self.root_pub]
    def versions(self, slug, kind="plugin"): return list(self.published.get(slug, {}))
    def entry(self, slug, version, kind="plugin"): return self.published.get(slug, {}).get(version)

    def release(self, slug, version, channel, title, notes, files, kind="plugin", summary="", category="", image=None, license="", origin=None):
        self.licenses = getattr(self, "licenses", {}) | {slug: (license, origin)}
        self.released.append((slug, version, kind, title, files[0]["declaration"]))
        self.tiles = getattr(self, "tiles", {}) | {slug: (summary, category, image)}


class ReleaseModules(unittest.TestCase):
    def setUp(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        cert = signing.make_cert(root, None, signing.new_tbs("issuer", signing.public_bytes(issuer), publisher="bleep", scopes=["issue"],
                                                             not_before=0, not_after=2**33))
        self.kit = signing.issue_kit(issuer, cert, "bleep", scopes=("module",), first_party=True)
        self.root_pub = signing.public_bytes(root)
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
        self.digests[slug] = signing.content_digest(signing.read_entries(self.dir / f"{slug}.bleepmod")).hex()

    def run_release(self, published, *names, force=False, dry=False, level="patch"):
        store = FakeStore(published)
        store.root_pub = self.root_pub
        args = argparse.Namespace(packages=self.dir, package=False, plugins=list(names), level=level, channel="stable", notes="", force=force,
                                  dry_run=dry, yes=True, registry="http://store")
        out = io.StringIO()
        with redirect_stdout(out):
            code = release.release_modules(args, store, self.kit)
        return code, store, out.getvalue()

    def entry(self, slug):
        return {"files": [{"contentDigest": self.digests[slug]}]}

    def test_first_release_of_everything(self):
        code, store, out = self.run_release({}, level="x")
        self.assertEqual(code, 0)
        self.assertEqual(sorted((s, v) for s, v, *_ in store.released), [("alpha", "0.1.0"), ("beta", "0.1.0")])
        self.assertIn("2 to release, 0 unchanged", out)

    def test_unchanged_modules_are_skipped_and_changed_ones_count_up(self):
        published = {"alpha": {"1.2.3": self.entry("alpha")}, "beta": {"1.0.0": self.entry("beta")}}
        self.make("beta", b"new code of beta")  # alpha is as published, beta changed
        code, store, out = self.run_release(published)
        self.assertEqual([(s, v) for s, v, *_ in store.released], [("beta", "1.0.1")])
        self.assertIn("alpha", out)
        self.assertIn("unchanged", out)

    def test_force_releases_unchanged_too(self):
        published = {"alpha": {"1.2.3": self.entry("alpha")}, "beta": {"1.0.0": self.entry("beta")}}
        _, store, _ = self.run_release(published, force=True)
        self.assertEqual(sorted((s, v) for s, v, *_ in store.released), [("alpha", "1.2.4"), ("beta", "1.0.1")])

    def test_the_newest_version_is_the_one_compared(self):
        published = {"alpha": {"1.0.0": self.entry("alpha"), "2.0.0": {"files": [{"contentDigest": "old"}]}}}
        _, store, _ = self.run_release(published, "alpha")
        self.assertEqual([(s, v) for s, v, *_ in store.released], [("alpha", "2.0.1")])  # 1.0.0 matches, but 2.0.0 is what clients get

    def test_what_is_declared_signed_and_titled(self):
        _, store, _ = self.run_release({}, "alpha", level="x")
        slug, version, kind, title, decl = store.released[0]
        self.assertEqual((kind, title, decl["path"], decl["platform"], decl["contentDigest"]), ("module", "Alpha", "alpha-0.1.0.bleepmod", "any", self.digests["alpha"]))
        res = signing.verify(bytes.fromhex(decl["contentDigest"]), decl["signature"], kind="module", id_="alpha", version="0.1.0",
                             roots=[self.root_pub])
        self.assertEqual(res.status, "signed")
        self.assertEqual(decl["sha256"], release.sha256(self.dir / "alpha.bleepmod"))

    def test_the_tile_is_summary_category_and_screenshot_of_the_package(self):
        _, store, _ = self.run_release({}, "alpha", "beta", level="x")
        self.assertEqual(store.tiles["alpha"], ("About alpha.", "Sources", b"\x89PNG\r\n\x1a\nalpha"))
        self.assertEqual(store.tiles["beta"], ("About beta.", "Sources", None))  # no screenshot: the store draws a placeholder

    def test_the_licence_of_the_package_goes_to_the_store(self):
        _, store, _ = self.run_release({}, "alpha", level="x")
        self.assertEqual(store.licenses["alpha"], ("MIT", None))  # a package that states none is MIT (package-module.py)

    def test_a_dry_run_releases_nothing(self):
        code, store, out = self.run_release({}, dry=True)
        self.assertEqual((code, store.released), (0, []))
        self.assertIn("Dry run", out)

    def test_a_module_without_a_package_is_an_error(self):
        with self.assertRaises(SystemExit):
            self.run_release({}, "gamma")
