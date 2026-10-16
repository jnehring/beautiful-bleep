/* SPDX-License-Identifier: MIT */
/*
 * bb_internal.h — what the files of the Bleep Bus implementation share: the
 * constants and small helpers, the process-local handle types, and the
 * functions that more than one section of the implementation calls.
 *
 * Structure of the implementation:
 *   bb_bus.c          bus open/close and the registry lock
 *   bb_registry.c     endpoints and ports            [non-RT, under the registry lock]
 *   bb_audio.c        audio thread                   [RT, lock-free]
 *   bb_connections.c  connections and discovery      [non-RT, under the registry lock]
 *   bb_state.c        state persistence              [non-RT]
 *
 * Concurrency model (see the specification, "Memory ordering"):
 *  - Every mutation of the tables happens under header.registry_lock, which
 *    only non-real-time code takes.
 *  - The audio thread never takes the lock. It reads output slots and input
 *    connection identities through seqlocks, and caches the mapping from a
 *    cable to an output index until registry_generation or the input's seq
 *    changes.
 */
#pragma once

#include "bleep_bus.h"
#include "bleep_bus_layout.h"
#include "bb_platform.h"

#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ========================================================================
 * Helpers
 * ===================================================================== */

#define BB_LOCK_TIMEOUT_NS  2000000000ull
#define BB_INIT_TIMEOUT_MS  2000u
#define BB_AMOUNT_LIMIT     1000.0f

static inline uint64_t bb_fnv1a64(const char* s) {
    uint64_t h = 0xcbf29ce484222325ull;
    for (; *s; ++s) {
        h ^= (uint8_t)*s;
        h *= 0x100000001b3ull;
    }
    return h;
}

static inline uint32_t bb_float_bits(float f) {
    uint32_t u;
    memcpy(&u, &f, sizeof(u));
    return u;
}

static inline float bb_bits_float(uint32_t u) {
    float f;
    memcpy(&f, &u, sizeof(f));
    return f;
}

/* Copies a string that lives in shared memory (and so may be unterminated or
 * hostile) into a caller buffer: at most cap-1 bytes, always NUL-terminated,
 * remainder zeroed. */
static inline void bb_copy_shm_str(char* dst, size_t cap, const char* src) {
    size_t n = strnlen(src, cap - 1);
    memcpy(dst, src, n);
    memset(dst + n, 0, cap - n);
}

/* Amounts and samples come from shared memory and may be NaN/Inf/huge:
 * non-finite becomes 0, amounts are clamped to the documented range. */
static inline float bb_sanitize_amount(float a) {
    if (!isfinite(a)) return 0.0f;
    if (a > BB_AMOUNT_LIMIT) return BB_AMOUNT_LIMIT;
    if (a < -BB_AMOUNT_LIMIT) return -BB_AMOUNT_LIMIT;
    return a;
}

static inline float bb_sanitize_sample(float x) { return isfinite(x) ? x : 0.0f; }

static inline void bb_set_err(bb_error* err, bb_error value) {
    if (err) *err = value;
}

/* Port names: 1..31 bytes, no control characters, no '/'. */
static inline int bb_valid_port_name(const char* name) {
    if (!name) return 0;
    size_t len = strlen(name);
    if (len == 0 || len >= BB_PORT_NAME_BYTES) return 0;
    for (size_t i = 0; i < len; ++i) {
        unsigned char c = (unsigned char)name[i];
        if (c < 0x20 || c == 0x7f || c == '/') return 0;
    }
    return 1;
}

/* Copies a free-form name, replacing control characters and truncating at a
 * UTF-8 character boundary. NULL becomes the empty string. */
static inline void bb_copy_display(char* dest, size_t cap, const char* src) {
    size_t n = 0;
    if (src) {
        size_t len = strlen(src);
        n = len < cap - 1 ? len : cap - 1;
        while (n > 0 && n < len && ((unsigned char)src[n] & 0xC0u) == 0x80u) --n; /* don't split a sequence */
        for (size_t i = 0; i < n; ++i) {
            unsigned char c = (unsigned char)src[i];
            dest[i] = (c < 0x20 || c == 0x7f) ? ' ' : (char)c;
        }
    }
    memset(dest + n, 0, cap - n);
}

static inline int bb_valid_namespace(const char* ns) {
    size_t len = strlen(ns);
    if (len == 0 || len >= BB_NAMESPACE_BYTES) return 0;
    for (size_t i = 0; i < len; ++i) {
        char c = ns[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return 0;
    }
    return 1;
}

/* ========================================================================
 * Process-local handles
 * ===================================================================== */

typedef struct bb_block_state {
    int valid;
    int64_t pos;
    uint32_t num_samples;
    uint32_t flags;
    uint64_t time_ns;
    double sample_rate;
} bb_block_state;

struct bb_bus {
    bb_shm_handle shm;
    bb_shm_header* hdr;
    bb_shm_endpoint* endpoints;
    bb_shm_input* inputs;
    bb_shm_output* outputs;
    uint32_t pid;
    char ns[BB_NAMESPACE_BYTES];
};

struct bb_output {
    bb_endpoint* ep;
    uint32_t index;
    uint32_t incarnation;   /* shm record incarnation this handle was allocated with */
    int written;            /* written during the current block */
};

typedef struct bb_conn_cache {
    int active;
    uint64_t uid;
    uint64_t hash;
    int32_t out_index;      /* -1 = source not on the bus */
    uint32_t out_incarnation;
    float held;             /* last sample, used when no block is available */
} bb_conn_cache;

struct bb_input {
    bb_endpoint* ep;
    uint32_t index;
    uint32_t cached_seq;        /* input seq the identity cache was built from (odd = never) */
    uint32_t cached_generation; /* registry generation the resolution was built from */
    bb_conn_cache cache[BB_MAX_CONNECTIONS_PER_INPUT];
    float scratch[BB_MAX_BLOCK_SAMPLES];
};

struct bb_endpoint {
    bb_bus* bus;
    uint32_t index;
    uint64_t uid;
    bb_block_state cur;
    bb_block_state prev;
    int in_block;
    /* Port arrays are read by the audio thread without a lock. Writers store
     * the pointer, then publish the count with release semantics; readers load
     * the count with acquire semantics. Removal is not supported while audio
     * runs (see bleep_bus.h). */
    bb_output* outputs[BB_MAX_PORTS_PER_ENDPOINT];
    uint32_t num_outputs;   /* atomic (bb_load32/bb_store32) */
    bb_input* inputs[BB_MAX_PORTS_PER_ENDPOINT];
    uint32_t num_inputs;    /* atomic (bb_load32/bb_store32) */
};

static const float bb_zeros[BB_MAX_BLOCK_SAMPLES];

/* ========================================================================
 * Shared between the files of the implementation
 * ===================================================================== */

bb_error bb_lock(bb_bus* bus);   /* bb_bus.c */
void bb_unlock(bb_bus* bus);   /* bb_bus.c */
int bb_find_endpoint_locked(bb_bus* bus, uint64_t uid);   /* bb_registry.c */
int bb_find_input_locked(bb_bus* bus, uint32_t endpoint_index, const char* name);   /* bb_registry.c */
int bb_find_output_locked(bb_bus* bus, uint64_t endpoint_uid, const char* name);   /* bb_registry.c */

