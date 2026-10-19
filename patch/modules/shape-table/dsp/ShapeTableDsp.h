// SPDX-License-Identifier: GPL-3.0-or-later
// Shape Table (doc/specs/modules/shape-table.md): a waveshaper with a drawn
// transfer curve. The curve is kPoints control points over x = −1 … +1, turned
// into a fine piecewise-linear table by a Catmull-Rom spline. Aliasing is
// handled twice over: oversampling (off, 2×, 4×) and first-order antiderivative
// anti-aliasing, which is exact for a piecewise-linear curve because the
// antiderivative of the table is a table too. Beyond ±1 the curve clips (holds
// its end values), folds (mirrors) or wraps (repeats).
#pragma once

#include "dsp/Delay.h"
#include "dsp/Oversampler.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>

namespace bleep::patch::shapetable {

constexpr int kPoints = 65;     ///< control points of a drawn curve
constexpr int kCells = 1024;    ///< intervals of the table over −1 … +1
constexpr float kLimit = 1.5f;  ///< the curve never leaves ±1.5

enum Edge { Clip = 0, Fold, Wrap };

using Points = std::array<float, kPoints>;

// ---- curve presets -----------------------------------------------------------------

constexpr int kPresets = 8;
inline const char* const* presetNames() {
    static const char* n[] = {"Linear", "Soft", "Hard", "Fold", "Stairs", "Asym", "Rectify", "Sine"};
    return n;
}

inline float presetValue(int preset, float x) noexcept {
    constexpr float pi = 3.14159265358979f;
    switch (preset) {
        case 1: return std::tanh(2.2f * x) / std::tanh(2.2f);                       // soft saturation
        case 2: return std::clamp(2.0f * x, -1.0f, 1.0f);                            // hard clip
        case 3: return std::sin(2.0f * pi * x);                                      // a folder: one full sine cycle across the range
        case 4: {                                                                      // eight steps with soft risers
            const float s = (x + 1.0f) * 4.0f, k = std::floor(s), f = s - k;
            const float smooth = f < 0.7f ? 0.0f : (f - 0.7f) / 0.3f;
            const float v = (k + smooth * smooth * (3.0f - 2.0f * smooth)) / 4.0f - 1.0f;
            return std::clamp(v + 0.125f, -1.0f, 1.0f);
        }
        case 5: return x >= 0.0f ? std::tanh(1.8f * x) / std::tanh(1.8f) : std::max(-0.85f, 1.3f * x);  // lopsided: soft above, harder below
        case 6: return std::fabs(x) * 2.0f - 1.0f;                                  // full-wave rectifier (centred)
        case 7: return std::sin(0.5f * pi * x);                                     // a sine segment
        default: return x;
    }
}

inline Points presetPoints(int preset) noexcept {
    Points p{};
    for (int i = 0; i < kPoints; ++i) p[(size_t)i] = std::clamp(presetValue(preset, -1.0f + 2.0f * (float)i / (float)(kPoints - 1)), -1.0f, 1.0f);
    return p;
}

// ---- the table ------------------------------------------------------------------------

struct Table {
    std::array<float, kCells + 1> y{};  ///< curve at x = −1 + 2 i / kCells
    std::array<double, kCells + 1> f{}; ///< its antiderivative from x = −1
    float step = 2.0f / (float)kCells;
    double period = 0.0;                ///< ∫ over −1 … +1

    static std::shared_ptr<const Table> build(const Points& pts) {
        auto t = std::make_shared<Table>();
        for (int i = 0; i <= kCells; ++i) {
            const double u = (double)i / kCells * (kPoints - 1);
            int k = std::min((int)u, kPoints - 2);
            const double fr = u - k;
            auto at = [&](int j) {  // beyond the ends the line continues, so a straight curve stays exactly straight
                if (j < 0) return 2.0 * pts[0] - pts[1];
                if (j > kPoints - 1) return 2.0 * pts[kPoints - 1] - pts[kPoints - 2];
                return (double)pts[(size_t)j];
            };
            const double y0 = at(k - 1), y1 = at(k), y2 = at(k + 1), y3 = at(k + 2);
            const double v = y1 + 0.5 * fr * (y2 - y0 + fr * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 + fr * (3.0 * (y1 - y2) + y3 - y0)));
            t->y[(size_t)i] = (float)std::clamp(v, -(double)kLimit, (double)kLimit);
        }
        t->f[0] = 0.0;
        for (int i = 0; i < kCells; ++i) t->f[(size_t)i + 1] = t->f[(size_t)i] + 0.5 * ((double)t->y[(size_t)i] + t->y[(size_t)i + 1]) * t->step;
        t->period = t->f[kCells];
        return t;
    }

    /// The curve inside −1 … +1 (linear between table points).
    float inside(double x) const noexcept {
        const double u = std::clamp((x + 1.0) * 0.5 * kCells, 0.0, (double)kCells - 1e-9);
        const int i = (int)u;
        const float t = (float)(u - i);
        return y[(size_t)i] + t * (y[(size_t)i + 1] - y[(size_t)i]);
    }
    /// Antiderivative inside −1 … +1 (exact for the piecewise-linear table).
    double innerF(double x) const noexcept {
        const double u = std::clamp((x + 1.0) * 0.5 * kCells, 0.0, (double)kCells);
        const int i = std::min((int)u, kCells - 1);
        const double d = (u - i) * step, slope = ((double)y[(size_t)i + 1] - y[(size_t)i]) / step;
        return f[(size_t)i] + d * y[(size_t)i] + 0.5 * d * d * slope;
    }

    float eval(double x, int edge) const noexcept {
        if (x >= -1.0 && x <= 1.0) return inside(x);
        switch (edge) {
            case Fold: {
                double r = std::fmod(x + 1.0, 4.0);
                if (r < 0.0) r += 4.0;
                return r <= 2.0 ? inside(r - 1.0) : inside(3.0 - r);
            }
            case Wrap: {
                double r = std::fmod(x + 1.0, 2.0);
                if (r < 0.0) r += 2.0;
                return inside(r - 1.0);
            }
            default: return x > 1.0 ? y[kCells] : y[0];
        }
    }
    double antiderivative(double x, int edge) const noexcept {
        if (x >= -1.0 && x <= 1.0) return innerF(x);
        switch (edge) {
            case Fold: {
                const double k = std::floor((x + 1.0) / 4.0), r = x - 4.0 * k;  // r in [−1, 3)
                const double base = r <= 1.0 ? innerF(r) : 2.0 * f[kCells] - innerF(2.0 - r);
                return k * 2.0 * period + base;
            }
            case Wrap: {
                const double k = std::floor((x + 1.0) / 2.0);
                return k * period + innerF(x - 2.0 * k);
            }
            default: return x > 1.0 ? f[kCells] + (double)y[kCells] * (x - 1.0) : (double)y[0] * (x + 1.0);
        }
    }
};

/// Output of `curve` for a full-scale sine of amplitude `amp` plus `bias` (no oversampling), harmonic amplitudes 1…n.
inline void harmonics(const Table& t, float amp, float bias, int edge, float* out, int n) {
    constexpr int N = 512;
    std::array<float, N> y;
    for (int i = 0; i < N; ++i) y[(size_t)i] = t.eval((double)amp * std::sin(6.283185307179586 * i / N) + (double)bias, edge);
    for (int h = 1; h <= n; ++h) {
        double re = 0.0, im = 0.0;
        for (int i = 0; i < N; ++i) {
            const double a = 6.283185307179586 * h * i / N;
            re += y[(size_t)i] * std::cos(a);
            im += y[(size_t)i] * std::sin(a);
        }
        out[h - 1] = (float)(2.0 * std::sqrt(re * re + im * im) / N);
    }
}

// ---- the processor ---------------------------------------------------------------------

struct Params {
    float drive = 1.0f;   ///< linear input gain
    float bias = 0.0f;    ///< added after the gain
    float mix = 1.0f;
    float out = 1.0f;     ///< linear output gain
    int edge = Clip;
    int quality = 1;      ///< 0 off, 1 2×, 2 4×
    bool dcBlock = true;
};

class Channel {
public:
    void prepare(double sampleRate) {
        dry_.resize((int)(0.01 * sampleRate) + 16);
        hpA_ = (float)std::exp(-6.283185307 * 8.0 / sampleRate);
    }
    void reset() noexcept {
        up_.reset(), down_.reset();
        dry_.clear();
        x1_ = 0.0;
        have_ = false;
        hpX_ = hpY_ = 0.0f;
        lastX_ = lastY_ = 0.0f;
    }
    static int factor(int quality) noexcept { return quality <= 0 ? 1 : quality == 1 ? 2 : 4; }
    /// Delay of the wet path in base samples (oversampler round trip plus half an ADAA step).
    static double latency(int f) noexcept { return dsp::oversamplerLatency(f) + 0.5 / f; }

    float process(const Table* table, const Params& p, float in) noexcept {
        if (!std::isfinite(in)) in = 0.0f;
        in = std::clamp(in, -64.0f, 64.0f);
        const int f = factor(p.quality);
        if (f != lastFactor_) {
            lastFactor_ = f;
            up_.reset(), down_.reset();
            have_ = false;
        }
        dry_.write(in);
        const float x = in * p.drive + p.bias;
        float wet = 0.0f;
        if (table) {
            float os[4];
            up_.process(x, f, os);
            float ys[4];
            for (int k = 0; k < f; ++k) ys[k] = adaa(*table, (double)os[k], p.edge);
            wet = down_.process(ys, f);
            lastX_ = x;
            lastY_ = table->eval((double)x, p.edge);
        }
        if (p.dcBlock) {  // one-pole high-pass: removes the offset a bias or an asymmetric curve makes
            const float y = wet - hpX_ + hpA_ * hpY_;
            hpX_ = wet, hpY_ = y;
            wet = y;
        } else {
            hpX_ = wet, hpY_ = 0.0f;
        }
        const float dry = dry_.readHermite(std::max(0.0, latency(f) - 0.0));
        return (dry * (1.0f - p.mix) + wet * p.mix) * p.out;
    }
    float lastX() const noexcept { return lastX_; }
    float lastY() const noexcept { return lastY_; }

private:
    float adaa(const Table& t, double x, int edge) noexcept {
        float y;
        const double dx = x - x1_;
        if (!have_) y = t.eval(x, edge);
        else if (std::fabs(dx) < 1e-6) y = t.eval(0.5 * (x + x1_), edge);
        else y = (float)((t.antiderivative(x, edge) - t.antiderivative(x1_, edge)) / dx);
        x1_ = x;
        have_ = true;
        return std::isfinite(y) ? std::clamp(y, -kLimit, kLimit) : 0.0f;
    }

    dsp::Upsampler up_;
    dsp::Downsampler down_;
    dsp::RingDelay dry_;
    double x1_ = 0.0;
    bool have_ = false;
    int lastFactor_ = 0;
    float hpA_ = 0.999f, hpX_ = 0.0f, hpY_ = 0.0f, lastX_ = 0.0f, lastY_ = 0.0f;
};

}  // namespace bleep::patch::shapetable
