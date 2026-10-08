// SPDX-License-Identifier: MIT
#include "Program.h"

#include <algorithm>
#include <functional>

namespace bleep::engine {

namespace {

bool isStructural(const std::string& type) { return type == kCell || type == kCellIn || type == kCellOut; }

bool writesToTrack(PortKind k) {
    return k == PortKind::MidiOut || k == PortKind::AudioOut || k == PortKind::Instrument || k == PortKind::AudioInsert ||
           k == PortKind::AudioBridge;
}

struct Resolved {
    std::string node, jack;
    float amount;
};

}  // namespace

std::unique_ptr<Program> Program::compile(const BoardModel& board,
                                          std::map<std::string, std::shared_ptr<Module>>& modules,
                                          const std::map<std::string, std::shared_ptr<PortSlot>>& ports,
                                          double sampleRate) {
    auto program = std::make_unique<Program>();
    program->sampleRate_ = sampleRate;
    const auto& reg = Registry::get();

    std::map<std::string, const NodeModel*> byId;
    std::map<std::string, const NodeModel*> cellOutOf;  // cell id → its Cell Out node
    for (const auto& n : board.nodes) {
        byId[n.id] = &n;
        if (n.type == kCellOut) cellOutOf[n.parent] = &n;
    }
    std::multimap<std::pair<std::string, std::string>, const CableModel*> into;
    for (const auto& c : board.cables) into.emplace(std::make_pair(c.to.node, c.to.jack), &c);

    auto isReal = [](const NodeModel& n) { return n.spec != nullptr && !isStructural(n.type) && !n.muted; };

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
            if (src.type == kCellIn) {
                resolveInto(src.parent, c.from.jack, amount, depth + 1, out);
            } else if (src.type == kCell) {
                if (auto co = cellOutOf.find(src.id); co != cellOutOf.end())
                    resolveInto(co->second->id, c.from.jack, amount, depth + 1, out);
            } else if (isReal(src)) {
                out.push_back({src.id, c.from.jack, amount});
            }
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
            if (p.modulatable) resolveInto(n.id, p.id, 1.0f, 0, found);
        for (const auto& j : n.spec->inputs) resolveInto(n.id, j.id, 1.0f, 0, found);
        auto& d = deps[n.id];
        for (const auto& r : found)
            if (std::find(d.begin(), d.end(), r.node) == d.end()) d.push_back(r.node);
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
        if (!m) {
            m = std::shared_ptr<Module>(reg.create(n->type).release());
            if (!m) continue;
            m->prepare(sampleRate);
            m->reset();
        }
        for (size_t i = 0; i < n->spec->params.size(); ++i) {
            auto v = n->params.find(n->spec->params[i].id);
            m->setKnob((int)i, v != n->params.end() ? v->second : n->spec->params[i].defaultNormalised());
        }
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
        const ModuleSpec& spec = *n->spec;
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
        program->steps_.push_back(std::move(st));
    }

    for (auto& st : program->steps_) {
        const NodeModel& n = *byId[st.nodeId];
        const ModuleSpec& spec = *n.spec;
        for (const auto& p : spec.params) {
            st.paramBuffers.push_back(std::make_unique<float[]>(kChunk));
            std::vector<Source> sources;
            if (p.modulatable) {
                std::vector<Resolved> found;
                resolveInto(n.id, p.id, 1.0f, 0, found);
                for (const auto& r : found)
                    if (auto b = outBuf.find({r.node, r.jack}); b != outBuf.end()) sources.push_back({b->second, r.amount});
            }
            st.paramSources.push_back(std::move(sources));
        }
        st.connected = std::make_unique<bool[]>(spec.inputs.size() + 1);
        for (size_t j = 0; j < spec.inputs.size(); ++j) {
            std::vector<Resolved> found;
            resolveInto(n.id, spec.inputs[j].id, 1.0f, 0, found);
            std::vector<Source> sources;
            std::vector<const NoteBuffer*> notes;
            if (spec.inputs[j].type == Signal::Notes) {
                for (const auto& r : found)
                    if (auto b = outNotes.find({r.node, r.jack}); b != outNotes.end()) notes.push_back(b->second);
                st.noteInputs.push_back(std::make_unique<NoteBuffer>());
                st.inputBuffers.push_back(nullptr);
            } else {
                for (const auto& r : found)
                    if (auto b = outBuf.find({r.node, r.jack}); b != outBuf.end()) sources.push_back({b->second, r.amount});
                st.inputBuffers.push_back(std::make_unique<float[]>(kChunk));
                std::fill_n(st.inputBuffers.back().get(), kChunk, 0.0f);
                st.noteInputs.push_back(nullptr);
            }
            st.connected[j] = !sources.empty() || !notes.empty();
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
    return program;
}

void Program::run(const Transport& t, int numSamples, bool transportStarted) noexcept {
    const int n = std::min(numSamples, kMaxHostBlock);
    const double ppqPerSample = t.bpm / 60.0 / std::max(t.sampleRate, 1.0);
    for (int off = 0; off < n; off += kChunk) {
        const int m = std::min(kChunk, n - off);
        ProcessContext ctx;
        ctx.numSamples = m;
        ctx.offset = off;
        ctx.transport = &t;
        ctx.transportStarted = transportStarted && off == 0;
        ctx.ppqStart = t.ppq + ppqPerSample * off;
        ctx.ppqPerSample = ppqPerSample;

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
            ctx.port = st.port ? &st.io : nullptr;
            mod.process(ctx);

            for (size_t k = 0; k < st.outputBuffers.size(); ++k) {
                auto& d = mod.outputDisplay((int)k);
                if (const float* b = st.outputBuffers[k].get()) {
                    d.value.store(b[m - 1], std::memory_order_relaxed);
                } else if (const NoteBuffer* nb = st.noteOutputs[k].get(); nb && nb->count > 0) {
                    d.value.store(1.0f, std::memory_order_relaxed);
                }
            }
        }
    }
}

}  // namespace bleep::engine
