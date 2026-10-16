/* SPDX-License-Identifier: MIT */
/* bb_bus.c — bus open/close and the registry lock. */
#include "bb_internal.h"

/* ========================================================================
 * Bus open/close and the registry lock
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

/* Called by a waiter after the init timeout. Succeeds for exactly one waiter
 * when the recorded initializer is dead (or never recorded itself): that
 * waiter claims the pid field, resets the header and publishes READY. */
static int bb_recover_init(bb_shm_header* h) {
    uint32_t holder = bb_load32(&h->reserved0);
    uint32_t me = bb_platform_pid();
    if (holder == me) return 0;
    if (holder != 0 && bb_platform_pid_alive(holder)) return 0;
    if (!bb_cas32(&h->reserved0, holder, me)) return 0; /* lost the race */
    /* Reset everything after init_state. init_state itself keeps its value so
     * that no other opener starts a second initialisation meanwhile. */
    size_t from = offsetof(bb_shm_header, init_state) + sizeof(uint32_t);
    memset((char*)h + from, 0, sizeof(bb_shm_header) - from);
    bb_store32(&h->reserved0, me);
    bb_init_header(h);
    bb_store32(&h->init_state, BB_INIT_READY);
    return 1;
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
        bb_store32(&hdr->reserved0, bb_platform_pid()); /* initializer pid, for crash recovery */
        bb_init_header(hdr);
        bb_store32(&hdr->init_state, BB_INIT_READY);
    } else {
        unsigned waited = 0;
        int retried = 0;
        while (shm.size >= sizeof(bb_shm_header) && bb_load32(&hdr->init_state) != BB_INIT_READY) {
            if (waited++ >= BB_INIT_TIMEOUT_MS) {
                /* The initializer may have crashed: if its process is gone, one
                 * waiter takes over and re-initialises the header. Otherwise
                 * (alive, or another waiter is recovering) wait one more round. */
                if (!size_mismatch && !retried) {
                    retried = 1;
                    if (bb_recover_init(hdr)) break;
                    waited = 0;
                    continue;
                }
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
    /* Use the compile-time layout constants, not hdr->*_offset: bb_check_header
     * validated those values, but a hostile peer could rewrite them in shared
     * memory between the check and now (double fetch). */
    bus->endpoints = (bb_shm_endpoint*)((char*)shm.base + BB_LAYOUT_ENDPOINTS_OFFSET);
    bus->inputs = (bb_shm_input*)((char*)shm.base + BB_LAYOUT_INPUTS_OFFSET);
    bus->outputs = (bb_shm_output*)((char*)shm.base + BB_LAYOUT_OUTPUTS_OFFSET);
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

bb_error bb_lock(bb_bus* bus) {
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

void bb_unlock(bb_bus* bus) { bb_store32(&bus->hdr->registry_lock, 0); }

