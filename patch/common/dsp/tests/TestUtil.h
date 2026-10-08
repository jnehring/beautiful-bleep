// SPDX-License-Identifier: MIT
// Tiny test helpers for the DSP tests next to the code (common/dsp/tests,
// modules/<name>/tests). Each test file is its own executable and ctest:
//
//   #include "TestUtil.h"            // from common/dsp/tests
//   static void ladderTunes() { TEST("ladder tunes"); EXPECT_NEAR(f, 440.0, 1.0); }
//   int main() { ladderTunes(); return bleep::test::finish("ladder"); }
#pragma once

#include <cmath>
#include <cstdio>
#include <vector>

namespace bleep::test {

inline int& failures() {
    static int n = 0;
    return n;
}
inline const char*& current() {
    static const char* name = "";
    return name;
}
/// Prints the summary; returns the process exit code.
inline int finish(const char* suite) {
    std::printf("%s: %d failures\n", suite, failures());
    return failures() == 0 ? 0 : 1;
}

/// RMS of a buffer.
inline double rms(const std::vector<float>& x, size_t from = 0) {
    double s = 0.0;
    size_t n = 0;
    for (size_t i = from; i < x.size(); ++i, ++n) s += (double)x[i] * x[i];
    return n ? std::sqrt(s / (double)n) : 0.0;
}

/// Magnitude of the DFT of `x` at `hz` (single bin, Hann window), normalised
/// so a full-scale sine at `hz` gives about 0.5.
inline double magnitudeAt(const std::vector<float>& x, double hz, double sampleRate) {
    double re = 0.0, im = 0.0, wsum = 0.0;
    const double pi = 3.14159265358979323846;
    const size_t n = x.size();
    for (size_t i = 0; i < n; ++i) {
        const double w = 0.5 - 0.5 * std::cos(2.0 * pi * (double)i / (double)(n - 1));
        const double ph = 2.0 * pi * hz * (double)i / sampleRate;
        re += w * x[i] * std::cos(ph);
        im -= w * x[i] * std::sin(ph);
        wsum += w;
    }
    return std::sqrt(re * re + im * im) / wsum;
}

/// Estimated frequency from rising zero crossings (needs a few periods).
inline double zeroCrossingHz(const std::vector<float>& x, double sampleRate, size_t from = 0) {
    double first = -1.0, last = -1.0;
    int count = 0;
    for (size_t i = from + 1; i < x.size(); ++i)
        if (x[i - 1] < 0.0f && x[i] >= 0.0f) {
            const double t = (double)(i - 1) + x[i - 1] / (double)(x[i - 1] - x[i]);
            if (first < 0.0) first = t;
            else ++count;
            last = t;
        }
    return count > 0 ? sampleRate * count / (last - first) : 0.0;
}

inline bool allFinite(const std::vector<float>& x) {
    for (float v : x)
        if (!std::isfinite(v)) return false;
    return true;
}

}  // namespace bleep::test

#define TEST(name) (bleep::test::current() = (name))
#define EXPECT(cond)                                                                                         \
    do {                                                                                                     \
        if (!(cond)) {                                                                                       \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", bleep::test::current(), __FILE__, __LINE__, #cond);   \
            ++bleep::test::failures();                                                                       \
        }                                                                                                    \
    } while (0)
#define EXPECT_NEAR(a, b, tol) EXPECT(std::fabs((double)(a) - (double)(b)) <= (double)(tol))
