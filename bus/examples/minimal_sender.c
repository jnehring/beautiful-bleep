/* SPDX-License-Identifier: MIT */
/*
 * minimal_sender — publishes a 0.5 Hz sine LFO on output "LFO".
 *
 *   ./minimal_sender            (Ctrl-C to stop)
 *
 * Run minimal_receiver in a second terminal to see the values arrive.
 */
#include "bleep_bus.h"
#include "common/example_clock.h"

#include <math.h>
#include <stdio.h>

int main(void) {
    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, NULL, &err);
    if (!bus) {
        fprintf(stderr, "bb_bus_open: %s\n", bb_error_string(err));
        return 1;
    }

    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.display_name = "Example LFO";
    info.product = "minimal-sender";
    info.vendor = "Bleep Bus examples";
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    bb_output* lfo = ep ? bb_add_output(ep, "LFO", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) : NULL;
    if (!lfo) {
        fprintf(stderr, "register: %s\n", bb_error_string(err));
        return 1;
    }
    printf("sending on %016llx/LFO, Ctrl-C to stop\n", (unsigned long long)bb_endpoint_uid(ep));

    example_install_signal_handler();
    float buf[EXAMPLE_BLOCK];
    double phase = 0.0;
    for (uint64_t block = 0; example_running; ++block) {
        bb_block_info b = example_block(block);
        for (uint32_t i = 0; i < b.num_samples; ++i) {
            buf[i] = (float)sin(2.0 * 3.14159265358979 * phase);
            phase += 0.5 / b.sample_rate;
            if (phase >= 1.0) phase -= 1.0;
        }
        bb_begin_block(ep, &b);
        bb_write_output(lfo, buf, b.num_samples);
        bb_end_block(ep);
        example_wait_block();
    }

    bb_unregister_instance(ep);
    bb_bus_close(bus);
    return 0;
}
