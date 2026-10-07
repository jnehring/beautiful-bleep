/* SPDX-License-Identifier: MIT */
/*
 * bb_platform.h — OS and atomics shims for the Bleep Bus reference library.
 * Internal; not part of the public API.
 */
#ifndef BB_PLATFORM_H
#define BB_PLATFORM_H

#include <stddef.h>
#include <stdint.h>

#include "bleep_bus.h"

/* ---------------------------------------------------------------------------
 * Atomics on plain integers in shared memory.
 * The layout uses ordinary uint32_t/uint64_t fields so other languages can
 * map it; these helpers give them atomic, ordered access.
 * ------------------------------------------------------------------------ */
#if defined(_MSC_VER) && !defined(__clang__)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <intrin.h>
static __inline uint32_t bb_load32(const uint32_t* p) { return (uint32_t)_InterlockedOr((volatile long*)p, 0); }
static __inline uint64_t bb_load64(const uint64_t* p) { return (uint64_t)_InterlockedOr64((volatile __int64*)p, 0); }
static __inline uint32_t bb_load32_relaxed(const uint32_t* p) { return *(const volatile uint32_t*)p; }
static __inline void bb_store32(uint32_t* p, uint32_t v) { _InterlockedExchange((volatile long*)p, (long)v); }
static __inline void bb_store64(uint64_t* p, uint64_t v) { _InterlockedExchange64((volatile __int64*)p, (__int64)v); }
static __inline void bb_store32_relaxed(uint32_t* p, uint32_t v) { *(volatile uint32_t*)p = v; }
static __inline int bb_cas32(uint32_t* p, uint32_t expected, uint32_t desired) {
    return (uint32_t)_InterlockedCompareExchange((volatile long*)p, (long)desired, (long)expected) == expected;
}
static __inline uint32_t bb_inc32(uint32_t* p) { return (uint32_t)_InterlockedIncrement((volatile long*)p); }
static __inline void bb_fence_acquire(void) { MemoryBarrier(); }
static __inline void bb_fence_release(void) { MemoryBarrier(); }
#else
#define bb_load32(p)          __atomic_load_n((p), __ATOMIC_ACQUIRE)
#define bb_load64(p)          __atomic_load_n((p), __ATOMIC_ACQUIRE)
#define bb_load32_relaxed(p)  __atomic_load_n((p), __ATOMIC_RELAXED)
#define bb_store32(p, v)      __atomic_store_n((p), (uint32_t)(v), __ATOMIC_RELEASE)
#define bb_store64(p, v)      __atomic_store_n((p), (uint64_t)(v), __ATOMIC_RELEASE)
#define bb_store32_relaxed(p, v) __atomic_store_n((p), (uint32_t)(v), __ATOMIC_RELAXED)
static inline int bb_cas32(uint32_t* p, uint32_t expected, uint32_t desired) {
    return __atomic_compare_exchange_n(p, &expected, desired, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}
#define bb_inc32(p)           __atomic_add_fetch((p), 1u, __ATOMIC_ACQ_REL)
#define bb_fence_acquire()    __atomic_thread_fence(__ATOMIC_ACQUIRE)
#define bb_fence_release()    __atomic_thread_fence(__ATOMIC_RELEASE)
#endif

/* ---------------------------------------------------------------------------
 * Shared memory
 * ------------------------------------------------------------------------ */
typedef struct bb_shm_handle {
    void* base;
    size_t size;
#if defined(_WIN32)
    void* mapping;
#else
    int fd;
#endif
} bb_shm_handle;

/** Opens or creates the named segment with exactly `size` bytes.
 *  A newly created segment is zero-filled. If the segment exists with a
 *  different size, it is mapped at its existing size and *size_mismatch is
 *  set so the caller can diagnose the version. */
bb_error bb_platform_shm_open(const char* name, size_t size, bb_shm_handle* out, int* size_mismatch);
void bb_platform_shm_close(bb_shm_handle* h);
bb_error bb_platform_shm_unlink(const char* name);

/** Builds the OS object name for a namespace into dest (>= 64 bytes). */
void bb_platform_shm_name(const char* ns, char* dest, size_t cap);

/* ---------------------------------------------------------------------------
 * Misc
 * ------------------------------------------------------------------------ */
uint64_t bb_platform_now_ns(void);          /* monotonic, system-wide, RT safe */
uint32_t bb_platform_pid(void);
int      bb_platform_pid_alive(uint32_t pid);
void     bb_platform_yield(void);
void     bb_platform_sleep_ms(unsigned ms);
uint64_t bb_platform_random64(void);

#endif /* BB_PLATFORM_H */
