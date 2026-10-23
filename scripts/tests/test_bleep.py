# SPDX-License-Identifier: MIT
"""python3 -m unittest discover -s scripts/tests"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bleep  # noqa: E402


def dispatch(argv, settings=None, live=False):
    """Runs ./bleep with the external commands replaced: returns the commands it would have run.
    `live`: whether Ableton Live counts as running."""
    calls = []
    with mock.patch.object(bleep, "run", lambda cmd, **kw: calls.append([str(c) for c in cmd])), \
            mock.patch.object(bleep, "have", lambda tool: False), \
            mock.patch.object(bleep, "live_running", lambda: live), \
            mock.patch.object(bleep.settings, "load", lambda: dict(settings or {})):
        bleep.main(argv)
    return calls


class Commands(unittest.TestCase):
    def test_build_plugins_is_the_default_and_uses_the_juce_setting(self):
        conf = dispatch(["build"], {"juceDir": "/j", "buildConfig": "Release"})[0]
        self.assertIn("-DBLEEP_JUCE_DIR=/j", conf)
        self.assertIn("-DBLEEP_BUILD_TESTS=ON", conf)

    def test_command_line_beats_the_setting(self):
        conf = dispatch(["build", "plugins", "--juce", "/cli"], {"juceDir": "/j"})[0]
        self.assertIn("-DBLEEP_JUCE_DIR=/cli", conf)

    def test_build_plugins_copies_them_to_the_plugin_folders_by_default(self):
        self.assertIn("-DBLEEP_COPY_PLUGINS=ON", dispatch(["build", "plugins"])[0])
        self.assertIn("-DBLEEP_COPY_PLUGINS=ON", dispatch(["build"])[0])
        self.assertIn("-DBLEEP_COPY_PLUGINS=ON", dispatch(["build", "plugins", "--install"])[0])
        self.assertIn("-DBLEEP_COPY_PLUGINS=OFF", dispatch(["build", "plugins", "--no-install"])[0])

    def test_while_live_runs_the_default_builds_without_copying_but_install_still_copies(self):
        self.assertIn("-DBLEEP_COPY_PLUGINS=OFF", dispatch(["build", "plugins"], live=True)[0])
        self.assertIn("-DBLEEP_COPY_PLUGINS=ON", dispatch(["build", "plugins", "--install"], live=True)[0])
        self.assertIn("-DBLEEP_COPY_PLUGINS=OFF", dispatch(["build", "plugins", "--no-install"], live=True)[0])

    def test_plugins_only_builds_no_tests_and_no_ctest(self):
        calls = dispatch(["build", "plugins", "--plugins-only"])
        self.assertIn("-DBLEEP_BUILD_TESTS=OFF", calls[0])
        self.assertFalse(any(c[0] == "ctest" for c in calls))

    def test_app_has_its_own_build_dir(self):
        calls = dispatch(["build", "app"])
        self.assertTrue(any("build/app" in part for part in calls[0]))
        self.assertIn("BleepApp", calls[1])

    def test_web_docker_comes_from_the_settings(self):
        self.assertIn("--docker", dispatch(["build", "modules"], {"webDocker": True})[0])
        self.assertNotIn("--docker", dispatch(["build", "modules"])[0])
        self.assertIn("--modules-only", dispatch(["build", "modules"])[0])

    def test_site_actions(self):
        self.assertEqual(dispatch(["run", "site", "--action", "down"])[0][-1], "down")


class Release(unittest.TestCase):
    def test_plugins_need_a_level(self):
        with self.assertRaises(SystemExit):
            dispatch(["release", "plugins"])

    def test_plugins_release_all_by_default(self):
        cmd = dispatch(["release", "plugins", "--level", "patch", "--dry-run"])[0]
        self.assertEqual(cmd[2:], ["--all", "--level", "patch", "--dry-run"])

    def test_modules_are_built_packaged_and_released(self):
        calls = dispatch(["release", "modules", "--level", "patch", "reverb"])
        self.assertIn("--modules-only", calls[0][0:3] + calls[0])
        self.assertEqual(calls[-1][2:], ["--modules", "--package", "reverb", "--level", "patch"])

    def test_modules_without_build(self):
        calls = dispatch(["release", "modules", "--level", "patch", "--no-build"])
        self.assertEqual(len(calls), 1)

    def test_community_passes_options_through(self):
        cmd = dispatch(["release", "community", "pkg.bleepmod", "--name", "wobble", "--check"])[0]
        self.assertEqual(cmd[2:], ["pkg.bleepmod", "--name", "wobble", "--check"])


class Tests(unittest.TestCase):
    def test_default_runs_the_fast_suites_and_checks(self):
        with mock.patch.dict(bleep.TESTS, {n: mock.Mock() for n in bleep.TESTS}):
            t = dict(bleep.TESTS)
            calls = dispatch(["test"])
        self.assertEqual([c[1] for c in calls], [str(bleep.SCRIPTS / "check" / "check-repo.py"), str(bleep.SCRIPTS / "check" / "check-api-docs.py")])
        self.assertTrue(t["py"].called and t["js"].called and not t["bus"].called)

    def test_all_includes_the_native_suites(self):
        with mock.patch.dict(bleep.TESTS, {n: mock.Mock() for n in bleep.TESTS}):
            t = dict(bleep.TESTS)
            dispatch(["test", "all"])
        self.assertTrue(all(m.called for m in t.values()))

    def test_site_tests_are_the_known_ones(self):
        tests = sorted((bleep.ROOT / "patch" / "web" / "test").glob("*-test.mjs"))
        self.assertTrue({"graph-test", "voices-test", "play-presets-test"} <= {p.stem for p in tests})


if __name__ == "__main__":
    unittest.main()
