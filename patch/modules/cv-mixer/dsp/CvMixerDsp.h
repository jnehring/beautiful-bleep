// SPDX-License-Identifier: GPL-3.0-only
// CV Mixer core (doc/specs/modules/cv-mixer.md §4): four bipolar channels
// combined by sum, average, max, min or a scan across them.
#pragma once

#include "dsp/Clip.h"

#include <algorithm>
#include <cmath>

namespace bleep::patch {

constexpr int kCvMixerChannels = 4;

enum CvMixMode { CvMixSum = 0, CvMixAverage, CvMixMax, CvMixMin, CvMixScan };

struct CvMixerParams {
    int mode = CvMixSum;
    int clip = dsp::ClipSoft;
    float scan = 0.0f;
    float master = 1.0f;
    float offset = 0.0f;
};

struct CvMixerFrame {
    float out = 0.0f, inv = 0.0f, abs = 0.0f;
};

/// The mix before Master/Offset. `c[n]` = In × Level; `active[n]` per spec §4.1.
inline float cvMix(const float* c, const bool* active, int mode, float scan) noexcept {
    switch (mode) {
        case CvMixAverage:
        case CvMixSum: {
            float sum = 0.0f;
            int n = 0;
            for (int k = 0; k < kCvMixerChannels; ++k) {
                sum += c[k];
                n += active[k] ? 1 : 0;
            }
            if (mode == CvMixSum) return sum;
            return n > 0 ? sum / (float)n : 0.0f;
        }
        case CvMixMax:
        case CvMixMin: {
            bool any = false;
            float v = 0.0f;
            for (int k = 0; k < kCvMixerChannels; ++k) {
                if (!active[k]) continue;
                v = !any ? c[k] : mode == CvMixMax ? std::max(v, c[k]) : std::min(v, c[k]);
                any = true;
            }
            return v;
        }
        case CvMixScan: {
            const float pos = std::clamp(scan, 0.0f, 1.0f) * (float)(kCvMixerChannels - 1);
            const int lo = std::min((int)pos, kCvMixerChannels - 2);
            const float t = pos - (float)lo;
            return c[lo] * (1.0f - t) + c[lo + 1] * t;
        }
        default: return 0.0f;
    }
}

inline void cvMixerTick(const float* c, const bool* active, const CvMixerParams& p, CvMixerFrame& f) noexcept {
    const float mix = cvMix(c, active, p.mode, p.scan);
    f.out = dsp::clip(mix * p.master + p.offset, p.clip);
    f.inv = -f.out;
    f.abs = std::fabs(f.out);
    if (p.clip != dsp::ClipOff) f.abs = std::min(f.abs, 1.0f);
}

}  // namespace bleep::patch
