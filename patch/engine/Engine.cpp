// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Engine.cpp — lifetime, instances, and finding the engine of the process.

#if JUCE_WINDOWS
#include <windows.h>
#include <process.h>
#else
#include <dlfcn.h>
#include <unistd.h>
#endif
#include "EngineInternal.h"
#include "LiveParamsDsp.h"

namespace bleep::engine {

// ---- lifetime ------------------------------------------------------------------

Engine::Engine() {
    media::migrateLegacyFolders();
    media::setFolder(juce::File::getSpecialLocation(juce::File::userMusicDirectory)
                         .getChildFile("Beautiful Bleep").getChildFile("Media").getFullPathName().toStdString());
#if defined(BLEEP_WASM_MODULES)
    {  // the modules installed on this machine (developers/modules/library.md): registered before any board is loaded
        auto& library = ModuleLibrary::instance();
        library.postToMessageThread = [](std::function<void()> f) { juce::MessageManager::callAsync(std::move(f)); };
        library.onTypesChanged = [this] { modulesChanged(); };
        library.start();
    }
#endif
    startTimerHz(10);
}

Engine::~Engine() {
    stopTimer();
    ui_.reset();
    delete program_.exchange(nullptr);
    for (auto* p : retired_) delete p;
    for (auto& t : table_) t.store(nullptr);
}

void Engine::retain() noexcept { refs_.fetch_add(1); }

PortSlot* Engine::slot(int handle) const noexcept {
    return handle > 0 && handle < kMaxInstances ? table_[handle].load(std::memory_order_acquire) : nullptr;
}

std::shared_ptr<PortSlot> Engine::slotShared(int handle) const {
    for (const auto& s : instances_)
        if (s->handle == handle) return s;
    return nullptr;
}

// ---- instances --------------------------------------------------------------------

int Engine::registerInstance(PortKind kind) noexcept {
    int handle = 0;
    for (int h = 1; h < kMaxInstances; ++h)
        if (table_[h].load() == nullptr && slotShared(h) == nullptr) {
            handle = h;
            break;
        }
    if (handle == 0) return 0;
    auto s = std::make_shared<PortSlot>();
    s->kind = kind;
    s->handle = handle;
    s->id = juce::Uuid().toDashedString().toStdString();
    s->registeredAt = nowMs();
    instances_.push_back(s);
    table_[handle].store(s.get(), std::memory_order_release);
    if (kind == PortKind::Patch && mainHandle_ == 0) {
        mainHandle_ = handle;
        implicit_ = false;  // Bleep Board takes over from the board cell plugins kept on their own
        setBoard(board::create(), true);
    }
    return handle;
}

int Engine::registerRemoteInstance(PortKind kind) noexcept {
    const int handle = registerInstance(kind);
    if (auto s = slotShared(handle)) s->remote = true;
    return handle;
}

void Engine::setBridged(int handle, bool bridged) noexcept {
    auto s = slotShared(handle);
    if (!s || s->bridged == bridged) return;
    s->bridged = bridged;
    recompile();  // the node is a ghost while its plugin talks to another board
    if (ui_) ui_->boardChanged();
}

void Engine::unregisterInstance(int handle) noexcept {
    if (handle <= 0 || handle >= kMaxInstances) return;
    table_[handle].store(nullptr, std::memory_order_release);
    instances_.erase(std::remove_if(instances_.begin(), instances_.end(),
                                    [&](const auto& s) { return s->handle == handle; }),
                     instances_.end());
    if (handle == mainHandle_) {
        // Deleting Bleep Board removes the board from the set (spec §5.4).
        clearBoard();
        promoteMain();
    } else {
        recompile();  // the port's node becomes a ghost
        if (ui_) ui_->boardChanged();
    }
    updateImplicitBoard();
}

void Engine::restoreInstanceId(int handle, const char* savedId) noexcept {
    auto s = slotShared(handle);
    if (!s || savedId == nullptr || *savedId == 0) return;
    s->restored = true;
    const std::string id(savedId);
    if (id == s->id) return;
    for (const auto& other : instances_)
        if (other != s && other->id == id) return;  // a duplicated device keeps its fresh ID (spec §5.4)
    const juce::String fresh(s->id);
    s->id = id;
    // A node that appeared for the fresh ID before the state arrived goes again.
    if (hasBoard() && board::findNodeByPort(board_, juce::String(id)) != nullptr)
        if (auto* n = board::findNodeByPort(board_, fresh)) {
            const juce::String nodeId = n->getProperty("id").toString();
            bool cabled = false;
            if (auto* cables = board_["cables"].getArray())
                for (const auto& c : *cables)
                    cabled |= c["from"]["node"].toString() == nodeId || c["to"]["node"].toString() == nodeId;
            if (!cabled)
                if (auto* nodes = board_["nodes"].getArray())
                    for (int i = nodes->size(); --i >= 0;)
                        if ((*nodes)[i]["id"].toString() == nodeId) nodes->remove(i);
        }
    recompile();
    if (ui_) ui_->boardChanged();
}

void Engine::instanceId(int handle, char* out, int capacity) noexcept {
    auto s = slotShared(handle);
    copyOut(s ? juce::String(s->id) : juce::String(), out, capacity);
}

void Engine::setTrack(int handle, const char* trackName, uint32_t argb) noexcept {
    if (auto s = slotShared(handle)) {
        s->trackName = trackName ? trackName : "";
        s->trackColour = argb;
    }
}

void Engine::prepare(int handle, double sampleRate, int maxBlock) noexcept {
    // Hosts may call this off the message thread: only touch atomics here.
    PortSlot* s = slot(handle);
    if (s == nullptr) return;
    s->maxBlock = maxBlock;
    int m = maxBlock_.load();
    while (maxBlock > m && !maxBlock_.compare_exchange_weak(m, maxBlock)) {}
    if (sampleRate > 0.0) pendingRate_.store(sampleRate);
    if (juce::MessageManager::existsAndIsCurrentThread()) applySampleRate();
}

void Engine::applySampleRate() {
    const double rate = pendingRate_.exchange(0.0);
    if (rate <= 0.0 || juce::exactlyEqual(rate, sampleRate_)) return;
    sampleRate_ = rate;
    modules_.clear();  // modules are prepared for one rate: start them fresh
    recompile();
}

PortState Engine::state(int handle) noexcept {
    auto s = slotShared(handle);
    if (s && s->kind == PortKind::Patch && handle != mainHandle_) return PortState::InactiveMain;
    return hasBoard() ? PortState::Ok : PortState::NoBoard;
}

int Engine::portLatencySamples(int handle) noexcept {
    PortSlot* s = slot(handle);
    return s != nullptr && s->local.load(std::memory_order_relaxed) ? 0 : latencySamples();
}

uint32_t Engine::liveParams(float* offsets32) noexcept {
    const patch::LiveParamsMailbox& box = patch::liveParams();
    for (int k = 0; k < patch::kNumLiveParams; ++k) offsets32[k] = box.offset[k].load(std::memory_order_relaxed);
    return box.cabled.load(std::memory_order_relaxed);
}

int Engine::latencySamples() noexcept {
    // The two blocks a signal really spends in the engine are blocks of the size the host runs, which can be far
    // below the maximum it announces (Live announces 512 whatever its buffer is). Report what has been seen once
    // there is something, so Live compensates the delay that is there and not more.
    const int seen = seenBlock_.load(std::memory_order_relaxed);
    const int m = seen > 0 ? seen : maxBlock_.load();
    return 2 * (m > 0 ? m : 512);
}

void Engine::statusText(int handle, char* out, int capacity) noexcept {
    auto s = slotShared(handle);
    juce::String text;
    switch (state(handle)) {
        case PortState::InactiveMain: text = "Inactive: this set already has a board."; break;
        case PortState::NoBoard: text = "No board in this set. Add Bleep Board."; break;
        case PortState::VersionMismatch: text = "Another version of Bleep Board is loaded."; break;
        case PortState::Ok: {
            const int l = s ? portLatencySamples(s->handle) : latencySamples();
            text = "Board running";
            if (s && s->kind != PortKind::Patch && s->kind != PortKind::MidiIn && s->kind != PortKind::AudioIn)
                text << u8(" · latency ") << l << " smp (" << juce::String(1000.0 * l / sampleRate_, 1) << " ms)";
            if (s && s->resyncs.load() > 0) text << u8(" · resyncs ") << (int)s->resyncs.load();
            if (s && s->drops.load() > 0) text << u8(" · drops ") << (int)s->drops.load();
            break;
        }
    }
    copyOut(text, out, capacity);
}

void Engine::nodeName(int handle, char* out, int capacity) noexcept {
    auto s = slotShared(handle);
    juce::DynamicObject* n = s && hasBoard() ? board::findNodeByPort(board_, juce::String(s->id)) : nullptr;
    copyOut(n ? n->getProperty("name").toString() : juce::String(), out, capacity);
}

void Engine::setNodeName(int handle, const char* name) noexcept {
    auto s = slotShared(handle);
    if (!s || !hasBoard() || name == nullptr) return;
    if (auto* n = board::findNodeByPort(board_, juce::String(s->id))) {
        beginGesture();
        n->setProperty("name", juce::String::fromUTF8(name).substring(0, 63));
        boardEdited(true);
    }
}


// ---- finding the engine: one per process ---------------------------------------------

namespace {

constexpr const char* kEnvName = "BLEEP_ENGINE";

juce::String abiTag() {
    return juce::String(kAbiTag) + "/" + juce::String((int)sizeof(BlockIO)) + "/" +
           juce::String((int)sizeof(MidiEvent)) + "/" + juce::String((int)sizeof(Transport)) + "/" +
           juce::String((int)sizeof(void*));
}

int processId() {
#if JUCE_WINDOWS
    return _getpid();
#else
    return (int)getpid();
#endif
}

/// Keeps this binary loaded for the rest of the process: other binaries hold
/// pointers into its code once they share its engine.
void pinThisBinary() {
#if JUCE_WINDOWS
    HMODULE module = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                       reinterpret_cast<LPCWSTR>(&pinThisBinary), &module);
#else
    Dl_info info{};
    if (dladdr(reinterpret_cast<void*>(&pinThisBinary), &info) != 0 && info.dli_fname != nullptr)
        dlopen(info.dli_fname, RTLD_NOW | RTLD_NODELETE);
#endif
}

void setEnv(const char* value) {
#if JUCE_WINDOWS
    _putenv_s(kEnvName, value ? value : "");
#else
    if (value) setenv(kEnvName, value, 1);
    else unsetenv(kEnvName);
#endif
}

/// Stands in when another build owns the process's engine.
class MismatchEngine final : public IEngine {
public:
    int abiMinor() const noexcept override { return 0; }
    void retain() noexcept override { ++refs_; }
    void release() noexcept override {
        if (--refs_ == 0) delete this;
    }
    int registerInstance(PortKind) noexcept override { return 1; }
    void unregisterInstance(int) noexcept override {}
    void restoreInstanceId(int, const char*) noexcept override {}
    void instanceId(int, char* out, int capacity) noexcept override { copyOut({}, out, capacity); }
    void setTrack(int, const char*, uint32_t) noexcept override {}
    void prepare(int, double, int) noexcept override {}
    PortState state(int) noexcept override { return PortState::VersionMismatch; }
    void statusText(int, char* out, int capacity) noexcept override {
        copyOut("Another version of Bleep Board is loaded. Restart Live after updating.", out, capacity);
    }
    void nodeName(int, char* out, int capacity) noexcept override { copyOut({}, out, capacity); }
    void setNodeName(int, const char*) noexcept override {}
    int latencySamples() noexcept override { return 0; }
    void process(int, BlockIO& io) noexcept override {
        io.numMidiOut = 0;
        io.boardAudioValid = false;
        for (int ch = 0; ch < io.numAudioOut; ++ch)
            if (io.audioOut[ch]) std::fill_n(io.audioOut[ch], io.numSamples, 0.0f);
    }
    size_t saveBoard(int, char*, size_t) noexcept override { return 0; }
    void loadBoard(int, const char*, size_t) noexcept override {}
    uint64_t boardGeneration() noexcept override { return 0; }
    void replaceBoardWith(int) noexcept override {}
    void editorOpened(int) noexcept override {}
    void openBoard(int) noexcept override {}
    void setCellPreset(int, const char*, size_t, bool) noexcept override {}
    size_t cellPreset(int, char*, size_t) noexcept override { return 0; }
    size_t uiCall(int, const char*, const char*, char*, size_t) noexcept override { return 0; }
    void setBridged(int, bool) noexcept override {}
    int portLatencySamples(int) noexcept override { return 0; }
    uint32_t liveParams(float*) noexcept override { return 0; }

private:
    int refs_ = 1;
};

Engine* g_ownEngine = nullptr;  ///< the engine this binary created, if any

}  // namespace

void Engine::release() noexcept {
    if (refs_.fetch_sub(1) != 1) return;
    if (g_ownEngine == this) {
        g_ownEngine = nullptr;
        setEnv(nullptr);
    }
    delete this;
}

IEngine* acquireEngine() {
    const juce::String tag = abiTag();
    if (const char* env = std::getenv(kEnvName); env != nullptr && *env != 0) {
        // "<pid>|<pointer>|<abi tag>"
        const juce::StringArray parts = juce::StringArray::fromTokens(env, "|", "");
        if (parts.size() == 3 && parts[0].getIntValue() == processId()) {
            if (parts[2] != tag) return new MismatchEngine();
            auto* engine = reinterpret_cast<IEngine*>((uintptr_t)parts[1].getHexValue64());
            engine->retain();
            return engine;
        }
    }
    pinThisBinary();
    auto* engine = new Engine();
    g_ownEngine = engine;
    const juce::String value = juce::String(processId()) + "|" +
                               juce::String::toHexString((juce::int64)(uintptr_t)static_cast<IEngine*>(engine)) +
                               "|" + tag;
    setEnv(value.toRawUTF8());
    return engine;
}

}  // namespace bleep::engine
