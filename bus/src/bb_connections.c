/* SPDX-License-Identifier: MIT */
/* bb_connections.c — connections and discovery. */
#include "bb_internal.h"

/* ========================================================================
 * Connections and discovery
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
        if (conn->source_uid == src_uid && strncmp(conn->output_name, output_name, BB_PORT_NAME_BYTES) == 0) {
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
    uint32_t seq = bb_load32(&rec->seq) | 1u; /* odd while changing, even if a writer died mid-update */
    bb_store32(&rec->seq, seq);
    bb_fence_release();
    conn->source_uid = src_uid;
    conn->output_hash = bb_fnv1a64(output_name);
    bb_copy_display(conn->output_name, sizeof(conn->output_name), output_name);
    bb_store32(&conn->amount_bits, bb_float_bits(amount));
    conn->state = BB_SLOT_ACTIVE;
    bb_store32(&rec->seq, seq + 1u);
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
    uint32_t seq = bb_load32(&rec->seq) | 1u;
    bb_store32(&rec->seq, seq);
    bb_fence_release();
    int removed = 0;
    for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
        bb_shm_connection* conn = &rec->connections[c];
        if (conn->state != BB_SLOT_ACTIVE) continue;
        if (all || (conn->source_uid == src_uid && strncmp(conn->output_name, output_name, BB_PORT_NAME_BYTES) == 0)) {
            memset(conn, 0, sizeof(*conn));
            ++removed;
        }
    }
    bb_store32(&rec->seq, seq + 1u);
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
            bb_copy_shm_str(d->display_name, sizeof(d->display_name), e->display_name);
            bb_copy_shm_str(d->track_name, sizeof(d->track_name), e->track_name);
            bb_copy_shm_str(d->vendor, sizeof(d->vendor), e->vendor);
            bb_copy_shm_str(d->product, sizeof(d->product), e->product);
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
        if (o->endpoint_index >= BB_MAX_ENDPOINTS) continue; /* hostile/corrupt record */
        if (dest && count < capacity) {
            bb_output_info* d = &dest[count];
            const bb_shm_endpoint* e = &bus->endpoints[o->endpoint_index];
            memset(d, 0, sizeof(*d));
            d->endpoint_uid = bb_load64(&o->endpoint_uid);
            d->type = (bb_signal_type)o->signal_type;
            d->polarity = (bb_polarity)o->polarity;
            bb_copy_shm_str(d->name, sizeof(d->name), o->name);
            bb_copy_shm_str(d->endpoint_name, sizeof(d->endpoint_name), e->display_name);
            bb_copy_shm_str(d->track_name, sizeof(d->track_name), e->track_name);
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
            bb_copy_shm_str(d->name, sizeof(d->name), in->name);
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
                d->amount = bb_sanitize_amount(bb_bits_float(bb_load32(&conn->amount_bits)));
                bb_copy_shm_str(d->output_name, sizeof(d->output_name), conn->output_name);
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
        if (bb_load32_relaxed(&slot->seq) == s1) {
            for (uint32_t i = 0; i < n; ++i) dest[i] = bb_sanitize_sample(dest[i]);
            return n;
        }
    }
    return 0;
}

