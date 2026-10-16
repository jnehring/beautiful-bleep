/* SPDX-License-Identifier: MIT */
/* harness.c — the TAP harness, check helpers and raw segment access. */
#include "bb_conf.h"

int g_test_number = 0;
int g_failures = 0;
int g_current_failed = 0;
char g_ns[BB_NAMESPACE_BYTES];
const char* g_self = "bb_conformance";

void run_check(const char* name, check_fn fn) {
    g_current_failed = 0;
    fn();
    ++g_test_number;
    if (g_current_failed) ++g_failures;
    printf("%s %d - %s\n", g_current_failed ? "not ok" : "ok", g_test_number, name);
    fflush(stdout);
}

void skip_check(const char* name, const char* reason) {
    ++g_test_number;
    printf("ok %d - %s # SKIP %s\n", g_test_number, name, reason);
}

/* ========================================================================
 * Helpers
 * ===================================================================== */

bb_bus* open_bus(void) {
    bb_error err = BB_OK;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, g_ns, &err);
    if (!bus) printf("#   bb_bus_open failed: %s\n", bb_error_string(err));
    return bus;
}

bb_endpoint* make_endpoint(bb_bus* bus, const char* name, uint64_t uid) {
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    info.display_name = name;
    info.product = "conformance";
    info.vendor = "Bleep Bus";
    return bb_register_instance(bus, &info, NULL);
}

void fill(float* buf, uint32_t n, float v) {
    for (uint32_t i = 0; i < n; ++i) buf[i] = v;
}

/* Runs one block on an endpoint that only writes `value` to `out`. */
void write_block(bb_endpoint* ep, bb_output* out, int64_t pos, uint32_t n, int playing, uint64_t t_ns,
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
float read_block(bb_endpoint* ep, bb_input* in, int64_t pos, uint32_t n, int playing, uint64_t t_ns,
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
uint32_t next_rand(void) {
    g_rng ^= g_rng << 13;
    g_rng ^= g_rng >> 17;
    g_rng ^= g_rng << 5;
    return g_rng;
}

void segment_name(const char* ns, char* dst, size_t cap) {
#if defined(_WIN32)
    snprintf(dst, cap, "Local\\bleepbus-v%d-%s", BB_SPEC_VERSION_MAJOR, ns);
#else
    snprintf(dst, cap, "/bleepbus-v%d-%s", BB_SPEC_VERSION_MAJOR, ns);
#endif
}

/* Maps an existing segment, or creates one of `create_size` bytes. */
int raw_open(const char* ns, size_t create_size, raw_map* m) {
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

void raw_close(raw_map* m) {
#if defined(_WIN32)
    if (m->base) UnmapViewOfFile(m->base);
    if (m->mapping) CloseHandle(m->mapping);
#else
    if (m->base) munmap(m->base, m->size);
    if (m->fd >= 0) close(m->fd);
#endif
    memset(m, 0, sizeof(*m));
}

void sleep_ms(unsigned ms) {
#if defined(_WIN32)
    Sleep(ms);
#else
    struct timespec ts = {(time_t)(ms / 1000u), (long)(ms % 1000u) * 1000000L};
    nanosleep(&ts, NULL);
#endif
}

int make_pair(pair* p, float amount) {
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

void free_pair(pair* p) {
    bb_unregister_instance(p->writer);
    bb_unregister_instance(p->reader);
    bb_bus_close(p->bus);
}

