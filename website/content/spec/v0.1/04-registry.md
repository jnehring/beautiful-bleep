---
title: Registry
order: 4
---

## 4. Registry

### 4.1 Endpoints

To register, under the registry lock:

1. Reclaim dead endpoints (4.3).
2. If the requested UID is 0, or already owned by an active endpoint,
   generate random non-zero UIDs until one is free. A plugin whose saved
   UID was taken (the user duplicated the device) MUST save the new UID.
3. Take the first free endpoint record, fill it, store `state = 1`.
4. Increment `registry_generation`.

UIDs are chosen by plugins and saved in their state, so cables survive
closing and reopening a set. A plugin SHOULD register immediately (with a
random UID) and switch to its saved UID when the host restores its state
(`bb_set_instance_uid`); the switch fails with `BB_ERR_UID_IN_USE` if that
UID is live elsewhere.

### 4.2 Ports

Outputs and inputs are records in their own tables with the owner's
endpoint index. Names:

- 1..31 bytes of UTF-8, no control characters, no `/`.
- Unique per endpoint and direction (an input and an output MAY share a name).
- Stable: cables refer to outputs by name. Renaming an output breaks
  existing cables to it.
- Convention: the bus input for modulating a parameter carries the
  parameter's display name, e.g. `Cutoff`.

To allocate an output: set `blocks_written = 0`, increment `incarnation`,
fill the remaining fields, store `state = 1`, increment
`registry_generation`. An input is reset with its seqlock held odd and its
connections zeroed.

Limits per bus: 64 endpoints, 256 outputs, 512 inputs; per endpoint the
reference SDK allows 64 outputs and 64 inputs.

### 4.3 Reclamation

An active endpoint whose `pid` is not a live process (POSIX: `kill(pid, 0)`
fails with `ESRCH`; Windows: the process cannot be opened or has exited) is
dead. On registration (and MAY on other occasions) implementations free it:
its outputs and inputs (with their connections) are freed, the endpoint
record is freed, and both generations are incremented.

Unregistering frees an endpoint the same way. Cables **from** a removed
endpoint stay stored at their receivers and read silence ("ghost source")
until an endpoint with that UID and output name appears again.

### 4.4 Addressing

Bridges (OSC, network) address ports as
`/<track>/<instance>/<port>`, where each segment is the corresponding name
lower-cased, with runs of characters outside `[a-z0-9]` replaced by `-`.
Example: track "Bass", instance "Function 1", output "A" →
`/bass/function-1/a`. Inside the bus, ports are addressed by
`(endpoint UID, port name)`.
