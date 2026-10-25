/* SPDX-License-Identifier: MIT */
/* checks_process.c — dead processes, a crashed initializer, and signals across processes (POSIX only). */
#include "bb_conf.h"

#if BB_HAVE_POSIX

/* ---- processes ---------------------------------------------------------- */

void check_reap_dead_process(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t uid = 0xdeadull;
    pid_t child = fork();
    if (child == 0) {
        bb_bus* cb = bb_bus_open(BB_SPEC_VERSION, g_ns, NULL);
        bb_endpoint* ep = make_endpoint(cb, "Crashing", uid);
        bb_add_output(ep, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, NULL);
        _exit(ep ? 0 : 1); /* exit without unregistering, like a crash */
    }
    int status = 0;
    waitpid(child, &status, 0);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);

    /* The dead endpoint's UID is reclaimed on the next registration. */
    bb_error err;
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    CHECK(ep != NULL);
    CHECK_EQ_INT(err, BB_OK);
    CHECK(bb_endpoint_uid(ep) == uid);
    bb_unregister_instance(ep);
    bb_bus_close(bus);
}

void check_lock_recovery(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    pid_t child = fork();
    if (child == 0) _exit(0);
    waitpid(child, NULL, 0);
    raw_map m;
    CHECK(raw_open(g_ns, 0, &m));
    if (m.base) {
        bb_shm_header* h = (bb_shm_header*)m.base;
        __atomic_store_n(&h->registry_lock, (uint32_t)child, __ATOMIC_RELEASE); /* "crashed while holding" */
        bb_endpoint* ep = make_endpoint(bus, "After Crash", 0);
        CHECK(ep != NULL);
        CHECK_EQ_INT(__atomic_load_n(&h->registry_lock, __ATOMIC_ACQUIRE), 0);
        bb_unregister_instance(ep);
        raw_close(&m);
    }
    bb_bus_close(bus);
}

void check_cross_process(void) {
    bb_bus* bus = open_bus();
    CHECK(bus != NULL);
    if (!bus) return;
    const uint64_t peer_uid = 0x0dd0beefull;
    bb_endpoint* r = make_endpoint(bus, "Cross Reader", 0);
    bb_input* in = bb_add_input(r, "in", BB_SIGNAL_CONTROL, NULL);
    CHECK_EQ_INT(bb_connect(bus, bb_endpoint_uid(r), "in", peer_uid, "peer", 1.0f), BB_OK);

    char uid_arg[32];
    snprintf(uid_arg, sizeof(uid_arg), "%llu", (unsigned long long)peer_uid);
    char* argv[] = {(char*)g_self, (char*)"peer-send", g_ns, uid_arg, (char*)"1", NULL};
    pid_t child;
    if (posix_spawn(&child, g_self, NULL, NULL, argv, environ) != 0) {
        printf("#   could not spawn %s\n", g_self);
        CHECK(0);
        bb_unregister_instance(r);
        bb_bus_close(bus);
        return;
    }
    int seen = 0, product_ok = 0;
    float buf[256];
    for (int i = 0; i < 400 && !seen; ++i) { /* up to ~2 s of real-time blocks */
        bb_block_info b = BB_BLOCK_INFO_INIT;
        b.num_samples = 256;
        b.sample_rate = 48000.0;
        b.transport_sample_pos = (int64_t)i * 256;
        bb_begin_block(r, &b);
        uint32_t present = bb_read_input(in, buf, 256);
        bb_end_block(r);
        if (present == 1 && fabsf(buf[0] - 0.42f) < 1e-6f) seen = 1;
        sleep_ms(5);
    }
    bb_endpoint_info infos[BB_MAX_ENDPOINTS];
    uint32_t n = bb_list_endpoints(bus, infos, BB_MAX_ENDPOINTS);
    for (uint32_t i = 0; i < n && i < BB_MAX_ENDPOINTS; ++i)
        if (infos[i].uid == peer_uid && strcmp(infos[i].product, "conformance-peer") == 0 &&
            infos[i].pid == (uint32_t)child)
            product_ok = 1;
    CHECK(seen);
    CHECK(product_ok);
    int status = 0;
    waitpid(child, &status, 0);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);
    bb_unregister_instance(r);
    bb_bus_close(bus);
}


/* The creator crashed while initialising: the next opener recovers after the
 * init timeout instead of failing forever. */
void check_init_crash_recovery(void) {
    char ns[BB_NAMESPACE_BYTES];
    snprintf(ns, sizeof(ns), "%s-i", g_ns);
    ns[BB_NAMESPACE_BYTES - 1] = '\0';
    bb_bus_unlink(ns);
    pid_t child = fork();
    if (child == 0) _exit(0);
    int status = 0;
    waitpid(child, &status, 0);

    raw_map m;
    CHECK(raw_open(ns, (size_t)BB_LAYOUT_TOTAL_BYTES, &m));
    if (!m.base) return;
    bb_shm_header* h = (bb_shm_header*)m.base;
    h->init_state = BB_INIT_INITIALIZING;
    h->reserved0 = (uint32_t)child; /* dead initializer */
    bb_error err = BB_OK;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, ns, &err);
    CHECK(bus != NULL);
    CHECK_EQ_INT(err, BB_OK);
    if (bus) {
        bb_endpoint* ep = make_endpoint(bus, "Recovered", 0);
        CHECK(ep != NULL);
        if (ep) bb_unregister_instance(ep);
        bb_bus_close(bus);
    }
    raw_close(&m);
    bb_bus_unlink(ns);
}

#endif /* BB_HAVE_POSIX */
