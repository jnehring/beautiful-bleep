---
title: Timing
description: The fixed one-block latency that makes parallel tracks render identically.
order: 5
---

## 5. Timing

Hosts such as Ableton Live process tracks on parallel threads in no
guaranteed order. The bus therefore has a **fixed latency of one block**:
a reader sees what a writer produced for the reader's *previous* block. The
result does not depend on which thread ran first, so a set renders the same
way every time, including offline export.

### 5.1 Blocks

Every block of every endpoint is framed by begin/end and carries:

- `num_samples` (1..4096). Hosts with larger blocks MUST split them; peers
  then split the same way.
- `transport_sample_pos`: the host's transport position of the first sample.
- `playing`: the transport runs (also during offline export).
- `time_ns`: a monotonic, system-wide clock (macOS `CLOCK_UPTIME_RAW`,
  Linux `CLOCK_MONOTONIC`, Windows `QueryPerformanceCounter`) or a host
  supplied equivalent.

### 5.2 Writing

For each output, once per block, the writer fills slot
`blocks_written mod 4` under its seqlock with the block's stamps and
samples, sets `block_index = blocks_written`, then increments
`blocks_written` (release). Writing again within the same block rewrites the
same slot. Outputs not written during a block publish zeros at block end.

### 5.3 Selecting the block to read

Let *W* be `blocks_written` of the source output and *prev* the reader's
previous block. Candidates are blocks *W−1*, *W−2*, *W−3* (newest first);
a candidate is only valid if its seqlock reads consistently and its
`block_index` equals its number.

1. **Position rule.** If the reader's previous and current blocks are both
   playing, choose the newest playing candidate whose
   `transport_sample_pos == prev.transport_sample_pos`.
2. **Time rule.** Otherwise, or if rule 1 finds nothing, choose the newest
   candidate with `time_ns + guard <= current.time_ns`, where
   `guard = 0.5 × num_samples / sample_rate` (1 ms if the rate is unknown).
   This picks a block from an earlier processing cycle.
3. **Hold.** If neither rule finds a block, the reader repeats the last
   sample it read from that connection (0 at first).

Rule 1 is exact and deterministic, also when loops repeat positions and when
export runs faster than real time. Rule 2 covers a stopped transport and
peers that just appeared.

If the chosen block is shorter than the reader's block, the remainder holds
the block's last sample.

### 5.4 Consequences

- Modulation arrives one block late. At 256 samples and 48 kHz that is
  5.3 ms: inaudible for modulation, unsuitable for phase-critical audio.
- A self-patched endpoint (output into its own input) works and also has
  one block of latency.
- Live's delay compensation does not know about the bus.

These rules are what Phase 0 of the project measures in real hosts; they may
be refined before 1.0.
