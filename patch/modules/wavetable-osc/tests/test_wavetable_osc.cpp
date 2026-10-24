// SPDX-License-Identifier: GPL-3.0-only
// Wavetable Osc: pitch, aliasing (plain and warped), mip crossfade, grid
// position, paths, warps, stereo and sub, Sync, bank changes, user banks
// (doc/specs/modules/wavetable-oscillator.md §8).
#include "WavetableOscDsp.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdlib>
#include <functional>
#include <set>
#include <vector>

using namespace bleep;
using patch::WavetableOscDsp;
using patch::WavetableOscFrame;
using patch::WavetableOscParams;
namespace wt = dsp::wavetable;
namespace wtosc = patch::wtosc;
using test::rms;
using test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;
constexpr double kC4 = 261.6255653005986;

const dsp::WavetableBank& analog() { return wt::factoryBank(wt::FactoryBank::Analog); }

struct Render {
    std::vector<float> outL, outR, sub, posX, posY;
};

Render render(WavetableOscParams p, int n, const dsp::WavetableBank& bank, int quality = 1,
              const std::function<void(int, WavetableOscDsp&, WavetableOscParams&)>& each = {}, const std::vector<int>& syncAt = {}) {
    WavetableOscDsp d;
    d.prepare(kSr);
    d.setOversampling(quality);
    d.setBank(&bank);
    Render r;
    size_t next = 0;
    for (int i = 0; i < n; ++i) {
        if (each) each(i, d, p);
        const bool sync = next < syncAt.size() && syncAt[next] == i;
        if (sync) ++next;
        const WavetableOscFrame f = d.process(p, sync);
        r.outL.push_back(f.outL), r.outR.push_back(f.outR), r.sub.push_back(f.sub);
        r.posX.push_back(f.posX), r.posY.push_back(f.posY);
    }
    return r;
}

std::vector<float> tail(const std::vector<float>& x, size_t n) { return std::vector<float>(x.end() - (long)n, x.end()); }

double worstNonHarmonicDb(const std::vector<float>& x, double f0, int guard = 10) {
    const size_t n = x.size();
    std::vector<std::complex<double>> buf(n);
    for (size_t i = 0; i < n; ++i) {
        const double t = 6.283185307179586 * (double)i / (double)n;
        buf[i] = (0.35875 - 0.48829 * std::cos(t) + 0.14128 * std::cos(2 * t) - 0.01168 * std::cos(3 * t)) * x[i];
    }
    wt::fft(buf.data(), (int)n, false);
    const double binHz = kSr / (double)n;
    double peak = 1e-30, worst = 1e-30;
    for (size_t i = 1; i < n / 2; ++i) {
        const double hz = (double)i * binHz, m = std::abs(buf[i]);
        peak = std::max(peak, m);
        if (hz > 20000.0 || hz < 20.0) continue;
        if (std::fabs(hz - std::round(hz / f0) * f0) <= guard * binHz) continue;
        worst = std::max(worst, m);
    }
    return 20.0 * std::log10(worst / peak);
}

double maxStep(const std::vector<float>& x, size_t from = 1) {
    double s = 0.0;
    for (size_t i = std::max<size_t>(from, 1); i < x.size(); ++i) s = std::max(s, (double)std::fabs(x[i] - x[i - 1]));
    return s;
}

WavetableOscParams saw() {
    WavetableOscParams p;
    p.x = 0.5f;  // Analog: sine, triangle, saw (x = 0.5), square, pulse
    p.y = 1.0f;  // the brightest row
    return p;
}

void pitch() {
    TEST("0 V plays C4 (Analog at 0, 0 is a sine)");
    const Render r = render(WavetableOscParams{}, 96000, analog());
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.outL, kSr, 100) / kC4)) < 0.1);
    EXPECT(std::fabs(1200.0 * std::log2(zeroCrossingHz(r.sub, kSr, 100) / (kC4 / 2))) < 0.1);
}

void aliasing() {
    TEST("saw C1…C8: aliasing below −58 dB; Sync warp 100 %: below −58 dB");
    // The mip levels keep 4 samples per period of their top harmonic, so the
    // cubic read's images limit the floor near the top of a level (Wavetable.h).
    for (float pitch : {-3.0f, 0.0f, 2.0f, 3.0f, 3.9f}) {
        WavetableOscParams p = saw();
        p.pitch = pitch;
        const Render r = render(p, 65536 + 2048, analog());
        const double db = worstNonHarmonicDb(tail(r.outL, 65536), kC4 * std::exp2(pitch));
        if (db > -58.0) std::printf("  saw alias at pitch %.1f: %.1f dB\n", pitch, db);
        EXPECT(db < -58.0);
    }
    for (int q : {1, 2})
        for (float pitch : {-1.0f, 1.0f, 2.0f}) {
            WavetableOscParams p = saw();
            p.pitch = pitch;
            p.warp = 1.0f;
            p.warpMode = wt::Warp::Sync;
            const Render r = render(p, 65536 + 2048, analog(), q);
            const double db = worstNonHarmonicDb(tail(r.outL, 65536), kC4 * std::exp2(pitch));
            if (db > -58.0) std::printf("  sync-warp alias at %dx, pitch %.1f: %.1f dB\n", q, pitch, db);
            EXPECT(db < -58.0);
        }
}

void mipCrossfade() {
    TEST("no step in brightness between adjacent semitones");
    double last = 0.0;
    for (int st = 0; st <= 36; ++st) {
        WavetableOscParams p = saw();
        p.pitch = 1.0f + st / 12.0f;
        const Render r = render(p, 8192, analog());
        // RMS of the first difference: weighted towards the top harmonics.
        std::vector<float> d(r.outL.size() - 1);
        for (size_t i = 1; i < r.outL.size(); ++i) d[i - 1] = r.outL[i] - r.outL[i - 1];
        const double level = 20.0 * std::log10(rms(d, 2048) / std::exp2(p.pitch));
        if (st > 0) EXPECT(std::fabs(level - last) < 0.5);
        last = level;
    }
}

void position() {
    TEST("grid points play their frame; cell centres the average of four");
    WavetableOscParams p;
    p.pitch = -5.0f;  // 8 Hz: mip level 0
    p.x = 3.0f / 7.0f;
    p.y = 5.0f / 7.0f;
    WavetableOscDsp d;
    d.prepare(kSr);
    d.setBank(&analog());
    double err = 0.0;
    for (int i = 0; i < 4800; ++i) {
        const double ph = d.phase();
        const float y = d.process(p, false).outL;
        err = std::max(err, (double)std::fabs(y - wt::readFrame(analog(), 5 * 8 + 3, ph, wt::Mip{}, wt::Interp::Cubic)));
    }
    EXPECT(err < 1e-5);
    p.x = 3.5f / 7.0f;
    p.y = 5.5f / 7.0f;
    WavetableOscDsp e;
    e.prepare(kSr);
    e.setBank(&analog());
    err = 0.0;
    for (int i = 0; i < 4800; ++i) {
        const double ph = e.phase();
        const float y = e.process(p, false).outL;
        float avg = 0.0f;
        for (int f : {5 * 8 + 3, 5 * 8 + 4, 6 * 8 + 3, 6 * 8 + 4}) avg += 0.25f * wt::readFrame(analog(), f, ph, wt::Mip{}, wt::Interp::Cubic);
        err = std::max(err, (double)std::fabs(y - avg));
    }
    EXPECT(err < 1e-5);
}

void paths() {
    TEST("paths visit every cell once; Snake and Spiral only step to neighbours; Scan ends");
    for (auto path : {wtosc::Path::Rows, wtosc::Path::Snake, wtosc::Path::Columns, wtosc::Path::Diagonal, wtosc::Path::Spiral})
        for (auto [cols, rows] : {std::pair{8, 8}, std::pair{8, 3}, std::pair{5, 1}, std::pair{1, 1}}) {
            uint8_t x[64], y[64];
            const int n = wtosc::pathCells(path, cols, rows, x, y);
            EXPECT(n == cols * rows);
            std::set<int> seen;
            for (int i = 0; i < n; ++i) seen.insert(x[i] + 8 * y[i]);
            EXPECT((int)seen.size() == n);
            if (path == wtosc::Path::Snake || path == wtosc::Path::Spiral)
                for (int i = 1; i < n; ++i) EXPECT(std::abs(x[i] - x[i - 1]) + std::abs(y[i] - y[i - 1]) == 1);
            if (path == wtosc::Path::Diagonal)
                for (int i = 1; i < n; ++i) EXPECT(std::max(std::abs(x[i] - x[i - 1]), std::abs(y[i] - y[i - 1])) <= 2);
        }
    for (auto path : {wtosc::Path::Rows, wtosc::Path::Snake, wtosc::Path::Spiral}) {
        uint8_t x[64], y[64];
        const int n = wtosc::pathCells(path, 8, 8, x, y);
        for (float scan : {0.0f, 1.0f}) {
            WavetableOscParams p;
            p.path = path;
            p.scan = scan;
            const Render r = render(p, 64, analog());
            const int i = scan > 0.5f ? n - 1 : 0;
            EXPECT_NEAR(r.posX.back(), x[i] / 7.0, 1e-5);
            EXPECT_NEAR(r.posY.back(), y[i] / 7.0, 1e-5);
        }
    }
}

void warps() {
    TEST("warps at 0 % are the identity; Squash 100 % holds 90 % of the cycle");
    WavetableOscParams p = saw();
    p.pitch = -1.0f;
    const Render plain = render(p, 4800, analog());
    for (auto mode : {wt::Warp::Bend, wt::Warp::Sync, wt::Warp::Mirror, wt::Warp::Squash, wt::Warp::Steps}) {
        p.warpMode = mode;
        EXPECT(render(p, 4800, analog()).outL == plain.outL);
    }
    WavetableOscParams q;  // sine: the held value is sin(0) = 0
    q.pitch = (float)std::log2(100.0 / kC4);  // 480 samples per cycle
    q.warp = 1.0f;
    q.warpMode = wt::Warp::Squash;
    const Render r = render(q, 4800, analog());
    int held = 0;
    for (size_t i = 480; i < 960; ++i) held += std::fabs(r.outL[i]) < 2e-3f;
    EXPECT(held >= 425);
}

void stereoSubSync() {
    TEST("Stereo 0: L = R; Sub keeps phase after Sync; Sync restarts cleanly");
    WavetableOscParams p = saw();
    Render r = render(p, 4800, analog());
    EXPECT(r.outL == r.outR);
    p.stereo = 0.3f;
    r = render(p, 4800, analog());
    EXPECT(r.outL != r.outR);
    p.stereo = 0.0f;
    p.pitch = 0.37f;
    p.subLevel = 0.5f;
    const Render a = render(p, 12000, analog(), 1, {}, {5000});
    const Render fresh = render(p, 7000, analog());
    double err = 0.0;
    for (size_t i = 5001; i < 12000; ++i)
        err = std::max(err, (double)std::fabs(a.outL[i] - fresh.outL[i - 5000]) + std::fabs(a.sub[i] - fresh.sub[i - 5000]));
    EXPECT(err < 1e-4);
    EXPECT(test::allFinite(a.outL));
}

void bankChange() {
    TEST("bank change and user bank swap are click-free");
    WavetableOscParams p;
    p.pitch = -2.0f;
    p.x = 0.6f;
    p.y = 0.4f;
    const auto& harmonic = wt::factoryBank(wt::FactoryBank::Harmonic);
    std::vector<std::vector<float>> cycles(3, std::vector<float>(1000));
    for (int c = 0; c < 3; ++c)
        for (int i = 0; i < 1000; ++i) cycles[(size_t)c][(size_t)i] = (float)(std::sin(6.283185307 * i / 1000.0 * (c + 1)) + 0.5);
    const dsp::WavetableBank user = wt::bankFromCycles(cycles);
    EXPECT(user.cols() == 3 && user.rows() == 1);
    const double base = maxStep(render(p, 4800, analog()).outL, 10);
    const Render r = render(p, 9600, analog(), 1, [&](int i, WavetableOscDsp& d, WavetableOscParams&) {
        if (i == 2000) d.setBank(&harmonic);
        if (i == 6000) d.setBank(&user);
    });
    EXPECT(maxStep(r.outL, 10) < base + 0.1);
    // DC is removed from imported cycles.
    double mean = 0.0;
    for (size_t i = 7000; i < 9600; ++i) mean += r.outL[i];
    EXPECT(std::fabs(mean / 2600.0) < 0.05);
}

void userCycles() {
    TEST("user banks: 1, 8, 64, 100 cycles → 1, 8, 64, 64 frames");
    for (auto [n, frames] : {std::pair{1, 1}, std::pair{8, 8}, std::pair{64, 64}, std::pair{100, 64}}) {
        std::vector<float> x((size_t)n * 2048);
        for (size_t i = 0; i < x.size(); ++i) x[i] = (float)std::sin(6.283185307 * (double)i / 2048.0);
        const auto b = wt::bankFromSamples(x.data(), x.size());
        EXPECT(std::min(b.frames(), frames) == frames);
        EXPECT(b.cols() * b.rows() >= frames && b.cols() * (b.rows() - 1) < frames);
    }
}

void bounds() {
    TEST("extremes stay finite and bounded");
    for (int q : {1, 2})
        for (auto mode : {wt::Warp::Bend, wt::Warp::Sync, wt::Warp::Mirror, wt::Warp::Squash, wt::Warp::Steps})
            for (auto read : {wtosc::Read::Cubic, wtosc::Read::Raw}) {
                WavetableOscParams p = saw();
                p.pitch = 4.5f;
                p.fm = 1.0f;
                p.fmDepth = 1.0f;
                p.warp = 0.7f;
                p.warpMode = mode;
                p.read = read;
                p.stereo = -0.5f;
                p.subLevel = 1.0f;
                p.stepBlend = true;
                p.path = wtosc::Path::Spiral;
                const Render r = render(p, 4800, wt::factoryBank(wt::FactoryBank::FM), q,
                                        [](int i, WavetableOscDsp&, WavetableOscParams& pp) { pp.scan = (float)(i % 480) / 480.0f; },
                                        {100, 1000, 1001});
                for (const auto* v : {&r.outL, &r.outR, &r.sub, &r.posX, &r.posY}) {
                    EXPECT(test::allFinite(*v));
                    for (float s : *v) EXPECT(std::fabs(s) < 2.0f);
                }
            }
}

}  // namespace

int main() {
    pitch();
    aliasing();
    mipCrossfade();
    position();
    paths();
    warps();
    stereoSubSync();
    bankChange();
    userCycles();
    bounds();
    return test::finish("wavetable-osc");
}
