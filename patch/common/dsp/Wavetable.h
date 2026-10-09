// SPDX-License-Identifier: MIT
// Single-cycle wavetables with band-limited mipmaps, for the Wavetable Osc
// (specs/modules/wavetable-oscillator.md) and the Macro Osc's Table model.
//
// A WavetableBank is a cols × rows grid of frames (factory banks are 8 × 8).
// Each frame is defined by its harmonic spectrum and stored as 11 mip levels:
// level L keeps harmonics up to 1024 / 2^L (level 0: 1023, level 10: the
// fundamental only), so every level is band-limited by construction. Level 0
// and 1 have 2048 samples, higher levels shrink by octaves (at least 64
// samples), which keeps every level 4× oversampled for the interpolation.
//
// Building (spectra, a small radix-2 FFT, mip synthesis) allocates and takes
// a few ms per bank: do it off the audio thread (prepare(), a worker, or the
// lazily built shared factoryBank()). Reading (readFrame, readXY) is RT-safe:
// no allocation, no locks, a handful of table reads per sample.
//
// Typical oscillator sample:
//
//     const double w = wavetable::warpPhase(warp, phase, amount);
//     const auto mip = wavetable::selectMip(std::fabs(hz) * wavetable::warpSlope(warp, amount), sampleRate);
//     const float y = wavetable::readXY(bank, x * 7, y * 7, w, mip, wavetable::Interp::Cubic);
#pragma once

#include "Formant.h"
#include "Random.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <vector>

namespace bleep::dsp {

namespace wavetable {

constexpr int kSize = 2048;    ///< samples per cycle at levels 0 and 1
constexpr int kLevels = 11;    ///< mip levels
constexpr int kHarmonics = 1023;  ///< highest harmonic stored (level 0)
constexpr int kGuard = 4;      ///< guard samples per table (1 before, 3 after)
constexpr double kTwoPi = 6.283185307179586476925;

/// Samples per cycle at mip level L.
constexpr int levelSize(int level) noexcept {
    return level <= 1 ? kSize : ((kSize >> (level - 1)) > 64 ? (kSize >> (level - 1)) : 64);
}
/// Highest harmonic kept at mip level L.
constexpr int levelHarmonics(int level) noexcept {
    return (1024 >> level) < levelSize(level) / 2 - 1 ? (1024 >> level) : levelSize(level) / 2 - 1;
}
/// Offset of level L inside a frame (in floats, including guards).
constexpr int levelOffset(int level) noexcept {
    int o = 0;
    for (int l = 0; l < level; ++l) o += levelSize(l) + kGuard;
    return o;
}
constexpr int kFrameStride = levelOffset(kLevels);

// ---------------------------------------------------------------------------
// Spectra. A Spectrum holds complex amplitudes S[n] for harmonics 1..1023
// (index 0, DC, is ignored): x(φ) = Σ Re(S[n] · e^{i 2π n φ}). A sine of
// amplitude a at harmonic n is S[n] = −i·a.

using Spectrum = std::vector<std::complex<double>>;

inline Spectrum emptySpectrum() { return Spectrum((size_t)kHarmonics + 1); }

/// Adds a·sin(2π n φ + phase) (phase in cycles).
inline void addSine(Spectrum& s, int n, double amp, double phase = 0.0) {
    if (n < 1 || n > kHarmonics) return;
    s[(size_t)n] += std::polar(amp, kTwoPi * phase - 0.25 * kTwoPi);
}

/// In-place radix-2 complex FFT (n a power of two), unnormalised;
/// `inverse` uses e^{+i…}.
inline void fft(std::complex<double>* a, int n, bool inverse) noexcept {
    for (int i = 1, j = 0; i < n; ++i) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (int len = 2; len <= n; len <<= 1) {
        const double ang = (inverse ? kTwoPi : -kTwoPi) / len;
        const std::complex<double> wl(std::cos(ang), std::sin(ang));
        for (int i = 0; i < n; i += len) {
            std::complex<double> w(1.0, 0.0);
            for (int j = 0; j < len / 2; ++j) {
                const auto u = a[i + j], v = a[i + j + len / 2] * w;
                a[i + j] = u + v;
                a[i + j + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}

inline bool isPowerOfTwo(size_t n) noexcept { return n >= 2 && (n & (n - 1)) == 0; }

/// Spectrum of one cycle of any length (DC dropped; harmonics up to
/// min(n/2 − 1, 1023)). Power-of-two lengths use the FFT, others a direct DFT.
inline Spectrum spectrumOfCycle(const float* x, size_t n) {
    Spectrum s = emptySpectrum();
    if (n < 2) return s;
    const int top = (int)std::min<size_t>(n / 2 - (n % 2 == 0 ? 1 : 0), (size_t)kHarmonics);
    if (isPowerOfTwo(n)) {
        std::vector<std::complex<double>> buf(n);
        for (size_t i = 0; i < n; ++i) buf[i] = (double)x[i];
        fft(buf.data(), (int)n, false);
        for (int k = 1; k <= top; ++k) s[(size_t)k] = buf[(size_t)k] * (2.0 / (double)n);
        return s;
    }
    for (int k = 1; k <= top; ++k) {
        const std::complex<double> step = std::polar(1.0, -kTwoPi * k / (double)n);
        std::complex<double> e(1.0, 0.0), acc(0.0, 0.0);
        for (size_t i = 0; i < n; ++i) {
            acc += (double)x[i] * e;
            e *= step;
            if ((i & 1023) == 1023) e = std::polar(1.0, -kTwoPi * k * (double)(i + 1) / (double)n);  // re-anchor
        }
        s[(size_t)k] = acc * (2.0 / (double)n);
    }
    return s;
}

/// Spectrum of a waveform function f(φ), φ in [0, 1), sampled at `points`
/// (a power of two; 8× the table size keeps the sampling alias of shapes
/// with corners far below the stored harmonics).
template <class F>
Spectrum spectrumOfFunction(F&& f, int points = 8 * kSize) {
    std::vector<float> x((size_t)points);
    for (int i = 0; i < points; ++i) x[(size_t)i] = (float)f((double)i / points);
    return spectrumOfCycle(x.data(), x.size());
}

/// A straight piece of a waveform: from (p0, v0) to (p1, v1), 0 ≤ p0 < p1 ≤ 1.
struct Segment {
    double p0, p1, v0, v1;
};

/// Exact spectrum of a piecewise-linear cycle (saw, square, pulse, steps,
/// synced saws…): no sampling, so no aliasing at all.
inline Spectrum spectrumOfSegments(const std::vector<Segment>& segs) {
    Spectrum s = emptySpectrum();
    const std::complex<double> I(0.0, 1.0);
    for (const auto& g : segs) {
        if (!(g.p1 > g.p0)) continue;
        const double slope = (g.v1 - g.v0) / (g.p1 - g.p0);
        const std::complex<double> st0 = std::polar(1.0, -kTwoPi * g.p0), st1 = std::polar(1.0, -kTwoPi * g.p1);
        std::complex<double> e0 = st0, e1 = st1;
        for (int n = 1; n <= kHarmonics; ++n) {
            const double w = kTwoPi * n;
            // ∫ f e^{−iωφ} dφ = [(i f / ω + slope / ω²) e^{−iωφ}]  (S = 2C)
            const auto c = (I * g.v1 / w + slope / (w * w)) * e1 - (I * g.v0 / w + slope / (w * w)) * e0;
            s[(size_t)n] += 2.0 * c;
            e0 *= st0, e1 *= st1;
        }
    }
    return s;
}

// ---------------------------------------------------------------------------
// Banks.

class WavetableBank {
public:
    WavetableBank() = default;

    /// Builds a cols × rows bank; gen(col, row) returns each frame's spectrum.
    /// With `normalise`, each frame is scaled to peak 1 at level 0.
    static WavetableBank fromSpectra(int cols, int rows, const std::function<Spectrum(int, int)>& gen,
                                     bool normalise = true) {
        WavetableBank b;
        b.cols_ = std::max(cols, 1);
        b.rows_ = std::max(rows, 1);
        b.data_.assign((size_t)b.frames() * kFrameStride, 0.0f);
        std::vector<std::complex<double>> buf(kSize);
        for (int r = 0; r < b.rows_; ++r)
            for (int c = 0; c < b.cols_; ++c) b.setFrame(r * b.cols_ + c, gen(c, r), normalise, buf);
        return b;
    }

    int cols() const noexcept { return cols_; }
    int rows() const noexcept { return rows_; }
    int frames() const noexcept { return cols_ * rows_; }
    bool empty() const noexcept { return data_.empty(); }

    /// Pointer to sample 0 of a frame's level; indices −1 … size + 2 are valid.
    const float* table(int frame, int level) const noexcept {
        return data_.data() + (size_t)frame * kFrameStride + levelOffset(level) + 1;
    }

private:
    void setFrame(int frame, const Spectrum& s, bool normalise, std::vector<std::complex<double>>& buf) {
        float* base = data_.data() + (size_t)frame * kFrameStride;
        for (int level = 0; level < kLevels; ++level) {
            const int n = levelSize(level), top = levelHarmonics(level);
            std::fill(buf.begin(), buf.begin() + n, std::complex<double>(0.0, 0.0));
            for (int k = 1; k <= top && k < (int)s.size(); ++k) {
                buf[(size_t)k] = 0.5 * s[(size_t)k];
                buf[(size_t)(n - k)] = 0.5 * std::conj(s[(size_t)k]);
            }
            fft(buf.data(), n, true);
            float* t = base + levelOffset(level) + 1;
            for (int i = 0; i < n; ++i) t[i] = (float)buf[(size_t)i].real();
        }
        if (normalise) {
            float peak = 0.0f;
            const float* t0 = base + 1;
            for (int i = 0; i < kSize; ++i) peak = std::max(peak, std::fabs(t0[i]));
            if (peak > 1e-9f)
                for (int i = 0; i < kFrameStride; ++i) base[i] /= peak;
        }
        for (int level = 0; level < kLevels; ++level) {  // guards
            const int n = levelSize(level);
            float* t = base + levelOffset(level) + 1;
            t[-1] = t[n - 1];
            t[n] = t[0], t[n + 1] = t[1], t[n + 2] = t[2];
        }
    }

    int cols_ = 0, rows_ = 0;
    std::vector<float> data_;
};

// ---------------------------------------------------------------------------
// Reading (RT-safe).

enum class Interp { Nearest, Linear, Cubic };

/// Two adjacent mip levels and the crossfade between them.
struct Mip {
    int level = 0;
    float frac = 0.0f;  ///< weight of level + 1
};

/// The mip levels for an effective frequency `hz` (|f| × the warp's maximum
/// phase slope): every harmonic read stays below `limit` × sampleRate, and the
/// fractional octave crossfades into the next level, so sweeps never step.
inline Mip selectMip(double hz, double sampleRate, double limit = 0.45) noexcept {
    const double x = std::log2(std::max(std::fabs(hz), 1e-6) * 1024.0 / (limit * sampleRate));
    const double fl = std::floor(x);
    Mip m;
    if (fl + 1.0 < 0.0) return m;
    if (fl + 1.0 >= (double)(kLevels - 1)) {
        m.level = kLevels - 1;
        return m;
    }
    m.level = (int)fl + 1;
    m.frac = (float)(x - fl);
    return m;
}

/// One table read at `phase` (cycles; wrapped).
inline float readTable(const float* t, int size, double phase, Interp interp) noexcept {
    const double pos = (phase - std::floor(phase)) * size;
    int i = (int)pos;
    if (i >= size) i = size - 1;  // phase rounding just below 1
    const float f = (float)(pos - i);
    const float* p = t + i;
    switch (interp) {
        case Interp::Nearest: return f < 0.5f ? p[0] : p[1];
        case Interp::Linear: return p[0] + f * (p[1] - p[0]);
        case Interp::Cubic:
        default: {  // Catmull-Rom: exact at the stored samples
            const float a = p[-1], b = p[0], c = p[1], d = p[2];
            return b + 0.5f * f * (c - a + f * (2.0f * a - 5.0f * b + 4.0f * c - d + f * (3.0f * (b - c) + d - a)));
        }
    }
}

/// One frame, crossfading the two mip levels.
inline float readFrame(const WavetableBank& bank, int frame, double phase, Mip mip, Interp interp) noexcept {
    const int l = std::clamp(mip.level, 0, kLevels - 1);
    const float a = readTable(bank.table(frame, l), levelSize(l), phase, interp);
    if (mip.frac <= 0.0f || l + 1 >= kLevels) return a;
    const float b = readTable(bank.table(frame, l + 1), levelSize(l + 1), phase, interp);
    return a + mip.frac * (b - a);
}

/// Bilinear morph between the four frames around grid position (x, y),
/// x in 0..cols − 1, y in 0..rows − 1 (clamped). Zero-weight frames are skipped,
/// so a grid point reads exactly that frame.
inline float readXY(const WavetableBank& bank, float x, float y, double phase, Mip mip, Interp interp) noexcept {
    if (bank.empty()) return 0.0f;
    x = std::clamp(x, 0.0f, (float)(bank.cols() - 1));
    y = std::clamp(y, 0.0f, (float)(bank.rows() - 1));
    const int ix = (int)x, iy = (int)y;
    const float fx = ix < bank.cols() - 1 ? x - (float)ix : 0.0f, fy = iy < bank.rows() - 1 ? y - (float)iy : 0.0f;
    auto at = [&](int cx, int cy) noexcept { return readFrame(bank, cy * bank.cols() + cx, phase, mip, interp); };
    float top = at(ix, iy);
    if (fx > 0.0f) top += fx * (at(ix + 1, iy) - top);
    if (fy <= 0.0f) return top;
    float bottom = at(ix, iy + 1);
    if (fx > 0.0f) bottom += fx * (at(ix + 1, iy + 1) - bottom);
    return top + fy * (bottom - top);
}

// ---------------------------------------------------------------------------
// Phase warps (wavetable-oscillator.md 4.4). All are the identity at amount 0.
// Pass |f| × warpSlope() to selectMip so the warped read stays band-limited.

enum class Warp { None, Bend, Sync, Mirror, Squash, Steps };

/// Phase distortion: a two-segment phase curve with its knee at (knee, 0.5).
inline double phaseDistort(double phase, double knee) noexcept {
    const double k = std::clamp(knee, 1e-4, 1.0 - 1e-4);
    return phase < k ? 0.5 * phase / k : 0.5 + 0.5 * (phase - k) / (1.0 - k);
}

/// The warped table position for `phase` in [0, 1), amount 0..1.
/// - Bend: knee at (0.5 − 0.45a, 0.5): first half squeezed, second stretched.
/// - Sync: frac(φ · (1 + 7a)), a hard-sync sweep inside the table.
/// - Mirror: (1 − a)·φ + a·(forward then backward); a = 1 reads the table
///   forward in the first half of the cycle and backward in the second.
/// - Squash: the whole table in the first 1 − 0.9a of the cycle, then holds
///   the table's start value (a PWM for any wave).
/// - Steps: quantised to 2^(11 − 10a) steps (2048 → 2).
inline double warpPhase(Warp warp, double phase, float amount) noexcept {
    const double a = std::clamp((double)amount, 0.0, 1.0);
    if (a <= 0.0) return phase;
    switch (warp) {
        case Warp::Bend: return phaseDistort(phase, 0.5 - 0.45 * a);
        case Warp::Sync: {
            const double w = phase * (1.0 + 7.0 * a);
            return w - std::floor(w);
        }
        case Warp::Mirror: return (1.0 - a) * phase + a * (phase < 0.5 ? 2.0 * phase : 2.0 - 2.0 * phase);
        case Warp::Squash: return std::min(phase / (1.0 - 0.9 * a), 1.0);
        case Warp::Steps: {
            const double n = std::exp2(11.0 - 10.0 * a);
            return std::floor(phase * n) / n;
        }
        case Warp::None:
        default: return phase;
    }
}

/// The largest |d warp / d phase|: how much the warp raises the bandwidth.
inline double warpSlope(Warp warp, float amount) noexcept {
    const double a = std::clamp((double)amount, 0.0, 1.0);
    switch (warp) {
        case Warp::Bend: {
            const double k = 0.5 - 0.45 * a;
            return 0.5 / std::min(k, 1.0 - k);
        }
        case Warp::Sync: return 1.0 + 7.0 * a;
        case Warp::Mirror: return 1.0 + a;
        case Warp::Squash: return 1.0 / (1.0 - 0.9 * a);
        case Warp::None:
        case Warp::Steps:
        default: return 1.0;
    }
}

// ---------------------------------------------------------------------------
// Factory banks: 8 × 8 frames, generated procedurally (identical everywhere).

enum class FactoryBank {
    Analog,    ///< X: sine → triangle → saw → square → 10 % pulse; Y: rounder → brighter
    Harmonic,  ///< X: odd → all harmonics; Y: spectral centre low → high
    Vowel,     ///< X: a → e → i → o → u; Y: small → large vocal tract (formants high → low)
    Pulse,     ///< X: width 50 % → 3 % (PWM); Y: single → two pulses half a cycle apart
    Sync,      ///< X: synced saw ratio 1 → 8; Y: saw → triangle carrier
    FM,        ///< X: index 0 → 6; Y: modulator ratio 1 … 8
    Fold,      ///< X: fold drive 1 → 8; Y: symmetry 0 → 1
    Organ,     ///< X: 8 drawbar registrations; Y: third-harmonic percussion 0 → full
    Digital,   ///< X: bit depth 8 → 2; Y: sample-and-hold steps 64 → 4 per cycle
    Spectra,   ///< X: 8 seeded random spectra; Y: smoothing rough → smooth
    Bell,      ///< X: partial stretch compressed → stretched; Y: bright → dark
    Count
};
constexpr int kNumFactoryBanks = (int)FactoryBank::Count;

inline const char* factoryBankName(FactoryBank b) noexcept {
    static constexpr const char* kNames[kNumFactoryBanks] = {"Analog",  "Harmonic", "Vowel",   "Pulse",
                                                             "Sync",    "FM",       "Fold",    "Organ",
                                                             "Digital", "Spectra",  "Bell"};
    const int i = (int)b;
    return i >= 0 && i < kNumFactoryBanks ? kNames[i] : "";
}

namespace detail {

// Analog shapes, in phase with the sine (fundamental = +sin), so morphs between
// them never cancel the fundamental.
inline Spectrum analogShape(int i) {
    switch (i) {
        case 0: {
            Spectrum s = emptySpectrum();
            s[1] = {0.0, -1.0};
            return s;
        }
        case 1: return spectrumOfSegments({{0.0, 0.25, 0.0, 1.0}, {0.25, 0.75, 1.0, -1.0}, {0.75, 1.0, -1.0, 0.0}});
        case 2: return spectrumOfSegments({{0.0, 0.5, 0.0, 1.0}, {0.5, 1.0, -1.0, 0.0}});
        case 3: return spectrumOfSegments({{0.0, 0.5, 1.0, 1.0}, {0.5, 1.0, -1.0, -1.0}});
        default: return spectrumOfSegments({{0.0, 0.2, -1.0, -1.0}, {0.2, 0.3, 1.0, 1.0}, {0.3, 1.0, -1.0, -1.0}});
    }
}

inline Spectrum mix(const Spectrum& a, const Spectrum& b, double t) {
    Spectrum s = emptySpectrum();
    for (size_t n = 0; n < s.size(); ++n) s[n] = (1.0 - t) * a[n] + t * b[n];
    return s;
}

inline double foldTri(double x) noexcept {  // reflect at ±1 (period 4)
    const double m = x + 1.0 - 4.0 * std::floor((x + 1.0) / 4.0);
    return 1.0 - std::fabs(m - 2.0);
}

inline Spectrum generate(FactoryBank bank, int c, int r) {
    const double u = c / 7.0, v = r / 7.0;
    Spectrum s = emptySpectrum();
    switch (bank) {
        case FactoryBank::Analog: {
            const double pos = u * 4.0;
            const int i = std::min((int)pos, 3);
            s = mix(analogShape(i), analogShape(i + 1), pos - i);
            if (r < 7) {  // one-pole roll-off, cutoff harmonic 2 … 1024
                const double fc = std::exp2(1.0 + 10.0 * v);
                for (int n = 1; n <= kHarmonics; ++n) s[(size_t)n] /= std::sqrt(1.0 + (n / fc) * (n / fc));
            }
            return s;
        }
        case FactoryBank::Harmonic: {
            const double centre = 6.0 * v;  // log2 of the peak harmonic: 1 … 64
            for (int n = 1; n <= 256; ++n) {
                const double d = std::log2((double)n) - centre;
                double a = std::exp(-0.5 * d * d);
                if (n % 2 == 0) a *= u;
                addSine(s, n, a);
            }
            return s;
        }
        case FactoryBank::Vowel: {
            const formant::Vowel vw = formant::vowelAt((float)(u * 4.0), (float)(0.75 - 1.5 * v));
            const double f0 = 110.0;  // the table's nominal pitch (A2)
            for (int n = 1; n * f0 < 10000.0; ++n) addSine(s, n, formant::vowelResponse(vw, n * f0) / n, n % 2 ? 0.0 : 0.5);
            return s;
        }
        case FactoryBank::Pulse: {
            // Total duty w; Y splits it into two pulses half a cycle apart.
            const double w = 0.5 * std::pow(0.03 / 0.5, u), w1 = w * (1.0 - 0.5 * v), w2 = w * 0.5 * v;
            return spectrumOfSegments({{0.0, w1, 1.0, 1.0}, {w1, 0.5, 0.0, 0.0}, {0.5, 0.5 + w2, 1.0, 1.0}, {0.5 + w2, 1.0, 0.0, 0.0}});
        }
        case FactoryBank::Sync: {
            const double ratio = 1.0 + 7.0 * u;
            auto shape = [&](double sp) { return (1.0 - v) * (2.0 * sp - 1.0) + v * (sp < 0.5 ? 4.0 * sp - 1.0 : 3.0 - 4.0 * sp); };
            std::vector<double> bp{0.0};
            for (int k = 0; k <= 8; ++k)
                for (double h : {0.0, 0.5})
                    if (const double p = (k + h) / ratio; p > 1e-12 && p < 1.0 - 1e-12) bp.push_back(p);
            bp.push_back(1.0);
            std::sort(bp.begin(), bp.end());
            std::vector<Segment> segs;
            for (size_t i = 0; i + 1 < bp.size(); ++i) {
                const double p0 = bp[i], p1 = bp[i + 1];
                const double k = std::floor(p0 * ratio + 1e-9);
                segs.push_back({p0, p1, shape(p0 * ratio - k), shape(p1 * ratio - k)});
            }
            return spectrumOfSegments(segs);
        }
        case FactoryBank::FM: {
            const double index = 6.0 * u, ratio = 1.0 + r;
            return spectrumOfFunction([&](double p) { return std::sin(kTwoPi * p + index * std::sin(kTwoPi * ratio * p)); });
        }
        case FactoryBank::Fold: {
            const double drive = 1.0 + 7.0 * u;
            return spectrumOfFunction([&](double p) { return foldTri(drive * std::sin(kTwoPi * p) + v); }, 16 * kSize);
        }
        case FactoryBank::Organ: {
            // Drawbars 8', 4', 2⅔', 2', 1⅗', 1⅓', 1' = harmonics 1, 2, 3, 4, 5, 6, 8.
            static constexpr int kHarm[7] = {1, 2, 3, 4, 5, 6, 8};
            static constexpr int kReg[8][7] = {{8, 0, 0, 0, 0, 0, 0}, {8, 8, 0, 0, 0, 0, 0}, {8, 0, 8, 0, 0, 0, 0},
                                               {8, 8, 8, 0, 0, 0, 0}, {8, 8, 8, 8, 0, 0, 0}, {6, 8, 8, 6, 4, 0, 0},
                                               {8, 4, 8, 0, 6, 0, 8}, {8, 8, 8, 8, 8, 8, 8}};
            for (int k = 0; k < 7; ++k)
                if (kReg[c][k] > 0) addSine(s, kHarm[k], std::pow(10.0, (kReg[c][k] - 8) * 3.0 / 20.0));
            addSine(s, 3, v);
            return s;
        }
        case FactoryBank::Digital: {
            const int bits = (int)std::lround(8.0 - 6.0 * u);
            const int steps = (int)std::lround(64.0 * std::exp2(-4.0 * v));
            const double levels = std::exp2(bits - 1) - 1.0;
            std::vector<Segment> segs;
            for (int k = 0; k < steps; ++k) {
                const double val = std::round(std::sin(kTwoPi * (k + 0.5) / steps) * levels) / levels;
                segs.push_back({(double)k / steps, (double)(k + 1) / steps, val, val});
            }
            return spectrumOfSegments(segs);
        }
        case FactoryBank::Spectra: {
            constexpr uint64_t kSeed = 0x5bec7a11ull;
            std::vector<double> raw(513);
            for (int n = 1; n <= 512; ++n) raw[(size_t)n] = uniform01(kSeed, (uint64_t)(c * 4096 + n), 1);
            const int half = (int)std::lround(12.0 * v);
            for (int n = 1; n <= 512; ++n) {
                double a = 0.0;
                int count = 0;
                for (int k = std::max(1, n - half); k <= std::min(512, n + half); ++k, ++count) a += raw[(size_t)k];
                addSine(s, n, a / count * std::pow((double)n, -0.8), uniform01(kSeed, (uint64_t)(c * 4096 + n), 2));
            }
            return s;
        }
        case FactoryBank::Bell: {
            // Church-bell partials (hum, prime, tierce, quint, nominal, …), placed on
            // harmonics of a quarter of the prime: the table's fundamental sits two
            // octaves below the bell's strike tone.
            static constexpr double kRatio[12] = {0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796, 8.215};
            static constexpr double kAmp[12] = {0.8, 1.0, 0.8, 0.5, 0.9, 0.5, 0.4, 0.4, 0.3, 0.25, 0.2, 0.15};
            const double stretch = 0.9 + 0.2 * u;
            for (int k = 0; k < 12; ++k) {
                const int n = (int)std::lround(4.0 * std::pow(kRatio[k], stretch));
                addSine(s, std::max(n, 1), kAmp[k] * std::pow(k + 1.0, -1.5 * v), 0.13 * k);
            }
            return s;
        }
        case FactoryBank::Count:
        default: return s;
    }
}

}  // namespace detail

/// Builds a factory bank (allocates; ~10–100 ms). Off the audio thread.
inline WavetableBank buildFactoryBank(FactoryBank bank) {
    return WavetableBank::fromSpectra(8, 8, [bank](int c, int r) { return detail::generate(bank, c, r); });
}

/// The process-wide shared copy of a factory bank, built on first use
/// (thread-safe). The first call for a bank builds it: call from prepare()
/// or a worker, never first from the audio thread.
inline const WavetableBank& factoryBank(FactoryBank bank) {
    static std::once_flag once[kNumFactoryBanks];
    static std::unique_ptr<WavetableBank> banks[kNumFactoryBanks];
    const int i = std::clamp((int)bank, 0, kNumFactoryBanks - 1);
    std::call_once(once[i], [i] { banks[i] = std::make_unique<WavetableBank>(buildFactoryBank((FactoryBank)i)); });
    return *banks[i];
}

// ---------------------------------------------------------------------------
// User tables.

/// A bank from single cycles of any length (each resampled to the table by
/// its spectrum, DC removed, normalised to peak 1). n cycles fill a grid of
/// `cols` columns row by row; the last row is padded with the last cycle.
/// One cycle gives a 1 × 1 bank (it plays at every position).
inline WavetableBank bankFromCycles(const std::vector<std::vector<float>>& cycles, int cols = 8) {
    const int n = (int)cycles.size();
    if (n == 0) return {};
    const int c = n == 1 ? 1 : std::min(cols, n);
    const int r = (n + c - 1) / c;
    return WavetableBank::fromSpectra(c, r, [&](int x, int y) {
        const auto& cyc = cycles[(size_t)std::min(y * c + x, n - 1)];
        return spectrumOfCycle(cyc.data(), cyc.size());
    });
}

/// A bank from raw sample data (e.g. a WAV's first channel). `cycleLength`
/// 0 = auto: 2048 if the length is a multiple of it, else the whole data is
/// one cycle. At most `maxCycles` cycles are used.
inline WavetableBank bankFromSamples(const float* data, size_t n, int cycleLength = 0, int maxCycles = 64) {
    if (data == nullptr || n < 2) return {};
    size_t len = cycleLength > 0 ? (size_t)cycleLength : (n % (size_t)kSize == 0 ? (size_t)kSize : n);
    len = std::min(len, n);
    std::vector<std::vector<float>> cycles;
    for (size_t start = 0; start + len <= n && (int)cycles.size() < maxCycles; start += len)
        cycles.emplace_back(data + start, data + start + len);
    return bankFromCycles(cycles);
}

}  // namespace wavetable

using wavetable::WavetableBank;

}  // namespace bleep::dsp
