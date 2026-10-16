# SPDX-License-Identifier: MIT
"""python3 -m unittest scripts/release/test_signing.py   (needs the `cryptography` package)"""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import signing as s  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

T0 = 1_760_000_000
YEAR = 365 * 86400


def entries_of(files, exec_=()):
    return {p: (hashlib.sha256(c).digest(), p in exec_) for p, c in files.items()}


class World:
    """A root, an issuer and one developer, the way the library sets them up."""

    def __init__(self, publisher="acme", scopes=("module",), first_party=False, not_before=T0, not_after=T0 + YEAR):
        self.root, self.issuer, self.dev = (Ed25519PrivateKey.generate() for _ in range(3))
        self.root_pub = s.public_bytes(self.root)
        self.issuer_cert = s.make_cert(self.root, None, s.new_tbs("issuer", s.public_bytes(self.issuer), publisher="bleep",
                                                                  scopes=["issue"], not_before=T0, not_after=T0 + YEAR))
        self.dev_cert = s.make_cert(self.issuer, self.issuer_cert, s.new_tbs(
            "developer", s.public_bytes(self.dev), publisher=publisher, scopes=scopes, first_party=first_party,
            not_before=not_before, not_after=not_after))
        self.files = {"module.json": b"{}", "module.wasm": b"\x00asm\x01\x00\x00\x00", "ui/a.js": b"1"}

    def signed(self, id_="acme/fuzz", version="1.0.0", kind="module", platform="any"):
        return s.sign(entries_of(self.files), self.dev, [self.issuer_cert, self.dev_cert], kind, id_, version, platform)

    def check(self, doc, entries=None, id_="acme/fuzz", version="1.0.0", kind="module", platform="any", now=T0 + 100, crl=None, roots=None):
        return s.verify(entries or entries_of(self.files), doc, kind=kind, id_=id_, version=version, platform=platform,
                        roots=roots or [self.root_pub], now=now, crl=crl)


class ContentDigest(unittest.TestCase):
    def test_order_does_not_matter_but_content_path_and_mode_do(self):
        a = entries_of({"a": b"1", "b": b"2"})
        self.assertEqual(s.content_digest(a), s.content_digest(dict(reversed(list(a.items())))))
        self.assertNotEqual(s.content_digest(a), s.content_digest(entries_of({"a": b"1", "b": b"3"})))
        self.assertNotEqual(s.content_digest(a), s.content_digest(entries_of({"a": b"1", "c": b"2"})))
        self.assertNotEqual(s.content_digest(a), s.content_digest(entries_of({"a": b"1", "b": b"2"}, exec_={"b"})))
        self.assertNotEqual(s.content_digest(a), s.content_digest(entries_of({"a": b"1"})))

    def test_no_ambiguity_between_path_and_hash(self):  # lp() makes "ab"+"c…" different from "a"+"bc…"
        x = {"ab": (hashlib.sha256(b"c").digest(), False)}
        y = {"a": (hashlib.sha256(b"c").digest(), False)}
        self.assertNotEqual(s.content_digest(x), s.content_digest(y))

    def test_bad_paths(self):
        for bad in ("", "/abs", "a/../b", "a//b", "./a", "a\\b"):
            with self.assertRaises(ValueError, msg=bad):
                s.content_digest({bad: (b"\0" * 32, False)})


class Verify(unittest.TestCase):
    def test_signed(self):
        w = World()
        r = w.check(w.signed())
        self.assertEqual((r.status, r.publisher), ("signed", "acme"))

    def test_unsigned(self):
        self.assertEqual(World().check(None).status, "unsigned")

    def test_any_changed_byte_breaks_it(self):
        w = World()
        doc = w.signed()
        for path in w.files:
            files = dict(w.files)
            files[path] += b"x"
            self.assertEqual(w.check(doc, entries_of(files)).status, "invalid", path)
        self.assertEqual(w.check(doc, entries_of({**w.files, "extra.txt": b"x"})).status, "invalid")

    def test_cannot_be_moved_to_another_module_version_kind_or_platform(self):
        w = World(scopes=("module", "plugin"))
        doc = w.signed()
        self.assertEqual(w.check(doc, id_="acme/other").status, "invalid")
        self.assertEqual(w.check(doc, version="1.0.1").status, "invalid")
        self.assertEqual(w.check(doc, kind="plugin").status, "invalid")
        self.assertEqual(w.check(doc, platform="macos-arm64").status, "invalid")

    def test_namespaces(self):
        w = World()
        self.assertEqual(w.check(w.signed(id_="reverb"), id_="reverb").status, "invalid")        # bare id: first party only
        self.assertEqual(w.check(w.signed(id_="evil/x"), id_="evil/x").status, "invalid")        # someone else's namespace
        self.assertEqual(w.check(w.signed(id_="acmefuzz"), id_="acmefuzz").status, "invalid")    # prefix without the slash
        f = World(publisher="bleep", first_party=True)
        self.assertEqual(f.check(f.signed(id_="reverb"), id_="reverb").status, "signed")

    def test_scopes(self):
        w = World(scopes=("module",))
        self.assertEqual(w.check(w.signed(kind="plugin"), kind="plugin").status, "invalid")

    def test_wrong_root_or_forged_chain(self):
        w = World()
        other = World()
        self.assertEqual(w.check(w.signed(), roots=[other.root_pub]).status, "invalid")
        forged = w.signed()
        forged["chain"][1] = other.dev_cert  # a developer cert from another library
        self.assertEqual(w.check(forged).status, "invalid")
        # an attacker mints their own issuer and developer under their own root
        self.assertEqual(w.check(other.signed(), roots=[w.root_pub]).status, "invalid")

    def test_tampered_certificate(self):
        w = World()
        doc = w.signed()
        doc["chain"][1]["tbs"]["publisher"] = "evil"
        self.assertEqual(w.check(doc).status, "invalid")
        doc = w.signed()
        doc["chain"][1]["tbs"]["scopes"] = ["module", "plugin"]
        self.assertEqual(w.check(doc).status, "invalid")

    def test_expiry_is_not_invalid(self):
        w = World(not_after=T0 + 1000)
        self.assertEqual(w.check(w.signed(), now=T0 + 500).status, "signed")
        self.assertEqual(w.check(w.signed(), now=T0 + 5000).status, "expired")
        self.assertEqual(w.check(w.signed(), now=T0 - 5000).status, "expired")

    def test_revoked_key_and_release(self):
        w = World()
        doc = w.signed()
        crl = {"revokedKeys": [{"keyId": s.key_id(s.public_bytes(w.dev))}]}
        self.assertEqual(w.check(doc, crl=crl).status, "revoked")
        digest = s.content_digest(entries_of(w.files)).hex()
        crl = {"revokedArtifacts": [{"kind": "module", "id": "acme/fuzz", "version": "1.0.0", "digest": digest}]}
        self.assertEqual(w.check(doc, crl=crl).status, "revoked")
        self.assertEqual(w.check(w.signed(version="1.0.1"), version="1.0.1", crl=crl).status, "signed")  # other releases are fine
        crl = {"revokedKeys": [{"keyId": s.key_id(s.public_bytes(w.issuer))}]}                          # revoking the issuer revokes all it issued
        self.assertEqual(w.check(doc, crl=crl).status, "revoked")

    def test_malformed_never_raises(self):
        w = World()
        for doc in ({}, {"format": 2}, {"format": 1, "algorithm": "ed25519"}, {"format": 1, "algorithm": "ed25519", "chain": [1, 2]},
                    {"format": 1, "algorithm": "ed25519", "chain": [], "keyId": "x", "signature": "!!"}):
            self.assertEqual(w.check(doc).status, "invalid", doc)
        bad = copy.deepcopy(w.signed())
        bad["signature"] = "AAAA"
        self.assertEqual(w.check(bad).status, "invalid")


class Receipts(unittest.TestCase):
    """Publication receipts (signing.md section 6a)."""

    def setUp(self):
        self.w = World()
        self.doc = self.w.signed()
        self.entries = entries_of(self.w.files)
        self.args = dict(kind="module", id_="acme/fuzz", version="1.0.0", platform="any", roots=[self.w.root_pub])

    def issue(self, now=T0 + 100, **kw):
        return s.issue_receipt(self.w.issuer, self.entries, self.doc, now=now, **{**self.args, **kw})

    def test_a_receipt_keeps_a_lapsed_release_signed(self):
        receipt = self.issue()
        late = T0 + YEAR + 5 * YEAR
        self.assertEqual(self.w.check(self.doc, now=late).status, "expired")
        r = s.verify(self.entries, self.doc, now=late, receipt=receipt, **self.args)
        self.assertEqual((r.status, r.published_at), ("signed", T0 + 100))

    def test_the_device_clock_plays_no_part(self):
        receipt = self.issue()
        for now in (0, T0 - 1, T0 + 100, T0 + YEAR + 1, 2 ** 40):
            self.assertEqual(s.verify(self.entries, self.doc, now=now, receipt=receipt, **self.args).status, "signed", now)

    def test_a_receipt_is_bound_to_the_release(self):
        receipt = self.issue()
        for change in (dict(version="1.0.1"), dict(id_="acme/other"), dict(platform="macos-arm64"), dict(kind="plugin")):
            r = s.verify(self.entries, self.doc, now=T0 + 100, receipt=receipt, **{**self.args, **change})
            self.assertEqual(r.status, "invalid", change)
        other = entries_of({**self.w.files, "ui/a.js": b"2"})
        self.assertEqual(s.verify(other, self.doc, now=T0 + 100, receipt=receipt, **self.args).status, "invalid")

    def test_a_receipt_cannot_be_edited_or_made_by_anyone_else(self):
        receipt = self.issue()
        self.assertEqual(s.verify(self.entries, self.doc, now=T0, receipt={**receipt, "publishedAt": T0 + 101}, **self.args).status, "invalid")
        for bad in ({**receipt, "publishedAt": "soon"}, {**receipt, "publishedAt": True}, {**receipt, "publishedAt": -1},
                    {**receipt, "format": 2}, {**receipt, "algorithm": "rsa"}, {"format": 1}, {}):
            self.assertEqual(s.verify(self.entries, self.doc, now=T0, receipt=bad, **self.args).status, "invalid", bad)
        stranger = Ed25519PrivateKey.generate()
        fake = s.make_receipt(stranger, kind="module", id_="acme/fuzz", version="1.0.0", platform="any", signer_key_id=self.doc["keyId"],
                              digest=s.content_digest(self.entries), published_at=T0 + 100)
        self.assertEqual(s.verify(self.entries, self.doc, now=T0, receipt={**fake, "issuerKeyId": receipt["issuerKeyId"]}, **self.args).status, "invalid")
        self.assertEqual(s.verify(self.entries, self.doc, now=T0, receipt=fake, **self.args).status, "invalid")

    def test_dated_outside_the_certificate_is_invalid_not_expired(self):
        for at in (T0 - 1, T0 + YEAR + 1):
            r = s.make_receipt(self.w.issuer, kind="module", id_="acme/fuzz", version="1.0.0", platform="any", signer_key_id=self.doc["keyId"],
                               digest=s.content_digest(self.entries), published_at=at)
            self.assertEqual(s.verify(self.entries, self.doc, now=T0 + 100, receipt=r, **self.args).status, "invalid", at)

    def test_stripping_the_receipt_fails_closed(self):
        self.issue()
        self.assertEqual(s.verify(self.entries, self.doc, now=T0 + YEAR + 1, receipt=None, **self.args).status, "expired")

    def test_revocation_still_wins(self):
        receipt = self.issue()
        crl = {"revokedKeys": [{"keyId": self.doc["keyId"]}], "revokedArtifacts": []}
        self.assertEqual(s.verify(self.entries, self.doc, now=T0 + 100, receipt=receipt, crl=crl, **self.args).status, "revoked")

    def test_the_library_issues_only_for_what_is_signed_right_now(self):
        lapsed = World(not_before=T0 - 2 * YEAR, not_after=T0 - YEAR)  # a certificate that ended before now
        with self.assertRaises(ValueError):
            s.issue_receipt(lapsed.issuer, entries_of(lapsed.files), lapsed.signed(), now=T0 + 100, **{**self.args, "roots": [lapsed.root_pub]})
        with self.assertRaises(ValueError):  # a tampered package
            s.issue_receipt(self.w.issuer, entries_of({**self.w.files, "ui/a.js": b"x"}), self.doc, now=T0 + 100, **self.args)
        with self.assertRaises(ValueError):  # no signature
            s.issue_receipt(self.w.issuer, self.entries, None, now=T0 + 100, **self.args)
        with self.assertRaises(ValueError):  # revoked
            self.issue(crl={"revokedKeys": [{"keyId": self.doc["keyId"]}], "revokedArtifacts": []})
        with self.assertRaises(ValueError):  # not our issuer
            s.issue_receipt(Ed25519PrivateKey.generate(), self.entries, self.doc, now=T0 + 100, **self.args)

    def test_a_clock_that_jumped_back_dates_nothing(self):
        self.assertEqual(self.issue(now=T0 + 200, newest=T0 + 200)["publishedAt"], T0 + 200)
        with self.assertRaises(ValueError):
            self.issue(now=T0 + 199, newest=T0 + 200)


class Decide(unittest.TestCase):
    def test_settings(self):
        w = World()
        off, on = {"module": False, "plugin": False}, {"module": True, "plugin": False}
        self.assertTrue(s.decide(w.check(w.signed()), "module", off)[0])
        self.assertFalse(s.decide(w.check(None), "module", off)[0])
        self.assertTrue(s.decide(w.check(None), "module", on)[0])
        self.assertFalse(s.decide(w.check(None), "plugin", on)[0])  # the two settings are separate
        broken = w.check(w.signed(), entries_of({**w.files, "x": b"1"}))
        self.assertFalse(s.decide(broken, "module", on)[0])         # a broken signature is never loaded
        expired = World(not_after=T0 + 1)
        self.assertFalse(s.decide(expired.check(expired.signed(), now=T0 + 99), "module", off)[0])
        self.assertTrue(s.decide(expired.check(expired.signed(), now=T0 + 99), "module", on)[0])


class Packages(unittest.TestCase):
    def make_zip(self, d, w):
        z = Path(d) / "fuzz.bleepmod"
        with zipfile.ZipFile(z, "w") as f:
            for p, c in w.files.items():
                f.writestr(p, c)
        return z

    def test_zip_and_folder_agree_and_signing_is_repeatable(self):
        w = World()
        with tempfile.TemporaryDirectory() as d:
            z = self.make_zip(d, w)
            folder = Path(d) / "folder"
            for p, c in w.files.items():
                (folder / p).parent.mkdir(parents=True, exist_ok=True)
                (folder / p).write_bytes(c)
            self.assertEqual(s.content_digest(s.read_entries(z)), s.content_digest(s.read_entries(folder)))
            for _ in range(2):  # signing twice replaces the signature, the digest ignores it
                s.write_doc(z, w.signed())
                self.assertEqual(w.check(s.read_doc(z), s.read_entries(z)).status, "signed")
            self.assertEqual([n for n in zipfile.ZipFile(z).namelist()].count(s.SIGNATURE_PATH), 1)

    def test_repacking_changes_nothing_but_content_does(self):
        w = World()
        with tempfile.TemporaryDirectory() as d:
            z = self.make_zip(d, w)
            s.write_doc(z, w.signed())
            doc = s.read_doc(z)
            z2 = Path(d) / "again.bleepmod"  # same files, other order and compression
            with zipfile.ZipFile(z2, "w", zipfile.ZIP_DEFLATED) as f:
                for p in reversed(list(w.files)):
                    f.writestr(p, w.files[p])
            self.assertEqual(w.check(doc, s.read_entries(z2)).status, "signed")
            with zipfile.ZipFile(z2, "a") as f:
                f.writestr("ui/evil.js", "x")
            self.assertEqual(w.check(doc, s.read_entries(z2)).status, "invalid")

    def test_duplicate_entries_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            z = Path(d) / "dup.bleepmod"
            with zipfile.ZipFile(z, "w") as f:
                f.writestr("a", "1")
                f.writestr("a", "2")
            with self.assertRaises(ValueError):
                s.read_entries(z)


class Vector(unittest.TestCase):
    def test_vector_is_stable(self):  # change this only with the spec: other implementations check against it
        v = s.test_vector()
        self.assertEqual(v["contentDigest"], "39f61d45e3115066a934dabca6cf83c346420153e85d6d58841033d62d0c1f08")
        self.assertEqual(v["signature"], "5019b69bf480dae36510479a2c4bbeab84e94477efcdd4ec3dc1528ef6f2644471e89b42c0ac69b4ff617bac7da69e4b817717e2f99e6526d4be2c10e1a72c0b")
        self.assertEqual(v["publishedAt"], 1765000000)
        self.assertEqual(v["publicationSignature"], "3d68e3df76c2bcc347f69e3205bdc1b029220445989dec47da111791f2f2e22c3aea53b88e625611c9d8924a2511e970c9284527e46ab1e78f120f3c21d20504")


FIXTURES = Path(__file__).resolve().parent.parent.parent / "patch" / "tests" / "library-fixtures"


class Fixtures(unittest.TestCase):
    """The packages in patch/tests/library-fixtures are made by `signing.py fixture`; this implementation, the JavaScript one
    (patch/web/test/library-client-test.mjs) and the C++ one (patch/tests/library_test.cpp) must give each its verdict."""

    def test_committed_fixtures_are_what_the_generator_makes(self):
        import importlib.util
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([sys.executable, str(Path(__file__).parent / "signing.py"), "fixture", d], check=True, capture_output=True)
            made = sorted(p.relative_to(d).as_posix() for p in Path(d).rglob("*") if p.is_file())
            self.assertEqual(made, sorted(p.relative_to(FIXTURES).as_posix() for p in FIXTURES.rglob("*") if p.is_file()))
            for name in made:
                self.assertEqual((Path(d) / name).read_bytes(), (FIXTURES / name).read_bytes(), name)

    def test_every_case_gets_its_verdict(self):
        spec = json.loads((FIXTURES / "cases.json").read_text())
        roots = {"main": [bytes.fromhex(spec["roots"]["main"])], "other": [bytes.fromhex(spec["roots"]["other"])], "none": []}
        self.assertGreater(len(spec["cases"]), 20)
        for c in spec["cases"]:
            pkg = FIXTURES / c["file"]
            try:
                entries = s.read_entries(pkg)
                s.content_digest(entries)
            except ValueError:
                got = "refused"
            else:
                try:
                    doc = s.read_doc(pkg)
                    r = s.verify(entries, doc, kind=c["kind"], id_=c["id"], version=c["version"], platform=c["platform"], roots=roots[c["roots"]],
                                 now=c["now"], crl=c["crl"])
                    got = r.status
                    if c["publisher"]:
                        self.assertEqual(r.publisher, c["publisher"], c["name"])
                except (ValueError, KeyError):  # a signature document that is not even JSON
                    got = "invalid"
            self.assertEqual(got, c["expect"], c["name"])

    def test_every_receipt_case_gets_its_verdict(self):
        spec = json.loads((FIXTURES / "cases.json").read_text())
        root = [bytes.fromhex(spec["roots"]["main"])]
        self.assertGreater(len(spec["receiptCases"]), 15)
        for c in spec["receiptCases"]:
            pkg = FIXTURES / c["file"]
            r = s.verify(s.read_entries(pkg), s.read_doc(pkg), kind=c["kind"], id_=c["id"], version=c["version"], platform=c["platform"],
                         roots=root, now=c["now"], crl=c["crl"], receipt=c["receipt"])
            self.assertEqual(r.status, c["expect"], c["name"])


if __name__ == "__main__":
    unittest.main()
