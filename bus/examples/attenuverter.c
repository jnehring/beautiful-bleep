/* SPDX-License-Identifier: MIT */
/*
 * attenuverter — the smallest useful module: Out = In × Gain + Offset.
 *
 *   ./attenuverter [gain] [offset]       e.g. ./attenuverter -0.5 0.25
 *
 * It registers input "In" and output "Out". Patch something into "In"
 * (minimal_receiver shows how to call bb_connect) and read "Out" elsewhere.
 */
#include "bleep_bus.h"
#include "common/example_clock.h"

#include <stdio.h>
#include <stdlib.h>

int main(int argc, char** argv) {
    const float gain = argc > 1 ? (float)atof(argv[1]) : -1.0f;
    const float offset = argc > 2 ? (float)atof(argv[2]) : 0.0f;

    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, NULL, &err);
    if (!bus) {
        fprintf(stderr, "bb_bus_open: %s\n", bb_error_string(err));
        return 1;
    }
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.display_name = "Example Attenuverter";
    info.product = "attenuverter";
    info.vendor = "Bleep Bus examples";
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    bb_input* in = ep ? bb_add_input(ep, "In", BB_SIGNAL_CONTROL, &err) : NULL;
    bb_output* out = in ? bb_add_output(ep, "Out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) : NULL;
    if (!out) {
        fprintf(stderr, "register: %s\n", bb_error_string(err));
        return 1;
    }
    printf("attenuverter %016llx: Out = In x %.3f %+.3f\n", (unsigned long long)bb_endpoint_uid(ep), gain, offset);

    example_install_signal_handler();
    float buf[EXAMPLE_BLOCK];
    for (uint64_t block = 0; example_running; ++block) {
        bb_block_info b = example_block(block);
        bb_begin_block(ep, &b);
        bb_read_input(in, buf, b.num_samples);
        for (uint32_t i = 0; i < b.num_samples; ++i) buf[i] = buf[i] * gain + offset;
        bb_write_output(out, buf, b.num_samples);
        bb_end_block(ep);
        example_wait_block();
    }

    bb_unregister_instance(ep);
    bb_bus_close(bus);
    return 0;
}
