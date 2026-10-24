// SPDX-License-Identifier: GPL-3.0-only
// Speak: the phoneme parser, determinism, the voice's formant peaks, silence in
// plosive closures, the three modes and bounds.
#include "SpeakDsp.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
namespace sp = patch::speak;
using patch::SpeakDsp;
using patch::SpeakParams;

namespace {

constexpr double kSr = 48000.0;

std::vector<float> render(const std::string& text, const SpeakParams& p, int n, bool gateAlways = true) {
    const auto seq = sp::parse(text);
    SpeakDsp d;
    d.prepare(kSr);
    d.reset();
    std::vector<float> out;
    for (int i = 0; i < n; ++i) out.push_back(d.tick(&seq, p, gateAlways).out);
    return out;
}

const char* name(int i) { return sp::table()[(size_t)i].sym; }

void parser() {
    TEST("the parser: digraphs, accents, lengthening, pauses, separators and junk");
    auto q = sp::parse("ma'ri");
    EXPECT(q.count == 4);
    EXPECT(std::string(name(q.seg[0].phoneme)) == "m");
    EXPECT(std::string(name(q.seg[2].phoneme)) == "r");
    EXPECT(q.seg[2].accent && !q.seg[1].accent);
    q = sp::parse("sh ee: ng");
    EXPECT(q.count == 5);  // sh, pause, ee, pause, ng
    EXPECT(q.seg[2].length > 1.5f);
    q = sp::parse("a_e");
    EXPECT(q.count == 2);
    q = sp::parse("ae");
    EXPECT(q.count == 1);
    q = sp::parse("Q3#!? A");  // upper case works, junk is skipped
    EXPECT(q.count == 2);
    EXPECT(sp::parse("").count == 0);
    EXPECT(sp::parse(std::string(2000, 'a')).count == sp::kMaxSegments);
}

void deterministic() {
    TEST("same text, same samples");
    SpeakParams p;
    EXPECT(render("h e l o . w er l d", p, 20000) == render("h e l o . w er l d", p, 20000));
}

void formants() {
    TEST("a sustained vowel has its energy near its formants: a (730/1090) vs ee (270/2290)");
    SpeakParams p;
    p.speed = 1.0f;
    p.pitchOct = -1.0f;
    p.intonation = 0.0f;
    p.breath = 0.0f;
    auto band = [&](const std::vector<float>& y, double lo, double hi) {
        double e = 0.0;
        const double f0 = 261.6255653 / 2.0;  // the voice sits an octave below C4
        for (int k = std::max(1, (int)std::ceil(lo / f0)); k * f0 <= hi; ++k) e += std::pow(test::magnitudeAt(y, k * f0, kSr), 2.0);
        return e;
    };
    const auto a = render("a", p, 40000), ee = render("ee", p, 40000);
    const std::vector<float> ya(a.begin() + 20000, a.begin() + 36000), yee(ee.begin() + 20000, ee.begin() + 36000);
    std::printf("  a: F1 %.2e, F2hi %.2e; ee: F1 %.2e, F2hi %.2e\n", band(ya, 600, 850), band(ya, 2000, 2600),
                band(yee, 600, 850), band(yee, 2000, 2600));
    EXPECT(band(ya, 600, 850) > band(yee, 600, 850) * 1.5);
    EXPECT(band(yee, 200, 330) > band(ya, 200, 330) * 1.5);  // ee: F1 at 270 Hz
    TEST("formant shift moves the spectrum up");
    SpeakParams q = p;
    q.formantShift = 6.0f;
    const auto s = render("a", q, 40000);
    const std::vector<float> ys(s.begin() + 20000, s.begin() + 36000);
    EXPECT(band(ys, 850, 1200) + band(ys, 1400, 1800) > band(ya, 850, 1200) + band(ya, 1400, 1800));
}

void consonants() {
    TEST("an unvoiced plosive closes: silence before the burst; a fricative is noisy and high");
    SpeakParams p;
    p.speed = 2.0f;  // a sound lasts ~0.4 s
    const auto t = render("a t a", p, 100000);
    double closure = 0.0, vowel = 0.0;
    const int segStart = (int)(1.3f / 2.0f * kSr * 1.0f + 0.5f * 1.0f / 2.0f * kSr);  // after the first vowel and the pause
    (void)segStart;
    for (int i = 0; i < 100000; ++i) vowel = std::max(vowel, (double)std::fabs(t[(size_t)i]));
    EXPECT(vowel > 0.2);
    // Find the quietest 5 ms stretch inside the middle third of the whole utterance: the closure/pause.
    double quiet = 1e9;
    for (int s0 = 30000; s0 + 240 < 70000; s0 += 240) {
        double e = 0.0;
        for (int i = 0; i < 240; ++i) e += std::fabs(t[(size_t)(s0 + i)]);
        quiet = std::min(quiet, e / 240.0);
    }
    closure = quiet;
    EXPECT(closure < 0.02);
    const auto s = render("s", p, 40000);
    const std::vector<float> ys(s.begin() + 8000, s.begin() + 20000);
    EXPECT(test::rms(ys) > 0.05);
    auto noiseBand = [&](double lo, double hi) {
        double e = 0.0;
        for (double f = lo; f < hi; f += 97.0) e += std::pow(test::magnitudeAt(ys, f, kSr), 2.0);
        return e / ((hi - lo) / 97.0);
    };
    EXPECT(noiseBand(5500, 8500) > 10.0 * noiseBand(200, 1200));
}

void modes() {
    TEST("gate mode is silent until the gate comes and runs one pass; step mode plays a sound per trigger");
    const auto seq = sp::parse("a_o");
    SpeakParams p;
    p.mode = 1;
    p.speed = 20.0f;
    SpeakDsp d;
    d.prepare(kSr);
    d.reset();
    double before = 0.0, during = 0.0, after = 0.0;
    for (int i = 0; i < 48000; ++i) {
        const bool g = i >= 4800 && i < 9600;
        const float y = std::fabs(d.tick(&seq, p, g).out);
        if (i < 4800) before += y;
        else if (i < 9600) during += y;
        else if (i > 20000) after += y;
    }
    EXPECT(before < 1e-6);
    EXPECT(during > 10.0);
    EXPECT(after < 1e-3);
    p.mode = 2;
    SpeakDsp e;
    e.prepare(kSr);
    e.reset();
    int trigs = 0, last = -1;
    for (int i = 0; i < 48000 * 2; ++i) {
        const bool g = (i / 12000) % 2 == 0;  // four pulses
        const auto f = e.tick(&seq, p, g);
        trigs += f.trig;
        if (f.trig) last = e.segment();
    }
    EXPECT(trigs == 4);
    EXPECT(last == 1);  // a, o, a, o → the last pulse plays segment 1
}

void bounds() {
    TEST("long strings at every speed and pitch stay finite and within ±1");
    for (float speed : {1.0f, 8.0f, 40.0f})
        for (float oct : {-3.0f, 0.0f, 2.0f}) {
            SpeakParams p;
            p.speed = speed, p.pitchOct = oct, p.breath = 1.0f, p.formantShift = oct * 4.0f;
            const auto y = render("'sh ee ng k g t d p b m n l r w y j ch z zh v th dh f h a e i o u ae uh er oo", p, 96000);
            EXPECT(test::allFinite(y));
            for (float v : y) EXPECT(std::fabs(v) <= 1.0f);
        }
}

}  // namespace

int main() {
    parser();
    deterministic();
    formants();
    consonants();
    modes();
    bounds();
    return test::finish("speak");
}
