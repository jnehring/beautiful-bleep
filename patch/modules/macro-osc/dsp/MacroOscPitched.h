// SPDX-License-Identifier: GPL-3.0-only
// Macro Osc models 1–9, the pitched ones (doc/specs/modules/macro-oscillator.md
// 4.2): reduced versions of the dedicated oscillators, built from the shared
// cores in patch/common/dsp (SyncOsc, Folder, FormantOsc, PartialBank, the
// wavetable banks, the chord table, the vowel table, Svf).
//
// Anti-aliasing: VA Pair and Chord are polyBLEP/polyBLAMP (SyncOsc, OscCore);
// Fold, FM and Phase Warp run at the Quality oversampling factor into the
// shared half-band decimator and also limit their brightness (drive, index,
// resonance) so their bandwidth stays below the oversampled Nyquist;
// Harmonic fades partials out below 0.45 fs; Table reads band-limited mips;
// Grain and Vowel are smooth by construction (windowed sines, filters).
#pragma once

#include "MacroOscCommon.h"
#include "dsp/Chords.h"
#include "dsp/Folder.h"
#include "dsp/Formant.h"
#include "dsp/OscCore.h"
#include "dsp/Oversampler.h"
#include "dsp/Partials.h"
#include "dsp/Svf.h"
#include "dsp/Wavetable.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch::macro {

/// The polyBLEP models (VA Pair, Chord, Vowel's glottis) run at 4× in Normal
/// and High: at 2× the residual aliasing of polyBLEP is only about −55 dB at C7.
inline int blepFactor(int os) noexcept { return os <= 1 ? 1 : 4; }

/// Linear interpolation of the input frequency over the oversampled sub-steps.
struct HzRamp {
    double last = 0.0;
    bool primed = false;
    void reset() noexcept { primed = false; }
    double at(double hz, int k, int os) noexcept {
        if (!primed) last = hz, primed = true;
        return last + (hz - last) * (double)(k + 1) / (double)os;
    }
    void done(double hz) noexcept { last = hz; }
};

// ---- 1 VA Pair -----------------------------------------------------------------

/// Two SyncOsc cores, oversampled by Quality. Tone: detune 0…1 semitone (0–70 %, slow curve), then the
/// intervals 3rd, 4th, 5th and octave. Shape: saw → square (0–50 %), then the
/// pulse narrows to 5 %. Blend: osc 2 hard-synced to osc 1, its ratio rising
/// by up to three octaves.
struct VaPairModel {
    dsp::SyncOsc a, b;
    dsp::Downsampler down[2];
    HzRamp ramp;
    double ratio = 1.0;

    void prepare(double) noexcept {}
    void reset() noexcept {
        a.reset();
        b.reset(0.25);
        activate();
    }
    void activate() noexcept {
        down[0].reset(), down[1].reset();
        ramp.reset();
    }

    static double intervalSemitones(float tone) noexcept {
        if (tone < 0.7f) return std::pow((double)tone / 0.7, 5.0);  // 0 … 1 semitone, 50 % ≈ 19 cents
        static constexpr double kSteps[4] = {4.0, 5.0, 7.0, 12.0};
        return kSteps[std::min(3, (int)((tone - 0.7f) / 0.075f))];
    }
    void control(const MacroIn& in) noexcept { ratio = std::exp2(intervalSemitones(in.tone) / 12.0); }

    static float wave(const dsp::OscWaves& w, float shape, float pw) noexcept {
        if (shape < 0.5f) return w.saw + 2.0f * shape * (w.square - w.saw);
        return w.square - (2.0f * pw - 1.0f);  // the pulse's DC removed
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const int os = blepFactor(in.os);
        const double osRate = in.sampleRate * os;
        const float shape = std::clamp(in.shape, 0.0f, 1.0f), blend = std::clamp(in.blend, 0.0f, 1.0f);
        const float pw = shape <= 0.5f ? 0.5f : 0.5f - 0.9f * (shape - 0.5f);
        const double syncRatio = blend > 0.0f ? std::exp2(3.0 * (double)blend) : 1.0;
        float o[4], x[4];
        for (int k = 0; k < os; ++k) {
            const double hz = ramp.at(in.hz, k, os);
            const dsp::OscWaves wa = a.process(dsp::osc::increment(hz, osRate), pw);
            const double syncAt = blend > 0.001f ? a.wrapAt() : -1.0;
            const dsp::OscWaves wb = b.process(dsp::osc::increment(hz * ratio * syncRatio, osRate), pw, syncAt, 1.0f);
            const float va = wave(wa, shape, pw), vb = wave(wb, shape, pw);
            o[k] = 0.5f * (va + vb);
            x[k] = 0.7f * vb;
        }
        ramp.done(in.hz);
        MacroOut r;
        r.out = down[0].process(o, os);
        if (in.wantAux) r.aux = down[1].process(x, os);
        return r;
    }
};

// ---- 2 Fold --------------------------------------------------------------------

/// Sine → triangle (Blend) × drive 1…16 (Tone) with a bias (Shape) into four
/// fold stages (dsp::Folder, ADAA), oversampled. The drive is limited so the
/// folded bandwidth (≈ drive × f) stays below a quarter of the oversampled
/// rate: high notes fold less instead of aliasing.
struct FoldModel {
    dsp::SyncOsc osc;
    dsp::Folder folder;
    dsp::fold::DcBlocker dc;
    dsp::Downsampler down[2];
    HzRamp ramp;

    void prepare(double sampleRate) noexcept { dc.prepare(sampleRate); }
    void reset() noexcept {
        osc.reset();
        activate();
    }
    void activate() noexcept {
        folder.reset();
        dc.reset();
        down[0].reset(), down[1].reset();
        ramp.reset();
    }
    void control(const MacroIn&) noexcept {}

    static float drive(float tone, double hz, double osRate) noexcept {
        const float d = 1.0f + 15.0f * tone * tone;
        const float cap = (float)std::max(1.0, 0.11 * osRate / std::max(std::fabs(hz), 1.0));
        return std::min(d, cap);
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const int os = in.os;
        const double osRate = in.sampleRate * os;
        const float blend = std::clamp(in.blend, 0.0f, 1.0f);
        const float g = drive(std::clamp(in.tone, 0.0f, 1.0f), in.baseHz, osRate);
        dsp::Folder::Params fp;
        fp.gain = 1.0f;
        fp.symmetry = 0.6f * (2.0f * std::clamp(in.shape, 0.0f, 1.0f) - 1.0f);
        fp.shape = 1.0f;       // later stages: hard reflection (cheap, no trig)
        fp.firstShape = 0.0f;  // the first: a soft sine fold
        fp.tap = 4.0f;
        float o[4], x[4];
        for (int k = 0; k < os; ++k) {
            const double hz = ramp.at(in.hz, k, os);
            const dsp::OscWaves w = osc.process(dsp::osc::increment(hz, osRate), 0.5f);
            const float src = w.sine + blend * (w.triangle - w.sine);
            o[k] = folder.process(g * src, fp);
            x[k] = std::clamp(g * src, -1.0f, 1.0f);
        }
        ramp.done(in.hz);
        MacroOut r;
        r.out = 0.8f * dc.process(down[0].process(o, os));
        if (in.wantAux) r.aux = 0.8f * down[1].process(x, os);
        return r;
    }
};

// ---- 3 FM ----------------------------------------------------------------------

/// Two-operator phase modulation, oversampled. Tone picks the modulator ratio
/// (½, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 7, 9; neighbours crossfade around the borders), Shape the
/// index 0…8 (quadratic), Blend the modulator's self-feedback 0…1.2 rad. The
/// index is limited at high notes so the sidebands stay below 0.45 × the
/// oversampled rate.
struct FmModel {
    static constexpr int kRatios = 11;
    static constexpr double kRatio[kRatios] = {0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 7.0, 9.0};
    double pc = 0.0, pm[2] = {0.0, 0.0};
    float fb[2][2] = {};
    int lo = 1;
    float w = 0.0f;
    dsp::Downsampler down[2];
    HzRamp ramp;

    void prepare(double) noexcept {}
    void reset() noexcept {
        pc = pm[0] = pm[1] = 0.0;
        activate();
    }
    void activate() noexcept {
        for (auto& f : fb) f[0] = f[1] = 0.0f;
        down[0].reset(), down[1].reset();
        ramp.reset();
    }
    void control(const MacroIn& in) noexcept {
        // Each ratio owns 1/11 of the knob; neighbours crossfade around the borders.
        const float pos = std::clamp(std::clamp(in.tone, 0.0f, 1.0f) * (float)kRatios - 0.5f, 0.0f, (float)(kRatios - 1));
        const int i = std::min((int)pos, kRatios - 2);
        const float wNew = smooth(pos - (float)i, 0.35f, 0.65f);
        if (i != lo) {  // keep each modulator's phase with its ratio
            if (i == lo + 1) pm[0] = pm[1], fb[0][0] = fb[1][0], fb[0][1] = fb[1][1];
            else if (i == lo - 1) pm[1] = pm[0], fb[1][0] = fb[0][0], fb[1][1] = fb[0][1];
            lo = i;
        }
        w = wNew;
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const int os = in.os;
        const double osRate = in.sampleRate * os;
        const float s = std::clamp(in.shape, 0.0f, 1.0f);
        const double r0 = kRatio[lo], r1 = kRatio[lo + 1];
        const double rMax = w > 0.0f ? r1 : r0;
        const double f = std::max(std::fabs(in.baseHz), 1.0);
        const double room = (0.45 * osRate - f) / (rMax * f) - 1.0;
        const float index = (float)std::min(8.0 * (double)(s * s), std::max(room, 0.0));
        // Feedback (rad → cycles) makes the modulator saw-like: thin it out when
        // the modulator's own harmonics would pass 7 % of the oversampled rate.
        const float fbRoom = (float)std::clamp(0.07 * osRate / (rMax * f) - 1.0, 0.0, 1.0);
        const float beta = 1.2f * std::clamp(in.blend, 0.0f, 1.0f) * fbRoom / 6.2831853f;
        float o[4], m[4];
        for (int k = 0; k < os; ++k) {
            const double dt = ramp.at(in.hz, k, os) / osRate;
            float mod = 0.0f;
            for (int j = 0; j < 2; ++j) {
                const float weight = j == 0 ? 1.0f - w : w;
                if (weight > 0.0f) {
                    const float y = sin2pi(pm[j] + (double)(beta * 0.5f * (fb[j][0] + fb[j][1])));
                    fb[j][1] = fb[j][0];
                    fb[j][0] = y;
                    mod += weight * y;
                }
                pm[j] += dt * (j ? r1 : r0);
                pm[j] -= std::floor(pm[j]);
            }
            o[k] = sin2pi(pc + (double)(index * mod * 0.15915494f));
            m[k] = mod;
            pc += dt;
            pc -= std::floor(pc);
        }
        ramp.done(in.hz);
        MacroOut r;
        r.out = 0.8f * down[0].process(o, os);
        if (in.wantAux) r.aux = 0.8f * down[1].process(m, os);
        return r;
    }
};

// ---- 4 Phase Warp ----------------------------------------------------------------

/// Casio-style phase distortion, oversampled: −cos read through a two-segment
/// phase curve (knee 0.5 → 0.05 by Tone; smooth at both joins, so it stays
/// clean), and a resonance: a sine at 1…16 × f under a falling window,
/// restarted every cycle (Shape), mixed by Blend. Aux: a band-limited square
/// one octave down, flipping at every phase reset.
struct PhaseWarpModel {
    double ph = 0.0, sub = 0.0;
    dsp::fold::DcBlocker dc;
    dsp::Downsampler down[2];
    HzRamp ramp;

    void prepare(double sampleRate) noexcept { dc.prepare(sampleRate, 10.0); }
    void reset() noexcept {
        ph = sub = 0.0;
        activate();
    }
    void activate() noexcept {
        down[0].reset(), down[1].reset();
        dc.reset();
        ramp.reset();
    }
    void control(const MacroIn&) noexcept {}

    MacroOut tick(const MacroIn& in) noexcept {
        const int os = in.os;
        const double osRate = in.sampleRate * os;
        const double knee = 0.5 - 0.45 * (double)std::clamp(in.tone, 0.0f, 1.0f);
        const float s = std::clamp(in.shape, 0.0f, 1.0f), mix = std::clamp(in.blend, 0.0f, 1.0f);
        const double f = std::max(std::fabs(in.baseHz), 1.0);
        const double resMax = std::max(1.0, 0.3 * osRate / f);
        const double res = std::min(1.0 + 15.0 * (double)(s * s), resMax);
        float o[4], q[4];
        for (int k = 0; k < os; ++k) {
            const double dt = dsp::osc::increment(ramp.at(in.hz, k, os), osRate);
            const double pd = dsp::wavetable::phaseDistort(ph, knee);
            const float warp = -sin2pi(pd + 0.25);  // −cos
            float y = warp;
            if (mix > 0.0f) {
                // (1 − φ)² · (1 − cos 2πrφ): zero with zero slope at both ends of the cycle.
                const float win = (float)((1.0 - ph) * (1.0 - ph));
                const float r = 1.2f * win * (1.0f - sin2pi(res * ph + 0.25));
                y = warp + mix * (r - warp);
            }
            o[k] = y;
            const double adt = std::max(std::fabs(dt) * 0.5, 1e-9);
            double sq = sub < 0.5 ? 1.0 : -1.0;
            sq += dsp::osc::polyBlep(sub, adt);
            sq -= dsp::osc::polyBlep(dsp::osc::wrap01(sub - 0.5), adt);
            q[k] = (float)sq;
            ph = dsp::osc::wrap01(ph + dt);
            sub = dsp::osc::wrap01(sub + 0.5 * dt);
        }
        ramp.done(in.hz);
        MacroOut r;
        r.out = 0.8f * dc.process(down[0].process(o, os));
        if (in.wantAux) r.aux = 0.6f * down[1].process(q, os);
        return r;
    }
};

// ---- 5 Grain -------------------------------------------------------------------

/// dsp::FormantOsc: one windowed sine burst per cycle. Tone: grain frequency
/// ½…16 × f; Shape: grain length (100 % = the whole cycle); Blend: a second
/// grain at 1.5 × the formant. Aux: a sine at f.
struct GrainModel {
    dsp::FormantOsc osc;

    void prepare(double sampleRate) noexcept { osc.prepare(sampleRate); }
    void reset() noexcept { osc.reset(); }
    void activate() noexcept {}
    void control(const MacroIn&) noexcept {}

    MacroOut tick(const MacroIn& in) noexcept {
        const double f0 = std::fabs(in.hz);
        const float aux = sin2pi(osc.phase());
        dsp::FormantOsc::Params p;
        p.f0Hz = f0;
        p.formantHz = f0 * 0.5 * std::exp2(5.0 * (double)std::clamp(in.tone, 0.0f, 1.0f));
        p.formant2Hz = 1.5 * p.formantHz;
        p.narrow = 0.95f * (1.0f - std::clamp(in.shape, 0.0f, 1.0f));
        p.reset = 1.0f;
        const float pair = std::clamp(in.blend, 0.0f, 1.0f);
        p.second = pair > 0.0f;
        const auto fr = osc.process(p);
        return {0.55f * (fr.formant + pair * fr.formant2) / (1.0f + 0.5f * pair), 0.7f * aux};
    }
};

// ---- 6 Harmonic ------------------------------------------------------------------

/// 24 partials (dsp::PartialBank): a Gaussian peak at partial 1…24 (Tone,
/// quadratic) of width 0.4…8.4 partials (Shape), on a faint 1/n floor that
/// keeps the fundamental; Blend: all → odd only (50 %) → even only (100 %).
/// The bank fades partials out between 0.40 and 0.45 fs. Aux: the odd partials.
struct HarmonicModel {
    static constexpr int kPartials = 24;
    dsp::PartialBank bank;
    float ratios[kPartials] = {};

    void prepare(double sampleRate) noexcept {
        bank.prepare(sampleRate);
        for (int i = 0; i < kPartials; ++i) ratios[i] = (float)(i + 1);
    }
    void reset() noexcept { bank.reset(); }
    void activate() noexcept {}

    static void levels(float tone, float shape, float blend, float* out) noexcept {
        const float c = 1.0f + 23.0f * tone * tone;
        const float sigma = 0.4f + 8.0f * shape * shape;
        const float balance = blend < 0.5f ? -2.0f * blend : -1.0f + 4.0f * (blend - 0.5f);
        for (int n = 1; n <= kPartials; ++n) {
            const float d = ((float)n - c) / sigma;
            const float l = std::exp(-0.5f * d * d) + 0.12f / (float)n;
            out[n - 1] = l * dsp::partials::oddEvenGain(n, balance);
        }
        const float norm = dsp::PartialBank::norm(out, kPartials);
        for (int i = 0; i < kPartials; ++i) out[i] *= 0.45f / std::max(norm, 1e-6f);
    }
    void control(const MacroIn& in) noexcept {
        float lv[kPartials];
        levels(std::clamp(in.tone, 0.0f, 1.0f), std::clamp(in.shape, 0.0f, 1.0f), std::clamp(in.blend, 0.0f, 1.0f), lv);
        bank.setPartials(ratios, lv, kPartials, std::fabs(in.baseHz));
    }
    MacroOut tick(const MacroIn& in) noexcept {
        if (!in.wantAux) return {bank.process(in.hz), 0.0f};
        float odd = 0.0f, even = 0.0f;
        bank.processOddEven(in.hz, odd, even);
        return {odd + even, odd};
    }
};

// ---- 7 Table -------------------------------------------------------------------

/// Eight of the Wavetable Osc's factory banks (Tone, stepped, 5 ms crossfade
/// on a change), X (Shape) and Y (Blend) on the 8 × 8 grid, band-limited
/// mips. Aux: the same position one octave down.
struct TableModel {
    static constexpr int kBanks = 8;
    static constexpr dsp::wavetable::FactoryBank kBank[kBanks] = {
        dsp::wavetable::FactoryBank::Analog, dsp::wavetable::FactoryBank::Harmonic,
        dsp::wavetable::FactoryBank::Pulse,  dsp::wavetable::FactoryBank::Sync,
        dsp::wavetable::FactoryBank::FM,     dsp::wavetable::FactoryBank::Organ,
        dsp::wavetable::FactoryBank::Digital, dsp::wavetable::FactoryBank::Bell};
    const dsp::WavetableBank* banks[kBanks] = {};
    double ph = 0.0, ph2 = 0.0;
    int bank = 0, prev = -1;
    float fade = 1.0f, fadeStep = 0.004f;

    /// Builds (once per process) and looks up the shared banks: allocates.
    void prepare(double sampleRate) {
        for (int i = 0; i < kBanks; ++i) banks[i] = &dsp::wavetable::factoryBank(kBank[i]);
        fadeStep = (float)(1.0 / (0.005 * sampleRate));
    }
    void reset() noexcept {
        ph = ph2 = 0.0;
        prev = -1;
        fade = 1.0f;
    }
    void activate() noexcept {}
    static int bankFor(float tone) noexcept { return std::clamp((int)(tone * (float)kBanks), 0, kBanks - 1); }
    void control(const MacroIn& in) noexcept {
        const int b = bankFor(std::clamp(in.tone, 0.0f, 1.0f));
        if (b != bank && fade >= 1.0f) {
            prev = bank;
            bank = b;
            fade = 0.0f;
        }
    }
    float read(int b, float x, float y, double phase, dsp::wavetable::Mip mip) const noexcept {
        return banks[b] ? dsp::wavetable::readXY(*banks[b], x, y, phase, mip, dsp::wavetable::Interp::Cubic) : 0.0f;
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const float x = 7.0f * std::clamp(in.shape, 0.0f, 1.0f), y = 7.0f * std::clamp(in.blend, 0.0f, 1.0f);
        const auto mip = dsp::wavetable::selectMip(std::fabs(in.hz), in.sampleRate);
        float v = read(bank, x, y, ph, mip), a = 0.0f;
        const bool aux = in.wantAux;
        dsp::wavetable::Mip mip2;
        if (aux) {
            mip2 = dsp::wavetable::selectMip(0.5 * std::fabs(in.hz), in.sampleRate);
            a = read(bank, x, y, ph2, mip2);
        }
        if (fade < 1.0f) {
            const float t = smooth(fade, 0.0f, 1.0f);
            v = read(prev, x, y, ph, mip) + t * (v - read(prev, x, y, ph, mip));
            if (aux) a = read(prev, x, y, ph2, mip2) + t * (a - read(prev, x, y, ph2, mip2));
            fade = std::min(1.0f, fade + fadeStep);
        }
        const double dt = dsp::osc::increment(in.hz, in.sampleRate);
        ph = dsp::osc::wrap01(ph + dt);
        ph2 = dsp::osc::wrap01(ph2 + 0.5 * dt);
        return {0.7f * v, 0.7f * a};
    }
};

// ---- 8 Chord -------------------------------------------------------------------

/// Four OscCore voices, oversampled by Quality (polyBLEP saw, polyBLAMP triangle) playing a chord from
/// the shared chord table (Chords.h). Tone: 12 chords; Shape: 8 voicings
/// (root position, three inversions, Drop 2, Open, Wide, Spread); Blend: sine
/// → triangle → saw. A few cents of fixed detune per voice. Aux: the root voice.
struct ChordModel {
    static constexpr int kVoices = 4, kChords = 12, kVoicings = 8;
    std::array<dsp::OscCore, kVoices> osc{};
    double ratio[kVoices] = {1.0, 1.0, 1.0, 1.0};
    int chord = -1, voicing = -1;
    dsp::Downsampler down[2];
    HzRamp ramp;

    static const char* chordName(int i) noexcept {
        static const char* const names[kChords] = {"Oct", "5", "sus2", "sus4", "m", "M", "m7", "maj7", "7", "m9", "maj9", "6/9"};
        return names[std::clamp(i, 0, kChords - 1)];
    }
    /// The chord's intervals; returns the count.
    static int intervals(int i, int* out) noexcept {
        static constexpr int kIds[kChords] = {-1, dsp::ChordFifth, dsp::ChordSus2, dsp::ChordSus4, dsp::ChordMinor,
                                              dsp::ChordMajor, dsp::ChordMinor7, dsp::ChordMajor7, dsp::ChordDominant7,
                                              dsp::ChordMinor9, dsp::ChordMajor9, dsp::Chord6Add9};
        const int id = kIds[std::clamp(i, 0, kChords - 1)];
        if (id < 0) {  // octaves
            out[0] = 0, out[1] = 12;
            return 2;
        }
        return dsp::chordIntervals(id, out);
    }
    /// Semitones of the four voices (voice 0 is the root) for a chord and voicing step.
    static void voices(int chordIndex, int voicingStep, int* semis) noexcept {
        int iv[dsp::kMaxChordTones];
        const int n = intervals(chordIndex, iv);
        const int inversion = voicingStep < 4 ? voicingStep : 0;
        static constexpr int kVoicing[kVoicings] = {dsp::VoicingClose, dsp::VoicingClose, dsp::VoicingClose, dsp::VoicingClose,
                                                    dsp::VoicingDrop2, dsp::VoicingOpen,  dsp::VoicingWide,  dsp::VoicingSpread};
        dsp::ChordVoicing v = dsp::buildChord(0, iv, n, kVoices, inversion, kVoicing[std::clamp(voicingStep, 0, kVoicings - 1)]);
        for (int k = 0; k < kVoices; ++k) semis[k] = k < v.count ? v.pitch[k] : 0;
    }

    void prepare(double) noexcept {
        for (auto& o : osc) o.setTriangleBlamp(true);
    }
    void reset() noexcept {
        for (int k = 0; k < kVoices; ++k) osc[(size_t)k].reset(0.25 * k);
        chord = voicing = -1;
        activate();
    }
    void activate() noexcept {
        down[0].reset(), down[1].reset();
        ramp.reset();
    }
    void control(const MacroIn& in) noexcept {
        const int c = std::clamp((int)(std::clamp(in.tone, 0.0f, 1.0f) * kChords), 0, kChords - 1);
        const int v = std::clamp((int)(std::clamp(in.shape, 0.0f, 1.0f) * kVoicings), 0, kVoicings - 1);
        if (c == chord && v == voicing) return;
        chord = c, voicing = v;
        int semis[kVoices];
        voices(c, v, semis);
        static constexpr double kDetuneCents[kVoices] = {0.0, 3.0, -3.5, 5.0};
        for (int k = 0; k < kVoices; ++k) ratio[k] = std::exp2((double)semis[k] / 12.0 + kDetuneCents[k] / 1200.0);
    }
    MacroOut tick(const MacroIn& in) noexcept {
        const int os = blepFactor(in.os);
        const double osRate = in.sampleRate * os;
        const float b = std::clamp(in.blend, 0.0f, 1.0f);
        float o[4], x[4];
        for (int j = 0; j < os; ++j) {
            const double hz = ramp.at(in.hz, j, os);
            float sum = 0.0f, root = 0.0f;
            for (int k = 0; k < kVoices; ++k) {
                const dsp::OscWaves w = osc[(size_t)k].tick(dsp::osc::increment(hz * ratio[k], osRate), 0.5f);
                const float y = b < 0.5f ? w.sine + 2.0f * b * (w.triangle - w.sine)
                                         : w.triangle + (2.0f * b - 1.0f) * (w.saw - w.triangle);
                sum += y;
                if (k == 0) root = y;
            }
            o[j] = 0.32f * sum;
            x[j] = 0.7f * root;
        }
        ramp.done(in.hz);
        MacroOut r;
        r.out = down[0].process(o, os);
        if (in.wantAux) r.aux = down[1].process(x, os);
        return r;
    }
};

// ---- 9 Vowel -------------------------------------------------------------------

/// A glottal pulse (polyBLEP saw, softened by a one-pole, oversampled by
/// Quality) and breath noise
/// into three ZDF band-passes (Svf) on the shared vowel table
/// (formant::vowelAt, a → e → i → o → u by Tone, ±1 octave of tract size by
/// Shape). Blend: voiced → whispered. Aux: the unvoiced (noise) part.
struct VowelModel {
    dsp::OscCore glottis;
    dsp::Svf voiced[3], unvoiced[3];
    float gain[3] = {}, k[3] = {};
    float lp = 0.0f, lpA = 0.8f;
    int lpOs = 0;
    dsp::Downsampler down;
    HzRamp ramp;
    Rng rng;

    void prepare(double) noexcept {}
    void reset() noexcept {
        glottis.reset();
        for (auto& f : voiced) f.reset();
        for (auto& f : unvoiced) f.reset();
        activate();
    }
    void reseed(uint64_t seed) noexcept { rng.seed(seed); }
    void activate() noexcept {
        lp = 0.0f;
        down.reset();
        ramp.reset();
    }
    void control(const MacroIn& in) noexcept {
        if (blepFactor(in.os) != lpOs) {
            lpOs = blepFactor(in.os);
            lpA = (float)std::exp(-6.283185307 * 1800.0 / (in.sampleRate * lpOs));
        }
        const dsp::formant::Vowel v =
            dsp::formant::vowelAt(4.0f * std::clamp(in.tone, 0.0f, 1.0f), 1.0f - 2.0f * std::clamp(in.shape, 0.0f, 1.0f));
        for (int i = 0; i < 3; ++i) {
            const float hz = std::min(v.f[i].hz, 0.42f * (float)in.sampleRate);
            const float q = std::clamp(hz / std::max(v.f[i].bandwidthHz, 20.0f), 0.7f, 30.0f);
            voiced[i].set(hz, q, in.sampleRate);
            unvoiced[i].set(hz, q, in.sampleRate);
            k[i] = 1.0f / q;
            gain[i] = std::pow(10.0f, v.f[i].gainDb / 20.0f);
        }
    }
    MacroOut tick(const MacroIn& in) noexcept {
        // The glottal pulse at the oversampled rate: a falling polyBLEP ramp, softened by a one-pole.
        const int os = blepFactor(in.os);
        float g[4], saw = 0.0f;
        for (int j = 0; j < os; ++j) {
            const double hz = std::fabs(ramp.at(in.hz, j, os));
            saw = glottis.tick(dsp::osc::increment(hz, in.sampleRate * os), 0.5f).saw;
            lp = (1.0f - lpA) * -saw + lpA * lp;
            g[j] = lp;
        }
        ramp.done(in.hz);
        const float glottal = down.process(g, os);
        const float breath = std::clamp(in.blend, 0.0f, 1.0f);
        const float noise = rng.bipolar();
        const float ev = (1.0f - breath) * (2.0f * glottal) + 0.04f * (1.0f - breath) * noise * (0.5f - 0.5f * saw);
        const float eu = breath * 1.4f * noise;
        float out = 0.0f, aux = 0.0f;
        if (in.wantAux) {
            for (int i = 0; i < 3; ++i) {
                out += gain[i] * k[i] * voiced[i].process(ev).bp;
                aux += gain[i] * k[i] * unvoiced[i].process(eu).bp;
            }
            return {1.6f * (out + aux), 1.6f * aux};
        }
        for (int i = 0; i < 3; ++i) out += gain[i] * k[i] * voiced[i].process(ev + eu).bp;
        return {1.6f * out, 0.0f};
    }
};

}  // namespace bleep::patch::macro
