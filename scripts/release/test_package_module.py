# SPDX-License-Identifier: MIT
"""python3 -m unittest scripts/release/test_package_module.py   (needs the `cryptography` package)"""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("package_module", HERE / "package-module.py")
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)
from app import signing  # noqa: E402  (package-module.py put website/api on the path)


def leb(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def name(s: str) -> bytes:
    return leb(len(s.encode())) + s.encode()


def section(sid: int, body: bytes) -> bytes:
    return bytes([sid]) + leb(len(body)) + body


def make_wasm(imports=(), exports=()) -> bytes:
    """A binary with these imports ((module, name) functions) and exports (names) and nothing else: enough for check_abi."""
    data = b"\0asm\x01\0\0\0"
    if imports:
        data += section(2, leb(len(imports)) + b"".join(name(m) + name(n) + b"\x00" + leb(0) for m, n in imports))
    data += section(7, leb(len(exports)) + b"".join(name(n) + b"\x00" + leb(0) for n in exports))
    return data


GOOD_IMPORTS = [("env", "emscripten_notify_memory_growth"), ("wasi_snapshot_preview1", "fd_write")]


class AbiCheck(unittest.TestCase):
    def test_a_conforming_file_passes(self):
        self.assertEqual(pm.check_abi(make_wasm(GOOD_IMPORTS, sorted(pm.REQUIRED_EXPORTS))), [])

    def test_extra_exports_are_fine(self):
        self.assertEqual(pm.check_abi(make_wasm([], sorted(pm.REQUIRED_EXPORTS) + ["something_else"])), [])

    def test_an_import_the_abi_does_not_allow_is_refused(self):
        problems = pm.check_abi(make_wasm(GOOD_IMPORTS + [("wasi_snapshot_preview1", "path_open")], sorted(pm.REQUIRED_EXPORTS)))
        self.assertEqual(len(problems), 1)
        self.assertIn("path_open", problems[0])
        self.assertTrue(pm.check_abi(make_wasm([("env", "fetch")], sorted(pm.REQUIRED_EXPORTS))))

    def test_a_missing_export_is_named(self):
        have = sorted(pm.REQUIRED_EXPORTS - {"bleep_process"})
        self.assertEqual(pm.check_abi(make_wasm([], have)), ["does not export bleep_process"])

    def test_not_a_wasm_file(self):
        self.assertTrue(pm.check_abi(b"hello"))
        self.assertTrue(pm.check_abi(b"\0asm\x02\0\0\0"))

    def test_a_truncated_file_is_a_problem_not_a_crash(self):
        good = make_wasm(GOOD_IMPORTS, sorted(pm.REQUIRED_EXPORTS))
        self.assertTrue(pm.check_abi(good[:-5]))


class Package(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.folder = self.dir / "fuzz"
        (self.folder / "ui").mkdir(parents=True)
        (self.folder / "doc").mkdir()
        (self.folder / "module.json").write_text(json.dumps({"name": "Fuzz", "slug": "fuzz", "doc": "doc/fuzz.md"}))
        (self.folder / "ui" / "fuzz.js").write_text("// view")
        (self.folder / "ui" / "notes.txt").write_text("not packaged")
        (self.folder / "doc" / "fuzz.md").write_text("# Fuzz")
        (self.folder / "doc" / "fuzz.png").write_bytes(b"\x89PNG")
        self.wasm = make_wasm(GOOD_IMPORTS, sorted(pm.REQUIRED_EXPORTS))

    def tearDown(self):
        self.tmp.cleanup()

    def files(self):
        return pm.collect(self.folder, self.wasm, ["fuzz"])

    def test_what_goes_in(self):
        files = self.files()
        self.assertEqual(sorted(files), ["doc/fuzz.md", "doc/fuzz.png", "module.json", "module.wasm", "ui/fuzz.js"])
        meta = json.loads(files["module.json"])
        self.assertEqual((meta["name"], meta["types"], meta["requires"]), ("Fuzz", ["fuzz"], {"engineAbi": 1}))
        self.assertNotIn("version", meta)  # the store counts the version; the content hash must not depend on it
        self.assertEqual(files["module.wasm"], self.wasm)

    def test_same_inputs_same_bytes(self):
        a, b = self.dir / "a.bleepmod", self.dir / "b.bleepmod"
        pm.write_zip(self.files(), a)
        pm.write_zip(dict(reversed(list(self.files().items()))), b)  # even if the files are handed over in another order
        self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_one_changed_byte_changes_the_content_hash(self):
        h1 = signing.content_digest(pm.entries_of(self.files()))
        self.wasm += b"\0"
        self.assertNotEqual(h1, signing.content_digest(pm.entries_of(self.files())))

    def test_the_zip_hashes_like_the_files_and_signs_and_verifies(self):
        z = self.dir / "fuzz.bleepmod"
        files = self.files()
        pm.write_zip(files, z)
        entries = signing.read_entries(z)
        self.assertEqual(signing.content_digest(entries), signing.content_digest(pm.entries_of(files)))
        # sign it the way the store expects, and check it comes out signed
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        root, issuer = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        cert = signing.make_cert(root, None, signing.new_tbs("issuer", signing.public_bytes(issuer), publisher="bleep", scopes=["issue"],
                                                             not_before=0, not_after=2**33))
        kit = signing.issue_kit(issuer, cert, "bleep", scopes=("module",), first_party=True, now=10)
        doc = signing.sign_with_kit(entries, kit, "module", "fuzz", "1.0.0")
        res = signing.verify(entries, doc, kind="module", id_="fuzz", version="1.0.0", roots=[signing.public_bytes(root)], now=100)
        self.assertEqual(res.status, "signed")
        self.assertEqual(sorted(zipfile.ZipFile(z).namelist()), sorted(files))

    def test_real_modules_if_they_are_built(self):  # the whole point: what build-web.sh makes passes the ABI check
        web = pm.ROOT / "build" / "web" / "modules"
        built = sorted((web / "modules").glob("*.wasm")) if web.exists() else []
        if not built:
            self.skipTest("no built modules (scripts/build/build-web.sh --modules-only)")
        for f in built:
            self.assertEqual(pm.check_abi(f.read_bytes()), [], f.name)


if __name__ == "__main__":
    unittest.main()
