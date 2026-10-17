// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Onsets.h: slice and tempo detection on synthetic loops.
#include "dsp/Onsets.h"

#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;

static constexpr double kSr = 48000.0;

/// Decaying noise bursts every `period` frames, starting at `first`, over a quiet bed.
static std::vector<float> clicks(int64_t frames, int64_t first, int64_t period, std::vector<int64_t>& truth) {
    std::vector<float> x((size_t)frames, 0.0f);
    uint32_t r = 7;
    for (auto& v : x) {
        r = r * 1664525u + 1013904223u;
        v = ((float)(r >> 8) / 8388608.0f - 1.0f) * 0.001f;
    }
    for (int64_t at = first; at < frames; at += period) {
        truth.push_back(at);
        for (int64_t i = 0; i < 6000 && at + i < frames; ++i) {
            r = r * 1664525u + 1013904223u;
            x[(size_t)(at + i)] += ((float)(r >> 8) / 8388608.0f - 1.0f) * 0.8f * std::exp(-(float)i / 900.0f);
        }
    }
    return x;
}

static void findsClicks() {
    TEST("onsets: bursts found within 5 ms, nothing extra");
    std::vector<int64_t> truth;
    const auto x = clicks(48000 * 4, 24000, 12000, truth);  // first at 0.5 s, 8 per... every 250 ms
    const float* ch[1] = {x.data()};
    const auto on = dsp::detectOnsets(ch, 1, (int64_t)x.size(), kSr, 0.5f, 0.05);
    EXPECT(on.size() == truth.size());
    bool close = on.size() == truth.size();
    for (size_t i = 0; close && i < on.size(); ++i) close = std::llabs(on[i] - truth[i]) < (int64_t)(0.005 * kSr);
    EXPECT(close);
}

static void sensitivityAndGap() {
    TEST("onsets: a long minimum gap merges close hits; silence has none");
    std::vector<int64_t> truth;
    const auto x = clicks(48000 * 4, 24000, 6000, truth);  // every 125 ms
    const float* ch[1] = {x.data()};
    const auto fine = dsp::detectOnsets(ch, 1, (int64_t)x.size(), kSr, 0.5f, 0.05);
    const auto coarse = dsp::detectOnsets(ch, 1, (int64_t)x.size(), kSr, 0.5f, 0.3);
    EXPECT(fine.size() == truth.size());
    EXPECT(coarse.size() < fine.size());
    for (size_t i = 1; i < coarse.size(); ++i) EXPECT(coarse[i] - coarse[i - 1] >= (int64_t)(0.3 * kSr));
    const std::vector<float> silent(48000, 0.0f);
    const float* s[1] = {silent.data()};
    EXPECT(dsp::detectOnsets(s, 1, 48000, kSr, 1.0f, 0.03).empty());
    EXPECT(dsp::detectOnsets(s, 0, 48000, kSr, 1.0f, 0.03).empty());
    EXPECT(dsp::detectOnsets(s, 1, 100, kSr, 1.0f, 0.03).empty());
}

static void tempo() {
    TEST("tempo: 120 BPM clicks measure about 120, 100 BPM about 100");
    for (double bpm : {120.0, 100.0}) {
        std::vector<int64_t> truth;
        const int64_t period = (int64_t)(kSr * 60.0 / bpm);
        const auto x = clicks(48000 * 12, 4800, period, truth);
        const float* ch[1] = {x.data()};
        EXPECT_NEAR(dsp::estimateBpm(ch, 1, (int64_t)x.size(), kSr), bpm, bpm * 0.03);
    }
}

int main() {
    findsClicks();
    sensitivityAndGap();
    tempo();
    return test::finish("onsets");
}
