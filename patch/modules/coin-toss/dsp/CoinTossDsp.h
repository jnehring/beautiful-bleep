// SPDX-License-Identifier: GPL-3.0-only
// Coin Toss (doc/specs/modules/coin-toss.md): two probability routers. Each rising
// edge at a channel's input tosses a weighted coin that sends the gate to A or
// B. Every toss is uniform01(seed, k, stream) for a toss counter k, so a render
// repeats exactly from the same start.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"

#include <array>
#include <cstdint>

namespace bleep::patch {

enum class CoinMode { Trigger, Latch, Toggle };
enum class CoinLink { Independent, Shared, Opposed };

struct CoinTossParams {
    std::array<float, 2> probability{0.5f, 0.5f};  ///< chance of B, 0..1
    std::array<float, 2> memory{0.0f, 0.0f};       ///< chance of repeating the last result
    std::array<CoinMode, 2> mode{CoinMode::Trigger, CoinMode::Trigger};
    CoinLink link = CoinLink::Independent;
    int loop = 0;  ///< 0 = off, else the counter runs modulo loop
    uint32_t seed = 1;
};

struct CoinTossFrame {
    std::array<float, 2> a{}, b{}, coin{};
};

class CoinTossDsp {
public:
    static constexpr std::array<int, 9> kLoops{0, 2, 3, 4, 6, 8, 12, 16, 32};

    /// The coin for toss `index` of a channel (0 or 1): pure function of the seed.
    static double coin(uint32_t seed, int64_t index, int channel) noexcept {
        return dsp::uniform01(seed, (uint64_t)index, (uint64_t)channel + 1);
    }
    /// The memory check for toss `index` (stream channel + 8, spec 4.3).
    static double memoryCheck(uint32_t seed, int64_t index, int channel) noexcept {
        return dsp::uniform01(seed, (uint64_t)index, (uint64_t)channel + 8);
    }

    CoinTossDsp() { reset(); }

    /// As a new module: counters cleared, Latch/Toggle on A.
    void reset() noexcept {
        reset_.reset();
        for (auto& c : ch_) c = Channel{};
        restart();
    }

    /// Reset input / transport start: counters to 0, outputs back to A.
    void restart() noexcept {
        for (auto& c : ch_) {
            c.k = 0;
            c.haveLast = false;
            c.lastB = false;
            c.stateB = false;
            c.armed = true;
        }
    }

    /// One sample. in1/in2 are the channel inputs (in2 already normalled to in1).
    void tick(const CoinTossParams& p, float in1, float in2, float resetIn, CoinTossFrame& out) noexcept {
        if (reset_.process(resetIn) > 0) restart();
        const float in[2] = {in1, in2};
        int edge[2];
        for (int c = 0; c < 2; ++c) {
            Channel& ch = ch_[(size_t)c];
            edge[c] = ch.edge.process(in[c]);
            if (p.mode[(size_t)c] != ch.mode) {  // mode change: low until the next edge
                ch.mode = p.mode[(size_t)c];
                ch.armed = false;
            }
        }
        if (p.link == CoinLink::Independent) {
            for (int c = 0; c < 2; ++c)
                if (edge[c] > 0) toss(c, coin(p.seed, index(ch_[(size_t)c], p), c), p);
        } else if (edge[0] > 0) {
            // One shared coin per toss on channel 1's edges; channel 2 compares
            // against its own probability (Shared) or the mirrored one (Opposed).
            const double u = coin(p.seed, index(ch_[0], p), 0);
            toss(0, u, p);
            ch_[1].k = ch_[0].k - 1;  // same counter for the memory check
            toss(1, p.link == CoinLink::Opposed ? 1.0 - u : u, p);
        }
        for (int c = 0; c < 2; ++c) {
            Channel& ch = ch_[(size_t)c];
            bool a = false, b = false;
            if (ch.armed) {
                switch (ch.mode) {
                    case CoinMode::Trigger: {
                        const bool high = ch.edge.high();
                        a = high && !ch.lastB;
                        b = high && ch.lastB;
                        break;
                    }
                    case CoinMode::Latch:
                    case CoinMode::Toggle:
                        a = !ch.stateB;
                        b = ch.stateB;
                        break;
                }
            }
            out.a[(size_t)c] = a ? 1.0f : 0.0f;
            out.b[(size_t)c] = b ? 1.0f : 0.0f;
            out.coin[(size_t)c] = ch.lastB ? 0.0f : 1.0f;
        }
    }

    bool lastB(int c) const noexcept { return ch_[(size_t)c].lastB; }
    /// The last 32 results, newest in bit 0 (1 = B).
    uint32_t history(int c) const noexcept { return ch_[(size_t)c].history; }
    /// Tosses since the last Reset (or transport start).
    int64_t count(int c) const noexcept { return ch_[(size_t)c].k; }

private:
    struct Channel {
        dsp::GateEdge edge;
        CoinMode mode = CoinMode::Trigger;
        int64_t k = 0;
        bool haveLast = false, lastB = false, stateB = false, armed = true;
        uint32_t history = 0;
    };

    static int64_t index(const Channel& ch, const CoinTossParams& p) noexcept {
        return p.loop > 0 ? ch.k % p.loop : ch.k;
    }

    /// Toss channel c with coin u: `u < probability` chooses B.
    void toss(int c, double u, const CoinTossParams& p) noexcept {
        Channel& ch = ch_[(size_t)c];
        const int64_t i = index(ch, p);
        bool b = u < (double)p.probability[(size_t)c];
        if (ch.haveLast && memoryCheck(p.seed, i, c) < (double)p.memory[(size_t)c]) b = ch.lastB;
        ++ch.k;
        ch.haveLast = true;
        ch.lastB = b;
        ch.armed = true;
        ch.history = (ch.history << 1) | (b ? 1u : 0u);
        if (ch.mode == CoinMode::Latch) ch.stateB = b;
        else if (ch.mode == CoinMode::Toggle && b) ch.stateB = !ch.stateB;
    }

    std::array<Channel, 2> ch_{};
    dsp::GateEdge reset_;
};

}  // namespace bleep::patch
