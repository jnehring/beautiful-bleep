// SPDX-License-Identifier: MIT
// Sweep Generator (doc/specs/modules/sweep-generator.md): a function generator
// with a built-in frequency sweep. A progress value p runs over one sweep
// cycle (free, synced to the song position, triggered, gated); the position s
// follows Direction, the frequency follows the Log or Lin law between Start
// and Stop, and a phase-continuous, polyBLEP/polyBLAMP-corrected oscillator
// plays it. Around it: markers, End and Sync triggers, Burst mode, a glided
// Retrace and a seeded Drift with a warm-up that settles after transport start.
//
// Drift is a pure function of (Seed, song time) while playing, and transport
// start resets p, φ and the warm-up, so renders from one position repeat.
#pragma once

#include "dsp/OscCore.h"
#include "dsp/Random.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum class SweepWave { Sine, Triangle, Square, RampUp, RampDown, Pulse };
enum class SweepMode { Continuous, Triggered, Gated, Burst };
enum class SweepDirection { Up, Down, UpDown };

/// Sweep Sync choices (index 0 = Free) and their lengths in quarter notes.
constexpr int kSweepSyncChoices = 8;
inline const std::array<const char*, kSweepSyncChoices>& sweepSyncNames() {
    static const std::array<const char*, kSweepSyncChoices> names{"Free",   "1/4",    "1/2",    "1 bar",
                                                                  "2 bars", "4 bars", "8 bars", "16 bars"};
    return names;
}
inline double sweepSyncBeats(int index) noexcept {
    static constexpr double beats[kSweepSyncChoices] = {0.0, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0};
    return index >= 0 && index < kSweepSyncChoices ? beats[index] : 0.0;
}
constexpr std::array<float, 6> kSweepMarkerWidthsMs{1.0f, 5.0f, 10.0f, 25.0f, 50.0f, 100.0f};
constexpr std::array<float, 4> kSweepWarmupSeconds{0.0f, 10.0f, 30.0f, 120.0f};

struct SweepParams {
    float startHz = 100.0f;
    float stopHz = 5000.0f;
    float sweepSeconds = 4.0f;  ///< length of one sweep when sync is Free
    float symmetry = 0.0f;      ///< −1..+1
    std::array<float, 3> markerHz{250.0f, 1000.0f, 4000.0f};
    float fm = 0.0f;            ///< 0..1, depth of the FM input
    float drift = 0.15f;        ///< 0..1
    float level = 0.8f;
    int wave = 0;               ///< SweepWave
    int mode = 0;               ///< SweepMode
    int sync = 0;               ///< sweepSyncNames() index, 0 = Free
    bool lin = false;           ///< Law: Log (false) or Lin
    int direction = 0;          ///< SweepDirection
    bool glide = false;         ///< Retrace: Instant (false) or Glide
    int burstCount = 4;         ///< 1..64 cycles
    int markers = 0;            ///< active markers, 0..3
    float markerWidthMs = 10.0f;
    bool phaseReset = false;
    float warmupSeconds = 30.0f;  ///< 0 = Off
    uint32_t seed = 1;
};

/// One sample of input.
struct SweepInput {
    float trigger = 0.0f, gate = 0.0f, hold = 0.0f;
    float pitch = 0.0f;    ///< octaves
    float fm = 0.0f, am = 0.0f;
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    double ppq = 0.0;
    double bpm = 120.0;
};

struct SweepFrame {
    float out = 0.0f;
    float sweep = 0.0f;  ///< s, 0..1
    float freq = 0.0f;   ///< 1 V/oct, drift included
    float marker = 0.0f, markerGate = 0.0f, end = 0.0f, sync = 0.0f;
};

/// Waveform constants derived from Symmetry (4.5).
struct SweepShape {
    double k = 0.5;  ///< corner / duty of sine, triangle and square: 0.05 … 0.95
    double c = 1.0;  ///< ramp curve exponent: 1/4 … 4
    double d = 0.13; ///< pulse duty: 1 … 25 %
};

class SweepGeneratorDsp {
public:
    static constexpr float kSmoothSeconds = 0.005f;      ///< knob smoothing (7.3)
    static constexpr double kDriftSmoothSeconds = 0.02;  ///< drift jumps (seek, stop) glide over this
    static constexpr int kDriftEvery = 16;               ///< drift recomputed every this many samples
    static constexpr double kFadeSeconds = 0.0005;       ///< Burst fades
    static constexpr double kRetraceSeconds = 0.25;      ///< Glide: at most this long
    static constexpr double kRetraceTau = 5.0;           ///< Glide: time constant = length / 5
    static constexpr double kEndSlack = 1e-9;            ///< rounding of the summed increments

    // ---- pure functions of the spec's formulas ----------------------------

    /// Position s for progress p (4.1).
    static double position(double p, int direction) noexcept {
        switch (direction) {
            case 1: return 1.0 - p;
            case 2: return 1.0 - std::fabs(2.0 * p - 1.0);
            default: return p;
        }
    }
    /// The frequency law (4.2) between a (s = 0) and b (s = 1).
    static double sweepHz(double a, double b, double s, bool lin) noexcept {
        return lin ? a + (b - a) * s : a * std::pow(b / a, s);
    }
    static SweepShape shapeFor(double symmetry) noexcept {
        const double sym = std::clamp(symmetry, -1.0, 1.0);
        SweepShape sh;
        sh.k = 0.5 + 0.45 * sym;
        sh.c = std::exp2(-2.0 * sym);
        sh.d = 0.01 + 0.12 * (sym + 1.0);
        return sh;
    }
    /// One sample of waveform `wave` at phase ph (4.5): the naive shape plus
    /// polyBLEP at its jumps and polyBLAMP at its corners. dt = |increment|.
    static double wave(int w, double ph, double dt, const SweepShape& sh) noexcept {
        using dsp::osc::polyBlamp;
        using dsp::osc::polyBlep;
        const double k = sh.k, tk = dsp::osc::wrap01(ph - k);
        // The corner corrections assume straight segments of at least a sample
        // around each corner; a shorter segment gets a proportionally smaller one.
        const double fit = std::min(1.0, std::min(k, 1.0 - k) / dt);
        switch (w) {
            case 1: {  // Triangle: −1 → +1 over [0, k), back over [k, 1)
                double y = ph < k ? -1.0 + 2.0 * ph / k : 1.0 - 2.0 * (ph - k) / (1.0 - k);
                const double corner = 2.0 / (k * (1.0 - k));  // slope change per cycle
                y += corner * dt * fit * (polyBlamp(ph, dt) - polyBlamp(tk, dt));
                return y;
            }
            case 2: {  // Square, duty k
                double y = ph < k ? 1.0 : -1.0;
                y += polyBlep(ph, dt) - polyBlep(tk, dt);
                return y;
            }
            case 3:
            case 4: {  // Ramps: 2·φ^c − 1, Down inverted
                const double c = sh.c;
                double y = 2.0 * (c == 1.0 ? ph : std::pow(ph, c)) - 1.0;
                y -= polyBlep(ph, dt);
                // The slope jumps at the reset too: from 2c (φ → 1) to the mean
                // slope over the first sample (finite even where φ^c is steep).
                const double first = 2.0 * std::pow(std::max(dt, 1e-9), c) / std::max(dt, 1e-9);
                y += (first - 2.0 * c) * dt * polyBlamp(ph, dt);
                return w == 3 ? y : -y;
            }
            case 5: {  // Pulse: duty d, mean removed, peak +1
                const double d = sh.d, td = dsp::osc::wrap01(ph - d);
                double y = ((ph < d ? 1.0 : -1.0) - (2.0 * d - 1.0)) / (2.0 - 2.0 * d);
                y += (polyBlep(ph, dt) - polyBlep(td, dt)) / (2.0 - 2.0 * d);
                return y;
            }
            default: {  // Sine with a warped phase; both kinks change the slope by π(1/k − 1/(1 − k))
                const double psi = ph < k ? 0.5 * ph / k : 0.5 + 0.5 * (ph - k) / (1.0 - k);
                double y = std::sin(dsp::osc::kTwoPi * psi);
                const double corner = 3.14159265358979323846 * (1.0 / k - 1.0 / (1.0 - k));
                if (corner != 0.0) y += corner * dt * fit * (polyBlamp(ph, dt) + polyBlamp(tk, dt));
                return y;
            }
        }
    }
    /// Raised-cosine fade 0 → 1 over x = 0 … 1.
    static double fade(double x) noexcept {
        return x >= 1.0 ? 1.0 : x <= 0.0 ? 0.0 : 0.5 - 0.5 * std::cos(3.14159265358979323846 * x);
    }
    /// Cosine-interpolated seeded noise with knots every `spacing` seconds (4.6).
    static double knotNoise(uint32_t seed, uint64_t stream, double t, double spacing) noexcept {
        const double x = t / spacing, fl = std::floor(x);
        const int64_t j = (int64_t)fl;
        const double a = 2.0 * dsp::uniform01(seed, (uint64_t)j, stream) - 1.0;
        const double b = 2.0 * dsp::uniform01(seed, (uint64_t)(j + 1), stream) - 1.0;
        return a + (b - a) * fade(x - fl);
    }
    /// n(t): 3 s knots plus half as much at 0.7 s knots, −1.5..+1.5.
    static double driftNoise(uint32_t seed, double t) noexcept {
        return knotNoise(seed, 1, t, 3.0) + 0.5 * knotNoise(seed, 2, t, 0.7);
    }
    /// w(t_s) in cents: starts at ±40 and decays with τ = warm-up / 3.
    static double warmupCents(uint32_t seed, double ts, double warmupSeconds) noexcept {
        if (warmupSeconds <= 0.0) return 0.0;
        const double x = std::max(ts, 0.0) * 3.0 / warmupSeconds;
        if (x > 40.0) return 0.0;
        return 40.0 * (2.0 * dsp::uniform01(seed, 0, 3) - 1.0) * std::exp(-x);
    }
    /// The drift in cents (4.6).
    static double driftCents(uint32_t seed, double drift, double t, double ts, double warmupSeconds) noexcept {
        if (drift <= 0.0) return 0.0;
        return drift * (25.0 * driftNoise(seed, t) + warmupCents(seed, ts, warmupSeconds));
    }

    // ---- processing ---------------------------------------------------------

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        centsCoeff_ = 1.0 - std::exp(-1.0 / (kDriftSmoothSeconds * sampleRate));
        reset();
    }

    void reset() noexcept {
        trig_.reset();
        p_ = 0.0;
        phase_ = 0.0;
        offset_ = 0.0;
        lastEnds_ = 0;
        resync_ = true;
        fresh_ = true;
        first_ = true;
        trigState_ = Waiting;
        trigBpm_ = lastBpm_ = 120.0;
        burst_ = Idle;
        cyclesDone_ = 0;
        burstAge_ = restartLeft_ = 0.0;
        burstGain_ = restartFrom_ = 0.0;
        retraceLeft_ = retraceTotal_ = 0;
        retraceFrom_ = 0.0;
        prevValid_ = false;
        prevActive_ = 0;
        prevAbove_.fill(false);
        markerGateLeft_ = 0;
        syncPending_ = false;
        moduleSamples_ = sinceStart_ = 0;
        s_ = 0.0;
        hz_ = 100.0;
        length_ = 4.0;
        lastMarkerHz_.fill(-1.0f);
        markerLog_.fill(0.0);
        lastSym_ = 2.0;
        cents_ = centsTarget_ = 0.0;
        driftCountdown_ = 0;
        linLa_ = linLb_ = 1e9;
    }

    void tick(const SweepParams& p, const SweepInput& in, SweepFrame& out) noexcept {
        out = SweepFrame{};
        const double sr = sampleRate_;
        const bool trig = trig_.process(in.trigger) > 0;
        const bool hold = in.hold >= 0.5f, gate = in.gate >= 0.5f;
        const int mode = std::clamp(p.mode, 0, 3), dir = std::clamp(p.direction, 0, 2);
        const double beats = sweepSyncBeats(p.sync);
        const bool locked = in.running && beats > 0.0 && (mode == Continuous || mode == Burst);
        if (in.bpm > 1.0 && std::isfinite(in.bpm)) lastBpm_ = in.bpm;
        length_ = beats > 0.0 ? beats * 60.0 / lastBpm_ : std::clamp((double)p.sweepSeconds, 0.001, 1000.0);

        // Knobs, smoothed over 5 ms (Start and Stop in octaves).
        const double laT = std::log2(std::max((double)p.startHz, 1e-3));
        const double lbT = std::log2(std::max((double)p.stopHz, 1e-3));
        const double symT = std::clamp((double)p.symmetry, -1.0, 1.0), fmT = std::clamp((double)p.fm, 0.0, 1.0);
        const double levelT = std::clamp((double)p.level, 0.0, 1.0), driftT = std::clamp((double)p.drift, 0.0, 1.0);
        if (first_) {
            la_.reset((float)laT);
            lb_.reset((float)lbT);
            sym_.reset((float)symT);
            fm_.reset((float)fmT);
            level_.reset((float)levelT);
            drift_.reset((float)driftT);
        }
        const double la = glide(la_, laT, sr), lb = glide(lb_, lbT, sr);
        const double sym = glide(sym_, symT, sr);
        const double fmDepth = glide(fm_, fmT, sr), level = glide(level_, levelT, sr);
        const double drift = glide(drift_, driftT, sr);

        bool jumped = false, end = false, wrapped = false, newPhase = false, sync = false;

        // Transport start (4.8): p and φ to 0, warm-up restarts, Triggered waits.
        if (in.started) {
            p_ = offset_ = 0.0;
            resync_ = fresh_ = true;
            trigState_ = Waiting;
            burst_ = Idle;
            retraceLeft_ = 0;
            sinceStart_ = 0;
            jumped = newPhase = true;
        }
        if (trig) {
            if (mode == Triggered) {
                p_ = 0.0;
                trigState_ = Running;
                trigBpm_ = lastBpm_;
                fresh_ = jumped = true;
            } else if (mode == Burst) {
                if (burst_ == Idle) sync = startBurst();
                else if (burst_ == Playing) {
                    burst_ = Restarting;
                    restartFrom_ = burstGain_;
                    restartLeft_ = kFadeSeconds * sr;
                }
            } else {  // Continuous, Gated: restart the sweep
                if (locked) offset_ = in.ppq;
                p_ = 0.0;
                resync_ = fresh_ = jumped = true;
                retraceLeft_ = 0;
            }
            if (p.phaseReset && mode != Burst) newPhase = true;
        }

        // Sweep progress (4.1, 4.3).
        const bool advance = !hold && (mode != Gated || gate);
        if (locked) {
            const double x = (in.ppq - offset_) / beats;
            const int64_t ends = (int64_t)std::floor(dir == 2 ? 2.0 * x : x);
            if (!hold) {
                if (resync_) {  // start, trigger, back from Free or Hold: join the grid
                    jumped = true;
                } else if (ends == lastEnds_ + 1) {
                    end = true;
                    wrapped = dir != 2;  // Up-Down turns without a jump
                } else if (ends != lastEnds_) {  // a seek or a loop jump
                    jumped = true;
                    retraceLeft_ = 0;
                }
                resync_ = false;
                lastEnds_ = ends;
                p_ = dsp::wrap01(x);
            } else {
                resync_ = true;
            }
        } else {
            resync_ = true;
            if (mode == Triggered) {
                if (trigState_ == Waiting) p_ = 0.0;
                else if (trigState_ == Running && advance && !fresh_) {
                    const double len = beats > 0.0 ? beats * 60.0 / trigBpm_ : length_;
                    const double prev = p_;
                    p_ += 1.0 / (len * sr);
                    if (dir == 2 && prev < 0.5 - kEndSlack && p_ >= 0.5 - kEndSlack) end = true;
                    if (p_ >= 1.0 - kEndSlack) {
                        p_ = 1.0;
                        end = true;
                        trigState_ = Done;
                    }
                }
            } else if (advance && !fresh_) {
                const double prev = p_;
                p_ += 1.0 / (length_ * sr);
                if (dir == 2 && prev < 0.5 - kEndSlack && p_ >= 0.5 - kEndSlack) end = true;
                if (p_ >= 1.0 - kEndSlack) {
                    p_ = std::max(0.0, p_ - std::floor(p_ + kEndSlack));
                    end = true;
                    wrapped = dir != 2;
                }
            }
        }
        fresh_ = false;
        if (wrapped) {
            jumped = true;
            retraceLeft_ = 0;
            if (p.glide && dir != 2) {  // Retrace Glide (4.4): from where the sweep ended
                retraceTotal_ = (int64_t)(std::min(0.05 * length_, kRetraceSeconds) * sr);
                if (retraceTotal_ >= 2) {
                    retraceLeft_ = retraceTotal_;
                    retraceFrom_ = s_ - position(p_, dir);
                }
            }
        }
        if (mode != Burst) burst_ = Idle;

        // Position, with the retrace's offset gliding to 0 on an exponential curve.
        double s = position(p_, dir);
        const bool retracing = retraceLeft_ > 0;
        if (retracing) {
            const double t = (double)(retraceTotal_ - retraceLeft_) / (double)retraceTotal_;
            const double e5 = std::exp(-kRetraceTau);
            s += retraceFrom_ * (std::exp(-kRetraceTau * t) - e5) / (1.0 - e5);
            if (advance) --retraceLeft_;
        }
        s = std::clamp(s, 0.0, 1.0);
        s_ = s;

        // Frequency (4.2), in octaves of Hz, before Pitch and Drift.
        double lf = la + s * (lb - la);
        if (p.lin) {
            if (differs(la, linLa_) || differs(lb, linLb_)) {  // cached: Start and Stop in Hz
                linLa_ = la;
                linLb_ = lb;
                linA_ = std::exp2(la);
                linB_ = std::exp2(lb);
            }
            lf = std::log2(std::max(linA_ + (linB_ - linA_) * s, 1e-9));
        }

        // Markers (4.7): the sign of log2(f_sweep / m) changes; not on jumps or during a retrace.
        bool marker = false;
        const size_t active = (size_t)std::clamp(p.markers, 0, 3);
        for (size_t i = 0; i < active; ++i) {
            if (differs(p.markerHz[i], lastMarkerHz_[i])) {
                lastMarkerHz_[i] = p.markerHz[i];
                markerLog_[i] = std::log2(std::max((double)p.markerHz[i], 1e-3));
            }
            const bool above = lf >= markerLog_[i];
            if (prevValid_ && !jumped && !retracing && above != prevAbove_[i]) marker = true;
            prevAbove_[i] = above;
        }
        prevValid_ = active > 0 && active == prevActive_;  // a marker switched on has no history yet
        prevActive_ = active;
        if (marker) markerGateLeft_ = std::max<int64_t>(1, (int64_t)std::llround(p.markerWidthMs * 0.001 * sr));

        // Drift (4.6): song time while playing, else time since the module started.
        const double t = in.running ? in.ppq * 60.0 / lastBpm_ : (double)moduleSamples_ / sr;
        // The drift moves slowly: its target is recomputed every kDriftEvery
        // samples and smoothed, which also glides the jumps of a seek or a stop.
        if (first_ || in.started || --driftCountdown_ <= 0) {
            driftCountdown_ = kDriftEvery;
            centsTarget_ = driftCents(p.seed, drift, t, (double)sinceStart_ / sr, (double)p.warmupSeconds);
            if (first_) cents_ = centsTarget_;
        }
        if (drift <= 0.0 && std::fabs(cents_) < 1e-9) cents_ = centsTarget_;  // Drift 0: exactly 0
        cents_ += (centsTarget_ - cents_) * centsCoeff_;
        const double cents = cents_;
        const double lfTotal = lf + std::clamp((double)in.pitch, -10.0, 10.0) + cents / 1200.0;
        hz_ = std::exp2(lfTotal);

        // Oscillator (4.4): linear through-zero FM, clamped to ±0.45·sr.
        const double fi = std::clamp(hz_ * (1.0 + 2.0 * fmDepth * (double)in.fm), -0.45 * sr, 0.45 * sr);
        const double inc = fi / sr, dt = std::max(std::fabs(inc), 1e-12);
        if (differs(sym, lastSym_)) {
            lastSym_ = sym;
            shape_ = shapeFor(sym);
        }
        const int w = std::clamp(p.wave, 0, 5);
        double y = 0.0, gain = 1.0;
        bool running = true;  // the phase moves this sample

        if (mode == Burst) {
            if (burst_ == Restarting) {
                gain = restartFrom_ * fade(restartLeft_ / (kFadeSeconds * sr));
                restartLeft_ -= 1.0;
                if (restartLeft_ <= 0.0) sync = startBurst() || sync;
            }
            if (burst_ == Playing) {
                const int n = std::clamp(p.burstCount, 1, 64);
                const double left = (double)(n - cyclesDone_ - 1) + (inc >= 0.0 ? 1.0 - phase_ : phase_);
                const double fadeLen = kFadeSeconds * sr;
                gain = std::min(fade(burstAge_ / fadeLen), fade(left / dt / fadeLen));
                burstAge_ += 1.0;
            } else if (burst_ == Idle) {
                gain = 0.0;
                running = false;
                phase_ = 0.0;
            }
            burstGain_ = gain;
        } else if (newPhase) {
            // Phase Reset or transport start: a step placed at this sample's start,
            // smoothed by a polyBLEP (the sample is the mean of both sides).
            const double before = wave(w, phase_, dt, shape_);
            phase_ = 0.0;
            y = 0.5 * (before - wave(w, 0.0, dt, shape_));
            sync = true;
        }
        if (running) y += wave(w, phase_, dt, shape_);
        if (syncPending_) sync = true;
        syncPending_ = false;

        const double am = std::clamp(1.0 + (double)in.am, 0.0, 4.0);
        const double o = y * gain * level * am;
        out.out = std::isfinite(o) ? (float)o : 0.0f;
        out.sweep = (float)s;
        out.freq = (float)(lfTotal - std::log2(dsp::osc::kC4Hz));
        out.marker = marker ? 1.0f : 0.0f;
        out.markerGate = markerGateLeft_ > 0 ? 1.0f : 0.0f;
        out.end = end ? 1.0f : 0.0f;
        out.sync = sync ? 1.0f : 0.0f;
        if (markerGateLeft_ > 0) --markerGateLeft_;

        // Advance the phase; every wrap (either direction) is a Sync.
        if (running) {
            phase_ += inc;
            const bool wrap = phase_ >= 1.0 || phase_ < 0.0;
            phase_ -= std::floor(phase_);
            if (!std::isfinite(phase_) || phase_ >= 1.0) phase_ = 0.0;  // −tiny + 1 rounds to 1
            if (wrap) {
                if (mode != Burst) {
                    syncPending_ = true;
                } else if (burst_ == Playing) {
                    if (++cyclesDone_ >= std::clamp(p.burstCount, 1, 64)) {
                        burst_ = Idle;  // the last cycle is done: silent until the next trigger
                        phase_ = 0.0;
                    } else {
                        syncPending_ = true;
                    }
                }  // a burst fading out for a restart counts no more cycles
            }
        }
        ++moduleSamples_;
        ++sinceStart_;
        first_ = false;
    }

    double progress() const noexcept { return p_; }
    double sweepPosition() const noexcept { return s_; }
    /// Current frequency in Hz (Pitch and Drift included, FM not).
    double frequency() const noexcept { return hz_; }
    double phase() const noexcept { return phase_; }
    /// Length of one sweep cycle in seconds at the current settings and tempo.
    double cycleSeconds() const noexcept { return length_; }
    bool waiting() const noexcept { return trigState_ == Waiting; }

private:
    enum { Continuous, Triggered, Gated, Burst };
    enum TrigState { Waiting, Running, Done };
    enum BurstState { Idle, Playing, Restarting };

    template <class T>
    static bool differs(T a, T b) noexcept { return a < b || a > b; }
    /// One-pole smoothing that settles exactly on the (double) target, so a
    /// still knob gives the exact frequency.
    static double glide(dsp::OnePole& f, double target, double sr, float seconds = kSmoothSeconds) noexcept {
        if (std::fabs((double)f.value() - target) <= 1e-6 * std::max(1.0, std::fabs(target))) {
            f.reset((float)target);
            return target;
        }
        return (double)f.process((float)target, seconds, sr);
    }
    /// Starts a burst at phase 0; returns true (its first cycle is a Sync).
    bool startBurst() noexcept {
        burst_ = Playing;
        phase_ = 0.0;
        cyclesDone_ = 0;
        burstAge_ = 0.0;
        syncPending_ = false;
        return true;
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge trig_;
    double p_ = 0.0, phase_ = 0.0, offset_ = 0.0;
    int64_t lastEnds_ = 0;
    bool resync_ = true, fresh_ = true, first_ = true;
    TrigState trigState_ = Waiting;
    double trigBpm_ = 120.0, lastBpm_ = 120.0;
    BurstState burst_ = Idle;
    int cyclesDone_ = 0;
    double burstAge_ = 0.0, restartLeft_ = 0.0, burstGain_ = 0.0, restartFrom_ = 0.0;
    int64_t retraceLeft_ = 0, retraceTotal_ = 0;
    double retraceFrom_ = 0.0;
    bool prevValid_ = false;
    size_t prevActive_ = 0;
    std::array<bool, 3> prevAbove_{};
    int64_t markerGateLeft_ = 0;
    bool syncPending_ = false;
    int64_t moduleSamples_ = 0, sinceStart_ = 0;
    double s_ = 0.0, hz_ = 100.0, length_ = 4.0;
    std::array<float, 3> lastMarkerHz_{};
    std::array<double, 3> markerLog_{};
    double lastSym_ = 2.0;
    SweepShape shape_;
    dsp::OnePole la_, lb_, sym_, fm_, level_, drift_;
    double cents_ = 0.0, centsTarget_ = 0.0, centsCoeff_ = 0.05;
    int driftCountdown_ = 0;
    double linLa_ = 1e9, linLb_ = 1e9, linA_ = 0.0, linB_ = 0.0;
};

}  // namespace bleep::patch
