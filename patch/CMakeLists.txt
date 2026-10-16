# SPDX-License-Identifier: MIT
#
# Beautiful Bleep — the shared engine, the board and the plugins users add in
# Live (spec §6). Uses Bleep Bus only through its public API, exactly like a
# third-party plugin.
#
#   cmake -S patch -B build/patch -DBLEEP_JUCE_DIR=/path/to/JUCE   # or let it fetch JUCE
#   cmake --build build/patch
#
# Options:
#   BLEEP_BUILD_PLUGINS   build the plugins (needs JUCE)                ON
#   BLEEP_BUILD_TESTS     build the DSP and engine tests                 ON
#   BLEEP_JUCE_DIR              local JUCE checkout; empty = FetchContent
#   BLEEP_COPY_PLUGINS    copy plugins to the user plugin folders       OFF
#   BLEEP_UI_DEV          plugins read the board UI from the source tree OFF
#                               (edit HTML/CSS/JS, reopen the board)
#   BLEEP_FORMATS         plugin formats                               "VST3"
#   BLEEP_BUILD_APP       build the standalone app (spec §11)            ON
#   BLEEP_LINK            include Ableton Link in the app (GPLv2+)        ON
#   BLEEP_LINK_DIR              local Ableton Link checkout; empty = FetchContent
cmake_minimum_required(VERSION 3.22)

if (NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")
endif ()

project(BleepBoard VERSION 0.2.0 LANGUAGES C CXX)
add_compile_definitions(BLEEP_VERSION="${PROJECT_VERSION}")  # the Help menu's Info

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(BLEEP_BUILD_PLUGINS "Build the Bleep plugins (needs JUCE)" ON)
option(BLEEP_BUILD_TESTS "Build the DSP and engine tests" ON)
option(BLEEP_LIGHT_TESTS "Tests only: DSP tests, module harness and type dump (juce_core only, no plugins)" OFF)
if (BLEEP_LIGHT_TESTS)
    set(BLEEP_BUILD_TESTS ON)
    set(BLEEP_BUILD_PLUGINS OFF)
    set(BLEEP_BUILD_APP OFF)
endif ()
option(BLEEP_COPY_PLUGINS "Copy built plugins into the user's plugin folders" OFF)
option(BLEEP_UI_DEV "Development builds: serve the board UI from the source tree instead of the embedded copy" OFF)
# Spec §5.2: VST3 only, Ableton Live only (for now).
set(BLEEP_FORMATS "VST3" CACHE STRING "Plugin formats (JUCE names)")
set(BLEEP_JUCE_DIR "" CACHE PATH "Local JUCE checkout (empty: download JUCE 8.0.9)")
# The wasm module host (engine/wasm/, developers/modules/module-abi.md): needs the Wasmtime C API, from
# https://github.com/bytecodealliance/wasmtime/releases (wasmtime-v<version>-<target>-c-api). With it, the test
# bleep_wasm_parity runs every module as native and as wasm and compares them (library.md section 13, M1).
set(BLEEP_WASMTIME_DIR "" CACHE PATH "Wasmtime C API folder: builds the wasm module host and bleep_wasm_parity")
# Default: the Wasmtime that scripts/experiments fetched into <build>/wasm-spike, so the apps get the Library without a flag.
foreach (_wt "${CMAKE_BINARY_DIR}/wasm-spike/wasmtime" "${CMAKE_CURRENT_SOURCE_DIR}/../build/wasm-spike/wasmtime")
    if (NOT BLEEP_WASMTIME_DIR AND EXISTS "${_wt}/lib/libwasmtime.a")
        get_filename_component(_wt "${_wt}" ABSOLUTE)
        set(BLEEP_WASMTIME_DIR "${_wt}" CACHE PATH "Wasmtime C API folder: builds the wasm module host and bleep_wasm_parity" FORCE)
    endif ()
endforeach ()
option(BLEEP_BUILD_APP "Build the standalone Bleep App" ON)
option(BLEEP_LINK "Include Ableton Link in the app (makes the app binary GPL)" ON)
set(BLEEP_LINK_DIR "" CACHE PATH "Local Ableton Link checkout (empty: download Link 4.1)")

# The bus, as a third party would consume it.
if (NOT TARGET bleep_bus)
    set(BLEEP_BUS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BLEEP_BUS_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../bus" "${CMAKE_CURRENT_BINARY_DIR}/bus")
endif ()

# Pure DSP, no JUCE. Every folder in modules/ with a module.json is a module.
file(GLOB module_jsons RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}/modules" CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/modules/*/module.json")
set(BLEEP_MODULES)
foreach (j IN LISTS module_jsons)
    get_filename_component(m "${j}" DIRECTORY)
    list(APPEND BLEEP_MODULES "${m}")
endforeach ()
list(SORT BLEEP_MODULES)
# Optional: build only some modules (a list of folder names), e.g. while
# several people add modules to one tree at the same time.
set(BLEEP_ONLY_MODULES "" CACHE STRING "Build only these modules (empty: all)")
if (BLEEP_ONLY_MODULES)
    list(FILTER BLEEP_MODULES INCLUDE REGEX "^(${BLEEP_ONLY_MODULES})$")
endif ()
# A module ported from copyleft code (GPL, LGPL, AGPL, MPL) keeps that licence and is never compiled into the apps
# and plugins: it ships only as an optional .wasm module from the Bleep Library. Tests and tools still build it
# (they are not distributed).
set(BLEEP_COPYLEFT_MODULES)
foreach (m IN LISTS BLEEP_MODULES)
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/module.json" module_json)
    string(JSON module_license ERROR_VARIABLE no_license GET "${module_json}" license)
    if (NOT no_license AND module_license MATCHES "GPL|MPL")
        list(APPEND BLEEP_COPYLEFT_MODULES "${m}")
    endif ()
endforeach ()
add_library(bleep_dsp INTERFACE)
target_include_directories(bleep_dsp INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/common")
foreach (m IN LISTS BLEEP_MODULES)
    target_include_directories(bleep_dsp INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/dsp")
endforeach ()
target_compile_features(bleep_dsp INTERFACE cxx_std_17)

if (BLEEP_BUILD_TESTS)
    enable_testing()
    add_executable(bleep_dsp_tests tests/test_dsp.cpp)
    target_link_libraries(bleep_dsp_tests PRIVATE bleep_dsp)
    add_test(NAME patch.dsp COMMAND bleep_dsp_tests)
    add_executable(bleep_utility_tests tests/test_utility_dsp.cpp)
    target_link_libraries(bleep_utility_tests PRIVATE bleep_dsp)
    add_test(NAME patch.utility-dsp COMMAND bleep_utility_tests)
    # System Audio's ring and drift-compensating reader (app/SystemAudioBuffer.h, doc/specs/system-audio.md): pure C++.
    add_executable(bleep_system_audio_test tests/system_audio_test.cpp)
    add_test(NAME patch.system-audio COMMAND bleep_system_audio_test)
    # DSP tests next to the code they test: common/dsp/tests/*.cpp and
    # modules/<name>/tests/*.cpp, one executable (and one ctest) per file.
    file(GLOB dsp_test_sources CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/common/dsp/tests/*.cpp")
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/tests/*.cpp")
        list(APPEND dsp_test_sources ${s})
    endforeach ()
    foreach (t IN LISTS dsp_test_sources)
        get_filename_component(name "${t}" NAME_WE)
        add_executable(bleep_${name} "${t}")
        target_link_libraries(bleep_${name} PRIVATE bleep_dsp)
        add_test(NAME patch.${name} COMMAND bleep_${name})
    endforeach ()
endif ()

if (NOT BLEEP_BUILD_PLUGINS AND NOT BLEEP_BUILD_TESTS)
    return()
endif ()

# ---- JUCE ---------------------------------------------------------------
if (BLEEP_JUCE_DIR)
    add_subdirectory("${BLEEP_JUCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)
else ()
    include(FetchContent)
    FetchContent_Declare(juce
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        # 8.0.9 (pinned by commit: tags can move)
        GIT_TAG f72bad64d29715216226685810c5196bd0d79d77
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(juce)
endif ()

# ---- the engine (compiled into every plugin: one engine per process, spec §5.3)
set(BLEEP_ENGINE_SOURCES
    engine/Board.cpp
    engine/Engine.cpp
    engine/Media.cpp
    engine/PortModules.cpp
    engine/Program.cpp
    engine/Registry.cpp
    engine/VoiceCell.cpp)
# What the apps and the plugins are built from. With the wasm module host (BLEEP_WASMTIME_DIR) they carry no
# modules: those come from the Bleep Library, as .wasm files installed on the machine (developers/modules/library.md). Tests and
# tools always compile the modules in (they are the reference the wasm builds are held to: bleep_wasm_parity).
set(BLEEP_APP_ENGINE_SOURCES ${BLEEP_ENGINE_SOURCES})
set(BLEEP_APP_MODULE_SOURCES)  # the same without the copyleft modules
foreach (m IN LISTS BLEEP_MODULES)
    file(GLOB module_sources CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
    list(APPEND BLEEP_ENGINE_SOURCES ${module_sources})
    if (NOT m IN_LIST BLEEP_COPYLEFT_MODULES)
        list(APPEND BLEEP_APP_MODULE_SOURCES ${module_sources})
    endif ()
endforeach ()
option(BLEEP_BUNDLE_MODULES "Compile the modules into the apps and the plugins (default: only without the wasm module host)" OFF)
if (BLEEP_BUNDLE_MODULES OR NOT BLEEP_WASMTIME_DIR)
    set(BLEEP_APP_ENGINE_SOURCES ${BLEEP_APP_ENGINE_SOURCES} ${BLEEP_APP_MODULE_SOURCES})
    set(BLEEP_APP_BUNDLES_MODULES TRUE)
else ()
    set(BLEEP_APP_BUNDLES_MODULES FALSE)
endif ()
set(BLEEP_ENGINE_INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/engine")
# The standalone app's audio bridge (spec §11.3): protocol, plugin side, app side.
set(BLEEP_BRIDGE_PROTOCOL_SOURCES bridges/standalone/BridgeProtocol.cpp)
set(BLEEP_BRIDGE_CLIENT_SOURCES ${BLEEP_BRIDGE_PROTOCOL_SOURCES} bridges/standalone/BridgeClient.cpp)
set(BLEEP_BRIDGE_SERVER_SOURCES ${BLEEP_BRIDGE_PROTOCOL_SOURCES} bridges/standalone/BridgeServer.cpp)
set(BLEEP_BRIDGE_INCLUDES "${CMAKE_CURRENT_SOURCE_DIR}/bridges/standalone")

# The web hub (doc/specs/bridges.md §10): WebSocket server and the app's web peers.
include(hub/hub.cmake)

if (BLEEP_BUILD_TESTS)
    # Every module type on a real compiled board: random knobs and inputs,
    # finite outputs, data round trips (tests/module_harness.cpp). juce_core only.
    juce_add_console_app(bleep_module_harness PRODUCT_NAME "Bleep Module Harness")
    target_sources(bleep_module_harness PRIVATE tests/module_harness.cpp engine/Board.cpp engine/Program.cpp
        engine/Registry.cpp engine/PortModules.cpp engine/VoiceCell.cpp engine/Media.cpp)
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
        target_sources(bleep_module_harness PRIVATE ${s})
    endforeach ()
    target_include_directories(bleep_module_harness PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_module_harness PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_module_harness PRIVATE bleep_dsp juce::juce_core
        juce::juce_recommended_config_flags)
    add_test(NAME patch.modules COMMAND bleep_module_harness)

    # The library's checks (signing.md): the packages of patch/tests/library-fixtures get the verdicts Python gave them.
    juce_add_console_app(bleep_library_test PRODUCT_NAME "Bleep Library Test")
    target_sources(bleep_library_test PRIVATE tests/library_test.cpp library/Verify.cpp library/Package.cpp library/Client.cpp library/Account.cpp
        third_party/monocypher/monocypher.c third_party/monocypher/monocypher-ed25519.c)
    target_include_directories(bleep_library_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" third_party/monocypher)
    target_compile_definitions(bleep_library_test PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
        "BLEEP_LIBRARY_FIXTURES=\"${CMAKE_CURRENT_SOURCE_DIR}/tests/library-fixtures\"")
    target_link_libraries(bleep_library_test PRIVATE juce::juce_core juce::juce_cryptography juce::juce_recommended_config_flags)
    if (APPLE)
        target_link_libraries(bleep_library_test PRIVATE "-framework Security" "-framework CoreFoundation")  # the keychain (library/Account.cpp)
    elseif (WIN32)
        target_link_libraries(bleep_library_test PRIVATE advapi32)  # the Credential Manager
    endif ()
    add_test(NAME patch.library COMMAND bleep_library_test)

    if (BLEEP_WASMTIME_DIR)
        add_library(bleep_wasmtime STATIC IMPORTED)
        set_target_properties(bleep_wasmtime PROPERTIES IMPORTED_LOCATION "${BLEEP_WASMTIME_DIR}/lib/libwasmtime.a"
            INTERFACE_INCLUDE_DIRECTORIES "${BLEEP_WASMTIME_DIR}/include")
        if (APPLE)
            set_property(TARGET bleep_wasmtime PROPERTY INTERFACE_LINK_LIBRARIES "-framework CoreFoundation;-framework Security")
        endif ()
        set(BLEEP_WASM_HOST_SOURCES engine/wasm/WasmRuntime.cpp engine/wasm/WasmModule.cpp engine/wasm/SpecJson.cpp engine/wasm/WasmRegistry.cpp
            engine/wasm/InstalledModules.cpp engine/wasm/ModuleLibrary.cpp library/Verify.cpp library/Package.cpp library/Client.cpp library/Account.cpp
            third_party/monocypher/monocypher.c third_party/monocypher/monocypher-ed25519.c)
        # Every module twice, native and as its .wasm, on the same input (tests/wasm_parity.cpp). Not a ctest: it needs the
        # wasm files (scripts/build/build-web.sh --modules-only).
        juce_add_console_app(bleep_wasm_parity PRODUCT_NAME "Bleep Wasm Parity")
        target_sources(bleep_wasm_parity PRIVATE tests/wasm_parity.cpp ${BLEEP_WASM_HOST_SOURCES} engine/Board.cpp engine/Program.cpp
            engine/Registry.cpp engine/PortModules.cpp engine/VoiceCell.cpp engine/Media.cpp)
        foreach (m IN LISTS BLEEP_MODULES)
            file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
            target_sources(bleep_wasm_parity PRIVATE ${s})
        endforeach ()
        target_include_directories(bleep_wasm_parity PRIVATE ${BLEEP_ENGINE_INCLUDES} engine/wasm "${CMAKE_CURRENT_SOURCE_DIR}" third_party/monocypher)
        target_compile_definitions(bleep_wasm_parity PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
        # WebAssembly never fuses a multiply and an add; the native reference must not either, or a phase accumulator drifts
        # by rounding alone and every oscillator "differs".
        target_compile_options(bleep_wasm_parity PRIVATE -ffp-contract=off)
        target_link_libraries(bleep_wasm_parity PRIVATE bleep_dsp juce::juce_core juce::juce_cryptography bleep_wasmtime
            juce::juce_recommended_config_flags)
        # The Transport module as a .wasm asks the host through its mailbox (tests/wasm_host_control_test.cpp). Not a ctest either.
        juce_add_console_app(bleep_wasm_host_control_test PRODUCT_NAME "Bleep Wasm Host Control Test")
        target_sources(bleep_wasm_host_control_test PRIVATE tests/wasm_host_control_test.cpp ${BLEEP_WASM_HOST_SOURCES} engine/Board.cpp
            engine/Program.cpp engine/Registry.cpp engine/PortModules.cpp engine/VoiceCell.cpp engine/Media.cpp)
        foreach (m IN LISTS BLEEP_MODULES)
            file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
            target_sources(bleep_wasm_host_control_test PRIVATE ${s})
        endforeach ()
        target_include_directories(bleep_wasm_host_control_test PRIVATE ${BLEEP_ENGINE_INCLUDES} engine/wasm "${CMAKE_CURRENT_SOURCE_DIR}" third_party/monocypher)
        target_compile_definitions(bleep_wasm_host_control_test PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
        target_link_libraries(bleep_wasm_host_control_test PRIVATE bleep_dsp juce::juce_core juce::juce_cryptography bleep_wasmtime
            juce::juce_recommended_config_flags)
    endif ()

    # The demo boards (patch/presets/demos, compiled to board/ui/demo-patches.json) load without a
    # warning and make sound (tests/demo_patches_test.cpp). juce_core only.
    juce_add_console_app(bleep_demo_patches PRODUCT_NAME "Bleep Demo Patches")
    target_sources(bleep_demo_patches PRIVATE tests/demo_patches_test.cpp engine/Board.cpp engine/Program.cpp
        engine/Registry.cpp engine/PortModules.cpp engine/VoiceCell.cpp engine/Media.cpp)
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
        target_sources(bleep_demo_patches PRIVATE ${s})
    endforeach ()
    target_include_directories(bleep_demo_patches PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_demo_patches PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_demo_patches PRIVATE bleep_dsp juce::juce_core
        juce::juce_recommended_config_flags)
    add_test(NAME patch.demo-patches COMMAND bleep_demo_patches
        "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/demo-patches.json")

    # Every cell preset Bleep Instrument or Bleep FX can load (`plays`) is played like the plugin plays
    # it and must make sound / die away (tests/cell_plugin_presets_test.cpp). juce_core only.
    juce_add_console_app(bleep_cell_plugin_presets PRODUCT_NAME "Bleep Cell Plugin Presets")
    target_sources(bleep_cell_plugin_presets PRIVATE tests/cell_plugin_presets_test.cpp engine/Board.cpp engine/Program.cpp
        engine/Registry.cpp engine/PortModules.cpp engine/VoiceCell.cpp engine/Media.cpp)
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
        target_sources(bleep_cell_plugin_presets PRIVATE ${s})
    endforeach ()
    target_include_directories(bleep_cell_plugin_presets PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_cell_plugin_presets PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_cell_plugin_presets PRIVATE bleep_dsp juce::juce_core
        juce::juce_recommended_config_flags)
    add_test(NAME patch.cell-plugin-presets COMMAND bleep_cell_plugin_presets
        "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/factory-presets.json"
        "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/hand-written-presets.json")

    # Engine features modules build on (normalling, output flags, harmony order,
    # stepped knobs, view metadata, commands, media). juce_core only.
    juce_add_console_app(bleep_engine_features PRODUCT_NAME "Bleep Engine Features")
    target_sources(bleep_engine_features PRIVATE tests/engine_features_test.cpp engine/Board.cpp engine/Program.cpp
        engine/Registry.cpp engine/PortModules.cpp engine/VoiceCell.cpp engine/Media.cpp)
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
        target_sources(bleep_engine_features PRIVATE ${s})
    endforeach ()
    target_include_directories(bleep_engine_features PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_engine_features PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_engine_features PRIVATE bleep_dsp juce::juce_core
        juce::juce_recommended_config_flags)
    add_test(NAME patch.engine-features COMMAND bleep_engine_features)
endif ()

if (BLEEP_BUILD_TESTS AND NOT BLEEP_LIGHT_TESTS)
    juce_add_console_app(bleep_engine_tests PRODUCT_NAME "Bleep Engine Tests")
    target_sources(bleep_engine_tests PRIVATE tests/engine_test.cpp ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_engine_tests PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_engine_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
        BLEEP_FACTORY_PRESETS="${CMAKE_CURRENT_SOURCE_DIR}/board/ui/factory-presets.json"
        BLEEP_FACTORY_PANELS="${CMAKE_CURRENT_SOURCE_DIR}/board/ui/factory-panels.json")
    target_link_libraries(bleep_engine_tests PRIVATE
        bleep_dsp juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.engine COMMAND bleep_engine_tests)

    juce_add_console_app(bleep_utility_module_tests PRODUCT_NAME "Bleep Utility Module Tests")
    target_sources(bleep_utility_module_tests PRIVATE tests/utility_modules_test.cpp ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_utility_module_tests PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_utility_module_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_utility_module_tests PRIVATE
        bleep_dsp juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.utility-modules COMMAND bleep_utility_module_tests)

    juce_add_console_app(bleep_controller_module_tests PRODUCT_NAME "Bleep Controller Module Tests")
    target_sources(bleep_controller_module_tests PRIVATE tests/controller_modules_test.cpp ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_controller_module_tests PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_controller_module_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_controller_module_tests PRIVATE
        bleep_dsp juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.controller-modules COMMAND bleep_controller_module_tests)

    juce_add_console_app(bleep_bridge_tests PRODUCT_NAME "Bleep Bridge Tests")
    target_sources(bleep_bridge_tests PRIVATE tests/bridge_test.cpp ${BLEEP_ENGINE_SOURCES}
        bridges/standalone/BridgeProtocol.cpp bridges/standalone/BridgeClient.cpp bridges/standalone/BridgeServer.cpp)
    target_include_directories(bleep_bridge_tests PRIVATE ${BLEEP_ENGINE_INCLUDES} ${BLEEP_BRIDGE_INCLUDES})
    target_compile_definitions(bleep_bridge_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_bridge_tests PRIVATE
        bleep_dsp juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.bridge COMMAND bleep_bridge_tests)
endif ()

if (BLEEP_BUILD_TESTS)
    # Writes the node types for the board UI's browser demo (board/ui/demo-types.json).
    juce_add_console_app(bleep_dump_types PRODUCT_NAME "Bleep Dump Types")
    target_sources(bleep_dump_types PRIVATE tests/dump_types.cpp engine/Board.cpp engine/Registry.cpp
        engine/PortModules.cpp engine/Media.cpp)
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/*Module.cpp")
        target_sources(bleep_dump_types PRIVATE ${s})
    endforeach ()
    target_include_directories(bleep_dump_types PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_dump_types PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_dump_types PRIVATE bleep_dsp juce::juce_core
        juce::juce_recommended_config_flags)
    add_test(NAME patch.ui-types COMMAND bleep_dump_types --check
        "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/demo-types.json")
    # The factory cell presets (compiled by patch/presets/build.mjs) load without a warning.
    add_test(NAME patch.factory-presets COMMAND bleep_dump_types --check-presets
        "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/factory-presets.json")
endif ()

if (NOT BLEEP_BUILD_PLUGINS)
    return()
endif ()

# The board UI (board/ui), the module views' hooks (modules/*/ui), the
# modules' documentation (modules/*/doc/*.md; the screenshots next to it are
# for the website) and the shared UI library (common/ui), embedded in every
# plugin. All are served flat, by file name.
file(GLOB BLEEP_BOARD_UI CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/board/ui/*"
    "${CMAKE_CURRENT_SOURCE_DIR}/common/ui/*")
if (BLEEP_APP_BUNDLES_MODULES)  # otherwise the installed packages bring their own views and docs
    foreach (m IN LISTS BLEEP_MODULES)
        file(GLOB s CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/ui/*"
            "${CMAKE_CURRENT_SOURCE_DIR}/modules/${m}/doc/*.md")
        list(APPEND BLEEP_BOARD_UI ${s})
    endforeach ()
endif ()
# module-views.json: the module view scripts that exist, so the board loads
# exactly those (board.js loadModuleViews).
set(module_views)
foreach (f IN LISTS BLEEP_BOARD_UI)
    get_filename_component(dir "${f}" DIRECTORY)
    get_filename_component(name "${f}" NAME)
    if (dir MATCHES "/modules/[^/]+/ui$" AND name MATCHES "\\.js$")
        list(APPEND module_views "\"${name}\"")
    endif ()
endforeach ()
list(JOIN module_views ", " module_views)
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/module-views.json" "[${module_views}]\n")
list(APPEND BLEEP_BOARD_UI "${CMAKE_CURRENT_BINARY_DIR}/module-views.json")
juce_add_binary_data(bleep_board_web HEADER_NAME BoardWeb.h NAMESPACE BoardWeb SOURCES ${BLEEP_BOARD_UI})

# Modules installed from the Bleep Library (developers/modules/library.md): the wasm module host, the library client and signature checks.
# With BLEEP_WASMTIME_DIR set, a target loads the modules found on the machine and gets the Library section.
# Where the library is and whom it trusts: config/library.json, the one place (read by the apps' build and by scripts/release).
# BLEEP_LIBRARY_URL and BLEEP_LIBRARY_ROOTS (hex, comma separated) override it for one build.
set(BLEEP_LIBRARY_CONFIG "${CMAKE_CURRENT_SOURCE_DIR}/../config/library.json" CACHE FILEPATH "The library configuration the apps and plugins are built with")
set(BLEEP_LIBRARY_URL "" CACHE STRING "Overrides libraryUrl of the library configuration")
set(BLEEP_LIBRARY_ROOTS "" CACHE STRING "Root public keys (hex, comma separated) besides rootKeys of the library configuration")
set(BLEEP_LIBRARY_URL_BAKED "")
set(BLEEP_LIBRARY_ROOTS "")
if (EXISTS "${BLEEP_LIBRARY_CONFIG}")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${BLEEP_LIBRARY_CONFIG}")
    file(READ "${BLEEP_LIBRARY_CONFIG}" library_config)
    string(JSON BLEEP_LIBRARY_URL_BAKED ERROR_VARIABLE err GET "${library_config}" libraryUrl)
    string(JSON n ERROR_VARIABLE err LENGTH "${library_config}" rootKeys)
    if (NOT err AND n GREATER 0)
        math(EXPR last "${n} - 1")
        foreach (i RANGE ${last})
            string(JSON key GET "${library_config}" rootKeys ${i})
            list(APPEND BLEEP_LIBRARY_ROOT_LIST "${key}")
        endforeach ()
        list(JOIN BLEEP_LIBRARY_ROOT_LIST "," BLEEP_LIBRARY_ROOTS)
    endif ()
endif ()
if (BLEEP_LIBRARY_URL)
    set(BLEEP_LIBRARY_URL_BAKED "${BLEEP_LIBRARY_URL}")
endif ()
if (BLEEP_LIBRARY_ROOTS)
    if (BLEEP_LIBRARY_ROOTS)
        set(BLEEP_LIBRARY_ROOTS "${BLEEP_LIBRARY_ROOTS},${BLEEP_LIBRARY_ROOTS}")
    else ()
        set(BLEEP_LIBRARY_ROOTS "${BLEEP_LIBRARY_ROOTS}")
    endif ()
endif ()
function(bleep_use_library target)
    if (NOT BLEEP_WASMTIME_DIR)
        return()
    endif ()
    if (NOT TARGET bleep_wasmtime)
        add_library(bleep_wasmtime STATIC IMPORTED)
        set_target_properties(bleep_wasmtime PROPERTIES IMPORTED_LOCATION "${BLEEP_WASMTIME_DIR}/lib/libwasmtime.a"
            INTERFACE_INCLUDE_DIRECTORIES "${BLEEP_WASMTIME_DIR}/include")
        if (APPLE)
            set_property(TARGET bleep_wasmtime PROPERTY INTERFACE_LINK_LIBRARIES "-framework CoreFoundation;-framework Security")
        endif ()
    endif ()
    target_sources(${target} PRIVATE engine/wasm/WasmRuntime.cpp engine/wasm/WasmModule.cpp engine/wasm/SpecJson.cpp
        engine/wasm/WasmRegistry.cpp engine/wasm/InstalledModules.cpp engine/wasm/ModuleLibrary.cpp library/Verify.cpp
        library/Package.cpp library/Client.cpp library/Account.cpp third_party/monocypher/monocypher.c third_party/monocypher/monocypher-ed25519.c)
    if (WIN32)
        target_link_libraries(${target} PRIVATE advapi32)  # the Credential Manager (library/Account.cpp)
    endif ()
    target_include_directories(${target} PRIVATE engine/wasm "${CMAKE_CURRENT_SOURCE_DIR}" third_party/monocypher)
    if (NOT BLEEP_APP_BUNDLES_MODULES)
        target_compile_definitions(${target} PRIVATE BLEEP_NO_BUNDLED_MODULES=1)
    endif ()
    target_compile_definitions(${target} PRIVATE BLEEP_WASM_MODULES=1 "BLEEP_LIBRARY_ROOTS=\"${BLEEP_LIBRARY_ROOTS}\"")
    if (BLEEP_LIBRARY_URL_BAKED)
        target_compile_definitions(${target} PRIVATE "BLEEP_LIBRARY_URL=\"${BLEEP_LIBRARY_URL_BAKED}\"")
    endif ()
    target_link_libraries(${target} PRIVATE bleep_wasmtime juce::juce_cryptography)
endfunction()

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
        COMPANY_NAME "Beautiful Bleep"   # Live groups VST3 plugins by this vendor name
        COMPANY_WEBSITE "https://brilliantbleep.com"
        BUNDLE_ID "com.brilliantbleep.patch.${lower}"
        PLUGIN_MANUFACTURER_CODE BrBp
        PLUGIN_CODE ${P_CODE}
        PRODUCT_NAME "${P_PRODUCT}"
        VERSION ${PROJECT_VERSION}
        FORMATS ${BLEEP_FORMATS}
        IS_SYNTH ${P_SYNTH}
        NEEDS_MIDI_INPUT ${P_SYNTH}
        NEEDS_MIDI_OUTPUT ${P_MIDI_OUT}
        IS_MIDI_EFFECT FALSE
        EDITOR_WANTS_KEYBOARD_FOCUS TRUE
        NEEDS_WEB_BROWSER TRUE
        NEEDS_WEBVIEW2 ${webview2}
        VST3_CATEGORIES ${P_VST3_CATEGORIES}
        COPY_PLUGIN_AFTER_BUILD ${BLEEP_COPY_PLUGINS})
    target_sources(${P_TARGET} PRIVATE
        ${BLEEP_APP_ENGINE_SOURCES}
        board/BoardWindow.cpp
        bridges/ableton/PortProcessor.cpp
        bridges/ableton/PortEditor.cpp
        bridges/ableton/PanelView.cpp
        bridges/ableton/PresetLibrary.cpp
        ${BLEEP_BRIDGE_CLIENT_SOURCES})
    target_include_directories(${P_TARGET} PRIVATE ${BLEEP_ENGINE_INCLUDES} ${BLEEP_BRIDGE_INCLUDES}
        "${CMAKE_CURRENT_SOURCE_DIR}/board" "${CMAKE_CURRENT_SOURCE_DIR}/bridges/ableton")
    target_compile_definitions(${P_TARGET} PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0)
    target_compile_definitions(${P_TARGET} PRIVATE BLEEP_PORT_KIND=${P_KIND})
    bleep_use_library(${P_TARGET})
    if (BLEEP_UI_DEV)
        # Never ship these builds: they read the UI from this machine's source tree.
        target_compile_definitions(${P_TARGET} PRIVATE "BLEEP_UI_DEV_ROOT=\"${CMAKE_CURRENT_SOURCE_DIR}\"")
    endif ()
    # Modules register themselves with a static initialiser (BLEEP_REGISTER_MODULE). JUCE puts the sources in a
    # static library, and a linker drops archive members nothing references: the plugin would offer only the modules
    # Registry.cpp registers by hand. Link the whole archive into each plugin format.
    foreach (fmt IN LISTS BLEEP_FORMATS)
        if (APPLE)
            target_link_options(${P_TARGET}_${fmt} PRIVATE "LINKER:-force_load,$<TARGET_FILE:${P_TARGET}>")
        elseif (MSVC)
            target_link_options(${P_TARGET}_${fmt} PRIVATE "/WHOLEARCHIVE:$<TARGET_FILE:${P_TARGET}>")
        else ()
            target_link_libraries(${P_TARGET}_${fmt} PRIVATE
                "-Wl,--whole-archive" "$<TARGET_FILE:${P_TARGET}>" "-Wl,--no-whole-archive")
        endif ()
    endforeach ()
    target_link_libraries(${P_TARGET}
        PRIVATE
            bleep_board_web
            bleep_dsp
            juce::juce_audio_utils
            juce::juce_gui_extra
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_lto_flags
            juce::juce_recommended_warning_flags)
endfunction()

bleep_add_plugin(TARGET BleepBoard PRODUCT "Bleep Board" CODE BpBo KIND Patch
    VST3_CATEGORIES Fx Tools)
bleep_add_plugin(TARGET BleepMidiIn PRODUCT "Bleep MIDI In" CODE BpMi KIND MidiIn SYNTH
    VST3_CATEGORIES Instrument Tools)
bleep_add_plugin(TARGET BleepMidiOut PRODUCT "Bleep MIDI Out" CODE BpMo KIND MidiOut SYNTH MIDI_OUT
    VST3_CATEGORIES Instrument Tools)
bleep_add_plugin(TARGET BleepAudioIn PRODUCT "Bleep Audio In" CODE BpAi KIND AudioIn
    VST3_CATEGORIES Fx Tools)
bleep_add_plugin(TARGET BleepAudioOut PRODUCT "Bleep Audio Out" CODE BpAo KIND AudioOut SYNTH
    VST3_CATEGORIES Instrument Tools)
bleep_add_plugin(TARGET BleepInstrument PRODUCT "Bleep Instrument" CODE BpIn KIND Instrument SYNTH
    VST3_CATEGORIES Instrument Synth)
bleep_add_plugin(TARGET BleepFx PRODUCT "Bleep FX" CODE BpFx KIND AudioInsert
    VST3_CATEGORIES Fx Tools)

# Opens the real board window on a real engine for a few seconds (not in ctest).
if (BLEEP_BUILD_TESTS)
    juce_add_gui_app(bleep_board_smoke PRODUCT_NAME "Bleep Board Smoke")
    target_sources(bleep_board_smoke PRIVATE tests/board_smoke.cpp board/BoardWindow.cpp ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_board_smoke PRIVATE ${BLEEP_ENGINE_INCLUDES})
    target_compile_definitions(bleep_board_smoke PRIVATE JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0
        BLEEP_BOARD_SMOKE_TEST=1 "BLEEP_UI_DEV_ROOT=\"${CMAKE_CURRENT_SOURCE_DIR}\"")
    target_link_libraries(bleep_board_smoke PRIVATE bleep_board_web bleep_dsp juce::juce_gui_extra juce::juce_audio_devices
        juce::juce_recommended_config_flags)
endif ()

# ---- Bleep Audio Bridge (spec §11.3): Live's side of the standalone app ------------
juce_add_plugin(BleepAudioBridge
    COMPANY_NAME "Beautiful Bleep"
    COMPANY_WEBSITE "https://brilliantbleep.com"
    BUNDLE_ID "com.brilliantbleep.patch.audiobridge"
    PLUGIN_MANUFACTURER_CODE BrBp
    PLUGIN_CODE BpAb
    PRODUCT_NAME "Bleep Audio Bridge"
    VERSION ${PROJECT_VERSION}
    FORMATS ${BLEEP_FORMATS}
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    VST3_CATEGORIES Fx Tools
    COPY_PLUGIN_AFTER_BUILD ${BLEEP_COPY_PLUGINS})
target_sources(BleepAudioBridge PRIVATE bridges/standalone/AudioBridgeProcessor.cpp ${BLEEP_BRIDGE_CLIENT_SOURCES})
target_include_directories(BleepAudioBridge PRIVATE ${BLEEP_BRIDGE_INCLUDES})
target_compile_definitions(BleepAudioBridge PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(BleepAudioBridge
    PRIVATE juce::juce_audio_utils
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# ---- the standalone app (spec §11) -------------------------------------------------
if (BLEEP_BUILD_APP)
    if (BLEEP_LINK)
        if (BLEEP_LINK_DIR)
            set(link_SOURCE_DIR "${BLEEP_LINK_DIR}")
        else ()
            include(FetchContent)
            FetchContent_Declare(link
                GIT_REPOSITORY https://github.com/Ableton/link.git
                # Link-4.1 (pinned by commit: tags can move)
                GIT_TAG 9c9091275e707ab09d09a5a608fcdb84bf0dec85
                GIT_SHALLOW TRUE
                GIT_SUBMODULES modules/asio-standalone
                SOURCE_SUBDIR no-cmake-project)  # headers only: don't build Link's examples and tests
            FetchContent_MakeAvailable(link)
        endif ()
        include("${link_SOURCE_DIR}/AbletonLinkConfig.cmake")
    endif ()

    # System Audio (doc/specs/system-audio.md): one backend per platform; Linux needs libpulse, without it the stub.
    set(BLEEP_SYSTEM_AUDIO_SOURCES app/SystemAudioStub.cpp)
    set(BLEEP_SYSTEM_AUDIO_LIBS)
    if (APPLE)
        set(BLEEP_SYSTEM_AUDIO_SOURCES app/SystemAudioMac.mm)
        set_source_files_properties(app/SystemAudioMac.mm PROPERTIES COMPILE_OPTIONS "-fobjc-arc")
    elseif (WIN32)
        set(BLEEP_SYSTEM_AUDIO_SOURCES app/SystemAudioWin.cpp)
        set(BLEEP_SYSTEM_AUDIO_LIBS ole32 mmdevapi)
    elseif (UNIX)
        find_package(PkgConfig QUIET)
        if (PkgConfig_FOUND)
            pkg_check_modules(BLEEP_PULSE QUIET IMPORTED_TARGET libpulse)
        endif ()
        if (BLEEP_PULSE_FOUND)
            set(BLEEP_SYSTEM_AUDIO_SOURCES app/SystemAudioLinux.cpp)
            set(BLEEP_SYSTEM_AUDIO_LIBS PkgConfig::BLEEP_PULSE)
        else ()
            message(STATUS "libpulse not found: the app is built without System Audio (install libpulse-dev)")
        endif ()
    endif ()

    juce_add_gui_app(BleepApp
        PRODUCT_NAME "Bleep App"
        COMPANY_NAME "Beautiful Bleep"
        BUNDLE_ID "com.brilliantbleep.patch.app"
        VERSION ${PROJECT_VERSION}
        ICON_BIG "${CMAKE_CURRENT_SOURCE_DIR}/app/icons/icon-1024.png"
        ICON_SMALL "${CMAKE_CURRENT_SOURCE_DIR}/app/icons/icon-512.png"
        DOCUMENT_EXTENSIONS bleepboard
        MICROPHONE_PERMISSION_ENABLED TRUE
        MICROPHONE_PERMISSION_TEXT "Bleep App uses audio inputs as Audio In nodes on the board."
        PLIST_TO_MERGE "<plist><dict><key>NSLocalNetworkUsageDescription</key><string>Bleep App uses Ableton Link to share tempo and beat with other apps on your network.</string><key>NSAudioCaptureUsageDescription</key><string>Beautiful Bleep can capture what your computer plays and put it on the board as the System node.</string></dict></plist>")
    target_sources(BleepApp PRIVATE
        app/Main.cpp
        app/AppController.cpp
        ${BLEEP_SYSTEM_AUDIO_SOURCES}
        bridges/standalone/LinkClock.cpp
        board/BoardWindow.cpp
        ${BLEEP_APP_ENGINE_SOURCES}
        ${BLEEP_BRIDGE_SERVER_SOURCES}
        ${BLEEP_HUB_SOURCES})
    target_include_directories(BleepApp PRIVATE ${BLEEP_ENGINE_INCLUDES} ${BLEEP_BRIDGE_INCLUDES} ${BLEEP_HUB_INCLUDES}
        "${CMAKE_CURRENT_SOURCE_DIR}/board" "${CMAKE_CURRENT_SOURCE_DIR}/app")
    target_compile_definitions(BleepApp PRIVATE
        JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0
        JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:BleepApp,JUCE_PRODUCT_NAME>"
        JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:BleepApp,JUCE_VERSION>"
        BLEEP_LINK=$<BOOL:${BLEEP_LINK}>)
    bleep_use_library(BleepApp)
    if (BLEEP_UI_DEV)
        target_compile_definitions(BleepApp PRIVATE "BLEEP_UI_DEV_ROOT=\"${CMAKE_CURRENT_SOURCE_DIR}\"")
    endif ()
    target_link_libraries(BleepApp PRIVATE
        bleep_board_web bleep_dsp
        juce::juce_audio_utils juce::juce_gui_extra
        $<$<BOOL:${BLEEP_LINK}>:Ableton::Link>
        ${BLEEP_SYSTEM_AUDIO_LIBS}
        juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
    if (APPLE)
        target_link_libraries(BleepApp PRIVATE "-framework CoreAudio" "-framework Foundation")
    endif ()
endif ()

# The preset library of Bleep Instrument and Bleep FX (the presets compiled into the plugins).
if (BLEEP_BUILD_TESTS)
    juce_add_console_app(bleep_preset_library_test PRODUCT_NAME "Bleep Preset Library Test")
    target_sources(bleep_preset_library_test PRIVATE tests/preset_library_test.cpp bridges/ableton/PresetLibrary.cpp
        ${BLEEP_ENGINE_SOURCES})
    target_include_directories(bleep_preset_library_test PRIVATE ${BLEEP_ENGINE_INCLUDES}
        "${CMAKE_CURRENT_SOURCE_DIR}/bridges/ableton")
    target_compile_definitions(bleep_preset_library_test PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_preset_library_test PRIVATE bleep_dsp bleep_board_web juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.preset-library COMMAND bleep_preset_library_test)
endif ()

# Integration test: the built Bleep Audio Bridge VST3 against the app's bridge server.
if (BLEEP_BUILD_TESTS)
    juce_add_console_app(bleep_bridge_plugin_test PRODUCT_NAME "Bleep Bridge Plugin Test")
    target_sources(bleep_bridge_plugin_test PRIVATE tests/bridge_plugin_test.cpp ${BLEEP_ENGINE_SOURCES}
        ${BLEEP_BRIDGE_SERVER_SOURCES})
    target_include_directories(bleep_bridge_plugin_test PRIVATE ${BLEEP_ENGINE_INCLUDES} ${BLEEP_BRIDGE_INCLUDES})
    target_compile_definitions(bleep_bridge_plugin_test PRIVATE
        JUCE_PLUGINHOST_VST3=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1)
    target_link_libraries(bleep_bridge_plugin_test PRIVATE bleep_dsp juce::juce_audio_processors
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_dependencies(bleep_bridge_plugin_test BleepAudioBridge_VST3)
    add_test(NAME patch.bridge-plugin COMMAND bleep_bridge_plugin_test
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepAudioBridge_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>")

    # The Board menu of the port plugins: Audio In/Out and MIDI In/Out talking to the app.
    juce_add_console_app(bleep_port_plugin_test PRODUCT_NAME "Bleep Port Plugin Test")
    target_sources(bleep_port_plugin_test PRIVATE tests/port_plugin_test.cpp ${BLEEP_ENGINE_SOURCES}
        ${BLEEP_BRIDGE_SERVER_SOURCES})
    target_include_directories(bleep_port_plugin_test PRIVATE ${BLEEP_ENGINE_INCLUDES} ${BLEEP_BRIDGE_INCLUDES})
    target_compile_definitions(bleep_port_plugin_test PRIVATE
        JUCE_PLUGINHOST_VST3=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1)
    target_link_libraries(bleep_port_plugin_test PRIVATE bleep_dsp juce::juce_audio_processors
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_dependencies(bleep_port_plugin_test BleepAudioIn_VST3 BleepAudioOut_VST3 BleepMidiIn_VST3 BleepMidiOut_VST3)
    # A stand-in for Live's plugins for trying the app and a browser by hand (not a test).
    juce_add_console_app(bleep_bridge_probe PRODUCT_NAME "Bleep Bridge Probe")
    target_sources(bleep_bridge_probe PRIVATE tests/bridge_probe.cpp ${BLEEP_BRIDGE_CLIENT_SOURCES})
    target_include_directories(bleep_bridge_probe PRIVATE ${BLEEP_BRIDGE_INCLUDES})
    target_compile_definitions(bleep_bridge_probe PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_bridge_probe PRIVATE juce::juce_core
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

    add_test(NAME patch.port-plugins COMMAND bleep_port_plugin_test
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepAudioIn_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepAudioOut_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepMidiIn_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
        "$<GENEX_EVAL:$<TARGET_PROPERTY:BleepMidiOut_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>")
endif ()
