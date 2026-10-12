# XY Pad

![XY Pad in the module view](xy-pad.png)

## Introduction

The XY Pad gives you **two control signals from one touch**. Drag a point over
the pad: its horizontal position comes out of *X*, its vertical position out of
*Y*. Patch the two onto a filter's cutoff and resonance, or a pair of mix
knobs, and one finger plays both.

## How does it work?

*X* and *Y* go from **Min** at the left and bottom edges to **Max** at the right
and top edges; both axes share the range. The default is 0 to 1; set *Min* to
−1 for a pad that moves its destinations both ways from the centre.

**Smooth** glides both outputs to a new position instead of jumping.

A cable into the *X* or *Y* knob moves the point like a hand would. In a panel,
an XY pad control drives this module.

## How to use it?

- **Filter sweep:** *X* onto a Multi Filter's **Cutoff**, *Y* onto its **Resonance**.
- **Morph:** *X* and *Y* onto two Crossfader mixes for a four-way blend.

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| X | 0 – 100 % | 50 % |
| Y | 0 – 100 % | 50 % |
| Min | −1 – +1 | 0 |
| Max | −1 – +1 | +1 |
| Smooth | 0 – 2 s | 20 ms |

Every knob is a modulation destination.

### Outputs

| Output | Signal | What it does |
|---|---|---|
| X | control | horizontal position, scaled from *Min* to *Max* |
| Y | control | vertical position, scaled from *Min* to *Max* |
