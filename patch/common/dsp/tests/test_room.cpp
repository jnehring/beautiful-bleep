// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Room: bounded, decaying, RT60 close to the size law, sleeps, survives
// parameter modulation.
#include "dsp/Noise.h"
#include "dsp/Random.h"
#include "dsp/Room.h"
#include "dsp/tests/TestUtil.h"

#include <chrono>
#include <cstdio>
#include <vector>

using namespace bleep;

template <int N>
static void impulse() {
    TEST(N == 4 ? "room4 impulse" : "room8 impulse");
    const double sr = 48000.0;
    for (float size : {0.0f, 0.4f, 1.0f}) {
        dsp::Room<N> room;
        room.prepare(sr);
        dsp::RoomParams p;
        p.size = size;
        p.amount = 1.0f;
        p.damping = 0.3f;
        room.set(p);
        std::vector<float> l, r;
        const int n = (int)(5.0 * sr);
        for (int i = 0; i < n; ++i) {
            const auto o = room.process(i == 0 ? 1.0f : 0.0f, i == 0 ? 1.0f : 0.0f);
            l.push_back(o.l);
            r.push_back(o.r);
        }
        EXPECT(test::allFinite(l) && test::allFinite(r));
        float peak = 0.0f;
        for (size_t i = 0; i < l.size(); ++i) peak = std::max(peak, std::max(std::fabs(l[i]), std::fabs(r[i])));
        EXPECT(peak < 1.0f);
        // Energy decays: each window (longer for big rooms) is quieter
        // (over the first 50 dB or so of the tail).
        const double rt = 0.3 * std::pow(4.0 / 0.3, size);
        const size_t w = (size_t)((0.05 + 0.1 * rt) * sr);
        double prev = 1e9;
        for (size_t s = (size_t)(0.1 * sr); s + w < (size_t)((0.1 + 0.8 * rt) * sr); s += w) {
            const double e = test::rms(std::vector<float>(l.begin() + (long)s, l.begin() + (long)(s + w)));
            EXPECT(e < prev);
            prev = e;
        }
        // RT60 from the slope over 40 % of the expected RT60 (50 ms windows).
        const size_t wa = (size_t)(0.1 * sr), wb = (size_t)((0.1 + 0.4 * rt) * sr);
        const size_t ww = (size_t)(0.05 * sr);
        auto win = [&](size_t s) {
            std::vector<float> v(l.begin() + (long)s, l.begin() + (long)(s + ww));
            v.insert(v.end(), r.begin() + (long)s, r.begin() + (long)(s + ww));
            return test::rms(v);
        };
        const double db = 20.0 * std::log10(win(wa) / win(wb));
        const double measured = 60.0 * (double)(wb - wa) / sr / db;
        std::printf("  room%d size %.1f: RT60 %.2f s (law %.2f s)\n", N, size, measured, rt);
        EXPECT_NEAR(measured, rt, 0.3 * rt);
        // Left and right differ (stereo).
        double diff = 0.0;
        for (size_t i = 0; i < l.size() / 4; ++i) diff += std::fabs(l[i] - r[i]);
        EXPECT(diff > 1.0);
    }
}

static void sleep() {
    TEST("room sleep");
    dsp::Room<4> room;
    room.prepare(48000.0);
    dsp::RoomParams p;
    p.size = 0.0f;
    room.set(p);
    EXPECT(room.sleeping());
    room.process(1.0f, 1.0f);
    EXPECT(!room.sleeping());
    for (int i = 0; i < 48000 * 3; ++i) room.process(0.0f, 0.0f);
    EXPECT(room.sleeping());
    const auto o = room.process(0.0f, 0.0f);
    EXPECT(o.l == 0.0f && o.r == 0.0f);
    // Amount 0 gives silence.
    p.amount = 0.0f;
    room.set(p);
    float sum = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        const auto q = room.process(0.5f, -0.5f);
        sum += std::fabs(q.l) + std::fabs(q.r);
    }
    EXPECT(sum == 0.0f);
}

static void modulation() {
    TEST("room modulation");
    dsp::Room<4> room;
    room.prepare(96000.0, 9);
    dsp::WhiteNoise n(4);
    float peak = 0.0f;
    bool finite = true;
    for (int i = 0; i < 96000 * 4; ++i) {
        if (i % 32 == 0) {
            dsp::RoomParams p;
            p.size = (float)dsp::uniform01(3, (uint64_t)i, 1);
            p.damping = (float)dsp::uniform01(3, (uint64_t)i, 2);
            p.amount = 1.0f;
            p.decay = i % 64 == 0 ? 0.0f : 10.0f * (float)dsp::uniform01(3, (uint64_t)i, 3);
            room.set(p);
        }
        const auto o = room.process(0.5f * n.next(), 0.5f * n.next());
        finite = finite && std::isfinite(o.l) && std::isfinite(o.r);
        peak = std::max(peak, std::max(std::fabs(o.l), std::fabs(o.r)));
    }
    EXPECT(finite);
    EXPECT(peak < 4.0f);
}

static void cpu() {
    dsp::Room<4> room;
    room.prepare(48000.0);
    dsp::RoomParams p;
    p.amount = 1.0f;
    room.set(p);
    dsp::WhiteNoise n(1);
    float acc = 0.0f;
    const int count = 480000;
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < count; ++i) acc += room.process(n.next(), 0.0f).l;
    const double ns = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - t0).count() / count;
    std::printf("  room4: %.1f ns/sample%s\n", ns, std::isfinite(acc) ? "" : " !");
}

int main() {
    impulse<4>();
    impulse<8>();
    sleep();
    modulation();
    cpu();
    return test::finish("room");
}
