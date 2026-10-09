// SPDX-License-Identifier: MIT
// Rhythm Bank core (doc/specs/modules/rhythm-bank.md): four related rhythms from
// (Family, Pattern, Length). rbPattern() builds the raw rows (a pure
// function, O(L) per output, no allocation); RhythmBankDsp steps through
// them with the Step Sequencer's clock (SeqClock), applying rotation, mute
// and Complement per step, and plays gates or triggers.
#pragma once

#include "dsp/Random.h"
#include "dsp/SeqClock.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numeric>

namespace bleep::patch {

enum RbFamily { RbEven = 0, RbPrime, RbMetric, RbPoly, RbInterlock, RbSeeded };
enum RbComplement { RbOff = 0, RbAvoid, RbFill, RbPairs };

constexpr int kRbOutputs = 4;
constexpr int kRbMaxLength = 32;
constexpr int kRbOpenCycle = 16;  ///< cycle of the families that need one with Length = Open
constexpr int kRbPatterns = 128;

/// E(k, n): slot m is a hit when (m · k) mod n < k.
inline bool rbEuclid(int k, int n, int m) noexcept {
    if (n <= 0 || k <= 0) return false;
    k = std::min(k, n);
    m = ((m % n) + n) % n;
    return ((int64_t)m * k) % n < k;
}

/// Metric strength s(i) for a cycle of L steps (4.1).
inline int rbStrength(int L, int i) noexcept {
    L = std::max(1, L);
    i = ((i % L) + L) % L;
    int m = L, s = (i % m == 0) ? 1 : 0;
    int f = 2;
    while (m > 1) {
        while (m % f != 0) ++f;
        m /= f;
        if (i % m == 0) ++s;
    }
    return s;
}

/// The 15 four-element subsets of {2, 3, 5, 7, 11, 13}, lexicographic.
inline const std::array<std::array<int, 4>, 15>& rbPrimeSets() {
    static const std::array<std::array<int, 4>, 15> sets = [] {
        std::array<std::array<int, 4>, 15> s{};
        const int q[6] = {2, 3, 5, 7, 11, 13};
        int n = 0;
        for (int a = 0; a < 6; ++a)
            for (int b = a + 1; b < 6; ++b)
                for (int c = b + 1; c < 6; ++c)
                    for (int d = c + 1; d < 6; ++d) s[(size_t)n++] = {q[a], q[b], q[c], q[d]};
        return s;
    }();
    return sets;
}

/// Poly: the 64 simplest ascending four-number sets of {2…9} (sorted by
/// lcm, then lexicographically).
inline const std::array<std::array<int, 4>, 64>& rbPolySets() {
    static const std::array<std::array<int, 4>, 64> sets = [] {
        struct Entry {
            std::array<int, 4> v;
            int lcm;
        };
        std::array<Entry, 70> all{};
        int n = 0;
        for (int a = 2; a <= 9; ++a)
            for (int b = a + 1; b <= 9; ++b)
                for (int c = b + 1; c <= 9; ++c)
                    for (int d = c + 1; d <= 9; ++d) {
                        const int l = std::lcm(std::lcm(a, b), std::lcm(c, d));
                        all[(size_t)n++] = {{a, b, c, d}, l};
                    }
        std::sort(all.begin(), all.end(), [](const Entry& x, const Entry& y) {
            return x.lcm != y.lcm ? x.lcm < y.lcm : x.v < y.v;
        });
        std::array<std::array<int, 4>, 64> s{};
        for (int i = 0; i < 64; ++i) s[(size_t)i] = all[(size_t)i].v;
        return s;
    }();
    return sets;
}

/// The four raw rows of one pattern: a hit bit per step (cycle steps; with
/// Length = Open, Prime is computed per step by rbPrimeOpen instead). Poly
/// hits also carry their exact position inside the step (`frac`, 0…1).
struct RbPattern {
    int length = 16;  ///< cycle length L
    uint32_t rows[kRbOutputs]{};
    float frac[kRbOutputs][kRbMaxLength]{};
    bool hit(int j, int i) const noexcept {
        const int m = ((i % length) + length) % length;
        return (rows[j] >> m) & 1u;
    }
};

/// Prime with Length = Open: output j (0-based) at song step n.
inline bool rbPrimeOpen(int P, int j, int64_t n) noexcept {
    const auto& set = rbPrimeSets()[(size_t)(((P % 15) + 15) % 15)];
    const int u = (P / 15) % 8;
    const int64_t q = set[(size_t)j];
    return (((n + (int64_t)u * (j + 1)) % q) + q) % q == 0;
}

/// Builds (Family, P, L) → four rows (4.2). `freeGrid`: Poly hits keep their
/// exact time (frac) instead of snapping to the nearest step.
inline RbPattern rbPattern(int family, int P, int L, bool freeGrid = false) noexcept {
    RbPattern pt;
    L = std::clamp(L, 2, kRbMaxLength);
    pt.length = L;
    P = std::clamp(P, 0, kRbPatterns - 1);
    const int a = P % 16, v = P / 16;
    auto set = [&](int j, int i) { pt.rows[j] |= 1u << (((i % L) + L) % L); };
    switch (family) {
        case RbEven: {
            const int k0 = 1 + (int)std::lround((double)a * (L - 1) / 15.0);
            const int ch = (k0 + 1) / 2, c3 = (k0 + 2) / 3;
            int k[4], r[4] = {0, 0, 0, 0};
            switch (v) {
                case 0: k[0] = k[1] = k[2] = k[3] = k0, r[1] = L / 4, r[2] = L / 2, r[3] = 3 * L / 4; break;
                case 1: k[0] = k0, k[1] = k0 + 1, k[2] = k0 + 2, k[3] = k0 + 3; break;
                case 2: k[0] = k0, k[1] = ch, k[2] = 2 * k0, k[3] = 4 * k0; break;
                case 3: k[0] = k0, k[1] = L - k0, k[2] = ch, k[3] = L - ch, r[1] = 1, r[3] = 1; break;
                case 4: k[0] = k[1] = k0, k[2] = k[3] = 2 * k0, r[1] = L / (2 * k0), r[3] = L / (4 * k0); break;
                case 5: k[0] = c3, k[1] = ch, k[2] = k0, k[3] = 2 * k0, r[1] = L / 2, r[3] = 1; break;
                case 6: k[0] = 1, k[1] = 2, k[2] = k0, k[3] = L, r[1] = L / 2; break;
                default: k[0] = k0, k[1] = k0 + 2, k[2] = k0 + 4, k[3] = k0 + 6, r[1] = 1, r[2] = 2, r[3] = 3; break;
            }
            for (int j = 0; j < 4; ++j) {
                const int kj = std::clamp(k[j], 1, L);
                for (int i = 0; i < L; ++i)
                    if (rbEuclid(kj, L, i - r[j])) set(j, i);
            }
            break;
        }
        case RbPrime: {
            const auto& q = rbPrimeSets()[(size_t)(P % 15)];
            const int u = (P / 15) % 8;
            for (int j = 0; j < 4; ++j)
                for (int i = 0; i < L; ++i)
                    if ((i + u * (j + 1)) % q[(size_t)j] == 0) set(j, i);
            break;
        }
        case RbMetric: {
            const int S = rbStrength(L, 0);
            const int g = 1 + a / 8, o = a % 8;
            for (int j = 0; j < 4; ++j) {
                const int level = std::clamp(S - j * g - o, 1, S);
                const bool exactly = j > 0 && ((v >> (j - 1)) & 1);
                for (int i = 0; i < L; ++i) {
                    const int s = rbStrength(L, i);
                    if (exactly ? s == level : s >= level) set(j, i);
                }
            }
            break;
        }
        case RbPoly: {
            const auto& ns = rbPolySets()[(size_t)(P % 64)];
            const double h = (P / 64) ? 0.5 : 0.0;
            for (int j = 0; j < 4; ++j) {
                const int n = ns[(size_t)j];
                for (int m = 0; m < n; ++m) {
                    const double pos = ((double)m + h) * (double)L / (double)n;  // in steps
                    int step;
                    float f = 0.0f;
                    if (freeGrid) {
                        step = (int)std::floor(pos + 1e-9);
                        f = (float)(pos - (double)step);
                        if (f < 1e-6f) f = 0.0f;
                    } else {
                        step = (int)std::floor(pos + 0.5);
                    }
                    step %= L;
                    if (!((pt.rows[j] >> step) & 1u)) {  // two hits in one step: the first
                        set(j, step);
                        pt.frac[j][step] = f;
                    }
                }
            }
            break;
        }
        case RbInterlock: {
            const int k1 = 1 + (int)std::lround((double)a * ((double)L / 2.0 - 1.0) / 15.0);
            static constexpr double rho[4][2] = {{0.5, 0.5}, {1.0 / 3.0, 0.5}, {2.0 / 3.0, 1.0 / 3.0}, {0.25, 2.0 / 3.0}};
            const int pr = std::clamp(v / 2, 0, 3);
            uint32_t taken = 0;
            for (int i = 0; i < L; ++i)
                if (rbEuclid(std::clamp(k1, 1, L), L, i)) set(0, i);
            taken = pt.rows[0];
            for (int j = 1; j < 4; ++j) {
                int free[kRbMaxLength], n = 0;
                for (int i = 0; i < L; ++i)
                    if (!((taken >> i) & 1u)) free[n++] = i;
                if (n == 0) break;
                int k;
                if (j < 3) k = (int)std::ceil(rho[pr][j - 1] * n - 1e-9);
                else k = (v % 2 == 0) ? n : (n + 1) / 2;
                for (int m = 0; m < n; ++m)
                    if (rbEuclid(k, n, m)) set(j, free[m]);
                taken |= pt.rows[j];
            }
            break;
        }
        case RbSeeded: {
            static constexpr double density[4] = {0.30, 0.20, 0.45, 0.35};
            static constexpr double gamma[4] = {2.0, 1.0, 0.5, 0.0};
            const int S = rbStrength(L, 0);
            for (int j = 0; j < 4; ++j) {
                double w[kRbMaxLength], sum = 0.0;
                for (int i = 0; i < L; ++i) {
                    w[i] = std::pow((double)rbStrength(L, i) / (double)S, gamma[j]);
                    sum += w[i];
                }
                for (int i = 0; i < L; ++i) {
                    const double pr = std::min(1.0, density[j] * L * w[i] / sum);
                    if (dsp::uniform01((uint64_t)P, (uint64_t)i, (uint64_t)(j + 1)) < pr) set(j, i);
                }
            }
            set(0, 0);
            break;
        }
        default: break;
    }
    return pt;
}

/// One step's hits after Rotate, Mute and Complement (4.4), as bits 0…3,
/// plus the Accent (≥ 2 unmuted hits before Complement).
struct RbStepHits {
    uint8_t bits = 0;
    bool accent = false;
    float frac[kRbOutputs]{};  ///< Poly Free: the hit's position inside the step
};

inline RbStepHits rbStep(const RbPattern& pt, int family, int P, bool open, int64_t step, const int* rotate,
                         const bool* mute, int complement) noexcept {
    RbStepHits h;
    uint8_t raw = 0;
    for (int j = 0; j < 4; ++j) {
        if (mute[j]) continue;
        const int64_t s = step - rotate[j];
        bool hit;
        if (open && family == RbPrime) {
            hit = rbPrimeOpen(P, j, s);
        } else {
            const int L = pt.length;
            const int i = (int)(((s % L) + L) % L);
            hit = (pt.rows[j] >> i) & 1u;
            if (hit) h.frac[j] = pt.frac[j][i];
        }
        if (hit) raw = (uint8_t)(raw | (1u << j));
    }
    int count = 0;
    for (int j = 0; j < 4; ++j) count += (raw >> j) & 1;
    h.accent = count >= 2;
    uint8_t out = raw;
    if (complement == RbAvoid || complement == RbFill) {
        out = 0;
        bool taken = false;
        for (int j = 0; j < 4; ++j)
            if (((raw >> j) & 1) && !taken) {
                out = (uint8_t)(out | (1u << j));
                taken = true;
            }
        if (complement == RbFill) {
            int top = -1;
            for (int j = 3; j >= 0 && top < 0; --j)
                if (!mute[j]) top = j;
            if (top >= 0) {
                const bool others = (out & ~(1u << top)) != 0;
                out = (uint8_t)(out & ~(1u << top));
                if (!others) out = (uint8_t)(out | (1u << top));
            }
        }
    } else if (complement == RbPairs) {
        out = raw;
        if (!mute[1]) out = (uint8_t)((out & ~2u) | (((raw & 1u) == 0) ? 2u : 0u));
        if (!mute[3]) out = (uint8_t)((out & ~8u) | (((raw & 4u) == 0) ? 8u : 0u));
    }
    for (int j = 0; j < 4; ++j)
        if (!((out >> j) & 1)) h.frac[j] = 0.0f;
    h.bits = out;
    return h;
}

/// Length setting → steps (0 = Open).
inline int rbLength(int setting) noexcept { return setting >= kRbMaxLength - 1 ? 0 : setting + 2; }

struct RbParams {
    int family = RbEven;
    int pattern = 0;
    int length = 16;        ///< 2…32, 0 = Open
    int rate = 9;           ///< dsp::sequencerRates() index
    int complement = RbOff;
    bool changeOnStep = false;  ///< Change = Step (else Cycle)
    bool freeGrid = false;
    bool mute[kRbOutputs]{};
    int rotate[kRbOutputs]{};
    bool trigger = false;   ///< Output: Trigger
    float width = 0.5f;
};

struct RbInput {
    float clock = 0.0f, reset = 0.0f;
    bool clocked = false;
    bool running = false, started = false;
    double ppq = 0.0, bpm = 120.0;
};

struct RbOutputs {
    float out[kRbOutputs]{};
    float any = 0.0f, accent = 0.0f, cycle = 0.0f;
};

class RhythmBankDsp {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
    }
    void reset() noexcept {
        clock_.reset();
        haveActive_ = false;
        step_ = 0;
        for (int j = 0; j < kRbOutputs; ++j) left_[j] = delay_[j] = 0, high_[j] = false;
        accentLeft_ = 0;
        stepLen_ = 6000;
    }

    void tick(const RbParams& p, const RbInput& in, RbOutputs& out) noexcept {
        out.cycle = 0.0f;
        bool rose[kRbOutputs]{};
        dsp::SeqClockInput ci;
        ci.clocked = in.clocked;
        ci.clock = in.clock;
        ci.reset = in.reset;
        ci.running = in.running;
        ci.started = in.started;
        ci.ppq = in.ppq;
        ci.bpm = in.bpm;
        ci.stepBeats = dsp::sequencerRateBeats(p.rate);
        clock_.tick(ci, [&](const dsp::SeqClockEvent& e) {
            if (e.type == dsp::SeqClockEvent::Release) {
                for (int j = 0; j < kRbOutputs; ++j) left_[j] = delay_[j] = 0;
                accentLeft_ = 0;
                return;
            }
            onStep(p, e.n, e.durationSamples, rose, out);
        });
        // Poly Free: hits later inside the step.
        for (int j = 0; j < kRbOutputs; ++j)
            if (delay_[j] > 0 && --delay_[j] == 0) {
                left_[j] = gateLen(p);
                rose[j] = true;
            }
        bool any = false;
        for (int j = 0; j < kRbOutputs; ++j) {
            const bool h = left_[j] > 0;
            float v;
            if (p.trigger) v = rose[j] ? 1.0f : 0.0f;
            else v = rose[j] && high_[j] ? 0.0f : (h ? 1.0f : 0.0f);  // back-to-back hits dip for a sample
            out.out[j] = v;
            high_[j] = v > 0.5f;
            any = any || v > 0.5f;
            if (left_[j] > 0) --left_[j];
        }
        out.any = any ? 1.0f : 0.0f;
        out.accent = accentLeft_ > 0 ? 1.0f : 0.0f;
        if (accentLeft_ > 0) --accentLeft_;
    }

    /// The active pattern (what plays) and its settings.
    const RbPattern& pattern() const noexcept { return active_; }
    int activeFamily() const noexcept { return family_; }
    int activePattern() const noexcept { return pat_; }
    int activeLength() const noexcept { return len_; }
    int activeComplement() const noexcept { return comp_; }
    /// The step in the cycle (Open: the song step).
    int64_t step() const noexcept { return step_; }
    bool high(int j) const noexcept { return high_[j]; }

private:
    int64_t gateLen(const RbParams& p) const noexcept {
        return p.trigger ? 1 : dsp::gateSamples(stepLen_, p.width);
    }

    void onStep(const RbParams& p, int64_t n, double duration, bool* rose, RbOutputs& out) noexcept {
        stepLen_ = std::max(1.0, duration);
        // Pattern changes: at the next step, or at step 1 of the next cycle.
        const bool want = !haveActive_ || p.family != family_ || p.pattern != pat_ || p.length != len_ ||
                          p.complement != comp_ || p.freeGrid != free_;
        const int cycle = len_ > 0 ? len_ : kRbOpenCycle;
        const bool atCycleStart = (((n % cycle) + cycle) % cycle) == 0;
        if (want && (!haveActive_ || p.changeOnStep || atCycleStart)) {
            family_ = p.family;
            pat_ = p.pattern;
            len_ = p.length;
            comp_ = p.complement;
            free_ = p.freeGrid;
            active_ = rbPattern(family_, pat_, len_ > 0 ? len_ : kRbOpenCycle, free_ && family_ == RbPoly);
            haveActive_ = true;
        }
        const int L = len_ > 0 ? len_ : kRbOpenCycle;
        const int64_t i = len_ > 0 ? ((n % L) + L) % L : n;
        step_ = i;
        if ((((n % L) + L) % L) == 0) out.cycle = 1.0f;
        const RbStepHits h = rbStep(active_, family_, pat_, len_ == 0, len_ > 0 ? i : n, p.rotate, p.mute, comp_);
        for (int j = 0; j < kRbOutputs; ++j) {
            if (!((h.bits >> j) & 1)) continue;
            if (h.frac[j] > 0.0f) {
                // Counted down from this sample on: due `frac · step` samples later.
                delay_[j] = std::max<int64_t>(1, (int64_t)std::llround((double)h.frac[j] * stepLen_)) + 1;
            } else {
                left_[j] = gateLen(p);
                rose[j] = true;
                delay_[j] = 0;
            }
        }
        if (h.accent) accentLeft_ = gateLen(p);
    }

    double sampleRate_ = 48000.0;
    dsp::SeqClock clock_;
    RbPattern active_;
    bool haveActive_ = false, free_ = false;
    int family_ = 0, pat_ = 0, len_ = 16, comp_ = 0;
    int64_t step_ = 0;
    double stepLen_ = 6000.0;
    int64_t left_[kRbOutputs]{}, delay_[kRbOutputs]{};
    int64_t accentLeft_ = 0;
    bool high_[kRbOutputs]{};
};

}  // namespace bleep::patch
