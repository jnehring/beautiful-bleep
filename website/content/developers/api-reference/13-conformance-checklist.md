---
title: Conformance checklist
description: What to check before calling a plugin Bleep Bus compatible.
order: 13
---

## Conformance checklist

Before you call your plugin "Bleep Bus compatible":

- [ ] Opens the bus with `BB_SPEC_VERSION` and keeps working when it is unavailable.
- [ ] Registers one endpoint per instance and saves `bb_endpoint_uid` in its state.
- [ ] Restores the saved UID with `bb_set_instance_uid` and handles `BB_ERR_UID_IN_USE`.
- [ ] Saves and restores cables with `bb_save_connections` / `bb_load_connections`.
- [ ] Frames every audio block with begin/end, ≤ 4096 samples, true transport position and `BB_BLOCK_PLAYING`.
- [ ] Calls only [RT] functions on the audio thread.
- [ ] Applies modulation as a normalised offset without moving host parameters.
- [ ] Watches `bb_endpoint_patch_version` and marks its state as changed.
- [ ] Unregisters in its destructor.
- [ ] Uses stable, short port names; parameter inputs are named after the parameter.
- [ ] `bb_conformance run` passes against the library build you ship.

See [Conformance](../bleep-bus/conformance.md) for running the suite and the validator.
