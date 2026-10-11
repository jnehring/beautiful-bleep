---
title: Versioning and extensions
description: How versions match and how the standard can be extended.
order: 8
---

## 8. Versioning and extensions

- The segment name carries the major version. The header carries major and
  minor.
- **0.x**: implementations MUST match major and minor exactly and report
  `BB_ERR_VERSION_MISMATCH` otherwise.
- **From 1.0**: a minor version MAY only use reserved bytes and MUST keep
  every existing field's meaning; peers with the same major are compatible.
  A new major version uses a new segment name, so old and new plugins run
  side by side without seeing each other.
- **Extensions** (planned): string-identified, versioned capabilities, in
  the style of CLAP extensions (`"com.example.osc-bridge/1"`), declared per
  endpoint in a table that a future minor version adds in reserved space.

### Changes

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-10 | First draft: layout, timing rules, cables, saved state. |

### Open questions for 0.2

- Pitch convention: keep 1 V/oct with 0 = C4, or switch to semitones?
- Namespace defaults per host process, to separate two running DAWs
  without configuration.
- A held "cable in hand" field for pick-up-and-drop patching across windows.
- Audio signals (stage 2): per-endpoint audio buffers allocated on demand.
