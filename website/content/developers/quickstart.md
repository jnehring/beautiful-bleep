---
title: Quickstart
description: A minimal Bleep Bus sender and receiver in 15 minutes.
order: 0
---

# Bleep Bus quickstart

A minimal sender and receiver in 15 minutes. This page is complete on its
own; paste it into a coding assistant together with your plugin source.

## 1. Build the SDK

```bash
git clone https://github.com/brilliantbleep/bleep.git
cmake -S bleep/bus -B build/bus
cmake --build build/bus
ctest --test-dir build/bus        # conformance suite
```

## 2. See it work (two terminals)

```bash
./build/bus/minimal_sender        # publishes a 0.5 Hz sine on output "LFO"
./build/bus/minimal_receiver      # patches LFO → In and prints it
./build/bus/bb_conformance inspect   # shows endpoints, ports and cables
```

## 3. Add it to your plugin

CMake:

```cmake
add_subdirectory(path/to/bleep/bus bleep_bus)
target_link_libraries(MyPlugin PRIVATE bleep_bus_cpp)   # C only: bleep_bus
```

Sender (any plugin, C API):

```c
#include "bleep_bus.h"

/* constructor */
bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, NULL, NULL);
bb_instance_info info = BB_INSTANCE_INFO_INIT;
info.display_name = "My LFO"; info.product = "My LFO"; info.vendor = "Me";
bb_endpoint* ep = bb_register_instance(bus, &info, NULL);
bb_output* out = bb_add_output(ep, "LFO", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);

/* audio callback */
bb_block_info b = BB_BLOCK_INFO_INIT;
b.num_samples = n; b.sample_rate = sr;
b.transport_sample_pos = transport_pos;
b.flags = playing ? BB_BLOCK_PLAYING : 0;
bb_begin_block(ep, &b);
bb_write_output(out, lfo_samples, n);
bb_end_block(ep);

/* destructor */
bb_unregister_instance(ep);
bb_bus_close(bus);
```

Receiver: the same setup with an input, plus a cable.

```c
bb_input* cutoff_in = bb_add_input(ep, "Cutoff", BB_SIGNAL_CONTROL, NULL);

/* message thread: patch the first output named "LFO" into Cutoff */
bb_output_info outs[BB_MAX_OUTPUTS];
uint32_t count = bb_list_outputs(bus, outs, BB_MAX_OUTPUTS);
for (uint32_t i = 0; i < count; ++i)
    if (strcmp(outs[i].name, "LFO") == 0) {
        bb_connect(bus, bb_endpoint_uid(ep), "Cutoff", outs[i].endpoint_uid, "LFO", 0.5f);
        break;
    }

/* audio callback, between begin and end */
float mod[BB_MAX_BLOCK_SAMPLES];
bb_read_input(cutoff_in, mod, n);
for (uint32_t i = 0; i < n; ++i) {
    float v = cutoff_knob + mod[i];                 /* normalised 0..1 */
    v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
    set_cutoff_normalised(i, v);                    /* never move the host parameter */
}
```

## 4. Save the cables

```c
/* getState */
uint64_t uid = bb_endpoint_uid(ep);                 /* save this */
size_t len = bb_save_connections(ep, NULL, 0);      /* + this text */

/* setState */
bb_set_instance_uid(ep, saved_uid);                 /* BB_ERR_UID_IN_USE: device was duplicated, fine */
bb_load_connections(ep, saved_text, saved_len);
```

## 5. Load it in Live

Build your plugin twice (or load two instances), put one on each of two
tracks, and press play. Modulation arrives one block late, independent of
track order.

Next: the [API reference](api-reference/00-overview.md) for every function,
host notes and pitfalls; the [specification](spec/v0.1/00-overview.md) if
you implement the bus without the SDK.
