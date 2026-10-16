/* SPDX-License-Identifier: MIT */
/*
 * bleep_bus.c — Bleep Bus reference implementation (spec v0.1).
 *
 * Structure:
 *   1. helpers (names, hashing, float bits)
 *   2. bus open/close and the registry lock
 *   3. endpoints and ports            [non-RT, under the registry lock]
 *   4. audio thread                   [RT, lock-free]
 *   5. connections and discovery      [non-RT, under the registry lock]
 *   6. state persistence              [non-RT]
 *
 * Concurrency model (see the specification, "Memory ordering"):
 *  - Every mutation of the tables happens under header.registry_lock, which
 *    only non-real-time code takes.
 *  - The audio thread never takes the lock. It reads output slots and input
 *    connection identities through seqlocks, and caches the mapping from a
 *    cable to an output index until registry_generation or the input's seq
 *    changes.
 */
#include "bleep_bus.h"
#include "bleep_bus_layout.h"
#include "bb_platform.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ========================================================================
 * 1. Helpers
 * ===================================================================== */

#define BB_LOCK_TIMEOUT_NS  2000000000ull
#define BB_INIT_TIMEOUT_MS  2000u
#define BB_AMOUNT_LIMIT     1000.0f

static uint64_t bb_fnv1a64(const char* s) {
    uint64_t h = 0xcbf29ce484222325ull;
    for (; *s; ++s) {
        h ^= (uint8_t)*s;
        h *= 0x100000001b3ull;
    }
    return h;
}

static uint32_t bb_float_bits(float f) {
    uint32_t u;
    memcpy(&u, &f, sizeof(u));
    return u;
}

static float bb_bits_float(uint32_t u) {
    float f;
    memcpy(&f, &u, sizeof(f));
    return f;
}

static void bb_set_err(bb_error* err, bb_error value) {
    if (err) *err = value;
}

/* Port names: 1..31 bytes, no control characters, no '/'. */
static int bb_valid_port_name(const char* name) {
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
static void bb_copy_display(char* dest, size_t cap, const char* src) {
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

static int bb_valid_namespace(const char* ns) {
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
    bb_output* outputs[BB_MAX_PORTS_PER_ENDPOINT];
    uint32_t num_outputs;
    bb_input* inputs[BB_MAX_PORTS_PER_ENDPOINT];
    uint32_t num_inputs;
};

static const float bb_zeros[BB_MAX_BLOCK_SAMPLES];

/* ========================================================================
 * 2. Bus open/close and the registry lock
 * ===================================================================== */

const char* bb_error_string(bb_error err) {
    switch (err) {
        case BB_OK: return "ok";
        case BB_ERR_INVALID_ARGUMENT: return "invalid argument";
        case BB_ERR_VERSION_MISMATCH: return "incompatible Bleep Bus spec version";
        case BB_ERR_SHARED_MEMORY: return "shared memory could not be created or mapped";
        case BB_ERR_CORRUPT: return "shared memory segment is not a Bleep Bus segment";
        case BB_ERR_FULL: return "bus table is full";
        case BB_ERR_NOT_FOUND: return "not found";
        case BB_ERR_ALREADY_EXISTS: return "name already exists on this endpoint";
        case BB_ERR_UID_IN_USE: return "UID already in use by another endpoint";
        case BB_ERR_TIMEOUT: return "timed out";
        case BB_ERR_PARSE: return "connection state could not be parsed";
    }
    return "unknown error";
}

static const char* bb_resolve_namespace(const char* requested) {
    if (requested) return requested;
    const char* env = getenv("BLEEP_BUS_NAMESPACE");
    if (env && *env) return env;
    return "default";
}

static void bb_init_header(bb_shm_header* h) {
    /* The segment is zero-filled; only non-zero fields need writing. */
    h->magic = BB_LAYOUT_MAGIC;
    h->spec_major = BB_SPEC_VERSION_MAJOR;
    h->spec_minor = BB_SPEC_VERSION_MINOR;
    h->header_bytes = (uint32_t)sizeof(bb_shm_header);
    h->total_bytes = BB_LAYOUT_TOTAL_BYTES;
    h->max_endpoints = BB_MAX_ENDPOINTS;
    h->max_outputs = BB_MAX_OUTPUTS;
    h->max_inputs = BB_MAX_INPUTS;
    h->max_connections_per_input = BB_MAX_CONNECTIONS_PER_INPUT;
    h->max_block_samples = BB_MAX_BLOCK_SAMPLES;
    h->output_slots = BB_OUTPUT_SLOTS;
    h->endpoints_offset = BB_LAYOUT_ENDPOINTS_OFFSET;
    h->inputs_offset = BB_LAYOUT_INPUTS_OFFSET;
    h->outputs_offset = BB_LAYOUT_OUTPUTS_OFFSET;
}

static bb_error bb_check_header(const bb_shm_header* h, size_t mapped) {
    if (mapped < sizeof(bb_shm_header)) return BB_ERR_CORRUPT;
    if (h->magic != BB_LAYOUT_MAGIC) return BB_ERR_CORRUPT;
    if (h->spec_major != BB_SPEC_VERSION_MAJOR) return BB_ERR_VERSION_MISMATCH;
    /* 0.x: every minor is its own layout. */
    if (BB_SPEC_VERSION_MAJOR == 0 && h->spec_minor != BB_SPEC_VERSION_MINOR) return BB_ERR_VERSION_MISMATCH;
    if (h->total_bytes != BB_LAYOUT_TOTAL_BYTES || mapped != BB_LAYOUT_TOTAL_BYTES ||
        h->header_bytes != sizeof(bb_shm_header) || h->max_endpoints != BB_MAX_ENDPOINTS ||
        h->max_outputs != BB_MAX_OUTPUTS || h->max_inputs != BB_MAX_INPUTS ||
        h->max_connections_per_input != BB_MAX_CONNECTIONS_PER_INPUT ||
        h->max_block_samples != BB_MAX_BLOCK_SAMPLES || h->output_slots != BB_OUTPUT_SLOTS ||
        h->endpoints_offset != BB_LAYOUT_ENDPOINTS_OFFSET || h->inputs_offset != BB_LAYOUT_INPUTS_OFFSET ||
        h->outputs_offset != BB_LAYOUT_OUTPUTS_OFFSET)
        return BB_ERR_CORRUPT;
    return BB_OK;
}

bb_bus* bb_bus_open(uint32_t spec_version, const char* bus_namespace, bb_error* err) {
    if ((spec_version >> 16) != BB_SPEC_VERSION_MAJOR ||
        (BB_SPEC_VERSION_MAJOR == 0 && (spec_version & 0xffffu) != BB_SPEC_VERSION_MINOR)) {
        bb_set_err(err, BB_ERR_VERSION_MISMATCH);
        return NULL;
    }
    const char* ns = bb_resolve_namespace(bus_namespace);
    if (!bb_valid_namespace(ns)) {
        bb_set_err(err, BB_ERR_INVALID_ARGUMENT);
        return NULL;
    }

    char name[64];
    bb_platform_shm_name(ns, name, sizeof(name));

    bb_shm_handle shm;
    int size_mismatch = 0;
    bb_error e = bb_platform_shm_open(name, (size_t)BB_LAYOUT_TOTAL_BYTES, &shm, &size_mismatch);
    if (e != BB_OK) {
        bb_set_err(err, e);
        return NULL;
    }
    bb_shm_header* hdr = (bb_shm_header*)shm.base;

    if (!size_mismatch && bb_cas32(&hdr->init_state, BB_INIT_EMPTY, BB_INIT_INITIALIZING)) {
        bb_init_header(hdr);
        bb_store32(&hdr->init_state, BB_INIT_READY);
    } else {
        unsigned waited = 0;
        while (shm.size >= sizeof(bb_shm_header) && bb_load32(&hdr->init_state) != BB_INIT_READY) {
            if (waited++ >= BB_INIT_TIMEOUT_MS) {
                bb_platform_shm_close(&shm);
                bb_set_err(err, BB_ERR_TIMEOUT);
                return NULL;
            }
            bb_platform_sleep_ms(1);
        }
    }

    e = bb_check_header(hdr, shm.size);
    if (e != BB_OK) {
        bb_platform_shm_close(&shm);
        bb_set_err(err, e);
        return NULL;
    }

    bb_bus* bus = (bb_bus*)calloc(1, sizeof(bb_bus));
    if (!bus) {
        bb_platform_shm_close(&shm);
        bb_set_err(err, BB_ERR_SHARED_MEMORY);
        return NULL;
    }
    bus->shm = shm;
    bus->hdr = hdr;
    bus->endpoints = (bb_shm_endpoint*)((char*)shm.base + hdr->endpoints_offset);
    bus->inputs = (bb_shm_input*)((char*)shm.base + hdr->inputs_offset);
    bus->outputs = (bb_shm_output*)((char*)shm.base + hdr->outputs_offset);
    bus->pid = bb_platform_pid();
    memcpy(bus->ns, ns, strlen(ns) + 1);
    bb_set_err(err, BB_OK);
    return bus;
}

void bb_bus_close(bb_bus* bus) {
    if (!bus) return;
    bb_platform_shm_close(&bus->shm);
    free(bus);
}

bb_error bb_bus_unlink(const char* bus_namespace) {
    const char* ns = bb_resolve_namespace(bus_namespace);
    if (!bb_valid_namespace(ns)) return BB_ERR_INVALID_ARGUMENT;
    char name[64];
    bb_platform_shm_name(ns, name, sizeof(name));
    return bb_platform_shm_unlink(name);
}

uint64_t bb_generate_uid(void) {
    uint64_t v;
    do {
        v = bb_platform_random64();
    } while (v == 0);
    return v;
}

static bb_error bb_lock(bb_bus* bus) {
    uint32_t* lock = &bus->hdr->registry_lock;
    uint64_t start = bb_platform_now_ns();
    unsigned spins = 0;
    while (!bb_cas32(lock, 0, bus->pid)) {
        uint32_t owner = bb_load32(lock);
        /* The holder crashed while holding the lock: take it over. */
        if (owner != 0 && owner != bus->pid && !bb_platform_pid_alive(owner)) {
            if (bb_cas32(lock, owner, bus->pid)) break;
        }
        if (++spins < 64) {
            bb_platform_yield();
        } else {
            bb_platform_sleep_ms(1);
            if (bb_platform_now_ns() - start > BB_LOCK_TIMEOUT_NS) return BB_ERR_TIMEOUT;
        }
    }
    return BB_OK;
}

static void bb_unlock(bb_bus* bus) { bb_store32(&bus->hdr->registry_lock, 0); }

/* ========================================================================
 * 3. Endpoints and ports (registry lock held unless noted)
 * ===================================================================== */

static void bb_free_input_locked(bb_shm_input* in) {
    uint32_t odd = bb_load32(&in->seq) | 1u;
    bb_store32(&in->seq, odd);
    bb_fence_release();
    memset(in->connections, 0, sizeof(in->connections));
    bb_store32(&in->seq, odd + 1u);
    bb_store32(&in->state, BB_SLOT_FREE);
}

static void bb_free_endpoint_locked(bb_bus* bus, uint32_t index) {
    for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
        bb_shm_output* o = &bus->outputs[i];
        if (bb_load32(&o->state) == BB_SLOT_ACTIVE && o->endpoint_index == index)
            bb_store32(&o->state, BB_SLOT_FREE);
    }
    for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i) {
        bb_shm_input* in = &bus->inputs[i];
        if (bb_load32(&in->state) == BB_SLOT_ACTIVE && in->endpoint_index == index)
            bb_free_input_locked(in);
    }
    bb_store32(&bus->endpoints[index].state, BB_SLOT_FREE);
    bb_inc32(&bus->hdr->registry_generation);
    bb_inc32(&bus->hdr->connection_generation);
}

/* Reclaims endpoints whose owning process no longer exists. */
static void bb_reap_dead_locked(bb_bus* bus) {
    for (uint32_t i = 0; i < BB_MAX_ENDPOINTS; ++i) {
        bb_shm_endpoint* e = &bus->endpoints[i];
        if (bb_load32(&e->state) != BB_SLOT_ACTIVE) continue;
        if (e->pid != bus->pid && !bb_platform_pid_alive(e->pid)) bb_free_endpoint_locked(bus, i);
    }
}

static int bb_find_endpoint_locked(bb_bus* bus, uint64_t uid) {
    for (uint32_t i = 0; i < BB_MAX_ENDPOINTS; ++i) {
        bb_shm_endpoint* e = &bus->endpoints[i];
        if (bb_load32(&e->state) == BB_SLOT_ACTIVE && bb_load64(&e->uid) == uid) return (int)i;
    }
    return -1;
}

static int bb_find_input_locked(bb_bus* bus, uint32_t endpoint_index, const char* name) {
    for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i) {
        bb_shm_input* in = &bus->inputs[i];
        if (bb_load32(&in->state) == BB_SLOT_ACTIVE && in->endpoint_index == endpoint_index &&
            strncmp(in->name, name, BB_PORT_NAME_BYTES) == 0)
            return (int)i;
    }
    return -1;
}

static int bb_find_output_locked(bb_bus* bus, uint64_t endpoint_uid, const char* name) {
    for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
        bb_shm_output* o = &bus->outputs[i];
        if (bb_load32(&o->state) == BB_SLOT_ACTIVE && bb_load64(&o->endpoint_uid) == endpoint_uid &&
            strncmp(o->name, name, BB_PORT_NAME_BYTES) == 0)
            return (int)i;
    }
    return -1;
}

bb_endpoint* bb_register_instance(bb_bus* bus, const bb_instance_info* info, bb_error* err) {
    if (!bus || !info || info->struct_size < sizeof(bb_instance_info)) {
        bb_set_err(err, BB_ERR_INVALID_ARGUMENT);
        return NULL;
    }
    bb_endpoint* ep = (bb_endpoint*)calloc(1, sizeof(bb_endpoint));
    if (!ep) {
        bb_set_err(err, BB_ERR_FULL);
        return NULL;
    }
    bb_error e = bb_lock(bus);
    if (e != BB_OK) {
        free(ep);
        bb_set_err(err, e);
        return NULL;
    }
    bb_reap_dead_locked(bus);

    bb_error result = BB_OK;
    uint64_t uid = info->uid;
    if (uid != 0 && bb_find_endpoint_locked(bus, uid) >= 0) result = BB_ERR_UID_IN_USE;
    if (uid == 0 || result == BB_ERR_UID_IN_USE) {
        do {
            uid = bb_generate_uid();
        } while (bb_find_endpoint_locked(bus, uid) >= 0);
    }

    int index = -1;
    for (uint32_t i = 0; i < BB_MAX_ENDPOINTS; ++i) {
        if (bb_load32(&bus->endpoints[i].state) == BB_SLOT_FREE) {
            index = (int)i;
            break;
        }
    }
    if (index < 0) {
        bb_unlock(bus);
        free(ep);
        bb_set_err(err, BB_ERR_FULL);
        return NULL;
    }

    bb_shm_endpoint* rec = &bus->endpoints[index];
    rec->pid = bus->pid;
    bb_store64(&rec->uid, uid);
    bb_store32(&rec->patch_version, 0);
    bb_store64(&rec->last_block_ns, 0);
    bb_copy_display(rec->display_name, sizeof(rec->display_name), info->display_name);
    bb_copy_display(rec->track_name, sizeof(rec->track_name), info->track_name);
    bb_copy_display(rec->vendor, sizeof(rec->vendor), info->vendor);
    bb_copy_display(rec->product, sizeof(rec->product), info->product);
    bb_store32(&rec->state, BB_SLOT_ACTIVE);
    bb_inc32(&bus->hdr->registry_generation);
    bb_unlock(bus);

    ep->bus = bus;
    ep->index = (uint32_t)index;
    ep->uid = uid;
    bb_set_err(err, result);
    return ep;
}

void bb_unregister_instance(bb_endpoint* ep) {
    if (!ep) return;
    bb_bus* bus = ep->bus;
    if (bb_lock(bus) == BB_OK) {
        bb_shm_endpoint* rec = &bus->endpoints[ep->index];
        if (bb_load32(&rec->state) == BB_SLOT_ACTIVE && bb_load64(&rec->uid) == ep->uid)
            bb_free_endpoint_locked(bus, ep->index);
        bb_unlock(bus);
    }
    for (uint32_t i = 0; i < ep->num_outputs; ++i) free(ep->outputs[i]);
    for (uint32_t i = 0; i < ep->num_inputs; ++i) free(ep->inputs[i]);
    free(ep);
}

uint64_t bb_endpoint_uid(const bb_endpoint* ep) { return ep ? ep->uid : 0; }

bb_bus* bb_endpoint_bus(const bb_endpoint* ep) { return ep ? ep->bus : NULL; }

uint32_t bb_endpoint_patch_version(const bb_endpoint* ep) {
    return ep ? bb_load32(&ep->bus->endpoints[ep->index].patch_version) : 0;
}

/* The endpoint record still belongs to this handle (not reaped or reused). */
static int bb_owns_record_locked(const bb_endpoint* ep) {
    const bb_shm_endpoint* rec = &ep->bus->endpoints[ep->index];
    return bb_load32(&rec->state) == BB_SLOT_ACTIVE && bb_load64(&rec->uid) == ep->uid;
}

bb_error bb_set_instance_uid(bb_endpoint* ep, uint64_t uid) {
    if (!ep || uid == 0) return BB_ERR_INVALID_ARGUMENT;
    if (uid == ep->uid) return BB_OK;
    bb_bus* bus = ep->bus;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) return e;
    if (!bb_owns_record_locked(ep)) {
        bb_unlock(bus);
        return BB_ERR_NOT_FOUND;
    }
    bb_reap_dead_locked(bus);
    if (bb_find_endpoint_locked(bus, uid) >= 0) {
        bb_unlock(bus);
        return BB_ERR_UID_IN_USE;
    }
    bb_store64(&bus->endpoints[ep->index].uid, uid);
    for (uint32_t i = 0; i < ep->num_outputs; ++i)
        bb_store64(&bus->outputs[ep->outputs[i]->index].endpoint_uid, uid);
    ep->uid = uid;
    bb_inc32(&bus->hdr->registry_generation);
    bb_unlock(bus);
    return BB_OK;
}

static bb_error bb_set_endpoint_string(bb_endpoint* ep, int which, const char* value) {
    if (!ep) return BB_ERR_INVALID_ARGUMENT;
    bb_bus* bus = ep->bus;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) return e;
    if (!bb_owns_record_locked(ep)) {
        bb_unlock(bus);
        return BB_ERR_NOT_FOUND;
    }
    bb_shm_endpoint* rec = &bus->endpoints[ep->index];
    if (which == 0)
        bb_copy_display(rec->display_name, sizeof(rec->display_name), value);
    else
        bb_copy_display(rec->track_name, sizeof(rec->track_name), value);
    bb_inc32(&bus->hdr->registry_generation);
    bb_unlock(bus);
    return BB_OK;
}

bb_error bb_set_instance_name(bb_endpoint* ep, const char* display_name) {
    return bb_set_endpoint_string(ep, 0, display_name);
}

bb_error bb_set_track_name(bb_endpoint* ep, const char* track_name) {
    return bb_set_endpoint_string(ep, 1, track_name);
}

bb_output* bb_add_output(bb_endpoint* ep, const char* name, bb_signal_type type, bb_polarity polarity,
                         bb_error* err) {
    if (!ep || !bb_valid_port_name(name) || (unsigned)type > BB_SIGNAL_PITCH ||
        (unsigned)polarity > BB_POLARITY_UNIPOLAR) {
        bb_set_err(err, BB_ERR_INVALID_ARGUMENT);
        return NULL;
    }
    if (ep->num_outputs >= BB_MAX_PORTS_PER_ENDPOINT) {
        bb_set_err(err, BB_ERR_FULL);
        return NULL;
    }
    for (uint32_t i = 0; i < ep->num_outputs; ++i) {
        if (strcmp(ep->bus->outputs[ep->outputs[i]->index].name, name) == 0) {
            bb_set_err(err, BB_ERR_ALREADY_EXISTS);
            return NULL;
        }
    }
    bb_output* out = (bb_output*)calloc(1, sizeof(bb_output));
    if (!out) {
        bb_set_err(err, BB_ERR_FULL);
        return NULL;
    }
    bb_bus* bus = ep->bus;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) {
        free(out);
        bb_set_err(err, e);
        return NULL;
    }
    int index = -1;
    if (bb_owns_record_locked(ep)) {
        for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
            if (bb_load32(&bus->outputs[i].state) == BB_SLOT_FREE) {
                index = (int)i;
                break;
            }
        }
    }
    if (index < 0) {
        bb_unlock(bus);
        free(out);
        bb_set_err(err, bb_owns_record_locked(ep) ? BB_ERR_FULL : BB_ERR_NOT_FOUND);
        return NULL;
    }
    bb_shm_output* rec = &bus->outputs[index];
    rec->endpoint_index = ep->index;
    bb_store64(&rec->endpoint_uid, ep->uid);
    rec->name_hash = bb_fnv1a64(name);
    bb_store64(&rec->blocks_written, 0);
    bb_inc32(&rec->incarnation);
    rec->signal_type = (uint32_t)type;
    rec->polarity = (uint32_t)polarity;
    bb_copy_display(rec->name, sizeof(rec->name), name);
    bb_store32(&rec->state, BB_SLOT_ACTIVE);
    bb_inc32(&bus->hdr->registry_generation);
    bb_unlock(bus);

    out->ep = ep;
    out->index = (uint32_t)index;
    ep->outputs[ep->num_outputs++] = out;
    bb_set_err(err, BB_OK);
    return out;
}

bb_input* bb_add_input(bb_endpoint* ep, const char* name, bb_signal_type type, bb_error* err) {
    if (!ep || !bb_valid_port_name(name) || (unsigned)type > BB_SIGNAL_PITCH) {
        bb_set_err(err, BB_ERR_INVALID_ARGUMENT);
        return NULL;
    }
    if (ep->num_inputs >= BB_MAX_PORTS_PER_ENDPOINT) {
        bb_set_err(err, BB_ERR_FULL);
        return NULL;
    }
    for (uint32_t i = 0; i < ep->num_inputs; ++i) {
        if (strcmp(ep->bus->inputs[ep->inputs[i]->index].name, name) == 0) {
            bb_set_err(err, BB_ERR_ALREADY_EXISTS);
            return NULL;
        }
    }
    bb_input* in = (bb_input*)calloc(1, sizeof(bb_input));
    if (!in) {
        bb_set_err(err, BB_ERR_FULL);
        return NULL;
    }
    bb_bus* bus = ep->bus;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) {
        free(in);
        bb_set_err(err, e);
        return NULL;
    }
    int index = -1;
    if (bb_owns_record_locked(ep)) {
        for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i) {
            if (bb_load32(&bus->inputs[i].state) == BB_SLOT_FREE) {
                index = (int)i;
                break;
            }
        }
    }
    if (index < 0) {
        bb_unlock(bus);
        free(in);
        bb_set_err(err, bb_owns_record_locked(ep) ? BB_ERR_FULL : BB_ERR_NOT_FOUND);
        return NULL;
    }
    bb_shm_input* rec = &bus->inputs[index];
    uint32_t seq = bb_load32(&rec->seq) | 1u; /* odd while we reset the record */
    bb_store32(&rec->seq, seq);
    bb_fence_release();
    rec->endpoint_index = ep->index;
    rec->name_hash = bb_fnv1a64(name);
    rec->signal_type = (uint32_t)type;
    bb_copy_display(rec->name, sizeof(rec->name), name);
    memset(rec->connections, 0, sizeof(rec->connections));
    bb_store32(&rec->seq, seq + 1u);
    bb_store32(&rec->state, BB_SLOT_ACTIVE);
    bb_inc32(&bus->hdr->registry_generation);
    bb_unlock(bus);

    in->ep = ep;
    in->index = (uint32_t)index;
    in->cached_seq = 1u; /* odd: forces the first identity load */
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) in->cache[c].out_index = -1;
    ep->inputs[ep->num_inputs++] = in;
    bb_set_err(err, BB_OK);
    return in;
}

/* ========================================================================
 * 4. Audio thread (RT: no locks, no allocation)
 * ===================================================================== */

void bb_begin_block(bb_endpoint* ep, const bb_block_info* info) {
    if (!ep || !info) return;
    if (ep->in_block) bb_end_block(ep);
    ep->prev = ep->cur;
    ep->cur.valid = 1;
    ep->cur.pos = info->transport_sample_pos;
    ep->cur.num_samples = info->num_samples > BB_MAX_BLOCK_SAMPLES ? BB_MAX_BLOCK_SAMPLES : info->num_samples;
    ep->cur.flags = info->flags;
    ep->cur.sample_rate = info->sample_rate;
    ep->cur.time_ns = info->host_time_ns ? info->host_time_ns : bb_platform_now_ns();
    ep->in_block = 1;
    for (uint32_t i = 0; i < ep->num_outputs; ++i) ep->outputs[i]->written = 0;
    bb_store64(&ep->bus->endpoints[ep->index].last_block_ns, ep->cur.time_ns);
}

void bb_write_output(bb_output* out, const float* samples, uint32_t num_samples) {
    if (!out || !out->ep->in_block) return;
    bb_endpoint* ep = out->ep;
    bb_shm_output* rec = &ep->bus->outputs[out->index];
    uint32_t n = ep->cur.num_samples;
    if (num_samples < n) n = num_samples;

    /* Only this endpoint writes blocks_written, so a plain read is exact. */
    uint64_t written = bb_load64(&rec->blocks_written);
    uint64_t k = out->written ? written - 1 : written;
    bb_shm_output_slot* slot = &rec->slots[k % BB_OUTPUT_SLOTS];

    uint32_t seq = bb_load32_relaxed(&slot->seq);
    bb_store32_relaxed(&slot->seq, seq + 1u); /* odd: being written */
    bb_fence_release();
    slot->num_samples = ep->cur.num_samples;
    slot->flags = (ep->cur.flags & BB_BLOCK_PLAYING) ? BB_SLOT_FLAG_PLAYING : 0u;
    slot->transport_sample_pos = ep->cur.pos;
    slot->time_ns = ep->cur.time_ns;
    slot->block_index = k;
    memcpy(slot->samples, samples ? samples : bb_zeros, n * sizeof(float));
    if (n < ep->cur.num_samples) {
        /* Short write: hold the last sample to the end of the block. */
        float last = n > 0 ? slot->samples[n - 1] : 0.0f;
        for (uint32_t i = n; i < ep->cur.num_samples; ++i) slot->samples[i] = last;
    }
    bb_store32(&slot->seq, seq + 2u);

    if (!out->written) {
        bb_store64(&rec->blocks_written, written + 1u);
        out->written = 1;
    }
}

void bb_end_block(bb_endpoint* ep) {
    if (!ep || !ep->in_block) return;
    for (uint32_t i = 0; i < ep->num_outputs; ++i) {
        bb_output* out = ep->outputs[i];
        if (!out->written) bb_write_output(out, bb_zeros, ep->cur.num_samples);
    }
    ep->in_block = 0;
}

/* Reloads cable identities when the input's seqlock moved. Returns 0 if the
 * record is being modified right now (keep the old cache for this block). */
static int bb_refresh_identities(bb_input* in, bb_shm_input* rec) {
    uint32_t seq = bb_load32(&rec->seq);
    if (seq == in->cached_seq) return 1;
    if (seq & 1u) return 0;
    bb_conn_cache next[BB_MAX_CONNECTIONS_PER_INPUT];
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        const bb_shm_connection* conn = &rec->connections[c];
        next[c].active = conn->state == BB_SLOT_ACTIVE;
        next[c].uid = conn->source_uid;
        next[c].hash = conn->output_hash;
    }
    bb_fence_acquire();
    if (bb_load32_relaxed(&rec->seq) != seq) return 0;
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        bb_conn_cache* cc = &in->cache[c];
        int same = cc->active && next[c].active && cc->uid == next[c].uid && cc->hash == next[c].hash;
        if (!same) {
            cc->active = next[c].active;
            cc->uid = next[c].uid;
            cc->hash = next[c].hash;
            cc->out_index = -1;
            cc->held = 0.0f;
        }
    }
    in->cached_seq = seq;
    in->cached_generation = bb_load32(&in->ep->bus->hdr->registry_generation) - 1u; /* force resolve */
    return 1;
}

/* Maps every active cable to an output index. Bounded scan, no allocation. */
static void bb_resolve(bb_input* in, uint32_t generation) {
    bb_bus* bus = in->ep->bus;
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        bb_conn_cache* cc = &in->cache[c];
        if (!cc->active) continue;
        cc->out_index = -1;
        for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
            bb_shm_output* o = &bus->outputs[i];
            if (bb_load32(&o->state) != BB_SLOT_ACTIVE) continue;
            if (o->name_hash != cc->hash || bb_load64(&o->endpoint_uid) != cc->uid) continue;
            cc->out_index = (int32_t)i;
            cc->out_incarnation = bb_load32(&o->incarnation);
            break;
        }
    }
    in->cached_generation = generation;
}

/* Reads a slot's stamp consistently. Returns 0 if the slot is being written. */
static int bb_read_stamp(const bb_shm_output_slot* slot, uint64_t* block_index, int64_t* pos, uint32_t* flags,
                         uint64_t* time_ns) {
    uint32_t s1 = bb_load32(&slot->seq);
    if (s1 & 1u) return 0;
    *block_index = slot->block_index;
    *pos = slot->transport_sample_pos;
    *flags = slot->flags;
    *time_ns = slot->time_ns;
    bb_fence_acquire();
    return bb_load32_relaxed(&slot->seq) == s1;
}

/* Picks the block of `o` this reader should see. Returns -1 if none. */
static int64_t bb_select_block(const bb_endpoint* ep, const bb_shm_output* o) {
    uint64_t w = bb_load64(&o->blocks_written);
    if (w == 0) return -1;
    uint64_t oldest = w > (BB_OUTPUT_SLOTS - 1) ? w - (BB_OUTPUT_SLOTS - 1) : 0;

    /* Rule 1 (transport running): the block stamped with our previous position. */
    if (ep->prev.valid && (ep->prev.flags & BB_BLOCK_PLAYING) && (ep->cur.flags & BB_BLOCK_PLAYING)) {
        for (uint64_t k = w; k-- > oldest;) {
            uint64_t idx;
            int64_t pos;
            uint32_t flags;
            uint64_t t;
            if (!bb_read_stamp(&o->slots[k % BB_OUTPUT_SLOTS], &idx, &pos, &flags, &t)) continue;
            if (idx == k && (flags & BB_SLOT_FLAG_PLAYING) && pos == ep->prev.pos) return (int64_t)k;
        }
    }

    /* Rule 2 (fallback): the newest block that began at least half a block
     * before ours, i.e. one that belongs to an earlier processing cycle. */
    uint64_t guard_ns = 1000000u;
    if (ep->cur.sample_rate > 0.0)
        guard_ns = (uint64_t)(0.5e9 * (double)ep->cur.num_samples / ep->cur.sample_rate);
    for (uint64_t k = w; k-- > oldest;) {
        uint64_t idx;
        int64_t pos;
        uint32_t flags;
        uint64_t t;
        if (!bb_read_stamp(&o->slots[k % BB_OUTPUT_SLOTS], &idx, &pos, &flags, &t)) continue;
        if (idx == k && t + guard_ns <= ep->cur.time_ns) return (int64_t)k;
    }
    return -1;
}

uint32_t bb_read_input(bb_input* in, float* dest, uint32_t num_samples) {
    if (!in || !dest) return 0;
    bb_endpoint* ep = in->ep;
    bb_bus* bus = ep->bus;
    uint32_t n = num_samples > BB_MAX_BLOCK_SAMPLES ? BB_MAX_BLOCK_SAMPLES : num_samples;
    for (uint32_t i = 0; i < num_samples; ++i) dest[i] = 0.0f;

    bb_shm_input* rec = &bus->inputs[in->index];
    bb_refresh_identities(in, rec);
    uint32_t generation = bb_load32(&bus->hdr->registry_generation);
    if (generation != in->cached_generation) bb_resolve(in, generation);

    uint32_t present = 0;
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        bb_conn_cache* cc = &in->cache[c];
        if (!cc->active || cc->out_index < 0) continue;
        const bb_shm_output* o = &bus->outputs[cc->out_index];
        if (bb_load32(&o->state) != BB_SLOT_ACTIVE || bb_load32(&o->incarnation) != cc->out_incarnation ||
            bb_load64(&o->endpoint_uid) != cc->uid)
            continue; /* stale; re-resolved when the generation moves */
        ++present;

        float amount = bb_bits_float(bb_load32(&rec->connections[c].amount_bits));
        int64_t k = bb_select_block(ep, o);
        uint32_t copied = 0;
        if (k >= 0) {
            const bb_shm_output_slot* slot = &o->slots[(uint64_t)k % BB_OUTPUT_SLOTS];
            uint32_t s1 = bb_load32(&slot->seq);
            uint32_t avail = slot->num_samples;
            if (avail > BB_MAX_BLOCK_SAMPLES) avail = BB_MAX_BLOCK_SAMPLES;
            copied = avail < n ? avail : n;
            if (!(s1 & 1u)) memcpy(in->scratch, slot->samples, copied * sizeof(float));
            bb_fence_acquire();
            if ((s1 & 1u) || bb_load32_relaxed(&slot->seq) != s1 || slot->block_index != (uint64_t)k) copied = 0;
        }
        for (uint32_t i = 0; i < copied; ++i) dest[i] += in->scratch[i] * amount;
        if (copied > 0) cc->held = in->scratch[copied - 1];
        for (uint32_t i = copied; i < n; ++i) dest[i] += cc->held * amount;
    }
    return present;
}

/* ========================================================================
 * 5. Connections and discovery
 * ===================================================================== */

static bb_error bb_locate_input_locked(bb_bus* bus, uint64_t dst_uid, const char* input_name,
                                       bb_shm_input** out_rec, int* out_endpoint) {
    int ei = bb_find_endpoint_locked(bus, dst_uid);
    if (ei < 0) return BB_ERR_NOT_FOUND;
    int ii = bb_find_input_locked(bus, (uint32_t)ei, input_name);
    if (ii < 0) return BB_ERR_NOT_FOUND;
    *out_rec = &bus->inputs[ii];
    *out_endpoint = ei;
    return BB_OK;
}

static void bb_touch_connections_locked(bb_bus* bus, int endpoint_index) {
    bb_inc32(&bus->endpoints[endpoint_index].patch_version);
    bb_inc32(&bus->hdr->connection_generation);
}

bb_error bb_connect(bb_bus* bus, uint64_t dst_uid, const char* input_name, uint64_t src_uid,
                    const char* output_name, float amount) {
    if (!bus || dst_uid == 0 || src_uid == 0 || !bb_valid_port_name(input_name) ||
        !bb_valid_port_name(output_name) || amount != amount)
        return BB_ERR_INVALID_ARGUMENT;
    if (amount > BB_AMOUNT_LIMIT) amount = BB_AMOUNT_LIMIT;
    if (amount < -BB_AMOUNT_LIMIT) amount = -BB_AMOUNT_LIMIT;

    bb_error e = bb_lock(bus);
    if (e != BB_OK) return e;
    bb_shm_input* rec;
    int ei;
    e = bb_locate_input_locked(bus, dst_uid, input_name, &rec, &ei);
    if (e != BB_OK) {
        bb_unlock(bus);
        return e;
    }
    int free_slot = -1;
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        bb_shm_connection* conn = &rec->connections[c];
        if (conn->state != BB_SLOT_ACTIVE) {
            if (free_slot < 0) free_slot = (int)c;
            continue;
        }
        if (conn->source_uid == src_uid && strcmp(conn->output_name, output_name) == 0) {
            /* Amount changes need no seqlock: readers load it atomically. */
            bb_store32(&conn->amount_bits, bb_float_bits(amount));
            bb_touch_connections_locked(bus, ei);
            bb_unlock(bus);
            return BB_OK;
        }
    }
    if (free_slot < 0) {
        bb_unlock(bus);
        return BB_ERR_FULL;
    }
    bb_shm_connection* conn = &rec->connections[free_slot];
    uint32_t seq = bb_load32(&rec->seq);
    bb_store32(&rec->seq, seq + 1u);
    bb_fence_release();
    conn->source_uid = src_uid;
    conn->output_hash = bb_fnv1a64(output_name);
    bb_copy_display(conn->output_name, sizeof(conn->output_name), output_name);
    bb_store32(&conn->amount_bits, bb_float_bits(amount));
    conn->state = BB_SLOT_ACTIVE;
    bb_store32(&rec->seq, seq + 2u);
    bb_touch_connections_locked(bus, ei);
    bb_unlock(bus);
    return BB_OK;
}

static bb_error bb_disconnect_impl(bb_bus* bus, uint64_t dst_uid, const char* input_name, uint64_t src_uid,
                                   const char* output_name, int all) {
    if (!bus || !bb_valid_port_name(input_name) || (!all && !bb_valid_port_name(output_name)))
        return BB_ERR_INVALID_ARGUMENT;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) return e;
    bb_shm_input* rec;
    int ei;
    e = bb_locate_input_locked(bus, dst_uid, input_name, &rec, &ei);
    if (e != BB_OK) {
        bb_unlock(bus);
        return e;
    }
    uint32_t seq = bb_load32(&rec->seq);
    bb_store32(&rec->seq, seq + 1u);
    bb_fence_release();
    int removed = 0;
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        bb_shm_connection* conn = &rec->connections[c];
        if (conn->state != BB_SLOT_ACTIVE) continue;
        if (all || (conn->source_uid == src_uid && strcmp(conn->output_name, output_name) == 0)) {
            memset(conn, 0, sizeof(*conn));
            ++removed;
        }
    }
    bb_store32(&rec->seq, seq + 2u);
    if (removed) bb_touch_connections_locked(bus, ei);
    bb_unlock(bus);
    return (removed || all) ? BB_OK : BB_ERR_NOT_FOUND;
}

bb_error bb_disconnect(bb_bus* bus, uint64_t dst_uid, const char* input_name, uint64_t src_uid,
                       const char* output_name) {
    return bb_disconnect_impl(bus, dst_uid, input_name, src_uid, output_name, 0);
}

bb_error bb_disconnect_all(bb_bus* bus, uint64_t dst_uid, const char* input_name) {
    return bb_disconnect_impl(bus, dst_uid, input_name, 0, NULL, 1);
}

uint32_t bb_list_endpoints(bb_bus* bus, bb_endpoint_info* dest, uint32_t capacity) {
    if (!bus || bb_lock(bus) != BB_OK) return 0;
    uint32_t count = 0;
    for (uint32_t i = 0; i < BB_MAX_ENDPOINTS; ++i) {
        const bb_shm_endpoint* e = &bus->endpoints[i];
        if (bb_load32(&e->state) != BB_SLOT_ACTIVE) continue;
        if (dest && count < capacity) {
            bb_endpoint_info* d = &dest[count];
            memset(d, 0, sizeof(*d));
            d->uid = bb_load64(&e->uid);
            d->pid = e->pid;
            memcpy(d->display_name, e->display_name, sizeof(d->display_name));
            memcpy(d->track_name, e->track_name, sizeof(d->track_name));
            memcpy(d->vendor, e->vendor, sizeof(d->vendor));
            memcpy(d->product, e->product, sizeof(d->product));
            for (uint32_t o = 0; o < BB_MAX_OUTPUTS; ++o)
                if (bb_load32(&bus->outputs[o].state) == BB_SLOT_ACTIVE && bus->outputs[o].endpoint_index == i)
                    ++d->num_outputs;
            for (uint32_t n = 0; n < BB_MAX_INPUTS; ++n)
                if (bb_load32(&bus->inputs[n].state) == BB_SLOT_ACTIVE && bus->inputs[n].endpoint_index == i)
                    ++d->num_inputs;
        }
        ++count;
    }
    bb_unlock(bus);
    return count;
}

uint32_t bb_list_outputs(bb_bus* bus, bb_output_info* dest, uint32_t capacity) {
    if (!bus || bb_lock(bus) != BB_OK) return 0;
    uint32_t count = 0;
    for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
        const bb_shm_output* o = &bus->outputs[i];
        if (bb_load32(&o->state) != BB_SLOT_ACTIVE) continue;
        if (dest && count < capacity) {
            bb_output_info* d = &dest[count];
            const bb_shm_endpoint* e = &bus->endpoints[o->endpoint_index];
            memset(d, 0, sizeof(*d));
            d->endpoint_uid = bb_load64(&o->endpoint_uid);
            d->type = (bb_signal_type)o->signal_type;
            d->polarity = (bb_polarity)o->polarity;
            memcpy(d->name, o->name, sizeof(d->name));
            memcpy(d->endpoint_name, e->display_name, sizeof(d->endpoint_name));
            memcpy(d->track_name, e->track_name, sizeof(d->track_name));
        }
        ++count;
    }
    bb_unlock(bus);
    return count;
}

uint32_t bb_list_inputs(bb_bus* bus, uint64_t endpoint_uid, bb_input_info* dest, uint32_t capacity) {
    if (!bus || bb_lock(bus) != BB_OK) return 0;
    uint32_t count = 0;
    int ei = bb_find_endpoint_locked(bus, endpoint_uid);
    for (uint32_t i = 0; ei >= 0 && i < BB_MAX_INPUTS; ++i) {
        const bb_shm_input* in = &bus->inputs[i];
        if (bb_load32(&in->state) != BB_SLOT_ACTIVE || in->endpoint_index != (uint32_t)ei) continue;
        if (dest && count < capacity) {
            bb_input_info* d = &dest[count];
            memset(d, 0, sizeof(*d));
            d->endpoint_uid = endpoint_uid;
            d->type = (bb_signal_type)in->signal_type;
            memcpy(d->name, in->name, sizeof(d->name));
            for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c)
                if (in->connections[c].state == BB_SLOT_ACTIVE) ++d->num_connections;
        }
        ++count;
    }
    bb_unlock(bus);
    return count;
}

uint32_t bb_list_connections(bb_bus* bus, uint64_t endpoint_uid, const char* input_name, bb_connection_info* dest,
                             uint32_t capacity) {
    if (!bus || !bb_valid_port_name(input_name) || bb_lock(bus) != BB_OK) return 0;
    uint32_t count = 0;
    bb_shm_input* rec;
    int ei;
    if (bb_locate_input_locked(bus, endpoint_uid, input_name, &rec, &ei) == BB_OK) {
        for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
            const bb_shm_connection* conn = &rec->connections[c];
            if (conn->state != BB_SLOT_ACTIVE) continue;
            if (dest && count < capacity) {
                bb_connection_info* d = &dest[count];
                memset(d, 0, sizeof(*d));
                d->source_uid = conn->source_uid;
                d->amount = bb_bits_float(bb_load32(&conn->amount_bits));
                memcpy(d->output_name, conn->output_name, sizeof(d->output_name));
                d->source_present = bb_find_output_locked(bus, conn->source_uid, conn->output_name) >= 0;
            }
            ++count;
        }
    }
    bb_unlock(bus);
    return count;
}

uint32_t bb_registry_generation(const bb_bus* bus) { return bus ? bb_load32(&bus->hdr->registry_generation) : 0; }

uint32_t bb_connection_generation(const bb_bus* bus) {
    return bus ? bb_load32(&bus->hdr->connection_generation) : 0;
}

uint32_t bb_peek_output(bb_bus* bus, uint64_t endpoint_uid, const char* output_name, float* dest,
                        uint32_t capacity) {
    if (!bus || !dest || !bb_valid_port_name(output_name) || bb_lock(bus) != BB_OK) return 0;
    int oi = bb_find_output_locked(bus, endpoint_uid, output_name);
    bb_unlock(bus);
    if (oi < 0) return 0;
    const bb_shm_output* o = &bus->outputs[oi];
    for (int attempt = 0; attempt < 4; ++attempt) {
        uint64_t w = bb_load64(&o->blocks_written);
        if (w == 0) return 0;
        const bb_shm_output_slot* slot = &o->slots[(w - 1) % BB_OUTPUT_SLOTS];
        uint32_t s1 = bb_load32(&slot->seq);
        if (s1 & 1u) continue;
        uint32_t n = slot->num_samples;
        if (n > BB_MAX_BLOCK_SAMPLES) n = BB_MAX_BLOCK_SAMPLES;
        if (n > capacity) n = capacity;
        memcpy(dest, slot->samples, n * sizeof(float));
        bb_fence_acquire();
        if (bb_load32_relaxed(&slot->seq) == s1) return n;
    }
    return 0;
}

/* ========================================================================
 * 6. State persistence
 *
 * Text format, one cable per line, fields separated by TAB:
 *   bleep-bus-connections 1
 *   <input name> \t <source uid, 16 lowercase hex digits> \t <output name> \t <amount>
 * The amount is written as [-]digits.digits (six fraction digits) and read
 * without the C locale functions, so it is stable across user locales.
 * ===================================================================== */

#define BB_STATE_HEADER "bleep-bus-connections 1\n"

static size_t bb_format_amount(char* dst, float amount) {
    char tmp[48];
    size_t n = 0;
    double v = amount;
    if (v < 0) {
        dst[n++] = '-';
        v = -v;
    }
    uint64_t scaled = (uint64_t)(v * 1000000.0 + 0.5);
    uint64_t ip = scaled / 1000000u, fp = scaled % 1000000u;
    size_t t = 0;
    do {
        tmp[t++] = (char)('0' + ip % 10u);
        ip /= 10u;
    } while (ip);
    while (t) dst[n++] = tmp[--t];
    dst[n++] = '.';
    for (int d = 5; d >= 0; --d) {
        uint64_t p = 1;
        for (int j = 0; j < d; ++j) p *= 10u;
        dst[n++] = (char)('0' + (fp / p) % 10u);
    }
    return n;
}

static int bb_parse_amount(const char* s, const char* end, float* out) {
    int neg = 0;
    double v = 0.0, scale = 1.0;
    int digits = 0, frac = 0;
    if (s < end && (*s == '-' || *s == '+')) neg = (*s++ == '-');
    for (; s < end; ++s) {
        if (*s == '.' && !frac) {
            frac = 1;
        } else if (*s >= '0' && *s <= '9') {
            if (frac) {
                scale /= 10.0;
                v += (*s - '0') * scale;
            } else {
                v = v * 10.0 + (*s - '0');
            }
            ++digits;
        } else {
            return 0;
        }
    }
    if (!digits) return 0;
    *out = (float)(neg ? -v : v);
    return 1;
}

static size_t bb_append(char* buf, size_t cap, size_t pos, const char* s, size_t n) {
    if (pos + n < cap) memcpy(buf + pos, s, n);
    return pos + n;
}

size_t bb_save_connections(bb_endpoint* ep, void* out, size_t cap) {
    if (!ep) return 0;
    char* buf = (char*)out;
    if (!buf) cap = 0;
    bb_bus* bus = ep->bus;
    if (bb_lock(bus) != BB_OK) return 0;
    size_t pos = bb_append(buf, cap, 0, BB_STATE_HEADER, strlen(BB_STATE_HEADER));
    for (uint32_t i = 0; i < ep->num_inputs; ++i) {
        const bb_shm_input* rec = &bus->inputs[ep->inputs[i]->index];
        for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
            const bb_shm_connection* conn = &rec->connections[c];
            if (conn->state != BB_SLOT_ACTIVE) continue;
            char line[160];
            size_t n = 0;
            size_t len = strnlen(rec->name, BB_PORT_NAME_BYTES - 1);
            memcpy(line + n, rec->name, len);
            n += len;
            line[n++] = '\t';
            for (int shift = 60; shift >= 0; shift -= 4) line[n++] = "0123456789abcdef"[(conn->source_uid >> shift) & 0xfu];
            line[n++] = '\t';
            len = strnlen(conn->output_name, BB_PORT_NAME_BYTES - 1);
            memcpy(line + n, conn->output_name, len);
            n += len;
            line[n++] = '\t';
            n += bb_format_amount(line + n, bb_bits_float(bb_load32(&conn->amount_bits)));
            line[n++] = '\n';
            pos = bb_append(buf, cap, pos, line, n);
        }
    }
    bb_unlock(bus);
    if (pos + 1 <= cap) buf[pos] = '\0';
    return pos + 1;
}

typedef struct bb_saved_cable {
    char input[BB_PORT_NAME_BYTES];
    char output[BB_PORT_NAME_BYTES];
    uint64_t uid;
    float amount;
} bb_saved_cable;

static int bb_copy_field(char* dst, const char* s, const char* e) {
    size_t n = (size_t)(e - s);
    if (n == 0 || n >= BB_PORT_NAME_BYTES) return 0;
    memcpy(dst, s, n);
    dst[n] = '\0';
    return bb_valid_port_name(dst);
}

bb_error bb_load_connections(bb_endpoint* ep, const void* data, size_t len) {
    if (!ep || (!data && len)) return BB_ERR_INVALID_ARGUMENT;
    const char* p = (const char*)data;
    const char* end = p + len;
    while (end > p && end[-1] == '\0') --end; /* tolerate a stored NUL */

    size_t hlen = strlen(BB_STATE_HEADER);
    if ((size_t)(end - p) < hlen - 1 || memcmp(p, BB_STATE_HEADER, hlen - 1) != 0) return BB_ERR_PARSE;
    p += hlen - 1;
    if (p < end && *p == '\n') ++p;

    enum { MAX_CABLES = BB_MAX_PORTS_PER_ENDPOINT * BB_MAX_CONNECTIONS_PER_INPUT };
    bb_saved_cable* cables = (bb_saved_cable*)calloc(MAX_CABLES, sizeof(bb_saved_cable));
    if (!cables) return BB_ERR_FULL;
    size_t count = 0;
    while (p < end) {
        const char* eol = p;
        while (eol < end && *eol != '\n') ++eol;
        const char* line_end = (eol > p && eol[-1] == '\r') ? eol - 1 : eol;
        if (line_end > p) {
            const char* f[4];
            const char* fe[4];
            int nf = 0;
            const char* s = p;
            for (const char* q = p; q <= line_end && nf < 4; ++q) {
                if (q == line_end || *q == '\t') {
                    f[nf] = s;
                    fe[nf] = q;
                    ++nf;
                    s = q + 1;
                }
            }
            bb_saved_cable cable;
            int ok = nf == 4 && count < MAX_CABLES && (fe[1] - f[1]) == 16;
            ok = ok && bb_copy_field(cable.input, f[0], fe[0]) && bb_copy_field(cable.output, f[2], fe[2]);
            cable.uid = 0;
            for (const char* q = f[1]; ok && q < fe[1]; ++q) {
                int d = (*q >= '0' && *q <= '9') ? *q - '0' : (*q >= 'a' && *q <= 'f') ? *q - 'a' + 10 : -1;
                if (d < 0) ok = 0;
                cable.uid = (cable.uid << 4) | (uint64_t)(d < 0 ? 0 : d);
            }
            ok = ok && cable.uid != 0 && bb_parse_amount(f[3], fe[3], &cable.amount);
            if (!ok) {
                free(cables);
                return BB_ERR_PARSE;
            }
            cables[count++] = cable;
        }
        p = eol < end ? eol + 1 : end;
    }

    bb_bus* bus = ep->bus;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) {
        free(cables);
        return e;
    }
    for (uint32_t i = 0; i < ep->num_inputs; ++i) {
        bb_shm_input* rec = &bus->inputs[ep->inputs[i]->index];
        uint32_t seq = bb_load32(&rec->seq);
        bb_store32(&rec->seq, seq + 1u);
        bb_fence_release();
        memset(rec->connections, 0, sizeof(rec->connections));
        uint32_t slot = 0;
        for (size_t c = 0; c < count && slot < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
            if (strcmp(cables[c].input, rec->name) != 0) continue;
            bb_shm_connection* conn = &rec->connections[slot++];
            float amount = cables[c].amount;
            if (amount > BB_AMOUNT_LIMIT) amount = BB_AMOUNT_LIMIT;
            if (amount < -BB_AMOUNT_LIMIT) amount = -BB_AMOUNT_LIMIT;
            conn->source_uid = cables[c].uid;
            conn->output_hash = bb_fnv1a64(cables[c].output);
            memcpy(conn->output_name, cables[c].output, sizeof(conn->output_name));
            bb_store32(&conn->amount_bits, bb_float_bits(amount));
            conn->state = BB_SLOT_ACTIVE;
        }
        bb_store32(&rec->seq, seq + 2u);
    }
    /* Loading is the owner's own action: no patch_version bump (it would mark
     * a freshly loaded set as modified). Other viewers still refresh. */
    bb_inc32(&bus->hdr->connection_generation);
    bb_unlock(bus);
    free(cables);
    return BB_OK;
}
