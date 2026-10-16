# SPDX-License-Identifier: MIT
#
# Bleep Bus — builds on its own (no other folder of this repository needed).
#
#   cmake -S bus -B build/bus && cmake --build build/bus && ctest --test-dir build/bus
#
# Targets:
#   bleep_bus           static C library (link this)
#   bleep_bus_cpp       header-only C++ wrapper (INTERFACE, links bleep_bus)
#   bb_conformance      conformance host and validator
#   minimal_sender, minimal_receiver, attenuverter   command-line examples
cmake_minimum_required(VERSION 3.22)
project(BleepBus VERSION 0.1.0 LANGUAGES C CXX)

option(BLEEP_BUS_BUILD_TESTS "Build the conformance suite and tests" ${PROJECT_IS_TOP_LEVEL})
option(BLEEP_BUS_BUILD_EXAMPLES "Build the command-line examples" ${PROJECT_IS_TOP_LEVEL})

add_library(bleep_bus STATIC
    src/bleep_bus.c
    src/bb_platform.c
    src/bb_platform.h
    include/bleep_bus.h
    include/bleep_bus_layout.h)
add_library(bleep::bus ALIAS bleep_bus)
target_include_directories(bleep_bus PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_compile_features(bleep_bus PUBLIC c_std_11)
set_target_properties(bleep_bus PROPERTIES POSITION_INDEPENDENT_CODE ON C_EXTENSIONS OFF)
if (MSVC)
    target_compile_options(bleep_bus PRIVATE /W4)
    target_link_libraries(bleep_bus PRIVATE bcrypt)
else ()
    target_compile_options(bleep_bus PRIVATE -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wno-sign-conversion)
endif ()
if (CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_libraries(bleep_bus PRIVATE rt)
endif ()

add_library(bleep_bus_cpp INTERFACE)
add_library(bleep::bus_cpp ALIAS bleep_bus_cpp)
target_include_directories(bleep_bus_cpp INTERFACE
    "${CMAKE_CURRENT_SOURCE_DIR}/wrappers/cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/wrappers/juce")
target_link_libraries(bleep_bus_cpp INTERFACE bleep_bus)
target_compile_features(bleep_bus_cpp INTERFACE cxx_std_17)

if (BLEEP_BUS_BUILD_EXAMPLES)
    foreach (example minimal_sender minimal_receiver attenuverter)
        add_executable(${example} examples/${example}.c)
        target_include_directories(${example} PRIVATE examples)
        target_link_libraries(${example} PRIVATE bleep_bus)
        if (NOT MSVC)
            target_link_libraries(${example} PRIVATE m)
        endif ()
    endforeach ()
endif ()

if (BLEEP_BUS_BUILD_TESTS)
    enable_testing()
    find_package(Threads REQUIRED)
    add_executable(bb_conformance
        conformance/bb_conformance.c
        conformance/bb_conf.h
        conformance/harness.c
        conformance/modes.c
        conformance/checks_layout.c
        conformance/checks_registry.c
        conformance/checks_timing.c
        conformance/checks_signals.c
        conformance/checks_hostile.c
        conformance/checks_process.c)
    target_link_libraries(bb_conformance PRIVATE bleep_bus Threads::Threads)
    if (NOT MSVC)
        target_link_libraries(bb_conformance PRIVATE m)
    endif ()
    if (CMAKE_SYSTEM_NAME STREQUAL "Linux")
        target_link_libraries(bb_conformance PRIVATE rt)
    endif ()
    add_test(NAME bus.conformance COMMAND bb_conformance run)

    add_executable(bb_test_cpp_wrapper tests/test_cpp_wrapper.cpp)
    target_link_libraries(bb_test_cpp_wrapper PRIVATE bleep_bus_cpp)
    add_test(NAME bus.cpp_wrapper COMMAND bb_test_cpp_wrapper)
endif ()
