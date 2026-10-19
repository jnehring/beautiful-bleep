// SPDX-License-Identifier: GPL-3.0-or-later
// Tuner DSP (doc/specs/modules/tuner.md): the shared pitch tracker
// (common/dsp/PitchTrack.h) plus the note arithmetic of a chromatic tuner: the
// nearest note of equal temperament around a reference A, the error in cents,
// a smoothed reading that does not smear across a change of note, and an
// in-tune gate with a settling time and hysteresis.
#pragma once

#include "dsp/PitchTrack.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

/// The note nearest to `hz`: MIDI number (A4 = 69) and the error in cents (−50 … +50).
struct NoteReading {
    int midi = 69;
    float cents = 0.0f;
};

inline NoteReading nearestNote(float hz, float referenceA) noexcept {
    const double midi = 69.0 + 12.0 * std::log2((double)std::max(hz, 1.0f) / (double)std::max(referenceA, 1.0f));
    const double n = std::floor(midi + 0.5);
    return {(int)n, (float)((midi - n) * 100.0)};
}
inline float noteHz(int midi, float referenceA) noexcept { return referenceA * std::exp2((float)(midi - 69) / 12.0f); }

struct TunerParams {
    float referenceA = 440.0f;
    float tolerance = 5.0f;  ///< cents either side of the note that count as in tune
    float damping = 0.08f;   ///< seconds, smoothing of the reading
    float minHz = 40.0f, maxHz = 1400.0f;
    int guard = 1;           ///< 0 off, 1 light, 2 firm
};

struct TunerFrame {
    float cents = 0.0f;   ///< smoothed error, held while no pitch is heard
    float inTune = 0.0f;  ///< gate
    float volts = 0.0f;   ///< smoothed pitch, V/oct (0 = C4), held
    bool voiced = false;
};

class TunerDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        tracker_.prepare(sampleRate);
        applied_.guard = -1;
        reset();
    }
    void reset() {
        tracker_.reset();
        logHz_ = 0.0f;
        have_ = false;
        voicedFor_ = quietFor_ = inTuneFor_ = 0.0f;
        inTune_ = false;
        lastNote_ = 69;
        frame_ = {};
    }

    void tick(float x, const TunerParams& p, TunerFrame& f) noexcept {
        configure(p);
        const float dt = 1.0f / (float)sr_;
        if (tracker_.push(x)) {
            if (tracker_.voiced() && tracker_.hz() > 0.0f) {
                const float lg = std::log2(tracker_.hz());
                // a jump of more than 60 cents is a new note: show it at once instead of sliding there
                if (!have_ || std::fabs(lg - logHz_) > 0.05f) logHz_ = lg;
                target_ = lg;
                have_ = true;
                quietFor_ = 0.0f;
            }
        }
        quietFor_ += dt;
        const bool heard = have_ && quietFor_ < 0.18f;
        if (have_) logHz_ += (1.0f - std::exp(-dt / std::max(p.damping, 0.002f))) * (target_ - logHz_);
        voicedFor_ = heard ? voicedFor_ + dt : 0.0f;

        const NoteReading n = nearestNote(have_ ? std::exp2(logHz_) : p.referenceA, p.referenceA);
        lastNote_ = n.midi;
        const float tol = inTune_ ? p.tolerance * 1.4f : p.tolerance;
        const bool close = heard && std::fabs(n.cents) <= tol;
        inTuneFor_ = close ? inTuneFor_ + dt : 0.0f;
        if (!close) inTune_ = false;
        else if (inTuneFor_ > 0.06f) inTune_ = true;

        f.cents = have_ ? n.cents : 0.0f;
        f.inTune = inTune_ ? 1.0f : 0.0f;
        f.volts = have_ ? (logHz_ - std::log2(261.6255653f)) : 0.0f;
        f.voiced = heard;
        frame_ = f;
    }

    float hz() const noexcept { return have_ ? std::exp2(logHz_) : 0.0f; }
    int midi() const noexcept { return lastNote_; }
    bool haveNote() const noexcept { return have_; }
    float confidence() const noexcept { return tracker_.confidence(); }
    const TunerFrame& frame() const noexcept { return frame_; }
    const dsp::PitchTracker& tracker() const noexcept { return tracker_; }

private:
    void configure(const TunerParams& p) noexcept {
        if (p.minHz == applied_.minHz && p.maxHz == applied_.maxHz && p.guard == applied_.guard) return;
        applied_ = p;
        dsp::PitchTrackSettings s;
        s.minHz = p.minHz;
        s.maxHz = p.maxHz;
        s.minConfidence = 0.8f;
        s.guardSeconds = p.guard <= 0 ? 0.0f : (p.guard == 1 ? 0.04f : 0.1f);
        s.vote = 3;
        tracker_.configure(s);
    }

    double sr_ = 48000.0;
    dsp::PitchTracker tracker_;
    TunerParams applied_;
    float logHz_ = 0.0f, target_ = 0.0f, voicedFor_ = 0.0f, quietFor_ = 0.0f, inTuneFor_ = 0.0f;
    bool have_ = false, inTune_ = false;
    int lastNote_ = 69;
    TunerFrame frame_;
};

}  // namespace bleep::patch
