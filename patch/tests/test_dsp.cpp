// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// test_dsp.cpp — runs the DSP tests of dsp/*.cpp.

#include "dsp/dsp_test.h"

int main() {
    runFilterTests();
    runModuleTests();
    runSequencerTests();
    runDrumTests();
    runGridTests();
    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all DSP tests passed\n");
    return 0;
}
