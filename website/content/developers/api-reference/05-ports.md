---
title: Port functions
order: 5
---

## Port functions

### `bb_add_output`

```c
bb_output* bb_add_output(bb_endpoint* ep, const char* name, bb_signal_type type,
                         bb_polarity polarity, bb_error* err);
```

Adds an output. **[non-RT]**

- `name`: 1–31 bytes UTF-8, no control characters, no `/`, unique among this
  endpoint's outputs. Keep it short and stable (`"A"`, `"EOC"`, `"Env"`),
  because cables refer to it by name.
- `type`: `BB_SIGNAL_CONTROL`, `_GATE`, `_TRIGGER` or `_PITCH`.
  `_AUDIO` is reserved.

**Errors:** `BB_ERR_INVALID_ARGUMENT`, `BB_ERR_ALREADY_EXISTS`, `BB_ERR_FULL`.
Outputs live until the endpoint is unregistered.

### `bb_add_input`

```c
bb_input* bb_add_input(bb_endpoint* ep, const char* name, bb_signal_type type, bb_error* err);
```

Adds an input, with the same naming rules. Name a parameter's modulation
input after the parameter (`"Cutoff"`). **[non-RT]**
