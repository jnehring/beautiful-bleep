// SPDX-License-Identifier: GPL-3.0-or-later
// Drum Map DSP: the generated map (shape of the default pattern, ASCII print
// for review), interpolation, Density (monotonic), accents and velocity,
// Fill, Chaos blocks, timing per Rate, loop jumps, Clock mode, Reset, notes
// and no hanging notes.
#include "DrumMapDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <map>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kStep = 6000;  // a 1/16 at 120 BPM, 48 kHz

struct Hit {
    int64_t at;
    int voice;
    bool accent;
    float vel;
};

struct Run {
    std::vector<Hit> hits;
    std::vector<int64_t> ends;
    std::vector<std::pair<bool, int>> notes;
    std::map<int, int> held;
    bool bad = false;
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
    std::vector<int> steps(int voice) const {
        std::vector<int> s;
        for (const auto& h : hits)
            if (h.voice == voice) s.push_back((int)((h.at + kStep / 2) / kStep));
        return s;
    }
};

struct Rig {
    DrumMapDsp dsp;
    DrumParams p;
    DrumTime t;
    DrumInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    Rig() {
        dsp.prepare(kSr);
        dsp.reset();
        t.running = true;
        t.bpm = kBpm;
    }
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            DrumOutputs o;
            dsp.tick(p, in, t, o, [&](bool on, int note, float, float) {
                r.notes.push_back({on, note});
                if (on) {
                    if (r.held[note]++ > 0) r.bad = true;
                } else if (--r.held[note] < 0) {
                    r.bad = true;
                }
            });
            for (int v = 0; v < kDrumVoices; ++v)
                if (o.trig[(size_t)v] > 0.5f) r.hits.push_back({sample, v, o.accent[(size_t)v] > 0.5f, o.vel[(size_t)v]});
            if (o.end > 0.5f) r.ends.push_back(sample);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

/// The hits of a voice at X/Y and density over the 32 map steps.
uint32_t pattern(float x, float y, int voice, float density) {
    uint32_t bits = 0;
    for (int s = 0; s < kDrumSteps; ++s) {
        const float L = drumLevel(drumFactoryMap(), x, y, voice, s);
        if (L > (1.0f - density) * 255.0f && L > 0.0f) bits |= 1u << s;
    }
    return bits;
}

void print(int c, int r) {
    std::printf("  node %d,%d\n", c, r);
    for (float d : {0.3f, 0.5f, 0.8f}) {
        for (int v = 0; v < kDrumVoices; ++v) {
            const uint32_t b = pattern((float)c / 4, (float)r / 4, v, d);
            char line[33];
            for (int s = 0; s < 32; ++s) line[s] = (b >> s) & 1 ? (s % 4 == 0 ? 'X' : 'x') : (s % 4 == 0 ? '|' : '.');
            line[32] = 0;
            std::printf("    %3.0f%% %-5s %s\n", d * 100, v == 0 ? "kick" : v == 1 ? "snare" : "hats", line);
        }
    }
}

}  // namespace

static void factoryMap() {
    TEST("the generated map");
    const bool verbose = std::getenv("DRUM_MAP_PRINT") != nullptr;
    if (verbose)
        for (int r = 0; r < kDrumGrid; ++r)
            for (int c = 0; c < kDrumGrid; ++c) print(c, r);
    // The default (X = Y = 25 %, node 1,1) at 50 %: kick on 1 and 3, snare on
    // 2 and 4, hats on the 8ths, in both bars.
    const uint32_t kick = pattern(0.25f, 0.25f, DrumKick, 0.5f);
    const uint32_t snare = pattern(0.25f, 0.25f, DrumSnare, 0.5f);
    const uint32_t hats = pattern(0.25f, 0.25f, DrumHats, 0.5f);
    EXPECT((kick & 0x0101u) == 0x0101u);
    EXPECT((snare & 0x1010u) == 0x1010u && (snare & 0x10000u << 4) != 0);
    for (int s = 0; s < 28; s += 2) EXPECT((hats >> s) & 1);
    // Straight (u = 0) has the kick on every beat; sparse (v = 0) has no 16th hats.
    EXPECT((pattern(0.0f, 0.0f, DrumKick, 0.4f) & 0x1111u) == 0x1111u);
    EXPECT((pattern(0.0f, 0.0f, DrumHats, 0.6f) & 0xaaaaaaaau) == 0);
    // Busy (v = 1) has 16th hats; broken (u = 1) moves the kick off beat 2.
    EXPECT((pattern(0.0f, 1.0f, DrumHats, 0.4f) & 0x2u) != 0);
    EXPECT(((pattern(1.0f, 0.5f, DrumKick, 0.5f) >> 4) & 1) == 0);
    // Every node differs from its neighbours somewhere.
    for (int i = 1; i < kDrumNodes; ++i)
        EXPECT(std::memcmp(&drumFactoryMap()[(size_t)i], &drumFactoryMap()[(size_t)i - 1], sizeof(DrumNode)) != 0);

    TEST("interpolation");
    const DrumMapTable& m = drumFactoryMap();
    for (int v = 0; v < kDrumVoices; ++v)
        for (int s = 0; s < kDrumSteps; ++s) {
            EXPECT(drumLevel(m, 0.5f, 0.75f, v, s) == (float)m[3 * 5 + 2].lanes[(size_t)v][(size_t)s]);
            const float mid = drumLevel(m, 0.625f, 0.75f, v, s);
            EXPECT_NEAR(mid, 0.5 * (m[3 * 5 + 2].lanes[(size_t)v][(size_t)s] + m[3 * 5 + 3].lanes[(size_t)v][(size_t)s]), 1.0);
        }
}

static void density() {
    TEST("Density: 0 % nothing, 100 % every level above 0, monotonic");
    for (int v = 0; v < kDrumVoices; ++v) {
        EXPECT(pattern(0.6f, 0.4f, v, 0.0f) == 0);
        uint32_t any = 0;
        for (int s = 0; s < kDrumSteps; ++s)
            if (drumLevel(drumFactoryMap(), 0.6f, 0.4f, v, s) > 0.0f) any |= 1u << s;
        EXPECT(pattern(0.6f, 0.4f, v, 1.0f) == any);
        uint32_t last = 0;
        for (int d = 0; d <= 100; ++d) {
            const uint32_t b = pattern(0.6f, 0.4f, v, d / 100.0f);
            EXPECT((b & last) == last);
            last = b;
        }
    }

    TEST("velocity and accent");
    Rig rig;
    rig.p.density = {1.0f, 1.0f, 1.0f};
    Run r;
    rig.run(kStep * 32, r);
    for (const auto& h : r.hits) {
        const float L = drumLevel(drumFactoryMap(), 0.25f, 0.25f, h.voice, (int)((h.at + 10) / kStep));
        EXPECT_NEAR(h.vel, 0.3 + 0.7 * L / 255.0, 1e-4);
        EXPECT(h.accent == (L >= 0.78f * 255.0f));
    }

    TEST("Fill raises density only while high");
    Rig f;
    f.p.density = {0.3f, 0.3f, 0.3f};
    f.p.fillAmount = 0.5f;
    Run rf;
    f.run(kStep * 16, rf);
    f.in.fill = 1.0f;
    f.run(kStep * 16, rf);
    f.in.fill = 0.0f;
    f.run(kStep * 32, rf);
    auto count = [&](int64_t from, int64_t to) {
        int n = 0;
        for (const auto& h : rf.hits) n += h.at >= from && h.at < to;
        return n;
    };
    const int filled = count(kStep * 16, kStep * 32), plain = count(kStep * 48, kStep * 64);
    EXPECT(filled > plain);
    EXPECT(count(0, kStep * 16) == count(kStep * 32, kStep * 48));
}

static void chaos() {
    TEST("Chaos blocks");
    auto bars = [](float amount, int rate, uint32_t seed) {
        Rig rig;
        rig.p.chaos = amount;
        rig.p.chaosRate = rate;
        rig.p.seed = seed;
        rig.p.length = 16;
        Run r;
        rig.run(kStep * 16 * 6, r);
        std::vector<std::vector<int>> per(6);
        for (const auto& h : r.hits) per[(size_t)(h.at / (kStep * 16))].push_back(h.voice * 100 + (int)((h.at / kStep) % 16));
        return per;
    };
    const auto zero = bars(0.0f, 0, 1);
    for (size_t b = 1; b < zero.size(); ++b) EXPECT(zero[b] == zero[0]);
    const auto four = bars(0.6f, 2, 1);
    EXPECT(four[0] == four[1] && four[1] == four[2] && four[2] == four[3]);
    EXPECT(four[4] != four[3]);
    EXPECT(bars(0.6f, 2, 1) == four);
    EXPECT(bars(0.6f, 2, 2) != four);
    const auto frozen = bars(0.6f, 4, 1);
    for (size_t b = 1; b < frozen.size(); ++b) EXPECT(frozen[b] == frozen[0]);
}

static void timing() {
    TEST("steps per Rate, End, loop jump");
    for (int rate = 0; rate < 5; ++rate) {
        Rig rig;
        rig.p.rate = rate;
        rig.p.density = {1.0f, 1.0f, 1.0f};
        Run r;
        rig.run(48000, r);
        const double beats = bleep::dsp::noteValueBeats(bleep::dsp::noteValueIndex(drumRateNames()[(size_t)rate]));
        const double stepSamples = beats * 24000.0;
        for (const auto& h : r.hits) {
            const double k = (double)h.at / stepSamples;
            EXPECT(std::fabs(k - std::round(k)) * stepSamples < 2.0);
        }
    }
    Rig e;
    e.p.length = 8;
    Run re;
    e.run(kStep * 20, re);
    EXPECT(re.ends.size() == 2);
    Rig j;
    Run rj;
    j.run(kStep * 3, rj);
    j.ppq = 0.25 * 21 + 0.01;
    j.run(10, rj);
    EXPECT(j.dsp.step() == 21);

    TEST("Clock mode: one step per pulse; Reset");
    Rig c;
    c.in.clockPatched = true;
    Run rc;
    for (int k = 0; k < 5; ++k) {
        c.in.clock = 1.0f;
        c.run(1, rc);
        c.in.clock = 0.0f;
        c.run(2999, rc);
    }
    EXPECT(c.dsp.step() == 4);
    c.in.reset = 1.0f;
    c.run(1, rc);
    c.in.reset = 0.0f;
    c.in.clock = 1.0f;
    c.run(1, rc);
    EXPECT(c.dsp.step() == 0);
}

static void notes() {
    TEST("notes: numbers, retrigger order, no hanging notes");
    Rig rig;
    rig.p.density = {1.0f, 1.0f, 1.0f};
    rig.p.noteLength = 1.0f;  // a note still sounds when the next hit comes
    Run r;
    rig.run(kStep * 8 + 10, r);
    for (const auto& [on, note] : r.notes) EXPECT(note == 36 || note == 38 || note == 42);
    EXPECT(!r.bad);
    EXPECT(r.sounding() > 0);
    rig.t.running = false;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.t.running = true;
    rig.run(kStep, r);
    rig.in.reset = 1.0f;
    rig.run(1, r);
    rig.in.reset = 0.0f;
    EXPECT(r.sounding() == 0);
    rig.run(kStep * 2, r);
    EXPECT(r.sounding() > 0);
    rig.p.note = {40, 41, 43};
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    EXPECT(!r.bad);
}

int main() {
    factoryMap();
    density();
    chaos();
    timing();
    notes();
    return bleep::test::finish("drum-map");
}
