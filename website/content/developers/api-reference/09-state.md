---
title: State functions
order: 9
---

## State functions

### `bb_save_connections`

```c
size_t bb_save_connections(bb_endpoint* ep, void* buf, size_t cap);
```

Writes all cables into this endpoint's inputs as NUL-terminated UTF-8 text.
**Returns** the bytes needed, including the NUL. If that exceeds `cap`,
nothing is written. **[non-RT]**

```c
size_t n = bb_save_connections(ep, NULL, 0);
char* text = malloc(n);
bb_save_connections(ep, text, n);
/* store `text` next to your parameters */
```

Format (tab-separated, locale-independent):

```
bleep-bus-connections 1
Cutoff	0123456789abcdef	A	-0.300000
```

### `bb_load_connections`

```c
bb_error bb_load_connections(bb_endpoint* ep, const void* buf, size_t len);
```

Replaces all cables into this endpoint's inputs with the saved ones. Add your
inputs first. Lines for unknown inputs are skipped. Loading does not change
`bb_endpoint_patch_version`. **[non-RT]** **Errors:** `BB_ERR_PARSE`.
