// SPDX-License-Identifier: MIT
// Grains node (doc/specs/modules/grains.md): a granular processor over a live
// buffer. A frozen buffer can be kept: the view saves it to the media store
// (exportMedia("frozen")) and stores the id in the node's data; on load,
// setData decodes it (resampled to the engine rate) and hands it to the
// audio thread, which plays it while Freeze is on.
#include "GrainsDsp.h"
#include "Handoff.h"
#include "Media.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::GrainsDsp;

constexpr int kFirstSync = 11, kLastSync = 24;  // noteValues(): "1/4" … "1/64T"
constexpr int kDots = 64;
constexpr int kPeaks = 256;

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    const juce::String id = in.getProperty("frozen", juce::String()).toString();
    out->setProperty("frozen", media::validId(id.toStdString()) ? id : juce::String());
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

bool sameAudio(const MediaClip& a, const MediaClip& b) {
    if (a.numChannels() != b.numChannels() || a.numFrames() != b.numFrames()) return false;
    const int64_t n = a.numFrames();
    for (int c = 0; c < a.numChannels(); ++c)
        for (int64_t i : {(int64_t)0, n / 3, n / 2, n - 1})
            if (n > 0 && (a.channels[(size_t)c][(size_t)i] < b.channels[(size_t)c][(size_t)i] || a.channels[(size_t)c][(size_t)i] > b.channels[(size_t)c][(size_t)i])) return false;
    return true;
}

class GrainsModule final : public Module {
public:
    enum { Position, Size, Pitch, Density, Texture, Spread, PitchJitter, Feedback, Blur, Mix, Reverse,
           Mode, Sync, Buffer, PitchQuant, MaxGrains, Freeze, Seed };
    enum { InL, InR, Trigger, FreezeIn, PitchIn };
    enum { OutL, OutR, Grain, Env };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const std::string id = juce::JSON::parse(juce::String(json)).getProperty("frozen", juce::String()).toString().toStdString();
        if (id == clipId_ && !clipMissing_) return;  // a clip that was missing is asked for again when its data comes again
        clipId_ = id;
        clipMissing_ = false;
        if (id.empty()) {
            clip_ = nullptr;
            handoff_.publish(nullptr);
            return;
        }
        auto clip = atRate(media::load(id), sampleRate_);
        if (!clip) {  // missing file: keep recording live
            clipMissing_ = true;
            return;
        }
        if (lastExport_ && sameAudio(*clip, *lastExport_)) return;  // the buffer we just saved: already playing
        clip_ = clip;
        handoff_.publish(clip);
    }

    std::shared_ptr<const MediaClip> exportMedia(const std::string& slot) override {
        if (slot != "frozen" || !frozen_.load()) return nullptr;
        if (playingClip_.load() && clip_) return clip_;
        const int len = dsp_.length(), filled = dsp_.filled(), w = dsp_.writePos();
        if (len <= 0 || filled <= 0) return nullptr;
        auto out = std::make_shared<MediaClip>();
        out->name = "Grains frozen buffer";
        out->sampleRate = sampleRate_;
        for (int c = 0; c < 2; ++c) {  // oldest first, ending at the freeze point
            std::vector<float> v((size_t)filled);
            const float* x = dsp_.channel(c);
            for (int i = 0; i < filled; ++i) v[(size_t)i] = x[(size_t)(((w - filled + i) % len + len) % len)];
            out->channels.push_back(std::move(v));
        }
        lastExport_ = out;
        return out;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"frozen", frozen_.load() ? 1.0 : 0.0});
        out.push_back({"clip", playingClip_.load() ? 1.0 : 0.0});
        out.push_back({"grains", (double)dotCount_.load()});
    }
    /// "peaks": max |L|,|R| over kPeaks bins of the valid span, oldest first
    /// (the write head at the right). "dots": [distance behind the head 0…1,
    /// progress, gain] per live grain.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> peaks((size_t)kPeaks, 0.0f);
        const bool clip = playingClip_.load() && clip_;
        const int len = clip ? (int)clip_->numFrames() : dsp_.length();
        const int filled = clip ? len : dsp_.filled();
        const int w = clip ? 0 : dsp_.writePos();
        if (len > 0 && filled > 0) {
            const int per = std::max(1, filled / kPeaks), stride = std::max(1, per / 24);
            for (int b = 0; b < kPeaks; ++b) {
                float m = 0.0f;
                for (int i = 0; i < per; i += stride) {
                    const int k = (int)(((int64_t)w - filled + (int64_t)b * filled / kPeaks + i) % len + len) % len;
                    for (int c = 0; c < 2; ++c) {
                        const float* x = clip ? clip_->channels[(size_t)std::min(c, clip_->numChannels() - 1)].data() : dsp_.channel(c);
                        m = std::max(m, std::fabs(x[k]));
                    }
                }
                peaks[(size_t)b] = m;
            }
        }
        out.push_back({"peaks", std::move(peaks)});
        const int n = dotCount_.load();
        std::vector<float> dots((size_t)n * 3);
        for (size_t i = 0; i < dots.size(); ++i) dots[i] = dots_[i].load(std::memory_order_relaxed);
        out.push_back({"dots", std::move(dots)});
    }

    void process(const ProcessContext& c) override {
        if (const MediaClip* clip = handoff_.get(); clip != activeClip_) {
            activeClip_ = clip;
            if (clip && clip->numChannels() > 0) {
                for (int ch = 0; ch < 2; ++ch) clipChannels_[ch] = clip->channels[(size_t)std::min(ch, clip->numChannels() - 1)].data();
                patch::GrainsClip gc{clipChannels_, 2, (int)std::min<int64_t>(clip->numFrames(), INT32_MAX)};
                dsp_.setClip(&gc);
            } else {
                dsp_.setClip(nullptr);
            }
        }
        const Transport& tr = *c.transport;
        const uint32_t seed = (uint32_t)setting(Seed);
        if (c.transportStarted) dsp_.restart(seed);
        patch::GrainsParams p;
        p.triggered = setting(Mode) >= 0.5f;
        const int sync = (int)setting(Sync);
        p.syncBeats = sync > 0 ? dsp::noteValueBeats(kFirstSync + sync - 1) : 0.0;
        p.buffer = (int)setting(Buffer);
        p.quant = (int)setting(PitchQuant);
        p.maxGrains = (int)setting(MaxGrains);
        p.seed = seed;
        patch::GrainsInput in;
        in.running = tr.playing && tr.ppqValid;
        in.bpm = tr.bpm;
        const bool freezeSetting = setting(Freeze) >= 0.5f;
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        patch::GrainsFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            p.position = value(c, Position, i);
            p.sizeSeconds = value(c, Size, i);
            p.pitch = value(c, Pitch, i);
            p.density = value(c, Density, i);
            p.texture = value(c, Texture, i);
            p.spread = value(c, Spread, i);
            p.pitchJitter = value(c, PitchJitter, i);
            p.feedback = value(c, Feedback, i);
            p.blur = value(c, Blur, i);
            p.mix = value(c, Mix, i);
            p.reverse = value(c, Reverse, i);
            in.l = c.inputs[InL][i];
            in.r = inR[i];
            in.trigger = c.inputs[Trigger][i];
            in.pitch = c.inputs[PitchIn][i];
            in.freeze = freezeSetting || c.inputs[FreezeIn][i] >= 0.5f;
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Grain][i] = f.grain;
            c.outputs[Env][i] = f.env;
        }
        frozen_.store(dsp_.frozen());
        playingClip_.store(dsp_.playingClip());
        float dots[kDots * 3];
        const int n = dsp_.grainDots(dots, kDots);
        for (int i = 0; i < n * 3; ++i) dots_[i].store(dots[i], std::memory_order_relaxed);
        dotCount_.store(n);
    }

private:
    GrainsDsp dsp_;
    RtHandoff<MediaClip> handoff_;
    const MediaClip* activeClip_ = nullptr;          // audio thread
    const float* clipChannels_[2] = {nullptr, nullptr};
    std::string clipId_;                              // message thread
    bool clipMissing_ = false;                        // message thread: the clip was asked for and is not there yet
    std::shared_ptr<const MediaClip> clip_, lastExport_;
    std::atomic<bool> frozen_{false}, playingClip_{false};
    std::atomic<int> dotCount_{0};
    std::atomic<float> dots_[kDots * 3] = {};
};

}  // namespace

static void registerGrainsModule(Registry& r) {
    ModuleSpec s;
    s.type = "grains";
    s.name = "Grains";
    s.category = "Audio";
    s.colour = "#2563eb";
    s.description = "Granular processor: records its input and plays it back as a seeded cloud of grains. "
                    "Freeze holds the buffer; Feedback and Blur build endless textures.";
    std::vector<std::string> sync{"Free"};
    for (int i = kFirstSync; i <= kLastSync; ++i) sync.emplace_back(dsp::noteValues()[(size_t)i].name);
    auto size = ParamSpec::seconds("size", "Size", 0.005f, 2.0f, 0.1f, 0.12f);
    size.map = ParamSpec::Map::Exponential;
    s.params = {ParamSpec::percent("position", "Position", 0.0f, 1.0f, 0.0f),
                size,
                ParamSpec::number("pitch", "Pitch", -24.0f, 24.0f, 0.0f, "st", 1),
                ParamSpec::percent("density", "Density", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("texture", "Texture", 0.0f, 1.0f, 0.4f),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.3f).inGroup("Scatter"),
                ParamSpec::number("pitchjitter", "Pitch Jitter", 0.0f, 12.0f, 0.0f, "st", 1).inGroup("Scatter"),
                ParamSpec::percent("feedback", "Feedback", 0.0f, 1.0f, 0.0f).inGroup("Space"),
                ParamSpec::percent("blur", "Blur", 0.0f, 1.0f, 0.0f).inGroup("Space"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("reverse", "Reverse", 0.0f, 1.0f, 0.0f).inGroup("Scatter"),
                ParamSpec::choice("mode", "Mode", {"Continuous", "Triggered"}, 0),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::choice("buffer", "Buffer", {"2 s", "4 s", "8 s", "16 s"}, 2),
                ParamSpec::choice("pitchquant", "Pitch Quant", {"Off", "Semitones", "Octaves", "Octaves + fifths"}, 1),
                ParamSpec::choice("maxgrains", "Max Grains", {"16", "32", "64"}, 1),
                ParamSpec::toggle("freeze", "Freeze", false),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"trigger", "Trigger", Signal::Trigger},
                {"freeze", "Freeze", Signal::Gate},
                {"pitch", "Pitch", Signal::Pitch}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"grain", "Grain", Signal::Trigger, false},
                 {"env", "Grain Env", Signal::Control, false}};
    s.memoryHeavy = true;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<GrainsModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerGrainsModule);

}  // namespace bleep::engine
