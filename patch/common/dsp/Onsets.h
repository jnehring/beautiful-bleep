// SPDX-License-Identifier: MIT
// Onset and tempo detection for slicing a sample (specs/modules/sampler.md
// section 4.2). An energy-flux detector: the signal is high-passed with a
// first difference (so low rumble doesn't mask a click), cut into 256-sample
// hops, and the rise in log energy from hop to hop is the onset function. Peaks
// above an adaptive threshold are onsets; each is placed on the first sample
// that rises above a fraction of the local peak and moved back to a zero
// crossing. The tempo comes from the autocorrelation of the same function.
// Message-thread only: it allocates and may take a few milliseconds per minute
// of audio.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace bleep::dsp {

struct OnsetAnalysis {
    static constexpr int kHop = 256;
    std::vector<float> flux;  ///< onset function, one value per hop
    double fluxRate = 0.0;    ///< hops per second
};

/// The onset function of `x` (any channel count is mixed to mono first).
inline OnsetAnalysis onsetFunction(const float* const* ch, int channels, int64_t frames, double sampleRate) {
    OnsetAnalysis a;
    a.fluxRate = sampleRate / OnsetAnalysis::kHop;
    const int64_t hops = frames / OnsetAnalysis::kHop;
    if (hops < 3 || channels < 1) return a;
    std::vector<double> energy((size_t)hops, 0.0);
    double prev = 0.0, peak = 0.0;
    for (int64_t h = 0; h < hops; ++h) {
        double e = 0.0;
        for (int i = 0; i < OnsetAnalysis::kHop; ++i) {
            const int64_t n = h * OnsetAnalysis::kHop + i;
            double x = 0.0;
            for (int c = 0; c < channels; ++c) x += (double)ch[c][n];
            x /= channels;
            const double y = x - 0.95 * prev;
            prev = x;
            e += y * y;
        }
        energy[(size_t)h] = e;
        peak = std::max(peak, e);
    }
    const double floorE = std::max(peak * 1e-6, 1e-12);
    a.flux.assign((size_t)hops, 0.0f);
    for (int64_t h = 1; h < hops; ++h)
        a.flux[(size_t)h] = (float)std::max(0.0, std::log(energy[(size_t)h] + floorE) - std::log(energy[(size_t)h - 1] + floorE));
    return a;
}

/// Onset positions in frames, ascending. `sensitivity` 0…1 (higher finds more),
/// `minGapSeconds` is the shortest slice. Position 0 is not reported.
inline std::vector<int64_t> detectOnsets(const float* const* ch, int channels, int64_t frames, double sampleRate,
                                         float sensitivity, double minGapSeconds) {
    std::vector<int64_t> out;
    const OnsetAnalysis a = onsetFunction(ch, channels, frames, sampleRate);
    const int64_t hops = (int64_t)a.flux.size();
    if (hops < 3) return out;
    const float s = std::clamp(sensitivity, 0.0f, 1.0f);
    float maxFlux = 0.0f;
    for (float f : a.flux) maxFlux = std::max(maxFlux, f);
    if (maxFlux <= 0.0f) return out;
    const int ctx = 12;
    const int64_t minGapHops = std::max<int64_t>(1, (int64_t)(minGapSeconds * a.fluxRate));
    int64_t lastHop = -1000000;
    for (int64_t h = 1; h < hops; ++h) {
        const float f = a.flux[(size_t)h];
        double mean = 0.0;
        int n = 0;
        for (int64_t k = std::max<int64_t>(0, h - ctx); k <= std::min(hops - 1, h + ctx); ++k, ++n) mean += a.flux[(size_t)k];
        mean /= std::max(1, n);
        const double thr = mean * (1.0 + 4.0 * (1.0 - s)) + (double)maxFlux * (0.04 + 0.5 * (1.0 - s) * (1.0 - s));
        if (f <= thr) continue;
        bool peak = true;  // a local maximum over ±2 hops
        for (int64_t k = std::max<int64_t>(0, h - 2); k <= std::min(hops - 1, h + 2); ++k)
            if (a.flux[(size_t)k] > f) peak = false;
        if (!peak) continue;
        if (h - lastHop < minGapHops) {
            // Too close to the last one: the stronger of the two stays.
            if (!out.empty() && f > a.flux[(size_t)lastHop]) {
                out.pop_back();
            } else {
                continue;
            }
        }
        // Place it: the first sample over 20 % of the local peak, then a zero crossing.
        const int64_t from = std::max<int64_t>(0, (h - 1) * OnsetAnalysis::kHop - OnsetAnalysis::kHop / 2);
        const int64_t to = std::min(frames, (h + 1) * OnsetAnalysis::kHop);
        float top = 0.0f;
        for (int64_t i = from; i < to; ++i) {
            float v = 0.0f;
            for (int c = 0; c < channels; ++c) v += ch[c][i];
            top = std::max(top, std::fabs(v / (float)channels));
        }
        int64_t at = from;
        for (int64_t i = from; i < to; ++i) {
            float v = 0.0f;
            for (int c = 0; c < channels; ++c) v += ch[c][i];
            if (std::fabs(v / (float)channels) >= 0.2f * top) {
                at = i;
                break;
            }
        }
        const int64_t back = std::max<int64_t>(0, at - (int64_t)(0.002 * sampleRate));
        for (int64_t i = at; i > back; --i) {
            const float x0 = ch[0][i - 1], x1 = ch[0][i];
            if ((x0 <= 0.0f && x1 >= 0.0f) || (x0 >= 0.0f && x1 <= 0.0f)) {
                at = i;
                break;
            }
        }
        if (at <= 0 || at >= frames) continue;
        if (!out.empty() && at - out.back() < (int64_t)(minGapSeconds * sampleRate)) continue;
        out.push_back(at);
        lastHop = h;
    }
    return out;
}

/// Tempo in BPM from the autocorrelation of the onset function, folded into
/// 80 … 160 BPM. 0 when there is nothing to measure.
inline double estimateBpm(const float* const* ch, int channels, int64_t frames, double sampleRate) {
    const OnsetAnalysis a = onsetFunction(ch, channels, frames, sampleRate);
    const int64_t n = (int64_t)a.flux.size();
    if (n < 64) return 0.0;
    std::vector<double> x((size_t)n);
    double mean = 0.0;
    for (int64_t i = 0; i < n; ++i) mean += a.flux[(size_t)i];
    mean /= (double)n;
    for (int64_t i = 0; i < n; ++i) x[(size_t)i] = a.flux[(size_t)i] - mean;
    const int64_t minLag = std::max<int64_t>(1, (int64_t)(a.fluxRate * 60.0 / 200.0));
    const int64_t maxLag = std::min<int64_t>(n / 2, (int64_t)(a.fluxRate * 60.0 / 60.0));
    if (maxLag <= minLag) return 0.0;
    double best = 0.0;
    int64_t bestLag = 0;
    for (int64_t lag = minLag; lag <= maxLag; ++lag) {
        double sum = 0.0;
        for (int64_t i = 0; i + lag < n; ++i) sum += x[(size_t)i] * x[(size_t)(i + lag)];
        sum /= (double)(n - lag);
        // A gentle preference for tempos around 120.
        const double bpm = 60.0 * a.fluxRate / (double)lag;
        const double w = std::exp(-0.5 * std::pow(std::log2(bpm / 120.0) / 1.0, 2.0));
        sum *= 0.5 + 0.5 * w;
        if (sum > best) {
            best = sum;
            bestLag = lag;
        }
    }
    if (bestLag == 0) return 0.0;
    double bpm = 60.0 * a.fluxRate / (double)bestLag;
    while (bpm < 80.0) bpm *= 2.0;
    while (bpm > 160.0) bpm *= 0.5;
    return bpm;
}

}  // namespace bleep::dsp
