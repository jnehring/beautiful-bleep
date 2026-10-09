// SPDX-License-Identifier: MIT
// Switch core (specs/modules/switch.md §4): a sequential switch with up to
// 8 steps. One step position drives both sections, 8 → 1 and 1 → 8. Steps
// come from Step triggers or the transport, Select offsets them, and every
// change fades from the current mix, so interrupted fades never jump.
#pragma once

#include "dsp/Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace bleep::patch {

constexpr int kSwitchSteps = 8;
constexpr int64_t kNoTick = std::numeric_limits<int64_t>::min();

enum SwitchOrder { SwitchForward = 0, SwitchBackward, SwitchPingPong, SwitchRandom, SwitchWalk };
enum SwitchCurve { SwitchEqualPower = 0, SwitchLinear };

struct SwitchParams {
    float level[kSwitchSteps] = {1, 1, 1, 1, 1, 1, 1, 1};
    float select = 0.0f;  ///< 0..1: offset of floor(select × Length) steps
    float fade = 0.002f;  ///< seconds
    int length = 4;       ///< 2..8
    int order = SwitchForward;
    int curve = SwitchEqualPower;
    bool glide = false;   ///< 8 → 1: glide between values instead of crossfading
    bool hold = false;    ///< 1 → 8: unselected outputs keep their last value
    uint32_t seed = 1;
};

/// Where the step counter comes from this sample.
struct SwitchClock {
    float step = 0.0f, reset = 0.0f;  ///< trigger inputs
    bool transport = false;           ///< Step unpatched and a Rate set: follow the song
    bool playing = false;
    int64_t tick = 0;                 ///< floor(ppq / rate) while playing
};

struct SwitchFrame {
    float out = 0.0f;
    float outs[kSwitchSteps] = {};
    float gate = 1.0f, end = 0.0f, position = 0.0f, changed = 0.0f;
};

class SwitchDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        count_ = 0;
        base_ = 0;
        walkK_ = -1;
        pos_ = -1;
        slot_ = prevSlot_ = 0;
        wrapped_ = false;
        stepHigh_ = resetHigh_ = false;
        lastTick_ = kNoTick;
        t_ = 1.0f;
        glideFrom_ = 0.0f;
        lastOut_ = 0.0f;
        for (int k = 0; k < kSwitchSteps; ++k) amount_[k] = start_[k] = held_[k] = 0.0f;
    }

    /// The step after `count` steps for the stateless orders (Random and
    /// Random walk need the previous step: see advance()).
    static int stepAt(int order, int length, int64_t count) noexcept {
        const int n = std::max(1, length);
        switch (order) {
            case SwitchBackward: return n - 1 - (int)(((count % n) + n) % n);
            case SwitchPingPong: {
                if (n <= 2) return (int)(count % n);
                const int64_t period = 2 * (n - 1);
                const int k = (int)(((count % period) + period) % period);
                return k < n ? k : (int)period - k;
            }
            default: return (int)(((count % n) + n) % n);
        }
    }

    /// One random move from `prev` at counter k: Random never repeats a step,
    /// Random walk moves ±1 and reflects at the ends.
    static int randomMove(int order, int length, int prev, int64_t k, uint32_t seed) noexcept {
        const int n = std::max(1, length);
        if (n == 1) return 0;
        const double u = dsp::uniform01(seed, (uint64_t)k, 0);
        if (order == SwitchWalk) {
            int p = prev + (u < 0.5 ? -1 : 1);
            if (p < 0) p = 1;
            if (p >= n) p = n - 2;
            return p;
        }
        const int r = (int)(u * (n - 1));
        return r >= prev ? r + 1 : r;
    }

    void tick(const float* in, const bool* patched, float splitIn, const SwitchClock& clk, const SwitchParams& p,
              SwitchFrame& f) noexcept {
        const int n = std::clamp(p.length, 2, kSwitchSteps);
        f.end = 0.0f;

        // ---- the step counter
        const bool reset = rising(clk.reset, resetHigh_);
        const bool step = rising(clk.step, stepHigh_);
        if (pos_ < 0 || reset) {
            count_ = 0;
            base_ = isRandom(p.order) ? 0 : stepAt(p.order, n, 0);
            walkK_ = 0;
            lastTick_ = kNoTick;
        }
        if (reset) {
            // Reset wins over a step on the same sample.
        } else if (clk.transport) {
            if (clk.playing && clk.tick != lastTick_) {
                follow(clk.tick, lastTick_, p, n);
                lastTick_ = clk.tick;
            }
        } else if (step) {
            follow(count_ + 1, count_, p, n);
        }

        // ---- Select offsets the step, with 2 % of a slot of hysteresis
        const float sel = std::clamp(p.select, 0.0f, 0.9999f) * (float)n;
        if (sel < (float)slot_ - 0.02f || sel >= (float)(slot_ + 1) + 0.02f || slot_ >= n)
            slot_ = std::min((int)sel, n - 1);
        const int pos = (base_ % n + slot_) % n;

        f.changed = 0.0f;
        if (pos_ < 0) {  // first sample: no fade
            pos_ = pos;
            for (int k = 0; k < kSwitchSteps; ++k) amount_[k] = k == pos ? 1.0f : 0.0f;
            t_ = 1.0f;
            glideFrom_ = value(in, patched, p, pos);
        } else if (pos != pos_) {
            if (wrapped_ || (slot_ == 0 && prevSlot_ == n - 1)) f.end = 1.0f;
            for (int k = 0; k < kSwitchSteps; ++k) start_[k] = amount_[k];
            glideFrom_ = lastOut_;
            pos_ = pos;
            t_ = p.fade > 0.0f ? 0.0f : 1.0f;
            f.changed = 1.0f;
        }
        prevSlot_ = slot_;
        wrapped_ = false;
        f.gate = f.changed > 0.0f ? 0.0f : 1.0f;

        // ---- fade progress: every step's amount moves linearly; the amounts sum to 1
        if (t_ < 1.0f) t_ = std::min(1.0f, t_ + (float)(1.0 / (std::max(p.fade, 1e-5f) * sampleRate_)));
        for (int k = 0; k < kSwitchSteps; ++k)
            amount_[k] = k == pos_ ? start_[k] + (1.0f - start_[k]) * t_ : start_[k] * (1.0f - t_);
        if (t_ >= 1.0f)
            for (int k = 0; k < kSwitchSteps; ++k) start_[k] = amount_[k];

        // ---- 8 → 1
        if (p.glide) {
            const float v = value(in, patched, p, pos_);
            f.out = glideFrom_ + (v - glideFrom_) * t_;
        } else {
            float out = 0.0f;
            for (int k = 0; k < kSwitchSteps; ++k)
                if (amount_[k] > 0.0f) out += gain(amount_[k], p.curve) * value(in, patched, p, k);
            f.out = out;
        }
        lastOut_ = f.out;

        // ---- 1 → 8
        for (int k = 0; k < kSwitchSteps; ++k) {
            const float g = gain(amount_[k], p.curve);
            f.outs[k] = p.hold ? held_[k] + (splitIn - held_[k]) * g : g * splitIn;
            if (p.hold && k == pos_) held_[k] = f.outs[k];
        }
        f.position = (float)pos_ / (float)(n - 1);
    }

    int position() const noexcept { return pos_; }

private:
    static bool rising(float x, bool& high) noexcept {
        const bool h = x >= 0.5f, edge = h && !high;
        high = h;
        return edge;
    }
    static bool isRandom(int order) noexcept { return order == SwitchRandom || order == SwitchWalk; }
    static float gain(float amount, int curve) noexcept {
        if (curve == SwitchLinear) return amount;
        return std::sin(amount * 1.57079632679489662f);
    }
    /// An input times its Level; an unpatched input is the Level itself.
    static float value(const float* in, const bool* patched, const SwitchParams& p, int k) noexcept {
        return patched[k] ? in[k] * p.level[k] : p.level[k];
    }

    /// Moves the step counter to k (from `from`, the previous counter).
    void follow(int64_t k, int64_t from, const SwitchParams& p, int n) noexcept {
        count_ = k;
        // End: the cycle starts again (every Length steps for the random orders).
        if (!isRandom(p.order)) {
            const int b = stepAt(p.order, n, k);
            wrapped_ = b == stepAt(p.order, n, 0) && b != base_ % n;
            base_ = b;
            return;
        }
        wrapped_ = k % n == 0;
        if (from != k - 1 || walkK_ != from) {
            // A jump (loop, mid-song start): rebuild from the last 64 moves.
            base_ = 0;
            for (int64_t j = std::max<int64_t>(1, k - 64); j < k; ++j) base_ = randomMove(p.order, n, base_, j, p.seed);
        }
        base_ = randomMove(p.order, n, base_ % n, k, p.seed);
        walkK_ = k;
    }

    double sampleRate_ = 48000.0;
    int64_t count_ = 0, walkK_ = -1, lastTick_ = kNoTick;
    int base_ = 0, pos_ = -1, slot_ = 0, prevSlot_ = 0;
    bool stepHigh_ = false, resetHigh_ = false, wrapped_ = false;
    float t_ = 1.0f, glideFrom_ = 0.0f, lastOut_ = 0.0f;
    float amount_[kSwitchSteps] = {}, start_[kSwitchSteps] = {}, held_[kSwitchSteps] = {};
};

}  // namespace bleep::patch
