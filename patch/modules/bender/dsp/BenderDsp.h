// SPDX-License-Identifier: MIT
// Bender core (doc/specs/modules/bender.md): a glitch effect. The input is
// recorded into a 4 s ring; time is cut into segments (song grid, free
// Time, or Clock pulses), and at each segment start a seeded decision
// (hash of Seed and segment index) either passes the input or repeats the
// segment that just ended, Repeats segments long, re-pitched by Bend,
// stuttered by Slice and corrupted by Mode. Every transition crossfades over
// Edge × 8 ms (Edge 0: hard cuts on purpose). Memory is allocated in
// prepare(); tick() never allocates.
#pragma once

#include "dsp/Delay.h"
#include "dsp/Lofi.h"
#include "dsp/Random.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::patch {

enum BenderMode { BenderCrush = 0, BenderDropout, BenderFold, BenderShuffle, BenderSmear, kBenderModes };
enum BenderSteps { BendFree = 0, BendOctaves, BendFifths, BendSemitones };

namespace bender {

constexpr double kRingSeconds = 4.0;
constexpr double kMaxSegment = 2.0;    ///< longest segment / source
constexpr double kPreroll = 0.010;     ///< audio kept before a source, for its loop seam
constexpr double kMinSlice = 0.003;

/// Seeded streams (one per purpose).
enum Stream : uint64_t { Glitch = 0x626e6401, Variation, Random, ShuffleMove, ShuffleTo, Dropout, Smear };

/// Bend snapped to the step set (sign kept; 0 stays 0).
inline double snapBend(double s, int steps) noexcept {
    const double a = std::fabs(s);
    if (steps == BendFree || a < 1e-9) return s;
    if (steps == BendSemitones) return std::copysign(std::exp2(std::round(12.0 * std::log2(a)) / 12.0), s);
    static constexpr double oct[] = {0.25, 0.5, 1.0, 2.0};
    static constexpr double fifth[] = {0.25, 0.5, 0.75, 1.0, 1.5, 2.0};
    const double* set = steps == BendOctaves ? oct : fifth;
    const int n = steps == BendOctaves ? 4 : 6;
    if (a < 0.125) return 0.0;  // below the smallest step: the head stops
    double best = set[0];
    for (int i = 1; i < n; ++i)
        if (std::fabs(std::log2(a / set[i])) < std::fabs(std::log2(a / best))) best = set[i];
    return std::copysign(best, s);
}

/// Bend Var: a factor from a fixed set around 1, drawn per segment; Var 0 is 1.
inline double variationFactor(double u, float var) noexcept {
    static constexpr double f[8] = {1.0, 0.5, 2.0, -1.0, 1.5, 0.75, -0.5, 0.25};
    const int i = std::clamp((int)(u * (1.0 + 7.0 * (double)std::clamp(var, 0.0f, 1.0f))), 0, 7);
    return f[i];
}

/// Decision of segment k: glitch or pass (the draw is fixed, Chance only
/// moves the threshold, so raising it only adds glitches).
inline bool glitchDraw(uint32_t seed, int64_t k, float chance) noexcept {
    return dsp::uniform01(seed, (uint64_t)k, Glitch) < (double)chance;
}

/// Repetition r of a glitch lasts len × (1 − Slice)^r (at least 3 ms);
/// synced, rounded to the nearest power-of-two division of the segment.
inline double repetitionLength(double len, float slice, int r, bool synced, double sampleRate) noexcept {
    const double s = std::clamp((double)slice, 0.0, 0.95);
    if (s <= 0.0) return len;
    double l = len * std::pow(1.0 - s, (double)r);
    if (synced) l = len / std::exp2(std::round(std::log2(len / std::max(l, 1.0))));
    return std::max(l, kMinSlice * sampleRate);
}

}  // namespace bender

struct BenderParams {
    double timeSeconds = 0.125;  ///< Free segment length
    double syncBeats = 0.25;     ///< 0 = Free
    float chance = 0.25f;
    int repeats = 4;
    float bend = 1.0f;
    float bendVar = 0.0f;
    float slice = 0.0f;
    float corrupt = 0.0f;
    float edge = 0.7f;
    float mix = 1.0f;
    int mode = BenderCrush;
    bool always = false;         ///< Corrupt When = Always
    int bendSteps = BendOctaves;
    bool now = false;
    uint32_t seed = 1;
};

struct BenderInput {
    float l = 0.0f, r = 0.0f;
    float clock = 0.0f, glitch = 0.0f;
    bool clockPatched = false;
    bool freeze = false;
    bool running = false;        ///< transport playing with a valid position
    double ppq = 0.0, bpm = 120.0;
};

struct BenderFrame {
    float l = 0.0f, r = 0.0f, active = 0.0f, segment = 0.0f, random = 0.0f;
};

class BenderDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        const int ring = (int)std::ceil(bender::kRingSeconds * sampleRate) + 16;
        ring_[0].resize(ring);
        ring_[1].resize(ring);
        srcCap_ = (int)std::ceil((bender::kMaxSegment + bender::kPreroll) * sampleRate) + 8;
        for (auto& s : src_)
            for (auto& c : s.ch) c.assign((size_t)srcCap_, 0.0f);
        reset();
    }
    size_t memoryBytes() const noexcept {
        return 2 * (size_t)(ring_[0].maxDelay() + 4) * sizeof(float) + 4 * (size_t)srcCap_ * sizeof(float);
    }

    void reset() noexcept {
        ring_[0].clear();
        ring_[1].clear();
        written_ = 0;
        restart();
        cur_ = Voice{};
        prev_ = Voice{};
        fade_ = 1.0f;
        glitching_ = false;
        segsLeft_ = 0;
        clockHigh_ = glitchHigh_ = false;
        forced_ = false;
        corruptGain_ = 1.0f;
        mode_ = pendingMode_ = -1;
        for (auto& c : crush_) c.reset();
        dropGain_ = 1.0f;
        history_.fill(0);
        historyCount_ = 0;
    }

    /// Restarts the segment count (transport start or module start).
    void restart() noexcept {
        freeK_ = 0;
        since_ = 0;
        segLen_ = 0;
        lastGridK_ = INT64_MIN;
        segK_ = -1;
        wasRunning_ = false;
    }

    bool glitching() const noexcept { return glitching_; }
    int64_t segmentIndex() const noexcept { return segK_; }
    /// Recent segments, newest last: 0 pass, 1 glitch start, 2 glitch continues, 3 sliced.
    int history(std::array<uint8_t, 64>& out) const noexcept {
        out = history_;
        return historyCount_;
    }
    /// Read head inside the current source (0 … 1), −1 while passing.
    float headPosition() const noexcept {
        return cur_.kind == Voice::Read && cur_.len > 0.0 ? (float)(cur_.pos / cur_.len) : -1.0f;
    }

    void tick(const BenderParams& p, const BenderInput& in, BenderFrame& f) noexcept {
        f.segment = 0.0f;
        const double edgeSamples = std::clamp((double)p.edge, 0.0, 1.0) * 0.008 * sr_;
        fadeLen_ = edgeSamples;

        // Mode changes: corruption ramps out and back in (10 ms each way).
        if (mode_ < 0) mode_ = pendingMode_ = p.mode;
        if (p.mode != pendingMode_) pendingMode_ = p.mode;
        const float rampStep = (float)(1.0 / (0.01 * sr_));
        if (pendingMode_ != mode_) {
            corruptGain_ = std::max(corruptGain_ - rampStep, 0.0f);
            if (corruptGain_ <= 0.0f) mode_ = pendingMode_;
        } else {
            corruptGain_ = std::min(corruptGain_ + rampStep, 1.0f);
        }

        // Record (not while frozen; the source of a frozen glitch must stay).
        if (!in.freeze) {
            ring_[0].write(in.l);
            ring_[1].write(in.r);
            ++written_;
        }

        // Glitch trigger: forces the next decision, or (Now) starts one at once.
        const bool gEdge = in.glitch >= 0.5f && !glitchHigh_;
        glitchHigh_ = in.glitch >= 0.5f;
        if (gEdge) {
            if (p.now) startGlitch(p, sourceLength(p, in), true);
            else forced_ = true;
        }

        // Segment boundaries.
        bool boundary = false;
        int64_t k = segK_;
        const double syncLen = p.syncBeats > 0.0 ? dsp::beatsToSamples(p.syncBeats, in.bpm, sr_) : 0.0;
        if (in.clockPatched) {
            const bool h = in.clock >= 0.5f;
            if (h && !clockHigh_) {
                boundary = true;
                k = freeK_++;
                lastClockLen_ = std::clamp((double)since_, 0.001 * sr_, bender::kMaxSegment * sr_);
            }
            clockHigh_ = h;
        } else if (p.syncBeats > 0.0 && in.running) {
            const int64_t gk = (int64_t)std::floor(in.ppq / p.syncBeats + 1e-9);
            if (gk != lastGridK_) {
                boundary = true;
                k = gk;
                lastGridK_ = gk;
            }
        } else {
            if (wasRunning_) {  // transport stopped: free timing from here
                since_ = 0;
                segLen_ = 0;
            }
            if (segLen_ <= 0 || since_ >= segLen_) {
                boundary = true;
                k = freeK_++;
                segLen_ = (int64_t)std::max(1.0, std::round(syncLen > 0.0 ? syncLen : p.timeSeconds * sr_));
            }
        }
        wasRunning_ = !in.clockPatched && p.syncBeats > 0.0 && in.running;
        ++since_;
        if (boundary) {
            const double ended = std::clamp((double)since_ - 1.0, 1.0, bender::kMaxSegment * sr_);
            since_ = 1;
            segK_ = k;
            f.segment = 1.0f;
            random_ = (float)(2.0 * dsp::uniform01(p.seed, (uint64_t)k, bender::Random) - 1.0);
            onBoundary(p, in, k, syncLen, ended);
        }
        if (in.freeze && !glitching_) startGlitch(p, sourceLength(p, in), true);
        if (in.freeze) freezeHeld_ = true;
        else if (freezeHeld_) {  // released: end at the next boundary
            freezeHeld_ = false;
            if (glitching_) segsLeft_ = std::min(segsLeft_, 1);
        }

        // Bend for this sample (Bend may move at audio rate: speed only).
        const double var = bender::variationFactor(varU_, p.bendVar);
        const double speed = bender::snapBend((double)p.bend * var, p.bendSteps);

        // Voices and the Edge crossfade.
        float yl = 0.0f, yr = 0.0f;
        render(cur_, p, speed, in, yl, yr);
        if (fade_ < 1.0f) {
            float pl = 0.0f, pr = 0.0f;
            render(prev_, p, speed, in, pl, pr);
            const float g = 0.5f - 0.5f * std::cos(3.14159265f * fade_);
            yl = pl + g * (yl - pl);
            yr = pr + g * (yr - pr);
            fade_ = fadeStep_ > 0.0f ? std::min(fade_ + fadeStep_, 1.0f) : 1.0f;
        }

        // Post corruption: Crush, Dropout, Fold (glitches only, or Always).
        const float amount = std::clamp(p.corrupt, 0.0f, 1.0f) * corruptGain_;
        const bool post = mode_ == BenderCrush || mode_ == BenderDropout || mode_ == BenderFold;
        if (post && amount > 0.0f && (glitching_ || p.always)) {
            switch (mode_) {
                case BenderCrush:
                    yl = crush_[0].process(yl, amount, sr_);
                    yr = crush_[1].process(yr, amount, sr_);
                    break;
                case BenderFold:
                    yl = dsp::foldCorrupt(yl, amount);
                    yr = dsp::foldCorrupt(yr, amount);
                    break;
                case BenderDropout: {
                    const bool g = glitching_ && cur_.kind == Voice::Read;
                    const double cellLen = std::max((g ? cur_.repLen : (double)std::max<int64_t>(segLen_, 16)) / 16.0, 1.0);
                    const double elapsed = g ? (double)cur_.age : (double)since_;
                    const uint64_t cell = (uint64_t)(segK_ * 4096 + (g ? cur_.rep * 16 : 2048) + (int64_t)(elapsed / cellLen));
                    const float target = dsp::Dropout::dropped(p.seed, cell, amount, bender::Dropout) ? 0.0f : 1.0f;
                    const float step = edgeSamples >= 1.0 ? (float)(1.0 / std::min(edgeSamples * 0.25, cellLen)) : 1.0f;
                    dropGain_ += std::clamp(target - dropGain_, -step, step);
                    yl *= dropGain_;
                    yr *= dropGain_;
                    break;
                }
                default: break;
            }
        } else {
            dropGain_ = 1.0f;
        }

        // Repetitions inside a glitch (the next one plays from the next sample).
        if (glitching_ && cur_.kind == Voice::Read && ++cur_.age >= cur_.repLen) nextRepetition(p, in);

        const float mix = std::clamp(p.mix, 0.0f, 1.0f);
        f.l = in.l + mix * (yl - in.l);
        f.r = in.r + mix * (yr - in.r);
        f.active = glitching_ ? 1.0f : 0.0f;
        f.random = random_;
        ++n_;
    }

private:
    struct Source {
        std::array<std::vector<float>, 2> ch;
        int pre = 0;      ///< samples of pre-roll before the segment start
        int len = 0;      ///< segment length
    };
    struct Voice {
        enum Kind { Pass, Read } kind = Pass;
        int src = 0;
        double len = 0.0;     ///< source length
        double repLen = 0.0;  ///< this repetition's length (output samples)
        double pos = 0.0;     ///< read position in the repetition region
        int64_t age = 0;
        int rep = 0;
        int lastSlice = -1, prevSlice = -1;
        double sliceFade = 1.0;
        double buzz = 0.0;    ///< Bend 0: phase of the 2 ms grain
        bool fresh = true;    ///< not rendered yet (a reversed read starts at the end)
        uint64_t key = 0;     ///< segment the glitch was decided in (shuffle / smear draws)
    };

    double sourceLength(const BenderParams& p, const BenderInput& in) const noexcept {
        double len;
        if (in.clockPatched) len = lastClockLen_ > 0.0 ? lastClockLen_ : p.timeSeconds * sr_;
        else if (p.syncBeats > 0.0) len = dsp::beatsToSamples(p.syncBeats, in.bpm, sr_);
        else len = p.timeSeconds * sr_;
        return std::clamp(len, 0.001 * sr_, bender::kMaxSegment * sr_);
    }

    void onBoundary(const BenderParams& p, const BenderInput& in, int64_t k, double syncLen, double ended) noexcept {
        uint8_t code = 0;
        if (glitching_) {
            if (!freezeHeld_ && --segsLeft_ <= 0) {
                endGlitch();
            } else {
                code = p.slice > 0.0f ? 3 : 2;
            }
        }
        if (!glitching_) {
            const bool yes = forced_ || bender::glitchDraw(p.seed, k, p.chance);
            forced_ = false;
            if (yes) {  // the source: the segment that just ended
                const double len = !in.clockPatched && syncLen > 0.0 && in.running ? syncLen : ended;
                startGlitch(p, std::clamp(len, 0.001 * sr_, bender::kMaxSegment * sr_), false);
                code = 1;
            }
        }
        for (size_t i = 0; i + 1 < history_.size(); ++i) history_[i] = history_[i + 1];
        history_.back() = code;
        historyCount_ = std::min(historyCount_ + 1, (int)history_.size());
    }

    /// Copies the last `len` recorded samples (plus pre-roll) into a free
    /// source buffer and starts reading it.
    void startGlitch(const BenderParams& p, double len, bool immediate) noexcept {
        const int s = cur_.kind == Voice::Read ? 1 - cur_.src : 0;
        Source& src = src_[(size_t)s];
        const int L = std::clamp((int)std::lround(len), 1, srcCap_ - 8);
        // Pre-roll for the loop seam (before the first writes the ring holds silence).
        const int pre = std::max(0, std::min((int)(bender::kPreroll * sr_), srcCap_ - 8 - L));
        const int total = pre + L;
        for (int c = 0; c < 2; ++c) {
            float* d = src.ch[(size_t)c].data();
            for (int i = 0; i < total; ++i) d[i] = ring_[(size_t)c].at((size_t)(total - 1 - i));  // oldest first
        }
        src.pre = pre;
        src.len = L;
        Voice v;
        v.kind = Voice::Read;
        v.src = s;
        v.len = (double)L;
        v.rep = 0;
        v.repLen = repetitionLength(p, 0, (double)L);
        v.key = (uint64_t)segK_;
        transition(v);
        if (!glitching_ || immediate) segsLeft_ = std::max(p.repeats, 1);
        glitching_ = true;
        varU_ = dsp::uniform01(p.seed, (uint64_t)segK_, bender::Variation);
    }

    void endGlitch() noexcept {
        glitching_ = false;
        segsLeft_ = 0;
        transition(Voice{});
    }

    void nextRepetition(const BenderParams& p, const BenderInput&) noexcept {
        Voice v = cur_;
        v.rep = cur_.rep + 1;
        v.repLen = repetitionLength(p, v.rep, v.len);
        v.pos = 0.0;
        v.age = 0;
        v.lastSlice = v.prevSlice = -1;
        v.sliceFade = 1.0;
        transition(v);
    }

    double repetitionLength(const BenderParams& p, int r, double len) const noexcept {
        return bender::repetitionLength(len, p.slice, r, p.syncBeats > 0.0, sr_);
    }

    void transition(const Voice& next) noexcept {
        prev_ = cur_;
        cur_ = next;
        const double fl = next.kind == Voice::Read ? std::min(fadeLen_, 0.5 * next.repLen) : fadeLen_;
        if (fl >= 1.0) {
            fade_ = 0.0f;
            fadeStep_ = (float)(1.0 / fl);
        } else {
            fade_ = 1.0f;
            fadeStep_ = 0.0f;
        }
    }

    /// One sample of a voice (and advances it).
    void render(Voice& v, const BenderParams& p, double speed, const BenderInput& in, float& l, float& r) noexcept {
        if (v.kind == Voice::Pass) {
            l = in.l;
            r = in.r;
            return;
        }
        const Source& src = src_[(size_t)v.src];
        const double L = std::max(v.repLen, 2.0);
        const float amount = std::clamp(p.corrupt, 0.0f, 1.0f) * corruptGain_;
        const double seam = std::min(fadeLen_, std::min(0.5 * L, (double)src.pre));
        if (std::fabs(speed) < 1e-3) {  // Bend 0: a 2 ms grain at the head, a buzz
            const double g = 0.002 * sr_;
            float yl = 0.0f, yr = 0.0f;
            for (int h = 0; h < 2; ++h) {
                double ph = v.buzz + 0.5 * h;
                ph -= std::floor(ph);
                const float w = (float)std::sin(3.14159265358979 * ph);
                yl += w * w * readSeam(src, 0, v.pos + ph * g, L, seam);
                yr += w * w * readSeam(src, 1, v.pos + ph * g, L, seam);
            }
            v.buzz += 1.0 / g;
            v.buzz -= std::floor(v.buzz);
            l = yl;
            r = yr;
            return;
        }
        double pos = v.pos;
        if (v.fresh && speed < 0.0) pos = v.pos = L - 1e-6;  // reversed: from the end
        v.fresh = false;
        double read = pos;
        double prevRead = -1.0;
        if (mode_ == BenderShuffle && amount > 0.0f) {
            const double sl = L / 8.0;
            const int j = std::clamp((int)(pos / sl), 0, 7);
            auto mapped = [&](int slice) {
                const uint64_t key = v.key * 64 + (uint64_t)slice;
                const bool moves = dsp::uniform01(p.seed, key, bender::ShuffleMove) < (double)amount;
                const int to = moves ? (int)(dsp::uniform01(p.seed, key, bender::ShuffleTo) * 8.0) : slice;
                return pos - slice * sl + std::clamp(to, 0, 7) * sl;
            };
            if (j != v.lastSlice) {
                v.prevSlice = v.lastSlice;
                v.lastSlice = j;
                v.sliceFade = v.prevSlice >= 0 && seam >= 1.0 ? 0.0 : 1.0;
            }
            read = mapped(j);
            if (v.sliceFade < 1.0) {
                prevRead = mapped(v.prevSlice);
                v.sliceFade = std::min(v.sliceFade + 1.0 / seam, 1.0);
            }
        } else if (mode_ == BenderSmear && amount > 0.0f) {
            const double t = (double)(n_) / (0.005 * sr_);
            read += dsp::smoothNoise(p.seed, bender::Smear + v.key, t) * 0.020 * sr_ * (double)amount;
        }
        float yl = readSeam(src, 0, read, L, seam), yr = readSeam(src, 1, read, L, seam);
        if (prevRead >= 0.0) {
            const float g = (float)(0.5 - 0.5 * std::cos(3.14159265358979 * v.sliceFade));
            yl = readSeam(src, 0, prevRead, L, seam) + g * (yl - readSeam(src, 0, prevRead, L, seam));
            yr = readSeam(src, 1, prevRead, L, seam) + g * (yr - readSeam(src, 1, prevRead, L, seam));
        }
        l = yl;
        r = yr;
        v.pos = pos + speed;
        if (v.pos >= L) v.pos -= L * std::floor(v.pos / L);
        else if (v.pos < 0.0) v.pos += L * std::ceil(-v.pos / L);
    }

    /// Cubic read of the repetition region [0, L) as a loop: near its end the
    /// audio crossfades into the pre-roll before the start (`seam` samples),
    /// so wrapping is continuous.
    static float readSeam(const Source& s, int c, double pos, double L, double seam) noexcept {
        pos -= L * std::floor(pos / L);
        float y = readAt(s, c, pos);
        if (seam >= 1.0 && pos > L - seam) {
            const float g = (float)((L - pos) / seam);  // 1 → 0 towards the end
            const float w = std::sin(1.5707963f * g);
            y = w * w * y + (1.0f - w * w) * readAt(s, c, pos - L);
        }
        return y;
    }
    /// Cubic read relative to the segment start (negative: pre-roll).
    static float readAt(const Source& s, int c, double pos) noexcept {
        const float* x = s.ch[(size_t)c].data();
        const int n = s.pre + s.len;
        const double q = std::clamp(pos + s.pre, 0.0, (double)(n - 1));
        const int i = (int)q;
        const float t = (float)(q - i);
        const auto at = [&](int k) { return x[std::clamp(k, 0, n - 1)]; };
        return dsp::hermite4(at(i - 1), at(i), at(i + 1), at(i + 2), t);
    }

    double sr_ = 48000.0;
    std::array<dsp::RingDelay, 2> ring_;
    std::array<Source, 2> src_;
    int srcCap_ = 0;
    int64_t written_ = 0;
    Voice cur_, prev_;
    float fade_ = 1.0f, fadeStep_ = 0.0f, corruptGain_ = 1.0f, dropGain_ = 1.0f, random_ = 0.0f;
    double fadeLen_ = 0.0, lastClockLen_ = 0.0, varU_ = 0.0;
    bool glitching_ = false, clockHigh_ = false, glitchHigh_ = false, forced_ = false, freezeHeld_ = false, wasRunning_ = false;
    int segsLeft_ = 0, mode_ = -1, pendingMode_ = -1;
    int64_t freeK_ = 0, since_ = 0, segLen_ = 0, lastGridK_ = INT64_MIN, segK_ = -1;
    std::array<dsp::Crush, 2> crush_;
    std::array<uint8_t, 64> history_{};
    int historyCount_ = 0;
    uint64_t n_ = 0;
};

}  // namespace bleep::patch
