/* SPDX-License-Identifier: MIT */
/* checks_layout.c — struct sizes, the segment header, and open(). */
#include "bb_conf.h"

void check_layout_sizes(void) {
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

void check_segment_header(void) {
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

void check_open_arguments(void) {
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

void check_segment_version_mismatch(void) {
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

