# SPDX-License-Identifier: MIT
#
# The web hub (doc/specs/bridges.md §10): WebSocket/HTTP server, web peers, audio links.
# Included at the end of patch/CMakeLists.txt. Variables used from there:
# BLEEP_ENGINE_SOURCES, BLEEP_ENGINE_INCLUDES, BLEEP_BRIDGE_INCLUDES, BLEEP_BUILD_TESTS.
set(BLEEP_HUB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/hub")
set(BLEEP_HUB_SOURCES)   # sources the app links (appended below)
set(BLEEP_HUB_INCLUDES "${BLEEP_HUB_DIR}")

list(APPEND BLEEP_HUB_SOURCES ${BLEEP_HUB_DIR}/WebSocketServer.cpp ${BLEEP_HUB_DIR}/WebHub.cpp)

if (BLEEP_BUILD_TESTS)
    juce_add_console_app(bleep_websocket_tests PRODUCT_NAME "Bleep WebSocket Tests")
    target_sources(bleep_websocket_tests PRIVATE tests/websocket_test.cpp ${BLEEP_HUB_DIR}/WebSocketServer.cpp)
    target_include_directories(bleep_websocket_tests PRIVATE ${BLEEP_HUB_INCLUDES})
    target_compile_definitions(bleep_websocket_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_websocket_tests PRIVATE
        juce::juce_core
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.websocket COMMAND bleep_websocket_tests)
endif ()

if (BLEEP_BUILD_TESTS)
    juce_add_console_app(bleep_hub_tests PRODUCT_NAME "Bleep Hub Tests")
    target_sources(bleep_hub_tests PRIVATE tests/hub_test.cpp ${BLEEP_HUB_SOURCES} ${BLEEP_ENGINE_SOURCES}
        ${BLEEP_BRIDGE_SERVER_SOURCES} bridges/standalone/BridgeClient.cpp)
    target_include_directories(bleep_hub_tests PRIVATE ${BLEEP_ENGINE_INCLUDES} ${BLEEP_BRIDGE_INCLUDES} ${BLEEP_HUB_INCLUDES}
        "${CMAKE_CURRENT_SOURCE_DIR}/tests")
    target_compile_definitions(bleep_hub_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bleep_hub_tests PRIVATE
        bleep_dsp juce::juce_events
        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME patch.hub COMMAND bleep_hub_tests)
endif ()

# The browser side of the link (patch/web/js/bridge-*.js): plain node, no build.
find_program(BLEEP_NODE node)
if (BLEEP_NODE AND BLEEP_BUILD_TESTS)
    foreach (t bridge-protocol-test bridge-ring-test bridge-client-test bridge-engine-test)
        add_test(NAME patch.web-${t} COMMAND ${BLEEP_NODE} "${CMAKE_CURRENT_SOURCE_DIR}/web/test/${t}.mjs")
    endforeach ()
endif ()
