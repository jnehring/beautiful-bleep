// SPDX-License-Identifier: GPL-3.0-only
// Logic core (doc/specs/modules/logic.md §4): boolean gates over A, B and an
// optional C, a toggle flip-flop and edge triggers, with a shared threshold
// and hysteresis.
#pragma once

#include <initializer_list>

#include <initializer_list>

namespace bleep::patch {

/// High above `threshold`, low again below `threshold − hysteresis`.
class Schmitt {
public:
    void reset() noexcept { high_ = false; }
    /// Returns true on a rising edge.
    bool process(float x, float threshold, float hysteresis) noexcept {
        const bool was = high_;
        if (high_) high_ = x >= threshold - hysteresis;
        else high_ = x >= threshold;
        return high_ && !was;
    }
    bool high() const noexcept { return high_; }

private:
    bool high_ = false;
};

struct LogicParams {
    float threshold = 0.5f;
    float hysteresis = 0.02f;
    bool flipFromA = false;  ///< Flip Source: A rising edge instead of the Flip jack
    bool cPatched = false;
};

struct LogicInputs {
    float a = 0.0f, b = 0.0f, c = 0.0f, flip = 0.0f, reset = 0.0f;
};

struct LogicFrame {
    float andOut = 0.0f, orOut = 0.0f, xorOut = 0.0f, nandOut = 0.0f, norOut = 0.0f, notA = 0.0f;
    float ff = 0.0f, rise = 0.0f, fall = 0.0f, change = 0.0f;
};

class LogicDsp {
public:
    void reset() noexcept {
        for (auto* s : {&a_, &b_, &c_, &flip_, &reset_}) s->reset();
        ff_ = false;
        first_ = true;
        and_ = or_ = xor_ = false;
    }

    void tick(const LogicInputs& in, const LogicParams& p, LogicFrame& f) noexcept {
        const bool wasA = a_.high();
        const bool riseA = a_.process(in.a, p.threshold, p.hysteresis);
        b_.process(in.b, p.threshold, p.hysteresis);
        c_.process(in.c, p.threshold, p.hysteresis);
        const bool flip = flip_.process(in.flip, p.threshold, p.hysteresis);
        const bool reset = reset_.process(in.reset, p.threshold, p.hysteresis);
        const bool a = a_.high(), b = b_.high(), c = c_.high();

        const bool all = a && b && (!p.cPatched || c);
        const bool any = a || b || (p.cPatched && c);
        const bool odd = (a != b) != (p.cPatched && c);

        if (reset) ff_ = false;
        else if (p.flipFromA ? riseA : flip) ff_ = !ff_;

        f.andOut = all ? 1.0f : 0.0f;
        f.orOut = any ? 1.0f : 0.0f;
        f.xorOut = odd ? 1.0f : 0.0f;
        f.nandOut = all ? 0.0f : 1.0f;
        f.norOut = any ? 0.0f : 1.0f;
        f.notA = a ? 0.0f : 1.0f;
        f.ff = ff_ ? 1.0f : 0.0f;
        f.rise = riseA ? 1.0f : 0.0f;
        f.fall = wasA && !a ? 1.0f : 0.0f;
        f.change = !first_ && (all != and_ || any != or_ || odd != xor_) ? 1.0f : 0.0f;
        and_ = all, or_ = any, xor_ = odd;
        first_ = false;
    }

private:
    Schmitt a_, b_, c_, flip_, reset_;
    bool ff_ = false, first_ = true, and_ = false, or_ = false, xor_ = false;
};

}  // namespace bleep::patch
