/* SPDX-License-Identifier: MIT */
/* example_clock.h — a fake "host" for the command-line examples: runs blocks
 * in real time and stops cleanly on Ctrl-C. Not part of the SDK. */
#ifndef EXAMPLE_CLOCK_H
#define EXAMPLE_CLOCK_H

#include <signal.h>
#include <stdint.h>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
static void example_sleep_ms(unsigned ms) { Sleep(ms); }
#else
#include <time.h>
static void example_sleep_ms(unsigned ms) {
    struct timespec ts = {(time_t)(ms / 1000u), (long)(ms % 1000u) * 1000000L};
    nanosleep(&ts, 0);
}
#endif

#define EXAMPLE_SAMPLE_RATE 48000.0
#define EXAMPLE_BLOCK 256u

static volatile sig_atomic_t example_running = 1;
static void example_on_signal(int sig) {
    (void)sig;
    example_running = 0;
}
static void example_install_signal_handler(void) {
    signal(SIGINT, example_on_signal);
    signal(SIGTERM, example_on_signal);
}

/* Block info for block number `index` of a transport that is always playing. */
static bb_block_info example_block(uint64_t index) {
    bb_block_info b = BB_BLOCK_INFO_INIT;
    b.num_samples = EXAMPLE_BLOCK;
    b.sample_rate = EXAMPLE_SAMPLE_RATE;
    b.transport_sample_pos = (int64_t)(index * EXAMPLE_BLOCK);
    b.flags = BB_BLOCK_PLAYING;
    return b;
}

/* Sleeps for roughly one block (good enough for a demo, not for audio). */
static void example_wait_block(void) { example_sleep_ms((unsigned)(1000.0 * EXAMPLE_BLOCK / EXAMPLE_SAMPLE_RATE)); }

#endif
