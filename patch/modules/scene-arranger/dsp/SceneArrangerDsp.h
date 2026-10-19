// SPDX-License-Identifier: GPL-3.0-or-later
// Scene Arranger core (doc/specs/modules/scene-arranger.md): up to 16 scenes
// played in a list of up to 16 slots (scene + repeat count). When a scene has
// played its repeats, its follow action picks the next one. Launches (the
// Launch knob or jack, Next, Previous) wait for the beat or bar if asked to.
//
// Time is counted in beats: Transport mode derives the beat from the song
// position, Clock mode counts pulses (one pulse is one beat). A "unit" is a
// whole number of beats (Scene Length); a scene visit lasts `repeats` units.
// Randomness is counter-based (Random.h), so renders repeat.
#pragma once

#include "dsp/Random.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

constexpr int kSaScenes = 16;
constexpr int kSaSlots = 16;
constexpr int kSaLanes = 8;

enum SaFollow : int { FollowOrder = 0, FollowNext, FollowPrevious, FollowRandom, FollowHold, FollowJump, FollowChance, kSaFollows };
enum SaQuantize : int { QuantImmediate = 0, QuantBeat, QuantBar };

struct SaParams {
    int scenes = 8;  ///< scenes in use, 1…16
    int steps = 8;   ///< slots in the play order, 1…16
    int slotScene[kSaSlots]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16};
    int slotRepeat[kSaSlots]{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
    int follow[kSaScenes]{};
    int target[kSaScenes]{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
    float chance[kSaScenes]{0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f};
    int lenBeats = 4;      ///< Scene Length in beats
    int beatsPerBar = 4;
    int quantize = QuantImmediate;
    int launch = 0;        ///< Launch knob: 0 = none, else scene number
    int laneFrom[kSaLanes]{1, 2, 3, 4, 5, 6, 7, 8};  ///< 0 = lane off
    int laneTo[kSaLanes]{1, 2, 3, 4, 5, 6, 7, 8};
    bool laneTrigger = false;
    bool cvLinear = false;  ///< Scene CV: s / 15 instead of the centre of slot s of 16
    uint64_t seed = 1;
};

struct SaInput {
    float clock = 0.0f, reset = 0.0f, next = 0.0f, prev = 0.0f;
    float launchCv = 0.0f;
    bool launchPatched = false;
    bool clocked = false;
    bool running = false;
    bool started = false;
    double ppq = 0.0;
    double ppqPerSample = 0.0;
};

struct SaOutputs {
    float scene = 0.0f, change = 0.0f, cycle = 0.0f, queued = 0.0f;
    float lane[kSaLanes]{};
};

class SceneArrangerDsp {
public:
    void prepare(double sampleRate) noexcept {
        sampleRate_ = sampleRate;
        pulseSamples_ = std::max<int64_t>(1, (int64_t)std::llround(sampleRate * 0.002));
    }

    void reset() noexcept {
        clock_.reset();
        reset_.reset();
        next_.reset();
        prev_.reset();
        scene_ = slot_ = 0;
        repeat_ = 0;
        repeatsNeeded_ = 1;
        visit_ = 0;
        pending_ = -1;
        lastLaunchKnob_ = 0;
        lastCvScene_ = -1;
        begun_ = manual_ = false;
        wasActive_ = false;
        off_ = lastPpq_ = 0.0;
        lastBeat_ = -1;
        skipUnitBeat_ = -1;
        n_ = -1;
        pendingReset_ = false;
        changeLeft_ = cycleLeft_ = 0;
        for (auto& l : laneLeft_) l = 0;
    }

    /// The scene a Launch jack value selects.
    static int sceneForCv(float v, int scenes) noexcept {
        return std::clamp((int)std::floor(v * (float)kSaSlots), 0, std::max(1, scenes) - 1);
    }

    void tick(const SaParams& p, const SaInput& in, SaOutputs& out) noexcept {
        const int scenes = std::clamp(p.scenes, 1, kSaScenes);
        steps_ = std::clamp(p.steps, 1, kSaSlots);
        scenes_ = scenes;
        const bool resetEdge = reset_.process(in.reset) > 0;
        const bool nextEdge = next_.process(in.next) > 0;
        const bool prevEdge = prev_.process(in.prev) > 0;
        const bool clockEdge = clock_.process(in.clock) > 0;
        changed_ = false;

        // ---- time: is the arrangement running, and did a beat start?
        bool active = false, beatEvent = false;
        int64_t beat = 0;
        if (in.clocked) {
            if (resetEdge) pendingReset_ = true;
            if (clockEdge) {
                n_ = pendingReset_ || n_ < 0 ? 0 : n_ + 1;
                pendingReset_ = false;
                beat = n_;
                beatEvent = true;
            }
            active = n_ >= 0;
        } else if (in.running) {
            active = true;
            if (in.started || !wasActive_) off_ = 0.0;
            const bool jump = std::fabs(in.ppq - (lastPpq_ + in.ppqPerSample)) > 0.5 * in.ppqPerSample + 1e-9;
            lastPpq_ = in.ppq;
            if (resetEdge) off_ = std::floor(in.ppq) + 1.0;  // the next beat is beat 0
            beat = (int64_t)std::floor(in.ppq - off_ + 1e-9);
            if (in.started || !wasActive_ || jump || resetEdge) lastBeat_ = beat;  // re-sync without catching up
            else if (beat != lastBeat_) beatEvent = true;
        }
        if (!active && wasActive_) {
            // Transport stopped or the clock was switched away.
            for (auto& l : laneLeft_) l = 0;
        }
        const bool started = active && (!wasActive_ || (in.started && !in.clocked));
        wasActive_ = active;

        if (started) {
            beginPlay(p, false);
            if (in.clocked) beatEvent = false;  // the first pulse starts the arrangement, it does not end a unit
        }
        if (resetEdge) {
            beginPlay(p, true);
            if (in.clocked || in.running) skipUnitBeat_ = 0;
        }

        // ---- manual launches
        if (nextEdge) queue(p, ((pending_ >= 0 ? pending_ : scene_) + 1) % scenes, active);
        if (prevEdge) queue(p, ((pending_ >= 0 ? pending_ : scene_) + scenes - 1) % scenes, active);
        if (p.launch != lastLaunchKnob_) {
            if (p.launch >= 1) queue(p, std::min(p.launch, scenes) - 1, active);
            lastLaunchKnob_ = p.launch;
        }
        if (in.launchPatched) {
            const int s = sceneForCv(in.launchCv, scenes);
            if (s != lastCvScene_) {
                lastCvScene_ = s;
                queue(p, s, active);
            }
        } else {
            lastCvScene_ = -1;
        }

        // ---- the beat
        if (active && beatEvent && beat >= 0) {
            lastBeat_ = beat;
            const int bpb = std::max(1, p.beatsPerBar);
            const bool isBar = beat % bpb == 0;
            const bool isUnit = beat % std::max(1, p.lenBeats) == 0;
            if (pending_ >= 0 && !changed_ && (p.quantize == QuantBeat || (p.quantize == QuantBar && isBar))) {
                launchNow(p, pending_);
            } else if (isUnit && !changed_) {
                if (beat == skipUnitBeat_) skipUnitBeat_ = -1;
                else unitEnd(p);
            }
            if (beat == skipUnitBeat_) skipUnitBeat_ = -1;
        }

        // ---- outputs
        scene_ = std::clamp(scene_, 0, scenes - 1);
        out.scene = p.cvLinear ? (float)scene_ / 15.0f : ((float)scene_ + 0.5f) / (float)kSaSlots;
        out.change = changeLeft_ > 0 ? 1.0f : 0.0f;
        out.cycle = cycleLeft_ > 0 ? 1.0f : 0.0f;
        out.queued = pending_ >= 0 ? 1.0f : 0.0f;
        if (changeLeft_ > 0) --changeLeft_;
        if (cycleLeft_ > 0) --cycleLeft_;
        for (int k = 0; k < kSaLanes; ++k) {
            float v = 0.0f;
            if (active) {
                if (p.laneTrigger) v = laneLeft_[k] > 0 ? 1.0f : 0.0f;
                else v = laneIn(p, k, scene_) ? 1.0f : 0.0f;
            }
            if (laneLeft_[k] > 0) --laneLeft_[k];
            out.lane[k] = v;
        }
    }

    int scene() const noexcept { return scene_; }
    int slot() const noexcept { return slot_; }
    int repeat() const noexcept { return repeat_; }
    int pending() const noexcept { return pending_; }

private:
    static bool laneIn(const SaParams& p, int k, int scene) noexcept {
        if (p.laneFrom[k] <= 0) return false;
        const int lo = std::min(p.laneFrom[k], std::max(1, p.laneTo[k]));
        const int hi = std::max(p.laneFrom[k], std::max(1, p.laneTo[k]));
        return scene + 1 >= lo && scene + 1 <= hi;
    }

    int slotOf(const SaParams& p, int scene) const noexcept {
        for (int i = 0; i < steps_; ++i)
            if (std::clamp(p.slotScene[i], 1, scenes_) - 1 == scene) return i;
        return -1;
    }

    /// A new visit of `scene`; `slot` is its place in the play order, or -1 when it is not on the list.
    void startVisit(const SaParams& p, int scene, int slot) noexcept {
        scene_ = std::clamp(scene, 0, scenes_ - 1);
        if (slot >= 0) slot_ = slot;
        repeatsNeeded_ = slot >= 0 ? std::clamp(p.slotRepeat[slot], 1, 64) : 1;
        repeat_ = 0;
        ++visit_;
        changed_ = true;
        changeLeft_ = pulseSamples_;
        for (int k = 0; k < kSaLanes; ++k)
            if (laneIn(p, k, scene_)) laneLeft_[k] = pulseSamples_;
    }

    void beginPlay(const SaParams& p, bool fromReset) noexcept {
        if (manual_ && !fromReset) {
            // A launch made while stopped decides where the arrangement starts.
            startVisit(p, scene_, slotOf(p, scene_));
        } else {
            const int s0 = std::clamp(p.slotScene[0], 1, scenes_) - 1;
            slot_ = 0;
            startVisit(p, s0, 0);
        }
        manual_ = false;
        pending_ = -1;
        begun_ = true;
    }

    void launchNow(const SaParams& p, int scene) noexcept {
        pending_ = -1;
        startVisit(p, scene, slotOf(p, scene));
    }

    void queue(const SaParams& p, int scene, bool active) noexcept {
        if (!active) {
            manual_ = true;
            pending_ = -1;
            startVisit(p, scene, slotOf(p, scene));
            return;
        }
        if (p.quantize == QuantImmediate) launchNow(p, scene);
        else pending_ = scene;
    }

    void nextSlot(const SaParams& p) noexcept {
        const int s2 = (slot_ + 1) % steps_;
        if (s2 == 0) cycleLeft_ = pulseSamples_;
        startVisit(p, std::clamp(p.slotScene[s2], 1, scenes_) - 1, s2);
    }

    void unitEnd(const SaParams& p) noexcept {
        if (!begun_) return;
        if (++repeat_ < repeatsNeeded_) return;
        const int s = scene_;
        auto go = [&](int dest) { startVisit(p, dest, slotOf(p, dest)); };
        switch (std::clamp(p.follow[s], 0, kSaFollows - 1)) {
            case FollowNext: go((s + 1) % scenes_); break;
            case FollowPrevious: go((s + scenes_ - 1) % scenes_); break;
            case FollowRandom:
                if (scenes_ <= 1) repeat_ = 0;
                else {
                    int d = (int)std::floor(dsp::uniform01(p.seed, (uint64_t)visit_, 7) * (double)(scenes_ - 1));
                    d = std::min(d, scenes_ - 2);
                    go(d >= s ? d + 1 : d);  // any scene but this one
                }
                break;
            case FollowHold: repeat_ = 0; break;
            case FollowJump: go(std::clamp(p.target[s], 1, scenes_) - 1); break;
            case FollowChance:
                if (dsp::uniform01(p.seed, (uint64_t)visit_, 8) < (double)p.chance[s]) go(std::clamp(p.target[s], 1, scenes_) - 1);
                else nextSlot(p);
                break;
            default: nextSlot(p); break;
        }
    }

    double sampleRate_ = 48000.0;
    int64_t pulseSamples_ = 96;
    dsp::GateEdge clock_, reset_, next_, prev_;
    int scenes_ = 8, steps_ = 8;
    int scene_ = 0, slot_ = 0, repeat_ = 0, repeatsNeeded_ = 1, pending_ = -1;
    int64_t visit_ = 0;
    int lastLaunchKnob_ = 0, lastCvScene_ = -1;
    bool begun_ = false, manual_ = false, wasActive_ = false, changed_ = false, pendingReset_ = false;
    double off_ = 0.0, lastPpq_ = 0.0;
    int64_t lastBeat_ = -1, skipUnitBeat_ = -1, n_ = -1;
    int64_t changeLeft_ = 0, cycleLeft_ = 0, laneLeft_[kSaLanes]{};
};

}  // namespace bleep::patch
