# SPDX-License-Identifier: MIT
#
# Bleep Patch — the shared engine, the board and the plugins users add in
# Live (spec §6). Uses Bleep Bus only through its public API, exactly like a
# third-party plugin.
#
#   cmake -S patch -B build/patch -DBLEEP_JUCE_DIR=/path/to/JUCE   # or let it fetch JUCE
#   cmake --build build/patch
#
# Options:
#   BLEEP_PATCH_BUILD_PLUGINS   build the plugins (needs JUCE)                ON
#   BLEEP_PATCH_BUILD_TESTS     build the DSP and engine tests                 ON
#   BLEEP_JUCE_DIR              local JUCE checkout; empty = FetchContent
#   BLEEP_PATCH_COPY_PLUGINS    copy plugins to the user plugin folders       OFF
#   BLEEP_PATCH_UI_DEV          plugins read the board UI from the source tree OFF
#                               (edit HTML/CSS/JS, reopen the board)
#   BLEEP_PATCH_FORMATS         plugin formats                               "VST3"
cmake_minimum_required(VERSION 3.22)

if (NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")
endif ()

project(BleepPatch VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(BLEEP_PATCH_BUILD_PLUGINS "Build the Bleep Patch plugins (needs JUCE)" ON)
option(BLEEP_PATCH_BUILD_TESTS "Build the DSP and engine tests" ON)
option(BLEEP_PATCH_COPY_PLUGINS "Copy built plugins into the user's plugin folders" OFF)
option(BLEEP_PATCH_UI_DEV "Development builds: serve the board UI from the source tree instead of the embedded copy" OFF)
# Spec §5.2: VST3 only, Ableton Live only (for now).
set(BLEEP_PATCH_FORMATS "VST3" CACHE STRING "Plugin formats (JUCE names)")
set(BLEEP_JUCE_DIR "" CACHE PATH "Local JUCE checkout (empty: download JUCE 8.0.9)")

# The bus, as a third party would consume it.
if (NOT TARGET bleep_bus)
    set(BLEEP_BUS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BLEEP_BUS_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../bus" "${CMAKE_CURRENT_BINARY_DIR}/bus")
endif ()

# Pure DSP, no JUCE.
set(BLEEP_MODULES function random utility filter)
add_library(bleep_patch_dsp INTERFACE)
target_include_directories(bleep_patch_dsp INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/common")
foreach (m IN LISTS BLEEP_MODULES)
    target_include_directories(bleep_patch_dsp INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/dsp")
endforeach ()
target_compile_features(bleep_patch_dsp INTERFACE cxx_std_17)

if (BLEEP_PATCH_BUILD_TESTS)
    enable_testing()
    add_executable(bleep_patch_dsp_tests tests/test_dsp.cpp)
    target_link_libraries(bleep_patch_dsp_tests PRIVATE bleep_patch_dsp)
    add_test(NAME patch.dsp COMMAND bleep_patch_dsp_tests)
endif ()

if (NOT BLEEP_PATCH_BUILD_PLUGINS AND NOT BLEEP_PATCH_BUILD_TESTS)
    return()
endif ()

# ---- JUCE ---------------------------------------------------------------
if (BLEEP_JUCE_DIR)
    add_subdirectory("${BLEEP_JUCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)
else ()
    include(FetchContent)
    FetchContent_Declare(juce
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 8.0.9
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(juce)
endif ()

# ---- the engine (compiled into every plugin: one engine per process, spec §5.3)
set(BLEEP_ENGINE_SOURCES
    engine/Board.cpp
    engine/Engine.cpp
    engine/PortModules.cpp
    engine/Program.cpp
    engine/Registry.cpp)
foreach (m IN LISTS BLEEP_MODULES)
    file(GLOB module_sources CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
    list(APPEND BLEEP_ENGINE_SOURCES ${module_sources})
endforeach ()
set(BLEEP_ENGINE_INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/engine")

if (BLEEP_PATCH_BUILD_TESTS)
    juce_add_console_app(bleep_engine_tests PRODUCT_NAME "Bleep Engine Tests")
    target_sources(bleep_engine_tests PRIVATE tests/engine_test.cpp ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_engine_tests PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_engine_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_engine_tests PRIVATE
        bleep_patch_dsp juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.engine COMMAND bleep_engine_tests)

    # Writes the node types for the board UI's browser demo (board/ui/demo-types.json).
    juce_add_console_app(bleep_dump_types PRODUCT_NAME "Bleep Dump Types")
    target_sources(bleep_dump_types PRIVATE tests/dump_types.cpp engine/Board.cpp engine/Registry.cpp
        engine/PortModules.cpp)
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
        target_sources(bleep_dump_types PRIVATE ${s})
    endforeach ()
    target_include_directories(bleep_dump_types PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_dump_types PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_dump_types PRIVATE bleep_patch_dsp juce::juce_core
        juce::juce_recommended_config_flags)
    add_test(NAME patch.ui-types COMMAND bleep_dump_types --check
        "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/demo-types.json")
endif ()

if (NOT BLEEP_PATCH_BUILD_PLUGINS)
    return()
endif ()

# The board UI (board/ui), the module views' hooks (modules/*/ui) and the
# shared UI library (common/ui), embedded in every plugin.
file(GLOB BLEEP_BOARD_UI CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/*"
    "${CMAKE_CURRENT_SOURCE_DIR}/common/ui/*")
foreach (m IN LISTS BLEEP_MODULES)
    file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/ui/*")
    list(APPEND BLEEP_BOARD_UI ${s})
endforeach ()
juce_add_binary_data(bleep_board_web HEADER_NAME BoardWeb.h NAMESPACE BoardWeb SOURCES ${BLEEP_BOARD_UI})

# bleep_add_plugin(TARGET <t> PRODUCT <name> CODE <4 chars> KIND <PortKind>
#                  [SYNTH] [MIDI_OUT] [VST3_CATEGORIES ...])
function(bleep_add_plugin)
    cmake_parse_arguments(P "SYNTH;MIDI_OUT" "TARGET;PRODUCT;CODE;KIND" "VST3_CATEGORIES" ${ARGN})
    string(TOLOWER "${P_TARGET}" lower)
    set(webview2 FALSE)
    if (WIN32)
        set(webview2 TRUE)
    endif ()
    # Live refuses VST3 instruments without an event input bus, so every
    # instrument takes MIDI in (and ignores it where it has no use).
    juce_add_plugin(${P_TARGET}
        COMPANY_NAME "Bleep Patch"   # Live groups VST3 plugins by this vendor name
        COMPANY_WEBSITE "https://brilliantbleep.com"
        BUNDLE_ID "com.brilliantbleep.patch.${lower}"
        PLUGIN_MANUFACTURER_CODE BrBp
        PLUGIN_CODE ${P_CODE}
        PRODUCT_NAME "${P_PRODUCT}"
        VERSION ${PROJECT_VERSION}
        FORMATS ${BLEEP_PATCH_FORMATS}
        IS_SYNTH ${P_SYNTH}
        NEEDS_MIDI_INPUT ${P_SYNTH}
        NEEDS_MIDI_OUTPUT ${P_MIDI_OUT}
        IS_MIDI_EFFECT FALSE
        EDITOR_WANTS_KEYBOARD_FOCUS TRUE
        NEEDS_WEB_BROWSER TRUE
        NEEDS_WEBVIEW2 ${webview2}
        VST3_CATEGORIES ${P_VST3_CATEGORIES}
        COPY_PLUGIN_AFTER_BUILD ${BLEEP_PATCH_COPY_PLUGINS})
    target_sources(${P_TARGET} PRIVATE
        ${BLEEP_ENGINE_SOURCES}
        board/BoardWindow.cpp
        bridges/ableton/PortProcessor.cpp
        bridges/ableton/PortEditor.cpp)
    target_include_directories(${P_TARGET} PRIVATE ${BLEEP_ENGINE_INCLUDES}
        "${CMAKE_CURRENT_SOURCE_DIR}/board" "${CMAKE_CURRENT_SOURCE_DIR}/bridges/ableton")
    target_compile_definitions(${P_TARGET} PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_DISPLAY_SPLASH_SCREEN=0)
    target_compile_definitions(${P_TARGET} PRIVATE BLEEP_PORT_KIND=${P_KIND})
    if (BLEEP_PATCH_UI_DEV)
        # Never ship these builds: they read the UI from this machine's source tree.
        target_compile_definitions(${P_TARGET} PRIVATE "BLEEP_UI_DEV_ROOT=\"${CMAKE_CURRENT_SOURCE_DIR}\"")
    endif ()
    target_link_libraries(${P_TARGET}
        PRIVATE
            bleep_board_web
            bleep_patch_dsp
            juce::juce_audio_utils
            juce::juce_gui_extra
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_lto_flags
            juce::juce_recommended_warning_flags)
endfunction()

bleep_add_plugin(TARGET BleepPatch PRODUCT "Bleep Patch" CODE BpPa KIND Patch
    VST3_CATEGORIES Fx Tools)

# Opens the real board window on a real engine for a few seconds (not in ctest).
if (BLEEP_PATCH_BUILD_TESTS)
    juce_add_gui_app(bleep_board_smoke PRODUCT_NAME "Bleep Board Smoke")
    target_sources(bleep_board_smoke PRIVATE tests/board_smoke.cpp board/BoardWindow.cpp ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_board_smoke PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_board_smoke PRIVATE JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0
        BLEEP_BOARD_SMOKE_TEST=1 "BLEEP_UI_DEV_ROOT=\"${CMAKE_CURRENT_SOURCE_DIR}\"")
    target_link_libraries(bleep_board_smoke PRIVATE bleep_board_web bleep_patch_dsp juce::juce_gui_extra
        juce::juce_recommended_config_flags)
endif ()
