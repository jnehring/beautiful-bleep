// SPDX-License-Identifier: MIT
// Cartesian Seq core (specs/modules/cartesian-sequencer.md): an 8 × 8 grid of
// cells (gate, pitch, velocity, mod, access) walked by two playheads. In
// Clocks mode X follows the transport or the X Clock, Y either wraps with X
// (a raster scan through the grid) or runs on its own rate or clock; in
// Cartesian mode the X/Y knobs pick the cell. Timing comes from the shared
// dsp::SeqClock, notes from dsp::SeqVoice; notes leave through a callback, so
// this stays free of the engine's types.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/SeqNotes.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

enum CartGate : uint8_t { CartOff = 0, CartOn = 1, CartTie = 2 };
enum CartDirection { CartForward = 0, CartBackward, CartPingPong, CartRandom };
enum CartMode { CartClocks = 0, CartCartesian };
enum CartSample { CartSampleClock = 0, CartSampleChange };
/// Y Rate: Wrap, Off, then the sequencer rates (index − kCartYRates).
enum CartYRate { CartYWrap = 0, CartYOff = 1 };
constexpr int kCartYRates = 2;

constexpr int kCartSize = 8, kCartCells = kCartSize * kCartSize;
constexpr int kCartMinPitch = -24, kCartMaxPitch = 36;

struct CartCell {
    uint8_t gate = CartOff;
    int8_t pitch = 0;         ///< semitones above Root + Octave
    uint8_t velocity = 100;   ///< 1..127
    int8_t mod = 0;           ///< −100..100 %
    bool play = true;         ///< Access: false = skipped
};
/// Row-major: cells[row · 8 + column].
using CartGrid = std::array<CartCell, kCartCells>;

struct CartParams {
    int columns = 4, rows = 4;
    int mode = CartClocks;
    int xRate = 9;            ///< sequencer rate index (Tempo.h)
    int yRate = CartYWrap;    ///< CartYRate, or kCartYRates + rate index
    int xDirection = CartForward, yDirection = CartForward;
    int sample = CartSampleClock;
    int root = 0, scale = 1, octave = 0;
    uint32_t seed = 1;
    float gateLength = 0.5f;  ///< share of an X step
    float swing = 0.5f;       ///< 0.5 = straight .. 0.75
    float x = 0.0f, y = 0.0f; ///< 0..1
    float modSlew = 0.0f;     ///< seconds
};

struct CartTime {
    bool running = false;     ///< transport playing with a valid position
    bool started = false;     ///< first sample after the transport started
    double bpm = 120.0;
    double ppq = 0.0;
};

struct CartInputs {
    float xClock = 0.0f, yClock = 0.0f, reset = 0.0f, transpose = 0.0f;
    bool xPatched = false, yPatched = false;
};

struct CartOutputs {
    float pitch = 0.0f, gate = 0.0f, velocity = 0.0f, mod = 0.0f, trigger = 0.0f;
    float xPos = 0.0f, yPos = 0.0f, rowEnd = 0.0f, gridEnd = 0.0f;
};

class CartesianSequencerDsp {
public:
    static constexpr int kMaxPath = (2 * kCartSize - 2) * (2 * kCartSize - 2);

    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    /// Steps until an axis of `n` cells is back at its start.
    static int cycle(int n, int direction) noexcept {
        return direction == CartPingPong && n > 1 ? 2 * n - 2 : n;
    }
    /// The index at count `k` on an axis of `n` cells (Random: Forward).
    static int position(int64_t k, int n, int direction) noexcept {
        if (n <= 1) return 0;
        switch (direction) {
            case CartBackward: return n - 1 - (int)mod(k, n);
            case CartPingPong: {
                const int j = (int)mod(k, 2 * n - 2);
                return j < n ? j : 2 * n - 2 - j;
            }
            default: return (int)mod(k, n);
        }
    }
    /// A knob (0..1) as a cell index on an axis of `n` cells.
    static int knobIndex(float v, int n) noexcept {
        return std::clamp((int)std::floor(std::clamp(v, 0.0f, 0.9999f) * (float)n), 0, n - 1);
    }
    /// A cell's quantized pitch, in semitones from C4.
    static int pitchOf(int root, int scale, float relative) noexcept {
        const auto& sc = dsp::scales()[(size_t)std::clamp(scale, 0, (int)dsp::scales().size() - 1)];
        return std::clamp(root + dsp::quantize(relative, sc.mask), -60, 67);  // MIDI 0..127
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        xClock_.prepare(sampleRate);
    }

    void reset() noexcept {
        xClock_.reset();
        voice_.reset();
        yEdge_.reset();
        resetEdge_.reset();
        haveNy_ = havePos_ = played_ = false;
        configured_ = false;
        stopRequested_ = false;
        nx_ = ny_ = 0;
        ix_ = iy_ = 0;
        lastX_ = lastY_ = lastRandom_ = -1;
        cell_ = 0;
        modOut_ = modTarget_ = modStep_ = 0.0f;
        modLeft_ = 0;
        sinceChange_ = 1 << 30;
        pathDirty_ = true;
    }

    /// A new grid. A sounding cell that lost its gate or was skipped stops;
    /// the raster path is rebuilt.
    void setGrid(const CartGrid& g) noexcept {
        const CartCell before = grid_[(size_t)cell_];
        grid_ = g;
        const CartCell& now = grid_[(size_t)cell_];
        if (voice_.sounding() && (now.gate != before.gate || now.play != before.play)) stopRequested_ = true;
        pathDirty_ = true;
    }
    const CartGrid& grid() const noexcept { return grid_; }

    int playingCell() const noexcept { return cell_; }
    bool sounding() const noexcept { return voice_.sounding(); }
    int column() const noexcept { return cell_ % kCartSize; }
    int row() const noexcept { return cell_ / kCartSize; }

    /// One sample. `emit(on, note, pitch, velocity)` receives note events.
    template <class Emit>
    void tick(const CartParams& p, const CartInputs& in, const CartTime& t, CartOutputs& out, Emit&& emit) noexcept {
        out.trigger = out.rowEnd = out.gridEnd = 0.0f;
        voice_.beginSample();
        const int cols = std::clamp(p.columns, 1, kCartSize), rows = std::clamp(p.rows, 1, kCartSize);
        const bool raster = p.mode == CartClocks && p.yRate == CartYWrap && !in.yPatched;
        // A different path or timing source: end the note and start counting afresh.
        if (configured_ && (cols != cols_ || rows != rows_ || p.mode != mode_ || p.sample != sample_ ||
                            p.xDirection != xDir_ || p.yDirection != yDir_ || raster != raster_ ||
                            in.xPatched != xPatched_ || in.yPatched != yPatched_)) {
            stop(emit);
            played_ = false;
            lastX_ = lastY_ = lastRandom_ = -1;
            pathDirty_ = true;
            havePos_ = false;
        }
        if (!configured_ || cols != cols_ || rows != rows_) pathDirty_ = true;
        configured_ = true;
        cols_ = cols, rows_ = rows, mode_ = p.mode, sample_ = p.sample;
        xDir_ = p.xDirection, yDir_ = p.yDirection, raster_ = raster;
        xPatched_ = in.xPatched, yPatched_ = in.yPatched;
        if (stopRequested_) stop(emit);

        const int offX = knobIndex(p.x, cols), offY = knobIndex(p.y, rows);
        const double xBeats = dsp::sequencerRateBeats(p.xRate);
        const double xStepSamples = dsp::beatsToSamples(xBeats, t.bpm, sampleRate_);

        if (p.mode == CartCartesian && p.sample == CartSampleChange) {
            // No clock: a cell plays whenever the position enters a new cell.
            ++sinceChange_;
            const bool resetEdge = resetEdge_.process(in.reset) > 0;
            const float fx = std::clamp(p.x, 0.0f, 0.9999f) * (float)cols;
            const float fy = std::clamp(p.y, 0.0f, 0.9999f) * (float)rows;
            if (!havePos_) {  // the first position is taken silently
                havePos_ = true;
                hx_ = (int)fx, hy_ = (int)fy;
                cell_ = nearest(hx_, hy_, cols, rows) >= 0 ? nearest(hx_, hy_, cols, rows) : hy_ * kCartSize + hx_;
            } else {
                int nx = hx_, ny = hy_;
                if (fx < (float)hx_ - 0.1f || fx > (float)hx_ + 1.1f || hx_ >= cols) nx = std::min((int)fx, cols - 1);
                if (fy < (float)hy_ - 0.1f || fy > (float)hy_ + 1.1f || hy_ >= rows) ny = std::min((int)fy, rows - 1);
                const bool moved = nx != hx_ || ny != hy_;
                if ((moved || resetEdge) && sinceChange_ >= (int64_t)(0.001 * sampleRate_)) {
                    hx_ = nx, hy_ = ny;
                    sinceChange_ = 0;
                    const int c = nearest(hx_, hy_, cols, rows);
                    if (c < 0) {
                        voice_.rest(emit);
                    } else if (c != cell_ || resetEdge || !voice_.sounding()) {
                        play(p, c, in.transpose, xStepSamples, emit, out);
                    }
                }
            }
        } else {
            bool xMoved = false, yMoved = false;
            double duration = xStepSamples;
            dsp::SeqClockInput ci;
            ci.clocked = in.xPatched;
            ci.clock = in.xClock;
            ci.reset = in.reset;
            ci.running = t.running;
            ci.started = t.started;
            ci.ppq = t.ppq;
            ci.bpm = t.bpm;
            ci.stepBeats = xBeats;
            ci.swing = p.swing;
            xClock_.tick(ci, [&](const dsp::SeqClockEvent& e) {
                if (e.type == dsp::SeqClockEvent::Release) {
                    stop(emit);
                    if (e.reason == dsp::SeqClockEvent::Stop) haveNy_ = false;
                } else {
                    xMoved = true;
                    nx_ = e.n;
                    duration = e.durationSamples;
                    lastStepSamples_ = e.stepSamples;
                }
            });
            const bool resetEdge = xClock_.resetEdge();
            if (p.mode == CartClocks && !raster) {
                yMoved = tickY(p, in, t, xBeats, resetEdge);
                if (resetEdge && in.yPatched && !yMoved) {  // Y is on row 0 for the next X pulse
                    ny_ = 0;
                    lastY_ = -1;
                    iy_ = axisIndex(0, rows, p.yDirection, p.seed, 1, lastY_);
                }
            }
            if (xMoved && p.mode == CartClocks) ix_ = axisIndex(nx_, cols, p.xDirection, p.seed, 0, lastX_);
            if (yMoved) iy_ = axisIndex(ny_, rows, p.yDirection, p.seed, 1, lastY_);
            if (!xMoved && yMoved) duration = lastStepSamples_ > 0.0 ? lastStepSamples_ : xStepSamples;

            if (xMoved || yMoved) {
                if (p.mode == CartCartesian) {
                    const int c = nearest(knobIndex(p.x, cols), knobIndex(p.y, rows), cols, rows);
                    if (c < 0) voice_.rest(emit);
                    else play(p, c, in.transpose, duration, emit, out);
                    if (played_ && mod(nx_, cols) == 0) out.rowEnd = 1.0f;
                    if (played_ && mod(nx_, (int64_t)cols * rows) == 0) out.gridEnd = 1.0f;
                } else if (raster) {
                    playRaster(p, offX, offY, in.transpose, duration, emit, out);
                } else {
                    // Independent axes: the cell, or the next playing one in the row.
                    const int y = p.yRate == CartYOff && !in.yPatched ? offY : (int)((iy_ + offY) % rows);
                    const int x = (int)((ix_ + offX) % cols);
                    const int c = inRow(x, y, cols, p.xDirection == CartBackward ? -1 : 1);
                    const int cycX = p.xDirection == CartRandom ? cols : cycle(cols, p.xDirection);
                    const int cycY = p.yDirection == CartRandom ? rows : cycle(rows, p.yDirection);
                    const bool xStart = mod(nx_, cycX) == 0;
                    const bool yStart = p.yRate == CartYOff && !in.yPatched ? true : mod(ny_, cycY) == 0;
                    if (played_ && xMoved && xStart) out.rowEnd = 1.0f;
                    if (played_ && xStart && yStart) out.gridEnd = 1.0f;
                    if (c < 0) {
                        voice_.rest(emit);
                        cell_ = y * kCartSize + x;
                    } else {
                        play(p, c, in.transpose, duration, emit, out);
                    }
                }
                played_ = true;
            }
        }

        voice_.endSample(emit);
        // Mod: a linear glide to the cell's value over Mod Slew.
        if (modLeft_ > 0) {
            modOut_ += modStep_;
            if (--modLeft_ == 0) modOut_ = modTarget_;
        }
        out.pitch = voice_.pitch();
        out.velocity = voice_.velocity();
        out.gate = voice_.gate() ? 1.0f : 0.0f;
        out.mod = modOut_;
        out.xPos = cols > 1 ? (float)column() / (float)(cols - 1) : 0.0f;
        out.yPos = rows > 1 ? (float)row() / (float)(rows - 1) : 0.0f;
        out.xPos = std::clamp(out.xPos, 0.0f, 1.0f);
        out.yPos = std::clamp(out.yPos, 0.0f, 1.0f);
    }

    /// The raster path for the current settings (for tests and the view):
    /// cell indices in playing order, skipped cells removed.
    int pathLength() const noexcept { return pathLen_; }
    int pathCell(int i) const noexcept { return path_[(size_t)i].cell; }

    /// Builds the raster path: rows in Y Direction, each row in X Direction,
    /// the X/Y knob offsets applied, skipped cells removed.
    void buildPath(int cols, int rows, int xDir, int yDir, int offX, int offY) noexcept {
        pathLen_ = 0;
        const int cy = cycle(rows, yDir == CartRandom ? CartForward : yDir);
        const int cx = cycle(cols, xDir == CartRandom ? CartForward : xDir);
        for (int i = 0; i < cy; ++i) {
            const int r = (position(i, rows, yDir == CartRandom ? CartForward : yDir) + offY) % rows;
            for (int j = 0; j < cx; ++j) {
                const int c = (position(j, cols, xDir == CartRandom ? CartForward : xDir) + offX) % cols;
                const int idx = r * kCartSize + c;
                if (grid_[(size_t)idx].play) path_[(size_t)pathLen_++] = {(uint8_t)idx, (uint8_t)i};
            }
        }
        // Playable cells (row-major) for random raster walks.
        cellsLen_ = 0;
        for (int r = 0; r < rows; ++r)
            for (int c = 0; c < cols; ++c)
                if (grid_[(size_t)(r * kCartSize + c)].play) cells_[(size_t)cellsLen_++] = (uint8_t)(r * kCartSize + c);
        builtFor_ = {cols, rows, xDir, yDir, offX, offY};
        pathDirty_ = false;
    }

    /// The nearest playing cell to (x, y) inside the playing area (distance in
    /// cells; ties to the lower row, then the lower column), or −1.
    int nearest(int x, int y, int cols, int rows) const noexcept {
        int best = -1, bestD = 1 << 30;
        for (int r = 0; r < rows; ++r)
            for (int c = 0; c < cols; ++c) {
                if (!grid_[(size_t)(r * kCartSize + c)].play) continue;
                const int d = (r - y) * (r - y) + (c - x) * (c - x);
                if (d < bestD) bestD = d, best = r * kCartSize + c;
            }
        return best;
    }

    /// Cell x in row y, or the next playing cell in `dir` (±1) in that row, or −1.
    int inRow(int x, int y, int cols, int dir) const noexcept {
        for (int k = 0; k < cols; ++k) {
            const int c = (int)mod(x + dir * k, cols);
            if (grid_[(size_t)(y * kCartSize + c)].play) return y * kCartSize + c;
        }
        return -1;
    }

private:
    struct PathEntry {
        uint8_t cell = 0, segment = 0;
    };
    struct BuiltFor {
        int cols = -1, rows = -1, xDir = -1, yDir = -1, offX = -1, offY = -1;
        bool operator!=(const BuiltFor& o) const noexcept {
            return cols != o.cols || rows != o.rows || xDir != o.xDir || yDir != o.yDir || offX != o.offX ||
                   offY != o.offY;
        }
    };

    /// The Y counter in independent mode: Y Clock pulses, or the transport at
    /// Y Rate anchored to the same origin as X. True when Y moved.
    bool tickY(const CartParams& p, const CartInputs& in, const CartTime& t, double xBeats, bool resetEdge) noexcept {
        if (in.yPatched) {
            if (resetEdge) yPendingReset_ = true;
            if (yEdge_.process(in.yClock) > 0) {
                ny_ = yPendingReset_ || !haveNy_ ? 0 : ny_ + 1;
                yPendingReset_ = false;
                haveNy_ = true;
                return true;
            }
            return false;
        }
        if (p.yRate < kCartYRates || !t.running) {
            if (!t.running) haveNy_ = yRunning_ = false;
            return false;
        }
        const double yBeats = dsp::sequencerRateBeats(p.yRate - kCartYRates);
        if (t.started || !yRunning_) yOrigin_ = in.xPatched ? 0.0 : (double)xClock_.origin() * xBeats;
        yRunning_ = true;
        if (resetEdge) {
            yOrigin_ = in.xPatched ? (std::floor(t.ppq / yBeats) + 1.0) * yBeats : (double)xClock_.origin() * xBeats;
            haveNy_ = true;  // silent until the next boundary
            ny_ = (int64_t)std::floor((t.ppq - yOrigin_) / yBeats);
            return false;
        }
        // Same rounding as SeqClock's X steps, so coinciding steps meet on one sample.
        const int64_t n = (int64_t)std::floor((t.ppq - yOrigin_) / yBeats);
        if (haveNy_ && n == ny_) return false;
        haveNy_ = true;
        ny_ = n;
        return true;
    }

    /// An axis count as an index (Random: seeded, never the same twice in a row).
    static int axisIndex(int64_t n, int cells, int direction, uint32_t seed, int axis, int& last) noexcept {
        int idx;
        if (direction == CartRandom && cells > 1) {
            const double u = dsp::uniform01(seed, (uint64_t)n, 11 + (uint64_t)axis);
            if (last >= 0 && last < cells) {
                const int r = std::min((int)(u * (cells - 1)), cells - 2);
                idx = r >= last ? r + 1 : r;
            } else {
                idx = std::min((int)(u * cells), cells - 1);
            }
        } else {
            idx = position(n, cells, direction);
        }
        last = idx;
        return idx;
    }

    template <class Emit>
    void playRaster(const CartParams& p, int offX, int offY, float transpose, double duration, Emit& emit,
                    CartOutputs& out) noexcept {
        const BuiltFor want{cols_, rows_, p.xDirection, p.yDirection, offX, offY};
        if (pathDirty_ || want != builtFor_) buildPath(cols_, rows_, p.xDirection, p.yDirection, offX, offY);
        if (pathLen_ == 0) {  // all skipped: silent, Pitch holds
            voice_.rest(emit);
            return;
        }
        const bool random = p.xDirection == CartRandom || p.yDirection == CartRandom;
        if (random) {
            const int k = cellsLen_;
            int i;
            const double u = dsp::uniform01(p.seed, (uint64_t)nx_, 13);
            if (k > 1 && lastRandom_ >= 0 && lastRandom_ < k) {
                const int r = std::min((int)(u * (k - 1)), k - 2);
                i = r >= lastRandom_ ? r + 1 : r;
            } else {
                i = std::min((int)(u * k), k - 1);
            }
            lastRandom_ = i;
            if (played_ && mod(nx_, cols_) == 0) out.rowEnd = 1.0f;
            if (played_ && mod(nx_, k) == 0) out.gridEnd = 1.0f;
            play(p, cells_[(size_t)i], transpose, duration, emit, out);
            return;
        }
        const int m = (int)mod(nx_, pathLen_);
        if (played_ && (m == 0 || path_[(size_t)m].segment != path_[(size_t)(m - 1)].segment)) out.rowEnd = 1.0f;
        if (played_ && m == 0) out.gridEnd = 1.0f;
        play(p, path_[(size_t)m].cell, transpose, duration, emit, out);
    }

    template <class Emit>
    void play(const CartParams& p, int idx, float transpose, double duration, Emit& emit, CartOutputs& out) noexcept {
        cell_ = idx;
        const CartCell& c = grid_[(size_t)idx];
        // Mod follows every visited cell, also gate-off ones.
        modTarget_ = (float)c.mod / 100.0f;
        const int64_t slew = (int64_t)std::llround(std::clamp(p.modSlew, 0.0f, 1.0f) * sampleRate_);
        if (slew <= 0) {
            modOut_ = modTarget_;
            modLeft_ = 0;
        } else {
            modStep_ = (modTarget_ - modOut_) / (float)slew;
            modLeft_ = slew;
        }
        if (c.gate == CartOff) {
            voice_.rest(emit);
            return;
        }
        const float rel = (float)(p.octave * 12 + c.pitch) + transpose * 12.0f;
        const int q = pitchOf(p.root, p.scale, rel);
        const float vel = std::clamp((float)c.velocity / 127.0f, 1.0f / 127.0f, 1.0f);
        const auto how = voice_.play(60 + q, (float)q / 12.0f, vel, c.gate == CartTie,
                                     dsp::gateSamples(duration, p.gateLength), emit);
        if (how == dsp::SeqVoice::Fresh) out.trigger = 1.0f;
    }

    template <class Emit>
    void stop(Emit& emit) noexcept {
        stopRequested_ = false;
        voice_.release(emit);
    }

    double sampleRate_ = 48000.0;
    CartGrid grid_{};
    dsp::SeqClock xClock_;
    dsp::SeqVoice voice_;
    dsp::GateEdge yEdge_, resetEdge_;
    bool configured_ = false, stopRequested_ = false, played_ = false;
    int cols_ = 4, rows_ = 4, mode_ = CartClocks, sample_ = 0, xDir_ = 0, yDir_ = 0;
    bool raster_ = true, xPatched_ = false, yPatched_ = false;
    int64_t nx_ = 0, ny_ = 0;
    int ix_ = 0, iy_ = 0, lastX_ = -1, lastY_ = -1, lastRandom_ = -1;
    bool haveNy_ = false, yPendingReset_ = false, yRunning_ = false;
    double yOrigin_ = 0.0, lastStepSamples_ = 0.0;
    int cell_ = 0;
    // Cartesian / Change
    bool havePos_ = false;
    int hx_ = 0, hy_ = 0;
    int64_t sinceChange_ = 1 << 30;
    // Mod output
    float modOut_ = 0.0f, modTarget_ = 0.0f, modStep_ = 0.0f;
    int64_t modLeft_ = 0;
    // Raster path
    std::array<PathEntry, kMaxPath> path_{};
    std::array<uint8_t, kCartCells> cells_{};
    int pathLen_ = 0, cellsLen_ = 0;
    bool pathDirty_ = true;
    BuiltFor builtFor_{};
};

}  // namespace bleep::patch
