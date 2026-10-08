# Bridges

A bridge is a family of nodes that connect the board to the outside world
(spec §4, §18).

- [`ableton/`](ableton/): the **Ableton bridge**, the plugins you add in Live:
  Bleep Patch and the ports (MIDI In/Out, Audio In/Out, Instrument, Audio
  Insert). One class, `PortProcessor`, built once per plugin.
- Later: Max for Live (`live.remote~`), Ableton Extensions SDK tools, OSC,
  VCV Rack, CV in/out.
