# Zone Delay

Type id `zone-delay` · category *Audio* · colour proposal `#3b82f6`

## 1. Purpose

One stereo delay that covers every delay time worth having, from tuned combs
and flanging through doubling and slapback to rhythmic echoes and 20-second
loops. *Zone* picks the time range, *Time* moves within it, and the rest
shapes what happens to the repeats: their character, how much they smear into
a cloud, how they move across the stereo field. Time changes either bend the
pitch like tape or crossfade cleanly, and three triggers turn it into a
performance instrument: reverse, hold (loop the buffer) and ping-pong.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is not patched. |
| In R | `audio` | Right input. |
| Clock | `trigger` | When patched, *Time* is measured from the clock (see 4.2). |
| Pitch | `pitch` | In the *Comb* zone, tunes the delay to that note (delay = 1 / frequency). Ignored in other zones. |
| Reverse | `gate` | While high (or toggled by the button), the repeats play backwards (4.5). |
| Hold | `gate` | While high, the buffer stops recording and loops (4.6). |
| Ping-Pong | `gate` | While high, the repeats bounce between the channels (4.4). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Dry/wet mix. |
| Wet L, Wet R | `audio` | Repeats only. |
| Tap | `trigger` | A pulse each time the delay time elapses (the "echo clock"); useful to sync other modules to a free-running delay. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Zone | 1–5 (stepped) | 3 | The time range (table in 4.1). Modulatable: crossing a zone boundary is handled as a time change (4.3). |
| Time | 0–100 % within the zone | 50 % | Exponential position inside the zone. Synced: picks a note value (4.2). |
| Feedback | 0–110 % | 40 % | Amount of each repeat fed back. Above 100 % the loop grows until the *Character* saturation holds it. |
| Character | 0–100 % | 25 % | Morphs through five loop characters (4.7). |
| Tone | −1 … +1 | 0 | Moves the character's filters darker or brighter (± 2 octaves). |
| Diffuse | 0–100 % | 0 % | Allpass diffusion in the loop: from clean repeats to a smeared cloud (4.8). |
| Offset | −50 … +50 % | 0 % | Stereo time offset: right time = left time × (1 + Offset). Negative makes the left side later. |
| Wobble | 0–100 % | 10 % | Slow tape-style time drift (wow) plus fast flutter; scaled by zone so it's subtle in long zones and chorus-like in short ones. |
| Mix | 0–100 % | 35 % | Dry/wet, equal-power. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Sync | Free, Transport | Free |
| Time Change | Tape, Crossfade | Tape |
| Glide | 5 ms – 2 s (Tape mode) | 150 ms |
| Clear on Play | off / on | off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Zones

| Zone | Name | Free range | Synced choices | Typical use |
|---|---|---|---|---|
| 1 | Comb | 0.25–12 ms | — (tracks *Pitch* if patched) | flanging, Karplus-style plucks, resonant metal |
| 2 | Short | 8–120 ms | 1/128 … 1/32 | doubling, chorus, slapback |
| 3 | Echo | 80 ms – 1.2 s | 1/32 … 1/2 (straight, dotted, triplet) | rhythmic echoes |
| 4 | Long | 0.6–5 s | 1/4 … 2 bars | long echoes, phrase repeats |
| 5 | Vast | 3–20 s | 1 bar … 8 bars | loops, slowly building layers |

Zones overlap so a modulated *Time* near the edge of one zone has an
equivalent in the next. The view prints the actual time in ms or s.

### 4.2 Sync and Clock

- **Free:** times in the table.
- **Transport:** *Time* steps through the zone's note values (4/4, at the
  current tempo). Tempo changes glide (Tape) or crossfade.
- **Clock patched:** the base time is the interval between the last two
  pulses, and *Time* chooses a ratio (¼, ⅓, ½, ⅔, 1, 3/2, 2, 3, 4) of it,
  clamped to the zone. A pulse arriving after more than 20 s of silence is
  ignored for measuring.

In the Comb zone with *Pitch* patched, the time is `1 / (C4 × 2^pitch)` and
*Time* becomes a ±12 semitone offset, so a Voice Cell's pitch plays the comb
in tune (cubic interpolation keeps high notes accurate within a few cents up
to 4 kHz).

### 4.3 Time changes: Tape vs Crossfade

**Tape** (default). The read head's distance follows the target time through
a one-pole with time constant *Glide*, plus a slew limit of ±1 sample per
sample (pitch range 0–2×). Changing the time speeds or slows the head, so the
repeats bend in pitch like a tape machine. Audio-rate modulation of *Time* is
FM of the repeats: continuous and click-free by construction. Zone changes
just set a new target.

**Crossfade.** Two read heads. When the target time differs from the playing
head's time by more than 0.5 %, the idle head jumps to the new time and the
two crossfade (equal-power) over 30 ms (Comb/Short), 60 ms (Echo) or 120 ms
(Long/Vast). Changes arriving during a crossfade are latched and applied
when it ends (latest value wins), so fast modulation in this mode becomes
stepped at the crossfade rate, never clicky. Pitch never changes.

*Wobble* is added after the mode logic, as a continuous offset of the read
position, in both modes (the crossfading heads take it as an offset, so it
never triggers a crossfade). Peak depth per zone: 0.12, 1.8, 2.5, 4 and 6 ms.

### 4.4 Stereo, Offset and Ping-Pong

Each channel has its own head; *Offset* skews the right channel's time. With
*Ping-Pong* on, the feedback crosses over (L → R, R → L) and the input to
the right line is muted for the first pass (the left line takes the mid of
both inputs instead), so a mono source bounces. Turning
*Ping-Pong* on or off crossfades the feedback routing over 20 ms; repeats
already in the buffer keep bouncing or settle.

### 4.5 Reverse

Reverse plays the most recent *Time* worth of audio backwards in repeating
windows: two heads, each reading backwards from the write head over one delay
time, offset by half a window, with raised-cosine windows that sum to 1.
The feedback path takes the reversed signal, so repeats alternate direction
when *Reverse* is on throughout. Switching *Reverse* crossfades the forward
and reversed reads over 20 ms. The window is at most half the buffer (15 s):
longer Vast times reverse in 15 s windows.

### 4.6 Hold

*Hold* high: recording into the buffer stops and the loop region is the
current delay time per channel (`dsp::HoldLoop`): playback continues exactly
where the read head was, the loop seam is crossfaded over 10 ms, and the loop
replays without loss (feedback is effectively 1). *Character* and *Diffuse* are bypassed for the held loop so
it doesn't degrade (later: an option to keep them for evolving loops).
*Time* still moves the read head inside the held region: in Tape mode it
changes speed (pitch), in Crossfade mode it changes the loop length. Hold low:
writing resumes and the output crossfades from the held loop back to the live
read over 20 ms; the knobs apply again. Combined with *Reverse*, a
held loop plays backwards.

### 4.7 Character

*Character* morphs through five loop characters; between two neighbours both
are computed and crossfaded, so modulation is smooth.

| Position | Name | In the loop |
|---|---|---|
| 0 % | Clean | flat, 20 kHz low-pass only |
| 25 % | Tape | 1-pole low-pass ≈ 7 kHz, 40 Hz high-pass, soft tanh saturation, a little hiss (−80 dB, seeded) |
| 50 % | Dark | 2-pole low-pass ≈ 2.2 kHz, 120 Hz high-pass, gentle saturation |
| 75 % | Band | resonant band-pass (Q 2) at ≈ 1 kHz: telephone-like repeats |
| 100 % | Lo-Fi | 12 kHz sample-rate reduction, 10-bit quantization, 5 kHz low-pass, mild saturation |

*Tone* moves every filter's cutoff by ±2 octaves. All filters are TPT
(zero-delay feedback), so per-sample modulation is safe. The character is
applied to everything written into the line (input plus feedback), so the
first echo already has it and every pass adds more. After the character, the
loop's safety net is linear up to ±1 and bends softly towards ±1.5, so
Feedback > 100 % builds into a stable, compressed drone instead of exploding,
also in Clean. In the Comb zone the Clean low-pass's group delay is
subtracted from the read time, so the comb stays in tune.

### 4.8 Diffuse

Four allpasses in series in the feedback path per channel (`dsp::Diffuser`,
lengths 3–23 ms, × 0.05 in Comb and × 0.25 in Short, the scale gliding over
100 ms on zone changes), coefficient 0.7 × Diffuse, blended with the
undiffused path by Diffuse (so 0 % is exactly the clean loop and the stage
idles), lengths slowly modulated (±0.3 ms, seeded rates) to avoid metallic
ringing. Each pass through the loop smears the repeat further: the first
echo is still recognizable, later ones dissolve into a cloud. At 100 % with
Feedback near 100 % it behaves like a reverb with a delay-time pre-delay.

### 4.9 Tails, transport and determinism

- Transport stop doesn't touch the buffer: the echoes ring out.
- *Clear on Play* empties the buffer on `transportStarted`, for
  bit-identical offline renders; the old tail's last output value is ramped
  to zero over 5 ms so the cut doesn't click (renders are identical from
  then on). Wobble and hiss restart from *Seed* at the same moment either way.
- In Transport sync, the *Tap* output and Hold loop boundaries are not
  phase-aligned to bars (a delay has no phase); sync only sets the time.

### 4.10 CPU and memory

- ≈ 0.5 % of one core at 48 kHz without Diffuse, ≈ 0.8 % with; Crossfade mode
  doubles the reads during fades.
- Buffer: 20 s + 50 % offset headroom per channel → 30 s × 2 channels,
  rounded up to a power of two by `dsp::RingDelay`: 16 MB at 44.1/48 kHz,
  32 MB at 96 kHz, 64 MB at 192 kHz, allocated in `prepare()`.
- Measured: ≈ 1 % of one core in the module harness (all inputs patched,
  three knobs modulated); Wobble is computed at control rate (every 32
  samples, interpolated).
- Inside a Voice Cell this multiplies per voice; the Add menu should warn
  (7.3).

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │ Zone  ① ② ●③ ④ ⑤      375 ms  (1/8.)   R 412 ms               │
 │ ┌───────────────────────────────────────────────────────────┐ │
 │ │ ▁▃█▃▁    ▁▂▆▂▁     ▁▂▄▂▁     ▁▁▃▁▁   echoes, scrolling  │ │
 │ └───────────────────────────────────────────────────────────┘ │
 │  [◀◀ Reverse]  [■ Hold]  [⇄ Ping-Pong]                        │
 └───────────────────────────────────────────────────────────────┘
```

- **Zone strip:** five buttons; the modulated zone is highlighted. Clicking
  sets the knob.
- **Time readout:** effective left and right times; synced note value in
  brackets.
- **Echo display:** the wet output's envelope as a scrolling strip with
  markers at each delay time, so feedback, diffusion and character are visible.
- **Reverse, Hold, Ping-Pong** buttons latch and OR with their gate inputs.

## 6. Saved state

Knob and setting values, plus the three latched buttons:

```json
{
  "type": "zone-delay",
  "params": { "zone": 0.5, "time": 0.5, "feedback": 0.36, … },
  "data": { "reverse": false, "hold": false, "pingPong": false }
}
```

Buffer contents are not saved; a held loop is lost when the board closes
(later: save held loops as audio, 9).

## 7. Engine requirements

1. **Shared delay toolkit** `patch/common/dsp/Delay.h` (with Verb, Delay Net,
   Bender): fractional delay line, slew-limited time follower, two-head
   crossfader, windowed reverse reader.
2. **Large buffers in `prepare()`**: up to tens of MB at high sample rates.
   Allocation happens on the message thread when the program is compiled; a
   failed allocation disables the module (silent, with a message on its node)
   instead of crashing.
3. **Heavy-module hint:** a `ModuleSpec` flag (`memoryHeavy`) so the board can
   warn before placing the module inside a Voice Cell (memory × voices).
4. Node data for the latched buttons (`sanitiseData`).

## 8. Tests

- Each zone's free range and synced note values give the right times (± 1
  sample) at 120 BPM and 90 BPM.
- Clock mode: delay equals the measured interval × the chosen ratio.
- Comb zone with *Pitch* = 0.75 (A4 = 440 Hz) and Feedback 95 %: the output's
  fundamental is 440 Hz ± 3 cents.
- **Tape mode:** a step in Time produces no discontinuity (sample-to-sample
  step below a threshold relative to input level) and a measurable pitch
  shift during the glide.
- **Crossfade mode:** a step in Time produces no pitch change; modulation
  faster than the crossfade becomes stepped but click-free.
- **Reverse:** a ramp input comes out descending for a large part of each
  window (each head is exactly reversed; the raised-cosine crossfade between
  them adds the window shape); window sums are 1 (no amplitude modulation on
  a constant input).
- **Hold:** with input continuing, the loop content stays identical for
  60 s (bit-exact with Character/Diffuse bypassed).
- Feedback 110 %: output stays bounded (< +6 dBFS) for every character.
- Ping-Pong: an impulse on L appears alternately on R and L.
- Clear on Play: renders are bit-identical (after the 5 ms declick); same
  Seed, same Wobble.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Save and load held loops as audio files (node data with an asset).
- Multiple heads per channel (a rhythmic multi-tap mode; see also Delay Net).
- *Character* inside a held loop for degrading loops over time.
- Pitch-shifted repeats (±12 semitones per repeat) using the crossfade heads.
- Ducking of the wet signal by the dry input.
