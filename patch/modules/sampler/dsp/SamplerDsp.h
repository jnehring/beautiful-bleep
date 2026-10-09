// SPDX-License-Identifier: MIT
// Sampler core (specs/modules/sampler.md): a polyphonic sample player and
// slicer. A loaded sample (stereo or mono floats, markers that cut it into
// slices) is played by up to 16 playheads. A start comes from a note (the
// note number picks the slice in slice mode, or the pitch in whole-sample
// mode) or from a trigger with CV inputs; the play mode (Gate, To end of
// sample, To end of slice, Loop, One-shot) decides how it ends. Each voice has
// an ADSR amplitude envelope, a state-variable filter, a bit/rate crusher and
// a pan; playheads can be scrubbed and crossfade across jumps and loop seams.
// Nothing allocates in tick(); the sample is owned by the caller (a handoff
// from the message thread) and only read here.
#pragma once

#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::patch {

namespace sampler {

constexpr int kVoices = 16;          ///< voice ids (and voice outputs)
constexpr int kStorage = 24;         ///< voice slots: the extra ones hold voices fading out
constexpr int kMaxSlices = 128, kMaxMarkers = kMaxSlices - 1;
constexpr int kMaxHeld = 32;
constexpr int kControlRate = 8;      ///< samples between filter / pitch updates
constexpr double kStealSeconds = 0.005;

enum Mode { ModeInherit = -1, ModeGate = 0, ModeToSample, ModeToSlice, ModeLoop, ModeOneShot };
enum VoiceMode { VoicePoly = 0, VoiceMono, VoiceLegato, VoiceLayers };
enum Quality { QualityLinear = 0, QualityCubic, QualitySinc };
enum PositionMode { PositionScrub = 0, PositionOffset };

/// Per-slice settings (saved with the markers).
struct SliceCfg {
    int mode = ModeInherit;
    float transpose = 0.0f;  ///< semitones
    float level = 1.0f;
    float pan = 0.0f;        ///< -1 … +1
    bool reverse = false;
    int choke = 0;           ///< 0 none, 1 … 8
};

/// The audio the DSP plays. Plain pointers: whoever hands this over keeps the
/// audio alive for as long as it is current.
struct Sample {
    const float* ch[2] = {nullptr, nullptr};
    int channels = 0;
    int64_t frames = 0;
    std::vector<int64_t> markers;     ///< sorted, 0 < m < frames
    std::vector<SliceCfg> slices;     ///< markers.size() + 1 entries (missing ones are defaults)

    int sliceCount() const noexcept { return frames > 0 ? (int)markers.size() + 1 : 0; }
    int64_t sliceStart(int i) const noexcept { return i <= 0 ? 0 : markers[(size_t)std::min<size_t>((size_t)i, markers.size()) - 1]; }
    int64_t sliceEnd(int i) const noexcept { return i < (int)markers.size() ? markers[(size_t)std::max(i, 0)] : frames; }
    SliceCfg cfg(int i) const noexcept { return i >= 0 && i < (int)slices.size() ? slices[(size_t)i] : SliceCfg(); }
};

/// 8-tap windowed-sinc interpolation, 512 phases.
class SincTable {
public:
    static constexpr int kTaps = 8, kPhases = 512;
    SincTable() {
        const double pi = 3.14159265358979323846;
        for (int p = 0; p < kPhases; ++p) {
            double sum = 0.0;
            float* row = &t_[(size_t)p * kTaps];
            for (int k = 0; k < kTaps; ++k) {
                const double x = (double)(k - 3) - (double)p / kPhases;  // tap k reads sample i + k - 3
                const double u = x / 4.0;
                const double s = std::fabs(x) < 1e-9 ? 1.0 : std::sin(pi * x) / (pi * x);
                const double w = 0.42 + 0.5 * std::cos(pi * u) + 0.08 * std::cos(2.0 * pi * u);
                row[k] = (float)(s * w);
                sum += row[k];
            }
            for (int k = 0; k < kTaps; ++k) row[k] = (float)(row[k] / sum);
        }
    }
    const float* row(double frac) const noexcept {
        return &t_[(size_t)std::clamp((int)(frac * kPhases + 0.5), 0, kPhases - 1) * kTaps];
    }

private:
    std::array<float, (size_t)kPhases * kTaps> t_{};
};

}  // namespace sampler

struct SamplerParams {
    // knobs
    float start = 0.0f, end = 1.0f;       ///< fractions of the file (or of each slice)
    float transpose = 0.0f, fine = 0.0f;  ///< semitones, cents
    float speed = 1.0f;
    float position = 0.0f;
    float attack = 0.001f, decay = 0.1f, sustain = 1.0f, release = 0.05f;  ///< seconds / 0..1
    float level = 1.0f, pan = 0.0f;
    float cutoff = 20000.0f, resonance = 0.0f, filterEnv = 0.0f;
    float velocity = 0.5f, crush = 0.0f;
    float layerPitch = 7.0f, layerOffset = 0.0f;  ///< semitones, milliseconds
    // settings
    int voices = 8;
    int voiceMode = sampler::VoicePoly;
    int layers = 2;
    bool byNote = true;
    bool sliceMode = false;
    int mode = sampler::ModeGate;
    bool pingPong = false;
    float loopFade = 0.005f;              ///< seconds
    int root = 60;
    float keyTrack = 1.0f;
    int quality = sampler::QualityCubic;
    int positionMode = sampler::PositionScrub;
    bool outputMono = false;
    bool voiceOut[sampler::kVoices] = {};  ///< voice n goes to its own jack (and out of the mix)
};

struct SamplerInput {
    float trigger = 0.0f, gate = 0.0f, stop = 0.0f, step = 0.0f;
    bool triggerPatched = false, gatePatched = false;
    float slice = 0.0f;
    bool slicePatched = false;
    float pitch = 0.0f;    ///< volts (octaves), for CV-triggered voices
    float speed = 0.0f;    ///< volts (octaves) added to Speed
    float velocity = 1.0f;
};

struct SamplerFrame {
    float l = 0.0f, r = 0.0f;
    float voice[sampler::kVoices] = {};
    float end = 0.0f, slice = 0.0f, playhead = 0.0f, active = 0.0f;
};

class SamplerDsp {
public:
    using Sample = sampler::Sample;

    void prepare(double sampleRate) {
        sr_ = sampleRate;
        stealStep_ = (float)(1.0 / (sampler::kStealSeconds * sr_));
        pulseLen_ = std::max(1, (int)(0.001 * sr_));
        reset();
    }
    void reset() {
        for (auto& v : voices_) v = Voice();
        held_ = 0;
        trigPrev_ = gatePrev_ = stopPrev_ = stepPrev_ = false;
        lastPosition_ = -1.0f;
        endLeft_ = sliceLeft_ = 0;
        ctl_ = 0;
        headSlot_ = -1;
    }

    /// Sets the sample to play (null: none). Playing voices go on when only
    /// the markers or slice settings changed; a different audio stops them.
    void setSample(const Sample* s) {
        const bool sameAudio = s_ && s && s_->ch[0] == s->ch[0] && s_->frames == s->frames && s_->channels == s->channels;
        s_ = s;
        if (!sameAudio) {
            for (auto& v : voices_) v = Voice();
            held_ = 0;
            headSlot_ = -1;
            current_ = 0;
        } else {
            current_ = std::clamp(current_, 0, std::max(0, s_->sliceCount() - 1));
        }
    }
    const Sample* sample() const noexcept { return s_; }

    // ---- performance --------------------------------------------------------
    void noteOn(int note, float pitchVolts, float velocity, const SamplerParams& p) {
        if (!s_ || s_->frames < 2) return;
        int slice = -1;
        if (p.sliceMode) {
            slice = note - p.root;
            if (slice < 0 || slice >= s_->sliceCount()) return;  // overflow: ignored
        }
        pushHeld(note, pitchVolts, velocity);
        const float semis = p.sliceMode ? 0.0f : ((pitchVolts * 12.0f + 60.0f - (float)p.root) * p.keyTrack);
        if (p.voiceMode == sampler::VoiceLegato) {
            for (auto& v : voices_)
                if (v.active && !v.fading && v.held && v.note >= 0 && v.stage != 3) {
                    v.note = note;
                    v.noteSemis = semis;
                    v.slice = slice;
                    return;
                }
        }
        startGroup(note, slice, semis, velocity, true, p);
    }
    void noteOff(int note, const SamplerParams& p) {
        // The held-note stack, for Mono and Legato fall-back.
        int idx = -1;
        for (int i = 0; i < held_; ++i)
            if (heldNotes_[i].note == note) idx = i;
        const bool wasTop = idx == held_ - 1;
        if (idx >= 0) {
            for (int i = idx; i + 1 < held_; ++i) heldNotes_[i] = heldNotes_[i + 1];
            --held_;
        }
        const bool mono = p.voiceMode == sampler::VoiceMono || p.voiceMode == sampler::VoiceLegato;
        if (mono && wasTop && held_ > 0) {
            const Held h = heldNotes_[held_ - 1];
            int slice = -1;
            if (p.sliceMode) {
                slice = h.note - p.root;
                if (slice < 0 || slice >= (s_ ? s_->sliceCount() : 0)) slice = -1;
            }
            const float semis = p.sliceMode ? 0.0f : ((h.pitch * 12.0f + 60.0f - (float)p.root) * p.keyTrack);
            if (p.voiceMode == sampler::VoiceLegato) {
                for (auto& v : voices_)
                    if (v.active && !v.fading && v.note == note) {
                        v.note = h.note;
                        v.noteSemis = semis;
                        if (p.sliceMode && slice >= 0) v.slice = slice;
                    }
            } else {
                for (auto& v : voices_)
                    if (v.active && !v.fading && v.note == note) release(v);
                startGroup(h.note, slice, semis, h.velocity, true, p);
            }
            return;
        }
        for (auto& v : voices_)
            if (v.active && v.note == note) v.held = false;
    }
    /// Releases every voice (Stop).
    void stopAll() {
        for (auto& v : voices_)
            if (v.active) release(v);
        held_ = 0;
    }
    /// Silences everything at once.
    void panic() {
        for (auto& v : voices_) v = Voice();
        held_ = 0;
    }
    void setCurrentSlice(int i) { current_ = s_ ? std::clamp(i, 0, std::max(0, s_->sliceCount() - 1)) : 0; }
    int currentSlice() const noexcept { return current_; }
    void nextSlice() {
        const int n = s_ ? s_->sliceCount() : 0;
        if (n > 0) current_ = (current_ + 1) % n;
    }
    void randomSlice(uint32_t seed) {
        const int n = s_ ? s_->sliceCount() : 0;
        if (n <= 0) return;
        rng_ = rng_ * 1664525u + 1013904223u + seed;
        current_ = (int)((rng_ >> 8) % (uint32_t)n);
    }
    /// Plays slice `i` (or the whole sample, i < 0) once, from the view.
    void audition(int i, const SamplerParams& p) {
        if (!s_ || s_->frames < 2) return;
        SamplerParams q = p;
        q.mode = sampler::ModeOneShot;
        startGroup(-2, i, 0.0f, 1.0f, false, q);
    }

    // ---- state for the view ---------------------------------------------------
    int activeVoices() const noexcept {
        int n = 0;
        for (const auto& v : voices_) n += v.active && !v.fading ? 1 : 0;
        return n;
    }
    /// f(position in frames, slice, held) for every sounding voice.
    template <class F>
    void forEachHead(F&& f) const {
        for (const auto& v : voices_)
            if (v.active && !v.fading) f(v.pos, v.slice, v.held);
    }

    // ---- audio -----------------------------------------------------------------
    void tick(const SamplerParams& p, const SamplerInput& in, SamplerFrame& out) {
        const bool trig = in.trigger > 0.5f, gate = in.gate > 0.5f, stop = in.stop > 0.5f, step = in.step > 0.5f;
        if (stop && !stopPrev_) stopAll();
        if (step && !stepPrev_) nextSlice();
        if (!p.byNote && s_ && s_->frames >= 2) {
            const bool start = in.triggerPatched ? (trig && !trigPrev_) : (in.gatePatched && gate && !gatePrev_);
            if (start) {
                int slice = -1;
                if (p.sliceMode) {
                    const int n = s_->sliceCount();
                    slice = in.slicePatched ? std::clamp((int)std::floor(std::clamp(in.slice, 0.0f, 1.0f) * (float)n), 0, n - 1) : current_;
                }
                startGroup(-1, slice, 0.0f, std::clamp(in.velocity, 0.0f, 1.0f), in.gatePatched ? gate : true, p);
            }
            if (in.gatePatched && !gate && gatePrev_)
                for (auto& v : voices_)
                    if (v.active && v.note == -1) v.held = false;
        }
        trigPrev_ = trig;
        gatePrev_ = gate;
        stopPrev_ = stop;
        stepPrev_ = step;

        // Scrub: moving Position jumps the sounding playheads.
        if (s_ && p.positionMode == sampler::PositionScrub) {
            if (lastPosition_ >= 0.0f && std::fabs(p.position - lastPosition_) > 2e-4f)
                for (auto& v : voices_)
                    if (v.active && !v.fading) {
                        double a, b;
                        region(v, p, a, b);
                        jump(v, a + (double)p.position * (b - a));
                    }
            lastPosition_ = p.position;
        } else {
            lastPosition_ = p.position;
        }

        if (ctl_ == 0) updateControl(p, in);
        ctl_ = (ctl_ + 1) % sampler::kControlRate;

        float mixL = 0.0f, mixR = 0.0f;
        for (int i = 0; i < sampler::kVoices; ++i) out.voice[i] = 0.0f;
        int active = 0;
        bool ended = false;
        if (s_) {
            for (auto& v : voices_) {
                if (!v.active) continue;
                float l, r;
                if (!renderVoice(v, p, l, r, ended)) continue;
                ++active;
                float mono = 0.5f * (l + r);
                if (p.voiceOut[v.id]) {
                    out.voice[v.id] += mono * v.gain;
                } else {
                    mixL += l * v.gainL;
                    mixR += r * v.gainR;
                }
            }
        }
        if (p.outputMono) mixL = mixR = 0.5f * (mixL + mixR);
        out.l = mixL;
        out.r = mixR;
        if (ended) endLeft_ = pulseLen_;
        if (sliceFlag_) {
            sliceLeft_ = pulseLen_;
            sliceFlag_ = false;
        }
        out.end = endLeft_ > 0 ? 1.0f : 0.0f;
        out.slice = sliceLeft_ > 0 ? 1.0f : 0.0f;
        if (endLeft_ > 0) --endLeft_;
        if (sliceLeft_ > 0) --sliceLeft_;
        out.playhead = 0.0f;
        if (headSlot_ >= 0 && voices_[headSlot_].active && s_ && s_->frames > 0)
            out.playhead = (float)std::clamp(voices_[headSlot_].pos / (double)s_->frames, 0.0, 1.0);
        out.active = (float)active / (float)std::max(1, p.voices);
    }

private:
    struct Held {
        int note = 0;
        float pitch = 0.0f, velocity = 0.0f;
    };
    struct Voice {
        bool active = false, held = false, fading = false, stopping = false;
        int id = 0, note = -1, slice = -1, mode = 0, layer = 0, choke = 0;
        int stage = 0;
        double pos = 0.0;
        double inc = 0.0;            ///< per-sample step (updated at control rate)
        float noteSemis = 0.0f, extraSemis = 0.0f;  ///< note pitch / slice + layer pitch, semitones
        bool reverse = false;
        float dir = 1.0f;            ///< ping-pong direction
        float env = 0.0f, fade = 1.0f, vel = 1.0f;
        float sliceLevel = 1.0f, slicePan = 0.0f;
        float gain = 0.0f, gainL = 0.0f, gainR = 0.0f;  ///< control-rate: level × velocity (× pan)
        double xPos = 0.0;           ///< crossfade source after a jump
        int xLeft = 0;
        int delay = 0;               ///< samples before a layer starts
        uint64_t age = 0;
        dsp::Svf fl, fr;
        float holdL = 0.0f, holdR = 0.0f;
        int crushCount = 0;
    };

    // ---- starting voices ----------------------------------------------------------
    void pushHeld(int note, float pitch, float vel) {
        for (int i = 0; i < held_; ++i)
            if (heldNotes_[i].note == note) {
                for (int j = i; j + 1 < held_; ++j) heldNotes_[j] = heldNotes_[j + 1];
                --held_;
                break;
            }
        if (held_ >= sampler::kMaxHeld) {
            for (int i = 0; i + 1 < held_; ++i) heldNotes_[i] = heldNotes_[i + 1];
            --held_;
        }
        heldNotes_[held_++] = {note, pitch, vel};
    }

    void startGroup(int note, int slice, float semis, float velocity, bool held, const SamplerParams& p) {
        const int layers = p.voiceMode == sampler::VoiceLayers ? std::clamp(p.layers, 1, std::min(8, p.voices)) : 1;
        for (int j = 0; j < layers; ++j) startVoice(note, slice, semis, velocity, held, j, p);
        sliceFlag_ = true;
    }

    int voiceLimit(const SamplerParams& p) const noexcept {
        if (p.voiceMode == sampler::VoiceMono || p.voiceMode == sampler::VoiceLegato) return 1;
        return std::clamp(p.voices, 1, sampler::kVoices);
    }

    void startVoice(int note, int slice, float semis, float velocity, bool held, int layer, const SamplerParams& p) {
        const int limit = voiceLimit(p);
        const sampler::SliceCfg cfg = s_->cfg(slice);
        // Choke groups: the same group on a live voice cuts it.
        if (slice >= 0 && cfg.choke > 0)
            for (auto& v : voices_)
                if (v.active && !v.fading && v.choke == cfg.choke) v.fading = true;
        int count = 0;
        for (const auto& v : voices_) count += v.active && !v.fading ? 1 : 0;
        int id = -1;
        while (count >= limit) {  // steal: the quietest voice in release, else the oldest
            int victim = -1;
            for (int i = 0; i < sampler::kStorage; ++i) {
                const Voice& v = voices_[i];
                if (!v.active || v.fading || v.id >= limit) continue;
                if (v.stage == 3 && (victim < 0 || voices_[victim].stage != 3 || v.env < voices_[victim].env)) victim = i;
                else if (victim < 0 || (voices_[victim].stage != 3 && v.age < voices_[victim].age)) victim = i;
            }
            if (victim < 0) break;
            voices_[victim].fading = true;
            id = voices_[victim].id;
            --count;
        }
        if (id < 0) {
            bool used[sampler::kVoices] = {};
            for (const auto& v : voices_)
                if (v.active && !v.fading) used[v.id] = true;
            for (int i = 0; i < limit && i < sampler::kVoices; ++i)
                if (!used[i]) {
                    id = i;
                    break;
                }
            if (id < 0) id = 0;
        }
        int slot = -1;
        for (int i = 0; i < sampler::kStorage && slot < 0; ++i)
            if (!voices_[i].active) slot = i;
        if (slot < 0) {  // every slot busy: take the oldest fading voice
            uint64_t oldest = ~0ull;
            for (int i = 0; i < sampler::kStorage; ++i)
                if (voices_[i].age < oldest) {
                    oldest = voices_[i].age;
                    slot = i;
                }
        }
        Voice& v = voices_[slot];
        v = Voice();
        v.active = true;
        v.held = held;
        v.id = id;
        v.note = note;
        v.slice = slice;
        v.layer = layer;
        v.choke = slice >= 0 ? cfg.choke : 0;
        v.mode = cfg.mode >= 0 && slice >= 0 ? cfg.mode : p.mode;
        v.noteSemis = semis;
        v.extraSemis = (slice >= 0 ? cfg.transpose : 0.0f) + (float)layer * p.layerPitch;
        v.reverse = slice >= 0 && cfg.reverse;
        v.sliceLevel = slice >= 0 ? cfg.level : 1.0f;
        v.slicePan = slice >= 0 ? cfg.pan : 0.0f;
        v.vel = (1.0f - p.velocity) + p.velocity * velocity;
        v.age = ++ageCounter_;
        v.delay = (int)(layer * p.layerOffset * 0.001 * sr_);
        v.fl.reset();
        v.fr.reset();
        double a, b;
        region(v, p, a, b);
        const bool backwards = (p.speed < 0.0f) != v.reverse;
        const double offset = p.positionMode == sampler::PositionOffset ? (double)std::clamp(p.position, 0.0f, 1.0f) * (b - a) : 0.0;
        v.pos = backwards ? std::max(a, b - offset - 1e-3) : std::min(b - 1e-3, a + offset);
        updateVoice(v, p, SamplerInput());
        headSlot_ = slot;
    }

    // ---- per-voice helpers ----------------------------------------------------------
    /// The playing region [a, b) in frames, with Start / End applied.
    void region(const Voice& v, const SamplerParams& p, double& a, double& b) const noexcept {
        const int64_t F = s_->frames;
        double s0 = 0.0, s1 = (double)F;
        int slice = v.slice;
        if (slice >= 0) {
            slice = std::min(slice, s_->sliceCount() - 1);
            s0 = (double)s_->sliceStart(slice);
            s1 = (double)s_->sliceEnd(slice);
        }
        a = s0 + (double)std::clamp(p.start, 0.0f, 1.0f) * (s1 - s0);
        b = s0 + (double)std::clamp(p.end, 0.0f, 1.0f) * (s1 - s0);
        if (v.mode == sampler::ModeToSample && slice >= 0) b = (double)std::clamp(p.end, 0.0f, 1.0f) * (double)F;
        a = std::clamp(a, 0.0, (double)F - 2.0);
        if (b < a + 2.0) b = a + 2.0;
        b = std::min(b, (double)F);
        if (b < a + 1.0) a = b - 1.0;
    }

    void release(Voice& v) noexcept {
        v.held = false;
        v.stage = 3;
    }

    void jump(Voice& v, double to) noexcept {
        v.xPos = v.pos;
        v.xLeft = std::max(1, (int)(0.003 * sr_));
        v.pos = to;
    }

    /// Control-rate update: pitch, filter, gains.
    void updateVoice(Voice& v, const SamplerParams& p, const SamplerInput& in) noexcept {
        const float cv = v.note == -1 ? in.pitch : 0.0f;
        const double semis = (double)v.noteSemis + (double)v.extraSemis + (double)p.transpose + (double)p.fine * 0.01 + 12.0 * (double)cv;
        const double speed = (double)p.speed * std::exp2((double)in.speed);
        double inc = std::exp2(semis / 12.0) * speed;
        if (v.reverse) inc = -inc;
        v.inc = inc * (double)v.dir;
        // level × velocity, balance
        const float level = p.level * v.sliceLevel * v.vel;
        v.gain = level;
        float pan = std::clamp(p.pan + v.slicePan, -1.0f, 1.0f);
        if (s_ && s_->channels == 1 && pan != 0.0f) {
            const float ang = (pan + 1.0f) * 0.78539816339f;
            v.gainL = level * std::cos(ang) * 1.41421356f;
            v.gainR = level * std::sin(ang) * 1.41421356f;
        } else {
            v.gainL = level * (pan > 0.0f ? 1.0f - pan : 1.0f);
            v.gainR = level * (pan < 0.0f ? 1.0f + pan : 1.0f);
        }
        if (filterOn(p)) {
            const float octaves = p.filterEnv * v.env * 6.0f + (v.vel - 1.0f) * p.velocity * 3.0f;
            const float hz = std::clamp(p.cutoff * std::exp2(octaves), 20.0f, 20000.0f);
            const float q = 0.7f + p.resonance * 9.0f;
            v.fl.set(hz, q, sr_);
            v.fr.set(hz, q, sr_);
        }
    }
    static bool filterOn(const SamplerParams& p) noexcept {
        return p.cutoff < 19990.0f || p.resonance > 0.001f || std::fabs(p.filterEnv) > 0.001f;
    }
    void updateControl(const SamplerParams& p, const SamplerInput& in) noexcept {
        for (auto& v : voices_)
            if (v.active) updateVoice(v, p, in);
    }

    static double coef(double seconds, double sr) noexcept { return 1.0 - std::exp(-4.6 / std::max(seconds * sr, 1.0)); }

    float readAt(const float* x, int64_t n, double pos, int quality) const noexcept {
        const int64_t i = (int64_t)std::floor(pos);
        const float t = (float)(pos - (double)i);
        auto at = [&](int64_t k) { return k < 0 || k >= n ? 0.0f : x[k]; };
        if (quality == sampler::QualityLinear) return at(i) + (at(i + 1) - at(i)) * t;
        if (quality == sampler::QualitySinc) {
            const float* h = sinc_.row(t);
            float y = 0.0f;
            for (int k = 0; k < sampler::SincTable::kTaps; ++k) y += h[k] * at(i + k - 3);
            return y;
        }
        const float p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        const float c1 = 0.5f * (p2 - p0), c2 = p0 - 2.5f * p1 + 2.0f * p2 - 0.5f * p3, c3 = 0.5f * (p3 - p0) + 1.5f * (p1 - p2);
        return ((c3 * t + c2) * t + c1) * t + p1;
    }
    void readFrame(double pos, int quality, float& l, float& r) const noexcept {
        l = readAt(s_->ch[0], s_->frames, pos, quality);
        r = s_->channels > 1 ? readAt(s_->ch[1], s_->frames, pos, quality) : l;
    }

    /// One sample of one voice into (l, r) before the gains. False when the voice is gone.
    bool renderVoice(Voice& v, const SamplerParams& p, float& l, float& r, bool& ended) noexcept {
        if (v.delay > 0) {
            --v.delay;
            l = r = 0.0f;
            return true;
        }
        double a, b;
        region(v, p, a, b);
        const double len = b - a;
        const bool loop = v.mode == sampler::ModeLoop;
        const bool ignoreGate = v.mode == sampler::ModeToSample || v.mode == sampler::ModeToSlice || v.mode == sampler::ModeOneShot;

        // read (with the loop seam crossfade)
        readFrame(v.pos, p.quality, l, r);
        if (loop && !p.pingPong && p.loopFade > 0.0f) {
            const double F = std::min((double)p.loopFade * sr_, len / 3.0);
            if (F >= 1.0) {
                double w = 0.0, other = 0.0;
                if (v.inc > 0.0 && v.pos > b - F) {
                    w = (v.pos - (b - F)) / F;
                    other = v.pos - len;
                } else if (v.inc < 0.0 && v.pos < a + F) {
                    w = (a + F - v.pos) / F;
                    other = v.pos + len;
                }
                if (w > 0.0) {
                    float l2, r2;
                    readFrame(other, p.quality, l2, r2);
                    l += (l2 - l) * (float)w;
                    r += (r2 - r) * (float)w;
                }
            }
        }
        if (v.xLeft > 0) {  // crossfade from before a jump
            float l2, r2;
            readFrame(v.xPos, p.quality, l2, r2);
            const float w = (float)v.xLeft / std::max(1.0f, (float)(0.003 * sr_));
            l += (l2 - l) * w;
            r += (r2 - r) * w;
            v.xPos += v.inc;
            --v.xLeft;
        }

        // advance
        v.pos += v.inc;
        if (loop) {
            if (p.pingPong) {
                if (v.pos >= b) {
                    v.pos = std::max(a, 2.0 * b - v.pos);
                    v.dir = -std::fabs(v.dir);
                    ended = true;
                } else if (v.pos < a) {
                    v.pos = std::min(b - 1e-3, 2.0 * a - v.pos);
                    v.dir = std::fabs(v.dir);
                    ended = true;
                }
            } else {
                if (v.pos >= b) {
                    v.pos = a + std::fmod(v.pos - a, len);
                    ended = true;
                } else if (v.pos < a) {
                    v.pos = b - std::fmod(a - v.pos, len);
                    ended = true;
                }
            }
        } else if (!v.stopping && ((v.inc >= 0.0 && v.pos >= b) || (v.inc < 0.0 && v.pos < a))) {
            v.stopping = true;
            ended = true;
        }

        // envelope
        if (!v.held && !ignoreGate && v.stage != 3) v.stage = 3;
        switch (v.stage) {
            case 0:
                v.env += (float)(1.0 / std::max((double)p.attack * sr_, 1.0));
                if (v.env >= 1.0f) {
                    v.env = 1.0f;
                    v.stage = 1;
                }
                break;
            case 1:
                v.env += (p.sustain - v.env) * (float)coef(p.decay, sr_);
                if (std::fabs(v.env - p.sustain) < 1e-4f) {
                    v.env = p.sustain;
                    v.stage = 2;
                }
                break;
            case 2: v.env = p.sustain; break;
            default:
                v.env -= v.env * (float)coef(p.release, sr_);
                if (v.env < 1e-4f) {
                    v.active = false;
                    return false;
                }
        }
        float g = v.env;
        if (v.fading || v.stopping) {
            v.fade -= stealStep_;
            if (v.fade <= 0.0f) {
                v.active = false;
                return false;
            }
        }
        g *= v.fade;

        // filter, crush
        if (filterOn(p)) {
            l = v.fl.process(l).lp;
            r = v.fr.process(r).lp;
        }
        if (p.crush > 0.001f) {
            const float bits = 16.0f - p.crush * 12.0f;
            const float q = std::exp2(bits - 1.0f);
            const int rate = 1 + (int)(p.crush * p.crush * 30.0f);
            if (v.crushCount <= 0) {
                v.holdL = std::round(l * q) / q;
                v.holdR = std::round(r * q) / q;
                v.crushCount = rate;
            }
            --v.crushCount;
            l = v.holdL;
            r = v.holdR;
        }
        l *= g;
        r *= g;
        return true;
    }

    const Sample* s_ = nullptr;
    double sr_ = 48000.0;
    float stealStep_ = 0.01f;
    int pulseLen_ = 48;
    std::array<Voice, sampler::kStorage> voices_{};
    std::array<Held, sampler::kMaxHeld> heldNotes_{};
    int held_ = 0;
    int current_ = 0;
    int ctl_ = 0;
    int headSlot_ = -1;
    int endLeft_ = 0, sliceLeft_ = 0;
    bool sliceFlag_ = false;
    bool trigPrev_ = false, gatePrev_ = false, stopPrev_ = false, stepPrev_ = false;
    float lastPosition_ = -1.0f;
    uint64_t ageCounter_ = 0;
    uint32_t rng_ = 12345u;
    sampler::SincTable sinc_;
};

}  // namespace bleep::patch
