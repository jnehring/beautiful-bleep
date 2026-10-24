// SPDX-License-Identifier: GPL-3.0-only
// Wave Analyzer (doc/specs/modules/wave-analyzer.md): a very narrow, tunable
// band-pass after the heterodyne wave analyzers of the measurement lab.
//
//   In ─► DC block (5 Hz) ─► Hilbert ─► a = x + j·H(x)
//   a · e^(−jφ) ─► 4-pole Butterworth low-pass at B/2 (on I and Q) ─► Z = I + jQ
//   Band = Re(Z · e^(+jφ))        Shifted = Re(Z · e^(+jψ))
//
// The local oscillator φ (cycles, double) runs at the tuned frequency f, which
// comes from the dial (Manual), a ramp (Sweep) or a hunt-and-lock loop (Lock),
// times 2^(pitch + drift). |Z| drives a moving-coil needle (Level, Peak).
// Drift is a seeded Hermite curve of song time; everything resets on a
// transport start, so a render from the same position is identical.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Hilbert.h"
#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Svf.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum WaveAnalyzerMode { WaManual = 0, WaSweep, WaLock };
enum WaveAnalyzerDir { WaUp = 0, WaDown, WaUpDown };

/// Floor choices in dB (the Floor setting's index).
inline constexpr std::array<double, 6> kWaveAnalyzerFloors = {-24.0, -36.0, -48.0, -60.0, -72.0, -96.0};
inline constexpr int kWaveAnalyzerDefaultFloor = 3;
/// Bandwidth choices in Hz; index 4 is 1/3 octave (proportional).
inline constexpr std::array<double, 4> kWaveAnalyzerBandwidths = {3.0, 10.0, 30.0, 100.0};
inline constexpr int kWaveAnalyzerThirdOctave = 4;

struct WaveAnalyzerParams {
    double freqNorm = 0.4475;  ///< the Frequency knob, normalised 0..1 (mapped by Range)
    int range = 0;             ///< 0 Full, 1 20–200 Hz, 2 200 Hz–2 kHz, 3 2–20 kHz
    float span = 4.0f;         ///< octaves above Frequency (Sweep)
    float sweepTime = 8.0f;    ///< seconds per sweep when free
    float capture = 7.0f;      ///< semitones ± around Frequency (Lock)
    float drift = 0.15f;       ///< 0..1
    float listen = 800.0f;     ///< Hz, the Shifted pitch
    float threshold = 0.6f;    ///< Peak threshold on the Level scale
    float gainDb = 12.0f;      ///< on Band and Shifted
    int mode = WaManual;
    int bandwidth = 1;         ///< index: 3, 10, 30, 100 Hz, 1/3 octave
    int sweepDir = WaUp;
    int sync = 0;              ///< WaveAnalyzerDsp::syncNames() index, 0 = Free
    int floor = kWaveAnalyzerDefaultFloor;
    bool needle = true;        ///< Ballistics: Needle or Fast
    uint32_t seed = 1;
    int voice = -1;            ///< Voice Cell voice (drift stream 1 + voice)
};

/// One sample of input.
struct WaveAnalyzerInput {
    float in = 0.0f;
    float pitch = 0.0f;           ///< octaves
    float reset = 0.0f;           ///< trigger
    float hold = 0.0f;            ///< gate
    bool running = false;         ///< transport playing with a valid position
    bool started = false;         ///< first sample after the transport started
    double ppq = 0.0;
    double bpm = 120.0;
    double songSeconds = 0.0;     ///< transport position in seconds (while running)
    bool wantShifted = true;      ///< false: skip the beat-frequency oscillator
};

struct WaveAnalyzerFrame {
    float band = 0.0f, shifted = 0.0f;
    float level = 0.0f, track = 0.0f, peak = 0.0f, locked = 0.0f;
};

class WaveAnalyzerDsp {
public:
    static constexpr double kTwoPi = 6.283185307179586476925;
    static constexpr double kC4 = 261.626;
    static constexpr double kMinHz = 10.0;
    static constexpr double kDriftKnotSeconds = 6.0;
    static constexpr double kNeedleHz = 2.1, kNeedleDamping = 0.8;
    /// Butterworth Qs of the two cascaded sections (4th order).
    static constexpr double kQ1 = 0.5412, kQ2 = 1.3066;
    /// DC group delay of that low-pass, in units of 1/B seconds:
    /// (1/Q1 + 1/Q2) / (2π · B/2) = 0.832 / B.
    static constexpr double kLagPerB = (1.0 / kQ1 + 1.0 / kQ2) / 3.14159265358979323846;
    /// The lock loop: ωn = 2π·B/16, damping 1, FLL aid kf = ωn. (B/8 with
    /// damping 0.707, as first designed, leaves about 5° of phase margin
    /// against the low-pass lag: it slips cycles and rings for seconds.)
    static constexpr double kLoopDivisor = 16.0, kLoopDamping = 1.0, kFllGain = 1.0;

    enum class LockState { Off, Hunt, Lock };

    /// Sync choices: dsp::syncNames() and 16, 32, 64 bars.
    static const std::array<const char*, 13>& syncNames() {
        static const std::array<const char*, 13> names = [] {
            std::array<const char*, 13> a{};
            for (size_t i = 0; i < 10; ++i) a[i] = dsp::syncNames()[i];
            a[10] = "16 bars";
            a[11] = "32 bars";
            a[12] = "64 bars";
            return a;
        }();
        return names;
    }
    static double syncBeats(int index) noexcept {
        if (index >= 10 && index <= 12) return 64.0 * (double)(1 << (index - 10));
        return dsp::syncBeats(index);
    }

    /// The dial: Full range 20 Hz–20 kHz, or one decade, exponential.
    static double dialHz(double norm, int range) noexcept {
        const double n = std::clamp(norm, 0.0, 1.0);
        if (range >= 1 && range <= 3) return 20.0 * std::pow(10.0, (double)(range - 1)) * std::pow(10.0, n);
        return 20.0 * std::pow(1000.0, n);
    }
    /// The bandwidth B at the tuned frequency f.
    static double bandwidthHz(int index, double f) noexcept {
        if (index >= 0 && index < (int)kWaveAnalyzerBandwidths.size()) return kWaveAnalyzerBandwidths[(size_t)index];
        return f * (std::exp2(1.0 / 6.0) - std::exp2(-1.0 / 6.0));  // 1/3 octave ≈ 0.2316·f
    }
    static double floorDb(int index) noexcept {
        return kWaveAnalyzerFloors[(size_t)std::clamp(index, 0, (int)kWaveAnalyzerFloors.size() - 1)];
    }
    /// |Z| → 0..1 on the dB scale from Floor (0) to 0 dBFS (1).
    static double levelMap(double magnitude, double floor) noexcept {
        const double db = 20.0 * std::log10(std::max(magnitude, 1e-6));
        return std::clamp((db - floor) / -floor, 0.0, 1.0);
    }
    /// The oscillator drift in octaves (±0.02·drift): a Catmull-Rom (cubic
    /// Hermite) curve through seeded knots 6 s apart.
    static double driftOctaves(double drift, uint32_t seed, uint64_t stream, double seconds) noexcept {
        if (drift <= 0.0) return 0.0;
        return std::clamp(drift, 0.0, 1.0) * 0.02 * dsp::smoothNoise(seed, stream, seconds / kDriftKnotSeconds);
    }
    /// One step of the local oscillator's phase (cycles, wrapped to [0, 1)).
    static double advance(double phase, double increment) noexcept {
        phase += increment;
        return phase - std::floor(phase);
    }

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        hilbert_.prepare(sampleRate, 15.0);
        dcR_ = 1.0 - kTwoPi * 5.0 / sampleRate;
        needle_.set(kNeedleHz, 1.0 / (2.0 * kNeedleDamping), sampleRate);  // k = 1/Q = 2ζ
        reset();
    }

    void reset() noexcept {
        restart();
        r_ = 0.0;
        freeSamples_ = 0;
        driftCount_ = 0;
        driftOct_ = 0.0;
        bwIndex_ = -1;
        bw_ = 10.0;
        gain_ = -1.0;
        lastMode_ = -1;
        pass_ = 0;
        tooFast_ = false;
        resetEdge_.reset();
    }

    void tick(const WaveAnalyzerParams& p, const WaveAnalyzerInput& in, WaveAnalyzerFrame& out) noexcept {
        if (in.started) {
            restart();
            r_ = 0.0;
            ++pass_;
        }
        const bool hold = in.hold >= 0.5f;
        const bool reset = resetEdge_.process(in.reset) > 0;
        const int mode = std::clamp(p.mode, 0, 2);
        const double dial = dialHz(p.freqNorm, p.range);
        window(p, dial);
        if (mode != lastMode_) {
            if (mode == WaLock) startHunt();
            else lock_ = LockState::Off;
            if (mode == WaSweep || lastMode_ == WaSweep) ++pass_;
            lastMode_ = mode;
        }

        // Drift (4.7): song time while playing, a free counter otherwise.
        // Recomputed every 16 samples; it moves by cents per second.
        const double seconds = in.running ? in.songSeconds : (double)freeSamples_ / sr_;
        ++freeSamples_;
        if (--driftCount_ < 0) {
            driftCount_ = 15;
            const uint64_t stream = p.voice >= 0 ? 1u + (uint64_t)p.voice : 1u;
            driftOct_ = driftOctaves(p.drift, p.seed, stream, seconds);
        }
        mult_ = std::exp2(std::clamp((double)in.pitch, -10.0, 10.0) + driftOct_);

        // The dial F (4.1, 4.5, 4.6).
        double F = dial;
        tooFast_ = false;
        if (mode == WaSweep) {
            F = sweep(p, in, hold, reset, dial);
        } else if (mode == WaLock) {
            if (reset) startHunt();
            F = lockF_ = std::clamp(lockF_, lo_, hi_);
        }

        if (!hold || !haveF_) f_ = std::clamp(F * mult_, kMinHz, 0.45 * sr_);
        haveF_ = true;
        F_ = F;
        setBandwidth(p.bandwidth);

        // Complex demodulation (4.2).
        const double x = (double)in.in;
        dcY_ = x - dcX_ + dcR_ * dcY_;
        dcX_ = x;
        float hi, hq;
        hilbert_.process((float)dcY_, hi, hq);
        const double c = std::cos(kTwoPi * phi_), s = std::sin(kTwoPi * phi_);
        const double mi = hi * c + hq * s;  // a · e^(−jφ)
        const double mq = hq * c - hi * s;
        zi_ = lpI_[1].lowpass(lpI_[0].lowpass(mi));
        zq_ = lpQ_[1].lowpass(lpQ_[0].lowpass(mq));
        if (std::fabs(zi_) + std::fabs(zq_) < 1e-20 && std::fabs(mi) + std::fabs(mq) < 1e-20) clearFilters();
        const double band = zi_ * c - zq_ * s;
        double shifted = 0.0;
        if (in.wantShifted) {
            shifted = zi_ * std::cos(kTwoPi * psi_) - zq_ * std::sin(kTwoPi * psi_);
            psi_ = advance(psi_, std::clamp((double)p.listen, 1.0, 0.45 * sr_) / sr_);
        }
        phi_ = advance(phi_, f_ / sr_);

        const double gTarget = std::pow(10.0, std::clamp((double)p.gainDb, -20.0, 40.0) / 20.0);
        gain_ = gain_ < 0.0 ? gTarget : gTarget + gainCoef() * (gain_ - gTarget);
        out.band = dsp::softClip((float)(gain_ * band));
        out.shifted = dsp::softClip((float)(gain_ * shifted));

        // Level and Peak (4.4).
        mag_ = std::sqrt(zi_ * zi_ + zq_ * zq_);
        const double m = levelMap(mag_, floorDb(p.floor));
        double needle;
        if (p.needle) {
            needle = needle_.lowpass(m);
            fast_.reset((float)m);
        } else {
            needle = (double)fast_.process((float)m, 0.005f, sr_);
            needle_.resetTo(needle);
        }
        level_ = std::clamp(needle, 0.0, 1.0);  // the needle stops at the pins
        out.level = (float)level_;
        out.peak = 0.0f;
        const double thr = std::clamp((double)p.threshold, 0.0, 1.0);
        if (armed_ && level_ > thr) {
            out.peak = 1.0f;
            armed_ = false;
        } else if (!armed_ && level_ < thr - 0.03) {
            armed_ = true;
        }
        out.track = (float)std::log2(f_ / kC4);

        if (mode == WaLock && !hold) updateLock(p);
        pzi_ = zi_;
        pzq_ = zq_;
        out.locked = lock_ == LockState::Lock ? 1.0f : 0.0f;
    }

    // ---- state for the view and the tests -----------------------------------
    double tunedHz() const noexcept { return f_; }
    double dialValueHz() const noexcept { return F_; }
    double bandwidth() const noexcept { return bw_; }
    double magnitude() const noexcept { return mag_; }
    double level() const noexcept { return level_; }
    double phase() const noexcept { return phi_; }
    double drift() const noexcept { return driftOct_; }
    bool tooFast() const noexcept { return tooFast_; }
    LockState lockState() const noexcept { return lock_; }
    /// Counts sweep passes (a new pass starts the plotter's fresh ink).
    uint32_t pass() const noexcept { return pass_; }
    /// Sets the local oscillator's phase (cycles), e.g. after a long run.
    void setPhase(double cycles) noexcept { phi_ = cycles - std::floor(cycles); }

private:
    /// Transport start: oscillators to 0, filters and needle clear, a new hunt.
    void restart() noexcept {
        hilbert_.reset();
        clearFilters();
        needle_.reset();
        fast_.reset();
        dcX_ = dcY_ = 0.0;
        phi_ = psi_ = 0.0;
        zi_ = zq_ = pzi_ = pzq_ = mag_ = level_ = 0.0;
        armed_ = true;
        haveF_ = false;
        if (lock_ != LockState::Off) startHunt();
    }
    void clearFilters() noexcept {
        for (auto& f : lpI_) f.reset();
        for (auto& f : lpQ_) f.reset();
    }
    double gainCoef() const noexcept { return std::exp(-1.0 / (0.02 * sr_)); }

    /// Coefficients only when B moves by more than 0.1 % (1/3 octave follows f).
    void setBandwidth(int index) noexcept {
        const double b = std::min(bandwidthHz(index, f_), 0.4 * sr_);
        if (index == bwIndex_ && std::fabs(b - bw_) <= 1e-3 * bw_) return;
        bwIndex_ = index;
        bw_ = b;
        const double fc = 0.5 * b;
        lpI_[0].set(fc, kQ1, sr_);
        lpI_[1].set(fc, kQ2, sr_);
        lpQ_[0].set(fc, kQ1, sr_);
        lpQ_[1].set(fc, kQ2, sr_);
    }

    /// The sweep ramp (4.5): synced to the song position or free.
    double sweep(const WaveAnalyzerParams& p, const WaveAnalyzerInput& in, bool hold, bool reset, double dial) noexcept {
        const double beats = syncBeats(p.sync);
        double rate;  // ramp cycles per second
        if (beats > 0.0 && in.running) {
            const double r = dsp::wrap01(in.ppq / beats);
            if (r < r_ - 0.5) ++pass_;
            r_ = r;
            rate = std::max(in.bpm, 1.0) / 60.0 / beats;
        } else {
            const double t = std::max((double)p.sweepTime, 0.01);
            rate = 1.0 / t;
            if (reset) {
                r_ = 0.0;
                ++pass_;
            }
            if (!hold) {
                r_ += 1.0 / (t * sr_);
                if (r_ >= 1.0) {
                    r_ -= std::floor(r_);
                    ++pass_;
                }
            }
        }
        double s = r_, slope = 1.0;
        if (p.sweepDir == WaDown) s = 1.0 - r_;
        else if (p.sweepDir == WaUpDown) s = 1.0 - std::fabs(2.0 * r_ - 1.0), slope = 2.0;
        const double span = std::clamp((double)p.span, 0.0, 10.0);
        const double F = dial * std::exp2(span * s);
        // Faster than B²/2 Hz/s the band cannot follow (Too Fast).
        const double hzPerSecond = F * mult_ * 0.693147180559945 * span * slope * rate;
        tooFast_ = !hold && hzPerSecond > 0.5 * bw_ * bw_;
        return F;
    }

    void window(const WaveAnalyzerParams& p, double dial) noexcept {
        const double k = std::exp2(std::clamp((double)p.capture, 0.0, 24.0) / 12.0);
        lo_ = dial / k;
        hi_ = dial * k;
    }

    void startHunt() noexcept {
        lock_ = LockState::Hunt;
        lockF_ = 0.0;  // clamped up to the bottom of W
        huntMax_ = 0.0;
        huntF_ = 0.0;
        huntSamples_ = 0;
    }

    /// The lock loop (4.6), after this sample's |Z|: sets F for the next one.
    void updateLock(const WaveAnalyzerParams& p) noexcept {
        const double minHuntSamples = sr_ / bw_;  // a hunt lasts at least 1/B (Capture 0)
        if (lock_ == LockState::Hunt) {
            if (mag_ > huntMax_) {
                huntMax_ = mag_;
                huntF_ = lockF_;
            }
            ++huntSamples_;
            const double rate = std::max(0.5 * bw_ * bw_ / mult_, (hi_ - lo_) / 8.0);  // F Hz per second
            if (lockF_ < hi_) {
                lockF_ = std::min(hi_, lockF_ + rate / sr_);
                return;
            }
            if ((double)huntSamples_ < minHuntSamples) return;
            // The band reads a moving dial late by its group delay: back off.
            const double peak = std::clamp(huntF_ - rate * kLagPerB / bw_, lo_, hi_);
            if (20.0 * std::log10(std::max(huntMax_, 1e-9)) > floorDb(p.floor) + 6.0) {
                lock_ = LockState::Lock;
                lockF_ = integ_ = peak;
                lockRef_ = huntMax_;
                lowSamples_ = pinSamples_ = 0;
            } else {
                startHunt();
            }
            return;
        }
        // Second-order PLL on the phase of Z, in F units (f = F · mult), with
        // frequency-locked-loop aid: the turn of Z per sample also feeds the
        // integrator, so the loop pulls in from anywhere in the band and does
        // not slip cycles. Locked, the turn is 0 and only the PLL acts.
        const double wn = kTwoPi * bw_ / kLoopDivisor;
        const double kp = 2.0 * kLoopDamping * wn, ki = wn * wn, kf = kFllGain * wn;
        const double e = std::atan2(zq_, zi_);
        const double turn = std::atan2(zq_ * pzi_ - zi_ * pzq_, zi_ * pzi_ + zq_ * pzq_);  // radians per sample
        const double toF = 1.0 / (kTwoPi * mult_);
        integ_ = std::clamp(integ_ + (ki * e / sr_ + kf * turn) * toF, lo_, hi_);
        lockF_ = std::clamp(integ_ + kp * e * toF, lo_, hi_);
        // Losing lock: 4/B seconds too quiet, or pinned to an edge of W.
        const double lose = 4.0 * sr_ / bw_;
        lowSamples_ = mag_ < 0.1 * lockRef_ ? lowSamples_ + 1 : 0;
        const bool wide = hi_ > lo_ * (1.0 + 1e-6);
        pinSamples_ = wide && (lockF_ <= lo_ || lockF_ >= hi_) ? pinSamples_ + 1 : 0;
        if ((double)lowSamples_ > lose || (double)pinSamples_ > lose) startHunt();
    }

    double sr_ = 48000.0;
    dsp::HilbertTransformer hilbert_;
    std::array<dsp::SvfLow, 2> lpI_, lpQ_;
    dsp::SvfLow needle_;
    dsp::OnePole fast_;
    dsp::GateEdge resetEdge_;
    double dcR_ = 0.999, dcX_ = 0.0, dcY_ = 0.0;
    double phi_ = 0.0, psi_ = 0.0;
    double pzi_ = 0.0, pzq_ = 0.0;
    double zi_ = 0.0, zq_ = 0.0, mag_ = 0.0, level_ = 0.0;
    double f_ = 440.0, F_ = 440.0, mult_ = 1.0;
    bool haveF_ = false, armed_ = true, tooFast_ = false;
    int bwIndex_ = -1;
    double bw_ = 10.0;
    double gain_ = -1.0;
    int lastMode_ = -1;
    uint32_t pass_ = 0;
    double r_ = 0.0;
    int64_t freeSamples_ = 0;
    int driftCount_ = 0;
    double driftOct_ = 0.0;
    // Lock loop
    LockState lock_ = LockState::Off;
    double lo_ = 293.66, hi_ = 659.26;
    double lockF_ = 440.0, integ_ = 440.0;
    double huntMax_ = 0.0, huntF_ = 440.0, lockRef_ = 0.0;
    int64_t huntSamples_ = 0, lowSamples_ = 0, pinSamples_ = 0;
};

}  // namespace bleep::patch
