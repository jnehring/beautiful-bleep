// SPDX-License-Identifier: GPL-3.0-or-later
// Bit Formula: the expression compiler (precedence, rejection of anything outside
// the grammar, limits), evaluation of every built-in formula, and the clock.
#include "BitFormulaDsp.h"

#include "dsp/tests/TestUtil.h"

#include <set>
#include <string>
#include <vector>

using namespace bleep;
using patch::BitCompiler;
using patch::BitFormulaDsp;
using patch::BitParams;
using patch::BitProgram;

namespace {

uint32_t eval(const char* src, uint32_t t = 0, uint32_t a = 0, uint32_t b = 0, uint32_t c = 0, uint32_t x = 0) {
    const auto p = BitCompiler::compile(src);
    EXPECT(p.ok);
    return p.run(t, a, b, c, x);
}

void arithmetic() {
    TEST("C-like precedence and wrapping arithmetic");
    EXPECT(eval("1+2*3") == 7);
    EXPECT(eval("(1+2)*3") == 9);
    EXPECT(eval("1<<2+1") == 8);          // + binds tighter than <<
    EXPECT(eval("6&3|8") == 10);          // & before |
    EXPECT(eval("5^1&3") == 4);           // & before ^
    EXPECT(eval("2<3 == 1") == 1);        // relational before equality
    EXPECT(eval("t>>2&7", 0xff) == 7);    // shift before &
    EXPECT(eval("0-1") == 0xffffffffu);   // wraps
    EXPECT(eval("-1") == 0xffffffffu);
    EXPECT(eval("~0") == 0xffffffffu);
    EXPECT(eval("!0 + !5") == 1);
    EXPECT(eval("7/0") == 0);
    EXPECT(eval("7%0") == 0);
    EXPECT(eval("1<<33") == 2);           // counts are taken modulo 32
    EXPECT(eval("0x1F + 0Xa") == 41);
    EXPECT(eval("t ? 10 : 20", 1) == 10);
    EXPECT(eval("t ? 10 : 20", 0) == 20);
    EXPECT(eval("a ? b ? 1 : 2 : 3", 0, 1, 0) == 2);  // right-associative
    EXPECT(eval("1 && 0 || 1") == 1);
    EXPECT(eval("t*a+b^c", 3, 4, 5, 6) == (3u * 4u + 5u ^ 6u));
    EXPECT(eval("x", 0, 0, 0, 0, 77) == 77);
}

void rejects() {
    TEST("anything outside the grammar is rejected, with a position");
    for (const char* bad : {"", "   ", "t+", "(t", "t)", "t t", "foo", "tt", "t**2", "sin(t)", "t=1", "1.5", "t;", "t // c", "0x", "99999999999",
                            "a?b", "t ? 1", "$", "t@2", "__import__", "\"x\""}) {
        const auto p = BitCompiler::compile(bad);
        EXPECT(!p.ok);
        EXPECT(p.errorAt >= 0);
    }
    TEST("limits: length, nesting and program size");
    EXPECT(!BitCompiler::compile(std::string(BitProgram::kMaxSource + 1, 't')).ok);
    EXPECT(!BitCompiler::compile(std::string(100, '(') + "t" + std::string(100, ')')).ok);
    std::string many = "t";
    for (int i = 0; i < 40; ++i) many += "+t";  // 81 instructions
    EXPECT(!BitCompiler::compile(many).ok);
    std::string deep = "t";
    for (int i = 0; i < 30; ++i) deep = "t+(" + deep + ")";  // stack grows with the right operand
    EXPECT(!BitCompiler::compile(deep).ok);
}

void presets() {
    TEST("every built-in formula compiles and makes a varied, non-constant signal for several knob settings");
    EXPECT(patch::bitPresets().size() == 16);
    for (size_t i = 0; i < patch::bitPresets().size(); ++i) {
        const auto& prog = patch::compiledPresets()[i];
        EXPECT(prog.ok);
        for (uint32_t k : {32u, 96u, 200u}) {
            std::set<uint32_t> seen;
            for (uint32_t t = 0; t < 1 << 15; ++t) seen.insert(prog.run(t, k, 255 - k, 255 - (k >> 1), (t * 7u) & 255u) & 255u);
            if (seen.size() < (i == 1 ? 2u : 4u)) std::printf("  %s with knobs %u: only %zu values\n", patch::bitPresets()[i].name, k, seen.size());
            EXPECT(seen.size() >= (i == 1 ? 2u : 4u));  // Pulse has two levels
        }
    }
}

void clocking() {
    TEST("the formula runs at the clock rate: t advances Rate times per second and the output is held between ticks");
    const double sr = 48000.0;
    BitFormulaDsp d;
    d.prepare(sr);
    d.reset();
    const auto prog = BitCompiler::compile("t");
    BitParams p;
    p.rateHz = 8000.0f;
    std::vector<float> y;
    for (int i = 0; i < 48000; ++i) y.push_back(d.tick(&prog, p, 0.0f).out);
    EXPECT(std::abs((int)d.tickCounter() - 8000) <= 1);
    // 6 samples per tick: steps change at most every 6th sample.
    int changes = 0;
    for (size_t i = 1; i < y.size(); ++i) changes += y[i] != y[i - 1];
    EXPECT(changes <= 8001);
    EXPECT(test::allFinite(y));
    TEST("a saw t at 8 kHz repeats every 256 ticks: 31.25 Hz");
    EXPECT_NEAR(test::zeroCrossingHz(y, sr), 8000.0 / 256.0, 0.5);
    TEST("bits reduce the resolution, smooth removes the steps' edges");
    BitFormulaDsp e;
    e.prepare(sr);
    e.reset();
    p.bits = 2;
    std::set<float> levels;
    for (int i = 0; i < 20000; ++i) levels.insert(e.tick(&prog, p, 0.0f).out);
    EXPECT(levels.size() == 4);
    p.bits = 8;
    BitFormulaDsp raw, sm;
    raw.prepare(sr), sm.prepare(sr), raw.reset(), sm.reset();
    BitParams ps = p;
    ps.smooth = 0.8f;
    double jumpRaw = 0.0, jumpSm = 0.0;
    float lr = 0.0f, ls = 0.0f;
    const auto noisy = BitCompiler::compile("(t*t>>3)^(t>>2)");
    for (int i = 0; i < 20000; ++i) {
        const float a = raw.tick(&noisy, p, 0.0f).out, b = sm.tick(&noisy, ps, 0.0f).out;
        jumpRaw += std::fabs(a - lr), jumpSm += std::fabs(b - ls);
        lr = a, ls = b;
    }
    EXPECT(jumpSm < jumpRaw * 0.7);
    TEST("a failed program gives a steady centre value, not noise or a crash");
    const auto broken = BitCompiler::compile("t+");
    BitFormulaDsp f;
    f.prepare(sr), f.reset();
    for (int i = 0; i < 100; ++i) EXPECT(std::fabs(f.tick(&broken, p, 0.0f).out) < 0.01f);
    TEST("rate extremes stay finite");
    for (float hz : {0.0f, 1.0f, 48000.0f, 400000.0f}) {
        p.rateHz = hz;
        for (int i = 0; i < 1000; ++i) EXPECT(std::isfinite(f.tick(&prog, p, 0.5f).out));
    }
}

}  // namespace

int main() {
    arithmetic();
    rejects();
    presets();
    clocking();
    return test::finish("bit-formula");
}
