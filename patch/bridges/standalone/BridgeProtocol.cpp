// SPDX-License-Identifier: MIT
#include "BridgeProtocol.h"

#include <cstdlib>
#include <new>

#if defined(_WIN32)
#include <windows.h>
#else
#include <fcntl.h>
#include <semaphore.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace bleep::bridge {

namespace {

std::string suffix() {
    const char* ns = std::getenv("BLEEP_BRIDGE_NAMESPACE");
    std::string s = ns && *ns ? ns : "";
#if !defined(_WIN32)
    s += "-" + std::to_string((long)getuid());  // one per user
#endif
    return s;
}

}  // namespace

// macOS limits POSIX names to 31 characters.
std::string segmentName() { return "/bleep-br" + suffix(); }
std::string semaphoreName() { return "/bleep-wk" + suffix(); }

int processId() noexcept {
#if defined(_WIN32)
    return (int)GetCurrentProcessId();
#else
    return (int)getpid();
#endif
}

bool processAlive(int pid) noexcept {
    if (pid <= 0) return false;
#if defined(_WIN32)
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
    if (!h) return false;
    DWORD code = 0;
    const bool alive = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
    CloseHandle(h);
    return alive;
#else
    return kill(pid, 0) == 0;
#endif
}

// ---- shared memory ---------------------------------------------------------------

namespace {
thread_local bool g_incompatible = false;
}

bool SharedMemory::lastOpenWasIncompatible() noexcept { return g_incompatible; }

SharedMemory* SharedMemory::open(bool create) {
    g_incompatible = false;
    const size_t size = sizeof(Shared);
    auto* m = new SharedMemory();
    m->owner_ = create;
#if defined(_WIN32)
    const std::string name = "Local\\" + segmentName().substr(1);
    HANDLE h = create ? CreateFileMappingA(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, (DWORD)((uint64_t)size >> 32),
                                           (DWORD)(size & 0xffffffffu), name.c_str())
                      : OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, name.c_str());
    // The app must be the creator: an object another process pre-created in the session is not ours.
    if (create && h && GetLastError() == ERROR_ALREADY_EXISTS) {
        CloseHandle(h);
        h = nullptr;
    }
    if (!h) {
        delete m;
        return nullptr;
    }
    void* p = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, size);
    if (!p) {
        CloseHandle(h);
        delete m;
        return nullptr;
    }
    m->handle_ = h;
#else
    const std::string name = segmentName();
    if (create) shm_unlink(name.c_str());  // a segment left behind by a crashed app
    const int fd = shm_open(name.c_str(), create ? (O_CREAT | O_EXCL | O_RDWR) : O_RDWR, 0600);
    if (fd < 0) {
        delete m;
        return nullptr;
    }
    if (create && ftruncate(fd, (off_t)size) != 0) {
        close(fd);
        shm_unlink(name.c_str());
        delete m;
        return nullptr;
    }
    struct stat st {};
    if (fstat(fd, &st) != 0 || (size_t)st.st_size < size) {
        close(fd);
        delete m;
        return nullptr;
    }
    void* p = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) {
        delete m;
        return nullptr;
    }
#endif
    m->shared_ = static_cast<Shared*>(p);
    Shared& s = *m->shared_;
    if (create) {
        std::memset(p, 0, size);
        new (&s) Shared();  // atomics start at zero
        s.version = kVersion;
        s.layoutSize = (uint32_t)size;
        s.appPid.store(processId());
        s.appHeartbeatMs.store(nowMs());
        s.readyBlock.store(-1);
        s.doneBlock.store(-1);
        std::atomic_thread_fence(std::memory_order_release);
        s.magic = kMagic;  // last: the segment is ready
    } else if (s.magic != kMagic || s.version != kVersion || s.layoutSize != size) {
        g_incompatible = true;
        delete m;
        return nullptr;
    }
    return m;
}

SharedMemory::~SharedMemory() {
    if (!shared_) return;
#if defined(_WIN32)
    UnmapViewOfFile(shared_);
    CloseHandle((HANDLE)handle_);
#else
    munmap(shared_, sizeof(Shared));
    if (owner_) shm_unlink(segmentName().c_str());
#endif
}

// ---- wake-up signal ------------------------------------------------------------------

WakeSignal* WakeSignal::open(bool create) {
    auto* w = new WakeSignal();
    w->owner_ = create;
#if defined(_WIN32)
    const std::string name = "Local\\" + semaphoreName().substr(1);
    HANDLE h = create ? CreateEventA(nullptr, FALSE, FALSE, name.c_str())
                      : OpenEventA(EVENT_MODIFY_STATE | SYNCHRONIZE, FALSE, name.c_str());
    if (create && h && GetLastError() == ERROR_ALREADY_EXISTS) {  // pre-created by another process: not ours
        CloseHandle(h);
        h = nullptr;
    }
    if (!h) {
        delete w;
        return nullptr;
    }
    w->handle_ = h;
#else
    const std::string name = semaphoreName();
    if (create) sem_unlink(name.c_str());
    sem_t* s = create ? sem_open(name.c_str(), O_CREAT | O_EXCL, 0600, 0) : sem_open(name.c_str(), 0);
    if (s == SEM_FAILED) {
        delete w;
        return nullptr;
    }
    w->handle_ = s;
#endif
    return w;
}

WakeSignal::~WakeSignal() {
    if (!handle_) return;
#if defined(_WIN32)
    CloseHandle((HANDLE)handle_);
#else
    sem_close((sem_t*)handle_);
    if (owner_) sem_unlink(semaphoreName().c_str());
#endif
}

void WakeSignal::post() noexcept {
#if defined(_WIN32)
    SetEvent((HANDLE)handle_);
#else
    sem_post((sem_t*)handle_);
#endif
}

void WakeSignal::wait() noexcept {
#if defined(_WIN32)
    WaitForSingleObject((HANDLE)handle_, INFINITE);
#else
    while (sem_wait((sem_t*)handle_) != 0) {}
#endif
}

}  // namespace bleep::bridge
