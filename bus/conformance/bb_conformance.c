/* SPDX-License-Identifier: MIT */
/*
 * bb_conformance — Bleep Bus conformance host and validator (spec v0.1).
 *
 * Usage:
 *   bb_conformance run [namespace]      Run every check against the linked
 *                                       implementation. TAP output; exit 1 on
 *                                       failure. Uses a private namespace.
 *   bb_conformance inspect [namespace]  Print and validate a live bus segment
 *                                       (e.g. while Live is running).
 *   bb_conformance peer-send <namespace> <uid> <seconds>
 *                                       Publish the constant 0.42 on output
 *                                       "peer" in real time. Used by `run` for
 *                                       the cross-process check, and by other
 *                                       implementations to test interop.
 *
 * The checks use only the public API (bleep_bus.h) plus the layout header
 * for byte-level validation, so this host can be linked against any
 * implementation of the C API.
 */
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
 * Mini TAP harness
 * ===================================================================== */

static int g_test_number = 0;
static int g_failures = 0;
static int g_current_failed = 0;
static char g_ns[BB_NAMESPACE_BYTES];
static const char* g_self = "bb_conformance";

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

static void run_check(const char* name, check_fn fn) {
    g_current_failed = 0;
    fn();
    ++g_test_number;
    if (g_current_failed) ++g_failures;
    printf("%s %d - %s\n", g_current_failed ? "not ok" : "ok", g_test_number, name);
    fflush(stdout);
}

static void skip_check(const char* name, const char* reason) {
    ++g_test_number;
    printf("ok %d - %s # SKIP %s\n", g_test_number, name, reason);
}

/* ========================================================================
 * Helpers
 * ===================================================================== */

static bb_bus* open_bus(void) {
    bb_error err = BB_OK;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, g_ns, &err);
    if (!bus) printf("#   bb_bus_open failed: %s\n", bb_error_string(err));
    return bus;
}

static bb_endpoint* make_endpoint(bb_bus* bus, const char* name, uint64_t uid) {
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    info.display_name = name;
    info.product = "conformance";
    info.vendor = "Bleep Bus";
    return bb_register_instance(bus, &info, NULL);
}

static void fill(float* buf, uint32_t n, float v) {
    for (uint32_t i = 0; i < n; ++i) buf[i] = v;
}

/* Runs one block on an endpoint that only writes `value` to `out`. */
static void write_block(bb_endpoint* ep, bb_output* out, int64_t pos, uint32_t n, int playing, uint64_t t_ns,
                        float value) {
    float buf[BB_MAX_BLOCK_SAMPLES];
    bb_block_info b = BB_BLOCK_INFO_INIT;
    b.transport_sample_pos = pos;
    b.num_samples = n;
    b.sample_rate = 48000.0;
    b.flags = playing ? BB_BLOCK_PLAYING : 0u;
    b.host_time_ns = t_ns;
    fill(buf, n, value);
    bb_begin_block(ep, &b);
    bb_write_output(out, buf, n);
    bb_end_block(ep);
}

/* Runs one block on a reading endpoint; returns the first sample read. */
static float read_block(bb_endpoint* ep, bb_input* in, int64_t pos, uint32_t n, int playing, uint64_t t_ns,
                        uint32_t* present, float* last) {
    float buf[BB_MAX_BLOCK_SAMPLES];
    bb_block_info b = BB_BLOCK_INFO_INIT;
    b.transport_sample_pos = pos;
    b.num_samples = n;
    b.sample_rate = 48000.0;
    b.flags = playing ? BB_BLOCK_PLAYING : 0u;
    b.host_time_ns = t_ns;
    bb_begin_block(ep, &b);
    uint32_t p = bb_read_input(in, buf, n);
    bb_end_block(ep);
    if (present) *present = p;
    if (last) *last = buf[n - 1];
    return buf[0];
}

/* Deterministic pseudo-random sequence for thread orders. */
static uint32_t g_rng = 0x12345678u;
static uint32_t next_rand(void) {
    g_rng ^= g_rng << 13;
    g_rng ^= g_rng >> 17;
    g_rng ^= g_rng << 5;
    return g_rng;
}

/* ------------------------------------------------------------------------
 * Raw segment access (validator, version tests)
 * --------------------------------------------------------------------- */

typedef struct raw_map {
    void* base;
    size_t size;
#if defined(_WIN32)
    HANDLE mapping;
#else
    int fd;
#endif
} raw_map;

static void segment_name(const char* ns, char* dst, size_t cap) {
#if defined(_WIN32)
    snprintf(dst, cap, "Local\\bleepbus-v%d-%s", BB_SPEC_VERSION_MAJOR, ns);
#else
    snprintf(dst, cap, "/bleepbus-v%d-%s", BB_SPEC_VERSION_MAJOR, ns);
#endif
}

/* Maps an existing segment, or creates one of `create_size` bytes. */
static int raw_open(const char* ns, size_t create_size, raw_map* m) {
    char name[64];
    segment_name(ns, name, sizeof(name));
    memset(m, 0, sizeof(*m));
#if defined(_WIN32)
    if (create_size)
        m->mapping = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, (DWORD)((uint64_t)create_size >> 32),
                                        (DWORD)(create_size & 0xffffffffu), name);
    else
        m->mapping = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, name);
    if (!m->mapping) return 0;
    m->base = MapViewOfFile(m->mapping, FILE_MAP_ALL_ACCESS, 0, 0, 0);
    if (!m->base) {
        CloseHandle(m->mapping);
        return 0;
    }
    MEMORY_BASIC_INFORMATION mbi;
    VirtualQuery(m->base, &mbi, sizeof(mbi));
    m->size = mbi.RegionSize;
    return 1;
#else
    m->fd = shm_open(name, O_RDWR | (create_size ? O_CREAT : 0), 0600);
    if (m->fd < 0) return 0;
    struct stat st;
    if (create_size) {
        if (ftruncate(m->fd, (off_t)create_size) != 0) { /* fine if it already had a size */
        }
    }
    if (fstat(m->fd, &st) != 0 || st.st_size == 0) {
        close(m->fd);
        return 0;
    }
    m->size = (size_t)st.st_size;
    m->base = mmap(NULL, m->size, PROT_READ | PROT_WRITE, MAP_SHARED, m->fd, 0);
    if (m->base == MAP_FAILED) {
        close(m->fd);
        return 0;
    }
    return 1;
#endif
}

static void raw_close(raw_map* m) {
#if defined(_WIN32)
    if (m->base) UnmapViewOfFile(m->base);
    if (m->mapping) CloseHandle(m->mapping);
#else
    if (m->base) munmap(m->base, m->size);
    if (m->fd >= 0) close(m->fd);
#endif
    memset(m, 0, sizeof(*m));
}

static void sleep_ms(unsigned ms) {
#if defined(_WIN32)
    Sleep(ms);
#else
    struct timespec ts = {(time_t)(ms / 1000u), (long)(ms % 1000u) * 1000000L};
    nanosleep(&ts, NULL);
#endif
}

/* ========================================================================
 * Checks
 * ===================================================================== */

static void check_layout_sizes(void) {
    CHECK_EQ_INT(sizeof(bb_shm_header), 256);
    CHECK_EQ_INT(sizeof(bb_shm_endpoint), 256);
    CHECK_EQ_INT(sizeof(bb_shm_connection), 64);
    CHECK_EQ_INT(sizeof(bb_shm_input), 576);
    CHECK_EQ_INT(sizeof(bb_shm_output_slot), 16448);
    CHECK_EQ_INT(sizeof(bb_shm_output), 65920);
    CHECK_EQ_INT(BB_LAYOUT_ENDPOINTS_OFFSET, 256);
    CHECK_EQ_INT(BB_LAYOUT_INPUTS_OFFSET, 16640);
    CHECK_EQ_INT(BB_LAYOUT_OUTPUTS_OFFSET, 311552);
    CHECK_EQ_INT(BB_LAYOUT_TOTAL_BYTES, 17187072);
    CHECK_EQ_INT(offsetof(bb_shm_header, init_state), 12);
    CHECK_EQ_INT(offsetof(bb_shm_header, registry_lock), 72);
    CHECK_EQ_INT(offsetof(bb_shm_output, blocks_written), 24);
    CHECK_EQ_INT(offsetof(bb_shm_output, slots), 128);
    CHECK_EQ_INT(offsetof(bb_shm_output_slot, samples), 64);
    CHECK_EQ_INT(offsetof(bb_shm_input, connections), 64);
}

static void check_segment_header(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (m.base) {
        const bb_shm_header* h = (const bb_shm_header*)m.base;
        CHECK(m.size >= BB_LAYOUT_TOTAL_BYTES);
        CHECK_EQ_INT(h->magic, BB_LAYOUT_MAGIC);
        CHECK_EQ_INT(h->spec_major, BB_SPEC_VERSION_MAJOR);
        CHECK_EQ_INT(h->spec_minor, BB_SPEC_VERSION_MINOR);
        CHECK_EQ_INT(h->init_state, BB_INIT_READY);
        CHECK_EQ_INT(h->total_bytes, BB_LAYOUT_TOTAL_BYTES);
        CHECK_EQ_INT(h->max_endpoints, BB_MAX_ENDPOINTS);
        CHECK_EQ_INT(h->max_outputs, BB_MAX_OUTPUTS);
        CHECK_EQ_INT(h->max_inputs, BB_MAX_INPUTS);
        CHECK_EQ_INT(h->max_block_samples, BB_MAX_BLOCK_SAMPLES);
        CHECK_EQ_INT(h->output_slots, BB_OUTPUT_SLOTS);
        CHECK_EQ_INT(h->endpoints_offset, BB_LAYOUT_ENDPOINTS_OFFSET);
        CHECK_EQ_INT(h->inputs_offset, BB_LAYOUT_INPUTS_OFFSET);
        CHECK_EQ_INT(h->outputs_offset, BB_LAYOUT_OUTPUTS_OFFSET);
        CHECK_EQ_INT(h->registry_lock, 0);
        raw_close(&m);
    }
    bb_bus_close(bus);
}

static void check_open_arguments(void) {
    bb_error err = BB_OK;
    CHECK(bb_bus_open(BB_MAKE_SPEC_VERSION(BB_SPEC_VERSION_MAJOR + 1, 0), g_ns, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_VERSION_MISMATCH);
    CHECK(bb_bus_open(BB_MAKE_SPEC_VERSION(0, 99), g_ns, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_VERSION_MISMATCH);
    CHECK(bb_bus_open(BB_SPEC_VERSION, "Not Valid!", &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_INVALID_ARGUMENT);
    CHECK(bb_bus_open(BB_SPEC_VERSION, "this-namespace-is-too-long", &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_INVALID_ARGUMENT);
    bb_bus* a = bb_bus_open(BB_SPEC_VERSION, g_ns, &err);
    bb_bus* b = bb_bus_open(BB_SPEC_VERSION, g_ns, &err);
    CHECK(a != NULL && b != NULL); /* several handles per process */
    bb_bus_close(a);
    bb_bus_close(b);
}

static void check_segment_version_mismatch(void) {
    char ns[BB_NAMESPACE_BYTES];
    snprintf(ns, sizeof(ns), "%s-v", g_ns);
    ns[BB_NAMESPACE_BYTES - 1] = '\0';
    bb_bus_unlink(ns);
    raw_map m;
    CHECK(raw_open(ns, (size_t)BB_LAYOUT_TOTAL_BYTES, &m));
    if (!m.base) return;
    bb_shm_header* h = (bb_shm_header*)m.base;
    memset(h, 0, sizeof(*h));
    h->magic = BB_LAYOUT_MAGIC;
    h->spec_major = BB_SPEC_VERSION_MAJOR;
    h->spec_minor = 99;
    h->total_bytes = BB_LAYOUT_TOTAL_BYTES;
    h->init_state = BB_INIT_READY;
    bb_error err = BB_OK;
    CHECK(bb_bus_open(BB_SPEC_VERSION, ns, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_VERSION_MISMATCH);

    h->magic = 0xdeadbeefu;
    CHECK(bb_bus_open(BB_SPEC_VERSION, ns, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_CORRUPT);
    raw_close(&m);
    bb_bus_unlink(ns);
}

static void check_registry(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    uint32_t gen0 = bb_registry_generation(bus);
    uint32_t ep_count0 = bb_list_endpoints(bus, NULL, 0);
    uint32_t out_count0 = bb_list_outputs(bus, NULL, 0);
    bb_error err;
    bb_endpoint* ep = make_endpoint(bus, "Registry Test", 0);
    CHECK(ep != NULL);
    CHECK(bb_endpoint_uid(ep) != 0);
    CHECK(bb_registry_generation(bus) != gen0);
    CHECK(bb_add_output(ep, "A", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) != NULL);
    CHECK(bb_add_output(ep, "EOC", BB_SIGNAL_TRIGGER, BB_POLARITY_UNIPOLAR, &err) != NULL);
    CHECK(bb_add_output(ep, "A", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_ALREADY_EXISTS);
    CHECK(bb_add_output(ep, "a/b", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_INVALID_ARGUMENT);
    CHECK(bb_add_output(ep, "", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) == NULL);
    CHECK(bb_add_output(ep, "this-output-name-is-much-too-long", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err) ==
          NULL);
    CHECK(bb_add_output(ep, "X", BB_SIGNAL_AUDIO, BB_POLARITY_BIPOLAR, &err) == NULL); /* reserved */
    CHECK(bb_add_input(ep, "Rate", BB_SIGNAL_CONTROL, &err) != NULL);
    CHECK(bb_add_input(ep, "Rate", BB_SIGNAL_CONTROL, &err) == NULL);
    CHECK_EQ_INT(err, BB_ERR_ALREADY_EXISTS);
    CHECK(bb_add_input(ep, "A", BB_SIGNAL_CONTROL, &err) != NULL); /* inputs and outputs: separate names */

    CHECK_EQ_INT(bb_list_endpoints(bus, NULL, 0), ep_count0 + 1);
    CHECK_EQ_INT(bb_list_outputs(bus, NULL, 0), out_count0 + 2);
    bb_input_info inputs[4];
    CHECK_EQ_INT(bb_list_inputs(bus, bb_endpoint_uid(ep), inputs, 4), 2);
    CHECK(strcmp(inputs[0].name, "Rate") == 0);

    bb_endpoint_info infos[BB_MAX_ENDPOINTS];
    uint32_t n = bb_list_endpoints(bus, infos, BB_MAX_ENDPOINTS);
    int found = 0;
    for (uint32_t i = 0; i < n; ++i) {
        if (infos[i].uid != bb_endpoint_uid(ep)) continue;
        found = 1;
        CHECK(strcmp(infos[i].display_name, "Registry Test") == 0);
        CHECK_EQ_INT(infos[i].num_outputs, 2);
        CHECK_EQ_INT(infos[i].num_inputs, 2);
    }
    CHECK(found);

    CHECK_EQ_INT(bb_set_instance_name(ep, "Renamed \xc3\xa4"), BB_OK); /* UTF-8 is fine */
    CHECK_EQ_INT(bb_set_track_name(ep, "Bass"), BB_OK);
    n = bb_list_endpoints(bus, infos, BB_MAX_ENDPOINTS);
    for (uint32_t i = 0; i < n; ++i)
        if (infos[i].uid == bb_endpoint_uid(ep))
            CHECK(strcmp(infos[i].display_name, "Renamed \xc3\xa4") == 0 && strcmp(infos[i].track_name, "Bass") == 0);

    bb_unregister_instance(ep);
    CHECK_EQ_INT(bb_list_endpoints(bus, NULL, 0), ep_count0);
    CHECK_EQ_INT(bb_list_outputs(bus, NULL, 0), out_count0);
    bb_bus_close(bus);
}

static void check_uid_collisions(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t uid = 0x1111222233334444ull;
    bb_error err;
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    bb_endpoint* a = bb_register_instance(bus, &info, &err);
    CHECK(a != NULL);
    CHECK_EQ_INT(err, BB_OK);
    CHECK(bb_endpoint_uid(a) == uid);
    bb_endpoint* b = bb_register_instance(bus, &info, &err); /* "duplicated device" */
    CHECK(b != NULL);
    CHECK_EQ_INT(err, BB_ERR_UID_IN_USE);
    CHECK(bb_endpoint_uid(b) != uid && bb_endpoint_uid(b) != 0);
    CHECK_EQ_INT(bb_set_instance_uid(b, uid), BB_ERR_UID_IN_USE);
    CHECK_EQ_INT(bb_set_instance_uid(b, 0x5555ull), BB_OK);
    CHECK(bb_endpoint_uid(b) == 0x5555ull);
    bb_unregister_instance(a);
    CHECK_EQ_INT(bb_set_instance_uid(b, uid), BB_OK); /* free again */
    bb_unregister_instance(b);
    CHECK(bb_generate_uid() != bb_generate_uid());
    bb_bus_close(bus);
}

typedef struct pair {
    bb_bus* bus;
    bb_endpoint* writer;
    bb_endpoint* reader;
    bb_output* out;
    bb_input* in;
} pair;

static int make_pair(pair* p, float amount) {
    memset(p, 0, sizeof(*p));
    p->bus = open_bus();
    if (!p->bus) return 0;
    p->writer = make_endpoint(p->bus, "Writer", 0);
    p->reader = make_endpoint(p->bus, "Reader", 0);
    p->out = bb_add_output(p->writer, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    p->in = bb_add_input(p->reader, "in", BB_SIGNAL_CONTROL, NULL);
    if (!p->writer || !p->reader || !p->out || !p->in) return 0;
    return bb_connect(p->bus, bb_endpoint_uid(p->reader), "in", bb_endpoint_uid(p->writer), "out", amount) == BB_OK;
}

static void free_pair(pair* p) {
    bb_unregister_instance(p->writer);
    bb_unregister_instance(p->reader);
    bb_bus_close(p->bus);
}

/* One block of latency while playing, in whatever order the host runs us. */
static void check_latency_playing(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    if (g_current_failed) {
        free_pair(&p);
        return;
    }
    const uint32_t n = 256;
    for (uint32_t c = 0; c < 200; ++c) {
        int64_t pos = (int64_t)c * n;
        uint64_t t = 1000000000ull + (uint64_t)c * 5333333ull;
        uint32_t present = 0;
        float got;
        if (next_rand() & 1u) {
            write_block(p.writer, p.out, pos, n, 1, t, (float)(c + 1));
            got = read_block(p.reader, p.in, pos, n, 1, t, &present, NULL);
        } else {
            got = read_block(p.reader, p.in, pos, n, 1, t, &present, NULL);
            write_block(p.writer, p.out, pos, n, 1, t, (float)(c + 1));
        }
        CHECK_EQ_INT(present, 1);
        CHECK_NEAR(got, (float)c, 0.0); /* value of the previous cycle (0 before the first) */
        if (g_current_failed) break;
    }
    free_pair(&p);
}

/* Offline export: blocks arrive much faster than real time. */
static void check_latency_offline(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    if (g_current_failed) {
        free_pair(&p);
        return;
    }
    const uint32_t n = 512;
    for (uint32_t c = 0; c < 200; ++c) {
        int64_t pos = 48000 + (int64_t)c * n;
        uint64_t t = 1000000000ull + (uint64_t)c * 1000ull; /* 1 µs per block */
        float got;
        if (next_rand() & 1u) {
            write_block(p.writer, p.out, pos, n, 1, t, (float)(c + 1));
            got = read_block(p.reader, p.in, pos, n, 1, t, NULL, NULL);
        } else {
            got = read_block(p.reader, p.in, pos, n, 1, t, NULL, NULL);
            write_block(p.writer, p.out, pos, n, 1, t, (float)(c + 1));
        }
        CHECK_NEAR(got, (float)c, 0.0);
        if (g_current_failed) break;
    }
    free_pair(&p);
}

/* Looping: the transport jumps back, stamps repeat; still one block late. */
static void check_latency_loop(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    if (g_current_failed) {
        free_pair(&p);
        return;
    }
    const uint32_t n = 128;
    for (uint32_t c = 0; c < 64; ++c) {
        int64_t pos = (int64_t)(c % 8) * n; /* 8-block loop */
        uint64_t t = 1000000000ull + (uint64_t)c * 2666666ull;
        float got;
        if (next_rand() & 1u) {
            write_block(p.writer, p.out, pos, n, 1, t, (float)(c + 1));
            got = read_block(p.reader, p.in, pos, n, 1, t, NULL, NULL);
        } else {
            got = read_block(p.reader, p.in, pos, n, 1, t, NULL, NULL);
            write_block(p.writer, p.out, pos, n, 1, t, (float)(c + 1));
        }
        CHECK_NEAR(got, (float)c, 0.0);
        if (g_current_failed) break;
    }
    free_pair(&p);
}

/* Transport stopped: positions do not move, the time rule takes over. */
static void check_latency_stopped(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    if (g_current_failed) {
        free_pair(&p);
        return;
    }
    const uint32_t n = 256;
    const uint64_t block_ns = (uint64_t)(1e9 * n / 48000.0);
    for (uint32_t c = 0; c < 200; ++c) {
        uint64_t t = 1000000000ull + (uint64_t)c * block_ns + (next_rand() % 50000u); /* ±jitter */
        float got;
        if (next_rand() & 1u) {
            write_block(p.writer, p.out, 777, n, 0, t, (float)(c + 1));
            got = read_block(p.reader, p.in, 777, n, 0, t + (next_rand() % 50000u), NULL, NULL);
        } else {
            got = read_block(p.reader, p.in, 777, n, 0, t, NULL, NULL);
            write_block(p.writer, p.out, 777, n, 0, t + (next_rand() % 50000u), (float)(c + 1));
        }
        CHECK_NEAR(got, (float)c, 0.0);
        if (g_current_failed) break;
    }
    free_pair(&p);
}

static void check_summing_and_amounts(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    bb_endpoint* w1 = make_endpoint(bus, "W1", 0);
    bb_endpoint* w2 = make_endpoint(bus, "W2", 0);
    bb_endpoint* r = make_endpoint(bus, "R", 0);
    bb_output* o1 = bb_add_output(w1, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    bb_output* o2 = bb_add_output(w2, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    uint64_t ru = bb_endpoint_uid(r);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", bb_endpoint_uid(w1), "out", 0.5f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", bb_endpoint_uid(w2), "out", -2.0f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", bb_endpoint_uid(w2), "out", -0.25f), BB_OK); /* update, not add */
    CHECK_EQ_INT(bb_list_connections(bus, ru, "in", NULL, 0), 2);
    uint32_t present = 0;
    for (int c = 0; c < 3; ++c) {
        write_block(w1, o1, c * 64, 64, 1, 0, 1.0f);
        write_block(w2, o2, c * 64, 64, 1, 0, 0.8f);
        float got = read_block(r, in, c * 64, 64, 1, 0, &present, NULL);
        if (c > 0) CHECK_NEAR(got, 0.5 * 1.0 - 0.25 * 0.8, 1e-6);
    }
    CHECK_EQ_INT(present, 2);
    /* An endpoint may patch its own output into its own input. */
    bb_output* self_out = bb_add_output(r, "self", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", ru, "self", 1.0f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", ru, "bad/name", 1.0f), BB_ERR_INVALID_ARGUMENT);
    CHECK_EQ_INT(bb_connect(bus, 0x77ull, "in", ru, "self", 1.0f), BB_ERR_NOT_FOUND);
    CHECK_EQ_INT(bb_connect(bus, ru, "missing", ru, "self", 1.0f), BB_ERR_NOT_FOUND);
    for (uint64_t extra = 1; extra <= 6; ++extra) bb_connect(bus, ru, "in", 0x9000ull + extra, "x", 1.0f);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", 0x9999ull, "x", 1.0f), BB_ERR_FULL);
    (void)self_out;
    bb_unregister_instance(w1);
    bb_unregister_instance(w2);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

static void check_ghost_sources(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t future_uid = 0xabcdef0123456789ull;
    bb_endpoint* r = make_endpoint(bus, "R", 0);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    CHECK_EQ_INT(bb_connect(bus, bb_endpoint_uid(r), "in", future_uid, "out", 1.0f), BB_OK);
    bb_connection_info ci;
    CHECK_EQ_INT(bb_list_connections(bus, bb_endpoint_uid(r), "in", &ci, 1), 1);
    CHECK_EQ_INT(ci.source_present, 0);
    uint32_t present = 99;
    float got = read_block(r, in, 0, 64, 1, 0, &present, NULL);
    CHECK_EQ_INT(present, 0);
    CHECK_NEAR(got, 0.0, 0.0);

    bb_endpoint* w = make_endpoint(bus, "Late Writer", future_uid);
    bb_output* out = bb_add_output(w, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    write_block(w, out, 64, 64, 1, 0, 0.3f);
    got = read_block(r, in, 128, 64, 1, 0, &present, NULL);
    (void)got;
    write_block(w, out, 128, 64, 1, 0, 0.3f);
    got = read_block(r, in, 192, 64, 1, 0, &present, NULL);
    CHECK_EQ_INT(present, 1);
    CHECK_NEAR(got, 0.3, 1e-7);
    CHECK_EQ_INT(bb_list_connections(bus, bb_endpoint_uid(r), "in", &ci, 1), 1);
    CHECK_EQ_INT(ci.source_present, 1);

    /* Source leaves: the cable stays, reads silence. */
    bb_unregister_instance(w);
    got = read_block(r, in, 256, 64, 1, 0, &present, NULL);
    CHECK_EQ_INT(present, 0);
    CHECK_NEAR(got, 0.0, 0.0);
    CHECK_EQ_INT(bb_list_connections(bus, bb_endpoint_uid(r), "in", NULL, 0), 1);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

static void check_block_edge_cases(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    if (g_current_failed) {
        free_pair(&p);
        return;
    }
    float buf[BB_MAX_BLOCK_SAMPLES];
    bb_block_info b = BB_BLOCK_INFO_INIT;
    b.num_samples = 64;
    b.sample_rate = 48000.0;
    b.flags = BB_BLOCK_PLAYING;

    /* Unwritten output publishes silence. */
    write_block(p.writer, p.out, 0, 64, 1, 0, 0.9f);
    read_block(p.reader, p.in, 0, 64, 1, 0, NULL, NULL);
    b.transport_sample_pos = 64;
    bb_begin_block(p.writer, &b);
    bb_end_block(p.writer);
    read_block(p.reader, p.in, 64, 64, 1, 0, NULL, NULL);
    CHECK_NEAR(read_block(p.reader, p.in, 128, 64, 1, 0, NULL, NULL), 0.0, 0.0);

    /* A short write holds its last sample. */
    b.transport_sample_pos = 192;
    for (int i = 0; i < 16; ++i) buf[i] = (float)i;
    bb_begin_block(p.writer, &b);
    bb_write_output(p.out, buf, 16);
    bb_end_block(p.writer);
    float last = 0.0f;
    read_block(p.reader, p.in, 192, 64, 1, 0, NULL, NULL);
    float first = read_block(p.reader, p.in, 256, 64, 1, 0, NULL, &last);
    (void)first;
    /* reader's previous block was 192: it sees the short-written block */
    CHECK_NEAR(last, 15.0, 0.0);

    /* Reader block larger than the writer's: the remainder holds. */
    write_block(p.writer, p.out, 1000, 32, 1, 0, 0.25f);
    read_block(p.reader, p.in, 1000, 32, 1, 0, NULL, NULL);
    write_block(p.writer, p.out, 1032, 32, 1, 0, 0.25f);
    read_block(p.reader, p.in, 1032, 64, 1, 0, NULL, &last);
    CHECK_NEAR(last, 0.25, 0.0);

    /* The writer stops: the reader holds its last value. */
    write_block(p.writer, p.out, 2000, 64, 1, 0, 0.6f);
    read_block(p.reader, p.in, 2000, 64, 1, 0, NULL, NULL);
    for (int c = 1; c < 10; ++c) {
        float got = read_block(p.reader, p.in, 2000 + c * 64, 64, 1, 0, NULL, NULL);
        CHECK_NEAR(got, 0.6, 1e-7);
    }

    /* Blocks larger than the maximum are clamped, never overflow. */
    static float big[BB_MAX_BLOCK_SAMPLES * 2];
    b.num_samples = BB_MAX_BLOCK_SAMPLES * 2;
    bb_begin_block(p.reader, &b);
    bb_read_input(p.in, big, BB_MAX_BLOCK_SAMPLES * 2);
    bb_end_block(p.reader);
    free_pair(&p);
}

static void check_persistence(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    bb_endpoint* r = make_endpoint(bus, "R", 0);
    bb_add_input(r, "Cutoff", BB_SIGNAL_CONTROL, NULL);
    bb_add_input(r, "Res", BB_SIGNAL_CONTROL, NULL);
    uint64_t ru = bb_endpoint_uid(r);
    CHECK_EQ_INT(bb_connect(bus, ru, "Cutoff", 0x0123456789abcdefull, "A", 0.5f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "Cutoff", 0x42ull, "EOC", -0.125f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "Res", 0x42ull, "B \xc3\xa9", 1.0f), BB_OK);

    char buf[2048];
    size_t needed = bb_save_connections(r, NULL, 0);
    CHECK(needed > 10);
    CHECK_EQ_INT(bb_save_connections(r, buf, 4), needed); /* too small: nothing written, size reported */
    CHECK_EQ_INT(bb_save_connections(r, buf, sizeof(buf)), needed);
    CHECK_EQ_INT(strlen(buf) + 1, needed);
    CHECK(strncmp(buf, "bleep-bus-connections 1\n", 24) == 0);
    CHECK(strstr(buf, "Cutoff\t0123456789abcdef\tA\t0.500000\n") != NULL);
    CHECK(strstr(buf, "Cutoff\t0000000000000042\tEOC\t-0.125000\n") != NULL);

    uint32_t pv = bb_endpoint_patch_version(r);
    CHECK_EQ_INT(bb_disconnect_all(bus, ru, "Cutoff"), BB_OK);
    CHECK_EQ_INT(bb_disconnect(bus, ru, "Res", 0x42ull, "B \xc3\xa9"), BB_OK);
    CHECK_EQ_INT(bb_disconnect(bus, ru, "Res", 0x42ull, "B \xc3\xa9"), BB_ERR_NOT_FOUND);
    CHECK(bb_endpoint_patch_version(r) != pv);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Cutoff", NULL, 0), 0);

    pv = bb_endpoint_patch_version(r);
    CHECK_EQ_INT(bb_load_connections(r, buf, needed), BB_OK);
    CHECK_EQ_INT(bb_endpoint_patch_version(r), pv); /* loading is not an edit */
    bb_connection_info ci[8];
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Cutoff", ci, 8), 2);
    CHECK(ci[0].source_uid == 0x0123456789abcdefull && strcmp(ci[0].output_name, "A") == 0);
    CHECK_NEAR(ci[0].amount, 0.5, 1e-6);
    CHECK_NEAR(ci[1].amount, -0.125, 1e-6);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Res", ci, 8), 1);
    CHECK(strcmp(ci[0].output_name, "B \xc3\xa9") == 0);

    /* Unknown inputs are skipped; CRLF and missing trailing newline are fine. */
    const char* other = "bleep-bus-connections 1\r\nGone\t0000000000000001\tA\t1.0\r\nRes\t0000000000000002\tA\t-.5";
    CHECK_EQ_INT(bb_load_connections(r, other, strlen(other)), BB_OK);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Cutoff", NULL, 0), 0);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Res", ci, 8), 1);
    CHECK_NEAR(ci[0].amount, -0.5, 1e-6);

    const char* bad[] = {"garbage", "bleep-bus-connections 1\nRes\tzz\tA\t1.0\n",
                         "bleep-bus-connections 1\nRes\t0000000000000002\tA\tabc\n",
                         "bleep-bus-connections 1\nRes\t0000000000000002\tA\n"};
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); ++i)
        CHECK_EQ_INT(bb_load_connections(r, bad[i], strlen(bad[i])), BB_ERR_PARSE);
    const char* empty = "bleep-bus-connections 1\n";
    CHECK_EQ_INT(bb_load_connections(r, empty, strlen(empty)), BB_OK);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Res", NULL, 0), 0);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

static void check_cross_handle_patching(void) {
    /* A patchbay in another plugin instance edits our cables. */
    bb_bus* mine = open_bus();
    bb_bus* theirs = open_bus();
    CHECK(mine != NULL && theirs != NULL);
    if (!mine || !theirs) return;
    bb_endpoint* r = make_endpoint(mine, "R", 0);
    bb_endpoint* w = make_endpoint(theirs, "W", 0);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    bb_output* out = bb_add_output(w, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    uint32_t pv = bb_endpoint_patch_version(r);
    uint32_t cg = bb_connection_generation(mine);
    CHECK_EQ_INT(bb_connect(theirs, bb_endpoint_uid(r), "in", bb_endpoint_uid(w), "out", 1.0f), BB_OK);
    CHECK(bb_endpoint_patch_version(r) != pv);
    CHECK(bb_connection_generation(mine) != cg);
    write_block(w, out, 0, 32, 1, 0, 0.7f);
    read_block(r, in, 0, 32, 1, 0, NULL, NULL);
    write_block(w, out, 32, 32, 1, 0, 0.7f);
    CHECK_NEAR(read_block(r, in, 32, 32, 1, 0, NULL, NULL), 0.7, 1e-7);

    /* Peek (scopes) */
    float peek[64];
    CHECK_EQ_INT(bb_peek_output(mine, bb_endpoint_uid(w), "out", peek, 64), 32);
    CHECK_NEAR(peek[31], 0.7, 1e-7);
    CHECK_EQ_INT(bb_peek_output(mine, bb_endpoint_uid(w), "nope", peek, 64), 0);

    /* Unregistering the receiver drops its cables. */
    uint64_t ru = bb_endpoint_uid(r);
    bb_unregister_instance(r);
    CHECK_EQ_INT(bb_list_connections(theirs, ru, "in", NULL, 0), 0);
    bb_unregister_instance(w);
    bb_bus_close(mine);
    bb_bus_close(theirs);
}

#if BB_HAVE_POSIX

/* ---- real threads, random order per cycle ---------------------------- */

#define T_WRITERS 4
#define T_READERS 4
#define T_CYCLES 3000

typedef struct thread_ctx {
    bb_endpoint* ep;
    bb_output* out;
    bb_input* in;
    int is_writer;
    float writer_scale;
    int errors;
    float first_bad;
    uint32_t bad_cycle;
} thread_ctx;

static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_cond = PTHREAD_COND_INITIALIZER;
static uint32_t g_cycle_started = 0;
static uint32_t g_done_in_cycle = 0;

static void* worker(void* arg) {
    thread_ctx* ctx = (thread_ctx*)arg;
    float buf[256];
    uint32_t local_rng = (uint32_t)(uintptr_t)arg | 1u;
    for (uint32_t c = 1; c <= T_CYCLES; ++c) {
        pthread_mutex_lock(&g_mutex);
        while (g_cycle_started < c) pthread_cond_wait(&g_cond, &g_mutex);
        pthread_mutex_unlock(&g_mutex);

        local_rng ^= local_rng << 13;
        local_rng ^= local_rng >> 17;
        local_rng ^= local_rng << 5;
        for (uint32_t spin = local_rng % 200u; spin; --spin) sched_yield();

        bb_block_info b = BB_BLOCK_INFO_INIT;
        b.transport_sample_pos = (int64_t)c * 256;
        b.num_samples = 256;
        b.sample_rate = 48000.0;
        b.flags = BB_BLOCK_PLAYING;
        bb_begin_block(ctx->ep, &b);
        if (ctx->is_writer) {
            fill(buf, 256, (float)c * ctx->writer_scale);
            bb_write_output(ctx->out, buf, 256);
        } else {
            bb_read_input(ctx->in, buf, 256);
            /* Each writer w contributes (c-1) * scale_w, scales 1,10,100,1000. */
            float expected = c > 1 ? (float)(c - 1) * 1111.0f : 0.0f;
            if (buf[0] != expected || buf[255] != expected) {
                if (!ctx->errors) {
                    ctx->first_bad = buf[0];
                    ctx->bad_cycle = c;
                }
                ++ctx->errors;
            }
        }
        bb_end_block(ctx->ep);

        pthread_mutex_lock(&g_mutex);
        if (++g_done_in_cycle == T_WRITERS + T_READERS) pthread_cond_broadcast(&g_cond);
        pthread_mutex_unlock(&g_mutex);
    }
    return NULL;
}

static void check_latency_threads(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    thread_ctx ctx[T_WRITERS + T_READERS];
    memset(ctx, 0, sizeof(ctx));
    const float scales[T_WRITERS] = {1.0f, 10.0f, 100.0f, 1000.0f};
    for (int i = 0; i < T_WRITERS; ++i) {
        ctx[i].ep = make_endpoint(bus, "TW", 0);
        ctx[i].out = bb_add_output(ctx[i].ep, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
        ctx[i].is_writer = 1;
        ctx[i].writer_scale = scales[i];
    }
    for (int i = T_WRITERS; i < T_WRITERS + T_READERS; ++i) {
        ctx[i].ep = make_endpoint(bus, "TR", 0);
        ctx[i].in = bb_add_input(ctx[i].ep, "in", BB_SIGNAL_CONTROL, NULL);
        for (int w = 0; w < T_WRITERS; ++w)
            CHECK_EQ_INT(bb_connect(bus, bb_endpoint_uid(ctx[i].ep), "in", bb_endpoint_uid(ctx[w].ep), "out", 1.0f),
                         BB_OK);
    }
    pthread_t threads[T_WRITERS + T_READERS];
    g_cycle_started = 0;
    for (int i = 0; i < T_WRITERS + T_READERS; ++i) pthread_create(&threads[i], NULL, worker, &ctx[i]);
    for (uint32_t c = 1; c <= T_CYCLES; ++c) {
        pthread_mutex_lock(&g_mutex);
        g_done_in_cycle = 0;
        g_cycle_started = c;
        pthread_cond_broadcast(&g_cond);
        while (g_done_in_cycle < T_WRITERS + T_READERS) pthread_cond_wait(&g_cond, &g_mutex);
        pthread_mutex_unlock(&g_mutex);
    }
    for (int i = 0; i < T_WRITERS + T_READERS; ++i) pthread_join(threads[i], NULL);
    for (int i = T_WRITERS; i < T_WRITERS + T_READERS; ++i) {
        if (ctx[i].errors)
            printf("#   reader %d: %d wrong blocks, first at cycle %u (got %g)\n", i, ctx[i].errors, ctx[i].bad_cycle,
                   ctx[i].first_bad);
        CHECK_EQ_INT(ctx[i].errors, 0);
    }
    for (int i = 0; i < T_WRITERS + T_READERS; ++i) bb_unregister_instance(ctx[i].ep);
    bb_bus_close(bus);
}

/* ---- hostile peers ------------------------------------------------------ */

static bb_shm_input* raw_find_input(raw_map* m, const char* name) {
    bb_shm_header* h = (bb_shm_header*)m->base;
    bb_shm_input* t = (bb_shm_input*)((char*)m->base + h->inputs_offset);
    for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i)
        if (t[i].state == BB_SLOT_ACTIVE && strncmp(t[i].name, name, BB_PORT_NAME_BYTES) == 0) return &t[i];
    return NULL;
}

/* A peer can put anything into the segment: the library must neither hand NaN
 * or Inf to the caller nor read past an unterminated string. */
static void check_hostile_values(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (g_current_failed || !m.base) {
        free_pair(&p);
        return;
    }
    bb_shm_input* rec = raw_find_input(&m, "in");
    CHECK(rec != NULL);
    if (!rec) {
        raw_close(&m);
        free_pair(&p);
        return;
    }
    const uint32_t n = 256;
    uint64_t t = 1000000000ull;
    int64_t pos = 0;
    float nan_v = nanf(""), inf_v = INFINITY;
    uint32_t bits;

    /* Sample values: NaN and Inf from a hostile writer read as silence. */
    float values[2] = {nan_v, inf_v};
    for (int k = 0; k < 2; ++k) {
        for (int c = 0; c < 3; ++c, pos += n, t += 5333333ull) {
            uint32_t present = 0;
            float last = 1.0f;
            write_block(p.writer, p.out, pos, n, 1, t, values[k]);
            float first = read_block(p.reader, p.in, pos, n, 1, t, &present, &last);
            CHECK(isfinite(first) && isfinite(last));
            if (c > 0) CHECK_NEAR(first, 0.0, 0.0);
        }
    }

    /* Amount bits: NaN reads as 0, huge values are clamped to the limit. */
    float amounts[3] = {nan_v, inf_v, 1e30f};
    float expect[3] = {0.0f, 0.0f, 1000.0f};
    for (int k = 0; k < 3; ++k) {
        memcpy(&bits, &amounts[k], sizeof(bits));
        rec->connections[0].amount_bits = bits;
        for (int c = 0; c < 3; ++c, pos += n, t += 5333333ull) {
            uint32_t present = 0;
            write_block(p.writer, p.out, pos, n, 1, t, 1.0f);
            float first = read_block(p.reader, p.in, pos, n, 1, t, &present, NULL);
            CHECK(isfinite(first));
            if (c > 0) CHECK_NEAR(first, expect[k], 0.0);
        }
    }
    {
        /* Listing and saving also sanitise the amount. */
        bb_connection_info ci[2];
        uint32_t cn = bb_list_connections(p.bus, bb_endpoint_uid(p.reader), "in", ci, 2);
        CHECK_EQ_INT(cn, 1);
        CHECK(cn == 1 && ci[0].amount == 1000.0f);
        char buf[512];
        size_t need = bb_save_connections(p.reader, buf, sizeof(buf));
        CHECK(need > 0 && need <= sizeof(buf) && strstr(buf, "1000.000000") != NULL);
    }

    /* Unterminated strings: names filled to the last byte. */
    bb_shm_header* h = (bb_shm_header*)m.base;
    bb_shm_endpoint* eps = (bb_shm_endpoint*)((char*)m.base + h->endpoints_offset);
    for (uint32_t i = 0; i < BB_MAX_ENDPOINTS; ++i) {
        if (eps[i].state != BB_SLOT_ACTIVE) continue;
        memset(eps[i].display_name, 'A', sizeof(eps[i].display_name));
        memset(eps[i].track_name, 'B', sizeof(eps[i].track_name));
        memset(eps[i].vendor, 'C', sizeof(eps[i].vendor));
        memset(eps[i].product, 'D', sizeof(eps[i].product));
    }
    memset(rec->name, 'x', sizeof(rec->name));
    memset(rec->connections[0].output_name, 'y', sizeof(rec->connections[0].output_name));

    bb_endpoint_info infos[BB_MAX_ENDPOINTS];
    uint32_t ne = bb_list_endpoints(p.bus, infos, BB_MAX_ENDPOINTS);
    CHECK(ne >= 2);
    for (uint32_t i = 0; i < ne && i < BB_MAX_ENDPOINTS; ++i) {
        CHECK(memchr(infos[i].display_name, 0, sizeof(infos[i].display_name)) != NULL);
        CHECK(memchr(infos[i].track_name, 0, sizeof(infos[i].track_name)) != NULL);
        CHECK(memchr(infos[i].vendor, 0, sizeof(infos[i].vendor)) != NULL);
        CHECK(memchr(infos[i].product, 0, sizeof(infos[i].product)) != NULL);
    }
    bb_output_info oi[BB_MAX_OUTPUTS];
    uint32_t no = bb_list_outputs(p.bus, oi, BB_MAX_OUTPUTS);
    for (uint32_t i = 0; i < no && i < BB_MAX_OUTPUTS; ++i) {
        CHECK(memchr(oi[i].name, 0, sizeof(oi[i].name)) != NULL);
        CHECK(memchr(oi[i].endpoint_name, 0, sizeof(oi[i].endpoint_name)) != NULL);
        CHECK(memchr(oi[i].track_name, 0, sizeof(oi[i].track_name)) != NULL);
    }
    bb_input_info ii[4];
    uint32_t ni = bb_list_inputs(p.bus, bb_endpoint_uid(p.reader), ii, 4);
    CHECK_EQ_INT(ni, 1);
    if (ni == 1) CHECK(memchr(ii[0].name, 0, sizeof(ii[0].name)) != NULL);
    char big[1024];
    size_t need = bb_save_connections(p.reader, big, sizeof(big));
    CHECK(need > 0 && need <= sizeof(big));
    /* Duplicate-name checks and cable edits must stay in bounds. */
    CHECK(bb_add_input(p.reader, "in", BB_SIGNAL_CONTROL, NULL) != NULL);
    bb_disconnect(p.bus, bb_endpoint_uid(p.reader), "in", bb_endpoint_uid(p.writer), "out");

    raw_close(&m);
    free_pair(&p);
}

/* A peer that dies at seq-odd must not leave the cable table unreadable. */
static bb_shm_output* raw_find_output(raw_map* m, uint64_t uid, const char* name) {
    bb_shm_output* t = (bb_shm_output*)((char*)m->base + BB_LAYOUT_OUTPUTS_OFFSET);
    for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i)
        if (t[i].state == BB_SLOT_ACTIVE && t[i].endpoint_uid == uid && strncmp(t[i].name, name, BB_PORT_NAME_BYTES) == 0)
            return &t[i];
    return NULL;
}

/* Table offsets are validated once at open; rewriting them afterwards must
 * not move the library's pointers (double fetch). */
static void check_hostile_offsets_after_open(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (g_current_failed || !m.base) {
        free_pair(&p);
        return;
    }
    bb_shm_header* h = (bb_shm_header*)m.base;
    uint64_t eo = h->endpoints_offset, io = h->inputs_offset, oo = h->outputs_offset;
    h->endpoints_offset = 0xfffffff0u;
    h->inputs_offset = 0x7fffffffffffull;
    h->outputs_offset = 8;
    bb_error err = BB_OK;
    CHECK(bb_bus_open(BB_SPEC_VERSION, g_ns, &err) == NULL); /* a fresh open rejects it ... */
    CHECK_EQ_INT(err, BB_ERR_CORRUPT);
    /* ... while the already-open handle keeps working. */
    const uint32_t n = 128;
    uint64_t t = 1000000000ull;
    int64_t pos = 0;
    for (int c = 0; c < 3; ++c, pos += n, t += 2666666ull) {
        write_block(p.writer, p.out, pos, n, 1, t, 0.5f);
        float first = read_block(p.reader, p.in, pos, n, 1, t, NULL, NULL);
        if (c > 0) CHECK_NEAR(first, 0.5, 0.0);
    }
    CHECK(bb_list_outputs(p.bus, NULL, 0) >= 1);
    h->endpoints_offset = eo;
    h->inputs_offset = io;
    h->outputs_offset = oo;
    raw_close(&m);
    free_pair(&p);
}

/* An output record whose endpoint_index is out of range is skipped, not used
 * as an index. */
static void check_hostile_endpoint_index(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (g_current_failed || !m.base) {
        free_pair(&p);
        return;
    }
    bb_shm_output* rec = raw_find_output(&m, bb_endpoint_uid(p.writer), "out");
    CHECK(rec != NULL);
    if (rec) {
        uint32_t before = bb_list_outputs(p.bus, NULL, 0);
        uint32_t saved = rec->endpoint_index;
        rec->endpoint_index = 0xffffffffu;
        bb_output_info oi[BB_MAX_OUTPUTS];
        uint32_t n = bb_list_outputs(p.bus, oi, BB_MAX_OUTPUTS);
        CHECK_EQ_INT(n, before - 1);
        rec->endpoint_index = BB_MAX_ENDPOINTS;
        n = bb_list_outputs(p.bus, oi, BB_MAX_OUTPUTS);
        CHECK_EQ_INT(n, before - 1);
        (void)bb_list_endpoints(p.bus, NULL, 0);
        rec->endpoint_index = saved;
        CHECK_EQ_INT(bb_list_outputs(p.bus, NULL, 0), before);
    }
    raw_close(&m);
    free_pair(&p);
}

/* If another endpoint now owns the writer's output record (reaped and
 * reallocated, or claimed by a hostile peer) the old writer must not touch
 * the slot: two writers would break the seqlock. */
static void check_output_ownership(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (g_current_failed || !m.base) {
        free_pair(&p);
        return;
    }
    bb_shm_output* rec = raw_find_output(&m, bb_endpoint_uid(p.writer), "out");
    CHECK(rec != NULL);
    if (rec) {
        const uint32_t n = 64;
        uint64_t t = 1000000000ull;
        int64_t pos = 0;
        write_block(p.writer, p.out, pos, n, 1, t, 0.25f);
        uint64_t written = rec->blocks_written;
        CHECK(written >= 1);

        uint64_t uid = rec->endpoint_uid;
        rec->endpoint_uid = uid ^ 0x1234ull; /* someone else's output now */
        for (int c = 1; c <= 3; ++c) write_block(p.writer, p.out, pos + c * n, n, 1, t + c * 1333333ull, 0.75f);
        CHECK_EQ_INT(rec->blocks_written, written);
        for (uint32_t i = 0; i < BB_OUTPUT_SLOTS; ++i)
            CHECK(rec->slots[i].samples[0] != 0.75f);
        rec->endpoint_uid = uid;

        uint32_t inc = rec->incarnation;
        rec->incarnation = inc + 1u; /* record was reallocated */
        write_block(p.writer, p.out, pos + 4 * n, n, 1, t + 4 * 1333333ull, 0.75f);
        CHECK_EQ_INT(rec->blocks_written, written);
        rec->incarnation = inc;

        uint32_t st = rec->state;
        rec->state = BB_SLOT_FREE;
        write_block(p.writer, p.out, pos + 5 * n, n, 1, t + 5 * 1333333ull, 0.75f);
        CHECK_EQ_INT(rec->blocks_written, written);
        rec->state = st;

        write_block(p.writer, p.out, pos + 6 * n, n, 1, t + 6 * 1333333ull, 0.75f); /* ownership restored */
        CHECK(rec->blocks_written > written);
    }
    raw_close(&m);
    free_pair(&p);
}

static void check_seq_odd_recovery(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (g_current_failed || !m.base) {
        free_pair(&p);
        return;
    }
    bb_shm_input* rec = raw_find_input(&m, "in");
    CHECK(rec != NULL);
    if (rec) {
        rec->seq |= 1u; /* a writer died mid-update */
        CHECK_EQ_INT(bb_connect(p.bus, bb_endpoint_uid(p.reader), "in", 0x77ull, "other", 0.5f), BB_OK);
        CHECK_EQ_INT(rec->seq & 1u, 0);
        rec->seq |= 1u;
        CHECK_EQ_INT(bb_disconnect(p.bus, bb_endpoint_uid(p.reader), "in", 0x77ull, "other"), BB_OK);
        CHECK_EQ_INT(rec->seq & 1u, 0);
    }
    raw_close(&m);
    free_pair(&p);
}

/* ---- processes ---------------------------------------------------------- */

static void check_reap_dead_process(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t uid = 0xdeadull;
    pid_t child = fork();
    if (child == 0) {
        bb_bus* cb = bb_bus_open(BB_SPEC_VERSION, g_ns, NULL);
        bb_endpoint* ep = make_endpoint(cb, "Crashing", uid);
        bb_add_output(ep, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
        _exit(ep ? 0 : 1); /* exit without unregistering, like a crash */
    }
    int status = 0;
    waitpid(child, &status, 0);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);

    /* The dead endpoint's UID is reclaimed on the next registration. */
    bb_error err;
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    CHECK(ep != NULL);
    CHECK_EQ_INT(err, BB_OK);
    CHECK(bb_endpoint_uid(ep) == uid);
    bb_unregister_instance(ep);
    bb_bus_close(bus);
}

static void check_lock_recovery(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    pid_t child = fork();
    if (child == 0) _exit(0);
    waitpid(child, NULL, 0);
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (m.base) {
        bb_shm_header* h = (bb_shm_header*)m.base;
        __atomic_store_n(&h->registry_lock, (uint32_t)child, __ATOMIC_RELEASE); /* "crashed while holding" */
        bb_endpoint* ep = make_endpoint(bus, "After Crash", 0);
        CHECK(ep != NULL);
        CHECK_EQ_INT(__atomic_load_n(&h->registry_lock, __ATOMIC_ACQUIRE), 0);
        bb_unregister_instance(ep);
        raw_close(&m);
    }
    bb_bus_close(bus);
}

static void check_cross_process(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t peer_uid = 0x0dd0beefull;
    bb_endpoint* r = make_endpoint(bus, "Cross Reader", 0);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    CHECK_EQ_INT(bb_connect(bus, bb_endpoint_uid(r), "in", peer_uid, "peer", 1.0f), BB_OK);

    char uid_arg[32];
    snprintf(uid_arg, sizeof(uid_arg), "%llu", (unsigned long long)peer_uid);
    char* argv[] = {(char*)g_self, (char*)"peer-send", g_ns, uid_arg, (char*)"3", NULL};
    pid_t child;
    if (posix_spawn(&child, g_self, NULL, NULL, argv, environ) != 0) {
        printf("#   could not spawn %s\n", g_self);
        CHECK(0);
        bb_unregister_instance(r);
        bb_bus_close(bus);
        return;
    }
    int seen = 0, product_ok = 0;
    float buf[256];
    for (int i = 0; i < 400 && !seen; ++i) { /* up to ~2 s of real-time blocks */
        bb_block_info b = BB_BLOCK_INFO_INIT;
        b.num_samples = 256;
        b.sample_rate = 48000.0;
        b.transport_sample_pos = (int64_t)i * 256;
        bb_begin_block(r, &b);
        uint32_t present = bb_read_input(in, buf, 256);
        bb_end_block(r);
        if (present == 1 && fabsf(buf[0] - 0.42f) < 1e-6f) seen = 1;
        sleep_ms(5);
    }
    bb_endpoint_info infos[BB_MAX_ENDPOINTS];
    uint32_t n = bb_list_endpoints(bus, infos, BB_MAX_ENDPOINTS);
    for (uint32_t i = 0; i < n && i < BB_MAX_ENDPOINTS; ++i)
        if (infos[i].uid == peer_uid && strcmp(infos[i].product, "conformance-peer") == 0 &&
            infos[i].pid == (uint32_t)child)
            product_ok = 1;
    CHECK(seen);
    CHECK(product_ok);
    int status = 0;
    waitpid(child, &status, 0);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

#endif /* BB_HAVE_POSIX */

/* ========================================================================
 * Modes
 * ===================================================================== */

static int mode_peer_send(const char* ns, uint64_t uid, int seconds) {
    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, ns, &err);
    if (!bus) {
        fprintf(stderr, "peer-send: %s\n", bb_error_string(err));
        return 1;
    }
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    info.display_name = "Peer";
    info.product = "conformance-peer";
    info.vendor = "Bleep Bus";
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    bb_output* out = bb_add_output(ep, "peer", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err);
    if (!ep || !out) {
        fprintf(stderr, "peer-send: %s\n", bb_error_string(err));
        return 1;
    }
    float buf[256];
    fill(buf, 256, 0.42f);
    int blocks = seconds * 48000 / 256;
    for (int i = 0; i < blocks; ++i) {
        bb_block_info b = BB_BLOCK_INFO_INIT;
        b.num_samples = 256;
        b.sample_rate = 48000.0;
        b.transport_sample_pos = (int64_t)i * 256;
        bb_begin_block(ep, &b);
        bb_write_output(out, buf, 256);
        bb_end_block(ep);
        sleep_ms(5);
    }
    bb_unregister_instance(ep);
    bb_bus_close(bus);
    return 0;
}

static const char* type_name(bb_signal_type t) {
    switch (t) {
        case BB_SIGNAL_CONTROL: return "control";
        case BB_SIGNAL_GATE: return "gate";
        case BB_SIGNAL_TRIGGER: return "trigger";
        case BB_SIGNAL_PITCH: return "pitch";
        case BB_SIGNAL_AUDIO: return "audio";
    }
    return "?";
}

static int mode_inspect(const char* ns) {
    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, ns, &err);
    if (!bus) {
        fprintf(stderr, "inspect: %s\n", bb_error_string(err));
        return 1;
    }
    int problems = 0;
    bb_endpoint_info eps[BB_MAX_ENDPOINTS];
    uint32_t ne = bb_list_endpoints(bus, eps, BB_MAX_ENDPOINTS);
    printf("bus \"%s\": %u endpoint(s), registry gen %u, connection gen %u\n", ns ? ns : "default", ne,
           bb_registry_generation(bus), bb_connection_generation(bus));
    static bb_output_info outs[BB_MAX_OUTPUTS];
    uint32_t no = bb_list_outputs(bus, outs, BB_MAX_OUTPUTS);
    for (uint32_t e = 0; e < ne && e < BB_MAX_ENDPOINTS; ++e) {
        printf("\n%016llx  %s › %s  (%s / %s, pid %u)\n", (unsigned long long)eps[e].uid,
               eps[e].track_name[0] ? eps[e].track_name : "?", eps[e].display_name, eps[e].vendor, eps[e].product,
               eps[e].pid);
        for (uint32_t o = 0; o < no && o < BB_MAX_OUTPUTS; ++o) {
            if (outs[o].endpoint_uid != eps[e].uid) continue;
            float tmp[BB_MAX_BLOCK_SAMPLES];
            uint32_t n = bb_peek_output(bus, eps[e].uid, outs[o].name, tmp, BB_MAX_BLOCK_SAMPLES);
            printf("   out %-12s %-8s %s", outs[o].name, type_name(outs[o].type),
                   outs[o].polarity == BB_POLARITY_BIPOLAR ? "bipolar " : "unipolar");
            if (n) printf("  last %+.4f", tmp[n - 1]);
            printf("\n");
        }
        bb_input_info ins[BB_MAX_PORTS_PER_ENDPOINT];
        uint32_t ni = bb_list_inputs(bus, eps[e].uid, ins, BB_MAX_PORTS_PER_ENDPOINT);
        for (uint32_t i = 0; i < ni && i < BB_MAX_PORTS_PER_ENDPOINT; ++i) {
            printf("   in  %-12s %-8s", ins[i].name, type_name(ins[i].type));
            bb_connection_info cs[BB_MAX_CONNECTIONS_PER_INPUT];
            uint32_t nc = bb_list_connections(bus, eps[e].uid, ins[i].name, cs, BB_MAX_CONNECTIONS_PER_INPUT);
            if (!nc) printf("  (unpatched)");
            printf("\n");
            for (uint32_t c = 0; c < nc && c < BB_MAX_CONNECTIONS_PER_INPUT; ++c)
                printf("         ← %016llx/%s × %+.3f%s\n", (unsigned long long)cs[c].source_uid, cs[c].output_name,
                       cs[c].amount, cs[c].source_present ? "" : "  [ghost]");
        }
    }

    /* Byte-level invariants on the raw segment. */
    raw_map m;
    if (raw_open(ns ? ns : "default", 0, &m)) {
        const char* base = (const char*)m.base;
        const bb_shm_header* h = (const bb_shm_header*)base;
        const bb_shm_endpoint* E = (const bb_shm_endpoint*)(base + h->endpoints_offset);
        const bb_shm_input* I = (const bb_shm_input*)(base + h->inputs_offset);
        const bb_shm_output* O = (const bb_shm_output*)(base + h->outputs_offset);
        for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
            if (O[i].state != BB_SLOT_ACTIVE) continue;
            const bb_shm_endpoint* owner = &E[O[i].endpoint_index];
            if (O[i].endpoint_index >= BB_MAX_ENDPOINTS || owner->state != BB_SLOT_ACTIVE ||
                owner->uid != O[i].endpoint_uid) {
                printf("PROBLEM: output %u (%s) has no live owner\n", i, O[i].name);
                ++problems;
            }
            if (memchr(O[i].name, 0, sizeof(O[i].name)) == NULL) {
                printf("PROBLEM: output %u name not terminated\n", i);
                ++problems;
            }
        }
        for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i) {
            if (I[i].state != BB_SLOT_ACTIVE) continue;
            if (I[i].endpoint_index >= BB_MAX_ENDPOINTS || E[I[i].endpoint_index].state != BB_SLOT_ACTIVE) {
                printf("PROBLEM: input %u (%s) has no live owner\n", i, I[i].name);
                ++problems;
            }
            if (I[i].seq & 1u) {
                printf("PROBLEM: input %u seqlock left odd\n", i);
                ++problems;
            }
        }
        if (h->registry_lock != 0) printf("note: registry lock held by pid %u\n", h->registry_lock);
        raw_close(&m);
    }
    printf("\n%s (%d problem(s))\n", problems ? "INVALID" : "valid", problems);
    bb_bus_close(bus);
    return problems ? 1 : 0;
}

#if BB_HAVE_POSIX
/* The creator crashed while initialising: the next opener recovers after the
 * init timeout instead of failing forever. */
static void check_init_crash_recovery(void) {
    char ns[BB_NAMESPACE_BYTES];
    snprintf(ns, sizeof(ns), "%s-i", g_ns);
    ns[BB_NAMESPACE_BYTES - 1] = '\0';
    bb_bus_unlink(ns);
    pid_t child = fork();
    if (child == 0) _exit(0);
    int status = 0;
    waitpid(child, &status, 0);

    raw_map m;
    CHECK(raw_open(ns, (size_t)BB_LAYOUT_TOTAL_BYTES, &m));
    if (!m.base) return;
    bb_shm_header* h = (bb_shm_header*)m.base;
    h->init_state = BB_INIT_INITIALIZING;
    h->reserved0 = (uint32_t)child; /* dead initializer */
    bb_error err = BB_OK;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, ns, &err);
    CHECK(bus != NULL);
    CHECK_EQ_INT(err, BB_OK);
    if (bus) {
        bb_endpoint* ep = make_endpoint(bus, "Recovered", 0);
        CHECK(ep != NULL);
        if (ep) bb_unregister_instance(ep);
        bb_bus_close(bus);
    }
    raw_close(&m);
    bb_bus_unlink(ns);
}
#endif

static int mode_run(const char* ns_arg) {
    if (ns_arg) {
        snprintf(g_ns, sizeof(g_ns), "%s", ns_arg);
    } else {
#if defined(_WIN32)
        snprintf(g_ns, sizeof(g_ns), "conf-%lu", (unsigned long)GetCurrentProcessId());
#else
        snprintf(g_ns, sizeof(g_ns), "conf-%ld", (long)getpid());
#endif
    }
    bb_bus_unlink(g_ns);
    printf("TAP version 13\n# Bleep Bus conformance, spec %d.%d, namespace %s\n", BB_SPEC_VERSION_MAJOR,
           BB_SPEC_VERSION_MINOR, g_ns);

    run_check("layout: struct sizes and offsets match the specification", check_layout_sizes);
    run_check("layout: a fresh segment carries a valid header", check_segment_header);
    run_check("open: version and namespace arguments are validated", check_open_arguments);
    run_check("open: segments of other versions are rejected", check_segment_version_mismatch);
    run_check("registry: endpoints and ports register, list and unregister", check_registry);
    run_check("registry: duplicated UIDs are re-keyed", check_uid_collisions);
    run_check("timing: one block of latency in any order (playing)", check_latency_playing);
    run_check("timing: offline export faster than real time", check_latency_offline);
    run_check("timing: transport loops", check_latency_loop);
    run_check("timing: transport stopped (time rule)", check_latency_stopped);
    run_check("signals: inputs sum their cables times amount", check_summing_and_amounts);
    run_check("signals: ghost sources read silence until they appear", check_ghost_sources);
    run_check("signals: unwritten, short, mismatched and oversized blocks", check_block_edge_cases);
    run_check("state: connections save and load", check_persistence);
    run_check("patching: cables edited from another handle", check_cross_handle_patching);
    run_check("hostile peer: NaN/Inf values and unterminated names", check_hostile_values);
    run_check("hostile peer: odd seqlock left by a dead writer", check_seq_odd_recovery);
    run_check("hostile peer: table offsets rewritten after open", check_hostile_offsets_after_open);
    run_check("hostile peer: out-of-range endpoint_index", check_hostile_endpoint_index);
    run_check("hostile peer: two writers claiming one output", check_output_ownership);
#if BB_HAVE_POSIX
    run_check("open: a crashed initializer is recovered", check_init_crash_recovery);
    run_check("timing: real threads in random order", check_latency_threads);
    run_check("registry: endpoints of dead processes are reclaimed", check_reap_dead_process);
    run_check("registry: a lock held by a dead process is recovered", check_lock_recovery);
    run_check("ipc: signals cross process boundaries", check_cross_process);
#else
    skip_check("open: a crashed initializer is recovered", "POSIX only in this version");
    skip_check("timing: real threads in random order", "POSIX only in this version");
    skip_check("registry: endpoints of dead processes are reclaimed", "POSIX only in this version");
    skip_check("registry: a lock held by a dead process is recovered", "POSIX only in this version");
    skip_check("ipc: signals cross process boundaries", "POSIX only in this version");
#endif

    printf("1..%d\n# %d failed\n", g_test_number, g_failures);
    bb_bus_unlink(g_ns);
    return g_failures ? 1 : 0;
}

int main(int argc, char** argv) {
    g_self = argv[0];
    const char* mode = argc > 1 ? argv[1] : "run";
    if (strcmp(mode, "run") == 0) return mode_run(argc > 2 ? argv[2] : NULL);
    if (strcmp(mode, "inspect") == 0) return mode_inspect(argc > 2 ? argv[2] : NULL);
    if (strcmp(mode, "peer-send") == 0 && argc > 4)
        return mode_peer_send(argv[2], strtoull(argv[3], NULL, 10), atoi(argv[4]));
    fprintf(stderr,
            "usage: %s run [namespace]\n"
            "       %s inspect [namespace]\n"
            "       %s peer-send <namespace> <uid> <seconds>\n",
            argv[0], argv[0], argv[0]);
    return 2;
}
