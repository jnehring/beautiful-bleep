/* SPDX-License-Identifier: MIT */
/*
 * bleep_bus.h — Bleep Bus public C API (spec v0.1, EXPERIMENTAL)
 *
 * Bleep Bus is an open protocol for sending control signals between audio
 * plugins, across tracks and across vendors, through named OS shared memory.
 * Every plugin that links this library (or reimplements the specification)
 * can publish *outputs* and read *inputs*; cables between them are
 * *connections*, stored on the receiving side.
 *
 * This header is the complete public API. It is plain C99 and is meant to be
 * read by humans and coding assistants alike, so every declaration documents
 * its thread rules, ownership and error behaviour.
 *
 * Normative words MUST / SHOULD / MAY follow RFC 2119.
 *
 * ---------------------------------------------------------------------------
 * Concepts in one paragraph
 * ---------------------------------------------------------------------------
 * A process opens the bus (bb_bus_open). Each plugin instance registers one
 * *endpoint* (bb_register_instance) with a stable 64-bit UID that it saves in
 * its state. An endpoint declares named outputs (bb_add_output) and inputs
 * (bb_add_input). On the audio thread, every block is framed by
 * bb_begin_block / bb_end_block; in between the plugin writes its outputs
 * (bb_write_output) and reads its inputs (bb_read_input). A reader always sees
 * the block a writer completed for the reader's *previous* block (a fixed
 * one-block latency), so results do not depend on the host's thread order.
 * Connections ("cables") link an input to (source endpoint UID, output name)
 * with an amount; an input sums all its connections.
 *
 * ---------------------------------------------------------------------------
 * Thread rules
 * ---------------------------------------------------------------------------
 *  [RT]      Real-time safe: no locks, no allocation, no system calls,
 *            bounded time. Call from the audio thread.
 *  [non-RT]  May lock, allocate or block for a short time. MUST NOT be called
 *            from the audio thread.
 *  An endpoint's [RT] functions MUST be called from one thread at a time.
 *  bb_add_output / bb_add_input publish the new port to the audio thread with
 *  release/acquire ordering, so adding ports while audio runs is safe. There
 *  is no safe removal: bb_unregister_instance (which frees the ports) MUST NOT
 *  overlap any [RT] call on that endpoint; stop audio processing first.
 *
 * ---------------------------------------------------------------------------
 * Minimal sender
 * ---------------------------------------------------------------------------
 *   bb_error err;
 *   bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, NULL, &err);
 *   bb_instance_info info = BB_INSTANCE_INFO_INIT;
 *   info.display_name = "LFO";
 *   bb_endpoint* ep = bb_register_instance(bus, &info, &err);
 *   bb_output* out = bb_add_output(ep, "out", BB_SIGNAL_CONTROL, BB_POLARITY_BIPOLAR);
 *
 *   // audio thread, every block:
 *   bb_block_info b = BB_BLOCK_INFO_INIT;
 *   b.transport_sample_pos = pos; b.num_samples = n; b.sample_rate = sr;
 *   b.flags = playing ? BB_BLOCK_PLAYING : 0;
 *   bb_begin_block(ep, &b);
 *   bb_write_output(out, samples, n);
 *   bb_end_block(ep);
 *
 *   // shutdown:
 *   bb_unregister_instance(ep);
 *   bb_bus_close(bus);
 */
#ifndef BLEEP_BUS_H
#define BLEEP_BUS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================
 * Versioning
 * ===================================================================== */

/** Specification version implemented by this header. 0.x is experimental:
 *  every minor bump MAY break the layout, and peers MUST match exactly.
 *  From 1.0 on, peers with the same major version are compatible. */
#define BB_SPEC_VERSION_MAJOR 0
#define BB_SPEC_VERSION_MINOR 1

/** Packs major/minor into the uint32 passed to bb_bus_open. */
#define BB_MAKE_SPEC_VERSION(major, minor) (((uint32_t)(major) << 16) | (uint32_t)(minor))
#define BB_SPEC_VERSION BB_MAKE_SPEC_VERSION(BB_SPEC_VERSION_MAJOR, BB_SPEC_VERSION_MINOR)

/* ========================================================================
 * Limits (part of the v0.1 shared-memory layout, see bleep_bus_layout.h)
 * ===================================================================== */

#define BB_MAX_ENDPOINTS              64   /**< plugin instances per bus      */
#define BB_MAX_OUTPUTS               256   /**< outputs per bus (all endpoints) */
#define BB_MAX_INPUTS                512   /**< inputs per bus (all endpoints)  */
#define BB_MAX_CONNECTIONS_PER_INPUT   8   /**< cables summed into one input    */
#define BB_MAX_PORTS_PER_ENDPOINT     64   /**< outputs + inputs of one endpoint (each) */
#define BB_MAX_BLOCK_SAMPLES        4096   /**< larger host blocks MUST be split */
#define BB_NAME_BYTES                 64   /**< endpoint/track names incl. NUL  */
#define BB_PORT_NAME_BYTES            32   /**< output/input names incl. NUL    */
#define BB_NAMESPACE_BYTES            17   /**< bus namespace incl. NUL         */

/* ========================================================================
 * Errors
 * ===================================================================== */

typedef enum bb_error {
    BB_OK = 0,
    BB_ERR_INVALID_ARGUMENT = 1, /**< NULL pointer, bad name, out-of-range value */
    BB_ERR_VERSION_MISMATCH = 2, /**< requested or found spec version is incompatible */
    BB_ERR_SHARED_MEMORY    = 3, /**< the OS refused to create/map the segment */
    BB_ERR_CORRUPT          = 4, /**< segment exists but its header is not a Bleep Bus header */
    BB_ERR_FULL             = 5, /**< a fixed-size table is full */
    BB_ERR_NOT_FOUND        = 6, /**< endpoint, input or connection does not exist */
    BB_ERR_ALREADY_EXISTS   = 7, /**< port name taken on this endpoint */
    BB_ERR_UID_IN_USE       = 8, /**< another live endpoint already owns this UID */
    BB_ERR_TIMEOUT          = 9, /**< registry lock or segment initialisation timed out */
    BB_ERR_PARSE            = 10 /**< saved connection state could not be parsed */
} bb_error;

/** Human-readable, static English string for an error code. [RT] */
const char* bb_error_string(bb_error err);

/* ========================================================================
 * Signals
 * ===================================================================== */

/**
 * Signal type of a port. All signals are 32-bit floats, one per sample, in
 * "virtual volts":
 *
 *  BB_SIGNAL_CONTROL  Continuous modulation. Bipolar -1..+1 (≈ ±5 V) or
 *                     unipolar 0..1 (≈ 0..+5 V or 0..10 V), see bb_polarity.
 *  BB_SIGNAL_GATE     High while >= 0.5, low below.
 *  BB_SIGNAL_TRIGGER  A single sample of 1.0 marks an event; all other samples
 *                     are 0.0. Readers that decimate MUST take the maximum
 *                     over the decimated span so triggers are not lost.
 *  BB_SIGNAL_PITCH    1.0 per octave (1 V/oct). 0.0 is C4 = MIDI note 60.
 *  BB_SIGNAL_AUDIO    Reserved for a later spec version. Do not use.
 *
 * Types are advisory: any output may be connected to any input.
 */
typedef enum bb_signal_type {
    BB_SIGNAL_CONTROL = 0,
    BB_SIGNAL_GATE    = 1,
    BB_SIGNAL_TRIGGER = 2,
    BB_SIGNAL_PITCH   = 3,
    BB_SIGNAL_AUDIO   = 4
} bb_signal_type;

/** Declared value range of an output. Advisory, for UIs and adapters. */
typedef enum bb_polarity {
    BB_POLARITY_BIPOLAR  = 0, /**< -1..+1 */
    BB_POLARITY_UNIPOLAR = 1  /**<  0..1  */
} bb_polarity;

/* ========================================================================
 * Opaque handles (process-local; never placed in shared memory)
 * ===================================================================== */

typedef struct bb_bus      bb_bus;      /**< one mapping of the bus segment */
typedef struct bb_endpoint bb_endpoint; /**< one registered plugin instance */
typedef struct bb_output   bb_output;   /**< an output of an endpoint       */
typedef struct bb_input    bb_input;    /**< an input of an endpoint        */

/* ========================================================================
 * Bus lifecycle
 * ===================================================================== */

/**
 * Opens (and if necessary creates) the bus segment. [non-RT]
 *
 * @param spec_version  Pass BB_SPEC_VERSION. The call fails with
 *                      BB_ERR_VERSION_MISMATCH if this library, or a segment
 *                      created by another plugin, implements an incompatible
 *                      version.
 * @param bus_namespace NULL for "default". Otherwise 1..16 characters from
 *                      [a-z0-9_-]. Plugins only see each other inside the same
 *                      namespace. Hosts or users MAY set the environment
 *                      variable BLEEP_BUS_NAMESPACE; it is used when this
 *                      argument is NULL.
 * @param err           Optional; receives BB_OK or the failure reason.
 * @return A handle, or NULL on failure. Close it with bb_bus_close.
 *
 * Several handles to the same bus in one process are fine (typically one per
 * plugin instance). The segment is named "/bleepbus-v<major>-<namespace>"
 * (POSIX) or "Local\\bleepbus-v<major>-<namespace>" (Windows).
 */
bb_bus* bb_bus_open(uint32_t spec_version, const char* bus_namespace, bb_error* err);

/** Unmaps the bus. All endpoints opened through it MUST be unregistered first.
 *  The segment itself stays in place for other users. [non-RT] */
void bb_bus_close(bb_bus* bus);

/** Removes the named segment from the OS (tools and tests only). Processes
 *  that still have it mapped keep working on the old segment. [non-RT] */
bb_error bb_bus_unlink(const char* bus_namespace);

/** Returns a random, non-zero 64-bit UID for a new endpoint. [non-RT] */
uint64_t bb_generate_uid(void);

/* ========================================================================
 * Endpoints (one per plugin instance)
 * ===================================================================== */

typedef struct bb_instance_info {
    uint32_t struct_size;      /**< sizeof(bb_instance_info); set by BB_INSTANCE_INFO_INIT */
    uint64_t uid;              /**< stable ID saved with the plugin state; 0 = generate one */
    const char* display_name;  /**< user-facing instance name, e.g. "Bass Wobble"; may be NULL */
    const char* track_name;    /**< host track name if known; may be NULL */
    const char* vendor;        /**< e.g. "Brilliant Bleep"; may be NULL */
    const char* product;       /**< e.g. "Function"; may be NULL */
} bb_instance_info;

#define BB_INSTANCE_INFO_INIT { (uint32_t)sizeof(bb_instance_info), 0, NULL, NULL, NULL, NULL }

/**
 * Registers a plugin instance. [non-RT]
 *
 * If info->uid is non-zero but already owned by a live endpoint (typical
 * after the user duplicates a device), a fresh UID is generated instead and
 * err is set to BB_ERR_UID_IN_USE while a valid endpoint is still returned.
 * Read the effective UID with bb_endpoint_uid and save that one.
 *
 * Endpoints left behind by crashed processes are reclaimed automatically.
 * Names longer than the field size are truncated at a UTF-8 boundary.
 */
bb_endpoint* bb_register_instance(bb_bus* bus, const bb_instance_info* info, bb_error* err);

/** Unregisters the instance and frees its outputs, inputs and connections.
 *  Cables from other endpoints that point at this UID stay stored on their
 *  side and read silence (a "ghost" source) until the UID returns. [non-RT] */
void bb_unregister_instance(bb_endpoint* ep);

/** The endpoint's current UID. [RT] */
uint64_t bb_endpoint_uid(const bb_endpoint* ep);

/** The bus this endpoint was registered on. [RT] */
bb_bus* bb_endpoint_bus(const bb_endpoint* ep);

/**
 * Changes the endpoint's UID, typically when a plugin restores its saved
 * state after it has already registered with a temporary UID. [non-RT]
 * @return BB_OK, or BB_ERR_UID_IN_USE if another live endpoint owns it (the
 *         endpoint keeps its current UID).
 */
bb_error bb_set_instance_uid(bb_endpoint* ep, uint64_t uid);

/** Sets the user-facing instance name (NULL = empty). [non-RT] */
bb_error bb_set_instance_name(bb_endpoint* ep, const char* display_name);

/** Sets the host track name (NULL = unknown). [non-RT] */
bb_error bb_set_track_name(bb_endpoint* ep, const char* track_name);

/**
 * A counter that increases whenever any connection to one of this
 * endpoint's inputs changes, from any process. Plugins poll it on their
 * message thread and tell the host their state changed (so the set is
 * marked dirty) when it moves. [RT]
 */
uint32_t bb_endpoint_patch_version(const bb_endpoint* ep);

/* ========================================================================
 * Ports
 * ===================================================================== */

/**
 * Adds an output. [non-RT]
 * @param name  1..31 bytes of UTF-8, no control characters, no '/' or tab.
 *              Unique among this endpoint's outputs. Keep names short and
 *              stable ("A", "EOC", "Env"): cables refer to them by name.
 * @return The output, or NULL (BB_ERR_ALREADY_EXISTS, BB_ERR_FULL, ...).
 *         Outputs live until bb_unregister_instance.
 */
bb_output* bb_add_output(bb_endpoint* ep, const char* name, bb_signal_type type,
                         bb_polarity polarity, bb_error* err);

/**
 * Adds an input. Same naming rules as outputs, unique among this endpoint's
 * inputs. Convention: a modulation input for a parameter is named after the
 * parameter ("Cutoff"). [non-RT]
 */
bb_input* bb_add_input(bb_endpoint* ep, const char* name, bb_signal_type type, bb_error* err);

/* ========================================================================
 * Audio thread
 * ===================================================================== */

typedef struct bb_block_info {
    uint32_t struct_size;          /**< sizeof(bb_block_info); set by BB_BLOCK_INFO_INIT */
    uint32_t num_samples;          /**< 1..BB_MAX_BLOCK_SAMPLES */
    int64_t  transport_sample_pos; /**< host transport position of the block's first sample */
    double   sample_rate;          /**< Hz */
    uint32_t flags;                /**< BB_BLOCK_* */
    uint64_t host_time_ns;         /**< monotonic time of the block in ns; 0 = library clock */
} bb_block_info;

#define BB_BLOCK_PLAYING 1u        /**< transport is running (also during offline export) */

#define BB_BLOCK_INFO_INIT { (uint32_t)sizeof(bb_block_info), 0, 0, 0.0, 0u, 0 }

/**
 * Starts a block. [RT]
 *
 * Hosts with blocks larger than BB_MAX_BLOCK_SAMPLES MUST split them and call
 * begin/end once per sub-block, advancing transport_sample_pos. Every peer
 * splits the same way, so alignment is preserved.
 */
void bb_begin_block(bb_endpoint* ep, const bb_block_info* info);

/**
 * Publishes this block's samples of an output. [RT]
 * Copies min(num_samples, block size) samples. Calling it again in the same
 * block overwrites. An output not written during a block publishes silence.
 */
void bb_write_output(bb_output* out, const float* samples, uint32_t num_samples);

/**
 * Reads an input for this block. [RT]
 *
 * Writes num_samples values to dest: the sum over all connections of
 * (source sample × amount). Without connections, dest is all zeros.
 *
 * Timing: for every source, the reader gets the block the source wrote for
 * the reader's previous block (one block of latency), independent of thread
 * order. If no such block exists (source just appeared, transport stopped,
 * different block sizes) the newest block completed before the current cycle
 * is used, and if there is none the source's last value is held.
 *
 * @return The number of connections whose source is present on the bus.
 */
uint32_t bb_read_input(bb_input* in, float* dest, uint32_t num_samples);

/** Ends the block and publishes silence on outputs that were not written. [RT] */
void bb_end_block(bb_endpoint* ep);

/* ========================================================================
 * Connections (cables). Stored with the receiving endpoint's input.
 * ===================================================================== */

/**
 * Connects source output (src_uid, output_name) to the input named
 * input_name of endpoint dst_uid, or updates the amount if that cable
 * exists. The destination MUST be registered (in any process); the source
 * need not be (the cable stays silent until it appears). [non-RT]
 *
 * @param amount  Multiplier applied to the source, typically -1..+1.
 * @return BB_OK, BB_ERR_NOT_FOUND (no such destination input), BB_ERR_FULL.
 */
bb_error bb_connect(bb_bus* bus, uint64_t dst_uid, const char* input_name,
                    uint64_t src_uid, const char* output_name, float amount);

/** Removes one cable. [non-RT] */
bb_error bb_disconnect(bb_bus* bus, uint64_t dst_uid, const char* input_name,
                       uint64_t src_uid, const char* output_name);

/** Removes all cables into an input. [non-RT] */
bb_error bb_disconnect_all(bb_bus* bus, uint64_t dst_uid, const char* input_name);

/* ========================================================================
 * Discovery (for source menus, patchbays and tools)
 * ===================================================================== */

typedef struct bb_endpoint_info {
    uint64_t uid;
    uint32_t pid;                          /**< owning process */
    uint32_t num_outputs;
    uint32_t num_inputs;
    char display_name[BB_NAME_BYTES];
    char track_name[BB_NAME_BYTES];
    char vendor[BB_PORT_NAME_BYTES];
    char product[BB_PORT_NAME_BYTES];
} bb_endpoint_info;

typedef struct bb_output_info {
    uint64_t endpoint_uid;
    bb_signal_type type;
    bb_polarity polarity;
    char name[BB_PORT_NAME_BYTES];
    char endpoint_name[BB_NAME_BYTES];     /**< display name of the owner */
    char track_name[BB_NAME_BYTES];        /**< track of the owner */
} bb_output_info;

typedef struct bb_input_info {
    uint64_t endpoint_uid;
    bb_signal_type type;
    uint32_t num_connections;
    char name[BB_PORT_NAME_BYTES];
} bb_input_info;

typedef struct bb_connection_info {
    uint64_t source_uid;
    float amount;
    int source_present;                    /**< 1 if the source output currently exists */
    char output_name[BB_PORT_NAME_BYTES];
} bb_connection_info;

/**
 * The list functions copy up to `capacity` records into `dest` (which may be
 * NULL when capacity is 0) and return the total number available. Records
 * are ordered by registration slot, which is stable while the bus runs.
 * All are [non-RT].
 */
uint32_t bb_list_endpoints(bb_bus* bus, bb_endpoint_info* dest, uint32_t capacity);
uint32_t bb_list_outputs(bb_bus* bus, bb_output_info* dest, uint32_t capacity);
uint32_t bb_list_inputs(bb_bus* bus, uint64_t endpoint_uid, bb_input_info* dest, uint32_t capacity);
uint32_t bb_list_connections(bb_bus* bus, uint64_t endpoint_uid, const char* input_name,
                             bb_connection_info* dest, uint32_t capacity);

/** Increases whenever an endpoint or port appears, disappears or is renamed.
 *  Cache discovery results and refresh when it changes. [RT] */
uint32_t bb_registry_generation(const bb_bus* bus);

/** Increases whenever any connection on the bus changes. [RT] */
uint32_t bb_connection_generation(const bb_bus* bus);

/**
 * Copies the newest completed block of an output, e.g. for a scope.
 * @return Number of samples copied (0 if the output does not exist or has
 *         not written yet). [non-RT]
 */
uint32_t bb_peek_output(bb_bus* bus, uint64_t endpoint_uid, const char* output_name,
                        float* dest, uint32_t capacity);

/* ========================================================================
 * State persistence
 * ===================================================================== */

/**
 * Serialises all cables into this endpoint's inputs as UTF-8 text
 * (format: see the specification, "Connection state"). [non-RT]
 * @return Bytes needed including the terminating NUL. If that exceeds `cap`,
 *         nothing is written; call again with a larger buffer.
 */
size_t bb_save_connections(bb_endpoint* ep, void* buf, size_t cap);

/**
 * Replaces all cables into this endpoint's inputs with the saved ones.
 * Inputs MUST be added before calling. Lines naming unknown inputs are
 * skipped. [non-RT]
 */
bb_error bb_load_connections(bb_endpoint* ep, const void* buf, size_t len);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* BLEEP_BUS_H */
