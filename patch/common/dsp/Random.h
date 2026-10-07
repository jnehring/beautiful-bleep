// SPDX-License-Identifier: MIT
// Counter-based randomness: every value is a pure function of
// (seed, index, stream), so renders are reproducible and seekable.
#pragma once

#include <cstdint>

namespace bleep::dsp {

/// SplitMix64 finaliser: a good 64-bit mix of x.
constexpr uint64_t mix64(uint64_t x) noexcept {
    x += 0x9e3779b97f4a7c15ull;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ull;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebull;
    return x ^ (x >> 31);
}

/// Hash of three values; `stream` separates independent uses of one seed.
constexpr uint64_t hash3(uint64_t seed, uint64_t index, uint64_t stream) noexcept {
    return mix64(mix64(mix64(seed) ^ index) ^ (stream * 0xd6e8feb86659fd93ull));
}

/// Uniform double in [0, 1).
constexpr double uniform01(uint64_t seed, uint64_t index, uint64_t stream) noexcept {
    return (double)(hash3(seed, index, stream) >> 11) * (1.0 / 9007199254740992.0);
}

}  // namespace bleep::dsp
