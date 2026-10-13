# Delay

Type id `delay` · category *Effects* · colour proposal `#5b8def`

## 1. Purpose

The plain stereo delay: one delay line per side, each with its own time, free
in milliseconds or locked to the song's tempo, with feedback, a low cut and a
high cut in the feedback path, and a ping-pong mode. It is the small sibling of
Zone Delay (`zone-delay.md`), which is for sound design; this one is for
echoes on a track. Its design follows the usual simple and ping-pong delays of
DAWs, without borrowing a name.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input. |
| In R | `audio` | Right input; unpatched, it follows *In L* (mono in, stereo out). |

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L | `audio` | Dry and echoes, left. |
| Out R | `audio` | Dry and echoes, right. |

Every knob is also an input (`specs.md` section 7.3).

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Time L | 1…2000 ms, exponential | 300 ms | Left delay time. Shown with *Sync* = Free. |
| Time R | 1…2000 ms, exponential | 300 ms | Right delay time. Shown with *Sync* = Free. |
| Feedback | 0…100 % | 40 % | How much of each echo returns. |
| Low Cut | 20…2000 Hz, exponential | 20 Hz (off) | High-pass in the feedback path. |
| High Cut | 500…20000 Hz, exponential | 20 kHz (off) | Low-pass in the feedback path. |
| Mix | 0…100 % | 50 % | Dry to wet. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Sync | Free, Tempo | Free |
| Rate L | 1/32, 1/16T, 1/16, 1/16., 1/8T, 1/8, 1/8., 1/4T, 1/4, 1/4., 1/2T, 1/2, 1/2., 1/1 | 1/8 |
| Rate R | the same | 1/8 |
| Mode | Stereo, Ping-Pong | Stereo |

*Rate L* and *Rate R* are shown with *Sync* = Tempo.

## 4. Behaviour

### 4.1 Time

With *Sync* = Free the times are *Time L* and *Time R* in milliseconds. With
*Sync* = Tempo each side's time is its *Rate* at the transport's tempo
(`dsp::beatsToSeconds`, 4/4 assumed). Times are limited to 4 seconds (a 1/1
below 60 BPM is shortened to 4 s).

A change of time, by hand, by modulation or by a tempo change, is followed
tape-style (`dsp::TapeTime`: a one-pole glide of 120 ms, with the read head's speed
limited to ±50 %): the echoes bend in pitch and never click. The first block
after a reset starts at its times without gliding.

### 4.2 Signal path

Per side, `read(time − 1)` is taken before the write (so the echo is
exactly *time* samples late; cubic interpolation) and the line is written with

- **Stereo:** `in + limit(filter(echo) × feedback)`, left and right independent.
- **Ping-Pong:** the left line gets the mono sum of both inputs plus the
  filtered *right* echo; the right line gets only the filtered *left* echo. The
  first echo is on the left, the next on the right, and so on. With both times
  equal the echoes alternate evenly; unequal times give a loping pattern.

*filter* is a one-pole high-pass (*Low Cut*, bypassed at 20 Hz) then a one-pole
low-pass (*High Cut*, bypassed at 20 kHz). *limit* is linear up to ±0.8 and
bends smoothly towards ±1, on the repeats only (the input is never limited), so
*Feedback* at 100 % holds a loop instead of growing without bound.

Output: `in + mix × (echo − in)`.

### 4.3 Housekeeping

- Memory: two lines of 4 s each (`memoryHeavy`: the board warns before it goes into a Voice Cell).
- A reset (stop, sample-rate change) clears the lines.

## 5. Module view

The generic module view (knobs and settings; the knobs for the other *Sync*
mode are hidden).

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

`Transport::bpm`, `dsp/Delay.h` (`RingDelay`, `TapeTime`), `dsp/Tempo.h` (all exist).

## 8. Tests

`patch/modules/delay/tests/test_stereo_delay.cpp`:

- An impulse comes back exactly after the time.
- Feedback 50 %: repeats at 1, 0.5, 0.25.
- Feedback 100 % stays bounded and finite for five seconds.
- Ping-pong: first echo left only, second right only.
- *High Cut* removes high-frequency content from the repeats.
- Synced rates are the right note values.
- A time change glides: no jump in the output.

## 9. Later

- Freeze, and a tap-tempo-style *Time* link between the sides (R = L × ratio).
- Stereo width and a modulation (chorus-style wobble) for the echoes.
- A display of the filter curve.
