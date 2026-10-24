// SPDX-License-Identifier: GPL-3.0-only
// Splice node (doc/specs/modules/splice.md): a reel recorder and splice player.
// The reel's audio lives in the media store: the view saves it with
// exportMedia("reel") and keeps the id in the node's data together with the
// markers; setData loads a reel (resampled to the engine rate) and hands it
// to the audio thread, which copies it in a slice per chunk. The audio thread
// owns the structure while recording; it is mirrored to the view through
// liveValues / liveArrays (the view writes it back into the data).
#include "Handoff.h"
#include "Media.h"
#include "Registry.h"
#include "SpliceDsp.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>
#include <deque>

namespace bleep::engine {
namespace {

using patch::SpliceDsp;
namespace splice = patch::splice;

constexpr int64_t kLoadFramesPerChunk = 65536;

struct ReelData {
    std::string reel;
    int64_t length = 0;
    std::vector<int64_t> markers;
    int current = 0;
};

ReelData parse(const juce::var& in) {
    ReelData d;
    const juce::String id = in.getProperty("reel", juce::String()).toString();
    d.reel = media::validId(id.toStdString()) ? id.toStdString() : std::string();
    const juce::var len = in.getProperty("length", 0);
    d.length = len.isInt() || len.isInt64() || len.isDouble() ? std::max<int64_t>(0, (int64_t)(double)len) : 0;
    if (const auto* m = in["markers"].getArray())
        for (const auto& v : *m)
            if (v.isInt() || v.isInt64() || v.isDouble()) {
                const int64_t x = (int64_t)(double)v;
                if (x > 0 && (d.length == 0 || x < d.length)) d.markers.push_back(x);
            }
    std::sort(d.markers.begin(), d.markers.end());
    d.markers.erase(std::unique(d.markers.begin(), d.markers.end()), d.markers.end());
    if ((int)d.markers.size() > splice::kMaxMarkers) d.markers.resize((size_t)splice::kMaxMarkers);
    if (d.length == 0 && d.reel.empty()) d.markers.clear();
    const juce::var cur = in.getProperty("current", 0);
    d.current = std::clamp(cur.isInt() || cur.isInt64() || cur.isDouble() ? (int)(double)cur : 0, 0, (int)d.markers.size());
    return d;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const ReelData d = parse(in);
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("reel", juce::String(d.reel));
    out->setProperty("length", (juce::int64)d.length);
    juce::Array<juce::var> markers;
    for (int64_t m : d.markers) markers.add((juce::int64)m);
    out->setProperty("markers", markers);
    out->setProperty("current", d.current);
    auto* names = new juce::DynamicObject();
    if (const auto* o = in["names"].getDynamicObject())
        for (const auto& p : o->getProperties()) {
            const int k = p.name.toString().getIntValue();
            if (p.name.toString() == juce::String(k) && k >= 0 && k < splice::kMaxSplices && p.value.isString())
                names->setProperty(p.name, p.value.toString().substring(0, 64));
        }
    out->setProperty("names", juce::var(names));
    return juce::JSON::toString(result, true).toStdString();
}

/// The clip at `sampleRate` (cubic resampling when the file's rate differs).
std::shared_ptr<const MediaClip> atRate(std::shared_ptr<const MediaClip> clip, double sampleRate) {
    if (!clip || clip->numFrames() < 2 || std::fabs(clip->sampleRate - sampleRate) < 1e-6) return clip;
    auto out = std::make_shared<MediaClip>();
    out->id = clip->id;
    out->name = clip->name;
    out->sampleRate = sampleRate;
    const double step = clip->sampleRate / sampleRate;
    const int64_t n = clip->numFrames(), frames = (int64_t)std::floor((double)(n - 1) / step) + 1;
    for (const auto& ch : clip->channels) {
        std::vector<float> v((size_t)frames);
        const auto at = [&](int64_t i) { return ch[(size_t)std::clamp<int64_t>(i, 0, n - 1)]; };
        for (int64_t i = 0; i < frames; ++i) {
            const double pos = (double)i * step;
            const int64_t k = (int64_t)pos;
            v[(size_t)i] = dsp::hermite4(at(k - 1), at(k), at(k + 1), at(k + 2), (float)(pos - (double)k));
        }
        out->channels.push_back(std::move(v));
    }
    return out;
}

class SpliceModule final : public Module {
public:
    enum { Speed, Window, Position, Overlap, Pick, Overdub, Level, Fade,
           Reel, RecordMode, RecordTarget, Shift, EndMode, Loop, Monitor, Sync, Seed };
    enum { InL, InR, Record, Mark, Next, Select, Play, SpeedIn };
    enum { OutL, OutR, End, PositionOut, SpliceOut };
    enum { RecButton, MarkButton, NextButton, PlayButton, ClearButton, SelectCommand };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void command(const std::string& id, float value) override {
        if (id == "select") postCommand(SelectCommand, value);
        else Module::command(id, value);
    }

    void setData(const std::string& json) override {
        if (json == lastJson_ && !missing_.load()) return;  // a reel that was missing is asked for again when its data comes again
        lastJson_ = json;
        releaseLoaded();
        const ReelData d = parse(juce::JSON::parse(juce::String(json)));
        auto msg = std::make_shared<Message>();
        msg->serial = ++serial_;
        msg->markers = d.markers;
        msg->current = d.current;
        if (d.reel != reelId_ || (missing_.load() && !d.reel.empty())) {
            const std::string previous = reelId_;
            reelId_ = d.reel;
            if (!d.reel.empty() && pendingExport_) {  // the reel we just saved: already in memory
                pendingExport_ = false;
                missing_.store(false);
                return publishEditIfChanged(d);
            }
            if (d.reel.empty()) {
                missing_.store(false);
                if (previous.empty()) return publishEditIfChanged(d);
                msg->load = true;  // cleared: an empty reel
            } else {
                auto clip = atRate(media::load(d.reel), sampleRate_);
                missing_.store(!clip);
                if (!clip) return publishEditIfChanged(d);  // missing: empty reel, markers kept in the data
                msg->load = true;
                msg->clip = clip.get();
                loaded_.push_back({msg->serial, clip});
            }
            handoff_.publish(msg);
            return;
        }
        publishEditIfChanged(d);
    }

    std::shared_ptr<const MediaClip> exportMedia(const std::string& slot) override {
        if (slot != "reel" && slot != "splice") return nullptr;
        const Snapshot s = snapshot();
        int64_t from = 0, to = s.length;
        if (slot == "splice" && s.length > 0) {
            from = s.current <= 0 ? 0 : s.markers[(size_t)std::min(s.current, (int)s.markers.size()) - 1];
            to = s.current < (int)s.markers.size() ? s.markers[(size_t)s.current] : s.length;
        }
        if (to - from < 1) return nullptr;
        auto out = std::make_shared<MediaClip>();
        out->name = slot == "reel" ? "Splice reel" : "Splice";
        out->sampleRate = sampleRate_;
        for (int c = 0; c < 2; ++c) out->channels.emplace_back(dsp_.channel(c) + from, dsp_.channel(c) + to);
        if (slot == "reel") {
            pendingExport_ = true;
            exportedAudioRev_.store(audioRev_.load());
        }
        return out;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        releaseLoaded();
        const Snapshot s = snapshot();
        out.push_back({"length", (double)s.length});
        out.push_back({"splices", s.length > 0 ? (double)s.markers.size() + 1.0 : 0.0});
        out.push_back({"current", (double)s.current});
        out.push_back({"pending", (double)pending_.load()});
        out.push_back({"recording", recording_.load() ? 1.0 : 0.0});
        out.push_back({"loading", loading_.load() ? 1.0 : 0.0});
        out.push_back({"missing", missing_.load() ? 1.0 : 0.0});
        out.push_back({"dirty", audioRev_.load() != exportedAudioRev_.load() && s.length > 0 ? 1.0 : 0.0});
        out.push_back({"rev", (double)s.rev});
        out.push_back({"capacity", splice::reelSeconds((int)setting(Reel)) * sampleRate_});
        out.push_back({"sampleRate", sampleRate_});
        out.push_back({"winStart", winStart_.load()});
        out.push_back({"winLength", winLength_.load()});
    }
    /// "markers" (frames), "peaks" (|L|,|R| max over 512 bins of the reel),
    /// "heads" (each playing voice's position, frames).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const Snapshot s = snapshot();
        std::vector<float> m;
        for (int64_t x : s.markers) m.push_back((float)x);
        out.push_back({"markers", std::move(m)});
        constexpr int kBins = 512;
        std::vector<float> peaks(kBins, 0.0f);
        if (s.length > 0) {
            for (int b = 0; b < kBins; ++b) {
                const int64_t from = s.length * b / kBins, to = std::max(s.length * (b + 1) / kBins, from + 1);
                const int64_t stride = std::max<int64_t>(1, (to - from) / 32);
                float v = 0.0f;
                for (int64_t i = from; i < to; i += stride)
                    v = std::max(v, std::max(std::fabs(dsp_.channel(0)[(size_t)i]), std::fabs(dsp_.channel(1)[(size_t)i])));
                peaks[(size_t)b] = v;
            }
        }
        out.push_back({"peaks", std::move(peaks)});
        std::vector<float> heads;
        const int n = headCount_.load();
        for (int i = 0; i < n; ++i) heads.push_back((float)heads_[i].load(std::memory_order_relaxed));
        out.push_back({"heads", std::move(heads)});
    }

    void process(const ProcessContext& c) override {
        if (const Message* m = handoff_.get(); m && m->serial != applied_) {
            applied_ = m->serial;
            if (m->load) {
                const MediaClip* clip = m->clip;
                const float* ch[2] = {nullptr, nullptr};
                int channels = 0;
                if (clip && clip->numChannels() > 0) {
                    channels = std::min(clip->numChannels(), 2);
                    for (int k = 0; k < channels; ++k) ch[k] = clip->channels[(size_t)k].data();
                }
                dsp_.beginLoad(ch, channels, clip ? clip->numFrames() : 0, m->markers.data(), (int)m->markers.size(), m->current);
                loadSerial_ = m->serial;
            } else {
                dsp_.setMarkers(m->markers.data(), (int)m->markers.size(), m->current);
            }
        }
        dsp_.serviceLoad(kLoadFramesPerChunk);
        if (!dsp_.loading() && loadSerial_ != 0) {
            loadDone_.store(loadSerial_);
            loadSerial_ = 0;
        }
        pollCommands([&](const Command& cmd) {
            switch (cmd.index) {
                case RecButton: dsp_.recordButton(); break;
                case MarkButton: dsp_.markButton(); break;
                case NextButton: dsp_.nextButton(); break;
                case PlayButton: dsp_.playButton(); break;
                case ClearButton: dsp_.clearReel(); break;
                case SelectCommand: dsp_.selectSplice((int)std::lround(cmd.value)); break;
                default: break;
            }
        });

        const Transport& tr = *c.transport;
        patch::SpliceParams p;
        p.reel = (int)setting(Reel);
        p.toggle = setting(RecordMode) >= 0.5f;
        p.target = (int)setting(RecordTarget);
        p.shift = (int)setting(Shift);
        p.endWindow = setting(EndMode) >= 0.5f;
        p.oneShot = setting(Loop) >= 0.5f;
        p.monitor = (int)setting(Monitor);
        p.sync = (int)setting(Sync);
        p.seed = (uint32_t)setting(Seed);
        patch::SpliceInput in;
        in.selectPatched = c.inputConnected[Select];
        in.running = tr.playing && tr.ppqValid;
        in.bpm = tr.bpm;
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        patch::SpliceFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.speed = value(c, Speed, i);
            p.window = value(c, Window, i);
            p.position = value(c, Position, i);
            p.overlap = value(c, Overlap, i);
            p.pick = value(c, Pick, i);
            p.overdub = value(c, Overdub, i);
            p.level = value(c, Level, i);
            p.fadeSeconds = value(c, Fade, i);
            in.l = c.inputs[InL][i];
            in.r = inR[i];
            in.record = c.inputs[Record][i];
            in.mark = c.inputs[Mark][i];
            in.next = c.inputs[Next][i];
            in.select = c.inputs[Select][i];
            in.play = c.inputs[Play][i];
            in.speed = c.inputs[SpeedIn][i];
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[End][i] = f.end;
            c.outputs[PositionOut][i] = f.position;
            c.outputs[SpliceOut][i] = f.splice;
        }
        publishState();
    }

private:
    struct Message {
        uint64_t serial = 0;
        bool load = false;
        const MediaClip* clip = nullptr;  // kept alive by loaded_ until the copy is done
        std::vector<int64_t> markers;
        int current = 0;
    };
    struct Snapshot {
        int64_t length = 0;
        std::vector<int64_t> markers;
        int current = 0;
        uint32_t rev = 0;
    };

    /// [audio thread] Mirrors the structure for the message thread (seqlock).
    void publishState() noexcept {
        if (dsp_.revision() != publishedRev_ || dsp_.length() != length_.load(std::memory_order_relaxed)) {
            publishedRev_ = dsp_.revision();
            seq_.fetch_add(1, std::memory_order_acq_rel);  // odd: writing
            length_.store(dsp_.length(), std::memory_order_relaxed);
            const int n = dsp_.markerCount();
            for (int i = 0; i < n; ++i) markers_[i].store(dsp_.marker(i), std::memory_order_relaxed);
            markerCount_.store(n, std::memory_order_relaxed);
            current_.store(dsp_.current(), std::memory_order_relaxed);
            rev_.store(dsp_.revision(), std::memory_order_relaxed);
            seq_.fetch_add(1, std::memory_order_release);
        }
        pending_.store(dsp_.pending());
        recording_.store(dsp_.recording());
        loading_.store(dsp_.loading());
        audioRev_.store(dsp_.audioRevision());
        winStart_.store(dsp_.windowStart());
        winLength_.store(dsp_.windowLength());
        int n = 0;
        dsp_.forEachHead([&](double pos) {
            if (n < splice::kVoices) heads_[n++].store(pos, std::memory_order_relaxed);
        });
        headCount_.store(n);
    }

    /// [message thread] A consistent copy of the structure.
    Snapshot snapshot() const {
        Snapshot s;
        for (int tries = 0; tries < 1000; ++tries) {
            const uint32_t a = seq_.load(std::memory_order_acquire);
            if (a & 1u) continue;
            s.length = length_.load(std::memory_order_relaxed);
            const int n = std::clamp(markerCount_.load(std::memory_order_relaxed), 0, splice::kMaxMarkers);
            s.markers.resize((size_t)n);
            for (int i = 0; i < n; ++i) s.markers[(size_t)i] = markers_[i].load(std::memory_order_relaxed);
            s.current = current_.load(std::memory_order_relaxed);
            s.rev = rev_.load(std::memory_order_relaxed);
            std::atomic_thread_fence(std::memory_order_acquire);
            if (seq_.load(std::memory_order_relaxed) == a) break;
        }
        return s;
    }

    void publishEditIfChanged(const ReelData& d) {
        const Snapshot s = snapshot();
        if (s.markers == d.markers && s.current == d.current) return;
        auto msg = std::make_shared<Message>();
        msg->serial = ++serial_;
        msg->markers = d.markers;
        msg->current = d.current;
        handoff_.publish(msg);
    }

    /// [message thread] Drops loaded clips the audio thread has copied in.
    void releaseLoaded() const {
        const uint64_t done = loadDone_.load();
        while (loaded_.size() > 1 && loaded_.front().first <= done) loaded_.pop_front();
        if (!loaded_.empty() && loaded_.front().first <= done) loaded_.pop_front();
    }

    SpliceDsp dsp_;
    RtHandoff<Message> handoff_;
    // message thread
    std::string lastJson_, reelId_;
    uint64_t serial_ = 0;
    bool pendingExport_ = false;
    mutable std::deque<std::pair<uint64_t, std::shared_ptr<const MediaClip>>> loaded_;
    // audio thread
    uint64_t applied_ = 0, loadSerial_ = 0;
    uint32_t publishedRev_ = ~0u;
    // shared
    std::atomic<uint64_t> loadDone_{0}, audioRev_{0}, exportedAudioRev_{0};
    std::atomic<uint32_t> seq_{0}, rev_{0};
    std::atomic<int64_t> length_{0};
    std::atomic<int64_t> markers_[splice::kMaxMarkers] = {};
    std::atomic<int> markerCount_{0}, current_{0}, pending_{-1}, headCount_{0};
    std::atomic<bool> recording_{false}, loading_{false}, missing_{false};
    std::atomic<double> winStart_{0.0}, winLength_{0.0};
    std::atomic<double> heads_[splice::kVoices] = {};
};

}  // namespace

static void registerSpliceModule(Registry& r) {
    ModuleSpec s;
    s.type = "splice";
    s.name = "Splice";
    s.category = "Audio/Sampling";
    s.colour = "#0284c7";
    s.description = "Tape-style sampler and looper: record onto a reel, cut it into splices, play them at any speed "
                    "and break them into windows, from micro-loops to clouds. Drop a WAV file on the reel to import it.";
    auto speed = ParamSpec::number("speed", "Speed", -4.0f, 4.0f, 1.0f, "×", 2);
    speed.map = ParamSpec::Map::Skew;
    speed.centre = 1.0f;  // +1 in the middle of the knob
    auto window = ParamSpec::percent("window", "Window Size", 0.00001f, 1.0f, 1.0f);
    window.map = ParamSpec::Map::Exponential;
    auto fade = ParamSpec::seconds("fade", "Fade", 0.0f, 0.05f, 0.01f, 0.003f);
    s.params = {speed,
                window.inGroup("Windows"),
                ParamSpec::percent("position", "Position", 0.0f, 1.0f, 0.0f).inGroup("Windows"),
                ParamSpec::percent("overlap", "Overlap", 0.0f, 1.0f, 0.4f).inGroup("Windows"),
                ParamSpec::percent("pick", "Pick", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("overdub", "Overdub", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("level", "Level", 0.0f, 2.0f, 1.0f),
                fade,
                ParamSpec::choice("reel", "Reel Length", {"15 s", "30 s", "60 s", "120 s"}, 2),
                ParamSpec::choice("recmode", "Record Mode", {"Gate", "Toggle"}, 1),
                ParamSpec::choice("rectarget", "Record Target", {"New splice", "Current splice", "Whole reel"}, 0),
                ParamSpec::choice("shift", "Shift", {"Immediate", "End of window", "End of splice"}, 2),
                ParamSpec::choice("endmode", "End Mode", {"Splice", "Window"}, 0),
                ParamSpec::choice("loop", "Loop", {"Loop", "One-shot"}, 0),
                ParamSpec::choice("monitor", "Monitor", {"Off", "Input while recording", "Always"}, 1),
                ParamSpec::choice("sync", "Sync", {"Free", "1 bar", "2 bars", "4 bars", "8 bars"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"l", "In L", Signal::Audio},          {"r", "In R", Signal::Audio},
                {"record", "Record", Signal::Gate},    {"mark", "Mark", Signal::Trigger},
                {"next", "Next", Signal::Trigger},     {"select", "Select", Signal::Control},
                {"play", "Play", Signal::Trigger},     {"speed", "Speed", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"end", "End", Signal::Trigger, false},
                 {"position", "Position", Signal::Control, false},
                 {"splice", "Splice", Signal::Control, false}};
    s.buttons = {{"rec", "● Rec"}, {"mark", "Mark"}, {"next", "Next"}, {"play", "Play"}, {"clear", "Clear reel"}};
    s.memoryHeavy = true;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SpliceModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerSpliceModule);

}  // namespace bleep::engine
