# SPDX-License-Identifier: MIT
"""python3 -m unittest scripts/release/test_release.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
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
