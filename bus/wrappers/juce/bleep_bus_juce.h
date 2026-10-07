// SPDX-License-Identifier: MIT
//
// bleep_bus_juce.h — helpers for using Bleep Bus inside a JUCE AudioProcessor.
//
// Header-only; include it after <juce_audio_processors/juce_audio_processors.h>
// and link the `bleep_bus` CMake target. Nothing here is required: it only
// saves the boilerplate of filling bb_block_info from JUCE's play head and of
// splitting large host blocks.
//
//   void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
//   {
//       bleep::juce_helpers::forEachBusBlock(getPlayHead(), getSampleRate(), buffer.getNumSamples(),
//           [&](const bb_block_info& info, int offset) {
//               endpoint.beginBlock(info);
//               lfo.render(lfoBuffer, info.num_samples);
//               out.write(lfoBuffer, info.num_samples);
//               endpoint.endBlock();
//           });
//   }
#pragma once

#include "bleep_bus.hpp"

namespace bleep::juce_helpers {

/// Transport snapshot for one host block.
struct Transport {
    int64_t samplePos = 0;
    bool playing = false;
    double bpm = 120.0;
    double ppq = 0.0;     ///< quarter notes at the block start
    bool hasPpq = false;
};

/// Reads the play head. Falls back to a free-running position when the host
/// gives none (pass the running counter in `fallbackPos`). [RT]
inline Transport readTransport(juce::AudioPlayHead* playHead, int64_t fallbackPos) {
    Transport t;
    t.samplePos = fallbackPos;
    if (playHead == nullptr) return t;
    if (auto pos = playHead->getPosition()) {
        if (auto s = pos->getTimeInSamples()) t.samplePos = *s;
        if (auto b = pos->getBpm()) t.bpm = *b;
        if (auto p = pos->getPpqPosition()) {
            t.ppq = *p;
            t.hasPpq = true;
        }
        t.playing = pos->getIsPlaying() || pos->getIsRecording();
    }
    return t;
}

/// Calls fn(info, sampleOffset) once per sub-block of at most
/// BB_MAX_BLOCK_SAMPLES samples, with consistent transport stamps. [RT]
template <typename Fn>
void forEachBusBlock(const Transport& t, double sampleRate, int numSamples, Fn&& fn) {
    int offset = 0;
    while (offset < numSamples) {
        const int n = juce::jmin(numSamples - offset, (int)BB_MAX_BLOCK_SAMPLES);
        bb_block_info info = BB_BLOCK_INFO_INIT;
        info.num_samples = (uint32_t)n;
        info.transport_sample_pos = t.samplePos + offset;
        info.sample_rate = sampleRate;
        info.flags = t.playing ? BB_BLOCK_PLAYING : 0u;
        fn(info, offset);
        offset += n;
    }
}

}  // namespace bleep::juce_helpers
