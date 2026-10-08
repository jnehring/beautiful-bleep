# Coin Toss

Type id `coin-toss` · category *Utility* · colour proposal `#7c3aed`

## 1. Purpose

A probability router: every incoming trigger or gate is sent to output *A* or
to output *B*, decided by a weighted coin. Two independent channels in one
module, each with a *Probability* knob, so a single clock becomes two
complementary, ever-changing rhythms. Every toss is seeded, so a rendered
song sounds the same as the live playback.

## 2. Jacks

**Inputs** (per channel; channel 2 is identical)

| Jack | Type | What it does |
|---|---|---|
| In 1, In 2 | `gate` | The signal to route. A trigger patched here is a 1-sample gate. *In 2* unpatched: it listens to *In 1* (normalled), so channel 2 makes a second, independent decision on the same events. |
| Reset | `trigger` | Restarts the toss counter (4.3) of both channels, so the following sequence of decisions repeats. |

Every knob is also an input (`specs.md` section 7.3); *Probability 1/2* are
the usual targets for an LFO or envelope.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| A 1, B 1, A 2, B 2 | `gate` | The routed signal (see *Mode*). |
| Coin 1, Coin 2 | `control` (unipolar) | 1 while the last toss chose A, 0 for B. Usable as a random switch for a crossfader or a Sequential Switch's *Address*. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Probability 1, 2 | 0–100 % | 50 % | Chance that a toss chooses **B**. 0 %: always A; 100 %: always B. |
| Memory 1, 2 | 0–100 % | 0 % | Chance that a toss simply repeats the previous result instead of flipping a new coin. Gives runs of A or of B without changing the long-term balance. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode 1, Mode 2 | Trigger, Latch, Toggle | Trigger |
| Link | Independent, Shared, Opposed | Independent |
| Loop | Off, 2, 3, 4, 6, 8, 12, 16, 32 tosses | Off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Modes

A toss happens at each **rising edge** of the input (≥ 0.5, `specs.md` 7.1).

- **Trigger:** the chosen output follows the input gate (high while the input
  is high); the other stays low. The gate length is kept; a trigger in gives
  a trigger out.
- **Latch:** the chosen output goes high and stays high until the next toss
  chooses the other side; the outputs are always complementary. Good for
  switching between two sources.
- **Toggle:** a toss that chooses **B** flips which output is high; one that
  chooses **A** leaves it as it is. *Probability* becomes "chance of a change"
  — a slowly flipping on/off pattern.

If the input falls and rises within one sample, both edges are honoured on
consecutive samples (no lost tosses).

### 4.2 Link

- **Independent:** each channel tosses its own coin with its own knob.
- **Shared:** both channels use one coin per toss, compared against their
  own *Probability*: `B1 = u < p1`, `B2 = u < p2` with the same *u*. With
  p1 < p2, whenever channel 1 goes B, channel 2 does too — nested
  probability (e.g. hats at 70 %, an open hat at 20 %, never one without the
  other). This is the third, shared-probability mode.
- **Opposed:** shared coin, channel 2 compares `u ≥ 1 − p2`, so the channels
  avoid each other — useful to share one clock between two voices without
  collisions.

Shared and Opposed toss on channel 1's edges; channel 2's input is then only
used for its gate length.

### 4.3 Determinism

Each channel keeps a **toss counter** *k*, cleared by Reset and when the
transport starts. The coin is `u = uniform01(Seed, k, channel)`; the memory
check uses stream `channel + 8`. When the transport plays and the input
comes from a transport-locked source, the counter is still event-based (not
derived from ppq): the board is deterministic, so the same song position
always delivers the same number of edges, and a render repeats exactly as
long as playback starts at the same point. Starting mid-song changes the
counter's origin; for exact mid-song recall, *Loop* (4.4) or a Reset from a
bar trigger (e.g. the Step Sequencer's *End*) re-anchors it.

### 4.4 Loop

With *Loop* = *n*, the counter runs modulo *n*: the same *n* decisions repeat,
a fixed random rhythm. Changing *Seed* gives a new one. With *Memory* > 0 the
memory check is part of the loop too, so a loop is exactly repeatable.

### 4.5 Edge cases

- *Probability* is sampled at the moment of the edge, so audio-rate
  modulation is fine and never glitches an ongoing gate.
- Changing *Mode* mid-gate: outputs go low, the next edge starts in the new mode.
- No input patched: outputs stay low (Latch: A high, B low after Reset).
- CPU: one hash per edge; nothing per sample beyond copying the gate.

## 5. Module view

Two columns, one per channel: knobs, mode selector and a **toss history**
strip of the last 32 decisions (filled square = B, empty = A), newest right.
With *Loop* on, the strip shows the loop's decisions and marks the current
one. A small coin icon flips on each toss. The *Link* selector sits between
the columns and draws a chain icon when Shared/Opposed.

## 6. Saved state

Knobs and settings only; no `data`. The toss counter is runtime state and
survives recompiles (modules are reused by node id).

## 7. Engine requirements

None. Uses `hash3`/`uniform01` from `patch/common/dsp/Random.h` and
`GateEdge` from `Smoothing.h`. Normalling an unpatched input to another
(*In 2* ← *In 1*) is done inside the module via `inputConnected`.
`liveValues`: `coin1`, `coin2`, `history1`, `history2` (32-bit masks).

## 8. Tests

- Probability 0 % and 100 % route every edge to A respectively B.
- Over 100 000 tosses at 30 % the share of B is within ±1 %.
- Memory 100 % never changes the result after the first toss; Memory 50 %
  doubles the mean run length.
- Modes: Trigger preserves gate length; Latch is always complementary;
  Toggle at 0 % never flips.
- Shared: with p1 < p2, B1 implies B2 for every toss; Opposed never sets B on both.
- Same Seed and input → identical output twice; Reset repeats the sequence;
  Loop *n* repeats with period *n*.
- *In 2* unpatched follows *In 1*'s edges.

## 9. Later

- More than two outputs per channel (weighted dice with N outputs).
- A *Bias by step* option: probability read from a short table indexed by the toss counter.
- Velocity-style output: a random value per toss on a `control` jack.
