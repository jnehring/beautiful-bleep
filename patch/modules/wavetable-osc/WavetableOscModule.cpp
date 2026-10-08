// SPDX-License-Identifier: MIT
// Wavetable Osc node (specs/modules/wavetable-oscillator.md): 2-D wavetable
// oscillator over factory banks and one user bank imported from the media
// store. The node data names the media (never the samples); setData loads the
// WAV, builds the bank's mipmaps on the message thread and hands it to the
// audio thread with RtHandoff. Factory banks are built once per process: the
// selected one in prepare(), the rest on a background thread.
#include "WavetableOscDsp.h"
#include "Handoff.h"
#include "Media.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <array>
#include <atomic>
#include <cctype>
#include <map>
#include <mutex>
#include <thread>

namespace bleep::engine {

namespace {

namespace wt = dsp::wavetable;
using dsp::WavetableBank;
using patch::WavetableOscDsp;
using patch::WavetableOscParams;

constexpr int kCycleLengths[] = {0, 256, 512, 1024, 2048, 4096};  ///< 0 = Auto
constexpr int kMaxCycles = 64;

/// The factory banks, shared by every instance. ensure() builds one on the
/// calling thread (never the audio thread); startAll() builds the rest on a
/// worker that the process joins at exit.
class FactoryBanks {
public:
    static FactoryBanks& get() {
        static FactoryBanks b;
        return b;
    }
    ~FactoryBanks() {
        if (worker_.joinable()) worker_.join();
    }
    /// Null while the bank is still being built.
    const WavetableBank* ready(int i) const noexcept {
        return i >= 0 && i < wt::kNumFactoryBanks ? ready_[(size_t)i].load(std::memory_order_acquire) : nullptr;
    }
    void ensure(int i) {
        if (i < 0 || i >= wt::kNumFactoryBanks || ready(i)) return;
        ready_[(size_t)i].store(&wt::factoryBank((wt::FactoryBank)i), std::memory_order_release);
    }
    void startAll() {
        std::lock_guard<std::mutex> l(lock_);
        if (worker_.joinable()) return;
        worker_ = std::thread([this] {
            for (int i = 0; i < wt::kNumFactoryBanks; ++i) ensure(i);
        });
    }

private:
    std::array<std::atomic<const WavetableBank*>, wt::kNumFactoryBanks> ready_{};
    std::thread worker_;
    std::mutex lock_;
};

/// The empty user bank: one sine, at every position.
const WavetableBank& sineBank() {
    static const WavetableBank b = WavetableBank::fromSpectra(1, 1, [](int, int) {
        wt::Spectrum s = wt::emptySpectrum();
        wt::addSine(s, 1, 1.0);
        return s;
    });
    return b;
}

bool validMediaId(const std::string& id) { return media::validId(id); }

/// The node data, checked: {"sample": id, "name": text, "cycle": length, "cells": {"k": id}}.
struct UserData {
    std::string sample, name;
    int cycle = 0;
    std::map<int, std::string> cells;
};

UserData parseData(const juce::var& in) {
    UserData d;
    const std::string sample = in["sample"].toString().toStdString();
    if (validMediaId(sample)) {
        d.sample = sample;
        d.name = in["name"].toString().substring(0, 200).toStdString();
    }
    const int cycle = (int)in.getProperty("cycle", 0);
    for (int c : kCycleLengths)
        if (c == cycle) d.cycle = c;
    if (auto* cells = in["cells"].getDynamicObject())
        for (const auto& prop : cells->getProperties()) {
            const int k = prop.name.toString().getIntValue();
            const std::string id = prop.value.toString().toStdString();
            if (k >= 0 && k < kMaxCycles && prop.name.toString() == juce::String(k) && validMediaId(id)) d.cells[k] = id;
        }
    return d;
}

std::string sanitiseData(const std::string& json) {
    const UserData d = parseData(json.empty() ? juce::var() : juce::JSON::parse(juce::String(json)));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    if (!d.sample.empty()) {
        out->setProperty("sample", juce::String(d.sample));
        out->setProperty("name", juce::String(d.name));
    }
    out->setProperty("cycle", d.cycle);
    if (!d.cells.empty()) {
        auto* cells = new juce::DynamicObject();
        for (const auto& [k, id] : d.cells) cells->setProperty(juce::Identifier(juce::String(k)), juce::String(id));
        out->setProperty("cells", juce::var(cells));
    }
    return juce::JSON::toString(result, true).toStdString();
}

/// A clip's first channel cut into cycles: `length` samples each, or Auto
/// (2048 if the length is a multiple of it, else the whole clip is one cycle).
/// `total` receives how many whole cycles the clip has. Silent clips: none.
std::vector<std::vector<float>> cyclesOf(const MediaClip& clip, int length, int maxCycles, int& total) {
    total = 0;
    if (clip.channels.empty() || clip.channels[0].size() < 2) return {};
    const auto& x = clip.channels[0];
    float peak = 0.0f;
    for (float v : x) peak = std::max(peak, std::fabs(v));
    if (!(peak > 1e-5f)) return {};
    const size_t n = x.size();
    size_t len = length > 0 ? (size_t)length : (n % (size_t)wt::kSize == 0 ? (size_t)wt::kSize : n);
    len = std::min(len, n);
    total = (int)(n / len);
    std::vector<std::vector<float>> cycles;
    for (size_t start = 0; start + len <= n && (int)cycles.size() < maxCycles; start += len)
        cycles.emplace_back(x.begin() + (long)start, x.begin() + (long)(start + len));
    return cycles;
}

class WavetableOscModule final : public Module {
public:
    enum { Octave, Coarse, Fine, BankSel, X, Y, Scan, Warp, FmDepth, Stereo, SubLevel, PathSel, Blend, ReadSel, WarpMode, Quality };
    enum { Pitch, Fm, Sync };
    enum { OutL, OutR, Sub, PosX, PosY };

    static constexpr int kWavePoints = 128, kThumbPoints = 32;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        auto& banks = FactoryBanks::get();
        banks.ensure(0);  // Analog
        const int sel = (int)setting(BankSel);
        if (sel >= 1) banks.ensure(sel - 1);
        sineBank();
        banks.startAll();
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        const UserData d = parseData(juce::JSON::parse(juce::String(json)));
        std::vector<std::vector<float>> cycles;
        int total = 0;
        bool error = false;
        if (!d.sample.empty()) {
            if (const auto clip = media::load(d.sample)) cycles = cyclesOf(*clip, d.cycle, kMaxCycles, total);
            error = cycles.empty();
        }
        // Single cells: the first cycle of each cell's file replaces that cell.
        for (const auto& [k, id] : d.cells) {
            const auto clip = media::load(id);
            int t = 0;
            auto one = clip ? cyclesOf(*clip, 0, 1, t) : std::vector<std::vector<float>>{};
            if (one.empty()) {
                error = true;
                continue;
            }
            if (cycles.empty()) cycles.push_back(sineCycle());
            while ((int)cycles.size() <= k) cycles.push_back(cycles.back());
            cycles[(size_t)k] = std::move(one[0]);
        }
        userCycles_.store(total, std::memory_order_relaxed);
        userFrames_.store((int)cycles.size(), std::memory_order_relaxed);
        userError_.store(error, std::memory_order_relaxed);
        std::shared_ptr<const WavetableBank> bank;
        if (!cycles.empty()) bank = std::make_shared<const WavetableBank>(wt::bankFromCycles(cycles, 8));
        else if (error && userBank_) return;  // a broken file leaves the bank as it was
        userBank_ = bank;
        keep_[2] = keep_[1], keep_[1] = keep_[0], keep_[0] = bank;  // alive through the audio thread's crossfade
        user_.publish(std::move(bank));
        ++bankVersion_;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"xL", (double)xL_.load(std::memory_order_relaxed)});
        out.push_back({"yL", (double)yL_.load(std::memory_order_relaxed)});
        out.push_back({"xR", (double)xR_.load(std::memory_order_relaxed)});
        out.push_back({"yR", (double)yR_.load(std::memory_order_relaxed)});
        out.push_back({"bank", (double)bankShown_.load(std::memory_order_relaxed)});
        const WavetableBank* b = shownBank();
        out.push_back({"cols", (double)(b ? b->cols() : 1)});
        out.push_back({"rows", (double)(b ? b->rows() : 1)});
        out.push_back({"userFrames", (double)userFrames_.load(std::memory_order_relaxed)});
        out.push_back({"userCycles", (double)userCycles_.load(std::memory_order_relaxed)});
        out.push_back({"userError", userError_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }

    /// The current blended cycle after warp (L and R) and, now and then or
    /// after a bank change, a 32-point thumbnail of every frame.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const WavetableBank* b = shownBank();
        if (b == nullptr || b->empty()) return;
        const auto mode = (wt::Warp)warpMode_.load(std::memory_order_relaxed);
        const float warp = warpAmount_.load(std::memory_order_relaxed);
        const wt::Mip mip{3, 0.0f};
        for (int c = 0; c < 2; ++c) {
            const float x = (c ? xR_ : xL_).load(std::memory_order_relaxed), y = (c ? yR_ : yL_).load(std::memory_order_relaxed);
            std::vector<float> v(kWavePoints);
            for (int i = 0; i < kWavePoints; ++i) {
                const double w = wt::warpPhase(mode, (double)i / kWavePoints, warp);
                v[(size_t)i] = wt::readXY(*b, x * (float)(b->cols() - 1), y * (float)(b->rows() - 1), w, mip, wt::Interp::Linear);
            }
            out.push_back({c ? "waveR" : "waveL", std::move(v)});
        }
        const int key = bankShown_.load(std::memory_order_relaxed) * 100000 + bankVersion_;
        if (key != thumbKey_ || ++thumbAge_ >= 30) {
            thumbKey_ = key;
            thumbAge_ = 0;
            std::vector<float> t((size_t)b->frames() * kThumbPoints);
            for (int f = 0; f < b->frames(); ++f)
                for (int i = 0; i < kThumbPoints; ++i)
                    t[(size_t)(f * kThumbPoints + i)] = wt::readFrame(*b, f, (double)i / kThumbPoints, wt::Mip{5, 0.0f}, wt::Interp::Linear);
            out.push_back({"thumbs", std::move(t)});
        }
    }

    void process(const ProcessContext& c) override {
        dsp_.setOversampling(setting(Quality) >= 0.5f ? 2 : 1);
        const WavetableBank* user = user_.get();
        const int sel = (int)value(c, BankSel, 0);
        const WavetableBank* bank = sel <= 0 ? (user ? user : &sineBank()) : FactoryBanks::get().ready(sel - 1);
        if (bank != nullptr) {  // a factory bank still being built: keep the current one
            dsp_.setBank(bank);
            bankShown_.store(sel, std::memory_order_relaxed);
        } else if (dsp_.bank() == nullptr) {
            dsp_.setBank(FactoryBanks::get().ready(0) ? FactoryBanks::get().ready(0) : &sineBank());
        }

        WavetableOscParams p;
        p.path = (patch::wtosc::Path)(int)setting(PathSel);
        p.stepBlend = setting(Blend) >= 0.5f;
        p.read = (patch::wtosc::Read)(int)setting(ReadSel);
        p.warpMode = (wt::Warp)((int)setting(WarpMode) + 1);
        bool want[WavetableOscDsp::kAudioOutputs];
        for (int k = 0; k < WavetableOscDsp::kAudioOutputs; ++k) want[k] = c.isOutputConnected(k);
        const float* sync = c.inputs[Sync];
        for (int i = 0; i < c.numSamples; ++i) {
            p.pitch = value(c, Octave, i) + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f + c.inputs[Pitch][i];
            p.fm = c.inputs[Fm][i];
            p.fmDepth = value(c, FmDepth, i);
            p.x = value(c, X, i);
            p.y = value(c, Y, i);
            p.scan = value(c, Scan, i);
            p.warp = value(c, Warp, i);
            p.stereo = value(c, Stereo, i);
            p.subLevel = value(c, SubLevel, i);
            const bool edge = sync[i] >= 0.5f && lastSync_ < 0.5f;
            lastSync_ = sync[i];
            const auto f = dsp_.process(p, edge, want);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[Sub][i] = f.sub;
            c.outputs[PosX][i] = f.posX;
            c.outputs[PosY][i] = f.posY;
        }
        xL_.store(dsp_.posX(0), std::memory_order_relaxed);
        yL_.store(dsp_.posY(0), std::memory_order_relaxed);
        xR_.store(dsp_.posX(1), std::memory_order_relaxed);
        yR_.store(dsp_.posY(1), std::memory_order_relaxed);
        warpMode_.store((int)p.warpMode, std::memory_order_relaxed);
        warpAmount_.store(p.warp, std::memory_order_relaxed);
    }

private:
    static std::vector<float> sineCycle() {
        std::vector<float> s((size_t)wt::kSize);
        for (int i = 0; i < wt::kSize; ++i) s[(size_t)i] = (float)std::sin(wt::kTwoPi * i / wt::kSize);
        return s;
    }
    /// [message thread] The bank the view shows: the selected one if ready.
    const WavetableBank* shownBank() const noexcept {
        const int sel = bankShown_.load(std::memory_order_relaxed);
        if (sel <= 0) return userBank_ ? userBank_.get() : &sineBank();
        return FactoryBanks::get().ready(sel - 1);
    }

    WavetableOscDsp dsp_;
    RtHandoff<WavetableBank> user_;
    std::shared_ptr<const WavetableBank> userBank_, keep_[3];  // message thread
    std::string data_;
    int bankVersion_ = 0;
    mutable int thumbKey_ = -1, thumbAge_ = 0;
    float lastSync_ = 0.0f;
    std::atomic<float> xL_{0.0f}, yL_{0.0f}, xR_{0.0f}, yR_{0.0f}, warpAmount_{0.0f};
    std::atomic<int> warpMode_{0}, bankShown_{1}, userFrames_{0}, userCycles_{0};
    std::atomic<bool> userError_{false};
};

}  // namespace

void registerWavetableOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "wavetable-osc";
    s.name = "Wavetable Osc";
    s.category = "Sources";
    s.colour = "#818cf8";
    s.description = "2-D wavetable oscillator: an 8 × 8 grid of band-limited cycles, paths, phase warps and your own WAV tables.";
    std::vector<std::string> banks{"User"};
    for (int i = 0; i < wt::kNumFactoryBanks; ++i) banks.push_back(wt::factoryBankName((wt::FactoryBank)i));
    s.params = {ParamSpec::steppedInt("octave", "Octave", -4, 4, 0).inGroup("Pitch"),
                ParamSpec::number("coarse", "Coarse", -12.0f, 12.0f, 0.0f, "st", 1).inGroup("Pitch"),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Pitch"),
                ParamSpec::stepped("bank", "Bank", banks, 1).inGroup("Table"),
                ParamSpec::percent("x", "X", 0.0f, 1.0f, 0.0f).inGroup("Table").when("path", 0, 0),
                ParamSpec::percent("y", "Y", 0.0f, 1.0f, 0.0f).inGroup("Table").when("path", 0, 0),
                ParamSpec::percent("scan", "Scan", 0.0f, 1.0f, 0.0f).inGroup("Table").when("path", 1, 5),
                ParamSpec::percent("warp", "Warp", 0.0f, 1.0f, 0.0f).inGroup("Warp").namedBy(
                    "warpMode", {"Bend", "Sync", "Mirror", "Squash", "Steps"}),
                ParamSpec::percent("fmDepth", "FM Depth", 0.0f, 1.0f, 0.0f).inGroup("Warp"),
                ParamSpec::percent("stereo", "Stereo", -0.5f, 0.5f, 0.0f).inGroup("Output"),
                ParamSpec::percent("subLevel", "Sub Level", 0.0f, 1.0f, 0.0f).inGroup("Output"),
                ParamSpec::choice("path", "Path", {"Off (X/Y)", "Rows", "Snake", "Columns", "Diagonal", "Spiral"}, 0),
                ParamSpec::choice("blend", "Frame Blend", {"Smooth", "Step"}, 0),
                ParamSpec::choice("read", "Read", {"Cubic", "Linear", "Raw"}, 0),
                ParamSpec::choice("warpMode", "Warp Mode", {"Bend", "Sync", "Mirror", "Squash", "Steps"}, 0),
                ParamSpec::choice("quality", "Quality", {"Normal (1×)", "High (2×)"}, 0)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"fm", "FM", Signal::Audio}, {"sync", "Sync", Signal::Trigger}};
    s.outputs = {{"outL", "Out L", Signal::Audio, true},
                 {"outR", "Out R", Signal::Audio, true},
                 {"sub", "Sub", Signal::Audio, true},
                 {"posX", "Pos X", Signal::Control, false},
                 {"posY", "Pos Y", Signal::Control, false}};
    s.memoryHeavy = false;  // banks are shared by every instance and voice
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<WavetableOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerWavetableOscModule);

}  // namespace bleep::engine
