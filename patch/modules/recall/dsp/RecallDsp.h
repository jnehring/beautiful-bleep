// SPDX-License-Identifier: GPL-3.0-or-later
// Recall (doc/specs/modules/recall.md): random gates (T) and random voltages (X)
// on one clock, each with a ring of its last Loop decisions. Recall is the
// chance that a decision repeats the one from Loop ticks ago, so the section
// moves from always new, through variations, to a locked loop. The rings hold
// raw uniforms, so Bias, Spread, Steps, Scale and T Mode still re-shape a
// locked loop. A captured loop (node data) replaces the ring entirely.
//
// Fresh decisions are uniform01(seed, index, stream); a transport start or a
// jump rebuilds the rings by replaying the last 4,096 ticks, so a render from
// the same position is always identical.
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

constexpr int kRecallSlots = 16;
constexpr int kRecallT = 4;  ///< uniforms per T decision
constexpr int kRecallX = 9;  ///< uniforms per X decision (three values of three)

enum class RecallTMode { Coin, Chance, Ratchet, Drums };
enum class RecallXSource { Tick, T1, T2, External };
enum class RecallXRange { Bipolar, Unipolar, Wide };

/// Random streams (spec 4.5: T, X and the repeat tests never influence each other).
namespace rstream {
constexpr uint64_t kTFresh = 100, kTRepeat = 110, kXFresh = 200, kXRepeat = 210, kTPad = 300, kXPad = 400;
}

/// Captured loops from the node data (spec 6). Rows may be short or missing:
/// count[slot] numbers are stored, the rest are padded from the seed.
struct RecallCapture {
    bool use = false;
    int length = 0;  ///< rows stored
    std::array<std::array<float, kRecallX>, kRecallSlots> values{};
    std::array<uint8_t, kRecallSlots> count{};
};
struct RecallCaptures {
    RecallCapture t, x;
};

struct RecallParams {
    float tBias = 0.5f, tJitter = 0.0f, tRecall = 0.0f, gateLength = 0.5f;
    float xSpread = 0.6f, xBias = 0.5f, xSteps = 0.5f, xRecall = 0.0f;
    float rateHz = 4.0f;
    int sync = 11;  ///< index into syncNames() below; 0 = Free
    RecallTMode tMode = RecallTMode::Coin;
    int tLoop = 8;
    RecallXSource xSource = RecallXSource::Tick;
    bool sorted = false;
    RecallXRange xRange = RecallXRange::Bipolar;
    int xLoop = 8;
    int root = 0;
    uint16_t scale = 0x0ab5;  ///< Major
    uint32_t seed = 1;
    const RecallCaptures* captured = nullptr;
};

struct RecallInput {
    float clock = 0.0f, reset = 0.0f, xClock = 0.0f;
    bool clockPatched = false, xClockPatched = false;
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    double ppq = 0.0, bpm = 120.0;
};

struct RecallFrame {
    float t1 = 0.0f, t2 = 0.0f, clock = 0.0f, xTrig = 0.0f;
    std::array<float, 3> x{};
};

class RecallDsp {
public:
    static constexpr int kReplayTicks = 4096;

    // ---- the rate list: Free, 2 bars, then the Step Sequencer's rates -------------
    static int numSyncs() noexcept { return 2 + dsp::kNumSequencerRates; }
    static const char* syncName(int i) noexcept {
        if (i <= 0) return "Free";
        if (i == 1) return "2 bars";
        return dsp::sequencerRate(i - 2).name;
    }
    static double syncBeats(int i) noexcept {
        if (i <= 0) return 0.0;
        if (i == 1) return 8.0;
        return dsp::sequencerRateBeats(i - 2);
    }

    // ---- pure helpers ---------------------------------------------------------------

    /// Drums (4.2): metric weights for a 16-tick bar (our own table).
    static float kickWeight(int pos) noexcept {
        static constexpr float w[16] = {1.0f, 0.05f, 0.1f, 0.05f, 0.35f, 0.05f, 0.15f, 0.05f,
                                        1.0f, 0.05f, 0.1f, 0.05f, 0.35f, 0.05f, 0.2f,  0.1f};
        return w[pos & 15];
    }
    static float snareWeight(int pos) noexcept {
        static constexpr float w[16] = {0.05f, 0.05f, 0.3f, 0.05f, 1.0f, 0.05f, 0.3f, 0.05f,
                                        0.05f, 0.05f, 0.3f, 0.05f, 1.0f, 0.05f, 0.3f, 0.1f};
        return w[pos & 15];
    }
    /// Ratchet (4.2): u picks one of ÷4, ÷3, ÷2, ×1, ×2, ×3, ×4, weighted around
    /// bias·6 (divisions left, multiplications right). Returns −4..−2 for
    /// divisions, 1..4 for ×1..×4.
    static int ratchet(double u, double bias) noexcept {
        static constexpr int rates[7] = {-4, -3, -2, 1, 2, 3, 4};
        const double c = std::clamp(bias, 0.0, 1.0) * 6.0;
        double w[7], sum = 0.0;
        for (int j = 0; j < 7; ++j) sum += w[j] = std::exp(-0.5 * (j - c) * (j - c) / (1.1 * 1.1));
        double acc = 0.0;
        for (int j = 0; j < 7; ++j)
            if (u * sum < (acc += w[j])) return rates[j];
        return rates[6];
    }
    static int64_t floorMod(int64_t a, int64_t m) noexcept { return ((a % m) + m) % m; }

    /// What a T decision fires on tick i: pulses per output (0 = none) and
    /// whether it is a multiplication (pulses spread over the tick).
    struct TFire {
        int count[2] = {0, 0};
    };
    static TFire tFire(const std::array<float, kRecallT>& u, int64_t tick, RecallTMode mode, double bias) noexcept {
        TFire f;
        switch (mode) {
            case RecallTMode::Coin:
                f.count[u[0] < bias ? 0 : 1] = 1;
                break;
            case RecallTMode::Chance:
                f.count[0] = u[0] < bias;
                f.count[1] = u[1] < bias;
                break;
            case RecallTMode::Ratchet:
                for (int k = 0; k < 2; ++k) {
                    const int r = ratchet(u[(size_t)k], bias);
                    f.count[k] = r > 0 ? r : floorMod(tick, -r) == 0 ? 1 : 0;
                }
                break;
            case RecallTMode::Drums: {
                const int pos = (int)floorMod(tick, 16);
                f.count[0] = u[0] < std::min(1.0, 2.0 * bias * kickWeight(pos));
                f.count[1] = u[1] < std::min(1.0, 2.0 * bias * snareWeight(pos));
                break;
            }
        }
        return f;
    }

    /// Scale degrees dropped as Steps rises from 70 % to 100 % (4.3): for seven
    /// notes the 2nd, 6th, 4th, 7th, 3rd, 5th; otherwise the outermost first.
    static uint16_t thinnedScale(uint16_t mask, double steps) noexcept {
        if ((mask & 0xfff) == 0) mask = 0xfff;
        int notes[12], n = 0;
        for (int s = 0; s < 12; ++s)
            if ((mask >> s) & 1) notes[n++] = s;
        if (steps <= 0.70 || n <= 1) return mask;
        const int drop = std::min(n - 1, (int)std::floor((steps - 0.70) / 0.30 * (double)(n - 1) + 1e-9));
        int order[11], m = 0;
        if (n == 7) {
            static constexpr int seven[6] = {2, 6, 4, 7, 3, 5};
            for (int d : seven) order[m++] = d;
        } else {
            for (int lo = 2, hi = n; lo <= hi;) {  // n, 2, n − 1, 3, …
                order[m++] = hi--;
                if (lo <= hi) order[m++] = lo++;
            }
        }
        uint16_t out = mask;
        for (int k = 0; k < drop; ++k) out = (uint16_t)(out & ~(1u << notes[order[k] - 1]));
        return out;
    }

    /// One X value from three raw uniforms, mapped to the output range and, with
    /// Steps above 55 %, quantized (4.3). Returns volts.
    static float shapeX(float u0, float u1, float u2, const RecallParams& p) noexcept {
        const double v = dsp::spreadBias(u0, u1, u2, p.xSpread, p.xBias);
        return quantizeX(rangeX(v, p.xRange), p);
    }
    static float rangeX(double v, RecallXRange r) noexcept {
        switch (r) {
            case RecallXRange::Unipolar: return (float)(0.5 * (v + 1.0));
            case RecallXRange::Wide: return (float)(2.0 * v);
            case RecallXRange::Bipolar: break;
        }
        return (float)v;
    }
    static float quantizeX(float volts, const RecallParams& p) noexcept {
        if (p.xSteps <= 0.55f) return volts;
        const uint16_t mask = thinnedScale(p.scale, p.xSteps);
        return (float)(p.root + dsp::quantize(volts * 12.0f - (float)p.root, mask)) / 12.0f;
    }

    // ---- running ------------------------------------------------------------------------

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
        reset();
    }

    void reset() noexcept {
        clock_.reset();
        xEdge_.reset();
        haveTick_ = pendingReset_ = false;
        lastTick_ = -1;
        phase_ = 0.0;
        tickSamples_ = sampleRate_ / 4.0;
        now_ = 0;
        clearRings();
        for (auto& o : out_) o = Output{};
        xCount_ = 0;
        lastDraw_ = 0;
        drawInterval_ = tickSamples_;
        for (auto& g : glide_) g = Glide{};
        laneWrite_ = drawWrite_ = 0;
        lanes_.fill(0);
        for (auto& d : draws_) d.fill(0.0f);
        tSnapshot_ = {};
        xSnapshot_ = {};
    }

    /// Capture (5): copies the section's ring (Loop slots) for the view.
    void captureT(const RecallParams& p) noexcept { snapshotOf(tRing_, tFilled_, p.tLoop, rstream::kTFresh, p, tSnapshot_); }
    void captureX(const RecallParams& p) noexcept { snapshotOf(xRing_, xFilled_, p.xLoop, rstream::kXFresh, p, xSnapshot_); }
    struct Snapshot {
        int length = 0;
        std::array<std::array<float, kRecallX>, kRecallSlots> values{};
    };
    const Snapshot& tSnapshot() const noexcept { return tSnapshot_; }
    const Snapshot& xSnapshot() const noexcept { return xSnapshot_; }

    void tick(const RecallParams& p, const RecallInput& in, RecallFrame& f) noexcept {
        f.clock = f.xTrig = 0.0f;
        ++now_;
        externalPatched_ = in.xClockPatched;
        if (in.started) {
            haveTick_ = false;  // the next tick rebuilds the rings
            phase_ = 1.0;
            if (in.clockPatched) clock_.reset();
        }
        const double beats = syncBeats(p.sync);
        dsp::SeqClockInput ci;
        ci.clocked = in.clockPatched;
        ci.clock = in.clock;
        ci.reset = in.reset;
        ci.running = in.running && beats > 0.0;
        ci.started = in.started;
        ci.ppq = in.ppq;
        ci.bpm = in.bpm;
        ci.stepBeats = beats > 0.0 ? beats : 0.25;
        clock_.tick(ci, [&](const dsp::SeqClockEvent& e) {
            if (e.type == dsp::SeqClockEvent::Release) {
                if (e.reason == dsp::SeqClockEvent::Stop)
                    for (auto& o : out_) o.count = 0;  // T gates fall
                return;
            }
            if (clock_.resetEdge()) resetNext_ = true;  // Reset and a pulse on one sample
            onTick(p, e.n, e.stepSamples, f);
        });
        if (clock_.resetEdge()) resetNext_ = pendingReset_ = true;
        if (ci.running) {
            phase_ = dsp::wrap01(in.ppq / beats);
            pendingReset_ = false;
        } else if (!in.clockPatched) {
            const double hz = beats > 0.0 ? in.bpm / 60.0 / beats : std::clamp((double)p.rateHz, 0.01, 1000.0);
            phase_ += hz / sampleRate_;
            if (!haveTick_ || phase_ >= 1.0) {
                phase_ -= std::floor(phase_);
                const int64_t k = pendingReset_ || !haveTick_ ? 0 : lastTick_ + 1;
                pendingReset_ = false;
                onTick(p, k, sampleRate_ / hz, f);
            }
        } else {
            pendingReset_ = false;
        }

        // T outputs; X draws on their pulse starts when X Source is T1 / T2.
        bool xDraw = false;
        for (int k = 0; k < 2; ++k) {
            bool starting = false;
            const bool high = out_[(size_t)k].gate(now_, starting);
            const bool level = high && !(starting && out_[(size_t)k].wasHigh);  // a 1-sample gap retriggers
            out_[(size_t)k].wasHigh = level;
            (k == 0 ? f.t1 : f.t2) = level ? 1.0f : 0.0f;
            if (starting && ((k == 0 && p.xSource == RecallXSource::T1) || (k == 1 && p.xSource == RecallXSource::T2)))
                xDraw = true;
        }
        if (p.xSource == RecallXSource::External && in.xClockPatched) {
            if (xEdge_.process(in.xClock) > 0) xDraw = true;
        } else {
            xEdge_.process(in.xClock);
        }
        if (xDraw) draw(p, xCount_++, f);

        // X outputs: glide (Steps < 45 %) or hold.
        for (int k = 0; k < 3; ++k) {
            Glide& g = glide_[(size_t)k];
            if (g.length > 0 && g.pos < g.length) {
                ++g.pos;
                const double t = (double)g.pos / (double)g.length;
                g.value = g.from + (g.to - g.from) * (float)(0.5 - 0.5 * std::cos(3.14159265358979 * t));
            } else {
                g.value = g.to;
            }
            f.x[(size_t)k] = std::clamp(g.value, -10.0f, 10.0f);
        }
    }

    // ---- live state for the view ----------------------------------------------------
    /// The last 16 ticks, newest last: bit 0 T1 fired, bit 1 T2, bit 2 repeated, bit 3 captured.
    std::array<uint8_t, 16> lanes() const noexcept {
        std::array<uint8_t, 16> out{};
        for (int i = 0; i < 16; ++i) out[(size_t)i] = lanes_[(size_t)((laneWrite_ + i) % 16)];
        return out;
    }
    /// The last 32 draws (volts, newest last), per output.
    float draw(int output, int i) const noexcept { return draws_[(size_t)output][(size_t)((drawWrite_ + i) % 32)]; }
    int64_t tickIndex() const noexcept { return lastTick_; }

private:
    struct Pulse {
        int64_t start = 0, end = 0;
    };
    struct Output {
        std::array<Pulse, 8> pulse{};
        int count = 0;
        bool wasHigh = false;
        void add(int64_t start, int64_t length) noexcept {  // gate() drops finished pulses
            if (count < (int)pulse.size()) pulse[(size_t)count++] = {start, start + std::max<int64_t>(1, length)};
        }
        bool gate(int64_t now, bool& starting) noexcept {
            bool high = false;
            int w = 0;
            for (int i = 0; i < count; ++i) {
                const Pulse& q = pulse[(size_t)i];
                if (now >= q.end) continue;  // finished
                pulse[(size_t)w++] = q;
                if (now >= q.start) high = true;
                if (now == q.start) starting = true;
            }
            count = w;
            return high;
        }
    };
    struct Glide {
        float from = 0.0f, to = 0.0f, value = 0.0f;
        int64_t pos = 0, length = 0;
    };

    void clearRings() noexcept {
        tFilled_.fill(false);
        xFilled_.fill(false);
    }

    /// A captured row's number j (padded from the seed past what was stored).
    static float capturedValue(const RecallCapture& c, int slot, int j, uint32_t seed, uint64_t padStream) noexcept {
        if (slot < c.length && j < c.count[(size_t)slot]) return c.values[(size_t)slot][(size_t)j];
        return (float)dsp::uniform01(seed, (uint64_t)slot, padStream + (uint64_t)j);
    }

    /// One section's decision for index i (4.4): captured, repeated or fresh.
    template <size_t N>
    static void decide(std::array<std::array<float, N>, kRecallSlots>& ring, std::array<bool, kRecallSlots>& filled,
                       int64_t i, int loop, float recall, const RecallCapture* cap, uint64_t fresh, uint64_t repeat,
                       uint64_t pad, uint32_t seed, std::array<float, N>& out, bool& repeated, bool& captured) noexcept {
        loop = std::clamp(loop, 1, kRecallSlots);
        const int slot = (int)floorMod(i, loop);
        repeated = captured = false;
        if (cap && cap->use) {
            for (size_t j = 0; j < N; ++j) out[j] = capturedValue(*cap, slot, (int)j, seed, pad);
            captured = true;
            return;
        }
        if (filled[(size_t)slot] && dsp::uniform01(seed, (uint64_t)i, repeat) < (double)recall) {
            out = ring[(size_t)slot];
            repeated = true;
            return;
        }
        for (size_t j = 0; j < N; ++j) out[j] = (float)dsp::uniform01(seed, (uint64_t)i, fresh + j);
        ring[(size_t)slot] = out;
        filled[(size_t)slot] = true;
    }

    void decideT(const RecallParams& p, int64_t i, std::array<float, kRecallT>& u, bool& rep, bool& cap) noexcept {
        decide(tRing_, tFilled_, i, p.tLoop, p.tRecall, p.captured ? &p.captured->t : nullptr, rstream::kTFresh,
               rstream::kTRepeat, rstream::kTPad, p.seed, u, rep, cap);
    }
    void decideX(const RecallParams& p, int64_t j, std::array<float, kRecallX>& u, bool& rep, bool& cap) noexcept {
        decide(xRing_, xFilled_, j, p.xLoop, p.xRecall, p.captured ? &p.captured->x : nullptr, rstream::kXFresh,
               rstream::kXRepeat, rstream::kXPad, p.seed, u, rep, cap);
    }

    /// A start or a jump: replay the last ticks so the rings are what playing
    /// through (with the current knobs) would have left (4.5).
    void rebuild(const RecallParams& p, int64_t tick) noexcept {
        clearRings();
        xCount_ = 0;
        std::array<float, kRecallT> u{};
        std::array<float, kRecallX> x{};
        bool rep = false, cap = false;
        for (int64_t s = std::max<int64_t>(0, tick - kReplayTicks); s < tick; ++s) {
            decideT(p, s, u, rep, cap);
            if (p.xSource == RecallXSource::Tick) {
                decideX(p, s, x, rep, cap);
            } else if (p.xSource == RecallXSource::T1 || p.xSource == RecallXSource::T2) {
                const TFire fire = tFire(u, s, p.tMode, p.tBias);
                for (int n = fire.count[p.xSource == RecallXSource::T1 ? 0 : 1]; n > 0; --n) decideX(p, xCount_++, x, rep, cap);
            }
        }
    }

    void onTick(const RecallParams& p, int64_t i, double tickSamples, RecallFrame& f) noexcept {
        tickSamples = std::max(1.0, tickSamples);
        // Reset: slot 0 again, the memory stays. A start or a jump: rebuild.
        if (!haveTick_ || (i != lastTick_ + 1 && !resetNext_)) rebuild(p, i);
        resetNext_ = false;
        haveTick_ = true;
        lastTick_ = i;
        tickSamples_ = tickSamples;
        f.clock = 1.0f;

        std::array<float, kRecallT> u{};
        bool rep = false, cap = false;
        decideT(p, i, u, rep, cap);
        const TFire fire = tFire(u, i, p.tMode, p.tBias);
        const double jitter = std::clamp((double)p.tJitter, 0.0, 1.0) * 0.5 * tickSamples;
        const double gl = std::clamp((double)p.gateLength, 0.01, 1.0);
        for (int k = 0; k < 2; ++k) {
            const int n = fire.count[k];
            if (n <= 0) continue;
            const int64_t delay = (int64_t)std::llround(u[(size_t)(2 + k)] * jitter);
            const double spacing = tickSamples / n;  // ×n: evenly spaced sub-pulses
            for (int s = 0; s < n; ++s)
                out_[(size_t)k].add(now_ + delay + (int64_t)std::llround(s * spacing), (int64_t)std::llround(gl * spacing));
        }
        lanes_[(size_t)laneWrite_] = (uint8_t)((fire.count[0] > 0 ? 1 : 0) | (fire.count[1] > 0 ? 2 : 0) | (rep ? 4 : 0) | (cap ? 8 : 0));
        laneWrite_ = (laneWrite_ + 1) % 16;

        if (p.xSource == RecallXSource::Tick || (p.xSource == RecallXSource::External && !externalPatched_)) {
            draw(p, i, f);
        }
    }

    /// X draws three values (4.3).
    void draw(const RecallParams& p, int64_t j, RecallFrame& f) noexcept {
        std::array<float, kRecallX> u{};
        bool rep = false, cap = false;
        decideX(p, j, u, rep, cap);
        float v[3];
        for (int k = 0; k < 3; ++k) v[k] = shapeX(u[(size_t)(3 * k)], u[(size_t)(3 * k + 1)], u[(size_t)(3 * k + 2)], p);
        if (p.sorted) std::sort(v, v + 3);
        // Glide over (45 % − Steps) / 45 % of the time to the next draw.
        const int64_t since = now_ - lastDraw_;
        lastDraw_ = now_;
        if (p.xSource != RecallXSource::Tick && since > 0 && since < (int64_t)(sampleRate_ * 60.0)) drawInterval_ = (double)since;
        const double interval = p.xSource == RecallXSource::Tick ? tickSamples_ : drawInterval_;
        const double share = p.xSteps < 0.45f ? (0.45 - p.xSteps) / 0.45 : 0.0;
        for (int k = 0; k < 3; ++k) {
            Glide& g = glide_[(size_t)k];
            g.from = g.value;
            g.to = v[k];
            g.pos = 0;
            g.length = (int64_t)(share * interval);
            draws_[(size_t)k][(size_t)drawWrite_] = v[k];
        }
        drawWrite_ = (drawWrite_ + 1) % 32;
        f.xTrig = 1.0f;
    }

    template <size_t N>
    static void snapshotOf(const std::array<std::array<float, N>, kRecallSlots>& ring, const std::array<bool, kRecallSlots>& filled,
                           int loop, uint64_t fresh, const RecallParams& p, Snapshot& out) noexcept {
        loop = std::clamp(loop, 1, kRecallSlots);
        out.length = loop;
        for (int s = 0; s < loop; ++s)
            for (size_t j = 0; j < N; ++j)
                out.values[(size_t)s][j] = filled[(size_t)s] ? ring[(size_t)s][j] : (float)dsp::uniform01(p.seed, (uint64_t)s, fresh + j);
    }
    double sampleRate_ = 48000.0;
    dsp::SeqClock clock_;
    dsp::GateEdge xEdge_;
    bool haveTick_ = false, pendingReset_ = false, resetNext_ = false, externalPatched_ = false;
    int64_t lastTick_ = -1, now_ = 0;
    double phase_ = 0.0, tickSamples_ = 12000.0;
    std::array<std::array<float, kRecallT>, kRecallSlots> tRing_{};
    std::array<std::array<float, kRecallX>, kRecallSlots> xRing_{};
    std::array<bool, kRecallSlots> tFilled_{}, xFilled_{};
    std::array<Output, 2> out_{};
    int64_t xCount_ = 0, lastDraw_ = 0;
    double drawInterval_ = 12000.0;
    std::array<Glide, 3> glide_{};
    std::array<uint8_t, 16> lanes_{};
    int laneWrite_ = 0;
    std::array<std::array<float, 32>, 3> draws_{};
    int drawWrite_ = 0;
    Snapshot tSnapshot_, xSnapshot_;
};

}  // namespace bleep::patch
