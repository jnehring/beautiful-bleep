---
title: Versioning and extensions
description: How versions match and how the standard can be extended.
order: 8
---

## 8. Versioning and extensions

### 8.0 Hostile peers

The segment is created with mode `0600`, so peers are same-user processes
that may be buggy or hostile. Implementations MUST validate what they read
from shared memory:

- Table offsets and sizes come from the layout constants, not from a second
  read of the header. Header values are validated once, at open.
- An endpoint index outside the endpoint table makes a record invalid;
  listings skip it.
- Strings are copied with a bound and always NUL-terminated.
- Non-finite samples and amounts are treated as 0; amounts are clamped to the
  documented range, and a sum that overflows to Inf is treated as 0.
- Before each write, a writer re-checks that the output record is still its
  own (`state`, `endpoint_uid`, `incarnation`).
- Process IDs of 0 or above `INT32_MAX` are invalid and never probed.

Known limits:

- **Truncation.** A same-user peer that shrinks the segment with `ftruncate`
  makes later accesses to the removed pages raise SIGBUS in every process
  that maps it. The audio thread cannot re-check the size without a system
  call, and POSIX named shared memory cannot be sealed.
- **PID namespaces.** Dead endpoints are reaped with `kill(pid, 0)`.
  Processes in separate PID namespaces (containers) that share one segment
  can look dead to each other. Run all peers of a bus in one PID namespace.


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
