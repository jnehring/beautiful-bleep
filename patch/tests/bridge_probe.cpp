// SPDX-License-Identifier: MIT
//
// A stand-in for Live's plugins, for trying the app and a browser by hand (not a ctest): connects to the running
// Bleep App as one or more port plugins, paced at real time like a host (one process is one host, so the
// plugins you want together go in one list).
//
//   bleep_bridge_probe <kinds> <app|web> [seconds=20]
//   kinds: audio-in, audio-out, midi-in, midi-out, comma separated, e.g. audio-in,audio-out,midi-in
//
//   audio-in    sends a 220 Hz sine (a pulse every second so levels move)
//   midi-in     sends a note every half second, with Live's beat position (120 BPM, playing)
//   audio-out   prints the level of what comes back
//   midi-out    prints the notes that come back, with the block and sample they land on
#include "BridgeClient.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using namespace bleep;

namespace {
constexpr int kBlock = 256;
constexpr double kRate = 48000.0;

struct Plugin {
    std::string what, name;
    uint32_t kind = 0;
    bridge::BridgeClient client;
    std::vector<float> in, retL, retR;
    std::vector<bridge::Midi> midiOut;
    double phase = 0.0, peak = 0.0;
};
}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::printf("usage: %s <audio-in,audio-out,midi-in,midi-out> <app|web> [seconds]\n", argv[0]);
        return 2;
    }
    std::setvbuf(stdout, nullptr, _IOLBF, 0);
    const bool web = std::string(argv[2]) == "web";
    const double seconds = argc > 3 ? std::atof(argv[3]) : 20.0;
    // PortKind values (the protocol's numbers): MidiIn 2, MidiOut 3, AudioIn 4, AudioOut 5.
    std::vector<std::unique_ptr<Plugin>> plugins;
    std::stringstream list(argv[1]);
    for (std::string what; std::getline(list, what, ',');) {
        auto p = std::make_unique<Plugin>();
        p->what = what;
        p->kind = what == "midi-in" ? 2 : what == "midi-out" ? 3 : what == "audio-in" ? 4 : 5;
        p->name = what == "audio-in" ? "Guitar" : what == "audio-out" ? "Web Synth" : what == "midi-in" ? "Keys" : "Web Sequencer";
        char id[64];
        std::snprintf(id, sizeof id, "00000000-0000-4000-8000-%012x", (unsigned)std::hash<std::string>{}(what) & 0xffffff);
        p->client.setIdentity(id, p->name);
        p->client.setPort(p->kind, web ? bridge::Board::Web : bridge::Board::App);
        p->client.prepare(kRate, kBlock);
        p->in.assign(kBlock, 0.0f);
        p->retL.assign(kBlock, 0.0f);
        p->retR.assign(kBlock, 0.0f);
        p->midiOut.assign(bridge::kMaxMidi, bridge::Midi{});
        plugins.push_back(std::move(p));
    }
    for (int i = 0; i < 50; ++i) {
        bool all = true;
        for (auto& p : plugins) all &= p->client.poll() == bridge::BridgeClient::Status::Connected;
        if (all) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    for (auto& p : plugins) {
        if (p->client.status() != bridge::BridgeClient::Status::Connected) {
            std::printf("%s not connected (status %d): is the app running?\n", p->what.c_str(), (int)p->client.status());
            return 1;
        }
        std::printf("connected as %s (%s, Board = %s)\n", p->name.c_str(), p->what.c_str(), web ? "Web" : "App");
    }

    const auto start = std::chrono::steady_clock::now();
    int64_t sample = 0, sentEdge = -1;
    bool returnLoud = false;
    int blocks = 0;
    for (auto next = start; std::chrono::duration<double>(next - start).count() < seconds; ++blocks) {
        next += std::chrono::microseconds((int64_t)(1e6 * kBlock / kRate));
        for (auto& p : plugins) {
            bridge::BridgeClient::Block b;
            b.numSamples = kBlock;
            b.transport.sampleRate = kRate;
            b.transport.bpm = 120.0;
            b.transport.playing = 1;
            b.transport.ppqValid = 1;
            b.transport.samplePos = sample;
            b.transport.ppq = (double)sample * 120.0 / (60.0 * kRate);
            const float* ins[2] = {p->in.data(), p->in.data()};
            float* rets[2] = {p->retL.data(), p->retR.data()};
            bridge::Midi note[2];
            if (p->what == "audio-in") {
                const bool loud = std::fmod((double)sample / kRate, 1.0) < 0.5;
                if (loud && (sample % (int64_t)kRate) < kBlock) sentEdge = sample - (sample % (int64_t)kRate);
                for (auto& s : p->in) {
                    s = loud ? 0.4f * (float)std::sin(p->phase) : 0.0f;
                    p->phase += 2.0 * M_PI * 220.0 / kRate;
                }
                b.in = ins;
            } else if (p->what == "midi-in") {
                const int64_t half = (int64_t)(kRate / 2);
                if ((sample % half) < kBlock) {
                    const bool on = (sample / half) % 2 == 0;
                    note[0].offset = (int)(sample % half);
                    note[0].bytes[0] = on ? 0x90 : 0x80;
                    note[0].bytes[1] = (uint8_t)(60 + (int)((sample / half / 2) % 5));
                    note[0].bytes[2] = 100;
                    note[0].size = 3;
                    b.midiIn = note;
                    b.numMidiIn = 1;
                }
            } else if (p->what == "audio-out") {
                b.ret = rets;
            } else {
                b.midiOut = p->midiOut.data();
            }
            p->client.poll();
            const bool got = p->client.exchange(b);
            if (p->what == "audio-out" && got) {
                double blockPeak = 0.0;
                for (float v : p->retL) blockPeak = std::max(blockPeak, (double)std::fabs(v));
                p->peak = std::max(p->peak, blockPeak);
                // The round trip of a pulse: from the block that carried its start to the block that brings it back.
                if (blockPeak > 0.1 && !returnLoud && sentEdge >= 0) {
                    const double ms = 1000.0 * (double)(sample - sentEdge) / kRate;
                    std::printf("pulse back after %.1f ms (the plugin's reported latency %.1f ms)\n", ms, 1000.0 * p->client.latencySamples() / kRate);
                }
                returnLoud = blockPeak > 0.1;
            }
            if (p->what == "midi-out")
                for (int i = 0; i < b.numMidiOut; ++i)
                    std::printf("note %d %d at block %d sample %d (beat %.3f)\n", p->midiOut[(size_t)i].bytes[0],
                                p->midiOut[(size_t)i].bytes[1], blocks, p->midiOut[(size_t)i].offset,
                                b.transport.ppq + p->midiOut[(size_t)i].offset * 120.0 / (60.0 * kRate));
            if (p->what == "audio-out" && blocks % 188 == 187) {
                std::printf("level %.3f, latency %d samples, late blocks %u\n", p->peak, p->client.latencySamples(), p->client.drops());
                p->peak = 0.0;
            }
        }
        sample += kBlock;
        std::this_thread::sleep_until(next);
    }
    return 0;
}
