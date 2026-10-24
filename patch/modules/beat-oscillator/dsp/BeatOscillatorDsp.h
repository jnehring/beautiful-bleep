// SPDX-License-Identifier: GPL-3.0-only
// Beat Oscillator (doc/specs/modules/beat-oscillator.md): a heterodyne tone
// source. Two high carriers A and B are mixed and low-passed, and what is
// left is their difference. Pull couples the carriers (Adler injection
// locking: they lock, or beat in uneven blips near the edge), Drift lets them
// wander on seeded splines, Warm-up starts them flat and lets them glide in.
//
// Everything that sounds runs at 4 · fs: the phases (double precision,
// forward Euler of the coupled equations), the mixer, the 4-pole detector and
// the beat measurement; FM comes in through dsp::Upsampler and Out leaves
// through dsp::Downsampler. Drift knots are uniform01(seed, k, stream), and a
// transport start resets phases and filters, so renders repeat.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Oversampler.h"
#include "dsp/Partials.h"
#include "dsp/Random.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct BeatOscillatorParams {
    float carrierHz = 10000.0f;    ///< frequency of A
    float offsetHz = 261.6f;       ///< Range · x³ + Fine: B's offset from A before Pitch
    float pull = 0.0f;             ///< 0..1: lock range 200 · Pull³ Hz
    float detector = 0.0f;         ///< 0..1: cutoff 2500 · 24^Detector Hz
    float drift = 0.15f;           ///< 0..1: wander depth 25 · Drift² cents
    float detuneRangeHz = 20.0f;   ///< Hz added to B per 1.0 at the Detune input
    int mixer = 0;                 ///< 0 Ideal, 1 Diode, 2 Overdriven
    bool dcCoupled = false;
    float warmupSeconds = 0.0f;    ///< 0 = Off
    uint32_t seed = 1;
    int voice = -1;                ///< Voice Cell index (−1 outside): drift streams + 8 · voice
};

/// One sample of input.
struct BeatOscillatorInput {
    float pitch = 0.0f;   ///< 1 V/oct on both carriers
    float detune = 0.0f;  ///< × detuneRangeHz, added to B
    float fm = 0.0f;      ///< linear FM of B: 1.0 = 1 kHz
    bool fmPatched = true; ///< false: FM is silent and its upsampler rests
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    bool cold = false;     ///< the Cold button (restarts the warm-up while stopped)
    double ppq = 0.0;
};

struct BeatOscillatorFrame {
    float out = 0.0f, a = 0.0f, b = 0.0f, beat = 0.0f, lock = 0.0f;
};

class BeatOscillatorDsp {
public:
    static constexpr int kOver = 4;
    static constexpr double kTwoPi = 6.283185307179586;
    static constexpr double kC4 = 261.626;
    static constexpr double kMinBeatHz = 0.1;   ///< the Beat output's floor (−11.35)
    static constexpr double kDeclickSeconds = 0.005;

    enum Mixer { Ideal = 0, Diode, Overdriven };

    static double lockRangeHz(double pull) noexcept {
        const double p = std::clamp(pull, 0.0, 1.0);
        return 200.0 * p * p * p;
    }
    static double detectorHz(double detector) noexcept {
        return 2500.0 * std::pow(24.0, std::clamp(detector, 0.0, 1.0));
    }
    static double driftCents(double drift) noexcept {
        const double d = std::clamp(drift, 0.0, 1.0);
        return 25.0 * d * d;
    }
    /// Warm-up offset in cents at `t` seconds for a carrier with factor `c` (4.6).
    static double warmCents(double t, double tw, double c) noexcept {
        if (tw <= 0.0 || t > 12.0 * tw) return 0.0;  // e^−36: gone
        return -40.0 * c * std::exp(-3.0 * std::max(t, 0.0) / tw);
    }
    /// The Beat output for a measured beat frequency.
    static double beatPitch(double hz) noexcept { return std::log2(std::max(hz, kMinBeatHz) / kC4); }
    /// B's warm-up factor c_B = 0.7 + 0.6 · uniform01(Seed, 0, 5).
    static double warmFactorB(uint32_t seed, int voice) noexcept {
        return 0.7 + 0.6 * dsp::uniform01(seed, 0, streamFor(5, voice));
    }
    static uint64_t streamFor(uint64_t stream, int voice) noexcept {
        return stream + 8u * (uint64_t)std::max(voice, 0);
    }

    /// The Overdriven mixer's carrier shape tanh(4x) / tanh(4).
    static float overdrive(float x) noexcept {
        constexpr float norm = 1.00067115f;  // 1 / tanh(4)
        return std::tanh(4.0f * x) * norm;
    }

    BeatOscillatorDsp() noexcept { calibrate(); }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        dt_ = 1.0 / (kOver * sampleRate);
        dcBlock_.set(1.0 / (kTwoPi * 5.0), sampleRate);
        dfSmooth_.set(0.005, sampleRate);
        beatSlew_.set(0.005, sampleRate);
        freqLag_.set(0.05, sampleRate);
        reset();
    }

    /// Back to the load state: phases at 0, filters empty, warm-up from the start.
    void reset() noexcept {
        restart();
        stopBase_ = stopSeconds_ = uLast_ = 0.0;
        wasRunning_ = false;
        lastOut_ = 0.0f;
        declickLeft_ = 0;
        declickOffset_ = 0.0f;
        freqA_.prime = freqB_.prime = true;
        slips_ = 0;
        everTicked_ = false;
    }

    void tick(const BeatOscillatorParams& p, const BeatOscillatorInput& in, BeatOscillatorFrame& out) noexcept {
        bool started = false;
        if (in.started) {
            restart();
            started = everTicked_;
        }
        everTicked_ = true;
        if (in.cold && !in.running) warmT_ = 0.0;

        // Time base of the drift (4.6): ppq / 8 while playing, seconds / 4
        // while stopped (continuing from where playback left it).
        double u;
        if (in.running) {
            u = uLast_ = in.ppq / 8.0;
        } else {
            if (wasRunning_) stopBase_ = uLast_, stopSeconds_ = 0.0;
            u = stopBase_ + stopSeconds_ / 4.0;
            stopSeconds_ += 1.0 / sampleRate_;
        }
        wasRunning_ = in.running;

        // Carrier frequencies (4.1) at the end of this sample.
        const uint32_t seed = p.seed;
        const double depth = driftCents(p.drift);
        double dA = 0.0, dB = 0.0;
        if (depth > 0.0) {
            dA = depth * (slowA_.at(seed, streamFor(1, p.voice), u) + 0.25 * fastA_.at(seed, streamFor(2, p.voice), 8.0 * u));
            dB = depth * (slowB_.at(seed, streamFor(3, p.voice), u) + 0.25 * fastB_.at(seed, streamFor(4, p.voice), 8.0 * u));
        }
        if (p.warmupSeconds > 0.0f) {
            dA += warmCents(warmT_, p.warmupSeconds, 1.0);
            dB += warmCents(warmT_, p.warmupSeconds, warmFactorB(seed, p.voice));
        }
        warmT_ += 1.0 / sampleRate_;
        driftA_ = dA, driftB_ = dB;
        auto finite = [](float v) { return std::isfinite(v) ? (double)v : 0.0; };
        const double pv = std::clamp(finite(in.pitch), -10.0, 10.0);
        if (pv < lastPitch_ || pv > lastPitch_) lastPitch_ = pv, pitchMul_ = std::exp2(pv);
        const double pitch = pitchMul_;
        const double nyq = 0.45 * sampleRate_;
        const double mulA = dA != 0.0 ? std::exp2(dA / 1200.0) : 1.0, mulB = dB != 0.0 ? std::exp2(dB / 1200.0) : 1.0;
        const double fA = (double)p.carrierHz * pitch * mulA;
        const double fB = ((double)p.carrierHz + (double)p.offsetHz) * pitch * mulB +
                          std::clamp(finite(in.detune), -64.0, 64.0) * (double)p.detuneRangeHz;
        const double lockHz = lockRangeHz(p.pull);
        const double k = kTwoPi * lockHz;
        if (prime_) prevA_ = fA, prevB_ = fB, prevK_ = k;
        nominalA_ = std::clamp(fA, 20.0, nyq);
        nominalB_ = std::clamp(fB, 0.0, nyq);

        // Lock (4.2): the smoothed detuning without FM against the lock range.
        const double dfs = nominalB_ - nominalA_;
        if (prime_) dfSmooth_.z = dfs;
        const double df = dfSmooth_.process(dfs);
        lock_ = std::fabs(df) <= (lock_ ? 1.02 * lockHz : lockHz);

        const double fd = detectorHz(p.detector);
        if (fd < lastFd_ || fd > lastFd_) {
            det1_.set((float)fd, 0.70710678f, kOver * sampleRate_);
            det2_.set((float)fd, 0.70710678f, kOver * sampleRate_);
            lastFd_ = fd;
        }

        float fm[kOver] = {};
        if (in.fmPatched) {
            fmUp_.process((float)std::clamp(finite(in.fm), -64.0, 64.0), kOver, fm);
            fmResting_ = false;
        } else if (!fmResting_) {
            fmUp_.reset();
            fmResting_ = true;
        }
        float lp[kOver];
        double sumA = 0.0, sumB = 0.0;
        for (int s = 0; s < kOver; ++s) {
            const double t = (double)(s + 1) / kOver;
            const double fa = std::clamp(prevA_ + (fA - prevA_) * t, 20.0, nyq);
            const double fb = std::clamp(prevB_ + (fB - prevB_) * t + 1000.0 * (double)fm[s], 0.0, nyq);
            const double ks = prevK_ + (k - prevK_) * t;

            // The mixer sees the carriers as they are now.
            const float a = cosRad(phiA_), b = cosRad(phiA_ + psi_);
            if (s == 0) out.a = a, out.b = b;
            lp[s] = det2_.process(det1_.process(mix(p.mixer, a, b)).lp).lp;

            // dφA/dt = ωA + (K/2) sin ψ, dψ/dt = Δω − K sin ψ (4.2).
            const double pull = ks > 0.0 ? ks * (double)sinRad(psi_) : 0.0;
            const double stepA = (kTwoPi * fa + 0.5 * pull) * dt_;
            const double stepPsi = (kTwoPi * (fb - fa) - pull) * dt_;
            phiA_ += stepA;
            if (phiA_ >= kTwoPi) phiA_ -= kTwoPi;
            psi_ += stepPsi;
            sumA += stepA;
            sumB += stepA + stepPsi;
            measure(stepPsi);
        }
        prevA_ = fA, prevB_ = fB, prevK_ = k;

        // Detector output, coupling (4.4), declick after a transport start.
        double x = (double)down_.process(lp, kOver);
        if (!p.dcCoupled) {
            if (prime_) dcBlock_.z = x;
            x -= dcBlock_.process(x);
        }
        if (!std::isfinite(x)) {
            restart();
            x = 0.0;
        }
        if (started) {
            declickOffset_ = lastOut_ - (float)x;
            declickLeft_ = declickLength();
        }
        float y = (float)x;
        if (declickLeft_ > 0) y += declickOffset_ * (float)declickLeft_-- / (float)declickLength();
        lastOut_ = y;
        out.out = dsp::softClip(y);

        // Beat measurement (4.5), slewed.
        if (fm_ != lastFm_) lastFm_ = fm_, beatPitch_ = beatPitch(fm_);
        if (prime_) beatSlew_.z = beatPitch_;
        out.beat = (float)beatSlew_.process(beatPitch_);
        out.lock = lock_ ? 1.0f : 0.0f;

        // Actual carrier frequencies for the view: the phase advance, smoothed.
        freqA_.process(freqLag_, sumA * sampleRate_ / kTwoPi);
        freqB_.process(freqLag_, sumB * sampleRate_ / kTwoPi);
        deltaSmooth_ = df;
        prime_ = false;
    }

    // ---- state for tests and the view ----
    double psi() const noexcept { return psi_; }                ///< ψ relative to the last slip, −2π..2π
    double measuredBeatHz() const noexcept { return fm_; }
    uint32_t slips() const noexcept { return slips_; }
    bool locked() const noexcept { return lock_; }
    double nominalA() const noexcept { return nominalA_; }      ///< fA after drift and warm-up
    double nominalB() const noexcept { return nominalB_; }      ///< fB without FM
    double detuneHz() const noexcept { return deltaSmooth_; }   ///< Δf_s (signed, smoothed)
    double actualA() const noexcept { return freqA_.z; }        ///< after pulling, ~50 ms average
    double actualB() const noexcept { return freqB_.z; }
    double driftA() const noexcept { return driftA_; }          ///< d_A in cents (drift + warm-up)
    double driftB() const noexcept { return driftB_; }

private:
    /// A one-pole low-pass (dsp::OnePole's response, 63 % rise in `seconds`)
    /// with the coefficient computed once, in double.
    struct Lag {
        double a = 0.0, z = 0.0;
        void set(double seconds, double sampleRate) noexcept { a = std::exp(-1.0 / (seconds * sampleRate)); }
        double process(double x) noexcept { return z = x + a * (z - x); }
    };
    /// A Lag state that starts at its first input.
    struct Follower {
        double z = 0.0;
        bool prime = true;
        void process(const Lag& lag, double x) noexcept {
            z = prime ? x : x + lag.a * (z - x);
            prime = false;
        }
    };

    /// dsp::smoothNoise with the four knots cached (they change once per knot).
    class Spline {
    public:
        double at(uint32_t seed, uint64_t stream, double t) noexcept {
            const double fl = std::floor(t);
            const int64_t i = (int64_t)fl;
            if (i != index_ || seed != seed_ || stream != stream_ || !valid_) {
                for (int k = 0; k < 4; ++k) y_[k] = dsp::noisePoint(seed, i - 1 + k, stream);
                index_ = i, seed_ = seed, stream_ = stream, valid_ = true;
            }
            return std::clamp(dsp::catmullRom(y_[0], y_[1], y_[2], y_[3], t - fl), -1.0, 1.0);
        }

    private:
        double y_[4] = {};
        int64_t index_ = 0;
        uint32_t seed_ = 0;
        uint64_t stream_ = 0;
        bool valid_ = false;
    };

    /// Transport start (4.7): phases at 0, beat measurement, filters and warm-up restart.
    void restart() noexcept {
        phiA_ = psi_ = 0.0;
        sinceSlip_ = 0.0;
        lastPeriod_ = 0.0;
        fm_ = 0.0;
        fmUp_.reset();
        down_.reset();
        det1_.reset();
        det2_.reset();
        warmT_ = 0.0;
        lock_ = false;
        prime_ = true;
    }

    /// sin and cos of an angle in radians (−4π…4π here) through the shared
    /// polynomial sine (|error| < 1e-6, about −120 dB).
    static float sinRad(double x) noexcept {
        const double t = x * (1.0 / kTwoPi);
        return dsp::partials::sin2pi((float)(t - std::floor(t)));
    }
    static float cosRad(double x) noexcept {
        const double t = x * (1.0 / kTwoPi) + 0.25;
        return dsp::partials::sin2pi((float)(t - std::floor(t)));
    }

    int declickLength() const noexcept { return std::max(1, (int)(kDeclickSeconds * sampleRate_)); }

    float mix(int mode, float a, float b) const noexcept {
        switch (mode) {
            case Diode: {
                const float v = std::max(0.0f, 0.5f * (a + b) + 0.2f);
                return diodeGain_ * v * v - diodeOffset_;
            }
            case Overdriven: {
                const float a2 = overdrive(a), b2 = overdrive(b);
                return overdriveGain_ * (a2 * b2 + 0.1f * (a2 + b2));
            }
            default: return 2.0f * a * b;
        }
    }

    /// One 4× step of the slip counter: a slip is ψ reaching another multiple
    /// of 2π; the crossing time is interpolated inside the sub-sample.
    void measure(double stepPsi) noexcept {
        sinceSlip_ += 1.0;
        if (psi_ >= kTwoPi || psi_ <= -kTwoPi) {
            const double sign = psi_ > 0.0 ? 1.0 : -1.0;
            psi_ -= sign * kTwoPi;
            const double past = std::clamp(std::fabs(psi_) / std::max(std::fabs(stepPsi), 1e-30), 0.0, 1.0);
            const double period = std::max(sinceSlip_ - past, 1e-3);
            fm_ = 1.0 / (period * dt_);
            lastPeriod_ = period;
            sinceSlip_ = past;
            ++slips_;
        } else if (lastPeriod_ > 0.0 && sinceSlip_ > lastPeriod_) {
            fm_ = 1.0 / (sinceSlip_ * dt_);  // falls towards 0 as the pair locks
        }
    }

    /// Mixer scales so a free-running beat peaks near ±1 at Out (4.3).
    void calibrate() noexcept {
        // Diode: s = 0.5 (a + b) = E cos θ with E = cos(ψ/2); the detector
        // keeps F(|E|) = mean over θ of max(0, E cos θ + c)². F(0) = c²; for
        // E > c the cut starts at α = acos(−c / E).
        constexpr double c = 0.2, pi = 3.14159265358979323846;
        auto f = [&](double e) {
            if (e <= c) return 0.5 * e * e + c * c;
            const double al = std::acos(-c / e);
            return (e * e * (0.5 * al + 0.25 * std::sin(2.0 * al)) + 2.0 * e * c * std::sin(al) + c * c * al) / pi;
        };
        const double lo = f(0.0), hi = f(1.0);
        diodeGain_ = (float)(2.0 / (hi - lo));
        diodeOffset_ = (float)(0.5 * (hi + lo) * 2.0 / (hi - lo));
        // Overdriven: the beat is the correlation of two shaped carriers,
        // largest (mean of a′²) at ψ = 0.
        double r = 0.0;
        constexpr int n = 4096;
        for (int i = 0; i < n; ++i) {
            const double v = (double)overdrive((float)std::cos(2.0 * pi * (i + 0.5) / n));
            r += v * v;
        }
        overdriveGain_ = (float)(n / r);
    }

    double sampleRate_ = 48000.0, dt_ = 1.0 / (kOver * 48000.0);
    double phiA_ = 0.0, psi_ = 0.0;
    double prevA_ = 0.0, prevB_ = 0.0, prevK_ = 0.0;
    bool prime_ = true, everTicked_ = false, lock_ = false, wasRunning_ = false;
    double nominalA_ = 0.0, nominalB_ = 0.0, deltaSmooth_ = 0.0, driftA_ = 0.0, driftB_ = 0.0;
    Follower freqA_, freqB_;
    double lastPitch_ = 0.0, pitchMul_ = 1.0, lastFm_ = -1.0, beatPitch_ = 0.0;
    bool fmResting_ = false;
    // beat measurement, in 4× samples
    double sinceSlip_ = 0.0, lastPeriod_ = 0.0, fm_ = 0.0;
    uint32_t slips_ = 0;
    // drift and warm-up
    Spline slowA_, fastA_, slowB_, fastB_;
    double stopBase_ = 0.0, stopSeconds_ = 0.0, uLast_ = 0.0, warmT_ = 0.0;
    // signal path
    dsp::Upsampler fmUp_;
    dsp::Downsampler down_;
    dsp::Svf det1_, det2_;
    double lastFd_ = -1.0;
    Lag dcBlock_, dfSmooth_, beatSlew_, freqLag_;
    float diodeGain_ = 1.0f, diodeOffset_ = 0.0f, overdriveGain_ = 1.0f;
    float lastOut_ = 0.0f, declickOffset_ = 0.0f;
    int declickLeft_ = 0;
};

}  // namespace bleep::patch
