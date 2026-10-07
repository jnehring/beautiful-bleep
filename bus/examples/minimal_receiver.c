/* SPDX-License-Identifier: MIT */
/*
 * minimal_receiver — finds the first output named "LFO" on the bus, patches
 * it into its input "In" and prints what arrives ten times per second.
 *
 *   ./minimal_receiver          (Ctrl-C to stop)
 */
#include "bleep_bus.h"
#include "common/example_clock.h"

#include <stdio.h>
#include <string.h>

int main(void) {
    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, NULL, &err);
    if (!bus) {
        fprintf(stderr, "bb_bus_open: %s\n", bb_error_string(err));
        return 1;
    }
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.display_name = "Example Receiver";
    info.product = "minimal-receiver";
    info.vendor = "Bleep Bus examples";
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    bb_input* in = ep ? bb_add_input(ep, "In", BB_SIGNAL_CONTROL, &err) : NULL;
    if (!in) {
        fprintf(stderr, "register: %s\n", bb_error_string(err));
        return 1;
    }

    /* Discovery: list all outputs and patch the first "LFO". */
    bb_output_info outs[BB_MAX_OUTPUTS];
    uint32_t n = bb_list_outputs(bus, outs, BB_MAX_OUTPUTS);
    int patched = 0;
    for (uint32_t i = 0; i < n && i < BB_MAX_OUTPUTS && !patched; ++i) {
        if (strcmp(outs[i].name, "LFO") != 0) continue;
        err = bb_connect(bus, bb_endpoint_uid(ep), "In", outs[i].endpoint_uid, "LFO", 1.0f);
        patched = err == BB_OK;
        printf("patched %s › LFO → In: %s\n", outs[i].endpoint_name, bb_error_string(err));
    }
    if (!patched) printf("no output named LFO yet; start minimal_sender and run me again\n");

    example_install_signal_handler();
    float buf[EXAMPLE_BLOCK];
    for (uint64_t block = 0; example_running; ++block) {
        bb_block_info b = example_block(block);
        bb_begin_block(ep, &b);
        uint32_t sources = bb_read_input(in, buf, b.num_samples);
        bb_end_block(ep);
        if (block % 19 == 0) printf("in = %+.3f  (%u source%s)\n", buf[0], sources, sources == 1 ? "" : "s");
        example_wait_block();
    }

    bb_unregister_instance(ep);
    bb_bus_close(bus);
    return 0;
}
