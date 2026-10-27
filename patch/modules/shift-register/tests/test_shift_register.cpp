// SPDX-License-Identifier: GPL-3.0-only
// Shift Register: Lock extremes, flip share, determinism, seeking, timing,
// voltage/pitch, bit gates, Combo, Mix, Data source
// (doc/specs/modules/shift-register.md §8).
#include "ShiftRegisterDsp.h"
#include "dsp/tests/TestUtil.h"

#include <bit>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::ShiftRegisterDsp;
using patch::ShiftRegisterFrame;
using patch::ShiftRegisterInput;
using patch::ShiftRegisterParams;
using patch::SrCombine;
using patch::SrSource;

static constexpr double kSr = 48000.0;

/// The register after each of `steps` steps, from the start pattern (step 0).
static std::vector<uint16_t> steps(const ShiftRegisterParams& p, int steps, const std::vector<bool>* data = nullptr) {
    std::vector<uint16_t> out{p.start};
    uint16_t reg = p.start;
    for (int k = 1; k < steps; ++k) {
        const bool d = data && (*data)[(size_t)k];
        reg = ShiftRegisterDsp::shift(reg, p.length, p.source, d, ShiftRegisterDsp::flips(p.seed, k, p.lock));
        out.push_back(reg);
    }
    return out;
}

static void lockExtremes() {
    TEST("Lock +100 % repeats every Length steps; −100 % every 2 × Length, inverted");
    for (int len = 2; len <= 16; ++len) {
        ShiftRegisterParams p;
        p.length = len;
        p.start = 0xb5a3;
        p.lock = 1.0f;
        const auto r = steps(p, 200);
        const uint16_t mask = (uint16_t)((1u << len) - 1);
        for (size_t k = (size_t)len + 16; k < r.size(); ++k) EXPECT((r[k] & mask) == (r[k - (size_t)len] & mask));
        p.lock = -1.0f;
        const auto q = steps(p, 200);
        for (size_t k = 2 * (size_t)len + 16; k < q.size(); ++k) {
            EXPECT((q[k] & mask) == (q[k - 2 * (size_t)len] & mask));
            EXPECT((q[k] & mask) == (uint16_t)(~q[k - (size_t)len] & mask));
        }
    }
    TEST("Lock 0 % flips half of the bits");
    int n = 0;
    for (int k = 0; k < 10000; ++k) n += ShiftRegisterDsp::flips(4, k, 0.0f);
    EXPECT_NEAR(n / 10000.0, 0.5, 0.02);
}

static void determinismAndSeek() {
    TEST("same seed and start: identical; another seed differs");
    ShiftRegisterParams p;
    p.lock = 0.3f;
    p.start = 0x1234;
    EXPECT(steps(p, 500) == steps(p, 500));
    ShiftRegisterParams q = p;
    q.seed = 9;
    EXPECT(steps(q, 500) != steps(p, 500));
    TEST("seek to step 1000 equals playing through");
    EXPECT(ShiftRegisterDsp::fastForward(p, 1000) == steps(p, 1001).back());
}

/// Renders the DSP with the transport at 120 BPM from `ppq0`.
static std::vector<ShiftRegisterFrame> renderTransport(const ShiftRegisterParams& p, double ppq0, double seconds,
                                                       ShiftRegisterDsp& d, std::vector<int64_t>* k = nullptr) {
    std::vector<ShiftRegisterFrame> out;
    ShiftRegisterFrame f;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        ShiftRegisterInput in;
        in.running = true;
        in.started = i == 0;
        in.ppq = ppq0 + i * 2.0 / kSr;
        d.tick(p, in, f);
        out.push_back(f);
        if (k) k->push_back(d.stepIndex());
    }
    return out;
}

static void timing() {
    TEST("transport steps on floor(ppq / syncBeats)");
    ShiftRegisterParams p;
    p.sync = 2;  // 1/16
    ShiftRegisterDsp d;
    d.prepare(kSr);
    std::vector<int64_t> ks;
    const auto r = renderTransport(p, 3.1, 2.0, d, &ks);
    for (size_t i = 0; i < r.size(); ++i) {
        const double ppq = 3.1 + i * 2.0 / kSr;
        EXPECT(ks[i] == (int64_t)std::floor(ppq / 0.25));
        const bool boundary = i == 0 || std::floor(ppq / 0.25) != std::floor((3.1 + (double)(i - 1) * 2.0 / kSr) / 0.25);
        EXPECT((r[i].step > 0.5f) == boundary);
    }
    TEST("a mid-song start equals a play-through");
    ShiftRegisterDsp e;
    e.prepare(kSr);
    renderTransport(p, 0.0, 2.0, e);  // 16 steps
    ShiftRegisterDsp g;
    g.prepare(kSr);
    renderTransport(p, 3.99, 0.002, g);
    EXPECT(e.reg() == g.reg());
    EXPECT(e.stepIndex() == g.stepIndex());

    TEST("Clock: one shift per pulse; Reset + Clock on one sample loads the start pattern");
    ShiftRegisterParams c;
    c.lock = 0.0f;
    c.start = 0x00f0;
    ShiftRegisterDsp h;
    h.prepare(kSr);
    ShiftRegisterFrame f;
    const auto expect = steps(c, 20);
    int pulses = 0;
    for (int i = 0; i < 20 * 100; ++i) {
        ShiftRegisterInput in;
        in.clockPatched = true;
        in.clock = i % 100 == 0 ? 1.0f : 0.0f;
        in.reset = i == 1000 ? 1.0f : 0.0f;
        h.tick(c, in, f);
        if (i % 100 == 0) {
            const int k = i < 1000 ? pulses : pulses - 10;
            EXPECT(h.reg() == expect[(size_t)k]);
            ++pulses;
        }
    }
}

static void voltageAndPitch() {
    TEST("voltage: 1000 0000 is 128/255; pitch is in the scale");
    EXPECT(ShiftRegisterDsp::number(0x0001) == 128);
    EXPECT(ShiftRegisterDsp::number(0x0080) == 1);
    EXPECT(ShiftRegisterDsp::number(0x00ff) == 255);
    const uint16_t minorPenta = dsp::scales()[12].mask;
    for (int n = 0; n < 256; ++n) {
        const float v = ShiftRegisterDsp::pitchFor(n, 2, 2, minorPenta, 0.0f);
        const int semis = (int)std::lround(v * 12.0f);
        EXPECT(dsp::inScale(minorPenta, semis - 2));
        EXPECT(semis >= 2 && semis <= 26);
    }
    EXPECT_NEAR(ShiftRegisterDsp::pitchFor(0, 2, 0, minorPenta, 1.0f), 1.0f, 1e-6);
}

/// Clock patched, a pulse every `period` samples.
static ShiftRegisterInput clocked(int i, int period) {
    ShiftRegisterInput in;
    in.clockPatched = true;
    in.clock = i % period == 0 ? 1.0f : 0.0f;
    return in;
}

static void gates() {
    TEST("Bit 2 is Bit 1 one step later; 100 % gate merges runs");
    ShiftRegisterParams p;
    p.lock = 0.0f;
    p.rateHz = 100.0f;
    p.sync = 0;
    p.gateLength = 1.0f;
    ShiftRegisterDsp d;
    d.prepare(kSr);
    ShiftRegisterFrame f;
    std::vector<float> b1, b2;
    for (int i = 0; i < 48000; ++i) {
        d.tick(p, clocked(i, 480), f);
        b1.push_back(f.bit[0]);
        b2.push_back(f.bit[1]);
    }
    for (size_t i = 480; i < b1.size(); ++i) EXPECT(b2[i] == b1[i - 480]);
    int edges = 0, ones = 0;
    for (size_t i = 1; i < b1.size(); ++i) edges += b1[i] > b1[i - 1], ones += i % 480 == 0 && b1[i] > 0.5f;
    EXPECT(edges < ones);  // runs of 1s are one gate
    TEST("Gate Length 25 %");
    p.gateLength = 0.25f;
    ShiftRegisterDsp e;
    e.prepare(kSr);
    for (int i = 0; i < 4800; ++i) {
        e.tick(p, clocked(i, 480), f);
        if (i >= 960 && i % 480 >= 121) EXPECT(f.bit[0] == 0.0f);
    }
}

static void comboAndMix() {
    TEST("Combo truth tables");
    for (int reg = 0; reg < 256; ++reg)
        for (uint8_t mask : {(uint8_t)0, (uint8_t)9, (uint8_t)0x5a, (uint8_t)0xff}) {
            const int chosen = reg & mask, count = std::popcount((unsigned)chosen);
            EXPECT(ShiftRegisterDsp::combo((uint16_t)reg, mask, SrCombine::Any) == (mask && count > 0));
            EXPECT(ShiftRegisterDsp::combo((uint16_t)reg, mask, SrCombine::All) == (mask && chosen == mask));
            EXPECT(ShiftRegisterDsp::combo((uint16_t)reg, mask, SrCombine::Odd) == (mask && (count & 1)));
        }
    TEST("Mix stays within ±1; a single +1 weight copies the bit");
    ShiftRegisterParams p;
    p.lock = 0.0f;
    p.rateHz = 200.0f;
    p.sync = 0;
    ShiftRegisterDsp d;
    d.prepare(kSr);
    ShiftRegisterFrame f;
    for (int i = 0; i < 48000; ++i) {
        for (int w = 0; w < 6; ++w) p.weight[(size_t)w] = (float)std::sin(i * 0.001 * (w + 1));
        d.tick(p, ShiftRegisterInput{}, f);
        EXPECT(std::fabs(f.mix) <= 1.0f + 1e-6f);
    }
    p.weight = {0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f};
    for (int i = 0; i < 4800; ++i) {
        d.tick(p, ShiftRegisterInput{}, f);
        EXPECT(f.mix == (float)((d.reg() >> 2) & 1u));
    }
}

static void dataSource() {
    TEST("Source Data with Lock +100 % passes the input through");
    ShiftRegisterParams p;
    p.lock = 1.0f;
    p.source = SrSource::Data;
    std::vector<bool> data;
    for (int k = 0; k < 300; ++k) data.push_back(dsp::uniform01(77, (uint64_t)k, 0) < 0.4);
    const auto r = steps(p, 300, &data);
    for (int k = 1; k < 300; ++k) EXPECT((bool)(r[(size_t)k] & 1u) == data[(size_t)k]);
}

int main() {
    lockExtremes();
    determinismAndSeek();
    timing();
    voltageAndPitch();
    gates();
    comboAndMix();
    dataSource();
    return bleep::test::finish("shift-register");
}
