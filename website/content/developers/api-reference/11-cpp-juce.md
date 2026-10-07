---
title: C++ and JUCE helpers
order: 11
---

## C++ and JUCE helpers

`bus/wrappers/cpp/bleep_bus.hpp` is a header-only C++17 RAII wrapper. Each
method maps to one C function and has the same thread rules.

```cpp
#include "bleep_bus.hpp"

bleep::Bus bus;                                         // bb_bus_open
bleep::Endpoint ep(bus, "Bass Wobble", "Function", "Me"); // bb_register_instance
bleep::Output a = ep.addOutput("A", BB_SIGNAL_CONTROL, BB_POLARITY_UNIPOLAR);
bleep::Input rate = ep.addInput("Rate");

for (const bb_output_info& o : bus.outputs()) { /* source menu */ }
bus.connect(ep.uid(), "Rate", otherUid, "Out", 0.5f);
std::string saved = ep.saveConnections();
```

`bus/wrappers/juce/bleep_bus_juce.h` fills `bb_block_info` from JUCE's play
head and splits large blocks:

```cpp
#include <juce_audio_processors/juce_audio_processors.h>
#include "bleep_bus_juce.h"

void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override {
    auto t = bleep::juce_helpers::readTransport(getPlayHead(), fallbackPos);
    fallbackPos += buffer.getNumSamples();
    bleep::juce_helpers::forEachBusBlock(t, getSampleRate(), buffer.getNumSamples(),
        [&](const bb_block_info& info, int offset) {
            endpoint.beginBlock(info);
            rate.read(rateMod.data(), info.num_samples);
            renderLfo(lfo.data(), rateMod.data(), info.num_samples);
            a.write(lfo.data(), info.num_samples);
            endpoint.endBlock();
        });
}
```

CMake: `add_subdirectory(path/to/bleep/bus)` and link `bleep_bus_cpp`.
That target brings in the C library and both wrapper folders.
