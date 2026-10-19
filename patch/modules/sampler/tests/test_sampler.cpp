// SPDX-License-Identifier: GPL-3.0-or-later
#include "SamplerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <memory>
#include <vector>

using namespace bleep::patch;
using namespace bleep::patch::sampler;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Rig {
    std::vector<float> a, b;
    Sample s;
    std::unique_ptr<SamplerDsp> dsp = std::make_unique<SamplerDsp>();
    SamplerParams p;
    SamplerInput in;
    SamplerFrame f;
    std::vector<float> l, r, end, v0;
    Rig() {
        dsp->prepare(kSr);
        p.attack = 0.00001f;  // full level from the first sample
        p.release = 0.01f;
        p.loopFade = 0.0f;
    }
    void load(std::vector<float> left, std::vector<float> right = {}) {
        a = std::move(left);
        b = std::move(right);
        s = Sample();
        s.ch[0] = a.data();
        s.channels = b.empty() ? 1 : 2;
        s.ch[1] = b.empty() ? nullptr : b.data();
        s.frames = (int64_t)a.size();
        apply();
    }
    void apply() {
        s.slices.resize(s.markers.size() + 1);
        dsp->setSample(&s);
    }
    void render(int n) {
        for (int i = 0; i < n; ++i) {
            dsp->tick(p, in, f);
            l.push_back(f.l);
            r.push_back(f.r);
            end.push_back(f.end);
            v0.push_back(f.voice[0]);
        }
    }
    void clear() { l.clear(), r.clear(), end.clear(), v0.clear(); }
};

static std::vector<float> sineClip(int n, double hz) {
    std::vector<float> x((size_t)n);
    for (int i = 0; i < n; ++i) x[(size_t)i] = 0.5f * (float)std::sin(2.0 * kPi * hz * i / kSr);
    return x;
}
static std::vector<float> ramp(int n) {
    std::vector<float> x((size_t)n);
    for (int i = 0; i < n; ++i) x[(size_t)i] = (float)i / (float)n;
    return x;
}

static void wholeSample() {
    TEST("whole sample at root: sample-exact; an octave up plays twice as fast");
    Rig t;
    t.load(ramp(20000));
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(100);
    bool same = true;
    for (int i = 0; i < 100; ++i) same = same && t.l[(size_t)i] == (float)i / 20000.0f;
    EXPECT(same);
    EXPECT(t.r[50] == t.l[50]);  // a mono clip sits in the middle

    Rig u;
    u.load(sineClip(48000, 500.0));
    u.dsp->noteOn(72, 1.0f, 1.0f, u.p);
    u.render(8000);
    const std::vector<float> part(u.l.begin() + 1000, u.l.end());
    EXPECT_NEAR(bleep::test::zeroCrossingHz(part, kSr), 1000.0, 5.0);
}

static void sliceKeys() {
    TEST("slice mode: a key per slice, To end of slice stops at the marker, overflow is ignored");
    Rig t;
    std::vector<float> x(30000);
    for (int i = 0; i < 30000; ++i) x[(size_t)i] = i < 10000 ? 0.1f : i < 20000 ? 0.2f : 0.3f;
    t.load(x);
    t.s.markers = {10000, 20000};
    t.apply();
    t.p.sliceMode = true;
    t.p.mode = ModeToSlice;
    t.dsp->noteOn(61, 0.0f, 1.0f, t.p);
    t.render(100);
    EXPECT_NEAR(t.l[50], 0.2, 1e-6);
    t.render(12000);
    EXPECT_NEAR(t.l[11000], 0.0, 1e-6);  // stopped at the marker (after the 5 ms fade)
    int ends = 0;
    for (float e : t.end) ends += e > 0.5f ? 1 : 0;
    EXPECT(ends > 0);
    t.clear();
    t.dsp->noteOn(63, 0.0f, 1.0f, t.p);  // slice 3 does not exist
    t.render(100);
    EXPECT(t.dsp->activeVoices() == 0);
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(10);
    EXPECT_NEAR(t.l.back(), 0.1, 1e-6);
}

static void playModes() {
    TEST("play modes: Gate releases, To end ignores the gate, Loop wraps, One-shot runs on");
    const int N = 4800;
    {
        Rig t;
        t.load(std::vector<float>((size_t)N, 0.5f));
        t.p.mode = ModeGate;
        t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
        t.render(1000);
        t.dsp->noteOff(60, t.p);
        t.render(2000);
        EXPECT(std::fabs(t.l.back()) < 1e-3f);  // released
    }
    {
        Rig t;
        t.load(std::vector<float>((size_t)N, 0.5f));
        t.p.mode = ModeToSample;
        t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
        t.render(1000);
        t.dsp->noteOff(60, t.p);
        t.render(1000);
        EXPECT_NEAR(t.l.back(), 0.5, 1e-6);  // still playing after the note-off
        t.render(4000);
        EXPECT(t.dsp->activeVoices() == 0);
    }
    {
        Rig t;
        t.load(ramp(N));
        t.p.mode = ModeLoop;
        t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
        t.render(N * 3);
        EXPECT(t.dsp->activeVoices() == 1);
        EXPECT_NEAR(t.l[(size_t)N + 10], t.l[10], 1e-6);  // wrapped
        int wraps = 0;
        for (float e : t.end) wraps += e > 0.5f && true ? 1 : 0;
        EXPECT(wraps >= 2);
        t.dsp->noteOff(60, t.p);
        t.render(2000);
        EXPECT(t.dsp->activeVoices() == 0);
    }
    {
        Rig t;
        t.load(std::vector<float>((size_t)N, 0.5f));
        t.p.mode = ModeOneShot;
        t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
        t.dsp->noteOff(60, t.p);
        t.render(N / 2);
        EXPECT_NEAR(t.l.back(), 0.5, 1e-6);
    }
}

static void loopSeam() {
    TEST("loop crossfade: no jump at the seam");
    Rig t;
    t.load(sineClip(4800, 523.0));  // not a whole number of cycles
    t.p.mode = ModeLoop;
    t.p.loopFade = 0.005f;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(4800 * 3);
    float worst = 0.0f;
    for (size_t i = 1; i < t.l.size(); ++i) worst = std::max(worst, std::fabs(t.l[i] - t.l[i - 1]));
    EXPECT(worst < 0.1f);
}

static void polyphony() {
    TEST("16 voices are independent; a 17th steals the oldest without a click");
    Rig t;
    t.load(std::vector<float>(48000, 0.01f));
    t.p.voices = 16;
    t.p.mode = ModeLoop;
    t.p.release = 0.1f;
    for (int i = 0; i < 16; ++i) t.dsp->noteOn(40 + i, 0.0f, 1.0f, t.p);
    t.render(100);
    EXPECT(t.dsp->activeVoices() == 16);
    EXPECT_NEAR(t.l.back(), 0.16, 1e-5);
    t.dsp->noteOn(80, 0.0f, 1.0f, t.p);
    t.render(1);
    EXPECT(t.dsp->activeVoices() == 16);
    float prev = t.l.back(), worst = 0.0f;
    t.render(400);
    for (size_t i = t.l.size() - 400; i < t.l.size(); ++i) {
        worst = std::max(worst, std::fabs(t.l[i] - prev));
        prev = t.l[i];
    }
    EXPECT(worst < 0.002f);
    t.render(400);
    EXPECT_NEAR(t.l.back(), 0.16, 1e-5);  // back to 16 voices
    t.dsp->noteOff(41, t.p);  // 40 was stolen
    t.render(48000);
    EXPECT(t.dsp->activeVoices() == 15);
}

static void monoLegato() {
    TEST("mono retriggers, legato keeps the playhead, release falls back to the held note");
    Rig t;
    t.load(ramp(48000));
    t.p.voiceMode = VoiceLegato;
    t.p.mode = ModeLoop;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(1000);
    t.dsp->noteOn(72, 1.0f, 1.0f, t.p);  // legato: no restart, twice as fast
    const float before = t.l.back();
    t.render(1);
    EXPECT(t.l.back() > before);
    t.dsp->noteOff(72, t.p);  // falls back to the first note, still playing
    t.render(10);
    EXPECT(t.dsp->activeVoices() == 1);
    t.dsp->noteOff(60, t.p);
    t.render(5000);
    EXPECT(t.dsp->activeVoices() == 0);

    Rig m;
    m.load(ramp(48000));
    m.p.voiceMode = VoiceMono;
    m.p.mode = ModeLoop;
    m.dsp->noteOn(60, 0.0f, 1.0f, m.p);
    m.render(1000);
    m.dsp->noteOn(64, 4.0f / 12.0f, 1.0f, m.p);
    m.render(600);
    EXPECT(m.l.back() < 0.02f);  // restarted from the beginning (the old voice would be at 0.03)
    EXPECT(m.dsp->activeVoices() == 1);
}

static void layers() {
    TEST("layers: one note starts several voices an interval apart");
    Rig t;
    t.load(sineClip(48000, 200.0));
    t.p.voiceMode = VoiceLayers;
    t.p.layers = 3;
    t.p.layerPitch = 12.0f;
    t.p.mode = ModeLoop;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(4000);
    EXPECT(t.dsp->activeVoices() == 3);
    EXPECT(bleep::test::magnitudeAt(t.l, 200.0, kSr) > 0.05);
    EXPECT(bleep::test::magnitudeAt(t.l, 400.0, kSr) > 0.05);
    EXPECT(bleep::test::magnitudeAt(t.l, 800.0, kSr) > 0.05);
    t.dsp->noteOff(60, t.p);
    t.render(4000);
    EXPECT(t.dsp->activeVoices() == 0);
}

static void scrubAndSpeed() {
    TEST("position scrubs without a click; negative speed plays backwards; the Speed input adds octaves");
    Rig t;
    t.load(sineClip(48000, 300.0));
    t.p.mode = ModeLoop;
    t.p.positionMode = PositionScrub;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(1000);
    t.p.position = 0.5f;
    t.render(1000);
    float worst = 0.0f;
    for (size_t i = 1; i < t.l.size(); ++i) worst = std::max(worst, std::fabs(t.l[i] - t.l[i - 1]));
    EXPECT(worst < 0.1f);

    Rig u;
    u.load(ramp(20000));
    u.p.speed = -1.0f;
    u.p.mode = ModeGate;
    u.dsp->noteOn(60, 0.0f, 1.0f, u.p);
    u.render(2000);
    int down = 0;
    for (size_t i = 1; i < u.l.size(); ++i) down += u.l[i] < u.l[i - 1] ? 1 : 0;
    EXPECT(down > 1900);

    Rig w;
    w.load(sineClip(48000, 500.0));
    w.in.speed = 1.0f;
    w.dsp->noteOn(60, 0.0f, 1.0f, w.p);
    w.render(8000);
    const std::vector<float> part(w.l.begin() + 1000, w.l.end());
    EXPECT_NEAR(bleep::test::zeroCrossingHz(part, kSr), 1000.0, 5.0);
}

static void startEnd() {
    TEST("start / end trim the sample (and each slice)");
    Rig t;
    t.load(ramp(10000));
    t.p.start = 0.5f;
    t.p.end = 0.6f;
    t.p.mode = ModeToSample;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(2000);
    EXPECT_NEAR(t.l[0], 0.5, 1e-4);
    EXPECT(t.dsp->activeVoices() == 0);
    int ends = 0;
    for (float e : t.end) ends += e > 0.5f ? 1 : 0;
    EXPECT(ends > 0);
}

static void cvTrigger() {
    TEST("CV mode: trigger, slice CV and gate; unpatched gate plays on");
    Rig t;
    std::vector<float> x(30000);
    for (int i = 0; i < 30000; ++i) x[(size_t)i] = i < 10000 ? 0.1f : i < 20000 ? 0.2f : 0.3f;
    t.load(x);
    t.s.markers = {10000, 20000};
    t.apply();
    t.p.byNote = false;
    t.p.sliceMode = true;
    t.p.mode = ModeGate;
    t.in.triggerPatched = t.in.gatePatched = true;
    t.in.slicePatched = true;
    t.in.slice = 0.9f;  // slice 3
    t.in.gate = 1.0f;
    t.in.trigger = 1.0f;
    t.render(50);
    t.in.trigger = 0.0f;
    EXPECT_NEAR(t.l[10], 0.3, 1e-6);
    t.in.gate = 0.0f;
    t.render(3000);
    EXPECT(t.dsp->activeVoices() == 0);
}

static void voiceOutsAndChoke() {
    TEST("a patched voice output takes the voice out of the mix; choke groups cut each other");
    Rig t;
    t.load(std::vector<float>(48000, 0.2f));
    t.p.voiceOut[0] = true;
    t.p.mode = ModeLoop;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(100);
    EXPECT_NEAR(t.l.back(), 0.0, 1e-9);
    EXPECT_NEAR(t.v0.back(), 0.2, 1e-6);

    Rig c;
    std::vector<float> x(20000, 0.3f);
    c.load(x);
    c.s.markers = {10000};
    c.apply();
    c.s.slices[0].choke = 1;
    c.s.slices[1].choke = 1;
    c.p.sliceMode = true;
    c.p.mode = ModeLoop;
    c.dsp->noteOn(60, 0.0f, 1.0f, c.p);
    c.render(100);
    c.dsp->noteOn(61, 0.0f, 1.0f, c.p);
    c.render(1000);
    EXPECT(c.dsp->activeVoices() == 1);
}

static void filterAndCrush() {
    TEST("the filter darkens, the envelope shapes, crush stays finite");
    Rig t;
    std::vector<float> noise(48000);
    uint32_t r = 1;
    for (auto& v : noise) {
        r = r * 1664525u + 1013904223u;
        v = (float)(r >> 8) / 8388608.0f - 1.0f;
    }
    t.load(noise);
    t.p.mode = ModeLoop;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(4800);
    const double open = bleep::test::rms(t.l);
    Rig u;
    u.load(noise);
    u.p.mode = ModeLoop;
    u.p.cutoff = 300.0f;
    u.dsp->noteOn(60, 0.0f, 1.0f, u.p);
    u.render(4800);
    EXPECT(bleep::test::rms(u.l, 500) < 0.25 * open);

    Rig e;
    e.load(std::vector<float>(48000, 0.5f));
    e.p.mode = ModeLoop;
    e.p.attack = 0.05f;
    e.dsp->noteOn(60, 0.0f, 1.0f, e.p);
    e.render(4800);
    EXPECT(e.l[100] < 0.1f);
    EXPECT_NEAR(e.l.back(), 0.5, 0.01);

    Rig c;
    c.load(noise);
    c.p.mode = ModeLoop;
    c.p.crush = 0.8f;
    c.dsp->noteOn(60, 0.0f, 1.0f, c.p);
    c.render(2000);
    bool finite = true;
    for (float v : c.l) finite = finite && std::isfinite(v) && std::fabs(v) < 2.0f;
    EXPECT(finite);
}

static void qualityAndEdges() {
    TEST("all interpolation qualities, no sample, one-sample and extreme markers stay finite and silent where due");
    for (int q = 0; q < 3; ++q) {
        Rig t;
        t.load(sineClip(48000, 440.0));
        t.p.quality = q;
        t.p.mode = ModeLoop;
        t.dsp->noteOn(67, 7.0f / 12.0f, 1.0f, t.p);
        t.render(4800);
        EXPECT(bleep::test::rms(t.l) > 0.2);
    }
    Rig none;
    none.dsp->noteOn(60, 0.0f, 1.0f, none.p);
    none.render(100);
    EXPECT(none.dsp->activeVoices() == 0);
    Rig one;
    one.load({0.5f});
    one.dsp->noteOn(60, 0.0f, 1.0f, one.p);
    one.render(100);
    EXPECT(one.dsp->activeVoices() == 0);
    Rig ext;
    ext.load(ramp(1000));
    ext.s.markers = {1, 2, 999};
    ext.apply();
    ext.p.sliceMode = true;
    ext.p.mode = ModeLoop;
    for (int i = 0; i < 5; ++i) ext.dsp->noteOn(60 + i, 0.0f, 1.0f, ext.p);
    ext.render(5000);
    bool finite = true;
    for (float v : ext.l) finite = finite && std::isfinite(v);
    EXPECT(finite);
}

/// A decaying tone played with a negative Speed swells up to the hit, in every play mode, with and without Slice Mode
/// (a reversed cymbal: it must not come out silent).
static void negativeSpeedSwells() {
    TEST("negative Speed: a decaying clip swells toward its start in every play mode, whole sample or slice");
    std::vector<float> clip(24000);
    for (int i = 0; i < 24000; ++i) clip[(size_t)i] = 0.8f * (float)(std::exp(-i / 5000.0) * std::sin(2.0 * kPi * 440.0 * i / kSr));
    for (const int mode : {ModeGate, ModeToSample, ModeToSlice, ModeLoop, ModeOneShot})
        for (const bool slices : {false, true})
            for (const bool withMarker : {false, true}) {
                if (withMarker && !slices) continue;
                Rig t;
                t.load(clip);
                if (withMarker) t.s.markers = {12000};
                t.apply();
                t.p.sliceMode = slices;
                t.p.mode = mode;
                t.p.speed = -1.0f;
                t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
                t.render(12000);
                // the hit is reached at the end of the first slice (or of the clip)
                float early = 0.0f, late = 0.0f;
                for (size_t i = 0; i < 4000; ++i) early = std::max(early, std::fabs(t.l[i]));
                for (size_t i = 6000; i < 12000; ++i) late = std::max(late, std::fabs(t.l[i]));
                const float peak = std::max(early, late);
                if (!(peak > 0.05f) || mode != ModeLoop && withMarker && false)
                    std::printf("  mode %d slices %d marker %d: peak %f\n", mode, (int)slices, (int)withMarker, (double)peak);
                EXPECT(peak > 0.05f);
            }
}

// Zero crossings (rising) per second over [from, to).
static double risingHz(const std::vector<float>& x, size_t from, size_t to) {
    int n = 0;
    for (size_t i = from + 1; i < to; ++i) n += x[i - 1] <= 0.0f && x[i] > 0.0f ? 1 : 0;
    return n * kSr / (double)(to - from);
}

// Warp modes: at double speed Repitch goes an octave up, the grain modes keep the pitch and take half the time.
static void warpModes() {
    for (int warp = WarpRepitch; warp <= WarpTexture; ++warp) {
        Rig t;
        t.load(sineClip(48000, 440.0));
        t.p.mode = ModeToSample;
        t.p.speed = 2.0f;
        t.p.warp = warp;
        t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
        t.render(30000);
        const double hz = risingHz(t.l, 2000, 20000);
        float peak = 0.0f;
        for (size_t i = 2000; i < 20000; ++i) peak = std::max(peak, std::fabs(t.l[i]));
        EXPECT(peak > 0.2f);
        if (warp == WarpRepitch) EXPECT(std::fabs(hz - 880.0) < 20.0);
        else if (warp != WarpTexture) EXPECT(std::fabs(hz - 440.0) < 25.0);
        // the clip is over after ~0.5 s: the tail is silent
        float tail = 0.0f;
        for (size_t i = 27000; i < 30000; ++i) tail = std::max(tail, std::fabs(t.l[i]));
        if (warp != WarpTexture) EXPECT(tail < 0.01f);
    }
    // unity speed and transpose: the grains put the sine back together
    Rig t;
    t.load(sineClip(48000, 440.0));
    t.p.mode = ModeToSample;
    t.p.warp = WarpTones;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(20000);
    float peak = 0.0f;
    for (size_t i = 5000; i < 20000; ++i) peak = std::max(peak, std::fabs(t.l[i]));
    EXPECT(peak > 0.45f && peak < 0.55f);
}

// Transpose and the Pitch input move the pitch of a note-triggered playhead.
static void pitchFollows() {
    Rig t;
    t.load(sineClip(48000, 440.0));
    t.p.mode = ModeLoop;
    t.dsp->noteOn(60, 0.0f, 1.0f, t.p);
    t.render(10000);
    t.clear();
    t.p.transpose = 12.0f;
    t.render(10000);
    EXPECT(std::fabs(risingHz(t.l, 2000, 10000) - 880.0) < 25.0);
    t.clear();
    t.p.transpose = 0.0f;
    t.in.pitch = 1.0f;
    t.render(10000);
    EXPECT(std::fabs(risingHz(t.l, 2000, 10000) - 880.0) < 25.0);
}

int main() {
    pitchFollows();
    warpModes();
    negativeSpeedSwells();
    wholeSample();
    sliceKeys();
    playModes();
    loopSeam();
    polyphony();
    monoLegato();
    layers();
    scrubAndSpeed();
    startEnd();
    cvTrigger();
    voiceOutsAndChoke();
    filterAndCrush();
    qualityAndEdges();
    return bleep::test::finish("sampler");
}
