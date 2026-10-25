// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Slot selector: the one position behind Select and Route
// (doc/specs/modules/select.md, route.md). Up to 8 slots; the active slot
// moves on Next triggers or the transport, is offset by Select, and jumps to
// slot k on a Trig k trigger. Every change fades from the current mix, so an
// interrupted fade never jumps; the per-slot gains always come from amounts
// that add up to 1.
#pragma once

#include "dsp/Random.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace bleep::dsp {

constexpr int kMaxSlots = 8;
constexpr int64_t kNoSlotTick = std::numeric_limits<int64_t>::min();

enum SlotOrder { SlotForward = 0, SlotBackward, SlotPingPong, SlotRandom };
enum SlotCurve { SlotEqualPower = 0, SlotLinear };

struct SlotParams {
    int slots = 4;        ///< 2..8
    int order = SlotForward;
    int curve = SlotEqualPower;
    float select = 0.0f;  ///< 0..1: offset of floor(select × slots) slots
    float fade = 0.002f;  ///< seconds
    uint32_t seed = 1;
};

/// What moves the position this sample.
struct SlotClock {
    float next = 0.0f, reset = 0.0f;  ///< trigger inputs
    const float* trig = nullptr;      ///< per-slot triggers (kMaxSlots values) or null
    int trigs = 0;                    ///< how many of them are in use
    bool transport = false;           ///< Next unpatched and a Rate set: follow the song
    bool playing = false;
    int64_t tick = 0;                 ///< floor(ppq / rate) while playing
};

struct SlotFrame {
    float gain[kMaxSlots] = {};  ///< per-slot gain (sums to 1 with the linear curve)
    bool changed = false;        ///< the position changed this sample
};

class SlotSelector {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        base_ = 0;
        dir_ = 1;
        count_ = 0;
        pos_ = -1;
        slot_ = 0;
        nextHigh_ = resetHigh_ = false;
        for (bool& h : trigHigh_) h = false;
        lastTick_ = kNoSlotTick;
        t_ = 1.0f;
        for (int k = 0; k < kMaxSlots; ++k) amount_[k] = start_[k] = 0.0f;
    }

    /// The slot after `count` steps for the stateless orders (Random needs the previous one: see randomMove()).
    static int stepAt(int order, int slots, int64_t count) noexcept {
        const int n = std::max(1, slots);
        switch (order) {
            case SlotBackward: return n - 1 - (int)(((count % n) + n) % n);
            case SlotPingPong: {
                if (n <= 2) return (int)(((count % n) + n) % n);
                const int64_t period = 2 * (n - 1);
                const int k = (int)(((count % period) + period) % period);
                return k < n ? k : (int)period - k;
            }
            default: return (int)(((count % n) + n) % n);
        }
    }

    /// A random move from `prev` at counter k: never the same slot twice.
    static int randomMove(int slots, int prev, int64_t k, uint32_t seed) noexcept {
        const int n = std::max(1, slots);
        if (n == 1) return 0;
        const int r = (int)(uniform01(seed, (uint64_t)k, 0) * (n - 1));
        return r >= prev ? r + 1 : r;
    }

    void tick(const SlotClock& clk, const SlotParams& p, SlotFrame& f) noexcept {
        const int n = std::clamp(p.slots, 2, kMaxSlots);
        const bool reset = rising(clk.reset, resetHigh_);
        const bool next = rising(clk.next, nextHigh_);
        int trig = -1;
        for (int k = 0; k < kMaxSlots; ++k) {
            const bool edge = k < clk.trigs && clk.trig && rising(clk.trig[k], trigHigh_[k]);
            if (edge && k < n) trig = k;
        }

        // ---- the position: Reset wins over Next, a Trig k wins over both
        if (pos_ < 0 || reset) {
            count_ = 0;
            dir_ = 1;
            base_ = p.order == SlotBackward ? n - 1 : 0;
            lastTick_ = kNoSlotTick;
            if (pos_ < 0 && clk.transport && clk.playing) {  // the first sample already follows the song
                base_ = atTick(clk.tick, p, n);
                lastTick_ = clk.tick;
            }
        } else if (clk.transport) {
            if (clk.playing && clk.tick != lastTick_) {
                base_ = atTick(clk.tick, p, n);
                lastTick_ = clk.tick;
            }
        } else if (next) {
            advance(p, n);
        }

        // ---- Select offsets the position, with 2 % of a slot of hysteresis
        const float sel = std::clamp(p.select, 0.0f, 0.9999f) * (float)n;
        if (sel < (float)slot_ - 0.02f || sel >= (float)(slot_ + 1) + 0.02f || slot_ >= n)
            slot_ = std::min((int)sel, n - 1);
        if (trig >= 0) base_ = ((trig - slot_) % n + n) % n;  // so the position is the triggered slot
        const int pos = (base_ % n + slot_) % n;

        f.changed = false;
        if (pos_ < 0) {  // first sample: no fade
            pos_ = pos;
            for (int k = 0; k < kMaxSlots; ++k) amount_[k] = start_[k] = k == pos ? 1.0f : 0.0f;
            t_ = 1.0f;
        } else if (pos != pos_) {
            for (int k = 0; k < kMaxSlots; ++k) start_[k] = amount_[k];
            pos_ = pos;
            t_ = p.fade > 0.0f ? 0.0f : 1.0f;
            f.changed = true;
        }

        // ---- fade progress: every slot's amount moves linearly; the amounts sum to 1
        if (t_ < 1.0f) t_ = std::min(1.0f, t_ + (float)(1.0 / (std::max(p.fade, 1e-5f) * sampleRate_)));
        for (int k = 0; k < kMaxSlots; ++k)
            amount_[k] = k == pos_ ? start_[k] + (1.0f - start_[k]) * t_ : start_[k] * (1.0f - t_);
        if (t_ >= 1.0f)
            for (int k = 0; k < kMaxSlots; ++k) start_[k] = amount_[k];
        for (int k = 0; k < kMaxSlots; ++k) f.gain[k] = curve(amount_[k], p.curve);
    }

    /// The active slot (0-based); -1 before the first sample.
    int position() const noexcept { return pos_; }

private:
    static bool rising(float x, bool& high) noexcept {
        const bool h = x >= 0.5f, edge = h && !high;
        high = h;
        return edge;
    }
    static float curve(float amount, int c) noexcept {
        return c == SlotLinear ? amount : std::sin(amount * 1.57079632679489662f);
    }

    void advance(const SlotParams& p, int n) noexcept {
        ++count_;
        switch (p.order) {
            case SlotBackward: base_ = (base_ + n - 1) % n; break;
            case SlotPingPong: {
                if (n <= 2) { base_ = (base_ + 1) % n; break; }
                if (base_ + dir_ < 0 || base_ + dir_ >= n) dir_ = -dir_;
                base_ += dir_;
                break;
            }
            case SlotRandom: base_ = randomMove(n, base_ % n, count_, p.seed); break;
            default: base_ = (base_ + 1) % n; break;
        }
    }

    /// The position for transport tick k, a pure function of k (Random: rebuilt from the last 64 moves).
    static int atTick(int64_t k, const SlotParams& p, int n) noexcept {
        if (p.order != SlotRandom) return stepAt(p.order, n, k);
        int b = 0;
        for (int64_t j = std::max<int64_t>(1, k - 64); j <= k; ++j) b = randomMove(n, b, j, p.seed);
        return b;
    }

    double sampleRate_ = 48000.0;
    int64_t count_ = 0, lastTick_ = kNoSlotTick;
    int base_ = 0, dir_ = 1, pos_ = -1, slot_ = 0;
    bool nextHigh_ = false, resetHigh_ = false, trigHigh_[kMaxSlots] = {};
    float t_ = 1.0f;
    float amount_[kMaxSlots] = {}, start_[kMaxSlots] = {};
};

}  // namespace bleep::dsp
