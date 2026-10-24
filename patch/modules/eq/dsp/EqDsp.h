// SPDX-License-Identifier: GPL-3.0-only
// Six-band parametric equaliser. Every band has a type (bell, shelves, cuts, notch, band-pass); RBJ "Audio EQ Cookbook"
// biquads (the formulas are public), cuts as Butterworth cascades, transposed direct form II in double precision.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct EqBand {
    enum Kind { Bell, LowShelf, HighShelf, LowCut, HighCut, Notch, BandPass, NumKinds };
    Kind kind = Bell;
    bool on = true;
    float hz = 1000.0f, gainDb = 0.0f, q = 1.0f;
    int order = 2;  ///< cuts: the filter order, 6 dB/octave per order (1, 2, 3, 4, 6 or 8)
    bool operator==(const EqBand& o) const noexcept {
        return kind == o.kind && on == o.on && hz == o.hz && gainDb == o.gainDb && q == o.q && order == o.order;
    }
    /// Bell and shelves have a gain; the other types ignore it.
    bool hasGain() const noexcept { return kind == Bell || kind == LowShelf || kind == HighShelf; }
    bool isCut() const noexcept { return kind == LowCut || kind == HighCut; }
    /// A bell or shelf at 0 dB is a wire; the other types always filter.
    bool active() const noexcept { return on && (!hasGain() || gainDb != 0.0f); }
};

struct Biquad {
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;

    static constexpr double kPi = 3.14159265358979323846;
    static constexpr int kMaxSections = 4;  ///< a cut of order 8 is four sections

    /// One RBJ section (kind: Bell, LowShelf, HighShelf, Notch, BandPass, or LowCut / HighCut as a 2nd-order section).
    static Biquad section(EqBand::Kind kind, double hz, double gainDb, double q, double sampleRate) noexcept {
        const double A = std::pow(10.0, gainDb / 40.0);
        const double w0 = 2.0 * kPi * std::min(hz, 0.45 * sampleRate) / sampleRate;
        const double cs = std::cos(w0), sn = std::sin(w0);
        const double alpha = sn / (2.0 * std::max(q, 0.05));
        double b0, b1, b2, a0, a1, a2;
        switch (kind) {
            case EqBand::Bell:
                b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
                break;
            case EqBand::LowShelf: {
                const double r = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1) - (A - 1) * cs + r); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - r);
                a0 = (A + 1) + (A - 1) * cs + r; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - r;
                break;
            }
            case EqBand::HighShelf: {
                const double r = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1) + (A - 1) * cs + r); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - r);
                a0 = (A + 1) - (A - 1) * cs + r; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - r;
                break;
            }
            case EqBand::LowCut:  // high-pass
                b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
                break;
            case EqBand::HighCut:  // low-pass
                b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
                break;
            case EqBand::Notch:
                b0 = 1; b1 = -2 * cs; b2 = 1;
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
                break;
            default:  // BandPass, 0 dB at the centre
                b0 = alpha; b1 = 0; b2 = -alpha;
                a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
                break;
        }
        return {b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0};
    }

    /// A first-order cut (6 dB/octave), bilinear transform; b2 = a2 = 0.
    static Biquad firstOrderCut(bool highPass, double hz, double sampleRate) noexcept {
        const double K = std::tan(kPi * std::min(hz, 0.45 * sampleRate) / sampleRate);
        const double n = 1.0 / (1.0 + K);
        return highPass ? Biquad{n, -n, 0, (K - 1) * n, 0} : Biquad{K * n, K * n, 0, (K - 1) * n, 0};
    }

    /// The sections of a band, written to `out`; returns how many (0..kMaxSections). A cut of order N is a Butterworth
    /// cascade: an optional first-order section and floor(N/2) second-order ones with Q = 1 / (2 cos theta).
    static int design(const EqBand& band, double sampleRate, Biquad (&out)[kMaxSections]) noexcept {
        if (!band.isCut()) {
            out[0] = section(band.kind, band.hz, band.gainDb, band.q, sampleRate);
            return 1;
        }
        const int order = std::clamp(band.order, 1, 2 * kMaxSections);
        const bool highPass = band.kind == EqBand::LowCut;
        int n = 0;
        if (order % 2) out[n++] = firstOrderCut(highPass, band.hz, sampleRate);
        for (int i = 0; i < order / 2; ++i) {
            const double theta = (order % 2 ? (i + 1) * kPi / order : (2 * i + 1) * kPi / (2.0 * order));
            out[n++] = section(band.kind, band.hz, 0.0, 1.0 / (2.0 * std::cos(theta)), sampleRate);
        }
        return n;
    }

    /// Magnitude in dB at `hz`: |H(e^jw)| from the coefficients (for the view's curve).
    double magnitudeDb(double hz, double sampleRate) const noexcept {
        const double w = 2.0 * kPi * hz / sampleRate;
        const double c1 = std::cos(w), s1 = std::sin(w), c2 = std::cos(2 * w), s2 = std::sin(2 * w);
        const double nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
        const double dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
        return 10.0 * std::log10(std::max((nr * nr + ni * ni) / std::max(dr * dr + di * di, 1e-30), 1e-30));
    }

    /// The whole band's response in dB (0 for a band that is off or flat).
    static double bandMagnitudeDb(const EqBand& band, double hz, double sampleRate) noexcept {
        if (!band.active()) return 0.0;
        Biquad s[kMaxSections];
        const int n = design(band, sampleRate, s);
        double db = 0.0;
        for (int i = 0; i < n; ++i) db += s[i].magnitudeDb(hz, sampleRate);
        return db;
    }
};

/// Six bands on one channel. Coefficients are redesigned only when a band changed.
class EqDsp {
public:
    static constexpr int kBands = 6;
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        reset();
    }
    void reset() {
        for (auto& band : z_)
            for (auto& z : band) z[0] = z[1] = 0.0;
        for (auto& b : designed_) b.hz = -1.0f;  // forces a redesign
    }
    /// Sets the bands (call before a run of ticks; cheap when nothing changed). With `blockSamples` > 0 the call
    /// stands for that many samples and frequency, gain and Q glide to the new values (about 10 ms) instead of
    /// jumping, so a fast sweep does not crackle; a change of type, on/off or slope still applies at once.
    void setBands(const EqBand (&bands)[kBands], int blockSamples = 0) noexcept {
        const double a = blockSamples > 0 ? 1.0 - std::exp(-blockSamples / (kGlideSeconds * sr_)) : 1.0;
        for (int i = 0; i < kBands; ++i) {
            EqBand b = bands[i];
            const EqBand& cur = designed_[i];
            if (a < 1.0 && cur.hz > 0.0f && b.kind == cur.kind && b.on == cur.on && b.order == cur.order) {
                b.hz = glide(cur.hz, b.hz, a, true);
                b.gainDb = glide(cur.gainDb, b.gainDb, a, false);
                b.q = glide(cur.q, b.q, a, true);
            }
            if (!(b == cur)) {
                designed_[i] = b;
                count_[i] = b.active() ? Biquad::design(b, sr_, sec_[i]) : 0;
                for (int s = count_[i]; s < Biquad::kMaxSections; ++s) z_[i][s][0] = z_[i][s][1] = 0.0;
            }
        }
    }
    float tick(float in) noexcept {
        double x = in;
        for (int i = 0; i < kBands; ++i) {
            for (int s = 0; s < count_[i]; ++s) {  // an off or flat band has no sections: a wire
                const Biquad& c = sec_[i][s];
                double* z = z_[i][s];
                const double y = c.b0 * x + z[0];
                z[0] = c.b1 * x - c.a1 * y + z[1];
                z[1] = c.b2 * x - c.a2 * y;
                x = y;
            }
        }
        return (float)x;
    }

private:
    static constexpr double kGlideSeconds = 0.01;
    /// One step of a one-pole glide from `from` towards `to` (in the log domain for hz and Q); lands on `to` once close.
    static float glide(float from, float to, double a, bool logDomain) noexcept {
        if (logDomain) {
            const double d = std::log((double)to / from);
            return std::abs(d) < 1e-4 ? to : (float)(from * std::exp(d * a));
        }
        const double d = (double)to - from;
        return std::abs(d) < 1e-3 ? to : (float)(from + d * a);
    }
    double sr_ = 48000.0;
    EqBand designed_[kBands];
    Biquad sec_[kBands][Biquad::kMaxSections];
    int count_[kBands]{};
    double z_[kBands][Biquad::kMaxSections][2]{};
};

}  // namespace bleep::patch
