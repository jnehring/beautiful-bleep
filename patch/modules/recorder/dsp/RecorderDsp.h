// SPDX-License-Identifier: GPL-3.0-only
// Recorder core (doc/specs/modules/recorder.md §4): a stereo take in memory with arm /
// record / stop, a length limit, start on signal or on a gate, and a pre-roll: while armed the
// last moments are kept, so a take that starts on a signal still has its beginning.
//
// All memory is allocated in prepare(); nothing is allocated while recording.
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>

namespace bleep::patch {

constexpr double kRecorderMaxSeconds = 120.0;
constexpr double kRecorderMaxPreroll = 2.0;
constexpr int kRecorderPeakColumns = 512;

enum RecorderState : int { RecIdle = 0, RecArmed, RecRecording, RecDone };

struct RecorderParams {
    double limit = 30.0;        ///< seconds; the take ends when it is full
    bool autoStart = true;      ///< an armed recorder starts when the input passes the threshold
    float threshold = 0.03f;    ///< linear
    double preroll = 0.25;      ///< seconds kept while armed
    bool gateControl = false;   ///< the Gate input starts (rising, if armed or idle) and ends (falling) a take
};

struct RecorderFrame {
    float recording = 0.0f;  ///< gate
    float done = 0.0f;       ///< short trigger when a take ends
    float progress = 0.0f;   ///< 0..1 of the limit
};

class RecorderDsp {
public:
    void prepare(double sampleRate) {
        sr_ = sampleRate;
        capacity_ = (size_t)(kRecorderMaxSeconds * sampleRate);
        left_.reset(new float[capacity_]);  // untouched memory stays unmapped until a take reaches it
        right_.reset(new float[capacity_]);
        preCapacity_ = (size_t)(kRecorderMaxPreroll * sampleRate) + 1;
        preL_.reset(new float[preCapacity_]());
        preR_.reset(new float[preCapacity_]());
        pulseLen_ = std::max(1, (int)(0.002 * sampleRate));
        reset();
    }
    void reset() noexcept {
        state_.store(RecIdle, std::memory_order_seq_cst);
        length_.store(0, std::memory_order_release);
        preWrite_ = 0;
        preFilled_ = 0;
        pos_ = 0;
        gateHigh_ = false;
        gateStarted_ = false;
        pulseLeft_ = 0;
        clearPeaks();
        pending_ = 0;
    }

    // ---- commands (audio thread) ---------------------------------------------------------------
    void arm() noexcept {
        if (state_.load() == RecRecording) return;
        preFilled_ = 0;
        state_.store(RecArmed);
    }
    void record() noexcept { pending_ = 1; }
    void stop() noexcept { pending_ = 2; }
    void clear() noexcept {
        if (state_.load() == RecRecording) return;
        length_.store(0, std::memory_order_release);
        clearPeaks();
        state_.store(RecIdle);
    }

    RecorderFrame tick(const RecorderParams& p, float l, float r, float gate) noexcept {
        const size_t limit = std::min(capacity_, (size_t)(std::max(0.1, p.limit) * sr_));
        const bool gateNow = gate >= 0.5f;
        const bool gateRise = gateNow && !gateHigh_, gateFall = !gateNow && gateHigh_;
        gateHigh_ = gateNow;
        const float level = std::max(std::fabs(l), std::fabs(r));
        const int before = state_.load();
        bool started = false;
        if (before == RecArmed) {
            // The pre-roll ring runs while armed; the take starts with the newest `keep` samples, this one included.
            preL_[preWrite_] = l;
            preR_[preWrite_] = r;
            preWrite_ = (preWrite_ + 1) % preCapacity_;
            preFilled_ = std::min(preFilled_ + 1, preCapacity_);
            const size_t keep = std::min(preFilled_, (size_t)(std::clamp(p.preroll, 0.0, kRecorderMaxPreroll) * sr_) + 1);
            if (pending_ == 1 || (p.autoStart && level >= p.threshold) || (p.gateControl && gateRise))
                started = beginTake(limit, keep);
        } else if (before != RecRecording) {
            if (pending_ == 1 || (p.gateControl && gateRise)) started = beginTake(limit, 0);
        }
        if (started) gateStarted_ = p.gateControl && gateRise;
        if (pending_ == 2 && state_.load() == RecRecording) endTake();
        if ((before == RecRecording && state_.load() == RecRecording) || (started && before != RecArmed)) {
            if (gateStarted_ && gateFall) {
                endTake();  // the gate went low: this sample is not part of the take
            } else {
                if (pos_ < limit) {
                    left_[pos_] = l;
                    right_[pos_] = r;
                    notePeak(pos_, limit, level);
                    ++pos_;
                }
                if (pos_ >= limit) endTake();
            }
        }
        pending_ = 0;
        return finish(limit);
    }

    int state() const noexcept { return state_.load(); }
    /// Samples recorded so far in the running take (audio thread).
    size_t recordedSoFar() const noexcept { return pos_; }
    size_t length() const noexcept { return length_.load(std::memory_order_acquire); }
    double sampleRate() const noexcept { return sr_; }
    const float* left() const noexcept { return left_.get(); }
    const float* right() const noexcept { return right_.get(); }
    /// Peak per column over the limit the take was started with (see peakSeconds()).
    float peak(int col) const noexcept { return peaks_[(size_t)col].load(std::memory_order_relaxed); }
    double peakSeconds() const noexcept { return peakSeconds_.load(std::memory_order_relaxed); }

    /// Message thread: take the right to read the take (false while it is being recorded). Release with endRead().
    bool beginRead() noexcept {
        reading_.store(true);
        if (state_.load() == RecRecording) {
            reading_.store(false);
            return false;
        }
        return true;
    }
    void endRead() noexcept { reading_.store(false); }

private:
    /// Starts a take with the newest `fromRing` samples of the pre-roll ring. False while the take is being read out.
    bool beginTake(size_t limit, size_t fromRing) noexcept {
        if (reading_.load()) return false;  // the previous take is being exported: try again next sample
        state_.store(RecRecording);          // seq_cst: pairs with beginRead()
        if (reading_.load()) {
            state_.store(RecIdle);
            return false;
        }
        clearPeaks();
        peakSeconds_.store((double)limit / sr_, std::memory_order_relaxed);
        pos_ = 0;
        length_.store(0, std::memory_order_release);
        const size_t n = std::min(fromRing, limit);
        for (size_t i = 0; i < n; ++i) {
            const size_t k = (preWrite_ + preCapacity_ - n + i) % preCapacity_;  // oldest first, the newest last
            left_[pos_] = preL_[k];
            right_[pos_] = preR_[k];
            notePeak(pos_, limit, std::max(std::fabs(preL_[k]), std::fabs(preR_[k])));
            ++pos_;
        }
        return true;
    }

    void endTake() noexcept {
        length_.store(pos_, std::memory_order_release);
        state_.store(pos_ > 0 ? RecDone : RecIdle);
        pulseLeft_ = pulseLen_;
        gateStarted_ = false;
        preFilled_ = 0;
    }

    RecorderFrame finish(size_t limit) noexcept {
        const int st = state_.load();
        RecorderFrame f;
        f.recording = st == RecRecording ? 1.0f : 0.0f;
        f.done = pulseLeft_ > 0 ? 1.0f : 0.0f;
        if (pulseLeft_ > 0) --pulseLeft_;
        const size_t n = st == RecRecording ? pos_ : st == RecDone ? length_.load(std::memory_order_relaxed) : 0;
        f.progress = std::clamp((float)n / (float)std::max<size_t>(limit, 1), 0.0f, 1.0f);
        return f;
    }

    void notePeak(size_t pos, size_t limit, float v) noexcept {
        const size_t col = std::min<size_t>(kRecorderPeakColumns - 1, pos * kRecorderPeakColumns / std::max<size_t>(limit, 1));
        if (v > peaks_[col].load(std::memory_order_relaxed)) peaks_[col].store(v, std::memory_order_relaxed);
    }
    void clearPeaks() noexcept {
        for (auto& p : peaks_) p.store(0.0f, std::memory_order_relaxed);
    }

    double sr_ = 48000.0;
    size_t capacity_ = 0, preCapacity_ = 1, preWrite_ = 0, preFilled_ = 0, pos_ = 0;
    std::unique_ptr<float[]> left_, right_, preL_, preR_;
    std::atomic<int> state_{RecIdle};
    std::atomic<size_t> length_{0};
    std::atomic<bool> reading_{false};
    std::atomic<double> peakSeconds_{30.0};
    std::array<std::atomic<float>, kRecorderPeakColumns> peaks_{};
    int pending_ = 0, pulseLen_ = 96, pulseLeft_ = 0;
    bool gateHigh_ = false, gateStarted_ = false;
};

}  // namespace bleep::patch
