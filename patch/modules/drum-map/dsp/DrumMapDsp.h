// SPDX-License-Identifier: MIT
// Drum Map core (specs/modules/drum-map.md): kick, snare and hats played from
// a 5 × 5 map of patterns. Each map node holds 32 levels (0–255) per voice;
// X/Y interpolate between nodes, Density thresholds the levels, Chaos moves
// them by a seeded amount that repeats per bar block. The factory map is
// generated here from a small set of rhythmic rules (drumFactoryMap), not
// copied from anywhere. Steps come from dsp::SeqClock; notes go through
// dsp::SeqNoteSet and leave through a callback.
#pragma once

#include "dsp/Random.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum DrumVoice { DrumKick = 0, DrumSnare, DrumHats, kDrumVoices };
constexpr int kDrumGrid = 5, kDrumNodes = kDrumGrid * kDrumGrid, kDrumSteps = 32;

using DrumLane = std::array<uint8_t, kDrumSteps>;
struct DrumNode {
    std::array<DrumLane, kDrumVoices> lanes{};
};
/// Nodes by index row · 5 + column (column = X, row = Y).
using DrumMapTable = std::array<DrumNode, kDrumNodes>;

// ---- The factory map --------------------------------------------------------
// A node at map position (u, v) ∈ [0, 1]² (u = X: straight → broken,
// v = Y: sparse → busy) is built from the rules of spec §4.2.

namespace drummap {

inline double clamp01(double x) noexcept { return std::clamp(x, 0.0, 1.0); }
inline double ramp(double x, double from, double to) noexcept { return clamp01((x - from) / (to - from)); }

/// Metric weight of a 16th inside a bar.
inline double metric(int s) noexcept {
    s &= 15;
    return s == 0 ? 1.0 : s == 8 ? 0.85 : s % 4 == 0 ? 0.7 : s % 2 == 0 ? 0.45 : 0.25;
}

/// Kick level of 16th `s` (0..15) in a bar.
inline double kick(int s, double u, double v) noexcept {
    static constexpr double straight[16] = {255, 0, 0, 0, 170, 0, 0, 0, 215, 0, 0, 0, 170, 0, 0, 0};
    // 3 + 3 + 2 eighths (16ths 0, 6, 12), pushed 16ths around beats 2 and 4.
    static constexpr double broken[16] = {255, 0, 0, 120, 0, 0, 205, 0, 60, 0, 175, 0, 140, 0, 95, 0};
    static constexpr double pickup[16] = {0, 0, 0.5, 0, 0, 0, 0, 1.0, 0, 0, 0.7, 0, 0, 0.6, 0, 0.9};
    const double base = straight[s] + (broken[s] - straight[s]) * u;
    const double p = pickup[s] * (60.0 + 80.0 * v) * ramp(v, 0.0, 0.5);
    return std::max(base, p);
}

/// Snare level of 16th `s`.
inline double snare(int s, double u, double v) noexcept {
    static constexpr double back[16] = {0, 0, 0, 0, 230, 0, 0, 0, 0, 0, 0, 0, 230, 0, 0, 0};
    static constexpr double half[16] = {0, 0, 0, 0, 0, 0, 0, 0, 230, 0, 0, 0, 0, 0, 0, 0};
    static constexpr double moved[16] = {0, 0, 0, 0, 0, 0, 0, 200, 0, 0, 0, 0, 210, 0, 0, 120};
    static constexpr double ghost[16] = {0, 0, 0, 1.0, 0, 0.8, 0, 0.5, 0, 0, 0, 1.0, 0, 0.8, 0, 0.6};
    // Overlapping crossfades (by maximum), so a backbone survives every blend.
    const double wB = 1.0 - ramp(u, 0.3, 0.65), wH = clamp01(1.0 - std::fabs(u - 0.6) / 0.45), wD = ramp(u, 0.5, 0.8);
    const double base = std::max({back[s] * wB, half[s] * wH, moved[s] * wD});
    const double g = ghost[s] * (40.0 + 70.0 * v) * ramp(v, 0.0, 0.5);
    return std::max(base, g);
}

/// Hat level of 16th `s`: quarters → 8ths → 16ths with v, strong hats moving
/// to the off-beats with u.
inline double hats(int s, double u, double v) noexcept {
    auto at = [&](bool beat, bool eighth) {
        if (beat) return 210.0;
        if (eighth) return 90.0 + 120.0 * ramp(v, 0.0, 0.5);
        return 40.0 + 120.0 * ramp(v, 0.5, 1.0);
    };
    const bool quarter = s % 4 == 0, offEighth = s % 4 == 2;
    const double on = at(quarter, offEighth);
    const double off = at(offEighth, quarter);  // the off-beats take the strong role
    const double k = u * u * (3.0 - 2.0 * u);
    return on + (off - on) * k;
}

}  // namespace drummap

/// One node of the factory map.
inline DrumNode drumFactoryNode(int column, int row) noexcept {
    const double u = (double)column / (kDrumGrid - 1), v = (double)row / (kDrumGrid - 1);
    DrumNode n;
    for (int step = 0; step < kDrumSteps; ++step) {
        const int s = step & 15;
        double k = drummap::kick(s, u, v), sn = drummap::snare(s, u, v), h = drummap::hats(s, u, v);
        if (step >= 28) {  // the last quarter of bar 2 is left open for fills
            const double f = (80.0 + 30.0 * (step - 28)) * drummap::ramp(v, 0.0, 0.75);
            k = std::max(k * 0.8, step == 28 || step == 30 ? f * 0.8 : 0.0);
            sn = std::max(sn * 0.8, step >= 29 ? f : 0.0);
            h *= 0.75;
        }
        if (k > 180.0) sn *= 0.4;  // kick and snare rarely collide
        n.lanes[DrumKick][(size_t)step] = (uint8_t)std::lround(std::clamp(k, 0.0, 255.0));
        n.lanes[DrumSnare][(size_t)step] = (uint8_t)std::lround(std::clamp(sn, 0.0, 255.0));
        n.lanes[DrumHats][(size_t)step] = (uint8_t)std::lround(std::clamp(h, 0.0, 255.0));
    }
    return n;
}

/// The whole factory map (generated once).
inline const DrumMapTable& drumFactoryMap() {
    static const DrumMapTable map = [] {
        DrumMapTable m{};
        for (int r = 0; r < kDrumGrid; ++r)
            for (int c = 0; c < kDrumGrid; ++c) m[(size_t)(r * kDrumGrid + c)] = drumFactoryNode(c, r);
        return m;
    }();
    return map;
}

/// The map's level for a voice and step at X/Y (0..1), bilinear between nodes.
inline float drumLevel(const DrumMapTable& m, float x, float y, int voice, int step) noexcept {
    const float gx = std::clamp(x, 0.0f, 1.0f) * (kDrumGrid - 1), gy = std::clamp(y, 0.0f, 1.0f) * (kDrumGrid - 1);
    const int c0 = std::min((int)gx, kDrumGrid - 2), r0 = std::min((int)gy, kDrumGrid - 2);
    const float fx = gx - (float)c0, fy = gy - (float)r0;
    auto at = [&](int c, int r) { return (float)m[(size_t)(r * kDrumGrid + c)].lanes[(size_t)voice][(size_t)step]; };
    const float top = at(c0, r0) + (at(c0 + 1, r0) - at(c0, r0)) * fx;
    const float bottom = at(c0, r0 + 1) + (at(c0 + 1, r0 + 1) - at(c0, r0 + 1)) * fx;
    return top + (bottom - top) * fy;
}

/// The Chaos block of a bar: every 1, 2, 4 or 8 bars, or Frozen (4) = 0.
inline int64_t drumChaosBlock(int64_t bar, int chaosRate) noexcept {
    static constexpr int64_t bars[4] = {1, 2, 4, 8};
    if (chaosRate < 0 || chaosRate > 3) return 0;
    const int64_t b = bars[chaosRate];
    return bar >= 0 ? bar / b : -((-bar + b - 1) / b);
}

/// A level after Chaos: L + Chaos · 255 · (u − 0.5), u seeded per block, step and voice.
inline float drumChaos(float level, float chaos, uint32_t seed, int64_t block, int step, int voice) noexcept {
    if (chaos <= 0.0f) return level;
    const double u = dsp::uniform01(seed, (uint64_t)(block * kDrumSteps + step), (uint64_t)voice);
    return std::clamp(level + std::clamp(chaos, 0.0f, 1.0f) * 255.0f * (float)(u - 0.5), 0.0f, 255.0f);
}

/// Rates offered by the Drum Map (names in Tempo.h's noteValues()).
inline const std::array<const char*, 5>& drumRateNames() {
    static const std::array<const char*, 5> n{"1/8", "1/8T", "1/16", "1/16T", "1/32"};
    return n;
}

struct DrumParams {
    float x = 0.25f, y = 0.25f;
    std::array<float, kDrumVoices> density{0.5f, 0.5f, 0.5f};
    float fillAmount = 0.35f, chaos = 0.0f, accent = 0.78f, swing = 0.5f, noteLength = 0.5f;
    int length = 32, rate = 2, chaosRate = 0;
    uint32_t seed = 1;
    std::array<int, kDrumVoices> note{36, 38, 42};
};

struct DrumTime {
    bool running = false, started = false;
    double bpm = 120.0, ppq = 0.0;
};

struct DrumInputs {
    float clock = 0.0f, reset = 0.0f, fill = 0.0f;
    bool clockPatched = false;
};

struct DrumOutputs {
    std::array<float, kDrumVoices> trig{}, accent{}, vel{};
    float step = 0.0f, end = 0.0f;
};

class DrumMapDsp {
public:
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
    }
    void reset() noexcept {
        clock_.reset();
        notes_.reset();
        for (auto& v : voices_) v = VoiceState{};
        played_ = false;
        step_ = 0;
        block_ = 0;
    }

    /// The map (factory nodes with the user's edits), or null for the factory map.
    void setMap(const DrumMapTable* m) noexcept { map_ = m; }
    const DrumMapTable& map() const noexcept { return map_ ? *map_ : drumFactoryMap(); }

    int step() const noexcept { return step_; }
    int64_t block() const noexcept { return block_; }
    /// Bit v: voice v's note sounds.
    uint32_t hits() const noexcept {
        uint32_t m = 0;
        for (int v = 0; v < kDrumVoices; ++v)
            if (voices_[(size_t)v].sounding >= 0) m |= 1u << v;
        return m;
    }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const DrumParams& p, const DrumInputs& in, const DrumTime& t, DrumOutputs& out, Emit&& emit) noexcept {
        out.end = 0.0f;
        for (int v = 0; v < kDrumVoices; ++v) out.trig[(size_t)v] = out.accent[(size_t)v] = 0.0f;
        const int length = std::clamp(p.length, 1, kDrumSteps);
        if (configured_ && (in.clockPatched != clocked_ || length != length_)) {
            releaseAll(emit);
            played_ = false;
        }
        configured_ = true;
        clocked_ = in.clockPatched;
        length_ = length;
        // Notes end after Note Length; a changed note number ends the old one.
        for (int v = 0; v < kDrumVoices; ++v) {
            VoiceState& s = voices_[(size_t)v];
            if (s.sounding >= 0 && (s.sounding != std::clamp(p.note[(size_t)v], 0, 127) || (s.left > 0 && --s.left == 0)))
                noteOff(v, emit);
        }

        dsp::SeqClockInput ci;
        ci.clocked = in.clockPatched;
        ci.clock = in.clock;
        ci.reset = in.reset;
        ci.running = t.running;
        ci.started = t.started;
        ci.ppq = t.ppq;
        ci.bpm = t.bpm;
        const auto& names = drumRateNames();
        ci.stepBeats = dsp::noteValueBeats(dsp::noteValueIndex(names[(size_t)std::clamp(p.rate, 0, 4)]));
        ci.swing = p.swing;
        clock_.tick(ci, [&](const dsp::SeqClockEvent& e) {
            if (e.type == dsp::SeqClockEvent::Release) {
                releaseAll(emit);
                if (e.reason == dsp::SeqClockEvent::Reset) played_ = false;
            } else {
                const int64_t bar = in.clockPatched ? (e.n >= 0 ? e.n / 16 : -1) : (int64_t)std::floor(t.ppq / 4.0 + 1e-9);
                playStep(p, e.n, bar, e.stepSamples, in.fill >= 0.5f, out, emit);
            }
        });
        for (int v = 0; v < kDrumVoices; ++v) out.vel[(size_t)v] = voices_[(size_t)v].velocity;
        out.step = length > 1 ? (float)step_ / (float)(length - 1) : 0.0f;
    }

    /// The level after Chaos of a voice at a step, as the module plays it now.
    float level(const DrumParams& p, int voice, int step, int64_t block) const noexcept {
        return drumChaos(drumLevel(map(), p.x, p.y, voice, step), p.chaos, p.seed, block, step, voice);
    }

private:
    struct VoiceState {
        int sounding = -1;
        int64_t left = 0;
        float velocity = 0.0f;
    };

    template <class Emit>
    void playStep(const DrumParams& p, int64_t n, int64_t bar, double stepSamples, bool fill, DrumOutputs& out,
                  Emit& emit) noexcept {
        const int step = (int)mod(n, length_);
        if (played_ && step == 0) out.end = 1.0f;
        played_ = true;
        step_ = step;
        block_ = drumChaosBlock(bar, p.chaosRate == 4 ? -1 : p.chaosRate);
        for (int v = 0; v < kDrumVoices; ++v) {
            const float L = level(p, v, step, block_);
            const float D = std::clamp(p.density[(size_t)v] + (fill ? p.fillAmount : 0.0f), 0.0f, 1.0f);
            if (!(L > (1.0f - D) * 255.0f && L > 0.0f)) continue;
            VoiceState& s = voices_[(size_t)v];
            s.velocity = 0.3f + 0.7f * L / 255.0f;
            out.trig[(size_t)v] = 1.0f;
            if (L >= std::clamp(p.accent, 0.0f, 1.0f) * 255.0f) out.accent[(size_t)v] = 1.0f;
            const int note = std::clamp(p.note[(size_t)v], 0, 127);
            if (s.sounding >= 0 && s.sounding != note) noteOff(v, emit);
            notes_.noteOn({note, dsp::notePitch(note), s.velocity}, emit);  // a sounding note: off first
            s.sounding = note;
            s.left = std::max<int64_t>(1, (int64_t)std::llround(std::clamp(p.noteLength, 0.1f, 1.0f) * stepSamples));
        }
    }

    template <class Emit>
    void noteOff(int v, Emit& emit) noexcept {
        VoiceState& s = voices_[(size_t)v];
        // Another voice may share the note number: only the last one ends it.
        bool shared = false;
        for (int o = 0; o < kDrumVoices; ++o)
            if (o != v && voices_[(size_t)o].sounding == s.sounding) shared = true;
        if (!shared) notes_.noteOff(s.sounding, emit);
        s.sounding = -1;
        s.left = 0;
    }

    template <class Emit>
    void releaseAll(Emit& emit) noexcept {
        for (auto& s : voices_) s.sounding = -1, s.left = 0;
        notes_.release(emit);
    }

    double sampleRate_ = 48000.0;
    const DrumMapTable* map_ = nullptr;
    dsp::SeqClock clock_;
    dsp::SeqNoteSet<4> notes_;
    std::array<VoiceState, kDrumVoices> voices_{};
    bool configured_ = false, clocked_ = false, played_ = false;
    int length_ = 32, step_ = 0;
    int64_t block_ = 0;
};

}  // namespace bleep::patch
