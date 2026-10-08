// SPDX-License-Identifier: MIT
// Segments core (specs/modules/segments.md): a chain of up to 8 segments
// (ramp, step or hold), each with its own time, level and curve, played as an
// envelope (gated, with a sustain point and a release part), a looping chain
// (an LFO of any shape) or anything in between. Every segment starts from the
// level the output has when it begins, so jumps and retriggers never click.
// Free-running with Sync and the transport playing, the chain is a function
// of the song position (seekable, renders repeat). Curves are Function's
// (dsp::curvePow).
#pragma once

#include "dsp/Slope.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kSegments = 8;

enum SegType : uint8_t { SegRamp = 0, SegStep, SegHold };
enum SegWait : uint8_t { WaitTime = 0, WaitGate, WaitTrigger };
enum SegIn : uint8_t { SegInAdvance = 0, SegInJump };

/// Per-segment choices (node data).
struct SegmentDef {
    uint8_t type = SegRamp;
    bool loop = false;
    uint8_t wait = WaitGate;   ///< Hold only
    uint8_t segIn = SegInAdvance;
    int sync = 11;             ///< index into dsp::noteValues() (1/4)
};
using SegmentTable = std::array<SegmentDef, kSegments>;

/// The chain a new module starts with: an ADSR (segments.md 4.6).
inline SegmentTable defaultSegments() {
    SegmentTable t{};
    t[2].type = SegHold;
    t[2].wait = WaitGate;
    return t;
}

struct SegmentsParams {
    float time[kSegments] = {0.005f, 0.3f, 0.25f, 0.4f, 0.25f, 0.25f, 0.25f, 0.25f};  ///< seconds
    float level[kSegments] = {1.0f, 0.7f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    float shape[kSegments] = {0.0f, 0.5f, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f};
    float timeScale = 1.0f;
    float velAmount = 0.0f;
    int count = 4;
    bool freeRun = false;   ///< Run = Free
    bool finish = false;    ///< Release = Finish
    bool sync = false;
};

struct SegmentsTime {
    bool running = false;
    bool started = false;
    double bpm = 120.0;
    double ppq = 0.0;
};

struct SegmentsFrame {
    float out = 0.0f;
    int segment = -1;  ///< running segment, −1 when idle or ended
    float loop = 0.0f, end = 0.0f, active = 0.0f;
};

class SegmentsDsp {
public:
    static constexpr double kMinSeconds = 0.0005;

    /// Sync values offered per segment: 8 bars … 1/64T (noteValues 1 … 24).
    static constexpr int kFirstSync = 1, kLastSync = dsp::kNumNoteValues - 1;
    static int clampSync(int i) noexcept { return std::clamp(i, kFirstSync, kLastSync); }

    /// Function's curve for a ramp from `a` to `b`: a falling ramp curves the
    /// distance travelled, so +1 is snappy (exponential) in both directions.
    static float ramp(float a, float b, double u, float shape) noexcept {
        const float s = std::clamp(shape, -1.0f, 1.0f);
        u = std::clamp(u, 0.0, 1.0);
        if (b >= a) return a + (b - a) * dsp::curvePow((float)u, s);
        return b + (a - b) * dsp::curvePow((float)(1.0 - u), s);
    }

    /// Loop region within Count: first and last segment with Loop on (−1: none).
    static void loopRange(const SegmentTable& d, int count, int& first, int& last) noexcept {
        first = last = -1;
        for (int i = 0; i < count; ++i)
            if (d[(size_t)i].loop) {
                if (first < 0) first = i;
                last = i;
            }
    }
    /// The sustain point: the last Hold that waits for the Gate, or else the
    /// end of the loop region (−1: none, a one-shot).
    static int sustainPoint(const SegmentTable& d, int count) noexcept {
        for (int i = count - 1; i >= 0; --i)
            if (d[(size_t)i].type == SegHold && d[(size_t)i].wait == WaitGate) return i;
        int first, last;
        loopRange(d, count, first, last);
        return last;
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        gate_.reset();
        for (auto& e : segIn_) e.reset();
        idx_ = -1;
        u_ = 0.0;
        elapsed_ = 0;
        start_ = out_ = 0.0f;
        peak_ = 1.0f;
        active_ = releasing_ = false;
        wasFree_ = false;
        locked_ = false;
        lockDropped_ = false;
        ppqStart_ = 0.0;
        pass_ = INT64_MIN;
    }

    int segment() const noexcept { return idx_; }
    double elapsedShare() const noexcept { return u_; }
    float level() const noexcept { return out_; }

    /// One sample. `segIns` are the Seg 1 … 8 trigger inputs, `velocity` the
    /// Velocity input (1 when unpatched).
    void tick(const SegmentsParams& p, const SegmentTable& d, float gateIn, float velocity, const float* segIns,
              const SegmentsTime& t, SegmentsFrame& f) noexcept {
        f.loop = f.end = 0.0f;
        const int count = std::clamp(p.count, 1, kSegments);
        int ls, le;
        loopRange(d, count, ls, le);
        const int sus = sustainPoint(d, count);
        const int edge = gate_.process(gateIn);
        const bool gateHigh = gate_.high();
        auto sampleVelocity = [&] {
            peak_ = 1.0f - std::clamp(p.velAmount, 0.0f, 1.0f) * (1.0f - std::clamp(velocity, 0.0f, 1.0f));
        };

        // Free run: starts on its own (also when switched to Free), again at
        // every transport start.
        if (p.freeRun && (!wasFree_ || t.started)) {
            sampleVelocity();
            begin(0, f);
            lockDropped_ = false;
            ppqStart_ = t.ppq;
            pass_ = INT64_MIN;
        }
        const bool lock = p.freeRun && p.sync && t.running && !lockDropped_;
        if (lock && !locked_) {  // the first locked sample counts from here
            ppqStart_ = t.ppq;
            pass_ = INT64_MIN;
        }
        locked_ = lock;
        wasFree_ = p.freeRun;

        // A lowered Count: playback past it goes to the release part (or ends).
        if (idx_ >= count) toRelease(sus, count, f);

        // Gate first, then the Seg inputs.
        if (edge > 0) {
            sampleVelocity();
            releasing_ = false;
            if (locked_) lockDropped_ = true, locked_ = false;
            begin(0, f);
        } else if (edge < 0 && !p.freeRun) {
            releasing_ = true;
            if (idx_ >= 0 && d[(size_t)idx_].type == SegHold && d[(size_t)idx_].wait == WaitTrigger) next(d, count, ls, le, p, f);
            else if (!p.finish && idx_ >= 0 && sus >= 0 && idx_ <= sus) toRelease(sus, count, f);
        }
        for (int n = 0; n < count; ++n) {
            if (segIn_[(size_t)n].process(segIns ? segIns[n] : 0.0f) <= 0) continue;
            if (locked_) lockDropped_ = true, locked_ = false;
            if (d[(size_t)n].segIn == SegInJump) {
                if (!active_) sampleVelocity();
                begin(n, f);
            } else if (idx_ == n) {
                next(d, count, ls, le, p, f);
            }
        }

        if (locked_) {
            playLocked(p, d, count, ls, le, t, f);
        } else if (idx_ >= 0) {
            const SegmentDef& s = d[(size_t)idx_];
            ++elapsed_;
            const double seconds = duration(p, s, idx_, t.bpm);
            u_ += 1.0 / (seconds * sampleRate_);
            bool done = false;
            if (s.type == SegHold && s.wait == WaitGate)
                done = (!gateHigh || releasing_) && (double)elapsed_ >= kMinSeconds * sampleRate_;
            else if (s.type == SegHold && s.wait == WaitTrigger)
                done = false;  // a Seg pulse (Advance) or the Gate's falling edge ends it
            else
                done = u_ >= 1.0;
            out_ = value(p, s, idx_, std::min(u_, 1.0), start_);
            if (done) next(d, count, ls, le, p, f);
        }
        f.out = out_;
        f.segment = idx_;
        f.active = active_ ? 1.0f : 0.0f;
    }

private:
    /// Length of segment i in seconds (Sync: its note value at the tempo).
    double duration(const SegmentsParams& p, const SegmentDef& s, int i, double bpm) const noexcept {
        if (p.sync) return std::max(kMinSeconds, dsp::beatsToSeconds(dsp::noteValueBeats(clampSync(s.sync)), bpm));
        return std::max(kMinSeconds, (double)p.time[i] * (double)std::max(p.timeScale, 0.0f));
    }
    float target(const SegmentsParams& p, int i) const noexcept { return std::clamp(p.level[i], -1.0f, 1.0f) * peak_; }

    float value(const SegmentsParams& p, const SegmentDef& s, int i, double u, float start) const noexcept {
        switch (s.type) {
            case SegHold: return start;
            case SegStep: {
                const float sh = p.shape[i];
                if (sh <= 0.0f) return target(p, i);
                return start + (target(p, i) - start) * (float)std::min(1.0, u / (double)sh);
            }
            default: return ramp(start, target(p, i), u, p.shape[i]);
        }
    }

    /// Starts segment i from the current level.
    void begin(int i, SegmentsFrame&) noexcept {
        idx_ = i;
        u_ = 0.0;
        elapsed_ = 0;
        start_ = out_;
        active_ = true;
    }
    /// The segment after the running one: back to the loop start (and Loop
    /// fires) unless releasing, else the next; past Count the chain ends.
    void next(const SegmentTable& d, int count, int ls, int le, const SegmentsParams& p, SegmentsFrame& f) noexcept {
        const bool loopOn = p.freeRun || !releasing_;
        if (idx_ == le && ls >= 0 && loopOn) {
            begin(ls, f);
            if (lonelyRamp(d, ls, le)) start_ = rampBase(p, d, ls);
            f.loop = 1.0f;
            return;
        }
        if (idx_ + 1 >= count) {
            finishChain(f);
            return;
        }
        begin(idx_ + 1, f);
    }
    /// A Ramp looping on its own would start each pass at its own level and
    /// stay flat; instead it restarts from the level before it (0 for the
    /// first segment): a saw.
    static bool lonelyRamp(const SegmentTable& d, int ls, int le) noexcept {
        return ls >= 0 && ls == le && d[(size_t)ls].type == SegRamp;
    }
    float rampBase(const SegmentsParams& p, const SegmentTable& d, int ls) const noexcept {
        for (int i = ls - 1; i >= 0; --i)
            if (d[(size_t)i].type != SegHold) return target(p, i);
        return 0.0f;
    }
    void toRelease(int sus, int count, SegmentsFrame& f) noexcept {
        if (sus >= 0 && sus + 1 < count) begin(sus + 1, f);
        else finishChain(f);
    }
    void finishChain(SegmentsFrame& f) noexcept {
        idx_ = -1;
        u_ = 0.0;
        active_ = false;
        f.end = 1.0f;
    }

    // ---- locked to the song (Run = Free, Sync, transport playing) ----------

    /// Where segment i starts in a locked chain: 0 for the first, the loop's
    /// end level for the loop start after its first pass, else the end level
    /// of the segment before.
    float lockedStart(const SegmentsParams& p, const SegmentTable& d, int i, int ls, int le, bool laterPass,
                      int depth = 0) const noexcept {
        if (depth > 2 * kSegments) return 0.0f;
        if (i == ls && laterPass && !lonelyRamp(d, ls, le)) return lockedEnd(p, d, le, ls, le, laterPass, depth + 1);
        if (i <= 0) return 0.0f;
        return lockedEnd(p, d, i - 1, ls, le, laterPass, depth + 1);
    }
    float lockedEnd(const SegmentsParams& p, const SegmentTable& d, int i, int ls, int le, bool laterPass,
                    int depth) const noexcept {
        if (d[(size_t)i].type != SegHold) return target(p, i);
        return lockedStart(p, d, i, ls, le, laterPass, depth + 1);
    }

    void playLocked(const SegmentsParams& p, const SegmentTable& d, int count, int ls, int le, const SegmentsTime& t,
                    SegmentsFrame& f) noexcept {
        auto beats = [&](int i) { return dsp::noteValueBeats(clampSync(d[(size_t)i].sync)); };
        const int introEnd = ls >= 0 ? ls : count;
        double introBeats = 0.0;
        for (int i = 0; i < introEnd; ++i) introBeats += beats(i);
        const double pos = std::max(0.0, t.ppq - ppqStart_);
        int idx = -1;
        double u = 0.0;
        bool later = false;
        int64_t pass = INT64_MIN;
        if (pos < introBeats) {
            double at = 0.0;
            for (int i = 0; i < introEnd; ++i) {
                if (pos < at + beats(i) || i == introEnd - 1) {
                    idx = i;
                    u = (pos - at) / beats(i);
                    break;
                }
                at += beats(i);
            }
        } else if (ls >= 0) {
            double loopBeats = 0.0;
            for (int i = ls; i <= le; ++i) loopBeats += beats(i);
            // The loop sits on the bar grid: its passes count from the start's bar.
            const double anchor = std::round(ppqStart_ / 4.0) * 4.0 + introBeats;
            const double lp = t.ppq - anchor;
            pass = (int64_t)std::floor(lp / loopBeats);
            double x = lp - (double)pass * loopBeats;
            const int64_t firstPass = (int64_t)std::floor((ppqStart_ + introBeats - anchor) / loopBeats);
            later = introEnd == 0 || pass != firstPass;
            for (int i = ls; i <= le; ++i) {
                if (x < beats(i) || i == le) {
                    idx = i;
                    u = std::min(x / beats(i), 1.0);
                    break;
                }
                x -= beats(i);
            }
        }
        if (pass_ != INT64_MIN && pass != INT64_MIN && pass > pass_) f.loop = 1.0f;
        pass_ = pass;
        if (idx < 0) {  // a one-shot chain past its end
            if (idx_ >= 0) finishChain(f);
            out_ = count > 0 ? lockedEnd(p, d, count - 1, ls, le, false, 0) : 0.0f;
            return;
        }
        const SegmentDef& s = d[(size_t)idx];
        idx_ = idx;
        u_ = u;
        elapsed_ = (int64_t)(u * beats(idx) * 60.0 / std::max(t.bpm, 1.0) * sampleRate_);
        active_ = true;
        start_ = lockedStart(p, d, idx, ls, le, later);
        out_ = value(p, s, idx, u, start_);
    }

    double sampleRate_ = 48000.0;
    dsp::GateEdge gate_;
    std::array<dsp::GateEdge, kSegments> segIn_;
    int idx_ = -1;
    double u_ = 0.0;
    int64_t elapsed_ = 0;
    float start_ = 0.0f, out_ = 0.0f, peak_ = 1.0f;
    bool active_ = false, releasing_ = false, wasFree_ = false;
    bool locked_ = false, lockDropped_ = false;
    double ppqStart_ = 0.0;
    int64_t pass_ = INT64_MIN;
};

}  // namespace bleep::patch
