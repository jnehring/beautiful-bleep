# Release

## What exists today

There is no release script yet. A release is manual:

1. **Check main is green.** CI (`.github/workflows/ci.yml`) builds and tests the bus, the plugins (macOS, Windows), the web board and the website.
2. **Set the version.** The product version is `project(BleepPatch VERSION …)` in `patch/CMakeLists.txt`; the plugins and the app take it from there. The bus has its own version in `bus/CMakeLists.txt` (it follows the spec version). Commit the bump.
3. **Tag.** `git tag plugin-vX.Y.Z && git push origin plugin-vX.Y.Z`.
4. **Take the build from CI.** The `plugins` job uploads `bleep-patch-macos-latest` and `bleep-patch-windows-latest` (VST3 and Standalone) as workflow artifacts. Download them from the run for the tag. To build locally instead, see [build-standalone-app.md](build-standalone-app.md) and `scripts/build-patch.sh`.
5. **Sign.** Not automated. macOS builds need a Developer ID signature and notarization to open without a Gatekeeper warning; Windows builds are unsigned. Do this before publishing.
6. **Publish.** Attach the signed files to a GitHub release for the tag, with the changelog.
7. **Website.** The site is deployed by rebuilding its containers (see [website.md](website.md)); deployment from CI is not set up yet (a note in the `website` job says so).

### Licence check before shipping the app

The app includes Ableton Link by default, which makes that binary GPL; the VST3 plugins do not include it. JUCE is AGPLv3 or commercial. `python3 scripts/check-repo.py` checks the repository's dependency and licence-header rules; CI runs it.

## Planned: the registry

`specs/registry.md` (section 7) specifies the real release system: per-module versions, content-addressed immutable files, a signed `index.json`, staging and atomic publish, driven by `scripts/release.py` with a dry run by default. **None of that is built.** When it is, this document must be replaced by that process.
