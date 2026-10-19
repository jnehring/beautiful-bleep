# Automata

Type id `automata` · category *Sequencing/Generative* · colour proposal `#14b8a6`

## 1. Purpose

A sequencer whose gates and notes come from a small system stepped on a clock.
*Mode* picks the system: **Ring** (a one-dimensional rule on up to 32 cells),
**Grid** (an 8 × 8 wrapping life-like automaton), **Chain** (a Markov chain over
eight scale degrees and a rest, with an editable table that also learns),
**Walker** (a turning walker leaving marks on an 8 × 8 wrapping grid) and
**Rewrite** (a string rewritten by three rules, read as notes, rests and octave
moves). Outputs: Gate, Pitch (quantized to Scale or the harmony bus), Velocity,
Birth, Density and Step.

Own twist: **Interference** (tiny seeded disturbances that fork the evolution)
and **Rewind** (step the system back n generations from a history ring, then
replay into a different future).

It differs from the Shift Register (one bit enters per step of a fixed
register) and from the pattern sequencers (the steps are not edited): the
rhythm and melody are the behaviour of a system, and the module can run it
backwards in time.

## 2. Jacks

Inputs: Clock (trigger), Reset (trigger), Rewind (gate), Learn (pitch),
Transpose (pitch). Outputs: Gate (gate), Pitch (pitch), Velocity (control),
Birth (trigger), Density (control), Step (trigger).

## 3. Controls

Mode, Rule (0…255), Cells (4…32), Grid Rule (6 life-like rules), Turns (5 turn
strings), Rules (5 rewriting sets), Density, Interference, Learn, Rewind By
(1…16), Octaves (1…3), Gate Length, Rate, Sync, Sync To, Seed, Root, Scale,
Harmony. Button: Rewind. Node data: the 9 × 9 Markov weights (0…9).

## 4. Behaviour

### 4.1 State, generations and history

All systems share one plain-data state (cells, string, walker, Markov state).
`seed()` builds generation 0 from Seed, Density and Mode (hash streams of
`Random.h`). Each step runs `evolve()`: generation g → g + 1, producing an event
(gate, degree 0…7, octave, velocity, birth). After each generation the state is
copied into a ring of 64 snapshots. `rewind(n)` restores generation
max(oldest, g − n) exactly. The disturbance counter `tick` is not rewound.

### 4.2 Systems

Ring: new[i] = bit (4l + 2c + r) of Rule; head = g mod n; gate = cell(head);
degree = the five cells around head as a 5-bit number >> 2; velocity from
their count; birth = head cell 0 → 1. Death: one new cell.

Grid: B/S counts of the 8 neighbours, wrapping; head column = g mod 8; gate =
any live cell; degree = lowest live row; velocity from the column's count;
birth = a birth in the column. Extinction: resown at max(Density, 20 %).

Chain: weight(i, j) = table + learned. Next state j drawn with
`uniform01(seed, tick, 6)` from row i; j = 8 is a rest (pitch holds).
velocity = 0.45 + 0.55 (1 − p); birth = p < 0.2. Learn: every step all learned
weights fade by 1 % × Learn and the observed move gains 2 × Learn (capped 24);
the observed move is (previous played degree → degree of Learn's pitch) when
Learn is patched, else the chain's own move.

Walker: marks 0…K−1 (K = letters of Turns). Turn by the letter of the mark
under the walker, mark → (mark + 1) mod K, move one cell. gate = arrived mark
> 0; birth = left mark was 0; degree = column; velocity = row.

Rewrite: symbols A B C R U D; A, B, C are rewritten when the head passes the
end; overflow (> 96) restarts from the axiom; birth at each rewrite; U/D
apply to the next note.

### 4.3 Interference

With probability Interference × 0.5 per step (`uniform01(seed, tick, 20)`) one
element is disturbed before evolving: a cell flips (Ring, Grid), a cell mark
advances and the direction may turn (Walker), the Chain's choice moves one
state, a symbol mutates (Rewrite).

### 4.4 Pitch

index = round(degree / 7 × Octaves × scaleSize) + octave × scaleSize;
pitch = (Root + scaleNote(Scale, index) + round(12 × Transpose)) / 12. With a
harmony bus, Root = the bus key and Scale = the bus scale.

### 4.5 Timing and determinism

SeqClock as in the Shift Register (Clock, transport, free Rate). A Reset
pulse seeds the system at once. A transport start, a jump or a Reset replays
the system from its seed to step k (≤ 4,096 evolutions); rewinds and learning
are not replayed. Everything is a function of (Seed, tick).

## 5. Module view

A canvas per mode (ring + generation rows; 8 × 8 cells; the 9 × 9 table with
click-to-edit; the string as chips), a Density bar and the generation count.

## 8. Tests

Rule 90 rows and wrap; blinker, block and edge wrap; determinism per mode;
Interference 0 identical and > 0 forks (still repeatable); Rewind exact and
bounded; a Reset restarts the sequence; Markov deterministic row, zero
weights, learning; walker bounds; rewriting stays bounded and plays; pitches in
scale; free-running timing; transport seeking.
