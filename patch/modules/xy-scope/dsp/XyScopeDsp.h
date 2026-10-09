// SPDX-License-Identifier: MIT
// XY Scope (doc/specs/modules/xy-scope.md): the measurement side of the scope.
// Two channel trackers (DC blocker, peak follower, interpolated rising zero
// crossings, mean period over 50 ms) give fx and fy; from them the Ratio
// output and the figure ratio p/q. A reference phasor at fx / q demodulates X
// at harmonic q and Y at harmonic p; the figure phase is
// wrap(q·arg Yc − p·arg Xc), in which errors of fx cancel. Correlation is a
// normalised running product; Still watches the ratio error and the slip.
// In Y-T mode the sweep (trigger, phase over Timebase) is decided here too,
// so the view only draws.
//
// Also the point ring (5.1): a wait-free single-producer ring of (x, y, z, s)
// points the audio thread writes and the view drains on the message thread.
//
// Everything is a function of the input: no random values, no reset on
// transport start or jumps.
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace bleep::patch {

/// Figure ratio p:q (lowest terms, 1..8 each).
struct XyFraction {
    int p = 1, q = 1;
    bool operator==(const XyFraction& o) const noexcept { return p == o.p && q == o.q; }
    bool operator!=(const XyFraction& o) const noexcept { return !(*this == o); }
};

/// The fraction with the smallest p + q within 3 % of r (ties: the closer
/// one); 1:1 when none is (4.2).
inline XyFraction xyBestFraction(double r) noexcept {
    XyFraction best;
    if (!(r > 0.0) || !std::isfinite(r)) return best;
    int bestSum = 99;
    double bestErr = 1e9;
    for (int p = 1; p <= 8; ++p)
        for (int q = 1; q <= 8; ++q) {
            int a = p, b = q;
            while (b) { const int t = a % b; a = b; b = t; }
            if (a != 1) continue;  // not in lowest terms
            const double err = std::fabs((double)p / q - r) / r;
            if (err > 0.03) continue;
            if (p + q < bestSum || (p + q == bestSum && err < bestErr)) {
                best = {p, q};
                bestSum = p + q;
                bestErr = err;
            }
        }
    return best;
}

/// Wraps an angle into (−π, π].
inline double xyWrap(double a) noexcept {
    constexpr double pi = 3.14159265358979323846, twoPi = 2.0 * pi;
    a -= twoPi * std::floor((a + pi) / twoPi);  // [−π, π)
    return a <= -pi ? a + twoPi : a;
}

/// Still tolerances, turns per second (Tight, Normal, Loose).
inline constexpr std::array<double, 3> kXyStillTolerance{0.05, 0.2, 1.0};

/// One-pole low-pass in double with a cached coefficient (a time constant in
/// seconds). Double because the DC blocker's 0.2 Hz pole is 1 − 3e−5 per
/// sample, too close to 1 for float.
struct XyPole {
    double z = 0.0, a = 0.0;
    void setTime(double seconds, double sampleRate) noexcept { a = std::exp(-1.0 / (seconds * sampleRate)); }
    double process(double x) noexcept { return z = x + a * (z - x); }
};

/// Frequency tracker for one channel (4.1).
class XyTracker {
public:
    static constexpr int kTimes = 17;  ///< crossing times kept: up to 16 periods

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        dc_.setTime(1.0 / (2.0 * 3.14159265358979323846 * 0.2), sampleRate);
        release_ = std::exp(-1.0 / (0.5 * sampleRate));
        reset();
    }
    void reset() noexcept {
        dc_.z = 0.0;
        hp_ = prev_ = env_ = 0.0;
        armed_ = false;
        count_ = 0;
        head_ = 0;
        freq_ = 0.0;
        lastCross_ = -1e18;
    }

    /// Sample `n` of the input. True when a rising crossing completed; its
    /// (fractional) time is then crossTime().
    bool tick(float x, int64_t n) noexcept {
        hp_ = (double)x - dc_.process((double)x);
        const double a = std::fabs(hp_);
        env_ = a > env_ ? a : env_ * release_;
        bool crossed = false;
        if (hp_ < -0.1 * env_) armed_ = true;
        else if (armed_ && hp_ >= 0.0) {
            armed_ = false;
            const double frac = prev_ < 0.0 ? prev_ / (prev_ - hp_) : 1.0;  // between n − 1 and n
            crossed = true;
            cross(double(n - 1) + frac);
        }
        prev_ = hp_;
        return crossed;
    }

    double hp() const noexcept { return hp_; }
    double env() const noexcept { return env_; }
    double freq() const noexcept { return freq_; }
    double crossTime() const noexcept { return lastCross_; }
    /// Patched, above −60 dBFS, a frequency known and a crossing within 5 s.
    bool valid(bool patched, int64_t n) const noexcept {
        return patched && env_ > 0.001 && count_ >= 2 && (double)n - lastCross_ < 5.0 * sr_;
    }

private:
    void cross(double t) noexcept {
        times_[(size_t)head_] = t;
        head_ = (head_ + 1) % kTimes;
        count_ = std::min(count_ + 1, kTimes);
        lastCross_ = t;
        if (count_ < 2) return;
        // The periods within the last 50 ms: at least 1, at most 16.
        const double window = 0.05 * sr_;
        int k = 1;
        while (k + 1 < count_ && t - at(k + 1) <= window) ++k;
        const double span = t - at(k);
        if (span > 0.0) freq_ = (double)k * sr_ / span;
    }
    /// The crossing time k crossings before the newest.
    double at(int k) const noexcept { return times_[(size_t)((head_ - 1 - k + 2 * kTimes) % kTimes)]; }

    double sr_ = 48000.0;
    XyPole dc_;
    double release_ = 0.0;
    double hp_ = 0.0, prev_ = 0.0, env_ = 0.0;
    bool armed_ = false;
    std::array<double, kTimes> times_{};
    int head_ = 0, count_ = 0;
    double freq_ = 0.0, lastCross_ = -1e18;
};

struct XyScopeParams {
    int mode = 0;          ///< 0 X-Y, 1 Y-T
    int trigger = 0;       ///< 0 Y Rising, 1 Auto, 2 Beat
    int tolerance = 1;     ///< Still: 0 Tight, 1 Normal, 2 Loose
    float timebase = 0.02f;  ///< seconds per sweep (Y-T)
};

/// One sample of input.
struct XyScopeInput {
    float x = 0.0f, y = 0.0f;
    bool xPatched = false, yPatched = false;
    bool playing = false;  ///< transport playing with a valid position
    double ppq = 0.0;
};

struct XyScopeFrame {
    float phase = 0.0f;   ///< φ / π, −1..+1
    float corr = 0.0f;    ///< −1..+1
    float ratio = 0.0f;   ///< log2(fy / fx), smoothed
    float still = 0.0f;   ///< gate
    float sweep = -1.0f;  ///< Y-T: position across the screen 0..1, −1 = beam off
};

class XyScopeDsp {
public:
    static constexpr int kHistory = 64;  ///< slip history, one entry per millisecond

    void prepare(double sampleRate) noexcept {
        sr_ = sampleRate;
        tx_.prepare(sampleRate);
        ty_.prepare(sampleRate);
        corrA_ = std::exp(-1.0 / (0.2 * sampleRate));
        ratioPole_.setTime(0.03, sampleRate);
        hop_ = std::max(1, (int)std::lround(sampleRate / 1000.0));
        reset();
    }

    void reset() noexcept {
        tx_.reset();
        ty_.reset();
        n_ = 0;
        sxy_ = sxx_ = syy_ = 0.0;
        ratioTarget_ = 0.0;
        ratioPole_.z = 0.0;
        frac_ = pending_ = XyFraction{};
        pendingCount_ = 0;
        fresh_ = true;
        ur_ = 1.0;
        ui_ = 0.0;
        wr_ = 1.0;
        wi_ = 0.0;
        stepFx_ = -1.0;
        stepQ_ = 0;
        xr_ = xi_ = yr_ = yi_ = x1r_ = x1i_ = y1r_ = y1i_ = 0.0;
        setDemodTime(0.02);
        phi_ = phiPrev_ = phiU_ = 0.0;
        phaseOut_ = 0.0;
        slipPole_.z = 0.0;
        histCount_ = 0;
        histHead_ = 0;
        hopCount_ = 0;
        warm_ = 0;
        slipFrac_ = XyFraction{};
        slip_ = std::numeric_limits<double>::infinity();
        still_ = false;
        onCount_ = offCount_ = 0;
        sweep_ = -1.0;
        idle_ = 0;
        lastBeat_ = std::numeric_limits<int64_t>::min();
    }

    void tick(const XyScopeParams& p, const XyScopeInput& in, XyScopeFrame& f) noexcept {
        const bool cx = tx_.tick(in.x, n_);
        const bool cy = ty_.tick(in.y, n_);
        const double x = tx_.hp(), y = ty_.hp();
        const bool vx = tx_.valid(in.xPatched, n_), vy = ty_.valid(in.yPatched, n_);
        const bool valid = vx && vy;

        // 4.4 Correlation
        sxy_ = x * y + corrA_ * (sxy_ - x * y);
        sxx_ = x * x + corrA_ * (sxx_ - x * x);
        syy_ = y * y + corrA_ * (syy_ - y * y);
        const double den = std::sqrt(sxx_ * syy_);
        f.corr = den >= 1e-8 ? (float)std::clamp(sxy_ / den, -1.0, 1.0) : 0.0f;

        // 4.2 Ratio and figure ratio
        if (!valid) fresh_ = true;
        else {
            ratioTarget_ = std::log2(ty_.freq() / tx_.freq());
            if (cx || cy || fresh_) {
                const XyFraction choice = xyBestFraction(ty_.freq() / tx_.freq());
                if (fresh_) {  // after an invalid stretch: take the choice at once
                    frac_ = pending_ = choice;
                    pendingCount_ = 0;
                    fresh_ = false;
                } else if (choice != pending_) {
                    pending_ = choice;
                    pendingCount_ = 0;
                }
            }
            if (pending_ != frac_ && ++pendingCount_ >= (int)(0.2 * sr_)) {
                frac_ = pending_;
                pendingCount_ = 0;
            }
        }
        f.ratio = (float)ratioPole_.process(ratioTarget_);

        // 4.3 Phase: ψ turns at fx / q; X demodulated at q·ψ, Y at p·ψ
        demodulate(x, y);
        if (valid) {
            phaseOut_ = phi_ / 3.14159265358979323846;
            phiU_ += xyWrap(phi_ - phiPrev_);
        }
        phiPrev_ = phi_;
        f.phase = (float)phaseOut_;

        // 4.5 Still
        updateSlip(valid);
        const double target = (double)frac_.p / frac_.q;
        const double err = valid ? std::fabs(ty_.freq() / tx_.freq() - target) / target : 1.0;
        const double tol = kXyStillTolerance[(size_t)std::clamp(p.tolerance, 0, 2)];
        const bool cond = valid && err < 0.0025 && std::fabs(slip_) < tol;
        if (cond) {
            offCount_ = 0;
            if (!still_ && ++onCount_ >= (int)(0.1 * sr_)) still_ = true;
        } else {
            onCount_ = 0;
            if (still_ && ++offCount_ >= (int)(0.05 * sr_)) still_ = false;
        }
        f.still = still_ ? 1.0f : 0.0f;

        // 4.6 Y-T sweep
        f.sweep = p.mode == 1 ? (float)sweep(p, in, cy) : -1.0f;
        ++n_;
    }

    // ---- live values for the view ----
    double fx() const noexcept { return tx_.freq(); }
    double fy() const noexcept { return ty_.freq(); }
    bool validX(bool patched) const noexcept { return tx_.valid(patched, n_); }
    bool validY(bool patched) const noexcept { return ty_.valid(patched, n_); }
    XyFraction fraction() const noexcept { return frac_; }
    double slip() const noexcept { return slip_; }  ///< turns per second

private:
    void setDemodTime(double tauD) noexcept { demodA_ = std::exp(-1.0 / (0.5 * tauD * sr_)); }

    /// z^k for k = 1..8, by squaring.
    static void cpow(double re, double im, int k, double& outRe, double& outIm) noexcept {
        double rr = 1.0, ri = 0.0;
        while (k > 0) {
            if (k & 1) {
                const double t = rr * re - ri * im;
                ri = rr * im + ri * re;
                rr = t;
            }
            const double t = re * re - im * im;
            im = 2.0 * re * im;
            re = t;
            k >>= 1;
        }
        outRe = rr;
        outIm = ri;
    }

    void demodulate(double x, double y) noexcept {
        const double fx = tx_.freq();
        const int p = frac_.p, q = frac_.q;
        if (fx != stepFx_ || q != stepQ_) {  // new estimate: new step and LP time
            stepFx_ = fx;
            stepQ_ = q;
            const double w = -2.0 * 3.14159265358979323846 * fx / (q * sr_);
            wr_ = std::cos(w);
            wi_ = std::sin(w);
            setDemodTime(fx > 0.0 ? std::clamp(4.0 / fx, 0.02, 2.0) : 0.02);
        }
        // u = e^(−j·ψ), rotated and renormalised
        const double t = ur_ * wr_ - ui_ * wi_;
        ui_ = ur_ * wi_ + ui_ * wr_;
        ur_ = t;
        const double g = 1.5 - 0.5 * (ur_ * ur_ + ui_ * ui_);
        ur_ *= g;
        ui_ *= g;
        double qr, qi, pr, pi;
        cpow(ur_, ui_, q, qr, qi);
        cpow(ur_, ui_, p, pr, pi);
        // LP: two complex one-poles in series, τd / 2 each
        const double a = demodA_;
        x1r_ = x * qr + a * (x1r_ - x * qr);
        x1i_ = x * qi + a * (x1i_ - x * qi);
        y1r_ = y * pr + a * (y1r_ - y * pr);
        y1i_ = y * pi + a * (y1i_ - y * pi);
        xr_ = x1r_ + a * (xr_ - x1r_);
        xi_ = x1i_ + a * (xi_ - x1i_);
        yr_ = y1r_ + a * (yr_ - y1r_);
        yi_ = y1i_ + a * (yi_ - y1i_);
        // arg(Yc^q · conj(Xc)^p) = q·arg Yc − p·arg Xc (atan2 ignores the scale)
        double ar, ai, br, bi;
        cpow(yr_, yi_, q, ar, ai);
        cpow(xr_, -xi_, p, br, bi);
        const double zr = ar * br - ai * bi, zi = ar * bi + ai * br;
        phi_ = xyWrap(std::atan2(zi, zr));
    }

    /// Slip ω: change of the unwrapped phase over the last 50 ms. The phase is
    /// smoothed first (τd / 2) so the demodulator's ripple at twice the
    /// carrier doesn't read as slip, and the history only starts once the
    /// demodulator had τd to settle (after a channel became valid or the
    /// figure ratio changed).
    void updateSlip(bool valid) noexcept {
        if (!valid) {
            warm_ = 0;
            histCount_ = 0;
            hopCount_ = 0;
            slip_ = std::numeric_limits<double>::infinity();
            return;
        }
        const double tauS = 0.5 * (stepFx_ > 0.0 ? std::clamp(4.0 / stepFx_, 0.02, 2.0) : 0.02);
        if (tauS != slipTau_) {
            slipTau_ = tauS;
            slipPole_.setTime(tauS, sr_);
        }
        if (frac_ != slipFrac_) {  // a new figure: the demodulator settles again
            slipFrac_ = frac_;
            warm_ = 0;
        }
        if (warm_ < (int64_t)(2.0 * tauS * sr_)) {  // wait τd for the demodulator to settle
            ++warm_;
            histCount_ = hopCount_ = 0;
            slip_ = std::numeric_limits<double>::infinity();
            return;
        }
        if (histCount_ == 0 && hopCount_ == 0) slipPole_.z = phiU_;
        const double s = slipPole_.process(phiU_);
        if (++hopCount_ < hop_) return;
        hopCount_ = 0;
        hist_[(size_t)histHead_] = s;
        histHead_ = (histHead_ + 1) % kHistory;
        histCount_ = std::min(histCount_ + 1, kHistory);
        const int back = std::min(50, histCount_ - 1);
        if (back < 5) {  // under 5 ms of history: not known yet
            slip_ = std::numeric_limits<double>::infinity();
            return;
        }
        const double old = hist_[(size_t)((histHead_ - 1 - back + 2 * kHistory) % kHistory)];
        slip_ = (s - old) / (2.0 * 3.14159265358979323846 * back * hop_ / sr_);
    }

    /// Y-T: the sweep position, or −1 while the beam waits for a trigger.
    double sweep(const XyScopeParams& p, const XyScopeInput& in, bool yCrossed) noexcept {
        const double len = std::max(1.0, (double)p.timebase * sr_);  // samples per sweep
        if (sweep_ >= 0.0) {
            sweep_ += 1.0 / len;
            if (sweep_ >= 1.0) {
                sweep_ = -1.0;
                idle_ = 0;
            }
        }
        if (p.trigger == 2) {  // Beat
            if (in.playing) {
                const int64_t beat = (int64_t)std::floor(in.ppq);
                if (beat != lastBeat_) sweep_ = 0.0;
                lastBeat_ = beat;
            } else {
                lastBeat_ = std::numeric_limits<int64_t>::min();
                if (sweep_ < 0.0) sweep_ = 0.0;
            }
        } else if (sweep_ < 0.0) {
            if (yCrossed) sweep_ = std::clamp(((double)n_ - ty_.crossTime()) / len, 0.0, 0.999);
            else if (p.trigger == 1 && ++idle_ >= (int64_t)len) sweep_ = 0.0;  // Auto: free-run
        }
        return sweep_;
    }

    double sr_ = 48000.0;
    XyTracker tx_, ty_;
    int64_t n_ = 0;
    // correlation
    double corrA_ = 0.0, sxy_ = 0.0, sxx_ = 0.0, syy_ = 0.0;
    // ratio
    double ratioTarget_ = 0.0;
    XyPole ratioPole_;
    XyFraction frac_, pending_;
    int pendingCount_ = 0;
    bool fresh_ = true;
    // phase
    double ur_ = 1.0, ui_ = 0.0, wr_ = 1.0, wi_ = 0.0, stepFx_ = -1.0;
    int stepQ_ = 0;
    double demodA_ = 0.0, xr_ = 0.0, xi_ = 0.0, yr_ = 0.0, yi_ = 0.0;
    double x1r_ = 0.0, x1i_ = 0.0, y1r_ = 0.0, y1i_ = 0.0;
    double phi_ = 0.0, phiPrev_ = 0.0, phiU_ = 0.0, phaseOut_ = 0.0;
    // still
    XyPole slipPole_;
    double slipTau_ = -1.0;
    int64_t warm_ = 0;
    XyFraction slipFrac_;
    std::array<double, kHistory> hist_{};
    int histHead_ = 0, histCount_ = 0, hop_ = 48, hopCount_ = 0;
    double slip_ = 0.0;
    bool still_ = false;
    int onCount_ = 0, offCount_ = 0;
    // sweep
    double sweep_ = -1.0;
    int64_t idle_ = 0, lastBeat_ = 0;
};

// ---- point ring (5.1) ---------------------------------------------------------------------------

/// Keeps every D-th sample: up to 1024 points per 60 Hz frame.
inline int xyDecimation(double sampleRate) noexcept {
    return std::max(1, (int)std::ceil(sampleRate / 61440.0 - 1e-9));
}

/// Wait-free single-producer, single-consumer ring of (x, y, z, s) points.
/// The audio thread pushes; the message thread drains what is new (at most
/// kMaxDrain points; when it fell behind, the older ones are dropped). The
/// producer never waits: it overwrites the oldest entries.
class XyPointRing {
public:
    static constexpr uint32_t kSize = 8192;      ///< power of two
    static constexpr uint32_t kMaxDrain = 4096;  ///< at most this many per drain

    /// [audio thread]
    void push(float x, float y, float z, float s) noexcept {
        const uint32_t w = write_.load(std::memory_order_relaxed);
        auto& e = data_[w & (kSize - 1)];
        e[0].store(x, std::memory_order_relaxed);
        e[1].store(y, std::memory_order_relaxed);
        e[2].store(z, std::memory_order_relaxed);
        e[3].store(s, std::memory_order_relaxed);
        write_.store(w + 1, std::memory_order_release);
    }
    /// Points written so far (wraps at 2^32).
    uint32_t written() const noexcept { return write_.load(std::memory_order_acquire); }

    /// [message thread] Appends the new points to `out` as x, y, z, s
    /// quadruples; returns the counter of the first one, `dropped` gets how
    /// many were skipped.
    uint32_t drain(std::vector<float>& out, uint32_t& dropped) noexcept {
        const uint32_t w = written();
        uint32_t r = read_;
        dropped = 0;
        if (w - r > kMaxDrain) {
            dropped = w - r - kMaxDrain;
            r = w - kMaxDrain;
        }
        const uint32_t first = r;
        out.reserve(out.size() + (size_t)(w - r) * 4);
        for (; r != w; ++r) {
            const auto& e = data_[r & (kSize - 1)];
            for (int k = 0; k < 4; ++k) out.push_back(e[(size_t)k].load(std::memory_order_relaxed));
        }
        read_ = w;
        return first;
    }

private:
    std::array<std::array<std::atomic<float>, 4>, kSize> data_{};
    std::atomic<uint32_t> write_{0};
    uint32_t read_ = 0;  // consumer only
};

}  // namespace bleep::patch
