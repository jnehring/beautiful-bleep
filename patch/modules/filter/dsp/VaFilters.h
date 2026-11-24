// SPDX-License-Identifier: GPL-3.0-only
// The filter algorithms of Vadim Zavalishin, "The Art of VA Filter Design"
// (rev. 1.0.3), built with the topology-preserving transform (TPT): every
// integrator is trapezoidal and every delayless feedback loop is solved
// through the instantaneous responses (y = G·x + S) of its parts.
//
//   §2/§3   1-pole multimode: low-pass, high-pass, allpass, low/high shelf
//   §3.3    naive (Euler) 1-pole low-pass, §3.11 direct form I biquad
//   §4      transistor ladder: linear, feedback shaping, tanh / hyperbolic
//           feedback saturator, nonlinear stages; multimode outputs
//   §4.7    diode ladder: linear and with a feedback saturator
//   §5      state-variable filter and its further types; nonlinear damping
//           (atanh / hyperbolic) and saturating integrators
//   §6      phasers (1-pole and 2-pole allpasses) and the flanger
//
// Appended after the book's list, in the module's own design:
//   Sallen-Key 2-pole low-/high-pass: a two-capacitor active topology whose
//           amplifier gain sets the resonance; the amplifier clips against a
//           hard-knee wall, so the resonance rings clean and then bites
//   Vowel   four formant resonators morphed over A-E-I-O-U
//   Comb    a tuned feedback comb with either polarity and damping in the loop
//   Staircase  a cascade of 1-pole sections, 6-48 dB, with staggered corners
//
// And circuit models of their own, each after a classic topology:
//   Op-Amp Slew SVF   a state-variable filter whose op-amp integrators are
//           slew-limited and rail-bound: loud, high signals turn to ramps
//   Diode-Feedback LP/HP  the Sallen-Key structure with a diode clipper in
//           the resonance path instead of a hard wall: soft, screaming
//   Diode Pair Multimode  integrators fed through diode pairs (tanh)
//   OTA 4-Pole  four OTA stages (each integrates tanh(in − out)) in a loop
//   CMOS Inverter SVF  inverters as integrators: asymmetric, very dirty
//
// Analog (0 … 1) brings in what the circuits do beyond their equations:
// component tolerances (each channel's cutoff and each ladder stage differ a
// little), slow drift and a noise floor (FilterDsp), slightly mismatched
// transistor pairs (asymmetric stages), the ladders' bass loss at high
// resonance, a coupling high-pass in the diode ladder's feedback, and a
// touch of stage saturation in the feedback-saturated ladders, so their
// self-oscillation shifts in pitch with its level. Analog 0 is the ideal
// circuit. The saturating ladders are solved in full (Newton over the loop).
//
// Drive is the algorithm's own: each family saturates where its circuit does
// (driveSpec()): the ladders in their stages, the diode ladder asymmetrically
// in its loop, the Sallen-Key against its amplifier's wall, the phasers,
// flanger and comb in their feedback, the 1-poles after the filter like tape,
// the linear SVFs and the biquad in a warm input stage. Drive raises the level
// into the nonlinearity and lowers the output again, so it changes the sound
// more than the loudness.
//
// One FilterVoice holds the state of one channel for every algorithm.
#pragma once

#include "dsp/Svf.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <string>
#include <vector>

namespace bleep::patch::va {

enum class FilterType {
    // State variable (§5)
    Svf, SvfUnitBp, SvfBandShelf, SvfPeak, SvfAllpass,
    // 1-pole (§2)
    OnePoleLp, OnePoleHp, OnePoleAp, OnePoleLowShelf, OnePoleHighShelf,
    // Transistor ladder (§4)
    Ladder, LadderFeedbackHp, LadderTanh, LadderHyperbolic, LadderNonlinear,
    // Diode ladder (§4.7)
    Diode, DiodeTanh,
    // Allpass effects (§6)
    Phaser1, Phaser2, Flanger,
    // Classic digital references (§3)
    NaiveOnePole, Biquad,
    // Own designs.
    SallenKeyLp, SallenKeyHp, Vowel, CombPositive, CombNegative, StaircaseLp, StaircaseHp,
    // Circuit models.
    SlewSvf, DiodeFeedbackLp, DiodeFeedbackHp, DiodePair, Ota4, CmosSvf,
    // Nonlinear state variable (§5.4). SvfSaturating must stay last: boards
    // saved before the algorithm list store it as type 1.0 ("Rough"). Boards
    // saved with the 25- and the 32-algorithm lists are migrated by name
    // (legacyLists()); the list's length − 1 must stay coprime to 24 and 31.
    SvfAtanh, SvfHyperbolic, SvfSaturating,
    Count
};
constexpr int kNumTypes = (int)FilterType::Count;

/// Type names grouped for the Type dropdown, in FilterType order.
struct TypeGroup {
    const char* name;
    std::vector<const char*> types;
};
inline const std::vector<TypeGroup>& typeGroups() {
    static const std::vector<TypeGroup> groups = {
        {"State Variable (12 dB)", {"SVF Multimode", "SVF Bandpass (unit gain)", "SVF Band Shelf", "SVF Peaking", "SVF Allpass"}},
        {"1-Pole (6 dB)", {"1-Pole Low-pass", "1-Pole High-pass", "1-Pole Allpass", "1-Pole Low Shelf", "1-Pole High Shelf"}},
        {"Transistor Ladder (24 dB)", {"Ladder Linear", "Ladder Feedback HP", "Ladder Tanh", "Ladder Hyperbolic", "Ladder Nonlinear Stages"}},
        {"Diode Ladder (24 dB)", {"Diode Ladder Linear", "Diode Ladder Tanh"}},
        {"Allpass Effects", {"Phaser 1-Pole ×4", "Phaser 2-Pole ×2", "Flanger"}},
        {"Classic Digital", {"Naive 1-Pole Low-pass", "Biquad (Direct Form I)"}},
        {"Sallen-Key (12 dB)", {"Sallen-Key Low-pass", "Sallen-Key High-pass"}},
        {"Formant", {"Vowel A-E-I-O-U"}},
        {"Tuned Comb", {"Comb Positive", "Comb Negative"}},
        {"Staircase (6-48 dB)", {"Staircase Low-pass", "Staircase High-pass"}},
        {"Op-Amp Slew (12 dB)", {"Op-Amp Slew SVF"}},
        {"Diode Feedback (12 dB)", {"Diode-Feedback Low-pass", "Diode-Feedback High-pass"}},
        {"Diode Pair (12 dB)", {"Diode Pair Multimode"}},
        {"OTA Cascade (24 dB)", {"OTA 4-Pole"}},
        {"CMOS Inverter (12 dB)", {"CMOS Inverter SVF"}},
        {"Nonlinear State Variable", {"SVF Atanh Damping", "SVF Hyperbolic Damping", "SVF Saturating (Rough)"}},
    };
    return groups;
}

/// The 25 names of the list before the own designs were added, in their old
/// order: boards stored Type normalised against it (index / 24).
inline const std::vector<std::string>& legacyNames() {
    static const std::vector<std::string> names = {
        "SVF Multimode", "SVF Bandpass (unit gain)", "SVF Band Shelf", "SVF Peaking", "SVF Allpass",
        "1-Pole Low-pass", "1-Pole High-pass", "1-Pole Allpass", "1-Pole Low Shelf", "1-Pole High Shelf",
        "Ladder Linear", "Ladder Feedback HP", "Ladder Tanh", "Ladder Hyperbolic", "Ladder Nonlinear Stages",
        "Diode Ladder Linear", "Diode Ladder Tanh", "Phaser 1-Pole ×4", "Phaser 2-Pole ×2", "Flanger",
        "Naive 1-Pole Low-pass", "Biquad (Direct Form I)",
        "SVF Atanh Damping", "SVF Hyperbolic Damping", "SVF Saturating (Rough)"};
    return names;
}

/// Every earlier list boards may have stored Type against (index / (n − 1)), oldest first:
/// the 25 algorithms of the book, then the 32 with the own designs.
inline const std::vector<std::vector<std::string>>& legacyLists() {
    static const std::vector<std::vector<std::string>> lists = {
        legacyNames(),
        {"SVF Multimode", "SVF Bandpass (unit gain)", "SVF Band Shelf", "SVF Peaking", "SVF Allpass",
         "1-Pole Low-pass", "1-Pole High-pass", "1-Pole Allpass", "1-Pole Low Shelf", "1-Pole High Shelf",
         "Ladder Linear", "Ladder Feedback HP", "Ladder Tanh", "Ladder Hyperbolic", "Ladder Nonlinear Stages",
         "Diode Ladder Linear", "Diode Ladder Tanh", "Phaser 1-Pole ×4", "Phaser 2-Pole ×2", "Flanger",
         "Naive 1-Pole Low-pass", "Biquad (Direct Form I)", "Sallen-Key Low-pass", "Sallen-Key High-pass",
         "Vowel A-E-I-O-U", "Comb Positive", "Comb Negative", "Staircase Low-pass", "Staircase High-pass",
         "SVF Atanh Damping", "SVF Hyperbolic Damping", "SVF Saturating (Rough)"},
    };
    return lists;
}

constexpr double kPi = 3.14159265358979323846;

/// Sallen-Key amplifier: gain 1 … 3.04 over the Resonance knob (3 is the edge
/// of self-oscillation), clipping against a wall at ±kWall.
constexpr double kWall = 2.0;
constexpr int kFormants = 4, kMaxStages = 8;
constexpr float kVowelNeutralHz = 2000.0f;  ///< Cutoff at which the formants sit at their natural place
constexpr float kSpacingCentreHz = 1500.0f; ///< Gain stretches or squeezes the formants around this

/// Sallen-Key amplifier gain for a Resonance 0..1: the peak Q = 1/(3 − K) follows
/// the SVF's curve (0.5 … 25, even steps per octave of Q, so the whole knob is
/// heard), then `top` more gain over the last 15 % takes it past 3, into
/// self-oscillation against the wall.
inline float sallenKeyGain(float res, float top) noexcept {
    res = std::clamp(res, 0.0f, 1.0f);
    const float q = 0.5f * std::pow(50.0f, res), over = std::max(0.0f, (res - 0.85f) / 0.15f);
    return 3.0f - 1.0f / q + top * over * over;
}

/// Prewarped integrator gain ωc·T/2 for a cutoff in Hz (§3.9).
inline float prewarp(double hz, double sampleRate) noexcept {
    const double f = std::clamp(hz, 5.0, 0.49 * sampleRate);
    return (float)std::tan(kPi * f / sampleRate);
}

/// Static ladder feedback high-pass (§4.3): kills the resonance below it.
constexpr double kFeedbackHpHz = 250.0;

// Analog (at 100 %).
constexpr float kStageTolerance = 0.08f;   ///< ±8 % cutoff spread between the stages of a ladder / cascade
constexpr float kStageMismatch = 0.35f;    ///< asymmetry of the transistor / OTA pairs (even harmonics)
constexpr float kBassLoss = 0.25f;         ///< share of the ladders' resonance compensation given up
constexpr float kAnalogBias = 0.5f;        ///< asymmetry of the Drive / warmth curve (even harmonics), on top of the type's own
constexpr float kCouplingHpHz = 90.0f;     ///< the diode ladder's feedback coupling high-pass
constexpr float kSlewHz = 4000.0f;         ///< op-amp slew: a full-scale sine above this is limited
constexpr float kOpAmpRail = 1.5f;         ///< op-amp / inverter integrators clip softly here

/// Where Drive acts: an input stage before the filter, a stage after it, or
/// inside the filter (its stages, loop or amplifier).
enum class DriveAt { Before, After, Inside };

/// Drive of one type: up to maxDb into the nonlinearity and asymmetry (even
/// harmonics) up to bias. The output is lowered again as a soft clipper with
/// level `knee` would grow a reference signal (driveMakeup()): full make-up
/// while Drive is low, less once the curve limits the level anyway. The knees
/// are fitted so a full-scale signal keeps its level at full Drive; quieter
/// signals come out a little louder, as a driven circuit does.
struct DriveSpec {
    DriveAt at;
    float maxDb, knee, bias;
    float trimDb = 0.0f;  ///< extra output gain at full Drive, where even no make-up leaves the type quieter (or louder: < 0)
    float trimExp = 1.5f; ///< how late over the knob the trim comes in (Drive^trimExp)
};

/// Drive also drives the output amplifier a little (up to this much, after the filter), so the distortion is not
/// all filtered away again on a low-pass. Not on the types driven after the filter, nor on the digital references.
constexpr float kOutputStageDb = 18.0f;

constexpr float kDriveReference = 0.5f;  ///< scales the knees (only kDriveReference / knee matters)

/// Output gain for an input gain g: tanh(r/knee) / tanh(g·r/knee), 1 at g = 1.
inline float driveMakeup(float g, float knee) noexcept {
    const float r = kDriveReference / knee;
    return std::tanh(r) / std::tanh(g * r);
}

inline const DriveSpec& driveSpec(FilterType type) noexcept {
    // FilterType order. Calibrated so that the same Drive sounds about as driven
    // on every type, at about the same loudness.
    static const DriveSpec specs[] = {
        // SVF Multimode, Bandpass (unit gain), Band Shelf, Peaking, Allpass: warm input stage
        {DriveAt::Before, 42.0f, 0.02f, 0.15f, 3.4f}, {DriveAt::Before, 42.0f, 0.02f, 0.15f, -4.0f, 6.0f}, {DriveAt::Before, 42.0f, 0.02f, 0.15f, 4.2f},
        {DriveAt::Before, 42.0f, 0.02f, 0.15f, 6.8f}, {DriveAt::Before, 42.0f, 0.02f, 0.15f, 2.8f},
        // 1-Pole LP, HP, AP, Low Shelf, High Shelf: tape-like stage after the filter
        {DriveAt::After, 36.0f, 0.31f, 0.1f, -5.6f, 2.0f}, {DriveAt::After, 36.0f, 0.02f, 0.1f, -8.0f, 4.0f}, {DriveAt::After, 36.0f, 0.02f, 0.1f, -5.2f, 2.0f},
        {DriveAt::After, 36.0f, 0.02f, 0.1f, 2.6f}, {DriveAt::After, 36.0f, 0.02f, 0.1f, -3.8f, 3.0f},
        // Ladder Linear, Feedback HP, Tanh, Hyperbolic, Nonlinear Stages: input stage, then into the stages
        {DriveAt::Inside, 36.0f, 0.02f, 0.0f, 3.2f}, {DriveAt::Inside, 48.0f, 0.69f, 0.0f, 2.4f}, {DriveAt::Inside, 42.0f, 0.14f, 0.0f, 0.6f, 6.0f},
        {DriveAt::Inside, 42.0f, 0.39f, 0.0f, -0.4f, 2.0f}, {DriveAt::Inside, 42.0f, 0.02f, 0.0f, 1.4f},
        // Diode Linear, Diode Tanh: asymmetric input stage, then in the loop (the ladder's input)
        {DriveAt::Inside, 32.0f, 0.13f, 0.4f, -2.6f}, {DriveAt::Inside, 36.0f, 0.58f, 0.4f, -1.8f, 3.0f},
        // Phaser 1-Pole, Phaser 2-Pole, Flanger: in the feedback loop
        {DriveAt::Inside, 42.0f, 0.34f, 0.0f, 2.0f}, {DriveAt::Inside, 42.0f, 0.02f, 0.0f, 2.0f}, {DriveAt::Inside, 42.0f, 0.16f, 0.0f, 3.0f},
        // Naive 1-Pole: hard digital clipping before; Biquad: warm input stage
        {DriveAt::Before, 36.0f, 0.61f, 0.0f, -1.4f}, {DriveAt::Before, 42.0f, 0.24f, 0.15f, -5.4f, 2.0f},
        // Sallen-Key LP, HP: into the amplifier's wall, which turns asymmetric
        {DriveAt::Inside, 42.0f, 0.02f, 0.3f, -0.2f, 3.0f}, {DriveAt::Inside, 42.0f, 0.02f, 0.3f, -11.6f, 4.0f},
        // Vowel: a driven voice before the formants
        {DriveAt::Before, 36.0f, 0.02f, 0.3f, 0.8f},
        // Comb Positive, Negative: in the loop
        {DriveAt::Inside, 42.0f, 0.47f, 0.0f, 2.6f}, {DriveAt::Inside, 42.0f, 0.70f, 0.0f, 2.6f},
        // Staircase LP, HP: into every section
        {DriveAt::Inside, 42.0f, 0.02f, 0.0f, 1.8f, 6.0f}, {DriveAt::Inside, 42.0f, 0.18f, 0.0f, 3.2f},
        // Op-Amp Slew SVF: into the slewing integrators
        {DriveAt::Inside, 42.0f, 0.02f, 0.1f, 2.6f},
        // Diode-Feedback LP, HP: into the amplifier and its diode clipper
        {DriveAt::Inside, 42.0f, 0.14f, 0.25f, -4.6f, 2.0f}, {DriveAt::Inside, 42.0f, 0.61f, 0.25f, -12.0f, 4.0f},
        // Diode Pair: into the diode pairs
        {DriveAt::Inside, 32.0f, 0.02f, 0.1f, 2.6f},
        // OTA 4-Pole: input stage, then into the OTA stages
        {DriveAt::Inside, 42.0f, 0.43f, 0.05f, 0.2f, 6.0f},
        // CMOS Inverter SVF: into the inverters
        {DriveAt::Inside, 36.0f, 0.02f, 0.35f, 1.0f},
        // SVF Atanh, Hyperbolic, Saturating: into their own nonlinearity
        {DriveAt::Inside, 36.0f, 1.11f, 0.0f, 15.0f}, {DriveAt::Inside, 36.0f, 0.02f, 0.0f, 5.0f, 6.0f}, {DriveAt::Inside, 36.0f, 0.38f, 0.0f, -2.8f, 2.0f},
    };
    static_assert(sizeof(specs) / sizeof(specs[0]) == (size_t)FilterType::Count, "one DriveSpec per FilterType");
    return specs[(size_t)type];
}

/// tanh with an offset, shifted back through the origin and normalised to slope 1 there:
/// b = 0 is tanh; b > 0 clips the negative side earlier (even harmonics, a diode's bend).
inline double asym(double v, double b) noexcept {
    const double tb = std::tanh(b);
    return (std::tanh(v + b) - tb) / (1.0 - tb * tb);
}
inline double asymD(double v, double b) noexcept {
    const double tb = std::tanh(b), t = std::tanh(v + b);
    return (1.0 - t * t) / (1.0 - tb * tb);
}
/// The largest |asym(v, b)|, for the Newton brackets.
inline double asymBound(double b) noexcept { return 1.0 / (1.0 - std::fabs(std::tanh(b))); }

/// An integrator's output against its supply rails: exactly linear up to 80 %
/// of the rail, then softly into it (lo < 0 < hi). Unlike a curve over the
/// whole range, it can be applied to a state every sample without damping or
/// shifting it.
inline float rails(float v, float lo, float hi) noexcept {
    const auto side = [](float a, float rail) {
        const float knee = 0.8f * rail;
        return a <= knee ? a : knee + (rail - knee) * std::tanh((a - knee) / (rail - knee));
    };
    return v >= 0.0f ? side(v, hi) : -side(-v, -lo);
}

/// Everything derived from the knobs, shared by both channels.
struct Coeffs {
    FilterType type = FilterType::Svf;
    float g = 0.1f;        ///< prewarped cutoff (the shelves' corrected cutoff)
    float G = 0.0f;        ///< 1-pole instantaneous gain g / (1 + g)
    float R = 0.7f;        ///< SVF damping, 1/(2Q)
    float k = 0.0f;        ///< ladder / phaser feedback amount
    float K = 0.0f;        ///< shelf amount: 10^(dB/20) − 1
    float morph = 0.0f;    ///< LP → BP → HP → notch
    float invert = 1.0f;   ///< phaser / flanger wet polarity
    float comp = 1.0f;     ///< ladder input gain against the bass loss
    float Gh = 0.0f;       ///< feedback high-pass instantaneous gain
    float naive = 0.0f;    ///< naive 1-pole ωc·T
    float delay = 1.0f;    ///< flanger delay in samples
    float hz = 1000.0f;    ///< cutoff in Hz
    float q = 0.707f;      ///< resonance as Q, for the saturating SVF
    float amp = 1.0f;      ///< Sallen-Key amplifier gain
    float damp = 1.0f;     ///< comb: instantaneous gain of the damping 1-pole
    float norm = 1.0f;     ///< comb: output scaling, 1 − |feedback|
    int stages = 4;        ///< staircase: number of 1-pole sections
    std::array<float, kMaxStages> stageG{};  ///< staircase: each section's G
    float drive = 0.0f;    ///< 0..1
    float inGain = 1.0f;   ///< level into the nonlinearity
    float outGain = 1.0f;  ///< level compensation after it
    float postGain = 1.0f; ///< level into the output stage (kOutputStageDb); 1: none
    float postMul = 1.0f;  ///< output-stage make-up: a signal at kDriveReference keeps its level
    float bias = 0.0f;     ///< asymmetry of the curve
    float stageSat = 0.0f; ///< hardness of the stage saturators (ladders, diodes, staircase); 0: linear stages
    float loopSat = 0.0f;  ///< hardness of the loop saturator (diodes, phasers, flanger, comb); 0: linear loop
    float analog = 0.0f;   ///< 0..1: tolerances, mismatch, bass loss, coupling (see the top)
    float stageBias = 0.0f;///< asymmetry of the ladder / OTA stages (mismatched pairs)
    double stageTb = 0.0, stageNorm = 1.0;  ///< tanh(stageBias), 1 / (1 − tanh²): asym() without its constant tanh
    bool warmthOnly = false;  ///< the saturation comes from Analog's warmth alone (FilterDsp), not from Drive
    double biasTb = 0.0, biasNorm = 1.0;  ///< tanh(bias), 1 / (1 − tanh²): the Drive stage's asym() without its constant tanh
    bool couplingHp = false; ///< diode ladder: a high-pass (Gh) in the feedback
    float wallLevel = (float)2.0;  ///< Sallen-Key / diode-feedback: where the amplifier's output limits
    bool softWall = false;  ///< diode clipper (soft) instead of the hard-knee wall
    float slew = 1.0f;     ///< op-amp slew SVF: largest integrator step per sample
    struct Formant {
        float g = 0.1f, R = 0.1f, amp = 0.0f;  ///< prewarped centre, damping, level
    };
    std::array<Formant, kFormants> formant{};
};

/// Formant table of the five vowels: centre (Hz), level (dB) and bandwidth (Hz)
/// of the first four resonances.
struct VowelFormants {
    float hz[kFormants], db[kFormants], bw[kFormants];
};
inline const std::array<VowelFormants, 5>& vowels() {
    static const std::array<VowelFormants, 5> v = {{
        {{780, 1180, 2850, 3800}, {0, -5, -16, -22}, {85, 95, 130, 190}},    // A
        {{430, 1900, 2650, 3450}, {0, -9, -14, -22}, {70, 110, 140, 200}},   // E
        {{310, 2150, 2950, 3700}, {0, -13, -15, -24}, {60, 120, 150, 210}},  // I
        {{460, 820, 2700, 3500}, {0, -4, -18, -24}, {75, 90, 130, 190}},     // O
        {{330, 720, 2450, 3350}, {0, -8, -20, -26}, {65, 90, 120, 180}},     // U
    }};
    return v;
}

/// Weights of the four morph endpoints (LP, BP, HP, notch), 0 % … 100 %.
inline std::array<float, 4> morphWeights(float morph) noexcept {
    const float m = std::clamp(morph, 0.0f, 1.0f) * 3.0f;
    const int i = std::min((int)m, 2);
    const float t = m - (float)i;
    std::array<float, 4> w{};
    w[(size_t)i] = 1.0f - t;
    w[(size_t)i + 1] = t;
    return w;
}

/// Computes the coefficients. resonance, morph 0..1; gainDb −24..+24.
inline Coeffs makeCoeffs(FilterType type, float hz, float resonance, float morph, float gainDb,
                         double sampleRate, float vowel = 0.0f, float damping = 0.0f, int slope = 4,
                         float drive = 0.0f, float analog = 0.0f) noexcept {
    Coeffs c;
    c.type = type;
    c.analog = std::clamp(analog, 0.0f, 1.0f);
    // The Drive and Analog part does not depend on the cutoff, which may move every sample: it is kept from the last
    // call with the same type, Drive and Analog (per thread, the audio thread's filters share it).
    struct DrivePart {
        FilterType type = FilterType::Count;
        float drive = -1.0f, analog = -1.0f;
        Coeffs c;
    };
    static thread_local DrivePart last;
    const float driveIn = std::clamp(drive, 0.0f, 1.0f);
    if (last.type == type && std::fabs(last.drive - driveIn) <= 0.0f && std::fabs(last.analog - c.analog) <= 0.0f) {
        const Coeffs& k = last.c;
        c.drive = k.drive, c.inGain = k.inGain, c.outGain = k.outGain, c.postGain = k.postGain, c.postMul = k.postMul, c.bias = k.bias, c.biasTb = k.biasTb, c.biasNorm = k.biasNorm;
        c.stageSat = k.stageSat, c.stageBias = k.stageBias, c.stageTb = k.stageTb, c.stageNorm = k.stageNorm, c.loopSat = k.loopSat;
    } else {
        const DriveSpec& d = driveSpec(type);
        c.drive = driveIn;
        // A curve, so the lower half of the knob stays fine-grained.
        c.inGain = c.drive > 0.0f ? std::pow(10.0f, d.maxDb * c.drive * c.drive / 20.0f) : 1.0f;
        c.outGain = driveMakeup(c.inGain, d.knee) * std::pow(10.0f, d.trimDb * std::pow(c.drive, d.trimExp) / 20.0f);
        // Analog adds asymmetry: a circuit's curve is never quite symmetric, so its warmth adds even harmonics
        // (a symmetric curve takes them away from a saw).
        c.bias = d.bias * c.drive + kAnalogBias * c.analog;
        if (d.at != DriveAt::After && type != FilterType::NaiveOnePole && type != FilterType::Biquad && c.drive > 0.0f) {
            c.postGain = std::pow(10.0f, kOutputStageDb * c.drive * c.drive / 20.0f);
            c.postMul = std::tanh(kDriveReference) / std::tanh(kDriveReference * c.postGain);
        }
        c.biasTb = std::tanh((double)c.bias);
        c.biasNorm = 1.0 / (1.0 - c.biasTb * c.biasTb);
        // The saturators' hardness grows with Drive, so Drive 0 stays exactly linear on the linear types and
        // the knee comes in gently (a: f(v) = tanh(a·v)/a, linear for small a).
        const float fade = c.drive;
        const bool ladderType = type >= FilterType::Ladder && type <= FilterType::LadderNonlinear;
        const bool stair = type == FilterType::StaircaseLp || type == FilterType::StaircaseHp;
        // Nonlinear Stages and the OTA cascade always saturate in their stages; Tanh and Hyperbolic get a touch with
        // Analog (a real ladder is never linear), Linear and Feedback HP only with Drive.
        const bool fbSat = type == FilterType::LadderTanh || type == FilterType::LadderHyperbolic;
        c.stageSat = (type == FilterType::LadderNonlinear || type == FilterType::Ota4) ? 1.0f
                     : fbSat ? std::max(fade, 0.5f * c.analog)
                     : (ladderType || stair) ? fade : 0.0f;
        c.stageBias = kStageMismatch * c.analog;
        c.stageTb = std::tanh((double)c.stageBias);
        c.stageNorm = 1.0 / (1.0 - c.stageTb * c.stageTb);
        c.loopSat = type == FilterType::DiodeTanh ? 1.0f
                    : (type == FilterType::Diode || type == FilterType::Phaser1 || type == FilterType::Phaser2 ||
                       type == FilterType::Flanger || type == FilterType::CombPositive || type == FilterType::CombNegative)
                        ? fade : 0.0f;
        last.type = type, last.drive = driveIn, last.analog = c.analog, last.c = c;
    }
    c.hz = hz;
    c.morph = morph;
    const float res = std::clamp(resonance, 0.0f, 1.0f);
    c.q = 0.5f * std::pow(50.0f, res);
    c.R = 0.5f / c.q;
    c.K = std::pow(10.0f, std::clamp(gainDb, -24.0f, 24.0f) / 20.0f) - 1.0f;
    c.invert = morph < 0.5f ? 1.0f : -1.0f;
    double cutoff = hz;
    // Shelves: the knob sets the middle of the slope (§2.11).
    if (type == FilterType::OnePoleLowShelf) cutoff /= std::sqrt(1.0 + c.K);
    if (type == FilterType::OnePoleHighShelf) cutoff *= std::sqrt(1.0 + c.K);
    // Diode ladder: the resonance peaks at ωc/√2 (§4.7); put it on the knob.
    if (type == FilterType::Diode || type == FilterType::DiodeTanh) cutoff *= std::sqrt(2.0);
    c.g = prewarp(cutoff, sampleRate);
    c.G = c.g / (1.0f + c.g);
    const float lpWeight = morphWeights(morph)[0];
    const auto is = [type](std::initializer_list<FilterType> list) {
        return std::find(list.begin(), list.end(), type) != list.end();
    };
    if (is({FilterType::Ladder, FilterType::LadderFeedbackHp})) c.k = 3.95f * res;
    if (is({FilterType::LadderTanh, FilterType::LadderHyperbolic, FilterType::LadderNonlinear}))
        c.k = 5.0f * res;  // self-oscillates above ~80 %
    if (type == FilterType::Diode) c.k = 16.5f * res;
    if (type == FilterType::DiodeTanh) c.k = 21.0f * res;  // self-oscillates above ~80 %
    if (is({FilterType::Phaser1, FilterType::Phaser2, FilterType::Flanger})) c.k = 0.85f * res;
    if (is({FilterType::SvfAtanh, FilterType::SvfHyperbolic}))
        c.R -= 0.06f * res * res;  // slightly negative at the top: self-oscillation
    if (is({FilterType::Ladder, FilterType::LadderTanh, FilterType::LadderHyperbolic, FilterType::LadderNonlinear}))
        // §4.3: boost the input by (1 + k) in low-pass mode; with Analog partly, so the bass thins out at high
        // resonance as on the circuit.
        c.comp = std::pow(1.0f + c.k * lpWeight, 1.0f - kBassLoss * c.analog);
    if (type == FilterType::Ota4) {
        c.k = 4.3f * res;  // self-oscillates above ~93 %
        c.comp = std::pow(1.0f + c.k * lpWeight, 0.5f - 0.25f * c.analog);  // the cascade loses bass with resonance
    }
    if ((type == FilterType::Diode || type == FilterType::DiodeTanh) && c.analog > 0.0f) {
        c.couplingHp = true;
        const float gh = prewarp(kCouplingHpHz * c.analog, sampleRate);
        c.Gh = gh / (1.0f + gh);
    }
    if (type == FilterType::SallenKeyLp || type == FilterType::SallenKeyHp) c.wallLevel = (float)kWall;
    if (type == FilterType::DiodeFeedbackLp || type == FilterType::DiodeFeedbackHp) {
        c.amp = sallenKeyGain(res, 0.3f);  // screams into self-oscillation from ~90 %
        c.wallLevel = 0.9f;
        c.softWall = true;
    }
    if (type == FilterType::SlewSvf) {
        c.R -= 0.05f * res * res;  // rings into oscillation at the top
        c.slew = (float)(2.0 * kPi * kSlewHz / sampleRate) * kOpAmpRail;
    }
    if (type == FilterType::DiodePair) c.R -= 0.05f * res * res;
    if (type == FilterType::CmosSvf) c.R -= 0.08f * res * res;
    if (type == FilterType::Diode || type == FilterType::DiodeTanh) c.comp = std::pow(1.0f + c.k, 0.75f);  // partial: full compensation overdrives
    if (type == FilterType::LadderFeedbackHp) {
        const float gh = prewarp(kFeedbackHpHz, sampleRate);
        c.Gh = gh / (1.0f + gh);
    }
    if (type == FilterType::Phaser2) c.R = 5.0f * std::pow(0.02f, std::clamp(morph, 0.0f, 1.0f));  // notch spacing
    if (type == FilterType::NaiveOnePole) c.naive = std::min(1.0f, (float)(2.0 * kPi * hz / sampleRate));
    if (type == FilterType::Flanger) c.delay = (float)std::max(2.0, sampleRate / std::max(5.0, (double)hz));
    if (type == FilterType::SallenKeyLp || type == FilterType::SallenKeyHp) c.amp = sallenKeyGain(res, 0.06f);
    if (type == FilterType::Vowel) {
        // Resonance narrows the formants; Gain (±24 dB) stretches or squeezes their spacing.
        const float bwScale = 2.0f * std::pow(0.1f, res);
        const float spacing = 1.0f + std::clamp(gainDb, -24.0f, 24.0f) / 48.0f;
        const float shift = hz / kVowelNeutralHz;
        const float pos = std::clamp(vowel, 0.0f, 1.0f) * 4.0f;
        const int i = std::min((int)pos, 3);
        const float t = pos - (float)i;
        const auto& a = vowels()[(size_t)i];
        const auto& b = vowels()[(size_t)i + 1];
        for (int n = 0; n < kFormants; ++n) {
            const float f0 = a.hz[n] * std::pow(b.hz[n] / a.hz[n], t);
            const float f = std::clamp(kSpacingCentreHz * std::pow(f0 / kSpacingCentreHz, spacing) * shift, 40.0f, 18000.0f);
            const float bw = (a.bw[n] + t * (b.bw[n] - a.bw[n])) * bwScale * std::sqrt(shift);
            auto& fm = c.formant[(size_t)n];
            fm.g = prewarp(f, sampleRate);
            fm.R = std::max(0.01f, 0.5f * bw / f);
            fm.amp = 2.0f * std::pow(10.0f, (a.db[n] + t * (b.db[n] - a.db[n])) / 20.0f);
        }
    }
    if (type == FilterType::CombPositive || type == FilterType::CombNegative) {
        const bool neg = type == FilterType::CombNegative;
        const float dampHz = 20000.0f * std::pow(0.02f, std::clamp(damping, 0.0f, 1.0f));
        const float gd = prewarp(dampHz, sampleRate);
        c.damp = gd / (1.0f + gd);
        c.k = (neg ? -0.985f : 0.985f) * res;
        c.norm = 1.0f - std::fabs(c.k);
        // The damping filter delays the loop by its phase delay at the comb's
        // pitch; take it off the line so the peaks stay on the Cutoff.
        const double w = 2.0 * kPi * std::max(5.0f, hz) / sampleRate;
        const double phase = std::atan(std::tan(0.5 * w) / gd);
        const double period = sampleRate / std::max(5.0f, hz) * (neg ? 0.5 : 1.0);
        c.delay = (float)std::max(2.0, period - phase / w);
    }
    if (type == FilterType::StaircaseLp || type == FilterType::StaircaseHp) {
        c.stages = std::clamp(slope, 1, kMaxStages);
        // N equal sections: scale the corner so the −3 dB point sits on the cutoff.
        const double edge = std::sqrt(std::pow(2.0, 1.0 / c.stages) - 1.0);
        const double base = type == FilterType::StaircaseLp ? hz / edge : hz * edge;
        for (int n = 0; n < c.stages; ++n) {
            const double octaves = res * ((double)n - 0.5 * (c.stages - 1));  // Resonance = spread, octaves per section
            const float g = prewarp(base * std::exp2(octaves), sampleRate);
            c.stageG[(size_t)n] = g / (1.0f + g);
        }
    }
    return c;
}

/// TPT 1-pole low-pass (§3.10) as one stage of a larger structure.
struct OnePole {
    float z = 0.0f;
    float tick(float x, float G) noexcept {
        const float v = (x - z) * G;
        const float y = v + z;
        z = y + v;
        return y;
    }
    /// Instantaneous offset S of y = G·x + S.
    float offset(float G) const noexcept { return z * (1.0f - G); }
    /// Advances the state once the output y is known.
    void commit(float y) noexcept { z = 2.0f * y - z; }
};

/// Solves u + a·f(u) = b for a monotonic saturator |f| < bound with a ≥ 0:
/// Newton's method, kept inside the bracket b ± a·bound.
template <typename F, typename DF>
inline float solveFeedback(float a, float b, float guess, F f, DF df, double bound = 1.0) noexcept {
    double lo = (double)b - a * bound, hi = (double)b + a * bound, u = std::clamp((double)guess, lo, hi);
    for (int i = 0; i < 12; ++i) {
        const double r = u + a * f(u) - b;
        if (std::fabs(r) < 1e-7) break;
        if (r > 0.0) hi = u; else lo = u;
        double next = u - r / (1.0 + a * df(u));
        if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
        u = next;
    }
    return (float)u;
}

inline double tanhD(double u) noexcept { const double t = std::tanh(u); return 1.0 - t * t; }

/// tanh by its [7/6] Padé approximant: within 1e-6 for |x| < 4.2, clamped to ±1
/// beyond 4.97 (where it meets 1 within 1e-4). For the stage solvers, which
/// evaluate it dozens of times per sample.
inline double fastTanh(double x) noexcept {
    if (x > 4.97) return 1.0;
    if (x < -4.97) return -1.0;
    const double x2 = x * x;
    return x * (135135.0 + x2 * (17325.0 + x2 * (378.0 + x2))) / (135135.0 + x2 * (62370.0 + x2 * (3150.0 + 28.0 * x2)));
}
inline double fastTanhD(double x) noexcept { const double t = fastTanh(x); return 1.0 - t * t; }
inline double hyper(double u) noexcept { return u / (1.0 + std::fabs(u)); }
inline double hyperD(double u) noexcept { const double d = 1.0 + std::fabs(u); return 1.0 / (d * d); }

/// One channel's state for every algorithm.
class FilterVoice {
public:
    void prepare(double sampleRate) {
        delay_.assign((size_t)(sampleRate * 0.25) + 4, 0.0f);
        reset();
    }

    /// This voice's component spread: one value in −1 … 1 per ladder stage (Analog scales it).
    void setVariation(const std::array<float, 4>& v) noexcept { tol_ = v; }
    void seedNoise(uint32_t seed) noexcept { rng_ = seed ? seed : 0x9e3779b9u; }
    /// Takes over another voice's filter state, keeping this voice's own components (spread and noise).
    void copyState(const FilterVoice& o) {
        const auto tol = tol_;
        const auto rng = rng_;
        *this = o;
        tol_ = tol;
        rng_ = rng;
    }

    void reset() noexcept {
        for (auto& p : p_) p = {};
        for (auto& p : stair_) p = {};
        vs1_.fill(0.0f);
        vs2_.fill(0.0f);
        skState_ = 0.0f;
        hp_ = {};
        s1_ = s2_ = t1_ = t2_ = 0.0f;
        x1_ = x2_ = y1_ = y2_ = 0.0f;
        naive_ = 0.0f;
        std::fill(delay_.begin(), delay_.end(), 0.0f);
        write_ = 0;
        rough_.reset();
        roughQ_ = roughHz_ = -1.0f;
        lastW_ = prevW_ = lastX_ = prevX_ = 0.0;
        lastLoop_ = 0.0;
        lastY_.fill(0.0);
        lastT_.fill(0.0);
    }

    /// One sample, with the type's Drive (driveSpec()).
    float process(const Coeffs& c, float x, double sampleRate) noexcept {
        // Analog: a noise floor around −70 dB, which also lets self-oscillation start on its own.
        if (c.analog > 0.0f && c.type != FilterType::NaiveOnePole && c.type != FilterType::Biquad)
            x += 3.0e-4f * c.analog * noise();
        if (c.drive <= 0.0f) return core(c, x, sampleRate);
        const DriveSpec& d = driveSpec(c.type);
        const double in = (double)c.inGain * x;
        const auto shape = [&c](double v) { return (fastTanh(v + c.bias) - c.biasTb) * c.biasNorm; };  // asym(v, bias)
        // The output stage, the same curve: a signal at kDriveReference keeps about its level, louder ones are
        // squashed, quieter ones come out a little louder.
        const auto post = [&c, &shape](float y) { return c.postGain > 1.0f ? (float)(shape((double)c.postGain * y) * c.postMul) : y; };
        switch (d.at) {
            case DriveAt::Before: {
                const double shaped = c.type == FilterType::NaiveOnePole ? std::clamp(in, -1.0, 1.0) : shape(in);
                return c.outGain * post(core(c, (float)shaped, sampleRate));
            }
            case DriveAt::After: return c.outGain * (float)shape((double)c.inGain * core(c, x, sampleRate));
            case DriveAt::Inside: {
                // The ladders and diodes have a soft input stage of their own (clipping at ±2).
                const bool stage = (c.type >= FilterType::Ladder && c.type <= FilterType::DiodeTanh) || c.type == FilterType::Ota4;
                const double v = stage ? 2.0 * shape(0.5 * in) : in;
                return c.outGain * post(core(c, (float)v, sampleRate));
            }
        }
        return x;
    }

private:
    float core(const Coeffs& c, float x, double sampleRate) noexcept {
        switch (c.type) {
            case FilterType::Svf: return morph(svf(c, x), c.morph);
            case FilterType::SvfUnitBp: return 2.0f * c.R * svf(c, x)[1];
            case FilterType::SvfBandShelf: return x + 2.0f * c.R * c.K * svf(c, x)[1];
            case FilterType::SvfPeak: { const auto o = svf(c, x); return o[0] - o[2]; }
            case FilterType::SvfAllpass: return x - 4.0f * c.R * svf(c, x)[1];

            case FilterType::OnePoleLp: return p_[0].tick(x, c.G);
            case FilterType::OnePoleHp: return x - p_[0].tick(x, c.G);
            case FilterType::OnePoleAp: return 2.0f * p_[0].tick(x, c.G) - x;
            case FilterType::OnePoleLowShelf: return x + c.K * p_[0].tick(x, c.G);
            case FilterType::OnePoleHighShelf: return x + c.K * (x - p_[0].tick(x, c.G));

            case FilterType::Ladder:
            case FilterType::LadderFeedbackHp:
            case FilterType::LadderTanh:
            case FilterType::LadderHyperbolic:
            case FilterType::LadderNonlinear:
            case FilterType::Ota4: return ladder(c, x);

            case FilterType::Diode:
            case FilterType::DiodeTanh: return diode(c, x);

            case FilterType::Phaser1: return phaser1(c, x);
            case FilterType::Phaser2: return phaser2(c, x);
            case FilterType::Flanger: return flanger(c, x);

            case FilterType::NaiveOnePole:
                naive_ += c.naive * (x - naive_);
                return naive_;
            case FilterType::Biquad: return biquad(c, x);

            case FilterType::SvfAtanh:
            case FilterType::SvfHyperbolic: return morph(svfNonlinear(c, x), c.morph);
            case FilterType::SvfSaturating:
                if (std::fabs(c.hz - roughHz_) > 0.0f || std::fabs(c.q - roughQ_) > 0.0f) {
                    rough_.set(c.hz, c.q, sampleRate);
                    roughHz_ = c.hz;
                    roughQ_ = c.q;
                }
                return dsp::morphSvf(rough_.process(x), c.morph);
            case FilterType::SallenKeyLp:
            case FilterType::DiodeFeedbackLp: return sallenKeyLp(c, x);
            case FilterType::SallenKeyHp:
            case FilterType::DiodeFeedbackHp: return sallenKeyHp(c, x);
            case FilterType::SlewSvf:
            case FilterType::DiodePair:
            case FilterType::CmosSvf: return morph(svfShaped(c, x), c.morph);
            case FilterType::Vowel: return vowel(c, x);
            case FilterType::CombPositive:
            case FilterType::CombNegative: return comb(c, x);
            case FilterType::StaircaseLp:
            case FilterType::StaircaseHp: {
                float y = x;
                for (int n = 0; n < c.stages; ++n) {
                    float G = c.stageG[(size_t)n];
                    if (c.analog > 0.0f) {  // the sections' spread
                        const float gs = G / (1.0f - G) * (1.0f + kStageTolerance * c.analog * tol_[(size_t)n % 4]);
                        G = gs / (1.0f + gs);
                    }
                    if (c.type == FilterType::StaircaseLp) {
                        y = c.stageSat > 0.0f ? satStage(stair_[(size_t)n], y, G / (1.0f - G), c.stageSat)
                                              : stair_[(size_t)n].tick(y, G);
                    } else {
                        // High-pass: input − low-pass only cancels with a linear low-pass; saturate the section's input.
                        if (c.stageSat > 0.0f) y = (float)(std::tanh((double)c.stageSat * y) / c.stageSat);
                        y -= stair_[(size_t)n].tick(y, G);
                    }
                }
                return y;
            }
            case FilterType::Count: break;
        }
        return x;
    }

    using Lbh = std::array<float, 3>;  // low-, band-, high-pass

    static float morph(const Lbh& o, float m) noexcept {
        const auto w = morphWeights(m);
        return w[0] * o[0] + w[1] * o[1] + w[2] * o[2] + w[3] * (o[0] + o[2]);
    }

    /// §5.2: the TPT state-variable filter, solved for the high-pass.
    Lbh svf(const Coeffs& c, float x) noexcept {
        const float g = c.g, r2 = 2.0f * c.R;
        const float hp = (x - (r2 + g) * s1_ - s2_) / (1.0f + r2 * g + g * g);
        const float v1 = g * hp, bp = v1 + s1_;
        s1_ = bp + v1;
        const float v2 = g * bp, lp = v2 + s2_;
        s2_ = lp + v2;
        return {lp, bp, hp};
    }

    /// §5.4, Fig. 5.11: a saturator in the band-pass damping path. The
    /// nonlinear zero-delay feedback equation is solved for the first
    /// integrator's output v (Newton, bracketed: atanh needs |v| < 1).
    Lbh svfNonlinear(const Coeffs& c, float x) noexcept {
        const bool atanhShape = c.type == FilterType::SvfAtanh;
        const double g = c.g, R = c.R, s1 = s1_, s2 = s2_;
        auto f = [&](double v) { return atanhShape ? std::atanh(v) : v / (1.0 - std::fabs(v)); };
        auto df = [&](double v) {
            if (atanhShape) return 1.0 / (1.0 - v * v);
            const double d = 1.0 - std::fabs(v);
            return 1.0 / (d * d);
        };
        // v − s1 = g·hp,  hp = x − 2f(v) − (2R − 2 + g)·v − s2
        auto F = [&](double v) { return v - s1 - g * ((double)x - 2.0 * f(v) - (2.0 * R - 2.0 + g) * v - s2); };
        double lo = -0.999999, hi = 0.999999;
        double v = std::clamp((s1 + g * ((double)x - s2)) / (1.0 + g * (2.0 * R + g)), lo, hi);
        for (int i = 0; i < 16; ++i) {
            const double r = F(v);
            if (std::fabs(r) < 1e-8) break;
            if (r > 0.0) hi = v; else lo = v;
            double next = v - r / (1.0 + g * (2.0 * df(v) + 2.0 * R - 2.0 + g));
            if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
            v = next;
        }
        const double hp = (double)x - 2.0 * f(v) - (2.0 * R - 2.0 + g) * v - s2;
        s1_ = (float)(2.0 * v - s1);
        const double lp = g * v + s2;
        s2_ = (float)(lp + g * v);
        return {(float)lp, (float)f(v), (float)hp};
    }

    /// §4.4: mixes the ladder taps y0…y4 into LP (y4), BP (s²), HP (s⁴) and
    /// notch ((s² + 1)²), all over the ladder's denominator.
    static float ladderModes(const float* y, float m) noexcept {
        const auto w = morphWeights(m);
        const float bp = y[2] - 2.0f * y[3] + y[4];
        const float hp = y[0] - 4.0f * y[1] + 6.0f * y[2] - 4.0f * y[3] + y[4];
        return w[0] * y[4] + w[1] * 4.0f * bp + w[2] * hp + w[3] * (y[4] + 2.0f * bp + hp);
    }

    /// A Newton step on the feedback point below this ends the full solution: the stages follow it to first order.
    static constexpr double kLadderLinearStep = 1e-3;

    /// §4.2–4.6: four TPT 1-poles in a negative feedback loop, solved at the
    /// feedback point. Linear stages: closed form, with a saturator there
    /// (tanh or x/(1 + |x|)) the equation u = x − k(G·f(u) + S) is solved
    /// numerically. Saturating stages (Nonlinear Stages, the OTA cascade, and
    /// the others with Drive or Analog): Newton's method over the whole loop,
    /// every stage solved inside it. With Analog the stages' cutoffs spread.
    float ladder(const Coeffs& c, float in) noexcept {
        std::array<float, 4> g{}, G{};
        for (size_t i = 0; i < 4; ++i) {
            g[i] = c.g * (1.0f + kStageTolerance * c.analog * tol_[i]);
            G[i] = g[i] / (1.0f + g[i]);
        }
        const float x = in * c.comp;
        // The chain's instantaneous response y4 = Gt·y0 + St.
        float Gt = 1.0f, St = 0.0f;
        for (size_t i = 0; i < 4; ++i) {
            St = G[i] * St + p_[i].offset(G[i]);
            Gt *= G[i];
        }
        // Feedback signal: y4, or its high-pass (Feedback HP): hpGain·(y4 − z).
        const bool fbHp = c.type == FilterType::LadderFeedbackHp;
        const float hpGain = fbHp ? 1.0f - c.Gh : 1.0f, hpZ = fbHp ? hp_.z : 0.0f;
        const float kf = c.k * hpGain;
        const float linear = (x - kf * (St - hpZ)) / (1.0f + kf * Gt);
        float y[5];
        // Stage saturation from Analog alone (its touch on Tanh / Hyperbolic, its warmth on the others, Drive at 0):
        // the loop as for linear stages, then each stage takes one step linearised around its last output. Nonlinear
        // Stages, the OTA cascade and Drive get the full solution below.
        const bool light = c.stageSat > 0.0f && (c.drive <= 0.0f || c.warmthOnly) &&
                           c.type != FilterType::LadderNonlinear && c.type != FilterType::Ota4;
        if (light) {
            if (c.type == FilterType::LadderTanh)
                y[0] = (float)fastTanh(solveFeedback(kf * Gt, x - kf * (St - hpZ), linear, fastTanh, fastTanhD));
            else if (c.type == FilterType::LadderHyperbolic)
                y[0] = (float)hyper(solveFeedback(kf * Gt, x - kf * (St - hpZ), linear, hyper, hyperD));
            else
                y[0] = linear;
            const double a = c.stageSat;
            // tanh(a·v + b) of each stage's input; a stage's last output is the next stage's last input, so its
            // tanh is already known (lastT_), and only the last stage's output needs one more.
            std::array<double, 5> t{};
            for (size_t i = 0; i < 4; ++i) {
                // y = z + g·(f(in) − f(y)), f(y) ≈ f(yp) + f'(yp)·(y − yp)
                t[i] = fastTanh(a * y[i] + c.stageBias);
                const double yp = lastY_[i], fi = (t[i] - c.stageTb) * c.stageNorm / a;
                const double tp = lastT_[i + 1], fp = (tp - c.stageTb) * c.stageNorm / a, dp = (1.0 - tp * tp) * c.stageNorm;
                const double out = (p_[i].z + g[i] * (fi - fp + dp * yp)) / (1.0 + g[i] * dp);
                y[i + 1] = (float)out;
                lastY_[i] = out;
                p_[i].commit(y[i + 1]);
            }
            t[4] = fastTanh(a * y[4] + c.stageBias);
            lastT_ = t;
        } else if (c.stageSat <= 0.0f) {
            if (c.type == FilterType::LadderTanh)
                y[0] = (float)fastTanh(solveFeedback(kf * Gt, x - kf * (St - hpZ), linear, fastTanh, fastTanhD));
            else if (c.type == FilterType::LadderHyperbolic)
                y[0] = (float)hyper(solveFeedback(kf * Gt, x - kf * (St - hpZ), linear, hyper, hyperD));
            else
                y[0] = linear;
            for (size_t i = 0; i < 4; ++i) y[i + 1] = p_[i].tick(y[i], G[i]);
        } else {
            // w: the feedback point before the loop's saturator (if any), y0 = fb(w).
            const int fb = c.type == FilterType::LadderTanh ? 1 : c.type == FilterType::LadderHyperbolic ? 2 : 0;
            const auto fbF = [fb](double w) { return fb == 1 ? fastTanh(w) : fb == 2 ? hyper(w) : w; };
            const auto fbD = [fb](double w) { return fb == 1 ? fastTanhD(w) : fb == 2 ? hyperD(w) : 1.0; };
            // Warm start: at 4× oversampling the feedback point moves smoothly, so the last two samples predict it,
            // and the input's departure from its own trend (noise, an edge) moves it by 1 / (1 + loop gain).
            const double trend = (double)x - (2.0 * lastX_ - prevX_);
            double w = 2.0 * lastW_ - prevW_ + trend / (1.0 + kf * lastLoop_);
            if (!std::isfinite(w)) w = linear;
            prevX_ = lastX_;
            lastX_ = x;
            std::array<double, 4> ys = lastY_;
            bool solved = false;
            for (int it = 0; it < 4; ++it) {
                const double dw = fbD(w);
                double d4 = dw;
                std::array<double, 4> slope{};  // dys[i]/dw
                double v = fbF(w);
                for (size_t i = 0; i < 4; ++i) {
                    double di = 0.0;
                    v = stage(c, p_[i].z, g[i], v, di, ys[i]);
                    ys[i] = v;
                    d4 *= di;
                    slope[i] = d4;
                }
                const double r = w - x + kf * (v - hpZ);
                if (std::fabs(r) < 1e-6) { solved = true; lastLoop_ = d4; break; }  // ys belong to this w
                lastLoop_ = d4;
                const double step = -r / (1.0 + kf * d4);
                if (!std::isfinite(step)) { w = linear; break; }
                w += step;
                if (std::fabs(step) < kLadderLinearStep) {
                    // A small last step: the stages follow it to first order (the error is of order step²), so they need
                    // not be solved again.
                    for (size_t i = 0; i < 4; ++i) ys[i] += slope[i] * step;
                    solved = true;
                    break;
                }
            }
            prevW_ = lastW_; lastW_ = w;
            y[0] = (float)fbF(w);
            for (size_t i = 0; i < 4; ++i) {
                if (!solved) {  // the last step moved w: run the stages once more for it
                    double di = 0.0;
                    ys[i] = stage(c, p_[i].z, g[i], y[i], di, ys[i]);
                }
                y[i + 1] = (float)ys[i];
                lastY_[i] = ys[i];
                p_[i].commit(y[i + 1]);
            }
        }
        if (fbHp) hp_.tick(y[4], c.Gh);
        return ladderModes(y, c.morph);
    }

    /// One saturating stage, solved for its output (Newton, from `guess`: the
    /// stage's last output), with dy/din. Transistor (§4.6): y = z + g·(f(in) −
    /// f(y)); OTA: y = z + g·f(in − y); f(v) = asym(a·v, b)/a (a: stageSat, b:
    /// the pairs' mismatch).
    static double stage(const Coeffs& c, double z, double g, double in, double& dydin, double guess) noexcept {
        const double a = c.stageSat, ia = 1.0 / a, tb = c.stageTb, norm = c.stageNorm;
        const auto f = [&](double v, double& d) {  // asym(a·v, b)/a and its slope, with tanh(b) precomputed
            const double t = fastTanh(a * v + c.stageBias);
            d = (1.0 - t * t) * norm;
            return (t - tb) * norm * ia;
        };
        double y = std::isfinite(guess) ? guess : (z + g * in) / (1.0 + g);
        double d = 0.0;
        if (c.type == FilterType::Ota4) {
            for (int n = 0; n < 4; ++n) {
                const double r = y - z - g * f(in - y, d);
                y -= r / (1.0 + g * d);
                if (std::fabs(r) < 1e-8) break;
            }
            dydin = g * d / (1.0 + g * d);
            return y;
        }
        double din = 0.0;
        const double fi = f(in, din);
        for (int n = 0; n < 4; ++n) {
            const double r = y - z - g * (fi - f(y, d));
            y -= r / (1.0 + g * d);
            if (std::fabs(r) < 1e-8) break;
        }
        dydin = g * din / (1.0 + g * d);  // d: the slope at the last iterate, close enough for the outer Newton
        return y;
    }

    /// §4.6: a 1-pole stage that integrates f(in) − f(out), f(v) = tanh(a·v)/a
    /// (a = 1: the book's transistor stage; smaller a: a softer, later knee).
    /// Solved by Newton's method; g is the prewarped gain.
    static float satStage(OnePole& st, float in, double g, double a) noexcept {
        const double fi = std::tanh(a * in) / a, z = st.z;
        double out = z;
        for (int n = 0; n < 4; ++n) {
            const double t = std::tanh(a * out);
            const double r = out - z - g * (fi - t / a);
            out -= r / (1.0 + g * (1.0 - t * t));
            if (std::fabs(r) < 1e-8) break;
        }
        st.commit((float)out);
        return (float)out;
    }

    /// §4.7: the linearised diode ladder in instantaneous-response form,
    /// solved stage by stage, inside the main feedback loop.
    float diode(const Coeffs& c, float in) noexcept {
        const float g = 0.5f * c.G, x = in * c.comp;
        float s[4];
        for (int i = 0; i < 4; ++i) s[i] = p_[(size_t)i].offset(c.G);
        const float G4 = g, S4 = s[3];
        const float d3 = 1.0f - g * G4, G3 = g / d3, S3 = (g * S4 + s[2]) / d3;
        const float d2 = 1.0f - g * G3, G2 = g / d2, S2 = (g * S3 + s[1]) / d2;
        const float d1 = 1.0f - 2.0f * g * G2, G1 = 2.0f * g / d1, S1 = (2.0f * g * S2 + s[0]) / d1;
        const float Gt = G4 * G3 * G2 * G1;
        const float St = G4 * G3 * G2 * S1 + G4 * G3 * S2 + G4 * S3 + S4;
        // Analog: a coupling high-pass in the feedback, hg·(y4 − z), so the bass keeps less resonance.
        const float hg = c.couplingHp ? 1.0f - c.Gh : 1.0f, hz = c.couplingHp ? hp_.z : 0.0f;
        const float kf = c.k * hg, St0 = St - hz;
        float u;
        if (c.loopSat > 0.0f) {
            // The loop saturator: tanh (Diode Tanh), turning asymmetric with Drive like a diode's bend.
            const double a = c.loopSat, b = c.bias;
            const auto f = [a, b](double v) { return asym(a * v, b) / a; };
            const auto df = [a, b](double v) { return asymD(a * v, b); };
            u = (float)f(solveFeedback(kf * Gt, x - kf * St0, (x - kf * St0) / (1.0f + kf * Gt), f, df, asymBound(b) / a));
        } else {
            u = (x - kf * St0) / (1.0f + kf * Gt);
        }
        // The coupled stages are solved as one linear block; Drive saturates their input u (in the loop) instead,
        // where the ladder's input pair sits.
        const float y1 = G1 * u + S1, y2 = G2 * y1 + S2, y3 = G3 * y2 + S3, y4 = G4 * y3 + S4;
        p_[0].commit(y1);
        p_[1].commit(y2);
        p_[2].commit(y3);
        p_[3].commit(y4);
        if (c.couplingHp) hp_.tick(y4, c.Gh);
        return y4;
    }

    /// §6.1: dry + four 1-pole allpasses, with zero-delay feedback around
    /// the allpass chain (Fig. 6.4).
    float phaser1(const Coeffs& c, float x) noexcept {
        const float a = 2.0f * c.G - 1.0f;  // allpass = 2·LP − in
        float A = 1.0f, B = 0.0f;
        for (auto& p : p_) {
            B = a * B + 2.0f * p.offset(c.G);
            A *= a;
        }
        const float u = loop(c, (x + c.k * B) / (1.0f - c.k * A));
        float ap = u;
        for (auto& p : p_) ap = 2.0f * p.tick(ap, c.G) - ap;
        return 0.5f * (u + c.invert * ap);
    }

    /// §6.1 notch spacing: two 2-pole SVF allpasses; Mode sets their damping.
    float phaser2(const Coeffs& c, float x) noexcept {
        const float g = c.g, r2 = 2.0f * c.R, D = 1.0f + r2 * g + g * g;
        // Instantaneous response of each allpass: x − 4R·bp = a·x + b.
        const float a = 1.0f - 2.0f * r2 * g / D;
        const float b1 = -2.0f * r2 * (s1_ - g * ((r2 + g) * s1_ + s2_) / D);
        const float b2 = -2.0f * r2 * (t1_ - g * ((r2 + g) * t1_ + t2_) / D);
        const float A = a * a, B = a * b1 + b2;
        const float u = loop(c, (x + c.k * B) / (1.0f - c.k * A));
        auto allpass = [&](float in, float& z1, float& z2) {
            const float hp = (in - (r2 + g) * z1 - z2) / D;
            const float v1 = g * hp, bp = v1 + z1;
            z1 = bp + v1;
            const float v2 = g * bp;
            z2 = v2 + z2 + v2;
            return in - 2.0f * r2 * bp;
        };
        const float ap = allpass(allpass(u, s1_, s2_), t1_, t2_);
        return 0.5f * (u + c.invert * ap);
    }

    /// The delay line read `delay` samples back (cubic, Hermite).
    float readDelay(float delay) const noexcept {
        const int size = (int)delay_.size();
        const float d = std::clamp(delay, 2.0f, (float)(size - 3));
        const int whole = (int)d;
        const float frac = d - (float)whole;
        // at(n): the sample written n + 1 samples before the current one.
        auto at = [&](int n) { return delay_[(size_t)((write_ - n + size) % size)]; };
        // Cubic (Hermite) interpolation between the delays whole and whole + 1.
        const float ym1 = at(whole - 2), y0 = at(whole - 1), y1 = at(whole), y2 = at(whole + 1);
        const float c1 = 0.5f * (y1 - ym1), c2 = ym1 - 2.5f * y0 + 2.0f * y1 - 0.5f * y2;
        const float c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
        return ((c3 * frac + c2) * frac + c1) * frac + y0;
    }
    void writeDelay(float v) noexcept {
        write_ = (write_ + 1) % (int)delay_.size();
        delay_[(size_t)write_] = v;
    }

    /// §6.2: the allpass chain replaced by a delay of 1/cutoff.
    float flanger(const Coeffs& c, float x) noexcept {
        const float wet = readDelay(c.delay);
        const float u = loop(c, x + c.k * wet);
        writeDelay(u);
        return 0.5f * (u + c.invert * wet);
    }

    /// Tuned comb: a delay of one period (half a period for the negative
    /// feedback, which makes the peaks fall on the odd harmonics) with a
    /// damping low-pass in the loop. Normalised to unity gain at the peaks.
    float comb(const Coeffs& c, float x) noexcept {
        const float fed = hp_.tick(readDelay(c.delay), c.damp);
        // The loop saturates around the level a unit input builds up (1 / norm).
        const float y = c.loopSat > 0.0f ? (float)(std::tanh(c.loopSat * c.norm * (x + c.k * fed)) / (c.loopSat * c.norm))
                                         : x + c.k * fed;
        writeDelay(y);
        return y * c.norm;
    }

    /// The phasers' and the flanger's loop saturator (with Drive): the
    /// summing point before the allpasses or the delay, cheap method.
    static float loop(const Coeffs& c, float u) noexcept {
        return c.loopSat > 0.0f ? (float)(std::tanh((double)c.loopSat * u) / c.loopSat) : u;
    }

    /// The wall: a hard-knee clipper, linear below about 0.6 of kWall,
    /// bounded by kWall. f'(t) = (1 + |t|^4)^(-5/4) on the unit curve.
    /// The amplifier's limit: the hard-knee wall (Sallen-Key) or a diode
    /// clipper (Diode-Feedback, soft: level·tanh(v/level)). With Drive it turns
    /// asymmetric: the negative side limits at level / (1 + b).
    struct Wall {
        double level = kWall, b = 0.0;
        bool soft = false;
    };
    static Wall wallOf(const Coeffs& c) noexcept { return {(double)c.wallLevel, (double)c.bias, c.softWall}; }
    static double wall(double v, const Wall& w) noexcept {
        const double s = v < 0.0 ? 1.0 + w.b : 1.0, u = v * s;
        if (w.soft) return w.level * std::tanh(u / w.level) / s;
        const double t = u / w.level, t2 = t * t;
        return u / std::pow(1.0 + t2 * t2, 0.25) / s;
    }
    static double wallD(double v, const Wall& w) noexcept {
        const double t = (v < 0.0 ? v * (1.0 + w.b) : v) / w.level;
        if (w.soft) return tanhD(t);
        const double t2 = t * t;
        return std::pow(1.0 + t2 * t2, -1.25);
    }
    /// Solves F(v) = a·v − rhs − m·wall(arg(v)) = 0 for increasing F, v in [lo, hi].
    template <typename Arg, typename DArg>
    static float solveWall(double lo, double hi, double a, double rhs, double m, Arg arg, DArg darg, double guess,
                           const Wall& w) noexcept {
        double v = std::clamp(guess, lo, hi);
        for (int i = 0; i < 12; ++i) {
            const double r = a * v - rhs - m * wall(arg(v), w);
            if (std::fabs(r) < 1e-7) break;
            if (r > 0.0) hi = v; else lo = v;
            double next = v - r / (a - m * wallD(arg(v), w) * darg);
            if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
            v = next;
        }
        return (float)v;
    }

    /// Sallen-Key low-pass: R-R-C-C with the second capacitor fed back from the
    /// amplifier output y = wall(K·u). Capacitor voltage c = v − y integrates
    /// x − 2v + u (v: the junction, u: the buffer input, a 1-pole of v):
    ///   H = K / (s² + (3 − K)·s + 1)      (divided by K at the output)
    /// The zero-delay equation a·v = rhs + y(v) is solved with a bracketed Newton.
    float sallenKeyLp(const Coeffs& c, float x) noexcept {
        const double g = c.g, G = c.G, K = c.amp;
        const double Su = p_[0].offset(c.G);
        const double a = 1.0 + 2.0 * g - g * G, rhs = skState_ + g * x + g * Su;
        const double guess = (rhs + K * Su) / (a - K * G);
        const Wall w = wallOf(c);
        const float v = solveWall((rhs - w.level) / a, (rhs + w.level) / a, a, rhs, 1.0,
                                  [&](double vv) { return K * (G * vv + Su); }, K * G, std::clamp(guess, -1e3, 1e3), w);
        const double u = G * v + Su, y = wall(K * u, w);
        const double in = x - 2.0 * v + u;
        const double cap = skState_ + g * in;
        skState_ = (float)(cap + g * in);
        p_[0].commit((float)u);
        return (float)(y / K);
    }

    /// Sallen-Key high-pass: C-C-R-R, the dual of the above.
    ///   H = K·s² / (s² + (3 − K)·s + 1)
    float sallenKeyHp(const Coeffs& c, float x) noexcept {
        const double g = c.g, G = c.G, K = c.amp;
        const double S2 = p_[0].offset(c.G);
        const double a = 1.0 + G + g, rhs = x - S2 - skState_;
        // F(v) = a·v − rhs − g·wall(K·((1 − G)·v − S2)): the 'm' is g.
        const double guess = (rhs - g * K * S2) / (a - g * K * (1.0 - G));
        const Wall w = wallOf(c);
        const float v = solveWall((rhs - g * w.level) / a, (rhs + g * w.level) / a, a, rhs, g,
                                  [&](double vv) { return K * ((1.0 - G) * vv - S2); }, K * (1.0 - G),
                                  std::clamp(guess, -1e3, 1e3), w);
        const double c2 = G * v + S2, u = v - c2, y = wall(K * u, w);
        skState_ = (float)(skState_ + 2.0 * g * (v - y));
        p_[0].commit((float)c2);
        return (float)(y / K);
    }

    /// The circuit SVFs: the TPT state-variable filter (§5.2) solved linearly
    /// for the high-pass, then each integrator integrates through its circuit
    /// (cheap method):
    ///   Op-Amp Slew  the step is slew-limited, the state clips at the rails
    ///   Diode Pair   the input goes through a diode pair (tanh)
    ///   CMOS         an inverter (asymmetric, early) in, a soft rail on the state
    Lbh svfShaped(const Coeffs& c, float x) noexcept {
        const float g = c.g, r2 = 2.0f * c.R;
        const float hp = (x - (r2 + g) * s1_ - s2_) / (1.0f + r2 * g + g * g);
        float bp, lp;
        if (c.type == FilterType::SlewSvf) {
            const float v1 = std::clamp(g * hp, -c.slew, c.slew);
            bp = v1 + s1_;
            s1_ = rails(bp + v1, -kOpAmpRail, kOpAmpRail);
            const float v2 = std::clamp(g * bp, -c.slew, c.slew);
            lp = v2 + s2_;
            s2_ = rails(lp + v2, -kOpAmpRail, kOpAmpRail);
        } else if (c.type == FilterType::DiodePair) {
            const float v1 = g * (float)asym(hp, 0.05);
            bp = v1 + s1_;
            s1_ = rails(bp + v1, -kOpAmpRail, kOpAmpRail);
            const float v2 = g * (float)asym(bp, 0.05);
            lp = v2 + s2_;
            s2_ = rails(lp + v2, -kOpAmpRail, kOpAmpRail);
        } else {  // CMOS inverters: an asymmetric gain stage in, lopsided rails on the state
            const auto inv = [](float v) { return (float)(asym(1.5 * v, 0.3) / 1.5); };
            const float v1 = g * inv(hp);
            bp = v1 + s1_;
            s1_ = rails(bp + v1, -1.0f, 1.4f);
            const float v2 = g * inv(bp);
            lp = v2 + s2_;
            s2_ = rails(lp + v2, -1.0f, 1.4f);
        }
        return {lp, bp, hp};
    }

    /// Four parallel unit-gain band-passes at the formants.
    float vowel(const Coeffs& c, float x) noexcept {
        float sum = 0.0f;
        for (size_t n = 0; n < (size_t)kFormants; ++n) {
            const auto& f = c.formant[n];
            const float r2 = 2.0f * f.R, g = f.g;
            const float hp = (x - (r2 + g) * vs1_[n] - vs2_[n]) / (1.0f + r2 * g + g * g);
            const float v1 = g * hp, bp = v1 + vs1_[n];
            vs1_[n] = bp + v1;
            const float v2 = g * bp;
            vs2_[n] += 2.0f * v2;
            sum += f.amp * r2 * bp;
        }
        return sum;
    }

    /// §3.11: the bilinear transform of the SVF morph in direct form I.
    /// Fine for static settings; fast modulation is where TPT wins.
    float biquad(const Coeffs& c, float x) noexcept {
        const auto w = morphWeights(c.morph);
        const float b2 = w[2] + w[3], b1 = w[1], b0 = w[0] + w[3];  // numerator of H(s)
        const float g = c.g, gg = g * g, r2g = 2.0f * c.R * g;
        const float n0 = b2 + b1 * g + b0 * gg, n1 = 2.0f * (b0 * gg - b2), n2 = b2 - b1 * g + b0 * gg;
        const float d0 = 1.0f + r2g + gg, d1 = 2.0f * (gg - 1.0f), d2 = 1.0f - r2g + gg;
        // Time-varying direct forms can run away (§3.11); a safety limit keeps them bounded.
        const float y = std::clamp((n0 * x + n1 * x1_ + n2 * x2_ - d1 * y1_ - d2 * y2_) / d0, -16.0f, 16.0f);
        x2_ = x1_;
        x1_ = x;
        y2_ = y1_;
        y1_ = y;
        return y;
    }

    std::array<OnePole, 4> p_{};
    std::array<OnePole, kMaxStages> stair_{};
    std::array<float, kFormants> vs1_{}, vs2_{};  // formant SVFs
    float skState_ = 0.0f;                       // Sallen-Key integrator
    OnePole hp_{};
    float s1_ = 0.0f, s2_ = 0.0f, t1_ = 0.0f, t2_ = 0.0f;  // SVF integrators (second SVF: t)
    float x1_ = 0.0f, x2_ = 0.0f, y1_ = 0.0f, y2_ = 0.0f;  // direct form I
    float naive_ = 0.0f;
    std::vector<float> delay_;
    int write_ = 0;
    dsp::RoughSvf rough_;
    float roughHz_ = -1.0f, roughQ_ = -1.0f;
    std::array<float, 4> tol_{};  ///< component spread per ladder stage, −1 … 1
    double lastW_ = 0.0, prevW_ = 0.0;  ///< the ladder's last two feedback points (warm start)
    double lastX_ = 0.0, prevX_ = 0.0;  ///< and its last two inputs
    double lastLoop_ = 0.0;             ///< the loop's gain dy4/dw at the last solution
    std::array<double, 4> lastY_{};   ///< each ladder stage's last output (warm start)
    std::array<double, 5> lastT_{};   ///< light path: tanh(a·v + b) of the stages' last inputs and the last output
    uint32_t rng_ = 0x9e3779b9u;  ///< noise floor (xorshift)
    /// White noise, −1 … 1.
    float noise() noexcept {
        rng_ ^= rng_ << 13;
        rng_ ^= rng_ >> 17;
        rng_ ^= rng_ << 5;
        return (float)rng_ * (2.0f / 4294967295.0f) - 1.0f;
    }
};

}  // namespace bleep::patch::va
