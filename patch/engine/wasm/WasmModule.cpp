// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "WasmModule.h"

#include "HostControl.h"
#include "Media.h"
#include "dsp/Harmony.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <condition_variable>
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <set>
#include <thread>

namespace bleep::engine {
namespace {

static_assert(kChunk == 32, "the module ABI's chunk (bleep_chunk(), module-abi.md section 5) is the engine's");
constexpr size_t kSnapshotReserve = 1 << 20;   // live values and data are copied into buffers of this size: no allocation on the audio thread
constexpr int kAudioBudgetMs = 100;            // one call into the module on the audio thread: a module that takes longer is stopped and bypassed
constexpr int kSnapshotEvery = 2048;           // samples between two looks at what the view asked for

std::string cString(wasm::Instance& inst, uint32_t ptr) {
    const uint8_t* mem = inst.memory();
    const size_t size = inst.memorySize();
    std::string out;
    for (size_t p = ptr; p < size && mem[p] && out.size() < 4096; ++p) out += (char)mem[p];
    return out;
}

// ---- sample files for modules (module-abi.md, "Media") -------------------------------------------------------------
//
// A module asks for a clip by id while it is inside bleep_set_data, on the audio thread, and may not wait for the disk.
// The service reads the file on a worker thread; until it is there the module is told "not available", and when it
// arrives the modules that asked are told to send their node data again, which makes them ask again and succeed.

class MediaService {
public:
    static MediaService& get() {
        static MediaService service;
        return service;
    }

    ~MediaService() {
        {
            std::lock_guard<std::mutex> l(mutex_);
            stop_ = true;
        }
        wake_.notify_one();
        worker_.join();
    }

    /// The clip if it is in memory. Otherwise: queues a request for the worker (one thread, a small fixed queue; a request that
    /// does not fit is dropped and comes again with the next ask), remembers that `who` wants it, returns null.
    /// Nothing here allocates: the queue is a fixed array.
    std::shared_ptr<const MediaClip> find(const std::string& id, void* who) {
        if (!media::validId(id)) return nullptr;  // a module can ask for any string
        std::unique_lock<std::mutex> lock(mutex_, std::try_to_lock);
        if (!lock.owns_lock()) return nullptr;  // a worker is storing a clip: ask again with the next data
        if (auto it = cache_.find(id); it != cache_.end()) return it->second;
        if (failed_.count(id)) return nullptr;
        for (size_t i = 0; i < queued_; ++i)
            if (queue_[i].who == who && id == queue_[i].id) return nullptr;  // already asked
        if (queued_ < kQueue && id.size() < sizeof queue_[0].id) {
            Request& r = queue_[queued_++];
            std::memcpy(r.id, id.c_str(), id.size() + 1);
            r.who = who;
            wake_.notify_one();
        }
        return nullptr;
    }

    void listen(void* who, std::function<void()> onClipArrived) {
        std::lock_guard<std::mutex> l(mutex_);
        listeners_[who] = std::move(onClipArrived);
    }
    void forget(void* who) {
        std::lock_guard<std::mutex> l(mutex_);
        listeners_.erase(who);
        for (auto& [id, set] : wants_) set.erase(who);
        for (size_t i = 0; i < queued_;)  // its requests go too
            if (queue_[i].who == who) { queue_[i] = queue_[--queued_]; } else ++i;
    }

private:
    static constexpr size_t kQueue = 8;          // requests waiting for the worker
    static constexpr size_t kMaxFailed = 256;    // ids that could not be loaded; beyond that the list starts over
    struct Request { char id[32]; void* who; };

    MediaService() : worker_([this] { run(); }) {}

    void run() {
        std::unique_lock<std::mutex> lock(mutex_);
        for (;;) {
            wake_.wait(lock, [this] { return stop_ || queued_ > 0; });
            if (stop_) return;
            const Request r = queue_[0];
            queue_[0] = queue_[--queued_];
            const std::string id = r.id;
            std::vector<std::function<void()>> notify;
            if (cache_.count(id)) {
                if (auto l = listeners_.find(r.who); l != listeners_.end()) l->second();  // it came while the request waited
                continue;
            }
            if (failed_.count(id)) continue;
            wants_[id].insert(r.who);
            lock.unlock();
            auto clip = media::load(id);  // the media folder, on this worker thread
            lock.lock();
            if (clip) {
                cache_[id] = clip;
                order_.push_back(id);
                while (order_.size() > 16) { cache_.erase(order_.front()); order_.pop_front(); }  // clips live on in the modules that copied them
            } else {
                if (failed_.size() >= kMaxFailed) failed_.clear();
                failed_.insert(id);
            }
            for (void* who : wants_[id])
                if (auto l2 = listeners_.find(who); l2 != listeners_.end()) notify.push_back(l2->second);
            wants_.erase(id);
            for (auto& f : notify) f();  // under the lock: a module cannot go away while it is told
        }
    }

    std::mutex mutex_;
    std::condition_variable wake_;
    bool stop_ = false;
    Request queue_[kQueue];
    size_t queued_ = 0;
    std::map<std::string, std::shared_ptr<const MediaClip>> cache_;
    std::deque<std::string> order_;
    std::set<std::string> failed_;
    std::map<std::string, std::set<void*>> wants_;
    std::map<void*, std::function<void()>> listeners_;
    std::thread worker_;  // last: starts running when everything above exists
};

}  // namespace

class WasmModule::Media final : public wasm::MediaHandler {
public:
    explicit Media(WasmModule& owner) : owner_(owner) {}
    int64_t info(const std::string& id, double& rate, int32_t& channels) override {
        const auto clip = MediaService::get().find(id, &owner_);
        if (!clip) return 0;
        rate = clip->sampleRate;
        channels = clip->numChannels();
        return clip->numFrames();
    }
    bool read(const std::string& id, int32_t channel, float* dst, int64_t frames) override {
        const auto clip = MediaService::get().find(id, &owner_);
        if (!clip || channel < 0 || channel >= clip->numChannels() || frames > clip->numFrames()) return false;
        std::memcpy(dst, clip->channels[(size_t)channel].data(), (size_t)frames * sizeof(float));
        return true;
    }

private:
    WasmModule& owner_;
};

// ---- WasmPackage --------------------------------------------------------------------------------------

int WasmPackage::indexOf(const std::string& type) const {
    for (size_t i = 0; i < types.size(); ++i)
        if (types[i] == type) return (int)i;
    return -1;
}

bool WasmPackage::retype(const std::string& type) {
    if (types.size() != 1 || type.empty()) return false;
    juce::var specs = juce::JSON::parse(juce::String(specJson));
    if (!specs.isArray() || specs.size() != 1) return false;
    if (auto* o = specs[0].getDynamicObject()) o->setProperty("type", juce::String(type));
    else return false;
    types[0] = type;
    specJson = juce::JSON::toString(specs, true).toStdString();
    return true;
}

std::shared_ptr<const wasm::Compiled> WasmPackage::compiled(std::string& error) const {
    std::lock_guard<std::mutex> lock(compileMutex_);
    if (!compiled_ && compileError_.empty()) {
        compiled_ = wasm::Compiled::compile(wasm_.data(), wasm_.size(), compileError_);
        if (!compiled_ && compileError_.empty()) compileError_ = "cannot compile the module";
    }
    if (!compiled_) error = compileError_;
    return compiled_;
}

std::shared_ptr<WasmPackage> WasmPackage::lazy(std::vector<uint8_t> wasmBytes, const std::string& specJson, std::string& error) {
    auto pkg = std::make_shared<WasmPackage>();
    pkg->wasm_ = std::move(wasmBytes);
    pkg->specJson = specJson;
    const juce::var specs = juce::JSON::parse(juce::String(specJson));
    if (!specs.isArray() || specs.size() == 0) { error = "spec.json is not a list of node types"; return nullptr; }
    for (int i = 0; i < specs.size(); ++i) pkg->types.push_back(specs[i]["type"].toString().toStdString());
    return pkg;
}

std::shared_ptr<WasmPackage> WasmPackage::load(const uint8_t* wasmBytes, size_t size, std::string& error) {
    auto pkg = std::make_shared<WasmPackage>();
    pkg->wasm_.assign(wasmBytes, wasmBytes + size);
    auto compiled = pkg->compiled(error);
    if (!compiled) return nullptr;
    auto inst = wasm::Instance::create(compiled, error);
    if (!inst) return nullptr;
    const int chunk = inst->find("bleep_chunk"), noteSize = inst->find("bleep_note_event_size");
    const int json = inst->find("bleep_spec_json"), jsonLen = inst->find("bleep_spec_json_length");
    if (chunk < 0 || noteSize < 0 || json < 0 || jsonLen < 0) {
        error = "not a Bleep module: the ABI's exports are missing";
        return nullptr;
    }
    if (inst->call(chunk) != kChunk) { error = "built for another chunk size"; return nullptr; }
    if (inst->call(noteSize) != (int)sizeof(NoteEvent)) { error = "built for another note event size"; return nullptr; }
    const uint32_t ptr = (uint32_t)inst->call(json);
    const uint32_t len = (uint32_t)inst->call(jsonLen);
    if ((size_t)ptr + len > inst->memorySize()) { error = "the spec points outside the module's memory"; return nullptr; }
    pkg->specJson.assign(reinterpret_cast<const char*>(inst->memory() + ptr), len);
    const juce::var specs = juce::JSON::parse(juce::String(pkg->specJson));
    if (!specs.isArray() || specs.size() == 0) { error = "the spec is not a list of node types"; return nullptr; }
    for (int i = 0; i < specs.size(); ++i) pkg->types.push_back(specs[i]["type"].toString().toStdString());
    return pkg;
}

std::string WasmPackage::sanitiseData(int typeIndex, const std::string& json) const {
    std::lock_guard<std::mutex> lock(sanitiseMutex_);
    std::string err;
    if (typeIndex < 0 || (size_t)typeIndex >= types.size()) return json;
    if (!sanitiser_) {
        const auto module = compiled(err);
        if (!module) return json;
        sanitiser_ = wasm::Instance::create(module, err);
        if (!sanitiser_) return json;
        sanitiserHandles_.assign(types.size(), 0);
    }
    wasm::Instance& inst = *sanitiser_;
    if (sanitiserHandles_[(size_t)typeIndex] == 0) sanitiserHandles_[(size_t)typeIndex] = inst.call(inst.find("bleep_create"), {(int32_t)typeIndex, 48000.0});
    const int32_t h = sanitiserHandles_[(size_t)typeIndex];
    const int scratchFn = inst.find("bleep_scratch"), sanitise = inst.find("bleep_sanitise_data"), textFn = inst.find("bleep_text");
    if (h == 0 || scratchFn < 0 || sanitise < 0 || textFn < 0) return json;
    const uint32_t at = (uint32_t)inst.call(scratchFn, {h, (int32_t)json.size() + 1});
    if ((size_t)at + json.size() + 1 > inst.memorySize()) return json;
    std::memcpy(inst.memory() + at, json.c_str(), json.size() + 1);
    const int32_t n = inst.call(sanitise, {h, (int32_t)typeIndex, (int32_t)json.size()});
    if (n < 0) return json;  // this type has no node data
    const uint32_t out = (uint32_t)inst.call(textFn, {h});
    if ((size_t)out + (size_t)n > inst.memorySize()) return json;
    return std::string(reinterpret_cast<const char*>(inst.memory() + out), (size_t)n);
}

// ---- WasmModule ---------------------------------------------------------------------------------------

WasmModule::WasmModule(const ModuleSpec& spec, std::shared_ptr<WasmPackage> package)
    : Module(spec), package_(std::move(package)), typeIndex_(package_->indexOf(spec.type)) {
    liveJson_.reserve(kSnapshotReserve);
    dataJson_.reserve(kSnapshotReserve);
    queue_.reserve(64);
    work_.reserve(64);
}

WasmModule::~WasmModule() { MediaService::get().forget(this); }

std::string WasmModule::error() const {
    std::lock_guard<std::mutex> lock(errorMutex_);
    return error_;
}

void WasmModule::fail(const std::string& why) {
    {
        std::lock_guard<std::mutex> lock(errorMutex_);
        if (error_.empty()) error_ = why;
    }
    ok_.store(false);
}

void WasmModule::prepare(double sampleRate) {
    Module::prepare(sampleRate);
    ok_.store(false);
    inst_.reset();
    if (typeIndex_ < 0) return fail("the file does not provide " + spec().type);
    std::string err;
    const auto module = package_->compiled(err);  // compiled on first use, here: prepare() does not run on the audio thread
    if (!module) return fail(err);
    inst_ = wasm::Instance::create(module, err);
    if (!inst_) return fail(err);
    inst_->setBudgetMs(wasm::kInitBudgetMs);  // bleep_create may allocate a lot; from the first block on, calls are held to kAudioBudgetMs
    media_ = std::make_unique<Media>(*this);
    inst_->setMedia(media_.get());
    MediaService::get().listen(this, [this] { replayData(); });
    auto need = [&](const char* name) { return inst_->find(name); };
    const int create = need("bleep_create"), params = need("bleep_params_ptr"), inputs = need("bleep_inputs_ptr"), outputs = need("bleep_outputs_ptr"),
              inConn = need("bleep_in_connected_ptr"), outConn = need("bleep_out_connected_ptr"), error = need("bleep_error");
    fnProcess_ = need("bleep_process"); fnSetKnob_ = need("bleep_set_knob"); fnTransport_ = need("bleep_set_transport");
    fnReset_ = need("bleep_reset"); fnScratch_ = need("bleep_scratch"); fnSetData_ = need("bleep_set_data");
    fnPerform_ = need("bleep_perform"); fnCommand_ = need("bleep_command"); fnLive_ = need("bleep_live"); fnText_ = need("bleep_text");
    fnTakeData_ = need("bleep_take_data"); fnNotesIn_ = need("bleep_notes_in_ptr"); fnNotesOut_ = need("bleep_notes_out_ptr");
    fnSetVoice_ = need("bleep_set_voice"); fnHarmony_ = need("bleep_harmony_ptr");  // the last two are optional additions
    fnHost_ = need("bleep_host_ptr");  // optional: the Transport module's mailbox
    for (int f : {create, params, inputs, outputs, inConn, outConn, error, fnProcess_, fnSetKnob_, fnTransport_, fnReset_, fnScratch_, fnSetData_,
                  fnPerform_, fnCommand_, fnLive_, fnText_, fnTakeData_, fnNotesIn_, fnNotesOut_})
        if (f < 0) return fail("the module lacks an export of the ABI");
    handle_ = (uint32_t)inst_->call(create, {(int32_t)typeIndex_, sampleRate});
    if (inst_->failed()) return fail(inst_->lastError());
    if (handle_ == 0) {
        const int32_t e = inst_->call(error);
        return fail("bleep_create failed: " + cString(*inst_, (uint32_t)e));
    }
    const int32_t h = (int32_t)handle_;
    paramsPtr_ = (uint32_t)inst_->call(params, {h});
    inputsPtr_ = (uint32_t)inst_->call(inputs, {h});
    outputsPtr_ = (uint32_t)inst_->call(outputs, {h});
    inConnectedPtr_ = (uint32_t)inst_->call(inConn, {h});
    outConnectedPtr_ = (uint32_t)inst_->call(outConn, {h});
    harmonyPtr_ = fnHarmony_ >= 0 ? (uint32_t)inst_->call(fnHarmony_, {h}) : 0;
    hostPtr_ = fnHost_ >= 0 ? (uint32_t)inst_->call(fnHost_, {h}) : 0;
    if (hostPtr_ != 0 && (size_t)hostPtr_ + sizeof(HostControlWire) > inst_->memorySize()) hostPtr_ = 0;  // not a mailbox we can read: ignored
    const size_t np = spec().params.size(), ni = spec().inputs.size(), no = spec().outputs.size();
    const size_t mem = inst_->memorySize();  // memory only grows: what is inside now stays inside
    const bool inside = (size_t)paramsPtr_ + std::max<size_t>(np, 1) * kChunk * 4 <= mem && (size_t)inputsPtr_ + std::max<size_t>(ni, 1) * kChunk * 4 <= mem &&
                        (size_t)outputsPtr_ + std::max<size_t>(no, 1) * kChunk * 4 <= mem && (size_t)inConnectedPtr_ + ni + 1 <= mem &&
                        (size_t)outConnectedPtr_ + no + 1 <= mem;
    if (!inside) return fail("a buffer of the module lies outside its memory");
    notesInPtr_.assign(ni, 0);
    notesOutPtr_.assign(no, 0);
    for (size_t j = 0; j < ni; ++j)
        if (spec().inputs[j].type == Signal::Notes) {
            notesInPtr_[j] = (uint32_t)inst_->call(fnNotesIn_, {h, (int32_t)j});
            if ((size_t)notesInPtr_[j] + sizeof(NoteBuffer) > mem) return fail("a notes buffer lies outside the module's memory");
        }
    for (size_t j = 0; j < no; ++j)
        if (spec().outputs[j].type == Signal::Notes) {
            notesOutPtr_[j] = (uint32_t)inst_->call(fnNotesOut_, {h, (int32_t)j});
            if ((size_t)notesOutPtr_[j] + sizeof(NoteBuffer) > mem) return fail("a notes buffer lies outside the module's memory");
        }
    lastKnob_.assign(np, std::nanf(""));  // forces the first sync
    lastVoice_ = -2;
    sinceSnapshot_ = 0;
    inst_->setBudgetMs(kAudioBudgetMs);
    ok_.store(true);
    drain();
}

void WasmModule::reset() {
    if (inst_ && ok_) {  // called while no audio runs (prepare, a recompile)
        inst_->call(fnReset_, {(int32_t)handle_});
        if (inst_->failed()) fail(inst_->lastError());
    }
}

char* WasmModule::scratch(int size) {
    const uint32_t ptr = (uint32_t)inst_->call(fnScratch_, {(int32_t)handle_, size});
    if ((size_t)ptr + (size_t)size + 1 > inst_->memorySize()) { fail("the scratch buffer lies outside the module's memory"); return nullptr; }
    return reinterpret_cast<char*>(inst_->memory() + ptr);
}

// ---- messages from the message thread -------------------------------------------------------------

void WasmModule::replayData() {  // a sample file the module asked for has been read: it loads it when it gets its data again
    std::lock_guard<std::mutex> lock(queueMutex_);
    if (lastData_.empty()) return;
    Message m;
    m.kind = Message::Data;
    m.text = lastData_;
    queue_.push_back(std::move(m));
}

void WasmModule::setData(const std::string& json) {
    std::lock_guard<std::mutex> lock(queueMutex_);
    lastData_ = json;
    Message m;
    m.kind = Message::Data;
    m.text = json;
    queue_.push_back(std::move(m));
}

void WasmModule::perform(const std::string& action, const std::vector<double>& args) {
    std::lock_guard<std::mutex> lock(queueMutex_);
    Message m;
    m.kind = Message::Perform;
    m.text = action;
    m.args = args;
    queue_.push_back(std::move(m));
}

void WasmModule::command(const std::string& id, float value) {
    std::lock_guard<std::mutex> lock(queueMutex_);
    Message m;
    m.kind = Message::Command;
    m.text = id;
    m.value = value;
    queue_.push_back(std::move(m));
}

void WasmModule::drain() {
    {
        std::unique_lock<std::mutex> lock(queueMutex_, std::try_to_lock);  // never wait on the audio thread: next chunk then
        if (!lock.owns_lock() || queue_.empty()) return;
        work_.swap(queue_);
        queue_.clear();
    }
    for (const Message& m : work_) deliver(m);
    work_.clear();
}

void WasmModule::deliver(const Message& m) {
    if (!inst_ || !ok_) return;
    const int32_t h = (int32_t)handle_;
    switch (m.kind) {
        case Message::Data:
            if (char* p = scratch((int)m.text.size() + 1)) {
                std::memcpy(p, m.text.c_str(), m.text.size() + 1);
                inst_->call(fnSetData_, {h, (int32_t)m.text.size()});
            }
            break;
        case Message::Command:
            if (char* p = scratch((int)m.text.size() + 1)) {
                std::memcpy(p, m.text.c_str(), m.text.size() + 1);
                inst_->call(fnCommand_, {h, m.value});
            }
            break;
        case Message::Perform: {
            const int offset = ((int)m.text.size() + 1 + 7) & ~7;  // the doubles are 8-byte aligned (module-abi.md, bleep_perform)
            if (char* p = scratch(offset + 8 * (int)m.args.size())) {
                std::memcpy(p, m.text.c_str(), m.text.size() + 1);
                if (!m.args.empty()) std::memcpy(p + offset, m.args.data(), 8 * m.args.size());
                inst_->call(fnPerform_, {h, (int32_t)offset, (int32_t)m.args.size()});
            }
            break;
        }
    }
    if (inst_->failed()) fail(inst_->lastError());
}

// ---- the audio thread -------------------------------------------------------------------------------

void WasmModule::bypass(const ProcessContext& c) {
    for (size_t j = 0; j < spec().outputs.size(); ++j)
        if (c.outputs[j]) std::fill_n(c.outputs[j], c.numSamples, 0.0f);
    for (size_t j = 0; j < spec().outputs.size(); ++j)
        if (c.notesOut && c.notesOut[j]) c.notesOut[j]->clear();
}

void WasmModule::process(const ProcessContext& c) {
    if (!ok_ || !inst_) return bypass(c);
    drain();
    const size_t np = spec().params.size(), ni = spec().inputs.size(), no = spec().outputs.size();
    const int32_t h = (int32_t)handle_;
    for (size_t i = 0; i < np; ++i) {  // the knobs: what the module reads with setting()
        const float k = knob((int)i);
        if (!(k == lastKnob_[i])) {
            lastKnob_[i] = k;
            inst_->call(fnSetKnob_, {h, (int32_t)i, k});
        }
    }
    if (fnSetVoice_ >= 0 && c.voice != lastVoice_) {
        lastVoice_ = c.voice;
        inst_->call(fnSetVoice_, {h, (int32_t)c.voice});
    }
    const Transport& t = *c.transport;
    hostToModule();
    const bool writesHarmony = spec().harmony == HarmonyRole::Writer;
    for (int off = 0; off < c.numSamples; off += kChunk) {
        const int n = std::min(kChunk, c.numSamples - off);
        uint8_t* mem = inst_->memory();
        auto* params = reinterpret_cast<float*>(mem + paramsPtr_);
        auto* inputs = reinterpret_cast<float*>(mem + inputsPtr_);
        for (size_t i = 0; i < np; ++i) std::memcpy(params + i * kChunk, c.params[i] + off, (size_t)n * sizeof(float));
        for (size_t i = 0; i < ni; ++i) {
            if (c.inputs[i]) std::memcpy(inputs + i * kChunk, c.inputs[i] + off, (size_t)n * sizeof(float));
            mem[inConnectedPtr_ + i] = c.inputConnected && c.inputConnected[i] ? 1 : 0;
            if (notesInPtr_[i]) {  // the events that fall into this slice, with their offsets relative to it
                NoteBuffer* dst = reinterpret_cast<NoteBuffer*>(mem + notesInPtr_[i]);
                dst->clear();
                if (const NoteBuffer* src = c.notesIn ? c.notesIn[i] : nullptr)
                    for (int k = 0; k < src->count; ++k) {
                        NoteEvent e = src->events[k];
                        if (e.offset >= off && e.offset < off + n) { e.offset = (int16_t)(e.offset - off); dst->push(e); }
                    }
            }
        }
        for (size_t j = 0; j < no; ++j) mem[outConnectedPtr_ + j] = !c.outputConnected || c.outputConnected[j] ? 1 : 0;
        if (harmonyPtr_ && c.harmony) std::memcpy(mem + harmonyPtr_, c.harmony, sizeof(dsp::HarmonyState) * dsp::kHarmonyBuses);
        const double ppq = c.ppqStart + c.ppqPerSample * off;
        if (c.transportStarted && off == 0)  // the module sees "started" when the transport goes from stopped to playing
            inst_->call(fnTransport_, {h, t.bpm, ppq, (int32_t)0, (int64_t)t.samplePos});
        inst_->call(fnTransport_, {h, t.bpm, ppq, (int32_t)(t.playing || c.transportStarted ? 1 : 0), (int64_t)(t.samplePos + off)});
        const int32_t status = inst_->call(fnProcess_, {h, (int32_t)n});
        if (inst_->failed()) { fail("trapped: " + inst_->lastError()); return bypass(c); }
        if (status != 0) { fail("bleep_process refused the call"); return bypass(c); }
        mem = inst_->memory();
        const auto* outputs = reinterpret_cast<const float*>(mem + outputsPtr_);
        for (size_t j = 0; j < no; ++j) {
            if (c.outputs[j]) std::memcpy(c.outputs[j] + off, outputs + j * kChunk, (size_t)n * sizeof(float));
            if (notesOutPtr_[j] && c.notesOut && c.notesOut[j]) {
                const NoteBuffer* src = reinterpret_cast<const NoteBuffer*>(mem + notesOutPtr_[j]);
                if (off == 0) c.notesOut[j]->clear();
                for (int k = 0; k < src->count && k < kMaxNotesPerChunk; ++k) {
                    NoteEvent e = src->events[k];
                    e.offset = (int16_t)(e.offset + off);
                    c.notesOut[j]->push(e);
                }
            }
        }
        if (writesHarmony && harmonyPtr_ && c.harmony) std::memcpy(c.harmony, mem + harmonyPtr_, sizeof(dsp::HarmonyState) * dsp::kHarmonyBuses);
    }
    hostFromModule();
    sinceSnapshot_ += c.numSamples;
    if (sinceSnapshot_ >= kSnapshotEvery) {
        sinceSnapshot_ = 0;
        snapshot();
    }
}

// ---- the Transport module's mailbox (HostControl.h) ---------------------------------------------

void WasmModule::hostToModule() {
    if (hostPtr_ == 0) return;
    const HostControl& host = hostControl();
    HostControlWire wire;
    std::memcpy(&wire, inst_->memory() + hostPtr_, sizeof wire);
    wire.hosted = host.hosted.load(std::memory_order_relaxed);
    wire.linkAvailable = host.linkAvailable.load(std::memory_order_relaxed);
    wire.linkEnabled = host.linkEnabled.load(std::memory_order_relaxed);
    wire.linkPeers = host.linkPeers.load(std::memory_order_relaxed);
    std::memcpy(inst_->memory() + hostPtr_, &wire, sizeof wire);
}

void WasmModule::hostFromModule() {
    if (hostPtr_ == 0) return;
    HostControlWire wire;
    std::memcpy(&wire, inst_->memory() + hostPtr_, sizeof wire);
    if (wire.tempo <= 0.0 && wire.play == HostControl::kNone && wire.link == HostControl::kNone && wire.startStopSync == HostControl::kNone) return;
    HostControl& host = hostControl();
    if (wire.tempo > 0.0) host.tempo.store(wire.tempo, std::memory_order_relaxed);
    if (wire.play >= HostControl::Stop && wire.play <= HostControl::Continue) host.play.store(wire.play, std::memory_order_relaxed);
    if (wire.link == 0 || wire.link == 1) host.link.store(wire.link, std::memory_order_relaxed);
    if (wire.startStopSync == 0 || wire.startStopSync == 1) host.startStopSync.store(wire.startStopSync, std::memory_order_relaxed);
    wire.tempo = 0.0;  // taken
    wire.play = wire.link = wire.startStopSync = HostControl::kNone;
    std::memcpy(inst_->memory() + hostPtr_, &wire, sizeof wire);
}

void WasmModule::snapshot() {
    const int32_t h = (int32_t)handle_;
    const bool live = wantLive_.exchange(false), data = wantData_.exchange(false);
    if (!live && !data) return;
    std::unique_lock<std::mutex> lock(snapMutex_, std::try_to_lock);
    if (!lock.owns_lock()) {  // the message thread is reading: ask again
        if (live) wantLive_.store(true);
        if (data) wantData_.store(true);
        return;
    }
    auto copyText = [&](int32_t length, std::string& dst) {
        const uint32_t ptr = (uint32_t)inst_->call(fnText_, {h});
        if (length < 0 || (size_t)length > kSnapshotReserve || (size_t)ptr + (size_t)length > inst_->memorySize()) return false;
        dst.assign(reinterpret_cast<const char*>(inst_->memory() + ptr), (size_t)length);  // within the reserved capacity: no allocation
        return true;
    };
    if (live) copyText(inst_->call(fnLive_, {h}), liveJson_);
    if (data) {
        const int32_t n = inst_->call(fnTakeData_, {h});
        if (n >= 0 && copyText(n, dataJson_)) haveData_ = true;
    }
    if (inst_->failed()) fail(inst_->lastError());
}

// ---- what the view asks for (message thread) ------------------------------------------------------------

void WasmModule::liveValues(std::vector<std::pair<std::string, double>>& out) const {
    wantLive_.store(true);
    std::string json;
    {
        std::lock_guard<std::mutex> lock(snapMutex_);
        json = liveJson_;
    }
    const juce::var v = juce::JSON::parse(juce::String(json));
    if (auto* values = v["values"].getDynamicObject())
        for (const auto& p : values->getProperties()) out.push_back({p.name.toString().toStdString(), (double)p.value});
}

void WasmModule::liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const {
    std::string json;
    {
        std::lock_guard<std::mutex> lock(snapMutex_);
        json = liveJson_;
    }
    const juce::var v = juce::JSON::parse(juce::String(json));
    if (auto* arrays = v["arrays"].getDynamicObject())
        for (const auto& p : arrays->getProperties()) {
            std::vector<float> values;
            if (auto* a = p.value.getArray())
                for (const auto& x : *a) values.push_back((float)(double)x);
            out.push_back({p.name.toString().toStdString(), std::move(values)});
        }
}

bool WasmModule::takeData(std::string& json) {
    wantData_.store(true);
    std::lock_guard<std::mutex> lock(snapMutex_);
    if (!haveData_) return false;
    json = dataJson_;
    haveData_ = false;
    return true;
}

}  // namespace bleep::engine
