// SPDX-License-Identifier: GPL-3.0-or-later
#include "ZoneDelayDsp.h"
#include "dsp/tests/TestUtil.h"

#include <memory>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    std::unique_ptr<ZoneDelayDsp> dsp = std::make_unique<ZoneDelayDsp>();
    ZoneDelayParams p;
    ZoneDelayInput in;
    ZoneDelayFrame f;
    explicit Run(double sr = kSr) {
        dsp->prepare(sr);
        p.wobble = 0.0f;
        p.character = 0.0f;
        p.mix = 1.0f;
        p.feedback = 0.0f;
    }
    /// Renders n samples of `src(i)` (mono into L); returns wet L (and R).
    template <class Src>
    void render(int n, Src&& src, std::vector<float>& l, std::vector<float>* r = nullptr) {
        for (int i = 0; i < n; ++i) {
            in.l = in.r = src(i);
            dsp->tick(p, in, f);
            l.push_back(f.wetL);
            if (r) r->push_back(f.wetR);
        }
    }
};

static int firstAbove(const std::vector<float>& x, float th, size_t from = 0) {
    for (size_t i = from; i < x.size(); ++i)
        if (std::fabs(x[i]) > th) return (int)i;
    return -1;
}

static void zoneTimes() {
    TEST("zone free ranges and synced note values");
    for (double bpm : {120.0, 90.0}) {
        Run r;
        r.in.bpm = bpm;
        int note = 0;
        for (int z = 1; z <= 5; ++z) {
            r.p.zone = z;
            r.p.synced = false;
            r.p.time = 0.0f;
            EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), zone::range(z).loMs * 48.0, 1.0);
            r.p.time = 1.0f;
            EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), zone::range(z).hiMs * 48.0, 1.0);
        }
        r.p.synced = true;
        r.p.zone = 3;
        r.p.time = 0.5f;  // Echo: 13 values, the middle one is 1/8
        EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), 0.5 * 60.0 / bpm * kSr, 1.0);
        EXPECT(note == 6);
        r.p.zone = 5;
        r.p.time = 1.0f;  // 8 bars, clamped to 20 s at 90 BPM
        EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), std::min(32.0 * 60.0 / bpm, 20.0) * kSr, 1.0);
        r.p.zone = 2;
        r.p.time = 0.0f;  // 1/128
        EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), 0.03125 * 60.0 / bpm * kSr, 1.0);
    }
    // An impulse arrives after the free time (Echo, Time 0 = 80 ms).
    Run r;
    r.p.zone = 3;
    r.p.time = 0.0f;
    std::vector<float> l;
    r.render(8000, [](int i) { return i == 0 ? 1.0f : 0.0f; }, l);
    EXPECT(std::abs(firstAbove(l, 0.3f) - 3840) <= 1);
}

static void clockMode() {
    TEST("clock: measured interval × ratio");
    Run r;
    r.p.zone = 3;
    r.p.time = 0.5f;  // ratio 1
    r.in.clockPatched = true;
    std::vector<float> l;
    for (int i = 0; i < 60000; ++i) {
        r.in.clock = i % 20000 == 0 ? 1.0f : 0.0f;
        r.in.l = r.in.r = 0.0f;
        r.dsp->tick(r.p, r.in, r.f);
    }
    int note = 0;
    EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), 20000.0, 0.5);
    r.p.time = 0.0f;  // ratio 1/4 = 5000 samples: clamped to the zone's 80 ms
    EXPECT_NEAR(r.dsp->baseDelay(r.p, r.in, note), 5000.0, 0.5);
}

static void combTunes() {
    TEST("comb zone plays the Pitch input in tune");
    Run r;
    r.p.zone = 1;
    r.p.time = 0.5f;
    r.p.feedback = 0.95f;
    r.in.pitchPatched = true;
    r.in.pitch = 0.75f;  // A4
    std::vector<float> l;
    r.render(48000, [](int i) { return i < 4 ? 0.5f : 0.0f; }, l);
    const std::vector<float> tail(l.begin() + 2400, l.end());
    double best = 0.0, hz = 0.0;
    for (double f = 425.0; f <= 455.0; f += 0.02)
        if (const double m = bleep::test::magnitudeAt(tail, f, kSr); m > best) best = m, hz = f;
    EXPECT_NEAR(1200.0 * std::log2(hz / 440.0), 0.0, 3.0);
}

static void tapeBends() {
    TEST("tape: a time step bends pitch without a jump");
    Run r;
    r.p.zone = 3;
    r.p.time = 0.3f;
    r.p.glide = 0.2f;
    std::vector<float> l;
    const auto sine = [](int i) { return 0.5f * (float)std::sin(2.0 * kPi * 500.0 * i / kSr); };
    r.render(48000, sine, l);
    r.p.time = 0.6f;  // longer: the head slows down, pitch drops during the glide
    std::vector<float> g;
    r.render(96000, [&](int i) { return sine(48000 + i); }, g);
    double maxStep = 0.0;
    for (size_t i = 1; i < g.size(); ++i) maxStep = std::max(maxStep, (double)std::fabs(g[i] - g[i - 1]));
    EXPECT(maxStep < 0.5 * 2.0 * kPi * 500.0 / kSr * 1.3);  // never steeper than the sine itself (+30 %)
    const double during = bleep::test::zeroCrossingHz(std::vector<float>(g.begin() + 1000, g.begin() + 6000), kSr);
    EXPECT(during < 480.0);
    const double after = bleep::test::zeroCrossingHz(std::vector<float>(g.end() - 4800, g.end()), kSr);
    EXPECT_NEAR(after, 500.0, 2.0);
}

static void crossfadeKeepsPitch() {
    TEST("crossfade: a time step keeps the pitch");
    Run r;
    r.p.zone = 3;
    r.p.time = 0.3f;
    r.p.crossfade = true;
    std::vector<float> l;
    const auto sine = [](int i) { return 0.5f * (float)std::sin(2.0 * kPi * 500.0 * i / kSr); };
    r.render(48000, sine, l);
    std::vector<float> g;
    for (int i = 0; i < 48000; ++i) {
        r.p.time = 0.3f + 0.3f * (float)((i / 200) % 2);  // faster than the fade: stepped
        r.in.l = r.in.r = sine(48000 + i);
        r.dsp->tick(r.p, r.in, r.f);
        g.push_back(r.f.wetL);
    }
    double maxStep = 0.0;
    for (size_t i = 1; i < g.size(); ++i) maxStep = std::max(maxStep, (double)std::fabs(g[i] - g[i - 1]));
    EXPECT(maxStep < 0.12);  // click-free
    EXPECT(bleep::test::allFinite(g));
    r.p.time = 0.6f;
    std::vector<float> h;
    r.render(24000, [&](int i) { return sine(96000 + i); }, h);
    const double hz = bleep::test::zeroCrossingHz(h, kSr);
    EXPECT_NEAR(hz, 500.0, 3.0);
}

static void reverseRamp() {
    TEST("reverse: a ramp comes out descending; constant input stays constant");
    Run r;
    r.p.zone = 3;
    r.p.time = 0.0f;  // 80 ms windows
    r.p.reverse = true;
    std::vector<float> l;
    r.render(48000, [](int i) { return (float)(i % 48000) / 48000.0f; }, l);
    // Each head reads the ramp backwards; their raised-cosine crossfade adds
    // the window shape on top, so a forward ramp (never descending) turns into
    // a signal that descends for a good part of every window.
    int down = 0;
    for (size_t i = 20000; i < 40000; ++i) down += l[i] < l[i - 1] ? 1 : 0;
    EXPECT(down > 3000);
    Run c;
    c.p.zone = 3;
    c.p.time = 0.0f;
    c.p.reverse = true;
    std::vector<float> k;
    c.render(48000, [](int) { return 0.5f; }, k);
    float lo = 1.0f, hi = 0.0f;
    for (size_t i = 24000; i < k.size(); ++i) lo = std::min(lo, k[i]), hi = std::max(hi, k[i]);
    EXPECT(hi - lo < 1e-3f);
}

static void holdLoops() {
    TEST("hold: the loop repeats while the input goes on");
    Run r;
    r.p.zone = 3;
    r.p.time = 0.0f;  // 3840 samples
    r.p.crossfade = true;
    std::vector<float> l;
    uint64_t s = 1;
    const auto noise = [&](int) {
        s = s * 6364136223846793005ull + 1442695040888963407ull;
        return (float)((double)(s >> 11) / 9007199254740992.0 - 0.5);
    };
    r.render(20000, noise, l);
    r.p.hold = true;
    std::vector<float> h;
    r.render(48000 * 4, noise, h);
    const int L = 3840;
    double err = 0.0;
    for (size_t i = 10000; i + L < h.size(); ++i) err = std::max(err, (double)std::fabs(h[i] - h[i + L]));
    EXPECT(err < 1e-5);
    r.p.hold = false;  // release: no click
    std::vector<float> g;
    r.render(4800, noise, g);
    EXPECT(bleep::test::allFinite(g));
}

static void feedbackBounded() {
    TEST("feedback 110 % stays bounded for every character");
    for (float ch : {0.0f, 0.25f, 0.5f, 0.75f, 1.0f, 0.4f}) {
        Run r;
        r.p.zone = 2;
        r.p.time = 0.2f;
        r.p.feedback = 1.1f;
        r.p.character = ch;
        r.p.diffuse = 0.5f;
        std::vector<float> l;
        uint64_t s = 7;
        r.render(48000 * 4, [&](int i) {
            s = s * 6364136223846793005ull + 1442695040888963407ull;
            return i < 4800 ? (float)((double)(s >> 11) / 9007199254740992.0 - 0.5) : 0.0f;
        }, l);
        float peak = 0.0f;
        for (float v : l) peak = std::max(peak, std::fabs(v));
        EXPECT(bleep::test::allFinite(l));
        EXPECT(peak < 2.0f);  // < +6 dBFS
    }
}

static void pingPong() {
    TEST("ping-pong: an impulse alternates R, L, R …");
    Run r;
    r.p.zone = 3;
    r.p.time = 0.0f;
    r.p.feedback = 0.8f;
    r.p.pingPong = true;
    std::vector<float> warm;
    r.render(2000, [](int) { return 0.0f; }, warm);  // ramp the switch in
    std::vector<float> l, rr;
    r.render(3840 * 4 + 100, [](int i) { return i == 0 ? 1.0f : 0.0f; }, l, &rr);
    const int D = 3840;
    EXPECT(std::fabs(l[D]) > 0.5f && std::fabs(rr[D]) < 0.01f);          // first pass: left only
    EXPECT(std::fabs(rr[2 * D]) > 0.3f && std::fabs(l[2 * D]) < 0.01f);  // then right
    EXPECT(std::fabs(l[3 * D]) > 0.2f && std::fabs(rr[3 * D]) < 0.01f);  // then left again
}

static void clearOnPlayRepeats() {
    TEST("clear on play: bit-identical renders after the clear");
    std::vector<float> a, b;
    for (int run = 0; run < 2; ++run) {
        Run r;
        r.p.zone = 3;
        r.p.wobble = 0.6f;
        r.p.character = 0.3f;
        r.p.feedback = 0.7f;
        r.p.diffuse = 0.4f;
        std::vector<float> pre;
        r.render(10000 + run * 7777, [&](int i) { return (float)std::sin(i * 0.01 * (run + 1)); }, pre);
        r.dsp->clear();
        auto& out = run == 0 ? a : b;
        r.render(48000, [](int i) { return (float)std::sin(i * 0.031); }, out);
    }
    bool same = true;
    for (size_t i = 480; i < a.size(); ++i) same = same && a[i] == b[i];  // after the 5 ms declick
    EXPECT(same);
}

int main() {
    zoneTimes();
    clockMode();
    combTunes();
    tapeBends();
    crossfadeKeepsPitch();
    reverseRamp();
    holdLoops();
    feedbackBounded();
    pingPong();
    clearOnPlayRepeats();
    return bleep::test::finish("zone-delay");
}
