// SPDX-License-Identifier: GPL-3.0-only
// Pitch Snap DSP (doc/specs/modules/pitch-snap.md): a real-time pitch corrector.
//
// The shared tracker (common/dsp/PitchTrack.h) measures the period of the input.
// The shifting itself is pitch-synchronous overlap-add: short Hann-windowed grains,
// two input periods long, are laid down one output period apart. Consecutive grains
// are cut from the input a whole number of input periods apart, so they line up with
// the waveform and add without a seam; a grain is repeated (up) or skipped (down)
// when the read position has to catch up. With Formant Preserve on the grains are
// copied unchanged, so the vowel stays where it was while the pitch moves; with it
// off each grain is resampled by the pitch ratio, as a plain pitch shifter would.
//
// What it shifts by is decided here: the note nearest to the (slowly averaged) input
// pitch in the chosen scale, with some stickiness, the error to it scaled by Amount,
// a retune Speed, and Drift, which lets the pitch wobble around its average through
// untouched (vibrato survives) while the average itself is pulled onto the note.
// Where nothing pitched is heard the input passes through, delayed to match.
#pragma once

#include "dsp/Delay.h"
#include "dsp/PitchTrack.h"
#include "dsp/Scales.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr float kSnapC4Hz = 261.6255653f;

struct PitchSnapParams {
    uint16_t scaleMask = 0xab5;  ///< pitch classes the notes may be, bit 0 = C (absolute, not relative to a root)
    uint16_t chordMask = 0;      ///< chord tones (absolute), used by `target` 1 and 2
    int target = 0;              ///< 0 scale, 1 chord tones, 2 chord tones if within a semitone, else scale
    float amount = 1.0f;         ///< 0 … 1 share of the error that is corrected
    float speed = 1.0f;          ///< 0 … 1: 1 = hard (instant), 0 = very slow
    float drift = 0.0f;          ///< 0 … 1 share of the pitch wobble left alone
    float driftTime = 0.3f;      ///< seconds the "average pitch" is taken over
    float offsetSemis = 0.0f;    ///< added to the target note (harmony), semitones
    bool formant = true;         ///< Formant Preserve
    float minHz = 70.0f, maxHz = 900.0f;
    int tracking = 1;            ///< 0 fast, 1 steady, 2 rock solid
    bool aligned = true;         ///< delay the audio by the tracker's lag so a correction lands on the audio it was measured on
};

struct PitchSnapFrame {
    float out = 0.0f;
    float target = 0.0f;   ///< note aimed at, V/oct (held while unvoiced)
    float pitch = 0.0f;    ///< detected input pitch, V/oct (held)
    float shift = 0.0f;    ///< applied shift in octaves (semitones / 12)
    bool voiced = false;
};

class PitchSnapDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        tracker_.prepare(sampleRate);
        line_.resize((int)(0.4 * sr_));
        applied_.tracking = -1;
        reset();
    }
    void reset() {
        tracker_.reset();
        line_.clear();
        written_ = 0;
        for (auto& g : grains_) g.active = false;
        countdown_ = 0.0;
        anchor_ = 0.0;
        haveAnchor_ = false;
        dryDelay_ = (float)(0.012 * sr_);
        mix_ = 0.0f;
        active_ = false;
        haveIn_ = false;
        sinceVoiced_ = 1e9f;
        psIn_ = psInst_ = psCentre_ = psSel_ = 0.0f;
        note_ = 0;
        corr_ = 0.0f;
        periodIn_ = 0.0f;
        frame_ = {};
    }

    PitchSnapFrame tick(float x, const PitchSnapParams& p) noexcept {
        configure(p);
        const float dt = 1.0f / (float)sr_;
        line_.write(x);
        ++written_;
        if (tracker_.push(x) && tracker_.voiced() && tracker_.hz() > 0.0f) {
            psIn_ = 12.0f * std::log2(tracker_.hz() / kSnapC4Hz);
            periodIn_ = (float)(sr_ / (double)tracker_.hz());
            sinceVoiced_ = 0.0f;
            haveIn_ = true;
        }
        sinceVoiced_ += dt;
        const bool heard = haveIn_ && sinceVoiced_ < 0.045f;

        float shiftSemis = 0.0f;
        if (heard) {
            if (!active_) {  // an onset: start from the input's own pitch
                active_ = true;
                psInst_ = psCentre_ = psSel_ = psIn_;
                note_ = chooseNote(psSel_, p, false);
                corr_ = 0.0f;
                haveAnchor_ = false;
                countdown_ = 0.0;
            }
            psInst_ += (1.0f - std::exp(-dt / 0.002f)) * (psIn_ - psInst_);
            psCentre_ += (1.0f - std::exp(-dt / std::max(p.driftTime, 0.02f))) * (psIn_ - psCentre_);
            psSel_ += (1.0f - std::exp(-dt / 0.06f)) * (psIn_ - psSel_);
            note_ = chooseNote(psSel_, p, true);
            const float ref = psInst_ + p.drift * (psCentre_ - psInst_);
            const float want = p.amount * ((float)note_ - ref);
            const float tau = 0.6f * (1.0f - p.speed) * (1.0f - p.speed);
            corr_ += (tau < 1e-4f ? 1.0f : 1.0f - std::exp(-dt / tau)) * (want - corr_);
            shiftSemis = corr_ + p.offsetSemis;
        } else {
            active_ = false;
        }

        // ---- grains ---------------------------------------------------------
        const float ratio = std::clamp(std::exp2(shiftSemis / 12.0f), 0.25f, 4.0f);
        if (heard) {
            const float tin = std::clamp(periodIn_, 8.0f, (float)(0.02 * sr_));
            if (countdown_ <= 0.0) {
                spawn(tin, tin / ratio, ratio, p.formant);
                countdown_ += (double)(tin / ratio);
            }
            countdown_ -= 1.0;
        }
        float wet = 0.0f;
        const double newest = (double)(written_ - 1);
        for (auto& g : grains_) {
            if (!g.active) continue;
            const float u = (float)(g.n / g.len);
            const float win = 0.5f - 0.5f * std::cos(6.2831853f * u);
            const double at = g.centre + (g.n - 0.5 * g.len) * g.step;
            wet += g.gain * win * line_.readHermite(std::max(newest - at, 0.0));
            g.n += 1.0;
            if (g.n >= g.len) g.active = false;
        }

        // ---- dry path and crossfade ----------------------------------------
        const float dry = line_.readHermite((double)dryDelay_);
        const float target = heard ? 1.0f : 0.0f;
        mix_ += (1.0f - std::exp(-dt / (heard ? 0.006f : 0.02f))) * (target - mix_);
        PitchSnapFrame f;
        f.out = dry + mix_ * (wet - dry);
        f.target = ((float)note_ + p.offsetSemis) / 12.0f;
        f.pitch = psIn_ / 12.0f;
        f.shift = shiftSemis / 12.0f;
        f.voiced = heard;
        frame_ = f;
        return f;
    }

    int note() const noexcept { return note_; }
    bool voiced() const noexcept { return frame_.voiced; }
    float inputSemis() const noexcept { return psIn_; }
    const dsp::PitchTracker& tracker() const noexcept { return tracker_; }
    /// Typical delay of the corrected signal, in seconds.
    float latencySeconds() const noexcept { return dryDelay_ / (float)sr_; }

private:
    struct Grain {
        bool active = false;
        double centre = 0.0;  ///< input position at the grain's middle
        double n = 0.0;       ///< output samples since the grain began (fractional start)
        double len = 1.0;
        double step = 1.0;    ///< input samples per output sample
        float gain = 1.0f;
    };

    void spawn(float tin, float tout, float ratio, bool formant) noexcept {
        const double newest = (double)(written_ - 1);
        const double tw = formant ? (double)tin : (double)tout;
        const double len = 2.0 * tw, step = formant ? 1.0 : (double)(tin / tout);
        const double latest = newest - 2.0 - (aligned_ ? (double)tracker_.latencySeconds() * sr_ : 0.0);  // the freshest centre we cut from
        if (!haveAnchor_ || latest - anchor_ > 3.0 * tin || anchor_ > latest) {
            anchor_ = latest;
            haveAnchor_ = true;
        } else {
            const double m = std::floor((latest - anchor_) / (double)tin);
            anchor_ += m * (double)tin;  // a whole number of input periods: m = 0 repeats the last grain
        }
        Grain* slot = nullptr;
        for (auto& g : grains_)
            if (!g.active) { slot = &g; break; }
        if (!slot) {  // all busy (extreme ratios): recycle the oldest
            slot = &grains_[0];
            for (auto& g : grains_)
                if (g.n > slot->n) slot = &g;
        }
        slot->active = true;
        slot->centre = anchor_;
        slot->n = std::max(-countdown_, 0.0);
        slot->len = len;
        slot->step = step;
        slot->gain = formant ? std::min(2.0f, tout / tin) : 1.0f;
        // the grain's middle is len/2 output samples ahead: that is the delay of the shifted signal
        const float lat = (float)(0.5 * len + (newest - anchor_));
        dryDelay_ += 0.05f * (std::clamp(lat, 16.0f, (float)(0.3 * sr_)) - dryDelay_);
    }

    /// The note for the (slowly averaged) input pitch, semitones from C4. `sticky`: keep the
    /// current note until another is clearly closer.
    int chooseNote(float semis, const PitchSnapParams& p, bool sticky) const noexcept {
        const int cand = nearest(semis, p);
        if (!sticky || cand == note_) return cand;
        const float dCur = std::fabs(semis - (float)note_), dNew = std::fabs(semis - (float)cand);
        return dNew + 0.2f < dCur ? cand : note_;
    }
    static int nearest(float semis, const PitchSnapParams& p) noexcept {
        const uint16_t scale = (p.scaleMask & 0xfff) ? p.scaleMask : (uint16_t)0xfff;
        const uint16_t chord = (p.chordMask & 0xfff) ? p.chordMask : scale;
        if (p.target == 1) return dsp::quantize(semis, chord);
        const int s = dsp::quantize(semis, scale);
        if (p.target == 2) {
            const int c = dsp::quantize(semis, chord);
            return std::fabs((float)c - semis) <= 1.0f ? c : s;
        }
        return s;
    }

    void configure(const PitchSnapParams& p) noexcept {
        aligned_ = p.aligned;
        if (p.minHz == applied_.minHz && p.maxHz == applied_.maxHz && p.tracking == applied_.tracking) return;
        applied_ = p;
        dsp::PitchTrackSettings s;
        s.minHz = p.minHz;
        s.maxHz = p.maxHz;
        s.minConfidence = 0.8f;
        s.guardSeconds = p.tracking == 0 ? 0.0f : (p.tracking == 1 ? 0.03f : 0.08f);
        s.vote = p.tracking == 0 ? 1 : (p.tracking == 1 ? 3 : 5);
        tracker_.configure(s);
    }

    double sr_ = 48000.0;
    dsp::PitchTracker tracker_;
    dsp::RingDelay line_;
    uint64_t written_ = 0;
    PitchSnapParams applied_;
    Grain grains_[8];
    double countdown_ = 0.0, anchor_ = 0.0;
    bool haveAnchor_ = false, active_ = false, haveIn_ = false, aligned_ = true;
    float dryDelay_ = 576.0f, mix_ = 0.0f, sinceVoiced_ = 1e9f;
    float psIn_ = 0.0f, psInst_ = 0.0f, psCentre_ = 0.0f, psSel_ = 0.0f, corr_ = 0.0f, periodIn_ = 0.0f;
    int note_ = 0;
    PitchSnapFrame frame_;
};

}  // namespace bleep::patch
