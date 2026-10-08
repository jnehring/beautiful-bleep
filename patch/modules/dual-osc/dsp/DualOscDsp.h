// SPDX-License-Identifier: MIT
// Dual Osc (specs/modules/dual-oscillator.md): two analog-style cores A and B.
// B frequency-modulates A (linear through-zero or exponential), A syncs to B
// (reversing soft sync → hard sync), and the A/B mix runs into a 4-stage
// wavefolder with a stereo spread.
//
// The whole cross-mod section runs oversampled (2× Normal, 4× High): both
// cores are dsp::SyncOsc (every wrap, edge, corner and sync reset corrected
// at its sub-sample time), the folder is dsp::Folder with ADAA, and every
// output is decimated by the same half-band chain, so A, B, Mix, Ring, Sub
// and Out stay phase-aligned. Unwanted outputs are not decimated.
#pragma once

#include "dsp/Folder.h"
#include "dsp/OscCore.h"
#include "dsp/Oversampler.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

/// One sample's controls, already in their own units.
struct DualOscParams {
    float pitchA = 0.0f;     ///< octaves from C4: Octave A + Tune A + Fine A + Pitch
    float pitchB = -1.0f;    ///< octaves from C4: Octave B + Tune B + Fine B + Pitch B (+ Pitch if tracking)
    float shapeA = 2.0f / 3.0f, shapeB = 0.0f;  ///< sine → triangle → saw → pulse
    float widthA = 0.5f;     ///< A's pulse width 0.05..0.95
    float fmDepth = 0.0f;    ///< 0..1
    float sync = 0.0f;       ///< 0 free … 0.5 soft … 1 hard
    float balance = 0.5f;    ///< A ↔ B into the folder
    float fold = 0.0f;       ///< 0..1: drive 1…12
    float symmetry = 0.0f;   ///< −1..+1 bias before the folder
    float drift = 0.1f;      ///< 0..1: ±8 cents of seeded wander at 1
    float width = 0.0f;      ///< 0..1 stereo spread of Out L/R
    bool expFm = false;      ///< FM Mode: false linear (through zero), true exponential
    bool lowRange = false;   ///< B Range Low: B ÷ 100
};

/// One output sample of every jack.
struct DualOscFrame {
    float a = 0.0f, b = 0.0f, mix = 0.0f, outL = 0.0f, outR = 0.0f, ring = 0.0f, sub = 0.0f;
};

class DualOscDsp {
public:
    enum Output { A, B, Mix, OutL, OutR, Ring, Sub, kOutputs };
    static constexpr float kDriftCents = 8.0f;
    static constexpr float kMaxDrive = 12.0f;

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        fmSmooth_ = (float)(1.0 - std::exp(-1.0 / (0.005 * sampleRate)));
        for (auto& d : drift_) d.prepare(sampleRate, 0.2);
        dcL_.prepare(sampleRate);
        dcR_.prepare(sampleRate);
        reset();
    }
    void reset() noexcept {
        coreA_.reset();
        coreB_.reset();
        for (auto& d : down_) d.reset();
        folderL_.reset();
        folderR_.reset();
        dcL_.reset();
        dcR_.reset();
        sub_ = 1.0f;
        subPending_ = 0.0f;
        fmDepth_ = -1.0f;
        primed_ = false;
        stereo_ = false;
        resetDrift(seed_);
    }
    /// Seed of the drift walks (Seed setting); rewinds them (transport start).
    void resetDrift(uint32_t seed) noexcept {
        seed_ = seed;
        for (int k = 0; k < 2; ++k) drift_[k].reset(seed, 0xd0a1000ull + (uint64_t)k);
    }
    uint32_t seed() const noexcept { return seed_; }
    /// 2 (Normal) or 4 (High); a change restarts the decimators.
    void setOversampling(int factor) noexcept {
        factor = factor >= 4 ? 4 : 2;
        if (factor == factor_) return;
        factor_ = factor;
        for (auto& d : down_) d.reset();
    }
    int oversampling() const noexcept { return factor_; }

    /// Core B's phase (for the view's scope trigger).
    double phaseB() const noexcept { return coreB_.phase(); }
    /// The folder's input level before Symmetry (|x| of the last sample's peak, left).
    float foldInput() const noexcept { return foldIn_; }

    /// One output sample. `fm` is the FM input, `foldCv` the Fold CV input,
    /// `sync` true on the sample of an external Sync edge. `want[k]` (k an
    /// Output) false skips decimating that output (its value is then 0); null
    /// computes everything.
    DualOscFrame process(const DualOscParams& p, float fm, float foldCv, bool sync, const bool* want = nullptr) noexcept {
        const int K = factor_;
        const double osRate = sampleRate_ * K;
        const double maxInc = 0.45;

        // Control rate (once per output sample).
        if (fmDepth_ < 0.0f) fmDepth_ = p.fmDepth;
        fmDepth_ += (p.fmDepth - fmDepth_) * fmSmooth_;
        const float driftCents = kDriftCents * std::clamp(p.drift, 0.0f, 1.0f);
        const float dA = drift_[0].next() * driftCents, dB = drift_[1].next() * driftCents;
        const double fA = dsp::osc::pitchToHz((double)p.pitchA + dA / 1200.0);
        double fB = dsp::osc::pitchToHz((double)p.pitchB + dB / 1200.0);
        if (p.lowRange) fB *= 0.01;
        if (!primed_) {
            lastFA_ = fA, lastFB_ = fB, lastFm_ = fm, lastFoldCv_ = foldCv;
            primed_ = true;
        }

        const float syncAmount = std::clamp(p.sync, 0.0f, 1.0f);
        const float bal = std::clamp(p.balance, 0.0f, 1.0f);
        const float w = std::clamp(p.width, 0.0f, 1.0f);
        const bool stereo = w > 0.0f;
        if (stereo && !stereo_) {  // R has been a copy of L: start it from L's state (no click)
            folderR_ = folderL_;
            down_[OutR] = down_[OutL];
            dcR_ = dcL_;
        }
        stereo_ = stereo;
        const float balL = std::clamp(bal - 0.25f * w, 0.0f, 1.0f), balR = std::clamp(bal + 0.25f * w, 0.0f, 1.0f);
        const float fold = std::clamp(p.fold, 0.0f, 1.0f);
        const float drive = 1.0f + (kMaxDrive - 1.0f) * fold;
        dsp::Folder::Params fpL = folderParams(fold, p.symmetry);
        dsp::Folder::Params fpR = fpL;
        fpR.symmetry = fpL.symmetry * (1.0f - 2.0f * w);  // mirrored at full width
        const bool want_[kOutputs] = {!want || want[A], !want || want[B], !want || want[Mix], true,
                                      stereo && (!want || want[OutR]), !want || want[Ring], !want || want[Sub]};

        float buf[kOutputs][4];
        float peak = 0.0f;
        for (int k = 0; k < K; ++k) {
            const double t = (double)(k + 1) / K;  // linear interpolation of the inputs
            const double hzA = lastFA_ + (fA - lastFA_) * t, hzB = lastFB_ + (fB - lastFB_) * t;
            const float fmIn = lastFm_ + (fm - lastFm_) * (float)t;
            const float cv = lastFoldCv_ + (foldCv - lastFoldCv_) * (float)t;
            const double ext = sync && k == 0 ? 0.0 : -1.0;  // the edge, one (oversampled) sample late

            const double dtB = std::clamp(hzB / osRate, -maxInc, maxInc);
            const dsp::OscWaves wb = coreB_.process(dtB, 0.5f, ext, 1.0f);

            double hz = hzA;
            if (fmDepth_ > 0.0f) {
                const double m = (double)wb.sine + (double)fmIn;
                hz = p.expFm ? dsp::osc::expFm(hzA, fmDepth_, m) : dsp::osc::linearFm(hzA, fmDepth_, m);
            }
            const double dtA = std::clamp(hz / osRate, -maxInc, maxInc);
            double syncAt = -1.0;
            float amount = 0.0f;
            if (ext >= 0.0) syncAt = ext, amount = 1.0f;
            else if (syncAmount > 0.0f && coreB_.wrapAt() >= 0.0) syncAt = coreB_.wrapAt(), amount = syncAmount;
            const double before = coreA_.phase();
            const dsp::OscWaves wa = coreA_.process(dtA, p.widthA, syncAt, amount);

            // Sub: flips on every forward wrap of A and on every (mostly) hard reset.
            float sub = sub_ + subPending_;
            subPending_ = 0.0f;
            double flipAt = coreA_.wrapAt();
            if (flipAt < 0.0 && syncAt >= 0.0 && amount >= 0.75f && coreA_.direction() > 0.0) {
                const double expected = dsp::osc::wrap01(before + dtA);
                if (coreA_.phase() < expected - 1e-9) flipAt = syncAt;
            }
            if (flipAt >= 0.0) {
                const float jump = -2.0f * sub_, b = (float)(1.0 - flipAt), a = (float)flipAt;
                sub += 0.5f * jump * b * b;
                subPending_ = -0.5f * jump * a * a;
                sub_ = -sub_;
            }

            const float va = dsp::OscCore::morph(wa, p.shapeA), vb = dsp::OscCore::morph(wb, p.shapeB);
            const float mix = va + bal * (vb - va);
            buf[A][k] = va;
            buf[B][k] = vb;
            buf[Mix][k] = mix;
            buf[Ring][k] = wa.sine * wb.sine;
            buf[Sub][k] = sub;
            const float xL = (va + balL * (vb - va)) * drive + cv;
            peak = std::max(peak, std::fabs(xL));
            buf[OutL][k] = folderL_.process(xL, fpL);
            if (stereo) buf[OutR][k] = folderR_.process((va + balR * (vb - va)) * drive + cv, fpR);
        }
        lastFA_ = fA, lastFB_ = fB, lastFm_ = fm, lastFoldCv_ = foldCv;
        foldIn_ = peak;

        float out[kOutputs] = {};
        for (int o = 0; o < kOutputs; ++o)
            if (want_[o]) out[o] = down_[o].process(buf[o], K);
        DualOscFrame f;
        f.a = out[A], f.b = out[B], f.mix = out[Mix], f.ring = out[Ring], f.sub = out[Sub];
        f.outL = dcL_.process(out[OutL]);
        f.outR = stereo ? dcR_.process(out[OutR]) : f.outL;
        return f;
    }

    /// The folder's settings for Fold and Symmetry: stage 1 morphs from a hard
    /// fold (the identity within ±1, so Fold 0 passes the mix) to a soft sine
    /// fold over the first quarter; later stages (soft/hard blend) come in
    /// one by one as Fold rises (tap 1 → 4).
    static dsp::Folder::Params folderParams(float fold, float symmetry) noexcept {
        dsp::Folder::Params fp;
        fp.gain = 1.0f;
        fp.symmetry = std::clamp(symmetry, -1.0f, 1.0f);
        fp.shape = 0.5f;
        fp.firstShape = 1.0f - std::min(1.0f, 4.0f * fold);
        fp.tap = 1.0f + 3.0f * fold;
        return fp;
    }

private:
    double sampleRate_ = 48000.0;
    int factor_ = 2;
    dsp::SyncOsc coreA_, coreB_;
    dsp::OscDrift drift_[2];
    dsp::Folder folderL_, folderR_;
    dsp::fold::DcBlocker dcL_, dcR_;
    dsp::Downsampler down_[kOutputs];
    float sub_ = 1.0f, subPending_ = 0.0f;
    float fmDepth_ = -1.0f, fmSmooth_ = 0.004f, foldIn_ = 0.0f;
    double lastFA_ = 0.0, lastFB_ = 0.0;
    float lastFm_ = 0.0f, lastFoldCv_ = 0.0f;
    bool primed_ = false, stereo_ = false;
    uint32_t seed_ = 1;
};

}  // namespace bleep::patch
