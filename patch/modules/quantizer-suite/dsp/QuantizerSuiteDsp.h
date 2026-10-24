// SPDX-License-Identifier: GPL-3.0-only
// Quantizer Suite core (doc/specs/modules/quantizer-suite.md): four quantizer
// channels, each quantizing to a scale ∧ note mask, transposing in scale
// steps, arpeggiating a scale chord, or following the board's harmony; with
// sampling, slew and a legato note per channel. Channels run A → D each
// sample, so normalled inputs add no delay. Notes leave through a callback
// `emit(channel, on, note, pitch, velocity)`, so this stays free of the
// engine's types.
#pragma once

#include "dsp/Chords.h"
#include "dsp/Harmony.h"
#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum QsMode { QsQuantize = 0, QsTranspose, QsArp, QsFollow };
enum QsSample { QsContinuous = 0, QsTrigger, QsTrackHold };
enum QsOrder { QsUp = 0, QsDown, QsUpDown, QsConverge, QsRandom };
enum QsTarget { QsScale = 0, QsChord, QsChordScale, QsRoot };

constexpr int kQsChannels = 4;
constexpr int kQsMaxArp = 24;  ///< tones of the largest arpeggio (Ninth × 4 octaves, deduplicated ≤ 20)

/// Scale steps of the Arp chords (Triad, Seventh, Sus2, Sus4, Fifth, Ninth,
/// Octave) and their semitones on the Chromatic scale.
struct QsArpChord {
    const char* name;
    int count;
    int steps[5];
    int chromatic[5];
};
inline const QsArpChord& qsArpChord(int i) noexcept {
    static const QsArpChord c[7] = {
        {"Triad", 3, {0, 2, 4}, {0, 4, 7}},          {"Seventh", 4, {0, 2, 4, 6}, {0, 4, 7, 10}},
        {"Sus2", 3, {0, 1, 4}, {0, 2, 7}},           {"Sus4", 3, {0, 3, 4}, {0, 5, 7}},
        {"Fifth", 2, {0, 4}, {0, 7}},                {"Ninth", 5, {0, 2, 4, 6, 8}, {0, 4, 7, 10, 14}},
        {"Octave", 1, {0}, {0}},
    };
    return c[std::clamp(i, 0, 6)];
}

/// The arpeggio index for the `counter`-th step over `size` tones (not Random).
inline int qsOrderIndex(int64_t counter, int size, int order) noexcept {
    if (size <= 1) return 0;
    auto mod = [](int64_t a, int64_t m) { return (int)(((a % m) + m) % m); };
    switch (order) {
        case QsDown: return size - 1 - mod(counter, size);
        case QsUpDown: {
            const int k = mod(counter, 2 * size - 2);
            return k < size ? k : 2 * size - 2 - k;
        }
        case QsConverge: {
            const int k = mod(counter, size);
            return (k & 1) ? size - 1 - k / 2 : k / 2;
        }
        default: return mod(counter, size);
    }
}

/// Nearest note of a mask with hysteresis (the Quantizer's rule): the
/// remembered note only moves once the input is more than `hyst` semitones
/// past the midpoint into another note's band.
class QsHysteresis {
public:
    void reset() noexcept { have_ = false; }
    int process(float semis, uint16_t mask, int root, float hyst) noexcept {
        const int q = dsp::quantizeSemis(semis, mask, root);
        if (!have_ || q == last_ || !dsp::inScale(mask, last_ - root)) {
            have_ = true;
            return last_ = q;
        }
        const int nb = dsp::stepSemis(last_, mask, root, semis > (float)last_ ? 1 : -1);
        const float mid = 0.5f * (float)(last_ + nb);
        if (std::fabs(semis - (float)last_) <= std::fabs(mid - (float)last_) + hyst) return last_;
        return last_ = q;
    }

private:
    bool have_ = false;
    int last_ = 0;
};

struct QsChannelParams {
    int mode = QsQuantize;
    int root = 0;
    int scale = 1;           ///< dsp::scales() index
    int sample = QsContinuous;
    int octave = 0;
    int chord = 0;           ///< qsArpChord index
    int order = QsUp;
    int span = 1;
    int target = QsChord;
    bool notes = true;
    uint16_t mask = 0xfff;   ///< allowed notes relative to the root (node data)
    int steps = 0;
    float slew = 0.0f;       ///< seconds
    const dsp::HarmonyState* harmony = nullptr;  ///< a valid context, or null
};

struct QsParams {
    QsChannelParams ch[kQsChannels];
    float hysteresis = 0.1f;  ///< semitones
    float velocity = 0.8f;
    uint32_t seed = 0;
};

struct QsInput {
    float in[kQsChannels]{};     ///< already normalled (B reads A when unpatched, …)
    float trig[kQsChannels]{};   ///< already normalled
    bool trigFed[kQsChannels]{}; ///< a Trig reaches the channel (its own or an earlier one)
    float reset = 0.0f;
    bool running = false;        ///< transport playing with a valid position
    bool started = false;
    double ppq = 0.0;
};

struct QsOutputs {
    float out[kQsChannels]{};
    float change[kQsChannels]{};
};

class QuantizerSuiteDsp {
public:
    /// Allowed notes: scale ∧ mask (relative to the key); empty → the root only.
    static uint16_t allowed(uint16_t scale, uint16_t mask) noexcept {
        const uint16_t a = (uint16_t)(scale & mask & 0xfff);
        return a ? a : (uint16_t)1;
    }

    /// The arpeggio's tones (semitones, low to high) on the quantized note `q`.
    static int arpTones(int q, uint16_t allowedMask, int key, int chord, int span, int* out) noexcept {
        const QsArpChord& c = qsArpChord(chord);
        span = std::clamp(span, 1, 4);
        int n = 0;
        const bool chromatic = (allowedMask & 0xfff) == 0xfff;
        const int size = dsp::scaleSize(allowedMask);
        const int idx = dsp::scaleIndexOf(allowedMask, q - key);
        for (int o = 0; o < span; ++o)
            for (int k = 0; k < c.count && n < kQsMaxArp; ++k)
                out[n++] = chromatic ? q + c.chromatic[k] + 12 * o
                                     : key + dsp::scaleNote(allowedMask, idx + c.steps[k] + o * size);
        std::sort(out, out + n);
        return (int)(std::unique(out, out + n) - out);
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        for (auto& c : ch_) c = Channel{};
        reset_.reset();
        origin_ = 0;
        transportOn_ = false;
    }

    /// One sample. `emit(channel, on, note, pitch, velocity)` receives note
    /// events; `room` is how many events the output can still take.
    template <class Emit>
    void tick(const QsParams& p, const QsInput& in, QsOutputs& out, int room, Emit&& emit) noexcept {
        const bool resetEdge = reset_.process(in.reset) > 0;
        // The transport-driven arpeggio step (1/16 notes), phase-locked.
        if (in.running) {
            if (in.started || !transportOn_) origin_ = 0;
            if (resetEdge) origin_ = (int64_t)std::floor(in.ppq / 0.25) + 1;
        }
        const int64_t step16 = (int64_t)std::floor(in.ppq / 0.25) - origin_;
        const bool stepped = in.running && (!transportOn_ || in.started || step16 != lastStep16_);
        const bool stopped = !in.running && transportOn_;
        transportOn_ = in.running;
        lastStep16_ = step16;

        for (int k = 0; k < kQsChannels; ++k) {
            Channel& c = ch_[k];
            const QsChannelParams& cp = p.ch[k];
            out.change[k] = 0.0f;
            const bool trigEdge = c.trig.process(in.trig[k]) > 0;
            if (resetEdge) c.arpReset = true;

            // Key, scale and allowed notes; Follow without a context acts as Quantize.
            const dsp::HarmonyState* h = cp.harmony;
            const int key = h ? h->key : cp.root;
            const uint16_t scale =
                h ? h->scale : dsp::scales()[(size_t)std::clamp(cp.scale, 0, (int)dsp::scales().size() - 1)].mask;
            const uint16_t allow = allowed(scale, cp.mask);
            const int mode = cp.mode == QsFollow && !h ? QsQuantize : cp.mode;
            const float x = in.in[k] * 12.0f;
            const float hyst = std::clamp(p.hysteresis, 0.0f, 0.5f);

            bool update = false, retrigger = false;
            int note = c.note;
            if (mode == QsArp) {
                const bool clocked = in.trigFed[k];
                bool advance = false;
                int64_t counter = 0;
                if (clocked) {
                    if (trigEdge) {
                        c.arpCount = c.arpReset ? 0 : c.arpCount + 1;
                        c.arpReset = false;
                        advance = true;
                    }
                    counter = c.arpCount;
                } else if (stepped) {
                    advance = true;
                    counter = step16;
                    c.arpReset = false;
                }
                if (stopped && !clocked) c.release = true;
                if (advance || !c.have) {
                    const int q = c.hyst.process(x, allow, key, hyst);
                    int tones[kQsMaxArp];
                    const int size = arpTones(q, allow, key, cp.chord, cp.span, tones);
                    int idx;
                    if (cp.order == QsRandom && size > 1) {
                        const double u = dsp::uniform01(p.seed, (uint64_t)counter, 101 + (uint64_t)k);
                        if (c.lastArp >= 0 && c.lastArp < size) {
                            const int r = std::min((int)(u * (size - 1)), size - 2);
                            idx = r >= c.lastArp ? r + 1 : r;
                        } else {
                            idx = std::min((int)(u * size), size - 1);
                        }
                    } else {
                        idx = qsOrderIndex(counter, size, cp.order);
                    }
                    c.lastArp = idx;
                    c.arpIndex = idx;
                    note = tones[((idx + cp.steps) % size + size) % size];
                    update = true;
                    retrigger = advance && note == c.note;
                }
            } else {
                bool sampleNow = true;
                if (in.trigFed[k] && cp.sample == QsTrigger) sampleNow = trigEdge;
                else if (in.trigFed[k] && cp.sample == QsTrackHold) sampleNow = in.trig[k] >= 0.5f;
                // Unchanged input and settings: nothing to do (most samples).
                const uint64_t cfg = (uint64_t)mode | (uint64_t)cp.target << 2 | (uint64_t)(cp.steps + 32) << 4 |
                                     (uint64_t)key << 10 | (uint64_t)allow << 14 |
                                     (h ? (uint64_t)h->chordRoot << 26 | (uint64_t)h->chord << 30 : 0) |
                                     (uint64_t)(cp.octave + 8) << 42 | (uint64_t)(hyst * 1000.0f) << 46;
                if (sampleNow && c.have && !trigEdge && !(x < c.lastX || x > c.lastX) && cfg == c.lastCfg) sampleNow = false;
                if (sampleNow || !c.have) {
                    c.lastX = x;
                    c.lastCfg = cfg;
                    if (mode == QsFollow) {
                        const dsp::HarmonyState& hs = *h;
                        switch (cp.target) {
                            case QsScale: note = dsp::stepSemis(c.hyst.process(x, allow, key, hyst), allow, key, cp.steps); break;
                            case QsChordScale: {  // a chord tone within a semitone wins
                                const int cn = dsp::chordSemis(hs, x);
                                note = std::fabs((float)cn - x) <= 1.0f ? cn : c.hyst.process(x, allow, key, hyst);
                                break;
                            }
                            case QsRoot: note = c.hyst.process(x, 1, hs.chordRoot, hyst); break;
                            default:
                                note = dsp::stepSemis(c.hyst.process(x, hs.chord, hs.chordRoot, hyst), hs.chord, hs.chordRoot,
                                                      cp.steps);
                                break;
                        }
                    } else {
                        const int q = c.hyst.process(x, allow, key, hyst);
                        note = mode == QsTranspose ? dsp::stepSemis(q, allow, key, cp.steps) : q;
                    }
                    update = true;
                    retrigger = trigEdge && cp.sample == QsTrigger && in.trigFed[k] && note + 12 * cp.octave == c.out;
                }
            }

            if (update) {
                const int o = std::clamp(note + 12 * cp.octave, -120, 120);
                c.note = note;
                if (o != c.out || !c.have) {
                    if (c.have) out.change[k] = 1.0f;
                    startGlide(c, o, cp.slew);
                    c.out = o;
                    c.notesDirty = true;
                } else if (retrigger) {
                    out.change[k] = 1.0f;
                    c.retrig = true;
                }
                c.have = true;
            }
            if (cp.sample == QsTrigger && in.trigFed[k] && trigEdge && mode != QsArp) out.change[k] = 1.0f;

            // Slew: a fixed time per change, linear in pitch.
            if (c.glideLeft > 0) {
                c.value += c.glideStep;
                if (--c.glideLeft == 0) c.value = (float)c.out / 12.0f;
            }
            out.out[k] = c.value;

            // Notes on channel k.
            notes(k, c, cp, p.velocity, room, emit);
        }
    }

    /// Ends every sounding note.
    template <class Emit>
    void release(Emit&& emit) noexcept {
        for (int k = 0; k < kQsChannels; ++k) {
            Channel& c = ch_[k];
            if (c.sounding >= 0) emit(k, false, c.sounding, c.soundingPitch, 0.0f);
            c.sounding = -1;
        }
    }

    int note(int k) const noexcept { return ch_[k].out; }
    int arpIndex(int k) const noexcept { return ch_[k].arpIndex; }
    int soundingNote(int k) const noexcept { return ch_[k].sounding; }

private:
    struct Channel {
        QsHysteresis hyst;
        dsp::GateEdge trig;
        bool have = false;
        int note = 0;           ///< mode result before Octave
        int out = 0;            ///< Out note (semitones from C4)
        float value = 0.0f;     ///< Out after slew (V/oct)
        float glideStep = 0.0f;
        int64_t glideLeft = 0;
        int64_t arpCount = -1;
        bool arpReset = true;
        int lastArp = -1, arpIndex = 0;
        bool notesDirty = false, retrig = false, release = false, wait = false;
        float lastX = 0.0f;     ///< input and settings of the last computation
        uint64_t lastCfg = 0;
        int sounding = -1;      ///< MIDI note sounding on this channel
        float soundingPitch = 0.0f;
    };

    void startGlide(Channel& c, int target, float slew) noexcept {
        const float to = (float)target / 12.0f;
        const int64_t n = (int64_t)std::llround((double)std::clamp(slew, 0.0f, 2.0f) * sampleRate_);
        if (n <= 0 || !c.have) {
            c.value = to;
            c.glideLeft = 0;
            return;
        }
        c.glideStep = (to - c.value) / (float)n;
        c.glideLeft = n;
    }

    static int foldMidi(int semis) noexcept {
        while (semis + 60 > 127) semis -= 12;
        while (semis + 60 < 0) semis += 12;
        return semis + 60;
    }

    template <class Emit>
    void notes(int k, Channel& c, const QsChannelParams& cp, float velocity, int& room, Emit& emit) noexcept {
        if (!cp.notes || c.release) {
            if (c.sounding >= 0 && room >= 1) {
                emit(k, false, c.sounding, c.soundingPitch, 0.0f);
                --room;
                c.sounding = -1;
            }
            if (c.sounding >= 0) return;  // no room: try again next sample
            // Notes off: the current note starts when they are on again;
            // transport stop: silent until the next step.
            c.wait = cp.notes;
            c.release = false;
            c.notesDirty = c.retrig = false;
            return;
        }
        if (c.wait && !c.notesDirty && !c.retrig) return;
        if (!c.have || room < 2) return;
        c.wait = false;
        const int midi = foldMidi(c.out);
        const float pitch = (float)(midi - 60) / 12.0f;
        const float vel = std::clamp(velocity, 0.01f, 1.0f);
        if (c.sounding < 0) {
            emit(k, true, midi, pitch, vel);
            --room;
        } else if (midi != c.sounding) {  // legato: the new note first
            emit(k, true, midi, pitch, vel);
            emit(k, false, c.sounding, c.soundingPitch, 0.0f);
            room -= 2;
        } else if (c.retrig) {
            emit(k, false, c.sounding, c.soundingPitch, 0.0f);
            emit(k, true, midi, pitch, vel);
            room -= 2;
        } else {
            c.notesDirty = false;
            return;
        }
        c.sounding = midi;
        c.soundingPitch = pitch;
        c.notesDirty = c.retrig = false;
    }

    double sampleRate_ = 48000.0;
    Channel ch_[kQsChannels];
    dsp::GateEdge reset_;
    int64_t origin_ = 0, lastStep16_ = 0;
    bool transportOn_ = false;
};

}  // namespace bleep::patch
