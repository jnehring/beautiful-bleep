// SPDX-License-Identifier: MIT
// Four-band parametric equaliser: low shelf, two peaking bands, high shelf. RBJ "Audio EQ Cookbook" biquads
// (the formulas are public), transposed direct form II in double precision.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct EqBand {
    enum Kind { LowShelf, Peak, HighShelf };
    Kind kind = Peak;
    float hz = 1000.0f, gainDb = 0.0f, q = 1.0f;
    bool operator==(const EqBand& o) const noexcept { return kind == o.kind && hz == o.hz && gainDb == o.gainDb && q == o.q; }
};

struct Biquad {
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;

    static Biquad design(const EqBand& band, double sampleRate) noexcept {
        const double A = std::pow(10.0, band.gainDb / 40.0);
        const double w0 = 2.0 * 3.14159265358979323846 * std::min((double)band.hz, 0.45 * sampleRate) / sampleRate;
        const double cs = std::cos(w0), sn = std::sin(w0);
        const double alpha = sn / (2.0 * std::max((double)band.q, 0.1));
        double b0, b1, b2, a0, a1, a2;
        switch (band.kind) {
            case EqBand::Peak:
                b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
                break;
            case EqBand::LowShelf: {
                const double r = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1) - (A - 1) * cs + r); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - r);
                a0 = (A + 1) + (A - 1) * cs + r; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - r;
                break;
            }
            default: {  // HighShelf
                const double r = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1) + (A - 1) * cs + r); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - r);
                a0 = (A + 1) - (A - 1) * cs + r; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - r;
                break;
            }
        }
        return {b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0};
    }
};

/// Four bands on one channel. Coefficients are redesigned only when a band changed.
class EqDsp {
public:
    static constexpr int kBands = 4;
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        reset();
    }
    void reset() {
        for (auto& z : z_) z[0] = z[1] = 0.0;
        for (auto& b : designed_) b.hz = -1.0f;  // forces a redesign
    }
    /// Sets the bands (call before a run of ticks; cheap when nothing changed).
    void setBands(const EqBand (&bands)[kBands]) noexcept {
        for (int i = 0; i < kBands; ++i)
            if (!(bands[i] == designed_[i])) {
                designed_[i] = bands[i];
                coef_[i] = Biquad::design(bands[i], sr_);
            }
    }
    float tick(float in) noexcept {
        double x = in;
        for (int i = 0; i < kBands; ++i) {
            if (designed_[i].gainDb == 0.0f) continue;  // a flat band is a wire
            const Biquad& c = coef_[i];
            const double y = c.b0 * x + z_[i][0];
            z_[i][0] = c.b1 * x - c.a1 * y + z_[i][1];
            z_[i][1] = c.b2 * x - c.a2 * y;
            x = y;
        }
        return (float)x;
    }

private:
    double sr_ = 48000.0;
    EqBand designed_[kBands];
    Biquad coef_[kBands];
    double z_[kBands][2]{};
};

}  // namespace bleep::patch
