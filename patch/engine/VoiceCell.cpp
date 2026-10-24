// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "VoiceCell.h"

#include "dsp/Random.h"

#include <algorithm>
#include <cmath>
#include <functional>

namespace bleep::engine {

namespace {
constexpr float kSilence = 3.2e-5f;  // −90 dB
}

VoiceCellModule::VoiceCellModule(ModuleSpec spec, std::shared_ptr<State> state)
    : OwnedSpec{std::move(spec)}, Module(ownedSpec), state_(std::move(state)) {}

std::shared_ptr<VoiceCellModule> VoiceCellModule::create(const BoardModel& board, const NodeModel& node,
                                                         const std::shared_ptr<VoiceCellModule>& previous,
                                                         double sampleRate) {
    // The spec: the registry's settings, the fixed jacks, then the shared jacks (spec §8.3.1).
    const ModuleSpec& base = *Registry::get().find(kVoiceCell);
    ModuleSpec spec = base;
    spec.inputs = {{"notes", "Notes", Signal::Notes}};
    for (const auto& j : node.cellInputs) spec.inputs.push_back({j.id, j.name, j.type});
    spec.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    for (const auto& j : node.cellOutputs) spec.outputs.push_back({j.id, j.name, j.type, true});

    auto state = previous ? previous->state_ : std::make_shared<State>();
    std::shared_ptr<VoiceCellModule> m(new VoiceCellModule(std::move(spec), state));
    m->sampleRate_ = sampleRate;
    m->seed_ = std::hash<std::string>{}(node.id);
    m->sharedIn_.assign(node.cellInputs.size(), {});
    m->numSharedOut_ = node.cellOutputs.size();

    std::string voiceIn, voiceOut;
    for (const auto& n : board.nodes)
        if (n.parent == node.id) {
            if (n.type == kVoiceIn) voiceIn = n.id;
            if (n.type == kVoiceOut) voiceOut = n.id;
        }
    const ModuleSpec& vin = *Registry::get().find(kVoiceIn);
    for (const auto& c : board.cables)
        if (c.to.node == voiceOut && c.to.jack == "active") m->activeTapped_ = true;
    // A source that leaves (unpatched, deleted, muted) never sends its note-offs.
    std::vector<std::string> sources;
    for (const auto& c : board.cables)
        if (c.to.node == node.id && c.to.jack == "notes") {
            const auto* src = board.node(c.from.node);
            sources.push_back(c.from.node + "." + c.from.jack + (src && src->muted ? " muted" : ""));
        }
    std::sort(sources.begin(), sources.end());
    std::string signature;
    for (const auto& s : sources) signature += s + "\n";
    if (signature != state->notesSources) m->releaseAll_ = previous != nullptr;
    state->notesSources = signature;

    for (int v = 0; v < kMaxVoices; ++v) {
        Program::Scope scope;
        scope.root = node.id;
        for (size_t k = 0; k < vin.outputs.size() && k < kNumSignals; ++k)
            scope.external[{voiceIn, vin.outputs[k].id}] = m->signals_[(size_t)v][k].data();
        for (size_t k = 0; k < node.cellInputs.size(); ++k)
            scope.external[{node.id, node.cellInputs[k].id}] = m->sharedIn_[k].data();
        scope.taps = {{voiceOut, "l"}, {voiceOut, "r"}, {voiceOut, "active"}};
        for (const auto& j : node.cellOutputs) scope.taps.push_back({node.id, j.id});  // read from any of the cell's Cell Outs
        m->programs_[(size_t)v] = Program::compile(board, state->modules[(size_t)v], {}, sampleRate, &scope);
    }
    return m;
}

void VoiceCellModule::prepare(double sampleRate) { Module::prepare(sampleRate); }

void VoiceCellModule::reset() {
    for (auto& v : state_->voices) v = Voice{};
    state_->held.clear();
    state_->heldVelocity.clear();
}

void VoiceCellModule::collect(std::map<std::string, std::vector<std::shared_ptr<Module>>>& out) const {
    for (const auto& voiceModules : state_->modules)
        for (const auto& [id, mod] : voiceModules) out[id].push_back(mod);
}

// ---- allocation (spec §8.3.2) ------------------------------------------------------

int VoiceCellModule::pickVoice(int voices, int note) {
    auto& vs = state_->voices;
    const int allocation = (int)setting(Allocation);  // 0 round robin, 1 lowest free, 2 reuse same note
    if (allocation == 2)
        for (int k = 0; k < voices; ++k)
            if (vs[(size_t)k].note == note && (vs[(size_t)k].gate || vs[(size_t)k].sounding)) return k;
    auto free = [&](int k) { return !vs[(size_t)k].gate && !vs[(size_t)k].sounding; };
    if (allocation == 1) {
        for (int k = 0; k < voices; ++k)
            if (free(k)) return k;
    } else {
        for (int i = 0; i < voices; ++i) {
            const int k = (state_->nextVoice + i) % voices;
            if (free(k)) {
                state_->nextVoice = (k + 1) % voices;
                return k;
            }
        }
    }
    // All busy: steal (0 oldest, 1 quietest, 2 lowest, 3 highest, 4 none).
    const int stealing = (int)setting(Stealing);
    if (stealing == 4) return -1;
    int best = 0;
    for (int k = 1; k < voices; ++k) {
        const Voice& a = vs[(size_t)k];
        const Voice& b = vs[(size_t)best];
        const bool better = stealing == 0   ? a.age < b.age
                            : stealing == 1 ? a.peak < b.peak
                            : stealing == 2 ? a.note < b.note
                                            : a.note > b.note;
        if (better) best = k;
    }
    return best;
}

void VoiceCellModule::start(Voice& v, int index, int note, float pitch, float velocity, bool glide) {
    v.retrigger = v.gate;  // a held voice is stolen: its envelopes restart
    v.note = note;
    v.target = pitch;
    if (!glide || !(v.gate || v.sounding)) v.pitch = pitch;
    v.gate = true;
    v.sounding = true;
    v.trigger = true;
    v.velocity = velocity;
    v.release = 0.0f;
    v.pressure = 0.0f;
    v.age = ++state_->counter;
    v.silent = 0;
    v.random = (float)(2.0 * dsp::uniform01(seed_, state_->counter, (uint64_t)index) - 1.0);
    displayVoice_.store(index, std::memory_order_relaxed);
}

void VoiceCellModule::noteOn(const NoteEvent& e, int voices, int mode) {
    const bool glideOn = setting(Glide) > 0.0f;
    const bool legatoOnly = setting(GlideMode) >= 0.5f;
    if (mode != 0) {  // mono / legato: one voice and a note stack
        auto& held = state_->held;
        const bool wasHeld = !held.empty();
        held.push_back(e.note);
        state_->heldVelocity.push_back(e.value);
        Voice& v = state_->voices[0];
        const bool glide = glideOn && (!legatoOnly || wasHeld);
        if (mode == 2 && wasHeld && v.gate) {  // legato: no new attack
            v.note = e.note;
            v.target = e.pitch;
            if (!glide) v.pitch = e.pitch;
            return;
        }
        start(v, 0, e.note, e.pitch, e.value, glide);
        return;
    }
    bool anyHeld = false;
    for (int k = 0; k < voices; ++k) anyHeld |= state_->voices[(size_t)k].gate;
    const int k = pickVoice(voices, e.note);
    if (k < 0) return;  // stealing: none
    start(state_->voices[(size_t)k], k, e.note, e.pitch, e.value, glideOn && (!legatoOnly || anyHeld));
}

void VoiceCellModule::noteOff(const NoteEvent& e, int voices, int mode) {
    if (mode != 0) {
        auto& held = state_->held;
        auto& vel = state_->heldVelocity;
        for (size_t i = held.size(); i-- > 0;)
            if (held[i] == e.note) {
                held.erase(held.begin() + (long)i);
                vel.erase(vel.begin() + (long)i);
            }
        Voice& v = state_->voices[0];
        if (held.empty()) {
            v.gate = false;
            v.release = e.value;
        } else if (v.note == e.note) {  // back to the previous held note, no new attack
            v.note = held.back();
            v.target = (float)(held.back() - 60) / 12.0f;
            if (setting(Glide) <= 0.0f) v.pitch = v.target;
        }
        return;
    }
    for (int k = 0; k < voices; ++k) {
        Voice& v = state_->voices[(size_t)k];
        if (v.gate && v.note == e.note) {
            v.gate = false;
            v.release = e.value;
        }
    }
}

// ---- processing ---------------------------------------------------------------------------

void VoiceCellModule::process(const ProcessContext& c) {
    const int m = c.numSamples;
    const int mode = (int)setting(Mode);  // 0 poly, 1 mono, 2 legato
    const int voices = mode != 0 ? 1 : std::clamp((int)setting(Voices), 1, kMaxVoices);
    const float glideTime = setting(Glide);
    const float glideCoef = glideTime > 0.0f ? 1.0f - (float)std::exp(-1.0 / (glideTime * sampleRate_)) : 1.0f;
    auto& vs = state_->voices;

    if (releaseAll_) {
        releaseAll_ = false;
        for (auto& v : vs) v.gate = false;
        state_->held.clear();
        state_->heldVelocity.clear();
    }

    for (size_t k = 0; k < sharedIn_.size(); ++k) std::copy(c.inputs[1 + k], c.inputs[1 + k] + m, sharedIn_[k].begin());

    // Voice In signals, sample by sample, with the notes at their positions.
    const NoteBuffer* notes = c.notesIn[0];
    int e = 0;
    for (int i = 0; i < m; ++i) {
        while (notes && e < notes->count && notes->events[e].offset <= i) {
            const NoteEvent& ev = notes->events[e++];
            if (ev.type == NoteEvent::On) noteOn(ev, voices, mode);
            else if (ev.type == NoteEvent::Off) noteOff(ev, voices, mode);
            else
                for (int k = 0; k < voices; ++k)
                    if (vs[(size_t)k].note == ev.note) vs[(size_t)k].pressure = ev.value;
        }
        for (int k = 0; k < voices; ++k) {
            Voice& v = vs[(size_t)k];
            auto& s = signals_[(size_t)k];
            v.pitch += (v.target - v.pitch) * glideCoef;
            s[Pitch][(size_t)i] = v.pitch;
            s[Gate][(size_t)i] = v.gate && !v.retrigger ? 1.0f : 0.0f;
            s[Trigger][(size_t)i] = v.trigger ? 1.0f : 0.0f;
            s[Velocity][(size_t)i] = v.velocity;
            s[Release][(size_t)i] = v.release;
            s[Pressure][(size_t)i] = v.pressure;
            s[VoiceNumber][(size_t)i] = (float)k;
            s[Random][(size_t)i] = v.random;
            v.trigger = false;
            v.retrigger = false;
        }
    }

    // Run the voices that play and sum them (spec §8.3.2: spread, compensation).
    for (size_t o = 0; o < spec().outputs.size(); ++o)
        if (c.outputs[o]) std::fill_n(c.outputs[o], m, 0.0f);
    const float spread = setting(Spread);
    const float gain = setting(Output) >= 0.5f ? 1.0f / std::sqrt((float)voices) : 1.0f;
    uint32_t mask = 0;
    ProcessContext inner = c;
    inner.port = nullptr;
    for (int k = 0; k < voices; ++k) {
        Voice& v = vs[(size_t)k];
        if (!v.gate && !v.sounding) continue;  // sleeping voices use no CPU
        Program& p = *programs_[(size_t)k];
        inner.voice = k;
        p.runChunk(inner);
        const float pan = voices > 1 ? spread * (2.0f * (float)k / (float)(voices - 1) - 1.0f) : 0.0f;
        const float angle = (pan + 1.0f) * 0.25f * 3.14159265f;
        const float gl = gain * std::cos(angle) * 1.41421356f, gr = gain * std::sin(angle) * 1.41421356f;
        const auto& tl = p.tap(0);
        const auto& tr = p.tap(1);
        float peak = 0.0f;
        for (int i = 0; i < m; ++i) {
            float l = 0.0f, r = 0.0f;
            for (const auto& src : tl) l += src.buffer[i] * src.amount;
            if (tr.empty()) r = l;
            else
                for (const auto& src : tr) r += src.buffer[i] * src.amount;
            c.outputs[0][i] += l * gl;
            c.outputs[1][i] += r * gr;
            peak = std::max(peak, std::max(std::fabs(l), std::fabs(r)));
        }
        for (size_t o = 0; o < numSharedOut_; ++o)
            for (const auto& src : p.tap(3 + o))
                for (int i = 0; i < m; ++i) c.outputs[2 + o][i] += src.buffer[i] * src.amount;
        v.peak = std::max(peak, v.peak * 0.9f);

        // Is the voice still sounding? Voice Out's Active, or −90 dB for 50 ms.
        if (!v.gate) {
            if (activeTapped_) {
                float active = 0.0f;
                for (const auto& src : p.tap(2)) active += src.buffer[m - 1] * src.amount;
                v.sounding = active >= 0.5f;
            } else {
                v.silent = peak < kSilence ? v.silent + m : 0;
                v.sounding = v.silent < (int)(0.05 * sampleRate_);
            }
        }
        if (v.gate || v.sounding) mask |= 1u << k;
    }
    activeMask_.store(mask, std::memory_order_relaxed);
}

}  // namespace bleep::engine
