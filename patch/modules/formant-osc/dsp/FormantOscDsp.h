// SPDX-License-Identifier: MIT
// Formant Osc (doc/specs/modules/formant-oscillator.md): a pulse-formant
// oscillator. Every fundamental cycle fires one windowed burst of a formant
// sine (dsp::FormantOsc, common/dsp/Formant.h); the formant tracks the note
// (Ratio) or stays put (Fixed) and passes through 0 Hz. A second formant on
// the right channel, a band-limited square and a sub share the fundamental.
//
// Around the shared burst generator this adds: knob smoothing (Roll and
// Narrow move the window, so they glide over 2 ms), loudness scaling of the
// burst, the Body mix, a short crossfade on external Sync (the old cycle
// fades into the restarted one, so a reset never clicks), and optional 2×
// oversampling with a half-band decimator per output.
#pragma once

#include "dsp/Formant.h"
#include "dsp/Oversampler.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

struct FormantOscParams {
    float pitch = 0.0f;        ///< octaves from C4: Octave + Coarse + Fine + Pitch
    float formant = 2.0f;      ///< Formant knob, −6…+6 octaves (through zero)
    float formantCv = 0.0f;    ///< Formant CV input, octaves (scales the formant)
    float fm = 0.0f;           ///< Formant FM input (audio)
    float fmDepth = 0.0f;      ///< 0..1: ±4× the formant at 1
    float narrow = 0.3f;       ///< 0..1
    float body = 0.7f;         ///< 0 square … 1 formant at Out
    float reset = 1.0f;        ///< 0..1
    float roll = 0.0f;         ///< 0..1 (wraps)
    float spread = 0.0f;       ///< −1…+1 octave: second formant (R)
    bool fixed = false;        ///< Tracking: false Ratio, true Fixed
    bool cosine = true;        ///< Start: true Cosine (0 Hz = the window), false Sine
};

struct FormantOscFrame {
    float outL = 0.0f, outR = 0.0f, formant = 0.0f, square = 0.0f, sub = 0.0f;
};

class FormantOscDsp {
public:
    enum Output { OutL, OutR, Formant, Square, Sub, kOutputs };
    static constexpr float kSquareLevel = 0.5f;  ///< the square's level inside Out

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        smooth_ = (float)(1.0 - std::exp(-1.0 / (0.002 * sampleRate)));
        xfadeLen_ = std::max(4, (int)std::lround(0.00025 * sampleRate));
        osc_.prepare(sampleRate * factor_);
        old_.prepare(sampleRate * factor_);
        reset();
    }
    void reset() noexcept {
        osc_.reset();
        old_ = osc_;
        xfade_ = 0;
        primed_ = false;
        for (auto& d : down_) d.reset();
    }
    /// 1 (Normal) or 2 (High).
    void setOversampling(int factor) noexcept {
        factor = factor >= 2 ? 2 : 1;
        if (factor == factor_) return;
        factor_ = factor;
        osc_.prepare(sampleRate_ * factor);
        old_.prepare(sampleRate_ * factor);
        for (auto& d : down_) d.reset();
    }
    int oversampling() const noexcept { return factor_; }

    /// The fundamental and both formants (Hz) of the last sample, for the view.
    double f0() const noexcept { return f0_; }
    double formantHz() const noexcept { return ff_; }
    double formant2Hz() const noexcept { return ff2_; }

    /// The (signed) formant frequency for a fundamental, the knob, CV and FM.
    static double formantFrequency(const FormantOscParams& p, double f0) noexcept {
        const auto mode = p.fixed ? dsp::formant::Tracking::Fixed : dsp::formant::Tracking::Ratio;
        const double ff = dsp::formant::formantHz(mode, f0, (double)p.formant) * std::exp2((double)p.formantCv);
        return dsp::osc::linearFm(ff, (double)std::clamp(p.fmDepth, 0.0f, 1.0f), (double)p.fm);
    }

    /// The burst's level: the window RMS normalisation of dsp::FormantOsc,
    /// eased by √gain so very narrow bursts don't peak above ~1.6.
    static float burstLevel(float narrow, double f0, double sampleRate) noexcept {
        const double dt = std::clamp(f0, 0.5, 0.45 * sampleRate) / sampleRate;
        const double len = std::clamp(1.0 - 0.95 * (double)narrow, 4.0 * dt, 1.0);
        const double g = dsp::FormantOsc::gain(len, 1.0 + 3.0 * (double)narrow);
        return (float)(0.8 / std::sqrt(std::max(g, 1.0)));
    }

    /// Shortest burst, in samples at the burst generator's rate: shorter
    /// windows have energy above Nyquist. Narrow is limited to keep it.
    static constexpr double kMinWindow = 12.0;

    /// The largest Narrow that keeps the window at least kMinWindow samples long.
    static float maxNarrow(double f0, double rate) noexcept {
        const double dt = std::clamp(f0, 0.5, 0.45 * rate) / rate;
        return (float)std::clamp((1.0 - kMinWindow * dt) / 0.95, 0.0, 1.0);
    }

    /// One output sample; `sync` true on the sample of a Sync edge; `want[k]`
    /// false skips an unread output's decimator (null: all).
    FormantOscFrame process(const FormantOscParams& p, bool sync, const bool* want = nullptr) noexcept {
        if (!primed_) {
            roll_ = p.roll, narrow_ = p.narrow;
            primed_ = true;
        }
        roll_ += (p.roll - roll_) * smooth_;
        narrow_ += (std::clamp(p.narrow, 0.0f, 1.0f) - narrow_) * smooth_;
        if (sync) {
            old_ = osc_;
            osc_.sync(p.reset);
            xfade_ = xfadeLen_ * factor_;
        }

        const double f0 = dsp::osc::pitchToHz((double)p.pitch);
        const double ff = formantFrequency(p, f0);
        const float narrow = std::min(narrow_, maxNarrow(f0, sampleRate_ * factor_));
        const bool second = p.spread != 0.0f;
        if (second && !second_ && factor_ > 1) down_[OutR] = down_[OutL];  // R takes over from L without a step
        second_ = second;
        f0_ = f0, ff_ = ff, ff2_ = second ? ff * std::exp2((double)p.spread) : ff;

        dsp::FormantOsc::Params fp;
        fp.f0Hz = f0;
        fp.formantHz = ff;
        fp.formant2Hz = ff2_;
        fp.narrow = narrow;
        fp.roll = roll_ - std::floor(roll_);
        fp.reset = p.reset;
        fp.cosineStart = p.cosine;
        fp.second = second;
        const float level = burstLevel(narrow, f0, sampleRate_ * factor_);
        const float body = std::clamp(p.body, 0.0f, 1.0f);

        float buf[kOutputs][2];
        const int K = factor_;
        for (int k = 0; k < K; ++k) {
            dsp::FormantOsc::Frame f = osc_.process(fp);
            if (xfade_ > 0) {  // the old cycle fades into the restarted one
                const dsp::FormantOsc::Frame o = old_.process(fp);
                const float t = (float)xfade_ / (float)(xfadeLen_ * K);
                f.formant += t * (o.formant - f.formant);
                f.formant2 += t * (o.formant2 - f.formant2);
                f.square += t * (o.square - f.square);
                f.sub += t * (o.sub - f.sub);
                --xfade_;
            }
            const float a = f.formant * level, b = second ? f.formant2 * level : a;
            const float sq = kSquareLevel * (1.0f - body) * f.square;
            buf[OutL][k] = sq + body * a;
            buf[OutR][k] = sq + body * b;
            buf[Formant][k] = a;
            buf[Square][k] = f.square;
            buf[Sub][k] = f.sub;
        }

        float out[kOutputs] = {};
        for (int o = 0; o < kOutputs; ++o) {
            if (o == OutR && !second) continue;
            if (K == 1) out[o] = buf[o][0];
            else if (!want || want[o] || o == OutL) out[o] = down_[o].process(buf[o], K);
        }
        FormantOscFrame r;
        r.outL = out[OutL];
        r.outR = second ? out[OutR] : out[OutL];
        r.formant = out[Formant], r.square = out[Square], r.sub = out[Sub];
        return r;
    }

private:
    double sampleRate_ = 48000.0, f0_ = 0.0, ff_ = 0.0, ff2_ = 0.0;
    int factor_ = 1, xfade_ = 0, xfadeLen_ = 12;
    dsp::FormantOsc osc_, old_;
    dsp::Downsampler down_[kOutputs];
    float smooth_ = 0.01f, roll_ = 0.0f, narrow_ = 0.3f;
    bool primed_ = false, second_ = false;
};

}  // namespace bleep::patch
