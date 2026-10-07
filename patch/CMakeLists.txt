# SPDX-License-Identifier: MIT
#
# Bleep Patch — the modules. Uses Bleep Bus only through its public API
# (bus/include + bus/wrappers), exactly like a third-party plugin.
#
#   cmake -S patch -B build/patch -DBLEEP_JUCE_DIR=/path/to/JUCE   # or let it fetch JUCE
#   cmake --build build/patch
#
# Options:
#   BLEEP_PATCH_BUILD_PLUGINS   build the JUCE plugins (needs JUCE)          ON
#   BLEEP_PATCH_BUILD_TESTS     build the DSP unit tests (no JUCE needed)     ON
#   BLEEP_JUCE_DIR              local JUCE checkout; empty = FetchContent
#   BLEEP_PATCH_COPY_PLUGINS    copy plugins to the user plugin folders       OFF
#   BLEEP_PATCH_UI_DEV          plugins read their UI from the source tree   OFF
#                               (edit HTML/CSS/JS, reopen the plugin window)
#   BLEEP_PATCH_FORMATS         plugin formats                    "VST3;Standalone"
#   BLEEP_PATCH_CLAP            also build CLAP (needs clap-juce-extensions)  OFF
#   BLEEP_CLAP_JUCE_EXTENSIONS_DIR  local clap-juce-extensions checkout
cmake_minimum_required(VERSION 3.22)

if (NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")
endif ()

project(BleepPatch VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(BLEEP_PATCH_BUILD_PLUGINS "Build the Bleep Patch plugins (needs JUCE)" ON)
option(BLEEP_PATCH_BUILD_TESTS "Build the DSP unit tests" ON)
option(BLEEP_PATCH_COPY_PLUGINS "Copy built plugins into the user's plugin folders" OFF)
option(BLEEP_PATCH_UI_DEV "Development builds: serve the UI from the source tree instead of the embedded copy" OFF)
option(BLEEP_PATCH_CLAP "Also build CLAP versions" OFF)
set(BLEEP_PATCH_FORMATS "VST3;Standalone" CACHE STRING "Plugin formats (JUCE names, e.g. VST3;Standalone;AU)")
set(BLEEP_JUCE_DIR "" CACHE PATH "Local JUCE checkout (empty: download JUCE 8.0.9)")
set(BLEEP_CLAP_JUCE_EXTENSIONS_DIR "" CACHE PATH "Local clap-juce-extensions checkout")

# The bus, as a third party would consume it.
if (NOT TARGET bleep_bus)
    set(BLEEP_BUS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BLEEP_BUS_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../bus" "${CMAKE_CURRENT_BINARY_DIR}/bus")
endif ()

# Pure DSP, no JUCE.
add_library(bleep_patch_dsp INTERFACE)
target_include_directories(bleep_patch_dsp INTERFACE
    "${CMAKE_CURRENT_SOURCE_DIR}/common"
    "${CMAKE_CURRENT_SOURCE_DIR}/modules/function/dsp"
    "${CMAKE_CURRENT_SOURCE_DIR}/modules/random/dsp"
    "${CMAKE_CURRENT_SOURCE_DIR}/modules/utility/dsp"
    "${CMAKE_CURRENT_SOURCE_DIR}/modules/midi-out/dsp"
    "${CMAKE_CURRENT_SOURCE_DIR}/modules/filter/dsp")
target_compile_features(bleep_patch_dsp INTERFACE cxx_std_17)

if (BLEEP_PATCH_BUILD_TESTS)
    enable_testing()
    add_executable(bleep_patch_dsp_tests tests/test_dsp.cpp)
    target_link_libraries(bleep_patch_dsp_tests PRIVATE bleep_patch_dsp)
    add_test(NAME patch.dsp COMMAND bleep_patch_dsp_tests)
endif ()

if (NOT BLEEP_PATCH_BUILD_PLUGINS)
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

if (BLEEP_PATCH_CLAP)
    if (BLEEP_CLAP_JUCE_EXTENSIONS_DIR)
        add_subdirectory("${BLEEP_CLAP_JUCE_EXTENSIONS_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/clap-juce-extensions" EXCLUDE_FROM_ALL)
    else ()
        include(FetchContent)
        FetchContent_Declare(clap_juce_extensions
            GIT_REPOSITORY https://github.com/free-audio/clap-juce-extensions.git
            GIT_TAG main
            GIT_SHALLOW TRUE
            GIT_SUBMODULES_RECURSE TRUE)
        FetchContent_MakeAvailable(clap_juce_extensions)
    endif ()
endif ()

# Shared UI library (patch/common/ui); each module adds its own ui/ folder.
file(GLOB BLEEP_COMMON_UI CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/common/ui/*")

# bleep_add_module(TARGET <t> PRODUCT <name> CODE <4 chars> DIR <modules/dir>
#                  SOURCES ... [FORMATS ...] [VST3_CATEGORIES ...] [CLAP_FEATURES ...]
#                  [SYNTH] [MIDI_OUT])
# A module folder holds dsp/ (JUCE-free DSP), ui/ (its HTML/CSS/JS page) and
# the processor that joins them. ui/ and common/ui/ are embedded as
# BinaryData with the header ModuleWeb.h, which ModuleEditor.cpp serves.
function(bleep_add_module)
    cmake_parse_arguments(M "SYNTH;MIDI_OUT" "TARGET;PRODUCT;CODE;DIR"
                          "SOURCES;FORMATS;VST3_CATEGORIES;CLAP_FEATURES" ${ARGN})
    if (NOT M_FORMATS)
        set(M_FORMATS ${BLEEP_PATCH_FORMATS})
    endif ()
    # Live takes MIDI output only from VST3 plugins: never build MIDI Out as AU.
    if (M_MIDI_OUT)
        list(REMOVE_ITEM M_FORMATS AU)
    endif ()
    string(TOLOWER "${M_TARGET}" lower)
    set(webview2 FALSE)
    if (WIN32)
        set(webview2 TRUE)
    endif ()

    juce_add_plugin(${M_TARGET}
        COMPANY_NAME "Bleep Patch"   # Live groups VST3 plugins by this vendor name
        COMPANY_WEBSITE "https://brilliantbleep.com"
        BUNDLE_ID "com.brilliantbleep.patch.${lower}"
        PLUGIN_MANUFACTURER_CODE BrBp
        PLUGIN_CODE ${M_CODE}
        PRODUCT_NAME "Bleep ${M_PRODUCT}"
        VERSION ${PROJECT_VERSION}
        FORMATS ${M_FORMATS}
        IS_SYNTH ${M_SYNTH}
        NEEDS_MIDI_INPUT FALSE
        NEEDS_MIDI_OUTPUT ${M_MIDI_OUT}
        IS_MIDI_EFFECT FALSE
        EDITOR_WANTS_KEYBOARD_FOCUS TRUE
        NEEDS_WEB_BROWSER TRUE
        NEEDS_WEBVIEW2 ${webview2}
        VST3_CATEGORIES ${M_VST3_CATEGORIES}
        COPY_PLUGIN_AFTER_BUILD ${BLEEP_PATCH_COPY_PLUGINS})

    file(GLOB module_ui CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/${M_DIR}/ui/*")
    juce_add_binary_data(${M_TARGET}Web
        HEADER_NAME ModuleWeb.h
        NAMESPACE ModuleWeb
        SOURCES ${BLEEP_COMMON_UI} ${module_ui})

    target_sources(${M_TARGET} PRIVATE
        ${M_SOURCES}
        "${CMAKE_CURRENT_SOURCE_DIR}/common/module/ModuleProcessor.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/common/module/ModuleEditor.cpp")
    target_include_directories(${M_TARGET} PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/common/module"
        "${CMAKE_CURRENT_SOURCE_DIR}/${M_DIR}"
        "${CMAKE_CURRENT_SOURCE_DIR}/${M_DIR}/dsp")
    target_compile_definitions(${M_TARGET} PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0)
    if (BLEEP_PATCH_UI_DEV)
        # Never ship these builds: they read the UI from this machine's source tree.
        target_compile_definitions(${M_TARGET} PRIVATE
            "BLEEP_UI_DEV_MODULE_DIR=\"${CMAKE_CURRENT_SOURCE_DIR}/${M_DIR}/ui\""
            "BLEEP_UI_DEV_COMMON_DIR=\"${CMAKE_CURRENT_SOURCE_DIR}/common/ui\"")
    endif ()
    target_link_libraries(${M_TARGET}
        PRIVATE
            ${M_TARGET}Web
            bleep_patch_dsp
            bleep_bus_cpp
            juce::juce_audio_utils
            juce::juce_gui_extra
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_lto_flags
            juce::juce_recommended_warning_flags)

    if (BLEEP_PATCH_CLAP AND COMMAND clap_juce_extensions_plugin)
        clap_juce_extensions_plugin(TARGET ${M_TARGET}
            CLAP_ID "com.brilliantbleep.patch.${lower}"
            CLAP_FEATURES ${M_CLAP_FEATURES})
    endif ()
endfunction()

bleep_add_module(TARGET BleepFunction PRODUCT Function CODE BpFn DIR modules/function
    SOURCES modules/function/FunctionProcessor.cpp
    VST3_CATEGORIES Fx Tools CLAP_FEATURES audio-effect utility)
bleep_add_module(TARGET BleepRandom PRODUCT Random CODE BpRn DIR modules/random
    SOURCES modules/random/RandomProcessor.cpp
    VST3_CATEGORIES Fx Tools CLAP_FEATURES audio-effect utility)
bleep_add_module(TARGET BleepUtility PRODUCT Utility CODE BpUt DIR modules/utility
    SOURCES modules/utility/UtilityProcessor.cpp
    VST3_CATEGORIES Fx Tools CLAP_FEATURES audio-effect utility)
bleep_add_module(TARGET BleepFilter PRODUCT Filter CODE BpFl DIR modules/filter
    SOURCES modules/filter/FilterProcessor.cpp
    VST3_CATEGORIES Fx Filter CLAP_FEATURES audio-effect filter)
bleep_add_module(TARGET BleepMidiOut PRODUCT "MIDI Out" CODE BpMo DIR modules/midi-out
    SOURCES modules/midi-out/MidiOutProcessor.cpp
    SYNTH MIDI_OUT
    VST3_CATEGORIES Instrument Tools CLAP_FEATURES instrument note-effect)

# Integration test: load the built VST3s into a headless host.
if (BLEEP_PATCH_BUILD_TESTS)
    juce_add_console_app(bleep_patch_host_test PRODUCT_NAME "Bleep Patch Host Test")
    target_sources(bleep_patch_host_test PRIVATE tests/host_test.cpp)
    target_compile_definitions(bleep_patch_host_test PRIVATE
        JUCE_PLUGINHOST_VST3=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_patch_host_test PRIVATE
        bleep_bus_cpp juce::juce_audio_processors
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_dependencies(bleep_patch_host_test BleepFunction_VST3 BleepUtility_VST3 BleepFilter_VST3 BleepMidiOut_VST3)
    add_test(NAME patch.host COMMAND bleep_patch_host_test
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepFunction_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepUtility_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepFilter_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepMidiOut_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>")
endif ()
