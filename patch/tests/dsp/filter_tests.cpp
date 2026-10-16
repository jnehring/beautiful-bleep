// SPDX-License-Identifier: MIT
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
    // A hard-driven 7.3 kHz sine: its in-band harmonics are 7.3 and 21.9 kHz;
    // everything else in the output is harmonics above Nyquist folded back.
    const double f0 = 7300.0, sr = 48000.0;
    for (FilterType t : {FilterType::Svf, FilterType::LadderTanh}) {
        FilterDsp f;
        f.prepare(sr);
        FilterParams p;
        p.type = (int)t;
        p.cutoff = 1.0f;
        p.resonance = 0.0f;
        p.drive = 1.0f;
        std::vector<float> out;
        for (int i = 0; i < 48000; ++i) {
            const float x = 0.8f * (float)std::sin(2.0 * 3.14159265358979 * f0 * i / sr);
            float frame[2] = {x, x};
            f.tick(p, 0.0f, frame, 2);
            if (i >= 4800) out.push_back(frame[0]);
        }
        double total = 0.0;
        for (float v : out) total += (double)v * v / (double)out.size();
        const double h1 = toneLevel(out, f0, sr), h3 = toneLevel(out, 3.0 * f0, sr);
        const double alias = std::sqrt(std::max(0.0, total - 0.5 * (h1 * h1 + h3 * h3))) / h1;
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
    filterAlgorithms();
}
