// SPDX-License-Identifier: GPL-3.0-only
// Room Print (doc/specs/modules/room-print.md): a partitioned convolution reverb.
//
//   * The first 512 samples of the impulse response run as a direct FIR, so the
//     reverb has no latency at all; the rest is split into 512-sample partitions
//     convolved by overlap-save in the frequency domain (a frequency-domain
//     delay line of the input's spectra), whose result for each block is ready
//     exactly when the next block starts.
//   * The impulse response is prepared off the audio thread (IrBuilder): resampled
//     (stretch), trimmed, given frequency-dependent decay (damping), normalised in
//     energy, and transformed. A set of synthetic responses is generated in code.
//   * Early/late balance is a gain per partition (the first ~60 ms are "early",
//     a smooth step to "late" by ~120 ms), so it can be modulated freely.
#pragma once

#include "dsp/Delay.h"
#include "dsp/Random.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bleep::patch::roomprint {

using cf = std::complex<float>;
constexpr int kP = 512;         ///< partition (and head) length
constexpr int kN = 2 * kP;      ///< FFT size
constexpr int kBins = kP + 1;
constexpr double kMaxSeconds = 4.0;

/// Radix-2 complex FFT of size kN with tables built once.
class Fft {
public:
    Fft() {
        for (int i = 0; i < kN; ++i) {
            int r = 0;
            for (int b = 0; b < 10; ++b) r |= ((i >> b) & 1) << (9 - b);
            rev_[(size_t)i] = (uint16_t)r;
            const double a = -6.283185307179586 * i / kN;
            tw_[(size_t)i] = cf((float)std::cos(a), (float)std::sin(a));
        }
    }
    void forward(cf* x) const noexcept { run(x, false); }
    void inverse(cf* x) const noexcept {
        run(x, true);
        for (int i = 0; i < kN; ++i) x[i] *= 1.0f / (float)kN;
    }
    static const Fft& instance() {
        static const Fft f;
        return f;
    }

private:
    void run(cf* x, bool inv) const noexcept {
        for (int i = 0; i < kN; ++i) {
            const int j = rev_[(size_t)i];
            if (j > i) std::swap(x[i], x[j]);
        }
        for (int len = 2; len <= kN; len <<= 1) {
            const int half = len / 2, stride = kN / len;
            for (int i = 0; i < kN; i += len)
                for (int k = 0; k < half; ++k) {
                    cf w = tw_[(size_t)(k * stride)];
                    if (inv) w = std::conj(w);
                    const cf a = x[i + k], b = x[i + k + half] * w;
                    x[i + k] = a + b;
                    x[i + k + half] = a - b;
                }
        }
    }
    std::array<uint16_t, kN> rev_{};
    std::array<cf, kN> tw_{};
};

/// A prepared impulse response, ready for the audio thread. Immutable once published.
struct Ir {
    int length = 0;                 ///< samples
    int partitions = 0;             ///< FFT partitions after the head
    std::array<std::vector<float>, 2> head;  ///< first kP samples, reversed (for a dot product with the history)
    std::array<std::vector<cf>, 2> spec;     ///< partitions × kBins
    std::array<std::vector<float>, 2> samples;  ///< the prepared response in the time domain (tests, view)
    std::vector<float> peaks;       ///< 2 × 160 min/max pairs of the left channel, for the view
};

struct Stereo {
    std::vector<float> l, r;
    double rate = 48000.0;
};

struct Shape {
    float stretch = 1.0f;   ///< playback speed of the response: 2 = twice as fast, an octave up, half as long
    float trimStart = 0.0f; ///< 0…0.9 of the (source) length cut from the start
    float trimEnd = 1.0f;   ///< 0.05…1 where the response ends
    float dampLow = 0.0f;   ///< 0…1 extra decay of the low band over time
    float dampHigh = 0.0f;  ///< 0…1 extra decay of the high band over time
};

// ---- synthetic impulse responses --------------------------------------------------

inline const char* const* synthNames() {
    static const char* names[] = {"Room", "Hall", "Cathedral", "Plate", "Spring", "Tank", "Cave", "Swell", "Gate", "Echoes"};
    return names;
}
constexpr int kSynthCount = 10;

namespace detail {
inline float noiseAt(uint64_t seed, int64_t i, uint64_t stream) { return (float)(2.0 * dsp::uniform01(seed, (uint64_t)i, stream) - 1.0); }

struct TailSpec {
    double rt60, attack, f0, f1;  ///< decay time, fade-in (s), low-pass start/end (Hz)
    double gain;
};
/// Exponentially decaying noise with a low-pass that closes over time.
inline void tail(std::vector<float>& out, double sr, uint64_t seed, uint64_t stream, const TailSpec& t, double startS) {
    float z = 0.0f;
    float a = 1.0f;
    for (size_t i = (size_t)(startS * sr); i < out.size(); ++i) {
        const double s = (double)i / sr - startS;
        if (((i - (size_t)(startS * sr)) & 63) == 0) {
            const double f = t.f0 * std::pow(t.f1 / t.f0, std::min(1.0, s / t.rt60));
            a = 1.0f - std::exp(-6.283185307f * (float)std::min(f, sr * 0.45) / (float)sr);
        }
        const double env = std::exp(-6.907755 * s / t.rt60) * std::min(1.0, s / std::max(t.attack, 1e-4));
        z += a * (noiseAt(seed, (int64_t)i, stream) - z);
        out[i] += (float)(z * env * t.gain);
    }
}
inline void earlyTaps(std::vector<float>& out, double sr, uint64_t seed, uint64_t stream, int count, double fromMs, double spreadMs, double gain) {
    for (int k = 0; k < count; ++k) {
        const double u = dsp::uniform01(seed, (uint64_t)k, stream + 100);
        const double ms = fromMs + (spreadMs - fromMs) * u * u;
        const size_t pos = (size_t)(ms * 0.001 * sr);
        if (pos >= out.size()) continue;
        const float sign = dsp::uniform01(seed, (uint64_t)k, stream + 200) < 0.5 ? -1.0f : 1.0f;
        out[pos] += sign * (float)(gain * std::exp(-2.0 * ms / spreadMs) * (0.5 + 0.5 * dsp::uniform01(seed, (uint64_t)k, stream + 300)));
    }
}
}  // namespace detail

/// One of the built-in responses (index 0 … kSynthCount−1) at `sr`. Deterministic.
inline Stereo makeSynthetic(int index, double sr) {
    index = std::clamp(index, 0, kSynthCount - 1);
    Stereo s;
    s.rate = sr;
    const uint64_t seed = 0x726f6f6dull + (uint64_t)index * 7919u;
    auto seconds = [&](double v) { return (size_t)(std::min(v, kMaxSeconds) * sr); };
    for (int ch = 0; ch < 2; ++ch) {
        std::vector<float>& o = ch == 0 ? s.l : s.r;
        const uint64_t st = (uint64_t)ch * 1000u;
        switch (index) {
            case 0: o.assign(seconds(0.6), 0.0f); detail::earlyTaps(o, sr, seed, st, 12, 3.0, 40.0, 0.5); detail::tail(o, sr, seed, st, {0.42, 0.004, 9000, 3500, 0.5}, 0.012); break;
            case 1: o.assign(seconds(2.8), 0.0f); detail::earlyTaps(o, sr, seed, st, 14, 8.0, 80.0, 0.45); detail::tail(o, sr, seed, st, {2.4, 0.02, 8000, 2000, 0.5}, 0.03); break;
            case 2: o.assign(seconds(4.0), 0.0f); detail::earlyTaps(o, sr, seed, st, 10, 15.0, 120.0, 0.35); detail::tail(o, sr, seed, st, {3.6, 0.05, 6000, 1200, 0.5}, 0.06); break;
            case 3: o.assign(seconds(2.0), 0.0f); detail::tail(o, sr, seed, st, {1.6, 0.002, 14000, 6000, 0.6}, 0.0); break;
            case 4: {  // spring: chirped echoes repeating at a slightly different period per side
                o.assign(seconds(2.2), 0.0f);
                const double period = ch == 0 ? 0.031 : 0.034;
                for (int k = 0; k < 40; ++k) {
                    const double t0 = 0.002 + k * period, amp = std::pow(0.82, k);
                    if (t0 >= 2.1) break;
                    const double len = 0.012 + 0.0004 * k;  // chirps spread as they go round
                    for (size_t i = 0; i < (size_t)(len * sr); ++i) {
                        const double t = (double)i / sr, w = std::sin(3.141592653589793 * t / len);
                        const double f = 300.0 + 5200.0 * (t / len) * (t / len);
                        const size_t pos = (size_t)(t0 * sr) + i;
                        if (pos < o.size()) o[pos] += (float)(amp * w * w * std::sin(6.283185307 * f * t) * 0.6);
                    }
                }
                detail::tail(o, sr, seed, st, {1.8, 0.02, 3500, 1500, 0.06}, 0.05);
                break;
            }
            case 5: {  // tank: a bundle of ringing modes
                o.assign(seconds(2.6), 0.0f);
                for (int m = 0; m < 48; ++m) {
                    const double f = 110.0 * std::pow(2.0, 5.2 * dsp::uniform01(seed, (uint64_t)m, st + 1));
                    const double rt = 0.5 + 2.2 * dsp::uniform01(seed, (uint64_t)m, st + 2) * (1000.0 / (f + 400.0) + 0.3);
                    const double ph = 6.283185307 * dsp::uniform01(seed, (uint64_t)m, st + 3), amp = 0.08 * (0.4 + dsp::uniform01(seed, (uint64_t)m, st + 4));
                    for (size_t i = 0; i < o.size(); ++i) {
                        const double t = (double)i / sr;
                        const double e = std::exp(-6.907755 * t / rt);
                        if (e < 1e-4) break;
                        o[i] += (float)(amp * e * std::sin(6.283185307 * f * t + ph));
                    }
                }
                break;
            }
            case 6: {  // cave: dark, long, with a few large echoes
                o.assign(seconds(4.0), 0.0f);
                detail::tail(o, sr, seed, st, {3.8, 0.08, 1800, 350, 0.45}, 0.1);
                detail::earlyTaps(o, sr, seed, st, 7, 60.0, 450.0, 0.5);
                break;
            }
            case 7: {  // swell: a hall tail played backwards, ending in a short fall
                o.assign(seconds(2.4), 0.0f);
                detail::tail(o, sr, seed, st, {2.2, 0.0005, 7000, 2500, 0.6}, 0.0);
                std::reverse(o.begin(), o.end());
                const size_t fade = (size_t)(0.04 * sr);
                for (size_t i = 0; i < fade && i < o.size(); ++i) o[o.size() - 1 - i] *= (float)i / (float)fade;
                break;
            }
            case 8: {  // gate: a dense burst cut off hard
                o.assign(seconds(0.5), 0.0f);
                detail::tail(o, sr, seed, st, {2.0, 0.001, 10000, 5000, 0.6}, 0.0);
                const size_t cut = (size_t)(0.2 * sr), fall = (size_t)(0.03 * sr);
                for (size_t i = cut; i < o.size(); ++i) o[i] *= i - cut < fall ? 1.0f - (float)(i - cut) / (float)fall : 0.0f;
                break;
            }
            default: {  // echoes: eight smeared taps, ping-ponging
                o.assign(seconds(2.2), 0.0f);
                for (int k = 0; k < 8; ++k) {
                    const double t0 = 0.21 * k + (ch == 1 ? 0.105 : 0.0) + 0.004;
                    const double amp = std::pow(0.68, k);
                    for (size_t i = 0; i < (size_t)(0.009 * sr); ++i) {
                        const size_t pos = (size_t)(t0 * sr) + i;
                        if (pos < o.size()) o[pos] += (float)(amp * 0.7 * detail::noiseAt(seed, (int64_t)(k * 5000 + (int)i), st) * std::sin(3.141592653589793 * (double)i / (0.009 * sr)));
                    }
                }
                break;
            }
        }
    }
    return s;
}

// ---- preparing a response -----------------------------------------------------------

namespace detail {
inline float hermite(const std::vector<float>& v, double pos) {
    const int64_t i = (int64_t)std::floor(pos);
    const float t = (float)(pos - (double)i);
    auto at = [&](int64_t k) { return k >= 0 && k < (int64_t)v.size() ? v[(size_t)k] : 0.0f; };
    return dsp::hermite4(at(i - 1), at(i), at(i + 1), at(i + 2), t);
}
}  // namespace detail

/// Resamples, trims, damps and normalises `src` into an Ir for the engine rate.
inline std::shared_ptr<const Ir> buildIr(const Stereo& src, const Shape& sh, double engineRate) {
    auto ir = std::make_shared<Ir>();
    if (src.l.empty()) return ir;
    const size_t srcLen = src.l.size();
    const double s0 = std::clamp((double)sh.trimStart, 0.0, 0.9) * (double)srcLen;
    const double s1 = std::max(s0 + 16.0, std::clamp((double)sh.trimEnd, 0.05, 1.0) * (double)srcLen);
    const double step = std::clamp((double)sh.stretch, 0.25, 4.0) * src.rate / engineRate;
    size_t n = (size_t)std::max(0.0, std::floor((std::min(s1, (double)srcLen) - s0) / step));
    n = std::min(n, (size_t)(kMaxSeconds * engineRate));
    if (n < 8) return ir;
    std::array<std::vector<float>, 2> y;
    const std::vector<float>* in[2] = {&src.l, src.r.empty() ? &src.l : &src.r};
    for (int ch = 0; ch < 2; ++ch) {
        y[(size_t)ch].resize(n);
        for (size_t i = 0; i < n; ++i) y[(size_t)ch][i] = detail::hermite(*in[ch], s0 + (double)i * step);
        auto& v = y[(size_t)ch];
        // Fades: 0.5 ms in when the start was trimmed, 15 ms out.
        const size_t fi = sh.trimStart > 0.0f ? (size_t)(0.0005 * engineRate) : 0, fo = std::min(n, (size_t)(0.015 * engineRate));
        for (size_t i = 0; i < fi && i < n; ++i) v[i] *= (float)i / (float)fi;
        for (size_t i = 0; i < fo; ++i) v[n - 1 - i] *= (float)i / (float)fo;
        // Damping: three bands (below ~250 Hz, middle, above ~3 kHz, split by two-pole low-passes); the outer ones decay faster.
        if (sh.dampLow > 0.001f || sh.dampHigh > 0.001f) {
            const float aLo = 1.0f - std::exp(-6.283185307f * 220.0f / (float)engineRate), aHi = 1.0f - std::exp(-6.283185307f * 3000.0f / (float)engineRate);
            float zl1 = 0.0f, zl2 = 0.0f, zh1 = 0.0f, zh2 = 0.0f;
            for (size_t i = 0; i < n; ++i) {
                const float x = v[i];
                zl1 += aLo * (x - zl1);
                zl2 += aLo * (zl1 - zl2);
                zh1 += aHi * (x - zh1);
                zh2 += aHi * (zh1 - zh2);
                const float low = zl2, high = x - zh2, mid = zh2 - zl2;
                const double t = (double)i / engineRate;
                v[i] = low * (float)std::exp(-4.6 * (double)sh.dampLow * t) + mid + high * (float)std::exp(-4.6 * (double)sh.dampHigh * t);
            }
        }
    }
    // Energy normalisation: unit energy over both channels (mean).
    double e = 0.0;
    for (int ch = 0; ch < 2; ++ch)
        for (float x : y[(size_t)ch]) e += (double)x * x;
    e *= 0.5;
    if (e < 1e-14) return ir;
    const float g = (float)(1.0 / std::sqrt(e));
    for (auto& v : y)
        for (float& x : v) x *= g;
    ir->length = (int)n;
    ir->samples = y;
    ir->partitions = n > (size_t)kP ? (int)((n - kP + kP - 1) / kP) : 0;
    const Fft& fft = Fft::instance();
    std::vector<cf> buf(kN);
    for (int ch = 0; ch < 2; ++ch) {
        auto& hd = ir->head[(size_t)ch];
        hd.assign(kP, 0.0f);
        for (int k = 0; k < kP; ++k)
            if ((size_t)k < n) hd[(size_t)(kP - 1 - k)] = y[(size_t)ch][(size_t)k];
        auto& sp = ir->spec[(size_t)ch];
        sp.assign((size_t)ir->partitions * kBins, cf());
        for (int j = 0; j < ir->partitions; ++j) {
            std::fill(buf.begin(), buf.end(), cf());
            for (int k = 0; k < kP; ++k) {
                const size_t idx = (size_t)(j + 1) * kP + (size_t)k;
                if (idx < n) buf[(size_t)k] = y[(size_t)ch][idx];
            }
            fft.forward(buf.data());
            std::copy(buf.begin(), buf.begin() + kBins, sp.begin() + (size_t)j * kBins);
        }
    }
    // Peaks for the view: 160 min/max pairs of the left channel.
    ir->peaks.assign(320, 0.0f);
    for (int b = 0; b < 160; ++b) {
        const size_t a = n * (size_t)b / 160, z = std::max(a + 1, n * (size_t)(b + 1) / 160);
        float lo = 0.0f, hi = 0.0f;
        for (size_t i = a; i < z && i < n; ++i) lo = std::min(lo, y[0][i]), hi = std::max(hi, y[0][i]);
        ir->peaks[(size_t)b * 2] = lo, ir->peaks[(size_t)b * 2 + 1] = hi;
    }
    return ir;
}

/// A decoded clip (planar channels) as a Stereo response.
inline Stereo fromChannels(const std::vector<std::vector<float>>& ch, double rate) {
    Stereo s;
    s.rate = rate > 0.0 ? rate : 48000.0;
    if (ch.empty()) return s;
    s.l = ch[0];
    s.r = ch.size() > 1 ? ch[1] : ch[0];
    return s;
}

// ---- the convolver ------------------------------------------------------------------

/// One input channel: history for the head FIR and the frequency-domain delay line.
class InputChannel {
public:
    void allocate(int maxPartitions) {
        maxPart_ = std::max(1, maxPartitions);
        fdl_.assign((size_t)maxPart_ * kBins, cf());
        reset();
    }
    void reset() noexcept {
        std::fill(hist_.begin(), hist_.end(), 0.0f);
        std::fill(prev_.begin(), prev_.end(), 0.0f);
        std::fill(cur_.begin(), cur_.end(), 0.0f);
        std::fill(fdl_.begin(), fdl_.end(), cf());
        w_ = 0, bi_ = 0, pos_ = 0;
    }
    /// Pushes a sample; true when a block completed (call completeBlock()).
    bool push(float x) noexcept {
        hist_[(size_t)w_] = hist_[(size_t)w_ + kP] = x;
        w_ = (w_ + 1) % kP;
        cur_[(size_t)bi_++] = x;
        if (bi_ == kP) {
            bi_ = 0;
            return true;
        }
        return false;
    }
    /// Dot product of the (reversed) head with the newest kP samples: the direct part of the output.
    float head(const float* hrev) const noexcept {
        // newest sample sits at hist_[w_ − 1 + kP]; the window is hist_[w_ … w_ + kP − 1] oldest → newest.
        const float* win = &hist_[(size_t)w_];
        float s = 0.0f;
        for (int k = 0; k < kP; ++k) s += hrev[k] * win[k];
        return s;
    }
    /// FFT of [previous block | this block] into the delay line.
    void completeBlock() noexcept {
        std::array<cf, kN> buf;
        for (int i = 0; i < kP; ++i) buf[(size_t)i] = prev_[(size_t)i], buf[(size_t)i + kP] = cur_[(size_t)i];
        Fft::instance().forward(buf.data());
        std::copy(buf.begin(), buf.begin() + kBins, fdl_.begin() + (size_t)pos_ * kBins);
        prev_ = cur_;
        pos_ = (pos_ + 1) % maxPart_;
        newest_ = (pos_ + maxPart_ - 1) % maxPart_;
    }
    /// The block of output (kP samples) for the *next* block: Σ_j X[newest − j] · H[j] · gain[j], keeping the valid half.
    void accumulate(const cf* spec, int partitions, const float* gains, float* out) const noexcept {
        std::array<cf, kBins> acc{};
        const int n = std::min(partitions, maxPart_);
        for (int j = 0; j < n; ++j) {
            const cf* x = &fdl_[(size_t)((newest_ - j + maxPart_) % maxPart_) * kBins];
            const cf* h = spec + (size_t)j * kBins;
            const float g = gains[j];
            for (int b = 0; b < kBins; ++b) acc[(size_t)b] += x[b] * h[b] * g;
        }
        std::array<cf, kN> buf;
        for (int b = 0; b < kBins; ++b) buf[(size_t)b] = acc[(size_t)b];
        for (int b = 1; b < kP; ++b) buf[(size_t)(kN - b)] = std::conj(acc[(size_t)b]);
        buf[0] = cf(acc[0].real(), 0.0f);
        buf[kP] = cf(acc[kP].real(), 0.0f);
        Fft::instance().inverse(buf.data());
        for (int i = 0; i < kP; ++i) out[i] = buf[(size_t)(kP + i)].real();
    }
    int blockPos() const noexcept { return bi_; }

private:
    std::array<float, 2 * kP> hist_{};
    std::array<float, kP> prev_{}, cur_{};
    std::vector<cf> fdl_;
    int maxPart_ = 1, w_ = 0, bi_ = 0, pos_ = 0, newest_ = 0;
};

struct RoomParams {
    float mix = 0.35f;
    float predelay = 0.0f;   ///< seconds
    float balance = 0.5f;    ///< 0 early only … 1 late only
    float width = 1.0f;      ///< wet stereo width 0…2
    float level = 1.0f;
};

struct RoomFrame {
    float l = 0.0f, r = 0.0f;
};

class RoomPrintDsp {
public:
    void prepare(double sampleRate) {
        sampleRate_ = sampleRate;
        Fft::instance();  // tables built here, not on the audio thread
        maxPart_ = (int)std::ceil(kMaxSeconds * sampleRate / kP) + 2;
        in_[0].allocate(maxPart_);
        in_[1].allocate(maxPart_);
        pre_[0].resize((int)(0.52 * sampleRate));
        pre_[1].resize((int)(0.52 * sampleRate));
        gains_.assign((size_t)maxPart_, 1.0f);
        reset();
    }
    void reset() noexcept {
        in_[0].reset();
        in_[1].reset();
        pre_[0].clear();
        pre_[1].clear();
        for (auto& t : tail_) t.fill(0.0f);
        tailIdx_ = 0;
        wetPrev_ = {};
        lastIr_ = nullptr;
        smoothedEarly_ = smoothedLate_ = 1.0f;
        gainsFor_ = -1.0f;
        gainsSeeded_ = false;
    }

    /// One sample. `stereoIn`: both inputs patched (else `l` feeds both channels).
    RoomFrame tick(const Ir* ir, const RoomParams& p, float l, float r, bool stereoIn) noexcept {
        if (ir != lastIr_) {  // a new response: the old spectra no longer match it
            lastIr_ = ir;
            for (auto& t : tail_) t.fill(0.0f);
            in_[0].reset();
            in_[1].reset();
            gainsFor_ = -1.0f;
        }
        if (!stereoIn) r = l;
        // predelay
        pre_[0].write(l);
        pre_[1].write(r);
        const double d = std::clamp((double)p.predelay * sampleRate_, 0.0, (double)pre_[0].maxDelay() - 4.0);
        const float xl = d < 1.0 ? l : pre_[0].readHermite(d), xr = d < 1.0 ? r : pre_[1].readHermite(d);
        // gains per partition from the balance
        const float early = std::min(1.0f, 2.0f * (1.0f - p.balance)), late = std::min(1.0f, 2.0f * p.balance);
        if (!gainsSeeded_) smoothedEarly_ = early, smoothedLate_ = late, gainsSeeded_ = true;
        smoothedEarly_ += 0.002f * (early - smoothedEarly_);
        smoothedLate_ += 0.002f * (late - smoothedLate_);
        float wl = 0.0f, wr = 0.0f;
        const bool haveIr = ir && ir->length > 0;
        InputChannel& a = in_[0];
        InputChannel& b = stereoIn ? in_[1] : in_[0];
        const bool doneA = a.push(xl);
        bool doneB = false;
        if (stereoIn) doneB = b.push(xr);
        if (haveIr) {
            wl = a.head(ir->head[0].data()) * smoothedEarly_;
            wr = b.head(ir->head[1].data()) * smoothedEarly_;
            // (b.head for a mono input reads the same history as a: valid because b is a)
            const int i = tailIdx_;
            wl += tail_[0][(size_t)i];
            wr += tail_[1][(size_t)i];
        }
        ++tailIdx_;
        if (doneA) {
            a.completeBlock();
            if (stereoIn && doneB) b.completeBlock();
            if (haveIr && ir->partitions > 0) {
                updateGains(ir->partitions);
                a.accumulate(ir->spec[0].data(), ir->partitions, gains_.data(), tail_[0].data());
                InputChannel& src = stereoIn ? in_[1] : in_[0];
                src.accumulate(ir->spec[1].data(), ir->partitions, gains_.data(), tail_[1].data());
            } else {
                for (auto& t : tail_) t.fill(0.0f);
            }
            tailIdx_ = 0;
        }
        // width (mid/side), level, mix
        const float m = 0.5f * (wl + wr), s = 0.5f * (wl - wr) * p.width;
        const float ol = (m + s) * p.level, orr = (m - s) * p.level;
        RoomFrame f;
        f.l = l * (1.0f - p.mix) + ol * p.mix;
        f.r = r * (1.0f - p.mix) + orr * p.mix;
        return f;
    }

private:
    void updateGains(int partitions) noexcept {
        const int n = std::min(partitions, maxPart_);
        for (int j = 0; j < n; ++j) {
            const double t = (double)(j + 1) * kP / sampleRate_;
            const double u = std::clamp((t - 0.06) / 0.06, 0.0, 1.0), w = u * u * (3.0 - 2.0 * u);
            gains_[(size_t)j] = (float)((1.0 - w) * smoothedEarly_ + w * smoothedLate_);
        }
    }

    double sampleRate_ = 48000.0;
    int maxPart_ = 1, tailIdx_ = 0;
    std::array<InputChannel, 2> in_;
    std::array<dsp::RingDelay, 2> pre_;
    std::array<std::array<float, kP>, 2> tail_{};
    std::vector<float> gains_;
    RoomFrame wetPrev_;
    const Ir* lastIr_ = nullptr;
    float smoothedEarly_ = 1.0f, smoothedLate_ = 1.0f, gainsFor_ = -1.0f;
    bool gainsSeeded_ = false;
};

}  // namespace bleep::patch::roomprint
