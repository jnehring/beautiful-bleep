/* SPDX-License-Identifier: MIT */
/*
 * bb_conformance — Bleep Bus conformance host and validator (spec v0.1).
 *
 * Usage:
 *   bb_conformance run [namespace]      Run every check against the linked
 *                                       implementation. TAP output; exit 1 on
 *                                       failure. Uses a private namespace.
 *   bb_conformance inspect [namespace]  Print and validate a live bus segment
 *                                       (e.g. while Live is running).
 *   bb_conformance peer-send <namespace> <uid> <seconds>
 *                                       Publish the constant 0.42 on output
 *                                       "peer" in real time. Used by `run` for
 *                                       the cross-process check, and by other
 *                                       implementations to test interop.
 *
 * The checks use only the public API (bleep_bus.h) plus the layout header
 * for byte-level validation, so this host can be linked against any
 * implementation of the C API.
 */

#include "bb_conf.h"

static int mode_run(const char* ns_arg) {
    if (ns_arg) {
        snprintf(g_ns, sizeof(g_ns), "%s", ns_arg);
    } else {
#if defined(_WIN32)
        snprintf(g_ns, sizeof(g_ns), "conf-%lu", (unsigned long)GetCurrentProcessId());
#else
        snprintf(g_ns, sizeof(g_ns), "conf-%ld", (long)getpid());
#endif
    }
    bb_bus_unlink(g_ns);
    printf("TAP version 13\n# Bleep Bus conformance, spec %d.%d, namespace %s\n", BB_SPEC_VERSION_MAJOR,
           BB_SPEC_VERSION_MINOR, g_ns);

    run_check("layout: struct sizes and offsets match the specification", check_layout_sizes);
    run_check("layout: a fresh segment carries a valid header", check_segment_header);
    run_check("open: version and namespace arguments are validated", check_open_arguments);
    run_check("open: segments of other versions are rejected", check_segment_version_mismatch);
    run_check("registry: endpoints and ports register, list and unregister", check_registry);
    run_check("registry: duplicated UIDs are re-keyed", check_uid_collisions);
    run_check("timing: one block of latency in any order (playing)", check_latency_playing);
    run_check("timing: offline export faster than real time", check_latency_offline);
    run_check("timing: transport loops", check_latency_loop);
    run_check("timing: transport stopped (time rule)", check_latency_stopped);
    run_check("signals: inputs sum their cables times amount", check_summing_and_amounts);
    run_check("signals: ghost sources read silence until they appear", check_ghost_sources);
    run_check("signals: unwritten, short, mismatched and oversized blocks", check_block_edge_cases);
    run_check("state: connections save and load", check_persistence);
    run_check("patching: cables edited from another handle", check_cross_handle_patching);
    run_check("hostile peer: NaN/Inf values and unterminated names", check_hostile_values);
    run_check("hostile peer: odd seqlock left by a dead writer", check_seq_odd_recovery);
    run_check("hostile peer: table offsets rewritten after open", check_hostile_offsets_after_open);
    run_check("hostile peer: out-of-range endpoint_index", check_hostile_endpoint_index);
    run_check("hostile peer: two writers claiming one output", check_output_ownership);
#if BB_HAVE_POSIX
    run_check("open: a crashed initializer is recovered", check_init_crash_recovery);
    run_check("timing: real threads in random order", check_latency_threads);
    run_check("registry: endpoints of dead processes are reclaimed", check_reap_dead_process);
    run_check("registry: a lock held by a dead process is recovered", check_lock_recovery);
    run_check("ipc: signals cross process boundaries", check_cross_process);
#else
    skip_check("open: a crashed initializer is recovered", "POSIX only in this version");
    skip_check("timing: real threads in random order", "POSIX only in this version");
    skip_check("registry: endpoints of dead processes are reclaimed", "POSIX only in this version");
    skip_check("registry: a lock held by a dead process is recovered", "POSIX only in this version");
    skip_check("ipc: signals cross process boundaries", "POSIX only in this version");
#endif

    printf("1..%d\n# %d failed\n", g_test_number, g_failures);
    bb_bus_unlink(g_ns);
    return g_failures ? 1 : 0;
}

int main(int argc, char** argv) {
    g_self = argv[0];
    const char* mode = argc > 1 ? argv[1] : "run";
    if (strcmp(mode, "run") == 0) return mode_run(argc > 2 ? argv[2] : NULL);
    if (strcmp(mode, "inspect") == 0) return mode_inspect(argc > 2 ? argv[2] : NULL);
    if (strcmp(mode, "peer-send") == 0 && argc > 4)
        return mode_peer_send(argv[2], strtoull(argv[3], NULL, 10), atoi(argv[4]));
    fprintf(stderr,
            "usage: %s run [namespace]\n"
            "       %s inspect [namespace]\n"
            "       %s peer-send <namespace> <uid> <seconds>\n",
            argv[0], argv[0], argv[0]);
    return 2;
}
