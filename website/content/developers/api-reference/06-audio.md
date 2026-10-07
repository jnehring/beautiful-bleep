---
title: Audio-thread functions
order: 6
---

## Audio-thread functions

```c
typedef struct bb_block_info {
    uint32_t struct_size;          /* BB_BLOCK_INFO_INIT */
    uint32_t num_samples;          /* 1..4096 */
    int64_t  transport_sample_pos; /* host position of the first sample */
    double   sample_rate;
    uint32_t flags;                /* BB_BLOCK_PLAYING */
    uint64_t host_time_ns;         /* 0 = library clock */
} bb_block_info;
```

### `bb_begin_block`

```c
void bb_begin_block(bb_endpoint* ep, const bb_block_info* info);
```

Starts a block. **[RT]** Split host blocks larger than `BB_MAX_BLOCK_SAMPLES`
into sub-blocks and advance `transport_sample_pos` for each. Set
`BB_BLOCK_PLAYING` whenever the transport runs, offline export included. The
deterministic timing rule depends on it.

### `bb_write_output`

```c
void bb_write_output(bb_output* out, const float* samples, uint32_t num_samples);
```

Publishes this block's samples. **[RT]** A shorter write holds its last
sample to the end of the block. A second call in the same block overwrites.
Outputs you don't write publish zeros.

### `bb_read_input`

```c
uint32_t bb_read_input(bb_input* in, float* dest, uint32_t num_samples);
```

Fills `dest` with Σ (source × amount) over all cables. **[RT]**
**Returns** the number of cables whose source is present. Use it to tell
"unpatched" from "patched but zero".

Each source arrives one block late (see Concepts). If the source has no
suitable block, its last value is held.

### `bb_end_block`

```c
void bb_end_block(bb_endpoint* ep);
```

Ends the block. **[RT]**

```c
bb_block_info b = BB_BLOCK_INFO_INIT;
b.num_samples = n; b.sample_rate = sr;
b.transport_sample_pos = pos; b.flags = playing ? BB_BLOCK_PLAYING : 0;
bb_begin_block(ep, &b);
bb_read_input(rate_in, rate_mod, n);
render_lfo(lfo, rate_mod, n);
bb_write_output(lfo_out, lfo, n);
bb_end_block(ep);
```
