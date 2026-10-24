// SPDX-License-Identifier: GPL-3.0-only
// Splice core (doc/specs/modules/splice.md): a tape-style sampler and looper.
// Audio is recorded onto a stereo reel of up to two minutes and cut into
// splices by markers; the current splice plays at a bipolar Speed, looped as
// a whole or broken into windows (Window Size, Position) that play with gaps,
// seamlessly, or as an overlapping cloud of up to four voices (Overlap).
// Triggers and a control input move between splices (Shift decides when).
// A reel loaded from the media store is copied in by serviceLoad() a slice at
// a time, so no single chunk does a big copy. Memory is allocated in
// prepare(); tick() never allocates.
#pragma once

#include "dsp/Delay.h"
#include "dsp/Random.h"
#include "dsp/Tempo.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace bleep::patch {

enum SpliceTarget { SpliceNew = 0, SpliceOverdub, SpliceWhole };
enum SpliceShift { ShiftImmediate = 0, ShiftWindow, ShiftSplice };
enum SpliceMonitor { MonitorOff = 0, MonitorRecording, MonitorAlways };

namespace splice {

constexpr double kMaxReelSeconds = 120.0;
constexpr int kMaxSplices = 128, kMaxMarkers = kMaxSplices - 1;
constexpr int kVoices = 8;  ///< up to 4 overlapping windows plus ones fading out
constexpr double kMinMarkerGap = 0.010;
constexpr double kMinWindow = 0.0005;

inline double reelSeconds(int index) noexcept {
    static constexpr double s[4] = {15.0, 30.0, 60.0, 120.0};
    return s[std::clamp(index, 0, 3)];
}
inline int syncBars(int index) noexcept {
    static constexpr int b[5] = {0, 1, 2, 4, 8};
    return b[std::clamp(index, 0, 4)];
}

/// Overlap zones: 0–30 % gaps, 30–50 % seamless, 50–100 % 2–4 overlapping voices.
enum Zone { Gaps, Seamless, Cloud };
inline Zone zone(float overlap) noexcept { return overlap < 0.3f ? Gaps : overlap <= 0.5f ? Seamless : Cloud; }
/// Gap share of the period (0.75 at 0 % … 0 at 30 %).
inline double gap(float overlap) noexcept { return 0.75 * (1.0 - std::clamp((double)overlap, 0.0, 0.3) / 0.3); }
/// Overlapping voices (2 at 50 % … 4 at 100 %).
inline double overlapFactor(float overlap) noexcept { return 2.0 + 4.0 * (std::clamp((double)overlap, 0.5, 1.0) - 0.5); }

/// Select / Pick with 2 % hysteresis: value 0 … 1 → splice 0 … n − 1.
inline int choose(float value, int n, int last) noexcept {
    if (n <= 1) return 0;
    const double v = std::clamp((double)value, 0.0, 1.0);
    const int c = std::min((int)(v * n), n - 1);
    if (last < 0 || last >= n || c == last) return c;
    if (c > last && v < (double)(last + 1) / n + 0.02) return last;
    if (c < last && v > (double)last / n - 0.02) return last;
    return c;
}

}  // namespace splice

struct SpliceParams {
    float speed = 1.0f;          ///< playback ratio (Speed knob), −4 … +4
    float window = 1.0f;         ///< Window Size: share of the splice
    float position = 0.0f;
    float overlap = 0.4f;
    float pick = 0.0f;
    float overdub = 1.0f;
    float level = 1.0f;
    float fadeSeconds = 0.003f;
    int reel = 2;                ///< Reel length index
    bool toggle = true;          ///< Record mode: Toggle (else Gate)
    int target = SpliceNew;
    int shift = ShiftSplice;
    bool endWindow = false;      ///< End Mode = Window
    bool oneShot = false;
    int monitor = MonitorRecording;
    int sync = 0;                ///< Sync index: Free, 1, 2, 4, 8 bars
    uint32_t seed = 1;
};

struct SpliceInput {
    float l = 0.0f, r = 0.0f;
    float record = 0.0f, mark = 0.0f, next = 0.0f, play = 0.0f;
    float select = 0.0f;
    bool selectPatched = false;
    float speed = 0.0f;          ///< Speed input, volts (1 V/oct)
    bool running = false;
    double ppq = 0.0, bpm = 120.0;
};

struct SpliceFrame {
    float l = 0.0f, r = 0.0f, end = 0.0f, position = 0.0f, splice = 0.0f;
};

class SpliceDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        cap_ = (int64_t)std::ceil(splice::kMaxReelSeconds * sampleRate);
        for (auto& c : reel_) c.assign((size_t)cap_, 0.0f);
        reset();
    }
    size_t memoryBytes() const noexcept { return 2 * (size_t)cap_ * sizeof(float); }

    void reset() noexcept {
        length_ = 0;
        markerCount_ = 0;
        current_ = 0;
        pending_ = -1;
        for (auto& v : voices_) v = Voice{};
        recording_ = false;
        recGain_ = 0.0f;
        stopping_ = false;
        phase_ = 0.0;
        acc_ = 0.0;
        done_ = false;
        lastSpawn_ = INT64_MIN;
        edges_ = Edges{};
        pickLast_ = selectLast_ = -1;
        pickValue_ = selectValue_ = -1.0f;
        loading_ = false;
        ++revision_;
        windowIndex_ = 0;
    }

    // ---- state for the module and the view ----------------------------------
    int64_t capacity() const noexcept { return cap_; }
    int64_t length() const noexcept { return length_; }
    int markerCount() const noexcept { return markerCount_; }
    int64_t marker(int i) const noexcept { return markers_[(size_t)i]; }
    int spliceCount() const noexcept { return length_ > 0 ? markerCount_ + 1 : 0; }
    int current() const noexcept { return current_; }
    int pending() const noexcept { return pending_; }
    bool recording() const noexcept { return recording_; }
    bool loading() const noexcept { return loading_; }
    /// Bumped on every structural change (markers, length, current).
    uint32_t revision() const noexcept { return revision_; }
    /// Bumped while audio is written (the reel differs from its saved file).
    uint64_t audioRevision() const noexcept { return audioRev_; }
    const float* channel(int c) const noexcept { return reel_[(size_t)c].data(); }
    int64_t spliceStart(int i) const noexcept { return i <= 0 ? 0 : markers_[(size_t)std::min(i, markerCount_) - 1]; }
    int64_t spliceEnd(int i) const noexcept { return i >= markerCount_ ? length_ : markers_[(size_t)i]; }
    /// The newest playing voice's position (absolute frames), −1 if none.
    double playhead() const noexcept { return head_; }
    double windowStart() const noexcept { return winStart_; }
    double windowLength() const noexcept { return winLen_; }
    /// Visits each playing voice's position (absolute frames).
    template <class F>
    void forEachHead(F&& f) const {
        for (const auto& v : voices_)
            if (v.active) f(v.pos);
    }

    // ---- commands (audio thread) ----------------------------------------------
    void recordButton() noexcept { edges_.recButton = true; }
    void markButton() noexcept { edges_.markButton = true; }
    void nextButton() noexcept { edges_.nextButton = true; }
    void playButton() noexcept { edges_.playButton = true; }
    void selectSplice(int i) noexcept {
        if (i >= 0 && i < spliceCount()) pending_ = i;
    }
    void clearReel() noexcept {
        stopRecording(false);
        length_ = 0;
        markerCount_ = 0;
        current_ = 0;
        pending_ = -1;
        releaseAll();
        ++revision_;
        ++audioRev_;
    }

    /// Replaces markers and the current splice (an edit from the view).
    void setMarkers(const int64_t* m, int count, int current) noexcept {
        if (recording_) return;  // the take in progress owns the structure
        markerCount_ = 0;
        int64_t last = 0;
        const int64_t gap = (int64_t)(splice::kMinMarkerGap * sr_);
        for (int i = 0; i < count && markerCount_ < splice::kMaxMarkers; ++i)
            if (m[i] >= last + gap && m[i] <= length_ - gap) markers_[(size_t)markerCount_++] = last = m[i];
        current_ = std::clamp(current, 0, std::max(spliceCount() - 1, 0));
        if (pending_ >= spliceCount()) pending_ = -1;
        ++revision_;
    }

    /// Starts copying a reel in (the audio is read from `ch` by serviceLoad).
    void beginLoad(const float* const* ch, int numChannels, int64_t frames, const int64_t* m, int count, int current) noexcept {
        stopRecording(false);
        releaseAll();
        loadSrc_[0] = ch && numChannels > 0 ? ch[0] : nullptr;
        loadSrc_[1] = ch && numChannels > 1 ? ch[1] : loadSrc_[0];
        loadFrames_ = std::clamp<int64_t>(frames, 0, cap_);
        loadPos_ = 0;
        loading_ = true;
        length_ = 0;
        markerCount_ = 0;
        loadMarkers_ = 0;
        for (int i = 0; i < count && i < splice::kMaxMarkers; ++i) loadM_[(size_t)loadMarkers_++] = m[i];
        loadCurrent_ = current;
        pending_ = -1;
        ++revision_;
    }
    /// Copies up to maxFrames of a pending load; call once per chunk.
    void serviceLoad(int64_t maxFrames) noexcept {
        if (!loading_) return;
        const int64_t n = std::min(maxFrames, loadFrames_ - loadPos_);
        for (int c = 0; c < 2; ++c)
            if (loadSrc_[c] != nullptr) std::copy(loadSrc_[c] + loadPos_, loadSrc_[c] + loadPos_ + n, reel_[(size_t)c].data() + loadPos_);
        loadPos_ += n;
        if (loadPos_ >= loadFrames_) {
            loading_ = false;
            length_ = loadSrc_[0] ? loadFrames_ : 0;
            setMarkers(loadM_.data(), loadMarkers_, loadCurrent_);
            phase_ = 0.0;
            acc_ = 0.0;
            done_ = false;
        }
    }

    // ---- one sample --------------------------------------------------------------
    void tick(const SpliceParams& p, const SpliceInput& in, SpliceFrame& f) noexcept {
        f.end = 0.0f;
        fade_ = std::max(1.0, (double)std::clamp(p.fadeSeconds, 0.0f, 0.05f) * sr_);  // 1: no fade
        const int64_t reelCap = std::min<int64_t>(cap_, (int64_t)std::llround(splice::reelSeconds(p.reel) * sr_));

        // Edges of the trigger and gate inputs.
        const bool recHigh = in.record >= 0.5f;
        const bool recRise = recHigh && !edges_.rec, recFall = !recHigh && edges_.rec;
        edges_.rec = recHigh;
        const bool mark = rise(in.mark, edges_.mark) || std::exchange(edges_.markButton, false);
        const bool next = rise(in.next, edges_.next) || std::exchange(edges_.nextButton, false);
        const bool play = rise(in.play, edges_.play) || std::exchange(edges_.playButton, false);
        const bool button = std::exchange(edges_.recButton, false);

        // Recording on / off.
        if (!loading_) {
            bool want = recording_ && !stopping_;
            if (p.toggle) {
                if (recRise || button) want = !want;
            } else {
                if (button) edges_.recLatched = !edges_.recLatched;
                if (recRise || recFall || button) want = recHigh || edges_.recLatched;
            }
            if (want && !(recording_ && !stopping_)) startRecording(p, reelCap);
            else if (!want && recording_ && !stopping_) stopRecording(true);
        }

        // Splice selection: Select (patched) or Pick set a pending splice when
        // their choice changes; Next steps from whichever is in charge.
        const int n = spliceCount();
        if (n > 0 && !loading_) {
            const float value = in.selectPatched ? in.select : p.pick;
            float& lastValue = in.selectPatched ? selectValue_ : pickValue_;
            int& last = in.selectPatched ? selectLast_ : pickLast_;
            if (std::fabs(value - lastValue) > 1e-5f) {  // only a moving knob or input picks
                const bool first = lastValue < -0.5f;
                lastValue = value;
                const int sel = splice::choose(value, n, last);
                if (sel != last && !first) pending_ = sel;
                last = sel;
            }
            if (next) pending_ = ((pending_ >= 0 ? pending_ : current_) + 1) % n;
        }
        if (mark) addMarkerNow();

        // Recording writes.
        float monitor = p.monitor == MonitorAlways || (p.monitor == MonitorRecording && recording_) ? 1.0f : 0.0f;
        if (recording_) record(p, in, reelCap);

        // Playback.
        float yl = 0.0f, yr = 0.0f;
        head_ = -1.0;
        const bool appending = recording_ && p.target != SpliceOverdub;
        if (n > 0 && !loading_ && !appending) {
            if (play) {
                if (pending_ >= 0) switchTo(pending_);
                releaseAll();
                restartCycle();
            }
            if (pending_ >= 0 && p.shift == ShiftImmediate) {
                switchTo(pending_);
                releaseAll();
                restartCycle();
            }
            schedule(p, in, f);
        } else if (n == 0 || loading_ || appending) {
            releaseAll();
        }
        int64_t newest = -1;
        for (auto& v : voices_) {
            if (!v.active) continue;
            if (!v.releasing && v.serial > newest) {
                newest = v.serial;
                head_ = v.pos;
            }
            float vl = 0.0f, vr = 0.0f;
            render(v, vl, vr);
            yl += vl;
            yr += vr;
        }

        const float level = std::clamp(p.level, 0.0f, 2.0f);
        f.l = level * yl + monitor * in.l;
        f.r = level * yr + monitor * in.r;
        const int cur = std::clamp(current_, 0, std::max(n - 1, 0));
        const double S = (double)(spliceEnd(cur) - spliceStart(cur));
        f.position = head_ >= 0.0 && S > 0.0 ? (float)std::clamp((head_ - (double)spliceStart(cur)) / S, 0.0, 1.0) : 0.0f;
        f.splice = n > 1 ? (float)cur / (float)(n - 1) : 0.0f;
    }

private:
    struct Voice {
        bool active = false, hann = false;
        double pos = 0.0, ratio = 1.0;
        int64_t age = 0, len = 0, serial = 0;
        double fadeIn = 1.0, fadeOut = 1.0;
        float gain = 1.0f, gl = 1.0f, gr = 1.0f, rel = 1.0f, attack = 1.0f;
        bool releasing = false;
    };
    struct Edges {
        bool rec = false, recLatched = false, mark = false, next = false, play = false;
        bool recButton = false, markButton = false, nextButton = false, playButton = false;
    };

    static bool rise(float x, bool& high) noexcept {
        const bool h = x >= 0.5f, r = h && !high;
        high = h;
        return r;
    }

    // ---- recording -----------------------------------------------------------------
    void startRecording(const SpliceParams& p, int64_t reelCap) noexcept {
        target_ = p.target;
        if (target_ == SpliceWhole) {
            length_ = 0;
            markerCount_ = 0;
            current_ = 0;
        }
        if (target_ == SpliceOverdub) {
            if (spliceCount() == 0) return;  // nothing to overdub onto
            const int cur = current_;
            overStart_ = spliceStart(cur);
            overEnd_ = spliceEnd(cur);
            overPos_ = head_ >= (double)overStart_ && head_ < (double)overEnd_ ? head_ : (double)overStart_;
        } else {
            if (length_ >= reelCap) return;  // full
            recording_ = true;
            if (length_ > 0) addMarker(length_);
            current_ = spliceCount() - 1;
            if (length_ == 0) current_ = 0;
            recPos_ = length_;
            releaseAll();
        }
        pending_ = -1;
        recording_ = true;
        stopping_ = false;
        recGain_ = 0.0f;
        ++revision_;
    }

    void stopRecording(bool fade) noexcept {
        if (!recording_) return;
        if (fade && target_ == SpliceOverdub) {  // keep writing while the punch-out ramps
            stopping_ = true;
            return;
        }
        if (target_ != SpliceOverdub && fade && fade_ >= 1.5) {  // punch-out: fade the take's last samples
            const int64_t f = std::min<int64_t>((int64_t)fade_, length_ - (target_ == SpliceNew ? spliceStart(current_) : 0));
            for (int64_t i = 0; i < f; ++i) {
                const float g = (float)i / (float)std::max<int64_t>(f, 1);
                for (auto& c : reel_) c[(size_t)(length_ - 1 - i)] *= g;
            }
        }
        recording_ = stopping_ = false;
        if (target_ != SpliceOverdub && length_ > 0) {
            // The new take becomes a splice of at least 10 ms; a shorter one is dropped.
            const int64_t start = spliceStart(spliceCount() - 1);
            if (length_ - start < (int64_t)(splice::kMinMarkerGap * sr_) && markerCount_ > 0) {
                length_ = start;
                --markerCount_;
            }
            current_ = std::max(spliceCount() - 1, 0);
        }
        restartCycle();
        ++revision_;
    }

    void record(const SpliceParams& p, const SpliceInput& in, int64_t reelCap) noexcept {
        const float step = (float)(1.0 / fade_);
        recGain_ = stopping_ ? std::max(recGain_ - step, 0.0f) : std::min(recGain_ + step, 1.0f);
        if (target_ == SpliceOverdub) {
            const int64_t i = std::clamp<int64_t>((int64_t)std::floor(overPos_), overStart_, std::max(overEnd_ - 1, overStart_));
            const float keep = 1.0f - recGain_ + recGain_ * std::clamp(p.overdub, 0.0f, 1.0f);
            reel_[0][(size_t)i] = keep * reel_[0][(size_t)i] + recGain_ * in.l;
            reel_[1][(size_t)i] = keep * reel_[1][(size_t)i] + recGain_ * in.r;
            const double v = speedRatio(p, in);
            const double span = (double)std::max<int64_t>(overEnd_ - overStart_, 1);
            overPos_ += v;
            if (overPos_ >= (double)overEnd_) overPos_ -= span;
            else if (overPos_ < (double)overStart_) overPos_ += span;
            ++audioRev_;
            if (stopping_ && recGain_ <= 0.0f) {
                recording_ = stopping_ = false;
                ++revision_;
            }
            return;
        }
        if (recPos_ >= reelCap) {  // full: stop
            stopRecording(true);
            return;
        }
        reel_[0][(size_t)recPos_] = recGain_ * in.l;
        reel_[1][(size_t)recPos_] = recGain_ * in.r;
        length_ = ++recPos_;
        ++audioRev_;
    }

    // ---- markers -------------------------------------------------------------------
    bool addMarker(int64_t at) noexcept {
        if (markerCount_ >= splice::kMaxMarkers) return false;
        const int64_t gap = (int64_t)(splice::kMinMarkerGap * sr_);
        if (at < gap || at > length_ - (recording_ ? 0 : gap)) return false;
        int i = 0;
        while (i < markerCount_ && markers_[(size_t)i] < at) ++i;
        if ((i > 0 && at - markers_[(size_t)i - 1] < gap) || (i < markerCount_ && markers_[(size_t)i] - at < gap)) return false;
        for (int k = markerCount_; k > i; --k) markers_[(size_t)k] = markers_[(size_t)k - 1];
        markers_[(size_t)i] = at;
        ++markerCount_;
        ++revision_;
        return true;
    }
    /// Mark: while appending, splits the take at the record head (the new
    /// part becomes current); while playing, splits the current splice at the
    /// play head.
    void addMarkerNow() noexcept {
        if (recording_ && target_ != SpliceOverdub) {
            if (addMarker(recPos_)) current_ = spliceCount() - 1;
            return;
        }
        if (head_ >= 0.0) addMarker((int64_t)std::llround(head_));  // the current splice keeps its first half
    }

    // ---- playback ------------------------------------------------------------------
    double speedRatio(const SpliceParams& p, const SpliceInput& in) const noexcept {
        return (double)std::clamp(p.speed, -4.0f, 4.0f) * std::exp2(std::clamp((double)in.speed, -8.0, 8.0));
    }

    void switchTo(int i) noexcept {
        current_ = std::clamp(i, 0, std::max(spliceCount() - 1, 0));
        pending_ = -1;
        ++revision_;
    }
    void restartCycle() noexcept {
        phase_ = 0.0;
        acc_ = 0.0;
        done_ = false;
        lastSpawn_ = INT64_MIN;
    }
    void releaseAll() noexcept {
        for (auto& v : voices_)
            if (v.active) v.releasing = true;
    }

    void schedule(const SpliceParams& p, const SpliceInput& in, SpliceFrame& f) noexcept {
        int cur = std::clamp(current_, 0, spliceCount() - 1);
        double start = (double)spliceStart(cur), S = (double)(spliceEnd(cur) - spliceStart(cur));
        if (S < 2.0) return;
        double v = speedRatio(p, in);
        const int bars = splice::syncBars(p.sync);
        const bool synced = bars > 0 && in.running;
        double barSamples = 0.0;
        if (synced) {  // the splice lasts exactly `bars` bars; pitch follows
            barSamples = dsp::beatsToSamples(4.0 * bars, in.bpm, sr_);
            v = (v < 0.0 ? -1.0 : 1.0) * S / std::max(barSamples, 1.0);
        }
        if (std::fabs(v) < 1e-4) {  // tape stop
            releaseAll();
            return;
        }
        const double G = std::clamp((double)p.window * S, std::min(splice::kMinWindow * sr_, S), S);
        const double ws = start + std::clamp((double)p.position, 0.0, 1.0) * (S - G);
        winStart_ = ws;
        winLen_ = G;
        const double lout = std::max(G / std::fabs(v), 2.0);
        const splice::Zone z = splice::zone(p.overlap);
        double period = lout;
        if (z == splice::Gaps) period = lout / (1.0 - splice::gap(p.overlap));
        else if (z == splice::Cloud) period = lout / splice::overlapFactor(p.overlap);

        // End of splice: after a splice length of audio has played.
        bool spawnNow = false;
        const bool passEnded = acc_ >= S;
        acc_ += std::fabs(v);
        if (passEnded) {
            acc_ -= S * std::floor((acc_ - std::fabs(v)) / S);
            if (!p.endWindow) f.end = 1.0f;
            if (p.oneShot && !p.endWindow) done_ = true;
            if (pending_ >= 0 && p.shift == ShiftSplice) {
                switchTo(pending_);
                releaseAll();
                restartCycle();
                spawnNow = true;
                cur = current_;
                start = (double)spliceStart(cur);
                S = (double)(spliceEnd(cur) - spliceStart(cur));
            }
        }

        // Window starts: counted down (Free) or from the song position (Sync).
        int64_t age0 = 0;
        if (synced) {
            const double song = in.ppq * dsp::beatsToSamples(1.0, in.bpm, sr_);
            const int64_t e = (int64_t)std::floor(song / period);
            if (e != lastSpawn_ || spawnNow) {
                const bool jumped = lastSpawn_ != INT64_MIN && e != lastSpawn_ + 1;
                age0 = (int64_t)(song - (double)e * period);
                if (jumped || lastSpawn_ == INT64_MIN) releaseAll();
                lastSpawn_ = e;
                spawnNow = true;
            }
        } else {
            if (phase_ <= 0.0 || spawnNow) {
                phase_ = spawnNow ? period : phase_ + period;
                spawnNow = true;
            }
            phase_ -= 1.0;
        }
        if (!spawnNow) return;
        if (pending_ >= 0 && p.shift == ShiftWindow) {  // the new splice starts on the next sample
            switchTo(pending_);
            releaseAll();
            restartCycle();
            return;
        }
        if (done_) return;
        spawnWindow(p, v, ws, G, lout, z, age0);
        if (p.endWindow) {
            f.end = 1.0f;
            if (p.oneShot) done_ = true;
        }
    }

    void spawnWindow(const SpliceParams& p, double v, double ws, double G, double lout, splice::Zone z, int64_t age0) noexcept {
        Voice nv;
        nv.active = true;
        nv.serial = ++serial_;
        nv.ratio = v;
        nv.age = age0;
        const double fade = fade_ < 1.5 ? 0.0 : std::min(fade_, 0.5 * lout);
        float pan = 0.0f;
        if (z == splice::Cloud) {
            const double factor = splice::overlapFactor(p.overlap);
            nv.hann = true;
            nv.len = (int64_t)std::ceil(lout);
            nv.gain = (float)(2.0 / factor);
            const double share = std::clamp(((double)p.overlap - 0.75) / 0.25, 0.0, 1.0);
            const uint64_t w = windowIndex_;
            if (dsp::uniform01(p.seed, w, 0x73706c31u) < share) {  // seeded pitch scatter
                static constexpr double semis[4] = {0.0, 12.0, -12.0, 7.0};
                nv.ratio = v * std::exp2(semis[(int)(dsp::uniform01(p.seed, w, 0x73706c32u) * 4.0) & 3] / 12.0);
            }
            pan = (float)(share * (2.0 * dsp::uniform01(p.seed, w, 0x73706c33u) - 1.0));
            const double span = (double)nv.len * std::fabs(nv.ratio);
            const double centre = ws + 0.5 * G;  // pitched voices stay centred on the window
            nv.pos = nv.ratio > 0.0 ? centre - 0.5 * span : centre + 0.5 * span;
        } else {
            nv.len = (int64_t)std::ceil(lout + (z == splice::Seamless ? fade : 0.0));
            nv.fadeIn = fade;
            nv.fadeOut = fade;
            nv.pos = v > 0.0 ? ws : ws + G - 1e-6;
        }
        nv.pos += nv.ratio * (double)age0;
        nv.attack = age0 > 0 ? 0.0f : 1.0f;  // joined mid-window (a jump): fade in
        if (pan != 0.0f) {  // equal power, unity in the centre
            const float th = (pan + 1.0f) * 0.78539816f;
            nv.gl = 1.41421356f * std::cos(th);
            nv.gr = 1.41421356f * std::sin(th);
        }
        ++windowIndex_;
        Voice* slot = nullptr;
        for (auto& s : voices_)
            if (!s.active) {
                slot = &s;
                break;
            }
        if (slot == nullptr) {  // steal the oldest
            for (auto& s : voices_)
                if (slot == nullptr || s.serial < slot->serial) slot = &s;
        }
        *slot = nv;
    }

    void render(Voice& v, float& l, float& r) noexcept {
        double g;
        const double t = (double)v.age;
        if (v.hann) {
            g = 0.5 - 0.5 * std::cos(6.283185307179586 * (t + 0.5) / (double)v.len);
        } else {
            g = 1.0;
            if (t < v.fadeIn) g = std::sin(1.5707963267948966 * (t + 0.5) / v.fadeIn);
            const double out = (double)v.len - t;
            if (out < v.fadeOut) g = std::min(g, std::sin(1.5707963267948966 * std::max(out - 0.5, 0.0) / v.fadeOut));
        }
        if (v.attack < 1.0f) v.attack = std::min(v.attack + (float)(1.0 / fade_), 1.0f);
        if (v.releasing) {
            v.rel -= (float)(1.0 / fade_);
            if (v.rel <= 0.0f) {
                v.active = false;
                return;
            }
        }
        const float a = (float)g * v.gain * v.attack * v.rel;
        l = a * v.gl * read(0, v.pos);
        r = a * v.gr * read(1, v.pos);
        v.pos += v.ratio;
        if (++v.age >= v.len) v.active = false;
    }

    /// Cubic read of the reel; silence outside [0, length).
    float read(int c, double pos) const noexcept {
        const float* x = reel_[(size_t)c].data();
        const int64_t n = length_;
        if (n < 4 || pos < -2.0 || pos > (double)n + 1.0) return 0.0f;
        const int64_t i = (int64_t)std::floor(pos);
        const float t = (float)(pos - (double)i);
        const auto at = [&](int64_t k) { return k >= 0 && k < n ? x[(size_t)k] : 0.0f; };
        return dsp::hermite4(at(i - 1), at(i), at(i + 1), at(i + 2), t);
    }

    double sr_ = 48000.0, fade_ = 144.0;
    std::array<std::vector<float>, 2> reel_;
    int64_t cap_ = 0, length_ = 0;
    std::array<int64_t, splice::kMaxMarkers> markers_{};
    int markerCount_ = 0, current_ = 0, pending_ = -1, pickLast_ = -1, selectLast_ = -1;
    float pickValue_ = -1.0f, selectValue_ = -1.0f;
    std::array<Voice, splice::kVoices> voices_{};
    int64_t serial_ = 0;
    double head_ = -1.0, winStart_ = 0.0, winLen_ = 0.0;
    // recording
    bool recording_ = false, stopping_ = false;
    int target_ = SpliceNew;
    float recGain_ = 0.0f;
    int64_t recPos_ = 0, overStart_ = 0, overEnd_ = 0;
    double overPos_ = 0.0;
    // scheduling
    double phase_ = 0.0, acc_ = 0.0;
    bool done_ = false;
    int64_t lastSpawn_ = INT64_MIN;
    uint64_t windowIndex_ = 0;
    Edges edges_;
    // loading
    bool loading_ = false;
    const float* loadSrc_[2] = {nullptr, nullptr};
    int64_t loadFrames_ = 0, loadPos_ = 0;
    std::array<int64_t, splice::kMaxMarkers> loadM_{};
    int loadMarkers_ = 0, loadCurrent_ = 0;
    uint32_t revision_ = 0;
    uint64_t audioRev_ = 0;
};

}  // namespace bleep::patch
