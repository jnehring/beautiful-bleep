// SPDX-License-Identifier: GPL-3.0-or-later
// Chord Quantizer core (doc/specs/modules/chord-quantizer.md): one pitch in, a
// voiced chord out. The input picks a root (chromatic, a scale degree, or the
// board's harmony), a chord is built on it (Chords.h: tone selection,
// inversion, voicing), placed by Anchor and Range, optionally voice-led, and
// strummed onto four pitch outputs and a note set. Notes leave through a
// callback, so this stays free of the engine's types.
#pragma once

#include "dsp/Chords.h"
#include "dsp/Harmony.h"
#include "dsp/Scales.h"
#include "dsp/SeqNotes.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum CqMode { CqChromatic = 0, CqDiatonic, CqFollow };
enum CqLead { CqLeadOff = 0, CqLeadSmooth, CqLeadSmoothTop };

constexpr int kCqVoices = 4;

/// Voicing setting → Chords.h voicing: Close, Drop 2, Drop 3, Spread, Open.
inline int cqVoicing(int setting) noexcept {
    static constexpr int map[5] = {dsp::VoicingClose, dsp::VoicingDrop2, dsp::VoicingDrop3, dsp::VoicingSpread,
                                   dsp::VoicingOpenUp};
    return map[std::clamp(setting, 0, 4)];
}

/// Nearest note of a mask with hysteresis (the Quantizer's rule): the
/// remembered note only moves once the input is more than `hyst` semitones
/// past the midpoint into another note's band.
class CqHysteresis {
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

struct CqParams {
    int mode = CqChromatic;
    int root = 0;              ///< key root pitch class (Diatonic)
    int scale = 1;             ///< dsp::scales() index
    int chord = dsp::ChordMajor;  ///< chord table index (Chromatic)
    int stack = dsp::StackTriad;  ///< scale stack (Diatonic)
    int inversion = 0;
    int voices = 4;
    int voicing = 0;           ///< setting index (cqVoicing)
    int lead = CqLeadOff;
    int anchor = dsp::AnchorBass;
    int range = 2;             ///< octaves
    bool strumDown = false;
    float strum = 0.0f;        ///< seconds
    float hysteresis = 0.1f;   ///< semitones
    float velocity = 0.8f;
};

struct CqInput {
    float pitch = 0.0f;        ///< V/oct
    float trig = 0.0f, gate = 0.0f;
    bool trigPatched = false, gatePatched = false;
    const dsp::HarmonyState* harmony = nullptr;  ///< a valid context, or null
};

struct CqOutputs {
    float voice[kCqVoices]{};
    float root = 0.0f;
    float change = 0.0f;
};

/// The chord to build: a root (semitones from C4) and intervals above it.
struct CqChordDef {
    int root = 0;
    int count = 3;
    int intervals[dsp::kMaxChordTones]{0, 4, 7};
    int bassPc = -1;           ///< Follow: a slash chord's bass pitch class
    bool operator==(const CqChordDef& o) const noexcept {
        if (root != o.root || count != o.count || bassPc != o.bassPc) return false;
        for (int i = 0; i < count; ++i)
            if (intervals[i] != o.intervals[i]) return false;
        return true;
    }
    uint16_t mask() const noexcept { return dsp::intervalMask(intervals, count); }
};

class ChordQuantizerDsp {
public:
    /// The chord definition for an input of `semis` (semitones from C4),
    /// without hysteresis (tests and previews).
    static CqChordDef define(const CqParams& p, float semis, const dsp::HarmonyState* h) noexcept {
        CqHysteresis hy;
        return defineWith(p, semis, h, hy);
    }

    /// Builds the voiced chord (sorted low to high) for a definition, placed
    /// near `target` semitones; with `prev` (sorted) and lead on, voice-led.
    static dsp::ChordVoicing voice(const CqParams& p, const CqChordDef& d, float target, const int* prev,
                                   int prevCount) noexcept {
        const int voices = std::clamp(p.voices, 1, kCqVoices);
        const int voicing = cqVoicing(p.voicing);
        dsp::ChordVoicing v;
        if (p.lead != CqLeadOff && prevCount > 0) {
            dsp::VoiceLeadOptions o;
            o.keepTop = p.lead == CqLeadSmoothTop;
            o.useTarget = true;
            o.anchor = p.anchor;
            o.target = target;
            v = dsp::leadChord(prev, prevCount, d.root, d.intervals, d.count, voices, voicing, o);
        } else {
            v = dsp::selectTones(d.root, d.intervals, d.count, voices);
            int inversion = p.inversion;
            if (d.bassPc >= 0) {  // a slash chord: invert until the bass is lowest
                inversion = 0;
                for (int k = 0; k < v.count; ++k)
                    if (dsp::pitchClass(v.pitch[k]) == d.bassPc) {
                        int idx[dsp::kMaxChordVoices];
                        dsp::voiceOrder(v, idx);
                        for (int j = 0; j < v.count; ++j)
                            if (idx[j] == k) inversion = j;
                        break;
                    }
            }
            dsp::invertChord(v, inversion);
            dsp::applyVoicing(v, voicing);
            v.transpose(dsp::octaveShiftTo(v, p.anchor, target));
        }
        fold(v, p.range);
        return v;
    }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        hyst_.reset();
        trig_.reset();
        gate_.reset();
        haveChord_ = sampledOnce_ = leadWasOn_ = false;
        prevCount_ = 0;
        count_ = 0;
        shift_ = 0;
        notes_.reset();
        sounding_ = notesDirty_ = false;
        for (int i = 0; i < kCqVoices; ++i) due_[i] = -1, applied_[i] = true;
    }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events;
    /// `room` is how many events the output can still take this sample.
    template <class Emit>
    void tick(const CqParams& p, const CqInput& in, CqOutputs& out, int room, Emit&& emit) noexcept {
        out.change = 0.0f;
        const bool trigEdge = in.trigPatched && trig_.process(in.trig) > 0;
        if (!in.trigPatched) sampledOnce_ = false;
        const bool sampling = !in.trigPatched || !sampledOnce_ || trigEdge;
        if (trigEdge) sampledOnce_ = true;

        if (sampling) {
            const float semis = in.pitch * 12.0f;
            const CqChordDef d = defineWith(p, semis, in.harmony, hyst_);
            const int config = p.inversion * 1000003 + p.voices * 10007 + p.voicing * 1009 + p.lead * 101 +
                               p.anchor * 11 + p.range + (p.mode << 24);
            if (!haveChord_ || !(d == def_) || config != config_ || trigEdge) {
                // Voice leading moves from the current chord; the first chord (and
                // the first after Voice Leading is switched on) uses Inversion.
                const bool lead = p.lead != CqLeadOff && leadWasOn_ && count_ > 0;
                const dsp::ChordVoicing v = voice(p, d, semis, target_, lead ? count_ : 0);
                base_.count = v.sorted(base_.pitch);
                shift_ = 0;
                def_ = d;
                config_ = config;
                haveChord_ = true;
                leadWasOn_ = p.lead != CqLeadOff;
            } else if (p.lead == CqLeadOff) {
                // The register follows the input, with a margin against flicker.
                dsp::ChordVoicing v;
                v.count = base_.count;
                for (int i = 0; i < v.count; ++i) v.pitch[i] = base_.pitch[i] + shift_;
                if (std::fabs(dsp::anchorPitch(v, p.anchor) - semis) > 6.0f + std::max(0.5f, p.hysteresis))
                    shift_ += dsp::octaveShiftTo(v, p.anchor, semis);
            }
            int next[kCqVoices];
            const int n = base_.count;
            for (int i = 0; i < n; ++i) next[i] = base_.pitch[i] + shift_;
            bool differs = n != count_;
            for (int i = 0; i < n && !differs; ++i) differs = next[i] != target_[i];
            if (differs || trigEdge) schedule(p, next, n, differs, trigEdge, emit);
        }

        // Strum: voices reach their new pitch on their own sample.
        for (int i = 0; i < count_; ++i) {
            if (due_[i] < 0) continue;
            if (due_[i] == 0) {
                if (!changeFired_) {
                    changeFired_ = true;
                    if (changePending_) out.change = 1.0f;
                }
                current_[i] = target_[i];
                applied_[i] = true;
                notesDirty_ = true;
            }
            --due_[i];
        }

        // Notes.
        const int gateEdge = in.gatePatched ? gate_.process(in.gate) : 0;
        const bool open = !in.gatePatched || gate_.high();
        if (gateEdge < 0 || (!open && sounding_)) {
            if (room >= notes_.count()) {
                notes_.release(emit);
                sounding_ = false;
            }
        } else if (open && (notesDirty_ || !sounding_) && room >= 2 * kCqVoices) {
            dsp::SeqNote ns[kCqVoices];
            int m = 0;
            for (int i = 0; i < count_; ++i)
                if (applied_[i]) {
                    const int s = foldMidi(current_[i]);
                    ns[m].note = 60 + s;
                    ns[m].pitch = (float)s / 12.0f;
                    ns[m].velocity = std::clamp(p.velocity, 0.01f, 1.0f);
                    ++m;
                }
            notes_.set(ns, m, emit);
            sounding_ = true;
            notesDirty_ = false;
        }

        // Pitch outputs.
        int hi = current_[0], lo = current_[0];
        for (int i = 1; i < count_; ++i) hi = std::max(hi, current_[i]), lo = std::min(lo, current_[i]);
        for (int i = 0; i < kCqVoices; ++i)
            out.voice[i] = (float)(i < count_ ? current_[i] : hi) / 12.0f;
        const int rootPc = dsp::pitchClass(def_.root);
        out.root = (float)(lo + dsp::pitchClass(rootPc - lo)) / 12.0f;
    }

    /// Ends every sounding note.
    template <class Emit>
    void release(Emit&& emit) noexcept {
        notes_.release(emit);
        sounding_ = false;
    }

    int count() const noexcept { return count_; }
    const int* voices() const noexcept { return current_; }
    const int* previous() const noexcept { return prev_; }
    int previousCount() const noexcept { return prevCount_; }
    const CqChordDef& chord() const noexcept { return def_; }
    bool sounding() const noexcept { return sounding_; }
    int soundingNotes() const noexcept { return notes_.count(); }

private:
    static int foldMidi(int semis) noexcept {
        while (semis + 60 > 127) semis -= 12;
        while (semis + 60 < 0) semis += 12;
        return semis;
    }
    /// Range: tones more than `range` octaves above the bass fold down.
    static void fold(dsp::ChordVoicing& v, int range) noexcept {
        if (v.count <= 0) return;
        const int lo = v.lowest(), span = 12 * std::clamp(range, 1, 4);
        for (int i = 0; i < v.count; ++i)
            while (v.pitch[i] > lo + span) v.pitch[i] -= 12;
    }

    static CqChordDef defineWith(const CqParams& p, float semis, const dsp::HarmonyState* h,
                                 CqHysteresis& hy) noexcept {
        CqChordDef d;
        const float hyst = std::clamp(p.hysteresis, 0.0f, 0.5f);
        if (p.mode == CqFollow && h) {
            // The context's chord; the input only sets the register.
            d.root = hy.process(semis, 1, h->chordRoot, hyst);  // the root nearest the input
            if (h->quality >= 0 && h->quality < dsp::kNumChordQualities) {
                d.count = dsp::chordIntervals(h->quality, d.intervals);
            } else {
                d.count = 0;
                for (int k = 0; k < 12 && d.count < dsp::kMaxChordTones; ++k)
                    if ((h->chord >> k) & 1u) d.intervals[d.count++] = k;
                if (d.count == 0) d.intervals[d.count++] = 0;
            }
            d.bassPc = h->bass != h->chordRoot ? h->bass : -1;
            return d;
        }
        if (p.mode == CqChromatic) {
            d.root = hy.process(semis, 0xfff, 0, hyst);
            d.count = dsp::chordIntervals(std::clamp(p.chord, 0, dsp::kNumChordQualities - 1), d.intervals);
            return d;
        }
        // Diatonic (and Follow without a bus): the harmony's key and scale if any.
        const int key = h ? h->key : p.root;
        const uint16_t scale =
            h ? h->scale : dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)].mask;
        const int q = hy.process(semis, scale, key, hyst);
        const int idx = dsp::scaleIndexOf(scale, q - key);
        const dsp::ScaleChord c = dsp::scaleChord(scale, idx, std::clamp(p.stack, 0, dsp::kNumScaleStacks - 1), true);
        d.root = key + c.root;
        d.count = std::max(1, c.count);
        for (int i = 0; i < d.count; ++i) d.intervals[i] = c.intervals[i];
        return d;
    }

    template <class Emit>
    void schedule(const CqParams& p, const int* next, int n, bool differs, bool retrigger, Emit& emit) noexcept {
        const bool hadChord = count_ > 0;
        if (differs && hadChord) {  // shown faintly by the view
            prevCount_ = count_;
            for (int i = 0; i < count_; ++i) prev_[i] = target_[i];
        }
        if (n != count_) {  // voice count changed: everything moves now
            for (int i = 0; i < n; ++i) current_[i] = i < count_ ? current_[i] : next[i];
            count_ = n;
        }
        for (int i = 0; i < n; ++i) target_[i] = next[i];
        if (retrigger && sounding_) {
            notes_.release(emit);
            sounding_ = false;
            for (int i = 0; i < n; ++i) applied_[i] = false;
        }
        const double spacing = n > 1 ? (double)std::clamp(p.strum, 0.0f, 0.1f) * sampleRate_ / (double)(n - 1) : 0.0;
        for (int k = 0; k < n; ++k) {
            const int i = p.strumDown ? n - 1 - k : k;
            due_[i] = (int64_t)std::llround(spacing * (double)k);
        }
        changeFired_ = false;
        changePending_ = differs && hadChord;
    }

    double sampleRate_ = 48000.0;
    CqHysteresis hyst_;
    dsp::GateEdge trig_, gate_;
    bool haveChord_ = false, sampledOnce_ = false, leadWasOn_ = false;
    CqChordDef def_;
    int config_ = 0;
    struct {
        int count = 0;
        int pitch[dsp::kMaxChordVoices]{};
    } base_;
    int shift_ = 0;
    int target_[kCqVoices]{}, current_[kCqVoices]{}, prev_[kCqVoices]{};
    int count_ = 0, prevCount_ = 0;
    int64_t due_[kCqVoices]{-1, -1, -1, -1};
    bool applied_[kCqVoices]{true, true, true, true};
    bool changeFired_ = true, changePending_ = false;
    dsp::SeqNoteSet<kCqVoices> notes_;
    bool sounding_ = false, notesDirty_ = false;
};

}  // namespace bleep::patch
