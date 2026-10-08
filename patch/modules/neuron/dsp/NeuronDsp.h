// SPDX-License-Identifier: MIT
// Neuron (specs/modules/neuron.md): two leaky integrate-and-fire neurons
// (dsp::LifNeuron). Each sums three weighted inputs; In 1 unpatched is +1 (a
// bias), In 3 unpatched hears the other neuron's Out or Gate from the previous
// sample. Logic outputs combine the gates. No randomness: the same inputs give
// the same outputs, sample for sample.
#pragma once

#include "dsp/Chaos.h"
#include "dsp/Smoothing.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bleep::patch {

enum class NeuronCross { Out, Gate, Off };

struct NeuronUnitParams {
    std::array<float, 3> weight{1.0f, 1.0f, 0.0f};
    dsp::NeuronParams cell;  ///< leak, threshold, hysteresis, pulse, spike
    float sharp = 4.0f;
};

struct NeuronParams {
    std::array<NeuronUnitParams, 2> unit;
    NeuronCross cross = NeuronCross::Out;
};

/// One sample of input: three jacks per neuron and whether each is patched.
struct NeuronInputs {
    std::array<std::array<float, 3>, 2> in{};
    std::array<std::array<bool, 3>, 2> patched{};
    float reset = 0.0f;
};

struct NeuronFrame {
    std::array<float, 2> gate{}, out{}, spike{}, membrane{};
    float logicAnd = 0.0f, logicOr = 0.0f, logicXor = 0.0f, diff = 0.0f;
};

class NeuronDsp {
public:
    /// neuron.md 4.3. Compare: clamp(Sharp · (m − Threshold), 0, 1) with a soft
    /// top. Spike: the same ramp moved down by 1 / Sharp so it ends at the
    /// threshold: Out shows the membrane charging and drops at each spike.
    static float outCurve(float membrane, float threshold, float sharp, bool spike) noexcept {
        sharp = std::max(sharp, 1.0f);
        return dsp::neuronOut(membrane, spike ? threshold - 1.0f / sharp : threshold, sharp);
    }

    void prepare(double sampleRate) noexcept {
        for (auto& n : cell_) n.prepare(sampleRate);
        reset();
    }

    /// Clears both membranes, gates and the cross normals.
    void reset() noexcept {
        for (auto& n : cell_) n.reset();
        cross_ = {0.0f, 0.0f};
        resetEdge_.reset();
    }

    void tick(const NeuronParams& p, const NeuronInputs& in, NeuronFrame& f) noexcept {
        if (resetEdge_.process(in.reset) > 0) {
            for (auto& n : cell_) n.reset();
            cross_ = {0.0f, 0.0f};
        }
        std::array<float, 2> next{};
        for (int u = 0; u < 2; ++u) {
            const NeuronUnitParams& up = p.unit[(size_t)u];
            const auto& x = in.in[(size_t)u];
            const auto& patched = in.patched[(size_t)u];
            const float in1 = patched[0] ? x[0] : 1.0f;
            const float in2 = patched[1] ? x[1] : 0.0f;
            const float in3 = patched[2] ? x[2] : cross_[(size_t)(1 - u)];  // the other neuron, one sample ago
            float sum = up.weight[0] * in1 + up.weight[1] * in2 + up.weight[2] * in3;
            if (!std::isfinite(sum)) sum = 0.0f;
            sum = std::clamp(sum, -100.0f, 100.0f);
            const dsp::NeuronFrame n = cell_[(size_t)u].tick(sum, up.cell);
            const float out = outCurve(n.membrane, up.cell.threshold, up.sharp, up.cell.spike);
            f.gate[(size_t)u] = n.gate ? 1.0f : 0.0f;
            f.out[(size_t)u] = out;
            f.spike[(size_t)u] = n.spike ? 1.0f : 0.0f;
            f.membrane[(size_t)u] = n.membrane;
            next[(size_t)u] = p.cross == NeuronCross::Out ? out : p.cross == NeuronCross::Gate ? f.gate[(size_t)u] : 0.0f;
        }
        cross_ = next;
        const bool a = f.gate[0] > 0.5f, b = f.gate[1] > 0.5f;
        f.logicAnd = a && b ? 1.0f : 0.0f;
        f.logicOr = a || b ? 1.0f : 0.0f;
        f.logicXor = a != b ? 1.0f : 0.0f;
        f.diff = f.out[0] - f.out[1];
    }

    float membrane(int u) const noexcept { return cell_[(size_t)u].membrane(); }
    bool gate(int u) const noexcept { return cell_[(size_t)u].gate(); }

private:
    std::array<dsp::LifNeuron, 2> cell_;
    std::array<float, 2> cross_{};
    dsp::GateEdge resetEdge_;
};

}  // namespace bleep::patch
