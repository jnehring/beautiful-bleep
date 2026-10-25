// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Index stepper: the whole-number step behind the Index node
// (doc/specs/modules/index.md). One step 0 … steps − 1 from a CV (equal bands
// with hysteresis), from Up/Down/Reset triggers or the transport, from
// one-hot gates or from binary-weighted gates; an Offset wraps it.
#pragma once

#include "dsp/SlotSelector.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::dsp {

constexpr int kMaxIndexSteps = 32;
constexpr int kMaxIndexGates = 8;

enum IndexMode { IndexCv = 0, IndexCount, IndexGates, IndexBinary };

struct IndexParams {
    int mode = IndexCv;
    int steps = 4;          ///< 2..32
    bool bipolar = false;   ///< CV mode: the input spans -1..+1
    int order = SlotForward;
    bool stop = false;      ///< Forward/Backward stop at the ends instead of wrapping
    int gates = 3;          ///< 1..8: how many gate inputs are in use
    int defaultStep = 0;    ///< Gates mode: the step while no gate is high
    uint32_t seed = 1;
    float offset = 0.0f;    ///< 0..1: floor(offset × steps) is added, wrapping
};

struct IndexClock {
    float in = 0.0f;                  ///< CV mode
    float up = 0.0f, down = 0.0f, reset = 0.0f;
    const float* gate = nullptr;      ///< kMaxIndexGates values or null
    bool transport = false;           ///< Up unpatched and a Rate set: follow the song
    bool playing = false;
    int64_t tick = 0;                 ///< floor(ppq / rate) while playing
};

class IndexStepper {
public:
    void reset() noexcept {
        base_ = 0;
        dir_ = 1;
        count_ = 0;
        slot_ = 0;
        step_ = -1;
        upHigh_ = downHigh_ = resetHigh_ = false;
        lastTick_ = kNoSlotTick;
    }

    /// One sample. Returns the step; `changed` is set when it moved.
    int tick(const IndexClock& clk, const IndexParams& p, bool& changed) noexcept {
        const int n = std::clamp(p.steps, 2, kMaxIndexSteps);
        int raw = 0;
        switch (p.mode) {
            case IndexCount: raw = counted(clk, p, n); break;
            case IndexGates: raw = gated(clk, p, n); break;
            case IndexBinary: raw = binary(clk, p, n); break;
            default: raw = cv(clk, p, n); break;
        }
        const int off = (int)std::floor(std::clamp(p.offset, 0.0f, 0.9999f) * (float)n);
        const int s = (raw + off) % n;
        changed = step_ >= 0 && s != step_;
        step_ = s;
        return s;
    }

    int step() const noexcept { return step_; }

private:
    static bool rising(float x, bool& high) noexcept {
        const bool h = x >= 0.5f, edge = h && !high;
        high = h;
        return edge;
    }

    int cv(const IndexClock& clk, const IndexParams& p, int n) noexcept {
        float u = clk.in;
        if (!(u == u)) u = p.bipolar ? -1.0f : 0.0f;  // NaN → step 0
        if (p.bipolar) u = (u + 1.0f) * 0.5f;
        const float sel = std::clamp(u, 0.0f, 0.9999f) * (float)n;
        if (sel < (float)slot_ - 0.02f || sel >= (float)(slot_ + 1) + 0.02f || slot_ >= n)
            slot_ = std::min((int)sel, n - 1);
        return slot_;
    }

    int counted(const IndexClock& clk, const IndexParams& p, int n) noexcept {
        const bool reset = rising(clk.reset, resetHigh_);
        const bool up = rising(clk.up, upHigh_);
        const bool down = rising(clk.down, downHigh_);
        const int first = p.order == SlotBackward ? n - 1 : 0;
        if (step_ < 0 || reset) {
            count_ = 0;
            dir_ = 1;
            base_ = first;
            lastTick_ = kNoSlotTick;
            if (step_ < 0 && clk.transport && clk.playing) {
                base_ = atTick(clk.tick, p, n);
                lastTick_ = clk.tick;
            }
        } else if (clk.transport) {
            if (clk.playing && clk.tick != lastTick_) {
                base_ = atTick(clk.tick, p, n);
                lastTick_ = clk.tick;
            }
        } else if (up || down) {
            // Down goes against the order for Forward/Backward; Ping-Pong and Random have no "against".
            const bool fwd = p.order == SlotBackward ? !up : up;
            move(p, n, p.order == SlotPingPong || p.order == SlotRandom ? true : fwd);
        }
        base_ = std::clamp(base_, 0, n - 1);
        return base_;
    }

    void move(const IndexParams& p, int n, bool forward) noexcept {
        ++count_;
        switch (p.order) {
            case SlotPingPong:
                if (base_ + dir_ < 0 || base_ + dir_ >= n) dir_ = -dir_;
                base_ += dir_;
                break;
            case SlotRandom: base_ = SlotSelector::randomMove(n, base_ % n, count_, p.seed); break;
            default: {
                const int d = forward ? 1 : -1;
                const int next = base_ + d;
                if (next < 0 || next >= n) base_ = p.stop ? base_ : (next + n) % n;
                else base_ = next;
                break;
            }
        }
    }

    int gated(const IndexClock& clk, const IndexParams& p, int n) const noexcept {
        const int k = std::clamp(p.gates, 1, kMaxIndexGates);
        if (clk.gate)
            for (int j = std::min(k, kMaxIndexGates) - 1; j >= 0; --j)
                if (j < n && clk.gate[j] >= 0.5f) return j;
        return std::clamp(p.defaultStep, 0, n - 1);
    }

    int binary(const IndexClock& clk, const IndexParams& p, int n) const noexcept {
        const int k = std::clamp(p.gates, 1, kMaxIndexGates);
        int sum = 0;
        if (clk.gate)
            for (int j = 0; j < k; ++j)
                if (clk.gate[j] >= 0.5f) sum += 1 << j;
        return std::min(sum, n - 1);
    }

    static int atTick(int64_t k, const IndexParams& p, int n) noexcept {
        if (p.order != SlotRandom) return SlotSelector::stepAt(p.order, n, k);
        int b = 0;
        for (int64_t j = std::max<int64_t>(1, k - 64); j <= k; ++j) b = SlotSelector::randomMove(n, b, j, p.seed);
        return b;
    }

    int64_t count_ = 0, lastTick_ = kNoSlotTick;
    int base_ = 0, dir_ = 1, slot_ = 0, step_ = -1;
    bool upHigh_ = false, downHigh_ = false, resetHigh_ = false;
};

}  // namespace bleep::dsp
