// SPDX-License-Identifier: MIT
// Shift Register (specs/modules/shift-register.md): a 16-bit looping register.
// On every step the bits move one place and the bit at Length comes back in at
// the front, flipped with probability (1 − Lock) / 2. Outputs read the bits:
// an 8-bit voltage and quantized pitch (b1 most significant), eight bit gates,
// a combined gate and a weighted mix.
//
// Flips are uniform01(seed, k, 1) for the step index k. The register is
// history, so a jump (the index isn't the previous one + 1) or a transport
// start reloads the start pattern and fast-forwards to k: a render from the
// same position is always identical.
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

enum class SrSource { Loop, Data, DataXorLoop };
enum class SrCombine { Any, All, Odd };

struct ShiftRegisterParams {
    float lock = 0.8f;        ///< −1..+1; flip chance p = (1 − lock) / 2
    float rateHz = 4.0f;      ///< free step rate (Sync Free, Clock unpatched)
    float level = 1.0f;       ///< Voltage scale
    float gateLength = 0.5f;  ///< 0.01..1 of a step
    std::array<float, 6> weight{1.0f, 0.5f, 0.25f, 0.125f, 0.0f, 0.0f};
    int length = 8;           ///< 2..16: the fed-back bit
    int sync = 2;             ///< dsp::syncNames() index (1/16)
    SrSource source = SrSource::Loop;
    SrCombine combine = SrCombine::Any;
    int octaves = 2;
    int root = 0;
    uint16_t scale = 0;       ///< scale mask (dsp::scales())
    uint32_t seed = 1;
    uint16_t start = 1;       ///< start pattern, bit 0 = b1
    uint8_t combo = 9;        ///< Combo bits, bit 0 = Bit 1
};

struct ShiftRegisterInput {
    float clock = 0.0f, reset = 0.0f, data = 0.0f, transpose = 0.0f;
    bool clockPatched = false;
    bool running = false;  ///< transport playing with a valid position
    bool started = false;  ///< first sample after the transport started
    double ppq = 0.0, bpm = 120.0;
};

struct ShiftRegisterFrame {
    float voltage = 0.0f, pitch = 0.0f, combo = 0.0f, mix = 0.0f, step = 0.0f, loop = 0.0f;
    std::array<float, 8> bit{};
};

class ShiftRegisterDsp {
public:
    static constexpr int64_t kMaxFastForward = 65536;

    /// Does the bit entering at step k flip? Pure function of (seed, k).
    static bool flips(uint32_t seed, int64_t k, float lock) noexcept {
        const double p = (1.0 - std::clamp((double)lock, -1.0, 1.0)) * 0.5;
        return dsp::uniform01(seed, (uint64_t)k, 1) < p;
    }
    /// One step of the register: shift, feed back b_length (through the source), flip.
    static uint16_t shift(uint16_t reg, int length, SrSource source, bool data, bool flip) noexcept {
        const bool out = (reg >> (std::clamp(length, 2, 16) - 1)) & 1u;
        bool in = out;
        if (source == SrSource::Data) in = data;
        else if (source == SrSource::DataXorLoop) in = out != data;
        return (uint16_t)((reg << 1) | ((in != flip) ? 1u : 0u));
    }
    /// The first eight bits as a number, b1 most significant (4.3).
    static int number(uint16_t reg) noexcept {
        int n = 0;
        for (int i = 0; i < 8; ++i) n |= ((reg >> i) & 1) << (7 - i);
        return n;
    }
    /// Pitch in volts (1 V/oct, 0 = C4) for a register number (4.3).
    static float pitchFor(int n, int octaves, int root, uint16_t scale, float transpose) noexcept {
        const float semis = (float)n / 255.0f * (float)octaves * 12.0f + transpose * 12.0f;
        return (float)(root + dsp::quantize(semis, scale)) / 12.0f;
    }
    /// The combined gate of the bits in `mask` (4.5).
    static bool combo(uint16_t reg, uint8_t mask, SrCombine how) noexcept {
        const unsigned chosen = (unsigned)(reg & mask);
        unsigned count = 0;  // set bits (std::popcount needs C++20; the app builds as C++17)
        for (unsigned b = chosen; b; b &= b - 1) ++count;
        if (mask == 0) return false;
        switch (how) {
            case SrCombine::Any: return count > 0;
            case SrCombine::All: return chosen == mask;
            case SrCombine::Odd: return (count & 1u) != 0;
        }
        return false;
    }
    /// The register at step k from the start pattern, with data 0 (4.7).
    static uint16_t fastForward(const ShiftRegisterParams& p, int64_t k, uint64_t* flipTrail = nullptr) noexcept {
        uint16_t reg = p.start;
        uint64_t trail = 0;
        for (int64_t s = std::max<int64_t>(1, k - kMaxFastForward + 1); s <= k; ++s) {
            const bool f = flips(p.seed, s, p.lock);
            reg = shift(reg, p.length, p.source, false, f);
            trail = (trail << 1) | (f ? 1u : 0u);
        }
        if (flipTrail) *flipTrail = trail;
        return reg;
    }

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
        reset();
    }

    void reset() noexcept {
        clock_.reset();
        haveStep_ = false;
        lastK_ = -1;
        pendingReset_ = false;
        phase_ = 0.0;
        reg_ = 0;
        loaded_ = false;
        trail_ = flipTrail_ = 0;
        stepSamples_ = sampleRate_ / 4.0;
        since_ = 0;
        gatesOn_ = false;
        n_ = 0;
        pitch_ = 0.0f;
    }

    /// The view's Load: the start pattern into the running register now.
    void load(uint16_t start) noexcept {
        reg_ = start;
        trail_ = start;
        flipTrail_ = 0;
        loaded_ = true;
        update(lastParams_, lastTranspose_);
    }
    /// The view toggles a live bit (0 = b1).
    void toggle(int bit) noexcept {
        if (bit < 0 || bit > 15) return;
        reg_ ^= (uint16_t)(1u << bit);
        trail_ ^= (uint64_t)1u << bit;
        update(lastParams_, lastTranspose_);
    }

    void tick(const ShiftRegisterParams& p, const ShiftRegisterInput& in, ShiftRegisterFrame& out) noexcept {
        if (!loaded_) {  // a new module starts on its start pattern
            reg_ = p.start;
            trail_ = p.start;
            loaded_ = true;
            update(p, in.transpose);
        }
        out.step = out.loop = 0.0f;
        ++since_;
        if (in.started) {
            haveStep_ = false;  // the next step reloads and fast-forwards
            if (in.clockPatched) clock_.reset();
            phase_ = 1.0;  // free: step 0 now
            lastK_ = -1;
        }
        const double beats = dsp::syncBeats(p.sync);
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
                if (e.reason == dsp::SeqClockEvent::Stop) gatesOn_ = false;
                return;
            }
            step(p, in, e.n, e.stepSamples);
        });
        if (clock_.resetEdge()) pendingReset_ = true;
        if (ci.running) {
            phase_ = dsp::wrap01(in.ppq / beats);  // a stop continues at this phase
            pendingReset_ = false;
        } else if (!in.clockPatched) {
            const double hz = beats > 0.0 ? in.bpm / 60.0 / beats : std::max((double)p.rateHz, 0.001);
            phase_ += hz / sampleRate_;
            if (!haveStep_ || phase_ >= 1.0) {
                phase_ -= std::floor(phase_);
                const int64_t k = pendingReset_ || !haveStep_ ? 0 : lastK_ + 1;
                pendingReset_ = false;
                step(p, in, k, sampleRate_ / hz);
                }
        } else {
            pendingReset_ = false;
        }

        // Gates: high from the step start for Gate Length; at 100 % they stay up across 1s.
        const bool open = gatesOn_ && (p.gateLength >= 0.999f || (double)since_ < (double)p.gateLength * stepSamples_);
        for (int i = 0; i < 8; ++i) out.bit[(size_t)i] = open && ((reg_ >> i) & 1u) ? 1.0f : 0.0f;
        out.combo = open && combo(reg_, p.combo, p.combine) ? 1.0f : 0.0f;
        out.voltage = (float)n_ / 255.0f * std::clamp(p.level, 0.0f, 1.0f);
        out.pitch = pitch_;
        float sum = 0.0f, norm = 0.0f;
        for (int i = 0; i < 6; ++i) {
            const float w = std::clamp(p.weight[(size_t)i], -1.0f, 1.0f);
            sum += w * (float)((reg_ >> i) & 1u);
            norm += std::fabs(w);
        }
        out.mix = sum / std::max(1.0f, norm);
        if (stepFired_) {
            out.step = 1.0f;
            const int len = std::clamp(p.length, 2, 16);
            if (((lastK_ % len) + len) % len == 0) out.loop = 1.0f;
            stepFired_ = false;
        }
        lastParams_ = p;
    }

    uint16_t reg() const noexcept { return reg_; }
    int64_t stepIndex() const noexcept { return lastK_; }
    /// Entered bits, newest in bit 0 (for the view's history); flips likewise.
    uint64_t trail() const noexcept { return trail_; }
    uint64_t flipTrail() const noexcept { return flipTrail_; }

private:
    void step(const ShiftRegisterParams& p, const ShiftRegisterInput& in, int64_t k, double stepSamples) noexcept {
        if (haveStep_ && k == lastK_ + 1) {
            const bool f = flips(p.seed, k, p.lock);
            reg_ = shift(reg_, p.length, p.source, in.data >= 0.5f, f);
            trail_ = (trail_ << 1) | (reg_ & 1u);
            flipTrail_ = (flipTrail_ << 1) | (f ? 1u : 0u);
        } else {  // start, Reset or a jump: the start pattern, fast-forwarded to k
            reg_ = fastForward(p, k, &flipTrail_);
            trail_ = reg_;
        }
        haveStep_ = true;
        lastK_ = k;
        stepSamples_ = std::max(1.0, stepSamples);
        since_ = 0;
        gatesOn_ = true;
        stepFired_ = true;
        update(p, in.transpose);
    }

    /// Voltage and Pitch change only on a step (or a Load / toggle).
    void update(const ShiftRegisterParams& p, float transpose) noexcept {
        lastTranspose_ = transpose;
        n_ = number(reg_);
        pitch_ = pitchFor(n_, std::clamp(p.octaves, 1, 4), p.root, p.scale, std::isfinite(transpose) ? transpose : 0.0f);
    }

    double sampleRate_ = 48000.0;
    dsp::SeqClock clock_;
    bool haveStep_ = false, pendingReset_ = false, loaded_ = false, gatesOn_ = false, stepFired_ = false;
    int64_t lastK_ = -1, since_ = 0;
    double phase_ = 0.0, stepSamples_ = 12000.0;
    uint16_t reg_ = 0;
    uint64_t trail_ = 0, flipTrail_ = 0;
    int n_ = 0;
    float pitch_ = 0.0f, lastTranspose_ = 0.0f;
    ShiftRegisterParams lastParams_;
};

}  // namespace bleep::patch
