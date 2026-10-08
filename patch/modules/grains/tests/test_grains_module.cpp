// SPDX-License-Identifier: MIT
#include "GrainsDsp.h"
#include "dsp/tests/TestUtil.h"

// The media store (no JUCE), for the frozen-buffer WAV round trip.
#include "../../../engine/Media.cpp"

#include <filesystem>
#include <memory>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Run {
    std::unique_ptr<GrainsDsp> dsp = std::make_unique<GrainsDsp>();
    GrainsParams p;
    GrainsInput in;
    GrainsFrame f;
    std::vector<float> l, r, grain;
    Run() {
        dsp->prepare(kSr);
        p.spread = 0.0f;
        p.mix = 1.0f;
        p.buffer = 0;  // 2 s
        in.bpm = 120.0;
    }
    template <class Src>
    void render(int n, Src&& src, bool trigger0 = false) {
        for (int i = 0; i < n; ++i) {
            in.l = in.r = src(i);
            in.trigger = trigger0 && i == 0 ? 1.0f : 0.0f;
            dsp->tick(p, in, f);
            if (in.running) in.ppq += in.bpm / 60.0 / kSr;
            l.push_back(f.l);
            r.push_back(f.r);
            grain.push_back(f.grain);
        }
    }
};

static uint64_t g_rng = 3;
static float noise() {
    g_rng = g_rng * 6364136223846793005ull + 1442695040888963407ull;
    return (float)((double)(g_rng >> 11) / 9007199254740992.0 - 0.5);
}

static void singleGrainCopies() {
    TEST("one rectangular grain reproduces the input, delayed");
    Run g;
    g.p.triggered = true;
    g.p.texture = 0.0f;  // rectangle (5 % fades)
    g.p.sizeSeconds = 0.1f;
    g.p.density = 0.5f;  // one grain per trigger
    std::vector<float> x;
    for (int i = 0; i < 30000; ++i) x.push_back(noise());
    g.render(24000, [&](int i) { return x[(size_t)i]; });
    g.render(6000, [&](int i) { return x[(size_t)(24000 + i)]; }, true);
    // The grain starts at 24000 reading 3 samples behind the write head.
    double err = 0.0;
    for (int i = 24000 + 400; i < 24000 + 4400; ++i) err = std::max(err, (double)std::fabs(g.l[(size_t)i] - x[(size_t)(i - 3)]));
    EXPECT(err < 1e-6);
    EXPECT(g.grain[24000] > 0.5f);
}

static void octaveUp() {
    TEST("pitch +12 reads at double speed");
    Run g;
    g.p.triggered = true;
    g.p.sizeSeconds = 0.5f;
    g.p.texture = 0.0f;
    g.p.position = 0.5f;
    g.p.pitch = 12.0f;
    const auto sine = [](int i) { return 0.5f * (float)std::sin(2.0 * kPi * 500.0 * i / kSr); };
    g.render(96000, sine);
    g.render(24000, [&](int i) { return sine(96000 + i); }, true);
    const std::vector<float> mid(g.l.begin() + 96000 + 3000, g.l.begin() + 96000 + 21000);
    EXPECT_NEAR(bleep::test::zeroCrossingHz(mid, kSr), 1000.0, 1.0);
    // Cubic reads of a sine at an octave up: compare against the best-fitting sine.
    double maxAbs = 0.0;
    for (float v : mid) maxAbs = std::max(maxAbs, (double)std::fabs(v));
    EXPECT_NEAR(maxAbs, 0.5, 0.005);
}

static void repeatsAndGrid() {
    TEST("same seed: identical; synced grains land on the grid after a jump");
    Run a, b;
    for (Run* r : {&a, &b}) {
        r->p.density = 0.7f;
        r->p.spread = 0.6f;
        r->p.pitchJitter = 5.0f;
        r->p.reverse = 0.3f;
        r->p.blur = 0.3f;
        r->dsp->restart(4);
        r->p.seed = 4;
        g_rng = 3;
        r->render(48000, [](int) { return noise(); });
    }
    EXPECT(a.l == b.l && a.r == b.r);

    Run s;
    s.p.syncBeats = 0.25;  // 1/16 at 120 BPM = 6000 samples
    s.p.density = 0.5f;
    s.in.running = true;
    s.render(30000, [](int) { return noise(); });
    s.in.ppq = 0.0;  // loop jump
    s.render(30000, [](int) { return noise(); });
    int bad = 0, count = 0;
    for (size_t i = 0; i < s.grain.size(); ++i)
        if (s.grain[i] > 0.5f) {
            ++count;
            const size_t j = i < 30000 ? i : i - 30000;
            if (j % 6000 != 0) ++bad;
        }
    EXPECT(bad == 0);
    EXPECT(count >= 9);
}

static void grainCap() {
    TEST("max grains cap is never exceeded");
    Run g;
    g.p.density = 1.0f;  // 200 grains/s
    g.p.sizeSeconds = 1.0f;
    g.p.maxGrains = 0;  // 16
    int most = 0;
    for (int i = 0; i < 96000; ++i) {
        g.in.l = g.in.r = noise();
        g.dsp->tick(g.p, g.in, g.f);
        most = std::max(most, g.dsp->playingGrains());
        EXPECT(std::isfinite(g.f.l));
    }
    EXPECT(most == 16);
}

static void freezeKeepsBuffer() {
    TEST("freeze stops writing; the buffer stays as it was");
    Run g;
    g.render(48000, [](int) { return noise(); });
    g.in.freeze = true;
    g.render(480, [](int) { return noise(); });  // the 5 ms write crossfade
    std::vector<float> before(g.dsp->channel(0), g.dsp->channel(0) + g.dsp->length());
    const int w = g.dsp->writePos();
    g.render(48000, [](int) { return noise(); });
    EXPECT(g.dsp->writePos() == w);
    EXPECT(std::equal(before.begin(), before.end(), g.dsp->channel(0)));
    EXPECT(g.dsp->frozen());
}

static void feedbackBounded() {
    TEST("feedback 100 % with blur stays bounded");
    Run g;
    g.p.feedback = 1.0f;
    g.p.blur = 1.0f;
    g.p.density = 0.8f;
    g.p.sizeSeconds = 0.3f;
    float peak = 0.0f;
    bool finite = true;
    for (int i = 0; i < 48000 * 30; ++i) {
        g.in.l = g.in.r = noise();
        g.dsp->tick(g.p, g.in, g.f);
        peak = std::max(peak, std::fabs(g.f.l));
        finite = finite && std::isfinite(g.f.l) && std::isfinite(g.f.r);
    }
    EXPECT(finite);
    EXPECT(peak < 8.0f);
}

static void frozenWavRoundTrip() {
    TEST("a frozen buffer saved as WAV comes back identical");
    namespace media = bleep::engine::media;
    const auto dir = std::filesystem::temp_directory_path() / "bleep-grains-test";
    std::filesystem::remove_all(dir);
    media::setFolder(dir.string());
    Run g;
    g.render(20000, [](int) { return noise(); });
    bleep::engine::MediaClip clip;
    clip.sampleRate = kSr;
    for (int c = 0; c < 2; ++c) clip.channels.emplace_back(g.dsp->channel(c), g.dsp->channel(c) + g.dsp->filled());
    const std::string id = media::save(clip);
    EXPECT(media::validId(id));
    const auto back = media::load(id);
    EXPECT(back && back->channels == clip.channels);
    // Played as a clip while frozen: grains read it.
    Run p;
    p.in.freeze = true;
    const float* ch[2] = {back->channels[0].data(), back->channels[1].data()};
    GrainsClip gc{ch, 2, (int)back->numFrames()};
    p.dsp->setClip(&gc);
    p.render(48000, [](int) { return 0.0f; });
    EXPECT(p.dsp->playingClip());
    double e = 0.0;
    for (size_t i = 24000; i < p.l.size(); ++i) e += (double)p.l[i] * p.l[i];
    EXPECT(e > 1.0);
    std::filesystem::remove_all(dir);
}

int main() {
    singleGrainCopies();
    octaveUp();
    repeatsAndGrid();
    grainCap();
    freezeKeepsBuffer();
    feedbackBounded();
    frozenWavRoundTrip();
    return bleep::test::finish("grains module");
}
