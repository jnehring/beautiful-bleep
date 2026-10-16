/* SPDX-License-Identifier: MIT */
/* bb_state.c — state persistence. */
#include "bb_internal.h"

/* ========================================================================
 * State persistence
 *
 * Text format, one cable per line, fields separated by TAB:
 *   bleep-bus-connections 1
 *   <input name> \t <source uid, 16 lowercase hex digits> \t <output name> \t <amount>
 * The amount is written as [-]digits.digits (six fraction digits) and read
 * without the C locale functions, so it is stable across user locales.
 * ===================================================================== */

#define BB_STATE_HEADER "bleep-bus-connections 1\n"

static size_t bb_format_amount(char* dst, float amount) {
    char tmp[48];
    size_t n = 0;
    double v = bb_sanitize_amount(amount);
    if (v < 0) {
        dst[n++] = '-';
        v = -v;
    }
    uint64_t scaled = (uint64_t)(v * 1000000.0 + 0.5);
    uint64_t ip = scaled / 1000000u, fp = scaled % 1000000u;
    size_t t = 0;
    do {
        tmp[t++] = (char)('0' + ip % 10u);
        ip /= 10u;
    } while (ip);
    while (t) dst[n++] = tmp[--t];
    dst[n++] = '.';
    for (int d = 5; d >= 0; --d) {
        uint64_t p = 1;
        for (int j = 0; j < d; ++j) p *= 10u;
        dst[n++] = (char)('0' + (fp / p) % 10u);
    }
    return n;
}

static int bb_parse_amount(const char* s, const char* end, float* out) {
    int neg = 0;
    double v = 0.0, scale = 1.0;
    int digits = 0, frac = 0;
    if (s < end && (*s == '-' || *s == '+')) neg = (*s++ == '-');
    for (; s < end; ++s) {
        if (*s == '.' && !frac) {
            frac = 1;
        } else if (*s >= '0' && *s <= '9') {
            if (frac) {
                scale /= 10.0;
                v += (*s - '0') * scale;
            } else {
                v = v * 10.0 + (*s - '0');
            }
            ++digits;
        } else {
            return 0;
        }
    }
    if (!digits) return 0;
    if (v > (double)BB_AMOUNT_LIMIT) v = (double)BB_AMOUNT_LIMIT; /* also keeps the float cast defined */
    *out = (float)(neg ? -v : v);
    return 1;
}

static size_t bb_append(char* buf, size_t cap, size_t pos, const char* s, size_t n) {
    if (pos + n < cap) memcpy(buf + pos, s, n);
    return pos + n;
}

size_t bb_save_connections(bb_endpoint* ep, void* out, size_t cap) {
    if (!ep) return 0;
    char* buf = (char*)out;
    if (!buf) cap = 0;
    bb_bus* bus = ep->bus;
    if (bb_lock(bus) != BB_OK) return 0;
    size_t pos = bb_append(buf, cap, 0, BB_STATE_HEADER, strlen(BB_STATE_HEADER));
    for (uint32_t i = 0; i < ep->num_inputs; ++i) {
        const bb_shm_input* rec = &bus->inputs[ep->inputs[i]->index];
        for (uint32_t c = 0; c < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
            const bb_shm_connection* conn = &rec->connections[c];
            if (conn->state != BB_SLOT_ACTIVE) continue;
            char line[160];
            size_t n = 0;
            size_t len = strnlen(rec->name, BB_PORT_NAME_BYTES - 1);
            memcpy(line + n, rec->name, len);
            n += len;
            line[n++] = '\t';
            for (int shift = 60; shift >= 0; shift -= 4) line[n++] = "0123456789abcdef"[(conn->source_uid >> shift) & 0xfu];
            line[n++] = '\t';
            len = strnlen(conn->output_name, BB_PORT_NAME_BYTES - 1);
            memcpy(line + n, conn->output_name, len);
            n += len;
            line[n++] = '\t';
            n += bb_format_amount(line + n, bb_bits_float(bb_load32(&conn->amount_bits)));
            line[n++] = '\n';
            pos = bb_append(buf, cap, pos, line, n);
        }
    }
    bb_unlock(bus);
    if (pos + 1 <= cap) buf[pos] = '\0';
    return pos + 1;
}

typedef struct bb_saved_cable {
    char input[BB_PORT_NAME_BYTES];
    char output[BB_PORT_NAME_BYTES];
    uint64_t uid;
    float amount;
} bb_saved_cable;

static int bb_copy_field(char* dst, const char* s, const char* e) {
    size_t n = (size_t)(e - s);
    if (n == 0 || n >= BB_PORT_NAME_BYTES) return 0;
    memcpy(dst, s, n);
    dst[n] = '\0';
    return bb_valid_port_name(dst);
}

bb_error bb_load_connections(bb_endpoint* ep, const void* data, size_t len) {
    if (!ep || (!data && len)) return BB_ERR_INVALID_ARGUMENT;
    const char* p = (const char*)data;
    const char* end = p + len;
    while (end > p && end[-1] == '\0') --end; /* tolerate a stored NUL */

    size_t hlen = strlen(BB_STATE_HEADER);
    if ((size_t)(end - p) < hlen - 1 || memcmp(p, BB_STATE_HEADER, hlen - 1) != 0) return BB_ERR_PARSE;
    p += hlen - 1;
    if (p < end && *p == '\n') ++p;

    enum { MAX_CABLES = BB_MAX_PORTS_PER_ENDPOINT * BB_MAX_CONNECTIONS_PER_INPUT };
    bb_saved_cable* cables = (bb_saved_cable*)calloc(MAX_CABLES, sizeof(bb_saved_cable));
    if (!cables) return BB_ERR_FULL;
    size_t count = 0;
    while (p < end) {
        const char* eol = p;
        while (eol < end && *eol != '\n') ++eol;
        const char* line_end = (eol > p && eol[-1] == '\r') ? eol - 1 : eol;
        if (line_end > p) {
            const char* f[4];
            const char* fe[4];
            int nf = 0;
            const char* s = p;
            for (const char* q = p; q <= line_end && nf < 4; ++q) {
                if (q == line_end || *q == '\t') {
                    f[nf] = s;
                    fe[nf] = q;
                    ++nf;
                    s = q + 1;
                }
            }
            bb_saved_cable cable;
            memset(&cable, 0, sizeof(cable));
            int ok = nf == 4 && count < MAX_CABLES && (fe[1] - f[1]) == 16;
            ok = ok && bb_copy_field(cable.input, f[0], fe[0]) && bb_copy_field(cable.output, f[2], fe[2]);
            cable.uid = 0;
            for (const char* q = f[1]; ok && q < fe[1]; ++q) {
                int d = (*q >= '0' && *q <= '9') ? *q - '0' : (*q >= 'a' && *q <= 'f') ? *q - 'a' + 10 : -1;
                if (d < 0) ok = 0;
                cable.uid = (cable.uid << 4) | (uint64_t)(d < 0 ? 0 : d);
            }
            ok = ok && cable.uid != 0 && bb_parse_amount(f[3], fe[3], &cable.amount);
            if (!ok) {
                free(cables);
                return BB_ERR_PARSE;
            }
            cables[count++] = cable;
        }
        p = eol < end ? eol + 1 : end;
    }

    bb_bus* bus = ep->bus;
    bb_error e = bb_lock(bus);
    if (e != BB_OK) {
        free(cables);
        return e;
    }
    for (uint32_t i = 0; i < ep->num_inputs; ++i) {
        bb_shm_input* rec = &bus->inputs[ep->inputs[i]->index];
        uint32_t seq = bb_load32(&rec->seq) | 1u;
        bb_store32(&rec->seq, seq);
        bb_fence_release();
        memset(rec->connections, 0, sizeof(rec->connections));
        uint32_t slot = 0;
        for (size_t c = 0; c < count && slot < BB_MAX_CONNECTIONS_PER_INPUT; ++c) {
            if (strncmp(cables[c].input, rec->name, BB_PORT_NAME_BYTES) != 0) continue;
            bb_shm_connection* conn = &rec->connections[slot++];
            float amount = bb_sanitize_amount(cables[c].amount);
            conn->source_uid = cables[c].uid;
            conn->output_hash = bb_fnv1a64(cables[c].output);
            bb_copy_shm_str(conn->output_name, sizeof(conn->output_name), cables[c].output);
            bb_store32(&conn->amount_bits, bb_float_bits(amount));
            conn->state = BB_SLOT_ACTIVE;
        }
        bb_store32(&rec->seq, seq + 1u);
    }
    /* Loading is the owner's own action: no patch_version bump (it would mark
     * a freshly loaded set as modified). Other viewers still refresh. */
    bb_inc32(&bus->hdr->connection_generation);
    bb_unlock(bus);
    free(cables);
    return BB_OK;
}

