// SPDX-License-Identifier: GPL-3.0-only
// Bit Formula (doc/specs/modules/bit-formula.md): a restricted integer expression
// language compiled to a small stack bytecode, and the generator that runs it
// once per clock tick. Nothing is evaluated from text on the audio thread: the
// compiler runs on the message thread and the finished Program (a plain struct,
// no heap) is handed over.
//
// Grammar (C-like precedence, all values unsigned 32-bit, wrapping):
//   variables  t (tick counter)  a b c (the three knobs, 0…255)  x (audio input as 0…255)
//   literals   decimal or 0x hex
//   unary      - ~ !
//   binary     * / %   + -   << >>   < <= > >=   == !=   &   ^   |   &&   ||
//   ternary    cond ? yes : no       (both branches are computed; no side effects exist)
// Division and remainder by zero give 0, shift counts are taken modulo 32.
// The result is used modulo 256.
#pragma once

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <string>

namespace bleep::patch {

struct BitProgram {
    enum Op : uint8_t {
        Const, VarT, VarA, VarB, VarC, VarX, Neg, BitNot, LogNot,
        Mul, Div, Mod, Add, Sub, Shl, Shr, Lt, Le, Gt, Ge, Eq, Ne, And, Xor, Or, LAnd, LOr, Select
    };
    static constexpr int kMaxOps = 64;
    static constexpr int kMaxStack = 24;
    static constexpr int kMaxSource = 160;
    struct Instr {
        Op op = Const;
        uint32_t imm = 0;
    };
    std::array<Instr, kMaxOps> code{};
    int length = 0;
    bool ok = false;
    int errorAt = -1;  ///< character position of the first error (compile failures)

    /// Evaluates one tick; the stack is on the caller's frame.
    uint32_t run(uint32_t t, uint32_t a, uint32_t b, uint32_t c, uint32_t x) const noexcept {
        uint32_t st[kMaxStack];
        int sp = 0;
        for (int i = 0; i < length; ++i) {
            const Instr& in = code[(size_t)i];
            switch (in.op) {
                case Const: st[sp++] = in.imm; break;
                case VarT: st[sp++] = t; break;
                case VarA: st[sp++] = a; break;
                case VarB: st[sp++] = b; break;
                case VarC: st[sp++] = c; break;
                case VarX: st[sp++] = x; break;
                case Neg: st[sp - 1] = 0u - st[sp - 1]; break;
                case BitNot: st[sp - 1] = ~st[sp - 1]; break;
                case LogNot: st[sp - 1] = st[sp - 1] == 0 ? 1u : 0u; break;
                case Select: {
                    const uint32_t no = st[--sp], yes = st[--sp];
                    st[sp - 1] = st[sp - 1] ? yes : no;
                    break;
                }
                default: {
                    const uint32_t r = st[--sp], l = st[sp - 1];
                    uint32_t v = 0;
                    switch (in.op) {
                        case Mul: v = l * r; break;
                        case Div: v = r ? l / r : 0u; break;
                        case Mod: v = r ? l % r : 0u; break;
                        case Add: v = l + r; break;
                        case Sub: v = l - r; break;
                        case Shl: v = l << (r & 31u); break;
                        case Shr: v = l >> (r & 31u); break;
                        case Lt: v = l < r; break;
                        case Le: v = l <= r; break;
                        case Gt: v = l > r; break;
                        case Ge: v = l >= r; break;
                        case Eq: v = l == r; break;
                        case Ne: v = l != r; break;
                        case And: v = l & r; break;
                        case Xor: v = l ^ r; break;
                        case Or: v = l | r; break;
                        case LAnd: v = (l != 0) && (r != 0); break;
                        case LOr: v = (l != 0) || (r != 0); break;
                        default: break;
                    }
                    st[sp - 1] = v;
                    break;
                }
            }
        }
        return sp > 0 ? st[sp - 1] : 0u;
    }
};

/// Recursive-descent compiler. Message thread only (allocates nothing but the std::string it reads).
class BitCompiler {
public:
    static BitProgram compile(const std::string& src) {
        BitCompiler c(src);
        c.prog_.errorAt = -1;
        if ((int)src.size() > BitProgram::kMaxSource) {
            c.fail(BitProgram::kMaxSource);
        } else {
            c.ternary();
            c.skip();
            if (!c.failed_ && c.pos_ < c.s_.size()) c.fail((int)c.pos_);  // trailing junk
        }
        c.prog_.ok = !c.failed_ && c.prog_.length > 0;
        if (!c.prog_.ok && c.prog_.errorAt < 0) c.prog_.errorAt = 0;
        if (!c.prog_.ok) c.prog_.length = 0;
        return c.prog_;
    }

private:
    explicit BitCompiler(const std::string& s) : s_(s) {}

    void fail(int at) {
        if (!failed_) prog_.errorAt = at;
        failed_ = true;
    }
    void emit(BitProgram::Op op, uint32_t imm = 0) {
        if (prog_.length >= BitProgram::kMaxOps) return fail((int)pos_);
        prog_.code[(size_t)prog_.length++] = {op, imm};
        // Track stack depth: pushes +1, binary −1, ternary −2, unary 0.
        switch (op) {
            case BitProgram::Const: case BitProgram::VarT: case BitProgram::VarA: case BitProgram::VarB: case BitProgram::VarC:
            case BitProgram::VarX: ++depth_; break;
            case BitProgram::Neg: case BitProgram::BitNot: case BitProgram::LogNot: break;
            case BitProgram::Select: depth_ -= 2; break;
            default: --depth_; break;
        }
        if (depth_ >= BitProgram::kMaxStack) fail((int)pos_);
    }
    void skip() {
        while (pos_ < s_.size() && (s_[pos_] == ' ' || s_[pos_] == '\t' || s_[pos_] == '\n' || s_[pos_] == '\r')) ++pos_;
    }
    bool take(const char* tok) {
        skip();
        size_t n = 0;
        while (tok[n]) ++n;
        if (s_.compare(pos_, n, tok) != 0) return false;
        pos_ += n;
        return true;
    }
    /// Takes `tok` only when the next characters are not `not1`/`not2` (so `<` is not the start of `<<`).
    bool takeNot(const char* tok, char not1, char not2 = 0) {
        skip();
        size_t n = 0;
        while (tok[n]) ++n;
        if (s_.compare(pos_, n, tok) != 0) return false;
        const char nx = pos_ + n < s_.size() ? s_[pos_ + n] : 0;
        if (nx && (nx == not1 || nx == not2)) return false;
        pos_ += n;
        return true;
    }

    void ternary() {
        logicalOr();
        if (failed_) return;
        if (take("?")) {
            ternary();
            if (!take(":")) return fail((int)pos_);
            ternary();
            emit(BitProgram::Select);
        }
    }
    void logicalOr() {
        logicalAnd();
        while (!failed_ && take("||")) logicalAnd(), emit(BitProgram::LOr);
    }
    void logicalAnd() {
        bitOr();
        while (!failed_ && take("&&")) bitOr(), emit(BitProgram::LAnd);
    }
    void bitOr() {
        bitXor();
        while (!failed_ && takeNot("|", '|')) bitXor(), emit(BitProgram::Or);
    }
    void bitXor() {
        bitAnd();
        while (!failed_ && take("^")) bitAnd(), emit(BitProgram::Xor);
    }
    void bitAnd() {
        equality();
        while (!failed_ && takeNot("&", '&')) equality(), emit(BitProgram::And);
    }
    void equality() {
        relational();
        for (;;) {
            if (failed_) return;
            if (take("==")) relational(), emit(BitProgram::Eq);
            else if (take("!=")) relational(), emit(BitProgram::Ne);
            else return;
        }
    }
    void relational() {
        shift();
        for (;;) {
            if (failed_) return;
            if (take("<=")) shift(), emit(BitProgram::Le);
            else if (take(">=")) shift(), emit(BitProgram::Ge);
            else if (takeNot("<", '<')) shift(), emit(BitProgram::Lt);
            else if (takeNot(">", '>')) shift(), emit(BitProgram::Gt);
            else return;
        }
    }
    void shift() {
        additive();
        for (;;) {
            if (failed_) return;
            if (take("<<")) additive(), emit(BitProgram::Shl);
            else if (take(">>")) additive(), emit(BitProgram::Shr);
            else return;
        }
    }
    void additive() {
        multiplicative();
        for (;;) {
            if (failed_) return;
            if (take("+")) multiplicative(), emit(BitProgram::Add);
            else if (take("-")) multiplicative(), emit(BitProgram::Sub);
            else return;
        }
    }
    void multiplicative() {
        unary();
        for (;;) {
            if (failed_) return;
            if (take("*")) unary(), emit(BitProgram::Mul);
            else if (take("/")) unary(), emit(BitProgram::Div);
            else if (take("%")) unary(), emit(BitProgram::Mod);
            else return;
        }
    }
    void unary() {
        if (++nesting_ > 24) return fail((int)pos_);
        if (take("-")) unary(), emit(BitProgram::Neg);
        else if (take("~")) unary(), emit(BitProgram::BitNot);
        else if (takeNot("!", '=')) unary(), emit(BitProgram::LogNot);
        else primary();
        --nesting_;
    }
    void primary() {
        skip();
        if (pos_ >= s_.size()) return fail((int)pos_);
        const char ch = s_[pos_];
        if (ch == '(') {
            ++pos_;
            if (++nesting_ > 24) return fail((int)pos_);
            ternary();
            --nesting_;
            if (!take(")")) fail((int)pos_);
            return;
        }
        if (ch >= '0' && ch <= '9') {
            uint64_t v = 0;
            if (ch == '0' && pos_ + 1 < s_.size() && (s_[pos_ + 1] == 'x' || s_[pos_ + 1] == 'X')) {
                pos_ += 2;
                const size_t start = pos_;
                while (pos_ < s_.size() && std::isxdigit((unsigned char)s_[pos_])) {
                    v = v * 16 + (uint64_t)(std::isdigit((unsigned char)s_[pos_]) ? s_[pos_] - '0' : (std::tolower(s_[pos_]) - 'a' + 10));
                    if (v > 0xffffffffull) return fail((int)pos_);
                    ++pos_;
                }
                if (pos_ == start) return fail((int)pos_);
            } else {
                while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') {
                    v = v * 10 + (uint64_t)(s_[pos_] - '0');
                    if (v > 0xffffffffull) return fail((int)pos_);
                    ++pos_;
                }
            }
            emit(BitProgram::Const, (uint32_t)v);
            return;
        }
        BitProgram::Op op;
        switch (ch) {
            case 't': op = BitProgram::VarT; break;
            case 'a': op = BitProgram::VarA; break;
            case 'b': op = BitProgram::VarB; break;
            case 'c': op = BitProgram::VarC; break;
            case 'x': op = BitProgram::VarX; break;
            default: return fail((int)pos_);
        }
        // A variable is a single letter: "ta" or "abc" is an error, not a product.
        if (pos_ + 1 < s_.size() && std::isalnum((unsigned char)s_[pos_ + 1])) return fail((int)pos_ + 1);
        ++pos_;
        emit(op);
    }

    const std::string& s_;
    size_t pos_ = 0;
    int depth_ = 0, nesting_ = 0;
    bool failed_ = false;
    BitProgram prog_;
};

struct BitPreset {
    const char* name;
    const char* source;
};

/// The stepped Formula choices; the last entry of the Formula knob (index kPresets) is the user's own.
inline const std::array<BitPreset, 16>& bitPresets() {
    static const std::array<BitPreset, 16> list = {{
        {"Ramp", "t*(1+(a>>5))"},
        {"Pulse", "(t&255)<a ? 255 : 0"},
        {"Stairs", "(t>>(1+(b>>6))) * (1+(a>>5)) ^ (t>>(c>>5))"},
        {"Sierpinski", "t & (t>>(1+(a>>5))) | (t>>(b>>5))"},
        {"Sieve", "t*((t>>(1+(a>>5)))|(t>>(1+(b>>5))))&c"},
        {"Crawl", "t*(((t>>(a>>4))|(t>>(b>>4)))&(c>>2)&(t>>5))"},
        {"Chirp", "(t*t>>(a>>4)) ^ (t>>(b>>5))"},
        {"Warble", "t*(1+((t>>(a>>4))&7)) & (128|c)"},
        {"Mask", "(t*(t>>(a>>5)) ^ (t>>(b>>4))) & c"},
        {"Counting", "(t>>(a>>5)) ^ (t>>(b>>5)) ^ (t>>(c>>5)) ^ t"},
        {"Echo Ramp", "((t&255) + ((t*(1+(a>>4))>>2)&255)) >> 1 ^ (b&t>>4)"},
        {"Grid", "(t&a) ^ ((t>>3)&b) ^ ((t>>6)&c)"},
        {"Mirror", "(t&128 ? ~t : t) * (1+(a>>6)) ^ (t>>(4+(b>>6)))"},
        {"Parity", "((t>>(a>>5)) & (t>>(b>>5)) & 1) * c + (t&31)"},
        {"Input Crush", "(x & (a|63)) ^ (t & b & 15) ^ (t>>4 & c & 7)"},
        {"Input Mod", "x*(1+(a>>5)) ^ (t&b) ^ (c>>5)"},
    }};
    return list;
}

/// All preset programs, compiled once (message thread or first use).
inline const std::array<BitProgram, 16>& compiledPresets() {
    static const std::array<BitProgram, 16> progs = [] {
        std::array<BitProgram, 16> p;
        for (size_t i = 0; i < p.size(); ++i) p[i] = BitCompiler::compile(bitPresets()[i].source);
        return p;
    }();
    return progs;
}

struct BitParams {
    float a = 128.0f, b = 128.0f, c = 128.0f;  ///< 0…255
    float rateHz = 8000.0f;                    ///< clock ticks per second (pitch already applied)
    float smooth = 0.0f;                       ///< 0 = raw staircase … 1 = about 200 Hz low-pass
    int bits = 8;                              ///< 1…8 significant bits of the result
};

struct BitFrame {
    float out = 0.0f;    ///< −1…+1
    float value = 0.0f;  ///< the byte as 0…1
    bool msb = false;    ///< bit 7
};

class BitFormulaDsp {
public:
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    void reset() noexcept {
        t_ = 0;
        phase_ = 1.0;  // evaluate the first tick on the first sample
        byte_ = 0;
        lp_ = 0.0f;
    }
    uint32_t tickCounter() const noexcept { return t_; }

    BitFrame tick(const BitProgram* prog, const BitParams& p, float input) noexcept {
        const double inc = std::clamp((double)p.rateHz, 0.0, sampleRate_ * 4.0) / sampleRate_;
        phase_ += inc;
        int guard = 0;
        while (phase_ >= 1.0 && guard++ < 4) {
            phase_ -= 1.0;
            const uint32_t x = (uint32_t)std::clamp((int)std::lround(input * 127.5f + 127.5f), 0, 255);
            const uint32_t v = prog && prog->ok ? prog->run(t_, toByte(p.a), toByte(p.b), toByte(p.c), x) : 128u;
            byte_ = v & 255u;
            ++t_;
        }
        if (phase_ >= 1.0) phase_ = std::fmod(phase_, 1.0);
        const int drop = 8 - std::clamp(p.bits, 1, 8);
        const uint32_t q = (byte_ >> drop) << drop;
        const float raw = ((float)q - 127.5f) / 127.5f;
        float y = raw;
        if (p.smooth > 0.001f) {
            const float fc = 20000.0f * std::pow(0.01f, std::clamp(p.smooth, 0.0f, 1.0f));
            const float a = 1.0f - std::exp(-6.283185307f * fc / (float)sampleRate_);
            lp_ += a * (raw - lp_);
            y = lp_;
        } else {
            lp_ = raw;
        }
        return {y, (float)byte_ / 255.0f, (byte_ & 128u) != 0};
    }

private:
    static uint32_t toByte(float v) noexcept { return (uint32_t)std::clamp((int)v, 0, 255); }
    double sampleRate_ = 48000.0, phase_ = 1.0;
    uint32_t t_ = 0, byte_ = 0;
    float lp_ = 0.0f;
};

}  // namespace bleep::patch
