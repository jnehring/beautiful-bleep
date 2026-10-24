// SPDX-License-Identifier: GPL-3.0-only
// Swarm (doc/specs/modules/swarm-oscillator.md): up to 16 oscillators spread over
// a chord or scale around one root. Spread opens the cloud from unison into
// the chord (each oscillator lands on the nearest chord note of its scaled
// position), each oscillator glides there at its own seeded pace, detune
// follows a pattern plus a slow seeded drift, a ring of phase modulation
// (Cross FM) couples neighbours, and the oscillators are scattered in stereo.
//
// Control (targets, glides, detune, drift, gains, pans) runs every
// kControl samples and is interpolated per sample; the root pitch and the
// oscillators run per sample, optionally at 2× with a half-band decimator.
#pragma once

#include "dsp/Chords.h"
#include "dsp/OscCore.h"
#include "dsp/Oversampler.h"
#include "dsp/Random.h"
#include "dsp/Scales.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

/// The Swarm's pitch sets (4.2): chords, then every scale of Scales.h.
struct SwarmSet {
    const char* name;
    enum Kind : uint8_t { Unison, Mask, Steps } kind;
    uint16_t mask;  ///< Mask: pitch classes, repeated every octave
    int8_t step;    ///< Steps: an evenly stacked interval (quartal, quintal)
};

inline int numSwarmSets() noexcept { return 16 + (int)dsp::scales().size(); }

inline SwarmSet swarmSet(int i) noexcept {
    using dsp::chordMask;
    static const SwarmSet chords[16] = {
        {"Unison", SwarmSet::Unison, 1, 0},
        {"Octaves", SwarmSet::Mask, 0x001, 0},
        {"Fifths", SwarmSet::Mask, 0x081, 0},
        {"Sus2", SwarmSet::Mask, chordMask(dsp::ChordSus2), 0},
        {"Sus4", SwarmSet::Mask, chordMask(dsp::ChordSus4), 0},
        {"Major", SwarmSet::Mask, chordMask(dsp::ChordMajor), 0},
        {"Minor", SwarmSet::Mask, chordMask(dsp::ChordMinor), 0},
        {"Major 7", SwarmSet::Mask, chordMask(dsp::ChordMajor7), 0},
        {"Minor 7", SwarmSet::Mask, chordMask(dsp::ChordMinor7), 0},
        {"Dominant 7", SwarmSet::Mask, chordMask(dsp::ChordDominant7), 0},
        {"Minor 9", SwarmSet::Mask, chordMask(dsp::ChordMinor9), 0},
        {"Major 9", SwarmSet::Mask, chordMask(dsp::ChordMajor9), 0},
        {"Add 9", SwarmSet::Mask, chordMask(dsp::ChordAdd9), 0},
        {"Quartal", SwarmSet::Steps, 0, 5},
        {"Quintal", SwarmSet::Steps, 0, 7},
        {"Cluster", SwarmSet::Mask, 0x007, 0},
    };
    if (i < 16) return chords[std::max(i, 0)];
    const auto& sc = dsp::scales()[(size_t)std::min(i - 16, (int)dsp::scales().size() - 1)];
    return {sc.name, SwarmSet::Mask, sc.mask, 0};
}

constexpr int kSwarmMinor7 = 8;  ///< the default set

struct SwarmParams {
    float pitch = 0.0f;   ///< root, V/oct: Octave + Coarse/12 + Fine/1200 + Pitch input
    float count = 8.0f;   ///< 1…16, the last oscillator fades in fractionally
    int set = kSwarmMinor7;
    float spread = 0.3f;
    int range = 2;        ///< octaves, 1…4
    float warp = 0.0f;
    float detune = 8.0f;  ///< cents
    float drift = 0.2f;
    float crossFm = 0.0f;
    float glide = 0.3f;   ///< seconds
    float width = 0.5f;
    int pattern = 0;      ///< Fan, Alternate, Random, Outer
    int stack = 0;        ///< Up, Centred, Down
    bool high = false;    ///< 2× oversampling
    uint32_t seed = 1;
};

struct SwarmFrame {
    float l = 0.0f, r = 0.0f, root = 0.0f, upper = 0.0f, spread = 0.0f;
};

class SwarmDsp {
public:
    static constexpr int kMaxOsc = 16;
    static constexpr int kMaxStack = 64;
    static constexpr int kControl = 16;  ///< samples per control update
    static constexpr double kRoundness = 0.2;  ///< rounded saw: share of the cycle the fall takes

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        muteStep_ = (float)(kControl / (0.002 * sampleRate));
        for (auto& d : drift_) d.prepare(sampleRate);
    }

    void reset() noexcept {
        down_[0].reset(), down_[1].reset(), down_[2].reset(), down_[3].reset();
        shuffle_ = 0;
        seed_ = ~0u;
        counter_ = 0;
        first_ = true;
        lastSync_ = lastShuffle_ = false;
        for (int k = 0; k < kMaxOsc; ++k) {
            sine_[k] = 0.0f;
            mute_[k] = 1.0f;
            gL_[k] = gR_[k] = gU_[k] = 0.0f;
            dgL_[k] = dgR_[k] = dgU_[k] = 0.0f;
        }
    }

    /// Transport start: the Reshuffle counter and the drift walks start over.
    void restart() noexcept {
        shuffle_ = 0;
        reseed();
    }
    /// One Reshuffle (input pulse or button): a new random pattern and glide rates.
    void reshuffle() noexcept {
        ++shuffle_;
        drawShuffle();
    }
    /// Restarts every oscillator at its start phase.
    void sync() noexcept {
        for (int k = 0; k < kMaxOsc; ++k) phase_[k] = startPhase(k);
    }

    /// Skips the decimators and sums of outputs nothing reads.
    void setOutputsUsed(bool root, bool upper) noexcept {
        wantRoot_ = root;
        wantUpper_ = upper;
    }

    /// One sample. `syncIn` and `shuffleIn` are the trigger inputs.
    SwarmFrame tick(const SwarmParams& p, float syncIn = 0.0f, float shuffleIn = 0.0f) noexcept {
        if (p.seed != seed_) {
            seed_ = p.seed;
            reseed();
        }
        const bool sh = shuffleIn >= 0.5f, sy = syncIn >= 0.5f;
        if (sh && !lastShuffle_) reshuffle();
        if (sy && !lastSync_) sync();
        lastShuffle_ = sh, lastSync_ = sy;
        if (p.high != high_) {
            high_ = p.high;
            for (auto& d : down_) d.reset();
        }
        const int step = counter_;  // position inside the control step
        if (step == 0) control(p);
        counter_ = (counter_ + 1) % kControl;

        const int os = high_ ? 2 : 1;
        const double fRoot = dsp::osc::pitchToHz((double)p.pitch) / (sampleRate_ * os);
        float l[2], r[2], root[2], upper[2];
        for (int s = 0; s < os; ++s) {
            float sl = 0.0f, sr = 0.0f, su = 0.0f;
            const float a = ((float)step + (float)s / (float)os) / (float)kControl;  // 0…1 over the step
            for (int k = 0; k < active_; ++k) {
                const double dt = fRoot * (double)(ratio0_[k] + a * (ratio1_[k] - ratio0_[k]));
                const float v = voice(k, dt, warp0_ + a * (warp1_ - warp0_), xfm0_ + a * (xfm1_ - xfm0_));
                if (k == 0) root[s] = v * mute_[0];
                sl += v * (gL_[k] + a * dgL_[k]);
                sr += v * (gR_[k] + a * dgR_[k]);
                su += v * (gU_[k] + a * dgU_[k]);
            }
            if (active_ == 0) root[s] = 0.0f;
            l[s] = sl, r[s] = sr, upper[s] = su;
        }
        SwarmFrame f;
        if (os == 1) {
            f.l = l[0], f.r = r[0], f.root = root[0], f.upper = upper[0];
        } else {
            f.l = down_[0].process(l, 2);
            f.r = down_[1].process(r, 2);
            if (wantRoot_) f.root = down_[2].process(root, 2);
            if (wantUpper_) f.upper = down_[3].process(upper, 2);
        }
        f.spread = spreadOut_;
        first_ = false;
        return f;
    }

    // ---- for the view and the tests ----
    int oscillators() const noexcept { return active_; }
    /// Oscillator k's current offset from the root in semitones (glide + detune).
    float pitchOf(int k) const noexcept { return glide_[k] + detuneNow_[k] / 100.0f; }
    float gliding(int k) const noexcept { return glide_[k]; }
    float targetOf(int k) const noexcept { return target_[k]; }
    float panOf(int k) const noexcept { return pan_[k]; }
    float levelOf(int k) const noexcept { return level_[k]; }
    float detuneUnit(int k) const noexcept { return unit_[k]; }
    float glideTimeFactor(int k) const noexcept { return 0.5f + rate_[k]; }
    int stackSize() const noexcept { return stackCount_; }
    int stackNote(int i) const noexcept { return stack_[i]; }

    /// The stack (4.2): the set's notes through `range` octaves, Up (0…12·range),
    /// Centred (±6·range) or Down (−12·range…0). Returns the count.
    static int buildStack(int set, int range, int stack, int* out) noexcept {
        const SwarmSet s = swarmSet(set);
        range = std::clamp(range, 1, 4);
        const int lo = stack == 1 ? -6 * range : stack == 2 ? -12 * range : 0;
        const int hi = lo + 12 * range;
        int n = 0;
        if (s.kind == SwarmSet::Unison) {
            out[n++] = 0;
        } else if (s.kind == SwarmSet::Steps) {
            for (int v = (int)std::ceil((double)lo / s.step) * s.step; v <= hi && n < kMaxStack; v += s.step) out[n++] = v;
        } else {
            for (int v = lo; v <= hi && n < kMaxStack; ++v)
                if ((s.mask >> (((v % 12) + 12) % 12)) & 1u) out[n++] = v;
        }
        return n;
    }

    /// Nearest stack note to x (stack sorted); ties go down.
    static int nearest(const int* stack, int n, float x) noexcept {
        int best = stack[0];
        for (int i = 1; i < n; ++i)
            if (std::fabs((float)stack[i] - x) < std::fabs((float)best - x)) best = stack[i];
        return best;
    }

    /// The detune pattern u ∈ [−1, 1] of oscillator k ≥ 1 of n (Fan, Alternate,
    /// Random, Outer); the root (k = 0) is never detuned.
    static float patternValue(int pattern, int k, int n, uint64_t shuffleSeed) noexcept {
        if (k <= 0) return 0.0f;
        const int j = k - 1, m = n - 1;
        const float c = m <= 1 ? 1.0f : 2.0f * (float)j / (float)(m - 1) - 1.0f;
        switch (pattern) {
            case 1: return (j % 2 == 0 ? 1.0f : -1.0f) / (float)(j / 2 + 1);
            case 2: return (float)(2.0 * dsp::uniform01(shuffleSeed, (uint64_t)k, 0x7a) - 1.0);
            case 3: return c * std::fabs(c);
            default: return c;
        }
    }

private:
    /// sin(2π·ph) for any phase, polynomial (error < 1e-6): 16 oscillators
    /// at 2× need it cheaper than std::sin.
    static float sin2pi(double ph) noexcept {
        float t = (float)(ph - std::floor(ph)) - 0.5f;  // −0.5 … 0.5, sin(2π·ph) = −sin(2π·t)
        if (t > 0.25f) t = 0.5f - t;
        else if (t < -0.25f) t = -0.5f - t;
        const float x = 6.28318531f * t, x2 = x * x;
        return -x * (1.0f + x2 * (-1.0f / 6.0f + x2 * (1.0f / 120.0f + x2 * (-1.0f / 5040.0f +
                    x2 * (1.0f / 362880.0f + x2 * (-1.0f / 39916800.0f))))));
    }

    double startPhase(int k) const noexcept { return k == 0 ? 0.0 : dsp::uniform01(seed_, (uint64_t)k, 0x5a); }

    void reseed() noexcept {
        for (int k = 0; k < kMaxOsc; ++k) {
            phase_[k] = startPhase(k);
            // Each walk has its own pace, 0.05…0.5 Hz.
            drift_[k].setRate(0.05 * std::pow(10.0, dsp::uniform01(seed_, (uint64_t)k, 0xd1)));
            drift_[k].reset(seed_, (uint64_t)k);
            jitter_[k] = (float)(1.0 + 0.2 * (2.0 * dsp::uniform01(seed_, (uint64_t)k, 0x9a) - 1.0));
        }
        drawShuffle();
    }

    void drawShuffle() noexcept {
        shuffleSeed_ = dsp::hash3(seed_, shuffle_, 0x5f);
        for (int k = 0; k < kMaxOsc; ++k) rate_[k] = (float)dsp::uniform01(shuffleSeed_, (uint64_t)k, 0x61);
    }

    /// One oscillator sample at increment dt: sine → triangle → rounded saw → saw.
    float voice(int k, double dt, float warp, float crossFm) noexcept {
        const double adt = std::max(std::fabs(dt), 1e-9);
        double ph = phase_[k];
        if (crossFm > 0.0f) {  // ring: modulated by the previous oscillator's last sine
            const int from = k == 0 ? active_ - 1 : k - 1;
            ph = dsp::osc::wrap01(ph + 0.5 * (double)crossFm * (double)sine_[from]);
        }
        const float w = std::clamp(warp, 0.0f, 1.0f) * 3.0f;
        const int seg = std::min((int)w, 2);
        const float t = w - (float)seg;
        float a = 0.0f, b = 0.0f;
        const float sine = sin2pi(ph);
        switch (seg) {
            case 0: a = sine, b = t > 0.0f ? triangle(ph, adt) : 0.0f; break;
            case 1: a = triangle(ph, adt), b = t > 0.0f ? rounded(ph) : 0.0f; break;
            default: a = rounded(ph), b = t > 0.0f ? (float)(2.0 * ph - 1.0 - dsp::osc::polyBlep(ph, adt)) : 0.0f; break;
        }
        sine_[k] = sine;
        double next = phase_[k] + dt;
        next -= std::floor(next);
        phase_[k] = next;
        return a + t * (b - a);
    }

    static float triangle(double ph, double adt) noexcept {
        double tri = ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph;
        tri += 8.0 * adt * (dsp::osc::polyBlamp(ph, adt) - dsp::osc::polyBlamp(dsp::osc::wrap01(ph - 0.5), adt));
        return (float)tri;
    }
    /// A cosine read through a two-segment phase curve: a quick fall around
    /// the wrap and a slow rise, a saw with rounded corners and few upper harmonics.
    static float rounded(double ph) noexcept {
        const double d = kRoundness;
        const double q = dsp::osc::wrap01(ph + 0.5 * d);
        const double pd = q < d ? 0.5 * q / d : 0.5 + 0.5 * (q - d) / (1.0 - d);
        return sin2pi(pd + 0.25);  // cos(2π·pd)
    }

    /// Every kControl samples: targets, glides, detune, gains and pans.
    void control(const SwarmParams& p) noexcept {
        const float count = std::clamp(p.count, 1.0f, (float)kMaxOsc);
        const int n = std::min((int)std::ceil(count - 1e-4f), kMaxOsc);
        const int set = std::clamp(p.set, 0, numSwarmSets() - 1);
        const int range = std::clamp(p.range, 1, 4);
        const int stack = std::clamp(p.stack, 0, 2);
        if (set != set_ || range != range_ || stack != stackMode_ || n != active_) {
            set_ = set, range_ = range, stackMode_ = stack;
            stackCount_ = buildStack(set, range, stack, stack_);
            // Evenly over the stack; the root oscillator takes note 0 and gives
            // up the position nearest the root.
            int pos[kMaxOsc], zero = 0;
            for (int i = 0; i < stackCount_; ++i)
                if (stack_[i] == 0) zero = i;
            for (int k = 0; k < n; ++k)
                pos[k] = n > 1 ? (int)std::lround((double)k * (stackCount_ - 1) / (n - 1)) : zero;
            int k0 = 0;
            for (int k = 1; k < n; ++k)
                if (std::abs(stack_[pos[k]]) < std::abs(stack_[pos[k0]])) k0 = k;
            full_[0] = 0.0f;
            for (int k = 1, j = 0; k < n; ++k, ++j) {
                if (j == k0) ++j;
                full_[k] = (float)stack_[pos[std::min(j, n - 1)]];
            }
        }
        // Oscillators that join start at the root octave of their glide.
        for (int k = active_; k < n; ++k)
            if (first_ || level_[k] <= 0.0f) glide_[k] = 0.0f;
        active_ = n;

        // Targets and glides (oscillator 0 stays on the root).
        const float spread = std::clamp(p.spread, 0.0f, 1.0f);
        double num = 0.0, den = 0.0;
        for (int k = 0; k < n; ++k) {
            target_[k] = k == 0 ? 0.0f : (float)nearest(stack_, stackCount_, spread * full_[k]);
            const float tau = p.glide * (0.5f + rate_[k]);
            const float a = tau <= 0.0f || first_ ? 0.0f : (float)std::exp(-(double)kControl / ((double)tau * sampleRate_));
            glide_[k] = target_[k] + a * (glide_[k] - target_[k]);
            if (k > 0) num += std::fabs(glide_[k]), den += std::fabs(full_[k]);
        }
        spreadOut_ = den > 0.0 ? (float)std::min(1.0, num / den) : 0.0f;

        // Detune: pattern + drift, then the frequency ratio at the end of this step.
        const float detune = std::max(p.detune, 0.0f), drift = std::clamp(p.drift, 0.0f, 1.0f);
        const double nyquist = 0.45 * sampleRate_;
        const double fRoot = dsp::osc::pitchToHz((double)p.pitch);
        float levels = 0.0f;
        for (int k = 0; k < kMaxOsc; ++k) {
            const float walk = drift_[k].advance(kControl);
            if (k >= n) {
                level_[k] = 0.0f;
                continue;
            }
            unit_[k] = patternValue(p.pattern, k, n, shuffleSeed_);
            detuneNow_[k] = k == 0 ? 0.0f : detune * unit_[k] + drift * 0.5f * detune * walk;
            const float semis = glide_[k] + detuneNow_[k] / 100.0f;
            ratio0_[k] = first_ ? std::exp2(semis / 12.0f) : ratio1_[k];
            ratio1_[k] = std::exp2(semis / 12.0f);
            // Too high to play cleanly: fade out (2 ms) instead of aliasing.
            const float muteTarget = fRoot * ratio1_[k] < nyquist ? 1.0f : 0.0f;
            mute_[k] = first_ ? muteTarget
                              : muteTarget > mute_[k] ? std::min(muteTarget, mute_[k] + muteStep_)
                                                      : std::max(muteTarget, mute_[k] - muteStep_);
            level_[k] = std::clamp(count - (float)k, 0.0f, 1.0f);
            levels += level_[k];
        }
        const float norm = 1.0f / std::sqrt(std::max(levels, 1.0f));
        warp0_ = first_ ? p.warp : warp1_, warp1_ = std::clamp(p.warp, 0.0f, 1.0f);
        xfm0_ = first_ ? p.crossFm : xfm1_, xfm1_ = std::clamp(p.crossFm, 0.0f, 1.0f);
        if (n <= 1) xfm0_ = xfm1_ = 0.0f;  // a single oscillator has no ring

        // Gains: level × mute × norm, panned (constant power, unity in the centre).
        const float width = std::clamp(p.width, 0.0f, 1.0f);
        const int half = std::max(1, n / 2);
        for (int k = 0; k < kMaxOsc; ++k) {
            float tl = 0.0f, tr = 0.0f, tu = 0.0f;
            if (k < n) {
                const float side = k % 2 ? 1.0f : -1.0f;
                const float mag = k == 0 ? 0.0f : std::min(1.0f, (float)((k + 1) / 2) / (float)half * jitter_[k]);
                pan_[k] = width * side * mag;
                const float g = level_[k] * mute_[k] * norm;
                const float th = (pan_[k] + 1.0f) * 0.78539816f;
                tl = g * 1.41421356f * std::cos(th);
                tr = g * 1.41421356f * std::sin(th);
                tu = k > 0 && glide_[k] >= 11.5f ? g : 0.0f;
            }
            const float l0 = first_ ? tl : gL_[k] + dgL_[k], r0 = first_ ? tr : gR_[k] + dgR_[k];
            const float u0 = first_ ? tu : gU_[k] + dgU_[k];
            gL_[k] = l0, gR_[k] = r0, gU_[k] = u0;
            dgL_[k] = tl - l0, dgR_[k] = tr - r0, dgU_[k] = tu - u0;
        }
        // Gains of oscillators that just stopped ramp out over this step.
        for (int k = n; k < kMaxOsc; ++k)
            if (gL_[k] != 0.0f || gR_[k] != 0.0f || dgL_[k] != 0.0f) active_ = std::max(active_, k + 1);
    }

    double sampleRate_ = 48000.0;
    float muteStep_ = 0.1f;
    bool high_ = false, first_ = true, lastSync_ = false, lastShuffle_ = false;
    bool wantRoot_ = true, wantUpper_ = true;
    uint32_t seed_ = ~0u;
    uint64_t shuffle_ = 0, shuffleSeed_ = 0;
    int counter_ = 0, active_ = 0;

    int set_ = -1, range_ = 0, stackMode_ = -1, stackCount_ = 1;
    int stack_[kMaxStack] = {};
    float full_[kMaxOsc] = {}, target_[kMaxOsc] = {}, glide_[kMaxOsc] = {};
    float rate_[kMaxOsc] = {}, unit_[kMaxOsc] = {}, detuneNow_[kMaxOsc] = {}, jitter_[kMaxOsc] = {};
    float ratio0_[kMaxOsc] = {}, ratio1_[kMaxOsc] = {}, mute_[kMaxOsc] = {}, level_[kMaxOsc] = {}, pan_[kMaxOsc] = {};
    float gL_[kMaxOsc] = {}, gR_[kMaxOsc] = {}, gU_[kMaxOsc] = {};
    float dgL_[kMaxOsc] = {}, dgR_[kMaxOsc] = {}, dgU_[kMaxOsc] = {};
    float warp0_ = 0.0f, warp1_ = 0.0f, xfm0_ = 0.0f, xfm1_ = 0.0f, spreadOut_ = 0.0f;
    double phase_[kMaxOsc] = {};
    float sine_[kMaxOsc] = {};
    dsp::OscDrift drift_[kMaxOsc];
    dsp::Downsampler down_[4];
};

}  // namespace bleep::patch
