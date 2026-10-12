// SPDX-License-Identifier: MIT
// Unit tests for System Audio's ring and drift-compensating reader (doc/specs/system-audio.md §5). Pure C++.
#include "../app/SystemAudioBuffer.h"

#include <cmath>
#include <cstdio>
#include <vector>

static int g_failures = 0;
static const char* g_test = "";

#define EXPECT(cond)                                                                   \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", g_test, __FILE__, __LINE__, #cond); \
            ++g_failures;                                                              \
        }                                                                              \
    } while (0)

using namespace bleep::app;

namespace {
constexpr double kPi = 3.14159265358979323846;

/// A producer at `inRate` (really `inRate * (1 + drift)`) and a consumer at `outRate`, run in lockstep for `seconds`,
/// the producer delivering `chunk` frames at a time (a capture backend's packets). The input is a sine of `freq` Hz.
struct Run {
    std::vector<float> out;
    uint32_t underruns = 0, overruns = 0;
    double ratio = 0.0;
};

Run simulate(double inRate, double outRate, double drift, double seconds, int chunk, int block, double freq = 440.0) {
    StereoRing ring;
    SystemAudioReader reader;
    reader.prepare(inRate, outRate, block);
    Run run;
    const double realIn = inRate * (1.0 + drift);
    double produced = 0.0, consumedTime = 0.0, producedTime = 0.0;
    uint64_t written = 0;
    std::vector<float> chunkBuf((size_t)chunk), l((size_t)block), r((size_t)block);
    const double blockTime = block / outRate;
    while (consumedTime < seconds) {
        // The producer delivers every chunk whose time has come (its clock is `realIn`).
        while (producedTime + chunk / realIn <= consumedTime + blockTime * 0.5) {
            for (int i = 0; i < chunk; ++i) chunkBuf[(size_t)i] = (float)std::sin(2.0 * kPi * freq * (double)(written + (uint64_t)i) / inRate);
            const float* planes[2] = {chunkBuf.data(), chunkBuf.data()};
            ring.writePlanar(planes, 2, chunk);
            written += (uint64_t)chunk;
            producedTime += chunk / realIn;
            produced += chunk;
        }
        reader.process(ring, l.data(), r.data(), block);
        run.out.insert(run.out.end(), l.begin(), l.end());
        consumedTime += blockTime;
    }
    run.underruns = reader.underruns();
    run.overruns = reader.overruns();
    run.ratio = reader.ratio();
    (void)produced;
    return run;
}

/// The largest sample-to-sample step after `skip` samples: a sine of 440 Hz at 48 kHz moves by at most 0.0576 per sample,
/// so a click (a dropped or repeated frame, a jump) shows as a larger step.
double maxStep(const std::vector<float>& v, size_t skip) {
    double m = 0.0;
    for (size_t i = skip + 1; i < v.size(); ++i) m = std::max(m, (double)std::fabs(v[i] - v[i - 1]));
    return m;
}

/// The frequency of a sine, from its zero crossings (rising), over the samples from `skip`.
double frequencyOf(const std::vector<float>& v, size_t skip, double rate) {
    int crossings = 0;
    double first = -1.0, last = -1.0;
    for (size_t i = skip + 1; i < v.size(); ++i)
        if (v[i - 1] < 0.0f && v[i] >= 0.0f) {
            const double t = (double)(i - 1) + (double)(-v[i - 1]) / (double)(v[i] - v[i - 1]);
            if (first < 0.0) first = t;
            last = t;
            ++crossings;
        }
    return crossings < 2 ? 0.0 : (crossings - 1) * rate / (last - first);
}
}  // namespace

static void sameRate() {
    g_test = "same-rate";
    const auto run = simulate(48000.0, 48000.0, 0.0, 3.0, 480, 256);
    EXPECT(run.underruns == 0);
    EXPECT(run.overruns == 0);
    EXPECT(std::fabs(frequencyOf(run.out, 4800, 48000.0) - 440.0) < 0.5);
    EXPECT(maxStep(run.out, 4800) < 0.07);
}

static void differentRates() {
    g_test = "different-rates";
    for (const double inRate : {44100.0, 96000.0}) {
        const auto run = simulate(inRate, 48000.0, 0.0, 3.0, (int)(inRate / 100), 512);
        EXPECT(run.underruns == 0);
        EXPECT(std::fabs(frequencyOf(run.out, 4800, 48000.0) - 440.0) < 0.5);
        EXPECT(maxStep(run.out, 4800) < 0.07 * 48000.0 / std::min(48000.0, inRate) + 0.01);
    }
}

static void clockDrift() {
    g_test = "clock-drift";
    // The capture runs 300 ppm fast, then slow: 20 seconds, no dropout, no overflow, and no click.
    for (const double drift : {0.0003, -0.0003}) {
        const auto run = simulate(48000.0, 48000.0, drift, 20.0, 480, 256);
        EXPECT(run.underruns == 0);
        EXPECT(run.overruns == 0);
        EXPECT(maxStep(run.out, 4800) < 0.07);
        // The reader follows the capture's clock: 440 Hz of the input is 440 Hz out, to within the drift.
        EXPECT(std::fabs(frequencyOf(run.out, 48000, 48000.0) - 440.0 * (1.0 + drift)) < 0.2);
    }
}

static void bigBursts() {
    g_test = "big-bursts";
    // A backend that delivers 20 ms at a time (the default 30 ms target covers packets up to about that): the fill swings, the output stays whole.
    const auto run = simulate(48000.0, 48000.0, 0.0001, 10.0, 960, 256);
    EXPECT(run.underruns == 0);
    EXPECT(maxStep(run.out, 9600) < 0.07);
}

static void startAndRunDry() {
    g_test = "start-and-dry";
    StereoRing ring;
    SystemAudioReader reader;
    reader.prepare(48000.0, 48000.0, 256);
    std::vector<float> l(256), r(256);
    // Nothing captured yet: silence, and no underrun counted (the reader has not started).
    reader.process(ring, l.data(), r.data(), 256);
    for (float s : l) EXPECT(s == 0.0f);
    EXPECT(reader.underruns() == 0);
    // Data arrives: after the ring has filled to the target, the reader plays it.
    std::vector<float> in(48000, 0.5f);
    ring.writeInterleaved(in.data(), 24000, 2);
    reader.process(ring, l.data(), r.data(), 256);
    EXPECT(l[0] == 0.5f && r[255] == 0.5f);
    // The capture stops: the reader runs dry, plays silence, counts it once and waits for the refill.
    for (int i = 0; i < 400; ++i) reader.process(ring, l.data(), r.data(), 256);
    EXPECT(reader.underruns() == 1);
    EXPECT(l[0] == 0.0f);
}

static void overflowSkips() {
    g_test = "overflow";
    StereoRing ring;
    SystemAudioReader reader;
    reader.prepare(48000.0, 48000.0, 256);
    std::vector<float> l(256), r(256), in(2, 0.25f);
    reader.process(ring, l.data(), r.data(), 256);  // the first block: nothing captured yet
    for (int i = 0; i < 3000; ++i) ring.writeInterleaved(in.data(), 1, 2);
    reader.process(ring, l.data(), r.data(), 256);  // starts, no overrun
    EXPECT(reader.overruns() == 0 && l[0] == 0.25f);
    for (int i = 0; i < 100000; ++i) ring.writeInterleaved(in.data(), 1, 2);  // the device stood still
    reader.process(ring, l.data(), r.data(), 256);
    EXPECT(reader.overruns() == 1);
    EXPECT(l[0] == 0.25f);
}

static void channelMapping() {
    g_test = "channels";
    StereoRing ring;
    const float mono[3] = {0.1f, 0.2f, 0.3f};
    ring.writeInterleaved(mono, 3, 1);  // one channel: both sides
    const float surround[6] = {1.f, 2.f, 3.f, 4.f, 5.f, 6.f};
    ring.writeInterleaved(surround, 1, 6);  // more than two: the first two
    EXPECT(ring.head() == 4);
    EXPECT(ring.left(1) == 0.2f && ring.right(1) == 0.2f);
    EXPECT(ring.left(3) == 1.f && ring.right(3) == 2.f);
    EXPECT(ring.takePeak() == 2.f);
    EXPECT(ring.takePeak() == 0.f);
}

int main() {
    sameRate();
    differentRates();
    clockDrift();
    bigBursts();
    startAndRunDry();
    overflowSkips();
    channelMapping();
    if (g_failures) std::printf("%d failure(s)\n", g_failures);
    else std::printf("system audio: ok\n");
    return g_failures ? 1 : 0;
}
