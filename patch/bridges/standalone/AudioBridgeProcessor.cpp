// SPDX-License-Identifier: MIT
//
// Bleep Audio Bridge (spec §11.3): a VST3 audio effect for Live that connects
// its track to the running Bleep Patch app. It needs no engine of its own:
// BridgeClient hands each block to the app and plays back the app's return.
#include "BridgeClient.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace bleep::bridge {

namespace {

/// Non-ASCII text (·, —, …) must reach juce::String as UTF-8.
inline juce::String u8(const char* text) { return juce::String::fromUTF8(text); }

const juce::Colour kBackground(0xff15171c), kPanel(0xff1d2027), kText(0xffe7e9ee), kMuted(0xff8b92a3),
    kAccent(0xffff9f43), kWarn(0xffff7a6b);
}

class AudioBridgeProcessor : public juce::AudioProcessor, private juce::Timer {
public:
    enum Monitor { Send, Return, Mix };

    AudioBridgeProcessor()
        : juce::AudioProcessor(BusesProperties()
                                   .withInput("Input", juce::AudioChannelSet::stereo(), true)
                                   .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
        monitor_ = new juce::AudioParameterChoice(juce::ParameterID("monitor", 1), "Monitor",
                                                  juce::StringArray{"Send", "Return", "Mix"}, Return);
        mix_ = new juce::AudioParameterFloat(juce::ParameterID("mix", 1), "Dry/Wet", 0.0f, 1.0f, 0.5f);
        addParameter(monitor_);
        addParameter(mix_);
        id_ = juce::Uuid().toDashedString();
        client_.setIdentity(id_.toStdString(), track_.toStdString());
        startTimerHz(5);
    }
    ~AudioBridgeProcessor() override { stopTimer(); }

    const juce::String getName() const override { return "Bleep Audio Bridge"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    bool isBusesLayoutSupported(const BusesLayout& l) const override {
        const auto out = l.getMainOutputChannelSet();
        return (out == juce::AudioChannelSet::mono() || out == juce::AudioChannelSet::stereo()) &&
               l.getMainInputChannelSet() == out;
    }

    void prepareToPlay(double sampleRate, int maxBlock) override {
        client_.prepare(sampleRate, maxBlock);
        latency_ = client_.latencySamples();
        setLatencySamples(latency_);  // Live's delay compensation lines the return up (spec §11.3)
        wet_.setSize(2, juce::jmax(1, maxBlock));
        delay_.setSize(2, latency_ + juce::jmax(1, maxBlock) + 1);
        delay_.clear();
        delayPos_ = 0;
    }
    void releaseResources() override {}

    void processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer&) override {
        juce::ScopedNoDenormals noDenormals;
        const int n = audio.getNumSamples(), channels = juce::jmin(2, audio.getNumChannels());
        if (channels == 0) return;
        if (wet_.getNumSamples() < n) wet_.setSize(2, n, false, false, true);

        Transport t;
        t.sampleRate = getSampleRate();
        if (auto* head = getPlayHead())
            if (auto pos = head->getPosition()) {
                if (auto s = pos->getTimeInSamples()) t.samplePos = *s;
                if (auto b = pos->getBpm()) t.bpm = *b;
                if (auto p = pos->getPpqPosition()) {
                    t.ppq = *p;
                    t.ppqValid = 1;
                }
                t.playing = pos->getIsPlaying() || pos->getIsRecording() ? 1 : 0;
            }
        const float* in[2] = {audio.getReadPointer(0), audio.getReadPointer(channels - 1)};
        float* ret[2] = {wet_.getWritePointer(0), wet_.getWritePointer(1)};
        const bool got = client_.process(in, ret, channels, n, t, isNonRealtime());

        // Dry is delayed by the reported latency, so dry, return and the rest of the set line up.
        const int monitor = monitor_->getIndex();
        const float mix = monitor == Send ? 0.0f : monitor == Return ? 1.0f : mix_->get();
        const int size = delay_.getNumSamples();
        for (int ch = 0; ch < channels; ++ch) {
            float* d = delay_.getWritePointer(ch);
            float* o = audio.getWritePointer(ch);
            const float* w = wet_.getReadPointer(ch);
            int pos = delayPos_;
            for (int i = 0; i < n; ++i) {
                d[pos] = o[i];
                int r = pos - latency_;
                if (r < 0) r += size;
                const float dry = d[r];
                o[i] = got ? dry + mix * (w[i] - dry) : dry;  // without the app: the track passes through
                if (++pos == size) pos = 0;
            }
        }
        delayPos_ = (delayPos_ + n) % size;
    }

    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;

    void getStateInformation(juce::MemoryBlock& dest) override {
        juce::XmlElement root("BleepAudioBridge");
        root.setAttribute("format", 1);
        root.setAttribute("id", id_);
        root.setAttribute("monitor", monitor_->getIndex());
        root.setAttribute("mix", mix_->get());
        copyXmlToBinary(root, dest);
    }
    void setStateInformation(const void* data, int size) override {
        auto xml = getXmlFromBinary(data, size);
        if (!xml || !xml->hasTagName("BleepAudioBridge")) return;
        const auto id = xml->getStringAttribute("id");
        if (id.length() == 36) id_ = id;  // the app knows the node by this ID
        *monitor_ = xml->getIntAttribute("monitor", Return);
        *mix_ = (float)xml->getDoubleAttribute("mix", 0.5);
        client_.setIdentity(id_.toStdString(), track_.toStdString());
    }
    void updateTrackProperties(const TrackProperties& p) override {
        track_ = p.name.value_or(juce::String());
        client_.setIdentity(id_.toStdString(), track_.toStdString());
    }

    BridgeClient& client() noexcept { return client_; }
    juce::AudioParameterChoice* monitor() const noexcept { return monitor_; }
    juce::AudioParameterFloat* mix() const noexcept { return mix_; }
    juce::String track() const { return track_; }
    int latency() const noexcept { return latency_; }

private:
    void timerCallback() override {
        // A duplicated device arrives with an ID another bridge already uses: take a new one.
        if (client_.poll() == BridgeClient::Status::Connected && client_.idTaken()) {
            id_ = juce::Uuid().toDashedString();
            client_.setIdentity(id_.toStdString(), track_.toStdString());
        }
    }

    BridgeClient client_;
    juce::AudioParameterChoice* monitor_ = nullptr;
    juce::AudioParameterFloat* mix_ = nullptr;
    juce::String id_, track_;
    juce::AudioBuffer<float> wet_, delay_;
    int delayPos_ = 0;
    int latency_ = 0;
};

class AudioBridgeEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit AudioBridgeEditor(AudioBridgeProcessor& p) : juce::AudioProcessorEditor(p), processor_(p) {
        title_.setText("Bleep Audio Bridge", juce::dontSendNotification);
        title_.setFont(juce::FontOptions(15.0f, juce::Font::bold));
        title_.setColour(juce::Label::textColourId, kAccent);
        addAndMakeVisible(title_);
        status_.setColour(juce::Label::textColourId, kMuted);
        status_.setFont(juce::FontOptions(12.0f));
        status_.setJustificationType(juce::Justification::topLeft);
        addAndMakeVisible(status_);
        monitorLabel_.setText("Monitor", juce::dontSendNotification);
        monitorLabel_.setColour(juce::Label::textColourId, kText);
        addAndMakeVisible(monitorLabel_);
        monitor_.addItemList({"Send", "Return", "Mix"}, 1);
        monitorAttachment_ = std::make_unique<juce::ComboBoxParameterAttachment>(*p.monitor(), monitor_);
        addAndMakeVisible(monitor_);
        mix_.setSliderStyle(juce::Slider::LinearHorizontal);
        mix_.setTextBoxStyle(juce::Slider::TextBoxRight, false, 56, 20);
        mix_.setColour(juce::Slider::trackColourId, kAccent);
        mixAttachment_ = std::make_unique<juce::SliderParameterAttachment>(*p.mix(), mix_);
        addAndMakeVisible(mix_);
        openApp_.onClick = [] {
#if JUCE_MAC
            juce::ChildProcess open;
            open.start(juce::StringArray{"/usr/bin/open", "-b", "com.brilliantbleep.patch.app"});
#endif
        };
        addAndMakeVisible(openApp_);
        setSize(400, 176);
        timerCallback();
        startTimerHz(4);
    }
    ~AudioBridgeEditor() override { stopTimer(); }

    void paint(juce::Graphics& g) override {
        g.fillAll(kBackground);
        if (processor_.client().status() != BridgeClient::Status::Connected) {
            g.setColour(kWarn);
            g.fillRect(0, 0, 4, getHeight());
        }
    }
    void resized() override {
        auto r = getLocalBounds().reduced(14, 10);
        auto top = r.removeFromTop(26);
        openApp_.setBounds(top.removeFromRight(110));
        title_.setBounds(top);
        r.removeFromTop(8);
        auto row = r.removeFromTop(26);
        monitorLabel_.setBounds(row.removeFromLeft(70));
        monitor_.setBounds(row.removeFromLeft(110));
        row.removeFromLeft(10);
        mix_.setBounds(row);
        r.removeFromTop(8);
        status_.setBounds(r);
    }

private:
    void timerCallback() override {
        juce::String s;
        switch (processor_.client().status()) {
            case BridgeClient::Status::Connected:
                s << "Connected to the Bleep Patch app" << (processor_.track().isNotEmpty() ? " as \"" + processor_.track() + "\"" : "")
                  << ".\nLatency " << processor_.latency() << " samples";
                if (processor_.client().drops() > 0) s << u8(" · late blocks ") << (int)processor_.client().drops();
                break;
            case BridgeClient::Status::AppNotRunning:
                s = "The Bleep Patch app is not running. The track passes through.";
                break;
            case BridgeClient::Status::OtherHost:
                s = "The Bleep Patch app is connected to another host.";
                break;
            case BridgeClient::Status::NoFreeSlot:
                s = "The Bleep Patch app has no free bridge slot.";
                break;
        }
        status_.setText(s, juce::dontSendNotification);
        mix_.setEnabled(processor_.monitor()->getIndex() == AudioBridgeProcessor::Mix);
        repaint();
    }

    AudioBridgeProcessor& processor_;
    juce::Label title_, status_, monitorLabel_;
    juce::ComboBox monitor_;
    juce::Slider mix_;
    juce::TextButton openApp_{"Open App"};
    std::unique_ptr<juce::ComboBoxParameterAttachment> monitorAttachment_;
    std::unique_ptr<juce::SliderParameterAttachment> mixAttachment_;
};

juce::AudioProcessorEditor* AudioBridgeProcessor::createEditor() { return new AudioBridgeEditor(*this); }

}  // namespace bleep::bridge

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bleep::bridge::AudioBridgeProcessor(); }
