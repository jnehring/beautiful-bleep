// SPDX-License-Identifier: GPL-3.0-only
// Lines core (doc/specs/modules/lines.md): a text-and-grid tracker. Patterns of
// 16-64 rows hold four tracks; a cell has a note, a velocity, a gate length and
// an effect (retrigger, slide, probability, transpose, jump, skip). A pattern
// order list chains the patterns. Every track runs at its own speed multiplier
// and length, so the tracks drift against each other: row positions come from
// one master position (the song position, or the Clock pulses) times each
// track's speed. Notes leave through a callback, so this stays free of the
// engine's types.
#pragma once

#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kLinesTracks = 4;
constexpr int kLinesMaxRows = 64;
constexpr int kLinesMinRows = 16;
constexpr int kLinesPatterns = 16;
constexpr int kLinesOrder = 32;
constexpr int kLinesNoteOff = 128;

/// The effect column.
enum LinesFx : uint8_t {
    FxNone = 0,
    FxRetrigger,   ///< Rxx: xx (2..16) repeats inside the row
    FxSlide,       ///< Sxx: tie into this note (legato); xx/255 of four rows of pitch glide
    FxProbability, ///< Pxx: plays with chance xx/255
    FxTranspose,   ///< Txx: xx semitones, 80..FF counting down (two's complement)
    FxJump,        ///< Jxx: the track's next row is row xx
    FxSkip,        ///< Kxx: the track skips xx rows after this one
    kFxCount
};

struct LinesCell {
    uint8_t note = 0;  ///< 0 empty, 1..127 MIDI note, 128 note off
    uint8_t vel = 0;   ///< 0 = the Velocity setting, else 1..127
    uint8_t gate = 0;  ///< 0 = the Gate setting, else 1..15 eighths of a row
    uint8_t fx = FxNone;
    uint8_t fxp = 0;
};

struct LinesPattern {
    int rows = 16;
    std::array<std::array<LinesCell, kLinesMaxRows>, kLinesTracks> cells{};
};

struct LinesSong {
    std::array<LinesPattern, kLinesPatterns> patterns{};
    std::array<uint8_t, kLinesOrder> order{};
    int orderLen = 1;
};

struct LinesParams {
    int rate = 9;               ///< a master row, as the Step Sequencer's rate list
    bool freeRun = true;        ///< tracks keep counting across patterns (else they restart with each)
    float gate = 0.5f;          ///< default gate, share of a row
    float velocity = 0.8f;      ///< default velocity
    std::array<int, kLinesTracks> speed{{5, 5, 5, 5}};  ///< speedTable() index
    std::array<int, kLinesTracks> length{{16, 16, 16, 16}};
    std::array<int, kLinesTracks> octave{};
    std::array<bool, kLinesTracks> mute{};
    int root = 0, scale = 0, scaleMask = -1;
    bool snap = false;
    uint32_t seed = 1;
};

struct LinesInputs {
    float clock = 0.0f, reset = 0.0f, transpose = 0.0f;
    bool clockPatched = false;
};

struct LinesTime {
    bool running = false, started = false;
    double bpm = 120.0, ppq = 0.0;
};

struct LinesOutputs {
    std::array<float, kLinesTracks> pitch{}, gate{}, velocity{};
    float pattern = 0.0f, end = 0.0f, row = 0.0f;
};

class LinesDsp {
public:
    static constexpr int kNumSpeeds = 10;
    static const std::array<double, kNumSpeeds>& speedTable() {
        static const std::array<double, kNumSpeeds> t{0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0};
        return t;
    }
    static const std::array<const char*, kNumSpeeds>& speedNames() {
        static const std::array<const char*, kNumSpeeds> n{"x1/4", "x1/3", "x1/2", "x2/3", "x3/4", "x1", "x3/2", "x2", "x3", "x4"};
        return n;
    }
    static int64_t mod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }
    static int64_t floorDiv(int64_t a, int64_t m) noexcept { return (a - mod(a, m)) / m; }

    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }

    void reset() noexcept {
        for (auto& t : tracks_) t = Track{};
        clock_.reset();
        reset_.reset();
        haveM_ = false;
        lastM_ = 0;
        transportOn_ = false;
        origin_ = 0;
        pendingReset_ = false;
        haveClock_ = havePulse_ = false;
        pulses_ = 0;
        sinceClock_ = 0;
        period_ = (int64_t)(sampleRate_ * 0.125);
        ordIdx_ = 0;
        localRow_ = 0;
        cycle_ = 0;
        lastPat_ = -1;
    }

    void setSong(const LinesSong* s) noexcept {
        if (s == song_) return;
        song_ = s;
    }

    int orderIndex() const noexcept { return ordIdx_; }
    int patternIndex() const noexcept { return patIdx_; }
    int localRow() const noexcept { return localRow_; }
    int trackRow(int k) const noexcept { return tracks_[(size_t)k].row; }
    bool sounding(int k) const noexcept { return tracks_[(size_t)k].sounding; }

    /// The pattern order entry and row of master row `m` (for the view and tests).
    static void locate(const LinesSong& s, int64_t m, int& ord, int& local, int64_t& cycle) noexcept {
        int total = 0;
        for (int i = 0; i < s.orderLen; ++i) total += rowsOf(s, i);
        total = std::max(total, 1);
        cycle = floorDiv(m, total);
        int r = (int)mod(m, total);
        for (int i = 0; i < s.orderLen; ++i) {
            const int n = rowsOf(s, i);
            if (r < n) {
                ord = i;
                local = r;
                return;
            }
            r -= n;
        }
        ord = 0;
        local = 0;
    }
    static int rowsOf(const LinesSong& s, int ordIdx) noexcept {
        return std::clamp(s.patterns[std::min<size_t>(s.order[(size_t)ordIdx], kLinesPatterns - 1)].rows, kLinesMinRows, kLinesMaxRows);
    }

    template <class Emit>
    void tick(const LinesParams& p, const LinesInputs& in, const LinesTime& t, LinesOutputs& out, Emit&& emit) noexcept {
        out.pattern = out.end = 0.0f;
        for (int k = 0; k < kLinesTracks; ++k) {
            Track& tr = tracks_[(size_t)k];
            tr.retrig = false;
            if (tr.sounding && --tr.remaining <= 0) {
                emit(k, false, tr.note, tr.pitch, 0.0f);
                tr.sounding = false;
            }
            if (tr.glideLeft > 0) {
                tr.cv += tr.glideStep;
                if (--tr.glideLeft == 0) tr.cv = tr.pitch;
            }
        }
        const bool resetEdge = reset_.process(in.reset) > 0;
        if (resetEdge) {
            releaseAll(emit);
            pendingReset_ = true;
        }
        const LinesSong* song = song_;
        double x = 0.0;
        bool valid = false;
        double rowSamples = sampleRate_ * 0.125;
        const double stepBeats = dsp::sequencerRateBeats(p.rate);
        if (in.clockPatched) {
            transportOn_ = false;
            ++sinceClock_;
            if (clock_.process(in.clock) > 0) {
                if (haveClock_) period_ = std::max<int64_t>(1, sinceClock_);
                haveClock_ = true;
                sinceClock_ = 0;
                pulses_ = (pendingReset_ || !havePulse_) ? 0 : pulses_ + 1;
                pendingReset_ = false;
                havePulse_ = true;
            }
            if (havePulse_) {
                x = (double)pulses_ + std::min(0.999, (double)sinceClock_ / (double)std::max<int64_t>(1, period_));
                valid = true;
                rowSamples = (double)period_;
            }
        } else if (t.running) {
            const double raw = t.ppq / stepBeats;
            rowSamples = stepBeats * 60.0 / std::max(t.bpm, 1.0) * sampleRate_;
            if (t.started || !transportOn_) {
                origin_ = 0;
                haveM_ = false;
                pendingReset_ = false;
            }
            transportOn_ = true;
            if (pendingReset_) {
                origin_ = (int64_t)std::floor(raw) + 1;  // the next boundary is row 0
                pendingReset_ = false;
                haveM_ = false;
            }
            x = raw - (double)origin_;
            valid = x >= 0.0;
        } else if (transportOn_) {
            transportOn_ = false;
            haveM_ = false;
            releaseAll(emit);
        }
        if (!in.clockPatched) havePulse_ = false;

        if (valid && song != nullptr) {
            const int64_t m = (int64_t)std::floor(x);
            if (haveM_ && m != lastM_ && m != lastM_ + 1) resync(emit);  // a jump: no catching up
            haveM_ = true;
            lastM_ = m;
            int ord = 0, local = 0;
            int64_t cycle = 0;
            locate(*song, m, ord, local, cycle);
            const bool newPat = ord != ordIdx_ || cycle != cycle_ || lastPat_ < 0;
            if (newPat) {
                if (lastPat_ >= 0) {
                    out.pattern = 1.0f;
                    if (ord == 0) out.end = 1.0f;
                }
                for (auto& tr : tracks_) {
                    if (!p.freeRun) tr.off = 0, tr.lastKey = kNoKey;
                }
            }
            ordIdx_ = ord;
            cycle_ = cycle;
            localRow_ = local;
            patIdx_ = std::min<int>(song->order[(size_t)ord], kLinesPatterns - 1);
            lastPat_ = patIdx_;
            const LinesPattern& pat = song->patterns[(size_t)patIdx_];
            const int rows = std::clamp(pat.rows, kLinesMinRows, kLinesMaxRows);
            const double frac = x - (double)m;
            const double lx = (double)local + frac;
            out.row = (float)lx / (float)rows;

            for (int k = 0; k < kLinesTracks; ++k) {
                Track& tr = tracks_[(size_t)k];
                const double sp = speedTable()[(size_t)std::clamp(p.speed[(size_t)k], 0, kNumSpeeds - 1)];
                const double q = (p.freeRun ? x : lx) * sp;
                const int64_t s = (int64_t)std::floor(q);
                const int64_t key = p.freeRun ? s : (((cycle * kLinesOrder + ord) << 12) | (s & 0xfff));
                const int len = std::clamp(std::min(p.length[(size_t)k], rows), 1, kLinesMaxRows);
                if (key != tr.lastKey) {
                    tr.lastKey = key;
                    const int row = (int)mod(s + tr.off, len);
                    tr.row = row;
                    tr.rowSamples = rowSamples / sp;
                    if (!p.mute[(size_t)k]) startRow(p, in, k, tr, pat.cells[(size_t)k][(size_t)row], s, len, emit);
                }
                // retriggers of the running row
                if (tr.ratchLeft > 0 && ++tr.ratchElapsed >= (int64_t)std::llround((double)tr.ratchIdx * tr.ratchSub)) {
                    ++tr.ratchIdx;
                    --tr.ratchLeft;
                    playNote(k, tr, tr.rNote, tr.rVel, std::max<int64_t>(1, (int64_t)std::llround(tr.ratchSub * tr.rGate)), false, 0, emit);
                }
            }
        }
        for (int k = 0; k < kLinesTracks; ++k) {
            const Track& tr = tracks_[(size_t)k];
            out.pitch[(size_t)k] = tr.cv;
            out.gate[(size_t)k] = tr.sounding && !tr.retrig ? 1.0f : 0.0f;
            out.velocity[(size_t)k] = tr.vel;
        }
    }

    template <class Emit>
    void releaseAll(Emit&& emit) noexcept {
        for (int k = 0; k < kLinesTracks; ++k) {
            Track& tr = tracks_[(size_t)k];
            if (tr.sounding) emit(k, false, tr.note, tr.pitch, 0.0f);
            tr.sounding = false;
            tr.ratchLeft = 0;
        }
    }

private:
    static constexpr int64_t kNoKey = INT64_MIN;
    struct Track {
        bool sounding = false, retrig = false;
        int note = 0, row = 0;
        float pitch = 0.0f, cv = 0.0f, vel = 0.0f;  ///< pitch: the note; cv: the Pitch output (glides)
        int64_t remaining = 0, lastKey = kNoKey, off = 0;
        float glideStep = 0.0f;
        int64_t glideLeft = 0;
        double rowSamples = 6000.0;
        int ratchLeft = 0, ratchIdx = 1, rNote = 60;
        int64_t ratchElapsed = 0;
        double ratchSub = 0.0;
        float rVel = 0.0f, rGate = 0.5f;
    };

    template <class Emit>
    void resync(Emit& emit) noexcept {
        releaseAll(emit);
        for (auto& tr : tracks_) tr.lastKey = kNoKey, tr.off = 0;
    }

    template <class Emit>
    void playNote(int k, Track& tr, int note, float vel, int64_t len, bool slide, int64_t glide, Emit& emit) noexcept {
        const float pitch = (float)(note - 60) / 12.0f;
        if (tr.sounding) {
            if (slide) {
                if (note != tr.note) {
                    emit(k, true, note, pitch, vel);
                    emit(k, false, tr.note, tr.pitch, 0.0f);
                }
            } else {
                emit(k, false, tr.note, tr.pitch, 0.0f);
                emit(k, true, note, pitch, vel);
                tr.retrig = true;
            }
        } else {
            emit(k, true, note, pitch, vel);
        }
        if (slide && glide > 0 && std::fabs(tr.cv - pitch) > 1e-9f) {
            tr.glideLeft = glide;
            tr.glideStep = (pitch - tr.cv) / (float)glide;
        } else {
            tr.glideLeft = 0;
            tr.cv = pitch;
        }
        tr.note = note;
        tr.pitch = pitch;
        tr.vel = vel;
        tr.remaining = std::max<int64_t>(1, len);
        tr.sounding = true;
    }

    template <class Emit>
    void startRow(const LinesParams& p, const LinesInputs& in, int k, Track& tr, const LinesCell& c, int64_t s, int len, Emit& emit) noexcept {
        tr.ratchLeft = 0;
        const int fxp = c.fxp;
        if (c.fx == FxJump) tr.off = (int64_t)std::min(fxp, len - 1) - (s + 1);
        else if (c.fx == FxSkip) tr.off += fxp;
        if (c.note == 0) return;
        if (c.note == kLinesNoteOff) {
            if (tr.sounding) emit(k, false, tr.note, tr.pitch, 0.0f);
            tr.sounding = false;
            return;
        }
        if (c.fx == FxProbability && dsp::uniform01(p.seed, (uint64_t)s * 4u + (uint64_t)k, 31) * 255.0 >= (double)fxp) return;
        int note = (int)c.note + p.octave[(size_t)k] * 12 + (int)std::lround(in.transpose * 12.0f);
        if (c.fx == FxTranspose) note += fxp >= 128 ? fxp - 256 : fxp;
        if (p.snap) {
            const auto& sc = dsp::scales()[(size_t)std::clamp(p.scale, 0, (int)dsp::scales().size() - 1)];
            const uint16_t mask = p.scaleMask >= 0 ? (uint16_t)p.scaleMask : sc.mask;
            note = 60 + p.root + dsp::quantize((float)(note - 60 - p.root), mask);
        }
        note = std::clamp(note, 0, 127);
        const float vel = c.vel > 0 ? (float)c.vel / 127.0f : std::clamp(p.velocity, 1.0f / 127.0f, 1.0f);
        const float gateRows = c.gate > 0 ? (float)c.gate / 8.0f : p.gate;
        const int64_t len1 = std::max<int64_t>(1, (int64_t)std::llround((double)gateRows * tr.rowSamples));
        if (c.fx == FxRetrigger) {
            const int n = std::clamp(fxp, 2, 16);
            tr.ratchSub = tr.rowSamples / n;
            tr.ratchIdx = 1;
            tr.ratchLeft = n - 1;
            tr.ratchElapsed = 0;
            tr.rNote = note;
            tr.rVel = vel;
            tr.rGate = std::min(gateRows, 1.0f);
            playNote(k, tr, note, vel, std::max<int64_t>(1, (int64_t)std::llround(tr.ratchSub * tr.rGate)), false, 0, emit);
            return;
        }
        const bool slide = c.fx == FxSlide;
        const int64_t glide = slide ? (int64_t)std::llround((double)fxp / 255.0 * 4.0 * tr.rowSamples) : 0;
        playNote(k, tr, note, vel, len1, slide, glide, emit);
    }

    double sampleRate_ = 48000.0;
    const LinesSong* song_ = nullptr;
    std::array<Track, kLinesTracks> tracks_{};
    dsp::GateEdge clock_, reset_;
    bool haveM_ = false, transportOn_ = false, pendingReset_ = false, haveClock_ = false, havePulse_ = false;
    int64_t lastM_ = 0, origin_ = 0, pulses_ = 0, sinceClock_ = 0, period_ = 6000, cycle_ = 0;
    int ordIdx_ = 0, localRow_ = 0, patIdx_ = 0, lastPat_ = -1;
};

}  // namespace bleep::patch
