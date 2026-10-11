---
title: Memory ordering
description: Atomics and the locks that protect the rest of the segment.
order: 3
---

## 3. Memory ordering

Fields marked **atomic** MUST be read and written with atomic operations of
their full width: loads with acquire, stores with release semantics, unless
stated otherwise. All other fields are plain memory protected by one of the
three mechanisms below.

### 3.1 Registry lock (non-real-time only)

Every change to the endpoint, input or output tables, and every change to a
connection, happens while holding `header.registry_lock`:

- Acquire: compare-and-swap 0 → own PID. While it fails, yield; after
  a few attempts, sleep 1 ms between attempts.
- If the holder's process no longer exists, a waiter MAY take the lock over
  with compare-and-swap holder PID → own PID.
- Give up after 2 s (`BB_ERR_TIMEOUT`).
- Release: store 0.

The lock MUST NOT be taken on an audio thread. Readers that need consistent
strings (names in listings) SHOULD take it too.

### 3.2 Seqlocks (audio thread readers)

Output slots and the connection list of an input use sequence locks.

Writer (holding the slot exclusively; for inputs, holding the registry lock):

```c
s = load_relaxed(seq);
store_relaxed(seq, s + 1);     /* odd: writing */
fence_release();
/* write the protected fields */
store_release(seq, s + 2);     /* even: consistent */
```

Reader:

```c
s1 = load_acquire(seq);
if (s1 & 1) retry_or_skip;
/* copy the protected fields */
fence_acquire();
s2 = load_relaxed(seq);
if (s1 != s2) retry_or_skip;
```

A reader on an audio thread MUST NOT spin on a seqlock; it skips the
candidate and uses another block or its held value (section 5).

### 3.3 Publication order

To activate a record, fill every field first, then store `state = 1` with
release. To change an output owner's UID, store `endpoint_uid` (atomic) and
then increment `registry_generation`. Readers on the audio thread cache the
mapping of a cable to an output index and recompute it only when
`registry_generation` or the input's `seq` changes. Before using a cached
output they re-check `state`, `incarnation` and `endpoint_uid`.
