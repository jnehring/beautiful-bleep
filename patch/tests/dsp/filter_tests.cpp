// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// filter_tests.cpp — the filters: state-variable filter, mapping, aliasing and the filter algorithms.

#include "dsp_test.h"

static void svfBasics() {
    g_test = "svf";
    dsp::Svf f;
    f.set(1000.0f, 0.707f, 48000.0);
    dsp::SvfOutputs o{};
    for (int i = 0; i < 48000; ++i) o = f.process(1.0f); // DC
    EXPECT_NEAR(o.lp, 1.0, 1e-3);
    EXPECT_NEAR(o.hp, 0.0, 1e-3);
    EXPECT_NEAR(o.bp, 0.0, 1e-3);
    EXPECT_NEAR(dsp::morphSvf(o, 0.0f), o.lp, 1e-7);
    EXPECT_NEAR(dsp::morphSvf(o, 1.0f), o.notch(), 1e-7);

    // Audio-rate cutoff modulation with high resonance stays bounded.
    std::mt19937 rng(7);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    float peak = 0.0f;
    for (int i = 0; i < 96000; ++i) {
        const float hz = FilterDsp::cutoffHz(0.5f + 0.5f * std::sin(i * 0.3f), 0.0f);
        f.set(hz, 25.0f, 48000.0);
        o = f.process(u(rng));
        peak = std::max(peak, std::fabs(o.lp));
        EXPECT(std::isfinite(o.lp) && std::isfinite(o.hp));
        if (g_failures) return;
    }
    EXPECT(peak < 100.0f);
}

static void filterMapping() {
    g_test = "filter";
    EXPECT_NEAR(FilterDsp::cutoffHz(0.0f, 0.0f), 20.0, 1e-3);
    EXPECT_NEAR(FilterDsp::cutoffHz(1.0f, 0.0f), 20000.0, 0.5);
    EXPECT_NEAR(FilterDsp::cutoffHz(0.5f, 1.0f), 2.0 * FilterDsp::cutoffHz(0.5f, 0.0f), 1e-2);
    EXPECT_NEAR(FilterDsp::q(0.0f), 0.5, 1e-6);
    EXPECT_NEAR(FilterDsp::q(1.0f), 25.0, 1e-4);

    FilterDsp f;
    f.prepare(48000.0);
    FilterParams p;
    p.mix = 0.0f; // dry: the input, exactly, delayed by the oversampling latency
    for (int i = 0; i <= FilterDsp::kLatency; ++i) {
        float frame[2] = {i == 0 ? 0.3f : 0.0f, i == 0 ? -0.2f : 0.0f};
        f.tick(p, 0.0f, frame, 2);
        EXPECT_NEAR(frame[0], i == FilterDsp::kLatency ? 0.3 : 0.0, 1e-7);
        EXPECT_NEAR(frame[1], i == FilterDsp::kLatency ? -0.2 : 0.0, 1e-7);
    }

    // Wet and dry line up: a pass-through filter at 50 % mix keeps a 1 kHz tone whole.
    {
        FilterDsp g;
        g.prepare(48000.0);
        FilterParams q;
        q.type = (int)FilterType::OnePoleAp;
        q.mix = 0.5f;
        q.cutoff = 1.0f;  // 20 kHz: the allpass barely shifts 1 kHz
        double in = 0.0, out = 0.0;
        for (int i = 0; i < 9600; ++i) {
            const float x = std::sin(i * 2.0f * 3.14159265f * 1000.0f / 48000.0f);
            float fr[2] = {x, x};
            g.tick(q, 0.0f, fr, 2);
            if (i >= 4800) in += (double)x * x, out += (double)fr[0] * fr[0];
        }
        EXPECT_NEAR(std::sqrt(out / in), 1.0, 0.02);
    }

    p.mix = 1.0f;
    p.cutoff = 0.0f; // 20 Hz low-pass: a 5 kHz tone almost vanishes, envelope stays low
    float env = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        float fr[2] = {std::sin(i * 2.0f * 3.14159265f * 5000.0f / 48000.0f), 0.0f};
        env = f.tick(p, 0.0f, fr, 2);
    }
    EXPECT(env < 0.01f);
}

static void roughFilter() {
    g_test = "rough filter";
    FilterDsp f;
    f.prepare(48000.0);
    FilterParams p;
    p.type = (int)FilterType::SvfSaturating;
    p.resonance = 1.0f;
    p.drive = 1.0f;
    std::mt19937 rng(3);
    std::uniform_real_distribution<float> u(-1.0f, 1.0f);
    float peak = 0.0f;
    for (int i = 0; i < 96000; ++i) {
        p.cutoff = 0.5f + 0.5f * std::sin(i * 0.001f);
        float frame[2] = {u(rng), u(rng)};
        f.tick(p, 0.0f, frame, 2);
        EXPECT(std::isfinite(frame[0]));
        peak = std::max(peak, std::fabs(frame[0]));
        if (g_failures) return;
    }
    EXPECT(peak < 20.0f);  // saturation keeps full resonance bounded
}

/// Magnitude of one frequency in x (Goertzel), normalised to a sine's amplitude.
static double toneLevel(const std::vector<float>& x, double freq, double sampleRate) {
    const double w = 2.0 * 3.14159265358979 * freq / sampleRate, k = 2.0 * std::cos(w);
    double s1 = 0.0, s2 = 0.0;
    for (float v : x) {
        const double s0 = v + k * s1 - s2;
        s2 = s1, s1 = s0;
    }
    return 2.0 * std::sqrt(std::max(0.0, s1 * s1 + s2 * s2 - k * s1 * s2)) / (double)x.size();
}

static void filterAliasing() {
    g_test = "filter aliasing";
    // A driven 7.3 kHz sine: its in-band harmonics are 7.3, 14.6 (the asymmetric
    // curves) and 21.9 kHz; everything else in the output is harmonics above
    // Nyquist folded back. Half Drive: at full Drive a loud tone this high is
    // clipped hard enough that its 25th harmonic folds back at about −30 dB.
    const double f0 = 7300.0, sr = 48000.0;
    for (FilterType t : {FilterType::Svf, FilterType::LadderTanh, FilterType::Diode, FilterType::SallenKeyLp,
                         FilterType::OnePoleLp, FilterType::CombPositive}) {
        FilterDsp f;
        f.prepare(sr);
        FilterParams p;
        p.type = (int)t;
        p.cutoff = 1.0f;
        p.resonance = 0.0f;
        p.drive = 0.5f;
        std::vector<float> out;
        for (int i = 0; i < 48000; ++i) {
            const float x = 0.8f * (float)std::sin(2.0 * 3.14159265358979 * f0 * i / sr);
            float frame[2] = {x, x};
            f.tick(p, 0.0f, frame, 2);
            if (i >= 4800) out.push_back(frame[0]);
        }
        double total = 0.0;
        for (float v : out) total += (double)v * v / (double)out.size();
        const double h1 = toneLevel(out, f0, sr), h2 = toneLevel(out, 2.0 * f0, sr), h3 = toneLevel(out, 3.0 * f0, sr);
        const double alias = std::sqrt(std::max(0.0, total - 0.5 * (h1 * h1 + h2 * h2 + h3 * h3))) / h1;
        if (!(alias < 0.01)) std::printf("  type %d: aliases only %.1f dB down\n", (int)t, -20.0 * std::log10(alias));
        EXPECT(h1 > 0.1);
        EXPECT(alias < 0.01);  // below −40 dB
    }
}


static double filterGain(FilterType type, float hz, double freq, float resonance = 0.0f, float morph = 0.0f,
                         float gain = 0.0f) {
    FilterDsp f;
    f.prepare(48000.0);
    FilterParams p;
    p.type = (int)type;
    p.cutoff = std::log(hz / 20.0f) / std::log(1000.0f);
    p.resonance = resonance;
    p.morph = morph;
    p.gain = gain;
    double in = 0.0, out = 0.0;
    for (int i = 0; i < 48000; ++i) {
        const float x = freq == 0.0 ? 0.1f : 0.1f * (float)std::sin(2.0 * 3.14159265358979 * freq * i / 48000.0);
        float frame[2] = {x, x};
        f.tick(p, 0.0f, frame, 2);
        if (i >= 24000) {
            in += (double)x * x;
            out += (double)frame[0] * frame[0];
        }
    }
    return std::sqrt(out / in);
}

/// Gain of a sine through the filter for parameters `p` (cutoff in Hz).
static double gainWith(FilterParams p, float hz, double freq) {
    FilterDsp f;
    f.prepare(48000.0);
    p.cutoff = std::log(hz / 20.0f) / std::log(1000.0f);
    double in = 0.0, out = 0.0;
    for (int i = 0; i < 48000; ++i) {
        const float x = 0.1f * (float)std::sin(2.0 * 3.14159265358979 * freq * i / 48000.0);
        float frame[2] = {x, x};
        f.tick(p, 0.0f, frame, 2);
        if (i >= 24000) {
            in += (double)x * x;
            out += (double)frame[0] * frame[0];
        }
    }
    return std::sqrt(out / in);
}

static FilterParams typed(FilterType t, float resonance = 0.0f) {
    FilterParams p;
    p.type = (int)t;
    p.resonance = resonance;
    return p;
}

static void ownAlgorithms() {
    g_test = "filter own designs";
    // Saved boards store the type normalised: the first and last algorithms keep their place
    // (old boards stored SVF Multimode as 0 and Rough as 1.0), the rest are migrated by name.
    static_assert((int)FilterType::Svf == 0 && (int)FilterType::SvfSaturating == va::kNumTypes - 1, "ends are frozen");
    static_assert(va::kNumTypes == 38, "38 algorithms");
    {
        std::vector<std::string> names;
        for (const auto& g : va::typeGroups())
            for (const char* n : g.types) names.emplace_back(n);
        EXPECT((int)names.size() == va::kNumTypes);
        const auto& legacy = va::legacyNames();
        EXPECT(legacy.size() == 25);
        for (const auto& n : legacy) EXPECT(std::find(names.begin(), names.end(), n) != names.end());
        EXPECT(names.front() == legacy.front() && names.back() == legacy.back());
    }

    // Sallen-Key: 12 dB/oct, half amplitude at the cutoff without resonance, a peak with it.
    EXPECT_NEAR(gainWith(typed(FilterType::SallenKeyLp), 1000.0f, 100.0), 1.0, 0.03);
    EXPECT_NEAR(gainWith(typed(FilterType::SallenKeyLp), 1000.0f, 1000.0), 0.5, 0.03);
    EXPECT(gainWith(typed(FilterType::SallenKeyLp), 1000.0f, 8000.0) < 0.03);
    EXPECT(gainWith(typed(FilterType::SallenKeyLp, 0.9f), 1000.0f, 1000.0) > 4.0);
    EXPECT_NEAR(gainWith(typed(FilterType::SallenKeyHp), 1000.0f, 15000.0), 1.0, 0.05);
    EXPECT_NEAR(gainWith(typed(FilterType::SallenKeyHp), 1000.0f, 1000.0), 0.5, 0.03);
    EXPECT(gainWith(typed(FilterType::SallenKeyHp), 1000.0f, 125.0) < 0.03);
    EXPECT(gainWith(typed(FilterType::SallenKeyHp, 0.9f), 1000.0f, 1000.0) > 4.0);

    // Circuit models, quiet (linear) responses: the diode-feedback pair as the Sallen-Key, the OTA cascade as the
    // ladder, the circuit SVFs as the SVF in low-pass mode.
    EXPECT_NEAR(gainWith(typed(FilterType::DiodeFeedbackLp), 1000.0f, 100.0), 1.0, 0.03);
    EXPECT_NEAR(gainWith(typed(FilterType::DiodeFeedbackLp), 1000.0f, 1000.0), 0.5, 0.03);
    EXPECT(gainWith(typed(FilterType::DiodeFeedbackLp), 1000.0f, 8000.0) < 0.03);
    EXPECT_NEAR(gainWith(typed(FilterType::DiodeFeedbackHp), 1000.0f, 15000.0), 1.0, 0.05);
    EXPECT(gainWith(typed(FilterType::DiodeFeedbackHp), 1000.0f, 125.0) < 0.03);
    EXPECT_NEAR(gainWith(typed(FilterType::Ota4), 1000.0f, 100.0), 1.0, 0.03);
    EXPECT(gainWith(typed(FilterType::Ota4), 1000.0f, 4000.0) < 0.01);
    for (FilterType t : {FilterType::SlewSvf, FilterType::DiodePair, FilterType::CmosSvf}) {
        EXPECT_NEAR(gainWith(typed(t), 1000.0f, 100.0), 1.0, 0.05);
        EXPECT(gainWith(typed(t), 1000.0f, 8000.0) < 0.05);
    }
    // At full resonance it rings on its own, held by the wall.
    for (FilterType t : {FilterType::SallenKeyLp, FilterType::SallenKeyHp}) {
        FilterDsp f;
        f.prepare(48000.0);
        FilterParams p = typed(t, 1.0f);
        p.cutoff = std::log(1000.0f / 20.0f) / std::log(1000.0f);
        double late = 0.0, peak = 0.0;
        for (int i = 0; i < 96000; ++i) {
            float frame[2] = {i == 0 ? 0.3f : 0.0f, 0.0f};
            f.tick(p, 0.0f, frame, 2);
            peak = std::max(peak, (double)std::fabs(frame[0]));
            if (i >= 72000) late += (double)frame[0] * frame[0];
        }
        EXPECT(std::sqrt(late / 24000.0) > 0.05);
        EXPECT(peak < 4.0 && std::isfinite(peak));
    }

    // Vowel: A has its first formant near 780 Hz, I near 310 Hz; Cutoff slides them.
    {
        FilterParams a = typed(FilterType::Vowel), i = a;
        i.vowel = 0.5f;  // E sits at 0.25, I at 0.5
        FilterParams ii = a;
        ii.vowel = 0.5f;
        EXPECT(gainWith(a, 2000.0f, 780.0) > 3.0 * gainWith(a, 2000.0f, 310.0));
        EXPECT(gainWith(ii, 2000.0f, 310.0) > 3.0 * gainWith(ii, 2000.0f, 780.0));
        EXPECT(gainWith(a, 4000.0f, 1560.0) > 3.0 * gainWith(a, 4000.0f, 780.0));  // an octave up
        EXPECT(gainWith(a, 2000.0f, 780.0) > 0.5);
    }

    // Comb: peaks on the cutoff and its multiples (positive) or odd multiples (negative).
    {
        FilterParams pos = typed(FilterType::CombPositive, 0.8f), neg = typed(FilterType::CombNegative, 0.8f);
        pos.damping = neg.damping = 0.0f;
        EXPECT(gainWith(pos, 1000.0f, 1000.0) > 0.9 && gainWith(pos, 1000.0f, 2000.0) > 0.9);
        EXPECT(gainWith(pos, 1000.0f, 1000.0) > 3.0 * gainWith(pos, 1000.0f, 1500.0));
        EXPECT(gainWith(pos, 1000.0f, 1000.0) > gainWith(pos, 1000.0f, 985.0));
        EXPECT(gainWith(pos, 1000.0f, 1000.0) > gainWith(pos, 1000.0f, 1015.0));
        EXPECT(gainWith(neg, 1000.0f, 1000.0) > 0.9 && gainWith(neg, 1000.0f, 3000.0) > 0.9);
        EXPECT(gainWith(neg, 1000.0f, 1000.0) > 3.0 * gainWith(neg, 1000.0f, 2000.0));
        // Damping dulls the upper peaks but keeps the tuning.
        pos.damping = 0.9f;
        EXPECT(gainWith(pos, 500.0f, 500.0) > 1.8 * gainWith(pos, 500.0f, 5000.0));
        EXPECT(gainWith(pos, 500.0f, 500.0) > gainWith(pos, 500.0f, 492.0));
        EXPECT(gainWith(pos, 500.0f, 500.0) > gainWith(pos, 500.0f, 508.0));
    }

    // Staircase: -3 dB at the cutoff for every slope, steeper with more sections.
    for (int n = 1; n <= 8; ++n) {
        FilterParams lp = typed(FilterType::StaircaseLp), hp = typed(FilterType::StaircaseHp);
        lp.slope = hp.slope = n;
        EXPECT_NEAR(gainWith(lp, 1000.0f, 1000.0), 0.7071, 0.03);
        EXPECT_NEAR(gainWith(hp, 1000.0f, 1000.0), 0.7071, 0.03);
        EXPECT_NEAR(gainWith(lp, 1000.0f, 20.0), 1.0, 0.02);
        const double octave = gainWith(lp, 1000.0f, 8000.0) / gainWith(lp, 1000.0f, 4000.0);
        EXPECT(octave < std::pow(0.5, 0.5 * n) * 1.2 && octave > std::pow(0.5, n) * 0.8);
    }
    {
        FilterParams lp = typed(FilterType::StaircaseLp, 0.0f);
        lp.slope = 4;
        const double tight = gainWith(lp, 1000.0f, 3000.0);
        lp.resonance = 0.5f;  // spread-out corners: a gentler first step
        EXPECT(gainWith(lp, 1000.0f, 3000.0) != tight);
    }
}

static void filterDrive() {
    g_test = "filter drive";
    // Drive is each algorithm's own (va::driveSpec()); on every type it changes the
    // sound clearly at full Drive, gently at a quarter, and keeps the level of a
    // full-scale signal within a few dB (a saw at 110 Hz peaking at 1, cutoff 1 kHz,
    // resonance 30 %): turning Drive up must not make it quieter.
    const double sr = 48000.0;
    std::vector<float> in(36000);
    for (size_t i = 0; i < in.size(); ++i) {
        double s = 0.0;
        for (int k = 1; k * 110 < 20000; ++k) s += std::sin(2.0 * 3.14159265358979 * k * 110.0 * (double)i / sr) / k;
        in[i] = (float)(s * 2.0 / 3.14159265358979);
    }
    auto run = [&](int type, float drive) {
        FilterDsp f;
        f.prepare(sr);
        FilterParams p;
        p.type = type;
        p.cutoff = (float)(std::log(1000.0 / 20.0) / std::log(1000.0));
        p.resonance = 0.3f;
        p.drive = drive;
        p.gain = 6.0f;
        p.vowel = 0.3f;
        p.damping = 0.3f;
        std::vector<float> out;
        for (size_t i = 0; i < in.size(); ++i) {
            float frame[2] = {in[i], in[i]};
            f.tick(p, 0.0f, frame, 2);
            if (i >= 12000) out.push_back(frame[0]);
        }
        return out;
    };
    auto energy = [](const std::vector<float>& a) { double e = 0; for (float v : a) e += (double)v * v; return e / (double)a.size(); };
    for (int t = 0; t < va::kNumTypes; ++t) {
        const auto y0 = run(t, 0.0f);
        const double e0 = energy(y0);
        for (float drive : {0.25f, 1.0f}) {
            const auto y = run(t, drive);
            double xy = 0.0, yy = 0.0;
            for (size_t i = 0; i < y.size(); ++i) xy += (double)y0[i] * y[i], yy += (double)y[i] * y[i];
            double r = 0.0;
            for (size_t i = 0; i < y.size(); ++i) { const double d = y0[i] - xy / yy * y[i]; r += d * d; }
            const double level = 10.0 * std::log10(energy(y) / e0), change = 10.0 * std::log10(r / (double)y.size() / e0);
            const bool ok = std::fabs(level) < 4.5 && (drive < 0.5f ? change < -10.0 : change > -9.0);
            if (!ok) std::printf("  type %d drive %.2f: level %+.1f dB, change %.1f dB\n", t, drive, level, change);
            EXPECT(ok);
        }
    }
}

static void filterAnalog() {
    g_test = "filter analog";
    // Analog (tolerances, drift, noise floor, mismatch) keeps every type bounded at full
    // resonance and drive with audio-rate cutoff modulation, and stays deterministic.
    auto render = [](int type, float analog, float resonance, float drive, bool silent) {
        FilterDsp f;
        f.prepare(48000.0);
        FilterParams p;
        p.type = type;
        p.analog = analog;
        p.resonance = resonance;
        p.drive = drive;
        p.gain = 12.0f;
        std::mt19937 rng(5);
        std::uniform_real_distribution<float> u(-1.0f, 1.0f);
        std::vector<float> out;
        for (int i = 0; i < 24000; ++i) {
            p.cutoff = silent ? 0.5f : 0.5f + 0.5f * std::sin(i * (i < 12000 ? 0.0005f : 0.3f));
            const float x = silent ? 0.0f : u(rng);
            float frame[2] = {x, x};
            f.tick(p, 0.0f, frame, 2);
            out.push_back(frame[0]);
            out.push_back(frame[1]);
        }
        return out;
    };
    for (int t = 0; t < va::kNumTypes; ++t) {
        const auto y = render(t, 1.0f, 1.0f, 1.0f, false);
        float peak = 0.0f;
        for (float v : y) peak = std::isfinite(v) ? std::max(peak, std::fabs(v)) : 1e9f;
        if (!(peak < 100.0f)) std::printf("  type %d: peak %g\n", t, peak);
        EXPECT(peak < 100.0f);
    }
    // The same settings render the same, for every instance (the spread is seeded by the instance count, but its
    // amount, the drift and the noise are not random between runs of one instance).
    {
        FilterDsp a, b;
        a.prepare(48000.0);
        b.prepare(48000.0);
        FilterParams p;
        p.type = (int)FilterType::LadderNonlinear;
        p.analog = 1.0f;
        p.resonance = 0.8f;
        float da = 0.0f, db = 0.0f;
        for (int i = 0; i < 4800; ++i) {
            float fa[2] = {0.3f, 0.3f}, fb[2] = {0.3f, 0.3f};
            a.tick(p, 0.0f, fa, 2);
            b.tick(p, 0.0f, fb, 2);
            da += std::fabs(fa[0] - fa[1]);  // the two channels differ (tolerances)
            db += std::fabs(fa[0] - fb[0]);  // and two instances differ
        }
        EXPECT(da > 0.0f && db > 0.0f);
    }
    // Self-oscillation starts from silence on the noise floor; Analog 0 stays silent.
    for (FilterType t : {FilterType::LadderTanh, FilterType::SallenKeyLp, FilterType::SlewSvf, FilterType::Ota4}) {
        auto rms = [](const std::vector<float>& y) {
            double e = 0.0;
            for (size_t i = y.size() / 2; i < y.size(); ++i) e += (double)y[i] * y[i];
            return std::sqrt(e / (double)(y.size() / 2));
        };
        const double on = rms(render((int)t, 1.0f, 1.0f, 0.0f, true)), off = rms(render((int)t, 0.0f, 1.0f, 0.0f, true));
        if (!(on > 0.01 && off < 1e-6)) std::printf("  type %d: self-oscillation %g (Analog 1), %g (Analog 0)\n", (int)t, on, off);
        EXPECT(on > 0.01 && off < 1e-6);
    }
}

static void filterAlgorithms() {
    g_test = "filter algorithms";
    // Every algorithm stays finite and bounded at full resonance and drive,
    // with audio-rate cutoff modulation and every morph position.
    for (int t = 0; t < va::kNumTypes; ++t) {
        for (float morph : {0.0f, 0.5f, 1.0f}) {
            FilterDsp f;
            f.prepare(48000.0);
            FilterParams p;
            p.type = t;
            p.resonance = 1.0f;
            p.drive = 1.0f;
            p.morph = morph;
            p.gain = 24.0f;
            p.vowel = morph;
            p.damping = morph;
            p.slope = 1 + (int)(morph * 7.0f);
            std::mt19937 rng(11);
            std::uniform_real_distribution<float> u(-1.0f, 1.0f);
            float peak = 0.0f;
            for (int i = 0; i < 48000; ++i) {
                p.cutoff = 0.5f + 0.5f * std::sin(i * (i < 24000 ? 0.0005f : 0.3f));
                float frame[2] = {u(rng), std::sin(i * 0.05f)};
                f.tick(p, 0.0f, frame, 2);
                peak = std::max({peak, std::fabs(frame[0]), std::fabs(frame[1])});
                if (!std::isfinite(frame[0]) || !std::isfinite(frame[1])) break;
            }
            if (!(std::isfinite(peak) && peak < 100.0f))
                std::printf("  type %d morph %.1f: peak %g\n", t, morph, peak);
            EXPECT(std::isfinite(peak) && peak < 100.0f);
        }
    }

    // Low-pass responses: unity at DC (shelf/compensation aside), far down two octaves above.
    for (FilterType t : {FilterType::Svf, FilterType::OnePoleLp, FilterType::Ladder, FilterType::LadderFeedbackHp,
                         FilterType::LadderNonlinear, FilterType::Diode, FilterType::NaiveOnePole, FilterType::Biquad,
                         FilterType::SvfAtanh, FilterType::SvfHyperbolic}) {
        g_test = "filter low-pass";
        const double pass = filterGain(t, 1000.0f, 50.0), stop = filterGain(t, 1000.0f, 8000.0);
        if (!(pass > 0.85 && pass < 1.15 && stop < 0.2)) std::printf("  type %d: pass %g stop %g\n", (int)t, pass, stop);
        EXPECT(pass > 0.85 && pass < 1.15);
        EXPECT(stop < 0.2);
    }
    for (FilterType t : {FilterType::OnePoleHp}) {
        g_test = "filter high-pass";
        EXPECT(filterGain(t, 1000.0f, 50.0) < 0.1);
        EXPECT_NEAR(filterGain(t, 1000.0f, 15000.0), 1.0, 0.05);
    }
    g_test = "filter ladder modes";
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 8000.0, 0.0f, 2.0f / 3.0f) > 0.85);  // HP passes highs
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 100.0, 0.0f, 2.0f / 3.0f) < 0.01);  // −24 dB/oct
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 1000.0, 0.0f, 1.0f) < 0.05);        // notch at the cutoff
    EXPECT(filterGain(FilterType::Ladder, 1000.0f, 1000.0, 0.0f, 1.0f / 3.0f) > 0.9);  // BP peak, unit gain

    g_test = "filter allpass";
    for (FilterType t : {FilterType::OnePoleAp, FilterType::SvfAllpass})
        for (double freq : {100.0, 1000.0, 10000.0}) EXPECT_NEAR(filterGain(t, 1000.0f, freq, 0.5f), 1.0, 0.02);

    g_test = "filter shelves";
    EXPECT_NEAR(filterGain(FilterType::OnePoleLowShelf, 1000.0f, 20.0, 0.0f, 0.0f, 12.0f), std::pow(10.0, 0.6), 0.1);
    EXPECT_NEAR(filterGain(FilterType::OnePoleLowShelf, 1000.0f, 15000.0, 0.0f, 0.0f, 12.0f), 1.0, 0.05);
    EXPECT_NEAR(filterGain(FilterType::OnePoleHighShelf, 1000.0f, 15000.0, 0.0f, 0.0f, -12.0f), std::pow(10.0, -0.6), 0.03);
    EXPECT_NEAR(filterGain(FilterType::SvfBandShelf, 1000.0f, 1000.0, 0.0f, 0.0f, 6.0f), std::pow(10.0, 0.3), 0.05);
    EXPECT_NEAR(filterGain(FilterType::SvfUnitBp, 1000.0f, 1000.0, 0.7f), 1.0, 0.03);

    g_test = "filter phaser";
    // 1-pole phaser: four allpasses at −45° each (ω = tan 22.5°) sum to −180°, a notch;
    // at the cutoff they sum to −360°, a peak.
    EXPECT(filterGain(FilterType::Phaser1, 1000.0f, 1000.0 * std::tan(3.14159265358979 / 8.0)) < 0.05);
    EXPECT(filterGain(FilterType::Phaser1, 1000.0f, 1000.0) > 0.95);
    // Flanger: delay 1/cutoff → notches at odd multiples of cutoff / 2.
    EXPECT(filterGain(FilterType::Flanger, 1000.0f, 500.0) < 0.05);
    EXPECT(filterGain(FilterType::Flanger, 1000.0f, 1000.0) > 0.95);
}


void runFilterTests() {
    svfBasics();
    filterMapping();
    roughFilter();
    filterAliasing();
    filterDrive();
    filterAnalog();
    filterAlgorithms();
    ownAlgorithms();
}
