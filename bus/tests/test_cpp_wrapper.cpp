// SPDX-License-Identifier: MIT
// Smoke test for the header-only C++ wrapper (behaviour is covered by the
// conformance suite; this checks that the wrapper compiles and round-trips).
#include "bleep_bus.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>

#define EXPECT(cond)                                                       \
    do {                                                                   \
        if (!(cond)) {                                                     \
            std::printf("FAILED %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
            return 1;                                                      \
        }                                                                  \
    } while (0)

int main() {
    const std::string ns = "cppwrap-" + std::to_string(std::rand() % 100000);
    bb_bus_unlink(ns.c_str());
    {
        bleep::Bus bus(ns.c_str());
        EXPECT(bus.ok());
        bleep::Endpoint lfo(bus, "LFO", "test", "Bleep Bus");
        bleep::Endpoint filter(bus, "Filter", "test", "Bleep Bus");
        EXPECT(lfo.ok() && filter.ok());
        bleep::Output out = lfo.addOutput("A");
        bleep::Input in = filter.addInput("Cutoff");
        EXPECT(out.valid() && in.valid());
        EXPECT(bus.connect(filter.uid(), "Cutoff", lfo.uid(), "A", 0.5f) == BB_OK);
        EXPECT(bus.endpoints().size() == 2);
        EXPECT(bus.outputs().size() == 1);
        EXPECT(bus.connections(filter.uid(), "Cutoff").size() == 1);

        float buf[64];
        for (int block = 0; block < 2; ++block) {
            bb_block_info info = BB_BLOCK_INFO_INIT;
            info.num_samples = 64;
            info.sample_rate = 48000.0;
            info.transport_sample_pos = block * 64;
            info.flags = BB_BLOCK_PLAYING;
            for (float& f : buf) f = 0.8f;
            lfo.beginBlock(info);
            out.write(buf, 64);
            lfo.endBlock();
            filter.beginBlock(info);
            in.read(buf, 64);
            filter.endBlock();
        }
        EXPECT(buf[0] > 0.399f && buf[0] < 0.401f);
        EXPECT(bus.peek(lfo.uid(), "A").size() == 64);

        const std::string saved = filter.saveConnections();
        EXPECT(saved.find("Cutoff\t") != std::string::npos);
        EXPECT(bus.disconnectAll(filter.uid(), "Cutoff") == BB_OK);
        EXPECT(filter.loadConnections(saved) == BB_OK);
        EXPECT(bus.connections(filter.uid(), "Cutoff").size() == 1);
    }
    bb_bus_unlink(ns.c_str());
    std::printf("ok\n");
    return 0;
}
