// SPDX-License-Identifier: MIT
// Meta Mod (doc/specs/modules/meta-modulator.md): combines a carrier and a
// modulator with one of eight algorithms, morphing continuously between
// neighbours: crossfade, fold, analog (diode) ring, digital ring, bitwise,
// comparator, vocoder, Chebyshev. An internal oscillator (the Oscillator's
// core) stands in for an unpatched input.
//
// The nonlinear algorithms run oversampled (2× or 4×, polyphase half-band);
// the linear ones (crossfade, vocoder) and the dry signal run at the base
// rate and are delayed by the oversampler's latency, so morphing between the
// two kinds stays in phase.
#pragma once

#include "dsp/Folder.h"
#include "dsp/OscCore.h"
#include "dsp/Oversampler.h"
#include "dsp/Smoothing.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

namespace metamod {

// The shared polyphase half-band resamplers (dsp/Oversampler.h).
using Upsampler = dsp::Upsampler;
using Downsampler = dsp::Downsampler;
/// Base samples of delay of an up/down pair at `factor`.
inline double latency(int factor) noexcept { return dsp::oversamplerLatency(factor); }

/// A short delay line with a 4-point Lagrange read (for the half-sample at 4×).
class Delay {
public:
    static constexpr int kSize = 128;
    void reset() noexcept { buf_.fill(0.0f), pos_ = 0; }
    float process(float x, double delay) noexcept {
        buf_[(size_t)pos_] = x;
        const int whole = (int)std::floor(delay);
        const float t = (float)(delay - whole);
        auto at = [&](int k) { return buf_[(size_t)((pos_ - k + kSize) % kSize)]; };
        float y;
        if (whole < 1 || t == 0.0f) {
            y = at(whole) + t * (at(whole + 1) - at(whole));
        } else {
            const float ym1 = at(whole - 1), y0 = at(whole), y1 = at(whole + 1), y2 = at(whole + 2);
            y = -t * (t - 1.0f) * (t - 2.0f) / 6.0f * ym1 + (t + 1.0f) * (t - 1.0f) * (t - 2.0f) / 2.0f * y0 -
                (t + 1.0f) * t * (t - 2.0f) / 2.0f * y1 + (t + 1.0f) * t * (t - 1.0f) / 6.0f * y2;
        }
        pos_ = (pos_ + 1) % kSize;
        return y;
    }

private:
    std::array<float, kSize> buf_{};
    int pos_ = 0;
};

/// The input limit: unchanged within ±1, then a smooth knee towards ±4, so the
/// polynomial algorithms can't explode on hot input and full-scale signals
/// stay undistorted.
inline float limit(float x) noexcept {
    if (!std::isfinite(x)) return 0.0f;
    const float a = std::fabs(x);
    if (a <= 1.0f) return x;
    return std::copysign(1.0f + 3.0f * std::tanh((a - 1.0f) / 3.0f), x);
}

/// The output limit: unchanged within ±2 (level-matched algorithms peak
/// below it), then a smooth knee into ±4.
inline float outputLimit(float x) noexcept {
    const float a = std::fabs(x);
    if (a <= 2.0f) return x;
    return std::copysign(2.0f + 2.0f * std::tanh((a - 2.0f) / 2.0f), x);
}

/// One diode of the analog ring, made symmetric (a diode pair): 0 below
/// `vb`, quadratic up to `vl`, then linear (slope 1, continuous).
inline float diodePair(float v, float vb, float vl) noexcept {
    const float a = std::fabs(v);
    if (a <= vb) return 0.0f;
    if (a < vl) return (a - vb) * (a - vb) / (2.0f * (vl - vb));
    return a - 0.5f * (vl + vb);
}

}  // namespace metamod

struct MetaModParams {
    float algorithm = 2.0f;  ///< 0…7, continuous
    float timbre = 0.5f;
    float carrierLevel = 1.0f;  ///< 0…2
    float modLevel = 1.0f;      ///< 0…2
    float oscTune = 0.0f;       ///< semitones
    float oscShape = 0.0f;      ///< the Oscillator's Shape morph
    float mix = 1.0f;
    int oscOctave = 0;
    int quality = 1;   ///< 0 Eco (1×), 1 Standard (2×), 2 High (4×)
    int bitwiseOp = 0; ///< XOR, AND, OR, Sum mod
};

struct MetaModInput {
    float carrierL = 0.0f, carrierR = 0.0f, modulator = 0.0f, pitch = 0.0f, sync = 0.0f;
    bool carrierLConnected = false, carrierRConnected = false, modConnected = false;
};

struct MetaModFrame {
    float l = 0.0f, r = 0.0f, osc = 0.0f, env = 0.0f;
};

class MetaModDsp {
public:
    static constexpr int kAlgorithms = 8;
    static constexpr int kBands = 12;
    enum { Crossfade, Fold, AnalogRing, DigitalRing, Bitwise, Comparator, Vocoder, Chebyshev };

    static int factor(int quality) noexcept { return quality <= 0 ? 1 : quality == 1 ? 2 : 4; }

    /// Output gain per algorithm: two full-scale sines (440 Hz carrier, 110 Hz
    /// modulator) at Timbre 50 % come out at about the RMS of the crossfade
    /// (measured; tests/test_meta_mod.cpp checks ±2 dB). The vocoder is
    /// matched with a noise carrier and a voice-like modulator instead.
    static float gain(int algorithm) noexcept {
        static constexpr float g[kAlgorithms] = {1.0f, 1.05f, 0.69f, 1.73f, 1.37f, 0.8f, 5.9f, 1.25f};
        return g[std::clamp(algorithm, 0, kAlgorithms - 1)];
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        rampStep_ = (float)(1.0 / (0.005 * sampleRate));
        holdSamples_ = (int)(0.05 * sampleRate);
        env_.prepare(sampleRate, 0.005f, 0.12f);
        for (auto& c : ch_) c.prepare(sampleRate);
        for (int k = 0; k < kBands; ++k) {
            bandHz_[k] = (float)(100.0 * std::pow(80.0, k / (double)(kBands - 1)));  // 100 Hz … 8 kHz
            for (auto& s : analysis_[k]) s.set(bandHz_[k], kBandQ, sampleRate);
            follow_[k].prepare(sampleRate, 0.002f, 0.04f);
        }
        unvoiced_.set(8000.0f, 0.7071f, sampleRate);
        shift_ = -1.0f;
    }

    void reset() noexcept {
        osc_.reset();
        lastSync_ = false;
        env_.reset();
        for (auto& c : ch_) c.reset();
        upB_.reset();
        for (int k = 0; k < kBands; ++k) {
            for (auto& s : analysis_[k]) s.reset();
            follow_[k].reset();
            level_[k] = 0.0f;
        }
        unvoiced_.reset();
        gCarrier_ = gModIn_ = gModOsc_ = -1.0f;
        factor_ = 0;
        silent_ = 0;
        vocoderHold_ = retune_ = 0;
        stereo_ = false;
    }

    MetaModFrame tick(const MetaModParams& p, const MetaModInput& in) noexcept {
        const int f = factor(p.quality);
        if (f != factor_) {  // a new rate: only the oversampling filters start over
            factor_ = f;
            for (auto& c : ch_) c.up.reset(), c.down.reset();
            upB_.reset();
        }

        // The internal oscillator, as the Oscillator.
        const bool syncHigh = in.sync >= 0.5f;
        if (syncHigh && !lastSync_) osc_.hardSync();
        lastSync_ = syncHigh;
        const double hz = (float)dsp::osc::pitchToHz((double)((float)p.oscOctave + p.oscTune / 12.0f + in.pitch));
        const double dt = std::clamp(hz / sampleRate_, -0.49, 0.49);
        const float osc = dsp::OscCore::morph(osc_.tick(dt, 0.5f), p.oscShape);

        // Which input the oscillator replaces (4.1), ramped over 5 ms.
        ramp(gCarrier_, in.carrierLConnected ? 1.0f : 0.0f);
        ramp(gModIn_, in.modConnected ? 1.0f : 0.0f);
        ramp(gModOsc_, !in.modConnected && in.carrierLConnected ? 1.0f : 0.0f);
        const float cl = clean(in.carrierL), cr = clean(in.carrierR);
        const float carrierL = gCarrier_ * cl + (1.0f - gCarrier_) * osc;
        const float carrierR = in.carrierRConnected ? cr : carrierL;
        const float mod = gModIn_ * clean(in.modulator) + gModOsc_ * osc;

        const float aL = metamod::limit(std::max(p.carrierLevel, 0.0f) * carrierL);
        const float aR = metamod::limit(std::max(p.carrierLevel, 0.0f) * carrierR);
        const float b = metamod::limit(std::max(p.modLevel, 0.0f) * mod);

        MetaModFrame out;
        out.osc = osc;
        out.env = std::min(1.0f, 2.0f * env_.process(b));

        // Algorithm weights: the two neighbours of the position.
        const float x = std::clamp(p.algorithm, 0.0f, (float)(kAlgorithms - 1));
        const int i = std::min((int)x, kAlgorithms - 2);
        const float frac = x - (float)i;
        const float t = std::clamp(p.timbre, 0.0f, 1.0f);
        const float wXfade = weight(Crossfade, i, frac), wVoc = weight(Vocoder, i, frac);
        auto isNonlinear = [](int alg) { return alg != Crossfade && alg != Vocoder; };
        const bool nonlinear = (isNonlinear(i) && frac < 1.0f) || (isNonlinear(i + 1) && frac > 0.0f);

        // Silence: both inputs below −120 dB for longer than the pipeline.
        const bool quiet = std::fabs(aL) < 1e-6f && std::fabs(aR) < 1e-6f && std::fabs(b) < 1e-6f;
        silent_ = quiet ? silent_ + 1 : 0;
        const bool skip = silent_ > 256;

        // The vocoder: analysis of the modulator, kept running 50 ms after its weight falls to 0.
        vocoderHold_ = wVoc > 0.0f ? holdSamples_ : std::max(vocoderHold_ - 1, 0);
        const bool vocoderOn = vocoderHold_ > 0 && !skip;
        if (vocoderOn) analyse(b, t);

        const bool stereo = in.carrierRConnected;
        if (stereo && !stereo_) ch_[1] = ch_[0];  // R was a copy of L: carry on from its state
        stereo_ = stereo;

        float bUp[4];
        const bool runNonlinear = nonlinear && !skip;
        if (runNonlinear) upB_.process(b, f, bUp);
        out.l = ch_[0].process(*this, p, aL, b, bUp, i, frac, t, wXfade, wVoc, vocoderOn, runNonlinear, f);
        out.r = stereo ? ch_[1].process(*this, p, aR, b, bUp, i, frac, t, wXfade, wVoc, vocoderOn, runNonlinear, f)
                       : out.l;
        return out;
    }

    /// One algorithm on one sample, without oversampling or output gain
    /// (also for tests). `fold` carries the Fold algorithm's ADAA state.
    static float algorithm(int alg, float a, float b, float t, int op, dsp::fold::Stage* fold = nullptr) noexcept {
        switch (alg) {
            case Crossfade: return a * std::cos(1.5707963f * t) + b * std::sin(1.5707963f * t);
            case Fold: {
                const float u = (1.0f + 7.0f * t) * (a + b);
                return fold ? (float)fold->process((double)u, 0.0) : (float)dsp::fold::soft((double)u);
            }
            case AnalogRing: {
                constexpr float vb = 0.02f, vl = 0.4f;
                const float vb2 = vb * (1.0f + 0.6f * t);
                return metamod::diodePair(a + b, vb, vl) - metamod::diodePair(a - b, vb2, vl + (vb2 - vb)) + 0.15f * t * a;
            }
            case DigitalRing: return a * (b + t) / (1.0f + t);
            case Bitwise: return bitwise(a, b, t, op);
            case Comparator: {
                if (t < 0.5f) return std::tanh(1000.0f * std::pow(0.004f, 2.0f * t) * (a - b));
                const float u = 2.0f * (t - 0.5f);
                return (1.0f - u) * std::tanh(4.0f * (a - b)) + u * std::max(a, b);
            }
            case Chebyshev: {
                const float c = std::clamp(a, -1.0f, 1.0f);
                const float n = 1.0f + 15.0f * std::clamp(t + 0.5f * b, 0.0f, 1.0f);
                const int lo = std::min((int)n, 15);
                const float fr = n - (float)lo;
                float t0 = 1.0f, t1 = c;  // T_0, T_1
                for (int k = 1; k < lo; ++k) {
                    const float t2 = 2.0f * c * t1 - t0;
                    t0 = t1, t1 = t2;
                }
                const float next = 2.0f * c * t1 - t0;  // T_(lo+1)
                return t1 + fr * (next - t1);
            }
            default: return 0.0f;
        }
    }

    /// The quantize–operate–dequantize of the Bitwise algorithm: `bits` from 16
    /// (Timbre 0) down to 2 (Timbre 100 %), exponentially.
    static int bitsFor(float t) noexcept { return std::clamp((int)std::lround(16.0f * std::pow(0.125f, t)), 2, 16); }
    static float bitwise(float a, float b, float t, int op) noexcept {
        const int bits = bitsFor(t);
        const int32_t half = 1 << (bits - 1);
        auto q = [&](float v) { return (int32_t)std::clamp(std::floor(std::clamp(v, -1.0f, 1.0f) * (float)half), (float)-half, (float)(half - 1)); };
        const int32_t x = q(a), y = q(b);
        int32_t r;
        switch (op) {
            case 1: r = x & y; break;
            case 2: r = x | y; break;
            case 3: {  // wrap-around addition in `bits` bits
                const int32_t span = 2 * half;
                r = ((x + y + half) % span + span) % span - half;
                break;
            }
            default: r = x ^ y; break;
        }
        return (float)r / (float)half;
    }

    // ---- for the view ----
    float bandLevel(int k) const noexcept { return level_[k]; }
    bool vocoderActive() const noexcept { return vocoderHold_ > 0; }

private:
    static constexpr float kBandQ = 4.0f;

    static float clean(float x) noexcept { return std::isfinite(x) ? x : 0.0f; }
    void ramp(float& g, float target) noexcept {
        if (g < 0.0f) g = target;
        else if (g < target) g = std::min(target, g + rampStep_);
        else if (g > target) g = std::max(target, g - rampStep_);
    }
    static float weight(int alg, int i, float frac) noexcept {
        return alg == i ? 1.0f - frac : alg == i + 1 ? frac : 0.0f;
    }

    /// Vocoder analysis: the modulator's 12 band envelopes, and the band
    /// frequencies of the synthesis side (× the formant shift).
    void analyse(float b, float t) noexcept {
        for (int k = 0; k < kBands; ++k) {
            float v = b;
            for (auto& s : analysis_[k]) v = s.process(v).bp / kBandQ;  // unity gain at the centre
            level_[k] = follow_[k].process(v);
        }
        unvoicedOut_ = 0.5f * unvoiced_.process(b).hp;
        // Formant shift: retune the synthesis bands (at most every 16 samples).
        if (retune_ > 0) {
            --retune_;
            return;
        }
        const float shift = std::exp2(2.0f * t - 1.0f);
        if (std::fabs(shift - shift_) > 1e-4f) {
            retune_ = 15;
            shift_ = shift;
            for (int k = 0; k < kBands; ++k) shiftedHz_[k] = std::min(bandHz_[k] * shift, (float)(0.45 * sampleRate_));
            for (auto& c : ch_) c.retune(*this);
        }
    }

    struct Channel {
        metamod::Upsampler up;
        metamod::Downsampler down;
        metamod::Delay linearDelay, dryDelay;
        dsp::fold::Stage fold;
        dsp::Svf synthesis[kBands][2];
        dsp::EnvelopeFollower carrierLevel[kBands];
        dsp::fold::DcBlocker dc;

        void reset() noexcept {
            up.reset(), down.reset(), linearDelay.reset(), dryDelay.reset(), fold.reset(), dc.reset();
            for (auto& band : synthesis)
                for (auto& s : band) s.reset();
            for (auto& e : carrierLevel) e.reset();
        }
        void prepare(double sampleRate) noexcept {
            dc.prepare(sampleRate);
            for (auto& e : carrierLevel) e.prepare(sampleRate, 0.002f, 0.04f);
        }
        void retune(const MetaModDsp& d) noexcept {
            for (int k = 0; k < kBands; ++k)
                for (auto& s : synthesis[k]) s.set(d.shiftedHz_[k], kBandQ, d.sampleRate_);
        }

        float process(MetaModDsp& d, const MetaModParams& p, float a, float b, const float* bUp, int i, float frac,
                      float t, float wXfade, float wVoc, bool vocoderOn, bool nonlinear, int f) noexcept {
            // Linear part at the base rate: crossfade and vocoder.
            float linear = 0.0f;
            if (wXfade > 0.0f) linear += wXfade * algorithm(Crossfade, a, b, t, 0);
            if (vocoderOn) {
                // Each carrier band is levelled by its own follower (the carrier's
                // spectrum doesn't matter, only where it has energy), then takes
                // the modulator's band envelope.
                float v = 0.0f;
                for (int k = 0; k < kBands; ++k) {
                    float y = a;
                    for (auto& s : synthesis[k]) y = s.process(y).bp / kBandQ;
                    v += y / (carrierLevel[k].process(y) + 0.01f) * d.level_[k];
                }
                linear += wVoc * metamod::limit(gain(Vocoder) * (v + d.unvoicedOut_));
            }
            // Nonlinear part, oversampled.
            float wet = 0.0f;
            if (nonlinear) {
                float aUp[4], buf[4];
                up.process(a, f, aUp);
                const bool foldOn = weight(Fold, i, frac) > 0.0f;
                for (int j = 0; j < f; ++j) {
                    float y = 0.0f;
                    for (int alg : {i, i + 1}) {
                        const float w = weight(alg, i, frac);
                        if (alg == Crossfade || alg == Vocoder || w <= 0.0f) continue;
                        y += w * gain(alg) * algorithm(alg, aUp[j], bUp[j], t, p.bitwiseOp, &fold);
                    }
                    buf[j] = y;
                }
                if (!foldOn) fold.reset();  // one sample of ADAA state: restarting is seamless
                wet = down.process(buf, f);
            }
            const double lat = metamod::latency(f);
            const float lin = linearDelay.process(linear, lat);
            const float dry = dryDelay.process(a, lat);
            const float mix = std::clamp(p.mix, 0.0f, 1.0f);
            // DC from the comparator, bitwise and ring imbalance goes; a knee above
            // ±2 keeps hot products (a ring of two ±4 signals) within ±4.
            return metamod::outputLimit(dc.process(dry + mix * (wet + lin - dry)));
        }
    };

    double sampleRate_ = 48000.0;
    float rampStep_ = 1.0f / 240.0f;
    int holdSamples_ = 2400;
    dsp::OscCore osc_;
    bool lastSync_ = false, stereo_ = false;
    dsp::EnvelopeFollower env_;
    float gCarrier_ = -1.0f, gModIn_ = -1.0f, gModOsc_ = -1.0f;
    int factor_ = 0, silent_ = 0, vocoderHold_ = 0, retune_ = 0;

    // Vocoder analysis (shared by both channels).
    float bandHz_[kBands] = {}, shiftedHz_[kBands] = {}, level_[kBands] = {};
    float shift_ = -1.0f, unvoicedOut_ = 0.0f;
    dsp::Svf analysis_[kBands][2];
    dsp::EnvelopeFollower follow_[kBands];
    dsp::Svf unvoiced_;

    metamod::Upsampler upB_;
    Channel ch_[2];
};

}  // namespace bleep::patch
