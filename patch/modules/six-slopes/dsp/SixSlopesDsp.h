// SPDX-License-Identifier: GPL-3.0-or-later
// Six Slopes core (doc/specs/modules/six-slopes.md): six independent rise/fall
// slopes sharing one set of controls. Harmonics spreads their rates over
// overtone or undertone ratios (optionally snapped to whole numbers or a just
// scale); each channel has its own trigger. Modes: one-shot (AR), sustained
// (ASR), looping and audio-rate (Sound). The slopes are dsp::Slope.
#pragma once

#include "dsp/Slope.h"
#include "dsp/Tempo.h"
#include "dsp/Waves.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum SixMode { SixAR = 0, SixASR, SixLoop, SixSound };
enum SixSnap { SixSnapOff = 0, SixSnapInteger, SixSnapJust };

struct SixParams {
    float rate = 0.4256f;   ///< Rate knob, normalised (slope modes 0.02–1000 Hz, Sound 16 Hz – 4 kHz)
    float pitch = 0.0f;     ///< octaves
    float harmonics = 0.0f; ///< −1..+1
    float skew = 0.25f;
    float curve = 0.0f;
    float level = 1.0f;
    float tilt = 0.0f;
    int mode = SixAR;
    int snap = SixSnapOff;
    int sync = 0;           ///< 0 = free, else an index into syncName()
    bool bipolar = false;   ///< Loop only (Sound is always bipolar)
};

struct SixTime {
    bool running = false;
    bool started = false;
    double bpm = 120.0;
    double ppq = 0.0;
};

struct SixFrame {
    float out[6] = {};
    float sum = 0.0f, end1 = 0.0f, active = 0.0f;
};

class SixSlopesDsp {
public:
    static constexpr int kChannels = 6;
    static constexpr double kC4 = 261.6255653005986;

    /// Sync: Free, then the shared note values from 8 bars to 1/32T.
    static constexpr int kFirstSyncValue = 1, kLastSyncValue = 21;
    static constexpr int kSyncChoices = 1 + kLastSyncValue - kFirstSyncValue + 1;
    static const char* syncName(int i) noexcept {
        return i <= 0 ? "Free" : dsp::noteValues()[(size_t)(kFirstSyncValue + std::min(i, kSyncChoices - 1) - 1)].name;
    }
    static double syncBeats(int i) noexcept {
        return i <= 0 ? 0.0 : dsp::noteValueBeats(kFirstSyncValue + std::min(i, kSyncChoices - 1) - 1);
    }

    /// Rate knob (0..1) → Hz of channel 1 before Pitch. Slope modes: 0.02–1000 Hz
    /// exponential (the declared knob). Sound: 16 Hz … C4 at the centre … 4 kHz.
    static double rateHz(bool sound, float n) noexcept {
        const double x = std::clamp((double)n, 0.0, 1.0);
        if (!sound) return 0.02 * std::pow(50000.0, x);
        return x < 0.5 ? 16.0 * std::pow(kC4 / 16.0, 2.0 * x) : kC4 * std::pow(4000.0 / kC4, 2.0 * x - 1.0);
    }

    /// Nearest just ratio: 1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8 (or 2) times a power of two.
    static double justRatio(double ratio) noexcept {
        static constexpr double just[8] = {1.0, 9.0 / 8.0, 5.0 / 4.0, 4.0 / 3.0, 3.0 / 2.0, 5.0 / 3.0, 15.0 / 8.0, 2.0};
        const double l = std::log2(std::max(ratio, 1e-6));
        const double oct = std::floor(l);
        const double f = l - oct;
        double best = 1.0, dist = 1e9;
        for (double j : just) {
            const double d = std::fabs(std::log2(j) - f);
            if (d < dist) dist = d, best = j;
        }
        return best * std::exp2(oct);
    }

    /// Rate ratio of channel k (0-based) for Harmonics h and a Snap.
    static double ratio(int k, float h, int snap) noexcept {
        const double hh = std::clamp((double)h, -1.0, 1.0);
        double x = 1.0 + k * std::fabs(hh);
        if (snap == SixSnapInteger) x = std::max(1.0, std::round(x));
        double r = hh >= 0.0 ? x : 1.0 / x;
        if (snap == SixSnapJust) r = justRatio(r);
        return r;
    }

    /// Level balance across channels (k 0-based): + favours the higher ones.
    static float tilt(int k, float t) noexcept {
        return std::clamp(1.0f + std::clamp(t, -1.0f, 1.0f) * ((float)(k + 1) - 3.5f) / 2.5f, 0.0f, 1.0f);
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        for (auto& s : slopes_) s.prepare(sampleRate);
        reset();
    }
    void reset() noexcept {
        for (auto& s : slopes_) s.reset();
        for (auto& g : trig_) g.reset();
        origin_.fill(0.0);
        ratios_.fill(1.0);
        hz_.fill(1.0);
    }

    double phase(int k) const noexcept { return slopes_[(size_t)k].phase(); }
    double ratioOf(int k) const noexcept { return ratios_[(size_t)k]; }
    double hzOf(int k) const noexcept { return hz_[(size_t)k]; }

    /// One sample. `trig[k]` is channel k's Trig (already normalled).
    void tick(const SixParams& p, const float* trig, const SixTime& t, SixFrame& f) noexcept {
        const bool sound = p.mode == SixSound;
        const bool loop = p.mode == SixLoop || sound;
        const double beats = sound ? 0.0 : syncBeats(p.sync);
        const bool locked = p.mode == SixLoop && beats > 0.0 && t.running;
        if (t.started) {
            origin_.fill(0.0);
            if (p.mode == SixLoop)
                for (auto& s : slopes_) s.setPhase(0.0);
        }
        double f1;
        double octave = 1.0;
        if (beats > 0.0) {
            octave = std::exp2(std::round((double)p.pitch));  // whole octaves keep the lock
            f1 = dsp::syncedHz(t.bpm, beats) * octave;
        } else {
            f1 = dsp::voctHz(rateHz(sound, p.rate), (double)p.pitch);
        }

        dsp::SlopeParams sp;
        sp.skew = std::clamp(p.skew, 0.005f, 0.995f);
        sp.curve = p.curve;
        sp.morphCurve = false;  // Function's curve
        sp.mode = p.mode == SixAR ? dsp::SlopeMode::AD : p.mode == SixASR ? dsp::SlopeMode::AR : dsp::SlopeMode::Loop;
        const bool bipolar = sound || (p.mode == SixLoop && p.bipolar);
        const double nyquist4 = 0.25 * sampleRate_;
        float sum = 0.0f;
        bool any = false;
        f.end1 = 0.0f;
        for (int k = 0; k < kChannels; ++k) {
            const double r = ratio(k, p.harmonics, p.snap);
            ratios_[(size_t)k] = r;
            sp.hz = f1 * r;
            hz_[(size_t)k] = sp.hz;
            dsp::SlopeFrame fr;
            if (locked) {
                if (trig_[(size_t)k].process(trig[k]) > 0) origin_[(size_t)k] = t.ppq;  // until the next transport start
                fr = slopes_[(size_t)k].tickAt(sp, dsp::ppqPhase(t.ppq - origin_[(size_t)k], beats, octave * r));
            } else {
                trig_[(size_t)k].process(trig[k]);
                fr = slopes_[(size_t)k].tick(sp, trig[k]);
            }
            any = any || fr.active;
            if (k == 0 && fr.endOfCycle) f.end1 = 1.0f;
            float v = bipolar ? 2.0f * fr.value - 1.0f : fr.value;
            if (sound) {  // fade out over the octave below sr/4 instead of aliasing
                const double fade = sp.hz <= 0.5 * nyquist4 ? 1.0 : std::clamp(std::log2(nyquist4 / sp.hz), 0.0, 1.0);
                v *= (float)fade;
            }
            v *= std::clamp(p.level, 0.0f, 1.0f) * tilt(k, p.tilt);
            f.out[k] = v;
            sum += v;
        }
        // Six equal slopes reach full scale when about half are up.
        const float s = sum / 3.0f;
        if (sound) f.sum = std::tanh(s);
        else f.sum = bipolar ? std::clamp(s, -1.0f, 1.0f) : std::clamp(s, 0.0f, 1.0f);
        f.active = loop || any ? 1.0f : 0.0f;
    }

private:
    double sampleRate_ = 48000.0;
    std::array<dsp::Slope, kChannels> slopes_;
    std::array<dsp::GateEdge, kChannels> trig_;
    std::array<double, kChannels> origin_{};
    std::array<double, kChannels> ratios_{}, hz_{};
};

}  // namespace bleep::patch
