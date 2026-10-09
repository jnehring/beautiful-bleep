// SPDX-License-Identifier: MIT
// Chord Osc (doc/specs/modules/chord-oscillator.md): up to six Oscillator cores
// tuned to a chord built on one pitch. The chord itself (quality, tone
// dropping and doubling, inversion, voicing) comes from the shared
// dsp/Chords.h; in Scale mode the root is quantized to a key and the chord is
// stacked from scale steps. Each voice keeps its tone ("its" third, "its"
// fifth) across chord changes, so Glide gives voice leading; voices that start
// or stop playing fade over 5 ms. A separate core plays the root alone.
#pragma once

#include "dsp/Chords.h"
#include "dsp/OscCore.h"
#include "dsp/Random.h"
#include "dsp/Scales.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

struct ChordOscParams {
    float pitch = 0.0f;   ///< Pitch input, V/oct (0 = C4)
    int octave = 0;       ///< −3…+3
    float tune = 0.0f;    ///< cents
    bool scaleMode = false;
    int chord = dsp::ChordMajor;  ///< Chromatic: index into the first 24 chord qualities
    int stack = dsp::StackTriad;  ///< Scale: dsp::ScaleStack
    int inversion = 0;    ///< −4…+4
    int voicing = 0;      ///< dsp::Voicing 0…5 (Close … Wide)
    int voices = 4;       ///< 1…6
    int key = 0;          ///< Scale mode: key pitch class
    uint16_t scale = 0xab5;  ///< Scale mode: mask relative to key
    float shape = 2.0f / 3.0f;
    float pulseWidth = 0.5f;
    float detune = 0.0f;     ///< cents, 0…50
    float glide = 0.0f;      ///< seconds
    float rootLevel = 1.0f;  ///< root voice inside Out L/R
    float stereo = 0.0f;
    float fmDepth = 0.0f;
    uint32_t seed = 1;
};

struct ChordOscFrame {
    float l = 0.0f, r = 0.0f, root = 0.0f;
    float pitch[4] = {};  ///< the four lowest sounding voices, V/oct
};

/// What the view shows: the chord as built (integers are exact).
struct ChordOscInfo {
    int rootPc = 0;      ///< chord root pitch class
    int quality = -1;    ///< chord table index, -1 if none (Scale mode clusters)
    int bassPc = 0;      ///< pitch class of the lowest voice
    int degree = 0;      ///< Scale mode: 0-based scale degree of the root (mod scale size)
    int count = 0;       ///< sounding voices
    float pitch[6] = {}; ///< voice pitches (V/oct, after glide), voice order
    bool latched = false;
};

class ChordOscDsp {
public:
    static constexpr int kMaxVoices = 6;
    static constexpr float kMinSemis = -48.37f;  ///< 16 Hz, semitones from C4
    static constexpr float kMaxSemis = 59.19f;   ///< 8 kHz

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        fadeStep_ = (float)(1.0 / (0.005 * sampleRate));
    }

    void reset() noexcept {
        rootCore_.reset();
        for (int k = 0; k < kMaxVoices; ++k) {
            cores_[k].reset();
            fade_[k] = 0.0f;
            glided_[k] = 0.0f;
        }
        seedPhases_ = ~0u;
        built_ = false;
        latched_ = false;
        lastLatch_ = false;
        glidedRoot_ = 0.0f;
        first_ = true;
        panReady_ = false;
    }

    /// Skips the Root core and the Pitch 1–4 sort while nothing reads them.
    void setOutputsUsed(bool root, bool pitches) noexcept {
        wantRoot_ = root;
        wantPitches_ = pitches;
    }

    /// One sample. `latchConnected`: the Latch input is patched (else the
    /// chord follows continuously); `latch` its value; `fm` the FM input.
    ChordOscFrame tick(const ChordOscParams& p, float fm, bool latchConnected, float latch) noexcept {
        if (seedPhases_ != p.seed) startPhases(p.seed);

        // Latch: sample the pitch and the stepped knobs at each rising edge.
        const bool high = latch >= 0.5f;
        if (!latchConnected) latched_ = false;
        else if (high && !lastLatch_) {
            latched_ = true;
            held_ = p;
        }
        lastLatch_ = high;
        const ChordOscParams& s = latched_ ? held_ : p;  // structure source
        build(s, p);

        // Root (continuous in Chromatic mode, the quantized chord root in Scale mode).
        const float rootSemis = rootSemis_ + (float)(12 * p.octave) + p.tune / 100.0f;
        const float glideA = glideCoefficient(p.glide);
        // Range guard: whole octaves, so every voice lies within 16 Hz … 8 kHz.
        float shift = 0.0f;
        while (rootSemis + shift + highest_ > kMaxSemis && rootSemis + shift + lowest_ - 12.0f >= kMinSemis) shift -= 12.0f;
        while (rootSemis + shift + lowest_ < kMinSemis) shift += 12.0f;
        if (first_) {
            for (int k = 0; k < kMaxVoices; ++k) glided_[k] = rootSemis + shift + offsets_[k];
            glidedRoot_ = rootOctaves(p);
        }

        const int n = count_;
        float active = 0.0f;
        for (int k = 0; k < kMaxVoices; ++k) {
            const float target = k < n ? 1.0f : 0.0f;
            if (first_) fade_[k] = target;
            else if (fade_[k] < target) fade_[k] = std::min(target, fade_[k] + fadeStep_);
            else if (fade_[k] > target) fade_[k] = std::max(target, fade_[k] - fadeStep_);
            active += fade_[k];
        }
        // Σ voices / √n, with n following the fades so a count change doesn't step.
        const float norm = 1.0f / std::sqrt(std::max(active, 1.0f));
        if (!panReady_ || n != panCount_ || p.stereo < panStereo_ || p.stereo > panStereo_) updatePan(n, p.stereo);
        ChordOscFrame out;
        for (int k = 0; k < kMaxVoices; ++k) {
            const float goal = rootSemis + shift + offsets_[k];
            glided_[k] = goal + glideA * (glided_[k] - goal);
            if (fade_[k] <= 0.0f) continue;  // silent voices cost nothing
            const float detune = p.detune * detune_[k] / 100.0f;
            const double dt = increment(glided_[k] + detune, p.fmDepth, fm);
            const dsp::OscWaves w = cores_[k].tick(dt, p.pulseWidth);
            const float v = dsp::OscCore::morph(w, p.shape) * fade_[k] * norm * (k == 0 ? p.rootLevel : 1.0f);
            out.l += v * panL_[k];
            out.r += v * panR_[k];
        }
        // The root core computes its pitch exactly like the Oscillator (in octaves),
        // so with Glide at 0 the two are sample-identical.
        const float rootOct = rootOctaves(p);
        glidedRoot_ = rootOct + glideA * (glidedRoot_ - rootOct);
        if (wantRoot_) {
            const double dtRoot = incrementOctaves(glidedRoot_, p.fmDepth, fm);
            out.root = dsp::OscCore::morph(rootCore_.tick(dtRoot, p.pulseWidth), p.shape);
        }

        // Pitch 1–4: the lowest voices after voicing, low to high (without detune).
        if (wantPitches_) {
            float sorted[kMaxVoices];
            for (int k = 0; k < n; ++k) sorted[k] = glided_[k];
            std::sort(sorted, sorted + n);
            for (int j = 0; j < 4; ++j) out.pitch[j] = sorted[std::min(j, n - 1)] / 12.0f;
        }
        first_ = false;
        return out;
    }

    /// The chord as built at the last tick.
    ChordOscInfo info() const noexcept {
        ChordOscInfo i;
        i.rootPc = rootPc_;
        i.quality = quality_;
        i.bassPc = bassPc_;
        i.degree = degree_;
        i.count = count_;
        for (int k = 0; k < kMaxVoices; ++k) i.pitch[k] = glided_[k] / 12.0f;
        i.latched = latched_;
        return i;
    }

    /// The detune offset of voice k in −1…+1 (× Detune cents): seeded, fixed.
    static float detuneOffset(uint32_t seed, int k) noexcept {
        return (float)(2.0 * dsp::uniform01(seed, (uint64_t)k, 0) - 1.0);
    }

    /// The pan position (−1…+1 at Stereo 100 %) of voice k of n: evenly spaced
    /// positions handed out from the centre outwards, alternating left/right,
    /// so the root sits nearest the centre.
    static float panPosition(int k, int n) noexcept {
        if (n <= 1) return 0.0f;
        // Position j = 2j/(n−1) − 1; the order by |position| is centre first, L before R.
        int order[kMaxVoices], m = 0;
        int lo = (n - 1) / 2, hi = n / 2;  // the two middle positions (equal for odd n)
        if (lo == hi) order[m++] = lo, --lo, ++hi;
        while (m < n) {
            if (lo >= 0) order[m++] = lo--;
            if (hi < n && m < n) order[m++] = hi++;
        }
        return 2.0f * (float)order[k] / (float)(n - 1) - 1.0f;
    }

private:
    double increment(float semis, float fmDepth, float fm) const noexcept {
        return incrementOctaves(semis / 12.0f, fmDepth, fm);
    }
    double incrementOctaves(float octaves, float fmDepth, float fm) const noexcept {
        // As the Oscillator: frequency in float, then linear through-zero FM.
        const double f0 = (float)dsp::osc::pitchToHz((double)octaves);
        return std::clamp(dsp::osc::linearFm(f0, (double)fmDepth, (double)fm) / sampleRate_, -0.49, 0.49);
    }

    /// The chord root in octaves, summed in the Oscillator's order.
    float rootOctaves(const ChordOscParams& p) const noexcept {
        return (float)p.octave + p.tune / 1200.0f + rootVolts_;
    }

    float glideCoefficient(float seconds) noexcept {
        if (seconds <= 0.0f) return 0.0f;
        if (seconds < glideTime_ || seconds > glideTime_) {
            glideTime_ = seconds;
            // One-pole: 99 % of a jump in `seconds` (4.6 time constants).
            glideA_ = (float)std::exp(-4.6 / (seconds * sampleRate_));
        }
        return glideA_;
    }

    void startPhases(uint32_t seed) noexcept {
        // Seeded start phases keep the voices from adding up in phase; the
        // root core starts at 0 like the Oscillator.
        seedPhases_ = seed;
        for (int k = 0; k < kMaxVoices; ++k) {
            cores_[k].reset(k == 0 ? 0.0 : dsp::uniform01(seed, (uint64_t)k, 1));
            detune_[k] = detuneOffset(seed, k);
        }
    }

    void updatePan(int n, float stereo) noexcept {
        panReady_ = true;
        panCount_ = n;
        panStereo_ = stereo;
        constexpr float kQuarterPi = 0.78539816f;
        for (int k = 0; k < n; ++k) {  // voices fading out keep their place
            const float pos = std::clamp(stereo, 0.0f, 1.0f) * panPosition(k, n);
            // Equal power, unity in the centre.
            panL_[k] = 1.41421356f * std::cos((pos + 1.0f) * kQuarterPi);
            panR_[k] = 1.41421356f * std::sin((pos + 1.0f) * kQuarterPi);
        }
    }

    /// Rebuilds the chord when anything it depends on changes. `s` holds the
    /// (possibly latched) pitch and stepped knobs, `p` the live settings.
    void build(const ChordOscParams& s, const ChordOscParams& p) noexcept {
        const bool scaleMode = p.scaleMode;
        const int chord = std::clamp(s.chord, 0, dsp::kNumChordOscQualities - 1);
        const int stack = std::clamp(s.stack, 0, dsp::kNumScaleStacks - 1);
        const int inversion = std::clamp(s.inversion, -4, 4);
        const int voicing = std::clamp(s.voicing, 0, (int)dsp::VoicingWide);
        const int voices = std::clamp(s.voices, 1, kMaxVoices);
        const uint16_t mask = (uint16_t)((p.scale & 0xfff) ? (p.scale & 0xfff) : 0xfff);
        const int key = ((p.key % 12) + 12) % 12;
        const float inSemis = 12.0f * s.pitch;
        // In Scale mode the chord depends on the quantized input; in Chromatic
        // mode only on the stepped knobs (the root is added continuously).
        const int q = scaleMode ? dsp::quantize(inSemis - (float)key, mask) + key : 0;
        if (built_ && scaleMode == bScale_ && chord == bChord_ && stack == bStack_ && inversion == bInv_ &&
            voicing == bVoicing_ && voices == bVoices_ && mask == bMask_ && key == bKey_ && q == bQ_) {
            if (!scaleMode) {
                rootSemis_ = inSemis;
                rootVolts_ = s.pitch;
                rootPc_ = ((int)std::lround(inSemis + (float)(12 * p.octave) + p.tune / 100.0f) % 12 + 12) % 12;
                bassPc_ = (rootPc_ + bassOffset_) % 12;
            }
            return;
        }
        built_ = true;
        bScale_ = scaleMode, bChord_ = chord, bStack_ = stack, bInv_ = inversion;
        bVoicing_ = voicing, bVoices_ = voices, bMask_ = mask, bKey_ = key, bQ_ = q;

        int intervals[dsp::kMaxChordTones];
        int count;
        if (scaleMode) {
            const int degree = dsp::scaleIndexOf(mask, q - key);
            const dsp::ScaleChord c = dsp::scaleChord(mask, degree, stack);
            count = c.count;
            for (int i = 0; i < count; ++i) intervals[i] = c.intervals[i];
            quality_ = c.quality;
            degree_ = ((degree % dsp::scaleSize(mask)) + dsp::scaleSize(mask)) % dsp::scaleSize(mask);
            rootSemis_ = (float)(key + c.root);
            rootVolts_ = rootSemis_ / 12.0f;
        } else {
            count = dsp::chordIntervals(chord, intervals);
            quality_ = chord;
            degree_ = 0;
            rootSemis_ = inSemis;
            rootVolts_ = s.pitch;
        }
        const dsp::ChordVoicing v = dsp::buildChord(0, intervals, count, voices, inversion, voicing);
        count_ = v.count;
        lowest_ = (float)v.lowest();
        highest_ = (float)v.highest();
        for (int k = 0; k < kMaxVoices; ++k) offsets_[k] = k < v.count ? (float)v.pitch[k] : 0.0f;
        bassOffset_ = ((v.lowest() % 12) + 12) % 12;
        const float rootAbs = rootSemis_ + (float)(12 * p.octave) + p.tune / 100.0f;
        rootPc_ = ((int)std::lround(rootAbs) % 12 + 12) % 12;
        bassPc_ = (rootPc_ + bassOffset_) % 12;
        // Voices that did not play keep gliding from where the chord is now.
        for (int k = 0; k < kMaxVoices; ++k)
            if (fade_[k] <= 0.0f) glided_[k] = rootAbs + offsets_[k];
    }

    double sampleRate_ = 48000.0;
    float fadeStep_ = 1.0f / 240.0f;
    dsp::OscCore cores_[kMaxVoices];
    dsp::OscCore rootCore_;
    float fade_[kMaxVoices] = {}, glided_[kMaxVoices] = {}, detune_[kMaxVoices] = {};
    float offsets_[kMaxVoices] = {};
    float panL_[kMaxVoices] = {}, panR_[kMaxVoices] = {};
    float glidedRoot_ = 0.0f, glideTime_ = -1.0f, glideA_ = 0.0f;
    uint32_t seedPhases_ = ~0u;
    bool first_ = true, panReady_ = false, wantRoot_ = true, wantPitches_ = true;
    int panCount_ = 0;
    float panStereo_ = -1.0f;

    // The built chord.
    bool built_ = false, bScale_ = false;
    int bChord_ = 0, bStack_ = 0, bInv_ = 0, bVoicing_ = 0, bVoices_ = 0, bKey_ = 0, bQ_ = 0;
    uint16_t bMask_ = 0;
    int count_ = 1, quality_ = -1, rootPc_ = 0, bassPc_ = 0, bassOffset_ = 0, degree_ = 0;
    float rootSemis_ = 0.0f, rootVolts_ = 0.0f, lowest_ = 0.0f, highest_ = 0.0f;

    // Latch.
    bool latched_ = false, lastLatch_ = false;
    ChordOscParams held_;
};

}  // namespace bleep::patch
