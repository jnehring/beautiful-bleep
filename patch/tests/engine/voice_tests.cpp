// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// voice_tests.cpp — Voice Cells, the Step Sequencer, the Drum Grid and the drum nodes.

#include "engine_test.h"

namespace {

/// its pitch as audio, so the cell's output is the sum of the playing pitches.
struct VoiceRig {
    Engine* e = new Engine();
    int main = 0, midi = 0, out = 0;
    juce::String cellId = "vc", voiceIn = "vi", voiceOut = "vo";
    FakePort *pMidi = nullptr, *pOut = nullptr;

    VoiceRig() {
        e->setStandalone(true);
        main = e->registerInstance(PortKind::Patch);
        midi = e->registerRemoteInstance(PortKind::MidiIn);
        out = e->registerRemoteInstance(PortKind::AudioOut);
        e->reconcileNow();
        pMidi = new FakePort(*e, midi);
        pOut = new FakePort(*e, out);
    }
    ~VoiceRig() {
        delete pMidi;
        delete pOut;
        e->unregisterInstance(midi);
        e->unregisterInstance(out);
        e->unregisterInstance(main);
        e->release();
    }
    /// A Voice Cell; `inside` adds nodes and cables inside it.
    void build(juce::var params, std::function<void(juce::Array<juce::var>&, juce::Array<juce::var>&)> inside) {
        auto doc = copyOf(e->board());
        auto* nodes = doc["nodes"].getArray();
        auto* cables = doc["cables"].getArray();
        auto cell = node(cellId, "voice-cell");
        cell.getDynamicObject()->setProperty("params", params);
        nodes->add(cell);
        nodes->add(node(voiceIn, "voice-in", cellId));
        nodes->add(node(voiceOut, "voice-out", cellId));
        juce::Array<juce::var> n, c;
        inside(n, c);
        nodes->addArray(n);
        cables->addArray(c);
        cables->add(cable(portNode(*e, midi), "notes", cellId, "notes"));
        cables->add(cable(cellId, "l", portNode(*e, out), "l"));
        e->commit(doc, "voice cell");
    }
    /// One block in standalone mode; returns the last output sample.
    float block(std::vector<std::array<int, 3>> events = {}) {
        std::vector<std::array<int, 4>> at;
        for (const auto& ev : events) at.push_back({ev[0], ev[1], ev[2], 0});
        return blockAt(at);
    }
    /// The same, with each event at its own sample offset {status, d1, d2, offset}.
    float blockAt(const std::vector<std::array<int, 4>>& events) {
        for (const auto& ev : events) {
            MidiEvent m;
            m.offset = ev[3];
            m.bytes[0] = (uint8_t)ev[0];
            m.bytes[1] = (uint8_t)ev[1];
            m.bytes[2] = (uint8_t)ev[2];
            m.size = 3;
            pMidi->midiIn.push_back(m);
        }
        BlockIO a, b;
        const float* ins[2] = {pMidi->in[0].data(), pMidi->in[1].data()};
        float* outs[2] = {pOut->out[0].data(), pOut->out[1].data()};
        for (BlockIO* io : {&a, &b}) {
            io->numSamples = kBlock;
            io->transport.sampleRate = kRate;
        }
        a.audioIn = ins;
        a.midiIn = pMidi->midiIn.data();
        a.numMidiIn = (int)pMidi->midiIn.size();
        b.audioOut = outs;
        b.numAudioOut = 2;
        int handles[2] = {midi, out};
        BlockIO* ios[2] = {&a, &b};
        e->processAll(handles, ios, 2);
        pMidi->midiIn.clear();
        return pOut->out[0][kBlock - 1];
    }
};

juce::var voiceParams(int voices, int stealing, int mode) {
    const auto* spec = Registry::get().find("voice-cell");
    auto norm = [&](const char* id, float v) { return spec->params[(size_t)spec->paramIndex(id)].toNormalised(v); };
    return obj({{"voices", norm("voices", (float)voices)}, {"stealing", norm("stealing", (float)stealing)},
                {"mode", norm("mode", (float)mode)}, {"output", norm("output", 0.0f)}});  // output: plain sum
}

void voiceCells() {
    g_test = "voice cell";
    auto pitchVoice = [](juce::Array<juce::var>&, juce::Array<juce::var>& c) {
        c.add(cable("vi", "pitch", "vo", "l"));  // the voice's audio = its pitch
    };
    {
        VoiceRig rig;
        rig.build(voiceParams(2, 0, 0), pitchVoice);  // 2 voices, steal oldest
        rig.block({{0x90, 64, 100}, {0x90, 67, 100}});
        EXPECT_NEAR(rig.block(), 4.0 / 12 + 7.0 / 12, 1e-5);
        rig.block({{0x90, 72, 100}});  // a third note steals E (the oldest)
        EXPECT_NEAR(rig.block(), 7.0 / 12 + 12.0 / 12, 1e-5);
        // A board edit doesn't cut the notes (voices survive recompiles).
        auto moved = copyOf(rig.e->board());
        for (auto& n : *moved["nodes"].getArray())
            if (n["id"].toString() == "vc") n.getDynamicObject()->setProperty("x", 333);
        rig.e->commit(moved, "move");
        EXPECT_NEAR(rig.block(), 7.0 / 12 + 12.0 / 12, 1e-5);
        // The engine shows which voices play.
        const auto live = rig.e->liveState({});
        EXPECT((int)live["nodes"]["vc"]["voices"] == 3);
    }
    {
        // A shared input arrives over Voice In (a Voice Cell has no Cell In): Dial → cell input → every voice.
        VoiceRig rig;
        rig.build(voiceParams(2, 0, 0), [](juce::Array<juce::var>& n, juce::Array<juce::var>& c) {
            n.add(node("dial", "dial"));
        });
        auto doc = copyOf(rig.e->board());
        for (auto& n : *doc["nodes"].getArray())
            if (n["id"].toString() == "vc")
                n.getDynamicObject()->setProperty(
                    "inputs", juce::Array<juce::var>{obj({{"id", "mod"}, {"name", "Mod"}, {"type", "control"}})});
        rig.e->commit(doc, "shared input");
        doc = copyOf(rig.e->board());  // the cables need the jack, so they come in a second commit
        doc["cables"].getArray()->add(cable("dial", "out", "vc", "mod"));
        doc["cables"].getArray()->add(cable("vi", "mod", "vo", "l"));
        rig.e->commit(doc, "shared input cables");
        int cellIns = 0;
        for (const auto& n : *rig.e->board()["nodes"].getArray()) cellIns += n["type"].toString() == "cell-in";
        EXPECT(cellIns == 0);  // the sanitiser does not add one
        rig.block({{0x90, 60, 100}});
        float v = 0.0f;
        for (int b = 0; b < 100; ++b) v = rig.block();
        EXPECT_NEAR(v, 0.5, 1e-3);
    }
    {
        VoiceRig rig;
        rig.build(voiceParams(2, 4, 0), pitchVoice);  // 2 voices, stealing: none
        rig.block({{0x90, 64, 100}, {0x90, 67, 100}, {0x90, 72, 100}});
        EXPECT_NEAR(rig.block(), 4.0 / 12 + 7.0 / 12, 1e-5);  // the third note is dropped
    }
    {
        VoiceRig rig;
        rig.build(voiceParams(8, 0, 1), pitchVoice);  // mono
        rig.block({{0x90, 60, 100}, {0x90, 64, 100}});
        EXPECT_NEAR(rig.block(), 4.0 / 12, 1e-5);
        rig.block({{0x80, 64, 0}});  // back to the held C
        EXPECT_NEAR(rig.block(), 0.0, 1e-5);
    }
    {
        // A real voice: Oscillator → VCA, ADSR on the gain and on Active. It sounds, then sleeps.
        VoiceRig rig;
        rig.build(voiceParams(8, 0, 0), [](juce::Array<juce::var>& n, juce::Array<juce::var>& c) {
            n.add(node("osc", "oscillator", "vc"));
            n.add(node("env", "adsr", "vc"));
            n.add(node("amp", "vca", "vc"));
            c.add(cable("vi", "pitch", "osc", "pitch"));
            c.add(cable("vi", "gate", "env", "gate"));
            c.add(cable("vi", "trigger", "env", "retrig"));
            c.add(cable("osc", "sine", "amp", "l"));
            c.add(cable("env", "env", "amp", "gain"));
            c.add(cable("amp", "l", "vo", "l"));
            c.add(cable("env", "active", "vo", "active"));
        });
        rig.block({{0x90, 69, 127}});
        float peak = 0.0f;
        for (int b = 0; b < 40; ++b) {
            rig.block();
            for (float x : rig.pOut->out[0]) peak = std::max(peak, std::fabs(x));
        }
        EXPECT(peak > 0.1f);
        EXPECT((int)rig.e->liveState({})["nodes"]["vc"]["voices"] == 1);
        rig.block({{0x80, 69, 0}});
        for (int b = 0; b < 2000; ++b) rig.block();  // ≈ 5 s: the release (0.4 s) is long over
        float tail = 0.0f;
        for (float x : rig.pOut->out[0]) tail = std::max(tail, std::fabs(x));
        EXPECT(tail < 1e-4f);
        EXPECT((int)rig.e->liveState({})["nodes"]["vc"]["voices"] == 0);  // asleep
    }
    {
        // Hammering: random chords, quick taps and stealing; when every key is up,
        // every voice must fall silent and sleep. No voice may hang.
        VoiceRig rig;
        rig.build(voiceParams(4, 0, 0), [](juce::Array<juce::var>& n, juce::Array<juce::var>& c) {
            n.add(node("osc", "oscillator", "vc"));
            n.add(node("env", "adsr", "vc"));
            n.add(node("amp", "vca", "vc"));
            c.add(cable("vi", "pitch", "osc", "pitch"));
            c.add(cable("vi", "gate", "env", "gate"));
            c.add(cable("vi", "trigger", "env", "retrig"));
            c.add(cable("osc", "sine", "amp", "l"));
            c.add(cable("env", "env", "amp", "gain"));
            c.add(cable("amp", "l", "vo", "l"));
            c.add(cable("env", "active", "vo", "active"));
        });
        std::mt19937 rng(11);
        std::set<int> held;
        for (int b = 0; b < 3000; ++b) {
            std::vector<std::array<int, 4>> ev;
            const int count = (int)(rng() % 4);
            int offset = 0;
            for (int k = 0; k < count; ++k) {
                offset = std::min(kBlock - 1, offset + (int)(rng() % 40));
                const int note = 48 + (int)(rng() % 24);
                if (held.count(note) || rng() % 3 == 0) {
                    if (held.count(note)) {
                        // Both note-off forms: 0x80 (any velocity) and 0x90 with velocity 0.
                        if (rng() % 2) ev.push_back({0x80, note, (int)(rng() % 128), offset});
                        else ev.push_back({0x90, note, 0, offset});
                        held.erase(note);
                    }
                } else {
                    ev.push_back({0x90, note, 1 + (int)(rng() % 127), offset});
                    held.insert(note);
                    if (rng() % 5 == 0) {  // a quick tap: released in the same block
                        ev.push_back({0x80, note, 0, std::min(kBlock - 1, offset + 1)});
                        held.erase(note);
                    }
                }
            }
            rig.blockAt(ev);
        }
        std::vector<std::array<int, 4>> off;
        for (int note : held) off.push_back({0x80, note, 0, 0});
        rig.blockAt(off);
        for (int b = 0; b < 2000; ++b) rig.block();
        float tail = 0.0f;
        for (float x : rig.pOut->out[0]) tail = std::max(tail, std::fabs(x));
        EXPECT(tail < 1e-4f);
        EXPECT((int)rig.e->liveState({})["nodes"]["vc"]["voices"] == 0);
    }
}

/// Step Sequencer (doc/specs/modules/step-sequencer.md): node data, live step
/// edits, and notes into a Voice Cell.
void stepSequencer() {
    g_test = "step sequencer";
    {  // Data is filled in and clamped.
        auto withData = node("short", "step-sequencer");
        juce::Array<juce::var> steps{obj({{"g", 7}, {"p", 99}, {"v", 0}}), obj({{"g", 2}, {"p", -3}, {"v", 64}})};
        withData.getDynamicObject()->setProperty("data", obj({{"steps", steps}}));
        auto d = board::sanitise(doc({node("fresh", "step-sequencer"), withData, node("u", "utility")}, {}));
        auto fresh = board::findNode(d, "fresh")->getProperty("data");
        auto saved = board::findNode(d, "short")->getProperty("data");
        EXPECT(fresh["steps"].size() == 32 && (int)fresh["steps"][31]["g"] == 1 && (int)fresh["steps"][0]["v"] == 100);
        EXPECT(saved["steps"].size() == 32);
        EXPECT((int)saved["steps"][0]["g"] == 2 && (int)saved["steps"][0]["p"] == 36 && (int)saved["steps"][0]["v"] == 1);
        EXPECT((int)saved["steps"][1]["g"] == 2 && (int)saved["steps"][1]["p"] == -3);
        EXPECT((int)saved["steps"][2]["g"] == 0);  // short arrays are padded with Off
        EXPECT(std::fabs((double)saved["randomize"]["density"] - 0.6) < 1e-9 && !saved["randomize"].hasProperty("lanes"));
        EXPECT(!board::findNode(d, "u")->hasProperty("data"));
        EXPECT(board::parse(d).node("short")->data.find("\"steps\"") != std::string::npos);
    }

    auto* e = new Engine();
    e->setStandalone(true);
    const int main = e->registerInstance(PortKind::Patch);
    const int out = e->registerRemoteInstance(PortKind::AudioOut);
    e->reconcileNow();
    FakePort pOut(*e, out);
    juce::Array<juce::var> steps;
    for (int i = 0; i < 32; ++i) steps.add(obj({{"g", 2}, {"p", 7}, {"v", 100}}));  // one long tied G
    auto seq = node("seq", "step-sequencer");
    seq.getDynamicObject()->setProperty("data", obj({{"steps", steps}}));
    auto cell = node("vc", "voice-cell");
    cell.getDynamicObject()->setProperty("params", voiceParams(8, 0, 0));
    auto edited = copyOf(e->board());
    for (auto n : {seq, cell, node("vi", "voice-in", "vc"), node("vo", "voice-out", "vc")})
        edited["nodes"].getArray()->add(n);
    for (auto c : {cable("seq", "notes", "vc", "notes"), cable("vi", "pitch", "vo", "l"), cable("vi", "gate", "vo", "r"),
                   cable("vi", "gate", "vo", "active"), cable("vc", "l", portNode(*e, out), "l"), cable("vc", "r", portNode(*e, out), "r")})
        edited["cables"].getArray()->add(c);
    e->commit(edited, "sequencer");
    int64_t pos = 0;
    auto run = [&](int blocks, bool playing = true) {
        for (int b = 0; b < blocks; ++b, pos += kBlock) {
            BlockIO io;
            float* outs[2] = {pOut.out[0].data(), pOut.out[1].data()};
            io.numSamples = kBlock;
            io.transport.sampleRate = kRate;
            io.transport.bpm = 120.0;
            io.transport.playing = playing;
            io.transport.ppqValid = true;
            io.transport.ppq = (double)pos / 24000.0;
            io.audioOut = outs;
            io.numAudioOut = 2;
            int handles[1] = {out};
            BlockIO* ios[1] = {&io};
            e->processAll(handles, ios, 1);
        }
    };
    run(100);
    EXPECT_NEAR(pOut.out[0][kBlock - 1], 7.0 / 12.0, 1e-4);  // one voice playing G
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 1.0, 1e-6);
    // A step edit takes effect without a commit; the doc follows.
    const auto undoBefore = e->canUndo();
    for (int i = 0; i < 32; ++i) steps.set(i, obj({{"g", 2}, {"p", 4}, {"v", 100}}));
    e->setData("seq", obj({{"steps", steps}}));
    EXPECT((int)board::findNode(e->board(), "seq")->getProperty("data")["steps"][5]["p"] == 4);
    EXPECT(e->canUndo() == undoBefore);
    run(100);
    EXPECT_NEAR(pOut.out[0][kBlock - 1], 4.0 / 12.0, 1e-4);  // legato to E: still one voice
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 1.0, 1e-6);
    auto live = e->liveState({"seq"})["nodes"]["seq"];
    EXPECT(live.hasProperty("step") && (int)live["sounding"] == 1);
    // Deleting the sequencer releases the note it was holding.
    edited = copyOf(e->board());
    auto* nodes = edited["nodes"].getArray();
    for (int i = nodes->size(); --i >= 0;)
        if ((*nodes)[i]["id"].toString() == "seq") nodes->remove(i);
    e->commit(edited, "delete");
    run(20);
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 0.0, 1e-6);
    e->unregisterInstance(out);
    e->unregisterInstance(main);
    e->release();
}

/// Drum Grid (doc/specs/modules/drum-grid.md): node data, live edits, and gates
/// through the engine.
void drumGrid() {
    g_test = "drum grid";
    {  // Data is filled in and cleaned.
        auto broken = node("broken", "drum-grid");
        juce::Array<juce::var> rows{"x?X..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"};
        juce::Array<juce::var> patterns{obj({{"length", 99}, {"steps", rows}}), 7};
        juce::Array<juce::var> tracks{obj({{"name", "  "}, {"mute", true}})};
        broken.getDynamicObject()->setProperty("data", obj({{"patterns", patterns}, {"tracks", tracks}, {"current", 40}}));
        auto d = board::sanitise(doc({node("fresh", "drum-grid"), broken}, {}));
        auto fresh = board::findNode(d, "fresh")->getProperty("data");
        auto saved = board::findNode(d, "broken")->getProperty("data");
        EXPECT(fresh["patterns"].size() == 16 && fresh["tracks"].size() == 8);
        EXPECT(fresh["patterns"][0]["steps"][0].toString() == "x...x...x...x..." + juce::String::repeatedString(".", 16));
        EXPECT(fresh["patterns"][1].isVoid() && fresh["tracks"][0]["name"].toString() == "Kick");
        EXPECT((int)saved["patterns"][0]["length"] == 32 && (int)saved["current"] == 15);
        EXPECT(saved["patterns"][0]["steps"][0].toString() == "x.X..xxxxxxxxxxxxxxxxxxxxxxxxxxx");
        EXPECT(saved["patterns"][0]["steps"][7].toString() == juce::String::repeatedString(".", 32));
        EXPECT(saved["patterns"][1].isVoid() && saved["patterns"].size() == 16);
        EXPECT(saved["tracks"][0]["name"].toString() == "Kick" && (bool)saved["tracks"][0]["mute"]);
    }

    auto* e = new Engine();
    e->setStandalone(true);
    const int main = e->registerInstance(PortKind::Patch);
    const int out = e->registerRemoteInstance(PortKind::AudioOut);
    e->reconcileNow();
    FakePort pOut(*e, out);
    juce::Array<juce::var> rows{"xxxxxxxxxxxxxxxx", "XXXXXXXXXXXXXXXX"};
    juce::Array<juce::var> patterns{obj({{"length", 16}, {"steps", rows}})};
    auto grid = node("grid", "drum-grid");
    grid.getDynamicObject()->setProperty("data", obj({{"patterns", patterns}}));
    grid.getDynamicObject()->setProperty("params", obj({{"gatelength", 1.0}}));
    auto edited = copyOf(e->board());
    edited["nodes"].getArray()->add(grid);
    for (auto c : {cable("grid", "gate1", portNode(*e, out), "l"), cable("grid", "velocity2", portNode(*e, out), "r")})
        edited["cables"].getArray()->add(c);
    e->commit(edited, "grid");
    int64_t pos = 0;
    auto run = [&](int blocks) {
        for (int b = 0; b < blocks; ++b, pos += kBlock) {
            BlockIO io;
            float* outs[2] = {pOut.out[0].data(), pOut.out[1].data()};
            io.numSamples = kBlock;
            io.transport.sampleRate = kRate;
            io.transport.bpm = 120.0;
            io.transport.playing = true;
            io.transport.ppqValid = true;
            io.transport.ppq = (double)pos / 24000.0;
            io.audioOut = outs;
            io.numAudioOut = 2;
            int handles[1] = {out};
            BlockIO* ios[1] = {&io};
            e->processAll(handles, ios, 1);
        }
    };
    run(20);
    EXPECT_NEAR(pOut.out[0][kBlock - 1], 1.0, 1e-6);  // track 1 plays
    EXPECT_NEAR(pOut.out[1][kBlock - 1], 1.0, 1e-6);  // track 2 is accented
    // Muting track 1 closes its gate without a commit or an undo entry.
    const auto undoBefore = e->canUndo();
    juce::Array<juce::var> tracks{obj({{"mute", true}})};
    e->setData("grid", obj({{"patterns", patterns}, {"tracks", tracks}}));
    EXPECT((bool)board::findNode(e->board(), "grid")->getProperty("data")["tracks"][0]["mute"]);
    EXPECT(e->canUndo() == undoBefore);
    run(4);
    EXPECT_NEAR(pOut.out[0][kBlock - 1], 0.0, 1e-6);
    auto live = e->liveState({"grid"})["nodes"]["grid"];
    EXPECT(live.hasProperty("step") && (int)live["playing"] == 0 && (int)live["queued"] == -1 && (int)live["running"] == 1);
    e->unregisterInstance(out);
    e->unregisterInstance(main);
    e->release();
}

/// Drum nodes (doc/specs/modules/ring-drums.md, punch-drums.md) and Noise, run
/// through their jacks: a trigger plays, Velocity scales, Level is last.
void drumNodes() {
    struct Rig {
        std::unique_ptr<Module> m;
        std::vector<std::vector<float>> params, inputs, outputs;
        std::vector<const float*> pp, ip;
        std::vector<float*> op;
        std::unique_ptr<bool[]> connected;
        Transport transport;

        explicit Rig(const std::string& type) : m(Registry::get().create(type)) {
            const auto& s = m->spec();
            params.assign(s.params.size(), std::vector<float>(kChunk));
            inputs.assign(s.inputs.size(), std::vector<float>(kChunk, 0.0f));
            outputs.assign(s.outputs.size(), std::vector<float>(kChunk, 0.0f));
            connected.reset(new bool[s.inputs.size() + 1]());
            for (size_t i = 0; i < s.params.size(); ++i) setParam((int)i, s.params[i].defaultNormalised());
            for (auto& v : params) pp.push_back(v.data());
            for (auto& v : inputs) ip.push_back(v.data());
            for (auto& v : outputs) op.push_back(v.data());
            m->prepare(kRate);
            m->reset();
        }
        void setParam(int i, float normalised) {
            m->setKnob(i, normalised);
            std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), normalised);
        }
        /// Runs `seconds`; input `trig` gets a one-sample pulse at the start. Returns the peak of output 0.
        float run(double seconds, int trig = -1) {
            ProcessContext c;
            c.numSamples = kChunk;
            c.transport = &transport;
            c.params = pp.data();
            c.inputs = ip.data();
            c.inputConnected = connected.get();
            c.outputs = op.data();
            float peak = 0.0f;
            for (int n = 0; n < (int)(seconds * kRate / kChunk); ++n) {
                if (trig >= 0) inputs[(size_t)trig][3] = n == 0 ? 1.0f : 0.0f;
                m->process(c);
                for (float x : outputs[0]) {
                    EXPECT(std::isfinite(x));
                    peak = std::max(peak, std::fabs(x));
                }
            }
            return peak;
        }
    };

    int drums = 0;
    for (const auto* s : Registry::get().all()) {
        if (s->category.rfind("Drums/", 0) != 0) continue;
        g_test = s->type.c_str();
        ++drums;
        const int level = (int)s->params.size() - 1;
        const int velocity = s->inputIndex("velocity");
        EXPECT(s->params[(size_t)level].id == "level");
        EXPECT(velocity == (int)s->inputs.size() - 1);
        EXPECT(s->outputs.size() == 1 && s->outputs[0].type == Signal::Audio);
        for (int t = 0; t < velocity; ++t) {
            Rig rig(s->type);
            EXPECT(rig.run(0.1) == 0.0f);           // silent until triggered
            const float loud = rig.run(0.5, t);
            EXPECT(loud > 0.2f && loud < 1.2f);
            rig.run(10.0);
            EXPECT(rig.run(0.1) < 1e-3f * loud);   // dies away
            // Velocity, sampled at the trigger.
            rig.connected[(size_t)velocity] = true;
            std::fill(rig.inputs[(size_t)velocity].begin(), rig.inputs[(size_t)velocity].end(), 0.25f);
            const float soft = rig.run(0.5, t);
            EXPECT(soft < 0.4f * loud && soft > 0.1f * loud);
            rig.run(10.0);
            // Level scales the output.
            rig.connected[(size_t)velocity] = false;
            rig.setParam(level, 0.0f);
            EXPECT(rig.run(0.5, t) == 0.0f);
        }
    }
    EXPECT(drums == 15);

    g_test = "noise node";
    Rig noise("noise");
    EXPECT(noise.run(0.1) > 0.1f);
    for (size_t o = 1; o < noise.outputs.size(); ++o) {
        float peak = 0.0f;
        for (float x : noise.outputs[o]) peak = std::max(peak, std::fabs(x));
        EXPECT(peak > 0.0f && peak < 2.0f);
    }
    noise.setParam(1, 0.0f);  // Level
    EXPECT(noise.run(0.1) == 0.0f);
    EXPECT(noise.outputs[1][0] != 0.0f);  // the fixed colours ignore Level
}


}  // namespace

void runVoiceTests() {
    voiceCells();
    stepSequencer();
    drumGrid();
    drumNodes();
}
