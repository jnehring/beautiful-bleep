// SPDX-License-Identifier: GPL-3.0-only
// Audio Console node (doc/specs/modules/audio-console.md): up to 32 channel strips with filters, EQ, pan, fader,
// mute, solo, aux sends and per-channel record arm; aux returns; a master with a limiter; direct outputs; and a
// multitrack recorder that hands its tracks to the recorder service (engine/Recording.h).
#include "AudioConsoleDsp.h"
#include "Handoff.h"
#include "Recording.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <string>

namespace bleep::engine {
namespace {

using patch::kConsoleAux;
using patch::kConsoleChannels;

// ---- the parameter layout ---------------------------------------------------------------------------------------------------
enum Global {
    Channels, AuxCount, Directs, DirectPoint, MainMono, Limiter,
    SendPoint,                                   // 4: send point of aux bus 1…4
    MasterLevel = SendPoint + kConsoleAux, MasterBal, MasterHp, MasterLp, MasterLo, MasterMid, MasterHi, MasterMute, MasterArm,
    ReturnBase,                                  // per aux bus: Level, Balance, Mute, Arm
    RecMode = ReturnBase + 4 * kConsoleAux, RecFormat, RecTap,
    ChannelBase
};
enum PerAux { RetLevel, RetBal, RetMute, AuxArm, PerAuxCount };
enum PerChannel { Level, Pan, Hp, Lp, Lo, Mid, Hi, Send, Mute = Send + kConsoleAux, Solo, Arm, Stereo, PerChannelCount };
constexpr int ch(int k, int f) { return ChannelBase + k * PerChannelCount + f; }
constexpr int ret(int j, int f) { return ReturnBase + j * PerAuxCount + f; }

// Inputs: In k L, In k R at 2k, 2k+1; then Return j L, R. Outputs: below.
constexpr int ReturnIn = 2 * kConsoleChannels;
enum Out { OutL, OutR, LevelOut, RecordingOut, SendOut };
constexpr int DirectOut = SendOut + 2 * kConsoleAux;

constexpr int kStereoSplit = 0;

ParamSpec fader(const std::string& id, const std::string& name, float def) {
    ParamSpec p = ParamSpec::number(id, name, dsp::kFaderFloorDb, 6.0f, def, "dB", 1);
    p.map = ParamSpec::Map::Skew;  // 0 dB sits at about 80 % of the travel, the bottom is silence
    p.centre = -12.0f;
    return p;
}

/// Send levels stop at 0 dB: thirty-two channels at +6 dB would put sixty-four times full scale on one bus.
ParamSpec sendFader(const std::string& id, const std::string& name) {
    ParamSpec p = ParamSpec::number(id, name, dsp::kFaderFloorDb, 0.0f, dsp::kFaderFloorDb, "dB", 1);
    p.map = ParamSpec::Map::Skew;
    p.centre = -12.0f;
    return p;
}

void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

constexpr int kMaxNames = kConsoleChannels;

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    juce::Array<juce::var> names;
    const auto* src = in.isObject() ? in["names"].getArray() : nullptr;
    for (int k = 0; k < kMaxNames; ++k) {
        const juce::String s = src && k < src->size() && (*src)[k].isString() ? (*src)[k].toString() : juce::String();
        names.add(s.substring(0, 24));
    }
    out->setProperty("names", names);
    // Which sections the view shows (EQ, filters, sends, S / M / R): all, until the user hides some.
    auto* shown = new juce::DynamicObject();
    for (const char* key : {"eq", "flt", "snd", "btn"}) {
        const juce::var v = in.isObject() && in["view"].isObject() ? in["view"][key] : juce::var();
        shown->setProperty(key, v.isVoid() ? 1 : ((int)v != 0 ? 1 : 0));
    }
    out->setProperty("view", juce::var(shown));
    // Where this console records: a full path, or nothing for the folder chosen in Settings.
    out->setProperty("folder", in.isObject() && in["folder"].isString() ? in["folder"].toString().trim().substring(0, 1024) : juce::String());
    return juce::JSON::toString(result, true).toStdString();
}

/// One recording session, as the audio thread sees it. The message thread owns the lifetime (see beginClose() and reap()).
struct SessionBox {
    struct Track {
        enum Kind { Channel, Aux, Master } kind = Channel;
        int index = 0, channels = 1;
    };
    mutable std::unique_ptr<recording::Session> session;
    std::vector<Track> plan;
    mutable std::atomic<bool> closing{false}, audioDone{false}, failed{false};
    double bytesPerSecond = 0.0;
};

class AudioConsoleModule final : public Module {
public:
    using Module::Module;

    ~AudioConsoleModule() override {
        // The module is going away and the audio is no longer running it: finish the session now.
        if (session_) {
            session_->closing.store(true, std::memory_order_release);
            session_->session.reset();
        }
    }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
#ifndef __wasm__
        recording::ensureDiskService();
#endif
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const juce::var v = juce::JSON::parse(juce::String(json));
        names_.clear();
        if (const auto* a = v.isObject() ? v["names"].getArray() : nullptr)
            for (const auto& s : *a) names_.push_back(s.toString().toStdString());
        folder_ = v.isObject() && v["folder"].isString() ? v["folder"].toString().toStdString() : std::string();
    }

    // ---- the view -------------------------------------------------------------------------------------------------------
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        reap();
        for (int k = 0; k < kConsoleChannels; ++k) out.push_back({"peak" + std::to_string(k + 1), (double)peak_[k].exchange(0.0f)});
        for (int j = 0; j < kConsoleAux; ++j) out.push_back({"auxPeak" + std::to_string(j + 1), (double)auxPeak_[j].exchange(0.0f)});
        out.push_back({"masterL", (double)masterL_.exchange(0.0f)});
        out.push_back({"masterR", (double)masterR_.exchange(0.0f)});
        out.push_back({"gr", (double)reduction_.load()});
        const recording::Service* svc = recording::service();
        // A host with no recorder (the browser today) reports no room at all; so does a disk with nothing left.
        const double room = svc ? svc->freeBytes() : 0.0;
        out.push_back({"recAvailable", room > 0.0 || session_ ? 1.0 : 0.0});
        out.push_back({"recFree", room});
        double rate = armedBytesPerSecond();
        double state = 0.0, seconds = 0.0, take = 0.0, failed = 0.0;
        if (session_ && !session_->closing.load()) {
            const recording::Status st = session_->session->status();
            state = st.takeOpen ? 2.0 : 1.0;
            seconds = sampleRate_ > 0.0 ? (double)st.frames / sampleRate_ : 0.0;
            take = st.take;
            failed = st.failed || session_->failed.load() ? 1.0 : 0.0;
            rate = session_->bytesPerSecond;
        }
        out.push_back({"recState", state});
        out.push_back({"recSeconds", seconds});
        out.push_back({"recTake", take});
        out.push_back({"recFailed", failed});
        out.push_back({"recRate", rate});
    }

    void liveText(std::vector<std::pair<std::string, std::string>>& out) const override {
        reap();
        const recording::Service* svc = recording::service();
        out.push_back({"recFolder", svc ? svc->where(folder_) : std::string()});
        std::string message = openError_;
        if (session_ && !session_->closing.load()) {
            const recording::Status st = session_->session->status();
            if (st.failed) message = st.message;
            else if (session_->failed.load()) message = "The disk could not keep up. The take was cut short.";
            out.push_back({"recSession", st.folder});
        }
        out.push_back({"recMessage", message});
    }

    /// The "Record" button: starts a session (the armed tracks are fixed from now until Stop) or stops it.
    void command(const std::string& id, float) override {
        if (id != "record") return;
        reap();
        if (!session_) openSession();
        else if (!session_->closing.load()) beginClose();
        else openError_ = "Still finishing the last recording.";
    }

    /// Polled by the engine ten times a second: lets a session that was stopped finish, even with the view closed.
    bool takeData(std::string&) override {
        reap();
        return false;
    }

    // ---- the audio ------------------------------------------------------------------------------------------------------
    void process(const ProcessContext& c) override {
        const int n = std::min(c.numSamples, (int)kChunk);
        patch::ConsoleParams p;
        p.channels = std::clamp((int)setting(Channels), 1, kConsoleChannels);
        p.aux = std::clamp((int)setting(AuxCount), 0, kConsoleAux);
        p.directs = std::clamp((int)setting(Directs), 0, p.channels);
        p.directPre = setting(DirectPoint) >= 0.5f;
        p.mono = setting(MainMono) >= 0.5f;
        p.limiter = setting(Limiter) >= 0.5f;
        p.tapPost = (int)setting(RecTap) == 1;
        for (int j = 0; j < kConsoleAux; ++j) {
            p.sendPre[j] = setting(SendPoint + j) >= 0.5f;
            p.returnDb[j] = value(c, ret(j, RetLevel), 0);
            p.returnBal[j] = value(c, ret(j, RetBal), 0);
            p.returnMute[j] = setting(ret(j, RetMute)) >= 0.5f;
        }
        readStrip(c, p.master, MasterLevel, MasterBal, MasterHp, MasterLp, MasterLo, MasterMid, MasterHi, MasterMute);
        for (int k = 0; k < p.channels; ++k) {
            auto& cp = p.ch[k];
            readStrip(c, cp.strip, ch(k, Level), ch(k, Pan), ch(k, Hp), ch(k, Lp), ch(k, Lo), ch(k, Mid), ch(k, Hi), ch(k, Mute));
            for (int j = 0; j < p.aux; ++j) cp.sendDb[j] = value(c, ch(k, Send + j), 0);
            cp.solo = setting(ch(k, Solo)) >= 0.5f;
            cp.stereo = setting(ch(k, Stereo)) >= 0.5f;
        }
        dsp_.update(p);

        // [audio thread] the session is only touched while it is not closing; see beginClose() and reap().
        const SessionBox* live = nullptr;
        if (const SessionBox* b = handoff_.get()) {
            if (b->closing.load(std::memory_order_acquire)) {
                if (takeOpen_) {
                    b->session->endTake();
                    takeOpen_ = false;
                }
                b->audioDone.store(true, std::memory_order_release);
            } else if (!b->failed.load(std::memory_order_relaxed)) {
                live = b;
            }
        }
        if (live) {
            const bool follow = (int)setting(RecMode) == 1;
            const bool want = !follow || (c.transport && c.transport->playing);
            if (want && !takeOpen_) takeOpen_ = live->session->beginTake();
            else if (!want && takeOpen_) {
                live->session->endTake();
                takeOpen_ = false;
            }
        }

        patch::ConsoleInputs in;
        patch::ConsoleFrame f;
        const bool retStereo[kConsoleAux] = {c.inputConnected[ReturnIn + 1], c.inputConnected[ReturnIn + 3],
                                             c.inputConnected[ReturnIn + 5], c.inputConnected[ReturnIn + 7]};
        float peaks[kConsoleChannels] = {}, auxPeaks[kConsoleAux] = {}, masterL = 0.0f, masterR = 0.0f;
        for (int i = 0; i < n; ++i) {
            for (int k = 0; k < p.channels; ++k) in.l[k] = c.inputs[2 * k][i], in.r[k] = c.inputs[2 * k + 1][i];
            for (int j = 0; j < p.aux; ++j) {
                in.returnL[j] = c.inputs[ReturnIn + 2 * j][i];
                in.returnR[j] = retStereo[j] ? c.inputs[ReturnIn + 2 * j + 1][i] : in.returnL[j];
            }
            dsp_.tick(in, p, f);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[LevelOut][i] = f.level;
            c.outputs[RecordingOut][i] = takeOpen_ ? 1.0f : 0.0f;
            for (int j = 0; j < p.aux; ++j) {
                c.outputs[SendOut + 2 * j][i] = f.sendL[j];
                c.outputs[SendOut + 2 * j + 1][i] = f.sendR[j];
                auxPeaks[j] = std::max(auxPeaks[j], f.auxPeak[j]);
            }
            for (int k = 0; k < p.directs; ++k) {
                c.outputs[DirectOut + 2 * k][i] = f.directL[k];
                c.outputs[DirectOut + 2 * k + 1][i] = f.directR[k];
            }
            for (int k = 0; k < p.channels; ++k) peaks[k] = std::max(peaks[k], f.peak[k]);
            masterL = std::max(masterL, std::fabs(f.outL));
            masterR = std::max(masterR, std::fabs(f.outR));
            if (takeOpen_) {
                for (int k = 0; k < p.channels; ++k) tapL_[k][i] = f.tapL[k], tapR_[k][i] = f.tapR[k];
                for (int j = 0; j < p.aux; ++j) auxTapL_[j][i] = f.sendL[j], auxTapR_[j][i] = f.sendR[j];
                masterTapL_[i] = f.outL, masterTapR_[i] = f.outR;
            }
        }
        for (int j = p.aux; j < kConsoleAux; ++j) std::fill(c.outputs[SendOut + 2 * j], c.outputs[SendOut + 2 * j] + n, 0.0f), std::fill(c.outputs[SendOut + 2 * j + 1], c.outputs[SendOut + 2 * j + 1] + n, 0.0f);
        if (takeOpen_ && live) {
            for (size_t t = 0; t < live->plan.size(); ++t) {
                const auto& tr = live->plan[t];
                const float* l = tr.kind == SessionBox::Track::Channel ? tapL_[tr.index] : tr.kind == SessionBox::Track::Aux ? auxTapL_[tr.index] : masterTapL_;
                const float* r = tr.kind == SessionBox::Track::Channel ? tapR_[tr.index] : tr.kind == SessionBox::Track::Aux ? auxTapR_[tr.index] : masterTapR_;
                const float* chans[2] = {l, r};
                if (!live->session->write((int)t, chans, n)) {
                    live->failed.store(true, std::memory_order_relaxed);
                    live->session->endTake();
                    takeOpen_ = false;
                    break;
                }
            }
        }
        for (int k = 0; k < kConsoleChannels; ++k) raise(peak_[k], peaks[k]);
        for (int j = 0; j < kConsoleAux; ++j) raise(auxPeak_[j], auxPeaks[j]);
        raise(masterL_, masterL);
        raise(masterR_, masterR);
        reduction_.store(dsp_.gainReduction());
    }

private:
    void readStrip(const ProcessContext& c, patch::ConsoleStripParams& s, int level, int pan, int hp, int lp, int lo, int mid, int hi, int mute) const {
        s.levelDb = value(c, level, 0);
        s.pan = value(c, pan, 0);
        s.hpHz = value(c, hp, 0);
        s.lpHz = value(c, lp, 0);
        s.loDb = value(c, lo, 0);
        s.midDb = value(c, mid, 0);
        s.hiDb = value(c, hi, 0);
        s.mute = setting(mute) >= 0.5f;
    }

    recording::Format format() const {
        const int f = (int)setting(RecFormat);
        return f == 0 ? recording::Format::Pcm16 : f == 1 ? recording::Format::Pcm24 : recording::Format::Float32;
    }

    std::string nameOf(int k) const {
        if (k < (int)names_.size() && !names_[(size_t)k].empty()) return names_[(size_t)k];
        return "Ch " + std::to_string(k + 1);
    }

    /// The tracks that are armed right now: channels, aux buses, master.
    std::vector<SessionBox::Track> armedTracks() const {
        std::vector<SessionBox::Track> plan;
        const int channels = std::clamp((int)setting(Channels), 1, kConsoleChannels), aux = std::clamp((int)setting(AuxCount), 0, kConsoleAux);
        for (int k = 0; k < channels; ++k)
            if (setting(ch(k, Arm)) >= 0.5f) plan.push_back({SessionBox::Track::Channel, k, setting(ch(k, Stereo)) >= 0.5f ? 2 : 1});
        for (int j = 0; j < aux; ++j)
            if (setting(ret(j, AuxArm)) >= 0.5f) plan.push_back({SessionBox::Track::Aux, j, 2});
        if (setting(MasterArm) >= 0.5f) plan.push_back({SessionBox::Track::Master, 0, 2});
        return plan;
    }

    double armedBytesPerSecond() const {
        int frames = 0;
        for (const auto& t : armedTracks()) frames += t.channels;
        return (double)frames * sampleRate_ * recording::bytesPerSample(format());
    }

    void openSession() {
        openError_.clear();
        recording::Service* svc = recording::service();
        if (!svc) {
            openError_ = "Recording is not available here.";
            return;
        }
        auto box = std::make_shared<SessionBox>();
        box->plan = armedTracks();
        std::vector<recording::TrackSpec> specs;
        double bytes = 0.0;
        for (const auto& t : box->plan) {
            recording::TrackSpec s;
            s.channels = t.channels;
            s.name = t.kind == SessionBox::Track::Channel ? nameOf(t.index) : t.kind == SessionBox::Track::Aux ? "Aux " + std::to_string(t.index + 1) : "Master";
            specs.push_back(s);
            bytes += (double)t.channels * sampleRate_ * recording::bytesPerSample(format());
        }
        box->bytesPerSecond = bytes;
        std::string error;
        box->session = svc->open("Audio Console", specs, sampleRate_, format(), &error, folder_);
        if (!box->session) {
            openError_ = error.empty() ? "Recording could not start." : error;
            return;
        }
        session_ = box;
        handoff_.publish(box);
    }

    /// Stops the recording. Nothing waits: the audio thread notices at its next block, ends the take and lets go of the session.
    void beginClose() {
        session_->closing.store(true, std::memory_order_release);
        closeAt_ = std::chrono::steady_clock::now();
    }

    /// Finishes a session that was stopped, once the audio thread has let go of it (or has not run for two seconds, so nobody is
    /// using it). Finishing the files takes a moment, which is why it is not done where the button is pressed.
    void reap() const {
        if (!session_ || !session_->closing.load(std::memory_order_acquire)) return;
        const bool released = session_->audioDone.load(std::memory_order_acquire) ||
                              std::chrono::steady_clock::now() - closeAt_ > std::chrono::seconds(2);
        if (!released) return;
        session_->session.reset();  // drains the buffers and finishes every file
        handoff_.publish(nullptr);
        session_.reset();
    }

    patch::AudioConsoleDsp dsp_;
    mutable RtHandoff<SessionBox> handoff_;
    mutable std::shared_ptr<SessionBox> session_;  // message thread
    mutable std::chrono::steady_clock::time_point closeAt_;
    std::string openError_;                // message thread
    std::vector<std::string> names_;       // message thread
    std::string folder_;                   // message thread: where this console records; empty = the Settings folder
    bool takeOpen_ = false;                // audio thread
    float tapL_[kConsoleChannels][kChunk] = {}, tapR_[kConsoleChannels][kChunk] = {};
    float auxTapL_[kConsoleAux][kChunk] = {}, auxTapR_[kConsoleAux][kChunk] = {};
    float masterTapL_[kChunk] = {}, masterTapR_[kChunk] = {};
    mutable std::atomic<float> peak_[kConsoleChannels] = {};
    mutable std::atomic<float> auxPeak_[kConsoleAux] = {};
    mutable std::atomic<float> masterL_{0.0f}, masterR_{0.0f};
    std::atomic<float> reduction_{1.0f};
};

}  // namespace

static void registerAudioConsoleModule(Registry& r) {
    ModuleSpec s;
    s.type = "audio-console";
    s.name = "Audio Console";
    s.category = "Audio/Mixing";
    s.colour = "#f97316";
    s.description = "Up to 32 channels with filters, EQ, sends, solo, mute and record arm; aux returns, master with limiter, direct outputs, and a multitrack recorder.";
    s.sanitiseData = sanitiseData;
    s.buttons = {{"record", "Record"}};

    s.params.push_back(ParamSpec::integer("channels", "Channels", 1, kConsoleChannels, 8).inGroup("Setup"));
    s.params.push_back(ParamSpec::integer("aux", "Aux Buses", 0, kConsoleAux, 2).inGroup("Setup"));
    s.params.push_back(ParamSpec::integer("directs", "Direct Outs", 0, kConsoleChannels, 0).inGroup("Setup"));
    s.params.push_back(ParamSpec::choice("directpoint", "Direct Point", {"Post-Fader", "Pre-Fader"}, 0).inGroup("Setup"));
    s.params.push_back(ParamSpec::toggle("mono", "Mono Main", false).inGroup("Setup"));
    s.params.push_back(ParamSpec::toggle("limiter", "Limiter", true).inGroup("Setup"));
    for (int j = 1; j <= kConsoleAux; ++j)
        s.params.push_back(ParamSpec::choice("sendpoint" + std::to_string(j), "Send Point " + std::to_string(j), {"Post-Fader", "Pre-Fader"}, 0)
                               .when("aux", j, kConsoleAux));
    s.params.push_back(fader("master_level", "Master", 0.0f));
    s.params.push_back(ParamSpec::number("master_bal", "Master Balance", -1.0f, 1.0f, 0.0f));
    s.params.push_back(ParamSpec::exponential("master_hp", "Master HP", 20.0f, 1000.0f, 20.0f, "Hz"));
    s.params.push_back(ParamSpec::exponential("master_lp", "Master LP", 1000.0f, 20000.0f, 20000.0f, "Hz"));
    s.params.push_back(ParamSpec::number("master_lo", "Master Lo", -15.0f, 15.0f, 0.0f, "dB", 1));
    s.params.push_back(ParamSpec::number("master_mid", "Master Mid", -15.0f, 15.0f, 0.0f, "dB", 1));
    s.params.push_back(ParamSpec::number("master_hi", "Master Hi", -15.0f, 15.0f, 0.0f, "dB", 1));
    s.params.push_back(ParamSpec::toggle("master_mute", "Master Mute", false));
    s.params.push_back(ParamSpec::toggle("master_arm", "Master Arm", true));
    for (int j = 1; j <= kConsoleAux; ++j) {
        const std::string n = std::to_string(j);
        s.params.push_back(fader("aux" + n + "_return", "Return " + n, 0.0f).when("aux", j, kConsoleAux));
        s.params.push_back(ParamSpec::number("aux" + n + "_bal", "Return " + n + " Balance", -1.0f, 1.0f, 0.0f).when("aux", j, kConsoleAux));
        s.params.push_back(ParamSpec::toggle("aux" + n + "_mute", "Return " + n + " Mute", false).when("aux", j, kConsoleAux));
        s.params.push_back(ParamSpec::toggle("aux" + n + "_arm", "Aux " + n + " Arm", false).when("aux", j, kConsoleAux));
    }
    s.params.push_back(ParamSpec::choice("recmode", "Start and Stop", {"Manual", "Follow Transport"}, 0).inGroup("Record"));
    s.params.push_back(ParamSpec::choice("recformat", "Format", {"WAV 16-bit", "WAV 24-bit", "WAV 32-bit float"}, 1).inGroup("Record"));
    s.params.push_back(ParamSpec::choice("rectap", "Channel Tap", {"Input", "Post-Fader"}, 0).inGroup("Record"));
    for (int k = 0; k < kConsoleChannels; ++k) {
        const std::string n = std::to_string(k + 1), pre = "ch" + n + "_", nm = "Ch " + n + " ";
        auto show = [&](ParamSpec p) { return p.when("channels", k + 1, kConsoleChannels); };
        s.params.push_back(show(fader(pre + "level", nm + "Level", 0.0f)));
        s.params.push_back(show(ParamSpec::number(pre + "pan", nm + "Pan", -1.0f, 1.0f, 0.0f)));
        s.params.push_back(show(ParamSpec::exponential(pre + "hp", nm + "HP", 20.0f, 1000.0f, 20.0f, "Hz")));
        s.params.push_back(show(ParamSpec::exponential(pre + "lp", nm + "LP", 1000.0f, 20000.0f, 20000.0f, "Hz")));
        s.params.push_back(show(ParamSpec::number(pre + "lo", nm + "Lo", -15.0f, 15.0f, 0.0f, "dB", 1)));
        s.params.push_back(show(ParamSpec::number(pre + "mid", nm + "Mid", -15.0f, 15.0f, 0.0f, "dB", 1)));
        s.params.push_back(show(ParamSpec::number(pre + "hi", nm + "Hi", -15.0f, 15.0f, 0.0f, "dB", 1)));
        for (int j = 1; j <= kConsoleAux; ++j) s.params.push_back(show(sendFader(pre + "send" + std::to_string(j), nm + "Send " + std::to_string(j))));
        s.params.push_back(show(ParamSpec::toggle(pre + "mute", nm + "Mute", false)));
        s.params.push_back(show(ParamSpec::toggle(pre + "solo", nm + "Solo", false)));
        s.params.push_back(show(ParamSpec::toggle(pre + "arm", nm + "Arm", false)));
        s.params.push_back(show(ParamSpec::toggle(pre + "stereo", nm + "Stereo", false)));
    }
    for (int k = 0; k < kConsoleChannels; ++k) {
        const std::string n = std::to_string(k + 1);
        s.inputs.push_back(JackSpec("in" + n + "l", "In " + n + " L", Signal::Audio).when("channels", k + 1, kConsoleChannels));
        s.inputs.push_back(JackSpec("in" + n + "r", "In " + n + " R", Signal::Audio)
                               .when("channels", k + 1, kConsoleChannels).andWhen("ch" + n + "_stereo", 1, 1));
    }
    for (int j = 1; j <= kConsoleAux; ++j) {
        const std::string n = std::to_string(j);
        s.inputs.push_back(JackSpec("return" + n + "l", "Return " + n + " L", Signal::Audio).when("aux", j, kConsoleAux));
        s.inputs.push_back(JackSpec("return" + n + "r", "Return " + n + " R", Signal::Audio).when("aux", j, kConsoleAux));
    }
    s.outputs = {{"outl", "Out L", Signal::Audio, true}, {"outr", "Out R", Signal::Audio, true},
                 {"level", "Level", Signal::Control, false}, {"recording", "Recording", Signal::Gate, false}};
    for (int j = 1; j <= kConsoleAux; ++j) {
        const std::string n = std::to_string(j);
        s.outputs.push_back(JackSpec("send" + n + "l", "Send " + n + " L", Signal::Audio, true).when("aux", j, kConsoleAux));
        s.outputs.push_back(JackSpec("send" + n + "r", "Send " + n + " R", Signal::Audio, true).when("aux", j, kConsoleAux));
    }
    for (int k = 0; k < kConsoleChannels; ++k) {
        const std::string n = std::to_string(k + 1);
        s.outputs.push_back(JackSpec("direct" + n + "l", "Direct " + n + " L", Signal::Audio, true).when("directs", k + 1, kConsoleChannels));
        s.outputs.push_back(JackSpec("direct" + n + "r", "Direct " + n + " R", Signal::Audio, true).when("directs", k + 1, kConsoleChannels));
    }
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioConsoleModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerAudioConsoleModule);

}  // namespace bleep::engine
