/* SPDX-License-Identifier: MIT */
/*
 * bleep_bus_layout.h — Bleep Bus v0.1 shared-memory layout (EXPERIMENTAL)
 *
 * Plugins do not need this header: bleep_bus.h is the API. It exists for
 * people who reimplement the bus without the SDK (other languages, bridges)
 * and for the conformance suite. The specification documents the same
 * layout in prose; if the two ever disagree, file an issue.
 *
 * Rules that apply to every struct below:
 *  - Little-endian, natural alignment, no compiler packing.
 *  - Fields commented "atomic" MUST only be accessed with atomic loads and
 *    stores of their full width (acquire/release unless noted).
 *  - Strings are NUL-terminated UTF-8 inside their fixed-size field.
 *  - Every table starts on a 64-byte boundary at the offset given in the
 *    header; record sizes are fixed and checked by the static asserts below.
 */
#ifndef BLEEP_BUS_LAYOUT_H
#define BLEEP_BUS_LAYOUT_H

#include "bleep_bus.h"

#ifdef __cplusplus
extern "C" {
#endif

#define BB_LAYOUT_MAGIC 0x53554242u /* "BBUS" read as little-endian bytes */

#define BB_OUTPUT_SLOTS 4           /* ring of completed blocks per output */

/* bb_shm_header.init_state */
#define BB_INIT_EMPTY        0u     /* fresh, zero-filled segment */
#define BB_INIT_INITIALIZING 1u     /* one process is writing the header */
#define BB_INIT_READY        2u

/* state field of endpoints, outputs, inputs and connections */
#define BB_SLOT_FREE   0u
#define BB_SLOT_ACTIVE 1u

/* bb_shm_output_slot.flags */
#define BB_SLOT_FLAG_PLAYING 1u     /* copy of BB_BLOCK_PLAYING */

typedef struct bb_shm_header {
    uint32_t magic;                 /* BB_LAYOUT_MAGIC */
    uint16_t spec_major;
    uint16_t spec_minor;
    uint32_t header_bytes;          /* sizeof(bb_shm_header) */
    uint32_t init_state;            /* atomic, BB_INIT_* */
    uint64_t total_bytes;           /* size of the whole segment */

    uint32_t max_endpoints;         /* BB_MAX_ENDPOINTS */
    uint32_t max_outputs;           /* BB_MAX_OUTPUTS */
    uint32_t max_inputs;            /* BB_MAX_INPUTS */
    uint32_t max_connections_per_input;
    uint32_t max_block_samples;
    uint32_t output_slots;          /* BB_OUTPUT_SLOTS */

    uint64_t endpoints_offset;      /* byte offset of bb_shm_endpoint[max_endpoints] */
    uint64_t inputs_offset;         /* byte offset of bb_shm_input[max_inputs] */
    uint64_t outputs_offset;        /* byte offset of bb_shm_output[max_outputs] */

    /* Registry lock: 0 = free, otherwise the PID of the holder. Taken by
     * every non-real-time mutation (and by consistent reads of names).
     * A waiter MAY steal it when the holder's process no longer exists. */
    uint32_t registry_lock;         /* atomic */
    uint32_t registry_generation;   /* atomic, +1 on endpoint/port changes */
    uint32_t connection_generation; /* atomic, +1 on cable changes */
    uint32_t reserved0;

    uint8_t reserved[168];          /* zero; for additive minor versions */
} bb_shm_header;                    /* 256 bytes */

typedef struct bb_shm_endpoint {
    uint32_t state;                 /* atomic, BB_SLOT_* */
    uint32_t pid;                   /* owning process */
    uint64_t uid;                   /* atomic, stable instance ID */
    uint32_t patch_version;         /* atomic, +1 on cable changes into this endpoint */
    uint32_t reserved0;
    uint64_t last_block_ns;         /* atomic, time of the last bb_begin_block */
    char display_name[BB_NAME_BYTES];
    char track_name[BB_NAME_BYTES];
    char vendor[BB_PORT_NAME_BYTES];
    char product[BB_PORT_NAME_BYTES];
    uint8_t reserved[32];
} bb_shm_endpoint;                  /* 256 bytes */

typedef struct bb_shm_connection {
    uint32_t state;                 /* BB_SLOT_*, guarded by the input's seq */
    uint32_t amount_bits;           /* atomic, IEEE-754 float bits; MAY change without seq */
    uint64_t source_uid;            /* guarded by the input's seq */
    uint64_t output_hash;           /* FNV-1a 64 of output_name, guarded by seq */
    char output_name[BB_PORT_NAME_BYTES];
    uint8_t reserved[8];
} bb_shm_connection;                /* 64 bytes */

typedef struct bb_shm_input {
    uint32_t state;                 /* atomic, BB_SLOT_* */
    uint32_t endpoint_index;        /* owner's index in the endpoint table */
    uint64_t name_hash;             /* FNV-1a 64 of name */
    uint32_t seq;                   /* atomic seqlock over connections[]: odd while changing */
    uint32_t signal_type;           /* bb_signal_type */
    char name[BB_PORT_NAME_BYTES];
    uint8_t reserved[8];
    bb_shm_connection connections[BB_MAX_CONNECTIONS_PER_INPUT];
} bb_shm_input;                     /* 64 + 8 * 64 = 576 bytes */

typedef struct bb_shm_output_slot {
    uint32_t seq;                   /* atomic seqlock: odd while the writer fills the slot */
    uint32_t num_samples;
    uint32_t flags;                 /* BB_SLOT_FLAG_* */
    uint32_t reserved0;
    int64_t  transport_sample_pos;  /* stamp: transport position of samples[0] */
    uint64_t time_ns;               /* stamp: monotonic time the block began */
    uint64_t block_index;           /* value of blocks_written when this slot was filled */
    uint8_t reserved[24];
    float samples[BB_MAX_BLOCK_SAMPLES];
} bb_shm_output_slot;               /* 64 + 4 * 4096 bytes */

typedef struct bb_shm_output {
    uint32_t state;                 /* atomic, BB_SLOT_* */
    uint32_t endpoint_index;
    uint64_t endpoint_uid;          /* atomic, mirrors the owner's uid */
    uint64_t name_hash;             /* FNV-1a 64 of name */
    uint64_t blocks_written;        /* atomic: completed blocks; block k is in slot k % BB_OUTPUT_SLOTS */
    uint32_t incarnation;           /* atomic, +1 each time this record is (re)allocated */
    uint32_t signal_type;           /* bb_signal_type */
    uint32_t polarity;              /* bb_polarity */
    uint32_t reserved0;
    char name[BB_PORT_NAME_BYTES];
    uint8_t reserved[48];
    bb_shm_output_slot slots[BB_OUTPUT_SLOTS];
} bb_shm_output;

/* Offsets of the tables for the v0.1 limits. */
#define BB_LAYOUT_ENDPOINTS_OFFSET ((uint64_t)sizeof(bb_shm_header))
#define BB_LAYOUT_INPUTS_OFFSET \
    (BB_LAYOUT_ENDPOINTS_OFFSET + (uint64_t)BB_MAX_ENDPOINTS * sizeof(bb_shm_endpoint))
#define BB_LAYOUT_OUTPUTS_OFFSET \
    (BB_LAYOUT_INPUTS_OFFSET + (uint64_t)BB_MAX_INPUTS * sizeof(bb_shm_input))
#define BB_LAYOUT_TOTAL_BYTES \
    (BB_LAYOUT_OUTPUTS_OFFSET + (uint64_t)BB_MAX_OUTPUTS * sizeof(bb_shm_output))

/* The specification fixes these sizes; a mismatch breaks interoperability. */
#if defined(__cplusplus)
#define BB_LAYOUT_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#else
#define BB_LAYOUT_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#endif
BB_LAYOUT_STATIC_ASSERT(sizeof(bb_shm_header) == 256, "bb_shm_header must be 256 bytes");
BB_LAYOUT_STATIC_ASSERT(sizeof(bb_shm_endpoint) == 256, "bb_shm_endpoint must be 256 bytes");
BB_LAYOUT_STATIC_ASSERT(sizeof(bb_shm_connection) == 64, "bb_shm_connection must be 64 bytes");
BB_LAYOUT_STATIC_ASSERT(sizeof(bb_shm_input) == 576, "bb_shm_input must be 576 bytes");
BB_LAYOUT_STATIC_ASSERT(sizeof(bb_shm_output_slot) == 64 + 4 * BB_MAX_BLOCK_SAMPLES,
                        "bb_shm_output_slot size");
BB_LAYOUT_STATIC_ASSERT(sizeof(bb_shm_output) == 128 + BB_OUTPUT_SLOTS * sizeof(bb_shm_output_slot),
                        "bb_shm_output size");

#ifdef __cplusplus
}
#endif

#endif /* BLEEP_BUS_LAYOUT_H */
