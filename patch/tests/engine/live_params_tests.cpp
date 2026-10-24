// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// live_params_tests.cpp — the Live Params node and what a Bleep Live Link device reports about its rows (IEngine::setLiveRowInfo).

#include "engine_test.h"
#include "LiveParams.h"

namespace {

using bleep::patch::kRowsPerChannel;
using bleep::patch::liveParams;

constexpr int kRows = kRowsPerChannel;

/// The mailbox is one per process: start and end each test with nothing in it.
void clearMailbox() {
    for (int c = 1; c <= bleep::patch::kNumChannels; ++c) liveParams().clearChannel(c);
    liveParams().discrete.store(0);
}

struct Rig {
    Engine* e = new Engine();
    int main = e->registerInstance(PortKind::Patch);
    std::unique_ptr<FakePort> port;
    int64_t block = 0;

    Rig() { e->reconcileNow(); }
    /// Adds a Live Params node with the given params (normalised, as the board document stores them).
    void addNode(const juce::String& id, juce::var params) {
        auto lp = node(id, "live-params");
        lp.getDynamicObject()->setProperty("params", params);
        auto edited = copyOf(e->board());
        edited["nodes"].getArray()->add(lp);
        e->commit(edited, "live params");
    }
    void run(int blocks = 8) {
        if (!port) port = std::make_unique<FakePort>(*e, main);
        for (int b = 0; b < blocks; ++b) port->run((block++) * kBlock);
    }
    std::array<float, 32> values(uint32_t* present = nullptr) {
        std::array<float, 32> v{};
        const uint32_t p = e->liveParams(v.data());
        if (present) *present = p;
        return v;
    }
    float knob(const juce::String& nodeId, const juce::String& param) {
        auto* n = board::findNode(e->board(), nodeId);
        return n ? (float)n->getProperty("params").getDynamicObject()->getProperty(param) : -1.0f;
    }
    ~Rig() {
        port.reset();
        e->unregisterInstance(main);
        e->collectGarbage();
        e->release();
        clearMailbox();
    }
};

void publishesTheKnobScaledIntoMinMax() {
    g_test = "live params: scaling";
    clearMailbox();
    Rig r;
    r.addNode("lp", obj({{"v1", 0.25}, {"lo1", 0.2}, {"hi1", 0.8}}));   // row 2 keeps the defaults: 0.5, Min 0, Max 1
    r.run();
    uint32_t present = 0;
    const auto v = r.values(&present);
    EXPECT((present & 0xFu) == 0xFu);               // the node drives its four rows on channel 1
    EXPECT_NEAR(v[0], 0.2 + 0.25 * 0.6, 1e-4);      // Min + value × (Max − Min)
    EXPECT_NEAR(v[1], 0.5, 1e-4);
    EXPECT((present & ~0xFu) == 0u);                // and no others
}

void cablesFeedTheKnobs() {
    g_test = "live params: cables";
    clearMailbox();
    Rig r;
    auto src = node("d", "dial");
    src.getDynamicObject()->setProperty("params", obj({{"value", 0.5}}));
    r.addNode("lp", obj({{"v3", 0.1}}));
    auto edited = copyOf(r.e->board());
    edited["nodes"].getArray()->add(src);
    edited["cables"].getArray()->add(cable("d", "out", "lp", "v3", 0.5));   // a cable onto the row's knob, at half amount
    r.e->commit(edited, "cable");
    r.run();
    EXPECT_NEAR(r.values()[2], 0.1 + 0.5 * 0.5, 1e-3);   // the knob plus the cable: the board's usual model
}

void cvInputsAddToTheirRows() {
    g_test = "live params: cv inputs";
    clearMailbox();
    Rig r;
    auto src = node("d", "dial");
    src.getDynamicObject()->setProperty("params", obj({{"value", 0.5}}));
    r.addNode("lp", obj({{"v2", 0.1}, {"lo2", 0.0}, {"hi2", 1.0}, {"v4", 0.2}}));
    auto edited = copyOf(r.e->board());
    edited["nodes"].getArray()->add(src);
    edited["cables"].getArray()->add(cable("d", "out", "lp", "cv2", 0.5));   // into row 2's CV input, at half amount
    r.e->commit(edited, "cv");
    r.run();
    const auto v = r.values();
    EXPECT_NEAR(v[1], 0.1 + 0.5 * 0.5, 1e-3);   // the knob plus the CV input
    EXPECT_NEAR(v[3], 0.2, 1e-4);               // a row whose CV input is not patched: just its knob
    EXPECT_NEAR(v[0], 0.5, 1e-4);               // and the other rows keep theirs
    // the CV input is scaled into Min..Max like everything else
    auto again = copyOf(r.e->board());
    for (auto& n : *again["nodes"].getArray())
        if (n["id"].toString() == "lp") n.getDynamicObject()->getProperty("params").getDynamicObject()->setProperty("hi2", 0.5);
    r.e->commit(again, "max");
    r.run();
    EXPECT_NEAR(r.values()[1], 0.0 + 0.35 * 0.5, 1e-3);
}

void discreteRowsAreNotScaled() {
    g_test = "live params: discrete";
    clearMailbox();
    Rig r;
    r.addNode("lp", obj({{"v1", 0.25}, {"lo1", 0.2}, {"hi1", 0.8}}));
    liveParams().setDiscrete(0, true);   // what the engine does when the device says the row is a menu
    r.run();
    EXPECT_NEAR(r.values()[0], 0.25, 1e-4);   // a menu's value is the item itself: Min and Max do not apply
    liveParams().setDiscrete(0, false);
    r.run();
    EXPECT_NEAR(r.values()[0], 0.2 + 0.25 * 0.6, 1e-4);
}

void aNodeOnAnotherChannelDrivesOtherRows() {
    g_test = "live params: channels";
    clearMailbox();
    Rig r;
    r.addNode("lp", obj({{"channel", 1.0 / 7.0}, {"v1", 0.9}}));   // channel 2: rows 4..7
    r.run();
    uint32_t present = 0;
    const auto v = r.values(&present);
    EXPECT((present & 0xFFu) == 0xF0u);
    EXPECT_NEAR(v[4], 0.9, 1e-4);
}

void removingTheNodeReleasesItsRows() {
    g_test = "live params: release";
    clearMailbox();
    Rig r;
    r.addNode("lp", obj({}));
    r.run();
    uint32_t present = 0;
    r.values(&present);
    EXPECT((present & 0xFu) == 0xFu);
    auto edited = copyOf(r.e->board());
    auto* nodes = edited["nodes"].getArray();
    for (int i = nodes->size() - 1; i >= 0; --i)
        if ((*nodes)[i]["id"].toString() == "lp") nodes->remove(i);
    r.e->commit(edited, "remove");
    r.run();
    r.e->collectGarbage();
    r.values(&present);
    EXPECT((present & 0xFu) == 0u);   // the sender then sends -1, and the device lets the parameters go
}

void aMappedRowMovesItsKnobSoNothingJumps() {
    g_test = "live params: adopt";
    clearMailbox();
    Rig r;
    r.addNode("lp", obj({{"v1", 0.9}, {"v2", 0.9}, {"lo1", 0.2}, {"hi1", 0.8}}));
    // a continuous parameter at 0.5 of its range, mapped to row 1: the knob is that position taken back out of Min..Max
    r.e->setLiveRowInfo(1, 0, R"({"kind":"continuous","name":"Frequency","current":0.5,"min":0,"max":1,"adopt":true,"items":[]})");
    EXPECT_NEAR(r.knob("lp", "v1"), (0.5 - 0.2) / 0.6, 1e-4);
    r.e->setLiveRowInfo(1, 0, R"({"kind":"continuous","name":"Frequency","current":0.95,"adopt":true})");
    EXPECT_NEAR(r.knob("lp", "v1"), 1.0, 1e-4);   // beyond Max: the knob stops at its end
    r.e->setLiveRowInfo(1, 0, R"({"kind":"continuous","name":"Frequency","current":0.0,"adopt":true})");
    EXPECT_NEAR(r.knob("lp", "v1"), 0.0, 1e-4);
    // without "adopt" (a name or items that arrive later) the knob stays
    r.e->setLiveRowInfo(1, 0, R"({"kind":"continuous","name":"Frequency","current":0.5,"adopt":false})");
    EXPECT_NEAR(r.knob("lp", "v1"), 0.0, 1e-4);
    // a discrete row has no Min and Max: the knob is the item's position
    r.e->setLiveRowInfo(1, 1, R"({"kind":"discrete","name":"Filter Type","current":0.6667,"min":0,"max":3,"adopt":true,"items":["A","B","C","D"]})");
    EXPECT_NEAR(r.knob("lp", "v2"), 0.6667, 1e-4);
    // a row of a channel without a node does nothing
    const float before = r.knob("lp", "v1");
    r.e->setLiveRowInfo(2, 0, R"({"kind":"continuous","name":"X","current":0.3,"adopt":true})");
    EXPECT_NEAR(r.knob("lp", "v1"), before, 1e-6);
}

void whatTheDeviceReportsIsKept() {
    g_test = "live params: info";
    clearMailbox();
    Rig r;
    r.addNode("lp", obj({}));
    r.e->setLiveRowInfo(1, 1, R"({"kind":"discrete","name":"Filter Type","current":0.3333,"min":0,"max":3,"adopt":false,"items":["Lowpass","Highpass","Bandpass","Notch"]})");
    r.e->setLiveRowInfo(1, 0, R"({"kind":"continuous","name":"Frequency","current":0.5,"min":0,"max":1,"adopt":false,"items":[]})");
    EXPECT(liveParams().isDiscrete(1) && !liveParams().isDiscrete(0));
    const juce::var info = r.e->liveLinkInfo();
    const auto* rows = info["rows"].getArray();
    EXPECT(rows != nullptr && rows->size() == 2);
    if (rows != nullptr && rows->size() == 2) {
        const juce::var* menu = nullptr;
        for (const auto& row : *rows)
            if ((int)row["row"] == 1) menu = &row;
        EXPECT(menu != nullptr);
        if (menu != nullptr) {
            EXPECT((int)(*menu)["channel"] == 1);
            EXPECT((*menu)["kind"].toString() == "discrete" && (*menu)["name"].toString() == "Filter Type");
            EXPECT((*menu)["items"].getArray() != nullptr && (*menu)["items"].getArray()->size() == 4);
            EXPECT((*menu)["items"][2].toString() == "Bandpass");
        }
    }
    // the node's view gets it as text with the live state (only while the view is open: the node is "watched")
    r.run(2);
    const juce::var st = r.e->liveState({juce::String("lp")});
    const juce::String text = st["nodes"]["lp"]["info"].toString();
    const juce::var parsed = juce::JSON::parse(text);
    EXPECT(text.contains("Filter Type") && text.contains("Bandpass") && text.contains("Frequency"));
    EXPECT(parsed["rows"].getArray() != nullptr && parsed["rows"].getArray()->size() == 2 && (int)parsed["channel"] == 1);
    EXPECT(r.e->liveState({})["nodes"]["lp"]["info"].toString().isEmpty());   // a node nobody watches costs nothing
    r.e->setLiveRowInfo(1, 1, R"({"kind":"none"})");   // unmapped: gone, and the flag with it
    EXPECT(!liveParams().isDiscrete(1));
    EXPECT(r.e->liveLinkInfo()["rows"].getArray()->size() == 1);
    // rubbish is ignored
    r.e->setLiveRowInfo(0, 0, "{}");
    r.e->setLiveRowInfo(9, 0, "{}");
    r.e->setLiveRowInfo(1, 7, "{}");
    r.e->setLiveRowInfo(1, 0, "this is not json");
    r.e->setLiveRowInfo(1, 0, nullptr);
    EXPECT(r.e->liveLinkInfo()["rows"].getArray()->size() == 1);
}

}  // namespace

void runLiveParamsTests() {
    publishesTheKnobScaledIntoMinMax();
    cablesFeedTheKnobs();
    cvInputsAddToTheirRows();
    discreteRowsAreNotScaled();
    aNodeOnAnotherChannelDrivesOtherRows();
    removingTheNodeReleasesItsRows();
    aMappedRowMovesItsKnobSoNothingJumps();
    whatTheDeviceReportsIsKept();
}
