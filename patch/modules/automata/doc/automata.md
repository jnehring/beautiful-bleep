# Automata

## Introduction

Automata is a sequencer that nobody programs. A small system lives inside it and takes one step every clock tick; what that system does becomes the music. Its cells light up and go dark, a walker leaves a trail, a chain of notes moves from one degree of the scale to the next, a phrase rewrites itself. You choose the kind of system with *Mode*, a seed decides where it starts, and the module turns what happens into a gate, a pitch in your scale, a velocity, a trigger whenever something is *born* and a *Density* voltage that says how alive the whole thing is.

Two controls make it behave differently from a pattern sequencer. *Interference* injects tiny seeded disturbances, one flipped cell or one mutated symbol at a time, so the evolution never repeats exactly. *Rewind* steps the system back by a number of generations from a ring of snapshots: the music returns to something it just played, then forks into a slightly different future.

## How does it work?

Every step, the system advances one **generation**; the module then reads it:

- **Gate** is high for *Gate Length* of the step when the system plays a note.
- **Pitch** is one of eight scale degrees spread over *Octaves* (1 – 3) of *Scale* above *Root* (or the key and scale of a Harmony Master bus, with *Harmony*), plus *Transpose*.
- **Velocity** is a 0 … 1 voltage from how crowded, how surprising or how high the thing that played was.
- **Birth** is a trigger when something new appears at the place being read.
- **Density** is a 0 … 1 voltage: the share of cells alive, marks laid, notes in the last sixteen steps or notes in the string.
- **Step** is a trigger on every step.

### The five systems

**Ring.** Up to 32 cells in a circle. Each step every cell takes its next value from itself and its two neighbours according to *Rule* (0 – 255); rule 30 and rule 90 are classic starting points. A read head moves one cell round the ring per step: a lit cell is a note, the five cells around the head give the degree, and *Birth* fires when the cell under the head just came alive. *Density* sets how many cells are alive at the start; at 0 the ring begins with one lit cell. A ring that dies out gets one new cell.

**Grid.** An 8 × 8 wrapping grid under a life-like rule (*Grid Rule*, written as birth/survival counts, such as B3/S23). The read head moves one column per step: the column plays if any cell in it is alive, the lowest live row gives the degree, the number of live cells the velocity, and *Birth* fires when a cell in that column was born. An extinct grid is sown again.

**Chain.** A Markov chain over the eight scale degrees and a rest. The 9 × 9 **transition table** in the view holds a weight (0 – 9) for every move from one state to the next; each step the chain draws its next state from the row of the current one. Rare moves are accented, and *Birth* fires on a surprising move. *Learn* makes the table change as you play: with a melody patched into *Learn*, every move you play from one degree to the next is added to the table; with nothing patched, the chain reinforces its own habits. Learned weights fade slowly.

**Walker.** A walker on an 8 × 8 wrapping grid with marks on some cells. On each step it looks at the mark under it, turns right or left as *Turns* says for that mark, changes the mark to the next kind, and moves forward. It plays when it arrives on a marked cell; its column gives the degree and its row the velocity. *Birth* fires when it leaves a fresh mark. *Density* is the share of marked cells.

**Rewrite.** A string of symbols (A, B, C, R, U, D) that is rewritten each time the read head reaches its end, using the three rules of the chosen *Rules* set. A, B and C play a note (B then moves up a degree, C down); R is a rest; U and D move the next note an octave up or down. When the string would get too long it starts over from its first symbol. *Birth* fires at every rewrite.

### Interference and Rewind

*Interference* is the chance (up to 50 % per step) that one thing is disturbed before the system evolves: a cell flips, the walker's mark or direction changes, the chain picks a neighbouring state, a symbol mutates. The disturbances come from *Seed* and a counter, so a render is repeatable.

*Rewind* goes back *Rewind By* generations (1 – 16, up to 63 in all) when the *Rewind* button is pressed or a gate arrives on the *Rewind* input. The state returns exactly. Because the disturbance counter keeps counting, the same stretch replays with different disturbances whenever *Interference* is up, and exactly the same when it is 0.

### Reset, seeds and repeatability

*Reset* (a pulse on the *Reset* input) returns the system to its seed. The seed comes from *Seed*, *Density* and the mode. When the transport starts or jumps, the module replays the system from its seed up to the current step (up to 4,096 steps), so a render from the same position is always identical. Rewinds and learning are not part of that replay.

## The view

- **Ring:** the cells on a circle with the read head circled, and the last generations as rows beside it.
- **Grid / Walker:** the 8 × 8 cells; the column being read lit (Grid), the walker as a white dot.
- **Chain:** the transition table, rows = from, columns = to, the last row and column are the rests. Brightness shows the chance. Click a cell to raise its weight, right-click (or Shift-click) to lower it. The current state's row is outlined.
- **Rewrite:** the string as chips, the symbol being read outlined.
- The bar below shows *Density*; the number is the generation.

## How to use it?

- **A melody that grows:** *Ring*, rule 30, *Density* 0; *Pitch* to an oscillator, *Gate* to its envelope.
- **Rhythm from births:** *Grid*; *Birth* to a hat, *Gate* to a kick.
- **Never the same twice:** raise *Interference* to 10 – 30 %.
- **Return to a phrase:** a slow square LFO into *Rewind*.
- **Teach it a style:** *Chain*, *Learn* up, a looping melody into *Learn*.
- **Dynamics:** *Density* into a filter cutoff or a VCA.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Automata does. In the standalone app open **File → Presets…** (⌘P) and pick *Automata* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Automata: Ring Melody** | A ring of sixteen cells grows under rule 30 from a single seed cell; the read head sweeps round the ring, so the lit cells become notes and the dark ones rests. Change Rule (90 mirrors itself, 110 drifts) or raise Interference to nudge the pattern off its course; Reset returns to the seed. |
| **Automata: Grid Garden** | An 8 by 8 wrapping world: colonies grow, collide and die. Gate and Pitch play a bell-like lead, every birth of a cell triggers a soft hat, and Density, how alive the grid is, opens a filter. Try the other Grid Rule choices, or raise Density for a crowded start. |
| **Automata: Chain Learns a Tune** | A frozen eight-note loop plays on the left and is patched into the chain's Learn input; the chain on the right listens, adds the moves it hears to its transition table and improvises in the same style. Turn Learn down to hear the plain, stepwise table, or open the module to edit the table by hand. |
| **Automata: Walker Drums** | A walker with four turn rules roams an 8 by 8 wrapping grid; it plays a note whenever it steps onto a marked cell and fires Birth when it lays a fresh mark. Gate drives a bass, Birth drives hats and a snare, and the walker's route repeats until Interference nudges it somewhere new. |
| **Automata: Rewrite and Rewind** | A phrase rewrites itself each time it ends, growing longer and then starting over. A slow square LFO patched into Rewind pulls the system four generations back every few seconds, so the phrase keeps returning to something it has played, but never exactly the same way. Change Rewind By or the Rules choice. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Automata view has 18 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Rule 30 Ring** | One seed cell grows into a lopsided, never-quite-repeating pattern. |
| **Rule 90 Lace** | A symmetrical lattice: the melody mirrors itself as it grows. |
| **Rule 110 Drift** | Structures drift sideways through a longer ring. |
| **Rule 184 Traffic** | Cells move along the ring like cars in traffic: slow, flowing lines. |
| **Garden Grid** | A small wrapping world: colonies grow, collide and die out. |
| **Mazy Grid** | Structures build up slowly into a maze of long-lived notes. |
| **Seeds Burst** | Every cell lives one step: a restless, sparkling grid. |
| **Gentle Chain** | Mostly stepwise motion with occasional rests. |
| **Student Chain** | Patch a melody into Learn: the chain picks up its habits. |
| **Wandering Walker** | A walker with two turn rules draws a looping highway. |
| **Crowded Walker** | A walker among old marks: gaps and bursts. |
| **Wide Walker** | Six turn rules: a sprawling, unpredictable path over three octaves. |
| **Cascade Phrase** | A phrase that rewrites itself every time it ends. |
| **Climbing Phrase** | Rising lines with octave jumps. |
| **Breathing Tide** | Slow phrases with rests that breathe. |
| **Restless Ring** | Interference keeps nudging the ring: it never settles into a pattern. |
| **Fork Phrase** | A rewriting phrase with a few mutations each pass. |
| **Free Grid** | Ignores the song tempo and steps at a set rate. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Mode | Ring, Grid, Chain, Walker, Rewrite | Ring |
| Rule | 0 – 255 (Ring) | 30 |
| Cells | 4 – 32 (Ring) | 16 |
| Grid Rule | B3/S23, B36/S23, B3/S12345, B2/S, B3/S45678, B1357/S1357 | B3/S23 |
| Turns | RL, RLR, LLRR, RLLR, RRLLRL | RLR |
| Rules | Cascade, Climb, Breath, Fork, Tide | Cascade |
| Density | 0 – 100 % (Ring, Grid, Chain, Walker) | 35 % |
| Interference | 0 – 100 % | 0 % |
| Learn | 0 – 100 % (Chain) | 0 % |
| Rewind By | 1 – 16 generations | 4 |
| Octaves | 1 – 3 | 1 |
| Gate Length | 1 – 100 % of a step | 50 % |
| Rate | 0.05 – 50 Hz | 4 Hz |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars | 1/16 |
| Sync To | Auto, Clock, Transport | Auto |
| Seed | 0 – 999 | 1 |
| Root | C … B | C |
| Scale | the Step Sequencer's scales | Minor Pentatonic |
| Harmony | Off, Bus A … Bus D | Off |

A new *Seed*, *Mode*, *Cells* or *Rules* set restarts the system from its seed. *Rule*, *Grid Rule* and *Turns* change the course of the running system. *Interference*, *Learn*, *Gate Length*, *Density*, *Rate* and the stepped knobs are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | each pulse is one generation; overrides *Rate* and *Sync* |
| Reset | trigger | returns the system to its seed; the next step is generation 1 |
| Rewind | gate | a rising edge steps back *Rewind By* generations |
| Learn | pitch | the melody the Chain learns from, read at each step |
| Transpose | pitch | added to *Pitch*, read at each step |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Gate | gate | high while the system plays a note |
| Pitch | pitch | the degree in *Scale*, held between notes |
| Velocity | control, 0 … 1 | accent of the last note |
| Birth | trigger | something was born at the place being read |
| Density | control, 0 … 1 | how alive the system is |
| Step | trigger | a pulse on every step |

### Buttons

| Button | What it does |
|---|---|
| Rewind | steps back *Rewind By* generations now |

## Origin

The ring, grid, walker, chain and rewriting systems are textbook mathematics (elementary cellular automata, life-like rules, Markov chains, turning walkers and string rewriting); the module is original work and uses none of anyone else's code.
