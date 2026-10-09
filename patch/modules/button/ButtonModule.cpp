// SPDX-License-Identifier: MIT
// Button node (doc/specs/modules/button.md): a pad in the module view; pressing
// it gives a gate, triggers and a toggle.
#include "ButtonDsp.h"
#include "ControlQueue.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

enum { Press, Release, SetLatched };

/// The node's data: {"on": bool}, the toggle's state.
bool parseOn(const std::string& json) {
    const juce::var d = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    return (bool)d.getProperty("on", false);
}

std::string sanitiseData(const std::string& json) {
    auto* o = new juce::DynamicObject();
    o->setProperty("on", parseOn(json));
    return juce::JSON::toString(juce::var(o), true).toStdString();
}

class ButtonModule final : public Module {
public:
    enum { Mode };
    enum { Gate, Trigger, ReleaseOut, Toggle };

    using Module::Module;

    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        if (json == data_) return;
        data_ = json;
        queue_.push({SetLatched, parseOn(json) ? 1 : 0, 0.0f});
    }

    /// "press" [latch?] and "release".
    void perform(const std::string& action, const std::vector<double>& args) override {
        if (action == "press") queue_.push({Press, args.empty() ? -1 : (args[0] >= 0.5 ? 1 : 0), 0.0f});
        else if (action == "release") queue_.push({Release, 0, 0.0f});
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"held", held_.load() ? 1.0 : 0.0});
        out.push_back({"on", on_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        const int mode = (int)setting(Mode);
        patch::ButtonFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            // One event per sample, so a quick tap still shows as a gate.
            ControlEvent e;
            if (queue_.pop(e)) {
                if (e.type == Press) dsp_.press(e.value);
                else if (e.type == Release) dsp_.release();
                else dsp_.setLatched(e.value != 0);
            }
            dsp_.tick(mode, f);
            c.outputs[Gate][i] = f.gate;
            c.outputs[Trigger][i] = f.trigger;
            c.outputs[ReleaseOut][i] = f.release;
            c.outputs[Toggle][i] = f.toggle;
        }
        held_.store(dsp_.held());
        on_.store(dsp_.latched());
    }

private:
    patch::ButtonDsp dsp_;
    ControlQueue<> queue_;
    std::string data_;  // message thread
    std::atomic<bool> held_{false}, on_{false};
};

}  // namespace

void registerButtonModule(Registry& r) {
    ModuleSpec s;
    s.type = "button";
    s.name = "Button";
    s.category = "Controllers";
    s.colour = "#fda4af";
    s.description = "A pad to press: gate while held (or toggled), triggers on press and release.";
    s.params = {ParamSpec::choice("mode", "Mode", {"Momentary", "Toggle"}, 0)};
    s.outputs = {{"gate", "Gate", Signal::Gate, false},
                 {"trigger", "Trigger", Signal::Trigger, false},
                 {"release", "Release", Signal::Trigger, false},
                 {"toggle", "Toggle", Signal::Gate, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ButtonModule>(spec); });
}

}  // namespace bleep::engine
