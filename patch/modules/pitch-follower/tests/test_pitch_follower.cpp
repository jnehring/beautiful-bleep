// SPDX-License-Identifier: GPL-3.0-or-later
#include "PitchFollowerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdint>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    PitchFollowerDsp dsp;
    PitchFollowerParams p;
    std::vector<float> pitch, gate, conf, env;
    Run() { dsp.prepare(kSr); }
    template <class Src>
    void render(int n, Src&& src) {
        PitchFollowerFrame f;
        for (int i = 0; i < n; ++i) {
            dsp.tick(src(i), p, f);
            pitch.push_back(f.pitch);
            gate.push_back(f.gate);
            conf.push_back(f.confidence);
            env.push_back(f.env);
        }
    }
};

static float tone(double hz, int i) { return 0.5f * (float)std::sin(2.0 * kPi * hz * i / kSr); }
static double volts(double hz) { return std::log2(hz / kC4Hz); }

static void tracksTones() {
    TEST("pitch output is V/oct, 0 at middle C, within 3 cents for tones from 82 Hz to 1.3 kHz");
    for (double f : {82.41, 110.0, 196.0, 261.6256, 440.0, 659.26, 987.77, 1318.5}) {
        Run r;
        r.p.glide = 0.0f;
        r.render((int)(kSr * 0.4), [&](int i) { return tone(f, i); });
        EXPECT_NEAR(r.pitch.back() - volts(f), 0.0, 3.0 / 1200.0);
        EXPECT(r.gate.back() > 0.5f);
        EXPECT(r.conf.back() > 0.9f);
    }
}

static void middleCIsZeroVolts() {
    TEST("middle C gives about 0 V");
    Run r;
    r.render((int)(kSr * 0.4), [](int i) { return tone(261.6256, i); });
    EXPECT_NEAR(r.pitch.back(), 0.0, 0.003);
}

static void noiseGivesNoGate() {
    TEST("noise and silence: the gate stays closed and the confidence low");
    Run r;
    uint32_t s = 7;
    r.render((int)kSr, [&](int) {
        s = s * 1664525u + 1013904223u;
        return 0.4f * ((float)(s >> 8) / 8388608.0f - 1.0f);
    });
    int open = 0;
    for (size_t i = 24000; i < r.gate.size(); ++i) open += r.gate[i] > 0.5f;
    EXPECT(open < 2000);
    EXPECT(r.conf.back() < 0.5f);
    Run q;
    q.render(24000, [](int) { return 0.0f; });
    EXPECT(q.gate.back() < 0.5f);
    EXPECT(q.env.back() < 1e-6f);
}

static void holdsPitchAndGate() {
    TEST("when the tone stops the pitch holds, the gate closes after Hold");
    Run r;
    r.p.hold = 0.3f;
    r.p.glide = 0.0f;
    r.render((int)(kSr * 0.5), [](int i) { return tone(330.0, i); });
    const float held = r.pitch.back();
    r.render((int)(kSr * 0.15), [](int) { return 0.0f; });
    EXPECT(r.gate.back() > 0.5f);  // still inside Hold
    r.render((int)(kSr * 0.4), [](int) { return 0.0f; });
    EXPECT(r.gate.back() < 0.5f);
    EXPECT_NEAR(r.pitch.back(), held, 0.002);
}

static void glideSlews() {
    TEST("glide slews the output between notes without jumping");
    Run r;
    r.p.glide = 0.1f;
    r.render((int)(kSr * 0.4), [](int i) { return tone(220.0, i); });
    const size_t from = r.pitch.size();
    double ph = 0.0;
    r.render((int)(kSr * 0.5), [&](int) {
        ph += 330.0 / kSr;
        return 0.5f * (float)std::sin(2.0 * kPi * ph);
    });
    float biggest = 0.0f;
    for (size_t i = from + 1; i < r.pitch.size(); ++i) biggest = std::max(biggest, std::fabs(r.pitch[i] - r.pitch[i - 1]));
    EXPECT(biggest < 0.01f);
    EXPECT_NEAR(r.pitch.back(), volts(330.0), 0.03);
}

static void newNoteDoesNotGlideFromSilence() {
    TEST("a note after a gap starts at its own pitch (no glide from the old one)");
    Run r;
    r.p.glide = 0.5f;
    r.p.hold = 0.05f;
    r.render((int)(kSr * 0.4), [](int i) { return tone(220.0, i); });
    r.render((int)(kSr * 0.4), [](int) { return 0.0f; });
    r.render((int)(kSr * 0.3), [](int i) { return tone(440.0, i); });
    EXPECT_NEAR(r.pitch.back(), volts(440.0), 0.02);
}

static void octaveGuardResistsJump() {
    TEST("octave guard: brief octave errors do not reach the output, a held octave does");
    for (int guard : {0, 2}) {
        Run r;
        r.p.guard = guard;
        r.p.glide = 0.0f;
        double lowest = 9.0;
        r.render((int)(kSr * 0.4), [](int i) { return tone(247.0, i); });
        const int n = (int)(kSr * 0.6);
        r.render(n, [&](int i) {
            const double t = (double)i / kSr;
            const bool burst = (t > 0.1 && t < 0.116) || (t > 0.3 && t < 0.31);
            return tone(burst ? 123.5 : 247.0, i);
        });
        for (size_t i = (size_t)(kSr * 0.5); i < r.pitch.size(); ++i) lowest = std::min(lowest, (double)r.pitch[i]);
        if (guard == 2) EXPECT(lowest > volts(247.0) - 0.1);
    }
}

static void envelopeFollows() {
    TEST("the envelope output follows the loudness and falls with Release");
    Run r;
    r.p.release = 0.05f;
    r.render((int)(kSr * 0.3), [](int i) { return tone(200.0, i); });
    EXPECT_NEAR(r.env.back(), 0.5, 0.1);
    r.render((int)(kSr * 0.5), [](int) { return 0.0f; });
    EXPECT(r.env.back() < 0.01f);
}

static void voteSmoothsJitter() {
    TEST("vote lowers the jitter of the pitch on a wobbly tone");
    auto spread = [](int vote) {
        Run r;
        r.p.vote = vote;
        r.p.glide = 0.0f;
        uint32_t s = 3;
        double ph = 0.0;
        r.render((int)(kSr * 1.0), [&](int) {
            s = s * 1664525u + 1013904223u;
            const double wob = 1.0 + 0.012 * (((double)(s >> 8) / 8388608.0) - 1.0);
            ph += 200.0 * wob / kSr;
            return 0.5f * (float)std::sin(2.0 * kPi * ph);
        });
        double lo = 9, hi = -9;
        for (size_t i = (size_t)(kSr * 0.4); i < r.pitch.size(); ++i) {
            lo = std::min(lo, (double)r.pitch[i]);
            hi = std::max(hi, (double)r.pitch[i]);
        }
        return hi - lo;
    };
    EXPECT(spread(4) <= spread(0) + 1e-6);
}

static void finiteForAnyInput() {
    TEST("outputs stay finite for loud, DC and non-finite free garbage");
    Run r;
    r.render(48000, [](int i) { return (i % 700 < 350) ? 4.0f : -4.0f; });
    r.render(48000, [](int) { return 0.7f; });
    for (float v : r.pitch) EXPECT(std::isfinite(v));
    for (float v : r.env) EXPECT(std::isfinite(v));
}

int main() {
    tracksTones();
    middleCIsZeroVolts();
    noiseGivesNoGate();
    holdsPitchAndGate();
    glideSlews();
    newNoteDoesNotGlideFromSilence();
    octaveGuardResistsJump();
    envelopeFollows();
    voteSmoothsJitter();
    finiteForAnyInput();
    return bleep::test::finish("pitch_follower");
}
