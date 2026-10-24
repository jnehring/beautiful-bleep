// SPDX-License-Identifier: GPL-3.0-only
#include "SpliceDsp.h"
#include "dsp/tests/TestUtil.h"

// The media store (no JUCE), for the WAV import / export round trip.
#include "../../../engine/Media.cpp"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static uint64_t g_rng = 9;
static float noise() {
    g_rng = g_rng * 6364136223846793005ull + 1442695040888963407ull;
    return (float)((double)(g_rng >> 11) / 9007199254740992.0 - 0.5);
}

struct Run {
    std::unique_ptr<SpliceDsp> dsp = std::make_unique<SpliceDsp>();
    SpliceParams p;
    SpliceInput in;
    SpliceFrame f;
    std::vector<float> l, r, end;
    Run() {
        dsp->prepare(kSr);
        p.fadeSeconds = 0.0f;
        p.monitor = MonitorOff;
        in.bpm = 120.0;
    }
    template <class Src>
    void render(int n, Src&& src) {
        for (int i = 0; i < n; ++i) {
            in.l = in.r = src(i);
            dsp->tick(p, in, f);
            if (in.running) in.ppq += in.bpm / 60.0 / kSr;
            l.push_back(f.l);
            r.push_back(f.r);
            end.push_back(f.end);
        }
    }
    /// Records `x` as a new splice (toggle button on, samples, off).
    void record(const std::vector<float>& x) {
        dsp->recordButton();
        render((int)x.size(), [&](int i) { return x[(size_t)i]; });
        dsp->recordButton();  // stops on the next tick, which already plays
    }
    /// The same, then one tick so the take is closed.
    void take(const std::vector<float>& x) {
        record(x);
        render(1, [](int) { return 0.0f; });
    }
    void clearOut() { l.clear(), r.clear(), end.clear(); }
};

static std::vector<float> noiseBlock(int n) {
    std::vector<float> x((size_t)n);
    for (auto& v : x) v = noise();
    return x;
}

static void recordPlays() {
    TEST("record, then play at speed 1: sample-exact");
    Run s;
    const auto x = noiseBlock(24000);
    s.record(x);
    EXPECT(s.dsp->length() == 24000);
    s.clearOut();
    s.render(48000, [](int) { return 0.0f; });
    // The first window starts right after the take; find it and compare.
    int at = -1;
    for (int i = 0; i < 100 && at < 0; ++i)
        if (s.l[(size_t)i] == x[0] && s.l[(size_t)i + 1] == x[1]) at = i;
    EXPECT(at >= 0);
    bool same = at >= 0;
    for (int i = 0; same && i < 24000; ++i) same = s.l[(size_t)(at + i)] == x[(size_t)i];
    EXPECT(same);
    // Loops seamlessly: the second pass starts right after the first.
    for (int i = 0; same && i < 1000 && at + 24000 + i < 48000; ++i) same = s.l[(size_t)(at + 24000 + i)] == x[(size_t)i];
    EXPECT(same);
}

static void speeds() {
    TEST("speed −1 reverses, 2 doubles, the Speed input adds octaves");
    std::vector<float> ramp(24000);
    for (int i = 0; i < 24000; ++i) ramp[(size_t)i] = (float)i / 24000.0f;
    Run s;
    s.p.speed = -1.0f;
    s.record(ramp);
    s.clearOut();
    s.render(24000, [](int) { return 0.0f; });
    int down = 0;
    for (size_t i = 100; i < 23000; ++i) down += s.l[i] < s.l[i - 1] ? 1 : 0;
    EXPECT(down > 22000);

    std::vector<float> sine(48000);
    for (int i = 0; i < 48000; ++i) sine[(size_t)i] = 0.5f * (float)std::sin(2.0 * kPi * 500.0 * i / kSr);
    for (int mode = 0; mode < 2; ++mode) {
        Run t;
        t.p.fadeSeconds = 0.003f;
        t.record(sine);
        if (mode == 0) t.p.speed = 2.0f;
        else t.in.speed = 1.0f;  // +1 V
        t.clearOut();
        t.render(60000, [](int) { return 0.0f; });
        const std::vector<float> part(t.l.begin() + 2000, t.l.begin() + 20000);
        EXPECT_NEAR(bleep::test::zeroCrossingHz(part, kSr), 1000.0, 2.0);
        std::vector<int> ends;
        for (size_t i = 0; i < t.end.size(); ++i)
            if (t.end[i] > 0.5f) ends.push_back((int)i);
        EXPECT(ends.size() >= 2);
        if (ends.size() >= 2) EXPECT(std::abs((ends[1] - ends[0]) - 24000) <= 1);  // half the length
    }
}

static void markers() {
    TEST("markers: mark while recording splits, near duplicates are ignored, deleting merges");
    Run s;
    s.dsp->recordButton();
    s.render(10000, [](int) { return noise(); });
    s.dsp->markButton();
    s.render(1, [](int) { return noise(); });
    s.dsp->markButton();  // 1 sample later: within 10 ms, ignored
    s.render(9999, [](int) { return noise(); });
    s.dsp->recordButton();
    s.render(1, [](int) { return 0.0f; });
    EXPECT(s.dsp->markerCount() == 1);
    EXPECT(s.dsp->marker(0) == 10000);
    EXPECT(s.dsp->spliceCount() == 2);
    // A second take appends a splice.
    s.take(noiseBlock(5000));
    EXPECT(s.dsp->spliceCount() == 3);
    EXPECT(s.dsp->spliceStart(2) == 20000 && s.dsp->spliceEnd(2) == 25000);
    EXPECT(s.dsp->current() == 2);
    // Deleting the middle marker merges splices 2 and 3.
    const int64_t keep[] = {10000};
    s.dsp->setMarkers(keep, 1, 1);
    EXPECT(s.dsp->spliceCount() == 2 && s.dsp->spliceEnd(1) == 25000);
    // Marking while playing splits the current splice at the play head.
    s.render(3000, [](int) { return 0.0f; });
    s.dsp->markButton();
    s.render(1, [](int) { return 0.0f; });
    EXPECT(s.dsp->spliceCount() == 3);
}

static void shifting() {
    TEST("shift: next splice at the end of the splice, or at once; select hysteresis");
    for (int shift : {ShiftSplice, ShiftImmediate}) {
        Run s;
        s.take(noiseBlock(12000));
        s.take(noiseBlock(12000));
        s.dsp->selectSplice(0);
        s.p.shift = ShiftImmediate;
        s.render(10, [](int) { return 0.0f; });
        EXPECT(s.dsp->current() == 0);
        s.p.shift = shift;
        s.render(3000, [](int) { return 0.0f; });
        s.dsp->nextButton();
        s.clearOut();
        s.render(1, [](int) { return 0.0f; });
        if (shift == ShiftImmediate) EXPECT(s.dsp->current() == 1);
        else EXPECT(s.dsp->current() == 0 && s.dsp->pending() == 1);
        s.render(12000, [](int) { return 0.0f; });
        EXPECT(s.dsp->current() == 1);
        if (shift == ShiftSplice) {
            int firstEnd = -1;
            for (size_t i = 0; i < s.end.size() && firstEnd < 0; ++i)
                if (s.end[i] > 0.5f) firstEnd = (int)i;
            EXPECT(firstEnd > 8000 && firstEnd < 9100);  // the rest of splice 1, then the switch
        }
    }
    EXPECT(splice::choose(0.49f, 2, 0) == 0);
    EXPECT(splice::choose(0.51f, 2, 0) == 0);  // inside the 2 % band
    EXPECT(splice::choose(0.53f, 2, 0) == 1);
    EXPECT(splice::choose(0.49f, 2, 1) == 1);
    EXPECT(splice::choose(0.47f, 2, 1) == 0);
}

static void windows() {
    TEST("windows: seamless loops are continuous; overlap voices; seeded pitches repeat");
    std::vector<float> sine(48000);
    for (int i = 0; i < 48000; ++i) sine[(size_t)i] = 0.5f * (float)std::sin(2.0 * kPi * 300.0 * i / kSr);
    Run s;
    s.p.fadeSeconds = 0.005f;
    s.record(sine);
    s.p.window = 0.1f;  // 4800-sample windows
    s.p.position = 0.5f;
    s.p.overlap = 0.4f;  // seamless
    s.clearOut();
    s.render(48000, [](int) { return 0.0f; });
    double maxStep = 0.0;
    for (size_t i = 1000; i < s.l.size(); ++i) maxStep = std::max(maxStep, (double)std::fabs(s.l[i] - s.l[i - 1]));
    EXPECT(maxStep < 0.05);
    EXPECT_NEAR(s.dsp->windowLength(), 4800.0, 1.0);
    EXPECT_NEAR(s.dsp->windowStart(), 21600.0, 1.0);

    for (float ov : {0.5f, 0.75f, 1.0f}) {
        s.p.overlap = ov;
        s.render(24000, [](int) { return 0.0f; });
        int heads = 0;
        s.dsp->forEachHead([&](double) { ++heads; });
        EXPECT(std::abs(heads - (int)std::ceil(splice::overlapFactor(ov))) <= 1);
    }
    std::vector<float> a, b;
    for (int run = 0; run < 2; ++run) {
        Run c;
        c.record(sine);
        c.p.window = 0.2f;
        c.p.overlap = 1.0f;
        c.p.seed = 3;
        c.clearOut();
        c.render(48000, [](int) { return 0.0f; });
        (run == 0 ? a : b) = c.l;
    }
    EXPECT(a == b);
}

static void overdub() {
    TEST("overdub 0 % replaces, 100 % sums");
    for (float amount : {0.0f, 1.0f}) {
        Run s;
        s.record(std::vector<float>(12000, 0.25f));
        s.p.target = SpliceOverdub;
        s.p.overdub = amount;
        s.render(100, [](int) { return 0.0f; });
        s.dsp->recordButton();
        s.render(30000, [](int) { return 0.5f; });
        s.dsp->recordButton();
        s.render(10, [](int) { return 0.0f; });
        const float expect = amount == 0.0f ? 0.5f : 0.25f + 0.5f + 0.5f;  // looped twice: summed again
        const float v = s.dsp->channel(0)[6000];
        if (amount == 0.0f) EXPECT_NEAR(v, expect, 1e-6);
        else EXPECT(v > 0.74f);
    }
}

static void syncBars() {
    TEST("sync: a splice lasts exactly N bars at any tempo, in phase after a jump");
    for (double bpm : {90.0, 120.0, 133.0}) {
        Run s;
        s.record(noiseBlock(30000));
        s.p.sync = 1;  // 1 bar
        s.in.running = true;
        s.in.bpm = bpm;
        s.in.ppq = 0.0;
        s.clearOut();
        const double bar = 4.0 * 60.0 / bpm * kSr;
        s.render((int)(bar * 3.5), [](int) { return 0.0f; });
        std::vector<int> ends;
        for (size_t i = 0; i < s.end.size(); ++i)
            if (s.end[i] > 0.5f) ends.push_back((int)i);
        EXPECT(ends.size() >= 2);
        if (ends.size() >= 2) EXPECT(std::fabs((ends[1] - ends[0]) - bar) <= 1.5);
        // Jump to the middle of a bar: the head is at the middle of the splice.
        s.in.ppq = 6.0;
        s.render(2, [](int) { return 0.0f; });
        EXPECT_NEAR((s.dsp->playhead() - s.dsp->spliceStart(s.dsp->current())) / 30000.0, 0.5, 0.01);
    }
}

static void wavRoundTrip() {
    TEST("reel export and import through WAV; missing media is safe");
    namespace media = bleep::engine::media;
    const auto dir = std::filesystem::temp_directory_path() /
        ("bleep-splice-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::remove_all(dir);
    media::setFolder(dir.string());
    Run s;
    s.take(noiseBlock(20000));
    s.take(noiseBlock(7000));
    bleep::engine::MediaClip clip;
    clip.sampleRate = kSr;
    for (int c = 0; c < 2; ++c) clip.channels.emplace_back(s.dsp->channel(c), s.dsp->channel(c) + s.dsp->length());
    const std::string id = media::save(clip);
    EXPECT(media::validId(id));
    EXPECT(media::save(clip) == id);  // hash-named: stored once
    const auto back = media::load(id);
    EXPECT(back && back->channels == clip.channels);
    if (!back) return;
    Run t;
    const float* ch[2] = {back->channels[0].data(), back->channels[1].data()};
    const int64_t m[] = {20000};
    t.dsp->beginLoad(ch, 2, back->numFrames(), m, 1, 1);
    int chunks = 0;
    while (t.dsp->loading() && chunks < 100) {
        t.dsp->serviceLoad(4096);
        t.render(32, [](int) { return 0.0f; });
        ++chunks;
    }
    EXPECT(!t.dsp->loading());
    EXPECT(t.dsp->length() == 27000 && t.dsp->spliceCount() == 2 && t.dsp->current() == 1);
    EXPECT(std::equal(clip.channels[0].begin(), clip.channels[0].end(), t.dsp->channel(0)));
    EXPECT(!media::load("0123456789abcdef.wav"));
    std::filesystem::remove_all(dir);
}

int main() {
    recordPlays();
    speeds();
    markers();
    shifting();
    windows();
    overdub();
    syncBars();
    wavRoundTrip();
    return bleep::test::finish("splice");
}
