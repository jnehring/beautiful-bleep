/* SPDX-License-Identifier: MIT */
/* checks_hostile.c — a peer that writes garbage into the shared segment. */
#include "bb_conf.h"

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
void check_hostile_values(void) {
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
void check_hostile_offsets_after_open(void) {
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
void check_hostile_endpoint_index(void) {
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
void check_output_ownership(void) {
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

void check_seq_odd_recovery(void) {
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
