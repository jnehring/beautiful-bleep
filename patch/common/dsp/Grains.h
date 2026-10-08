// SPDX-License-Identifier: MIT
// Granular engine over a caller-owned buffer (specs/modules/grains.md §4,
// splice.md §4.4, the Macro Osc's Grain model): morphable grain windows, up
// to 64 grain voices with per-grain pitch (negative = reversed), position,
// pan and size, click-free stealing when the cap is reached, and a seeded
// scheduler (density plus position / pitch / pan jitter) whose every random
// choice is uniform01(seed, grain index, stream), so renders repeat exactly.
//
// The engine never allocates: grain slots are fixed, the window tables are
// built once (call grainWindowTables() off the audio thread to warm them).
#pragma once

#include "Delay.h"
#include "Random.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

// ---- windows ----------------------------------------------------------------

/// Window shapes along the texture axis (0 … 1), in this order:
/// rectangle (5 % raised-cosine fades), trapezoid (25 % linear fades), Hann,
/// narrow Gaussian, percussive (fast attack, exponential decay). All are 0 at
/// both ends. Texture values between two shapes interpolate them.
struct GrainWindowTables {
    static constexpr int kShapes = 5, kSize = 1024;
    std::array<std::array<float, kSize + 2>, kShapes> t{};
};

inline const GrainWindowTables& grainWindowTables() {
    static const GrainWindowTables tables = [] {
        GrainWindowTables w;
        constexpr double pi = 3.14159265358979323846;
        const double g0 = std::exp(-0.5 * (0.5 / 0.15) * (0.5 / 0.15));
        for (int i = 0; i <= GrainWindowTables::kSize + 1; ++i) {
            const double x = std::min((double)i / GrainWindowTables::kSize, 1.0);
            const double edge = std::min(x, 1.0 - x);
            const double rect = edge >= 0.05 ? 1.0 : 0.5 - 0.5 * std::cos(pi * edge / 0.05);
            const double trap = std::min(edge / 0.25, 1.0);
            const double hann = 0.5 - 0.5 * std::cos(2.0 * pi * x);
            const double gauss = (std::exp(-0.5 * ((x - 0.5) / 0.15) * ((x - 0.5) / 0.15)) - g0) / (1.0 - g0);
            const double att = x < 0.02 ? std::sin(0.5 * pi * x / 0.02) : 1.0;
            const double tail = x > 0.9 ? 0.5 + 0.5 * std::cos(pi * (x - 0.9) / 0.1) : 1.0;
            const double perc = att * std::exp(-5.0 * std::max(x - 0.02, 0.0)) * tail;
            const double v[5] = {rect, trap, hann, gauss, perc};
            for (int s = 0; s < GrainWindowTables::kShapes; ++s) w.t[(size_t)s][(size_t)i] = (float)v[s];
        }
        return w;
    }();
    return tables;
}

/// Window value at x ∈ [0, 1] for a texture ∈ [0, 1].
inline float grainWindow(float texture, float x) noexcept {
    const auto& w = grainWindowTables();
    const float s = std::clamp(texture, 0.0f, 1.0f) * (GrainWindowTables::kShapes - 1);
    const int a = std::min((int)s, GrainWindowTables::kShapes - 2);
    const float sf = s - (float)a;
    const float p = std::clamp(x, 0.0f, 1.0f) * GrainWindowTables::kSize;
    const int i = std::min((int)p, GrainWindowTables::kSize - 1);
    const float f = p - (float)i;
    const auto& ta = w.t[(size_t)a];
    const auto& tb = w.t[(size_t)a + 1];
    const float va = ta[(size_t)i] + f * (ta[(size_t)i + 1] - ta[(size_t)i]);
    const float vb = tb[(size_t)i] + f * (tb[(size_t)i + 1] - tb[(size_t)i]);
    return va + sf * (vb - va);
}

// ---- buffer and grains ------------------------------------------------------

/// A view of the caller's circular buffer. channels[c][i] for i < length.
struct GrainBuffer {
    const float* const* channels = nullptr;
    int numChannels = 0;  ///< 1 (mono, played to both sides) or 2
    int length = 0;       ///< buffer size in samples
    int writePos = 0;     ///< next index to be written (the "now" of the buffer)
    int filled = 0;       ///< valid samples behind writePos (≤ length)
    bool live = true;     ///< still being written: grains stay clear of the write head
};

/// Cubic read of channel c at an absolute (wrapping) position.
inline float grainRead(const GrainBuffer& b, int c, double pos) noexcept {
    const float* x = b.channels[std::min(c, b.numChannels - 1)];
    const int n = b.length;
    pos -= std::floor(pos / n) * n;
    int i = std::min((int)pos, n - 1);
    const float t = (float)(pos - i);
    const int im1 = i == 0 ? n - 1 : i - 1;
    const int i1 = i + 1 >= n ? i + 1 - n : i + 1;
    const int i2 = i + 2 >= n ? i + 2 - n : i + 2;
    return hermite4(x[im1], x[i], x[i1], x[i2], t);
}

/// Everything a grain fixes at its start.
struct GrainSpec {
    double start = 0.0;   ///< absolute buffer position of the first sample
    double ratio = 1.0;   ///< read speed: 2 = octave up, negative = reversed
    int size = 4800;      ///< length in samples
    float pan = 0.0f;     ///< −1 … +1 (equal power, centre = unity on both sides)
    float texture = 0.5f; ///< window shape (grainWindow)
    float gain = 1.0f;
};

/// Up to kMaxGrains grains (the cap can be lowered). When the cap is reached,
/// the oldest grain fades out over the steal time (2 ms default) in one of the
/// spare slots and the new one starts at once, so CPU stays bounded and
/// nothing clicks.
class GrainEngine {
public:
    static constexpr int kMaxGrains = 64;

    void prepare(double sampleRate) {
        (void)grainWindowTables();
        stealSamples_ = std::max(1, (int)(0.002 * sampleRate));
        reset();
    }
    void setMaxGrains(int n) noexcept { max_ = std::clamp(n, 1, kMaxGrains); }
    void setStealSamples(int n) noexcept { stealSamples_ = std::max(n, 1); }
    void reset() noexcept {
        for (auto& g : g_) g.active = false;
        counter_ = 0;
    }

    /// Starts a grain; returns false only if every slot (including the spare
    /// fading ones) is busy.
    bool start(const GrainSpec& s) noexcept {
        if (s.size < 2) return false;
        int playing = 0;
        Grain* oldest = nullptr;
        Grain* freeSlot = nullptr;
        for (auto& g : g_) {
            if (!g.active) {
                if (freeSlot == nullptr) freeSlot = &g;
                continue;
            }
            if (g.releasing) continue;
            ++playing;
            if (oldest == nullptr || g.order < oldest->order) oldest = &g;
        }
        if (playing >= max_ && oldest != nullptr) {
            oldest->releasing = true;
            oldest->release = 1.0f;
        }
        if (freeSlot == nullptr) return false;
        Grain& g = *freeSlot;
        g.active = true;
        g.releasing = false;
        g.release = 1.0f;
        g.pos = s.start;
        g.ratio = s.ratio;
        g.age = 0;
        g.size = s.size;
        g.order = ++counter_;
        const float th = (std::clamp(s.pan, -1.0f, 1.0f) + 1.0f) * 0.78539816f;
        g.gl = 1.41421356f * std::cos(th) * s.gain;
        g.gr = 1.41421356f * std::sin(th) * s.gain;
        // Latch the window as two table rows and a blend.
        const float sh = std::clamp(s.texture, 0.0f, 1.0f) * (GrainWindowTables::kShapes - 1);
        g.shape = std::min((int)sh, GrainWindowTables::kShapes - 2);
        g.shapeFrac = sh - (float)g.shape;
        return true;
    }

    /// Sums all grains into outL/outR (added, so clear them first).
    void process(const GrainBuffer& b, float& outL, float& outR) noexcept {
        if (b.channels == nullptr || b.length < 4) return;
        const auto& w = grainWindowTables();
        const float relStep = 1.0f / (float)stealSamples_;
        for (auto& g : g_) {
            if (!g.active) continue;
            const float p = ((float)g.age + 0.5f) / (float)g.size * GrainWindowTables::kSize;
            const int i = std::min((int)p, GrainWindowTables::kSize - 1);
            const float f = p - (float)i;
            const auto& ta = w.t[(size_t)g.shape];
            const auto& tb = w.t[(size_t)g.shape + 1];
            const float va = ta[(size_t)i] + f * (ta[(size_t)i + 1] - ta[(size_t)i]);
            const float vb = tb[(size_t)i] + f * (tb[(size_t)i + 1] - tb[(size_t)i]);
            float win = va + g.shapeFrac * (vb - va);
            if (g.releasing) {
                g.release -= relStep;
                win *= std::max(g.release, 0.0f);
            }
            const float l = grainRead(b, 0, g.pos) * win;
            const float r = b.numChannels > 1 ? grainRead(b, 1, g.pos) * win : l;
            outL += l * g.gl;
            outR += r * g.gr;
            g.pos += g.ratio;
            if (++g.age >= g.size || (g.releasing && g.release <= 0.0f)) g.active = false;
        }
    }

    /// Grains playing and not being stolen.
    int playing() const noexcept {
        int n = 0;
        for (const auto& g : g_) n += g.active && !g.releasing ? 1 : 0;
        return n;
    }
    /// All busy slots, including grains fading out after a steal.
    int busy() const noexcept {
        int n = 0;
        for (const auto& g : g_) n += g.active ? 1 : 0;
        return n;
    }
    /// For views: visits each active grain with (position, progress 0…1, gain).
    template <typename F>
    void forEachGrain(F&& f) const {
        for (const auto& g : g_)
            if (g.active) f(g.pos, (float)g.age / (float)g.size, g.releasing ? g.release : 1.0f);
    }

private:
    struct Grain {
        double pos = 0.0, ratio = 1.0;
        int age = 0, size = 0, shape = 0;
        float shapeFrac = 0.0f, gl = 1.0f, gr = 1.0f, release = 1.0f;
        uint64_t order = 0;
        bool active = false, releasing = false;
    };
    static constexpr int kSpare = 16;  // slots for grains fading out after a steal
    std::array<Grain, kMaxGrains + kSpare> g_{};
    int max_ = 32, stealSamples_ = 96;
    uint64_t counter_ = 0;
};

// ---- scheduling -------------------------------------------------------------

/// What the cloud draws its grains from. Positions are fractions of the
/// usable span behind the write head (0 = newest audio, 1 = oldest).
struct GrainCloudParams {
    double rate = 20.0;            ///< grains per second (continuous mode)
    float irregularity = 0.0f;     ///< 0 … 0.9: interval × (1 ± irregularity)
    float position = 0.0f;         ///< 0 … 1
    float positionJitter = 0.0f;   ///< ± fraction of the span
    float sizeSeconds = 0.12f;
    float pitch = 0.0f;            ///< semitones
    float pitchJitter = 0.0f;      ///< ± semitones
    float panSpread = 0.0f;        ///< 0 … 1
    float reverseChance = 0.0f;    ///< 0 … 1
    float texture = 0.5f;
    float gain = 1.0f;
    /// Optional pitch quantizer applied to pitch + jitter (semitones in, out).
    float (*quantize)(float semitones, const void* context) = nullptr;
    const void* quantizeContext = nullptr;
};

/// Seeded scheduler. Grain n's random draws are uniform01(seed, n, stream)
/// with one stream per parameter (the GrainCloud::Stream values); n counts
/// grains since reset() (or is passed explicitly, e.g. a grid index).
class GrainCloud {
public:
    enum Stream : uint64_t { Timing = 0x67740001, Position, Pitch, Pan, Reverse, Skip };

    void prepare(double sampleRate) noexcept { sr_ = sampleRate; }
    /// Restarts the grain count and timing (first grain on the next tick).
    void reset(uint64_t seed) noexcept {
        seed_ = seed;
        n_ = 0;
        phase_ = 1.0;
        interval_ = 1.0;
        burstLeft_ = 0;
    }
    uint64_t seed() const noexcept { return seed_; }
    uint64_t grainCount() const noexcept { return n_; }
    double random(uint64_t n, Stream s) const noexcept { return uniform01(seed_, n, (uint64_t)s); }

    /// Continuous mode, once per sample: starts grains at `rate` (the
    /// irregularity scales each interval by 1 ± irregularity, seeded).
    /// Returns the number of grains started (0 or 1).
    int tickContinuous(const GrainBuffer& b, const GrainCloudParams& p, GrainEngine& e) noexcept {
        phase_ += std::max(p.rate, 0.0) / sr_ / interval_;
        if (phase_ < 1.0) return 0;
        phase_ = std::min(phase_ - 1.0, 1.0);
        const double irr = std::clamp((double)p.irregularity, 0.0, 0.9);
        interval_ = 1.0 + irr * (2.0 * random(n_, Timing) - 1.0);
        return spawn(b, p, e, n_++) ? 1 : 0;
    }

    /// Triggered mode: a pulse starts `burst` grains (1 … 8), spaced by
    /// spacingSamples; call tickTriggered every sample.
    void trigger(int burst = 1, double spacingSamples = 0.0) noexcept {
        burstLeft_ = std::clamp(burst, 1, 8);
        spacing_ = std::max(spacingSamples, 0.0);
        burstWait_ = 0.0;
    }
    int tickTriggered(const GrainBuffer& b, const GrainCloudParams& p, GrainEngine& e) noexcept {
        int started = 0;
        while (burstLeft_ > 0 && burstWait_ <= 0.0) {
            started += spawn(b, p, e, n_++) ? 1 : 0;
            --burstLeft_;
            burstWait_ += std::max(spacing_, 1.0);
            if (spacing_ <= 0.0) burstWait_ = 0.0;
        }
        burstWait_ -= 1.0;
        return started;
    }

    /// Builds grain n's spec from the params (deterministic in seed, n).
    GrainSpec makeGrain(const GrainBuffer& b, const GrainCloudParams& p, uint64_t n) const noexcept {
        GrainSpec s;
        s.size = std::max(2, (int)std::lround(std::max(p.sizeSeconds, 0.0f) * sr_));
        float semis = p.pitch + p.pitchJitter * (float)(2.0 * random(n, Pitch) - 1.0);
        if (p.quantize != nullptr) semis = p.quantize(semis, p.quantizeContext);
        s.ratio = std::exp2((double)semis / 12.0);
        if (random(n, Reverse) < (double)p.reverseChance) s.ratio = -s.ratio;
        s.pan = std::clamp(p.panSpread, 0.0f, 1.0f) * (float)(2.0 * random(n, Pan) - 1.0);
        s.texture = p.texture;
        s.gain = p.gain;
        const double pos = std::clamp((double)p.position + (double)p.positionJitter * (2.0 * random(n, Position) - 1.0), 0.0, 1.0);
        s.start = startFor(b, pos, s.ratio, s.size);
        return s;
    }

    bool spawn(const GrainBuffer& b, const GrainCloudParams& p, GrainEngine& e, uint64_t n) const noexcept {
        if (b.length < 8 || b.filled < 8) return false;
        return e.start(makeGrain(b, p, n));
    }

    /// Absolute start position for a grain whose read head should sit at
    /// `position` (0 newest … 1 oldest) of the usable span. The whole grain
    /// stays between the write head (≥ 3 samples behind it, for the cubic
    /// read) and the oldest valid sample, including its drift from reading
    /// faster or slower than the write head moves (or, frozen, from moving at
    /// all). Grains longer than the span are clamped to the newest end.
    static double startFor(const GrainBuffer& b, double position, double ratio, int size) noexcept {
        const double filled = std::clamp((double)b.filled, 0.0, (double)b.length);
        // Delay behind writePos over the grain's life: d(t) = d0 + t (w − ratio),
        // t ∈ [0, size], where w = 1 while the write head moves (live), else 0.
        const double drift = (double)size * ((b.live ? 1.0 : 0.0) - ratio);
        const double lo = 3.0 - std::min(drift, 0.0);
        const double hi = std::max(filled - 3.0 - std::max(drift, 0.0), lo);
        const double d0 = lo + std::clamp(position, 0.0, 1.0) * (hi - lo);
        return (double)b.writePos - d0;
    }

private:
    double sr_ = 48000.0, phase_ = 1.0, interval_ = 1.0, spacing_ = 0.0, burstWait_ = 0.0;
    uint64_t seed_ = 1, n_ = 0;
    int burstLeft_ = 0;
};

/// Output gain normalisation for overlapping grains: 1 / √max(1, rate × size).
inline float grainOverlapGain(double rate, double sizeSeconds) noexcept {
    return (float)(1.0 / std::sqrt(std::max(1.0, rate * sizeSeconds)));
}

}  // namespace bleep::dsp
