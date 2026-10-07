---
title: Layout
order: 2
---

## 2. Layout

All integers are little-endian with natural alignment and no packing.
Strings are NUL-terminated UTF-8 within fixed-size fields. Reserved bytes
MUST be zero when written and MUST be ignored when read.

The reference header `bus/include/bleep_bus_layout.h`
declares the same structures in C with static size checks.

### Segment

| Offset | Size | Content |
|---:|---:|---|
| 0 | 256 | header |
| 256 | 64 × 256 = 16 384 | endpoint table |
| 16 640 | 512 × 576 = 294 912 | input table |
| 311 552 | 256 × 65 920 = 16 875 520 | output table |
| | **17 187 072** | total |

### Header (256 bytes)

| Offset | Type | Field | Value / meaning |
|---:|---|---|---|
| 0 | u32 | magic | `0x53554242` ("BBUS") |
| 4 | u16 | spec_major | 0 |
| 6 | u16 | spec_minor | 1 |
| 8 | u32 | header_bytes | 256 |
| 12 | u32 | init_state | **atomic**; 0 empty, 1 initialising, 2 ready |
| 16 | u64 | total_bytes | 17 187 072 |
| 24 | u32 | max_endpoints | 64 |
| 28 | u32 | max_outputs | 256 |
| 32 | u32 | max_inputs | 512 |
| 36 | u32 | max_connections_per_input | 8 |
| 40 | u32 | max_block_samples | 4096 |
| 44 | u32 | output_slots | 4 |
| 48 | u64 | endpoints_offset | 256 |
| 56 | u64 | inputs_offset | 16 640 |
| 64 | u64 | outputs_offset | 311 552 |
| 72 | u32 | registry_lock | **atomic**; 0 free, else PID of the holder |
| 76 | u32 | registry_generation | **atomic**; +1 on any endpoint or port change |
| 80 | u32 | connection_generation | **atomic**; +1 on any cable change |
| 84 | u32 | reserved | 0 |
| 88 | u8[168] | reserved | 0 |

### Endpoint record (256 bytes)

| Offset | Type | Field | Meaning |
|---:|---|---|---|
| 0 | u32 | state | **atomic**; 0 free, 1 active |
| 4 | u32 | pid | owning process |
| 8 | u64 | uid | **atomic**; stable instance ID, never 0 |
| 16 | u32 | patch_version | **atomic**; +1 when a cable into this endpoint changes |
| 20 | u32 | reserved | |
| 24 | u64 | last_block_ns | **atomic**; time of the last block begin |
| 32 | char[64] | display_name | user-facing instance name |
| 96 | char[64] | track_name | host track name, may be empty |
| 160 | char[32] | vendor | |
| 192 | char[32] | product | |
| 224 | u8[32] | reserved | |

### Input record (576 bytes)

| Offset | Type | Field | Meaning |
|---:|---|---|---|
| 0 | u32 | state | **atomic**; 0 free, 1 active |
| 4 | u32 | endpoint_index | owner's index in the endpoint table |
| 8 | u64 | name_hash | FNV-1a 64 of `name` |
| 16 | u32 | seq | **atomic** seqlock over `connections` (odd while changing) |
| 20 | u32 | signal_type | see section 6 |
| 24 | char[32] | name | |
| 56 | u8[8] | reserved | |
| 64 | connection[8] | connections | 8 × 64 bytes |

Connection (64 bytes):

| Offset | Type | Field | Meaning |
|---:|---|---|---|
| 0 | u32 | state | 0 free, 1 active (guarded by the input's `seq`) |
| 4 | u32 | amount_bits | **atomic**; IEEE-754 binary32 bits of the amount |
| 8 | u64 | source_uid | guarded by `seq` |
| 16 | u64 | output_hash | FNV-1a 64 of `output_name`, guarded by `seq` |
| 24 | char[32] | output_name | |
| 56 | u8[8] | reserved | |

### Output record (65 920 bytes)

| Offset | Type | Field | Meaning |
|---:|---|---|---|
| 0 | u32 | state | **atomic**; 0 free, 1 active |
| 4 | u32 | endpoint_index | |
| 8 | u64 | endpoint_uid | **atomic**; mirrors the owner's UID |
| 16 | u64 | name_hash | FNV-1a 64 of `name` |
| 24 | u64 | blocks_written | **atomic**; number of completed blocks |
| 32 | u32 | incarnation | **atomic**; +1 each time the record is allocated |
| 36 | u32 | signal_type | |
| 40 | u32 | polarity | 0 bipolar, 1 unipolar |
| 44 | u32 | reserved | |
| 48 | char[32] | name | |
| 80 | u8[48] | reserved | |
| 128 | slot[4] | slots | 4 × 16 448 bytes |

Output slot (16 448 bytes):

| Offset | Type | Field | Meaning |
|---:|---|---|---|
| 0 | u32 | seq | **atomic** seqlock; odd while the writer fills the slot |
| 4 | u32 | num_samples | 1..4096 |
| 8 | u32 | flags | bit 0: transport playing |
| 12 | u32 | reserved | |
| 16 | i64 | transport_sample_pos | stamp: transport position of `samples[0]` |
| 24 | u64 | time_ns | stamp: monotonic time the block began |
| 32 | u64 | block_index | value of `blocks_written` before this block was published |
| 40 | u8[24] | reserved | |
| 64 | f32[4096] | samples | |

Block *k* of an output is stored in slot `k mod 4`.

### Hash

`name_hash` and `output_hash` are 64-bit FNV-1a over the UTF-8 bytes
(offset basis `0xcbf29ce484222325`, prime `0x100000001b3`). Hashes speed up
lookups; equality of names is decided by the hash on the audio thread and by
the full string elsewhere.
