// SPDX-License-Identifier: MIT
//
// System Audio where no backend exists (a platform other than macOS, Windows and Linux with libpulse).
#include "SystemAudio.h"

namespace bleep::app {

std::string SystemAudio::unsupportedReason() { return "System audio capture is not available in this build."; }
bool SystemAudio::canExclude() { return false; }
std::vector<std::pair<std::string, std::string>> SystemAudio::sources() { return {}; }
std::unique_ptr<SystemAudio> SystemAudio::create() { return nullptr; }

}  // namespace bleep::app
