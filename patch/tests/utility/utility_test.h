// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// utility/utility_test.h — what the utility DSP test files share: the includes, EXPECT macros and the failure count.
#pragma once

#include "../../modules/attenuverter/dsp/AttenuverterDsp.h"
#include "../../modules/audio-mixer/dsp/AudioMixerDsp.h"
#include "../../modules/crossfader/dsp/CrossfaderDsp.h"
#include "../../modules/cv-mixer/dsp/CvMixerDsp.h"
#include "../../modules/level-meter/dsp/LevelMeterDsp.h"
#include "../../modules/logic/dsp/LogicDsp.h"
#include "../../modules/multiplier/dsp/MultiplierDsp.h"
#include "../../modules/notes-to-cv/dsp/NotesToCvDsp.h"
#include "../../modules/quantizer/dsp/QuantizerDsp.h"
#include "../../modules/switch/dsp/SwitchDsp.h"

#include <cmath>
#include <complex>
#include <cstdio>
#include <vector>

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

inline constexpr double kPi = 3.14159265358979323846;

// One function per file; test_utility_dsp.cpp calls them both.
void runMixingTests();
void runControlTests();
