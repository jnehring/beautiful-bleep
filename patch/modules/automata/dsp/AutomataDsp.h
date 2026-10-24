// SPDX-License-Identifier: GPL-3.0-only
// Automata (doc/specs/modules/automata.md): a sequencer whose gates and notes
// come from a small system that evolves on every step. Five systems share one
// state record and one history ring:
//
//   Rule    a ring of up to 32 cells under a one-dimensional rule (0…255)
//   Life    an 8×8 wrapping grid under a birth/survival rule
//   Markov  a chain over eight scale degrees and a rest, with an editable
//           transition table that also learns from played notes
//   Ant     a walker on an 8×8 wrapping grid that turns by the mark under it
//   Lsys    a rewriting string read as notes, rests and octave moves
//
// Every random draw is a pure function of (Seed, tick, stream); `tick` counts
// evolutions since the seed and is NOT rewound, so a replay after Rewind forks
// into a slightly different future while a render from the same start repeats.
// The state after each generation goes into a ring of kAutoHist snapshots.
#pragma once

#include "dsp/Chords.h"
#include "dsp/Random.h"
#include "dsp/Scales.h"
#include "dsp/SeqClock.h"
#include "dsp/Smoothing.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace bleep::patch {

enum class AutoMode : int { Rule, Life, Markov, Ant, Lsys };

constexpr int kAutoCells = 64;  ///< ring cells (≤ 32) or an 8×8 grid
constexpr int kAutoStr = 96;    ///< longest L-system string
constexpr int kAutoHist = 64;   ///< generations that Rewind can reach
constexpr int kAutoStates = 9;  ///< Markov: degrees 0…7 and the rest (8)

struct LifeRule {
    const char* name;
    uint16_t birth, survive;  ///< bit k: k neighbours
};
constexpr uint16_t nbMask(std::initializer_list<int> ks) {
    uint16_t m = 0;
    for (int k : ks) m = (uint16_t)(m | (1u << k));
    return m;
}
inline const std::array<LifeRule, 6>& lifeRules() {
    static const std::array<LifeRule, 6> r{{{"B3/S23", nbMask({3}), nbMask({2, 3})},
                                            {"B36/S23", nbMask({3, 6}), nbMask({2, 3})},
                                            {"B3/S12345", nbMask({3}), nbMask({1, 2, 3, 4, 5})},
                                            {"B2/S", nbMask({2}), 0},
                                            {"B3/S45678", nbMask({3}), nbMask({4, 5, 6, 7, 8})},
                                            {"B1357/S1357", nbMask({1, 3, 5, 7}), nbMask({1, 3, 5, 7})}}};
    return r;
}

/// Turn rules of the Ant: one letter per mark state, R/L.
inline const std::array<const char*, 5>& antTurns() {
    static const std::array<const char*, 5> t{"RL", "RLR", "LLRR", "RLLR", "RRLLRL"};
    return t;
}

/// L-system rule sets. Symbols: A note, B note then up a degree, C note then
/// down a degree, R rest, U octave up, D octave down (U and D move the next
/// note). A, B and C are rewritten by the three rules; the rest stay.
struct LsysSet {
    const char* name;
    const char* axiom;
    const char* rule[3];
};
inline const std::array<LsysSet, 5>& lsysSets() {
    static const std::array<LsysSet, 5> s{{{"Cascade", "A", {"AB", "CA", "RB"}},
                                           {"Climb", "A", {"ABB", "AR", "UA"}},
                                           {"Breath", "AR", {"ABA", "RC", "AD"}},
                                           {"Fork", "B", {"AC", "BRB", "CA"}},
                                           {"Tide", "AC", {"ARB", "UAC", "DB"}}}};
    return s;
}

struct AutomataParams {
    int mode = 0;
    uint32_t seed = 1;
    int rule = 30;        ///< Rule: 0…255
    int size = 16;        ///< Rule: ring cells 4…32
    int lifeRule = 0;     ///< lifeRules() index
    int turns = 0;        ///< antTurns() index
    int lsys = 0;         ///< lsysSets() index
    float density = 0.35f;
    float interference = 0.0f;
    float learn = 0.0f;
    int rewindBy = 4;     ///< generations a Rewind goes back, 1…16
    int spread = 1;       ///< octaves the eight degrees cover, 1…3
    int root = 0;
    uint16_t scale = 0xab5;
    float gateLength = 0.5f;
    float rateHz = 4.0f;
    int sync = 2;
};

struct AutomataInput {
    float clock = 0.0f, reset = 0.0f, rewind = 0.0f, learn = 0.0f, transpose = 0.0f;
    bool clockPatched = false, learnPatched = false;
    bool running = false, started = false;
    double ppq = 0.0, bpm = 120.0;
};

struct AutomataFrame {
    float gate = 0.0f, pitch = 0.0f, velocity = 0.0f, birth = 0.0f, density = 0.0f, step = 0.0f;
};

/// Everything that evolves; plain data so a snapshot is a copy.
struct AutoState {
    std::array<uint8_t, kAutoCells> cell{};
    std::array<uint8_t, kAutoStr> str{};  ///< symbols 0…5 = A B C R U D
    uint32_t window = 0;                  ///< Markov: sounding steps among the last 16
    uint8_t ax = 0, ay = 0, adir = 0;     ///< Ant
    uint8_t deg = 0;                      ///< Markov: current state 0…8
    uint8_t note = 0;                     ///< Markov / Lsys: last sounding degree 0…7
    int8_t oct = 0;                       ///< Lsys octave move −1…1
    uint8_t len = 1, head = 0;            ///< Lsys
    uint8_t lsGen = 0;
    uint8_t key = 0;                      ///< hash of what the state was seeded for
};

/// What one evolution produced.
struct AutoEvent {
    bool gate = false, birth = false;
    int degree = 0;  ///< 0…7
    int octave = 0;  ///< scale octaves added
    float velocity = 0.7f;
};

class AutomataDsp {
public:
    static constexpr int64_t kMaxFastForward = 4096;
    static constexpr int kTable = kAutoStates * kAutoStates;

    // ---- Pure helpers (tested) -------------------------------------------------

    static int clampSize(int n) noexcept { return std::clamp(n, 4, 32); }
    static uint8_t keyOf(const AutomataParams& p) noexcept {
        return (uint8_t)(mix(((uint64_t)p.mode << 40) ^ ((uint64_t)clampSize(p.size) << 32) ^ ((uint64_t)p.lsys << 24) ^
                             (uint64_t)p.seed) & 0xffu) | 1u;
    }
    static uint64_t mix(uint64_t x) noexcept { return dsp::mix64(x); }

    /// The next row of a ring under `rule` (rule numbers 0…255, wrapping). Returns births.
    static uint64_t ringStep(const uint8_t* in, uint8_t* out, int n, int rule) noexcept {
        uint64_t born = 0;
        for (int i = 0; i < n; ++i) {
            const int l = in[(i + n - 1) % n], c = in[i], r = in[(i + 1) % n];
            const int v = (rule >> ((l << 2) | (c << 1) | r)) & 1;
            out[i] = (uint8_t)v;
            if (v && !c) born |= (uint64_t)1 << i;
        }
        return born;
    }
    /// One generation of the 8×8 wrapping grid. Returns births.
    static uint64_t lifeStep(const uint8_t* in, uint8_t* out, const LifeRule& r) noexcept {
        uint64_t born = 0;
        for (int y = 0; y < 8; ++y)
            for (int x = 0; x < 8; ++x) {
                int n = 0;
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx)
                        if (dx || dy) n += in[((y + dy + 8) & 7) * 8 + ((x + dx + 8) & 7)] ? 1 : 0;
                const bool alive = in[y * 8 + x] != 0;
                const bool next = alive ? ((r.survive >> n) & 1u) : ((r.birth >> n) & 1u);
                out[y * 8 + x] = next ? 1 : 0;
                if (next && !alive) born |= (uint64_t)1 << (y * 8 + x);
            }
        return born;
    }
    /// The scale index of degree 0…7 over `spread` octaves.
    static int noteIndex(int degree, int octave, int spread, uint16_t scale) noexcept {
        const int size = dsp::scaleSize(scale);
        return (int)std::lround((double)degree / 7.0 * (double)(spread * size)) + octave * size;
    }
    /// Pitch in V/oct (0 = C4).
    static float pitchFor(int degree, int octave, const AutomataParams& p, int transposeSemis) noexcept {
        return (float)(p.root + dsp::scaleNote(p.scale, noteIndex(degree, octave, p.spread, p.scale)) + transposeSemis) / 12.0f;
    }
    /// A played pitch (V/oct) as the nearest degree 0…7.
    static int degreeOf(float volts, const AutomataParams& p) noexcept {
        const int semis = (int)std::lround(std::isfinite(volts) ? volts * 12.0f : 0.0f) - p.root;
        const int size = dsp::scaleSize(p.scale), m = std::max(1, p.spread) * size;
        const int idx = dsp::scaleIndexOf(p.scale, semis);
        const int w = ((idx % m) + m) % m;
        return std::clamp((int)std::lround((double)w * 7.0 / (double)m), 0, 7);
    }
    static int popcount64(uint64_t v) noexcept {
        int n = 0;
        for (; v; v &= v - 1) ++n;
        return n;
    }

    // ---- Lifecycle -----------------------------------------------------------------

    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        clock_.prepare(sampleRate);
        reset();
    }
    void reset() noexcept {
        clock_.reset();
        rewindEdge_.reset();
        haveStep_ = false;
        lastK_ = -1;
        pendingReset_ = false;
        phase_ = 0.0;
        stepSamples_ = sampleRate_ / 4.0;
        since_ = 0;
        gatesOn_ = stepFired_ = birthFired_ = false;
        gen_ = tick_ = 0;
        oldest_ = 0;
        state_ = AutoState{};
        seeded_ = false;
        learned_.fill(0.0f);
        lastObs_ = 0;
        pitch_ = velocity_ = density_ = 0.0f;
        event_ = AutoEvent{};
        table_.fill(1);
    }

    /// The editable transition table: weights 0…9, row = from, column = to.
    void setTable(const uint8_t* t) noexcept {
        for (int i = 0; i < kTable; ++i) table_[(size_t)i] = std::min<uint8_t>(t[i], 9);
    }
    /// Seeds the state (generation 0) for `p`: also what Reset returns to.
    void seed(const AutomataParams& p) noexcept {
        state_ = AutoState{};
        state_.key = keyOf(p);
        gen_ = tick_ = 0;
        oldest_ = 0;
        const uint32_t sd = p.seed;
        const double d = std::clamp((double)p.density, 0.0, 1.0);
        switch ((AutoMode)std::clamp(p.mode, 0, 4)) {
            case AutoMode::Rule: {
                const int n = clampSize(p.size);
                for (int i = 0; i < n; ++i) state_.cell[(size_t)i] = dsp::uniform01(sd, (uint64_t)i, 1) < d ? 1 : 0;
                if (d < 0.02) {
                    state_.cell.fill(0);
                    state_.cell[(size_t)(n / 2)] = 1;
                }
                break;
            }
            case AutoMode::Life:
                for (int i = 0; i < 64; ++i) state_.cell[(size_t)i] = dsp::uniform01(sd, (uint64_t)i, 2) < d ? 1 : 0;
                break;
            case AutoMode::Ant: {
                const int k = (int)std::strlen(antTurns()[(size_t)std::clamp(p.turns, 0, 4)]);
                for (int i = 0; i < 64; ++i)
                    if (dsp::uniform01(sd, (uint64_t)i, 3) < d * 0.5) state_.cell[(size_t)i] = (uint8_t)(1 + (int)(dsp::hash3(sd, (uint64_t)i, 4) % (uint64_t)(k - 1)));
                state_.ax = (uint8_t)(dsp::hash3(sd, 0, 5) & 7);
                state_.ay = (uint8_t)(dsp::hash3(sd, 1, 5) & 7);
                state_.adir = (uint8_t)(dsp::hash3(sd, 2, 5) & 3);
                break;
            }
            case AutoMode::Markov:
                state_.deg = (uint8_t)(dsp::hash3(sd, 0, 6) % 8);
                state_.note = state_.deg;
                state_.window = 0x5555u;
                break;
            case AutoMode::Lsys: {
                const LsysSet& set = lsysSets()[(size_t)std::clamp(p.lsys, 0, 4)];
                state_.len = (uint8_t)std::strlen(set.axiom);
                for (int i = 0; i < state_.len; ++i) state_.str[(size_t)i] = symbolOf(set.axiom[i]);
                state_.head = 0;
                state_.note = (uint8_t)(dsp::hash3(sd, 0, 7) % 8);
                break;
            }
        }
        hist_[0] = state_;
        seeded_ = true;
        density_ = densityOf(state_, p);
    }

    /// Steps the system back by up to n generations (as far as the ring reaches).
    void rewind(int n) noexcept {
        if (!seeded_) return;
        const int64_t target = std::max<int64_t>(std::max<int64_t>(0, oldest_), gen_ - std::max(1, n));
        if (target >= gen_) return;
        state_ = hist_[(size_t)(target % kAutoHist)];
        gen_ = target;
        density_ = densityOf(state_, lastParams_);
    }

    /// Mean aliveness 0…1 of a state.
    static float densityOf(const AutoState& s, const AutomataParams& p) noexcept {
        switch ((AutoMode)std::clamp(p.mode, 0, 4)) {
            case AutoMode::Rule: {
                const int n = clampSize(p.size);
                int c = 0;
                for (int i = 0; i < n; ++i) c += s.cell[(size_t)i] ? 1 : 0;
                return (float)c / (float)n;
            }
            case AutoMode::Life:
            case AutoMode::Ant: {
                int c = 0;
                for (int i = 0; i < 64; ++i) c += s.cell[(size_t)i] ? 1 : 0;
                return (float)c / 64.0f;
            }
            case AutoMode::Markov: return (float)popcount64(s.window & 0xffffu) / 16.0f;
            case AutoMode::Lsys: {
                int c = 0;
                for (int i = 0; i < s.len; ++i) c += s.str[(size_t)i] <= 2 ? 1 : 0;
                return (float)c / (float)std::max<int>(1, s.len);
            }
        }
        return 0.0f;
    }

    void tick(const AutomataParams& p, const AutomataInput& in, AutomataFrame& out) noexcept {
        lastParams_ = p;
        if (!seeded_ || state_.key != keyOf(p)) seed(p);
        out.step = out.birth = 0.0f;
        ++since_;
        if (rewindEdge_.process(in.rewind) > 0) rewind(p.rewindBy);
        if (in.started) {
            haveStep_ = false;
            if (in.clockPatched) clock_.reset();
            phase_ = 1.0;
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
                gatesOn_ = false;
                if (e.reason == dsp::SeqClockEvent::Reset) seed(p);
                return;
            }
            step(p, in, e.n, e.stepSamples);
        });
        if (clock_.resetEdge()) pendingReset_ = true;
        if (ci.running) {
            phase_ = dsp::wrap01(in.ppq / beats);
            pendingReset_ = false;
        } else if (!in.clockPatched) {
            const double hz = beats > 0.0 ? in.bpm / 60.0 / beats : std::max((double)p.rateHz, 0.001);
            phase_ += hz / sampleRate_;
            if (!haveStep_ || phase_ >= 1.0) {
                phase_ -= std::floor(phase_);
                const int64_t k = pendingReset_ || !haveStep_ ? 0 : lastK_ + 1;
                if (pendingReset_) seed(p);
                pendingReset_ = false;
                step(p, in, k, sampleRate_ / hz);
            }
        } else {
            pendingReset_ = false;
        }

        const bool open = gatesOn_ && event_.gate && (p.gateLength >= 0.999f || (double)since_ < (double)p.gateLength * stepSamples_);
        out.gate = open ? 1.0f : 0.0f;
        out.pitch = pitch_;
        out.velocity = velocity_;
        out.density = density_;
        if (stepFired_) {
            out.step = 1.0f;
            stepFired_ = false;
        }
        if (birthFired_) {
            out.birth = 1.0f;
            birthFired_ = false;
        }
    }

    // ---- For the view ---------------------------------------------------------------
    const AutoState& state() const noexcept { return state_; }
    int64_t generation() const noexcept { return gen_; }
    const AutoEvent& lastEvent() const noexcept { return event_; }
    /// Effective Markov row weights, normalised per row, as bytes 0…255 (81 values).
    void effectiveTable(uint8_t* out) const noexcept {
        for (int i = 0; i < kAutoStates; ++i) {
            float row[kAutoStates], sum = 0.0f;
            for (int j = 0; j < kAutoStates; ++j) sum += row[j] = weight(i, j);
            for (int j = 0; j < kAutoStates; ++j) out[i * kAutoStates + j] = (uint8_t)std::lround(255.0f * (sum > 0.0f ? row[j] / sum : 0.0f));
        }
    }
    float learnedWeight(int i, int j) const noexcept { return learned_[(size_t)(i * kAutoStates + j)]; }

    /// Runs one generation from the current state (also used by the tests).
    AutoEvent evolve(const AutomataParams& p) noexcept {
        if (!seeded_ || state_.key != keyOf(p)) seed(p);
        lastParams_ = p;
        const uint64_t tick = (uint64_t)tick_;
        const bool perturbed = p.interference > 0.0f && dsp::uniform01(p.seed, tick, 20) < (double)p.interference * 0.5;
        const uint64_t h = dsp::hash3(p.seed, tick, 21);
        AutoEvent e;
        AutoState& s = state_;
        switch ((AutoMode)std::clamp(p.mode, 0, 4)) {
            case AutoMode::Rule: {
                const int n = clampSize(p.size);
                if (perturbed) s.cell[h % (uint64_t)n] ^= 1;
                uint8_t nc[kAutoCells] = {};
                uint64_t born = ringStep(s.cell.data(), nc, n, std::clamp(p.rule, 0, 255));
                bool any = false;
                for (int i = 0; i < n; ++i) any = any || nc[i];
                if (!any) {  // died out: one new cell
                    const int at = (int)(dsp::hash3(p.seed, tick, 22) % (uint64_t)n);
                    nc[at] = 1;
                    born |= (uint64_t)1 << at;
                }
                std::memcpy(s.cell.data(), nc, (size_t)n);
                const int head = (int)((gen_ + 1) % n);
                e.gate = s.cell[(size_t)head] != 0;
                int v = 0, alive = 0;
                for (int d = -2; d <= 2; ++d) {
                    const int c = s.cell[(size_t)((head + d + 2 * n) % n)];
                    v = (v << 1) | c;
                    alive += c;
                }
                e.degree = v >> 2;
                e.velocity = 0.35f + 0.65f * (float)alive / 5.0f;
                e.birth = (born >> head) & 1u;
                break;
            }
            case AutoMode::Life: {
                if (perturbed) s.cell[h % 64] ^= 1;
                uint8_t nc[64];
                uint64_t born = lifeStep(s.cell.data(), nc, lifeRules()[(size_t)std::clamp(p.lifeRule, 0, 5)]);
                int alive = 0;
                for (int i = 0; i < 64; ++i) alive += nc[i];
                if (alive == 0) {  // extinct: a fresh seeding
                    const double d = std::max(0.2, (double)p.density);
                    for (int i = 0; i < 64; ++i) {
                        nc[i] = dsp::uniform01(p.seed, tick * 64 + (uint64_t)i, 23) < d ? 1 : 0;
                        if (nc[i]) born |= (uint64_t)1 << i;
                    }
                }
                std::memcpy(s.cell.data(), nc, 64);
                const int col = (int)((gen_ + 1) & 7);
                int count = 0, low = -1;
                bool b = false;
                for (int y = 0; y < 8; ++y) {
                    if (s.cell[(size_t)(y * 8 + col)]) {
                        ++count;
                        if (low < 0) low = y;
                    }
                    b = b || ((born >> (y * 8 + col)) & 1u);
                }
                e.gate = count > 0;
                e.degree = std::max(0, low);
                e.velocity = 0.35f + 0.65f * (float)count / 8.0f;
                e.birth = b;
                break;
            }
            case AutoMode::Ant: {
                const char* rules = antTurns()[(size_t)std::clamp(p.turns, 0, 4)];
                const int k = (int)std::strlen(rules);
                if (perturbed) {
                    uint8_t& c = s.cell[h % 64];
                    c = (uint8_t)((c + 1) % k);
                    if (h & 0x100) s.adir = (uint8_t)((s.adir + 1) & 3);
                }
                uint8_t& under = s.cell[(size_t)(s.ay * 8 + s.ax)];
                const int mark = under % k;
                s.adir = (uint8_t)((s.adir + (rules[mark] == 'R' ? 1 : 3)) & 3);
                under = (uint8_t)((mark + 1) % k);
                static constexpr int dx[4] = {0, 1, 0, -1}, dy[4] = {-1, 0, 1, 0};
                s.ax = (uint8_t)((s.ax + dx[s.adir] + 8) & 7);
                s.ay = (uint8_t)((s.ay + dy[s.adir] + 8) & 7);
                const int here = s.cell[(size_t)(s.ay * 8 + s.ax)];
                e.gate = here > 0;
                e.birth = mark == 0;
                e.degree = s.ax;
                e.velocity = 0.35f + 0.65f * (float)s.ay / 7.0f;
                break;
            }
            case AutoMode::Markov: {
                float row[kAutoStates], sum = 0.0f;
                const int from = std::min<int>(s.deg, kAutoStates - 1);
                for (int j = 0; j < kAutoStates; ++j) sum += row[j] = weight(from, j);
                int to = 0;
                if (sum <= 0.0f) {
                    to = (int)(dsp::hash3(p.seed, tick, 24) % kAutoStates);
                    sum = 1.0f;
                    row[to] = 1.0f;
                } else {
                    const float u = (float)dsp::uniform01(p.seed, tick, 6) * sum;
                    float acc = 0.0f;
                    to = kAutoStates - 1;
                    for (int j = 0; j < kAutoStates; ++j) {
                        acc += row[j];
                        if (u < acc) {
                            to = j;
                            break;
                        }
                    }
                }
                if (perturbed) to = (to + ((h & 1) ? 1 : kAutoStates - 1)) % kAutoStates;
                const float prob = row[to] / sum;
                s.deg = (uint8_t)to;
                e.gate = to != 8;
                if (e.gate) s.note = (uint8_t)to;
                e.degree = s.note;
                e.velocity = 0.45f + 0.55f * (1.0f - prob);
                e.birth = prob < 0.2f;
                s.window = (s.window << 1) | (e.gate ? 1u : 0u);
                if (!learnIn_) {
                    if (p.learn > 0.0f && !fastForward_) observe(from, to, p.learn);
                    lastObs_ = to;
                }
                break;
            }
            case AutoMode::Lsys: {
                const LsysSet& set = lsysSets()[(size_t)std::clamp(p.lsys, 0, 4)];
                if (perturbed && s.len > 0) s.str[h % s.len] = (uint8_t)((h >> 8) % 6);
                bool born = false;
                auto next = [&]() -> uint8_t {
                    if (s.head >= s.len) {
                        born = true;
                        uint8_t out[kAutoStr];
                        int n = 0;
                        bool overflow = false;
                        for (int i = 0; i < s.len && !overflow; ++i) {
                            const uint8_t c = s.str[(size_t)i];
                            const char* r = c <= 2 ? set.rule[c] : nullptr;
                            if (!r) {
                                if (n < kAutoStr) out[n++] = c;
                                else overflow = true;
                            } else {
                                for (; *r; ++r) {
                                    if (n >= kAutoStr) {
                                        overflow = true;
                                        break;
                                    }
                                    out[n++] = symbolOf(*r);
                                }
                            }
                        }
                        if (overflow || n == 0) {  // too long: start again from the axiom
                            n = 0;
                            for (const char* a = set.axiom; *a; ++a) out[n++] = symbolOf(*a);
                            s.lsGen = 0;
                        } else {
                            ++s.lsGen;
                        }
                        std::memcpy(s.str.data(), out, (size_t)n);
                        s.len = (uint8_t)n;
                        s.head = 0;
                    }
                    return s.str[s.head++];
                };
                uint8_t c = next();
                for (int guard = 0; (c == 4 || c == 5) && guard < 8; ++guard) {
                    s.oct = (int8_t)std::clamp(s.oct + (c == 4 ? 1 : -1), -1, 1);
                    c = next();
                }
                if (c <= 2) {
                    e.gate = true;
                    e.degree = s.note;
                    e.octave = s.oct;
                    e.velocity = 0.55f + 0.15f * (float)c + (s.oct != 0 ? 0.15f : 0.0f);
                    if (c == 1) s.note = (uint8_t)((s.note + 1) & 7);
                    if (c == 2) s.note = (uint8_t)((s.note + 7) & 7);
                    s.oct = 0;
                } else {
                    e.degree = s.note;
                }
                e.birth = born;
                break;
            }
        }
        ++gen_;
        ++tick_;
        if (gen_ - oldest_ >= kAutoHist) oldest_ = gen_ - (kAutoHist - 1);
        hist_[(size_t)(gen_ % kAutoHist)] = state_;
        event_ = e;
        density_ = densityOf(state_, p);
        return e;
    }

    /// Learning from a played pitch (called once per step by tick()).
    void observePlayed(const AutomataParams& p, float volts) noexcept {
        if (p.learn <= 0.0f) return;
        observe(lastObs_, degreeOf(volts, p), p.learn);
    }

private:
    static uint8_t symbolOf(char c) noexcept {
        switch (c) {
            case 'A': return 0;
            case 'B': return 1;
            case 'C': return 2;
            case 'R': return 3;
            case 'U': return 4;
            default: return 5;
        }
    }
    float weight(int i, int j) const noexcept {
        return (float)table_[(size_t)(i * kAutoStates + j)] + learned_[(size_t)(i * kAutoStates + j)];
    }
    void observe(int from, int to, float amount) noexcept {
        for (float& v : learned_) v *= 1.0f - 0.01f * amount;
        float& w = learned_[(size_t)(std::clamp(from, 0, 8) * kAutoStates + std::clamp(to, 0, 8))];
        w = std::min(w + 2.0f * amount, 24.0f);
        lastObs_ = to;
    }

    void step(const AutomataParams& p, const AutomataInput& in, int64_t k, double stepSamples) noexcept {
        learnIn_ = in.learnPatched;
        AutoEvent e;
        if (haveStep_ && k == lastK_ + 1) {
            e = evolve(p);
        } else {  // start, Reset or a jump: the seed, evolved up to step k
            seed(p);
            const int64_t n = std::min<int64_t>(k, kMaxFastForward - 1);
            fastForward_ = true;
            for (int64_t i = 0; i <= n; ++i) e = evolve(p);
            fastForward_ = false;
        }
        if (in.learnPatched) observePlayed(p, in.learn);
        haveStep_ = true;
        lastK_ = k;
        stepSamples_ = std::max(1.0, stepSamples);
        since_ = 0;
        gatesOn_ = true;
        stepFired_ = true;
        birthFired_ = e.birth;
        const int ts = std::isfinite(in.transpose) ? (int)std::lround(in.transpose * 12.0f) : 0;
        pitch_ = pitchFor(e.degree, e.octave, p, ts);
        velocity_ = std::clamp(e.velocity, 0.0f, 1.0f);
    }

    double sampleRate_ = 48000.0;
    dsp::SeqClock clock_;
    dsp::GateEdge rewindEdge_;
    bool haveStep_ = false, pendingReset_ = false, gatesOn_ = false, stepFired_ = false, birthFired_ = false;
    bool seeded_ = false, learnIn_ = false, fastForward_ = false;
    int64_t lastK_ = -1, since_ = 0, gen_ = 0, tick_ = 0, oldest_ = 0;
    double phase_ = 0.0, stepSamples_ = 12000.0;
    AutoState state_;
    std::array<AutoState, kAutoHist> hist_{};
    std::array<uint8_t, kTable> table_{};
    std::array<float, kTable> learned_{};
    int lastObs_ = 0;
    float pitch_ = 0.0f, velocity_ = 0.0f, density_ = 0.0f;
    AutoEvent event_;
    AutomataParams lastParams_;
};

}  // namespace bleep::patch
