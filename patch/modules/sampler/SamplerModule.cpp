// SPDX-License-Identifier: GPL-3.0-or-later
// Sampler node (doc/specs/modules/sampler.md): a polyphonic sample player and
// slicer. The WAV lives in the media store; the node's data holds its id, the
// slice markers and the per-slice settings. setData loads the clip (resampled
// to the engine rate), builds a Sample the audio thread reads in place, and
// hands it over (Handoff.h): marker edits publish a new Sample over the same
// audio, so playing voices go on. Detection (onsets, tempo) runs here, on the
// message thread, and writes its result back through takeData.
#include "Handoff.h"
#include "Media.h"
#include "Registry.h"
#include "SamplerDsp.h"
#include "dsp/Delay.h"
#include "dsp/Onsets.h"
#include "dsp/SeqClock.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>
#include <mutex>

namespace bleep::engine {
namespace {

namespace sm = patch::sampler;
constexpr int kBins = 512;

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

double number(const juce::var& v, double fallback) {
    return v.isInt() || v.isInt64() || v.isDouble() ? (double)v : fallback;
}

/// The node data, parsed and clamped.
struct NodeData {
    std::string clip;
    int64_t length = 0;
    std::vector<int64_t> markers;
    int current = 0;
    std::vector<sm::SliceCfg> slices;
    std::vector<std::string> names;
    juce::var slicing;
};

NodeData parse(const juce::var& in) {
    NodeData d;
    const juce::String id = in.getProperty("clip", juce::String()).toString();
    d.clip = media::validId(id.toStdString()) ? id.toStdString() : std::string();
    d.length = std::max<int64_t>(0, (int64_t)number(in.getProperty("length", 0), 0));
    if (const auto* m = in["markers"].getArray())
        for (const auto& v : *m)
            if (v.isInt() || v.isInt64() || v.isDouble()) {
                const int64_t x = (int64_t)(double)v;
                if (x > 0 && (d.length == 0 || x < d.length)) d.markers.push_back(x);
            }
    std::sort(d.markers.begin(), d.markers.end());
    d.markers.erase(std::unique(d.markers.begin(), d.markers.end()), d.markers.end());
    if ((int)d.markers.size() > sm::kMaxMarkers) d.markers.resize((size_t)sm::kMaxMarkers);
    if (d.clip.empty()) d.markers.clear();
    const int n = (int)d.markers.size() + 1;
    d.current = std::clamp((int)number(in.getProperty("current", 0), 0), 0, n - 1);
    d.slices.assign((size_t)n, sm::SliceCfg());
    d.names.assign((size_t)n, std::string());
    if (const auto* o = in["slices"].getDynamicObject())
        for (const auto& p : o->getProperties()) {
            const int k = p.name.toString().getIntValue();
            if (p.name.toString() != juce::String(k) || k < 0 || k >= n) continue;
            const juce::var& s = p.value;
            sm::SliceCfg& c = d.slices[(size_t)k];
            c.mode = std::clamp((int)number(s.getProperty("mode", -1), -1.0), -1, (int)sm::ModeOneShot);
            c.transpose = (float)std::clamp(number(s.getProperty("transpose", 0), 0.0), -48.0, 48.0);
            c.level = (float)std::clamp(number(s.getProperty("level", 1), 1.0), 0.0, 2.0);
            c.pan = (float)std::clamp(number(s.getProperty("pan", 0), 0.0), -1.0, 1.0);
            c.reverse = (bool)s.getProperty("reverse", false);
            c.choke = std::clamp((int)number(s.getProperty("choke", 0), 0.0), 0, 8);
            d.names[(size_t)k] = s.getProperty("name", juce::String()).toString().substring(0, 64).toStdString();
        }
    d.slicing = in.getProperty("slicing", juce::var());
    return d;
}

juce::var toVar(const NodeData& d) {
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("clip", juce::String(d.clip));
    out->setProperty("length", (juce::int64)d.length);
    juce::Array<juce::var> markers;
    for (int64_t m : d.markers) markers.add((juce::int64)m);
    out->setProperty("markers", markers);
    out->setProperty("current", d.current);
    auto* slices = new juce::DynamicObject();
    for (size_t i = 0; i < d.slices.size(); ++i) {
        const sm::SliceCfg& c = d.slices[i];
        const bool plain = c.mode < 0 && c.transpose == 0.0f && c.level == 1.0f && c.pan == 0.0f && !c.reverse && c.choke == 0 && d.names[i].empty();
        if (plain) continue;
        auto* s = new juce::DynamicObject();
        s->setProperty("mode", c.mode);
        s->setProperty("transpose", c.transpose);
        s->setProperty("level", c.level);
        s->setProperty("pan", c.pan);
        s->setProperty("reverse", c.reverse);
        s->setProperty("choke", c.choke);
        s->setProperty("name", juce::String(d.names[i]));
        slices->setProperty(juce::String((int)i), juce::var(s));
    }
    out->setProperty("slices", juce::var(slices));
    auto* slicing = new juce::DynamicObject();
    slicing->setProperty("kind", juce::String(d.slicing.getProperty("kind", "manual").toString()));
    slicing->setProperty("threshold", std::clamp(number(d.slicing.getProperty("threshold", 0.5), 0.5), 0.0, 1.0));
    slicing->setProperty("minGap", std::clamp(number(d.slicing.getProperty("minGap", 30), 30.0), 5.0, 500.0));
    slicing->setProperty("beats", std::clamp((int)number(d.slicing.getProperty("beats", 16), 16.0), 2, sm::kMaxSlices));
    slicing->setProperty("bpm", std::clamp(number(d.slicing.getProperty("bpm", 120), 120.0), 20.0, 400.0));
    slicing->setProperty("bars", std::clamp((int)number(d.slicing.getProperty("bars", 4), 4.0), 1, 64));
    out->setProperty("slicing", juce::var(slicing));
    return result;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    return juce::JSON::toString(toVar(parse(in)), true).toStdString();
}

class SamplerModule final : public Module {
public:
    enum {
        Start, End, Transpose, Fine, Speed, Position, Attack, Decay, Sustain, Release, Level, Pan, Cutoff, Resonance,
        FilterEnv, Velocity, Crush, LayerPitch, LayerOffset,
        Voices, VoiceMode, Layers, TriggerBy, SliceMode, Mode, LoopStyle, LoopFade, Root, KeyTrack, Quality,
        PositionMode, VoiceOuts, Output, Warp, Sync, Ppqn, Beats,
        Gain, RecMode, RecLen, Monitor, RecFeedback
    };
    enum { Notes, Trigger, Gate, SliceIn, PitchIn, SpeedIn, VelocityIn, Stop, Step, ClockIn, InL, InR, RecIn };
    enum { OutL, OutR, EndOut, SliceOut, PlayheadOut, ActiveOut, Voice1 };
    enum { NextButton, RandomButton, StopButton, RecordButton, AuditionCommand };
    static constexpr double kRecSeconds = 20.0;  ///< longest recording

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        const size_t cap = (size_t)(kRecSeconds * sampleRate);
        if (recL_.size() != cap) {  // the recording buffer is allocated here, never on the audio thread
            recL_.assign(cap, 0.0f);
            recR_.assign(cap, 0.0f);
            recLen_.store(0);
            recState_.store(0);
            liveA_ = false;
            live_ = false;
            lastJson_.clear();
        }
    }
    void reset() override {
        dsp_.reset();
        sinceClock_ = 0;
        clockPrev_ = false;
        clockBpm_ = 0.0;
        syncRatio_ = 1.0;
        recGatePrev_ = false;
        recState_.store(0);
    }

    void command(const std::string& id, float value) override {
        if (id == "audition") postCommand(AuditionCommand, value);
        else Module::command(id, value);
    }

    void setData(const std::string& json) override {
        if (json == lastJson_ && !missing_.load()) return;  // a clip that was missing is asked for again when its data comes again
        lastJson_ = json;
        data_ = parse(juce::JSON::parse(juce::String(json)));
        if (data_.clip != clipId_ || missing_.load()) {
            clipId_ = data_.clip;
            clip_.reset();
            peaks_.assign(kBins, 0.0f);
            missing_.store(false);
            live_ = !clipId_.empty() && clipId_ == liveClipId_ && recLen_.load() > 0;
            if (!live_ && recState_.load() == 0) recHeld_.store(false);
            if (!clipId_.empty() && !live_) {
                clip_ = atRate(media::load(clipId_), sampleRate_);
                missing_.store(!clip_);
                if (clip_) computePeaks();
            }
        }
        publish();
    }

    /// "detect" {sensitivity 0…1, minGap ms}: replaces the markers with the
    /// detected onsets. "bpm": estimates the tempo into the slicing settings.
    void perform(const std::string& action, const std::vector<double>& args) override {
        if (!clip_ || clip_->numChannels() < 1) return;
        const float* ch[2] = {clip_->channels[0].data(), clip_->numChannels() > 1 ? clip_->channels[1].data() : nullptr};
        const int channels = std::min(clip_->numChannels(), 2);
        NodeData d = data_;
        d.length = clip_->numFrames();
        if (action == "detect") {
            const float sens = args.size() > 0 ? (float)args[0] : 0.5f;
            const double gap = (args.size() > 1 ? args[1] : 30.0) * 0.001;
            d.markers = dsp::detectOnsets(ch, channels, clip_->numFrames(), sampleRate_, sens, std::max(gap, 0.005));
            if ((int)d.markers.size() > sm::kMaxMarkers) d.markers.resize((size_t)sm::kMaxMarkers);
            d.current = 0;
            d.slices.resize(d.markers.size() + 1);
            d.names.resize(d.markers.size() + 1);
        } else if (action == "bpm") {
            const double bpm = dsp::estimateBpm(ch, channels, clip_->numFrames(), sampleRate_);
            if (bpm <= 0.0) return;
            auto* s = new juce::DynamicObject();
            juce::var slicing(s);
            if (const auto* o = d.slicing.getDynamicObject())
                for (const auto& p : o->getProperties()) s->setProperty(p.name, p.value);
            s->setProperty("bpm", std::round(bpm * 10.0) / 10.0);
            d.slicing = slicing;
        } else {
            return;
        }
        std::lock_guard<std::mutex> l(pendingLock_);
        pending_ = juce::JSON::toString(toVar(d), true).toStdString();
        hasPending_ = true;
    }
    bool takeData(std::string& json) override {
        if (recDone_.exchange(false)) saveRecording();
        std::lock_guard<std::mutex> l(pendingLock_);
        if (!hasPending_) return false;
        hasPending_ = false;
        json = pending_;
        return true;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        const int rs = recState_.load();
        const bool rec = rs == 1 || live_ || recHeld_.load();
        const double frames = rs == 1 ? (double)recPosA_.load() : (live_ || recHeld_.load()) ? (double)recLen_.load() : clip_ ? (double)clip_->numFrames() : 0.0;
        out.push_back({"length", frames});
        out.push_back({"slices", rec ? (double)data_.markers.size() + 1.0 : clip_ ? (double)data_.markers.size() + 1.0 : 0.0});
        out.push_back({"recState", (double)rs});
        out.push_back({"recSeconds", sampleRate_ > 0.0 ? (rs == 1 ? (double)recPosA_.load() : (double)recLen_.load()) / sampleRate_ : 0.0});
        out.push_back({"current", (double)current_.load()});
        out.push_back({"missing", missing_.load() ? 1.0 : 0.0});
        out.push_back({"sampleRate", sampleRate_});
        out.push_back({"channels", rec ? 2.0 : clip_ ? (double)clip_->numChannels() : 0.0});
    }
    /// "markers" (frames), "peaks" (max |L|,|R| over 512 bins), "heads" (position
    /// in frames and slice of each sounding voice, pairs).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> m;
        for (int64_t x : data_.markers) m.push_back((float)x);
        out.push_back({"markers", std::move(m)});
        if (recState_.load() == 1 || live_ || recHeld_.load()) out.push_back({"peaks", livePeaks()});
        else out.push_back({"peaks", peaks_});
        std::vector<float> heads;
        const int n = headCount_.load();
        for (int i = 0; i < n; ++i) {
            heads.push_back((float)heads_[i].load(std::memory_order_relaxed));
            heads.push_back((float)headSlice_[i].load(std::memory_order_relaxed));
        }
        out.push_back({"heads", std::move(heads)});
        std::vector<float> envs;  // envelope level and stage (0 attack, 1 decay, 2 sustain, 3 release) of each sounding voice
        for (int i = 0; i < n; ++i) {
            envs.push_back(headEnv_[i].load(std::memory_order_relaxed));
            envs.push_back((float)headStage_[i].load(std::memory_order_relaxed));
        }
        out.push_back({"envs", std::move(envs)});
    }

    void process(const ProcessContext& c) override {
        if (const Loaded* ld = handoff_.get(); ld != applied_ && recState_.load() != 1) {  // not while a fresh recording is made
            applied_ = ld;
            dsp_.setSample(ld && ld->sample.frames > 0 ? &ld->sample : nullptr);
            liveA_ = ld && ld->live && ld->sample.frames > 0;
            sampleSeconds_ = ld && ld->sample.frames > 0 ? (double)ld->sample.frames / sampleRate_ : 0.0;
            if (ld) dsp_.setCurrentSlice(ld->current);
        }

        patch::SamplerParams p;
        p.voices = (int)setting(Voices);
        p.voiceMode = (int)setting(VoiceMode);
        p.layers = (int)setting(Layers);
        p.byNote = setting(TriggerBy) < 0.5f;
        p.sliceMode = setting(SliceMode) >= 0.5f;
        p.mode = (int)setting(Mode);
        p.pingPong = setting(LoopStyle) >= 0.5f;
        p.loopFade = setting(LoopFade);
        p.root = (int)setting(Root);
        p.keyTrack = setting(KeyTrack);
        p.quality = (int)setting(Quality);
        p.positionMode = (int)setting(PositionMode);
        p.outputMono = setting(Output) >= 0.5f;
        p.warp = (int)setting(Warp);

        // Tempo sync: Speed is scaled so the sample lasts `Beats` beats at the tempo of the clock or the transport.
        const int sync = (int)setting(Sync);  // 0 off, 1 auto, 2 clock, 3 transport
        const bool clockMode = sync > 0 && dsp::clockSynced(sync - 1, c.inputConnected[ClockIn]);
        static constexpr double kPulses[] = {1.0, 2.0, 4.0, 8.0, 24.0, 48.0};
        const double pulses = kPulses[std::clamp((int)setting(Ppqn), 0, 5)];
        double hostBpm = c.transport ? c.transport->bpm : 120.0;
        if (clockMode && clockBpm_ > 0.0) hostBpm = clockBpm_;
        const bool useSync = sync > 0 && sampleSeconds_ > 0.0;
        const double smooth = 1.0 - std::exp(-1.0 / (0.02 * sampleRate_));
        const int recMode = (int)setting(RecMode), monitor = (int)setting(Monitor);
        const float feedback = setting(RecFeedback);
        const auto recLimit = [&]() -> int64_t {
            int64_t n = (int64_t)recL_.size();
            if ((int)setting(RecLen) == 1)
                n = std::min<int64_t>(n, (int64_t)std::llround(std::clamp((double)setting(Beats), 0.25, 256.0) * 60.0 / std::max(hostBpm, 1.0) * sampleRate_));
            return std::max<int64_t>(n, 16);
        };
        if (setting(VoiceOuts) >= 0.5f)
            for (int v = 0; v < sm::kVoices; ++v) p.voiceOut[v] = c.isOutputConnected(Voice1 + v);

        pollCommands([&](const Command& cmd) {
            switch (cmd.index) {
                case RecordButton:
                    if (recState_.load() != 0) recStop(p);
                    else recStart(recMode == 1, recLimit(), c.inputConnected[InR], p);
                    break;
                case NextButton: dsp_.nextSlice(); break;
                case RandomButton: dsp_.randomSlice(++randomCount_); break;
                case StopButton: dsp_.stopAll(); break;
                case AuditionCommand: dsp_.audition((int)std::lround(cmd.value), p); break;
                default: break;
            }
        });

        // Notes: with "Trigger by Note" only.
        const NoteBuffer* notes = c.inputConnected[Notes] && p.byNote ? c.notesIn[Notes] : nullptr;
        if ((!c.inputConnected[Notes] || !p.byNote) && hadNotes_) dsp_.stopAll();
        hadNotes_ = notes != nullptr;
        int e = 0;
        patch::SamplerInput in;
        in.triggerPatched = c.inputConnected[Trigger];
        in.gatePatched = c.inputConnected[Gate];
        in.slicePatched = c.inputConnected[SliceIn];
        patch::SamplerFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            if (sync > 0) {  // measure the clock: the time between pulses gives the tempo
                ++sinceClock_;
                const bool edge = c.inputs[ClockIn][i] >= 0.5f;
                if (edge && !clockPrev_ && c.inputConnected[ClockIn]) {
                    if (sinceClock_ > 16 && sinceClock_ < (int64_t)(4.0 * sampleRate_)) {
                        const double bpm = std::clamp(60.0 * sampleRate_ / ((double)sinceClock_ * pulses), 20.0, 400.0);
                        clockBpm_ = clockBpm_ > 0.0 ? clockBpm_ + (bpm - clockBpm_) * 0.5 : bpm;
                    }
                    sinceClock_ = 0;
                }
                clockPrev_ = edge;
                if (clockMode && clockBpm_ > 0.0) hostBpm = clockBpm_;
            }
            const double target = useSync ? sampleSeconds_ * hostBpm / (60.0 * std::clamp((double)value(c, Beats, i), 0.25, 256.0)) : 1.0;
            syncRatio_ += (target - syncRatio_) * smooth;
            if (c.inputConnected[RecIn]) {  // the Rec gate: high records (or overdubs, per Rec Mode), low stops
                const bool g = c.inputs[RecIn][i] >= 0.5f;
                if (g && !recGatePrev_ && recState_.load() == 0) recStart(recMode == 1, recLimit(), c.inputConnected[InR], p);
                else if (!g && recGatePrev_ && recState_.load() != 0) recStop(p);
                recGatePrev_ = g;
            }
            const float inL = c.inputs[InL][i], inR = c.inputConnected[InR] ? c.inputs[InR][i] : inL;
            if (const int rs = recState_.load(std::memory_order_relaxed); rs == 1) {
                if (recPos_ < (int64_t)recL_.size()) {
                    recL_[(size_t)recPos_] = inL;
                    recR_[(size_t)recPos_] = inR;
                    ++recPos_;
                }
                if (recPos_ >= recLimit_) recStop(p);
            } else if (rs == 2) {  // overdub: the input is added at the playhead, the old audio kept by Feedback
                double pos;
                if (dsp_.primaryHead(pos) && recLen_.load() > 0) {
                    const size_t k = (size_t)std::clamp<int64_t>((int64_t)pos, 0, recLen_.load() - 1);
                    recL_[k] = recL_[k] * feedback + inL;
                    recR_[k] = recR_[k] * feedback + inR;
                }
            }
            p.start = value(c, Start, i);
            p.end = value(c, End, i);
            p.transpose = value(c, Transpose, i);
            p.fine = value(c, Fine, i);
            p.speed = value(c, Speed, i) * (float)syncRatio_;
            p.position = value(c, Position, i);
            p.attack = value(c, Attack, i);
            p.decay = value(c, Decay, i);
            p.sustain = value(c, Sustain, i);
            p.release = value(c, Release, i);
            p.level = value(c, Level, i);
            p.pan = value(c, Pan, i);
            p.cutoff = value(c, Cutoff, i);
            p.resonance = value(c, Resonance, i);
            p.filterEnv = value(c, FilterEnv, i);
            p.velocity = value(c, Velocity, i);
            p.crush = value(c, Crush, i);
            p.gain = std::exp2(value(c, Gain, i) * 0.16609640474f);
            p.layerPitch = value(c, LayerPitch, i);
            p.layerOffset = value(c, LayerOffset, i);
            in.trigger = c.inputs[Trigger][i];
            in.gate = c.inputs[Gate][i];
            in.slice = c.inputs[SliceIn][i];
            in.pitch = c.inputs[PitchIn][i];
            in.speed = c.inputs[SpeedIn][i];
            in.velocity = c.inputConnected[VelocityIn] ? c.inputs[VelocityIn][i] : 1.0f;
            in.stop = c.inputs[Stop][i];
            in.step = c.inputs[Step][i];
            // The notes come last: a note starting on this sample reads this sample's knobs (a negative Speed decides where the
            // playhead starts), not the defaults `p` holds at the top of a block.
            for (; notes && e < notes->count && notes->events[e].offset <= i; ++e) {
                const NoteEvent& ev = notes->events[e];
                if (ev.type == NoteEvent::On) dsp_.noteOn(ev.note, ev.pitch, ev.value, p);
                else if (ev.type == NoteEvent::Off) dsp_.noteOff(ev.note, p);
            }
            dsp_.tick(p, in, f);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            if (monitor == 2 || (monitor == 1 && recState_.load(std::memory_order_relaxed) != 0)) {
                c.outputs[OutL][i] += inL;
                c.outputs[OutR][i] += inR;
            }
            c.outputs[EndOut][i] = f.end;
            c.outputs[SliceOut][i] = f.slice;
            c.outputs[PlayheadOut][i] = f.playhead;
            c.outputs[ActiveOut][i] = f.active;
            for (int v = 0; v < sm::kVoices; ++v) c.outputs[Voice1 + v][i] = f.voice[v];
        }
        recPosA_.store(recPos_, std::memory_order_relaxed);
        current_.store(dsp_.currentSlice());
        int n = 0;
        dsp_.forEachHead([&](double pos, int slice, bool, float env, int stage) {
            if (n < sm::kVoices) {
                heads_[n].store(pos, std::memory_order_relaxed);
                headSlice_[n].store(slice, std::memory_order_relaxed);
                headEnv_[n].store(env, std::memory_order_relaxed);
                headStage_[n].store(stage, std::memory_order_relaxed);
                ++n;
            }
        });
        headCount_.store(n);
    }

private:
    /// [audio thread] Starts recording: fresh (replaces the sample) or overdub (into a recording that is there).
    void recStart(bool overdub, int64_t limit, bool stereo, const patch::SamplerParams& p) {
        if (overdub && liveA_ && recLen_.load() > 0) {
            recState_.store(2);
            if (dsp_.activeVoices() == 0) dsp_.startLoop(p);
            return;
        }
        dsp_.stopAll();
        dsp_.setSample(nullptr);
        liveA_ = false;
        recPos_ = 0;
        recLimit_ = limit;
        recStereo_.store(stereo);
        recLen_.store(0);
        recState_.store(1);
    }
    /// [audio thread] Ends the recording: a fresh one becomes the sample and loops at once.
    void recStop(const patch::SamplerParams& p) {
        const int rs = recState_.load();
        if (rs == 1) {
            if (recPos_ < 16) {  // nothing recorded: the old sample comes back
                recState_.store(0);
                applied_ = nullptr;
                return;
            }
            recLen_.store(recPos_);
            recSample_ = sm::Sample();
            recSample_.channels = 2;
            recSample_.ch[0] = recL_.data();
            recSample_.ch[1] = recR_.data();
            recSample_.frames = recPos_;
            recSample_.slices.resize(1);
            dsp_.setSample(&recSample_);
            dsp_.setCurrentSlice(0);
            liveA_ = true;
            recHeld_.store(true);
            sampleSeconds_ = (double)recPos_ / sampleRate_;
            recState_.store(0);
            dsp_.startLoop(p);
            recDone_.store(true);
        } else if (rs == 2) {
            recState_.store(0);
            recDone_.store(true);
        }
    }
    /// [message thread] A recording ended: it goes to the media folder and into the node's data.
    void saveRecording() {
        const int64_t n = recLen_.load();
        if (n < 16 || n > (int64_t)recL_.size()) return;
        auto clip = std::make_shared<MediaClip>();
        clip->name = "Recording";
        clip->sampleRate = sampleRate_;
        clip->channels.emplace_back(recL_.begin(), recL_.begin() + n);
        if (recStereo_.load()) clip->channels.emplace_back(recR_.begin(), recR_.begin() + n);
        const std::string id = media::save(*clip);
        if (id.empty()) return;
        NodeData d = data_;
        if (d.length != n || d.clip.empty()) {
            d.markers.clear();
            d.slices.assign(1, sm::SliceCfg());
            d.names.assign(1, std::string());
            d.current = 0;
        }
        d.clip = id;
        d.length = n;
        liveClipId_ = id;
        std::lock_guard<std::mutex> l(pendingLock_);
        pending_ = juce::JSON::toString(toVar(d), true).toStdString();
        hasPending_ = true;
    }
    std::vector<float> livePeaks() const {
        std::vector<float> out((size_t)kBins, 0.0f);
        const int64_t n = recState_.load() == 1 ? recPosA_.load() : recLen_.load();
        if (n < 1 || n > (int64_t)recL_.size()) return out;
        for (int b = 0; b < kBins; ++b) {
            const int64_t from = n * b / kBins, to = std::max(n * (b + 1) / kBins, from + 1);
            const int64_t stride = std::max<int64_t>(1, (to - from) / 64);
            float v = 0.0f;
            for (int64_t i = from; i < to && i < n; i += stride) v = std::max({v, std::fabs(recL_[(size_t)i]), std::fabs(recR_[(size_t)i])});
            out[(size_t)b] = v;
        }
        return out;
    }

    /// What the audio thread plays: the Sample plus the clip it points into.
    struct Loaded {
        patch::sampler::Sample sample;
        std::shared_ptr<const MediaClip> clip;
        int current = 0;
        bool live = false;  ///< the sample is the recording buffer
    };

    void publish() {
        auto ld = std::make_shared<Loaded>();
        ld->clip = clip_;
        ld->current = data_.current;
        ld->live = live_;
        if (live_ && recLen_.load() > 1) {
            sm::Sample& s = ld->sample;
            s.channels = 2;
            s.ch[0] = recL_.data();
            s.ch[1] = recR_.data();
            s.frames = recLen_.load();
            for (int64_t m : data_.markers)
                if (m > 0 && m < s.frames) s.markers.push_back(m);
            s.slices = data_.slices;
            s.slices.resize(s.markers.size() + 1);
        } else if (clip_ && clip_->numChannels() > 0 && clip_->numFrames() > 1) {
            sm::Sample& s = ld->sample;
            s.channels = std::min(clip_->numChannels(), 2);
            for (int k = 0; k < s.channels; ++k) s.ch[k] = clip_->channels[(size_t)k].data();
            s.frames = clip_->numFrames();
            for (int64_t m : data_.markers)
                if (m > 0 && m < s.frames) s.markers.push_back(m);
            s.slices = data_.slices;
            s.slices.resize(s.markers.size() + 1);
        }
        handoff_.publish(ld);
    }

    void computePeaks() {
        const int64_t n = clip_->numFrames();
        for (int b = 0; b < kBins; ++b) {
            const int64_t from = n * b / kBins, to = std::max(n * (b + 1) / kBins, from + 1);
            const int64_t stride = std::max<int64_t>(1, (to - from) / 64);
            float v = 0.0f;
            for (int64_t i = from; i < to && i < n; i += stride)
                for (const auto& ch : clip_->channels) v = std::max(v, std::fabs(ch[(size_t)i]));
            peaks_[(size_t)b] = v;
        }
    }

    patch::SamplerDsp dsp_;
    RtHandoff<Loaded> handoff_;
    // message thread
    std::string lastJson_, clipId_;
    NodeData data_;
    std::shared_ptr<const MediaClip> clip_;
    std::vector<float> peaks_ = std::vector<float>(kBins, 0.0f);
    std::mutex pendingLock_;
    std::string pending_;
    bool hasPending_ = false;
    // recording: the buffers are allocated in prepare(); the audio thread writes them, the message thread saves them
    std::vector<float> recL_, recR_;
    std::atomic<int> recState_{0};  ///< 0 idle, 1 recording, 2 overdubbing
    std::atomic<int64_t> recLen_{0}, recPosA_{0};
    std::atomic<bool> recDone_{false}, recStereo_{false}, recHeld_{false};  ///< recHeld_: the sample is a take not yet saved
    bool live_ = false;  // message thread: the node's clip is the recording buffer
    std::string liveClipId_;
    // audio thread
    sm::Sample recSample_;
    bool liveA_ = false, recGatePrev_ = false;
    int64_t recPos_ = 0, recLimit_ = 0;
    const Loaded* applied_ = nullptr;
    bool hadNotes_ = false;
    double sampleSeconds_ = 0.0, clockBpm_ = 0.0, syncRatio_ = 1.0;
    int64_t sinceClock_ = 0;
    bool clockPrev_ = false;
    uint32_t randomCount_ = 0;
    // shared
    std::atomic<int> current_{0}, headCount_{0};
    std::atomic<bool> missing_{false};
    std::atomic<double> heads_[sm::kVoices] = {};
    std::atomic<int> headSlice_[sm::kVoices] = {};
    std::atomic<float> headEnv_[sm::kVoices] = {};
    std::atomic<int> headStage_[sm::kVoices] = {};
};

}  // namespace

static void registerSamplerModule(Registry& r) {
    ModuleSpec s;
    s.type = "sampler";
    s.name = "Sampler";
    s.category = "Audio/Sampling";
    s.colour = "#0d9488";
    s.description = "Polyphonic sample player and slicer: load a WAV, cut it into slices by hand, by transients or into "
                    "beats, and play it from notes or triggers with up to 16 playheads, play modes, an envelope and a filter. "
                    "It also records its audio inputs, to loop, overdub or use as a delay.";
    auto speed = ParamSpec::number("speed", "Speed", -4.0f, 4.0f, 1.0f, "×", 2);
    speed.map = ParamSpec::Map::Skew;
    speed.centre = 1.0f;
    auto cutoff = ParamSpec::hertz("cutoff", "Cutoff", 20.0f, 20000.0f, 20000.0f);
    s.params = {
        ParamSpec::percent("start", "Start", 0.0f, 1.0f, 0.0f).inGroup("Sample"),
        ParamSpec::percent("end", "End", 0.0f, 1.0f, 1.0f).inGroup("Sample"),
        ParamSpec::number("transpose", "Transpose", -48.0f, 48.0f, 0.0f, "st", 1).inGroup("Pitch"),
        ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup("Pitch"),
        speed.inGroup("Pitch"),
        ParamSpec::percent("position", "Position", 0.0f, 1.0f, 0.0f).inGroup("Sample"),
        ParamSpec::seconds("attack", "Attack", 0.0005f, 10.0f, 0.1f, 0.001f).inGroup("Envelope"),
        ParamSpec::seconds("decay", "Decay", 0.001f, 10.0f, 0.3f, 0.1f).inGroup("Envelope"),
        ParamSpec::percent("sustain", "Sustain", 0.0f, 1.0f, 1.0f).inGroup("Envelope"),
        ParamSpec::seconds("release", "Release", 0.001f, 10.0f, 0.3f, 0.05f).inGroup("Envelope"),
        ParamSpec::percent("level", "Level", 0.0f, 2.0f, 1.0f).inGroup("Output"),
        ParamSpec::number("pan", "Pan", -1.0f, 1.0f, 0.0f).inGroup("Output"),
        cutoff.inGroup("Filter"),
        ParamSpec::percent("resonance", "Resonance", 0.0f, 1.0f, 0.0f).inGroup("Filter"),
        ParamSpec::percent("filterenv", "Filter Env", -1.0f, 1.0f, 0.0f).inGroup("Filter"),
        ParamSpec::percent("velocity", "Velocity", 0.0f, 1.0f, 0.5f).inGroup("Output"),
        ParamSpec::percent("crush", "Crush", 0.0f, 1.0f, 0.0f).inGroup("Output"),
        ParamSpec::number("layerpitch", "Layer Pitch", -24.0f, 24.0f, 7.0f, "st", 1).inGroup("Layers").when("voicemode", 3, 3),
        ParamSpec::number("layeroffset", "Layer Offset", 0.0f, 200.0f, 0.0f, "ms", 0).inGroup("Layers").when("voicemode", 3, 3),
        ParamSpec::integer("voices", "Voices", 1, 16, 8),
        ParamSpec::choice("voicemode", "Voice Mode", {"Poly", "Mono", "Legato", "Layers"}, 0),
        ParamSpec::integer("layers", "Layers", 1, 8, 2).when("voicemode", 3, 3),
        ParamSpec::choice("triggerby", "Trigger By", {"Note", "CV"}, 0),
        ParamSpec::choice("slicemode", "Slice Mode", {"Off", "On"}, 0),
        ParamSpec::choice("mode", "Mode", {"Gate", "To end of sample", "To end of slice", "Loop", "One-shot"}, 0),
        ParamSpec::choice("loopstyle", "Loop Style", {"Forward", "Ping-pong"}, 0),
        ParamSpec::seconds("loopfade", "Loop Crossfade", 0.0f, 0.05f, 0.01f, 0.005f),
        ParamSpec::integer("root", "Root Note", 0, 127, 60),
        ParamSpec::percent("keytrack", "Key Tracking", -1.0f, 2.0f, 1.0f),
        ParamSpec::choice("quality", "Quality", {"Linear", "Cubic", "Sinc"}, 1),
        ParamSpec::choice("positionmode", "Position Mode", {"Scrub", "Offset"}, 0),
        ParamSpec::choice("voiceouts", "Voice Outs", {"Off", "On"}, 0),
        ParamSpec::choice("output", "Output", {"Stereo", "Mono"}, 0),
        ParamSpec::choice("warp", "Warp", {"Repitch", "Beats", "Tones", "Texture"}, 0),
        ParamSpec::choice("sync", "Tempo Sync", {"Off", "Auto", "Clock", "Transport"}, 0),
        ParamSpec::choice("ppqn", "Clock PPQN", {"1 PPQN", "2 PPQN", "4 PPQN", "8 PPQN", "24 PPQN", "48 PPQN"}, 4).when("sync", 1, 2),
        ParamSpec::exponential("beats", "Beats", 0.25f, 256.0f, 4.0f).inGroup("Tempo Sync"),
        ParamSpec::number("gain", "Gain", -24.0f, 24.0f, 0.0f, "dB", 1).inGroup("Sample"),
        ParamSpec::choice("recmode", "Rec Mode", {"Replace", "Overdub"}, 0),
        ParamSpec::choice("reclen", "Rec Length", {"Free", "Beats"}, 0),
        ParamSpec::choice("monitor", "Monitor", {"Off", "Recording", "Always"}, 0),
        ParamSpec::percent("recfeedback", "Feedback", 0.0f, 1.0f, 1.0f).inGroup("Record")};
    // Settings are plain choices; the knobs above are inputs too.
    for (auto& p : s.params)
        if (p.kind != ParamSpec::Kind::Float) p.modulatable = false;
    s.inputs = {{"notes", "Notes", Signal::Notes},         {"trigger", "Trigger", Signal::Trigger},
                {"gate", "Gate", Signal::Gate},            {"slice", "Slice", Signal::Control},
                {"pitch", "Pitch", Signal::Pitch},         {"speed", "Speed", Signal::Pitch},
                {"velocity", "Velocity", Signal::Control}, {"stop", "Stop", Signal::Trigger},
                {"step", "Step", Signal::Trigger},
                {"clock", "Clock", Signal::Trigger},
                {"inl", "In L", Signal::Audio},
                {"inr", "In R", Signal::Audio},
                {"rec", "Rec", Signal::Gate}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"end", "End", Signal::Trigger, false},
                 {"slice", "Slice", Signal::Trigger, false},
                 {"playhead", "Playhead", Signal::Control, false},
                 {"active", "Active", Signal::Control, false}};
    for (int v = 1; v <= sm::kVoices; ++v)
        s.outputs.push_back(JackSpec("voice" + std::to_string(v), "Voice " + std::to_string(v), Signal::Audio, true).when("voiceouts", 1, 1));
    s.buttons = {{"next", "Next"}, {"random", "Random"}, {"stop", "Stop"}, {"record", "Record"}};
    s.memoryHeavy = true;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SamplerModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerSamplerModule);

}  // namespace bleep::engine
