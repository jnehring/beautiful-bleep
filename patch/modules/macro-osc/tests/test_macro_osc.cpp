// SPDX-License-Identifier: MIT
// Macro Osc (doc/specs/modules/macro-oscillator.md §8): pitch per pitched model,
// aliasing at a high note per model, Harmonic's band limit, click-free model
// changes, the trigger envelope and gate, silent drums, Pluck tuning,
// determinism, bounded outputs under random knobs, and a CPU report per model.
#include "MacroOscDsp.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <memory>
#include <vector>

using namespace bleep;
using patch::MacroOscDsp;
using patch::MacroOscParams;
namespace macro = patch::macro;

namespace {

constexpr double kSr = 48000.0;
constexpr double kC4 = 261.6255653005986;
constexpr double kPi = 3.14159265358979323846;
const char* const kNames[macro::kModels] = {"VA Pair", "Fold",  "FM",    "Phase Warp", "Grain", "Harmonic",
                                             "Table",   "Chord", "Vowel", "Noise Band", "Dust",  "Pluck",
                                             "Modal",   "Kick",  "Snare", "Metal"};

struct Render {
    std::vector<float> out, aux, env;
};

struct Setup {
    int quality = 1;
    bool gated = false;
    int triggerEvery = 0;  ///< samples (0: none); the first at sample `firstTrigger`
    int firstTrigger = 0;
    float accent = 1.0f;
    uint32_t seed = 1;
    int voice = -1;
    bool wantAux = true;
};

Render render(MacroOscParams p, int n, const Setup& s = {}, const std::function<void(int, MacroOscParams&)>& mod = {}) {
    auto dsp = std::make_unique<MacroOscDsp>();  // a fresh instance per render (the wavetables are shared)
    MacroOscDsp* d = dsp.get();
    d->prepare(kSr);
    d->setQuality(s.quality);
    d->setSeed(s.seed, s.voice);
    d->setGated(s.gated);
    d->setWantAux(s.wantAux);
    Render r;
    r.out.reserve((size_t)n), r.aux.reserve((size_t)n), r.env.reserve((size_t)n);
    for (int i = 0; i < n; ++i) {
        if (mod) mod(i, p);
        const bool trig = s.gated && s.triggerEvery > 0 && i >= s.firstTrigger && (i - s.firstTrigger) % s.triggerEvery == 0;
        const auto f = d->process(p, trig, s.accent);
        r.out.push_back(f.out), r.aux.push_back(f.aux), r.env.push_back(f.env);
    }
    return r;
}

MacroOscParams params(int model) {
    MacroOscParams p;
    p.model = model;
    p.level = 1.0f;
    return p;
}

std::vector<float> slice(const std::vector<float>& x, size_t from, size_t n) {
    return std::vector<float>(x.begin() + (long)from, x.begin() + (long)std::min(x.size(), from + n));
}

/// Complex DFT at `hz` under a 4-term Blackman-Harris window (sidelobes −92 dB),
/// normalised so a full-scale sine gives magnitude 0.5.
struct Bin {
    double re, im;
    double mag() const { return std::sqrt(re * re + im * im); }
};
Bin dft(const std::vector<float>& x, size_t from, size_t n, double hz) {
    double re = 0.0, im = 0.0, wsum = 0.0;
    for (size_t i = 0; i < n; ++i) {
        const double t = 2.0 * kPi * (double)i / (double)(n - 1);
        const double w = 0.35875 - 0.48829 * std::cos(t) + 0.14128 * std::cos(2 * t) - 0.01168 * std::cos(3 * t);
        const double ph = 2.0 * kPi * hz * (double)(from + i) / kSr;
        re += w * x[from + i] * std::cos(ph);
        im -= w * x[from + i] * std::sin(ph);
        wsum += w;
    }
    return {re / wsum, im / wsum};
}

/// Frequency of the component near `hz` from the phase advance between two
/// windows `gap` samples apart (precise to a small fraction of a cent).
double measureHz(const std::vector<float>& x, size_t from, double hz, size_t n = 8192, size_t gap = 16384) {
    const Bin a = dft(x, from, n, hz), b = dft(x, from + gap, n, hz);
    // Both bins are referred to absolute time, so a component exactly at hz has equal phase.
    double d = std::atan2(b.im, b.re) - std::atan2(a.im, a.re);
    while (d > kPi) d -= 2 * kPi;
    while (d < -kPi) d += 2 * kPi;
    return hz + d / (2.0 * kPi * (double)gap / kSr);
}

double cents(double a, double b) { return 1200.0 * std::log2(a / b); }

/// Largest aliased component (dB) relative to the strongest harmonic, for a
/// render at f0: probes the folded images of harmonics up to 6 × Nyquist that
/// land at least 25 Hz from every true harmonic.
double aliasDb(const std::vector<float>& x, double f0, size_t from, size_t n = 32768) {
    double ref = 1e-12;
    for (int k = 1; k * f0 < 0.5 * kSr; ++k) ref = std::max(ref, dft(x, from, n, k * f0).mag());
    double worst = 1e-12;
    for (int k = (int)(0.5 * kSr / f0) + 1; k * f0 < 3.0 * kSr; ++k) {
        double a = std::fmod(k * f0, kSr);
        if (a > 0.5 * kSr) a = kSr - a;
        const double near = std::fabs(a - f0 * std::round(a / f0));
        if (near < 25.0 || a < 20.0 || a > 20000.0) continue;  // the audible band
        const double mag = dft(x, from, n, a).mag();
        if (std::getenv("MACRO_DEBUG") && mag > worst) std::printf("      k %d → %.1f Hz: %.1f dB\n", k, a, 20 * std::log10(mag / ref));
        worst = std::max(worst, mag);
    }
    return 20.0 * std::log10(worst / ref);
}

double maxAbs(const std::vector<float>& x, size_t from = 0, size_t to = ~size_t(0)) {
    double m = 0.0;
    for (size_t i = from; i < std::min(to, x.size()); ++i) m = std::max(m, (double)std::fabs(x[i]));
    return m;
}
double maxStep(const std::vector<float>& x, size_t from = 1, size_t to = ~size_t(0)) {
    double m = 0.0;
    for (size_t i = std::max<size_t>(from, 1); i < std::min(to, x.size()); ++i) m = std::max(m, (double)std::fabs(x[i] - x[i - 1]));
    return m;
}

// ---- tests ---------------------------------------------------------------------

constexpr int kPitched[] = {macro::VaPair, macro::Fold, macro::Fm, macro::PhaseWarp, macro::Grain,
                            macro::Harmonic, macro::Table, macro::Chord, macro::Vowel};

void pitchPerModel() {
    for (int m : kPitched) {
        TEST(kNames[m]);
        for (double oct : {0.0, 1.0}) {
            MacroOscParams p = params(m);
            p.pitch = oct;
            if (m == macro::VaPair) p.tone = 0.0f;  // unison: osc 2's detune would sit inside the analysis window
            const Render r = render(p, 48000);
            const double want = kC4 * std::exp2(oct);
            const double got = measureHz(r.out, 4096, want);
            if (std::fabs(cents(got, want)) > 0.1) std::printf("  %s %+g V: %.4f Hz (%+.3f ct)\n", kNames[m], oct, got, cents(got, want));
            EXPECT(std::fabs(cents(got, want)) <= 0.1);
            EXPECT(dft(r.out, 4096, 8192, want).mag() > 1e-3);  // the fundamental is there
        }
    }
    // Modal's fundamental mode is in tune too (struck, ringing).
    TEST("Modal pitch");
    MacroOscParams p = params(macro::Modal);
    p.decay = 4.0f;
    Setup s;
    s.gated = true, s.triggerEvery = 1 << 30;
    const Render r = render(p, 48000, s);
    EXPECT(std::fabs(cents(measureHz(r.out, 2048, kC4), kC4)) <= 0.5);
}

void aliasingAtHighNote() {
    // C7 (2093 Hz) at Normal and High quality, at bright settings per model.
    std::printf("  aliasing at C7, dB below the strongest harmonic (Normal / High):\n");
    struct Limit {
        int model;
        double normal, high;
        float tone, shape, blend;
        double pitch;
        const char* what;
    };
    const Limit limits[] = {
        {macro::VaPair, -60, -70, 0.0f, 0.0f, 0.0f, 3.0, "saws"},
        {macro::VaPair, -60, -70, 0.5f, 0.8f, 0.6f, 3.0, "synced pulses"},
        {macro::Fold, -60, -70, 0.8f, 0.5f, 0.0f, 3.0, "drive 11"},
        {macro::Fm, -60, -70, 0.5f, 0.8f, 0.0f, 3.0, "index 5"},
        {macro::Fm, -60, -70, 0.5f, 0.6f, 1.0f, 3.0, "feedback"},
        {macro::PhaseWarp, -60, -70, 0.8f, 0.6f, 0.5f, 3.0, "warp + res"},
        {macro::Grain, -60, -60, 0.5f, 0.5f, 0.5f, 3.0, "pair"},
        {macro::Harmonic, -90, -90, 0.5f, 0.5f, 0.0f, 3.0, ""},
        {macro::Table, -65, -65, 0.5f, 0.5f, 0.5f, 3.0, ""},
        {macro::Chord, -60, -70, 0.5f, 0.5f, 1.0f, 3.0, "root saw"},
        // Vowel's floor is its aspiration noise (a few % of the voiced level), not aliasing.
        {macro::Vowel, -45, -45, 0.5f, 0.5f, 0.0f, 2.0, "C6"},
    };
    for (const auto& l : limits) {
        TEST(kNames[l.model]);
        double db[2];
        const double f0 = kC4 * std::exp2(l.pitch);
        for (int q = 0; q < 2; ++q) {
            MacroOscParams p = params(l.model);
            p.pitch = l.pitch;
            p.tone = l.tone, p.shape = l.shape, p.blend = l.blend;
            Setup s;
            s.quality = q == 0 ? 1 : 2;
            const Render r = render(p, 40000, s);
            // Chord: the root voice on Aux (the chord itself isn't harmonic to f).
            db[q] = aliasDb(l.model == macro::Chord ? r.aux : r.out, f0, 4096);
        }
        std::printf("    %-10s %-14s %7.1f / %7.1f dB\n", kNames[l.model], l.what, db[0], db[1]);
        EXPECT(db[0] <= l.normal);
        EXPECT(db[1] <= l.high);
    }
}

void harmonicBandLimit() {
    TEST("Harmonic band limit");
    // At C8 (4186 Hz) partials 6+ would be above 0.45 fs (21.6 kHz): none may sound.
    MacroOscParams p = params(macro::Harmonic);
    p.pitch = 4.0;
    p.tone = 1.0f;  // peak on partial 24
    p.shape = 1.0f;
    const Render r = render(p, 40000);
    for (int k = 6; k <= 24; ++k) {
        const double hz = kC4 * 16.0 * k;
        double a = std::fmod(hz, kSr);
        if (a > 0.5 * kSr) a = kSr - a;
        EXPECT(dft(r.out, 4096, 32768, a).mag() < 1e-5);
    }
    // A sweep across the cut is click-free.
    TEST("Harmonic sweep");
    p.tone = 0.3f;
    p.shape = 0.5f;
    const Render s = render(p, 96000, {}, [](int i, MacroOscParams& q) { q.pitch = 2.0 + 2.5 * i / 96000.0; });
    double steady = 0.0;  // the largest step of steady tones along the sweep
    for (double pitch = 2.0; pitch <= 4.5; pitch += 1.0 / 24.0) {
        MacroOscParams q = p;
        q.pitch = pitch;
        steady = std::max(steady, maxStep(render(q, 4800).out, 2000));
    }
    std::printf("  Harmonic sweep: max step %.4f (steady tones %.4f)\n", maxStep(s.out, 2000), steady);
    EXPECT(maxStep(s.out, 2000) <= 1.1 * steady + 0.01);
}

void modelChanges() {
    // Every index is reachable and the change is a crossfade: no step larger
    // than either model's own largest step.
    for (int m = 0; m < macro::kModels; ++m) {
        TEST(kNames[m]);
        MacroOscDsp d;
        d.prepare(kSr);
        MacroOscParams p = params(m);
        for (int i = 0; i < 2000; ++i) d.process(p, false, 1.0f);
        EXPECT(d.model() == m);
    }
    for (int m = 0; m + 1 < macro::kModels; ++m) {
        TEST("model change");
        const int n = 24000, at = 12000;
        MacroOscParams a = params(m), b = params(m + 1);
        a.level = b.level = 0.8f;
        const Render ra = render(a, n), rb = render(b, n);
        const Render rs = render(a, n, {}, [&](int i, MacroOscParams& q) { q.model = i < at ? m : m + 1; });
        const double own = std::max(maxStep(ra.out, 2000), maxStep(rb.out, 2000));
        const double sw = maxStep(rs.out, at - 10, at + 2000);
        // During the fade two signals add (equal power: up to √2 × either slope).
        if (sw > own * 1.42 + 1e-3) std::printf("  %s → %s: step %.4f, own %.4f\n", kNames[m], kNames[m + 1], sw, own);
        EXPECT(sw <= own * 1.42 + 1e-3);
    }
    TEST("model jump far");
    MacroOscParams p = params(macro::Chord);
    const Render r = render(p, 24000, {}, [](int i, MacroOscParams& q) { q.model = i < 8000 ? macro::Chord : i < 8100 ? macro::Harmonic : macro::VaPair; });
    const double own = std::max({maxStep(render(params(macro::Chord), 9600).out, 2000),
                                 maxStep(render(params(macro::Harmonic), 9600).out, 2000),
                                 maxStep(render(params(macro::VaPair), 9600).out, 2000)});
    std::printf("  far jump: step %.4f, own %.4f\n", maxStep(r.out, 7000, 12000), own);
    EXPECT(maxStep(r.out, 7000, 12000) <= own * 1.42 + 1e-3);
}

void triggerAndEnvelope() {
    TEST("envelope");
    MacroOscParams p = params(macro::VaPair);
    p.decay = 0.5f;
    Setup s;
    s.gated = true, s.triggerEvery = 1 << 30, s.firstTrigger = 1000, s.accent = 0.7f;
    const Render r = render(p, 60000, s);
    EXPECT(r.env[999] == 0.0f);
    EXPECT(r.env[1000] > 0.0f);
    EXPECT_NEAR(r.env[1000 + 23], 0.7, 0.01);  // 0.5 ms ramp
    EXPECT(r.env[1000 + 24 + 24000] <= 0.7 * 0.0011);  // −60 dB after Decay
    EXPECT(maxAbs(r.out, 0, 1000) < 1e-6);  // gated: silent before the strike
    EXPECT(maxAbs(r.out, 1000, 6000) > 0.1);
    EXPECT(maxAbs(r.out, 40000) < 1e-3);
    EXPECT(maxStep(r.out, 990, 1100) < 0.1);  // anti-click rise

    TEST("ungated");
    const Render u = render(params(macro::VaPair), 4800);
    EXPECT(maxAbs(u.env) == 0.0);
    EXPECT(test::rms(u.out, 1000) > 0.1);

    TEST("gate colour");
    for (float c : {0.0f, 0.5f, 1.0f}) {
        MacroOscParams q = params(macro::VaPair);
        q.gateColour = c;
        const Render g = render(q, 30000, s);
        EXPECT(test::allFinite(g.out));
        EXPECT(maxAbs(g.out, 1000, 4000) > 0.05);
        EXPECT(maxAbs(g.out, 25000) < 0.02);
    }

    for (int m = macro::Kick; m <= macro::Metal; ++m) {
        TEST(kNames[m]);
        const Render silent = render(params(m), 9600);
        EXPECT(maxAbs(silent.out) == 0.0);
        MacroOscParams q = params(m);
        q.pitch = m == macro::Kick ? -2.0 : 0.0;
        const Render hit = render(q, 48000, s);
        EXPECT(maxAbs(hit.out, 0, 1000) == 0.0);
        EXPECT(maxAbs(hit.out, 1000, 5000) > 0.1);
        EXPECT(maxAbs(hit.out, 1000) <= 1.0);
        EXPECT(maxAbs(hit.out, 46000) < 0.01);  // decayed within ~1 s at Decay 0.5 s
    }
    TEST("retrigger adds energy");
    {
        MacroOscParams q = params(macro::Modal);
        q.decay = 2.0f;
        Setup roll = s;
        roll.triggerEvery = 2400;
        const Render one = render(q, 24000, s), many = render(q, 24000, roll);
        EXPECT(test::rms(many.out, 12000) > 1.3 * test::rms(one.out, 12000));
        EXPECT(maxAbs(many.out) <= 1.0);
    }
}

void pluckTuning() {
    TEST("Pluck tuning");
    for (int oct = -2; oct <= 3; ++oct) {
        MacroOscParams p = params(macro::Pluck);
        p.pitch = oct;
        p.decay = 6.0f;
        p.shape = 0.2f;
        Setup s;
        s.gated = true, s.triggerEvery = 1 << 30;
        const Render r = render(p, 60000, s);
        const double want = kC4 * std::exp2(oct);
        const double got = measureHz(r.out, 4800, want, 8192, 24000);
        if (std::fabs(cents(got, want)) > 2.0) std::printf("  pluck %+d oct: %+.2f ct\n", oct, cents(got, want));
        EXPECT(std::fabs(cents(got, want)) <= 2.0);
    }
}

void determinism() {
    Setup s;
    s.gated = true, s.triggerEvery = 9000, s.firstTrigger = 10;
    for (int m = 0; m < macro::kModels; ++m) {
        TEST(kNames[m]);
        MacroOscParams p = params(m);
        if (m == macro::Vowel) p.blend = 0.5f;
        const Render a = render(p, 20000, s), b = render(p, 20000, s);
        EXPECT(a.out == b.out && a.aux == b.aux);
    }
    for (int m : {macro::Vowel, macro::NoiseBand, macro::Dust, macro::Pluck, macro::Snare}) {
        TEST("voices differ");
        MacroOscParams p = params(m);
        p.blend = m == macro::Vowel ? 0.8f : p.blend;
        Setup v0 = s, v1 = s;
        v0.voice = 0, v1.voice = 1;
        EXPECT(render(p, 20000, v0).out != render(p, 20000, v1).out);
    }
}

void randomKnobsStayBounded() {
    for (int m = 0; m < macro::kModels; ++m) {
        TEST(kNames[m]);
        for (int q = 0; q < 3; ++q) {
            const uint64_t h = 77 + (uint64_t)m * 13 + (uint64_t)q;
            uint64_t count = 0;
            auto rnd = [&]() { return (float)dsp::uniform01(h, count++, 5); };
            Setup s;
            s.quality = q;
            s.gated = (m + q) % 2 == 0;
            s.triggerEvery = 3000;
            const Render r = render(params(m), 48000, s, [&](int i, MacroOscParams& p) {
                if (i % 1500 == 0) {
                    p.tone = rnd(), p.shape = rnd(), p.blend = rnd();
                    p.pitch = 8.0 * rnd() - 4.0;
                    p.fmDepth = rnd() < 0.5f ? 0.0f : rnd();
                    p.decay = 0.005f + 3.0f * rnd();
                    p.gateColour = rnd();
                }
                p.fm = std::sin(0.05f * (float)i) * 1.5f;
            });
            EXPECT(test::allFinite(r.out) && test::allFinite(r.aux) && test::allFinite(r.env));
            EXPECT(maxAbs(r.out) <= 4.0 && maxAbs(r.aux) <= 4.0);
        }
    }
}

void levelsAndCpu() {
    std::printf("  model           RMS out   peak out   RMS aux   CPU (Normal, %% of one core)\n");
    for (int k = 0; k < macro::kModels + 2; ++k) {
        const int m = k < macro::kModels ? k : k == macro::kModels ? macro::Pluck : macro::Modal;
        const bool struck = macro::isDrum(m) || k >= macro::kModels;
        TEST(kNames[m]);
        MacroOscParams p = params(m);
        p.level = 0.8f;
        Setup t;
        if (struck) t.gated = true, t.triggerEvery = 12000;
        const int n = 96000;
        const auto t0 = std::chrono::steady_clock::now();
        const Render r = render(p, n, t);
        const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        const double rmsOut = test::rms(r.out, 4800);
        std::printf("    %-10s %-4s %7.3f   %7.3f   %7.3f   %5.2f %%\n", kNames[m], struck ? "hit" : "", rmsOut, maxAbs(r.out), test::rms(r.aux, 4800),
                    100.0 * sec / (n / kSr));
        EXPECT(rmsOut > 0.03 && maxAbs(r.out) <= 1.5);  // audible at defaults, nominal ±1
    }
}

}  // namespace

int main() {
    pitchPerModel();
    aliasingAtHighNote();
    harmonicBandLimit();
    modelChanges();
    triggerAndEnvelope();
    pluckTuning();
    determinism();
    randomKnobsStayBounded();
    levelsAndCpu();
    return test::finish("macro-osc");
}
