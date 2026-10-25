// SPDX-License-Identifier: GPL-3.0-only
// Shape Sequencer DSP (doc/specs/modules/shape-sequencer.md): a loop of up to 64
// shapes, each with its own position and length in quarter notes, its own start
// level, end level and curve. The loop runs on the transport, or from a trigger
// or a gate. The step count of the view is only the editing grid: the shapes
// keep their place when it changes. No JUCE, no allocation.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kMaxShapes = 64;

enum ShapeType : uint8_t { ShapeEmpty, ShapeRamp, ShapeCurve, ShapeTriangle, ShapePlateau, ShapePulse };

/// One shape: it covers [start, start + len) quarter notes of the loop. Levels are 0…1, `c` (the curve) −1…+1.
struct ShapeSegment {
    uint8_t type = ShapeEmpty;
    float a = 0.0f;  ///< start level (plateau: its level; pulse: first half; triangle: the edges)
    float b = 0.0f;  ///< end level (pulse: second half; triangle: the peak)
    float c = 0.0f;
    double start = 0.0;
    double len = 0.0;
};

/// The shapes sorted by start, without overlaps (the module's sanitiser makes sure).
struct ShapeTable {
    std::array<ShapeSegment, kMaxShapes> seg{};
    int count = 0;

    /// Index of the shape covering `pos` (quarter notes), or -1 in a gap.
    int find(double pos) const noexcept {
        int lo = 0, hi = count - 1, hit = -1;
        while (lo <= hi) {
            const int mid = (lo + hi) / 2;
            if (seg[(size_t)mid].start <= pos) hit = mid, lo = mid + 1;
            else hi = mid - 1;
        }
        return hit >= 0 && pos < seg[(size_t)hit].start + seg[(size_t)hit].len ? hit : -1;
    }
};

/// The shape at position t (0…1) inside its span, 0…1 (empty: 0).
inline float shapeValue(const ShapeSegment& s, double t) noexcept {
    t = std::clamp(t, 0.0, 1.0);
    const double p = std::pow(2.0, 2.0 * (double)s.c);
    double x = 0.0;
    switch (s.type) {
        case ShapeRamp: x = std::pow(t, p); break;
        case ShapeCurve: {
            const double u = std::pow(t, p), v = std::pow(1.0 - t, p);
            x = u / (u + v);
            break;
        }
        case ShapeTriangle: x = std::pow(1.0 - std::fabs(2.0 * t - 1.0), p); break;
        case ShapePlateau: return s.a;
        case ShapePulse: return t < 0.5 ? s.a : s.b;
        default: return 0.0f;
    }
    return (float)((double)s.a + ((double)s.b - (double)s.a) * x);
}

/// Saw up, plateau, saw down, curve, one per beat: what a new module plays.
inline ShapeTable defaultShapeTable() {
    ShapeTable t;
    t.seg[0] = {ShapeRamp, 0.0f, 1.0f, 0.0f, 0.0, 1.0};
    t.seg[1] = {ShapePlateau, 0.6f, 0.6f, 0.0f, 1.0, 1.0};
    t.seg[2] = {ShapeRamp, 1.0f, 0.0f, 0.5f, 2.0, 1.0};
    t.seg[3] = {ShapeCurve, 0.0f, 1.0f, 0.4f, 3.0, 1.0};
    t.count = 4;
    return t;
}

enum ShapeSync : int { ShapeOnTransport = 0, ShapeOnTrigger = 1, ShapeOnGate = 2 };

struct ShapeParams {
    double lengthBeats = 4.0;  ///< the loop, in quarter notes
    double rate = 1.0;         ///< speed multiplier (the loop lasts lengthBeats / rate)
    int sync = ShapeOnTransport;
    bool once = false;         ///< Trigger sync: play one pass, then hold the end
    bool bipolar = false;
    float depth = 1.0f;
    float offset = 0.0f;
    float slew = 0.0f;         ///< 0…1 → 0…250 ms
};

struct ShapeTime {
    bool running = false;  ///< transport playing with a valid position
    double bpm = 120.0;
    double ppq = 0.0;
};

struct ShapeFrame {
    float out = 0.0f;
    float stepTrig = 0.0f;
    float cycle = 0.0f;
    double phase = 0.0;  ///< position in the loop, 0…1
    bool active = false;
};

class ShapeSequencerDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        pulseLen_ = std::max(1, (int)std::lround(0.002 * sampleRate));
        reset();
    }
    void reset() {
        trigEdge_.reset();
        resetEdge_.reset();
        phase_ = 0.0;
        active_ = done_ = false;
        origin_ = 0.0;
        lastSeg_ = -1;
        lastPhase_ = 0.0;
        stepPulse_ = cyclePulse_ = 0;
        slew_.reset(0.0f);
    }

    void tick(const ShapeParams& p, const ShapeTable& table, float trig, float resetIn, const ShapeTime& t, ShapeFrame& f) {
        const double cycleBeats = p.lengthBeats / std::max(p.rate, 1e-6);
        const int te = trigEdge_.process(trig), re = resetEdge_.process(resetIn);
        bool newCycle = false;

        if (p.sync == ShapeOnTransport) {
            active_ = t.running;
            done_ = false;
            if (!t.running) {
                phase_ = 0.0;
                lastPhase_ = 0.0;
            } else {
                if (re > 0) origin_ = t.ppq;
                phase_ = dsp::wrap01((t.ppq - origin_) / cycleBeats);
                if (phase_ < lastPhase_) newCycle = true;
                lastPhase_ = phase_;
            }
        } else {
            if (te > 0) {
                phase_ = 0.0;
                active_ = true;
                done_ = false;
                newCycle = true;
            } else if (re > 0 && active_) {
                phase_ = 0.0;
                done_ = false;
                newCycle = true;
            }
            if (p.sync == ShapeOnGate && te < 0) active_ = false;
            if (active_ && !done_) {
                phase_ += t.bpm / 60.0 / sr_ / cycleBeats;
                if (phase_ >= 1.0) {
                    if (p.sync == ShapeOnTrigger && p.once) {
                        phase_ = 1.0;
                        done_ = true;
                        cyclePulse_ = pulseLen_;  // the end of the pass
                    } else {
                        phase_ -= std::floor(phase_);
                        newCycle = true;
                    }
                }
            }
        }

        float shaped = p.bipolar ? 0.5f : 0.0f;  // idle: the centre / the floor
        int seg = -1;
        if (active_) {
            // At the very end of a Once pass, read just inside the loop so the last value is held.
            const double pos = std::min(phase_, 1.0 - 1e-9) * p.lengthBeats;
            seg = table.find(pos);
            shaped = 0.0f;  // a gap between shapes is the floor
            if (seg >= 0) {
                const ShapeSegment& s = table.seg[(size_t)seg];
                shaped = shapeValue(s, (pos - s.start) / s.len);
            }
        }
        if (seg >= 0 && (seg != lastSeg_ || newCycle)) stepPulse_ = pulseLen_;
        lastSeg_ = seg;
        if (newCycle) cyclePulse_ = pulseLen_;

        float v = p.offset + p.depth * (p.bipolar ? 2.0f * shaped - 1.0f : shaped);
        v = std::clamp(v, -1.0f, 1.0f);
        const float tau = p.slew * p.slew * 0.25f;
        f.out = slew_.process(v, tau, sr_);
        f.stepTrig = stepPulse_ > 0 ? 1.0f : 0.0f;
        f.cycle = cyclePulse_ > 0 ? 1.0f : 0.0f;
        if (stepPulse_ > 0) --stepPulse_;
        if (cyclePulse_ > 0) --cyclePulse_;
        f.phase = phase_;
        f.active = active_;
    }

private:
    double sr_ = 48000.0;
    int pulseLen_ = 96;
    dsp::GateEdge trigEdge_, resetEdge_;
    dsp::OnePole slew_;
    double phase_ = 0.0, lastPhase_ = 0.0, origin_ = 0.0;
    bool active_ = false, done_ = false;
    int lastSeg_ = -1, stepPulse_ = 0, cyclePulse_ = 0;
};

}  // namespace bleep::patch
