// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Waves.h: the LFO wave set, the phasor and the ppq phase lock. The LFO was
// refactored onto Waves.h; its previous implementation is copied below
// verbatim (namespace oldlfo) and both run side by side: the outputs must be
// bit-identical.
#include "dsp/Waves.h"

#include "LfoDsp.h"
#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

// ---- The LFO before the refactor (commit 05dfc5a), unchanged ----------------
namespace bleep::oldlfo {

enum LfoWave { LfoSine = 0, LfoTriangle, LfoSawUp, LfoSawDown, LfoSquare, LfoRandomStep, LfoRandomSmooth, kLfoWaves };

struct LfoParams {
    float rateHz = 1.0f;
    int sync = 0;              ///< dsp::syncNames() index; 0 = free
    float phase = 0.0f;        ///< 0..1 offset
    float pulseWidth = 0.5f;
    float fade = 0.0f;         ///< seconds
    int wave = LfoSine;
    bool unipolar = false;
    uint32_t seed = 1;
};

struct LfoTime {
    bool running = false;      ///< transport playing with a valid position
    bool started = false;      ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct LfoFrame {
    float out = 0.0f, sine = 0.0f, triangle = 0.0f, saw = 0.0f, square = 0.0f, random = 0.0f, cycle = 0.0f;
};

class LfoDsp {
public:
    static constexpr double kTwoPi = 6.283185307179586;

    /// Seeded random value for a cycle, in −1..+1.
    static float randomAt(uint32_t seed, int64_t cycle) noexcept {
        return (float)(2.0 * dsp::uniform01(seed, (uint64_t)cycle, 11) - 1.0);
    }
    static float triangle(double p) noexcept {
        return (float)(p < 0.25 ? 4.0 * p : p < 0.75 ? 2.0 - 4.0 * p : 4.0 * p - 4.0);
    }
    /// Bipolar value of `wave` at phase p (0..1) in cycle `cycle`.
    static float value(int wave, double p, float pulseWidth, uint32_t seed, int64_t cycle) noexcept {
        switch (wave) {
            case LfoTriangle: return triangle(p);
            case LfoSawUp: return (float)(2.0 * p - 1.0);
            case LfoSawDown: return (float)(1.0 - 2.0 * p);
            case LfoSquare: return p < (double)std::clamp(pulseWidth, 0.05f, 0.95f) ? 1.0f : -1.0f;
            case LfoRandomStep: return randomAt(seed, cycle);
            case LfoRandomSmooth: {
                const double k = 0.5 - 0.5 * std::cos(p * kTwoPi * 0.5);
                return (float)((1.0 - k) * randomAt(seed, cycle) + k * randomAt(seed, cycle + 1));
            }
            default: return (float)std::sin(p * kTwoPi);
        }
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        reset_.reset();
        phase_ = 0.0;
        cycle_ = 0;
        started_ = false;
        fadeGain_ = 1.0f;
    }

    /// Phase within the cycle (0..1, before the Phase offset).
    double phase() const noexcept { return phase_; }

    void tick(const LfoParams& p, float resetIn, const LfoTime& t, LfoFrame& f) noexcept {
        f.cycle = 0.0f;
        const bool resetEdge = reset_.process(resetIn) > 0;
        if (resetEdge || t.started) fadeGain_ = 0.0f;
        const double beats = dsp::syncBeats(p.sync);
        if (beats > 0.0 && t.running) {
            const double s = t.ppq / beats;
            const int64_t n = (int64_t)std::floor(s);
            const double inc = t.bpm / 60.0 / sampleRate_ / beats;
            if (started_ ? n != cycle_ : s - (double)n < inc) f.cycle = 1.0f;
            cycle_ = n;
            phase_ = s - (double)n;
        } else {
            const double hz = beats > 0.0 ? t.bpm / 60.0 / beats : (double)p.rateHz;
            if (resetEdge || !started_) {
                if (started_) ++cycle_;
                phase_ = 0.0;
                f.cycle = 1.0f;
            } else {
                phase_ += hz / sampleRate_;
                if (phase_ >= 1.0) {
                    const double whole = std::floor(phase_);
                    phase_ -= whole;
                    cycle_ += (int64_t)whole;
                    f.cycle = 1.0f;
                }
            }
        }
        started_ = true;
        if (p.fade > 0.0f) fadeGain_ = std::min(1.0f, fadeGain_ + (float)(1.0 / (p.fade * sampleRate_)));
        else fadeGain_ = 1.0f;

        const double shifted = phase_ + (double)std::clamp(p.phase, 0.0f, 1.0f);
        const int64_t cycle = cycle_ + (int64_t)std::floor(shifted);
        const double ph = shifted - std::floor(shifted);
        auto out = [&](float v) { return (p.unipolar ? 0.5f + 0.5f * v : v) * fadeGain_; };
        f.sine = out(value(LfoSine, ph, p.pulseWidth, p.seed, cycle));
        f.triangle = out(value(LfoTriangle, ph, p.pulseWidth, p.seed, cycle));
        f.saw = out(value(LfoSawUp, ph, p.pulseWidth, p.seed, cycle));
        f.square = out(value(LfoSquare, ph, p.pulseWidth, p.seed, cycle));
        f.random = out(value(LfoRandomStep, ph, p.pulseWidth, p.seed, cycle));
        f.out = p.wave == LfoRandomSmooth ? out(value(LfoRandomSmooth, ph, p.pulseWidth, p.seed, cycle))
                : p.wave == LfoSawDown    ? out(value(LfoSawDown, ph, p.pulseWidth, p.seed, cycle))
                : p.wave == LfoTriangle   ? f.triangle
                : p.wave == LfoSawUp      ? f.saw
                : p.wave == LfoSquare     ? f.square
                : p.wave == LfoRandomStep ? f.random
                                          : f.sine;
    }

private:
    double sampleRate_ = 48000.0;
    dsp::GateEdge reset_;
    double phase_ = 0.0;
    int64_t cycle_ = 0;
    bool started_ = false;
    float fadeGain_ = 1.0f;
};

}  // namespace bleep::oldlfo
// -----------------------------------------------------------------------------

using namespace bleep;

static bool sameFrame(const patch::LfoFrame& a, const oldlfo::LfoFrame& b) {
    return a.out == b.out && a.sine == b.sine && a.triangle == b.triangle && a.saw == b.saw && a.square == b.square &&
           a.random == b.random && a.cycle == b.cycle;
}

static void regressionAgainstOldLfo() {
    TEST("waves: LfoDsp wave functions identical to the pre-refactor LFO");
    // Pure wave functions over a dense phase grid, all waves, several cycles and seeds.
    int bad = 0;
    for (int w = 0; w < patch::kLfoWaves; ++w)
        for (int i = 0; i <= 4000; ++i) {
            const double p = i / 4000.0 * 0.999999;
            const float pw = 0.05f + 0.9f * (float)((i * 7) % 100) / 100.0f;
            for (uint32_t seed : {0u, 1u, 77u, 999u})
                for (int64_t cycle : {(int64_t)-3, (int64_t)0, (int64_t)5, (int64_t)123456})
                    bad += patch::LfoDsp::value(w, p, pw, seed, cycle) != oldlfo::LfoDsp::value(w, p, pw, seed, cycle);
        }
    EXPECT(bad == 0);
    EXPECT(patch::LfoDsp::randomAt(42, 9) == oldlfo::LfoDsp::randomAt(42, 9));
    EXPECT(patch::LfoDsp::triangle(0.3) == oldlfo::LfoDsp::triangle(0.3));
}

static void waveValues() {
    TEST("waves: values");
    using namespace dsp::waves;
    EXPECT_NEAR(sine(0.25), 1.0, 1e-7);
    EXPECT_NEAR(triangle(0.75), -1.0, 1e-7);
    EXPECT(sawUp(0.0) == -1.0f && sawDown(0.0) == 1.0f);
    EXPECT(square(0.04, 0.0f) == 1.0f && square(0.06, 0.0f) == -1.0f);  // pulse width clamped to 5 %
    EXPECT(randomStep(3, 4) == randomAt(3, 4, kRandomStream));
    EXPECT(randomAt(3, 4, 1) != randomAt(3, 4, 2));  // Quad LFO: one stream per channel
    EXPECT_NEAR(randomSmooth(0.0, 3, 4), randomAt(3, 4), 1e-6);
    EXPECT_NEAR(randomSmooth(1.0, 3, 4), randomAt(3, 5), 1e-6);
    EXPECT(unipolar(-1.0f) == 0.0f && unipolar(1.0f) == 1.0f);
    const dsp::CyclePhase c = dsp::offsetPhase(0.75, 10, 0.5);
    EXPECT(c.cycle == 11 && std::fabs(c.phase - 0.25) < 1e-12);
}

static void phasor() {
    TEST("waves: phasor counts cycles");
    dsp::Phasor p;
    int wraps = 0;
    for (int i = 0; i < 48010; ++i) wraps += p.advance(3.0, 48000.0);  // just past 3 cycles
    EXPECT(wraps == 3 && p.cycle() == 3);
    // Negative increments wrap backwards and count down.
    dsp::Phasor n;
    n.reset(0.1, 5);
    EXPECT(n.advance(-0.2) && n.cycle() == 4 && std::fabs(n.phase() - 0.9) < 1e-12);
    n.restart();
    EXPECT(n.cycle() == 5 && n.phase() == 0.0);
}

static void ppqLock() {
    TEST("waves: phase locked to ppq");
    // One cycle per bar (4 quarters): phase = frac(ppq / 4), cycle = floor.
    EXPECT_NEAR(dsp::ppqPhase(5.0, 4.0), 0.25, 1e-12);
    EXPECT(dsp::ppqCycle(5.0, 4.0) == 1);
    EXPECT(dsp::ppqCycle(-0.5, 4.0) == -1);
    EXPECT_NEAR(dsp::ppqPhase(5.0, 4.0, 3.0), 0.75, 1e-12);  // ratio 3 per bar
    EXPECT_NEAR(dsp::syncedHz(120.0, 4.0), 0.5, 1e-12);

    // Phasor::lock follows the song, fires on every bar line, repeats exactly
    // after a loop jump, and on a first sample fires only on the bar's first sample.
    const double sr = 48000.0, bpm = 120.0, beats = 4.0;
    const double perSample = bpm / 60.0 / sr;  // quarters per sample
    dsp::Phasor p;
    int edges = 0, bad = 0;
    std::vector<double> first;
    for (int i = 0; i < 200000; ++i) {
        const int j = i < 100000 ? i : i - 100000;  // jump back to the start
        const double ppq = 1.0 + j * perSample;
        edges += p.lock(ppq, beats, bpm, sr, i != 0 && i != 100000);
        bad += std::fabs(p.phase() - std::fmod(ppq / beats, 1.0)) > 1e-12;
        if (i < 100) first.push_back(p.phase());
        if (i >= 100000 && i < 100100) bad += p.phase() != first[(size_t)(i - 100000)];
    }
    EXPECT(bad == 0);
    // 100000 samples = 4.17 quarters → ppq 1 … 5.17: one bar line (at 4) per pass.
    EXPECT(edges == 2);
    dsp::Phasor q;
    EXPECT(q.lock(4.0, beats, bpm, sr, false));                    // exactly on the bar: an edge
    dsp::Phasor r;
    EXPECT(!r.lock(4.0 + 10 * perSample, beats, bpm, sr, false));  // mid-bar start: none
}

int main() {
    regressionAgainstOldLfo();
    waveValues();
    phasor();
    ppqLock();
    return bleep::test::finish("waves");
}
