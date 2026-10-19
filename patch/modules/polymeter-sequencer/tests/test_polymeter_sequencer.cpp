// SPDX-License-Identifier: GPL-3.0-or-later
// Polymeter Seq DSP: track positions for every division and direction (also
// after a jump), loop windows, Bar and Track Ends, probability and bias,
// seeds, ratchets and Ratchet Amt, scale degrees, pattern changes, Hold and
// no hanging notes.
#include "PolymeterSequencerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cstdlib>
#include <functional>
#include <map>
#include <vector>

using namespace bleep::patch;

namespace {

constexpr double kSr = 48000.0;
constexpr double kBpm = 120.0;
constexpr double kPpqPerSample = kBpm / 60.0 / kSr;
constexpr int64_t kTick = 6000;  // a 1/16 at 120 BPM, 48 kHz

struct Note {
    int64_t at;
    bool on;
    int note;
    float velocity;
};

struct Run {
    std::vector<Note> notes;
    std::vector<int64_t> bars, ends, triggers;
    std::vector<float> gate;
    std::map<int, int> held;
    bool bad = false;
    int sounding() const {
        int n = 0;
        for (const auto& [k, v] : held) n += v;
        return n;
    }
    std::vector<Note> ons() const {
        std::vector<Note> o;
        for (const auto& n : notes)
            if (n.on) o.push_back(n);
        return o;
    }
};

/// A slot with every track neutral (Trigger On everywhere), lengths 1, muted
/// except the Trigger track.
PolySlot plainSlot() {
    PolySlot s{};
    for (int k = 0; k < kPolyTracks; ++k) {
        s[(size_t)k].length = 1;
        s[(size_t)k].hi = 0;
        s[(size_t)k].steps.fill((int8_t)polyNeutral(k));
        s[(size_t)k].mute = k != PolyTrig;
    }
    return s;
}
PolyTrack track(int len, int div = 3, int dir = PolyForward) {
    PolyTrack t;
    t.length = (uint8_t)len;
    t.lo = 0;
    t.hi = (uint8_t)(len - 1);
    t.division = (uint8_t)div;
    t.direction = (uint8_t)dir;
    return t;
}

struct Rig {
    PolymeterSequencerDsp dsp;
    PolyPattern pattern;
    PolyParams p;
    PolyTime t;
    PolyInputs in;
    int64_t sample = 0;
    double ppq = 0.0;
    explicit Rig(const PolySlot& s) {
        pattern.fill(s);
        dsp.prepare(kSr);
        dsp.reset();
        dsp.setPattern(&pattern);
        p.scale = 0;
        t.running = true;
        t.bpm = kBpm;
    }
    void run(int64_t n, Run& r, const std::function<void(int64_t)>& each = nullptr) {
        for (int64_t i = 0; i < n; ++i, ++sample) {
            if (each) each(sample);
            t.started = sample == 0;
            t.ppq = ppq;
            PolyOutputs o;
            dsp.tick(p, in, t, o, [&](bool on, int note, float, float vel) {
                r.notes.push_back({sample, on, note, vel});
                if (on) {
                    if (r.held[note]++ > 0) r.bad = true;
                } else if (--r.held[note] < 0) {
                    r.bad = true;
                }
            });
            if (o.bar > 0.5f) r.bars.push_back(sample);
            if (o.trackEnds > 0.5f) r.ends.push_back(sample);
            if (o.trigger > 0.5f) r.triggers.push_back(sample);
            r.gate.push_back(o.gate);
            if (t.running) ppq += kPpqPerSample;
        }
    }
};

bool near(int64_t a, int64_t b, int64_t tol = 2) { return std::llabs(a - b) <= tol; }

}  // namespace

static void positions() {
    TEST("track ticks for every division");
    for (int div = 0; div < kPolyDivisions; ++div) {
        const PolyTrack t = track(5, div);
        const int m = polyMultiplier(div), d = polyDivider(div);
        for (int64_t n = 0; n < 50; ++n) {
            EXPECT(PolymeterSequencerDsp::trackTick(t, n, 0.0) == (m > 1 ? n * m : n / d));
            EXPECT(PolymeterSequencerDsp::advances(t, n, 0.0) == (m > 1 || n % d == 0));
            if (m > 1) EXPECT(PolymeterSequencerDsp::trackTick(t, n, 1.0 / m) == n * m + 1);
        }
    }

    TEST("directions and loop windows");
    PolyTrack t = track(10);
    t.lo = 2;
    t.hi = 5;
    const int fwd[8] = {2, 3, 4, 5, 2, 3, 4, 5};
    for (int i = 0; i < 8; ++i) EXPECT(PolymeterSequencerDsp::position(t, i, 1, 0) == fwd[i]);
    t.direction = PolyBackward;
    for (int i = 0; i < 8; ++i) EXPECT(PolymeterSequencerDsp::position(t, i, 1, 0) == 7 - fwd[i]);
    t.direction = PolyPingPong;
    const int pp[8] = {2, 3, 4, 5, 4, 3, 2, 3};
    for (int i = 0; i < 8; ++i) EXPECT(PolymeterSequencerDsp::position(t, i, 1, 0) == pp[i]);
    EXPECT(PolymeterSequencerDsp::period(t) == 6);
    t.direction = PolyRandom;
    for (int i = 0; i < 200; ++i) {
        const int q = PolymeterSequencerDsp::position(t, i, 1, 0);
        EXPECT(q >= 2 && q <= 5);
    }

    TEST("positions follow the song position after a jump");
    PolySlot s = plainSlot();
    s[PolyNote] = track(7);
    s[PolyOct] = track(5, 4);  // /2
    s[PolyNote].mute = s[PolyOct].mute = false;
    Rig rig(s);
    Run r;
    rig.run(kTick * 9, r);
    rig.ppq = 0.25 * 40 + 0.01;
    rig.run(5, r);
    EXPECT(rig.dsp.trackPosition(PolyNote) == 40 % 7);
    EXPECT(rig.dsp.trackPosition(PolyOct) == (40 / 2) % 5);
}

static void barsAndEnds() {
    TEST("lengths 3 and 4: Bar every 12 ticks");
    PolySlot s = plainSlot();
    s[PolyTrig] = track(3);
    s[PolyNote] = track(4);
    s[PolyNote].mute = false;
    EXPECT(PolymeterSequencerDsp::cycleTicks(s) == 12);
    Rig rig(s);
    Run r;
    rig.run(kTick * 36 + 10, r);
    EXPECT(r.bars.size() == 4);
    for (size_t i = 0; i < r.bars.size(); ++i) EXPECT(near(r.bars[i], (int64_t)i * 12 * kTick));
    // Track Ends: every 3 and every 4 ticks (12 counted once), not at the start.
    EXPECT(r.ends.size() == 12 + 9 - 3);

    TEST("Bar after Reset (Clock mode)");
    Rig c(s);
    c.in.clockPatched = true;
    Run rc;
    for (int k = 0; k < 7; ++k) {
        c.in.clock = 1.0f;
        c.run(1, rc);
        c.in.clock = 0.0f;
        c.run(999, rc);
    }
    c.in.reset = 1.0f;
    c.run(1, rc);
    c.in.reset = 0.0f;
    c.in.clock = 1.0f;
    c.run(1, rc);
    EXPECT(rc.bars.size() == 2 && rc.bars.back() == c.sample - 1);

    TEST("default pattern: cycle of 560 steps");
    EXPECT(PolymeterSequencerDsp::cycleTicks(polyDefaultSlot()) == 560);
}

static void probability() {
    TEST("probability and bias");
    auto hits = [](int prob, float bias, uint32_t seed) {
        PolySlot s = plainSlot();
        s[PolyProb].steps.fill((int8_t)prob);
        s[PolyProb].mute = false;
        Rig rig(s);
        rig.p.probBias = bias;
        rig.p.seed = seed;
        Run r;
        rig.run(kTick * 200, r);
        return r.ons();
    };
    EXPECT(hits(100, 0.0f, 1).size() == 200);
    EXPECT(hits(0, 0.0f, 1).empty());
    EXPECT(hits(100, -1.0f, 1).empty());
    EXPECT(hits(0, 1.0f, 1).size() == 200);
    const auto a = hits(50, 0.0f, 3), b = hits(50, 0.0f, 3), c = hits(50, 0.0f, 4);
    EXPECT(a.size() > 70 && a.size() < 130);
    bool same = a.size() == b.size(), differ = a.size() != c.size();
    for (size_t i = 0; i < a.size() && same; ++i) same = a[i].at == b[i].at;
    for (size_t i = 0; i < a.size() && i < c.size() && !differ; ++i) differ = a[i].at != c[i].at;
    EXPECT(same && differ);
}

static void ratchets() {
    TEST("ratchet counts and spacing; Ratchet Amt 0 plays single hits");
    for (int shape : {(int)PolyEven, (int)PolyAccelerate, (int)PolyDecelerate}) {
        PolySlot s = plainSlot();
        s[PolyRatch].steps.fill(4);
        s[PolyRatch].shape.fill((uint8_t)shape);
        s[PolyRatch].mute = false;
        Rig rig(s);
        Run r;
        rig.run(kTick - 10, r);
        const auto o = r.ons();
        EXPECT(o.size() == 4);
        for (size_t k = 0; k < o.size(); ++k) {
            EXPECT(near(o[k].at, (int64_t)std::llround(PolymeterSequencerDsp::ratchetTime((int)k, 4, shape) * kTick), 2));
            EXPECT_NEAR(o[k].velocity, 0.8 * (1.0 - 0.08 * k), 1e-4);
        }
        EXPECT(!r.bad);
        Rig z(s);
        z.p.ratchetAmount = 0.0f;
        Run rz;
        z.run(kTick * 4 - 10, rz);
        EXPECT(rz.ons().size() == 4);
    }
}

static void degrees() {
    TEST("scale degrees across octaves");
    const auto& sc = bleep::dsp::scales();
    for (size_t k = 0; k < sc.size(); ++k) {
        int n = 0;
        for (int b = 0; b < 12; ++b) n += (sc[k].mask >> b) & 1;
        for (int d = kPolyMinDegree; d <= kPolyMaxDegree; ++d) {
            const int s = degreeToSemitones(d, sc[k].mask);
            EXPECT(bleep::dsp::inScale(sc[k].mask, s));
            EXPECT(degreeToSemitones(d + n, sc[k].mask) == s + 12);
            if (d > kPolyMinDegree) EXPECT(s > degreeToSemitones(d - 1, sc[k].mask));
        }
    }
    EXPECT(degreeToSemitones(0, sc[1].mask) == 0 && degreeToSemitones(2, sc[1].mask) == 4 &&
           degreeToSemitones(-1, sc[1].mask) == -1 && degreeToSemitones(7, sc[1].mask) == 12);
    EXPECT(degreeToSemitones(5, sc[0].mask) == 5);
}

static void patternChange() {
    TEST("pattern change waits for the next bar; tracks stay in phase");
    PolySlot a = plainSlot(), b = plainSlot();
    b[PolyNote].steps.fill(2);
    b[PolyNote].mute = false;
    Rig rig(a);
    rig.pattern[1] = b;
    rig.p.slotsUsed = 2;
    rig.p.change = PolyNextBar;
    Run r;
    rig.run(kTick * 5, r);
    rig.in.dataSlot = 1;
    rig.run(kTick * 8, r);
    EXPECT(rig.dsp.slot() == 0);
    rig.run(kTick * 4, r);
    EXPECT(rig.dsp.slot() == 1);
    const auto o = r.ons();
    for (const auto& n : o) EXPECT((n.at < kTick * 16 - 2) == (n.note == 60));
    EXPECT(!r.bad);

    TEST("Pattern input selects the slot immediately");
    Rig c(a);
    c.pattern[2] = b;
    c.p.slotsUsed = 4;
    c.p.change = PolyImmediate;
    c.in.patternPatched = true;
    c.in.pattern = 0.6f;
    Run rc;
    c.run(kTick, rc);
    EXPECT(c.dsp.slot() == 2);
}

static void noHanging() {
    TEST("no hanging notes: stop, Reset, pattern change, Hold, edits");
    PolySlot s = plainSlot();
    s[PolyGate].steps.fill((int8_t)kPolyTie);
    s[PolyGate].mute = false;
    Rig rig(s);
    rig.pattern[1] = s;
    rig.pattern[1][PolyNote].steps.fill(3);
    rig.pattern[1][PolyNote].mute = false;
    rig.p.slotsUsed = 2;
    rig.p.change = PolyImmediate;
    Run r;
    rig.run(kTick * 2 + 5, r);
    EXPECT(r.sounding() == 1);
    rig.t.running = false;
    rig.run(2, r);
    EXPECT(r.sounding() == 0);
    rig.t.running = true;
    rig.run(kTick, r);
    EXPECT(r.sounding() == 1);
    rig.in.reset = 1.0f;
    rig.run(1, r);
    rig.in.reset = 0.0f;
    EXPECT(r.sounding() == 0);
    rig.run(kTick * 2, r);
    EXPECT(r.sounding() == 1);
    rig.in.dataSlot = 1;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kTick * 2, r);
    rig.in.hold = 1.0f;
    rig.run(kTick * 2, r);
    const size_t before = r.ons().size();
    rig.run(kTick * 2, r);
    EXPECT(r.ons().size() == before);  // nothing advances while held
    rig.in.hold = 0.0f;
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    rig.run(kTick * 2, r);
    PolyPattern edited = rig.pattern;
    edited[1][PolyNote].steps.fill(4);
    rig.dsp.setPattern(&edited);
    rig.run(1, r);
    EXPECT(r.sounding() == 0);
    EXPECT(!r.bad);

    TEST("Gate Scale above 100 % overlaps legato");
    PolySlot g = plainSlot();
    g[PolyNote].steps[0] = 0;
    g[PolyNote].steps[1] = 2;
    g[PolyNote].length = 2;
    g[PolyNote].hi = 1;
    g[PolyNote].mute = false;
    g[PolyGate].steps.fill(80);  // × 1.5 = 120 % of a hit
    g[PolyGate].mute = false;
    Rig o(g);
    o.p.gateScale = 1.5f;
    Run ro;
    o.run(kTick + 10, ro);
    std::vector<Note> at;
    for (const auto& n : ro.notes)
        if (n.at > 10) at.push_back(n);
    EXPECT(at.size() == 2 && at[0].on && !at[1].on);  // new note-on before the old note-off
}

int main() {
    positions();
    barsAndEnds();
    probability();
    ratchets();
    degrees();
    patternChange();
    noHanging();
    return bleep::test::finish("polymeter-sequencer");
}
