// SPDX-License-Identifier: GPL-3.0-only
// The filter algorithms of Vadim Zavalishin, "The Art of VA Filter Design"
// (rev. 1.0.3), built with the topology-preserving transform (TPT): every
// integrator is trapezoidal and every delayless feedback loop is solved
// through the instantaneous responses (y = G·x + S) of its parts.
//
//   §2/§3   1-pole multimode: low-pass, high-pass, allpass, low/high shelf
//   §3.3    naive (Euler) 1-pole low-pass, §3.11 direct form I biquad
//   §4      transistor ladder: linear, feedback shaping, tanh / hyperbolic
//           feedback saturator, nonlinear stages; multimode outputs
//   §4.7    diode ladder: linear and with a feedback saturator
//   §5      state-variable filter and its further types; nonlinear damping
//           (atanh / hyperbolic) and saturating integrators
//   §6      phasers (1-pole and 2-pole allpasses) and the flanger
//
// Appended after the book's list, in the module's own design:
//   Sallen-Key 2-pole low-/high-pass: a two-capacitor active topology whose
//           amplifier gain sets the resonance; the amplifier clips against a
//           hard-knee wall, so the resonance rings clean and then bites
//   Vowel   four formant resonators morphed over A-E-I-O-U
//   Comb    a tuned feedback comb with either polarity and damping in the loop
//   Staircase  a cascade of 1-pole sections, 6-48 dB, with staggered corners
//
// One FilterVoice holds the state of one channel for every algorithm.
#pragma once

#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <initializer_list>
#include <string>
#include <vector>

namespace bleep::patch::va {

enum class FilterType {
    // State variable (§5)
    Svf, SvfUnitBp, SvfBandShelf, SvfPeak, SvfAllpass,
    // 1-pole (§2)
    OnePoleLp, OnePoleHp, OnePoleAp, OnePoleLowShelf, OnePoleHighShelf,
    // Transistor ladder (§4)
    Ladder, LadderFeedbackHp, LadderTanh, LadderHyperbolic, LadderNonlinear,
    // Diode ladder (§4.7)
    Diode, DiodeTanh,
    // Allpass effects (§6)
    Phaser1, Phaser2, Flanger,
    // Classic digital references (§3)
    NaiveOnePole, Biquad,
    // Own designs.
    SallenKeyLp, SallenKeyHp, Vowel, CombPositive, CombNegative, StaircaseLp, StaircaseHp,
    // Nonlinear state variable (§5.4). SvfSaturating must stay last: boards
    // saved before the algorithm list store it as type 1.0 ("Rough"). Boards
    // saved with the 25-algorithm list are migrated by name (legacyNames()).
    SvfAtanh, SvfHyperbolic, SvfSaturating,
    Count
};
constexpr int kNumTypes = (int)FilterType::Count;

/// Type names grouped for the Type dropdown, in FilterType order.
struct TypeGroup {
    const char* name;
    std::vector<const char*> types;
};
inline const std::vector<TypeGroup>& typeGroups() {
    static const std::vector<TypeGroup> groups = {
        {"State Variable (12 dB)", {"SVF Multimode", "SVF Bandpass (unit gain)", "SVF Band Shelf", "SVF Peaking", "SVF Allpass"}},
        {"1-Pole (6 dB)", {"1-Pole Low-pass", "1-Pole High-pass", "1-Pole Allpass", "1-Pole Low Shelf", "1-Pole High Shelf"}},
        {"Transistor Ladder (24 dB)", {"Ladder Linear", "Ladder Feedback HP", "Ladder Tanh", "Ladder Hyperbolic", "Ladder Nonlinear Stages"}},
        {"Diode Ladder (24 dB)", {"Diode Ladder Linear", "Diode Ladder Tanh"}},
        {"Allpass Effects", {"Phaser 1-Pole ×4", "Phaser 2-Pole ×2", "Flanger"}},
        {"Classic Digital", {"Naive 1-Pole Low-pass", "Biquad (Direct Form I)"}},
        {"Sallen-Key (12 dB)", {"Sallen-Key Low-pass", "Sallen-Key High-pass"}},
        {"Formant", {"Vowel A-E-I-O-U"}},
        {"Tuned Comb", {"Comb Positive", "Comb Negative"}},
        {"Staircase (6-48 dB)", {"Staircase Low-pass", "Staircase High-pass"}},
        {"Nonlinear State Variable", {"SVF Atanh Damping", "SVF Hyperbolic Damping", "SVF Saturating (Rough)"}},
    };
    return groups;
}

/// The 25 names of the list before the own designs were added, in their old
/// order: boards stored Type normalised against it (index / 24).
inline const std::vector<std::string>& legacyNames() {
    static const std::vector<std::string> names = {
        "SVF Multimode", "SVF Bandpass (unit gain)", "SVF Band Shelf", "SVF Peaking", "SVF Allpass",
        "1-Pole Low-pass", "1-Pole High-pass", "1-Pole Allpass", "1-Pole Low Shelf", "1-Pole High Shelf",
        "Ladder Linear", "Ladder Feedback HP", "Ladder Tanh", "Ladder Hyperbolic", "Ladder Nonlinear Stages",
        "Diode Ladder Linear", "Diode Ladder Tanh", "Phaser 1-Pole ×4", "Phaser 2-Pole ×2", "Flanger",
        "Naive 1-Pole Low-pass", "Biquad (Direct Form I)",
        "SVF Atanh Damping", "SVF Hyperbolic Damping", "SVF Saturating (Rough)"};
    return names;
}

constexpr double kPi = 3.14159265358979323846;

/// Sallen-Key amplifier: gain 1 … 3.04 over the Resonance knob (3 is the edge
/// of self-oscillation), clipping against a wall at ±kWall.
constexpr double kWall = 2.0;
constexpr int kFormants = 4, kMaxStages = 8;
constexpr float kVowelNeutralHz = 2000.0f;  ///< Cutoff at which the formants sit at their natural place
constexpr float kSpacingCentreHz = 1500.0f; ///< Gain stretches or squeezes the formants around this

/// Prewarped integrator gain ωc·T/2 for a cutoff in Hz (§3.9).
inline float prewarp(double hz, double sampleRate) noexcept {
    const double f = std::clamp(hz, 5.0, 0.49 * sampleRate);
    return (float)std::tan(kPi * f / sampleRate);
}

/// Static ladder feedback high-pass (§4.3): kills the resonance below it.
constexpr double kFeedbackHpHz = 250.0;

/// Everything derived from the knobs, shared by both channels.
struct Coeffs {
    FilterType type = FilterType::Svf;
    float g = 0.1f;        ///< prewarped cutoff (the shelves' corrected cutoff)
    float G = 0.0f;        ///< 1-pole instantaneous gain g / (1 + g)
    float R = 0.7f;        ///< SVF damping, 1/(2Q)
    float k = 0.0f;        ///< ladder / phaser feedback amount
    float K = 0.0f;        ///< shelf amount: 10^(dB/20) − 1
    float morph = 0.0f;    ///< LP → BP → HP → notch
    float invert = 1.0f;   ///< phaser / flanger wet polarity
    float comp = 1.0f;     ///< ladder input gain against the bass loss
    float Gh = 0.0f;       ///< feedback high-pass instantaneous gain
    float naive = 0.0f;    ///< naive 1-pole ωc·T
    float delay = 1.0f;    ///< flanger delay in samples
    float hz = 1000.0f;    ///< cutoff in Hz
    float q = 0.707f;      ///< resonance as Q, for the saturating SVF
    float amp = 1.0f;      ///< Sallen-Key amplifier gain
    float damp = 1.0f;     ///< comb: instantaneous gain of the damping 1-pole
    float norm = 1.0f;     ///< comb: output scaling, 1 − |feedback|
    int stages = 4;        ///< staircase: number of 1-pole sections
    std::array<float, kMaxStages> stageG{};  ///< staircase: each section's G
    struct Formant {
        float g = 0.1f, R = 0.1f, amp = 0.0f;  ///< prewarped centre, damping, level
    };
    std::array<Formant, kFormants> formant{};
};

/// Formant table of the five vowels: centre (Hz), level (dB) and bandwidth (Hz)
/// of the first four resonances.
struct VowelFormants {
    float hz[kFormants], db[kFormants], bw[kFormants];
};
inline const std::array<VowelFormants, 5>& vowels() {
    static const std::array<VowelFormants, 5> v = {{
        {{780, 1180, 2850, 3800}, {0, -5, -16, -22}, {85, 95, 130, 190}},    // A
        {{430, 1900, 2650, 3450}, {0, -9, -14, -22}, {70, 110, 140, 200}},   // E
        {{310, 2150, 2950, 3700}, {0, -13, -15, -24}, {60, 120, 150, 210}},  // I
        {{460, 820, 2700, 3500}, {0, -4, -18, -24}, {75, 90, 130, 190}},     // O
        {{330, 720, 2450, 3350}, {0, -8, -20, -26}, {65, 90, 120, 180}},     // U
    }};
    return v;
}

/// Weights of the four morph endpoints (LP, BP, HP, notch), 0 % … 100 %.
inline std::array<float, 4> morphWeights(float morph) noexcept {
    const float m = std::clamp(morph, 0.0f, 1.0f) * 3.0f;
    const int i = std::min((int)m, 2);
    const float t = m - (float)i;
    std::array<float, 4> w{};
    w[(size_t)i] = 1.0f - t;
    w[(size_t)i + 1] = t;
    return w;
}

/// Computes the coefficients. resonance, morph 0..1; gainDb −24..+24.
inline Coeffs makeCoeffs(FilterType type, float hz, float resonance, float morph, float gainDb,
                         double sampleRate, float vowel = 0.0f, float damping = 0.0f, int slope = 4) noexcept {
    Coeffs c;
    c.type = type;
    c.hz = hz;
    c.morph = morph;
    const float res = std::clamp(resonance, 0.0f, 1.0f);
    c.q = 0.5f * std::pow(50.0f, res);
    c.R = 0.5f / c.q;
    c.K = std::pow(10.0f, std::clamp(gainDb, -24.0f, 24.0f) / 20.0f) - 1.0f;
    c.invert = morph < 0.5f ? 1.0f : -1.0f;
    double cutoff = hz;
    // Shelves: the knob sets the middle of the slope (§2.11).
    if (type == FilterType::OnePoleLowShelf) cutoff /= std::sqrt(1.0 + c.K);
    if (type == FilterType::OnePoleHighShelf) cutoff *= std::sqrt(1.0 + c.K);
    // Diode ladder: the resonance peaks at ωc/√2 (§4.7); put it on the knob.
    if (type == FilterType::Diode || type == FilterType::DiodeTanh) cutoff *= std::sqrt(2.0);
    c.g = prewarp(cutoff, sampleRate);
    c.G = c.g / (1.0f + c.g);
    const float lpWeight = morphWeights(morph)[0];
    const auto is = [type](std::initializer_list<FilterType> list) {
        return std::find(list.begin(), list.end(), type) != list.end();
    };
    if (is({FilterType::Ladder, FilterType::LadderFeedbackHp})) c.k = 3.95f * res;
    if (is({FilterType::LadderTanh, FilterType::LadderHyperbolic, FilterType::LadderNonlinear}))
        c.k = 5.0f * res;  // self-oscillates above ~80 %
    if (type == FilterType::Diode) c.k = 16.5f * res;
    if (type == FilterType::DiodeTanh) c.k = 21.0f * res;  // self-oscillates above ~80 %
    if (is({FilterType::Phaser1, FilterType::Phaser2, FilterType::Flanger})) c.k = 0.85f * res;
    if (is({FilterType::SvfAtanh, FilterType::SvfHyperbolic}))
        c.R -= 0.06f * res * res;  // slightly negative at the top: self-oscillation
    if (is({FilterType::Ladder, FilterType::LadderTanh, FilterType::LadderHyperbolic, FilterType::LadderNonlinear}))
        c.comp = 1.0f + c.k * lpWeight;  // §4.3: boost the input by (1 + k) in low-pass mode
    if (type == FilterType::Diode || type == FilterType::DiodeTanh) c.comp = std::pow(1.0f + c.k, 0.75f);  // partial: full compensation overdrives
    if (type == FilterType::LadderFeedbackHp) {
        const float gh = prewarp(kFeedbackHpHz, sampleRate);
        c.Gh = gh / (1.0f + gh);
    }
    if (type == FilterType::Phaser2) c.R = 5.0f * std::pow(0.02f, std::clamp(morph, 0.0f, 1.0f));  // notch spacing
    if (type == FilterType::NaiveOnePole) c.naive = std::min(1.0f, (float)(2.0 * kPi * hz / sampleRate));
    if (type == FilterType::Flanger) c.delay = (float)std::max(2.0, sampleRate / std::max(5.0, (double)hz));
    if (type == FilterType::SallenKeyLp || type == FilterType::SallenKeyHp) c.amp = 1.0f + 2.04f * res;
    if (type == FilterType::Vowel) {
        // Resonance narrows the formants; Gain (±24 dB) stretches or squeezes their spacing.
        const float bwScale = 2.0f * std::pow(0.1f, res);
        const float spacing = 1.0f + std::clamp(gainDb, -24.0f, 24.0f) / 48.0f;
        const float shift = hz / kVowelNeutralHz;
        const float pos = std::clamp(vowel, 0.0f, 1.0f) * 4.0f;
        const int i = std::min((int)pos, 3);
        const float t = pos - (float)i;
        const auto& a = vowels()[(size_t)i];
        const auto& b = vowels()[(size_t)i + 1];
        for (int n = 0; n < kFormants; ++n) {
            const float f0 = a.hz[n] * std::pow(b.hz[n] / a.hz[n], t);
            const float f = std::clamp(kSpacingCentreHz * std::pow(f0 / kSpacingCentreHz, spacing) * shift, 40.0f, 18000.0f);
            const float bw = (a.bw[n] + t * (b.bw[n] - a.bw[n])) * bwScale * std::sqrt(shift);
            auto& fm = c.formant[(size_t)n];
            fm.g = prewarp(f, sampleRate);
            fm.R = std::max(0.01f, 0.5f * bw / f);
            fm.amp = 2.0f * std::pow(10.0f, (a.db[n] + t * (b.db[n] - a.db[n])) / 20.0f);
        }
    }
    if (type == FilterType::CombPositive || type == FilterType::CombNegative) {
        const bool neg = type == FilterType::CombNegative;
        const float dampHz = 20000.0f * std::pow(0.02f, std::clamp(damping, 0.0f, 1.0f));
        const float gd = prewarp(dampHz, sampleRate);
        c.damp = gd / (1.0f + gd);
        c.k = (neg ? -0.985f : 0.985f) * res;
        c.norm = 1.0f - std::fabs(c.k);
        // The damping filter delays the loop by its phase delay at the comb's
        // pitch; take it off the line so the peaks stay on the Cutoff.
        const double w = 2.0 * kPi * std::max(5.0f, hz) / sampleRate;
        const double phase = std::atan(std::tan(0.5 * w) / gd);
        const double period = sampleRate / std::max(5.0f, hz) * (neg ? 0.5 : 1.0);
        c.delay = (float)std::max(2.0, period - phase / w);
    }
    if (type == FilterType::StaircaseLp || type == FilterType::StaircaseHp) {
        c.stages = std::clamp(slope, 1, kMaxStages);
        // N equal sections: scale the corner so the −3 dB point sits on the cutoff.
        const double edge = std::sqrt(std::pow(2.0, 1.0 / c.stages) - 1.0);
        const double base = type == FilterType::StaircaseLp ? hz / edge : hz * edge;
        for (int n = 0; n < c.stages; ++n) {
            const double octaves = res * ((double)n - 0.5 * (c.stages - 1));  // Resonance = spread, octaves per section
            const float g = prewarp(base * std::exp2(octaves), sampleRate);
            c.stageG[(size_t)n] = g / (1.0f + g);
        }
    }
    return c;
}

/// TPT 1-pole low-pass (§3.10) as one stage of a larger structure.
struct OnePole {
    float z = 0.0f;
    float tick(float x, float G) noexcept {
        const float v = (x - z) * G;
        const float y = v + z;
        z = y + v;
        return y;
    }
    /// Instantaneous offset S of y = G·x + S.
    float offset(float G) const noexcept { return z * (1.0f - G); }
    /// Advances the state once the output y is known.
    void commit(float y) noexcept { z = 2.0f * y - z; }
};

/// Solves u + a·f(u) = b for a monotonic saturator |f| < 1 with a ≥ 0:
/// Newton's method, kept inside the bracket b ± a.
template <typename F, typename DF>
inline float solveFeedback(float a, float b, float guess, F f, DF df) noexcept {
    double lo = (double)b - a, hi = (double)b + a, u = std::clamp((double)guess, lo, hi);
    for (int i = 0; i < 12; ++i) {
        const double r = u + a * f(u) - b;
        if (std::fabs(r) < 1e-7) break;
        if (r > 0.0) hi = u; else lo = u;
        double next = u - r / (1.0 + a * df(u));
        if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
        u = next;
    }
    return (float)u;
}

inline double tanhD(double u) noexcept { const double t = std::tanh(u); return 1.0 - t * t; }
inline double hyper(double u) noexcept { return u / (1.0 + std::fabs(u)); }
inline double hyperD(double u) noexcept { const double d = 1.0 + std::fabs(u); return 1.0 / (d * d); }

/// One channel's state for every algorithm.
class FilterVoice {
public:
    void prepare(double sampleRate) {
        delay_.assign((size_t)(sampleRate * 0.25) + 4, 0.0f);
        reset();
    }

    void reset() noexcept {
        for (auto& p : p_) p = {};
        for (auto& p : stair_) p = {};
        vs1_.fill(0.0f);
        vs2_.fill(0.0f);
        skState_ = 0.0f;
        hp_ = {};
        s1_ = s2_ = t1_ = t2_ = 0.0f;
        x1_ = x2_ = y1_ = y2_ = 0.0f;
        naive_ = 0.0f;
        std::fill(delay_.begin(), delay_.end(), 0.0f);
        write_ = 0;
        rough_.reset();
        roughQ_ = roughHz_ = -1.0f;
    }

    float process(const Coeffs& c, float x, double sampleRate) noexcept {
        switch (c.type) {
            case FilterType::Svf: return morph(svf(c, x), c.morph);
            case FilterType::SvfUnitBp: return 2.0f * c.R * svf(c, x)[1];
            case FilterType::SvfBandShelf: return x + 2.0f * c.R * c.K * svf(c, x)[1];
            case FilterType::SvfPeak: { const auto o = svf(c, x); return o[0] - o[2]; }
            case FilterType::SvfAllpass: return x - 4.0f * c.R * svf(c, x)[1];

            case FilterType::OnePoleLp: return p_[0].tick(x, c.G);
            case FilterType::OnePoleHp: return x - p_[0].tick(x, c.G);
            case FilterType::OnePoleAp: return 2.0f * p_[0].tick(x, c.G) - x;
            case FilterType::OnePoleLowShelf: return x + c.K * p_[0].tick(x, c.G);
            case FilterType::OnePoleHighShelf: return x + c.K * (x - p_[0].tick(x, c.G));

            case FilterType::Ladder:
            case FilterType::LadderFeedbackHp:
            case FilterType::LadderTanh:
            case FilterType::LadderHyperbolic: return ladder(c, x);
            case FilterType::LadderNonlinear: return ladderNonlinear(c, x);

            case FilterType::Diode:
            case FilterType::DiodeTanh: return diode(c, x);

            case FilterType::Phaser1: return phaser1(c, x);
            case FilterType::Phaser2: return phaser2(c, x);
            case FilterType::Flanger: return flanger(c, x);

            case FilterType::NaiveOnePole:
                naive_ += c.naive * (x - naive_);
                return naive_;
            case FilterType::Biquad: return biquad(c, x);

            case FilterType::SvfAtanh:
            case FilterType::SvfHyperbolic: return morph(svfNonlinear(c, x), c.morph);
            case FilterType::SvfSaturating:
                if (std::fabs(c.hz - roughHz_) > 0.0f || std::fabs(c.q - roughQ_) > 0.0f) {
                    rough_.set(c.hz, c.q, sampleRate);
                    roughHz_ = c.hz;
                    roughQ_ = c.q;
                }
                return dsp::morphSvf(rough_.process(x), c.morph);
            case FilterType::SallenKeyLp: return sallenKeyLp(c, x);
            case FilterType::SallenKeyHp: return sallenKeyHp(c, x);
            case FilterType::Vowel: return vowel(c, x);
            case FilterType::CombPositive:
            case FilterType::CombNegative: return comb(c, x);
            case FilterType::StaircaseLp:
            case FilterType::StaircaseHp: {
                float y = x;
                for (int n = 0; n < c.stages; ++n) {
                    const float lp = stair_[(size_t)n].tick(y, c.stageG[(size_t)n]);
                    y = c.type == FilterType::StaircaseLp ? lp : y - lp;
                }
                return y;
            }
            case FilterType::Count: break;
        }
        return x;
    }

private:
    using Lbh = std::array<float, 3>;  // low-, band-, high-pass

    static float morph(const Lbh& o, float m) noexcept {
        const auto w = morphWeights(m);
        return w[0] * o[0] + w[1] * o[1] + w[2] * o[2] + w[3] * (o[0] + o[2]);
    }

    /// §5.2: the TPT state-variable filter, solved for the high-pass.
    Lbh svf(const Coeffs& c, float x) noexcept {
        const float g = c.g, r2 = 2.0f * c.R;
        const float hp = (x - (r2 + g) * s1_ - s2_) / (1.0f + r2 * g + g * g);
        const float v1 = g * hp, bp = v1 + s1_;
        s1_ = bp + v1;
        const float v2 = g * bp, lp = v2 + s2_;
        s2_ = lp + v2;
        return {lp, bp, hp};
    }

    /// §5.4, Fig. 5.11: a saturator in the band-pass damping path. The
    /// nonlinear zero-delay feedback equation is solved for the first
    /// integrator's output v (Newton, bracketed: atanh needs |v| < 1).
    Lbh svfNonlinear(const Coeffs& c, float x) noexcept {
        const bool atanhShape = c.type == FilterType::SvfAtanh;
        const double g = c.g, R = c.R, s1 = s1_, s2 = s2_;
        auto f = [&](double v) { return atanhShape ? std::atanh(v) : v / (1.0 - std::fabs(v)); };
        auto df = [&](double v) {
            if (atanhShape) return 1.0 / (1.0 - v * v);
            const double d = 1.0 - std::fabs(v);
            return 1.0 / (d * d);
        };
        // v − s1 = g·hp,  hp = x − 2f(v) − (2R − 2 + g)·v − s2
        auto F = [&](double v) { return v - s1 - g * ((double)x - 2.0 * f(v) - (2.0 * R - 2.0 + g) * v - s2); };
        double lo = -0.999999, hi = 0.999999;
        double v = std::clamp((s1 + g * ((double)x - s2)) / (1.0 + g * (2.0 * R + g)), lo, hi);
        for (int i = 0; i < 16; ++i) {
            const double r = F(v);
            if (std::fabs(r) < 1e-8) break;
            if (r > 0.0) hi = v; else lo = v;
            double next = v - r / (1.0 + g * (2.0 * df(v) + 2.0 * R - 2.0 + g));
            if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
            v = next;
        }
        const double hp = (double)x - 2.0 * f(v) - (2.0 * R - 2.0 + g) * v - s2;
        s1_ = (float)(2.0 * v - s1);
        const double lp = g * v + s2;
        s2_ = (float)(lp + g * v);
        return {(float)lp, (float)f(v), (float)hp};
    }

    /// §4.4: mixes the ladder taps y0…y4 into LP (y4), BP (s²), HP (s⁴) and
    /// notch ((s² + 1)²), all over the ladder's denominator.
    static float ladderModes(const float* y, float m) noexcept {
        const auto w = morphWeights(m);
        const float bp = y[2] - 2.0f * y[3] + y[4];
        const float hp = y[0] - 4.0f * y[1] + 6.0f * y[2] - 4.0f * y[3] + y[4];
        return w[0] * y[4] + w[1] * 4.0f * bp + w[2] * hp + w[3] * (y[4] + 2.0f * bp + hp);
    }

    /// §4.2–4.5: four TPT 1-poles in a negative feedback loop. The loop is
    /// solved at the feedback point u; with a saturator there (tanh or
    /// x/(1 + |x|)) the equation u = x − k(G·f(u) + S) is solved numerically.
    float ladder(const Coeffs& c, float in) noexcept {
        const float G = c.G, x = in * c.comp;
        const float S = ((p_[0].offset(G) * G + p_[1].offset(G)) * G + p_[2].offset(G)) * G + p_[3].offset(G);
        const float G4 = G * G * G * G;
        float y[5];
        const float linear = (x - c.k * S) / (1.0f + c.k * G4);
        if (c.type == FilterType::LadderFeedbackHp) {
            // §4.3: a static 1-pole high-pass on the feedback path.
            const float hpGain = 1.0f - c.Gh;
            y[0] = (x - c.k * hpGain * (S - hp_.z)) / (1.0f + c.k * hpGain * G4);
        } else if (c.type == FilterType::LadderTanh) {
            y[0] = std::tanh(solveFeedback(c.k * G4, x - c.k * S, linear, [](double v) { return std::tanh(v); }, tanhD));
        } else if (c.type == FilterType::LadderHyperbolic) {
            y[0] = (float)hyper(solveFeedback(c.k * G4, x - c.k * S, linear, hyper, hyperD));
        } else {
            y[0] = linear;
        }
        for (int i = 0; i < 4; ++i) y[i + 1] = p_[(size_t)i].tick(y[i], G);
        if (c.type == FilterType::LadderFeedbackHp) hp_.tick(y[4], c.Gh);
        return ladderModes(y, c.morph);
    }

    /// §4.6: every stage integrates tanh(in) − tanh(out). Uses the "cheap"
    /// method: the feedback point comes from the linear model, then the
    /// nonlinear stages run on top (each solved by Newton's method).
    float ladderNonlinear(const Coeffs& c, float in) noexcept {
        const float G = c.G, g = c.g, x = in * c.comp;
        const float S = ((p_[0].offset(G) * G + p_[1].offset(G)) * G + p_[2].offset(G)) * G + p_[3].offset(G);
        float y[5];
        y[0] = (x - c.k * S) / (1.0f + c.k * G * G * G * G);
        for (int i = 0; i < 4; ++i) {
            auto& st = p_[(size_t)i];
            const double ti = std::tanh((double)y[i]), z = st.z;
            // y = z + g·(tanh(in) − tanh(y))
            double out = z;
            for (int n = 0; n < 4; ++n) {
                const double t = std::tanh(out);
                const double r = out - z - g * (ti - t);
                out -= r / (1.0 + g * (1.0 - t * t));
                if (std::fabs(r) < 1e-8) break;
            }
            y[i + 1] = (float)out;
            st.commit(y[i + 1]);
        }
        return ladderModes(y, c.morph);
    }

    /// §4.7: the linearised diode ladder in instantaneous-response form,
    /// solved stage by stage, inside the main feedback loop.
    float diode(const Coeffs& c, float in) noexcept {
        const float g = 0.5f * c.G, x = in * c.comp;
        float s[4];
        for (int i = 0; i < 4; ++i) s[i] = p_[(size_t)i].offset(c.G);
        const float G4 = g, S4 = s[3];
        const float d3 = 1.0f - g * G4, G3 = g / d3, S3 = (g * S4 + s[2]) / d3;
        const float d2 = 1.0f - g * G3, G2 = g / d2, S2 = (g * S3 + s[1]) / d2;
        const float d1 = 1.0f - 2.0f * g * G2, G1 = 2.0f * g / d1, S1 = (2.0f * g * S2 + s[0]) / d1;
        const float Gt = G4 * G3 * G2 * G1;
        const float St = G4 * G3 * G2 * S1 + G4 * G3 * S2 + G4 * S3 + S4;
        float u;
        if (c.type == FilterType::DiodeTanh)
            u = std::tanh(solveFeedback(c.k * Gt, x - c.k * St, (x - c.k * St) / (1.0f + c.k * Gt),
                                        [](double v) { return std::tanh(v); }, tanhD));
        else
            u = (x - c.k * St) / (1.0f + c.k * Gt);
        const float y1 = G1 * u + S1, y2 = G2 * y1 + S2, y3 = G3 * y2 + S3, y4 = G4 * y3 + S4;
        p_[0].commit(y1);
        p_[1].commit(y2);
        p_[2].commit(y3);
        p_[3].commit(y4);
        return y4;
    }

    /// §6.1: dry + four 1-pole allpasses, with zero-delay feedback around
    /// the allpass chain (Fig. 6.4).
    float phaser1(const Coeffs& c, float x) noexcept {
        const float a = 2.0f * c.G - 1.0f;  // allpass = 2·LP − in
        float A = 1.0f, B = 0.0f;
        for (auto& p : p_) {
            B = a * B + 2.0f * p.offset(c.G);
            A *= a;
        }
        const float u = (x + c.k * B) / (1.0f - c.k * A);
        float ap = u;
        for (auto& p : p_) ap = 2.0f * p.tick(ap, c.G) - ap;
        return 0.5f * (u + c.invert * ap);
    }

    /// §6.1 notch spacing: two 2-pole SVF allpasses; Mode sets their damping.
    float phaser2(const Coeffs& c, float x) noexcept {
        const float g = c.g, r2 = 2.0f * c.R, D = 1.0f + r2 * g + g * g;
        // Instantaneous response of each allpass: x − 4R·bp = a·x + b.
        const float a = 1.0f - 2.0f * r2 * g / D;
        const float b1 = -2.0f * r2 * (s1_ - g * ((r2 + g) * s1_ + s2_) / D);
        const float b2 = -2.0f * r2 * (t1_ - g * ((r2 + g) * t1_ + t2_) / D);
        const float A = a * a, B = a * b1 + b2;
        const float u = (x + c.k * B) / (1.0f - c.k * A);
        auto allpass = [&](float in, float& z1, float& z2) {
            const float hp = (in - (r2 + g) * z1 - z2) / D;
            const float v1 = g * hp, bp = v1 + z1;
            z1 = bp + v1;
            const float v2 = g * bp;
            z2 = v2 + z2 + v2;
            return in - 2.0f * r2 * bp;
        };
        const float ap = allpass(allpass(u, s1_, s2_), t1_, t2_);
        return 0.5f * (u + c.invert * ap);
    }

    /// The delay line read `delay` samples back (cubic, Hermite).
    float readDelay(float delay) const noexcept {
        const int size = (int)delay_.size();
        const float d = std::clamp(delay, 2.0f, (float)(size - 3));
        const int whole = (int)d;
        const float frac = d - (float)whole;
        // at(n): the sample written n + 1 samples before the current one.
        auto at = [&](int n) { return delay_[(size_t)((write_ - n + size) % size)]; };
        // Cubic (Hermite) interpolation between the delays whole and whole + 1.
        const float ym1 = at(whole - 2), y0 = at(whole - 1), y1 = at(whole), y2 = at(whole + 1);
        const float c1 = 0.5f * (y1 - ym1), c2 = ym1 - 2.5f * y0 + 2.0f * y1 - 0.5f * y2;
        const float c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
        return ((c3 * frac + c2) * frac + c1) * frac + y0;
    }
    void writeDelay(float v) noexcept {
        write_ = (write_ + 1) % (int)delay_.size();
        delay_[(size_t)write_] = v;
    }

    /// §6.2: the allpass chain replaced by a delay of 1/cutoff.
    float flanger(const Coeffs& c, float x) noexcept {
        const float wet = readDelay(c.delay);
        const float u = x + c.k * wet;
        writeDelay(u);
        return 0.5f * (u + c.invert * wet);
    }

    /// Tuned comb: a delay of one period (half a period for the negative
    /// feedback, which makes the peaks fall on the odd harmonics) with a
    /// damping low-pass in the loop. Normalised to unity gain at the peaks.
    float comb(const Coeffs& c, float x) noexcept {
        const float fed = hp_.tick(readDelay(c.delay), c.damp);
        const float y = x + c.k * fed;
        writeDelay(y);
        return y * c.norm;
    }

    /// The wall: a hard-knee clipper, linear below about 0.6 of kWall,
    /// bounded by kWall. f'(t) = (1 + |t|^4)^(-5/4) on the unit curve.
    static double wall(double v) noexcept {
        const double t = v / kWall, t2 = t * t;
        return v / std::pow(1.0 + t2 * t2, 0.25);
    }
    static double wallD(double v) noexcept {
        const double t = v / kWall, t2 = t * t;
        return std::pow(1.0 + t2 * t2, -1.25);
    }
    /// Solves F(v) = a·v − rhs − m·wall(arg(v)) = 0 for increasing F, v in [lo, hi].
    template <typename Arg, typename DArg>
    static float solveWall(double lo, double hi, double a, double rhs, double m, Arg arg, DArg darg, double guess) noexcept {
        double v = std::clamp(guess, lo, hi);
        for (int i = 0; i < 12; ++i) {
            const double r = a * v - rhs - m * wall(arg(v));
            if (std::fabs(r) < 1e-7) break;
            if (r > 0.0) hi = v; else lo = v;
            double next = v - r / (a - m * wallD(arg(v)) * darg);
            if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
            v = next;
        }
        return (float)v;
    }

    /// Sallen-Key low-pass: R-R-C-C with the second capacitor fed back from the
    /// amplifier output y = wall(K·u). Capacitor voltage c = v − y integrates
    /// x − 2v + u (v: the junction, u: the buffer input, a 1-pole of v):
    ///   H = K / (s² + (3 − K)·s + 1)      (divided by K at the output)
    /// The zero-delay equation a·v = rhs + y(v) is solved with a bracketed Newton.
    float sallenKeyLp(const Coeffs& c, float x) noexcept {
        const double g = c.g, G = c.G, K = c.amp;
        const double Su = p_[0].offset(c.G);
        const double a = 1.0 + 2.0 * g - g * G, rhs = skState_ + g * x + g * Su;
        const double guess = (rhs + K * Su) / (a - K * G);
        const float v = solveWall((rhs - kWall) / a, (rhs + kWall) / a, a, rhs, 1.0,
                                  [&](double vv) { return K * (G * vv + Su); }, K * G, std::clamp(guess, -1e3, 1e3));
        const double u = G * v + Su, y = wall(K * u);
        const double in = x - 2.0 * v + u;
        const double cap = skState_ + g * in;
        skState_ = (float)(cap + g * in);
        p_[0].commit((float)u);
        return (float)(y / K);
    }

    /// Sallen-Key high-pass: C-C-R-R, the dual of the above.
    ///   H = K·s² / (s² + (3 − K)·s + 1)
    float sallenKeyHp(const Coeffs& c, float x) noexcept {
        const double g = c.g, G = c.G, K = c.amp;
        const double S2 = p_[0].offset(c.G);
        const double a = 1.0 + G + g, rhs = x - S2 - skState_;
        // F(v) = a·v − rhs − g·wall(K·((1 − G)·v − S2)): the 'm' is g.
        const double guess = (rhs - g * K * S2) / (a - g * K * (1.0 - G));
        const float v = solveWall((rhs - g * kWall) / a, (rhs + g * kWall) / a, a, rhs, g,
                                  [&](double vv) { return K * ((1.0 - G) * vv - S2); }, K * (1.0 - G),
                                  std::clamp(guess, -1e3, 1e3));
        const double c2 = G * v + S2, u = v - c2, y = wall(K * u);
        skState_ = (float)(skState_ + 2.0 * g * (v - y));
        p_[0].commit((float)c2);
        return (float)(y / K);
    }

    /// Four parallel unit-gain band-passes at the formants.
    float vowel(const Coeffs& c, float x) noexcept {
        float sum = 0.0f;
        for (size_t n = 0; n < (size_t)kFormants; ++n) {
            const auto& f = c.formant[n];
            const float r2 = 2.0f * f.R, g = f.g;
            const float hp = (x - (r2 + g) * vs1_[n] - vs2_[n]) / (1.0f + r2 * g + g * g);
            const float v1 = g * hp, bp = v1 + vs1_[n];
            vs1_[n] = bp + v1;
            const float v2 = g * bp;
            vs2_[n] += 2.0f * v2;
            sum += f.amp * r2 * bp;
        }
        return sum;
    }

    /// §3.11: the bilinear transform of the SVF morph in direct form I.
    /// Fine for static settings; fast modulation is where TPT wins.
    float biquad(const Coeffs& c, float x) noexcept {
        const auto w = morphWeights(c.morph);
        const float b2 = w[2] + w[3], b1 = w[1], b0 = w[0] + w[3];  // numerator of H(s)
        const float g = c.g, gg = g * g, r2g = 2.0f * c.R * g;
        const float n0 = b2 + b1 * g + b0 * gg, n1 = 2.0f * (b0 * gg - b2), n2 = b2 - b1 * g + b0 * gg;
        const float d0 = 1.0f + r2g + gg, d1 = 2.0f * (gg - 1.0f), d2 = 1.0f - r2g + gg;
        // Time-varying direct forms can run away (§3.11); a safety limit keeps them bounded.
        const float y = std::clamp((n0 * x + n1 * x1_ + n2 * x2_ - d1 * y1_ - d2 * y2_) / d0, -16.0f, 16.0f);
        x2_ = x1_;
        x1_ = x;
        y2_ = y1_;
        y1_ = y;
        return y;
    }

    std::array<OnePole, 4> p_{};
    std::array<OnePole, kMaxStages> stair_{};
    std::array<float, kFormants> vs1_{}, vs2_{};  // formant SVFs
    float skState_ = 0.0f;                       // Sallen-Key integrator
    OnePole hp_{};
    float s1_ = 0.0f, s2_ = 0.0f, t1_ = 0.0f, t2_ = 0.0f;  // SVF integrators (second SVF: t)
    float x1_ = 0.0f, x2_ = 0.0f, y1_ = 0.0f, y2_ = 0.0f;  // direct form I
    float naive_ = 0.0f;
    std::vector<float> delay_;
    int write_ = 0;
    dsp::RoughSvf rough_;
    float roughHz_ = -1.0f, roughQ_ = -1.0f;
};

}  // namespace bleep::patch::va
