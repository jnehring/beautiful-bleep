---
title: Naming
description: Namespaces and how the shared-memory segment is named.
order: 1
---

## 1. Naming

A namespace is 1 to 16 characters from `[a-z0-9_-]`. The default namespace
is `default`. An implementation SHOULD use the value of the environment
variable `BLEEP_BUS_NAMESPACE` when the plugin does not choose one; this lets
users and test hosts separate buses (for example two DAWs running at once).

The segment name is built from the **major** spec version and the namespace:

| Platform | Name | API |
|---|---|---|
| macOS, Linux, other POSIX | `/bleepbus-v0-<namespace>` | `shm_open`, `mmap` |
| Windows | `Local\bleepbus-v0-<namespace>` | `CreateFileMappingA` on the paging file, `MapViewOfFile` |

macOS limits POSIX shared-memory names to 31 characters, which is why the
namespace is limited to 16.

The segment MUST be created with permissions for the current user only
(POSIX mode `0600`). It is never unlinked during normal operation: plugins
come and go, the segment stays. Tools MAY unlink it when no host is running.

### Creating and opening

1. Open the object with create permission (`O_RDWR | O_CREAT`).
2. If its size is 0, set it to the v0.1 total size (17 187 072 bytes). The
   operating system MAY round the size up to whole pages; a size **at least**
   the total size is valid. If two processes race, one resize fails
   harmlessly; re-read the size.
3. Map the first 17 187 072 bytes read/write.
4. Initialise: compare-and-swap `header.init_state` from 0 to 1. The winner
   writes the header (section 2) and then stores 2 with release semantics.
   Everyone else waits (up to 2 s) until `init_state` reads 2.
5. Validate the header (magic, version, sizes, offsets). On a mismatch the
   implementation MUST NOT touch the segment and reports a version error.
