// SPDX-License-Identifier: MIT
// drum_tests.cpp — the drum voices.

#include "dsp_test.h"

struct DrumRun {
    float peak = 0.0f;   ///< whole run
    float before = 0.0f; ///< peak before the trigger
    float end = 0.0f;    ///< peak in the last 100 ms
    bool finite = true;
    std::vector<float> out;
};

/// Runs a voice for `seconds`, triggering `input` at 10 ms.
template <class V>
static DrumRun drum(const typename V::Params& p, float seconds, float velocity = 1.0f, int input = 0) {
    V v;
    v.prepare(48000.0);
    v.reset();
    DrumRun r;
    const int n = (int)(seconds * 48000.0f);
    for (int i = 0; i < n; ++i) {
        if (i == 480) v.trigger(input, velocity);
        const float x = v.tick(p);
        r.out.push_back(x);
        r.finite = r.finite && std::isfinite(x);
        r.peak = std::max(r.peak, std::fabs(x));
        if (i < 480) r.before = std::max(r.before, std::fabs(x));
        if (i >= n - 4800) r.end = std::max(r.end, std::fabs(x));
    }
    return r;
}

/// Frequency from positive-going zero crossings between two times.
static double crossingHz(const std::vector<float>& x, double from, double to) {
    int count = 0, first = -1, last = -1;
    for (int i = (int)(from * 48000); i < (int)(to * 48000) && i < (int)x.size(); ++i)
        if (x[(size_t)i - 1] < 0.0f && x[(size_t)i] >= 0.0f) {
            if (first < 0) first = i;
            last = i;
            ++count;
        }
    return count > 1 ? (count - 1) * 48000.0 / (last - first) : 0.0;
}

/// Every drum voice: silent until triggered, sounds at a sane level, dies away.
template <class V>
static void drumBasics(const char* name, typename V::Params p = {}, float seconds = 4.0f, int input = 0) {
    g_test = name;
    const auto r = drum<V>(p, seconds, 1.0f, input);
    EXPECT(r.finite);
    EXPECT(r.before == 0.0f);
    EXPECT(r.peak > 0.3f && r.peak < 1.5f);
    EXPECT(r.end < 1e-3f * r.peak);
    const auto soft = drum<V>(p, seconds, 0.25f, input);
    EXPECT(soft.peak < 0.6f * r.peak && soft.peak > 0.05f * r.peak);
}

static void drums() {
    drumBasics<RingKick>("ring kick");
    drumBasics<RingSnare>("ring snare");
    drumBasics<RingClap>("ring clap");
    drumBasics<RingTom>("ring tom");
    drumBasics<RingRim>("ring rim");
    drumBasics<RingRim>("ring clave", {RingRim::Clave});
    drumBasics<RingCowbell>("ring cowbell");
    drumBasics<RingHats>("ring hats closed", {}, 2.0f, RingHats::Closed);
    drumBasics<RingHats>("ring hats open", {}, 4.0f, RingHats::Open);
    drumBasics<RingCymbal>("ring cymbal", {}, 6.0f);
    drumBasics<PunchKick>("punch kick");
    drumBasics<PunchSnare>("punch snare");
    drumBasics<PunchClap>("punch clap");
    drumBasics<PunchTom>("punch tom");
    drumBasics<PunchRim>("punch rim");
    drumBasics<PunchHats>("punch hats closed", {}, 2.0f, PunchHats::Closed);
    drumBasics<PunchHats>("punch hats open", {}, 4.0f, PunchHats::Open);
    drumBasics<PunchCymbal>("punch crash", {}, 8.0f);
    PunchCymbal::Params ride;
    ride.voice = PunchCymbal::Ride;
    drumBasics<PunchCymbal>("punch ride", ride, 10.0f);

    g_test = "drum pitch";
    {  // Without sweep, kicks and toms ring at Tune.
        RingKick::Params k;
        k.sweep = 0.0f;
        k.tone = 0.0f;
        k.tuneHz = 60.0f;
        EXPECT_NEAR(crossingHz(drum<RingKick>(k, 1.0f).out, 0.1, 0.6), 60.0, 0.5);
        PunchKick::Params pk;
        pk.sweep = 0.0f;
        pk.attack = 0.0f;
        pk.drive = 0.0f;
        pk.tuneHz = 45.0f;
        EXPECT_NEAR(crossingHz(drum<PunchKick>(pk, 1.0f).out, 0.1, 0.6), 45.0, 0.5);
        // With sweep the pitch starts higher and settles on Tune.
        pk.sweep = 1.0f;
        const auto swept = drum<PunchKick>(pk, 1.5f).out;
        EXPECT(crossingHz(swept, 0.0105, 0.03) > 1.8 * 45.0);
        EXPECT_NEAR(crossingHz(swept, 0.8, 1.4), 45.0, 1.5);
        RingTom::Params t;
        t.noise = 0.0f;
        t.bend = 0.0f;
        t.tuneHz = 200.0f;
        EXPECT_NEAR(crossingHz(drum<RingTom>(t, 1.0f).out, 0.05, 0.3), 200.0, 1.0);
    }

    g_test = "drum decay";
    {  // Decay sets how long a voice rings (−60 dB).
        auto ringsFor = [](const std::vector<float>& x) {
            float peak = 0.0f;
            for (float v : x) peak = std::max(peak, std::fabs(v));
            size_t last = 0;
            for (size_t i = 0; i < x.size(); ++i)
                if (std::fabs(x[i]) > 1e-3f * peak) last = i;
            return (double)(last - 480) / 48000.0;
        };
        RingKick::Params k;
        k.decay = 1.5f;
        EXPECT_NEAR(ringsFor(drum<RingKick>(k, 3.0f).out), 1.5, 0.1);
        PunchTom::Params t;
        t.decay = 0.3f;
        t.noise = 0.0f;
        EXPECT_NEAR(ringsFor(drum<PunchTom>(t, 1.0f).out), 0.3, 0.05);
    }

    g_test = "hats choke";
    {  // A closed hit cuts a ringing open hat.
        RingHats v;
        v.prepare(48000.0);
        RingHats::Params p;
        p.openDecay = 3.0f;
        v.trigger(RingHats::Open, 1.0f);
        float open = 0.0f, after = 0.0f;
        for (int i = 0; i < 9600; ++i) open = std::max(open, std::fabs(v.tick(p)));
        v.trigger(RingHats::Closed, 1.0f);
        for (int i = 0; i < 24000; ++i) {
            const float x = std::fabs(v.tick(p));
            if (i > 14400) after = std::max(after, x);
        }
        EXPECT(after < 1e-3f * open);
    }

    g_test = "clap bursts";
    {  // Four bursts → four separate peaks in the envelope before the tail.
        RingClap::Params p;
        p.spread = 0.015f;
        const auto r = drum<RingClap>(p, 0.5f);
        int peaks = 0;
        for (int b = 0; b < 4; ++b) {
            const int start = 480 + (int)(b * p.spread * 48000.0f);
            float early = 0.0f, late = 0.0f;
            for (int i = 0; i < 100; ++i) early = std::max(early, std::fabs(r.out[(size_t)(start + i)]));
            for (int i = 500; i < 700; ++i) late = std::max(late, std::fabs(r.out[(size_t)(start + i)]));
            if (b < 3 && early > 3.0f * late) ++peaks;
            if (b == 3 && early > 0.05f) ++peaks;
        }
        EXPECT(peaks == 4);
    }

    g_test = "drum reset";
    {  // reset() silences a ringing voice.
        RingCymbal v;
        v.prepare(48000.0);
        RingCymbal::Params p;
        v.trigger(0, 1.0f);
        for (int i = 0; i < 1000; ++i) v.tick(p);
        v.reset();
        float after = 0.0f;
        for (int i = 0; i < 1000; ++i) after = std::max(after, std::fabs(v.tick(p)));
        EXPECT(after == 0.0f);
    }
}


void runDrumTests() {
    drums();
}
