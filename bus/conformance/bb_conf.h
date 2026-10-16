/* SPDX-License-Identifier: MIT */
/*
 * bb_conf.h — what the conformance host's files share: the TAP harness, the
 * helpers the checks are written with, raw segment access, and every check.
 */
#pragma once

#if !defined(_WIN32) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include "bleep_bus.h"
#include "bleep_bus_layout.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#define BB_HAVE_POSIX 0
#else
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <spawn.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#define BB_HAVE_POSIX 1
extern char** environ;
#endif

/* ========================================================================
 * Mini TAP harness (harness.c)
 * ===================================================================== */

extern int g_test_number;
extern int g_failures;
extern int g_current_failed;
extern char g_ns[BB_NAMESPACE_BYTES];
extern const char* g_self;

#define CHECK(cond)                                                                    \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            printf("#   %s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #cond);        \
            g_current_failed = 1;                                                      \
        }                                                                              \
    } while (0)

#define CHECK_EQ_INT(a, b)                                                             \
    do {                                                                               \
        long long va_ = (long long)(a), vb_ = (long long)(b);                          \
        if (va_ != vb_) {                                                              \
            printf("#   %s:%d: %s == %lld, expected %s == %lld\n", __FILE__, __LINE__, \
                   #a, va_, #b, vb_);                                                  \
            g_current_failed = 1;                                                      \
        }                                                                              \
    } while (0)

#define CHECK_NEAR(a, b, tol)                                                          \
    do {                                                                               \
        double va_ = (double)(a), vb_ = (double)(b);                                   \
        if (fabs(va_ - vb_) > (tol)) {                                                 \
            printf("#   %s:%d: %s == %g, expected %g\n", __FILE__, __LINE__, #a, va_,  \
                   vb_);                                                               \
            g_current_failed = 1;                                                      \
        }                                                                              \
    } while (0)

typedef void (*check_fn)(void);

void run_check(const char* name, check_fn fn);
void skip_check(const char* name, const char* reason);

/* ========================================================================
 * Helpers (harness.c)
 * ===================================================================== */

bb_bus* open_bus(void);
bb_endpoint* make_endpoint(bb_bus* bus, const char* name, uint64_t uid);
void fill(float* buf, uint32_t n, float v);
void write_block(bb_endpoint* ep, bb_output* out, int64_t pos, uint32_t n, int playing, uint64_t t_ns, float value);
float read_block(bb_endpoint* ep, bb_input* in, int64_t pos, uint32_t n, int playing, uint64_t t_ns,
                 uint32_t* present, float* last);
uint32_t next_rand(void);
void sleep_ms(unsigned ms);

/* A writer and a reader on one bus, patched out -> in. */
typedef struct pair {
    bb_bus* bus;
    bb_endpoint* writer;
    bb_endpoint* reader;
    bb_output* out;
    bb_input* in;
} pair;

int make_pair(pair* p, float amount);
void free_pair(pair* p);

/* Raw segment access (validator, version tests) */

typedef struct raw_map {
    void* base;
    size_t size;
#if defined(_WIN32)
    HANDLE mapping;
#else
    int fd;
#endif
} raw_map;

void segment_name(const char* ns, char* dst, size_t cap);
int raw_open(const char* ns, size_t create_size, raw_map* m);
void raw_close(raw_map* m);

/* ========================================================================
 * Checks (checks_*.c), run in order by bb_conformance.c
 * ===================================================================== */

/* checks_layout.c */
void check_layout_sizes(void);
void check_segment_header(void);
void check_open_arguments(void);
void check_segment_version_mismatch(void);

/* checks_registry.c */
void check_registry(void);
void check_uid_collisions(void);

/* checks_timing.c */
void check_latency_playing(void);
void check_latency_offline(void);
void check_latency_loop(void);
void check_latency_stopped(void);

/* checks_signals.c */
void check_summing_and_amounts(void);
void check_ghost_sources(void);
void check_block_edge_cases(void);
void check_persistence(void);
void check_cross_handle_patching(void);

/* checks_hostile.c */
void check_hostile_values(void);
void check_hostile_offsets_after_open(void);
void check_hostile_endpoint_index(void);
void check_output_ownership(void);
void check_seq_odd_recovery(void);

#if BB_HAVE_POSIX
/* checks_timing.c */
void check_latency_threads(void);

/* checks_process.c */
void check_init_crash_recovery(void);
void check_reap_dead_process(void);
void check_lock_recovery(void);
void check_cross_process(void);
#endif

/* ========================================================================
 * Modes (modes.c)
 * ===================================================================== */

int mode_peer_send(const char* ns, uint64_t uid, int seconds);
int mode_inspect(const char* ns);
