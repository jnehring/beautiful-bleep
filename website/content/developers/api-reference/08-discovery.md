---
title: Discovery functions
order: 8
---

## Discovery functions

Each list function copies up to `capacity` records and returns the total
available. Call it with `capacity = 0` to size a buffer. Records are ordered
by table slot, which is stable while the bus runs. All are **[non-RT]**.

### `bb_list_endpoints`

```c
uint32_t bb_list_endpoints(bb_bus* bus, bb_endpoint_info* dest, uint32_t capacity);
```

`bb_endpoint_info`: `uid`, `pid`, `num_outputs`, `num_inputs`,
`display_name`, `track_name`, `vendor`, `product`.

### `bb_list_outputs`

```c
uint32_t bb_list_outputs(bb_bus* bus, bb_output_info* dest, uint32_t capacity);
```

Every output on the bus with its owner's names. This is what a source menu
shows. `bb_output_info`: `endpoint_uid`, `type`, `polarity`, `name`,
`endpoint_name`, `track_name`.

### `bb_list_inputs`

```c
uint32_t bb_list_inputs(bb_bus* bus, uint64_t endpoint_uid, bb_input_info* dest, uint32_t capacity);
```

The inputs of one endpoint, with `num_connections`.

### `bb_list_connections`

```c
uint32_t bb_list_connections(bb_bus* bus, uint64_t endpoint_uid, const char* input_name,
                             bb_connection_info* dest, uint32_t capacity);
```

The cables into one input. `bb_connection_info`: `source_uid`, `amount`,
`output_name`, `source_present` (0 for a ghost source).

### `bb_registry_generation`

```c
uint32_t bb_registry_generation(const bb_bus* bus);
```

Changes whenever an endpoint or port appears, disappears or is renamed.
Cache your lists and refresh them when it changes. **[RT]**

### `bb_connection_generation`

```c
uint32_t bb_connection_generation(const bb_bus* bus);
```

Changes whenever any cable on the bus changes. **[RT]**

### `bb_peek_output`

```c
uint32_t bb_peek_output(bb_bus* bus, uint64_t endpoint_uid, const char* output_name,
                        float* dest, uint32_t capacity);
```

Copies the newest completed block of any output, e.g. for a scope.
**Returns** the number of samples copied (0 if the output doesn't exist).
