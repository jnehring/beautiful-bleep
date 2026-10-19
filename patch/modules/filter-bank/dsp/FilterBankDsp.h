// SPDX-License-Identifier: GPL-3.0-or-later
// Filter Bank (doc/specs/modules/filter-bank.md): ten fixed band-pass filters
// (dsp::Svf, unit gain at the centre) with per-band levels, tilt, odd/even
// balance and a scanning window, an envelope follower per band, and a
// built-in vocoder that scales each band by the matching band of a
// sidechain (or of the input itself).
//
// Control-rate work (band frequencies, coefficients, target gains, follower
// times) runs every kBlock samples; gains are smoothed per sample (5 ms).
// Bands nobody hears or reads are skipped and restart from silence.
//
// Flat sum: band-passes summed in phase ripple by a few dB whatever their Q.
// At 12 dB/oct the bands are summed as they are (≈ −1.9 … +2.4 dB from 60 Hz
// to 12 kHz at the default Q); at 24 dB/oct (two sections at 0.64·Q) every
// even band is inverted, as in a crossover, which keeps the sum within
// ≈ ±0.9 dB. With Edge Bands = Low-pass/High-pass, band 1 also carries what
// lies below it and band 10 what lies above it: band − tail, where the tail is
// a low-pass (high-pass) well outside the band, subtracted so that it sums in
// phase with the band's own skirt.
#pragma once

#include "dsp/Gain.h"
#include "dsp/Scales.h"
#include "dsp/Smoothing.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

struct FilterBankParams {
    static constexpr int kBands = 10;
    enum Tuning { Spectral, Harmonic, Scale };

    std::array<float, kBands> levelDb{};  ///< −60 (silent) … +12
    float q = 2.2f;          ///< 0.5 … 30
    float tilt = 0.0f;       ///< dB/oct around 1 kHz, −6 … +6
    float oddEven = 0.0f;    ///< −1 (odd only) … +1 (even only)
    float scan = 0.5f;       ///< 0 … 1: window centre band 1 … 10
    float width = 10.0f;     ///< 1 … 10 bands (10 = no window)
    float shift = 0.0f;      ///< octaves, −2 … +2
    float spacing = 1.0f;    ///< 0.5 … 2
    float attack = 0.003f;   ///< seconds
    float release = 0.08f;   ///< seconds
    float vocode = 0.0f;     ///< 0 … 1
    float mix = 1.0f;        ///< dry ↔ bank, for Sum
    float pitch = 0.0f;      ///< octaves (Harmonic and Scale tuning)
    int tuning = Spectral, root = 0, scale = 12;
    bool steep = false;      ///< 24 dB/oct
    bool edges = true;       ///< band 1 low-pass, band 10 high-pass
    bool sidechain = false;  ///< envelopes from the sidechain
    bool split = false;      ///< Sum L = odd bands, Sum R = even bands
};

struct FilterBankFrame {
    static constexpr int kBands = FilterBankParams::kBands;
    float in[2] = {0.0f, 0.0f};
    float sidechain = 0.0f;
    float sum[2] = {0.0f, 0.0f};
    float odd = 0.0f, even = 0.0f;
    std::array<float, kBands> band{}, env{};
};

/// Which per-band outputs something reads (unread ones may be skipped).
struct FilterBankOutputs {
    std::array<bool, FilterBankParams::kBands> band{}, env{};
};

class FilterBankDsp {
public:
    static constexpr int kBands = FilterBankParams::kBands;
    static constexpr int kBlock = 8;
    static constexpr double kC2 = 65.40639132514966;

    /// Centre frequencies before Shift and Spacing.
    static std::array<double, kBands> baseFrequencies(int tuning, float pitch, int root, int scale) noexcept {
        std::array<double, kBands> f{};
        if (tuning == FilterBankParams::Harmonic) {
            const double f0 = kC2 * std::exp2((double)pitch);
            for (int k = 0; k < kBands; ++k) f[(size_t)k] = f0 * (k + 1);
        } else if (tuning == FilterBankParams::Scale) {
            const auto& list = dsp::scales();
            const uint16_t mask = list[(size_t)std::clamp(scale, 0, (int)list.size() - 1)].mask;
            int note = dsp::quantize(pitch * 12.0f, mask);
            for (int k = 0; k < kBands; ++k) {
                f[(size_t)k] = kC2 * std::exp2((root + note) / 12.0);
                do ++note;
                while (!dsp::inScale(mask, note));
            }
        } else {
            for (int k = 0; k < kBands; ++k) f[(size_t)k] = 55.0 * std::pow(14000.0 / 55.0, k / 9.0);
        }
        return f;
    }
    /// Shift and Spacing around the geometric middle of bands 5 and 6 (unclamped).
    static std::array<double, kBands> frequencies(const FilterBankParams& p) noexcept {
        auto f = baseFrequencies(p.tuning, p.pitch, p.root, p.scale);
        const double m = std::sqrt(f[4] * f[5]);
        const double up = std::exp2((double)p.shift), sp = std::clamp((double)p.spacing, 0.25, 4.0);
        for (auto& x : f) x = m * up * std::pow(x / m, sp);
        return f;
    }
    /// The scan window's gain for band k (0-based).
    static float window(int k, float scan, float width) noexcept {
        const float w = std::clamp(width, 1.0f, 10.0f);
        const float d = std::fabs((float)k - 9.0f * std::clamp(scan, 0.0f, 1.0f));
        const float flat = 0.5f * (w - 1.0f);  // full gain within, then one band of cosine taper
        float g = d <= flat ? 1.0f : d >= flat + 1.0f ? 0.0f : 0.5f + 0.5f * std::cos(3.14159265f * (d - flat));
        const float off = std::clamp(w - 9.0f, 0.0f, 1.0f);  // Width 9 … 10 fades the window out
        return g + off * (1.0f - g);
    }

    void prepare(double sampleRate) {
        sampleRate_ = sampleRate;
        smooth_ = (float)std::exp(-1.0 / (0.005 * sampleRate));
        reset();
    }

    void reset() noexcept {
        for (auto& b : bands_) b = {};
        for (auto& g : gain_) g = 0.0f;
        target_.fill(0.0f);
        countdown_ = 0;
        lastQ_ = -1.0f;
        lastSteep_ = -1;
        lastAttack_ = lastRelease_ = -1.0f;
    }

    /// True when the next tick() does its control-rate update: only then are
    /// the slow params (all but vocode and mix) read, so callers may skip
    /// filling them in between.
    bool controlDue() const noexcept { return countdown_ <= 1; }

    void tick(const FilterBankParams& p, const FilterBankOutputs& o, FilterBankFrame& f, bool stereo) noexcept {
        if (--countdown_ <= 0) control(p, o);
        const bool split = p.split;
        const int channels = split || !stereo ? 1 : 2;
        const float mono = 0.5f * (f.in[0] + f.in[1]);
        const float x0 = split ? mono : f.in[0];
        float sum[2] = {0.0f, 0.0f}, odd = 0.0f, even = 0.0f;
        for (int k = 0; k < kBands; ++k) {
            Band& b = bands_[(size_t)k];
            gain_[(size_t)k] = target_[(size_t)k] + smooth_ * (gain_[(size_t)k] - target_[(size_t)k]);
            if (!b.active) {
                f.band[(size_t)k] = 0.0f;
                f.env[(size_t)k] = 0.0f;
                continue;
            }
            float y[2];
            y[0] = b.process(0, x0, steep_);
            y[1] = channels == 2 ? b.process(1, f.in[1], steep_) : y[0];
            const float ym = 0.5f * (y[0] + y[1]);
            float env = 0.0f;
            if (b.sidechain) env = b.follower.process(b.process(2, f.sidechain, steep_));
            else if (!p.sidechain) env = b.follower.process(ym);
            const float voc = std::clamp(1.0f - p.vocode + p.vocode * 4.0f * env, 0.0f, 4.0f);
            const float g = gain_[(size_t)k] * voc;
            effective_[(size_t)k] = g;
            f.band[(size_t)k] = limit(ym * g);
            f.env[(size_t)k] = std::min(1.0f, 2.0f * env);
            sum[0] += y[0] * g;
            sum[1] += y[1] * g;
            (k & 1 ? even : odd) += ym * g;
        }
        if (split) {
            sum[0] = odd;
            sum[1] = even;
        }
        const float dry[2] = {f.in[0], stereo ? f.in[1] : f.in[0]};
        for (int c = 0; c < 2; ++c) f.sum[c] = limit(dry[c] + p.mix * (sum[c] - dry[c]));
        f.odd = limit(odd);
        f.even = limit(even);
    }

    // For the view.
    double frequency(int k) const noexcept { return bands_[(size_t)k].hz; }
    float effectiveGain(int k) const noexcept { return bands_[(size_t)k].active ? effective_[(size_t)k] : 0.0f; }
    bool active(int k) const noexcept { return bands_[(size_t)k].active; }

private:
    /// Output safety limit: linear up to ±2, then a tanh knee bounded at ±8
    /// (+12 dB levels, steep tilt and vocode boost can stack up).
    static float limit(float x) noexcept {
        const float a = std::fabs(x);
        return a <= 2.0f ? x : std::copysign(2.0f + 6.0f * std::tanh((a - 2.0f) / 6.0f), x);
    }

    /// One band: up to two SVF sections per channel (L, R, sidechain) and an
    /// edge tail filter, plus its envelope follower.
    struct Band {
        std::array<std::array<dsp::Svf, 2>, 3> sec{};
        std::array<dsp::Svf, 3> tail{};
        dsp::EnvelopeFollower follower;
        float inv = 1.0f;    ///< 1 / Q of a section: unit gain at the centre
        float sign = 1.0f;   ///< polarity (even bands inverted at 24 dB/oct)
        int edge = 0;        ///< 0 none, −1 low tail (band 1), +1 high tail (band 10)
        double hz = 0.0;
        bool active = false, sidechain = false, prepared = false;

        void clear() noexcept {
            for (auto& ch : sec)
                for (auto& s : ch) s.reset();
            for (auto& t : tail) t.reset();
            follower.reset();
        }
        float process(int c, float x, bool steep) noexcept {
            float y = sec[(size_t)c][0].process(x).bp * inv;
            if (steep) y = sec[(size_t)c][1].process(y).bp * inv;
            if (edge < 0) y -= tail[(size_t)c].process(x).lp;
            else if (edge > 0) y -= tail[(size_t)c].process(x).hp;
            return sign * y;
        }
    };

    /// The section Q that keeps the analog bandwidth in octaves after the
    /// bilinear transform (which squeezes bands towards Nyquist; RBJ's
    /// bandwidth correction w0 / sin w0), so the top bands overlap like the
    /// others and the sum stays flat up there.
    float warpedQ(float q, double hz) const noexcept {
        const double w0 = 2.0 * 3.14159265358979323846 * hz / sampleRate_;
        const double octaves = 2.0 * std::asinh(0.5 / q) / 0.6931471805599453;
        return (float)(0.5 / std::sinh(0.5 * 0.6931471805599453 * octaves * w0 / std::sin(w0)));
    }

    void control(const FilterBankParams& p, const FilterBankOutputs& o) noexcept {
        countdown_ = kBlock;
        const auto f = frequencies(p);
        const float q = std::clamp(p.q, 0.5f, 30.0f);
        const bool steep = p.steep;
        const float secQ = steep ? 0.64f * q : q;
        const bool retune = std::fabs(q - lastQ_) > 0.0f || (int)steep != lastSteep_ || p.edges != lastEdges_;
        steep_ = steep;
        const bool times = std::fabs(p.attack - lastAttack_) > 0.0f || std::fabs(p.release - lastRelease_) > 0.0f;
        const double top = 0.45 * sampleRate_;
        const float oe = std::clamp(p.oddEven, -1.0f, 1.0f);
        for (int k = 0; k < kBands; ++k) {
            Band& b = bands_[(size_t)k];
            const double hz = std::clamp(f[(size_t)k], 20.0, top);
            // Target gain: level × tilt × odd/even × window; bands above the top are muted.
            float g = dsp::faderGain(p.levelDb[(size_t)k]);
            if (g > 0.0f) {
                g *= std::pow(10.0f, p.tilt * (float)std::log2(hz / 1000.0) / 20.0f);
                g *= std::min(1.0f, k & 1 ? 1.0f + oe : 1.0f - oe);
                g *= window(k, p.scan, p.width);
                if (f[(size_t)k] > top) g = 0.0f;
            }
            target_[(size_t)k] = g;
            const bool envNeeded = o.env[(size_t)k] || (p.vocode > 0.0f && g > 0.0f);
            const bool active = g > 0.0f || gain_[(size_t)k] > 1e-6f || o.band[(size_t)k] || o.env[(size_t)k];
            const bool sc = active && p.sidechain && envNeeded;
            if (active && !b.active) {  // restart from silence
                b.clear();
                b.hz = 0.0;
            }
            if (sc && !b.sidechain) {  // the sidechain filters start now: tune them too
                for (auto& s : b.sec[2]) s.reset();
                b.tail[2].reset();
                b.hz = 0.0;
            }
            b.active = active;
            b.sidechain = sc;
            b.edge = p.edges ? (k == 0 ? -1 : k == kBands - 1 ? 1 : 0) : 0;
            // A high tail beyond the top of the band would only cut into band 10's
            // own skirt (at 48 kHz band 10 already reaches Nyquist): leave it out.
            if (b.edge > 0 && hz / (steep ? 0.4 : 0.35) > top) b.edge = 0;
            b.sign = steep && (k & 1) ? -1.0f : 1.0f;
            if (!active) continue;
            if (retune || std::fabs(hz - b.hz) > 1e-9 * hz) {
                b.hz = hz;
                const float bq = warpedQ(secQ, hz);
                b.inv = 1.0f / bq;
                const int channels = sc ? 3 : 2;
                for (int c = 0; c < channels; ++c)
                    for (auto& s : b.sec[(size_t)c]) s.set((float)hz, bq, sampleRate_);
                if (b.edge != 0) {
                    const double m = steep ? 0.4 : 0.35, tq = steep ? 0.5 : 0.7071;
                    const double th = b.edge < 0 ? hz * m : hz / m;
                    for (int c = 0; c < channels; ++c) b.tail[(size_t)c].set((float)th, (float)tq, sampleRate_);
                }
            }
            if (times || !b.prepared) {
                b.follower.prepare(sampleRate_, std::max(p.attack, 1e-4f), std::max(p.release, 1e-3f));
                b.prepared = true;
            }
        }
        lastQ_ = q;
        lastSteep_ = steep;
        lastEdges_ = p.edges;
        lastAttack_ = p.attack;
        lastRelease_ = p.release;
    }

    double sampleRate_ = 48000.0;
    std::array<Band, kBands> bands_{};
    std::array<float, kBands> gain_{}, target_{}, effective_{};
    float smooth_ = 0.99f, lastQ_ = -1.0f, lastAttack_ = -1.0f, lastRelease_ = -1.0f;
    int countdown_ = 0, lastSteep_ = -1;
    bool steep_ = false, lastEdges_ = true;
};

}  // namespace bleep::patch
