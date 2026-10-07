---
title: Connection functions
order: 7
---

## Connection functions

Cables are stored with the receiving input in shared memory, so any process
can edit them. The receiver saves them with its state.

### `bb_connect`

```c
bb_error bb_connect(bb_bus* bus, uint64_t dst_uid, const char* input_name,
                    uint64_t src_uid, const char* output_name, float amount);
```

Adds a cable, or updates the amount if the cable already exists. **[non-RT]**
The destination must be registered. The source doesn't need to be: the cable
reads silence until it appears. The amount is clamped to ±1000.
**Errors:** `BB_ERR_NOT_FOUND` (no such destination input), `BB_ERR_FULL`
(8 cables per input), `BB_ERR_INVALID_ARGUMENT`.

```c
bb_connect(bus, filter_uid, "Cutoff", lfo_uid, "A", -0.3f);
```

### `bb_disconnect`

```c
bb_error bb_disconnect(bb_bus* bus, uint64_t dst_uid, const char* input_name,
                       uint64_t src_uid, const char* output_name);
```

Removes one cable. **[non-RT]** **Errors:** `BB_ERR_NOT_FOUND`.

### `bb_disconnect_all`

```c
bb_error bb_disconnect_all(bb_bus* bus, uint64_t dst_uid, const char* input_name);
```

Removes every cable into an input. **[non-RT]**
