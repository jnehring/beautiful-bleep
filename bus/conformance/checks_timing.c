/* SPDX-License-Identifier: MIT */
/* checks_timing.c — one block of latency in every transport state, and with real threads. */
#include "bb_conf.h"

/* One block of latency while playing, in whatever order the host runs us. */
void check_latency_playing(void) {
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
void check_latency_offline(void) {
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
void check_latency_loop(void) {
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
void check_latency_stopped(void) {
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


#if BB_HAVE_POSIX
/* ---- real threads, random order per cycle ---------------------------- */

#define T_WRITERS 4
#define T_READERS 4
#define T_CYCLES 300

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
        for (uint32_t spin = local_rng % 20u; spin; --spin) sched_yield();

        bb_block_info b = BB_BLOCK_INFO_INIT;
        b.transport_sample_pos = (int64_t)c * 256;
        b.num_samples = 256;
        b.sample_rate = 48000.0;
        b.flags = BB_BLOCK_PLAYING;
        b.host_time_ns = 1000000000ull + (uint64_t)c * 5333333ull; /* same stamp for the whole cycle */
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

void check_latency_threads(void) {
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


#endif /* BB_HAVE_POSIX */
