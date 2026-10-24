// SPDX-License-Identifier: GPL-3.0-only
// Zone Delay core (doc/specs/modules/zone-delay.md): a stereo delay over five time
// zones (comb … 20 s loops), free, synced to the transport or measured from a
// clock. Time changes bend like tape (dsp::TapeTime) or crossfade between two
// heads; five loop characters morph into each other; an allpass diffuser in
// the feedback path smears repeats into a cloud. Reverse (dsp::ReverseReader),
// Hold (dsp::HoldLoop) and Ping-Pong are performance switches. The loop
// saturates softly above 0 dBFS, so Feedback above 100 % builds into a
// bounded drone. Memory is allocated in prepare(); tick() never allocates.
#pragma once

#include "dsp/Delay.h"
#include "dsp/Fdn.h"
#include "dsp/Lofi.h"
#include "dsp/Random.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>

namespace bleep::patch {

namespace zone {

constexpr int kZones = 5;
constexpr double kMaxSeconds = 20.0;     ///< longest time (Vast)
constexpr double kMaxOffset = 0.5;       ///< Offset ±50 % (the right side up to 30 s)
constexpr double kC4 = 261.6255653005986;

struct Range {
    double loMs, hiMs;
};
/// Free time range of a zone (1 … 5).
inline Range range(int z) noexcept {
    static constexpr Range r[kZones] = {{0.25, 12.0}, {8.0, 120.0}, {80.0, 1200.0}, {600.0, 5000.0}, {3000.0, 20000.0}};
    return r[std::clamp(z, 1, kZones) - 1];
}

struct Note {
    const char* name;
    double beats;
};
/// Synced note values of a zone, shortest first (Comb has none: it tracks Pitch).
inline int notes(int z, const Note*& out) noexcept {
    static constexpr Note shortZ[] = {{"1/128", 0.03125}, {"1/64T", 1.0 / 24.0}, {"1/64", 0.0625},
                                      {"1/32T", 1.0 / 12.0}, {"1/64.", 0.09375}, {"1/32", 0.125}};
    static constexpr Note echo[] = {{"1/32", 0.125}, {"1/16T", 1.0 / 6.0}, {"1/32.", 0.1875}, {"1/16", 0.25},
                                    {"1/8T", 1.0 / 3.0}, {"1/16.", 0.375}, {"1/8", 0.5}, {"1/4T", 2.0 / 3.0},
                                    {"1/8.", 0.75}, {"1/4", 1.0}, {"1/2T", 4.0 / 3.0}, {"1/4.", 1.5}, {"1/2", 2.0}};
    static constexpr Note longZ[] = {{"1/4", 1.0}, {"1/2T", 4.0 / 3.0}, {"1/4.", 1.5}, {"1/2", 2.0},
                                     {"1/1T", 8.0 / 3.0}, {"1/2.", 3.0}, {"1/1", 4.0}, {"1/1.", 6.0}, {"2 bars", 8.0}};
    static constexpr Note vast[] = {{"1/1", 4.0}, {"1/1.", 6.0}, {"2 bars", 8.0}, {"4 bars", 16.0}, {"8 bars", 32.0}};
    switch (std::clamp(z, 1, kZones)) {
        case 2: out = shortZ; return (int)std::size(shortZ);
        case 3: out = echo; return (int)std::size(echo);
        case 4: out = longZ; return (int)std::size(longZ);
        case 5: out = vast; return (int)std::size(vast);
        default: out = nullptr; return 0;
    }
}
/// The note value Time picks in a zone (−1 for Comb).
inline int noteIndex(int z, float time) noexcept {
    const Note* n = nullptr;
    const int count = notes(z, n);
    return count == 0 ? -1 : std::clamp((int)std::lround(std::clamp(time, 0.0f, 1.0f) * (float)(count - 1)), 0, count - 1);
}

/// Clock ratios Time chooses from when Clock is patched.
inline double clockRatio(float time) noexcept {
    static constexpr double r[9] = {0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 1.0, 1.5, 2.0, 3.0, 4.0};
    return r[std::clamp((int)std::lround(std::clamp(time, 0.0f, 1.0f) * 8.0f), 0, 8)];
}

/// Peak wobble depth per zone (ms): chorus-like in short zones, subtle in long ones.
inline double wobbleMs(int z) noexcept {
    static constexpr double d[kZones] = {0.12, 1.8, 2.5, 4.0, 6.0};
    return d[std::clamp(z, 1, kZones) - 1];
}
/// Crossfade time per zone in Crossfade mode (ms).
inline double fadeMs(int z) noexcept { return z <= 2 ? 30.0 : z == 3 ? 60.0 : 120.0; }

/// The loop's safety net: linear up to ±1, then a tanh knee towards ±1.5.
inline float loopLimit(float x) noexcept {
    const float a = std::fabs(x);
    if (a <= 1.0f) return x;
    return std::copysign(1.0f + 0.5f * std::tanh((a - 1.0f) * 2.0f), x);
}

/// Zero-delay-feedback one-pole (low-pass and high-pass from one state).
struct OnePole {
    float s = 0.0f, G = 0.0f;
    void set(double hz, double sr) noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(hz, 5.0, 0.45 * sr) / sr);
        G = (float)(g / (1.0 + g));
    }
    float lp(float x) noexcept {
        const float v = (x - s) * G;
        const float y = v + s;
        s = y + v;
        return y;
    }
    float hp(float x) noexcept { return x - lp(x); }
    void reset() noexcept { s = 0.0f; }
};

/// Zero-delay-feedback state-variable filter whose coefficients are computed
/// once per sample and shared by both channels (dsp::Svf keeps them per
/// instance).
struct SvfCoef {
    float k = 1.0f, a1 = 0.0f, a2 = 0.0f, a3 = 0.0f;
    void set(double hz, double q, double sr) noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(hz, 5.0, 0.45 * sr) / sr);
        k = (float)(1.0 / std::max(q, 0.05));
        a1 = (float)(1.0 / (1.0 + g * (g + (double)k)));
        a2 = (float)g * a1;
        a3 = (float)g * a2;
    }
};
struct SvfState {
    float ic1 = 0.0f, ic2 = 0.0f;
    /// Returns {lp, bp}.
    std::pair<float, float> process(float v0, const SvfCoef& c) noexcept {
        const float v3 = v0 - ic2;
        const float v1 = c.a1 * ic1 + c.a2 * v3;
        const float v2 = ic2 + c.a2 * ic1 + c.a3 * v3;
        ic1 = 2.0f * v1 - ic1;
        ic2 = 2.0f * v2 - ic2;
        return {v2, v1};
    }
};

/// Two read heads with an additive per-sample offset (the wobble): when the
/// target moves by more than 0.5 %, the idle head jumps there and the two
/// crossfade (equal-power); targets arriving during a fade are latched.
/// (dsp::CrossfadeReader without an offset input; see the module report.)
class TwoHeads {
public:
    void setFade(int samples) noexcept { fade_ = std::max(samples, 1); }
    void reset(double d) noexcept {
        cur_ = next_ = d;
        pos_ = -1;
    }
    double delay() const noexcept { return cur_; }
    /// Reads `target + offset` samples back (read-before-write convention: the
    /// caller passes the loop length minus one).
    float process(const dsp::RingDelay& line, double target, double offset) noexcept {
        if (pos_ < 0 && std::fabs(target - cur_) > 0.005 * std::max(cur_, 1.0)) {
            next_ = target;
            pos_ = 0;
        }
        if (pos_ < 0) return line.readHermite(std::max(cur_ + offset, 0.0));
        const float t = (float)(pos_ + 1) / (float)fade_;
        const float y = std::cos(1.5707963f * t) * line.readHermite(std::max(cur_ + offset, 0.0)) +
                        std::sin(1.5707963f * t) * line.readHermite(std::max(next_ + offset, 0.0));
        if (++pos_ >= fade_) {
            cur_ = next_;
            pos_ = -1;
        }
        return y;
    }

private:
    double cur_ = 0.0, next_ = 0.0;
    int fade_ = 1440, pos_ = -1;
};

/// Measures the interval between rising clock edges (ignoring gaps > 20 s).
class ClockMeter {
public:
    void reset() noexcept {
        high_ = false;
        since_ = 0;
        interval_ = 0;
        seen_ = false;
    }
    /// One sample; returns true on a rising edge.
    bool process(float x, double sampleRate) noexcept {
        const bool h = x >= 0.5f;
        const bool edge = h && !high_;
        high_ = h;
        ++since_;
        if (edge) {
            if (seen_ && (double)since_ <= 20.0 * sampleRate) interval_ = since_;
            seen_ = true;
            since_ = 0;
        }
        return edge;
    }
    /// Samples between the last two pulses; 0 until two have arrived.
    int64_t interval() const noexcept { return interval_; }

private:
    bool high_ = false, seen_ = false;
    int64_t since_ = 0, interval_ = 0;
};

}  // namespace zone

enum ZoneCharacter { ZoneClean = 0, ZoneTape, ZoneDark, ZoneBand, ZoneLofi, kZoneCharacters };

struct ZoneDelayParams {
    int zone = 3;              ///< 1 … 5
    float time = 0.5f;         ///< 0 … 1 within the zone
    float feedback = 0.4f;     ///< 0 … 2
    float character = 0.25f;   ///< 0 … 1 (five characters)
    float tone = 0.0f;         ///< −1 … +1 (± 2 octaves)
    float diffuse = 0.0f;
    float offset = 0.0f;       ///< −0.5 … +0.5
    float wobble = 0.1f;
    float mix = 0.35f;
    bool synced = false;       ///< Sync = Transport
    bool crossfade = false;    ///< Time Change = Crossfade
    float glide = 0.15f;       ///< seconds (Tape)
    bool reverse = false, hold = false, pingPong = false;
    uint32_t seed = 1;
};

struct ZoneDelayInput {
    float l = 0.0f, r = 0.0f;
    float clock = 0.0f;
    bool clockPatched = false;
    float pitch = 0.0f;
    bool pitchPatched = false;
    double bpm = 120.0;
};

struct ZoneDelayFrame {
    float outL = 0.0f, outR = 0.0f, wetL = 0.0f, wetR = 0.0f, tap = 0.0f;
};

class ZoneDelayDsp {
public:
    /// Allocates the lines: 30 s per channel (20 s plus the Offset headroom).
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        coefTone_.fill(-1.0);
        const int maxSamples = (int)std::ceil(zone::kMaxSeconds * (1.0 + zone::kMaxOffset) * sampleRate) + 16;
        static constexpr float diffL[4] = {3.1f, 7.3f, 13.7f, 22.9f};
        static constexpr float diffR[4] = {3.7f, 8.9f, 14.9f, 21.1f};
        for (int c = 0; c < 2; ++c) {
            ch_[(size_t)c].line.resize(maxSamples);
            ch_[(size_t)c].diffuser.prepare(sampleRate, c == 0 ? diffL : diffR, 4, 1.0f, 0.4f);
            ch_[(size_t)c].diffuser.setModulation(0.3f, 0.35f);
            ch_[(size_t)c].tape.prepare(sampleRate, 0.15f, 1.0);
        }
        reset();
    }

    /// Bytes held by the delay lines (for the module report).
    size_t memoryBytes() const noexcept { return 2 * (size_t)(ch_[0].line.maxDelay() + 4) * sizeof(float); }

    void reset() noexcept {
        for (auto& c : ch_) {
            c.line.clear();
            c.diffuser.clear();
            c.reverse.reset();
            c.tape.reset(48.0);
            c.heads.reset(48.0);
            for (auto& s : c.chr) s = CharState{};
            c.declick = 0.0f;
            c.lastWet = 0.0f;
        }
        clock_.reset();
        primed_ = false;
        holding_ = false;
        revMix_ = holdMix_ = ppMix_ = 0.0f;
        tapPhase_ = 0.0;
        restart(seed_);
        lastLo_ = lastHi_ = -1;
        diffScale_ = 1.0f;
        declickLeft_ = 0;
    }

    /// Clear on Play: empties the lines now (the old tail's last value is
    /// faded over 5 ms, so the cut doesn't click) and restarts Wobble and hiss.
    void clear() noexcept {
        for (auto& c : ch_) {
            c.declick = c.lastWet;
            c.line.clear();
            c.diffuser.clear();
            c.reverse.reset();
            for (auto& s : c.chr) s = CharState{};
        }
        declickLeft_ = (int)(0.005 * sr_);
        declickLen_ = std::max(declickLeft_, 1);
        holding_ = false;
        holdMix_ = 0.0f;
        tapPhase_ = 0.0;
        restart(seed_);
    }
    /// Restarts the seeded Wobble and hiss (transport start).
    void restart(uint32_t seed) noexcept {
        seed_ = seed;
        n_ = 0;
        for (int c = 0; c < 2; ++c) ch_[(size_t)c].diffuser.setSeed(seed * 2u + (uint32_t)c + 1u);
    }

    /// The left and right delay (samples) and the synced note (−1: none) of the last tick.
    double timeL() const noexcept { return lastTime_[0]; }
    double timeR() const noexcept { return lastTime_[1]; }
    int noteIndex() const noexcept { return lastNote_; }
    bool holding() const noexcept { return holding_; }

    /// The base delay (samples, before Offset and Wobble) for the params.
    double baseDelay(const ZoneDelayParams& p, const ZoneDelayInput& in, int& note) const noexcept {
        note = -1;
        const zone::Range r = zone::range(p.zone);
        const double lo = r.loMs * 0.001 * sr_, hi = r.hiMs * 0.001 * sr_;
        const float t = std::clamp(p.time, 0.0f, 1.0f);
        if (p.zone == 1 && in.pitchPatched) {
            const double hz = zone::kC4 * std::exp2((double)in.pitch + 2.0 * ((double)t - 0.5));
            return std::clamp(sr_ / std::max(hz, 1.0), 2.0, hi);
        }
        if (in.clockPatched && clock_.interval() > 0)
            return std::clamp((double)clock_.interval() * zone::clockRatio(t), lo, hi);
        if (p.synced && p.zone > 1) {
            const zone::Note* n = nullptr;
            zone::notes(p.zone, n);
            note = zone::noteIndex(p.zone, t);
            return std::clamp(dsp::beatsToSamples(n[note].beats, in.bpm, sr_), 2.0, zone::kMaxSeconds * sr_);
        }
        return lo * std::pow(hi / lo, (double)t);
    }

    void tick(const ZoneDelayParams& p, const ZoneDelayInput& in, ZoneDelayFrame& f) noexcept {
        if (p.seed != seed_) {  // a new Seed: new Wobble and hiss, same clock
            seed_ = p.seed;
            for (int c = 0; c < 2; ++c) ch_[(size_t)c].diffuser.setSeed(seed_ * 2u + (uint32_t)c + 1u);
        }
        clock_.process(in.clock, sr_);
        int note = -1;
        const double base = baseDelay(p, in, note);
        const double off = std::clamp((double)p.offset, -zone::kMaxOffset, zone::kMaxOffset);
        double target[2] = {base, std::max(base * (1.0 + off), 2.0)};
        lastNote_ = note;

        if (!primed_ || p.crossfade != crossfadeMode_) {  // start (or switch modes) on the current time
            for (int c = 0; c < 2; ++c) {
                const double d = primed_ ? ch_[(size_t)c].current : target[c];
                ch_[(size_t)c].tape.reset(d);
                ch_[(size_t)c].heads.reset(d - 1.0);  // the heads hold the read distance (loop − 1)
            }
            crossfadeMode_ = p.crossfade;
            primed_ = true;
        }
        if (p.zone != lastZone_) {
            lastZone_ = p.zone;
            for (auto& c : ch_) c.heads.setFade((int)(zone::fadeMs(p.zone) * 0.001 * sr_));
        }
        if (std::fabs(p.glide - glide_) > 1e-6f) {
            glide_ = p.glide;
            for (auto& c : ch_) c.tape.setGlide(std::max(p.glide, 0.005f));
        }

        // Ramps: reverse 20 ms, ping-pong 20 ms; hold switches at once (HoldLoop
        // continues the live read), its release crossfades over 20 ms.
        const float step20 = (float)(1.0 / (0.02 * sr_));
        revMix_ += std::clamp((p.reverse ? 1.0f : 0.0f) - revMix_, -step20, step20);
        ppMix_ += std::clamp((p.pingPong ? 1.0f : 0.0f) - ppMix_, -step20, step20);
        if (p.hold && !holding_) {
            for (auto& c : ch_) {
                c.hold.setSeamSamples((int)(0.01 * sr_));
                c.hold.engage(c.line, c.current);
                c.heldDelay = c.current;
            }
            holding_ = true;
            holdMix_ = 1.0f;
        } else if (!p.hold && holding_) {
            holding_ = false;
        }
        if (!holding_ && holdMix_ > 0.0f) holdMix_ = std::max(holdMix_ - step20, 0.0f);

        // Wobble: seeded smooth wow plus flutter, depth by zone.
        const double t = (double)n_ / sr_;
        if (n_ == 0) for (auto& c : ch_) c.wobStep = 0.0;
        const double depth = (double)p.wobble * zone::wobbleMs(p.zone) * 0.001 * sr_;

        // Character: the two neighbouring characters and their blend.
        const float cpos = std::clamp(p.character, 0.0f, 1.0f) * (kZoneCharacters - 1);
        const int lo = std::min((int)cpos, kZoneCharacters - 2), hi = lo + 1;
        const float blend = cpos - (float)lo;
        if (lo != lastLo_ || hi != lastHi_) {  // a character entering the pair starts from rest
            for (auto& c : ch_) {
                if (lo != lastLo_ && lo != lastHi_) c.chr[(size_t)lo] = CharState{};
                if (hi != lastLo_ && hi != lastHi_) c.chr[(size_t)hi] = CharState{};
            }
            lastLo_ = lo;
            lastHi_ = hi;
        }
        const double toneMul = std::exp2(2.0 * std::clamp((double)p.tone, -1.0, 1.0));
        if (toneMul < coefTone_[(size_t)lo] || toneMul > coefTone_[(size_t)lo]) setCharacter(lo, toneMul);
        if (toneMul < coefTone_[(size_t)hi] || toneMul > coefTone_[(size_t)hi]) setCharacter(hi, toneMul);
        // Comb tuning: remove the Clean low-pass's group delay (1 / 2g samples).
        const double comp = p.zone == 1 && lo == ZoneClean ? (1.0 - blend) * cleanDelay_ : 0.0;

        const float diffAmt = std::clamp(p.diffuse, 0.0f, 1.0f);
        const float diffTarget = p.zone == 1 ? 0.05f : p.zone == 2 ? 0.25f : 1.0f;
        diffScale_ += (diffTarget - diffScale_) * (float)(1.0 / (0.1 * sr_));

        float y[2];
        const float inSig[2] = {in.l, in.r};
        for (int c = 0; c < 2; ++c) {
            Channel& ch = ch_[(size_t)c];
            if ((n_ & 31) == 0) {  // control rate: the next 32 samples interpolate linearly
                const double t1 = (double)(n_ + 32) / sr_;
                const auto shape = [&](double tt) {
                    return 0.5 + 0.4 * dsp::smoothNoiseAt(seed_, 0x776f7700u + (uint64_t)c, tt, 0.7) +
                           0.1 * std::sin(6.283185307179586 * (5.3 + 0.4 * c) * tt);
                };
                ch.wob = (n_ == 0 || ch.wobStep == 0.0) ? shape(t) : ch.wob;
                ch.wobStep = (shape(t1) - ch.wob) / 32.0;
            }
            const double wob = depth * ch.wob;
            ch.wob += ch.wobStep;
            double fwdDelay;
            float fwd;
            if (p.crossfade) {
                fwd = ch.heads.process(ch.line, target[c] - comp - 1.0, wob);
                fwdDelay = ch.heads.delay() + 1.0;
            } else {
                fwdDelay = ch.tape.process(target[c] - comp);
                fwd = ch.line.readHermite(std::max(fwdDelay + wob - 1.0, 0.0));
            }
            ch.current = fwdDelay;
            float live = fwd;
            if (revMix_ > 0.0f) {
                if (!ch.revOn) {
                    ch.reverse.reset();
                    ch.revOn = true;
                }
                live = fwd + revMix_ * (ch.reverse.process(ch.line, target[c]) - fwd);
            } else {
                ch.revOn = false;
            }
            float out = live;
            if (holding_ || holdMix_ > 0.0f) {
                double loop = ch.heldDelay, speed = 1.0;
                if (p.crossfade) loop = target[c];
                else speed = ch.heldDelay / std::max(target[c], 2.0);
                if (p.reverse) speed = -speed;
                const float held = ch.hold.process(ch.line, loop, speed);
                out = holding_ ? held : live + holdMix_ * (held - live);
            }
            y[c] = out;
        }

        // Feedback paths (not while holding: writing stops, the loop replays).
        if (!holding_) {
            const float fb = std::clamp(p.feedback, 0.0f, 2.0f);
            const float inPP[2] = {in.l + ppMix_ * 0.5f * (in.r - in.l), in.r * (1.0f - ppMix_)};
            for (int c = 0; c < 2; ++c) {
                Channel& ch = ch_[(size_t)c];
                const float route = y[c] + ppMix_ * (y[1 - c] - y[c]);
                float d = route;
                if (diffAmt > 0.0f) {  // idle at 0 %: starts from silence when turned up
                    if (!ch.diffOn) ch.diffuser.clear();
                    ch.diffOn = true;
                    const float diffused = ch.diffuser.process(route, 0.7f * diffAmt, diffScale_);
                    d = route + diffAmt * (diffused - route);
                } else {
                    ch.diffOn = false;
                }
                float v = inPP[c] + fb * d;
                const float a = character(ch, lo, v, c), b = character(ch, hi, v, c);
                v = zone::loopLimit(a + blend * (b - a));
                if (std::fabs(v) < 1e-20f) v = 0.0f;
                ch.line.write(v);
            }
        }

        // Tap: a pulse each time the (left) delay time elapses.
        f.tap = 0.0f;
        tapPhase_ += 1.0 / std::max(ch_[0].current, 2.0);
        if (tapPhase_ >= 1.0) {
            tapPhase_ -= std::floor(tapPhase_);
            f.tap = 1.0f;
        }

        const float mix = std::clamp(p.mix, 0.0f, 1.0f);
        const float gd = std::cos(1.5707963f * mix), gw = std::sin(1.5707963f * mix);
        const float dc = declickLeft_ > 0 ? (float)declickLeft_-- / (float)declickLen_ : 0.0f;
        for (int c = 0; c < 2; ++c) {
            Channel& ch = ch_[(size_t)c];
            const float w = y[c] + ch.declick * dc;
            ch.lastWet = w;
            (c == 0 ? f.wetL : f.wetR) = w;
            (c == 0 ? f.outL : f.outR) = gd * inSig[c] + gw * w;
        }
        lastTime_[0] = ch_[0].current;
        lastTime_[1] = ch_[1].current;
        ++n_;
    }

private:
    struct CharState {
        zone::OnePole lp, hp;
        zone::SvfState svf;
        dsp::Decimator dec;
    };
    struct Coefs {
        zone::OnePole lp, hp;  // only G is used
        zone::SvfCoef svf;
    };
    struct Channel {
        dsp::RingDelay line;
        dsp::TapeTime tape;
        zone::TwoHeads heads;
        dsp::ReverseReader reverse;
        dsp::HoldLoop hold;
        dsp::Diffuser diffuser;
        std::array<CharState, kZoneCharacters> chr{};
        double current = 48.0, heldDelay = 48.0;
        bool revOn = false, diffOn = false;
        double wob = 0.0, wobStep = 0.0;
        float declick = 0.0f, lastWet = 0.0f;
    };

    void setCharacter(int k, double toneMul) noexcept {
        coefTone_[(size_t)k] = toneMul;
        Coefs& c = coefs_[(size_t)k];
        switch (k) {
            case ZoneClean: {
                const double hz = std::min(20000.0 * toneMul, 0.45 * sr_);
                c.lp.set(hz, sr_);
                const double g = std::tan(3.14159265358979323846 * std::clamp(hz, 5.0, 0.45 * sr_) / sr_);
                cleanDelay_ = 0.5 / g;
                break;
            }
            case ZoneTape:
                c.lp.set(7000.0 * toneMul, sr_);
                c.hp.set(40.0 * toneMul, sr_);
                break;
            case ZoneDark:
                c.svf.set(2200.0 * toneMul, 0.7071, sr_);
                c.hp.set(120.0 * toneMul, sr_);
                break;
            case ZoneBand: c.svf.set(1000.0 * toneMul, 2.0, sr_); break;
            case ZoneLofi: c.svf.set(5000.0 * toneMul, 0.7071, sr_); break;
            default: break;
        }
    }

    float character(Channel& ch, int k, float x, int c) noexcept {
        CharState& s = ch.chr[(size_t)k];
        const Coefs& k_ = coefs_[(size_t)k];
        switch (k) {
            case ZoneClean:
                s.lp.G = k_.lp.G;
                return s.lp.lp(x);
            case ZoneTape: {
                s.lp.G = k_.lp.G;
                s.hp.G = k_.hp.G;
                const float hiss = 1e-4f * (float)(2.0 * dsp::uniform01(seed_, n_, 0x68697373u + (uint64_t)c) - 1.0);
                return std::tanh(s.hp.hp(s.lp.lp(x))) + hiss;
            }
            case ZoneDark: {
                s.hp.G = k_.hp.G;
                const float v = s.svf.process(s.hp.hp(x), k_.svf).first;
                return std::tanh(0.8f * v) * 1.25f;
            }
            case ZoneBand: {
                const float v = 0.5f * s.svf.process(x, k_.svf).second;  // unit gain at the centre (Q 2)
                return std::tanh(1.2f * v) / 1.2f;
            }
            case ZoneLofi: {
                const float held = s.dec.process(x, 12000.0, sr_);
                const float q = dsp::quantizeBits(std::clamp(held, -1.5f, 1.5f), 10.0f);
                return std::tanh(s.svf.process(q, k_.svf).first);
            }
            default: return x;
        }
    }

    double sr_ = 48000.0;
    std::array<Channel, 2> ch_;
    std::array<Coefs, kZoneCharacters> coefs_{};
    std::array<double, kZoneCharacters> coefTone_{-1.0, -1.0, -1.0, -1.0, -1.0};
    zone::ClockMeter clock_;
    bool primed_ = false, crossfadeMode_ = false, holding_ = false;
    int lastZone_ = -1, lastLo_ = -1, lastHi_ = -1, lastNote_ = -1;
    float glide_ = -1.0f, revMix_ = 0.0f, holdMix_ = 0.0f, ppMix_ = 0.0f, diffScale_ = 1.0f;
    int declickLeft_ = 0, declickLen_ = 1;
    double cleanDelay_ = 0.0, tapPhase_ = 0.0;
    double lastTime_[2] = {0.0, 0.0};
    uint32_t seed_ = 1;
    uint64_t n_ = 0;
};

}  // namespace bleep::patch
