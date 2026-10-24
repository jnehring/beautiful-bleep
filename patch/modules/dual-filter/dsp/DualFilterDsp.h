// SPDX-License-Identifier: GPL-3.0-only
// Dual Filter (doc/specs/modules/dual-filter.md): two morphing state-variable
// filters (dsp::Svf clean, dsp::RoughSvf saturating) under one cutoff, pulled
// apart symmetrically by Spread, in serial, parallel, parallel-inverted or
// stereo routing. Cutoffs, resonance mapping, drive and the envelope follow
// the Filter module (FilterDsp.h) so the two feel the same.
//
// Routing changes keep the filter states and crossfade the output from the
// old routing (run on a copy of the filters) to the new one over 10 ms.
#pragma once

#include "FilterDsp.h"
#include "dsp/Smoothing.h"
#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

struct DualFilterParams {
    enum Routing { Serial, Parallel, ParallelInverted, Stereo };
    enum Link { Off, Same, Mirror };
    enum Character { Clean, Saturating };

    float cutoff = 0.5674f;  ///< normalised 0..1: 20 Hz · 1000^x (as the Filter)
    float spread = 1.0f;     ///< octaves, −5 … +5: f2 above f1 when positive
    float res1 = 0.2f, res2 = 0.2f;  ///< 0..1 → Q 0.5..25
    float mode1 = 0.0f, mode2 = 0.0f;  ///< 0 LP, 1/3 BP, 2/3 HP, 1 notch (mode2 before Link)
    float balance = 0.0f;    ///< −1 … +1
    float drive = 0.0f;      ///< 0..1
    float keyTrack = 0.0f;   ///< 0..1
    float mix = 1.0f;        ///< dry/wet
    int routing = Serial, link = Off, character = Clean;
};

struct DualFilterFrame {
    float in[2] = {0.0f, 0.0f};
    float out[2] = {0.0f, 0.0f};
    float f1 = 0.0f, f2 = 0.0f;  ///< each filter alone, mono (Stereo: the left / right filter)
    float env = 0.0f;
};

class DualFilterDsp {
public:
    static constexpr float kOctaves = 9.965784f;  ///< log2(1000): the cutoff knob's span

    /// Cutoff octaves above 20 Hz → Hz.
    static float hz(float octaves) noexcept { return 20.0f * std::exp2(octaves); }
    /// The two cutoffs for a normalised cutoff, a spread in octaves and a
    /// pitch offset in octaves (before the filters' own clamping).
    static void cutoffs(float cutoff, float spread, float pitchOctaves, float& f1, float& f2) noexcept {
        const float c = std::clamp(cutoff, 0.0f, 1.0f) * kOctaves + pitchOctaves;
        f1 = hz(c - 0.5f * spread);
        f2 = hz(c + 0.5f * spread);
    }
    /// Filter 2's response after Link (4.3).
    static float linkedMode2(float mode1, float mode2, int link) noexcept {
        switch (link) {
            case DualFilterParams::Same: return std::clamp(mode1 + mode2, 0.0f, 1.0f);
            case DualFilterParams::Mirror: return std::clamp(1.0f - mode1 + mode2, 0.0f, 1.0f);
            default: return std::clamp(mode2, 0.0f, 1.0f);
        }
    }

    void prepare(double sampleRate) {
        sampleRate_ = sampleRate;
        env_.prepare(sampleRate, 0.005f, 0.12f);
        fadeStep_ = (float)(1.0 / (0.01 * sampleRate));
        reset();
    }

    void reset() noexcept {
        bank_.reset();
        old_.reset();
        env_.reset();
        fade_ = 0.0f;
        routing_ = -1;
        character_ = -1;
        last_ = {};
    }

    /// One frame. `stereo`: the two inputs differ (In R patched); otherwise
    /// the serial and parallel routings run once and copy.
    void tick(const DualFilterParams& p, float pitch, DualFilterFrame& f, bool stereo = true) noexcept {
        const int routing = std::clamp(p.routing, 0, 3);
        const bool rough = p.character == DualFilterParams::Saturating;
        if ((int)rough != character_) {  // another filter: start from silence
            bank_.reset();
            old_.reset();
            fade_ = 0.0f;
            character_ = rough;
            last_.f1 = -1.0f;
        } else if (routing != routing_ && routing_ >= 0) {
            old_ = bank_;  // the old routing finishes on a copy
            oldRouting_ = routing_;
            fade_ = 1.0f;
        }
        routing_ = routing;

        float f1, f2;
        cutoffs(p.cutoff, p.spread, p.keyTrack * pitch, f1, f2);
        const float q1 = FilterDsp::q(p.res1), q2 = FilterDsp::q(p.res2);
        const auto changed = [](float a, float b) { return std::fabs(a - b) > 0.0f; };
        if (changed(f1, last_.f1) || changed(f2, last_.f2) || changed(q1, last_.q1) || changed(q2, last_.q2)) {
            bank_.set(f1, q1, f2, q2, sampleRate_, rough);
            if (fade_ > 0.0f) old_.set(f1, q1, f2, q2, sampleRate_, rough);
            last_ = {f1, f2, q1, q2};
        }

        Shape s;
        s.mode1 = std::clamp(p.mode1, 0.0f, 1.0f);
        s.mode2 = linkedMode2(p.mode1, p.mode2, p.link);
        s.balance = std::clamp(p.balance, -1.0f, 1.0f);
        s.rough = rough;
        // Gain staging (4.5), clean Serial: filter 2's input is scaled down while
        // the cutoffs are within a semitone, back to 1 over the next octave.
        const float w = std::clamp(std::fabs(p.spread) - 1.0f / 12.0f, 0.0f, 1.0f);
        const float atZero = 1.0f / std::max(1.0f, q1 / 4.0f);
        s.stage = atZero + w * (1.0f - atZero);

        // Drive (as the Filter): tanh on the input.
        const float gain = 1.0f + (rough ? 12.0f : 7.0f) * p.drive;
        float x[2];
        for (int c = 0; c < 2; ++c) x[c] = f.in[c] + p.drive * (std::tanh(f.in[c] * gain) - f.in[c]);

        Result r = run(bank_, routing, s, x, stereo);
        if (fade_ > 0.0f) {
            const Result o = run(old_, oldRouting_, s, x, stereo);
            const float t = fade_ * fade_ * (3.0f - 2.0f * fade_);  // smoothstep of the remaining old share
            for (int c = 0; c < 2; ++c) r.out[c] += t * (o.out[c] - r.out[c]);
            r.f1 += t * (o.f1 - r.f1);
            r.f2 += t * (o.f2 - r.f2);
            fade_ = std::max(0.0f, fade_ - fadeStep_);
        }

        for (int c = 0; c < 2; ++c) f.out[c] = f.in[c] + p.mix * (limit(r.out[c]) - f.in[c]);
        f.f1 = limit(r.f1);
        f.f2 = limit(r.f2);
        f.env = std::min(1.0f, 2.0f * env_.process(0.5f * (f.out[0] + f.out[1])));
    }

private:
    /// Final safety limit: linear up to ±2, then a tanh knee bounded at ±8.
    static float limit(float x) noexcept {
        const float a = std::fabs(x);
        return a <= 2.0f ? x : std::copysign(2.0f + 6.0f * std::tanh((a - 2.0f) / 6.0f), x);
    }

    struct Shape {
        float mode1 = 0.0f, mode2 = 0.0f, balance = 0.0f, stage = 1.0f;
        bool rough = false;
    };
    struct Result {
        float out[2] = {0.0f, 0.0f};
        float f1 = 0.0f, f2 = 0.0f;
    };

    /// Two filters per channel, clean and saturating ([channel][filter]).
    struct Bank {
        std::array<std::array<dsp::Svf, 2>, 2> clean{};
        std::array<std::array<dsp::RoughSvf, 2>, 2> rough{};
        void reset() noexcept {
            for (auto& ch : clean)
                for (auto& f : ch) f.reset();
            for (auto& ch : rough)
                for (auto& f : ch) f.reset();
        }
        void set(float f1, float q1, float f2, float q2, double sr, bool sat) noexcept {
            for (int c = 0; c < 2; ++c) {
                if (sat) {
                    rough[(size_t)c][0].set(f1, q1, sr);
                    rough[(size_t)c][1].set(f2, q2, sr);
                } else {
                    clean[(size_t)c][0].set(f1, q1, sr);
                    clean[(size_t)c][1].set(f2, q2, sr);
                }
            }
        }
        float process(int c, int k, float x, float mode, bool sat) noexcept {
            const auto o = sat ? rough[(size_t)c][(size_t)k].process(x) : clean[(size_t)c][(size_t)k].process(x);
            return dsp::morphSvf(o, mode);
        }
    };

    static Result run(Bank& b, int routing, const Shape& s, const float* x, bool stereo) noexcept {
        Result r;
        if (routing == DualFilterParams::Stereo) {
            const float y1 = b.process(0, 0, x[0], s.mode1, s.rough);
            const float y2 = b.process(1, 1, x[1], s.mode2, s.rough);
            r.out[0] = y1 * std::min(1.0f, 1.0f - s.balance);
            r.out[1] = y2 * std::min(1.0f, 1.0f + s.balance);
            r.f1 = y1;
            r.f2 = y2;
            return r;
        }
        const int channels = stereo ? 2 : 1;
        float f1 = 0.0f, f2 = 0.0f;
        for (int c = 0; c < channels; ++c) {
            const float y1 = b.process(c, 0, x[c], s.mode1, s.rough);
            float y2, out;
            if (routing == DualFilterParams::Serial) {
                const float bypass = std::max(s.balance, 0.0f);
                y2 = b.process(c, 1, y1 * (s.rough ? 1.0f : s.stage), s.mode2, s.rough);
                out = (1.0f - bypass) * y2 + bypass * y1;
            } else {
                y2 = b.process(c, 1, x[c], s.mode2, s.rough);
                const float g1 = 0.5f * std::clamp(1.0f - s.balance, 0.0f, 2.0f);
                const float g2 = 0.5f * std::clamp(1.0f + s.balance, 0.0f, 2.0f);
                out = g1 * y1 + (routing == DualFilterParams::ParallelInverted ? -g2 : g2) * y2;
            }
            r.out[c] = out;
            f1 += y1;
            f2 += y2;
        }
        if (!stereo) r.out[1] = r.out[0];
        r.f1 = f1 / (float)channels;
        r.f2 = f2 / (float)channels;
        return r;
    }

    struct Last {
        float f1 = -1.0f, f2 = -1.0f, q1 = -1.0f, q2 = -1.0f;
    };

    double sampleRate_ = 48000.0;
    Bank bank_, old_;
    dsp::EnvelopeFollower env_;
    Last last_{};
    float fade_ = 0.0f, fadeStep_ = 0.002f;
    int routing_ = -1, oldRouting_ = 0, character_ = -1;
};

}  // namespace bleep::patch
