// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Formant synthesis shared by Formant Osc (doc/specs/modules/formant-oscillator.md),
// the Macro Osc's Grain and Vowel models and the Wavetable Osc's Vowel bank:
//
// - FormantOsc: a pulse-formant ("burst") oscillator. Every fundamental cycle
//   plays one burst: a sine at the formant frequency under a smooth window.
//   The window's length and sharpness come from Narrow, its start from Roll
//   (read modulo the cycle, so a burst never gets cut), and Reset decides how
//   much of the formant phase restarts at each cycle (100 % = strictly
//   harmonic). The formant can track the pitch (ratio) or stay put (fixed Hz),
//   and passes through 0 Hz smoothly.
// - A vowel table: five vowels × three formants (frequency, bandwidth, gain),
//   morphable in log frequency, plus the resonance response used to build
//   vowel spectra.
#pragma once

#include "OscCore.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::dsp {

namespace formant {

/// One formant: centre, bandwidth (both Hz) and gain (dB, 0 = loudest).
struct Formant {
    float hz, bandwidthHz, gainDb;
};
struct Vowel {
    Formant f[3];
};

constexpr int kNumVowels = 5;  ///< a, e, i, o, u

/// Tenor vowels a, e, i, o, u (the classic Csound formant table).
inline const Vowel& vowel(int index) noexcept {
    static constexpr Vowel kVowels[kNumVowels] = {
        {{{650.0f, 80.0f, 0.0f}, {1080.0f, 90.0f, -6.0f}, {2650.0f, 120.0f, -7.0f}}},   // a
        {{{400.0f, 70.0f, 0.0f}, {1700.0f, 80.0f, -14.0f}, {2600.0f, 100.0f, -12.0f}}},  // e
        {{{290.0f, 40.0f, 0.0f}, {1870.0f, 90.0f, -15.0f}, {2800.0f, 100.0f, -18.0f}}},  // i
        {{{400.0f, 40.0f, 0.0f}, {800.0f, 80.0f, -10.0f}, {2600.0f, 100.0f, -12.0f}}},   // o
        {{{350.0f, 40.0f, 0.0f}, {600.0f, 60.0f, -20.0f}, {2700.0f, 100.0f, -17.0f}}},   // u
    };
    return kVowels[std::clamp(index, 0, kNumVowels - 1)];
}

/// Morph through a → e → i → o → u: `position` 0..4 (0 = a, 4 = u).
/// Frequencies and bandwidths are interpolated in log, gains in dB.
/// `shiftOctaves` scales all formants (the vocal tract size: −1 large … +1 small).
inline Vowel vowelAt(float position, float shiftOctaves = 0.0f) noexcept {
    const float x = std::clamp(position, 0.0f, (float)(kNumVowels - 1));
    const int i = std::min((int)x, kNumVowels - 2);
    const float t = x - (float)i;
    const Vowel& a = vowel(i);
    const Vowel& b = vowel(i + 1);
    const float shift = std::exp2(shiftOctaves);
    Vowel v;
    for (int k = 0; k < 3; ++k) {
        v.f[k].hz = shift * a.f[k].hz * std::pow(b.f[k].hz / a.f[k].hz, t);
        v.f[k].bandwidthHz = shift * a.f[k].bandwidthHz * std::pow(b.f[k].bandwidthHz / a.f[k].bandwidthHz, t);
        v.f[k].gainDb = a.f[k].gainDb + t * (b.f[k].gainDb - a.f[k].gainDb);
    }
    return v;
}

/// Magnitude of one two-pole resonance at `hz` (1 at its centre).
inline double resonance(const Formant& f, double hz) noexcept {
    const double x = (hz * hz - (double)f.hz * f.hz) / (std::max(hz, 1e-3) * (double)f.bandwidthHz);
    return 1.0 / std::sqrt(1.0 + x * x);
}

/// The vowel's spectral envelope at `hz`: the gain-weighted sum of its three
/// resonances (about 1 at the first formant).
inline double vowelResponse(const Vowel& v, double hz) noexcept {
    double s = 0.0;
    for (const auto& f : v.f) s += std::pow(10.0, (double)f.gainDb / 20.0) * resonance(f, hz);
    return s;
}

/// Formant knob F (octaves) → frequency multiplier that passes through zero:
/// sign(F)·2^|F| for |F| ≥ 0.1, linear to 0 between −0.1 and +0.1.
inline double formantScale(double octaves) noexcept {
    const double a = std::fabs(octaves);
    if (a >= 0.1) return std::copysign(std::exp2(a), octaves);
    return octaves / 0.1 * std::exp2(0.1);
}

enum class Tracking {
    Ratio,  ///< formant = f0 × scale: the same timbre on every note
    Fixed,  ///< formant = C4 × scale: the formant stays put (sung vowel)
};

/// The (signed) formant frequency for knob F in octaves.
inline double formantHz(Tracking mode, double f0Hz, double octaves) noexcept {
    return (mode == Tracking::Ratio ? f0Hz : osc::kC4Hz) * formantScale(octaves);
}

}  // namespace formant

/// The pulse-formant oscillator. Call process() once per sample.
class FormantOsc {
public:
    struct Params {
        double f0Hz = osc::kC4Hz;   ///< fundamental, clamped to 0.5 Hz … 0.45 fs
        double formantHz = 523.25;  ///< signed; negative runs the formant phase backwards
        double formant2Hz = 0.0;    ///< second formant (shares phase/window/roll); used if second
        float narrow = 0.0f;        ///< 0..1: window length 1 → 0.05 cycle, sharpness 1 → 4
        float roll = 0.0f;          ///< 0..1: window start within the cycle (wraps)
        float reset = 1.0f;         ///< 0..1: share of the formant phase reset each cycle
        bool cosineStart = false;   ///< carrier starts at its peak: 0 Hz = the window itself
        bool second = false;        ///< compute formant2
    };
    struct Frame {
        float formant;   ///< the burst, normalised by the window RMS (≈ ±1, ≤ ±4)
        float formant2;  ///< the second burst (0 unless Params::second)
        float window;    ///< the window alone, 0..1
        float square;    ///< polyBLEP square at f0
        float sub;       ///< square one octave down
    };

    /// Peak limit of the RMS normalisation (very narrow windows).
    static constexpr float kMaxGain = 4.0f;

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        phase_ = 0.0;
        psi_ = psi2_ = 0.0;
        sub_ = 1.0f;
    }
    /// Hard-resets the fundamental phase (the Sync input); the formant phase
    /// follows the Reset rule, as at the start of a burst.
    void sync(float reset) noexcept {
        phase_ = 0.0;
        psi_ = keep(psi_, reset);
        psi2_ = keep(psi2_, reset);
    }
    double phase() const noexcept { return phase_; }

    Frame process(const Params& p) noexcept {
        const double f0 = std::clamp(p.f0Hz, 0.5, 0.45 * sampleRate_);
        const double dt = f0 / sampleRate_;
        const double inc1 = p.formantHz / sampleRate_;
        const double inc2 = p.second ? p.formant2Hz / sampleRate_ : 0.0;
        const double phi = phase_;

        // Window: length L (≥ 4 samples), sharpness q.
        const float narrow = std::clamp(p.narrow, 0.0f, 1.0f);
        const double len = std::clamp(1.0 - 0.95 * (double)narrow, 4.0 * dt, 1.0);
        const double q = 1.0 + 3.0 * (double)narrow;
        const double u = osc::wrap01(phi - (double)p.roll);
        const double w = u < len ? std::pow((double)sin2(u / len), q) : 0.0;
        const double g = gain(len, q);

        Frame o;
        const double theta = p.cosineStart ? 0.25 : 0.0;
        o.formant = (float)(g * w * fade(inc1) * std::sin(osc::kTwoPi * (psi_ + theta)));
        o.formant2 = p.second ? (float)(g * w * fade(inc2) * std::sin(osc::kTwoPi * (psi2_ + theta))) : 0.0f;
        o.window = (float)w;
        double sq = phi < 0.5 ? 1.0 : -1.0;
        sq += osc::polyBlep(phi, dt);
        sq -= osc::polyBlep(osc::wrap01(phi - 0.5), dt);
        o.square = (float)sq;
        o.sub = sub_;

        // Advance. Where the window starts again (where it is 0), the formant
        // phase is reset at the exact sub-sample time.
        psi_ += inc1;
        psi2_ += inc2;
        if (u + dt >= 1.0) {
            const double after = (u + dt - 1.0) / dt;  // samples since the window start
            psi_ = keep(psi_ - after * inc1, p.reset) + after * inc1;
            psi2_ = keep(psi2_ - after * inc2, p.reset) + after * inc2;
        }
        double next = phi + dt;
        if (next >= 1.0) {
            next -= 1.0;
            sub_ = -sub_;
        }
        phase_ = next;
        psi_ = osc::wrap01(psi_);
        psi2_ = osc::wrap01(psi2_);
        return o;
    }

    /// The window RMS normalisation for a window of length `len` (share of the
    /// cycle) and sharpness `q`: the RMS of the wide window (L 1, q 1) over
    /// this one's, capped at kMaxGain.
    static double gain(double len, double q) noexcept {
        // mean of sin^(2m)(πv) over a period = Γ(m + ½) / (√π Γ(m + 1)), m = 2q.
        auto meanPow = [](double m) noexcept {
            return (1.0 - 1.0 / (8.0 * m) + 1.0 / (128.0 * m * m)) / std::sqrt(3.14159265358979323846 * m);
        };
        static const double ref = std::sqrt(meanPow(2.0));
        return std::min((double)kMaxGain, ref / std::sqrt(len * meanPow(2.0 * q)));
    }

private:
    /// sin²(πv), v in [0, 1], from a 1024-point table.
    static float sin2(double v) noexcept {
        static const std::array<float, kTable + 2> table = [] {
            std::array<float, kTable + 2> t{};
            for (int i = 0; i <= kTable + 1; ++i) {
                const double s = std::sin(3.14159265358979323846 * (double)i / kTable);
                t[(size_t)i] = (float)(s * s);
            }
            return t;
        }();
        const double x = std::clamp(v, 0.0, 1.0) * kTable;
        const int i = std::min((int)x, kTable - 1);
        const float f = (float)(x - i);
        return table[(size_t)i] + f * (table[(size_t)i + 1] - table[(size_t)i]);
    }
    /// Fades a formant out between 0.4 and 0.45 × fs (|increment|).
    static double fade(double inc) noexcept { return std::clamp((0.45 - std::fabs(inc)) / 0.05, 0.0, 1.0); }
    static double keep(double psi, float reset) noexcept {
        return osc::wrap01((1.0 - (double)std::clamp(reset, 0.0f, 1.0f)) * osc::wrap01(psi));
    }

    static constexpr int kTable = 1024;
    double sampleRate_ = 48000.0, phase_ = 0.0, psi_ = 0.0, psi2_ = 0.0;
    float sub_ = 1.0f;
};

}  // namespace bleep::dsp
