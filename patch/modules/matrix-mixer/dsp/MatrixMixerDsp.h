// SPDX-License-Identifier: MIT
// Matrix Mixer core (specs/modules/matrix-mixer.md): up to 8 inputs × 8
// outputs, a bipolar gain at every crosspoint (modulatable per sample),
// per-input mutes with a 5 ms ramp, output levels, an output stage (Clean,
// Soft clip, Normalize) and a morph between two stored snapshots. Works a
// chunk at a time; crosspoints that are 0 for a whole chunk are skipped.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kMmSize = 8;
constexpr int kMmCross = kMmSize * kMmSize;
constexpr int kMmSnapshots = 8;
constexpr int kMmMaxBlock = 64;
constexpr float kMmLimit = 10.0f;  ///< outputs never exceed ±10

enum MmStage { MmClean = 0, MmSoftClip, MmNormalize };
enum MmCurve { MmLinear = 0, MmSmooth, MmEqualPower };

/// One stored matrix: gains (−1…+1, index input · 8 + output), levels (0…2), mutes.
struct MmSnapshot {
    bool valid = false;
    float g[kMmCross]{};
    float level[kMmSize]{1, 1, 1, 1, 1, 1, 1, 1};
    bool mute[kMmSize]{};
};
struct MmSnapshots {
    MmSnapshot s[kMmSnapshots];
    int a = 0, b = 1;  ///< morph ends
};

/// The morph curve: Linear, Smooth (smoothstep) or Equal power. Returns
/// the weights of A and B.
inline void mmMorphWeights(float m, int curve, float& wa, float& wb) noexcept {
    m = std::clamp(m, 0.0f, 1.0f);
    switch (curve) {
        case MmSmooth: {
            const float t = m * m * (3.0f - 2.0f * m);
            wa = 1.0f - t, wb = t;
            break;
        }
        case MmEqualPower:
            wa = std::cos(m * 1.5707963f);
            wb = std::sin(m * 1.5707963f);
            break;
        default: wa = 1.0f - m, wb = m; break;
    }
}

/// The Soft clip stage: linear up to 0.9, then a tanh knee that never exceeds 1.
inline float mmSoftClip(float x) noexcept {
    const float a = std::fabs(x);
    if (a <= 0.9f) return x;
    const float y = 0.9f + 0.1f * std::tanh((a - 0.9f) * 10.0f);
    return x < 0.0f ? -y : y;
}

/// One chunk's inputs. Gains and levels arrive as the knob value (in units)
/// plus the per-sample effective value (knob + modulation, in units); the
/// difference is the modulation, which stays on top of a morph.
struct MmBlock {
    int numSamples = 0;
    int inputs = 4, outputs = 4;
    const float* in[kMmSize]{};      ///< nullptr: unpatched
    float unpatched = 0.0f;          ///< value of an unpatched input (0 or 1)
    float gainKnob[kMmCross]{};      ///< −1…+1
    const float* gainEff[kMmCross]{};///< −1…+1 per sample (nullptr: = knob)
    float levelKnob[kMmSize]{};      ///< 0…2
    const float* levelEff[kMmSize]{};
    bool mute[kMmSize]{};
    int stage = MmClean;
    bool morph = false;
    const float* morphAmount = nullptr;  ///< 0…1 per sample
    int curve = MmLinear;
    const MmSnapshots* snapshots = nullptr;
};

class MatrixMixerDsp {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        rampSamples_ = std::max(1.0, 0.020 * sampleRate);
        muteStep_ = (float)(1.0 / std::max(1.0, 0.005 * sampleRate));
    }
    void reset() noexcept {
        haveBase_ = false;
        for (int i = 0; i < kMmSize; ++i) muteGain_[i] = 1.0f, peak_[i] = 0.0f;
    }

    /// Mixes one chunk into out[0…outputs) (each numSamples long, ≤ kMmMaxBlock).
    void process(const MmBlock& b, float* const* out) noexcept {
        const int n = std::clamp(b.numSamples, 0, kMmMaxBlock);
        const int ni = std::clamp(b.inputs, 1, kMmSize), no = std::clamp(b.outputs, 1, kMmSize);
        const MmSnapshot* A = nullptr;
        const MmSnapshot* B = nullptr;
        if (b.morph && b.snapshots) {
            const auto& sn = *b.snapshots;
            A = &sn.s[std::clamp(sn.a, 0, kMmSnapshots - 1)];
            B = &sn.s[std::clamp(sn.b, 0, kMmSnapshots - 1)];
        }
        const float m0 = b.morph && b.morphAmount ? b.morphAmount[0] : 0.0f;

        // Mutes (a snapshot's mutes switch at 50 % of the morph), ramped over 5 ms.
        float mg[kMmSize][kMmMaxBlock];
        for (int i = 0; i < ni; ++i) {
            bool mute = b.mute[i];
            if (A) {
                const MmSnapshot* S = m0 < 0.5f ? A : B;
                if (S->valid) mute = S->mute[i];
            }
            const float target = mute ? 0.0f : 1.0f;
            float g = muteGain_[i];
            if (g == target) {
                std::fill(mg[i], mg[i] + n, g);
                continue;
            }
            for (int s = 0; s < n; ++s) {
                g = g < target ? std::min(target, g + muteStep_) : std::max(target, g - muteStep_);
                mg[i][s] = g;
            }
            muteGain_[i] = g;
        }

        // Knob values ramp over 20 ms (snapshot recall, edits); a morph sets the base directly.
        if (!haveBase_) {
            for (int k = 0; k < kMmCross; ++k) base_[k] = target_[k] = b.gainKnob[k], step_[k] = 0.0f;
            haveBase_ = true;
        }
        float x[kMmSize][kMmMaxBlock];
        bool silent[kMmSize]{};  // muted all through the chunk: the row is skipped
        for (int i = 0; i < ni; ++i) {
            if (b.in[i]) std::copy(b.in[i], b.in[i] + n, x[i]);
            else std::fill(x[i], x[i] + n, b.unpatched);
            silent[i] = n > 0 && mg[i][0] == 0.0f && mg[i][n - 1] == 0.0f;
            if (n > 0 && !(mg[i][0] == 1.0f && mg[i][n - 1] == 1.0f))
                for (int s = 0; s < n; ++s) x[i][s] *= mg[i][s];
        }

        float wa[kMmMaxBlock], wb[kMmMaxBlock];  // morph weights per sample
        if (A)
            for (int s = 0; s < n; ++s) mmMorphWeights(b.morphAmount ? b.morphAmount[s] : 0.0f, b.curve, wa[s], wb[s]);
        float g[kMmMaxBlock], absSum[kMmMaxBlock];
        for (int j = 0; j < no; ++j) {
            float* o = out[j];
            std::fill(o, o + n, 0.0f);
            if (b.stage == MmNormalize) std::fill(absSum, absSum + n, 0.0f);
            for (int i = 0; i < ni; ++i) {
                const int k = i * kMmSize + j;
                const int how = gains(b, k, n, A, B, wa, wb, g);
                if (how == 0) continue;  // 0 for the whole chunk
                if (how == 1) {          // constant
                    const float c = g[0];
                    if (!silent[i])
                        for (int s = 0; s < n; ++s) o[s] += c * x[i][s];
                    if (b.stage == MmNormalize)
                        for (int s = 0; s < n; ++s) absSum[s] += std::fabs(c);
                    continue;
                }
                if (!silent[i])
                    for (int s = 0; s < n; ++s) o[s] += g[s] * x[i][s];
                if (b.stage == MmNormalize)
                    for (int s = 0; s < n; ++s) absSum[s] += std::fabs(g[s]);
            }
            // Level, then the output stage.
            const float lk = levelBase(b, j, m0, A, B);
            if (b.stage == MmNormalize)
                for (int s = 0; s < n; ++s) o[s] /= std::max(1.0f, absSum[s]);
            if (const float* le = b.levelEff[j]) {
                for (int s = 0; s < n; ++s) o[s] *= std::clamp(lk + le[s] - b.levelKnob[j], 0.0f, 2.0f);
            } else {
                const float l = std::clamp(lk, 0.0f, 2.0f);
                for (int s = 0; s < n; ++s) o[s] *= l;
            }
            if (b.stage == MmSoftClip)
                for (int s = 0; s < n; ++s) o[s] = mmSoftClip(o[s]);
            float peak = 0.0f;
            for (int s = 0; s < n; ++s) {
                const float v = o[s] == o[s] ? std::fmin(std::fmax(o[s], -kMmLimit), kMmLimit) : 0.0f;  // NaN → 0
                o[s] = v;
                peak = std::fmax(peak, std::fabs(v));
            }
            peak_[j] = peak;
        }
        // Crosspoints of hidden rows/columns still follow their knobs.
        for (int k = 0; k < kMmCross; ++k)
            if (k / kMmSize >= ni || k % kMmSize >= no) advanceRamp(b, k, n);
        for (int j = no; j < kMmSize; ++j) peak_[j] = 0.0f;
    }

    /// The base gain (knob or morph, before modulation) of crosspoint k at the chunk end.
    float baseGain(int k) const noexcept { return lastBase_[k]; }
    float peak(int j) const noexcept { return peak_[j]; }
    float muteGain(int i) const noexcept { return muteGain_[i]; }

private:
    /// The gain of crosspoint k: 0 = zero throughout, 1 = constant (g[0]),
    /// 2 = per sample in g.
    int gains(const MmBlock& b, int k, int n, const MmSnapshot* A, const MmSnapshot* B, const float* wa,
               const float* wb, float* g) noexcept {
        const float* eff = b.gainEff[k];
        const float knob = b.gainKnob[k];
        if (A) {
            const float ga = A->valid ? A->g[k] : knob, gb = B->valid ? B->g[k] : knob;
            bool any = false;
            for (int s = 0; s < n; ++s) {
                const float base = wa[s] * ga + wb[s] * gb;
                g[s] = std::clamp(base + (eff ? eff[s] - knob : 0.0f), -2.0f, 2.0f);
                any = any || g[s] != 0.0f;
            }
            base_[k] = target_[k] = knob, step_[k] = 0.0f;
            lastBase_[k] = n > 0 ? g[n - 1] - (eff ? eff[n - 1] - knob : 0.0f) : lastBase_[k];
            return any ? 2 : 0;
        }
        const float start = base_[k];
        advanceRamp(b, k, n);
        lastBase_[k] = base_[k];
        bool modulated = false;
        if (eff)
            for (int s = 0; s < n && !modulated; ++s) modulated = eff[s] != knob;
        if (!modulated && start == base_[k]) {  // not ramping, not modulated
            g[0] = start;
            return start == 0.0f ? 0 : 1;
        }
        float v = start;
        const float tgt = target_[k];
        for (int s = 0; s < n; ++s) {
            if (v != tgt) v = step_[k] > 0.0f ? std::min(tgt, v + step_[k]) : std::max(tgt, v + step_[k]);
            g[s] = v + (eff ? eff[s] - knob : 0.0f);
        }
        return 2;
    }

    void advanceRamp(const MmBlock& b, int k, int n) noexcept {
        const float knob = b.gainKnob[k];
        if (knob != target_[k]) {
            target_[k] = knob;
            step_[k] = (float)((knob - base_[k]) / rampSamples_);
        }
        float v = base_[k];
        if (v != target_[k]) {
            v += step_[k] * (float)n;
            if ((step_[k] > 0.0f && v > target_[k]) || (step_[k] <= 0.0f && v < target_[k])) v = target_[k];
        }
        base_[k] = v;
    }

    float levelBase(const MmBlock& b, int j, float m, const MmSnapshot* A, const MmSnapshot* B) const noexcept {
        if (!A) return b.levelKnob[j];
        float wa, wb;
        mmMorphWeights(m, b.curve, wa, wb);
        const float la = A->valid ? A->level[j] : b.levelKnob[j], lb = B->valid ? B->level[j] : b.levelKnob[j];
        return wa * la + wb * lb;
    }

    double sampleRate_ = 48000.0, rampSamples_ = 960.0;
    float muteStep_ = 1.0f / 240.0f;
    bool haveBase_ = false;
    float base_[kMmCross]{}, target_[kMmCross]{}, step_[kMmCross]{}, lastBase_[kMmCross]{};
    float muteGain_[kMmSize]{1, 1, 1, 1, 1, 1, 1, 1};
    float peak_[kMmSize]{};
};

}  // namespace bleep::patch
