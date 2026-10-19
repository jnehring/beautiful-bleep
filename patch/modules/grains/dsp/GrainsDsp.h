// SPDX-License-Identifier: GPL-3.0-or-later
// Grains core (doc/specs/modules/grains.md): a stereo circular buffer recording
// the input (plus feedback), played back by the shared granular engine
// (dsp::GrainEngine, dsp::GrainCloud): continuous, transport-locked or
// triggered scheduling, seeded per grain, pitch quantizing, a Blur stage
// (allpass diffusion into a small FDN, dsp::Fdn) and Freeze with crossfaded
// write seams. A frozen buffer can also be played from an external clip (a
// saved buffer loaded from the media store). Memory is allocated in
// prepare(); tick() never allocates.
#pragma once

#include "dsp/Clip.h"
#include "dsp/Fdn.h"
#include "dsp/Grains.h"
#include "dsp/Random.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::patch {

enum GrainsQuant { GrainsQuantOff = 0, GrainsQuantSemis, GrainsQuantOctaves, GrainsQuantFifths };

namespace grains {

constexpr double kMaxBufferSeconds = 16.0;

/// Buffer lengths of the Buffer setting (seconds).
inline double bufferSeconds(int index) noexcept {
    static constexpr double s[4] = {2.0, 4.0, 8.0, 16.0};
    return s[std::clamp(index, 0, 3)];
}
inline int maxGrains(int index) noexcept {
    static constexpr int n[3] = {16, 32, 64};
    return n[std::clamp(index, 0, 2)];
}

/// Pitch quantizers (semitones in, semitones out).
inline float quantize(float semis, int mode) noexcept {
    switch (mode) {
        case GrainsQuantSemis: return std::round(semis);
        case GrainsQuantOctaves: return 12.0f * std::round(semis / 12.0f);
        case GrainsQuantFifths: {  // octaves and octaves + a fifth
            const float o = std::floor(semis / 12.0f);
            float best = 12.0f * o, d = std::fabs(semis - best);
            for (float c : {12.0f * o + 7.0f, 12.0f * o + 12.0f})
                if (std::fabs(semis - c) < d) d = std::fabs(semis - c), best = c;
            return best;
        }
        default: return semis;
    }
}
inline float quantizeHook(float semis, const void* ctx) noexcept { return quantize(semis, *static_cast<const int*>(ctx)); }

/// Density → grains per second (0.5 … 200, exponential).
inline double rate(float density) noexcept { return 0.5 * std::pow(400.0, (double)std::clamp(density, 0.0f, 1.0f)); }
/// Irregularity grows as Density falls below 50 % (up to ±90 %).
inline float irregularity(float density) noexcept { return density >= 0.5f ? 0.0f : 0.9f * (0.5f - density) * 2.0f; }
/// Synced: grains per grid point (1 at or below 50 %, up to 4).
inline int perGrid(float density) noexcept {
    return density <= 0.5f ? 1 : std::clamp(1 + (int)std::ceil((density - 0.5f) * 2.0f * 3.0f), 2, 4);
}
/// Synced: chance to skip a grid point below 50 %.
inline double skipChance(float density) noexcept { return density >= 0.5f ? 0.0 : (0.5 - (double)density) * 2.0; }
/// Triggered: burst size (1 at or below 50 %, up to 8).
inline int burst(float density) noexcept {
    return density <= 0.5f ? 1 : std::clamp(1 + (int)std::lround((density - 0.5f) * 2.0f * 7.0f), 1, 8);
}

}  // namespace grains

struct GrainsParams {
    float position = 0.0f;
    float sizeSeconds = 0.12f;
    float pitch = 0.0f;          ///< semitones
    float density = 0.5f;
    float texture = 0.4f;
    float spread = 0.3f;
    float pitchJitter = 0.0f;    ///< semitones
    float feedback = 0.0f;
    float blur = 0.0f;
    float mix = 1.0f;
    float reverse = 0.0f;
    bool triggered = false;      ///< Mode = Triggered
    double syncBeats = 0.0;      ///< 0 = Free
    int buffer = 2;              ///< Buffer setting index (2, 4, 8, 16 s)
    int quant = GrainsQuantSemis;
    int maxGrains = 1;           ///< index: 16, 32, 64
    uint32_t seed = 1;
};

struct GrainsInput {
    float l = 0.0f, r = 0.0f;
    float trigger = 0.0f;
    float pitch = 0.0f;          ///< volts (1 V/oct)
    bool freeze = false;
    bool running = false;
    double ppq = 0.0, bpm = 120.0;
};

struct GrainsFrame {
    float l = 0.0f, r = 0.0f, grain = 0.0f, env = 0.0f;
};

/// Audio to play while frozen instead of the live buffer (planar channels).
struct GrainsClip {
    const float* const* channels = nullptr;
    int numChannels = 0;
    int length = 0;
};

class GrainsDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        cap_ = (int)std::ceil(grains::kMaxBufferSeconds * sampleRate) + 8;
        for (auto& c : buf_) c.assign((size_t)cap_, 0.0f);
        chans_[0] = buf_[0].data();
        chans_[1] = buf_[1].data();
        engine_.prepare(sampleRate);
        cloud_.prepare(sampleRate);
        fdn_.prepare(sampleRate, 8, 0.01, 7);
        static constexpr float diffMs[4] = {4.1f, 7.3f, 13.1f, 22.9f};
        for (auto& d : diff_) {
            d.prepare(sampleRate, diffMs, 4, 1.0f, 0.4f);
            d.setModulation(0.3f, 0.3f);
        }
        diff_[1].setSeed(11);
        reset();
    }
    size_t memoryBytes() const noexcept { return 2 * (size_t)cap_ * sizeof(float); }

    void reset() noexcept {
        for (auto& c : buf_) std::fill(c.begin(), c.end(), 0.0f);
        length_ = 0;
        writePos_ = filled_ = 0;
        writeGain_ = 1.0f;
        frozen_ = false;
        engine_.reset();
        cloud_.reset(seed_);
        fdn_.clear();
        for (auto& d : diff_) d.clear();
        blurOn_ = false;
        gain_ = -1.0f;
        duck_ = 1.0f;
        pending_ = None;
        clipActive_ = false;
        trigHigh_ = false;
        lastGridN_ = INT64_MIN;
        lastAge_ = lastSize_ = 0;
        extra_ = 0;
        virtualPpq_ = 0.0;
    }

    /// Restarts the grain count (transport start): renders repeat.
    void restart(uint32_t seed) noexcept {
        seed_ = seed;
        cloud_.reset(seed);
        extra_ = 0;
        lastGridN_ = INT64_MIN;
    }

    /// [audio thread] A clip to play while frozen (null: none). Takes effect
    /// with a short duck; the module starts frozen on it.
    void setClip(const GrainsClip* clip) noexcept {
        clip_ = clip ? *clip : GrainsClip{};
        request(clip && clip->length > 8 ? UseClip : DropClip);
    }
    bool playingClip() const noexcept { return clipActive_; }
    bool frozen() const noexcept { return frozen_ || clipActive_; }
    /// Grains playing (not counting ones fading out after a steal).
    int playingGrains() const noexcept { return engine_.playing(); }

    /// The live buffer for the view and for saving: channels, length, write
    /// position and valid samples. Safe to read while frozen.
    const float* channel(int c) const noexcept { return buf_[(size_t)c].data(); }
    int length() const noexcept { return length_; }
    int writePos() const noexcept { return writePos_; }
    int filled() const noexcept { return filled_; }

    /// For views: each grain's distance behind the write head (0 … 1 of the
    /// valid span), progress and gain; returns the count.
    int grainDots(float* out, int max) const noexcept {
        const GrainBuffer b = view();
        int n = 0;
        engine_.forEachGrain([&](double pos, float progress, float gain) {
            if (n >= max || b.filled <= 0) return;
            double d = (double)b.writePos - pos;
            d -= std::floor(d / b.length) * b.length;
            out[n * 3 + 0] = (float)std::clamp(d / (double)b.filled, 0.0, 1.0);
            out[n * 3 + 1] = progress;
            out[n * 3 + 2] = gain;
            ++n;
        });
        return n;
    }

    void tick(const GrainsParams& p, const GrainsInput& in, GrainsFrame& f) noexcept {
        f.grain = 0.0f;
        if (p.seed != seed_) restart(p.seed);
        const int len = (int)std::lround(grains::bufferSeconds(p.buffer) * sr_);
        if (length_ == 0) length_ = std::min(len, cap_);
        else if (len != length_ && pending_ == None) request(Resize);
        engine_.setMaxGrains(grains::maxGrains(p.maxGrains));

        // Ducks for buffer changes and source switches (10 ms out, act, 10 ms in).
        const float duckStep = (float)(1.0 / (0.01 * sr_));
        if (pending_ != None) {
            duck_ = std::max(duck_ - duckStep, 0.0f);
            if (duck_ <= 0.0f) {
                apply(pending_, len);
                pending_ = None;
            }
        } else {
            duck_ = std::min(duck_ + duckStep, 1.0f);
        }
        if (clipActive_ && !in.freeze && pending_ == None) request(DropClip);

        // Freeze: the write crossfades into the old content over 5 ms, so the
        // frozen buffer loops seamlessly at the write head (and back on release).
        const float wStep = (float)(1.0 / (0.005 * sr_));
        writeGain_ += std::clamp((in.freeze ? 0.0f : 1.0f) - writeGain_, -wStep, wStep);
        frozen_ = writeGain_ <= 0.0f;

        GrainBuffer b = view();
        quant_ = p.quant;
        GrainCloudParams cp;
        cp.position = p.position;
        cp.positionJitter = 0.25f * p.spread;
        cp.panSpread = p.spread;
        cp.sizeSeconds = std::clamp(p.sizeSeconds, 0.005f, 2.0f);
        cp.pitch = p.pitch + 12.0f * in.pitch;
        cp.pitchJitter = p.pitchJitter;
        cp.reverseChance = p.reverse;
        cp.texture = p.texture;
        cp.quantize = p.quant == GrainsQuantOff ? nullptr : grains::quantizeHook;
        cp.quantizeContext = &quant_;

        // Scheduling.
        int started = 0;
        double ratePerSecond = grains::rate(p.density);
        const bool trig = in.trigger >= 0.5f && !trigHigh_;
        trigHigh_ = in.trigger >= 0.5f;
        if (p.triggered) {
            const int n = grains::burst(p.density);
            if (trig) cloud_.trigger(n, 0.25 * (double)cp.sizeSeconds * sr_);
            started += cloud_.tickTriggered(b, cp, engine_);
            ratePerSecond = (double)std::min(n, 4) / std::max((double)cp.sizeSeconds, 1e-3);
        } else {
            if (trig) started += cloud_.spawn(b, cp, engine_, (1ull << 40) + extra_++) ? 1 : 0;
            if (p.syncBeats > 0.0) {
                virtualPpq_ = in.running ? in.ppq : virtualPpq_ + in.bpm / 60.0 / sr_;  // stopped: the last tempo
                const int per = grains::perGrid(p.density);
                const double sub = p.syncBeats / per;
                const int64_t s = (int64_t)std::floor(virtualPpq_ / sub + 1e-9);
                if (s != lastGridN_) {
                    lastGridN_ = s;
                    const int64_t grid = (int64_t)std::floor((double)s / per);
                    const uint64_t n = (uint64_t)(grid * 4 + (s - grid * per));
                    const bool skip = s % per == 0 && cloud_.random((uint64_t)grid * 4, GrainCloud::Skip) < grains::skipChance(p.density);
                    if (!skip) started += cloud_.spawn(b, cp, engine_, n) ? 1 : 0;
                }
                ratePerSecond = (double)per / std::max(dsp::beatsToSeconds(p.syncBeats, in.bpm), 1e-3);
            } else {
                cp.rate = ratePerSecond;
                cp.irregularity = grains::irregularity(p.density);
                started += cloud_.tickContinuous(b, cp, engine_);
            }
        }
        if (started > 0) {
            f.grain = 1.0f;
            lastAge_ = 0;
            lastSize_ = std::max(2, (int)std::lround(cp.sizeSeconds * sr_));
            lastTexture_ = p.texture;
        }
        f.env = lastAge_ < lastSize_ ? dsp::grainWindow(lastTexture_, ((float)lastAge_ + 0.5f) / (float)lastSize_) : 0.0f;
        ++lastAge_;

        // Grains, normalised by the expected overlap (smoothed over 50 ms).
        float gl = 0.0f, gr = 0.0f;
        engine_.process(b, gl, gr);
        const float target = dsp::grainOverlapGain(ratePerSecond, cp.sizeSeconds);
        if (gain_ < 0.0f) gain_ = target;
        gain_ += (target - gain_) * (float)(1.0 / (0.05 * sr_));
        gl *= gain_;
        gr *= gain_;

        // Blur: diffusion into a small FDN; level and decay from one knob.
        const float blur = std::clamp(p.blur, 0.0f, 1.0f);
        if (blur > 0.0f) {
            if (!blurOn_) {
                fdn_.clear();
                for (auto& d : diff_) d.clear();
                blurOn_ = true;
            }
            dsp::FdnParams fp;
            fp.size = 0.35f;
            fp.decay = (float)(0.3 * std::pow(8.0 / 0.3, (double)blur));
            fp.damping = 0.35f;
            fp.diffusion = 0.8f;
            fp.modDepth = 0.1f;
            fp.modRate = 0.4f;
            fp.limit = true;
            float bl = 0.0f, br = 0.0f;
            fdn_.process(diff_[0].process(gl, 0.6f), diff_[1].process(gr, 0.6f), bl, br, fp);
            gl = (1.0f - 0.5f * blur) * gl + blur * bl;
            gr = (1.0f - 0.5f * blur) * gr + blur * br;
        } else {
            blurOn_ = false;
        }
        gl *= duck_;
        gr *= duck_;

        // Record: input plus soft-clipped feedback of the wet signal.
        if (!frozen_ && !clipActive_ && length_ > 0) {
            const float fb = std::clamp(p.feedback, 0.0f, 1.0f);
            const float xl = in.l + fb * dsp::softClip(gl), xr = in.r + fb * dsp::softClip(gr);
            float& ol = buf_[0][(size_t)writePos_];
            float& orr = buf_[1][(size_t)writePos_];
            ol = writeGain_ * xl + (1.0f - writeGain_) * ol;
            orr = writeGain_ * xr + (1.0f - writeGain_) * orr;
            if (++writePos_ >= length_) writePos_ = 0;
            filled_ = std::min(filled_ + 1, length_);
        }

        const float mix = std::clamp(p.mix, 0.0f, 1.0f);
        f.l = in.l + mix * (gl - in.l);
        f.r = in.r + mix * (gr - in.r);
    }

private:
    using GrainBuffer = dsp::GrainBuffer;
    using GrainCloud = dsp::GrainCloud;
    using GrainCloudParams = dsp::GrainCloudParams;
    enum Pending { None, Resize, UseClip, DropClip };

    GrainBuffer view() const noexcept {
        GrainBuffer b;
        if (clipActive_ && clip_.channels != nullptr) {
            b.channels = clip_.channels;
            b.numChannels = std::clamp(clip_.numChannels, 1, 2);
            b.length = clip_.length;
            b.writePos = 0;  // the clip ends where the freeze happened
            b.filled = clip_.length;
            b.live = false;
            return b;
        }
        b.channels = chans_;
        b.numChannels = 2;
        b.length = std::max(length_, 8);
        b.writePos = writePos_;
        b.filled = filled_;
        b.live = !frozen_;
        return b;
    }

    void request(Pending what) noexcept {
        if (what == DropClip && !clipActive_) return;
        pending_ = what;
    }
    void apply(Pending what, int len) noexcept {
        engine_.reset();
        switch (what) {
            case Resize:
                length_ = std::min(len, cap_);
                writePos_ = filled_ = 0;
                break;
            case UseClip: clipActive_ = clip_.channels != nullptr && clip_.length > 8; break;
            case DropClip: clipActive_ = false; break;
            case None:
            default: break;
        }
    }

    double sr_ = 48000.0;
    std::array<std::vector<float>, 2> buf_;
    const float* chans_[2] = {nullptr, nullptr};
    int cap_ = 0, length_ = 0, writePos_ = 0, filled_ = 0;
    float writeGain_ = 1.0f, gain_ = -1.0f, duck_ = 1.0f, lastTexture_ = 0.4f;
    bool frozen_ = false, clipActive_ = false, trigHigh_ = false, blurOn_ = false;
    Pending pending_ = None;
    GrainsClip clip_;
    dsp::GrainEngine engine_;
    GrainCloud cloud_;
    dsp::Fdn fdn_;
    std::array<dsp::Diffuser, 2> diff_;
    int quant_ = GrainsQuantSemis;
    int64_t lastGridN_ = INT64_MIN;
    int lastAge_ = 0, lastSize_ = 0;
    uint64_t extra_ = 0;
    double virtualPpq_ = 0.0;
    uint32_t seed_ = 1;
};

}  // namespace bleep::patch
