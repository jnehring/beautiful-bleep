# SPDX-License-Identifier: MIT
"""python3 -m unittest discover -s scripts/tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import settings  # noqa: E402


class Layers(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.shared, self.local = self.tmp / "bleep.json", self.tmp / "bleep.local.json"
        for patch in (mock.patch.object(settings, "SHARED", self.shared), mock.patch.object(settings, "LOCAL", self.local),
                      mock.patch.object(settings, "CONFIG_DIR", self.tmp),
                      mock.patch.dict("os.environ", {v: "" for v in settings.ENV.values()})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_local_beats_shared_and_environment_beats_local(self):
        self.shared.write_text(json.dumps({"channel": "stable", "registry": "https://a"}))
        self.local.write_text(json.dumps({"registry": "https://b"}))
        self.assertEqual(settings.load()["registry"], "https://b")
        with mock.patch.dict("os.environ", {"BLEEP_REGISTRY_URL": "https://c"}):
            self.assertEqual(settings.load()["registry"], "https://c")
        self.assertEqual(settings.load()["channel"], "stable")

    def test_comments_are_dropped_and_paths_expanded(self):
        self.local.write_text(json.dumps({"_comment": "x", "signingKit": "~/kit.json", "juceDir": "libs/JUCE"}))
        s = settings.load()
        self.assertNotIn("_comment", s)
        self.assertEqual(s["signingKit"], str(Path("~/kit.json").expanduser()))
        self.assertEqual(s["juceDir"], str(settings.ROOT / "libs" / "JUCE"))

    def test_registry_falls_back_to_the_library_config(self):
        (self.tmp / "library.json").write_text(json.dumps({"libraryUrl": "https://lib"}))
        self.assertEqual(settings.load()["registry"], "https://lib")

    def test_missing_files_are_fine_and_broken_ones_are_named(self):
        self.assertEqual(settings.get("signingKit"), None)
        self.local.write_text("{nope")
        with self.assertRaises(SystemExit):
            settings.load()


if __name__ == "__main__":
    unittest.main()
