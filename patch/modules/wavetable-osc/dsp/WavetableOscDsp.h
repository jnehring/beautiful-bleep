// SPDX-License-Identifier: MIT
// Wavetable Osc (specs/modules/wavetable-oscillator.md): a two-dimensional
// wavetable oscillator. A bank is a grid of single-cycle frames with
// band-limited mipmaps (dsp::WavetableBank, common/dsp/Wavetable.h); X and Y
// (or Scan along a path) pick a point on the grid, the four nearest frames
// are blended, and a phase warp bends how each cycle is read.
//
// Around the shared reader this adds: the position (X/Y or one of five
// paths, smoothed over 1 ms), the stepped frame blend (2 ms crossfade per
// step), the bank crossfade (10 ms, also when an import swaps the user bank),
// polyBLEP corrections for the discontinuities a warp or Sync makes (Sync
// warp and Steps at the cycle reset and at each step, the external Sync
// input), a second channel offset by Stereo, a sub sine an octave down, and
// optional 2× oversampling. The banks themselves are owned by the caller.
#pragma once

#include "dsp/OscCore.h"
#include "dsp/Oversampler.h"
#include "dsp/Partials.h"
#include "dsp/Wavetable.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

namespace wtosc {

enum class Path { Off, Rows, Snake, Columns, Diagonal, Spiral };
enum class Read { Cubic, Linear, Raw };

constexpr int kMaxCells = 64;

/// The order a path visits the cells of a cols × rows grid; returns the count.
inline int pathCells(Path path, int cols, int rows, uint8_t* cx, uint8_t* cy) noexcept {
    cols = std::clamp(cols, 1, 8), rows = std::clamp(rows, 1, 8);
    int n = 0;
    auto add = [&](int c, int r) noexcept { cx[n] = (uint8_t)c, cy[n] = (uint8_t)r, ++n; };
    switch (path) {
        case Path::Snake:
            for (int r = 0; r < rows; ++r)
                for (int k = 0; k < cols; ++k) add(r % 2 ? cols - 1 - k : k, r);
            break;
        case Path::Columns:
            for (int c = 0; c < cols; ++c)
                for (int r = 0; r < rows; ++r) add(c, r);
            break;
        case Path::Diagonal:  // zig-zag across the anti-diagonals
            for (int d = 0; d <= cols + rows - 2; ++d)
                for (int k = 0; k <= d; ++k) {
                    const int r = d % 2 ? k : d - k, c = d - r;
                    if (c < cols && r < rows) add(c, r);
                }
            break;
        case Path::Spiral: {  // clockwise, outside in
            int top = 0, bottom = rows - 1, left = 0, right = cols - 1;
            while (top <= bottom && left <= right) {
                for (int c = left; c <= right; ++c) add(c, top);
                for (int r = top + 1; r <= bottom; ++r) add(right, r);
                if (top < bottom)
                    for (int c = right - 1; c >= left; --c) add(c, bottom);
                if (left < right)
                    for (int r = bottom - 1; r > top; --r) add(left, r);
                ++top, --bottom, ++left, --right;
            }
            break;
        }
        case Path::Off:
        case Path::Rows:
        default:  // Rows (and Off)
            for (int r = 0; r < rows; ++r)
                for (int c = 0; c < cols; ++c) add(c, r);
            break;
    }
    return n;
}

}  // namespace wtosc

struct WavetableOscParams {
    float pitch = 0.0f;        ///< octaves from C4: Octave + Coarse + Fine + Pitch
    float fm = 0.0f;           ///< FM input (audio)
    float fmDepth = 0.0f;      ///< 0..1: ±4× at 1, through zero
    float x = 0.0f, y = 0.0f;  ///< 0..1 grid position (Path Off)
    float scan = 0.0f;         ///< 0..1 along the path
    float warp = 0.0f;         ///< 0..1
    float stereo = 0.0f;       ///< −0.5…+0.5: R's X (or Scan) offset
    float subLevel = 0.0f;     ///< 0..1: Sub into Out
    wtosc::Path path = wtosc::Path::Off;
    bool stepBlend = false;    ///< Frame Blend Step (nearest frame)
    wtosc::Read read = wtosc::Read::Cubic;
    dsp::wavetable::Warp warpMode = dsp::wavetable::Warp::Bend;
};

struct WavetableOscFrame {
    float outL = 0.0f, outR = 0.0f, sub = 0.0f, posX = 0.0f, posY = 0.0f;
};

class WavetableOscDsp {
public:
    using Bank = dsp::WavetableBank;
    enum Output { OutL, OutR, Sub, kAudioOutputs };
    static constexpr double kBankFade = 0.010;  ///< seconds
    static constexpr double kStepFade = 0.002;
    static constexpr double kSmooth = 0.001;

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        reset();
    }
    void reset() noexcept {
        phase_ = 0.0;
        subPhase_ = 0.0;
        for (auto& c : ch_) c = Channel{};
        for (auto& d : down_) d.reset();
        subPending_ = 0.0f;
        prev_ = nullptr;
        bankFade_ = 1.0f;
        primed_ = false;
    }
    /// 1 (Normal) or 2 (High).
    void setOversampling(int factor) noexcept {
        factor = factor >= 2 ? 2 : 1;
        if (factor == factor_) return;
        factor_ = factor;
        for (auto& d : down_) d.reset();
    }
    int oversampling() const noexcept { return factor_; }

    /// The bank to play (owned by the caller; it and the previous one must stay
    /// valid for kBankFade after a change). A change crossfades over 10 ms.
    void setBank(const Bank* bank) noexcept {
        if (bank == cur_) return;
        if (cur_ != nullptr && primed_) {
            prev_ = cur_;
            bankFade_ = 0.0f;
        }
        cur_ = bank;
    }
    const Bank* bank() const noexcept { return cur_; }

    /// The played position (0..1) of a channel (0 L, 1 R), after path and smoothing.
    float posX(int c) const noexcept { return ch_[c & 1].u; }
    float posY(int c) const noexcept { return ch_[c & 1].v; }
    double phase() const noexcept { return phase_; }

    /// One output sample; `sync` true on the sample of a Sync edge. `want`
    /// (indexed by Output, may be null) skips unread outputs' decimators.
    WavetableOscFrame process(const WavetableOscParams& p, bool sync, const bool* want = nullptr) noexcept {
        WavetableOscFrame out;
        if (cur_ == nullptr || cur_->empty()) return out;
        const int K = factor_;
        const double rate = sampleRate_ * K;
        if (!primed_) {
            const float u = p.x, v = p.y;
            for (auto& c : ch_) c.u = u, c.v = v;
            primed_ = true;
            target(p, 0, true), target(p, 1, true);
        }

        // Pitch, FM, warp and mip level: once per output sample.
        double hz = dsp::osc::pitchToHz((double)p.pitch);
        hz = dsp::osc::linearFm(hz, (double)std::clamp(p.fmDepth, 0.0f, 1.0f), (double)p.fm);
        hz = std::clamp(hz, -0.45 * rate, 0.45 * rate);
        const double dt = hz / rate;
        const float warp = std::clamp(p.warp, 0.0f, 1.0f);
        const auto mode = warp > 0.0f ? p.warpMode : dsp::wavetable::Warp::None;
        const bool raw = p.read == wtosc::Read::Raw;
        const auto interp = raw ? dsp::wavetable::Interp::Nearest
                            : p.read == wtosc::Read::Linear ? dsp::wavetable::Interp::Linear
                                                           : dsp::wavetable::Interp::Cubic;
        const dsp::wavetable::Mip mip =
            raw ? dsp::wavetable::Mip{} : dsp::wavetable::selectMip(std::fabs(hz) * dsp::wavetable::warpSlope(mode, warp), rate);
        const bool stereo = p.stereo != 0.0f;
        const int channels = stereo ? 2 : 1;
        const float smooth = (float)(1.0 - std::exp(-1.0 / (kSmooth * sampleRate_)));
        for (int c = 0; c < channels; ++c) {
            target(p, c, false);
            Channel& s = ch_[c];
            s.u += (s.tu - s.u) * smooth;
            s.v += (s.tv - s.v) * smooth;
            if (p.stepBlend) stepTarget(s);
        }
        if (!stereo) ch_[1] = ch_[0];
        const float stepInc = (float)(1.0 / (kStepFade * rate)), bankInc = (float)(1.0 / (kBankFade * rate));
        const double steps = std::exp2(11.0 - 10.0 * (double)warp);  // Steps warp (Wavetable.h)

        float buf[kAudioOutputs][2];
        for (int k = 0; k < K; ++k) {
            const bool ext = sync && k == 0;
            Read r{p, mode, warp, mip, interp};
            float v[2], subV;
            if (ext) {  // restart: this sample is the midpoint of the jump (polyBLEP at the sample)
                for (int c = 0; c < channels; ++c) {
                    const float before = read(r, c, phase_) + ch_[c].pending;
                    v[c] = 0.5f * (before + read(r, c, 0.0));
                    ch_[c].pending = 0.0f;
                }
                const float sb = dsp::partials::sin2pi((float)subPhase_) + subPending_;
                subV = 0.5f * sb;  // sin(0) = 0
                subPending_ = 0.0f;
                phase_ = 0.0, subPhase_ = 0.0;
            } else {
                for (int c = 0; c < channels; ++c) {
                    v[c] = read(r, c, phase_) + ch_[c].pending;
                    ch_[c].pending = 0.0f;
                }
                subV = dsp::partials::sin2pi((float)subPhase_) + subPending_;
                subPending_ = 0.0f;
            }

            // Advance; correct the discontinuities crossed on the way.
            const double from = phase_;
            double to = from + dt;
            const bool wrapped = to >= 1.0 || to < 0.0;
            to -= std::floor(to);
            const bool jumpy = mode == dsp::wavetable::Warp::Sync || mode == dsp::wavetable::Warp::Steps;
            if (wrapped && jumpy && std::fabs(dt) > 1e-12) {
                const double edge = dt > 0.0 ? 1.0 : 0.0;
                const double a = (edge - from) / dt;  // fraction of the interval
                const double pre = dt > 0.0 ? 1.0 - 1e-9 : 0.0, post = dt > 0.0 ? 0.0 : 1.0 - 1e-9;
                for (int c = 0; c < channels; ++c) blep(c, a, read(r, c, post) - read(r, c, pre), v[c]);
            } else if (!wrapped && mode == dsp::wavetable::Warp::Steps) {
                const double s0 = std::floor(from * steps), s1 = std::floor(to * steps);
                if (std::fabs(s1 - s0) == 1.0) {  // one step edge inside this interval
                    const double e = (dt > 0.0 ? s1 : s0) / steps;
                    const double a = (e - from) / dt;
                    for (int c = 0; c < channels; ++c) blep(c, a, read(r, c, to) - read(r, c, from), v[c]);
                }
            }
            phase_ = to;
            double sp = subPhase_ + 0.5 * dt;
            subPhase_ = sp - std::floor(sp);

            // Step and bank crossfades advance per (oversampled) sample.
            for (int c = 0; c < channels; ++c) ch_[c].fade = std::min(1.0f, ch_[c].fade + stepInc);
            if (bankFade_ < 1.0f) {
                bankFade_ = std::min(1.0f, bankFade_ + bankInc);
                if (bankFade_ >= 1.0f) prev_ = nullptr;
            }
            const float sub = subV;
            const float mixSub = 0.7f * std::clamp(p.subLevel, 0.0f, 1.0f);
            const float norm = 1.0f / (1.0f + 0.5f * mixSub);
            buf[OutL][k] = (v[0] + mixSub * sub) * norm;
            buf[OutR][k] = stereo ? (v[1] + mixSub * sub) * norm : buf[OutL][k];
            buf[Sub][k] = sub;
        }
        if (!stereo) ch_[1] = ch_[0];

        if (K == 1) {
            out.outL = buf[OutL][0], out.outR = buf[OutR][0], out.sub = buf[Sub][0];
        } else {
            out.outL = down_[OutL].process(buf[OutL], K);
            if (stereo && !stereo_) down_[OutR] = down_[OutL];  // R takes over from L without a step
            out.outR = stereo && (!want || want[OutR]) ? down_[OutR].process(buf[OutR], K) : out.outL;
            if (!want || want[Sub]) out.sub = down_[Sub].process(buf[Sub], K);
        }
        stereo_ = stereo;
        out.posX = ch_[0].u, out.posY = ch_[0].v;
        return out;
    }

private:
    struct Channel {
        float u = 0.0f, v = 0.0f, tu = 0.0f, tv = 0.0f;  ///< position (0..1) and its target
        int cell = -1, prevCell = -1;                    ///< Step blend: grid cell (c + 8 r)
        float fade = 1.0f;                               ///< Step blend crossfade
        float pending = 0.0f;                            ///< polyBLEP residual for the next sample
    };
    struct Read {
        const WavetableOscParams& p;
        dsp::wavetable::Warp mode;
        float warp;
        dsp::wavetable::Mip mip;
        dsp::wavetable::Interp interp;
    };

    /// Channel c's target position from X/Y or the path.
    void target(const WavetableOscParams& p, int c, bool jump) noexcept {
        Channel& s = ch_[c];
        const float off = c == 1 ? p.stereo : 0.0f;
        if (p.path == wtosc::Path::Off) {
            s.tu = std::clamp(p.x + off, 0.0f, 1.0f);
            s.tv = std::clamp(p.y, 0.0f, 1.0f);
        } else {
            const int cols = cur_->cols(), rows = cur_->rows();
            if (p.path != path_ || cols != pathCols_ || rows != pathRows_) {
                pathCount_ = wtosc::pathCells(p.path, cols, rows, pathX_.data(), pathY_.data());
                path_ = p.path, pathCols_ = cols, pathRows_ = rows;
            }
            float scan = std::clamp(p.scan, 0.0f, 1.0f) + off;
            if (c == 1) scan -= std::floor(scan);  // R wraps along the path
            const float pos = std::clamp(scan, 0.0f, 1.0f) * (float)(pathCount_ - 1);
            const int i = std::min((int)pos, std::max(pathCount_ - 2, 0));
            const float t = pathCount_ > 1 ? pos - (float)i : 0.0f;
            const int j = std::min(i + 1, pathCount_ - 1);
            const float gx = pathX_[(size_t)i] + t * ((float)pathX_[(size_t)j] - pathX_[(size_t)i]);
            const float gy = pathY_[(size_t)i] + t * ((float)pathY_[(size_t)j] - pathY_[(size_t)i]);
            s.tu = cols > 1 ? gx / (float)(cols - 1) : 0.0f;
            s.tv = rows > 1 ? gy / (float)(rows - 1) : 0.0f;
        }
        if (jump) s.u = s.tu, s.v = s.tv;
    }

    /// Step blend: the nearest cell; a change starts a 2 ms crossfade.
    void stepTarget(Channel& s) noexcept {
        const int cols = cur_->cols(), rows = cur_->rows();
        const int cx = (int)std::lround(s.u * (float)(cols - 1)), cy = (int)std::lround(s.v * (float)(rows - 1));
        const int cell = cx + 8 * cy;
        if (s.cell < 0) s.cell = s.prevCell = cell;
        if (cell == s.cell) return;
        s.prevCell = s.fade < 0.5f ? s.prevCell : s.cell;
        s.cell = cell;
        s.fade = 0.0f;
    }

    /// One bank at channel c's position and table phase w.
    float readBank(const Bank& b, const Read& r, const Channel& s, double w) const noexcept {
        if (!r.p.stepBlend)
            return dsp::wavetable::readXY(b, s.u * (float)(b.cols() - 1), s.v * (float)(b.rows() - 1), w, r.mip, r.interp);
        auto frame = [&](int cell) noexcept {
            const int cx = std::min(cell % 8, b.cols() - 1), cy = std::min(cell / 8, b.rows() - 1);
            return dsp::wavetable::readFrame(b, cy * b.cols() + cx, w, r.mip, r.interp);
        };
        const float a = frame(s.cell);
        return s.fade >= 1.0f ? a : frame(s.prevCell) + s.fade * (a - frame(s.prevCell));
    }

    /// Channel c at oscillator phase `ph` (warped), crossfading banks.
    float read(const Read& r, int c, double ph) const noexcept {
        const double w = dsp::wavetable::warpPhase(r.mode, ph, r.warp);
        const float a = readBank(*cur_, r, ch_[c], w);
        if (prev_ == nullptr || bankFade_ >= 1.0f) return a;
        const float b = readBank(*prev_, r, ch_[c], w);
        return b + bankFade_ * (a - b);
    }

    /// polyBLEP for a jump `j` a fraction `a` into the interval after the
    /// sample `cur` (as dsp::SyncOsc).
    void blep(int c, double a, float j, float& cur) noexcept {
        a = std::clamp(a, 0.0, 1.0);
        const float b = (float)(1.0 - a);
        cur += 0.5f * j * b * b;
        ch_[c].pending -= 0.5f * j * (float)(a * a);
    }

    double sampleRate_ = 48000.0, phase_ = 0.0, subPhase_ = 0.0;
    int factor_ = 1;
    const Bank* cur_ = nullptr;
    const Bank* prev_ = nullptr;
    float bankFade_ = 1.0f, subPending_ = 0.0f;
    Channel ch_[2];
    dsp::Downsampler down_[kAudioOutputs];
    wtosc::Path path_ = wtosc::Path::Off;
    int pathCols_ = 0, pathRows_ = 0, pathCount_ = 0;
    std::array<uint8_t, wtosc::kMaxCells> pathX_{}, pathY_{};
    bool primed_ = false, stereo_ = false;
};

}  // namespace bleep::patch
