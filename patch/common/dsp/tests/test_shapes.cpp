// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Shapes.h: the 96 factory shapes (range, kinds, endpoints, family traits,
// pinned order), Morph, Skew, Reverse and user point lists.
#include "dsp/Shapes.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

using namespace bleep;
using dsp::ShapeKind;
using dsp::ShapeLibrary;
using dsp::ShapeTable;

static const ShapeLibrary& lib() { return ShapeLibrary::factory(); }

static void allShapesValid() {
    TEST("shapes: 96 finite tables in range with the documented endpoints");
    EXPECT(ShapeLibrary::kFactoryShapes == 96);
    for (int s = 0; s < ShapeLibrary::kFactoryShapes; ++s) {
        const ShapeTable& t = lib().table(s);
        const dsp::ShapeInfo& in = ShapeLibrary::info(s);
        EXPECT(in.family == s / 8);
        EXPECT(in.name && std::strlen(in.name) > 0);
        float lo = 1e9f, hi = -1e9f;
        for (float v : t.v) {
            EXPECT(std::isfinite(v));
            lo = std::min(lo, v);
            hi = std::max(hi, v);
        }
        EXPECT(lo >= (in.bipolar ? -1.0f : 0.0f) && hi <= 1.0f);
        EXPECT(hi - lo > 0.3f);  // nothing flat
        if (in.kind == ShapeKind::Envelope) {
            EXPECT(!in.bipolar);
            EXPECT(t.v.front() == 0.0f && t.v.back() == 0.0f);
            EXPECT(hi > 0.99f);  // every envelope reaches full level
        } else {
            EXPECT(t.v.back() == t.v.front());
        }
        if (in.hasSustain()) EXPECT(in.sustain > 0.0f && in.sustain < 1.0f);
        if (bleep::test::failures()) {
            std::printf("    shape %d (%s)\n", s, in.name);
            return;
        }
    }
}

static void familyTraits() {
    TEST("shapes: family traits");
    // Kinds and polarity by family, as in shape-envelope.md 4.1.
    for (int s = 0; s < 96; ++s) {
        const dsp::ShapeInfo& in = ShapeLibrary::info(s);
        const bool envelope = in.family <= 5;
        EXPECT((in.kind == ShapeKind::Envelope) == envelope);
        EXPECT(in.bipolar == (in.family >= 6 && in.family != 9));
        EXPECT(in.hasSustain() == (in.family == 3));
    }
    // Decays: full level right after the start, then falling all the way.
    for (int s = 0; s < 8; ++s) {
        const ShapeTable& t = lib().table(s);
        EXPECT_NEAR(t.v[1], 1.0, 1e-6);
        bool falling = true;
        for (int i = 2; i < 256; ++i) falling = falling && t.v[(size_t)i] <= t.v[(size_t)i - 1] + 1e-7f;
        EXPECT(falling);
    }
    // Decays get slower from Click to Long exp: level at 10 % rises.
    EXPECT(lib().value(0, 0.1) < lib().value(1, 0.1) && lib().value(1, 0.1) < lib().value(2, 0.1) &&
           lib().value(2, 0.1) < lib().value(3, 0.1));
    // Plucks: peak at 1 / (1 + ratio) of the time.
    const double ratios[4] = {20, 8, 4, 2};
    for (int s = 8; s < 16; ++s) {
        const ShapeTable& t = lib().table(s);
        const int peak = (int)(std::max_element(t.v.begin(), t.v.end()) - t.v.begin());
        EXPECT(std::fabs(peak / 255.0 - 1.0 / (1.0 + ratios[(s - 8) / 2])) < 0.01);
    }
    // Sustains: flat (constant) right before the sustain point.
    for (int s = 24; s < 32; ++s) {
        const dsp::ShapeInfo& in = ShapeLibrary::info(s);
        const float a = lib().value(s, in.sustain - 0.05), b = lib().value(s, in.sustain);
        EXPECT_NEAR(a, b, 1e-5);
        EXPECT(b > 0.2f);
    }
    EXPECT_NEAR(lib().value(24, 0.5), 0.25, 1e-5);  // ADSR 25 / 50 / 75 % sustain levels
    EXPECT_NEAR(lib().value(25, 0.5), 0.5, 1e-5);
    EXPECT_NEAR(lib().value(26, 0.5), 0.75, 1e-5);
    // Bounces: the number of peaks (local maxima) equals the number of hits.
    auto peaks = [](const ShapeTable& t) {
        int n = 0;
        for (int i = 1; i < 255; ++i) n += t.v[(size_t)i] > t.v[(size_t)i - 1] + 1e-6f && t.v[(size_t)i] >= t.v[(size_t)i + 1];
        return n;
    };
    EXPECT(peaks(lib().table(32)) == 3 && peaks(lib().table(33)) == 5 && peaks(lib().table(34)) == 8);
    EXPECT(peaks(lib().table(35)) == 8 && peaks(lib().table(39)) == 12);
    // Stairs: the documented levels at each step's middle.
    for (int k = 0; k < 4; ++k) EXPECT_NEAR(lib().value(41, (k + 0.5) / 4.0), (k + 1) / 4.0, 1e-5);
    for (int k = 0; k < 3; ++k) EXPECT_NEAR(lib().value(43, (k + 0.5) / 3.0), 1.0 - k / 3.0, 1e-5);
    // Classic waves.
    EXPECT_NEAR(lib().value(48, 0.25), 1.0, 1e-4);
    EXPECT_NEAR(lib().value(48, 0.75), -1.0, 1e-4);
    EXPECT_NEAR(lib().value(50, 0.5), 0.0, 0.01);
    EXPECT(lib().value(52, 0.25) == 1.0f && lib().value(52, 0.75) == -1.0f);
    // Skewed waves peak at 10 / 25 / 75 / 90 %.
    const double skews[4] = {0.1, 0.25, 0.75, 0.9};
    for (int s = 56; s < 64; ++s) {
        const ShapeTable& t = lib().table(s);
        const int peak = (int)(std::max_element(t.v.begin(), t.v.end()) - t.v.begin());
        EXPECT(std::fabs(peak / 255.0 - skews[(s - 56) % 4]) < 0.005);
    }
    // Harmonic, wobble and texture shapes are normalised to peak 1.
    for (int s = 64; s < 96; ++s) {
        if (s >= 72 && s < 80) continue;
        float peak = 0.0f;
        for (float v : lib().table(s).v) peak = std::max(peak, std::fabs(v));
        EXPECT_NEAR(peak, 1.0, 1e-6);
    }
    // Gates: 0 or 1 except on the short edges; x.x.xx.x has 5 gates.
    {
        const ShapeTable& t = lib().table(72);
        int edges = 0, between = 0;
        for (int i = 1; i < 256; ++i) {
            edges += t.v[(size_t)i] >= 0.5f && t.v[(size_t)i - 1] < 0.5f;
            between += t.v[(size_t)i] > 0.01f && t.v[(size_t)i] < 0.99f;
        }
        EXPECT(edges == 5);
        EXPECT(between <= 12);
    }
    // Textures differ from each other (different seeds).
    EXPECT(lib().table(88).checksum() != lib().table(89).checksum());
}

static void pinnedOrder() {
    TEST("shapes: library order and content are pinned");
    // Saved boards store the shape index: reordering or changing a factory
    // shape must be deliberate. Regenerate with BLEEP_PRINT_SHAPES=1.
    static constexpr uint32_t pinned[96] = {
        0xa5969f51u, 0x13a6cee0u, 0xa06a87a5u, 0x80398223u, 0xe7cb8bf9u, 0x3b639257u,
        0x8a3913ebu, 0x367556feu, 0x98705d24u, 0x415dac19u, 0x9dbf14eau, 0xd7dab119u,
        0x0a183e04u, 0x49eeffecu, 0x94cba03cu, 0x671e0b49u, 0x3c5ad56fu, 0x78be0068u,
        0x6b529769u, 0x8bab3afeu, 0x4c830390u, 0xd681c390u, 0xc19b298cu, 0xa2fce58au,
        0x4869ecd3u, 0x9e1c6ffdu, 0x219eea17u, 0x795b4be9u, 0x58fc218cu, 0x2b2725b9u,
        0x92fd92ffu, 0x31c6efefu, 0x38bdc6ccu, 0xd9625bfau, 0x629bffeeu, 0x59c7587fu,
        0x27adbe69u, 0xd0aed172u, 0x03782f96u, 0x578268c2u, 0x8dda7310u, 0xa92fe928u,
        0x0449754eu, 0xfc4c46a9u, 0xb780a660u, 0xaf5f76c3u, 0x9bb44ebeu, 0x029e23b3u,
        0x1ad3d201u, 0x82e4a9e8u, 0x68836379u, 0x63e3b3e9u, 0x0f2e7c66u, 0x0374e2e8u,
        0xc04a5a6cu, 0x89019016u, 0x53345ee3u, 0x8ea739a3u, 0x7d7aab27u, 0x597dbdebu,
        0xb671a91au, 0x95dab2cbu, 0xf39c5f57u, 0x0dfcfe32u, 0x73bc8cd2u, 0xcbe5392bu,
        0x0601ea26u, 0x6dbc8d50u, 0x053d183au, 0x1a001cb5u, 0x1cb6e498u, 0xf3585804u,
        0x55bc8cebu, 0x0a00bfe3u, 0x426c6fd3u, 0x143a3b83u, 0x12092e39u, 0xbfccafb3u,
        0x16af5d8du, 0xd14a70f7u, 0xadb15249u, 0x0c901502u, 0xf0310bc2u, 0xe17fe544u,
        0x144e3f8cu, 0xa3c0ca4bu, 0x200afcd1u, 0xef6fffffu, 0x28f1a653u, 0xdc6c585bu,
        0x30d59573u, 0x3d78f4c4u, 0xc4c5d773u, 0xc69b99e0u, 0xff34c740u, 0x84ed86f5u,
    };
    const bool print = std::getenv("BLEEP_PRINT_SHAPES") != nullptr;
    int changed = 0;
    for (int s = 0; s < 96; ++s) {
        const uint32_t c = lib().table(s).checksum();
        if (print) std::printf("0x%08xu,%s", c, s % 6 == 5 ? "\n" : " ");
        changed += c != pinned[s];
    }
    EXPECT(changed == 0);
    // generate() matches the built library.
    ShapeTable t;
    ShapeLibrary::generate(37, t);
    EXPECT(t.v == lib().table(37).v);
}

static void morph() {
    TEST("shapes: morph");
    for (int s = 0; s < 96; ++s) {
        const int n = (s + 1) % 96;
        for (int i = 0; i <= 50; ++i) {
            const double p = i / 50.0;
            EXPECT(lib().morph(s, 0.0f, p) == lib().value(s, p));
            EXPECT_NEAR(lib().morph(s, 1.0f, p), lib().value(n, p), 1e-6);
            EXPECT_NEAR(lib().morph(s, 0.5f, p), 0.5 * (lib().value(s, p) + lib().value(n, p)), 1e-6);
        }
    }
    // Continuous in morph: a small morph step never moves the output more than that step allows.
    float worst = 0.0f;
    for (int s = 0; s < 96; ++s)
        for (int i = 0; i <= 100; ++i) {
            const double p = i / 100.0;
            for (int m = 1; m <= 100; ++m)
                worst = std::max(worst, std::fabs(lib().morph(s, m / 100.0f, p) - lib().morph(s, (m - 1) / 100.0f, p)));
        }
    EXPECT(worst <= 0.02f + 1e-6f);  // |a − b| ≤ 2 for bipolar tables, × 1 % per step
    // Within a family neighbours are related: Short exp → Long exp moves gradually.
    EXPECT(lib().morph(2, 0.5f, 0.2) > lib().value(2, 0.2) && lib().morph(2, 0.5f, 0.2) < lib().value(3, 0.2));
    // Wraps from the last shape to the first.
    EXPECT_NEAR(lib().morph(95, 1.0f, 0.3), lib().value(0, 0.3), 1e-6);
}

static void lookups() {
    TEST("shapes: lookup, skew, reverse");
    const ShapeTable& sine = lib().table(48);
    // Linear and cubic agree on the points and stay close in between.
    for (int i = 0; i < 255; ++i) {
        const double p = i / 255.0;
        EXPECT_NEAR(sine.cubic(p, true), sine.v[(size_t)i], 1e-6);
        EXPECT_NEAR(sine.cubic(p + 0.5 / 255.0, true), std::sin(2.0 * 3.14159265358979 * (p + 0.5 / 255.0)), 1e-5);
        EXPECT_NEAR(sine.at(p + 0.5 / 255.0), std::sin(2.0 * 3.14159265358979 * (p + 0.5 / 255.0)), 1e-4);
    }
    EXPECT(sine.at(-1.0) == sine.v.front() && sine.at(2.0) == sine.v.back());
    // Skew ±1 and Reverse (shape-envelope.md 4.4).
    EXPECT_NEAR(dsp::skewPhase(0.25, 1.0f), 0.5, 1e-12);                 // first half in a quarter of the time
    EXPECT_NEAR(dsp::skewPhase(std::sqrt(0.5), -1.0f), 0.5, 1e-12);      // ... in about 71 %
    EXPECT_NEAR(dsp::skewPhase(0.3, 0.0f), 0.3, 1e-12);
    EXPECT(dsp::skewPhase(0.0, 1.0f) == 0.0 && dsp::skewPhase(1.0, -1.0f) == 1.0);
    EXPECT(dsp::reversePhase(0.25) == 0.75);
}

static void userShapes() {
    TEST("shapes: user point lists and resampling");
    const dsp::ShapePoint pts[] = {{0.0f, 0.0f, 0.0f}, {0.5f, 1.0f, 1.0f}, {1.0f, 0.0f, -1.0f}};
    EXPECT_NEAR(dsp::evaluatePoints(pts, 3, 0.25), 0.5, 1e-6);           // linear
    EXPECT_NEAR(dsp::evaluatePoints(pts, 3, 0.5), 1.0, 1e-6);
    EXPECT_NEAR(dsp::evaluatePoints(pts, 3, 0.75), 0.0625, 1e-6);  // +1 fall: drops fast, (1−u)^4 of the way left
    EXPECT(dsp::evaluatePoints(pts, 0, 0.3) == 0.0f);  // an empty slot is flat 0
    const dsp::ShapePoint up[] = {{0.0f, 0.0f, 1.0f}, {1.0f, 1.0f, 0.0f}};
    EXPECT_NEAR(dsp::evaluatePoints(up, 2, 0.5), 0.0625, 1e-6);  // +1 rise: u^4
    ShapeTable t;
    dsp::renderPoints(pts, 3, t);
    EXPECT(t.v.front() == 0.0f && t.v.back() == 0.0f && std::fabs(t.at(0.5) - 1.0f) < 0.01f);

    // 64 saved values → 256 with a monotone cubic: through the points, no overshoot.
    float vals[64];
    for (int i = 0; i < 64; ++i) vals[i] = i < 20 ? 0.0f : i < 30 ? 1.0f : (float)(0.5 + 0.5 * std::sin(i * 0.4));
    dsp::resampleMonotone(vals, 64, t);
    EXPECT(t.v.front() == vals[0] && std::fabs(t.v.back() - vals[63]) < 1e-6f);
    float lo = 1.0f, hi = 0.0f;
    for (float v : t.v) lo = std::min(lo, v), hi = std::max(hi, v);
    EXPECT(lo >= -1e-6f && hi <= 1.0f + 1e-6f);
    for (int k = 0; k < 64; ++k) EXPECT_NEAR(t.at(k / 63.0), vals[k], 0.03);  // the table is 256 linear points
}

int main() {
    allShapesValid();
    familyTraits();
    pinnedOrder();
    morph();
    lookups();
    userShapes();
    return bleep::test::finish("shapes");
}
