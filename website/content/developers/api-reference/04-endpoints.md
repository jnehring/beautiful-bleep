---
title: Endpoint functions
description: Register a plugin instance and keep its stable UID.
order: 4
---

## Endpoint functions

### `bb_register_instance`

```c
bb_endpoint* bb_register_instance(bb_bus* bus, const bb_instance_info* info, bb_error* err);
```

Registers a plugin instance. **[non-RT]**

```c
bb_instance_info info = BB_INSTANCE_INFO_INIT;  /* sets struct_size */
info.uid = 0;                    /* 0 = generate */
info.display_name = "Function";  /* user-facing; may be NULL */
info.track_name = NULL;          /* if known */
info.vendor = "Brilliant Bleep";
info.product = "Function";
bb_endpoint* ep = bb_register_instance(bus, &info, &err);
```

If `info.uid` is already live, a fresh UID is used. The endpoint is still
returned, and `err` is `BB_ERR_UID_IN_USE`. Endpoints of crashed processes are
reclaimed here. Names are truncated at a UTF-8 boundary.
**Errors:** `BB_ERR_INVALID_ARGUMENT`, `BB_ERR_FULL` (64 endpoints),
`BB_ERR_TIMEOUT`.

### `bb_unregister_instance`

```c
void bb_unregister_instance(bb_endpoint* ep);
```

Removes the instance, its ports and the cables into its inputs. Cables from
its outputs stay with their receivers and read silence until the UID returns.
Frees `ep`. **[non-RT]**

### `bb_endpoint_uid`

```c
uint64_t bb_endpoint_uid(const bb_endpoint* ep);
```

The current UID. Save this one. **[RT]**

### `bb_endpoint_bus`

```c
bb_bus* bb_endpoint_bus(const bb_endpoint* ep);
```

The bus the endpoint belongs to. **[RT]**

### `bb_set_instance_uid`

```c
bb_error bb_set_instance_uid(bb_endpoint* ep, uint64_t uid);
```

Switches to a saved UID after state restore. **[non-RT]** **Errors:**
`BB_ERR_UID_IN_USE` (another live endpoint owns it; nothing changes),
`BB_ERR_INVALID_ARGUMENT` (0), `BB_ERR_NOT_FOUND`.

### `bb_set_instance_name`

```c
bb_error bb_set_instance_name(bb_endpoint* ep, const char* display_name);
```

Sets the user-facing name shown in other plugins' source menus. **[non-RT]**

### `bb_set_track_name`

```c
bb_error bb_set_track_name(bb_endpoint* ep, const char* track_name);
```

Sets the host track name if your plugin learns it (JUCE:
`updateTrackProperties`). That callback may come on any thread, so store the
name and apply it from your message thread. **[non-RT]**

### `bb_endpoint_patch_version`

```c
uint32_t bb_endpoint_patch_version(const bb_endpoint* ep);
```

Increases whenever any process changes a cable into this endpoint. Poll it
and mark your state as changed when it moves. **[RT]**
