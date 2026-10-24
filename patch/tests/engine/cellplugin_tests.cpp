// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// cellplugin_tests.cpp — cell plugins (Bleep Instrument, Bleep FX): a preset cell next to the port node.

#include "engine_test.h"

namespace {

/// A factory preset as the plugin hands it to the engine: its document plus name and panels.
juce::String factoryPreset(const char* name) {
    const auto presets = board::fromJson(juce::File(BLEEP_FACTORY_PRESETS).loadFileAsString());
    const auto panels = board::fromJson(juce::File(BLEEP_FACTORY_PANELS).loadFileAsString());
    for (const auto& p : *presets["presets"].getArray())
        if (p["name"].toString() == name) {
            juce::var doc = board::fromJson(board::toJson(p["preset"]));
            doc.getDynamicObject()->setProperty("name", p["name"]);
            if (panels["panels"].hasProperty(name)) doc.getDynamicObject()->setProperty("panels", panels["panels"][name]);
            return board::toJson(doc);
        }
    return {};
}

/// The name of the first factory instrument whose root is a Voice Cell and that has a panel (the presets change, so no test names one):
/// the Starters are left out, they have nothing inside to play. Empty if there is none.
juce::String voiceCellInstrument() {
    const auto presets = board::fromJson(juce::File(BLEEP_FACTORY_PRESETS).loadFileAsString());
    const auto panels = board::fromJson(juce::File(BLEEP_FACTORY_PANELS).loadFileAsString());
    for (const auto& p : *presets["presets"].getArray()) {
        const auto& doc = p["preset"];
        if (p["category"].toString() == "Starters" || !doc["plays"].hasProperty("instrument")) continue;
        if (!panels["panels"].hasProperty(p["name"].toString())) continue;
        const juce::String root = doc["root"].toString();
        for (const auto& n : *doc["nodes"].getArray())
            if (n["id"].toString() == root && n["type"].toString() == "voice-cell") return p["name"].toString();
    }
    return {};
}

void setPreset(Engine& e, int handle, const juce::String& json, bool replace = true) {
    e.setCellPreset(handle, json.toRawUTF8(), (size_t)json.getNumBytesAsUTF8(), replace);
}

juce::String cellOf(Engine& e, int handle) {
    const auto port = portNode(e, handle);
    return port.isEmpty() ? juce::String() : board::attachedCell(e.board(), port);
}

float peakAfter(FakePort& p, int blocks, int from, std::function<void(int)> before = {}) {
    float peak = 0.0f;
    for (int b = 0; b < blocks; ++b) {
        if (before) before(b);
        p.run((int64_t)b * kBlock);
        if (b >= from)
            for (auto& ch : p.out)
                for (float v : ch) peak = std::max(peak, std::fabs(v));
    }
    return peak;
}

/// A drum machine in an Instrument plays with the host's transport: Clock and Run come from the port node.
void cellPluginsFollowHost() {
    g_test = "cell plugins follow the host";
    for (const char* name : {"Trap Roll Call", "Warehouse House"}) {
        auto* e = new Engine();
        const int inst = e->registerInstance(PortKind::Instrument);
        setPreset(*e, inst, factoryPreset(name));
        const auto cell = cellOf(*e, inst);
        const auto port = portNode(*e, inst);
        EXPECT(cell.isNotEmpty());
        bool clock = false, run = false;
        for (const auto& c : *e->board()["cables"].getArray()) {
            if (c["from"]["node"].toString() != port) continue;
            clock |= c["from"]["jack"].toString() == "clock" && c["to"]["node"].toString() == cell && c["to"]["jack"].toString() == "clock";
            run |= c["from"]["jack"].toString() == "playing" && c["to"]["node"].toString() == cell && c["to"]["jack"].toString() == "run";
        }
        EXPECT(clock);
        EXPECT(run == (juce::String(name) == "Warehouse House"));
        FakePort p(*e, inst);
        const float stopped = peakAfter(p, 300, 8);
        if (!(stopped < 0.0001f)) std::printf("%s: plays %f with the transport stopped\n", name, stopped);
        EXPECT(stopped < 0.0001f);  // a stopped transport plays nothing
        p.playing = true;
        const float playing = peakAfter(p, 1200, 8);
        EXPECT(playing > 0.01f && std::isfinite(playing));
        e->unregisterInstance(inst);
        e->collectGarbage();
        e->release();
    }
    // The host's MIDI plays the drums too: General MIDI notes trigger the kit, the transport stays stopped.
    for (const char* name : {"Warehouse House", "One Drop Echo", "Trap Roll Call", "Bossa Clave Box", "Foundry Clank",
                             "Neuro Two-Step", "Twelve-Eight Bell", "Tribal Tom Cascade", "Clicks & Cuts Garden", "Brush Swing Trio"}) {
        auto* e = new Engine();
        const int inst = e->registerInstance(PortKind::Instrument);
        setPreset(*e, inst, factoryPreset(name));
        FakePort p(*e, inst);
        const float idle = peakAfter(p, 200, 8);
        if (!(idle < 0.0001f)) std::printf("%s: idle peak %f\n", name, idle);
        EXPECT(idle < 0.0001f);
        bool wired = false;
        for (const auto& c : *e->board()["cables"].getArray())
            wired |= c["from"]["node"].toString() == portNode(*e, inst) && c["from"]["jack"].toString() == "notes";
        EXPECT(wired);
        for (int note : {36, 38, 42}) {
            MidiEvent on;
            on.offset = 0;
            on.size = 3;
            on.bytes[0] = 0x90;
            on.bytes[1] = (uint8_t)note;
            on.bytes[2] = 110;
            FakePort q(*e, inst);
            const float hit = peakAfter(q, 120, 4, [&](int b) { if (b == 0) q.midiIn.push_back(on); });
            if (!(hit > std::max(0.005f, idle * 1.1f))) std::printf("%s: note %d gave peak %f, idle %f\n", name, note, hit, idle);
            EXPECT(hit > std::max(0.005f, idle * 1.1f) && std::isfinite(hit));
        }
        e->unregisterInstance(inst);
        e->collectGarbage();
        e->release();
    }
}

void cellPlugins() {
    g_test = "cell plugins";
    {   // the ABI versions: the engine says its minor, and `supports` compares it
        auto* probe = new Engine();
        EXPECT(probe->abiMinor() == kAbiMinor && probe->supports(0) && !probe->supports(kAbiMinor + 1));
        probe->release();
        EXPECT(juce::String(kAbiTag).startsWith("bleep-engine-abi-"));
    }
    const juce::String voiceName = voiceCellInstrument();   // an instrument whose root is a Voice Cell, whatever the factory presets are today
    EXPECT(voiceName.isNotEmpty());
    const auto warm = factoryPreset(voiceName.toRawUTF8());
    const auto empty = factoryPreset("Empty FX");
    EXPECT(warm.isNotEmpty() && empty.isNotEmpty());

    // An Instrument alone in the set: the engine keeps a board for it, with the port node and the cell.
    juce::String snapshot;
    {
        auto* e = new Engine();
        const int inst = e->registerInstance(PortKind::Instrument);
        EXPECT(!e->hasBoard());
        setPreset(*e, inst, warm);
        EXPECT(e->hasBoard() && e->state(inst) == PortState::Ok);
        const auto cell = cellOf(*e, inst);
        EXPECT(cell.isNotEmpty());
        if (cell.isNotEmpty()) {
            // The preset's root is a Voice Cell, and it is the cell.
            EXPECT(board::findNode(e->board(), cell)->getProperty("type").toString() == "voice-cell");
            EXPECT(board::findNode(e->board(), cell)->getProperty("name").toString() == voiceName);
            EXPECT(e->board()["panels"].isArray() && e->board()["panels"].size() >= 1);
            // The panel's keys play the cell's notes.
            bool keysFound = false;
            for (const auto& q : *e->board()["panels"].getArray())
                for (const auto& c : *q["controls"].getArray())
                    if (c["type"].toString() == "keys") keysFound = (*c["wire"].getArray())[0].hasProperty("notes");
            EXPECT(keysFound);
            EXPECT(board::parse(e->board()).nodes.size() > 4);
        }
        // What a plugin window's web view asks: the board page's native calls as JSON.
        auto ui = [&](const char* method, const char* args) {
            const size_t len = e->uiCall(inst, method, args, nullptr, 0);
            std::string out(len, '\0');
            e->uiCall(inst, "__last", "[]", out.data(), len);
            return juce::JSON::parse(juce::String::fromUTF8(out.data(), (int)len));
        };
        const auto init = ui("init", "[]");
        EXPECT(init["plugin"] && init["pluginCell"].toString() == cell && init["types"].size() > 10);
        EXPECT(ui("pluginCell", "[]")["cell"].toString() == cell);
        EXPECT(init["board"]["panels"].size() >= 1);
        const juce::String firstNode = (*init["board"]["nodes"].getArray())[(init["board"]["nodes"].size() - 1)]["id"].toString();
        EXPECT(ui("setParam", ("[\"" + firstNode + "\",\"nope\",0.5]").toRawUTF8()).isVoid());
        EXPECT(ui("liveState", "[[]]").hasProperty("nodes"));
        // The automatable knobs: the cell's panel controls, at most 16, each naming a real node and knob.
        const auto knobs = ui("cellParams", "[]");
        EXPECT(knobs.isArray() && knobs.size() >= 4 && knobs.size() <= 16);
        for (int i = 0; i < knobs.size(); ++i)
            EXPECT(board::findNode(e->board(), knobs[i]["node"].toString()) != nullptr && knobs[i]["name"].toString().isNotEmpty() &&
                   (double)knobs[i]["value"] >= 0.0 && (double)knobs[i]["value"] <= 1.0);
        FakePort p(*e, inst);
        MidiEvent on;
        on.offset = 0;
        on.size = 3;
        on.bytes[0] = 0x90;
        on.bytes[1] = 60;
        on.bytes[2] = 100;
        // The cell is cabled to no other plugin: it runs in the plugin's own block, so the note sounds in the block it arrives in.
        EXPECT(e->portLatencySamples(inst) == 0);
        const float first = peakAfter(p, 1, 0, [&](int b) { if (b == 0) p.midiIn.push_back(on); });
        EXPECT(first > 0.01f);
        const float sound = std::max(first, peakAfter(p, 60, 0));
        EXPECT(sound > 0.01f && std::isfinite(sound));
        EXPECT(sound < 2.0f);

        // The saved state carries the edited cell; a new set restores it.
        auto edited = copyOf(e->board());
        bool moved = false;
        for (auto& n : *edited["nodes"].getArray())
            if (n["parent"].toString().isNotEmpty() && n["type"].toString() != "voice-in" && n["type"].toString() != "voice-out" && !moved)
                n.getDynamicObject()->setProperty("name", "Edited Node"), moved = true;
        e->commit(edited, "move");
        const size_t len = e->cellPreset(inst, nullptr, 0);
        std::string json(len, '\0');
        e->cellPreset(inst, json.data(), len);
        snapshot = juce::String::fromUTF8(json.data(), (int)len);
        const auto saved = board::fromJson(snapshot);
        EXPECT(saved["name"].toString() == voiceName && saved.hasProperty("plays") && saved["panels"].isArray());
        bool kept = false;
        for (const auto& n : *saved["nodes"].getArray()) kept |= n["name"].toString() == "Edited Node";
        EXPECT(moved && kept);
        e->unregisterInstance(inst);
        EXPECT(!e->hasBoard());  // the last cell plugin takes its board with it
        e->collectGarbage();
        e->release();
    }
    // Restoring: with Bleep Board (its board is saved) the board's copy wins; without, the snapshot builds the cell.
    {
        auto* e = new Engine();
        const int inst = e->registerInstance(PortKind::Instrument);
        setPreset(*e, inst, snapshot, false);
        const auto cell = cellOf(*e, inst);
        bool kept = false;
        for (const auto& n : *e->board()["nodes"].getArray()) kept |= n["name"].toString() == "Edited Node";
        EXPECT(cell.isNotEmpty() && kept);
        // Bleep Board arrives: its board replaces the implicit one, and the cell comes back with the port node.
        const int main = e->registerInstance(PortKind::Patch);
        e->reconcileNow();
        EXPECT(cellOf(*e, inst).isNotEmpty());
        // A second state restore does not stack another cell on top.
        setPreset(*e, inst, snapshot, false);
        int cells = 0;
        for (const auto& n : *e->board()["nodes"].getArray()) cells += n["parent"].toString().isEmpty() && (n["type"].toString() == "voice-cell" || n["type"].toString() == "cell");
        EXPECT(cells == 1);
        // Choosing another preset replaces the cell.
        setPreset(*e, inst, factoryPreset("Heavy Ladder Bass"), true);
        cells = 0;
        for (const auto& n : *e->board()["nodes"].getArray()) cells += n["parent"].toString().isEmpty() && (n["type"].toString() == "voice-cell" || n["type"].toString() == "cell");
        EXPECT(cells == 1);
        EXPECT(board::findNode(e->board(), cellOf(*e, inst))->getProperty("name").toString() == "Heavy Ladder Bass");
        e->unregisterInstance(inst);
        e->unregisterInstance(main);
        e->collectGarbage();
        e->release();
    }
    // An FX: Empty FX passes the track's audio through the board and back, in the same block (its cell is cabled to no other plugin).
    {
        auto* e = new Engine();
        const int main = e->registerInstance(PortKind::Patch);
        const int fx = e->registerInstance(PortKind::AudioInsert);
        setPreset(*e, fx, empty);
        EXPECT(cellOf(*e, fx).isNotEmpty());
        FakePort pMain(*e, main), pFx(*e, fx);
        int arrivedAt = -1;
        for (int b = 0; b < 12; ++b) {
            for (auto& ch : pFx.in) std::fill(ch.begin(), ch.end(), 0.0f);
            if (b == 1) pFx.in[0][7] = pFx.in[1][7] = 0.5f;
            pMain.run((int64_t)b * kBlock);
            pFx.run((int64_t)b * kBlock);
            if (arrivedAt < 0 && std::fabs(pFx.out[0][7]) > 0.25f) arrivedAt = b;
        }
        EXPECT(arrivedAt == 1 && e->portLatencySamples(fx) == 0);
        e->unregisterInstance(fx);
        e->unregisterInstance(main);
        e->collectGarbage();
        e->release();
    }
}

}  // namespace

void runCellPluginTests() {
    cellPlugins();
    cellPluginsFollowHost();
}
