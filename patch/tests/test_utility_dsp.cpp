// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Unit tests for the utility module cores: Attenuverter, CV Mixer, Audio
// Mixer, Multiplier, Crossfader, Logic, Quantizer, Switch, Notes to CV and
// Level Meter.
// Pure C++, like test_dsp.cpp.
// The tests are in utility/*.cpp.

#include "utility/utility_test.h"

int main() {
    runMixingTests();
    runControlTests();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all utility DSP tests passed\n");
    return 0;
}
