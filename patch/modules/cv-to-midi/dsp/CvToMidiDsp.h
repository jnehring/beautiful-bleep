// SPDX-License-Identifier: MIT
// CV to MIDI core (doc/specs/modules/cv-to-midi.md): one lane turns a control
// signal into 7 or 14 bit controller values, sending only when the quantised
// value changes and never faster than the rate limit.
#pragma once

#include <algorithm>
#include <cmath>

namespace bleep::patch {

constexpr int kCvToMidiLanes = 4;

struct CvToMidiLaneParams {
    int cc = 1;               ///< controller 0..127
    int minData = 0;          ///< data range the CV maps onto, 0..127
    int maxData = 127;
    bool bipolar = false;     ///< input −1…+1 instead of 0…1
    bool hires = false;       ///< 14 bit: MSB on cc, LSB on cc + 32 (controllers 0..31 only)
    int minGapSamples = 0;    ///< rate limit: samples between two sends
};

/// Up to two messages per tick (MSB, then LSB).
struct CvToMidiMessages {
    int count = 0;
    int cc[2] = {};
    int data[2] = {};         ///< 0..127
};

class CvToMidiLane {
public:
    void reset() noexcept {
        last_ = -1;
        gap_ = 1 << 30;
    }
    /// The last value sent (7 or 14 bit as quantised), -1 before the first one.
    int last() const noexcept { return last_; }
    /// Sends the current value again at the next tick.
    void resend() noexcept { last_ = -1; }

    /// The quantised value for `cv`: 0..127, or 0..16383 when `hires`.
    static int quantise(float cv, const CvToMidiLaneParams& p) noexcept {
        float u = p.bipolar ? (cv + 1.0f) * 0.5f : cv;
        if (!(u > 0.0f)) u = 0.0f;  // also catches NaN
        u = std::min(u, 1.0f);
        const int lo = std::min(p.minData, p.maxData), hi = std::max(p.minData, p.maxData);
        const float data = p.minData <= p.maxData ? lo + u * (float)(hi - lo) : hi - u * (float)(hi - lo);
        return hires(p) ? (int)std::lround(data * (16383.0f / 127.0f)) : (int)std::lround(data);
    }

    void tick(float cv, const CvToMidiLaneParams& p, CvToMidiMessages& out) noexcept {
        out.count = 0;
        if (gap_ < (1 << 30)) ++gap_;
        const int v = quantise(cv, p);
        if (v == last_ || gap_ < p.minGapSamples) return;
        last_ = v;
        gap_ = 0;
        const int cc = std::clamp(p.cc, 0, 127);
        if (hires(p)) {
            out.cc[0] = cc;
            out.data[0] = v >> 7;
            out.cc[1] = cc + 32;
            out.data[1] = v & 127;
            out.count = 2;
        } else {
            out.cc[0] = cc;
            out.data[0] = v;
            out.count = 1;
        }
    }

private:
    static bool hires(const CvToMidiLaneParams& p) noexcept { return p.hires && p.cc < 32; }

    int last_ = -1;
    int gap_ = 1 << 30;  // the first value goes out at once
};

}  // namespace bleep::patch
