// SPDX-License-Identifier: GPL-3.0-only
// Note Gate core (doc/specs/modules/note-gate.md): decides for every note-on of
// a `notes` stream whether it passes, and what it becomes: range window,
// velocity floor/ceiling, rule lanes (steps of the bar, every Nth note,
// density limit), pitch-class remap and velocity curve. A note-off follows its
// note-on: notes that were blocked never produce one, and a note that passed
// always ends, whatever the gate does in between. Header-only, no JUCE.
#pragma once

#include "dsp/NoteStream.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kGateCurvePoints = 17;
constexpr int kGateSteps = 16;

/// The edited parts of the module (node data).
struct GateTable {
    std::array<int8_t, 12> remap{{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}};  ///< pitch class → pitch class, −1 blocks it
    std::array<float, kGateCurvePoints> curve{};                              ///< velocity out at 17 evenly spaced inputs
    uint16_t steps = 0xffff;                                                   ///< bit k: step k of the bar lets notes through
    GateTable() {
        for (int i = 0; i < kGateCurvePoints; ++i) curve[(size_t)i] = (float)i / (kGateCurvePoints - 1);
    }
};

enum GateVerdict : int { GatePassed = 0, GateClosed, GateRange, GateVelocity, GateRule, GateRemap };

struct GateParams {
    int low = 0, high = 127;
    bool blockInside = false;
    float floor = 0.0f, ceiling = 1.0f;
    bool liftFloor = false;
    bool drawnCurve = false;
    float bend = 0.0f;
    bool remap = false;
    bool open = true;  ///< the gate input lets notes through now
    // rule lanes
    bool stepsOn = false;
    bool ppqValid = false;
    double ppq = 0.0;
    double barBeats = 4.0;
    int every = 1, offset = 0;
    int densityMax = 0;  ///< passed notes per window, 0 = off
    double windowBeats = 1.0;
    double bpm = 120.0;
    double sampleRate = 48000.0;
};

class NoteGateDsp {
public:
    void reset() noexcept {
        owner_.reset();
        token_.fill(0);
        recentCount_ = 0;
        counter_ = 0;
    }

    /// The step of the bar (0…15) nearest to `ppq`.
    static int stepAt(double ppq, double barBeats) noexcept {
        const double bar = std::max(barBeats, 1.0), pos = (ppq / bar - std::floor(ppq / bar)) * kGateSteps;
        return (int)std::floor(pos + 0.5) % kGateSteps;
    }

    /// Velocity after the curve: Knob (Bend −1…+1: soft notes louder … quieter) or Drawn.
    static float curve(float v, bool drawn, float bend, const GateTable& t) noexcept {
        v = std::clamp(v, 0.0f, 1.0f);
        if (!drawn) return std::pow(v, std::exp2(-2.0f * std::clamp(bend, -1.0f, 1.0f)));
        const float x = v * (kGateCurvePoints - 1);
        const int i = std::min((int)x, kGateCurvePoints - 2);
        const float f = x - (float)i;
        return std::clamp(t.curve[(size_t)i] * (1.0f - f) + t.curve[(size_t)i + 1] * f, 0.0f, 1.0f);
    }

    /// A note-on at `at` (a sample count the caller keeps, for the density lane).
    template <class Emit>
    GateVerdict noteOn(int note, float pitch, float velocity, const GateParams& p, const GateTable& t, int64_t at, Emit&& emit) noexcept {
        const size_t k = (size_t)std::clamp(note, 0, 127);
        if (!p.open) return GateClosed;
        const bool inside = note >= std::min(p.low, p.high) && note <= std::max(p.low, p.high);
        if (inside == p.blockInside) return GateRange;
        float vel = velocity;
        if (vel < p.floor) {
            if (!p.liftFloor) return GateVelocity;
            vel = p.floor;
        }
        vel = std::min(vel, std::max(p.ceiling, p.floor));
        // rule lanes: every active lane must agree
        if (p.stepsOn && p.ppqValid && !((t.steps >> stepAt(p.ppq, p.barBeats)) & 1u)) return GateRule;
        const uint64_t index = counter_++;  // counts the notes that got this far
        if (p.every > 1 && (int)(index % (uint64_t)p.every) != std::clamp(p.offset, 0, p.every - 1)) return GateRule;
        if (p.densityMax > 0) {
            const int64_t window = std::max<int64_t>(1, (int64_t)dsp::beatsToSamples(p.windowBeats, p.bpm, p.sampleRate));
            int inWindow = 0;
            for (int i = 0; i < recentCount_; ++i)
                if (at - recent_[(size_t)i] < window) ++inWindow;
            if (inWindow >= p.densityMax) return GateRule;
        }
        int out = note;
        if (p.remap) {
            const int pc = ((note % 12) + 12) % 12, target = t.remap[(size_t)pc];
            if (target < 0) return GateRemap;
            out = note - pc + std::clamp((int)target, 0, 11);
            if (out < 0 || out > 127) return GateRemap;
        }
        if (p.densityMax > 0) remember(at);
        const float outVel = std::max(0.008f, curve(vel, p.drawnCurve, p.bend, t));
        if (token_[k]) owner_.off(lastOut_[k], token_[k], emit);
        lastOut_[k] = out;
        token_[k] = owner_.on(out, pitch + (float)(out - note) / 12.0f, outVel, emit);
        return GatePassed;
    }

    template <class Emit>
    void noteOff(int note, Emit&& emit) noexcept {
        const size_t k = (size_t)std::clamp(note, 0, 127);
        if (!token_[k]) return;
        owner_.off(lastOut_[k], token_[k], emit);
        token_[k] = 0;
    }

    template <class Emit>
    void flush(Emit&& emit) noexcept {
        owner_.allOff(emit);
        token_.fill(0);
    }

    int sounding() const noexcept { return owner_.count(); }

private:
    void remember(int64_t at) noexcept {
        if (recentCount_ >= kRecent) {
            for (int i = 1; i < recentCount_; ++i) recent_[(size_t)(i - 1)] = recent_[(size_t)i];
            --recentCount_;
        }
        recent_[(size_t)recentCount_++] = at;
    }
    static constexpr int kRecent = 32;
    dsp::NoteOwner owner_;
    std::array<uint32_t, 128> token_{};
    std::array<int, 128> lastOut_{};
    std::array<int64_t, kRecent> recent_{};
    int recentCount_ = 0;
    uint64_t counter_ = 0;
};

}  // namespace bleep::patch
