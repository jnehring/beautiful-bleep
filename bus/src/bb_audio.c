/* SPDX-License-Identifier: MIT */
/* bb_audio.c — the audio thread (RT: no locks, no allocation). */
#include "bb_internal.h"

static const float bb_zeros[BB_MAX_BLOCK_SAMPLES];

/* ========================================================================
 * Audio thread (RT: no locks, no allocation)
 * ===================================================================== */

/* Lock-free variant of bb_owns_record_locked for the audio thread. */
static int bb_owns_endpoint(const bb_endpoint* ep) {
    const bb_shm_endpoint* rec = &ep->bus->endpoints[ep->index];
    return bb_load32(&rec->state) == BB_SLOT_ACTIVE && bb_load64(&rec->uid) == ep->uid;
}

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
    uint32_t nout = bb_load32(&ep->num_outputs);
    for (uint32_t i = 0; i < nout; ++i) ep->outputs[i]->written = 0;
    if (bb_owns_endpoint(ep)) bb_store64(&ep->bus->endpoints[ep->index].last_block_ns, ep->cur.time_ns);
}

void bb_write_output(bb_output* out, const float* samples, uint32_t num_samples) {
    if (!out || !out->ep->in_block) return;
    bb_endpoint* ep = out->ep;
    bb_shm_output* rec = &ep->bus->outputs[out->index];
    /* The record may have been reaped and reallocated to another endpoint (or
     * rewritten by a hostile peer): writing then would put two writers on one
     * seqlock. Verify ownership first and fail quietly. */
    if (bb_load32(&rec->state) != BB_SLOT_ACTIVE || bb_load64(&rec->endpoint_uid) != ep->uid ||
        bb_load32(&rec->incarnation) != out->incarnation)
        return;
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
    uint32_t nout = bb_load32(&ep->num_outputs);
    for (uint32_t i = 0; i < nout; ++i) {
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
    if (ep->cur.sample_rate > 0.0) {
        double g = 0.5e9 * (double)ep->cur.num_samples / ep->cur.sample_rate;
        if (!(g >= 0.0)) g = 0.0;
        if (g > 1e9) g = 1e9; /* also keeps the cast defined for tiny sample rates */
        guard_ns = (uint64_t)g;
    }
    for (uint64_t k = w; k-- > oldest;) {
        uint64_t idx;
        int64_t pos;
        uint32_t flags;
        uint64_t t;
        if (!bb_read_stamp(&o->slots[k % BB_OUTPUT_SLOTS], &idx, &pos, &flags, &t)) continue;
        if (idx == k && t <= ep->cur.time_ns && ep->cur.time_ns - t >= guard_ns) return (int64_t)k;
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

        float amount = bb_sanitize_amount(bb_bits_float(bb_load32(&rec->connections[c].amount_bits)));
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
        for (uint32_t i = 0; i < copied; ++i) {
            in->scratch[i] = bb_sanitize_sample(in->scratch[i]);
            dest[i] += in->scratch[i] * amount;
        }
        if (copied > 0) cc->held = in->scratch[copied - 1];
        for (uint32_t i = copied; i < n; ++i) dest[i] += cc->held * amount;
    }
    /* A sum of huge finite values can still overflow to Inf. */
    for (uint32_t i = 0; i < n; ++i) dest[i] = bb_sanitize_sample(dest[i]);
    return present;
}

