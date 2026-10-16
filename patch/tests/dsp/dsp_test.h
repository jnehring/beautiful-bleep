// SPDX-License-Identifier: MIT
#pragma once
// dsp/dsp_test.h — what the DSP test files share: the includes, EXPECT macros and the failure count.
// Unit tests for the Beautiful Bleep DSP cores. No JUCE, no bus: pure C++.
#include "../../modules/adsr/dsp/AdsrDsp.h"
#include "../../modules/drum-grid/dsp/DrumGridDsp.h"
#include "../../modules/filter/dsp/FilterDsp.h"
#include "../../modules/oscillator/dsp/OscillatorDsp.h"
#include "../../modules/function/dsp/FunctionDsp.h"
#include "../../modules/noise/dsp/NoiseDsp.h"
#include "../../modules/punch-drums/dsp/PunchDrumsDsp.h"
#include "../../modules/lfo/dsp/LfoDsp.h"
#include "../../modules/random/dsp/RandomDsp.h"
#include "../../modules/ring-drums/dsp/RingDrumsDsp.h"
#include "../../modules/step-sequencer/dsp/StepSequencerDsp.h"
#include "../../modules/utility/dsp/UtilityDsp.h"

#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
#include <random>
#include <vector>

// The harness the DSP test files share (dsp/*.cpp, run by test_dsp.cpp).
inline int g_failures = 0;
inline const char* g_test = "";

#define EXPECT(cond)                                                                   \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            std::printf("  %s: %s:%d: EXPECT(%s)\n", g_test, __FILE__, __LINE__, #cond); \
            ++g_failures;                                                              \
        }                                                                              \
    } while (0)
#define EXPECT_NEAR(a, b, tol) EXPECT(std::fabs((double)(a) - (double)(b)) <= (tol))

using namespace bleep;

using namespace bleep::patch;


// One function per file; test_dsp.cpp calls them all.
void runFilterTests();
void runModuleTests();
void runSequencerTests();
void runDrumTests();
void runGridTests();
