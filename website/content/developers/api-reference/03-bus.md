---
title: Bus functions
order: 3
---

## Bus functions

### `bb_bus_open`

```c
bb_bus* bb_bus_open(uint32_t spec_version, const char* bus_namespace, bb_error* err);
```

Opens the bus segment, creating it if needed. **[non-RT]**

- `spec_version`: pass `BB_SPEC_VERSION`.
- `bus_namespace`: `NULL` for the environment variable `BLEEP_BUS_NAMESPACE`,
  else `"default"`. Otherwise 1–16 characters from `[a-z0-9_-]`.
- `err`: optional.

**Returns** a handle, or `NULL`. **Errors:** `BB_ERR_VERSION_MISMATCH` (you or
the existing segment speak another version), `BB_ERR_INVALID_ARGUMENT`,
`BB_ERR_SHARED_MEMORY`, `BB_ERR_CORRUPT`, `BB_ERR_TIMEOUT`.

```c
bb_error err;
bb_bus* bus = bb_bus_open(BB_SPEC_VERSION, NULL, &err);
if (!bus) log("bus offline: %s", bb_error_string(err)); /* keep working without it */
```

### `bb_bus_close`

```c
void bb_bus_close(bb_bus* bus);
```

Unmaps the bus. Unregister all endpoints opened through it first. `NULL` is
ignored. **[non-RT]**

### `bb_bus_unlink`

```c
bb_error bb_bus_unlink(const char* bus_namespace);
```

Removes the named segment from the operating system. For tools and tests only.
Processes that still map it keep using the old segment. On Windows this is a
no-op; the mapping disappears with its last handle. **[non-RT]**

### `bb_generate_uid`

```c
uint64_t bb_generate_uid(void);
```

Returns a random, non-zero 64-bit UID. **[non-RT]**

### `bb_error_string`

```c
const char* bb_error_string(bb_error err);
```

Static English text for an error code. **[RT]**
