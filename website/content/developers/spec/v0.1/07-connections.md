---
title: Connections and state
description: Cable rules and the text format used to save them.
order: 7
---

## 7. Connections and state

### 7.1 Cables

An input holds up to 8 connections. Each is `(source UID, output name,
amount)`. Its value is the sum over connections whose source exists of
`sample × amount`. The amount is a finite float, clamped to ±1000.

Any process MAY add, change or remove a cable into any registered input
(this is how a patchbay in one plugin window edits another plugin), under
the registry lock:

- **Add**: seqlock odd, fill a free connection, `state = 1`, seqlock even.
- **Change amount** of an existing cable: atomic store of `amount_bits`
  only; no seqlock.
- **Remove**: seqlock odd, zero the connection, seqlock even.
- After any of these: increment the owner's `patch_version` and
  `connection_generation`.

A receiving plugin watches its `patch_version` and tells its host that its
state changed, so the set is marked as modified.

### 7.2 Saved state

Cables belong to the receiving instance and are saved in its plugin state.
The reference format is UTF-8 text, one cable per line, fields separated by
a tab:

```
bleep-bus-connections 1
<input name>	<source uid: 16 lowercase hex digits>	<output name>	<amount>
```

The amount is written as `[-]digits.digits` (six fraction digits) and parsed
without the C locale, so it is stable across user locales. Readers accept
CRLF line ends, a missing final newline and `+`/`-` signs; lines naming
inputs the endpoint does not have are ignored.

Loading replaces all cables of the endpoint's inputs and increments
`connection_generation`, but not `patch_version` (loading is not an edit).
