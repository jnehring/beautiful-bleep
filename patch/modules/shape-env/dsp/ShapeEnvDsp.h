// SPDX-License-Identifier: GPL-3.0-or-later
// Shape Env core (doc/specs/modules/shape-envelope.md): plays shapes from the
// shared library (96 factory shapes, dsp/Shapes.h) or 8 user-drawn slots as a
// one-shot envelope, a gated envelope that holds at the shape's sustain point,
// or a loop. Morph blends into the next shape, Skew warps time, Reverse reads
// backwards. Restarts and shape changes crossfade, so nothing clicks.
#pragma once

#include "dsp/Shapes.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"
#include "dsp/Waves.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum ShapeEnvMode { ShapeOneShot = 0, ShapeGated, ShapeLoop };

/// A user slot: a table drawn in the view (node data), or empty (a flat 0).
struct UserShape {
    dsp::ShapeTable table{};
    bool used = false;
    dsp::ShapeKind kind = dsp::ShapeKind::Envelope;
    bool bipolar = false;
    float sustain = -1.0f;  ///< table phase, or −1 for none
};
constexpr int kUserShapes = 8;
using UserShapes = std::array<UserShape, kUserShapes>;

/// A user slot as saved in the document: 64 points (3 decimals).
struct UserSlot {
    static constexpr int kPoints = 64;
    bool used = false;
    float points[kPoints] = {};
    float sustain = -1.0f;
    bool cycle = false;
    bool bipolar = false;

    /// Cleans drawn values: any count is resampled (linearly) to 64, rounded
    /// to 3 decimals, clamped to the polarity's range; a cycle ends where it
    /// starts. A sustain point outside 0..1 (or not finite) is dropped.
    void set(const double* values, int n, double sustainPoint, bool isCycle, bool isBipolar) noexcept {
        cycle = isCycle;
        bipolar = isBipolar;
        used = n > 0;
        const float lo = bipolar ? -1.0f : 0.0f;
        auto at = [&](int i) { return std::isfinite(values[i]) ? values[i] : 0.0; };
        for (int i = 0; i < kPoints; ++i) {
            double y = 0.0;
            if (n == 1) y = at(0);
            else if (n > 1) {
                const double x = (double)i * (n - 1) / (kPoints - 1);
                const int k = std::min((int)x, n - 2);
                y = at(k) + (x - k) * (at(k + 1) - at(k));
            }
            points[i] = std::clamp(round3(y), lo, 1.0f);
        }
        if (cycle) points[kPoints - 1] = points[0];
        sustain = std::isfinite(sustainPoint) && sustainPoint >= 0.0 && sustainPoint <= 1.0 ? round3(sustainPoint) : -1.0f;
    }
    static float round3(double v) noexcept { return (float)(std::round(v * 1000.0) / 1000.0); }

    /// The run-time table: 64 points → 256 with a monotone cubic (no overshoot).
    void build(UserShape& u) const noexcept {
        u.used = used;
        u.kind = cycle ? dsp::ShapeKind::Cycle : dsp::ShapeKind::Envelope;
        u.bipolar = bipolar;
        u.sustain = sustain;
        if (!used) {
            u.table.v.fill(0.0f);
            return;
        }
        dsp::resampleMonotone(points, kPoints, u.table);
        if (cycle) u.table.v[dsp::ShapeTable::kPoints - 1] = u.table.v[0];
    }
};

struct ShapeEnvParams {
    float time = 0.5f;        ///< seconds (one-shot length or loop cycle)
    int shape = 0;            ///< 0–95 factory, 96–103 user
    float morph = 0.0f;       ///< 0..1 toward shape + 1
    float level = 1.0f;
    float velAmount = 0.0f;
    float skew = 0.0f;        ///< −1..+1
    int mode = ShapeOneShot;
    int sync = 0;             ///< 0 = off, else an index into syncName()
    bool reverse = false;
    bool ignoreRetrigger = false;
};

struct ShapeEnvTime {
    bool running = false;
    double bpm = 120.0;
    double ppq = 0.0;
};

struct ShapeEnvFrame {
    float out = 0.0f, inv = 0.0f, phase = 0.0f, end = 0.0f, active = 0.0f;
};

class ShapeEnvDsp {
public:
    static constexpr int kFactory = dsp::ShapeLibrary::kFactoryShapes;
    static constexpr int kShapes = kFactory + kUserShapes;

    /// Sync: Off, then the shared note values from 16 bars to 1/32T.
    static constexpr int kSyncChoices = 1 + 22;
    static const char* syncName(int i) noexcept {
        return i <= 0 ? "Off" : dsp::noteValues()[(size_t)std::min(i, kSyncChoices - 1) - 1].name;
    }
    static double syncBeats(int i) noexcept { return i <= 0 ? 0.0 : dsp::noteValueBeats(std::min(i, kSyncChoices - 1) - 1); }

    struct Info {
        dsp::ShapeKind kind;
        bool bipolar;
        float sustain;
    };

    /// The table of shape s (factory or user; an empty user slot is a flat 0).
    static const dsp::ShapeTable& table(int s, const UserShapes* user) noexcept {
        static const dsp::ShapeTable empty{};
        s = wrap(s);
        if (s < kFactory) return dsp::ShapeLibrary::factory().table(s);
        if (!user || !(*user)[(size_t)(s - kFactory)].used) return empty;
        return (*user)[(size_t)(s - kFactory)].table;
    }
    static Info info(int s, const UserShapes* user) noexcept {
        s = wrap(s);
        if (s < kFactory) {
            const dsp::ShapeInfo& in = dsp::ShapeLibrary::info(s);
            return {in.kind, in.bipolar, in.sustain};
        }
        if (!user || !(*user)[(size_t)(s - kFactory)].used) return {dsp::ShapeKind::Envelope, false, -1.0f};
        const UserShape& u = (*user)[(size_t)(s - kFactory)];
        return {u.kind, u.bipolar, u.sustain};
    }
    static int wrap(int s) noexcept { return ((s % kShapes) + kShapes) % kShapes; }

    /// The value of shape s morphed toward s + 1 at playback phase `phase`
    /// (Skew, then Reverse, then the table lookup).
    static float lookup(int s, float morph, float skew, bool reverse, double phase, const UserShapes* user) noexcept {
        double x = dsp::skewPhase(phase, skew);
        if (reverse) x = dsp::reversePhase(x);
        return dsp::morphTables(table(s, user), table(s + 1, user), morph, x);
    }
    /// The shape's info for a morph (S below 50 %, S + 1 above).
    static Info morphedInfo(int s, float morph, const UserShapes* user) noexcept {
        return info(morph < 0.5f ? s : s + 1, user);
    }
    /// The playback phase at which Gated mode holds (−1: no sustain point):
    /// the sustain point mirrored by Reverse and mapped back through Skew.
    static double holdPhase(float sustain, float skew, bool reverse) noexcept {
        if (sustain < 0.0f) return -1.0;
        const double target = reverse ? 1.0 - (double)sustain : (double)sustain;
        return std::pow(std::clamp(target, 0.0, 1.0), std::exp2((double)std::clamp(skew, -1.0f, 1.0f)));
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        (void)dsp::ShapeLibrary::factory();  // build the tables here, not on the audio thread
        reset();
    }
    void reset() noexcept {
        trig_.reset();
        gate_.reset();
        phase_ = 0.0;
        running_ = held_ = holding_ = false;
        started_ = false;
        latched_ = -1;
        out_ = 0.0f;
        fade_ = 0.0f;
        peak_ = 1.0f;
    }

    double phase() const noexcept { return phase_; }
    bool holding() const noexcept { return holding_; }
    int playingShape() const noexcept { return latched_ < 0 ? 0 : latched_; }

    void tick(const ShapeEnvParams& p, float trigIn, float gateIn, float velocity, const ShapeEnvTime& t,
              const UserShapes* user, ShapeEnvFrame& f) noexcept {
        f.end = 0.0f;
        const bool trigEdge = trig_.process(trigIn) > 0;
        const int gateEdge = gate_.process(gateIn);
        const bool start = trigEdge || gateEdge > 0;
        const int mode = std::clamp(p.mode, 0, 2);
        const double beats = syncBeats(p.sync);
        const double seconds = beats > 0.0 ? dsp::beatsToSeconds(beats, t.bpm) : std::max((double)p.time, 0.001);
        const double inc = 1.0 / (seconds * sampleRate_);
        const float velAmount = std::clamp(p.velAmount, 0.0f, 1.0f);

        if (mode == ShapeLoop) {
            const int s = wrap(p.shape);
            if (latched_ >= 0 && s != latched_) crossfade(0.005);  // a new shape: 5 ms
            latched_ = s;
            if (start) peak_ = 1.0f - velAmount * (1.0f - std::clamp(velocity, 0.0f, 1.0f));
            if (beats > 0.0 && t.running) {
                const double ph = dsp::ppqPhase(t.ppq, beats);
                if (started_ && ph < phase_) f.end = 1.0f;
                phase_ = ph;
            } else if (start) {
                crossfade(0.002);
                phase_ = 0.0;
            } else if (started_) {
                phase_ += inc;
                if (phase_ >= 1.0) {
                    phase_ -= std::floor(phase_);
                    f.end = 1.0f;
                }
            }
            running_ = true;
            held_ = holding_ = false;
            f.active = 1.0f;
        } else {
            if (gateEdge < 0) held_ = false;
            if (start && !(running_ && p.ignoreRetrigger)) {
                if (started_) crossfade(0.002);
                latched_ = wrap(p.shape);  // shape changes are picked up at the next start
                phase_ = 0.0;
                running_ = true;
                held_ = mode == ShapeGated && gateEdge > 0;  // Trig is a gate of zero length
                peak_ = 1.0f - velAmount * (1.0f - std::clamp(velocity, 0.0f, 1.0f));
            } else if (running_) {
                double next = phase_ + inc;
                holding_ = false;
                if (held_ && mode == ShapeGated) {
                    const double hold = holdPhase(morphedInfo(latched_, p.morph, user).sustain, p.skew, p.reverse);
                    if (hold >= 0.0 && phase_ <= hold && next >= hold) {
                        next = hold;
                        holding_ = true;
                    }
                }
                if (next >= 1.0) {
                    next = 1.0;
                    running_ = false;
                    f.end = 1.0f;
                }
                phase_ = next;
            }
            if (!running_) holding_ = false;
            f.active = running_ ? 1.0f : 0.0f;
        }
        started_ = started_ || start || mode == ShapeLoop;

        float v = 0.0f;
        if (latched_ >= 0) v = lookup(latched_, p.morph, p.skew, p.reverse, phase_, user);
        v *= std::clamp(p.level, 0.0f, 1.0f) * peak_;
        if (fade_ > 0.0f) {
            v += fade_ * (from_ - v);
            fade_ = std::max(0.0f, fade_ - fadeStep_);
        }
        out_ = v;
        const bool bipolar = latched_ >= 0 && morphedInfo(latched_, p.morph, user).bipolar;
        f.out = v;
        f.inv = bipolar ? -v : 1.0f - v;
        f.phase = (float)phase_;
    }

private:
    void crossfade(double seconds) noexcept {
        from_ = out_;
        fade_ = 1.0f;
        fadeStep_ = (float)(1.0 / (seconds * sampleRate_));
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge trig_, gate_;
    double phase_ = 0.0;
    bool running_ = false, held_ = false, holding_ = false, started_ = false;
    int latched_ = -1;
    float out_ = 0.0f, from_ = 0.0f, fade_ = 0.0f, fadeStep_ = 0.01f, peak_ = 1.0f;
};

}  // namespace bleep::patch
