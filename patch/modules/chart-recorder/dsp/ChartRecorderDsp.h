// SPDX-License-Identifier: GPL-3.0-only
// Chart Recorder (doc/specs/modules/chart-recorder.md): a sprung pen draws the
// input onto a looping strip of paper and a replay head plays the strip back
// as modulation.
//
//   In → gain → detector (DC, Rectified, RMS, Peak, Log dB) → pen target
//   pen: mass, spring, damper, velocity limit, stiction, end stops (4.2)
//   write head p (Free or song position) writes the pen into int16 points
//   replay head r (Free or song position) + Offset reads them back (4.4, 4.5)
//
// The strip is a fixed array of atomics, so the message thread can read it
// (snapshots for the node data, ink for the view) while the audio thread
// writes. Everything is deterministic: the same input draws the same line.
#pragma once

#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <bit>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bleep::patch {

constexpr int kChartMaxPoints = 24000;
constexpr int kChartMinPoints = 16;
constexpr int kChartMaxMarks = 256;
constexpr int16_t kChartBlank = -32768;          ///< a point with no ink
constexpr double kChartPointsPerSecond = 200.0;
constexpr int kChartDefaultPoints = 1600;         ///< 4 bars at 120 BPM
constexpr double kChartStop = 1.05;               ///< the pen's end stops, paper units
constexpr int kChartInkRing = 4096;               ///< written point indices the view has not read

/// Leading zero count of a non-zero 64-bit word.
inline int chartClz64(uint64_t v) noexcept { return std::countl_zero(v); }

inline const std::array<double, 9>& chartFreeLengths() {
    static const std::array<double, 9> a{1, 2, 5, 10, 30, 60, 120, 300, 600};
    return a;
}
inline const std::array<int, 7>& chartBarLengths() {
    static const std::array<int, 7> a{1, 2, 4, 8, 16, 32, 64};
    return a;
}
inline const std::array<float, 4>& chartLogRanges() {
    static const std::array<float, 4> a{10.0f, 25.0f, 50.0f, 75.0f};
    return a;
}

/// Points for a strip of `seconds` (200 per second, at most 24,000).
inline int chartPointsFor(double seconds) noexcept {
    if (!(seconds > 0.0) || !std::isfinite(seconds)) return kChartDefaultPoints;
    return (int)std::clamp(std::lround(seconds * kChartPointsPerSecond), (long)kChartMinPoints, (long)kChartMaxPoints);
}
/// Paper units (−1 … +1) ↔ int16 points.
inline int16_t chartQuantise(double u) noexcept { return (int16_t)std::lround(std::clamp(u, -1.0, 1.0) * 32767.0); }
inline double chartUnits(int16_t s) noexcept { return (double)s / 32767.0; }

// ---- saved state (6): base64 of little-endian int16, marks ------------------

inline std::string chartEncodePcm16(const int16_t* points, int n) {
    static const char* abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const size_t bytes = (size_t)std::max(n, 0) * 2;
    auto byte = [&](size_t i) -> uint32_t {
        const auto s = (uint16_t)points[i >> 1];
        return (i & 1) ? (uint32_t)(s >> 8) : (uint32_t)(s & 0xff);
    };
    std::string out;
    out.reserve((bytes + 2) / 3 * 4);
    for (size_t i = 0; i < bytes; i += 3) {
        uint32_t b = byte(i) << 16;
        if (i + 1 < bytes) b |= byte(i + 1) << 8;
        if (i + 2 < bytes) b |= byte(i + 2);
        out += abc[(b >> 18) & 63];
        out += abc[(b >> 12) & 63];
        out += i + 1 < bytes ? abc[(b >> 6) & 63] : '=';
        out += i + 2 < bytes ? abc[b & 63] : '=';
    }
    return out;
}

/// Decodes `n` points; a short or broken string is padded with blank
/// (decoding stops at the first character that is not base64), a long one is
/// truncated.
inline std::vector<int16_t> chartDecodePcm16(const std::string& s, int n) {
    std::vector<int16_t> out((size_t)std::max(n, 0), kChartBlank);
    auto sextet = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
    };
    uint32_t acc = 0;
    int bits = 0;
    size_t index = 0;
    uint32_t lo = 0;
    for (char c : s) {
        const int v = sextet(c);
        if (v < 0) break;
        acc = ((acc << 6) | (uint32_t)v) & 0xffffff;
        bits += 6;
        if (bits < 8) continue;
        bits -= 8;
        const uint32_t b = (acc >> bits) & 0xff;
        if (index & 1) {
            if ((index >> 1) >= out.size()) break;
            out[index >> 1] = (int16_t)(uint16_t)(lo | (b << 8));
        } else {
            lo = b;
        }
        ++index;
    }
    return out;
}

/// Marks in range, integral and unique, the newest 256 (the list is oldest first).
inline std::vector<int> chartSanitiseMarks(const std::vector<double>& raw, int n) {
    std::vector<int> out;
    for (double m : raw) {
        if (!std::isfinite(m) || m < 0.0 || m >= (double)n || std::floor(m) < m) continue;
        const int k = (int)m;
        if (std::find(out.begin(), out.end(), k) == out.end()) out.push_back(k);
    }
    if (out.size() > (size_t)kChartMaxMarks) out.erase(out.begin(), out.end() - kChartMaxMarks);
    return out;
}

/// A strip as saved in the node data.
struct ChartStripData {
    int n = kChartDefaultPoints;
    std::vector<int16_t> points;  ///< n points
    std::vector<int> marks;
};

/// The checks of sanitiseData without the JSON: `n` (NaN when missing), the
/// base64 points and the raw marks. A missing or broken n is taken from the
/// points, or the default.
inline ChartStripData chartSanitise(double n, const std::string& pcm16, const std::vector<double>& marks) {
    ChartStripData d;
    if (std::isfinite(n) && n >= 1.0) d.n = (int)std::clamp(std::lround(n), (long)kChartMinPoints, (long)kChartMaxPoints);
    else if (!pcm16.empty()) {
        size_t chars = 0;  // the base64 prefix, without padding
        while (chars < pcm16.size() && (std::isalnum((unsigned char)pcm16[chars]) || pcm16[chars] == '+' || pcm16[chars] == '/'))
            ++chars;
        d.n = std::clamp((int)(chars * 6 / 16), kChartMinPoints, kChartMaxPoints);
    }
    d.points = chartDecodePcm16(pcm16, d.n);
    d.marks = chartSanitiseMarks(marks, d.n);
    return d;
}

/// Point j of a strip resampled from nOld to nNew points (point centres onto
/// point centres): linear between two inked neighbours, the nearest point
/// next to a blank one.
inline int16_t chartResamplePoint(const int16_t* src, int nOld, int nNew, int j) noexcept {
    const double x = std::clamp(((double)j + 0.5) * (double)nOld / (double)nNew - 0.5, 0.0, (double)(nOld - 1));
    const int i0 = (int)x, i1 = std::min(i0 + 1, nOld - 1);
    const double f = x - (double)i0;
    const int16_t a = src[i0], b = src[i1];
    if (a == kChartBlank || b == kChartBlank) return f < 0.5 ? a : b;
    return (int16_t)std::lround((double)a + ((double)b - (double)a) * f);
}
inline void chartResample(const int16_t* src, int nOld, int16_t* dst, int nNew) noexcept {
    for (int j = 0; j < nNew; ++j) dst[j] = chartResamplePoint(src, nOld, nNew, j);
}
inline int chartResampleIndex(int k, int nOld, int nNew) noexcept {
    return std::clamp((int)(((double)k + 0.5) * (double)nNew / (double)nOld), 0, nNew - 1);
}

// ---- detector (4.1) ----------------------------------------------------------

class ChartDetector {
public:
    enum Mode { Dc, Rectified, Rms, Peak, LogDb };

    static bool unipolar(int mode) noexcept { return mode != Dc; }
    /// Detector value → pen target: the paper is −1 … +1.
    static double target(double y, int mode) noexcept { return unipolar(mode) ? 2.0 * y - 1.0 : y; }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        average_.reset();
        peak_.reset();
        release_ = -1.0f;
    }

    /// x after Gain → y: DC −1 … +1, Rectified / RMS / Peak ≥ 0, Log 0 … 1.
    double process(double x, int mode, float response, float logRange) noexcept {
        switch (mode) {
            case Rectified: return average_.process((float)std::fabs(x), response, sampleRate_);
            case Rms: return std::sqrt(std::max(0.0f, average_.process((float)(x * x), response, sampleRate_)));
            case Peak:
                if (response < release_ || response > release_) {
                    // Instant attack (an attack time of 1 ns is a coefficient of 0).
                    peak_.prepare(sampleRate_, 1e-9f, response);
                    release_ = response;
                }
                return peak_.process((float)x);
            case LogDb: {
                const double ms = average_.process((float)(x * x), response, sampleRate_);
                const double db = 10.0 * std::log10(std::max(ms, 1e-20));
                const double range = std::max(1.0f, logRange);
                return std::clamp((db + range) / range, 0.0, 1.0);
            }
            default: return std::clamp(x, -1.0, 1.0);
        }
    }

private:
    double sampleRate_ = 48000.0;
    dsp::OnePole average_;          // |x| or x², by mode
    dsp::EnvelopeFollower peak_;
    float release_ = -1.0f;
};

// ---- pen (4.2) -----------------------------------------------------------------

/// A mass on a spring with a damper, a velocity limit, stiction and end stops,
/// in paper units (2 = full width), semi-implicit Euler in double precision.
class ChartPen {
public:
    void reset(double u = 0.0) noexcept {
        u_ = u;
        v_ = 0.0;
    }
    /// Writing Speed in mm/s (1 … 1000), Damping and Friction 0 … 1.
    void setParams(float writingSpeed, float damping, float friction) noexcept {
        if (writingSpeed < speed_ || writingSpeed > speed_) {
            speed_ = writingSpeed;
            const double w = 2.0 * 3.14159265358979323846 * (double)writingSpeed / 20.0;
            w2_ = w * w;
            omega_ = w;
            vmax_ = (double)writingSpeed / 50.0;
            damping_ = -1.0f;  // ζω changed
        }
        if (damping < damping_ || damping > damping_) {
            damping_ = damping;
            c_ = 2.0 * 0.05 * std::pow(40.0, std::clamp((double)damping, 0.0, 1.0)) * omega_;
        }
        // |ω²(t − u)| < Friction · 0.08 · ω²  ⇔  |t − u| < 0.08 · Friction
        stick_ = 0.08 * std::clamp((double)friction, 0.0, 1.0);
    }

    double tick(double target, double sampleRate) noexcept {
        const double e = target - u_;
        double f = w2_ * e - c_ * v_;
        if (std::fabs(v_) < 1e-4 && std::fabs(e) < stick_) {
            v_ = 0.0;
            f = 0.0;
        }
        v_ = std::clamp(v_ + f / sampleRate, -vmax_, vmax_);
        u_ += v_ / sampleRate;
        if (u_ > kChartStop) {
            u_ = kChartStop;
            if (v_ > 0.0) v_ = -0.3 * v_;
        } else if (u_ < -kChartStop) {
            u_ = -kChartStop;
            if (v_ < 0.0) v_ = -0.3 * v_;
        }
        return u_;
    }

    double position() const noexcept { return u_; }
    double velocity() const noexcept { return v_; }
    double maxVelocity() const noexcept { return vmax_; }

private:
    double u_ = 0.0, v_ = 0.0;
    double w2_ = 0.0, omega_ = 0.0, c_ = 0.0, vmax_ = 0.0, stick_ = 0.0;
    float speed_ = -1.0f, damping_ = -1.0f;
};

// ---- the recorder ----------------------------------------------------------------

struct ChartParams {
    float gainDb = 0.0f;
    float response = 0.05f;      ///< seconds
    float writingSpeed = 100.0f; ///< mm/s
    float damping = 0.7f;
    float friction = 0.0f;
    float paperSpeed = 1.0f;     ///< Free paper, × of Length
    float replaySpeed = 1.0f;
    float offset = 0.0f;
    int detector = ChartDetector::Dc;
    float logRange = 50.0f;
    int paper = 1;               ///< 0 Free, 1 Transport
    double lengthSeconds = 10.0; ///< Length (Free)
    int bars = 4;                ///< Length (Transport)
    int record = 1;              ///< 0 Always, 1 Gate, 2 Armed
    int replaySync = 1;          ///< 0 Free, 1 Song
    int interp = 1;              ///< 0 Step, 1 Linear, 2 Smooth
};

/// One sample of input.
struct ChartInput {
    float in = 0.0f, record = 0.0f, mark = 0.0f, hold = 0.0f, clear = 0.0f, reset = 0.0f;
    bool arm = false;       ///< the Arm button, this sample
    bool playing = false;   ///< transport playing with a valid position
    double ppq = 0.0;
    double bpm = 120.0;
    bool canWrite = true;   ///< false for voices > 0 inside a Voice Cell
};

struct ChartFrame {
    float pen = 0.0f, replay = 0.0f, marker = 0.0f, position = 0.0f;
};

class ChartRecorderDsp {
public:
    enum RecState { Idle, Armed, Writing, Done };
    enum Paper { FreePaper, TransportPaper };
    enum Record { Always, Gate, ArmedPass };
    enum Interp { Step, Linear, Smooth };

    ChartRecorderDsp()
        : points_(new std::atomic<int16_t>[kChartMaxPoints]), scratch_(new int16_t[kChartMaxPoints]) {
        for (int i = 0; i < kChartMaxPoints; ++i) points_[(size_t)i].store(kChartBlank, std::memory_order_relaxed);
        for (auto& m : marks_) m.store(0, std::memory_order_relaxed);
        for (auto& k : ink_) k.store(0, std::memory_order_relaxed);
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        detector_.prepare(sampleRate);
        reset();
    }

    /// Heads, pen and detector; the strip stays.
    void reset() noexcept {
        detector_.reset();
        pen_.reset();
        p_ = r_ = 0.0;
        state_ = Idle;
        curK_ = -1;
        sum_ = 0.0;
        count_ = 0;
        prevQ_ = -1;
        sinceInk_ = writtenSamples_ = 0;
        wasWriting_ = false;
        recordEdge_.reset();
        markEdge_.reset();
        clearEdge_.reset();
        resetEdge_.reset();
    }

    /// Block rate, before tick(): sizes the strip from Length (4.3). A change
    /// of Paper or Length resamples it; a blank strip follows the tempo too
    /// (nothing to stretch), an inked one keeps its size when the tempo moves.
    void configure(const ChartParams& p, double bpm) noexcept {
        const int key = p.paper == TransportPaper ? 1000 + p.bars : (int)std::lround(p.lengthSeconds);
        const int want = chartPointsFor(stripSeconds(p, bpm));
        if (key != sizeKey_) {
            const bool first = sizeKey_ < 0;
            sizeKey_ = key;
            if (!first && want != n()) resize(want);
        }
        if (inked_ == 0 && want != n()) resize(want);
    }

    /// [audio thread] Replaces the strip (node data from the message thread).
    void load(const ChartStripData& d) noexcept {
        finishPoint();
        const int n = std::clamp(d.n, kChartMinPoints, kChartMaxPoints);
        for (int k = 0; k < n; ++k)
            points_[(size_t)k].store(k < (int)d.points.size() ? d.points[(size_t)k] : kChartBlank, std::memory_order_relaxed);
        n_.store(n, std::memory_order_relaxed);
        rebuildInk();
        int count = 0;
        for (int m : d.marks)
            if (m >= 0 && m < n && count < kChartMaxMarks) marks_[(size_t)count++].store(m, std::memory_order_relaxed);
        markCount_.store(count, std::memory_order_relaxed);
        rebuildMarkBits();
        prevQ_ = -1;
        fullWanted_.store(true, std::memory_order_release);
    }

    /// Wipes the strip and its marks.
    void clear() noexcept {
        finishPoint();
        for (int k = 0; k < n(); ++k) points_[(size_t)k].store(kChartBlank, std::memory_order_relaxed);
        rebuildInk();
        markCount_.store(0, std::memory_order_relaxed);
        rebuildMarkBits();
        snapshotWanted_.store(true, std::memory_order_release);
        fullWanted_.store(true, std::memory_order_release);
    }

    void tick(const ChartParams& p, const ChartInput& in, ChartFrame& out) noexcept {
        out.marker = 0.0f;
        const double fs = sampleRate_;
        const bool clearEdge = clearEdge_.process(in.clear) > 0;
        const bool resetEdge = resetEdge_.process(in.reset) > 0;
        const bool markEdge = markEdge_.process(in.mark) > 0;
        const bool recordRise = recordEdge_.process(in.record) > 0;
        const bool held = in.hold >= 0.5f;
        if (clearEdge && in.canWrite) clear();

        // Detector and pen (4.1, 4.2)
        if (p.gainDb < gainDb_ || p.gainDb > gainDb_) {
            gainDb_ = p.gainDb;
            gain_ = std::pow(10.0, (double)p.gainDb / 20.0);
        }
        const double y = detector_.process((double)in.in * gain_, p.detector, p.response, p.logRange);
        // Unipolar detectors are unbounded above: past ±1.5 the pen only bangs harder into the stop.
        const double t = std::clamp(ChartDetector::target(y, p.detector), -1.5, 1.5);
        pen_.setParams(p.writingSpeed, p.damping, p.friction);
        const double u = pen_.tick(t, fs);

        // Paper (4.3)
        const double pPrev = p_;
        const double length = stripSeconds(p, in.bpm);
        bool live = true;
        if (p.paper == TransportPaper) {
            live = in.playing;
            if (live && !held) p_ = dsp::wrap01(in.ppq / (4.0 * std::max(1, p.bars)));
        } else if (!held) {
            p_ = dsp::wrap01(p_ + (double)p.paperSpeed / (std::max(length, 1e-3) * fs));
        }
        const bool wrapped = live && !held && p_ < pPrev - 0.5;

        // Record modes
        if (p.record != recordMode_) {
            recordMode_ = p.record;
            state_ = Idle;
        }
        bool passEnded = false, writing = false;
        if (p.record == ArmedPass) {
            if ((recordRise || in.arm) && state_ != Writing) state_ = Armed;
            if (wrapped) {
                if (state_ == Writing) {
                    state_ = Done;
                    passEnded = true;
                } else if (state_ == Armed) {
                    state_ = Writing;
                }
            }
            writing = state_ == Writing && live;
        } else {
            writing = live && (p.record == Always || in.record >= 0.5f);
            state_ = writing ? Writing : Idle;
        }
        if (!in.canWrite) writing = false;

        const int n = this->n();
        const int k = std::min(n - 1, (int)(p_ * n));
        if (writing) {
            if (k != curK_) {
                finishPoint();
                curK_ = k;
                sum_ = 0.0;
                count_ = 0;
            }
            sum_ += u;
            ++count_;
            setPoint(k, chartQuantise(sum_ / (double)count_));
            if (++sinceInk_ >= 2048) {  // held paper: keep the view up to date
                pushInk(k);
                sinceInk_ = 0;
            }
            if (++writtenSamples_ >= (int64_t)(5.0 * fs)) {
                writtenSamples_ = 0;
                passEnded = true;
            }
            if (wrapped) passEnded = true;
        } else {
            finishPoint();
        }
        if ((wasWriting_ && !writing) || passEnded) snapshotWanted_.store(true, std::memory_order_release);
        wasWriting_ = writing;
        if (markEdge && in.canWrite) addMark(k);

        // Replay head (4.4)
        if (p.replaySync == 0) {
            if (resetEdge) r_ = 0.0;
            else r_ = dsp::wrap01(r_ + (double)p.replaySpeed / (std::max(length, 1e-3) * fs));
        } else if (in.playing) {
            const double beats = p.paper == TransportPaper ? 4.0 * std::max(1, p.bars)
                                                           : p.lengthSeconds * std::max(in.bpm, 1.0) / 60.0;
            r_ = dsp::wrap01((double)p.replaySpeed * in.ppq / beats);
        }
        const double q = dsp::wrap01(r_ + (double)p.offset);

        // Reading (4.5) and marks
        const double v = std::clamp(read(q, p.interp), -1.0, 1.0);
        const bool uni = ChartDetector::unipolar(p.detector);
        const double pen = std::clamp(u, -1.0, 1.0);
        out.pen = (float)(uni ? 0.5 * (pen + 1.0) : pen);
        out.replay = (float)(uni ? 0.5 * (v + 1.0) : v);
        out.position = (float)q;
        const int kq = std::min(n - 1, (int)(q * n));
        if (prevQ_ >= 0 && kq != prevQ_ && crossesMark(prevQ_, kq)) out.marker = 1.0f;
        prevQ_ = kq;
        q_ = q;
    }

    /// The strip at read position q (0 … 1), in paper units.
    double read(double q, int interp) const noexcept {
        if (inked_ == 0) return 0.0;
        const int n = this->n();
        const double x = std::clamp(q, 0.0, 1.0) * n;
        const int i0 = std::min(n - 1, (int)x);
        const double f = x - (double)i0;
        auto at = [&](int i) { return chartUnits(points_[(size_t)(prevInk(((i % n) + n) % n))].load(std::memory_order_relaxed)); };
        if (interp == Step) return at(i0);
        if (interp == Linear) {
            const double a = at(i0), b = at(i0 + 1);
            return a + (b - a) * f;
        }
        // 4-point cubic Hermite (Catmull-Rom)
        const double ym = at(i0 - 1), y0 = at(i0), y1 = at(i0 + 1), y2 = at(i0 + 2);
        const double c1 = 0.5 * (y1 - ym);
        const double c2 = ym - 2.5 * y0 + 2.0 * y1 - 0.5 * y2;
        const double c3 = 0.5 * (y2 - ym) + 1.5 * (y0 - y1);
        return ((c3 * f + c2) * f + c1) * f + y0;
    }

    /// Length in seconds: Length (Free) or bars at the tempo.
    static double stripSeconds(const ChartParams& p, double bpm) noexcept {
        return p.paper == TransportPaper ? (double)std::max(1, p.bars) * 240.0 / std::max(bpm, 1.0) : p.lengthSeconds;
    }

    // ---- state for the module, the view and the tests ----
    // Any thread: the strip and the marks (atomics).
    int n() const noexcept { return n_.load(std::memory_order_relaxed); }
    int16_t point(int k) const noexcept { return points_[(size_t)k].load(std::memory_order_relaxed); }
    int markCount() const noexcept { return markCount_.load(std::memory_order_relaxed); }
    int mark(int i) const noexcept { return marks_[(size_t)i].load(std::memory_order_relaxed); }
    /// Message thread: something worth saving happened (4.3, engine req. 2).
    bool takeSnapshotRequest() noexcept { return snapshotWanted_.exchange(false, std::memory_order_acq_rel); }
    /// Message thread: the view should get the whole strip (load, clear, resize, ring overflow).
    bool takeFullRequest() const noexcept { return fullWanted_.exchange(false, std::memory_order_acq_rel); }
    void requestFull() noexcept { fullWanted_.store(true, std::memory_order_release); }
    /// Ink ring: indices of points written, oldest first; `inkWritten()` counts them all.
    uint32_t inkWritten() const noexcept { return inkWrite_.load(std::memory_order_acquire); }
    int inkAt(uint32_t i) const noexcept { return ink_[i % kChartInkRing].load(std::memory_order_relaxed); }
    // Audio thread (the module copies them into atomics for the view).
    double writeHead() const noexcept { return p_; }
    double readPosition() const noexcept { return q_; }
    double pen() const noexcept { return pen_.position(); }
    const ChartPen& penModel() const noexcept { return pen_; }
    int recState() const noexcept { return state_; }
    bool writing() const noexcept { return wasWriting_; }
    int inked() const noexcept { return inked_; }

private:
    static constexpr int kWords = (kChartMaxPoints + 63) / 64;
    static constexpr int kSummary = (kWords + 63) / 64;

    void setPoint(int k, int16_t v) noexcept {
        points_[(size_t)k].store(v, std::memory_order_relaxed);
        const uint64_t bit = 1ull << (k & 63);
        if (!(ink0_[(size_t)(k >> 6)] & bit)) {
            ink0_[(size_t)(k >> 6)] |= bit;
            ink1_[(size_t)(k >> 12)] |= 1ull << ((k >> 6) & 63);
            ++inked_;
        }
    }
    void pushInk(int k) noexcept {
        const uint32_t w = inkWrite_.load(std::memory_order_relaxed);
        ink_[w % kChartInkRing].store(k, std::memory_order_relaxed);
        inkWrite_.store(w + 1, std::memory_order_release);
    }
    void finishPoint() noexcept {
        if (curK_ >= 0) pushInk(curK_);
        curK_ = -1;
        sinceInk_ = 0;
    }

    void rebuildInk() noexcept {
        ink0_.fill(0);
        ink1_.fill(0);
        inked_ = 0;
        for (int k = 0; k < n(); ++k)
            if (points_[(size_t)k].load(std::memory_order_relaxed) != kChartBlank) {
                ink0_[(size_t)(k >> 6)] |= 1ull << (k & 63);
                ink1_[(size_t)(k >> 12)] |= 1ull << ((k >> 6) & 63);
                ++inked_;
            }
    }
    /// The highest word ≤ w with ink, or −1.
    int prevWord(int w) const noexcept {
        for (int s = w >> 6; s >= 0 && w >= 0; --s) {
            const uint64_t mask = (w >> 6) == s ? (~0ull >> (63 - (w & 63))) : ~0ull;
            if (const uint64_t m = ink1_[(size_t)s] & mask) return (s << 6) + 63 - chartClz64(m);
        }
        return -1;
    }
    /// The nearest inked point at or before k, wrapping (needs some ink).
    int prevInk(int k) const noexcept {
        const int w = k >> 6;
        if (const uint64_t m = ink0_[(size_t)w] & (~0ull >> (63 - (k & 63)))) return (w << 6) + 63 - chartClz64(m);
        int b = prevWord(w - 1);
        if (b < 0) b = prevWord((n() - 1) >> 6);
        if (b < 0) return k;
        return (b << 6) + 63 - chartClz64(ink0_[(size_t)b]);
    }

    void resize(int nNew) noexcept {
        finishPoint();
        const int nOld = n();
        if (inked_ > 0) {  // points past n are always blank, so a blank strip only changes n
            for (int k = 0; k < nOld; ++k) scratch_[(size_t)k] = points_[(size_t)k].load(std::memory_order_relaxed);
            for (int j = 0; j < nNew; ++j) points_[(size_t)j].store(chartResamplePoint(scratch_.get(), nOld, nNew, j), std::memory_order_relaxed);
            for (int j = nNew; j < nOld; ++j) points_[(size_t)j].store(kChartBlank, std::memory_order_relaxed);
        }
        n_.store(nNew, std::memory_order_relaxed);
        if (inked_ > 0) rebuildInk();
        const int count = markCount();
        int kept = 0;
        for (int i = 0; i < count; ++i) {
            const int m = chartResampleIndex(mark(i), nOld, nNew);
            bool dup = false;
            for (int j = 0; j < kept; ++j) dup = dup || mark(j) == m;
            if (!dup) marks_[(size_t)kept++].store(m, std::memory_order_relaxed);
        }
        markCount_.store(kept, std::memory_order_relaxed);
        rebuildMarkBits();
        prevQ_ = -1;
        if (inked_ > 0 || kept > 0) snapshotWanted_.store(true, std::memory_order_release);
        fullWanted_.store(true, std::memory_order_release);
    }
    void addMark(int k) noexcept {
        if (markBits_[(size_t)(k >> 6)] & (1ull << (k & 63))) return;
        int count = markCount();
        if (count >= kChartMaxMarks) {  // drop the oldest
            for (int i = 1; i < count; ++i) marks_[(size_t)(i - 1)].store(mark(i), std::memory_order_relaxed);
            --count;
        }
        marks_[(size_t)count].store(k, std::memory_order_relaxed);
        markCount_.store(count + 1, std::memory_order_relaxed);
        rebuildMarkBits();
        snapshotWanted_.store(true, std::memory_order_release);
    }
    void rebuildMarkBits() noexcept {
        markBits_.fill(0);
        for (int i = 0; i < markCount(); ++i) markBits_[(size_t)(mark(i) >> 6)] |= 1ull << (mark(i) & 63);
    }
    /// floor(q·N) went from a to b: did it enter a marked index, the short way round?
    bool crossesMark(int a, int b) const noexcept {
        const int n = this->n(), count = markCount();
        if (count == 0) return false;
        int d = b - a;
        if (d > n / 2) d -= n;
        else if (d <= -n / 2) d += n;
        if (d == 1 || d == -1) return (markBits_[(size_t)(b >> 6)] >> (b & 63)) & 1ull;
        for (int i = 0; i < count; ++i) {
            const int m = mark(i);
            const int rel = d > 0 ? ((m - a) % n + n) % n : ((a - m) % n + n) % n;
            if (rel >= 1 && rel <= std::abs(d)) return true;
        }
        return false;
    }

    double sampleRate_ = 48000.0;
    ChartDetector detector_;
    ChartPen pen_;
    float gainDb_ = 0.0f;
    double gain_ = 1.0;

    std::unique_ptr<std::atomic<int16_t>[]> points_;
    std::unique_ptr<int16_t[]> scratch_;
    std::atomic<int> n_{kChartDefaultPoints};
    std::array<uint64_t, kWords> ink0_{};    // a bit per inked point
    std::array<uint64_t, kSummary> ink1_{};  // a bit per non-empty ink0_ word
    int inked_ = 0;
    std::array<std::atomic<int>, kChartMaxMarks> marks_;
    std::atomic<int> markCount_{0};
    std::array<uint64_t, kWords> markBits_{};
    std::array<std::atomic<int>, kChartInkRing> ink_;
    std::atomic<uint32_t> inkWrite_{0};
    std::atomic<bool> snapshotWanted_{false};
    mutable std::atomic<bool> fullWanted_{true};
    int sizeKey_ = -1;

    double p_ = 0.0, r_ = 0.0, q_ = 0.0;
    int state_ = Idle, recordMode_ = -1;
    int curK_ = -1, count_ = 0, prevQ_ = -1, sinceInk_ = 0;
    double sum_ = 0.0;
    int64_t writtenSamples_ = 0;
    bool wasWriting_ = false;
    dsp::GateEdge recordEdge_, markEdge_, clearEdge_, resetEdge_;
};

}  // namespace bleep::patch
