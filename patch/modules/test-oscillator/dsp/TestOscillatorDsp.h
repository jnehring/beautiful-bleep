// SPDX-License-Identifier: GPL-3.0-only
// Test Oscillator (doc/specs/modules/test-oscillator.md): a lamp-stabilised
// bridge oscillator. A band-pass resonator (zero-delay-feedback SVF, Q0 = 5)
// and a soft-clipping amplifier form a closed loop that is solved implicitly each
// sample, so the small-signal frequency is exactly the cutoff. A lamp (a
// one-pole "heat" of the loop signal) pulls the gain down above the nominal
// amplitude: the oscillation regulates itself, bounces after every
// disturbance and, below 100 % loop gain, becomes a ringing resonator.
//
// Everything runs 4× oversampled (2× at 88.2/96 kHz, 1× from 176.4 kHz).
// Noise, wander and hum are seeded and counted from power-up, so two renders
// from the same power-up are bit-identical.
#pragma once

#include "dsp/Noise.h"
#include "dsp/Oversampler.h"
#include "dsp/Random.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct TestOscillatorParams {
    float frequency = 4.4f;  ///< the dial, 1..10
    float fineCents = 0.0f;  ///< ±50
    float fm = 0.0f;         ///< 0..1 linear FM depth
    float loopGain = 1.2f;   ///< 0..3
    float settle = 0.25f;    ///< lamp time constant, seconds
    float drift = 0.4f;      ///< 0..1: warm-up, wander and hum
    float kick = 0.5f;       ///< 0..1
    float level = 1.0f;
    int range = 2;           ///< 0..3: ×1, ×10, ×100, ×1k
    bool warmUp = true;
    int mains = 1;           ///< 0 Off, 1 50 Hz, 2 60 Hz
};

/// One sample of input.
struct TestOscillatorInput {
    float pitch = 0.0f;  ///< octaves
    float fm = 0.0f;
    float kick = 0.0f;   ///< trigger
    float audio = 0.0f;
    bool audioPatched = false;
};

struct TestOscillatorFrame {
    float sine = 0.0f, square = 0.0f, sync = 0.0f, lamp = 0.0f;
};

class TestOscillatorDsp {
public:
    static constexpr double kQ0 = 5.0;
    static constexpr double kK0 = 1.0 / kQ0;
    static constexpr double kA0 = 0.5;             ///< nominal amplitude of y
    static constexpr double kKnee = 0.6;           ///< the amplifier is linear up to here
    static constexpr double kNoise = 1e-4;         ///< noise floor (4.5)
    static constexpr double kSwitchSeconds = 0.004;  ///< loop open on a Range change
    static constexpr double kDialSeconds = 0.02;
    static constexpr double kSweepSeconds = 0.01;
    static constexpr double kEdgeSeconds = 20e-6;  ///< Square edges
    static constexpr double kPi = 3.14159265358979323846;
    static constexpr int kMaxFactor = 4;
    static constexpr int kSyncDelaySize = 64;
    static constexpr int64_t kDriftBlock = 16;

    /// Oversampling factor for a base rate (4.0).
    static int factorFor(double sampleRate) noexcept { return sampleRate < 80000.0 ? 4 : sampleRate < 160000.0 ? 2 : 1; }
    /// The dial frequency before Pitch, drift and FM (4.2).
    static double dialHz(double frequency, double fineCents, int range) noexcept {
        return 2.0 * std::pow(10.0, (double)std::clamp(range, 0, 3)) * std::clamp(frequency, 1.0, 10.0) *
               std::exp2(fineCents / 1200.0);
    }
    /// The amplifier: linear up to ±kKnee, then a tanh knee into ±1 (the shape
    /// of dsp::softClip, in double and with its slope for the Newton solve).
    static double amplifier(double x, double& slope) noexcept {
        const double a = std::fabs(x);
        if (a <= kKnee) {
            slope = 1.0;
            return x;
        }
        const double t = std::tanh((a - kKnee) / (1.0 - kKnee));
        slope = 1.0 - t * t;
        return std::copysign(kKnee + (1.0 - kKnee) * t, x);
    }
    /// The lamp's gain factor for a heat h (4.3).
    static double agc(double h) noexcept {
        const double x = h / (kA0 * kA0);
        return x <= 1.0 ? 1.0 : std::max(1.0 / 1.5, 1.0 / (1.0 + 8.0 * (x - 1.0)));
    }
    /// Value noise: 2·uniform01(key, ⌊x⌋, stream) − 1 at the knots, smoothstep between (4.5).
    static double valueNoise(uint64_t key, double x, uint64_t stream) noexcept {
        const double fl = std::floor(x);
        const int64_t i = (int64_t)fl;
        const double a = 2.0 * dsp::uniform01(key, (uint64_t)i, stream) - 1.0;
        const double b = 2.0 * dsp::uniform01(key, (uint64_t)(i + 1), stream) - 1.0;
        return a + (b - a) * dsp::smoothstep01(x - fl);
    }
    /// Drift in cents at `seconds` since power-up (warm-up and wander, 4.5).
    static double driftAt(double drift, bool warmUp, double seconds, uint64_t key, uint64_t streamOffset) noexcept {
        if (drift <= 0.0) return 0.0;
        const double warm = warmUp ? -100.0 * drift * std::exp(-seconds / 10.0) : 0.0;
        const double wander = 15.0 * drift * (0.7 * valueNoise(key, 0.11 * seconds, 11 + streamOffset) +
                                              0.3 * valueNoise(key, 0.6 * seconds, 12 + streamOffset));
        return warm + wander;
    }

    void prepare(double sampleRate) noexcept {
        fb_ = sampleRate;
        factor_ = factorFor(sampleRate);
        fs_ = fb_ * factor_;
        dialA_ = std::exp(-1.0 / (kDialSeconds * fb_));
        sweepA_ = std::exp(-1.0 / (kSweepSeconds * fb_));
        maxStep_ = 2.0 / (kEdgeSeconds * fs_);
        switchSamples_ = (int)std::lround(kSwitchSeconds * fs_);
        syncDelay_ = std::clamp((int)std::lround(dsp::oversamplerLatency(factor_) * 0.5), 0, kSyncDelaySize - 1);
        settleFor_ = -1.0;
        powerUp();
    }

    /// Seed and voice for noise and wander; applied at the next power-up
    /// (wander follows at once, it is a function of time).
    void setSeed(uint32_t seed, int voice) noexcept {
        key_ = dsp::hash3(seed, (uint64_t)(voice + 1), 0x7e57);
        streamOffset_ = voice >= 0 ? 100u * (uint64_t)(voice + 1) : 0u;
    }

    /// Power-up (4.7): resonator and heat cleared, noise reseeded, t = 0.
    void powerUp() noexcept {
        ic1_ = ic2_ = y_ = h_ = 0.0;
        noise_ = dsp::WhiteNoise((uint32_t)dsp::hash3(key_, 1, 0x5eed) | 1u);
        t_ = 0;
        up_.reset();
        downSine_.reset();
        downSquare_.reset();
        audioWasPatched_ = false;
        squareState_ = 0.0;
        armed_ = false;
        syncRing_.fill(0.0f);
        syncPos_ = 0;
        switchLeft_ = 0;
        sweep_ = 0.0;
        snap_ = true;
        kickEdge_.reset();
        freqHz_ = 0.0;
        gain_ = 0.0;
        drift_ = driftStep_ = 0.0;
        gFor_ = -1.0;
    }

    void tick(const TestOscillatorParams& p, const TestOscillatorInput& in, TestOscillatorFrame& out) noexcept {
        const int range = std::clamp(p.range, 0, 3);
        if (snap_) range_ = range;
        else if (range != range_) {  // the switch breaks contact (4.2)
            range_ = range;
            switchLeft_ = switchSamples_;
        }
        const double settle = std::clamp((double)p.settle, 0.001, 10.0);
        if (settle != settleFor_) {
            settleFor_ = settle;
            heatA_ = std::exp(-1.0 / (settle * fs_));
        }

        // Frequency (4.2): the dial smoothed in octaves, Pitch and drift not.
        if (p.frequency != dialFor_) {
            dialFor_ = p.frequency;
            dialLog_ = std::log2(std::clamp((double)p.frequency, 1.0, 10.0));
        }
        const double dialTarget = dialLog_ + (double)p.fineCents / 1200.0;
        if (snap_) dialOct_ = dialTarget;
        else dialOct_ = dialTarget + dialA_ * (dialOct_ - dialTarget);
        // Drift is slow: computed every kDriftBlock samples, ramped between.
        const double drift = std::clamp((double)p.drift, 0.0, 1.0);
        if (snap_) drift_ = driftAt(drift, p.warmUp, 0.0, key_, streamOffset_);
        if (t_ % kDriftBlock == 0) {
            const double next = driftAt(drift, p.warmUp, (double)(t_ + kDriftBlock) / fb_, key_, streamOffset_);
            driftStep_ = (next - drift_) / (double)kDriftBlock;
        }
        drift_ += driftStep_;
        const double pitch = std::isfinite(in.pitch) ? std::clamp((double)in.pitch, -10.0, 10.0) : 0.0;
        const double oct = dialOct_ + pitch + drift_ / 1200.0;

        // Sweep loss (4.3): the rate of change of log2 f without FM.
        if (snap_) lastOct_ = oct;
        const double rate = std::fabs(oct - lastOct_) * fb_;
        lastOct_ = oct;
        sweep_ = rate + sweepA_ * (sweep_ - rate);
        const double sweepLoss = 1.0 - 0.015 * std::min(sweep_, 20.0);

        static constexpr double kRangeHz[4] = {2.0, 20.0, 200.0, 2000.0};
        const double base = kRangeHz[range_];
        const double fmIn = std::isfinite(in.fm) ? std::clamp((double)in.fm, -16.0, 16.0) : 0.0;
        const double noFm = base * std::exp2(oct);
        double f = noFm * (1.0 + std::clamp((double)p.fm, 0.0, 1.0) * fmIn);
        f = std::clamp(f, 1.0, 0.45 * fb_);
        freqHz_ = std::clamp(noFm, 1.0, 0.45 * fb_);
        if (f != gFor_) {
            gFor_ = f;
            gNext_ = std::tan(kPi * f / fs_);
        }
        const double g1 = gNext_;
        if (snap_) g_ = g1;
        const double g0 = g_;
        g_ = g1;

        // Mains hum (4.5): exact phase from the sample count.
        double hum = 0.0;
        if (p.mains > 0 && drift > 0.0) {
            const double hz = p.mains == 2 ? 60.0 : 50.0;
            const double s = std::sin(2.0 * kPi * std::fmod(hz * (double)t_, fb_) / fb_);
            hum = s + 0.4 * (3.0 * s - 4.0 * s * s * s);  // sin φ + 0.4 sin 3φ
        }
        const double e0 = 0.002 * drift * hum;

        // Audio In, upsampled (4.4).
        float audio[kMaxFactor] = {};
        if (in.audioPatched) {
            const float a = std::isfinite(in.audio) ? std::clamp(in.audio, -16.0f, 16.0f) : 0.0f;
            up_.process(0.25f * a, factor_, audio);
            audioWasPatched_ = true;
        } else if (audioWasPatched_) {
            up_.reset();
            audioWasPatched_ = false;
        }

        // Kick (4.4): a step into the band-pass state, first peak 2·Kick·A0.
        if (kickEdge_.process(in.kick) > 0) {
            const double amp = 2.0 * std::clamp((double)p.kick, 0.0, 1.0) * kA0;
            ic1_ += amp / kK0 * std::sqrt(1.0 + g0 * g0);
        }

        const double loopGain = std::clamp((double)p.loopGain, 0.0, 3.0);
        float sine[kMaxFactor], square[kMaxFactor];
        bool fired = false;
        const bool steady = g0 == g1;  // coefficients fixed for the whole sample
        double a1 = 0.0, a2 = 0.0, a3 = 0.0;
        for (int j = 0; j < factor_; ++j) {
            if (!steady || j == 0) {
                const double g = steady ? g1 : g0 + (g1 - g0) * (double)(j + 1) / (double)factor_;
                a1 = 1.0 / (1.0 + g * (g + kK0)), a2 = g * a1, a3 = g * a2;
            }
            const double e = (double)audio[j] + kNoise * (double)noise_.next() + e0;
            double G = 0.0;
            if (switchLeft_ > 0) --switchLeft_;
            else G = loopGain * agc(h_) * sweepLoss;
            gain_ = G;

            // y = k0·(α + β·(amp(G·y) + e)) (4.1). Inside the amplifier's linear
            // range the solution is exact; past the knee, two Newton steps from
            // the last y.
            const double A = kK0 * (a1 * ic1_ - a2 * ic2_ + a2 * e), B = kK0 * a2;
            double y = A / (1.0 - B * G), slope = 1.0;
            if (std::fabs(G * y) > kKnee) {
                y = y_;
                for (int k = 0; k < 2; ++k) {
                    const double v = amplifier(G * y, slope);
                    y -= (y - A - B * v) / (1.0 - B * G * slope);
                }
            }
            const double amp = amplifier(G * y, slope);
            const double v3 = amp + e - ic2_;
            const double v1 = a1 * ic1_ + a2 * v3;
            const double v2 = ic2_ + a2 * ic1_ + a3 * v3;
            ic1_ = 2.0 * v1 - ic1_;
            ic2_ = 2.0 * v2 - ic2_;
            y_ = kK0 * v1;

            // Heat: a one-pole of 2y² with time constant Settle (4.3).
            const double y2 = 2.0 * y_ * y_;
            h_ = y2 + heatA_ * (h_ - y2);

            // Square: a comparator scaled by the amplitude, slewed (4.6).
            const double rms = std::sqrt(h_);
            const double q = std::clamp(30.0 * y_ / std::max(rms, 1e-4), -1.0, 1.0);
            squareState_ += std::clamp(q - squareState_, -maxStep_, maxStep_);
            sine[j] = (float)amp;
            square[j] = (float)squareState_;

            // Sync: upward zero crossings, re-armed below −0.1·√h.
            if (y_ < -0.1 * rms) armed_ = true;
            else if (armed_ && y_ >= 0.0) {
                armed_ = false;
                fired = fired || rms > 1e-3;
            }
        }
        if (!std::isfinite(ic1_) || !std::isfinite(ic2_) || !std::isfinite(h_) || !std::isfinite(y_)) {
            ic1_ = ic2_ = y_ = h_ = 0.0;
            squareState_ = 0.0;
        }

        // Decimation; Square fades out between −60 and −72 dB of √h.
        const double level = std::clamp((double)p.level, 0.0, 1.0);
        const double s = downSine_.process(sine, factor_);
        double sq = downSquare_.process(square, factor_);
        if (h_ < 1e-6) sq *= h_ <= 6.3095734448e-8 ? 0.0 : std::clamp((10.0 * std::log10(h_) + 72.0) / 12.0, 0.0, 1.0);
        out.sine = (float)((s + 0.001 * drift * hum) * level);
        out.square = (float)(sq * level);
        out.lamp = (float)std::min(h_ / (2.0 * kA0 * kA0), 1.0);
        // Sync is delayed by the decimator's latency, so it meets Sine's crossing.
        syncRing_[(size_t)syncPos_] = fired ? 1.0f : 0.0f;
        out.sync = syncRing_[(size_t)((syncPos_ + kSyncDelaySize - syncDelay_) % kSyncDelaySize)];
        syncPos_ = (syncPos_ + 1) % kSyncDelaySize;

        ++t_;
        snap_ = false;
    }

    double y() const noexcept { return y_; }
    double heat() const noexcept { return h_; }
    /// Frequency in Hz with Pitch and drift, without FM (the readout).
    double frequency() const noexcept { return freqHz_; }
    double driftCents() const noexcept { return drift_; }
    double gain() const noexcept { return gain_; }
    int factor() const noexcept { return factor_; }
    int64_t samplesSincePowerUp() const noexcept { return t_; }

private:
    double fb_ = 48000.0, fs_ = 192000.0;
    int factor_ = 4;
    double dialA_ = 0.0, sweepA_ = 0.0, heatA_ = 0.0, settleFor_ = -1.0, maxStep_ = 1.0;
    int switchSamples_ = 0, switchLeft_ = 0, syncDelay_ = 0;
    uint64_t key_ = dsp::hash3(1, 0, 0x7e57), streamOffset_ = 0;

    double ic1_ = 0.0, ic2_ = 0.0, y_ = 0.0, h_ = 0.0, g_ = 0.0;
    double dialOct_ = 0.0, lastOct_ = 0.0, sweep_ = 0.0;
    double squareState_ = 0.0;
    double freqHz_ = 0.0, gain_ = 0.0, drift_ = 0.0, driftStep_ = 0.0;
    double gFor_ = -1.0, gNext_ = 0.0, dialLog_ = 0.0;
    float dialFor_ = -1.0f;
    int range_ = 2;
    int64_t t_ = 0;
    bool snap_ = true, armed_ = false, audioWasPatched_ = false;
    dsp::WhiteNoise noise_{1u};
    dsp::GateEdge kickEdge_;
    dsp::Upsampler up_;
    dsp::Downsampler downSine_, downSquare_;
    std::array<float, kSyncDelaySize> syncRing_{};
    int syncPos_ = 0;
};

}  // namespace bleep::patch
