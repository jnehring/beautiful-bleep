// SPDX-License-Identifier: MIT
//
// WasmModule.h — a node type whose DSP is a module .wasm (doc/specs/module-abi.md). It is a Module like the compiled-in
// ones: the engine cannot tell the difference. One WasmPackage per file (compiled once), one WasmModule per node.
//
// Threads: the instance is only ever entered from the audio thread (process) or, while no audio runs, from prepare().
// Everything the message thread asks for (data, gestures, buttons, live values) goes through a queue the audio thread drains.
#pragma once

#include "Module.h"
#include "WasmRuntime.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace bleep::engine {

/// A compiled module file and the node types it provides, in the order of its spec (the order bleep_create takes).
class WasmPackage {
public:
    /// Compiles the bytes now and reads the node types out of the module. Null, with `error`, if they are not a conforming
    /// module (module-abi.md). For tests and tools; installed modules use lazy().
    static std::shared_ptr<WasmPackage> load(const uint8_t* wasm, size_t size, std::string& error);
    /// From a package's module.wasm and its spec.json: nothing is compiled until a node first needs it, so every installed
    /// module can be listed at start-up at no cost.
    static std::shared_ptr<WasmPackage> lazy(std::vector<uint8_t> wasm, const std::string& specJson, std::string& error);

    /// The compiled module; compiles it on the first call (not on the audio thread). Null, with `error`, if that fails.
    std::shared_ptr<const wasm::Compiled> compiled(std::string& error) const;

    std::vector<std::string> types;   ///< node type ids; the index is the typeIndex of bleep_create
    std::string specJson;             ///< the node type descriptions (module-abi.md section 7): what ModuleSpec is made from

    int indexOf(const std::string& type) const;

    /// A node type's data made valid (ModuleSpec::sanitiseData), by a private instance of the module. Message thread.
    std::string sanitiseData(int typeIndex, const std::string& json) const;

private:
    std::vector<uint8_t> wasm_;
    mutable std::mutex compileMutex_;
    mutable std::shared_ptr<wasm::Compiled> compiled_;
    mutable std::string compileError_;
    mutable std::mutex sanitiseMutex_;
    mutable std::unique_ptr<wasm::Instance> sanitiser_;
    mutable std::vector<int> sanitiserHandles_;  // per type: an instance handle of the sanitiser, 0 if not made yet
};

class WasmModule final : public Module {
public:
    /// `spec` is the node type's spec (it must outlive the module, like for every Module).
    WasmModule(const ModuleSpec& spec, std::shared_ptr<WasmPackage> package);
    ~WasmModule() override;

    /// False if the instance could not be made, or trapped: the module then outputs silence (the reason is in error()).
    bool ok() const noexcept { return ok_.load(std::memory_order_relaxed); }
    std::string error() const;

    void prepare(double sampleRate) override;
    void reset() override;
    void process(const ProcessContext& c) override;
    void setData(const std::string& json) override;
    void perform(const std::string& action, const std::vector<double>& args) override;
    void command(const std::string& id, float value) override;
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override;
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override;
    bool takeData(std::string& json) override;

private:
    struct Message {
        enum Kind { Data, Perform, Command } kind = Data;
        std::string text;
        std::vector<double> args;
        float value = 0.0f;
    };
    class Media;                                   // answers bleep_media_info / bleep_media_read (module-abi.md, "Media")
    void replayData();                             // any thread
    void drain();                                  // audio thread (or prepare): delivers the queued messages
    void deliver(const Message& m);
    void snapshot();                               // audio thread: live values and node data the module changed
    char* scratch(int size);                       // `size` bytes in the module's memory for a string going in
    void fail(const std::string& why);
    void bypass(const ProcessContext& c);

    std::shared_ptr<WasmPackage> package_;
    std::unique_ptr<wasm::Instance> inst_;
    int typeIndex_;
    std::atomic<bool> ok_{false};
    mutable std::mutex errorMutex_;
    std::string error_;

    // exports, resolved once per instance
    int fnProcess_ = -1, fnSetKnob_ = -1, fnTransport_ = -1, fnReset_ = -1, fnScratch_ = -1, fnSetData_ = -1, fnPerform_ = -1,
        fnCommand_ = -1, fnLive_ = -1, fnText_ = -1, fnTakeData_ = -1, fnSetVoice_ = -1, fnNotesIn_ = -1, fnNotesOut_ = -1, fnHarmony_ = -1;
    uint32_t handle_ = 0, paramsPtr_ = 0, inputsPtr_ = 0, outputsPtr_ = 0, inConnectedPtr_ = 0, outConnectedPtr_ = 0, harmonyPtr_ = 0;
    std::vector<uint32_t> notesInPtr_, notesOutPtr_;   // per jack (0: not a notes jack)
    std::vector<float> lastKnob_;
    int lastVoice_ = -2;
    int64_t sinceSnapshot_ = 0;

    std::mutex queueMutex_;
    std::vector<Message> queue_, work_;
    std::string lastData_;                         // sent again when a sample file the module asked for has been read
    std::unique_ptr<Media> media_;

    mutable std::mutex snapMutex_;                 // the audio thread only try-locks it
    mutable std::atomic<bool> wantLive_{false}, wantData_{false};
    std::string liveJson_, dataJson_;
    bool haveData_ = false;
};

}  // namespace bleep::engine
