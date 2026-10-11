---
title: Types, constants and errors
description: Constants, types and error codes in one table.
order: 10
---

## Types, constants and errors

### Constants

| Name | Value | Meaning |
|---|---|---|
| `BB_SPEC_VERSION` | `BB_MAKE_SPEC_VERSION(0, 1)` | pass to `bb_bus_open` |
| `BB_MAX_ENDPOINTS` | 64 | per bus |
| `BB_MAX_OUTPUTS` | 256 | per bus |
| `BB_MAX_INPUTS` | 512 | per bus |
| `BB_MAX_CONNECTIONS_PER_INPUT` | 8 | |
| `BB_MAX_PORTS_PER_ENDPOINT` | 64 | outputs, and inputs, each |
| `BB_MAX_BLOCK_SAMPLES` | 4096 | split larger blocks |
| `BB_NAME_BYTES` | 64 | endpoint/track name field, incl. NUL |
| `BB_PORT_NAME_BYTES` | 32 | port name field, incl. NUL |
| `BB_BLOCK_PLAYING` | 1 | `bb_block_info.flags` |

### Errors

| Code | Value | When |
|---|---:|---|
| `BB_OK` | 0 | |
| `BB_ERR_INVALID_ARGUMENT` | 1 | NULL, bad name or namespace, NaN amount |
| `BB_ERR_VERSION_MISMATCH` | 2 | incompatible spec version (yours or the segment's) |
| `BB_ERR_SHARED_MEMORY` | 3 | the OS refused the segment (sandbox?) |
| `BB_ERR_CORRUPT` | 4 | the segment is not a Bleep Bus segment |
| `BB_ERR_FULL` | 5 | a table is full |
| `BB_ERR_NOT_FOUND` | 6 | no such endpoint, input or cable |
| `BB_ERR_ALREADY_EXISTS` | 7 | port name taken |
| `BB_ERR_UID_IN_USE` | 8 | UID owned by another live endpoint |
| `BB_ERR_TIMEOUT` | 9 | registry lock or initialisation took > 2 s |
| `BB_ERR_PARSE` | 10 | saved cable text is malformed |

A plugin MUST keep working (passing audio, using its knobs) when the bus is
unavailable.
