// SPDX-License-Identifier: GPL-3.0-only
// Folder (doc/specs/modules/wavefolder.md): a stereo six-stage wavefolder with a
// tap crossfade, anti-aliased by 2× or 4× oversampling plus first-order ADAA
// in every stage (the shared dsp::Folder). A sine/triangle oscillator can
// stand in for the input. The dry path is delayed by the oversampling and
// ADAA latency, so Mix stays in phase.
#pragma once

#include "dsp/Folder.h"
#include "dsp/OscCore.h"
#include "dsp/Oversampler.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

/// 1×, 2× or 4× with the shared half-band resamplers (dsp/Oversampler.h).
class FolderOversampler {
public:
    void reset() noexcept { up_.reset(), down_.reset(); }
    void up(float x, int factor, float* out) noexcept { up_.process(x, factor, out); }
    float down(const float* in, int factor) noexcept { return down_.process(in, factor); }
    /// Latency in base samples: 47 per stage at its own rate.
    static double latency(int factor) noexcept { return dsp::oversamplerLatency(factor); }

private:
    dsp::Upsampler up_;
    dsp::Downsampler down_;
};

struct WavefolderParams {
    float fold = 0.0f;      ///< 0…1: per-stage gain 4^fold
    float symmetry = 0.0f;  ///< −1…+1
    float tap = 6.0f;       ///< 1…6
    float shape = 0.5f;     ///< 0 soft … 1 hard
    float spread = 0.0f;
    float level = 1.0f;     ///< input gain, cubic
    float mix = 1.0f;
    float wave = 0.0f;      ///< oscillator: sine → triangle
    float coarse = 0.0f;    ///< semitones
    float fine = 0.0f;      ///< cents
    float fmDepth = 0.0f;
    int octave = 0;
    int source = 0;         ///< 0 Auto, 1 Input, 2 Internal
    int quality = 1;        ///< 0 Eco (2×), 1 Normal (4×)
};

struct WavefolderInput {
    float l = 0.0f, r = 0.0f, pitch = 0.0f;
    bool lConnected = false, rConnected = false, pitchConnected = false;
};

struct WavefolderFrame {
    float l = 0.0f, r = 0.0f, osc = 0.0f;
};

class WavefolderDsp {
public:
    static constexpr int kQualities = 2;
    static int factor(int quality) noexcept { return quality <= 0 ? 2 : 4; }
    /// Total latency of the wet path: oversampler + half a sample per ADAA stage.
    static double latency(int f, int stages) noexcept { return FolderOversampler::latency(f) + 0.5 * stages / f; }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        smooth_ = (float)std::exp(-1.0 / (0.002 * sampleRate));  // 2 ms
        rampStep_ = (float)(1.0 / (0.005 * sampleRate));          // 5 ms
        for (auto& c : ch_) c.dc.prepare(sampleRate);
    }

    void reset() noexcept {
        for (auto& c : ch_) c.reset();
        osc_.reset();
        osc_.setTriangleBlamp(true);
        oscMix_ = -1.0f;
        factor_ = 0;
        stereo_ = false;
    }

    WavefolderFrame tick(const WavefolderParams& p, const WavefolderInput& in) noexcept {
        const int f = factor(p.quality);
        if (f != factor_) {  // a new rate: only the oversampling filters start over
            factor_ = f;
            for (auto& c : ch_) c.os.reset();
        }
        // Source: the oscillator stands in when asked (or, on Auto, when only Pitch is patched).
        const bool oscOn = p.source == 2 || (p.source == 0 && in.pitchConnected && !in.lConnected);
        const float target = oscOn ? 1.0f : 0.0f;
        if (oscMix_ < 0.0f) oscMix_ = target;
        else if (oscMix_ < target) oscMix_ = std::min(target, oscMix_ + rampStep_);
        else if (oscMix_ > target) oscMix_ = std::max(target, oscMix_ - rampStep_);

        float osc = 0.0f;
        if (oscMix_ > 0.0f) {
            const double hz = dsp::osc::pitchToHz((double)p.octave + (double)in.pitch + (p.coarse + p.fine / 100.0) / 12.0);
            const double fm = oscOn && in.lConnected ? (double)in.l : 0.0;  // In L is FM while the oscillator runs
            const double dt = dsp::osc::increment(dsp::osc::linearFm(hz, (double)p.fmDepth, fm), sampleRate_);
            const dsp::OscWaves w = osc_.tick(dt, 0.5f);
            osc = w.sine + std::clamp(p.wave, 0.0f, 1.0f) * (w.triangle - w.sine);
        }
        const float m = std::max(oscMix_, 0.0f);
        const float inL = sanitize(in.l), inR = sanitize(in.rConnected ? in.r : in.l);
        const float xL = (1.0f - m) * inL + m * osc;
        const float xR = (1.0f - m) * inR + m * osc;

        const float spread = std::clamp(p.spread, 0.0f, 1.0f);
        const bool stereo = in.rConnected || spread > 0.0f;
        if (stereo && !stereo_) ch_[1] = ch_[0];  // R was a copy of L: carry on from L's state
        stereo_ = stereo;

        WavefolderFrame out;
        out.osc = osc * m;
        out.l = ch_[0].process(*this, p, xL, spread * 0.5f, spread * 0.1f, f);
        out.r = stereo ? ch_[1].process(*this, p, xR, -spread * 0.5f, -spread * 0.1f, f) : out.l;
        return out;
    }

    // ---- for the view ----
    /// The input range after Level over the last samples (L channel).
    float inputMin() const noexcept { return ch_[0].lo; }
    float inputMax() const noexcept { return ch_[0].hi; }
    void clearInputRange() noexcept { ch_[0].lo = ch_[0].hi = 0.0f; }
    float levelGain() const noexcept { return ch_[0].level; }
    float symmetryNow() const noexcept { return ch_[0].sym; }
    /// The dry signal (delayed like the wet one) of the last L sample.
    float dryL() const noexcept { return ch_[0].lastDry; }

    static float levelCurve(float level) noexcept {
        const float l = std::clamp(level, 0.0f, 1.0f);
        return l * l * l;
    }

private:
    static float sanitize(float x) noexcept { return std::isfinite(x) ? std::clamp(x, -64.0f, 64.0f) : 0.0f; }

    struct Channel {
        FolderOversampler os;
        dsp::Folder folder;
        dsp::fold::DcBlocker dc;
        float sym = 0.0f, level = 1.0f, gain = 1.0f, tap = 6.0f;
        bool started = false;
        float lo = 0.0f, hi = 0.0f, lastDry = 0.0f;
        static constexpr int kDelay = 128;  // > 70.5 + 1.5 + 2 (Lagrange)
        std::array<float, kDelay> dry{};
        int pos = 0;

        void reset() noexcept {
            os.reset(), folder.reset(), dc.reset();
            started = false;
            dry.fill(0.0f);
            pos = 0;
            lo = hi = lastDry = 0.0f;
        }

        float process(const WavefolderDsp& d, const WavefolderParams& p, float x, float symOffset, float foldOffset,
                      int f) noexcept {
            const float symT = std::clamp(p.symmetry + symOffset, -1.0f, 1.0f);
            const float levelT = levelCurve(p.level);
            const float gainT = std::exp2(2.0f * std::clamp(p.fold + foldOffset, 0.0f, 1.0f));  // 4^fold
            const float tapT = std::clamp(p.tap, 1.0f, 6.0f);
            if (!started) {
                started = true;
                sym = symT, level = levelT, gain = gainT, tap = tapT;
            }
            // Symmetry and Level glide over 2 ms (they click at the hard corners);
            // Fold and Tap are interpolated per oversampled sample.
            sym = symT + d.smooth_ * (sym - symT);
            level = levelT + d.smooth_ * (level - levelT);
            const float u = level * x;
            lo = std::min(lo, u), hi = std::max(hi, u);

            float buf[4];
            os.up(u, f, buf);
            dsp::Folder::Params fp;
            fp.symmetry = sym;
            fp.shape = std::clamp(p.shape, 0.0f, 1.0f);
            const float g0 = gain, t0 = tap;
            for (int j = 0; j < f; ++j) {
                const float a = (float)(j + 1) / (float)f;
                fp.gain = g0 + a * (gainT - g0);
                fp.tap = t0 + a * (tapT - t0);
                buf[j] = folder.process(buf[j], fp);
            }
            gain = gainT, tap = tapT;
            const float wet = os.down(buf, f);

            // Dry, delayed by the wet path's latency (4-point Lagrange for the fraction).
            dry[(size_t)pos] = x;
            const int stages = (int)std::ceil(tapT - 1e-6f);
            const double delay = latency(f, stages);
            const int whole = (int)std::floor(delay);
            const float fr = (float)(delay - whole);
            auto at = [&](int k) { return dry[(size_t)((pos - k + kDelay) % kDelay)]; };
            const float y0 = at(whole), y1 = at(whole + 1);
            float dryOut;
            if (whole < 1) {
                dryOut = y0 + fr * (y1 - y0);  // (no oversampling: short delays, linear)
            } else {  // nodes at delays whole−1 … whole+2, evaluated at whole + fr
                const float ym1 = at(whole - 1), y2 = at(whole + 2), t = fr;
                dryOut = -t * (t - 1.0f) * (t - 2.0f) / 6.0f * ym1 + (t + 1.0f) * (t - 1.0f) * (t - 2.0f) / 2.0f * y0 -
                         (t + 1.0f) * t * (t - 2.0f) / 2.0f * y1 + (t + 1.0f) * t * (t - 1.0f) / 6.0f * y2;
            }
            pos = (pos + 1) % kDelay;
            lastDry = dryOut;
            const float mix = std::clamp(p.mix, 0.0f, 1.0f);
            // Symmetry makes DC: a 5 Hz high-pass on the output (after Mix, so dry
            // and wet stay in phase).
            return dc.process(dryOut + mix * (wet - dryOut));
        }
    };

    double sampleRate_ = 48000.0;
    float smooth_ = 0.99f, rampStep_ = 1.0f / 240.0f, oscMix_ = -1.0f;
    int factor_ = 0;
    bool stereo_ = false;
    dsp::OscCore osc_;
    Channel ch_[2];
};

}  // namespace bleep::patch
