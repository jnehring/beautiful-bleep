/* SPDX-License-Identifier: MIT */
/* modes.c — `peer-send` and `inspect`. */
#include "bb_conf.h"

int mode_peer_send(const char* ns, uint64_t uid, int seconds) {
    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, ns, &err);
    if (!bus) {
        fprintf(stderr, "peer-send: %s\n", bb_error_string(err));
        return 1;
    }
    bb_instance_info info = BB_INSTANCE_INFO_INIT;
    info.uid = uid;
    info.display_name = "Peer";
    info.product = "conformance-peer";
    info.vendor = "Bleep Bus";
    bb_endpoint* ep = bb_register_instance(bus, &info, &err);
    bb_output* out = bb_add_output(ep, "peer", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR, &err);
    if (!ep || !out) {
        fprintf(stderr, "peer-send: %s\n", bb_error_string(err));
        return 1;
    }
    float buf[256];
    fill(buf, 256, 0.42f);
    int blocks = seconds * 48000 / 256;
    for (int i = 0; i < blocks; ++i) {
        bb_block_info b = BB_BLOCK_INFO_INIT;
        b.num_samples = 256;
        b.sample_rate = 48000.0;
        b.transport_sample_pos = (int64_t)i * 256;
        bb_begin_block(ep, &b);
        bb_write_output(out, buf, 256);
        bb_end_block(ep);
        sleep_ms(5);
    }
    bb_unregister_instance(ep);
    bb_bus_close(bus);
    return 0;
}

static const char* type_name(bb_signal_type t) {
    switch (t) {
        case BB_SIGNAL_CONTROL: return "control";
        case BB_SIGNAL_GATE: return "gate";
        case BB_SIGNAL_TRIGGER: return "trigger";
        case BB_SIGNAL_PITCH: return "pitch";
        case BB_SIGNAL_AUDIO: return "audio";
    }
    return "?";
}

int mode_inspect(const char* ns) {
    bb_error err;
    bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, ns, &err);
    if (!bus) {
        fprintf(stderr, "inspect: %s\n", bb_error_string(err));
        return 1;
    }
    int problems = 0;
    bb_endpoint_info eps[BB_MAX_ENDPOINTS];
    uint32_t ne = bb_list_endpoints(bus, eps, BB_MAX_ENDPOINTS);
    printf("bus \"%s\": %u endpoint(s), registry gen %u, connection gen %u\n", ns ? ns : "default", ne,
           bb_registry_generation(bus), bb_connection_generation(bus));
    static bb_output_info outs[BB_MAX_OUTPUTS];
    uint32_t no = bb_list_outputs(bus, outs, BB_MAX_OUTPUTS);
    for (uint32_t e = 0; e < ne && e < BB_MAX_ENDPOINTS; ++e) {
        printf("\n%016llx  %s › %s  (%s / %s, pid %u)\n", (unsigned long long)eps[e].uid,
               eps[e].track_name[0] ? eps[e].track_name : "?", eps[e].display_name, eps[e].vendor, eps[e].product,
               eps[e].pid);
        for (uint32_t o = 0; o < no && o < BB_MAX_OUTPUTS; ++o) {
            if (outs[o].endpoint_uid != eps[e].uid) continue;
            float tmp[BB_MAX_BLOCK_SAMPLES];
            uint32_t n = bb_peek_output(bus, eps[e].uid, outs[o].name, tmp, BB_MAX_BLOCK_SAMPLES);
            printf("   out %-12s %-8s %s", outs[o].name, type_name(outs[o].type),
                   outs[o].polarity == BB_POLARITY_BIPOLAR ? "bipolar " : "unipolar");
            if (n) printf("  last %+.4f", tmp[n - 1]);
            printf("\n");
        }
        bb_input_info ins[BB_MAX_PORTS_PER_ENDPOINT];
        uint32_t ni = bb_list_inputs(bus, eps[e].uid, ins, BB_MAX_PORTS_PER_ENDPOINT);
        for (uint32_t i = 0; i < ni && i < BB_MAX_PORTS_PER_ENDPOINT; ++i) {
            printf("   in  %-12s %-8s", ins[i].name, type_name(ins[i].type));
            bb_connection_info cs[BB_MAX_CONNECTIONS_PER_INPUT];
            uint32_t nc = bb_list_connections(bus, eps[e].uid, ins[i].name, cs, BB_MAX_CONNECTIONS_PER_INPUT);
            if (!nc) printf("  (unpatched)");
            printf("\n");
            for (uint32_t c = 0; c < nc && c < BB_MAX_CONNECTIONS_PER_INPUT; ++c)
                printf("         ← %016llx/%s × %+.3f%s\n", (unsigned long long)cs[c].source_uid, cs[c].output_name,
                       cs[c].amount, cs[c].source_present ? "" : "  [ghost]");
        }
    }

    /* Byte-level invariants on the raw segment. */
    raw_map m;
    if (raw_open(ns ? ns : "default", 0, &m)) {
        const char* base = (const char*)m.base;
        const bb_shm_header* h = (const bb_shm_header*)base;
        const bb_shm_endpoint* E = (const bb_shm_endpoint*)(base + h->endpoints_offset);
        const bb_shm_input* I = (const bb_shm_input*)(base + h->inputs_offset);
        const bb_shm_output* O = (const bb_shm_output*)(base + h->outputs_offset);
        for (uint32_t i = 0; i < BB_MAX_OUTPUTS; ++i) {
            if (O[i].state != BB_SLOT_ACTIVE) continue;
            const bb_shm_endpoint* owner = &E[O[i].endpoint_index];
            if (O[i].endpoint_index >= BB_MAX_ENDPOINTS || owner->state != BB_SLOT_ACTIVE ||
                owner->uid != O[i].endpoint_uid) {
                printf("PROBLEM: output %u (%s) has no live owner\n", i, O[i].name);
                ++problems;
            }
            if (memchr(O[i].name, 0, sizeof(O[i].name)) == NULL) {
                printf("PROBLEM: output %u name not terminated\n", i);
                ++problems;
            }
        }
        for (uint32_t i = 0; i < BB_MAX_INPUTS; ++i) {
            if (I[i].state != BB_SLOT_ACTIVE) continue;
            if (I[i].endpoint_index >= BB_MAX_ENDPOINTS || E[I[i].endpoint_index].state != BB_SLOT_ACTIVE) {
                printf("PROBLEM: input %u (%s) has no live owner\n", i, I[i].name);
                ++problems;
            }
            if (I[i].seq & 1u) {
                printf("PROBLEM: input %u seqlock left odd\n", i);
                ++problems;
            }
        }
        if (h->registry_lock != 0) printf("note: registry lock held by pid %u\n", h->registry_lock);
        raw_close(&m);
    }
    printf("\n%s (%d problem(s))\n", problems ? "INVALID" : "valid", problems);
    bb_bus_close(bus);
    return problems ? 1 : 0;
}
