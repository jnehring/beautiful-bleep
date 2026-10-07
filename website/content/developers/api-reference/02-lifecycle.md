---
title: Lifecycle
order: 2
---

## Lifecycle

```
constructor      bb_bus_open → bb_register_instance → bb_add_output / bb_add_input
restore state    bb_set_instance_uid(saved uid) → bb_load_connections(saved text)
audio callback   bb_begin_block → bb_read_input … bb_write_output → bb_end_block
save state       bb_endpoint_uid → bb_save_connections
UI / timer       bb_list_outputs (source menus), bb_connect / bb_disconnect,
                 bb_endpoint_patch_version (mark the set dirty)
destructor       bb_unregister_instance → bb_bus_close
```

Rules:

1. Register in the constructor with UID 0 (a fresh UID), so the instance is
   on the bus before the host restores its state.
2. When the host restores state, call `bb_set_instance_uid` with the saved
   UID. If it returns `BB_ERR_UID_IN_USE`, the user duplicated the device:
   keep the fresh UID, and still load the saved cables.
3. Add all inputs before `bb_load_connections`.
4. Save `bb_endpoint_uid` (not the UID you asked for) and the
   `bb_save_connections` text in your plugin state.
5. Poll `bb_endpoint_patch_version` on the message thread a few times per
   second. When it changes, tell the host your state changed. In JUCE:
   `updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true))`.
6. Unregister before closing the bus.
