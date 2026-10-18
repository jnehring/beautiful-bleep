# Task: build or organise a panel
A panel shows what the player touches, not everything: a dozen well-chosen knobs, grouped by function, plus a meter.
- New panel: read the board below, decide sections by function in signal order (sources, filter, envelopes/modulation, effects, output/mix), 3-8 knobs per
  section (cutoff, resonance, attack, release, mix, level...; skip rarely used settings), then call `build_panel` with that plan (layout is automatic).
  Give the panel a short name and a lowercase id.
- Existing panel: read it with `get_panel`, change it (regroup, rename labels, align to the grid, no overlaps, nothing outside cols/rows)
  and send it whole with `propose_panel`. Organising means rearranging: never remove a control, a wired knob or a section unless the user asks for it
  (a cluttered panel gets grouped and aligned, not trimmed); the result has at least as many wired controls as the panel you read.
- Controls: dial (float knobs), select (choices), button (switches), slider (long throws like mixer levels), meter (audio out), section (frame), label.
