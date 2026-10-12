# SPDX-License-Identifier: MIT
#
# Builds everything: the bus, its conformance suite and examples, and the
# Beautiful Bleep modules. Each folder also builds on its own (see its README).
#
#   cmake -S . -B build -DBLEEP_JUCE_DIR=/path/to/JUCE
#   cmake --build build && ctest --test-dir build
cmake_minimum_required(VERSION 3.22)

if (NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")
endif ()

project(Bleep VERSION 0.1.0 LANGUAGES C CXX)
enable_testing()

set(BLEEP_BUS_BUILD_TESTS ON CACHE BOOL "Build the conformance suite and tests")
set(BLEEP_BUS_BUILD_EXAMPLES ON CACHE BOOL "Build the command-line examples")
add_subdirectory(bus)
add_subdirectory(patch)
