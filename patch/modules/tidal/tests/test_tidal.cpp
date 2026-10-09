// SPDX-License-Identifier: MIT
// Tidal (doc/specs/modules/tidal.md §8): rate and 1 V/oct, skew, curve, smooth and
// fold, the four relations, clock following, transport lock, envelopes.
#include "TidalDsp.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::TidalDsp;
using patch::TidalFrame;
using patch::TidalParams;
using patch::TidalTime;

static constexpr double kSr = 48000.0;

/// Frequency knob (normalised) for `hz` in the Medium range.
static float medium(double hz) { return (float)(std::log(hz / 0.02) / std::log(2500.0)); }

struct Run {
    std::vector<float> out[4], rise, end;
};

/// Runs n samples; `trig(i)` and `clock(i)` give the inputs.
template <class Trig, class Clock>
static Run run(const TidalParams& p, int64_t n, Trig trig, Clock clock, bool clockPatched = false,
               TidalDsp* keep = nullptr) {
    TidalDsp local;
    TidalDsp& d = keep ? *keep : local;
    if (!keep) d.prepare(kSr);
    Run r;
    TidalTime t;
    TidalFrame f;
    for (int64_t i = 0; i < n; ++i) {
        d.tick(p, trig(i), clock(i), clockPatched, t, f);
        for (int k = 0; k < 4; ++k) r.out[k].push_back(f.out[k]);
        r.rise.push_back(f.rise);
        r.end.push_back(f.end);
    }
    return r;
}
static Run run(const TidalParams& p, int64_t n) {
    return run(p, n, [](int64_t) { return 0.0f; }, [](int64_t) { return 0.0f; });
}
static int count(const std::vector<float>& x) {
    int c = 0;
    for (float v : x) c += v > 0.5f ? 1 : 0;
    return c;
}
/// Upward crossings of `level`.
static int crossings(const std::vector<float>& x, float level) {
    int c = 0;
    for (size_t i = 1; i < x.size(); ++i) c += x[i - 1] < level && x[i] >= level ? 1 : 0;
    return c;
}

static void frequency() {
    TEST("tidal: 2 Hz gives 2 End pulses per second, Pitch +1 doubles");
    TidalParams p;
    p.freq = medium(2.0);
    EXPECT_NEAR(TidalDsp::rangeHz(patch::TidalMedium, p.freq), 2.0, 1e-4);
    EXPECT(count(run(p, 48000 + 10).end) == 2);
    p.pitch = 1.0f;
    EXPECT(count(run(p, 48000 + 10).end) == 4);
    // Range ends and the Audio range's centre.
    EXPECT_NEAR(TidalDsp::rangeHz(patch::TidalSlow, 0.0f), 0.001, 1e-9);
    EXPECT_NEAR(TidalDsp::rangeHz(patch::TidalSlow, 1.0f), 1.0, 1e-9);
    EXPECT_NEAR(TidalDsp::rangeHz(patch::TidalAudio, 0.0f), 8.0, 1e-9);
    EXPECT_NEAR(TidalDsp::rangeHz(patch::TidalAudio, 0.5f), TidalDsp::kC4, 1e-6);
    EXPECT_NEAR(TidalDsp::rangeHz(patch::TidalAudio, 1.0f), 8000.0, 1e-6);
}

static void skew() {
    TEST("tidal: skew sets the rise time; saws in Medium, limited in Audio");
    TidalParams p;
    p.freq = medium(10.0);
    p.skew = 0.25f;
    const Run r = run(p, 9600);
    // Rise gate: 25 % of a 100 ms cycle = 1200 samples per cycle.
    EXPECT(std::abs(count(r.rise) - 2400) <= 2);
    // Skew 0: a falling saw jumps from −1 to +1 at the wrap.
    p.skew = 0.0f;
    const Run s = run(p, 9600);
    float jump = 0.0f;
    for (size_t i = 1; i < s.out[0].size(); ++i) jump = std::max(jump, s.out[0][i] - s.out[0][i - 1]);
    EXPECT(jump > 1.9f);
    // Audio range: skew is limited, so the saw has a short rise (no vertical jump).
    p.range = patch::TidalAudio;
    p.freq = 0.0f;  // 8 Hz: the 0.5 % rise is 30 samples
    const Run a = run(p, 4800);
    jump = 0.0f;
    for (size_t i = 1; i < a.out[0].size(); ++i) jump = std::max(jump, a.out[0][i] - a.out[0][i - 1]);
    EXPECT(jump < 1.9f);
    EXPECT(count(a.rise) > 0);
}

static void curve() {
    TEST("tidal: curve values at u = 0.5");
    TidalParams p;
    p.freq = medium(1.0);
    p.skew = 1.0f;  // a rising saw: u = phase
    p.unipolar = true;
    for (float c : {-1.0f, 0.0f, 0.5f, 1.0f}) {
        p.curve = c;
        const Run r = run(p, 24001);
        const double expect = c == -1.0f ? 0.9375 : c == 0.0f ? 0.5 : c == 0.5f ? 0.5 : 0.0625;
        EXPECT_NEAR(r.out[0][24000 - 1], expect, 1e-3);
    }
}

static void smoothAndFold() {
    TEST("tidal: Smooth −1 keeps the level of a near-sine; +1 folds");
    TidalParams p;
    p.freq = medium(5.0);
    p.skew = 0.5f;
    p.curve = -1.0f;  // logarithmic: a plateau-like, square-ish contour
    p.smooth = -1.0f;
    const Run r = run(p, 48000 * 3);
    float lo = 1e9f, hi = -1e9f;
    for (size_t i = 48000 * 2; i < r.out[0].size(); ++i) lo = std::min(lo, r.out[0][i]), hi = std::max(hi, r.out[0][i]);
    EXPECT_NEAR(hi - lo, 2.0, 0.2);  // a full-scale sine has peak-to-peak 2 (bipolar)
    // Near-sine: the 3rd harmonic is small against the fundamental.
    std::vector<float> tail(r.out[0].begin() + 48000 * 2, r.out[0].end());
    EXPECT(test::magnitudeAt(tail, 15.0, kSr) < 0.1 * test::magnitudeAt(tail, 5.0, kSr));
    // Fold +1: x = (2v − 1) × 6 sweeps −6 … +6, reflected at every odd number:
    // six turning points inside each slope and one at each end of the
    // triangle, so seven peaks per cycle.
    p.curve = 0.0f;
    p.smooth = 1.0f;
    p.freq = medium(1.0);
    const Run f = run(p, 48000 * 3);
    int peaks = 0;
    for (size_t i = 12000; i < 12000 + 2 * 48000; ++i)
        peaks += f.out[0][i] > f.out[0][i - 1] && f.out[0][i] >= f.out[0][i + 1] ? 1 : 0;
    EXPECT(peaks == 14);
}

static void relations() {
    TEST("tidal: Phase quarter offsets, Harmonic 1:2:3:4, Ratio zone 3 realigns every 6 cycles");
    TidalParams p;
    p.freq = medium(1.0);
    p.relation = patch::TidalPhase;
    p.spread = 1.0f;
    p.skew = 1.0f;
    p.unipolar = true;
    const Run r = run(p, 48000);
    // A rising saw: output k leads by k/4 of a cycle.
    for (int k = 1; k < 4; ++k) {
        double expect = r.out[0][1000] + k * 0.25;
        expect -= std::floor(expect);
        EXPECT_NEAR(r.out[k][1000], expect, 1e-3);
    }
    p.spread = -1.0f;
    const Run b = run(p, 48000);
    double back = b.out[0][20000] - 0.25;
    back -= std::floor(back);
    EXPECT_NEAR(b.out[1][20000], back, 1e-3);

    p.relation = patch::TidalHarmonic;
    p.spread = 1.0f;
    p.skew = 0.5f;
    p.unipolar = false;
    const Run h = run(p, 48000 * 2 + 10);
    for (int k = 0; k < 4; ++k) EXPECT(crossings(h.out[k], 0.0f) == 2 * (k + 1));
    p.spread = -1.0f;
    const Run u = run(p, 48000 * 12 + 10);
    EXPECT(crossings(u.out[0], 0.0f) == 12 && crossings(u.out[3], 0.0f) == 3);

    p.relation = patch::TidalRatio;
    p.spread = 0.6f;  // zone 3: 4/3, 3/2, 2
    EXPECT(TidalDsp::ratioSet(0.6f).repeat == 6);
    EXPECT(TidalDsp::ratioSet(-0.2f).repeat == 12);  // 1/2, 1/3, 1/4
    p.freq = medium(4.0);
    const Run z = run(p, (int64_t)(48000 * 3.0) + 100);  // 12 cycles of A
    // After 6 and 12 cycles of A all four are back at the start together.
    for (int64_t at : {(int64_t)(48000 * 1.5) + 2, (int64_t)(48000 * 3.0) + 2})
        for (int k = 1; k < 4; ++k) EXPECT_NEAR(z.out[k][(size_t)at], z.out[0][(size_t)at], 0.02);
    // In between they differ.
    EXPECT(std::fabs(z.out[1][30000] - z.out[0][30000]) > 0.05f);
    // Level: staggered, alternating inversion below 0.
    p.relation = patch::TidalLevel;
    p.spread = -1.0f;
    const Run l = run(p, 4800);
    EXPECT_NEAR(l.out[1][3000], -(2.0f / 3.0f) * l.out[0][3000], 1e-4);
    EXPECT_NEAR(l.out[3][3000], 0.0f, 1e-6);
}

static void clockFollow() {
    TEST("tidal: clock ×4, ÷3, and a pause");
    TidalParams p;
    p.ratio = 9;  // ×4
    const int period = 12000;
    auto pulses = [&](int64_t i) { return i % period == 0 ? 1.0f : 0.0f; };
    const Run r = run(p, period * 10 + 10, [](int64_t) { return 0.0f; }, pulses, true);
    // After the first intervals: 4 cycles per pulse, the cycle restarts on each pulse.
    int ends = 0;
    for (int64_t i = period * 5 + 100; i < period * 9 + 100; ++i) ends += r.end[(size_t)i] > 0.5f ? 1 : 0;
    EXPECT(ends == 16);
    for (int k = 6; k < 10; ++k) {
        bool near = false;
        for (int64_t i = k * period - 2; i <= k * period + 1; ++i) near = near || r.end[(size_t)i] > 0.5f;
        EXPECT(near);
    }
    // ÷3: the phase resets on every third pulse; one cycle takes three pulses.
    p.ratio = 4;  // ÷3
    const Run d = run(p, period * 13 + 10, [](int64_t) { return 0.0f; }, pulses, true);
    std::vector<int64_t> at;
    for (int64_t i = period * 4; i < period * 13; ++i)
        if (d.end[(size_t)i] > 0.5f) at.push_back(i);
    EXPECT(at.size() == 3);
    if (at.size() == 3) EXPECT(std::llabs(at[1] - at[0] - 3 * period) <= 2);
    // A long pause, then a pulse: no runaway rate.
    TidalDsp dsp;
    dsp.prepare(kSr);
    p.ratio = 6;
    auto paused = [&](int64_t i) { return (i < period * 5 && i % period == 0) || i == period * 40 ? 1.0f : 0.0f; };
    const Run q = run(p, period * 41, [](int64_t) { return 0.0f; }, paused, true, &dsp);
    EXPECT(dsp.hz() < 10.0);
    EXPECT(test::allFinite(q.out[0]));
}

static void transport() {
    TEST("tidal: sync follows the song position and survives a loop jump");
    TidalParams p;
    p.sync = 11;  // 1/4
    EXPECT(std::string(TidalDsp::syncName(11)) == "1/4");
    p.skew = 1.0f;
    p.unipolar = true;
    TidalDsp d;
    d.prepare(kSr);
    TidalTime t;
    t.running = true;
    t.bpm = 120.0;
    TidalFrame f;
    const double ppqPerSample = 2.0 / kSr;
    std::vector<float> first;
    for (int i = 0; i < 48000; ++i) {
        t.ppq = i * ppqPerSample;
        t.started = i == 0;
        d.tick(p, 0.0f, 0.0f, false, t, f);
        first.push_back(f.out[0]);
        if (i == 30000) EXPECT_NEAR(f.out[0], std::fmod(t.ppq, 1.0), 1e-4);
    }
    // Jump back to 0.5 s and play again: identical values.
    for (int i = 24000; i < 48000; ++i) {
        t.ppq = i * ppqPerSample;
        t.started = false;
        d.tick(p, 0.0f, 0.0f, false, t, f);
        EXPECT(f.out[0] == first[(size_t)i]);
    }
}

static void envelopes() {
    TEST("tidal: AD retrigger and AR release start from the current level");
    TidalParams p;
    p.mode = patch::TidalAD;
    p.freq = medium(2.0);
    auto gate = [](int64_t i) { return i == 10 || i == 18000 ? 1.0f : 0.0f; };
    const Run r = run(p, 48000, gate, [](int64_t) { return 0.0f; });
    float step = 0.0f;
    for (size_t i = 11; i < r.out[0].size(); ++i) step = std::max(step, std::fabs(r.out[0][i] - r.out[0][i - 1]));
    EXPECT(step < 0.002f);  // the slope's own per-sample movement, nothing more
    EXPECT(r.out[0][17999] > 0.1f && r.out[0][17999] < 0.9f);
    p.mode = patch::TidalAR;
    auto held = [](int64_t i) { return i >= 10 && i < 2000 ? 1.0f : 0.0f; };  // released during the rise
    const Run a = run(p, 48000, held, [](int64_t) { return 0.0f; });
    EXPECT(a.out[0][1999] > 0.05f && a.out[0][1999] < 0.5f);
    EXPECT(std::fabs(a.out[0][2001] - a.out[0][1999]) < 0.002f);
    EXPECT(a.out[0][2100] < a.out[0][1999]);
    EXPECT(count(a.end) == 1);
    // Unipolar in AD and AR, every output in range.
    for (int k = 0; k < 4; ++k)
        for (float v : a.out[k]) EXPECT(v >= 0.0f && v <= 1.0f);
}

int main() {
    frequency();
    skew();
    curve();
    smoothAndFold();
    relations();
    clockFollow();
    transport();
    envelopes();
    return bleep::test::finish("tidal");
}
