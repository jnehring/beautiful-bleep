# SPDX-License-Identifier: MIT
"""python3 -m unittest scripts/release/test_community_publish.py   (needs the `cryptography` package)"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("community_publish", HERE / "community-publish.py")
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)
from app import community  # noqa: E402


def wasm(exports=tuple(sorted(community.REQUIRED_EXPORTS))) -> bytes:
    def leb(n):
        out = bytearray()
        while True:
            b = n & 0x7F
            n >>= 7
            out.append(b | (0x80 if n else 0))
            if not n:
                return bytes(out)
    body = leb(len(exports)) + b"".join(leb(len(e)) + e.encode() + (b"\x02" if e == "memory" else b"\x00") + leb(0) for e in exports)
    return b"\0asm\x01\0\0\0" + b"\x07" + leb(len(body)) + body


class CommunityPublish(unittest.TestCase):
    def folder(self, d: Path, **extra):
        (d / "module.json").write_text(json.dumps({"types": ["zed/wobble"], "requires": {"engineAbi": 1}}))
        (d / "module.wasm").write_bytes(wasm())
        (d / "spec.json").write_text("[]")
        for name, data in extra.items():
            (d / name).parent.mkdir(exist_ok=True)
            (d / name).write_bytes(data)

    def test_a_folder_is_zipped_and_passes_the_librarys_checks(self):
        with tempfile.TemporaryDirectory() as t:
            self.folder(Path(t), **{"doc/readme.md": b"# Wobble"})
            files, meta = community.inspect(cp.package_bytes(Path(t)))
            self.assertEqual(sorted(files), ["doc/readme.md", "module.json", "module.wasm", "spec.json"])
            self.assertEqual(cp.main([t, "--name", "wobble", "--version", "1.0.0", "--check"]), 0)

    def test_files_a_community_module_may_not_bring_are_left_out(self):
        with tempfile.TemporaryDirectory() as t:
            self.folder(Path(t))
            (Path(t) / "ui").mkdir()
            (Path(t) / "ui" / "view.js").write_bytes(b"alert(1)")
            (Path(t) / "notes.txt").write_bytes(b"x")
            files, _ = community.inspect(cp.package_bytes(Path(t)))
            self.assertNotIn("ui/view.js", files)
            self.assertNotIn("notes.txt", files)

    def test_a_package_the_library_would_refuse_is_refused_before_the_upload(self):
        with tempfile.TemporaryDirectory() as t:
            self.folder(Path(t))
            (Path(t) / "module.wasm").write_bytes(b"\0asm\x01\0\0\0")
            self.assertEqual(cp.main([t, "--name", "wobble", "--version", "1.0.0", "--check"]), 1)


if __name__ == "__main__":
    unittest.main()
