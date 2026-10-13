// SPDX-License-Identifier: MIT
#include "Program.h"

#include "VoiceCell.h"

#include <algorithm>
#include <functional>

namespace bleep::engine {

namespace {

bool isStructural(const std::string& type) {
    return type == kCell || type == kCellIn || type == kCellOut || type == kVoiceIn || type == kVoiceOut;
}

bool writesToTrack(PortKind k) {
    return k == PortKind::MidiOut || k == PortKind::AudioOut || k == PortKind::Instrument || k == PortKind::AudioInsert ||
           k == PortKind::AudioBridge;
}

struct Resolved {
    std::string node, jack;
    float amount;
    const float* buffer = nullptr;  ///< an external source (scope)
};

}  // namespace

namespace {

/// An Audio Insert (or Bridge) sends the track's audio into the board and takes it back: one node, so the way
/// through the board would be a cycle with a feedback delay. Split it into the node (the send) and a return node
/// that takes the cables into its inputs, and the audio goes out and back in the same chunk.
bool hasInsert(const BoardModel& b) {
    for (const auto& n : b.nodes)
        if (n.type == "audio-insert" || n.type == "audio-bridge") return true;
    return false;
}

BoardModel splitInserts(const BoardModel& in) {
    BoardModel out = in;
    const ModuleSpec* ret = Registry::get().find(kAudioReturn);
    if (ret == nullptr) return out;
    for (const auto& n : in.nodes) {
        if (n.type != "audio-insert" && n.type != "audio-bridge") continue;
        NodeModel r;
        r.id = n.id + "~r";
        r.type = kAudioReturn;
        r.name = n.name;
        r.port = n.port;
        r.muted = n.muted;
        r.spec = ret;
        out.nodes.push_back(std::move(r));
        for (auto& c : out.cables)
            if (c.to.node == n.id) c.to.node = n.id + "~r";
    }
    return out;
}

}  // namespace

bool hasPatchbays(const BoardModel& board) {
    for (const auto& n : board.nodes)
        if (n.type == kPatchbayIn || n.type == kPatchbayOut) return true;
    return false;
}

BoardModel flattenPatchbays(const BoardModel& in) {
    std::map<std::string, const NodeModel*> byId;
    for (const auto& n : in.nodes) byId[n.id] = &n;
    auto isBay = [&](const std::string& id) {
        auto it = byId.find(id);
        return it != byId.end() && (it->second->type == kPatchbayIn || it->second->type == kPatchbayOut);
    };
    auto typeOf = [&](const std::string& id) {
        auto it = byId.find(id);
        return it == byId.end() ? std::string() : it->second->type;
    };
    // The Patch Bay In whose bundle arrives at (node, jack): over cell outputs and inputs, however deep.
    std::function<const NodeModel*(const std::string&, const std::string&, int)> bundleSource;
    bundleSource = [&](const std::string& node, const std::string& jack, int depth) -> const NodeModel* {
        if (depth > 64) return nullptr;
        for (const auto& c : in.cables) {
            if (c.to.node != node || c.to.jack != jack) continue;
            const std::string& from = c.from.node;
            const std::string t = typeOf(from);
            if (t == kPatchbayIn) return byId[from];
            if (t == kCell) {  // out of a cell: the cable into the same jack of its Cell Out
                for (const auto& n : in.nodes)
                    if (n.type == kCellOut && n.parent == from)
                        if (const NodeModel* r = bundleSource(n.id, c.from.jack, depth + 1)) return r;
            } else if (t == kCellIn) {  // into a cell: the cable into that jack of the cell
                const NodeModel* cell = byId.count(byId[from]->parent) ? byId[byId[from]->parent] : nullptr;
                if (cell)
                    if (const NodeModel* r = bundleSource(cell->id, c.from.jack, depth + 1)) return r;
            }
        }
        return nullptr;
    };
    struct Source {
        Endpoint from;
        float amount;
    };
    // What feeds channel `jack` of a Patch Bay Out: the real outputs behind it (bays chain).
    std::function<void(const std::string&, const std::string&, float, int, std::vector<Source>&)> channelSources;
    channelSources = [&](const std::string& bayOut, const std::string& jack, float scale, int depth, std::vector<Source>& out) {
        if (depth > 16) return;
        const NodeModel* bayIn = bundleSource(bayOut, "bundle", 0);
        if (!bayIn) return;
        for (const auto& c : in.cables) {
            if (c.to.node != bayIn->id || c.to.jack != jack) continue;
            if (typeOf(c.from.node) == kPatchbayOut) channelSources(c.from.node, c.from.jack, scale * c.amount, depth + 1, out);
            else out.push_back({c.from, scale * c.amount});
        }
    };
    // The Voice Cell a node is in ("" for none): signals reach its voices only through its shared inputs.
    auto voiceOf = [&](const std::string& id) {
        auto it = byId.find(id);
        std::string p = it == byId.end() ? std::string() : it->second->parent;
        for (int depth = 0; !p.empty() && depth < 64; ++depth) {
            auto q = byId.find(p);
            if (q == byId.end()) break;
            if (q->second->type == kVoiceCell) return p;
            p = q->second->parent;
        }
        return std::string();
    };
    BoardModel out;
    out.id = in.id;
    for (const auto& n : in.nodes)
        if (!isBay(n.id)) {
            out.nodes.push_back(n);
            auto& jacks = out.nodes.back();   // bundles are not signals: a cell's patchbay jacks go with the bundle cables
            auto drop = [](std::vector<CellJack>& list) {
                list.erase(std::remove_if(list.begin(), list.end(), [](const CellJack& j) { return j.type == Signal::Patchbay; }), list.end());
            };
            drop(jacks.cellInputs);
            drop(jacks.cellOutputs);
        }
    auto outNode = [&](const std::string& id) -> NodeModel* {
        for (auto& n : out.nodes)
            if (n.id == id) return &n;
        return nullptr;
    };
    Signal t{};
    for (const auto& c : in.cables) {
        if (isBay(c.to.node)) continue;
        if (typeOf(c.from.node) == kPatchbayOut) {
            std::vector<Source> sources;
            channelSources(c.from.node, c.from.jack, 1.0f, 0, sources);
            int k = 0;
            for (const auto& s : sources) {
                const std::string dstVoice = voiceOf(c.to.node), srcVoice = voiceOf(s.from.node);
                if (dstVoice == srcVoice) {
                    CableModel nc;
                    nc.id = c.id + "~" + std::to_string(k++);
                    nc.from = s.from;
                    nc.to = c.to;
                    nc.amount = s.amount * c.amount;
                    out.cables.push_back(std::move(nc));
                } else if (!dstVoice.empty() && srcVoice.empty()) {
                    // Into a Voice Cell: the channel becomes a shared input of the cell, and inside, its Cell In feeds the knob.
                    NodeModel* voiceCell = outNode(dstVoice);
                    const NodeModel* cellIn = nullptr;
                    for (const auto& n : out.nodes)
                        if (n.type == kCellIn && n.parent == dstVoice) cellIn = &n;
                    if (!voiceCell || !cellIn) continue;
                    const std::string jack = "bay~" + c.id + "~" + std::to_string(k++);
                    voiceCell->cellInputs.push_back({jack, jack, Signal::Control});
                    CableModel into, inside;
                    into.id = c.id + "~in" + jack;
                    into.from = s.from;
                    into.to = {dstVoice, jack};
                    into.amount = s.amount;
                    inside.id = c.id + "~out" + jack;
                    inside.from = {cellIn->id, jack};
                    inside.to = c.to;
                    inside.amount = c.amount;
                    out.cables.push_back(std::move(into));
                    out.cables.push_back(std::move(inside));
                }   // out of a Voice Cell: its voices have no output to a bay's channel
            }
            continue;
        }
        const NodeModel* src = byId.count(c.from.node) ? byId[c.from.node] : nullptr;
        if (src && in.outputType(*src, c.from.jack, t) && t == Signal::Patchbay) continue;  // a bundle between cells
        out.cables.push_back(c);
    }
    return out;
}

std::unique_ptr<Program> Program::compile(const BoardModel& boardIn,
                                          std::map<std::string, std::shared_ptr<Module>>& modules,
                                          const std::map<std::string, std::shared_ptr<PortSlot>>& ports,
                                          double sampleRate, const Scope* scope) {
    auto program = std::make_unique<Program>();
    const std::string root = scope ? scope->root : std::string();
    program->sampleRate_ = sampleRate;
    const auto& reg = Registry::get();
    BoardModel flat;
    if (hasPatchbays(boardIn)) flat = flattenPatchbays(boardIn);
    const BoardModel& bayless = hasPatchbays(boardIn) ? flat : boardIn;
    BoardModel split;
    if (hasInsert(bayless)) split = splitInserts(bayless);
    const BoardModel& board = hasInsert(bayless) ? split : bayless;

    std::map<std::string, const NodeModel*> byId;
    std::map<std::string, std::vector<const NodeModel*>> cellOutOf;  // cell id → its Cell Out nodes
    for (const auto& n : board.nodes) {
        byId[n.id] = &n;
        if (n.type == kCellOut) cellOutOf[n.parent].push_back(&n);
    }
    std::multimap<std::pair<std::string, std::string>, const CableModel*> into;
    for (const auto& c : board.cables) into.emplace(std::make_pair(c.to.node, c.to.jack), &c);

    // The Voice Cell a node belongs to ("" for none): its scope.
    auto voiceRoot = [&](const NodeModel& n) {
        std::string p = n.parent;
        for (int depth = 0; !p.empty() && depth < 64; ++depth) {
            auto it = byId.find(p);
            if (it == byId.end()) break;
            if (it->second->type == kVoiceCell) return p;
            p = it->second->parent;
        }
        return std::string();
    };
    auto isReal = [&](const NodeModel& n) {
        return n.spec != nullptr && !isStructural(n.type) && !n.muted && voiceRoot(n) == root;
    };
    auto external = [&](const std::string& node, const std::string& jack) -> const float* {
        if (!scope) return nullptr;
        auto it = scope->external.find({node, jack});
        return it != scope->external.end() ? it->second : nullptr;
    };

    // Follows cables back to real outputs, through cell jacks (spec §8.1).
    std::function<void(const std::string&, const std::string&, float, int, std::vector<Resolved>&)> resolveInto;
    resolveInto = [&](const std::string& node, const std::string& jack, float scale, int depth,
                      std::vector<Resolved>& out) {
        if (depth > 64) return;
        auto range = into.equal_range({node, jack});
        for (auto it = range.first; it != range.second; ++it) {
            const CableModel& c = *it->second;
            auto s = byId.find(c.from.node);
            if (s == byId.end()) continue;
            const NodeModel& src = *s->second;
            const float amount = scale * c.amount;
            if (src.type == kVoiceIn || (src.type == kCellIn && scope && src.parent == root)) {
                if (const float* b = external(src.type == kVoiceIn ? src.id : root, c.from.jack))
                    out.push_back({src.id, c.from.jack, amount, b});
            } else if (src.type == kCellIn) {
                resolveInto(src.parent, c.from.jack, amount, depth + 1, out);
            } else if (src.type == kCell) {
                if (auto co = cellOutOf.find(src.id); co != cellOutOf.end())
                    for (const NodeModel* o : co->second) resolveInto(o->id, c.from.jack, amount, depth + 1, out);
            } else if (isReal(src)) {
                out.push_back({src.id, c.from.jack, amount});
            }
        }
    };

    // An input jack's sources; an unpatched input follows its normal (JackSpec::normal).
    auto resolveInput = [&](const NodeModel& n, const ModuleSpec& spec, size_t jack, std::vector<Resolved>& out) {
        std::string id = spec.inputs[jack].id;
        for (int hop = 0; hop < 8; ++hop) {
            const size_t before = out.size();
            resolveInto(n.id, id, 1.0f, 0, out);
            if (out.size() != before) return;
            const int j = spec.inputIndex(id);
            if (j < 0 || spec.inputs[(size_t)j].normal.empty()) return;
            id = spec.inputs[(size_t)j].normal;
        }
    };

    // Real nodes and their dependencies.
    std::vector<const NodeModel*> real;
    std::map<std::string, std::vector<std::string>> deps;
    for (const auto& n : board.nodes) {
        if (!isReal(n)) continue;
        real.push_back(&n);
        std::vector<Resolved> found;
        for (const auto& p : n.spec->params)
            if (p.drivable()) resolveInto(n.id, p.id, 1.0f, 0, found);
        for (size_t j = 0; j < n.spec->inputs.size(); ++j) resolveInput(n, *n.spec, j, found);
        if (n.type == kVoiceCell) {  // its jacks are on the node, not in the registry spec
            for (const auto& j : n.cellInputs) resolveInto(n.id, j.id, 1.0f, 0, found);
            resolveInto(n.id, "notes", 1.0f, 0, found);
        }
        auto& d = deps[n.id];
        for (const auto& r : found)
            if (!r.buffer && std::find(d.begin(), d.end(), r.node) == d.end()) d.push_back(r.node);
    }
    // The harmony bus: every writer runs before every reader (doc/specs/modules/harmony-master.md §7).
    for (const auto* r : real)
        if (r->spec->harmony == HarmonyRole::Reader)
            for (const auto* w : real)
                if (w->spec->harmony == HarmonyRole::Writer) {
                    auto& d = deps[r->id];
                    if (std::find(d.begin(), d.end(), w->id) == d.end()) d.push_back(w->id);
                }

    // Topological order; an edge back into the current path is feedback.
    std::vector<const NodeModel*> order;
    std::map<std::string, int> mark;  // 1 = on the path, 2 = done
    std::function<void(const NodeModel&)> visit = [&](const NodeModel& n) {
        mark[n.id] = 1;
        for (const auto& s : deps[n.id]) {
            const int m = mark[s];
            if (m == 1) {
                program->feedback_.insert(s + "→" + n.id);
                continue;
            }
            if (m == 0) visit(*byId[s]);
        }
        mark[n.id] = 2;
        order.push_back(&n);
    };
    for (const auto* n : real)
        if (mark[n->id] == 0) visit(*n);

    // Modules: reuse by id and type, create the rest, drop the removed.
    std::map<std::string, std::shared_ptr<Module>> kept;
    for (const auto* n : order) {
        std::shared_ptr<Module> m;
        if (auto it = modules.find(n->id); it != modules.end() && it->second->spec().type == n->type) m = it->second;
        if (n->type == kVoiceCell) {
            // Always rebuilt (its inside may have changed); its voices keep their state.
            m = VoiceCellModule::create(board, *n, std::dynamic_pointer_cast<VoiceCellModule>(m), sampleRate);
        } else if (!m) {
            m = std::shared_ptr<Module>(reg.create(n->type).release());
            if (!m) continue;
            m->prepare(sampleRate);
            m->reset();
        }
        for (size_t i = 0; i < n->spec->params.size(); ++i) {
            auto v = n->params.find(n->spec->params[i].id);
            m->setKnob((int)i, v != n->params.end() ? v->second : n->spec->params[i].defaultNormalised());
        }
        if (n->spec->sanitiseData) m->setData(n->data);
        kept[n->id] = m;
    }
    // Muted and structural nodes keep their state while they exist.
    for (const auto& n : board.nodes)
        if (kept.count(n.id) == 0)
            if (auto it = modules.find(n.id); it != modules.end() && it->second->spec().type == n.type)
                kept[n.id] = it->second;
    modules = kept;

    // Steps with their output buffers first, so inputs can point at them.
    std::map<std::pair<std::string, std::string>, float*> outBuf;
    std::map<std::pair<std::string, std::string>, NoteBuffer*> outNotes;
    for (const auto* n : order) {
        auto mod = modules.find(n->id);
        if (mod == modules.end()) continue;
        Step st;
        st.nodeId = n->id;
        st.module = mod->second;
        const ModuleSpec& spec = st.module->spec();  // a Voice Cell's spec carries its own jacks
        for (const auto& o : spec.outputs) {
            if (o.type == Signal::Notes) {
                st.noteOutputs.push_back(std::make_unique<NoteBuffer>());
                st.outputBuffers.push_back(nullptr);
                outNotes[{n->id, o.id}] = st.noteOutputs.back().get();
            } else {
                st.outputBuffers.push_back(std::make_unique<float[]>(kChunk));
                std::fill_n(st.outputBuffers.back().get(), kChunk, 0.0f);
                st.noteOutputs.push_back(nullptr);
                outBuf[{n->id, o.id}] = st.outputBuffers.back().get();
            }
        }
        if (spec.port != PortKind::None) {
            if (auto p = ports.find(n->port); p != ports.end() && p->second) {
                st.port = p->second;
                st.portWritesOut = writesToTrack(spec.port);
                if (std::find(program->slots_.begin(), program->slots_.end(), st.port) == program->slots_.end())
                    program->slots_.push_back(st.port);
            }
        }
        if (n->bypassed && spec.port == PortKind::None) {
            std::vector<int> ins, outs;
            for (size_t j = 0; j < spec.inputs.size(); ++j)
                if (spec.inputs[j].type == Signal::Audio) ins.push_back((int)j);
            for (size_t k = 0; k < spec.outputs.size(); ++k)
                if (spec.outputs[k].type == Signal::Audio) outs.push_back((int)k);
            if (!ins.empty() && !outs.empty()) {
                st.bypassed = true;
                for (size_t k = 0; k < outs.size(); ++k) st.bypassRoute.emplace_back(ins[std::min(k, ins.size() - 1)], outs[k]);
            }
        }
        program->steps_.push_back(std::move(st));
    }

    for (auto& st : program->steps_) {
        const NodeModel& n = *byId[st.nodeId];
        const ModuleSpec& spec = st.module->spec();
        for (const auto& p : spec.params) {
            st.paramBuffers.push_back(std::make_unique<float[]>(kChunk));
            std::vector<Source> sources;
            if (p.drivable()) {
                std::vector<Resolved> found;
                resolveInto(n.id, p.id, 1.0f, 0, found);
                for (const auto& r : found)
                    if (r.buffer) sources.push_back({r.buffer, r.amount});
                    else if (auto b = outBuf.find({r.node, r.jack}); b != outBuf.end()) sources.push_back({b->second, r.amount});
            }
            st.paramSources.push_back(std::move(sources));
        }
        st.connected = std::make_unique<bool[]>(spec.inputs.size() + 1);
        for (size_t j = 0; j < spec.inputs.size(); ++j) {
            std::vector<Resolved> found;
            resolveInto(n.id, spec.inputs[j].id, 1.0f, 0, found);
            const bool patched = !found.empty();
            if (!patched) resolveInput(n, spec, j, found);  // normalled to another input
            std::vector<Source> sources;
            std::vector<const NoteBuffer*> notes;
            if (spec.inputs[j].type == Signal::Notes) {
                for (const auto& r : found)
                    if (auto b = outNotes.find({r.node, r.jack}); b != outNotes.end()) notes.push_back(b->second);
                st.noteInputs.push_back(std::make_unique<NoteBuffer>());
                st.inputBuffers.push_back(nullptr);
            } else {
                for (const auto& r : found)
                    if (r.buffer) sources.push_back({r.buffer, r.amount});
                    else if (auto b = outBuf.find({r.node, r.jack}); b != outBuf.end()) sources.push_back({b->second, r.amount});
                st.inputBuffers.push_back(std::make_unique<float[]>(kChunk));
                std::fill_n(st.inputBuffers.back().get(), kChunk, 0.0f);
                st.noteInputs.push_back(nullptr);
            }
            st.connected[j] = patched && (!sources.empty() || !notes.empty());
            st.inputSources.push_back(std::move(sources));
            st.noteSources.push_back(std::move(notes));
        }
        for (auto& b : st.paramBuffers) st.paramPtrs.push_back(b.get());
        for (auto& b : st.inputBuffers) st.inputPtrs.push_back(b.get());
        for (auto& b : st.noteInputs) st.notesInPtrs.push_back(b.get());
        for (auto& b : st.outputBuffers) st.outputPtrs.push_back(b.get());
        for (auto& b : st.noteOutputs) st.notesOutPtrs.push_back(b.get());
        st.io.slot = st.port.get();
    }

    // Taps: what feeds Voice Out and the cell's shared outputs, per voice.
    if (scope)
        for (const auto& t : scope->taps) {
            std::vector<Resolved> found;
            if (auto co = cellOutOf.find(t.node); co != cellOutOf.end())  // a cell's shared output: any of its Cell Outs
                for (const NodeModel* o : co->second) resolveInto(o->id, t.jack, 1.0f, 0, found);
            else
                resolveInto(t.node, t.jack, 1.0f, 0, found);
            std::vector<Source> sources;
            for (const auto& r : found)
                if (r.buffer) sources.push_back({r.buffer, r.amount});
                else if (auto b = outBuf.find({r.node, r.jack}); b != outBuf.end()) sources.push_back({b->second, r.amount});
            program->taps_.push_back(std::move(sources));
        }

    // Which outputs something reads (ProcessContext::outputConnected).
    std::set<const void*> read;
    for (const auto& st : program->steps_) {
        for (const auto& list : st.paramSources)
            for (const auto& s : list) read.insert(s.buffer);
        for (const auto& list : st.inputSources)
            for (const auto& s : list) read.insert(s.buffer);
        for (const auto& list : st.noteSources)
            for (const NoteBuffer* b : list) read.insert(b);
    }
    for (const auto& list : program->taps_)
        for (const auto& s : list) read.insert(s.buffer);
    for (auto& st : program->steps_) {
        st.outConnected = std::make_unique<bool[]>(st.outputBuffers.size() + 1);
        for (size_t k = 0; k < st.outputBuffers.size(); ++k)
            st.outConnected[k] = st.outputBuffers[k] ? read.count(st.outputBuffers[k].get()) > 0
                                                     : read.count(st.noteOutputs[k].get()) > 0;
    }
    return program;
}

void Program::run(const Transport& t, int numSamples, bool transportStarted) noexcept {
    const int n = std::min(numSamples, kMaxHostBlock);
    const double ppqPerSample = t.bpm / 60.0 / std::max(t.sampleRate, 1.0);
    for (int off = 0; off < n; off += kChunk) {
        ProcessContext ctx;
        ctx.numSamples = std::min(kChunk, n - off);
        ctx.offset = off;
        ctx.transport = &t;
        ctx.transportStarted = transportStarted && off == 0;
        ctx.ppqStart = t.ppq + ppqPerSample * off;
        ctx.ppqPerSample = ppqPerSample;
        runChunk(ctx);
    }
}

void Program::runChunk(const ProcessContext& chunk) noexcept {
    ProcessContext ctx = chunk;
    if (!ctx.harmony) ctx.harmony = harmony_.data();  // a Voice Cell's inside shares the board's buses
    const int m = ctx.numSamples;
    {
        for (auto& st : steps_) {
            Module& mod = *st.module;
            for (size_t i = 0; i < st.paramBuffers.size(); ++i) {
                float* buf = st.paramBuffers[i].get();
                const float base = mod.knob((int)i);
                const auto& sources = st.paramSources[i];
                if (sources.empty()) {
                    std::fill_n(buf, m, base);
                } else {
                    for (int s = 0; s < m; ++s) {
                        float v = base;
                        for (const auto& src : sources) v += src.buffer[s] * src.amount;
                        buf[s] = v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
                    }
                }
                if (mod.spec().params[i].cableable) mod.setDriven((int)i, sources.empty() ? -1.0f : buf[0]);   // a setting is read once per block
                auto& d = mod.paramDisplay((int)i);
                d.value.store(buf[m - 1], std::memory_order_relaxed);
                d.active.store(!sources.empty(), std::memory_order_relaxed);
            }
            for (size_t j = 0; j < st.inputSources.size(); ++j) {
                if (NoteBuffer* nb = st.noteInputs[j].get()) {
                    nb->clear();
                    for (const NoteBuffer* src : st.noteSources[j])
                        for (int k = 0; k < src->count; ++k) nb->push(src->events[k]);
                    std::stable_sort(nb->events, nb->events + nb->count,
                                     [](const NoteEvent& a, const NoteEvent& b) { return a.offset < b.offset; });
                    continue;
                }
                float* buf = st.inputBuffers[j].get();
                const auto& sources = st.inputSources[j];
                if (sources.empty()) {
                    std::fill_n(buf, m, 0.0f);
                    continue;
                }
                const Source& first = sources[0];
                for (int s = 0; s < m; ++s) buf[s] = first.buffer[s] * first.amount;
                for (size_t k = 1; k < sources.size(); ++k)
                    for (int s = 0; s < m; ++s) buf[s] += sources[k].buffer[s] * sources[k].amount;
            }
            for (auto& nb : st.noteOutputs)
                if (nb) nb->clear();

            ctx.params = st.paramPtrs.data();
            ctx.inputs = st.inputPtrs.data();
            ctx.inputConnected = st.connected.get();
            ctx.notesIn = st.notesInPtrs.data();
            ctx.outputs = st.outputPtrs.data();
            ctx.notesOut = st.notesOutPtrs.data();
            ctx.outputConnected = st.outConnected.get();
            ctx.port = st.port ? &st.io : nullptr;
            if (st.bypassed) {
                for (auto& ob : st.outputBuffers)
                    if (ob) std::fill_n(ob.get(), m, 0.0f);
                for (const auto& [in, out] : st.bypassRoute)
                    std::copy_n(st.inputPtrs[in], m, st.outputBuffers[out].get());
            } else {
                mod.process(ctx);
            }

            for (size_t k = 0; k < st.outputBuffers.size(); ++k) {
                auto& d = mod.outputDisplay((int)k);
                if (const float* b = st.outputBuffers[k].get()) {
                    d.value.store(b[m - 1], std::memory_order_relaxed);
                    float lo = d.lo.load(std::memory_order_relaxed), hi = d.hi.load(std::memory_order_relaxed);
                    for (int s = 0; s < m; ++s) {
                        lo = std::min(lo, b[s]);
                        hi = std::max(hi, b[s]);
                    }
                    d.lo.store(lo, std::memory_order_relaxed);
                    d.hi.store(hi, std::memory_order_relaxed);
                } else if (const NoteBuffer* nb = st.noteOutputs[k].get(); nb && nb->count > 0) {
                    d.value.store(1.0f, std::memory_order_relaxed);
                    d.lo.store(0.0f, std::memory_order_relaxed);
                    d.hi.store(1.0f, std::memory_order_relaxed);
                }
            }
        }
    }
}

}  // namespace bleep::engine
