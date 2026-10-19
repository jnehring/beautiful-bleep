// SPDX-License-Identifier: GPL-3.0-or-later
// OSC Bridge node (doc/specs/modules/osc-bridge.md): six receive lanes turn the arguments of OSC
// messages into signals, gates and triggers; six send lanes turn signals into messages. The lanes
// live in the node's data; the UDP port (OscPort.h) is opened only while the module is switched on.
#include "OscBridgeDsp.h"
#include "OscPort.h"
#include "Handoff.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>

namespace bleep::engine {
namespace {

using namespace patch;

double num(const juce::var& v, double def, double lo, double hi) {
    return (v.isInt() || v.isInt64() || v.isDouble()) ? std::clamp((double)v, lo, hi) : def;
}
void copyText(char* dst, const juce::var& v, const char* def) {
    juce::String s = v.isString() ? v.toString() : juce::String(def);
    s = s.retainCharacters("/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.:*?[]{}!,~ +#=@%&()$");
    std::memset(dst, 0, osc::kMaxAddress);
    if (s.isNotEmpty() && s[0] != '/') s = "/" + s;
    std::strncpy(dst, s.toRawUTF8(), osc::kMaxAddress - 1);
}

OscBridgeConfig parseConfig(const std::string& json, juce::String* host = nullptr) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    OscBridgeConfig c;
    const juce::var rx = in["receive"], tx = in["send"];
    for (int i = 0; i < kOscLanes; ++i) {
        const juce::var r = rx.isArray() && i < rx.size() ? rx[i] : juce::var();
        OscReceiveLane& l = c.receive[(size_t)i];
        const juce::String def = "/bleep/in/" + juce::String(i + 1);
        copyText(l.pattern, r["pattern"], r.isVoid() ? def.toRawUTF8() : "");
        l.arg = (int)num(r["arg"], 0, 0, osc::kMaxArgs - 1);
        l.mode = (int)num(r["mode"], OscReceiveValue, 0, 2);
        l.lo = (float)num(r["lo"], 0.0, -1.0e6, 1.0e6);
        l.hi = (float)num(r["hi"], 1.0, -1.0e6, 1.0e6);
        l.bipolar = (bool)num(r["bipolar"], 0, 0, 1);
        l.smooth = (float)num(r["smooth"], 0.01, 0.0, 5.0);
        const juce::var s = tx.isArray() && i < tx.size() ? tx[i] : juce::var();
        OscSendLane& o = c.send[(size_t)i];
        const juce::String sdef = "/bleep/out/" + juce::String(i + 1);
        copyText(o.address, s["address"], s.isVoid() ? sdef.toRawUTF8() : "");
        o.mode = (int)num(s["mode"], OscSendValue, 0, 2);
        o.lo = (float)num(s["lo"], 0.0, -1.0e6, 1.0e6);
        o.hi = (float)num(s["hi"], 1.0, -1.0e6, 1.0e6);
        o.bipolar = (bool)num(s["bipolar"], 0, 0, 1);
        o.rate = (float)num(s["rate"], 50.0, 1.0, 500.0);
    }
    if (host) {
        const juce::String h = in["host"].isString() ? in["host"].toString().trim() : juce::String("127.0.0.1");
        *host = h.isNotEmpty() && h.length() <= 253 ? h : juce::String("127.0.0.1");
    }
    return c;
}

std::string sanitiseData(const std::string& json) {
    juce::String host;
    const OscBridgeConfig c = parseConfig(json, &host);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("host", host.retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:"));
    juce::Array<juce::var> rx, tx;
    for (int i = 0; i < kOscLanes; ++i) {
        const OscReceiveLane& l = c.receive[(size_t)i];
        auto* r = new juce::DynamicObject();
        r->setProperty("pattern", juce::String(l.pattern));
        r->setProperty("arg", l.arg);
        r->setProperty("mode", l.mode);
        r->setProperty("lo", (double)l.lo);
        r->setProperty("hi", (double)l.hi);
        r->setProperty("bipolar", l.bipolar ? 1 : 0);
        r->setProperty("smooth", (double)l.smooth);
        rx.add(juce::var(r));
        const OscSendLane& o = c.send[(size_t)i];
        auto* s = new juce::DynamicObject();
        s->setProperty("address", juce::String(o.address));
        s->setProperty("mode", o.mode);
        s->setProperty("lo", (double)o.lo);
        s->setProperty("hi", (double)o.hi);
        s->setProperty("bipolar", o.bipolar ? 1 : 0);
        s->setProperty("rate", (double)o.rate);
        tx.add(juce::var(s));
    }
    out->setProperty("receive", rx);
    out->setProperty("send", tx);
    return juce::JSON::toString(result, true).toStdString();
}

class OscBridgeModule final : public Module {
public:
    enum { Active, Listen, Access, SendPort };
    enum { Activity = kOscLanes };

    explicit OscBridgeModule(const ModuleSpec& spec) : Module(spec) { OscPort::instance().addSender(&queue_); }
    ~OscBridgeModule() override {
        OscPort::instance().removeSender(&queue_);
        OscPort::instance().release(this);
    }

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        cursor_ = OscPort::instance().inbox().head();
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        juce::String host;
        auto cfg = std::make_shared<OscBridgeConfig>(parseConfig(json, &host));
        host_ = host;
        config_.publish(std::move(cfg));
        apply();
    }

    /// Polled by the engine ten times a second on the message thread: the knobs are applied to the port here.
    bool takeData(std::string&) override {
        apply();
        return false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"status", (double)status_.load()});
        out.push_back({"received", (double)dsp_.received()});
        out.push_back({"sent", (double)OscPort::instance().sent()});
        out.push_back({"argc", (double)lastArgc_.load()});
    }

    /// "last": the newest message as characters of its address, then 0, then its arguments.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v;
        for (const auto& c : lastAddress_) {
            const uint8_t ch = c.load(std::memory_order_relaxed);
            if (ch == 0) break;
            v.push_back((float)ch);
        }
        v.push_back(0.0f);
        const int n = lastArgc_.load();
        for (int i = 0; i < n && i < osc::kMaxArgs; ++i) v.push_back(lastArgs_[(size_t)i].load(std::memory_order_relaxed));
        out.push_back({"last", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        static const OscBridgeConfig kEmpty{};
        const OscBridgeConfig* cfg = config_.get();
        if (!cfg) cfg = &kEmpty;
        OscPort& port = OscPort::instance();
        const bool on = setting(Active) > 0.5f;
        bool any = false;
        if (on) {
            osc::Message m;
            while (port.inbox().read(cursor_, m)) {
                dsp_.onMessage(*cfg, m);
                any = true;
                std::memcpy(addressScratch_, m.address, sizeof addressScratch_);
                for (size_t i = 0; i < sizeof addressScratch_; ++i) lastAddress_[i].store((uint8_t)addressScratch_[i], std::memory_order_relaxed);
                for (int i = 0; i < m.argc; ++i) lastArgs_[(size_t)i].store(m.args[i], std::memory_order_relaxed);
                lastArgc_.store(m.argc, std::memory_order_relaxed);
            }
        } else {
            cursor_ = port.inbox().head();
        }
        if (any) activityLeft_ = (int)(0.002 * sampleRate_);
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kOscLanes; ++k) {
                c.outputs[k][i] = dsp_.receive(*cfg, k);
                if (on) dsp_.send(*cfg, k, c.inputs[k][i], queue_);
            }
            c.outputs[Activity][i] = activityLeft_ > 0 ? 1.0f : 0.0f;
            if (activityLeft_ > 0) --activityLeft_;
        }
        status_.store((int)port.status(), std::memory_order_relaxed);
    }

private:
    /// [message thread] Tells the port what the knobs say.
    void apply() {
        OscPort::Config want;
        want.active = knobValue(Active) > 0.5f;
        want.listenPort = (int)std::lround(knobValue(Listen));
        want.network = (int)std::lround(knobValue(Access)) == 1;
        want.host = host_;
        want.sendPort = (int)std::lround(knobValue(SendPort));
        status_.store((int)OscPort::instance().configure(this, want), std::memory_order_relaxed);
    }
    float knobValue(int i) const { return spec().params[(size_t)i].fromNormalised(knob(i)); }

    OscBridgeDsp dsp_;
    OscOutQueue queue_;
    RtHandoff<OscBridgeConfig> config_;
    juce::String host_ = "127.0.0.1";
    uint64_t cursor_ = 0;
    int activityLeft_ = 0;
    char addressScratch_[osc::kMaxAddress] = {};
    std::atomic<int> status_{0};
    std::array<std::atomic<uint8_t>, osc::kMaxAddress> lastAddress_{};
    std::array<std::atomic<float>, osc::kMaxArgs> lastArgs_{};
    std::atomic<int> lastArgc_{0};
};

}  // namespace

static void registerOscBridgeModule(Registry& r) {
    ModuleSpec s;
    s.type = "osc-bridge";
    s.name = "OSC Bridge";
    s.category = "Utility";
    s.colour = "#fde047";
    s.description = "Talks OSC over the network: messages that match an address pattern become signals, gates or triggers; "
                    "signals are sent as messages. Off until switched on.";
    s.params = {ParamSpec::toggle("active", "Network On", false),
                ParamSpec::integer("listen", "Listen Port", 1024, 65535, 9000),
                ParamSpec::choice("access", "Accept From", {"This Computer", "Local Network"}, 0),
                ParamSpec::integer("sendport", "Send Port", 1, 65535, 9001)};
    for (int i = 0; i < kOscLanes; ++i)
        s.inputs.push_back({"cv" + std::to_string(i + 1), "Send " + std::to_string(i + 1), Signal::Control});
    for (int i = 0; i < kOscLanes; ++i) s.outputs.push_back({"out" + std::to_string(i + 1), "Receive " + std::to_string(i + 1), Signal::Control, true});
    s.outputs.push_back({"activity", "Activity", Signal::Trigger, false});
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<OscBridgeModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerOscBridgeModule);

}  // namespace bleep::engine
