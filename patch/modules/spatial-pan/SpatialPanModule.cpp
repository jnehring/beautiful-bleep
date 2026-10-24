// SPDX-License-Identifier: GPL-3.0-only
// Spatial Pan node (doc/specs/modules/spatial-pan.md): a binaural panner from synthesised cues.
#include "Registry.h"
#include "SpatialDsp.h"

namespace bleep::engine {
namespace {

using patch::SpatialDsp;
using patch::SpatialParams;

class SpatialPanModule final : public Module {
public:
    enum { Azimuth, Distance, Elevation, Orbit, Doppler, Room, Size, Air, Head, Level };
    enum { InL, InR };
    enum { OutL, OutR, Side };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        orbit_ = 0.0;
    }
    void reset() override {
        dsp_.reset();
        orbit_ = 0.0;
    }

    void process(const ProcessContext& c) override {
        SpatialParams p;
        const bool r = c.inputConnected[InR], l = c.inputConnected[InL];
        for (int i = 0; i < c.numSamples; ++i) {
            const float in = l && r ? 0.5f * (c.inputs[InL][i] + c.inputs[InR][i]) : r ? c.inputs[InR][i] : c.inputs[InL][i];
            orbit_ += (double)value(c, Orbit, i) / sampleRate_;
            orbit_ -= std::floor(orbit_);
            float az = value(c, Azimuth, i) + (float)(orbit_ * 360.0);
            az -= 360.0f * std::floor((az + 180.0f) / 360.0f);  // wrap to ±180
            p.azimuth = az;
            p.elevation = value(c, Elevation, i);
            p.distance = 0.25f * std::pow(100.0f, value(c, Distance, i));
            p.doppler = value(c, Doppler, i);
            p.room = value(c, Room, i);
            p.size = value(c, Size, i);
            p.air = value(c, Air, i);
            p.headCm = value(c, Head, i);
            const auto f = dsp_.tick(in, p);
            const float level = value(c, Level, i) * 2.0f;  // 50 % is unity
            c.outputs[OutL][i] = f.l * level;
            c.outputs[OutR][i] = f.r * level;
            c.outputs[Side][i] = f.side;
        }
    }

private:
    SpatialDsp dsp_;
    double orbit_ = 0.0;
};

}  // namespace

static void registerSpatialPanModule(Registry& r) {
    ModuleSpec s;
    s.type = "spatial-pan";
    s.name = "Spatial Pan";
    s.category = "Audio/Mixing";
    s.colour = "#2dd4bf";
    s.description = "A binaural panner built from synthesised cues: azimuth, distance and elevation with interaural time and level "
                    "differences, head shadow, pinna notch, early reflections and Doppler.";
    s.memoryHeavy = false;
    s.params = {ParamSpec::number("azimuth", "Azimuth", -180.0f, 180.0f, 0.0f, "°", 0),
                ParamSpec::percent("distance", "Distance", 0.0f, 1.0f, 0.35f),
                ParamSpec::number("elevation", "Elevation", -90.0f, 90.0f, 0.0f, "°", 0),
                ParamSpec::number("orbit", "Orbit", -2.0f, 2.0f, 0.0f, "turns/s", 2),
                ParamSpec::percent("doppler", "Doppler", 0.0f, 1.0f, 1.0f),
                ParamSpec::percent("room", "Room", 0.0f, 1.0f, 0.3f),
                ParamSpec::percent("size", "Size", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("air", "Air", 0.0f, 1.0f, 0.5f),
                ParamSpec::number("head", "Head", 7.0f, 11.0f, 8.75f, "cm", 2),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.5f)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}, {"side", "Side", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SpatialPanModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSpatialPanModule);

}  // namespace bleep::engine
