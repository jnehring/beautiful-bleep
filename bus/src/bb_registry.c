/* SPDX-License-Identifier: MIT */
/* bb_registry.c — endpoints and ports (registry lock held unless noted). */
#include "bb_internal.h"

/* ========================================================================
 * Endpoints and ports (registry lock held unless noted)
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

int bb_find_endpoint_locked(bb_bus* bus, uint64_t uid) {
    for (uint32_t i = 0; i < BB_MAX_ENDPOINTS; ++i) {
        bb_shm_endpoint* e = &bus->endpoints[i];
        if (bb_load32(&e->state) == BB_SLOT_ACTIVE && bb_load64(&e->uid) == uid) return (int)i;
    }
    return -1;
}

int bb_find_input_locked(bb_bus* bus, uint32_t endpoint_index, const char* name) {
    for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i) {
        bb_shm_input* in = &bus->inputs[i];
        if (bb_load32(&in->state) == BB_SLOT_ACTIVE && in->endpoint_index == endpoint_index &&
            strncmp(in->name, name, BB_PORT_NAME_BYTES) == 0)
            return (int)i;
    }
    return -1;
}

int bb_find_output_locked(bb_bus* bus, uint64_t endpoint_uid, const char* name) {
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
        if (strncmp(ep->bus->outputs[ep->outputs[i]->index].name, name, BB_PORT_NAME_BYTES) == 0) {
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
    uint32_t incarnation = bb_inc32(&rec->incarnation);
    rec->signal_type = (uint32_t)type;
    rec->polarity = (uint32_t)polarity;
    bb_copy_display(rec->name, sizeof(rec->name), name);
    bb_store32(&rec->state, BB_SLOT_ACTIVE);
    bb_inc32(&bus->hdr->registry_generation);
    bb_unlock(bus);

    out->ep = ep;
    out->index = (uint32_t)index;
    out->incarnation = incarnation;
    {
        uint32_t n = ep->num_outputs; /* only mutated by the (single) control thread */
        ep->outputs[n] = out;
        bb_fence_release();
        bb_store32(&ep->num_outputs, n + 1u); /* publish the pointer before the count */
    }
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
        if (strncmp(ep->bus->inputs[ep->inputs[i]->index].name, name, BB_PORT_NAME_BYTES) == 0) {
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
    {
        uint32_t n = ep->num_inputs;
        ep->inputs[n] = in;
        bb_fence_release();
        bb_store32(&ep->num_inputs, n + 1u);
    }
    bb_set_err(err, BB_OK);
    return in;
}

