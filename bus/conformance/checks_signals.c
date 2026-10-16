/* SPDX-License-Identifier: MIT */
/* checks_signals.c — summing, ghost sources, block edge cases, persistence, patching from another handle. */
#include "bb_conf.h"

void check_summing_and_amounts(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    bb_endpoint* w1 = make_endpoint(bus, "W1", 0);
    bb_endpoint* w2 = make_endpoint(bus, "W2", 0);
    bb_endpoint* r = make_endpoint(bus, "R", 0);
    bb_output* o1 = bb_add_output(w1, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    bb_output* o2 = bb_add_output(w2, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    uint64_t ru = bb_endpoint_uid(r);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", bb_endpoint_uid(w1), "out", 0.5f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", bb_endpoint_uid(w2), "out", -2.0f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", bb_endpoint_uid(w2), "out", -0.25f), BB_OK); /* update, not add */
    CHECK_EQ_INT(bb_list_connections(bus, ru, "in", NULL, 0), 2);
    uint32_t present = 0;
    for (int c = 0; c < 3; ++c) {
        write_block(w1, o1, c * 64, 64, 1, 0, 1.0f);
        write_block(w2, o2, c * 64, 64, 1, 0, 0.8f);
        float got = read_block(r, in, c * 64, 64, 1, 0, &present, NULL);
        if (c > 0) CHECK_NEAR(got, 0.5 * 1.0 - 0.25 * 0.8, 1e-6);
    }
    CHECK_EQ_INT(present, 2);
    /* An endpoint may patch its own output into its own input. */
    bb_output* self_out = bb_add_output(r, "self", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", ru, "self", 1.0f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", ru, "bad/name", 1.0f), BB_ERR_INVALID_ARGUMENT);
    CHECK_EQ_INT(bb_connect(bus, 0x77ull, "in", ru, "self", 1.0f), BB_ERR_NOT_FOUND);
    CHECK_EQ_INT(bb_connect(bus, ru, "missing", ru, "self", 1.0f), BB_ERR_NOT_FOUND);
    for (uint64_t extra = 1; extra <= 6; ++extra) bb_connect(bus, ru, "in", 0x9000ull + extra, "x", 1.0f);
    CHECK_EQ_INT(bb_connect(bus, ru, "in", 0x9999ull, "x", 1.0f), BB_ERR_FULL);
    (void)self_out;
    bb_unregister_instance(w1);
    bb_unregister_instance(w2);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

void check_ghost_sources(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t future_uid = 0xabcdef0123456789ull;
    bb_endpoint* r = make_endpoint(bus, "R", 0);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    CHECK_EQ_INT(bb_connect(bus, bb_endpoint_uid(r), "in", future_uid, "out", 1.0f), BB_OK);
    bb_connection_info ci;
    CHECK_EQ_INT(bb_list_connections(bus, bb_endpoint_uid(r), "in", &ci, 1), 1);
    CHECK_EQ_INT(ci.source_present, 0);
    uint32_t present = 99;
    float got = read_block(r, in, 0, 64, 1, 0, &present, NULL);
    CHECK_EQ_INT(present, 0);
    CHECK_NEAR(got, 0.0, 0.0);

    bb_endpoint* w = make_endpoint(bus, "Late Writer", future_uid);
    bb_output* out = bb_add_output(w, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    write_block(w, out, 64, 64, 1, 0, 0.3f);
    got = read_block(r, in, 128, 64, 1, 0, &present, NULL);
    (void)got;
    write_block(w, out, 128, 64, 1, 0, 0.3f);
    got = read_block(r, in, 192, 64, 1, 0, &present, NULL);
    CHECK_EQ_INT(present, 1);
    CHECK_NEAR(got, 0.3, 1e-7);
    CHECK_EQ_INT(bb_list_connections(bus, bb_endpoint_uid(r), "in", &ci, 1), 1);
    CHECK_EQ_INT(ci.source_present, 1);

    /* Source leaves: the cable stays, reads silence. */
    bb_unregister_instance(w);
    got = read_block(r, in, 256, 64, 1, 0, &present, NULL);
    CHECK_EQ_INT(present, 0);
    CHECK_NEAR(got, 0.0, 0.0);
    CHECK_EQ_INT(bb_list_connections(bus, bb_endpoint_uid(r), "in", NULL, 0), 1);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

void check_block_edge_cases(void) {
    pair p;
    CHECK(make_pair(&p, 1.0f));
    if (g_current_failed) {
        free_pair(&p);
        return;
    }
    float buf[BB_MAX_BLOCK_SAMPLES];
    bb_block_info b = BB_BLOCK_INFO_INIT;
    b.num_samples = 64;
    b.sample_rate = 48000.0;
    b.flags = BB_BLOCK_PLAYING;

    /* Unwritten output publishes silence. */
    write_block(p.writer, p.out, 0, 64, 1, 0, 0.9f);
    read_block(p.reader, p.in, 0, 64, 1, 0, NULL, NULL);
    b.transport_sample_pos = 64;
    bb_begin_block(p.writer, &b);
    bb_end_block(p.writer);
    read_block(p.reader, p.in, 64, 64, 1, 0, NULL, NULL);
    CHECK_NEAR(read_block(p.reader, p.in, 128, 64, 1, 0, NULL, NULL), 0.0, 0.0);

    /* A short write holds its last sample. */
    b.transport_sample_pos = 192;
    for (int i = 0; i < 16; ++i) buf[i] = (float)i;
    bb_begin_block(p.writer, &b);
    bb_write_output(p.out, buf, 16);
    bb_end_block(p.writer);
    float last = 0.0f;
    read_block(p.reader, p.in, 192, 64, 1, 0, NULL, NULL);
    float first = read_block(p.reader, p.in, 256, 64, 1, 0, NULL, &last);
    (void)first;
    /* reader's previous block was 192: it sees the short-written block */
    CHECK_NEAR(last, 15.0, 0.0);

    /* Reader block larger than the writer's: the remainder holds. */
    write_block(p.writer, p.out, 1000, 32, 1, 0, 0.25f);
    read_block(p.reader, p.in, 1000, 32, 1, 0, NULL, NULL);
    write_block(p.writer, p.out, 1032, 32, 1, 0, 0.25f);
    read_block(p.reader, p.in, 1032, 64, 1, 0, NULL, &last);
    CHECK_NEAR(last, 0.25, 0.0);

    /* The writer stops: the reader holds its last value. */
    write_block(p.writer, p.out, 2000, 64, 1, 0, 0.6f);
    read_block(p.reader, p.in, 2000, 64, 1, 0, NULL, NULL);
    for (int c = 1; c < 10; ++c) {
        float got = read_block(p.reader, p.in, 2000 + c * 64, 64, 1, 0, NULL, NULL);
        CHECK_NEAR(got, 0.6, 1e-7);
    }

    /* Blocks larger than the maximum are clamped, never overflow. */
    static float big[BB_MAX_BLOCK_SAMPLES * 2];
    b.num_samples = BB_MAX_BLOCK_SAMPLES * 2;
    bb_begin_block(p.reader, &b);
    bb_read_input(p.in, big, BB_MAX_BLOCK_SAMPLES * 2);
    bb_end_block(p.reader);
    free_pair(&p);
}

void check_persistence(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    bb_endpoint* r = make_endpoint(bus, "R", 0);
    bb_add_input(r, "Cutoff", BB_SIGNAL_CONTROL, NULL);
    bb_add_input(r, "Res", BB_SIGNAL_CONTROL, NULL);
    uint64_t ru = bb_endpoint_uid(r);
    CHECK_EQ_INT(bb_connect(bus, ru, "Cutoff", 0x0123456789abcdefull, "A", 0.5f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "Cutoff", 0x42ull, "EOC", -0.125f), BB_OK);
    CHECK_EQ_INT(bb_connect(bus, ru, "Res", 0x42ull, "B \xc3\xa9", 1.0f), BB_OK);

    char buf[2048];
    size_t needed = bb_save_connections(r, NULL, 0);
    CHECK(needed > 10);
    CHECK_EQ_INT(bb_save_connections(r, buf, 4), needed); /* too small: nothing written, size reported */
    CHECK_EQ_INT(bb_save_connections(r, buf, sizeof(buf)), needed);
    CHECK_EQ_INT(strlen(buf) + 1, needed);
    CHECK(strncmp(buf, "bleep-bus-connections 1\n", 24) == 0);
    CHECK(strstr(buf, "Cutoff\t0123456789abcdef\tA\t0.500000\n") != NULL);
    CHECK(strstr(buf, "Cutoff\t0000000000000042\tEOC\t-0.125000\n") != NULL);

    uint32_t pv = bb_endpoint_patch_version(r);
    CHECK_EQ_INT(bb_disconnect_all(bus, ru, "Cutoff"), BB_OK);
    CHECK_EQ_INT(bb_disconnect(bus, ru, "Res", 0x42ull, "B \xc3\xa9"), BB_OK);
    CHECK_EQ_INT(bb_disconnect(bus, ru, "Res", 0x42ull, "B \xc3\xa9"), BB_ERR_NOT_FOUND);
    CHECK(bb_endpoint_patch_version(r) != pv);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Cutoff", NULL, 0), 0);

    pv = bb_endpoint_patch_version(r);
    CHECK_EQ_INT(bb_load_connections(r, buf, needed), BB_OK);
    CHECK_EQ_INT(bb_endpoint_patch_version(r), pv); /* loading is not an edit */
    bb_connection_info ci[8];
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Cutoff", ci, 8), 2);
    CHECK(ci[0].source_uid == 0x0123456789abcdefull && strcmp(ci[0].output_name, "A") == 0);
    CHECK_NEAR(ci[0].amount, 0.5, 1e-6);
    CHECK_NEAR(ci[1].amount, -0.125, 1e-6);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Res", ci, 8), 1);
    CHECK(strcmp(ci[0].output_name, "B \xc3\xa9") == 0);

    /* Unknown inputs are skipped; CRLF and missing trailing newline are fine. */
    const char* other = "bleep-bus-connections 1\r\nGone\t0000000000000001\tA\t1.0\r\nRes\t0000000000000002\tA\t-.5";
    CHECK_EQ_INT(bb_load_connections(r, other, strlen(other)), BB_OK);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Cutoff", NULL, 0), 0);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Res", ci, 8), 1);
    CHECK_NEAR(ci[0].amount, -0.5, 1e-6);

    const char* bad[] = {"garbage", "bleep-bus-connections 1\nRes\tzz\tA\t1.0\n",
                         "bleep-bus-connections 1\nRes\t0000000000000002\tA\tabc\n",
                         "bleep-bus-connections 1\nRes\t0000000000000002\tA\n"};
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); ++i)
        CHECK_EQ_INT(bb_load_connections(r, bad[i], strlen(bad[i])), BB_ERR_PARSE);
    const char* empty = "bleep-bus-connections 1\n";
    CHECK_EQ_INT(bb_load_connections(r, empty, strlen(empty)), BB_OK);
    CHECK_EQ_INT(bb_list_connections(bus, ru, "Res", NULL, 0), 0);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}

void check_cross_handle_patching(void) {
    /* A patchbay in another plugin instance edits our cables. */
    bb_bus* mine = open_bus();
    bb_bus* theirs = open_bus();
    CHECK(mine != NULL && theirs != NULL);
    if (!mine || !theirs) return;
    bb_endpoint* r = make_endpoint(mine, "R", 0);
    bb_endpoint* w = make_endpoint(theirs, "W", 0);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    bb_output* out = bb_add_output(w, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
    uint32_t pv = bb_endpoint_patch_version(r);
    uint32_t cg = bb_connection_generation(mine);
    CHECK_EQ_INT(bb_connect(theirs, bb_endpoint_uid(r), "in", bb_endpoint_uid(w), "out", 1.0f), BB_OK);
    CHECK(bb_endpoint_patch_version(r) != pv);
    CHECK(bb_connection_generation(mine) != cg);
    write_block(w, out, 0, 32, 1, 0, 0.7f);
    read_block(r, in, 0, 32, 1, 0, NULL, NULL);
    write_block(w, out, 32, 32, 1, 0, 0.7f);
    CHECK_NEAR(read_block(r, in, 32, 32, 1, 0, NULL, NULL), 0.7, 1e-7);

    /* Peek (scopes) */
    float peek[64];
    CHECK_EQ_INT(bb_peek_output(mine, bb_endpoint_uid(w), "out", peek, 64), 32);
    CHECK_NEAR(peek[31], 0.7, 1e-7);
    CHECK_EQ_INT(bb_peek_output(mine, bb_endpoint_uid(w), "nope", peek, 64), 0);

    /* Unregistering the receiver drops its cables. */
    uint64_t ru = bb_endpoint_uid(r);
    bb_unregister_instance(r);
    CHECK_EQ_INT(bb_list_connections(theirs, ru, "in", NULL, 0), 0);
    bb_unregister_instance(w);
    bb_bus_close(mine);
    bb_bus_close(theirs);
}

