// SPDX-License-Identifier: MIT
//
// Prints every node type as JSON, the way the board UI receives it. The board
// UI's browser demo (scripts/ui-server.py) uses a copy in board/ui/demo-types.json:
//
//   bleep_dump_types --write patch/board/ui/demo-types.json
//   bleep_dump_types --check patch/board/ui/demo-types.json   (ctest: the copy is current)
#include "Board.h"

#include <cstdio>

int main(int argc, char** argv) {
    const juce::String json =
        juce::JSON::toString(bleep::engine::board::describeTypes(), false).replace("\r\n", "\n") + "\n";
    if (argc == 3) {
        const juce::File file(juce::File::getCurrentWorkingDirectory().getChildFile(argv[2]));
        if (juce::String(argv[1]) == "--write") return file.replaceWithText(json, false, false, "\n") ? 0 : 1;
        if (juce::String(argv[1]) == "--check") {
            if (file.loadFileAsString() == json) return 0;
            std::printf("%s is out of date: run bleep_dump_types --write %s\n", argv[2], argv[2]);
            return 1;
        }
    }
    std::printf("%s", json.toRawUTF8());
    return 0;
}
