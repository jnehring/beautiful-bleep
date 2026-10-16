/* SPDX-License-Identifier: MIT */
/*
 * bb_platform.c — POSIX and Windows implementations of the platform shims.
 */
#if !defined(_WIN32) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE /* for clock_gettime / getrandom on glibc */
#endif

#include "bb_platform.h"

#include <stdio.h>
#include <string.h>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>

void bb_platform_shm_name(const char* ns, char* dest, size_t cap) {
    snprintf(dest, cap, "Local\\bleepbus-v%d-%s", BB_SPEC_VERSION_MAJOR, ns);
}

bb_error bb_platform_shm_open(const char* name, size_t size, bb_shm_handle* out, int* size_mismatch) {
    memset(out, 0, sizeof(*out));
    *size_mismatch = 0;
    HANDLE mapping = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE,
                                        (DWORD)((uint64_t)size >> 32), (DWORD)(size & 0xffffffffu), name);
    if (mapping == NULL) return BB_ERR_SHARED_MEMORY;
    /* If the mapping already existed, its size wins; query it after mapping. */
    void* base = MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, 0);
    if (base == NULL) {
        CloseHandle(mapping);
        return BB_ERR_SHARED_MEMORY;
    }
    MEMORY_BASIC_INFORMATION mbi;
    size_t mapped = size;
    if (VirtualQuery(base, &mbi, sizeof(mbi)) != 0) mapped = mbi.RegionSize;
    if (mapped < size) *size_mismatch = 1;
    out->base = base;
    out->size = mapped < size ? mapped : size;
    out->mapping = mapping;
    return BB_OK;
}

void bb_platform_shm_close(bb_shm_handle* h) {
    if (h->base) UnmapViewOfFile(h->base);
    if (h->mapping) CloseHandle((HANDLE)h->mapping);
    memset(h, 0, sizeof(*h));
}

bb_error bb_platform_shm_unlink(const char* name) {
    (void)name; /* Windows frees the mapping when the last handle closes. */
    return BB_OK;
}

uint64_t bb_platform_now_ns(void) {
    static LARGE_INTEGER freq; /* benign race: every thread computes the same value */
    LARGE_INTEGER now;
    if (freq.QuadPart == 0) QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&now);
    return (uint64_t)((double)now.QuadPart * 1.0e9 / (double)freq.QuadPart);
}

uint32_t bb_platform_pid(void) { return (uint32_t)GetCurrentProcessId(); }

int bb_platform_pid_alive(uint32_t pid) {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
    if (h == NULL) return GetLastError() == ERROR_ACCESS_DENIED;
    DWORD code = 0;
    BOOL ok = GetExitCodeProcess(h, &code);
    CloseHandle(h);
    return ok && code == STILL_ACTIVE;
}

void bb_platform_yield(void) { SwitchToThread(); }
void bb_platform_sleep_ms(unsigned ms) { Sleep(ms); }

uint64_t bb_platform_random64(void) {
    uint64_t v = 0;
    if (BCryptGenRandom(NULL, (PUCHAR)&v, sizeof(v), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
        v = bb_platform_now_ns() ^ ((uint64_t)GetCurrentProcessId() << 32);
    return v;
}

#else /* POSIX */

#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

void bb_platform_shm_name(const char* ns, char* dest, size_t cap) {
    /* macOS limits POSIX shm names to 31 characters: 13 + 16 + NUL fits. */
    snprintf(dest, cap, "/bleepbus-v%d-%s", BB_SPEC_VERSION_MAJOR, ns);
}

bb_error bb_platform_shm_open(const char* name, size_t size, bb_shm_handle* out, int* size_mismatch) {
    memset(out, 0, sizeof(*out));
    out->fd = -1;
    *size_mismatch = 0;

    int fd = shm_open(name, O_RDWR | O_CREAT, 0600);
    if (fd < 0) return BB_ERR_SHARED_MEMORY;

    struct stat st;
    /* A size of 0 means we created it (or the creator has not sized it yet).
     * Sizing twice to the same value is harmless; macOS rejects the second
     * ftruncate with EINVAL, which we ignore and re-check below. */
    for (int attempt = 0; attempt < 1000; ++attempt) {
        if (fstat(fd, &st) != 0) {
            close(fd);
            return BB_ERR_SHARED_MEMORY;
        }
        if (st.st_size != 0) break;
        if (ftruncate(fd, (off_t)size) == 0) continue;
        bb_platform_sleep_ms(1);
    }
    if (st.st_size == 0) {
        close(fd);
        return BB_ERR_TIMEOUT;
    }
    /* The OS rounds the size up to whole pages (16 KiB on Apple silicon). */
    size_t mapped = (size_t)st.st_size;
    if (mapped < size) *size_mismatch = 1;
    if (mapped > size) mapped = size;

    void* base = mmap(NULL, mapped, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (base == MAP_FAILED) {
        close(fd);
        return BB_ERR_SHARED_MEMORY;
    }
    out->base = base;
    out->size = mapped;
    out->fd = fd;
    return BB_OK;
}

void bb_platform_shm_close(bb_shm_handle* h) {
    if (h->base) munmap(h->base, h->size);
    if (h->fd >= 0) close(h->fd);
    memset(h, 0, sizeof(*h));
    h->fd = -1;
}

bb_error bb_platform_shm_unlink(const char* name) {
    if (shm_unlink(name) == 0 || errno == ENOENT) return BB_OK;
    return BB_ERR_SHARED_MEMORY;
}

uint64_t bb_platform_now_ns(void) {
#if defined(__APPLE__)
    return clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
#endif
}

uint32_t bb_platform_pid(void) { return (uint32_t)getpid(); }

int bb_platform_pid_alive(uint32_t pid) {
    /* pid 0 / a negative pid_t would probe our process group or every process;
     * values above INT32_MAX cannot be real PIDs. Such records are invalid,
     * never probe them. */
    if (pid == 0 || pid > 0x7fffffffu) return 0;
    if (kill((pid_t)pid, 0) == 0) return 1;
    return errno == EPERM; /* exists, owned by someone else */
}

void bb_platform_yield(void) { sched_yield(); }

void bb_platform_sleep_ms(unsigned ms) {
    struct timespec ts;
    ts.tv_sec = (time_t)(ms / 1000u);
    ts.tv_nsec = (long)(ms % 1000u) * 1000000L;
    while (nanosleep(&ts, &ts) != 0 && errno == EINTR) {
    }
}

uint64_t bb_platform_random64(void) {
    uint64_t v = 0;
#if defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__)
    arc4random_buf(&v, sizeof(v));
#else
    int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        if (read(fd, &v, sizeof(v)) != (ssize_t)sizeof(v)) v = 0;
        close(fd);
    }
    if (v == 0) v = bb_platform_now_ns() ^ ((uint64_t)getpid() << 32);
#endif
    return v;
}

#endif
