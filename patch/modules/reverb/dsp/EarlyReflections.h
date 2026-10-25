// SPDX-License-Identifier: GPL-3.0-only
// Verb's early reflections (doc/specs/modules/reverb.md): the discrete first
// echoes of a rectangular room, computed with the image-source method. Each
// room is a box with a source and a listener in it; every mirror image of the
// source up to the third reflection is one tap, with the delay of its extra
// path, the level of the 1/r spreading and the wall losses, a pan from the
// direction it arrives from, and a low-pass that closes with every bounce
// (walls and air take the highs first). The 24 earliest taps are kept. The
// tap times scale with Size; the level is normalised so Early = 100 % has
// the energy of the input.
#pragma once

#include "dsp/Delay.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace bleep::patch {

class EarlyReflections {
public:
    static constexpr int kMaxTaps = 24;
    static constexpr int kRoomCount = 6;  ///< Off, Booth, Studio, Club, Hall, Chapel
    static constexpr double kSpeedOfSound = 343.0;
    static constexpr double kMaxTapSeconds = 0.35;  ///< taps later than this are dropped
    static constexpr double kMaxScale = 2.0;

    /// Room 0 is Off; the others in order of size.
    static const char* roomName(int room) noexcept {
        static constexpr const char* names[kRoomCount] = {"Off", "Booth", "Studio", "Club", "Hall", "Chapel"};
        return names[std::clamp(room, 0, kRoomCount - 1)];
    }

    void prepare(double sampleRate, double maxPreDelaySeconds = 1.0) {
        sr_ = sampleRate;
        line_.resize((int)std::ceil((maxPreDelaySeconds + kMaxTapSeconds * kMaxScale) * sampleRate) + 8);
        preTime_.prepare(sampleRate, 0.002f, 1.0);
        scaleCoef_ = std::exp(-1.0 / (0.02 * sampleRate));
        levelCoef_ = std::exp(-1.0 / (0.005 * sampleRate));
        inStep_ = 1.0f / (float)(0.02 * sampleRate);
        setRoom(0);
        clear();
    }

    /// Rebuilds the taps. Not click-free by itself: the owner fades the wet
    /// path out around it.
    void setRoom(int room) noexcept {
        room_ = std::clamp(room, 0, kRoomCount - 1);
        count_ = 0;
        if (room_ == 0) return;
        struct Box {
            double w, d, h, beta;  // width (x), depth (y), height (z) in metres; wall reflectivity
        };
        static constexpr Box boxes[kRoomCount] = {{0, 0, 0, 0},         {2.4, 2.0, 2.3, 0.72}, {6.0, 4.6, 3.0, 0.80},
                                                  {13.0, 9.0, 4.2, 0.78}, {30.0, 21.0, 12.0, 0.86}, {42.0, 16.0, 22.0, 0.90}};
        const Box b = boxes[room_];
        // Source and listener as fractions of the room (kept off the middle
        // so the images are not symmetric), the listener facing +y.
        const double src[3] = {0.30 * b.w, 0.22 * b.d, 0.45 * b.h};
        const double lis[3] = {0.62 * b.w, 0.58 * b.d, 0.40 * b.h};
        const double dim[3] = {b.w, b.d, b.h};
        const double d0 = dist(src, lis);

        struct Image {
            double d, pan;
            int order;
        };
        std::array<Image, 216> images;
        int n = 0;
        for (int q = 0; q < 8; ++q) {
            for (int j = 0; j < 27; ++j) {
                double pos[3];
                int order = 0;
                for (int a = 0; a < 3; ++a) {
                    const int qa = (q >> a) & 1;
                    const int ja = (j / (a == 0 ? 1 : a == 1 ? 3 : 9)) % 3 - 1;
                    pos[a] = (1 - 2 * qa) * src[a] + 2.0 * ja * dim[a];
                    order += std::abs(ja - qa) + std::abs(ja);
                }
                if (order < 1 || order > 3) continue;
                const double dx = pos[0] - lis[0], dy = pos[1] - lis[1];
                const double flat = std::sqrt(dx * dx + dy * dy);
                images[(size_t)n++] = {dist(pos, lis), flat > 1e-9 ? dx / flat : 0.0, order};
            }
        }
        std::sort(images.begin(), images.begin() + n, [](const Image& a, const Image& b) { return a.d < b.d; });

        double energy = 0.0;
        for (int i = 0; i < n && count_ < kMaxTaps; ++i) {
            const Image& im = images[(size_t)i];
            const double t = std::max((im.d - d0) / kSpeedOfSound, 0.0005);
            if (t > kMaxTapSeconds) break;
            Tap& tap = taps_[(size_t)count_++];
            tap.seconds = t;
            const double g = std::min(std::pow(b.beta, im.order) * d0 / im.d, 1.0);
            const double angle = (im.pan + 1.0) * 0.78539816339744831;  // equal-power pan
            tap.gl = (float)(g * std::cos(angle));
            tap.gr = (float)(g * std::sin(angle));
            energy += g * g;
            const double fc = 14000.0 * std::pow(0.62, im.order) / (1.0 + 0.02 * im.d);
            tap.lp = (float)(1.0 - std::exp(-6.28318530717958648 * std::min(fc, 0.45 * sr_) / sr_));
        }
        const float norm = energy > 0.0 ? (float)(1.0 / std::sqrt(energy)) : 0.0f;
        for (int i = 0; i < count_; ++i) {
            taps_[(size_t)i].gl *= norm;
            taps_[(size_t)i].gr *= norm;
        }
        for (auto& tap : taps_) tap.z = 0.0f;
    }
    int room() const noexcept { return room_; }
    int tapCount() const noexcept { return count_; }
    double tapSeconds(int i) const noexcept { return taps_[(size_t)i].seconds; }

    void clear() noexcept {
        line_.clear();
        for (auto& tap : taps_) tap.z = 0.0f;
        primed_ = false;
    }

    /// One sample of the stereo input (summed to mono). size: 0 … 1 scales
    /// the tap times 0.5× … 2×; level: 0 … 1; freeze fades the input out.
    void process(float inL, float inR, float& outL, float& outR, float size, float level,
                 double preDelaySamples, bool freeze) noexcept {
        const double target = std::exp2(2.0 * (std::clamp((double)size, 0.0, 1.0) - 0.5));
        if (!primed_) {
            primed_ = true;
            scale_ = target;
            level_ = level;
            inGain_ = freeze ? 0.0f : 1.0f;
            preTime_.reset(preDelaySamples);
        }
        scale_ = target + scaleCoef_ * (scale_ - target);
        level_ = level + (float)levelCoef_ * (level_ - level);
        inGain_ += std::clamp((freeze ? 0.0f : 1.0f) - inGain_, -inStep_, inStep_);
        line_.write(0.5f * (inL + inR) * inGain_);
        outL = outR = 0.0f;
        if (room_ == 0 || count_ == 0) return;
        const double pd = preTime_.process(std::clamp(preDelaySamples, 0.0, 1.0 * sr_));
        float l = 0.0f, r = 0.0f;
        for (int i = 0; i < count_; ++i) {
            Tap& tap = taps_[(size_t)i];
            const float x = line_.readLinear(pd + tap.seconds * scale_ * sr_);
            tap.z += tap.lp * (x - tap.z);
            l += tap.gl * tap.z;
            r += tap.gr * tap.z;
        }
        outL = l * level_;
        outR = r * level_;
    }

private:
    struct Tap {
        double seconds = 0.0;
        float gl = 0.0f, gr = 0.0f, lp = 1.0f, z = 0.0f;
    };
    static double dist(const double* a, const double* b) noexcept {
        const double x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
        return std::sqrt(x * x + y * y + z * z);
    }

    double sr_ = 48000.0, scale_ = 1.0, scaleCoef_ = 0.999, levelCoef_ = 0.99;
    float level_ = 0.0f, inGain_ = 1.0f, inStep_ = 0.001f;
    int room_ = 0, count_ = 0;
    bool primed_ = false;
    dsp::RingDelay line_;
    dsp::TapeTime preTime_;
    std::array<Tap, kMaxTaps> taps_;
};

}  // namespace bleep::patch
