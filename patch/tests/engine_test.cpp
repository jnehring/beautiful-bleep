// SPDX-License-Identifier: MIT
//
// Engine tests: board documents, the compiler (cells, feedback), block
// claiming and port latency, persistence and undo. Plugins are simulated by
// calling IEngine directly, including from several threads per host block.
// The tests are in engine/*.cpp.
#include "engine/engine_test.h"

namespace bleep::engine {
std::unique_ptr<BoardUi> createBoardUi(Engine&) { return nullptr; }  // no window in tests
}  // namespace bleep::engine

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    runDocumentTests();
    runHostTests();
    runVoiceTests();
    runCellPluginTests();
    std::printf(g_failures ? "%d failure(s)\n" : "engine tests passed\n", g_failures);
    return g_failures ? 1 : 0;
}
