// SPDX-License-Identifier: GPL-3.0-or-later
// Speak (doc/specs/modules/speak.md): a small cascade-formant speech synthesiser.
// A phoneme string is parsed (message thread) into segments; the voice runs
// them at a rate. Vowels, nasals and approximants are a band-limited pulse
// through a resonator cascade; fricatives and plosive bursts are noise through
// a band; "h" is noise through the vocal tract. Everything is deterministic:
// the noise generator restarts from a fixed seed on reset.
#pragma once

#include "dsp/Noise.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <string>

namespace bleep::patch {

namespace speak {

enum Kind : uint8_t { Vowel, Nasal, Approx, Fric, VFric, Stop, VStop, Aspirate, Pause };

struct Phoneme {
    const char* sym;
    Kind kind;
    float f1, f2, f3;  ///< formant targets in Hz
    float voice;       ///< amplitude of the voiced source
    float noise;       ///< amplitude of the noise source
    float nf, nbw;     ///< noise band centre / width in Hz (Fric, Stop bursts)
    float dur;         ///< length in units; a unit lasts 1 / Speed seconds
};

/// Symbols are matched longest first (two letters before one).
inline const std::array<Phoneme, 36>& table() {
    static const std::array<Phoneme, 36> t = {{
        {"a", Vowel, 730, 1090, 2440, 1.0f, 0, 0, 0, 1.3f},   {"e", Vowel, 530, 1840, 2480, 1.0f, 0, 0, 0, 1.1f},
        {"i", Vowel, 390, 1990, 2550, 1.0f, 0, 0, 0, 0.9f},   {"o", Vowel, 570, 840, 2410, 1.0f, 0, 0, 0, 1.3f},
        {"u", Vowel, 440, 1020, 2240, 1.0f, 0, 0, 0, 0.9f},   {"ee", Vowel, 270, 2290, 3010, 1.0f, 0, 0, 0, 1.3f},
        {"oo", Vowel, 300, 870, 2240, 1.0f, 0, 0, 0, 1.3f},   {"ae", Vowel, 660, 1720, 2410, 1.0f, 0, 0, 0, 1.3f},
        {"uh", Vowel, 640, 1190, 2390, 1.0f, 0, 0, 0, 1.0f},  {"er", Vowel, 490, 1350, 1690, 1.0f, 0, 0, 0, 1.3f},
        {"m", Nasal, 250, 1100, 2200, 0.55f, 0, 0, 0, 0.9f},  {"n", Nasal, 250, 1500, 2500, 0.55f, 0, 0, 0, 0.8f},
        {"ng", Nasal, 250, 1900, 2600, 0.5f, 0, 0, 0, 0.9f},  {"l", Approx, 360, 1300, 2500, 0.8f, 0, 0, 0, 0.8f},
        {"r", Approx, 310, 1060, 1380, 0.8f, 0, 0, 0, 0.8f},  {"w", Approx, 290, 610, 2150, 0.8f, 0, 0, 0, 0.7f},
        {"y", Approx, 260, 2070, 3020, 0.8f, 0, 0, 0, 0.7f},  {"s", Fric, 400, 1600, 2600, 0, 0.9f, 7000, 3500, 1.0f},
        {"sh", Fric, 400, 1600, 2600, 0, 0.9f, 3300, 1800, 1.1f}, {"f", Fric, 400, 1600, 2600, 0, 0.35f, 4500, 5000, 0.9f},
        {"th", Fric, 400, 1600, 2600, 0, 0.3f, 5200, 4500, 0.9f}, {"z", VFric, 300, 1600, 2600, 0.45f, 0.6f, 7000, 3500, 0.9f},
        {"zh", VFric, 300, 1600, 2600, 0.45f, 0.6f, 3000, 1800, 0.9f}, {"v", VFric, 300, 1100, 2400, 0.45f, 0.25f, 4500, 5000, 0.8f},
        {"dh", VFric, 300, 1400, 2500, 0.45f, 0.2f, 5000, 4500, 0.7f}, {"h", Aspirate, 500, 1500, 2500, 0, 0.55f, 0, 0, 0.8f},
        {"p", Stop, 250, 900, 2200, 0, 0.7f, 900, 1600, 0.8f}, {"t", Stop, 250, 1700, 2600, 0, 0.8f, 4500, 2500, 0.8f},
        {"k", Stop, 250, 1400, 2000, 0, 0.8f, 2000, 1500, 0.9f}, {"b", VStop, 250, 900, 2200, 0.3f, 0.5f, 900, 1600, 0.7f},
        {"d", VStop, 250, 1700, 2600, 0.3f, 0.5f, 4000, 2500, 0.7f}, {"g", VStop, 250, 1400, 2000, 0.3f, 0.5f, 2000, 1500, 0.8f},
        {"ch", Stop, 250, 1700, 2600, 0, 0.9f, 3300, 1800, 1.1f}, {"j", VStop, 250, 1700, 2600, 0.3f, 0.7f, 3000, 1800, 1.0f},
        {"_", Pause, 0, 0, 0, 0, 0, 0, 0, 0.0f},              {" ", Pause, 0, 0, 0, 0, 0, 0, 0, 1.0f},
    }};
    return t;
}

constexpr int kMaxSegments = 256;

struct Segment {
    uint8_t phoneme = 0;     ///< index into table()
    bool accent = false;     ///< ' before it: louder, higher
    float length = 1.0f;     ///< multiplier from ':' (lengthen) and ',' style pauses
};

struct Sequence {
    std::array<Segment, kMaxSegments> seg{};
    int count = 0;
};

/// Text → segments. Case-insensitive; "'" accents the next phoneme, ":" lengthens the previous one,
/// space and "." are a pause, "," and "-" a half pause, "_" separates letters that would otherwise join
/// into a two-letter symbol (a_e is a then e, ae is one vowel). Unknown characters are skipped.
inline Sequence parse(const std::string& text) {
    Sequence q;
    auto find = [](const std::string& s, size_t pos, int len) -> int {
        if (pos + (size_t)len > s.size()) return -1;
        const auto& t = table();
        for (size_t i = 0; i < t.size(); ++i)
            if (std::string(t[i].sym).size() == (size_t)len && s.compare(pos, (size_t)len, t[i].sym) == 0 && t[i].kind != Pause) return (int)i;
        return -1;
    };
    std::string s;
    for (char ch : text) s += (char)std::tolower((unsigned char)ch);
    bool accent = false;
    size_t i = 0;
    auto push = [&](int ph, float length, bool acc) {
        if (q.count < kMaxSegments) q.seg[(size_t)q.count++] = {(uint8_t)ph, acc, length};
    };
    const int pauseIndex = (int)table().size() - 1;
    while (i < s.size()) {
        const char ch = s[i];
        if (ch == '\'') { accent = true; ++i; continue; }
        if (ch == ':') { if (q.count) q.seg[(size_t)q.count - 1].length *= 1.8f; ++i; continue; }
        if (ch == ' ' || ch == '.') { push(pauseIndex, 1.0f, false); ++i; accent = false; continue; }
        if (ch == ',' || ch == '-') { push(pauseIndex, 0.5f, false); ++i; accent = false; continue; }
        if (ch == '_') { ++i; continue; }
        int ph = find(s, i, 2);
        int len = 2;
        if (ph < 0) { ph = find(s, i, 1); len = 1; }
        if (ph < 0) { ++i; continue; }
        push(ph, 1.0f, accent);
        accent = false;
        i += (size_t)len;
    }
    return q;
}

}  // namespace speak

struct SpeakParams {
    float speed = 8.0f;       ///< units per second
    float pitchOct = 0.0f;    ///< octaves above C4 (jack + knobs)
    float formantShift = 0.0f;///< semitones
    float breath = 0.1f;      ///< 0…1
    float intonation = 0.5f;  ///< 0…1
    float glide = 0.5f;       ///< 0…1: how far the formants slide between sounds
    int mode = 0;             ///< 0 loop, 1 gate (one pass per gate), 2 step (a trigger per sound)
};

struct SpeakFrame {
    float out = 0.0f;
    bool voiced = false;
    bool trig = false;      ///< a new sound started
    float position = 0.0f;  ///< 0…1 through the text
};

class SpeakDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        seg_ = 0;
        elapsed_ = 0;
        segLen_ = 1;
        running_ = false;
        ended_ = true;
        started_ = false;
        gatePrev_ = false;
        phase_ = 0.0;
        for (auto& r : res_) r = {};
        nzRes_ = {};
        src_ = 0.0f;
        lastWhite_ = 0.0f;
        f1_ = f2_ = f3_ = 500.0f;
        voiceAmp_ = noiseAmp_ = 0.0f;
        nf_ = 3000.0f;
        nbw_ = 2000.0f;
        noise_ = dsp::WhiteNoise(0x5eed1234u);
        pitchSm_ = 0.0f;
        tick_ = 0;
    }

    /// `gate` is the Go input (high/low); in Loop mode it is ignored.
    SpeakFrame tick(const speak::Sequence* seq, const SpeakParams& p, bool gate) noexcept {
        SpeakFrame fr;
        const int n = seq ? seq->count : 0;
        const bool rise = gate && !gatePrev_;
        gatePrev_ = gate;
        // ---- sequencing
        if (n == 0) {
            running_ = false;
        } else if (p.mode == 0) {
            if (!running_) startSegment(*seq, 0, p, fr), running_ = true;
        } else if (p.mode == 1) {
            if (rise) startSegment(*seq, 0, p, fr), running_ = true;
            if (!gate && running_) running_ = false, ended_ = true;
        } else {  // step: each rising edge plays the next sound
            if (rise) {
                startSegment(*seq, started_ ? (seg_ + 1) % n : 0, p, fr);
                running_ = true;
            }
            if (!gate && running_ && elapsed_ >= segLen_) running_ = false;
        }
        float u = 0.0f;
        const speak::Phoneme* ph = nullptr;
        const speak::Segment* sg = nullptr;
        if (running_ && n > 0) {
            seg_ = std::min(seg_, n - 1);
            sg = &seq->seg[(size_t)seg_];
            ph = &speak::table()[sg->phoneme];
            // Step mode holds steady sounds while the gate is high.
            const bool hold = p.mode == 2 && gate && (ph->kind == speak::Vowel || ph->kind == speak::Nasal || ph->kind == speak::Approx ||
                                                      ph->kind == speak::Fric || ph->kind == speak::VFric || ph->kind == speak::Aspirate);
            if (!(hold && elapsed_ >= segLen_ * 0.6)) ++elapsed_;
            u = std::min(1.0f, (float)elapsed_ / (float)segLen_);
            if (elapsed_ >= segLen_ && !hold) {
                if (p.mode == 2) {
                    running_ = false;
                } else if (seg_ + 1 < n) {
                    startSegment(*seq, seg_ + 1, p, fr);
                    sg = &seq->seg[(size_t)seg_];
                    ph = &speak::table()[sg->phoneme];
                    u = 0.0f;
                } else if (p.mode == 0) {
                    startSegment(*seq, 0, p, fr);
                    sg = &seq->seg[0];
                    ph = &speak::table()[sg->phoneme];
                    u = 0.0f;
                } else {
                    running_ = false;
                    ended_ = true;
                }
            }
        }
        // ---- targets for this sample
        const float shift = std::exp2(p.formantShift / 12.0f);
        float tf1 = f1_, tf2 = f2_, tf3 = f3_, tv = 0.0f, tn = 0.0f, accent = 0.0f;
        bool aspirate = false;
        if (ph && running_) {
            accent = sg->accent ? 1.0f : 0.0f;
            if (ph->kind != speak::Pause) {
                tf1 = ph->f1 * shift, tf2 = ph->f2 * shift, tf3 = ph->f3 * shift;
                nf_ = ph->nf * shift, nbw_ = std::max(100.0f, ph->nbw * shift);
            }
            // Edge fades (3 ms-ish happen through the amplitude smoother); stops are silent for the closure.
            switch (ph->kind) {
                case speak::Vowel: case speak::Approx: tv = ph->voice * edge(u); break;
                case speak::Nasal: tv = ph->voice * edge(u); break;
                case speak::Fric: tn = ph->noise * edge(u); break;
                case speak::VFric: tv = ph->voice * edge(u); tn = ph->noise * edge(u); break;
                case speak::Aspirate: tn = ph->noise * edge(u); aspirate = true; break;
                case speak::Stop: case speak::VStop: {
                    const bool affricate = ph->dur > 1.0f;
                    const float closure = affricate ? 0.35f : 0.55f;
                    if (u < closure) tv = ph->kind == speak::VStop ? ph->voice : 0.0f;
                    else if (u < closure + 0.1f) tn = ph->noise * (1.0f - (u - closure) / 0.1f * 0.5f), tv = ph->kind == speak::VStop ? ph->voice * 0.7f : 0.0f;
                    else {
                        tn = ph->noise * (affricate ? 0.7f : 0.35f) * (1.0f - (u - closure - 0.1f) / (0.9f - closure));
                        tv = ph->kind == speak::VStop ? ph->voice * (1.0f - u) : 0.0f;
                    }
                    break;
                }
                case speak::Pause: break;
            }
            tv *= 1.0f + 0.3f * accent;
        }
        // ---- smoothing (formants glide, amplitudes follow within a few ms)
        const float gl = 1.0f - std::exp(-1.0f / (float)(sampleRate_ * (0.004 + 0.045 * (double)std::clamp(p.glide, 0.0f, 1.0f))));
        f1_ += gl * (tf1 - f1_), f2_ += gl * (tf2 - f2_), f3_ += gl * (tf3 - f3_);
        const float am = 1.0f - std::exp(-1.0f / (float)(sampleRate_ * 0.003));
        voiceAmp_ += am * (tv - voiceAmp_);
        noiseAmp_ += am * (tn - noiseAmp_);
        // ---- pitch
        const double c4 = 261.6255653005986;
        float contourSt = 0.0f;
        if (seq && n > 1 && running_) contourSt = -2.0f * (float)seg_ / (float)(n - 1);  // declination
        contourSt += 3.0f * accent;
        pitchSm_ += 0.0008f * (contourSt * p.intonation * 2.0f - pitchSm_);
        const double f0 = std::clamp(c4 * std::exp2((double)p.pitchOct + (double)pitchSm_ / 12.0), 20.0, sampleRate_ * 0.3);
        // ---- sources
        phase_ += f0 / sampleRate_;
        if (phase_ >= 1.0) phase_ -= 1.0;
        const double dt = f0 / sampleRate_;
        double saw = 2.0 * phase_ - 1.0;
        if (phase_ < dt) { const double x = phase_ / dt; saw -= x + x - x * x - 1.0; }
        else if (phase_ > 1.0 - dt) { const double x = (phase_ - 1.0) / dt; saw -= x * x + x + x + 1.0; }
        src_ += 0.25f * ((float)saw - src_);  // tilt: roughly −6 dB/oct more above 2 kHz
        const float white = noise_.next();
        const float breathNoise = white * p.breath * 0.35f;
        float glottal = (src_ + breathNoise) * voiceAmp_;
        float asp = aspirate ? white * noiseAmp_ : 0.0f;
        // ---- filters (coefficients every 16 samples)
        if ((tick_++ & 15) == 0) {
            const float ff1 = std::clamp(f1_, 100.0f, 4000.0f), ff2 = std::clamp(f2_, 200.0f, 6000.0f), ff3 = std::clamp(f3_, 400.0f, 8000.0f);
            res_[0].set(ff1, 60.0f + 0.05f * ff1, sampleRate_);
            res_[1].set(ff2, 90.0f + 0.05f * ff2, sampleRate_);
            res_[2].set(ff3, 150.0f + 0.05f * ff3, sampleRate_);
            res_[3].set(std::min(3600.0f * shift, 9000.0f), 250.0f, sampleRate_);
            res_[4].set(std::min(4700.0f * shift, 10000.0f), 300.0f, sampleRate_);
            nzRes_.set(std::clamp(nf_, 300.0f, 12000.0f), nbw_, sampleRate_);
        }
        float v = glottal + asp;
        for (auto& r : res_) v = r.run(v);
        const float bright = (white - lastWhite_) * 0.7f;  // tilt the burst noise upwards before the band
        lastWhite_ = white;
        const float band = nzRes_.run(aspirate ? 0.0f : bright * noiseAmp_) * 2.2f;
        float y = v * 0.2f + band * 0.3f;
        y = std::tanh(y);
        fr.out = y;
        fr.voiced = voiceAmp_ > 0.2f;
        fr.position = n > 0 ? (float)seg_ / (float)n : 0.0f;
        if (!running_) fr.out *= 1.0f;  // filters ring out: no extra gating
        return fr;
    }

    int segment() const noexcept { return seg_; }

private:
    struct Res {
        float a = 0, b = 0, c = 0, y1 = 0, y2 = 0;
        void set(float f, float bw, double sr) noexcept {
            c = (float)-std::exp(-6.283185307179586 * bw / sr);
            b = (float)(2.0 * std::exp(-3.141592653589793 * bw / sr) * std::cos(6.283185307179586 * f / sr));
            a = 1.0f - b - c;
        }
        float run(float x) noexcept {
            const float y = a * x + b * y1 + c * y2;
            y2 = y1, y1 = y;
            return y;
        }
    };

    static float edge(float u) noexcept {  // a short fade at both ends of a sound
        return std::min({1.0f, u * 12.0f + 0.15f, (1.0f - u) * 8.0f + 0.1f});
    }
    void startSegment(const speak::Sequence& seq, int index, const SpeakParams& p, SpeakFrame& fr) noexcept {
        seg_ = std::clamp(index, 0, std::max(0, seq.count - 1));
        const auto& sg = seq.seg[(size_t)seg_];
        const auto& ph = speak::table()[sg.phoneme];
        float dur = ph.dur * sg.length * (sg.accent ? 1.2f : 1.0f);
        segLen_ = std::max(1, (int)std::lround(dur / std::max(0.3f, p.speed) * sampleRate_));
        elapsed_ = 0;
        started_ = true;
        ended_ = false;
        fr.trig = ph.kind != speak::Pause;
    }

    double sampleRate_ = 48000.0, phase_ = 0.0;
    std::array<Res, 5> res_{};
    Res nzRes_{};
    dsp::WhiteNoise noise_{0x5eed1234u};
    float lastWhite_ = 0.0f, src_ = 0.0f, f1_ = 500, f2_ = 1500, f3_ = 2500, voiceAmp_ = 0, noiseAmp_ = 0, nf_ = 3000, nbw_ = 2000, pitchSm_ = 0;
    int seg_ = 0, segLen_ = 1, elapsed_ = 0;
    uint32_t tick_ = 0;
    bool running_ = false, ended_ = true, started_ = false, gatePrev_ = false;
};

}  // namespace bleep::patch
