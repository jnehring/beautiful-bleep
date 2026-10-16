# Chart Recorder

## Introduction

Chart Recorder is a pen drawing a signal onto a looping strip of paper; the
strip plays back as modulation. The pen is a heavy, sprung mechanism: it
lags, overshoots, sticks and bangs into its end stops, so even a plain
envelope comes out with character, live at *Pen*. The strip replays at
another speed, backwards, locked to the song or scrubbed by hand, and you
can draw on the paper with the mouse.

## How does it work?

**Detector.** *In* goes through *Gain* into the detector, which decides what
the pen draws:

- **DC:** the signal itself, −1 … +1. For control signals.
- **Rectified, RMS:** the average level, smoothed over *Response*.
- **Peak:** jumps up at once and falls back over *Response*.
- **Log dB:** the RMS level in decibels, like a level recorder: 0 dBFS at the
  top edge, −*Log Range* at the bottom.

Audio into *In* is fine with the level detectors. With DC, *Pen* and *Replay*
are bipolar (−1 … +1); with the others they are unipolar (0 … 1).

**The pen** is a weight on a spring with a damper. *Writing Speed* is how
fast it can move and how stiff the spring is: fast, it follows closely; slow,
it draws straight ramps between levels. *Damping* low makes it overshoot and
wiggle around each new level; high makes it creep. *Friction* makes it stick:
small changes don't move it until they add up (up to 4 % of the paper width),
so smooth movement turns into small steps. At the edges of the paper the pen
hits its end stops and bounces back a little: an overdriven input draws
flattened tops with a small kick. *Pen* always carries the pen's position,
whether it is writing or not. There is no randomness: the same input draws
the same line.

**Paper.** The strip is *Length* long and loops. With *Paper* on
*Transport* it moves with the song (1 … 64 bars) and stands still while
the transport is stopped; on *Free* it runs all the time (1 s … 10 min), at
*Paper Speed*. *Hold Paper* (the input or the button) stops the paper while
the pen keeps writing into the same spot; in Transport mode the paper rejoins
the song when you let go. The strip keeps 200 points per second (coarser
beyond 2 minutes). Changing *Length* resamples it; a tempo change stretches it
with the song.

**Recording.** *Record* decides when the pen writes:

- **Always:** whenever the paper moves.
- **Gate:** while the *Record* input is high.
- **Armed:** a rising edge on *Record* (or the **Arm** button) arms; writing
  starts when the paper next comes round to the start, and stops after
  exactly one pass. The view shows Armed, Writing and Done.

Writing replaces what was on the paper. **Clear** (input or button) wipes the
strip and its marks. **Mark** puts a tick on the paper edge where the pen is.

**Replay.** The replay head reads the strip at *Replay Speed*: 1× is the
paper's own speed, negative runs backwards, 0 parks it. With *Replay Sync* on
*Song* its position follows the song position (it holds while stopped);
on *Free* it runs on its own and *Reset* sends it back to the start (to
*Offset*).
*Offset* is added to the head, so with *Replay Speed* at 0 it scrubs through
the strip. *Interpolation* reads between points: *Step* holds each point,
*Linear* draws lines, *Smooth* draws curves. Unwritten paper reads the last
ink before it; an empty strip reads 0. *Marker* fires whenever the replay
head passes a mark, in either direction. *Position* is the replay head,
0 at the start of the strip and 1 at the end.

**Drawing.** In the view, drag on the paper to draw ink, Shift-drag for one
straight line, right-drag to erase and Alt-click to add or remove a mark.
Each drag is one undo step. The strip is saved with the board; what the
module records is saved too (when recording stops, after each pass and every
few seconds while writing).

## How to use it?

- **A character envelope:** an ADSR into *In*, *Writing Speed* 30 mm/s,
  *Damping* 20 %: *Pen* is the envelope with momentum, overshoot and ringing.
- **Sticky steps:** a slow LFO into *In*, *Friction* 70 %: *Pen* moves in
  irregular little steps.
- **Record a gesture, play it back:** a Dial into *In*, *Record* on Armed,
  press **Arm** and move the dial for one pass. *Replay* loops it in time with
  the song; set *Replay Speed* to −1 to play it backwards or 0.5 for half speed.
- **A level follower:** a drum bus into *In*, *Detector* Log dB, *Response*
  100 ms: *Replay* gives the loop's loudness contour, ready for ducking or
  filter moves.
- **A scrubbed table:** *Replay Speed* 0 and a modulation source into *Offset*:
  the strip becomes a drawn transfer curve.
- **Events from the drawing:** Alt-click marks onto the paper and patch
  *Marker* into an envelope's trigger.
- **Inside a Voice Cell:** every voice has its own pen and replay head; only
  the first voice records.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Chart Recorder does. In the standalone app open **File → Presets…** (⌘P) and pick *Chart Recorder* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Chart Recorder: Pen with Momentum** | An envelope that follows a bass line is drawn by a slow pen with little damping, so the pen overshoots and wobbles around each level: that wobble sweeps the filter. Turn Writing Speed up for a tight envelope, Damping up for a lazy one, and watch the pen on the paper. |
| **Chart Recorder: Sticky Steps** | A smooth slow LFO is drawn with a pen that sticks: it only moves once the change has built up, so Pen becomes irregular little steps that a Quantizer turns into a wandering pentatonic melody. Lower Friction for a smoother line and more notes, raise it for fewer, bigger leaps. |
| **Chart Recorder: Backwards Gesture** | A smooth random walk is drawn live on a four-bar strip: one voice plays the live pen, and a second plays what the paper replays backwards, so the melody answers itself in reverse. Try Replay Speed 0.5 or 2, or switch Interpolation to Step. |
| **Chart Recorder: Loudness Contour** | The drum bus is drawn as a level trace (Log dB, Response 100 ms), and an inverted Pen pumps a chord pad so it ducks on every kick. Change Detector or Response, or use the Replay output for a duck that arrives a loop later. |
| **Chart Recorder: Drawn Table** | A curve drawn on the paper is read as a table: Replay Speed is 0 and a slow LFO on Offset scrubs through it, so the drawn shape becomes a looping melody. Draw on the paper in the view (Shift-drag for lines), or set Interpolation to Step to hear each plateau. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Gain | −24 … +24 dB | 0 dB |
| Response | 1 ms – 2 s | 50 ms |
| Writing Speed | 1 – 1000 mm/s | 100 mm/s |
| Damping | 0 – 100 % | 70 % |
| Friction | 0 – 100 % | 0 % |
| Paper Speed | 0.25 – 4× | 1× |
| Replay Speed | −4 … +4× | +1× |
| Offset | 0 – 100 % | 0 % |
| Detector | DC, Rectified, RMS, Peak, Log dB | DC |
| Log Range | 10, 25, 50, 75 dB | 50 dB |
| Paper | Free, Transport | Transport |
| Length (Free) | 1 s, 2 s, 5 s, 10 s, 30 s, 1 min, 2 min, 5 min, 10 min | 10 s |
| Length (Transport) | 1, 2, 4, 8, 16, 32, 64 bars | 4 bars |
| Record | Always, Gate, Armed | Gate |
| Replay Sync | Free, Song | Song |
| Interpolation | Step, Linear, Smooth | Linear |

- **Gain:** the input level before the detector.
- **Response:** the averaging time of Rectified, RMS and Log dB; the fall time of Peak.
- **Writing Speed:** the fastest the pen moves; also its stiffness.
- **Damping:** low overshoots and wiggles, high creeps.
- **Friction:** how much change it takes to move the pen.
- **Paper Speed:** the paper's speed in Free mode (only shown there).
- **Replay Speed:** the replay head's speed; negative runs backwards.
- **Offset:** shifts the replay head along the strip.
- **Log Range:** the span of the paper with the Log dB detector (only shown then).

The eight knobs are modulation destinations. The **Clear**, **Arm** and
**Hold Paper** buttons act like the inputs (Hold Paper toggles).

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | control | the signal to draw (audio is fine with the level detectors) |
| Record | gate | writes while high (Gate); a rising edge arms one pass (Armed) |
| Mark | trigger | puts a mark on the paper at the pen |
| Hold Paper | gate | stops the paper while high |
| Clear | trigger | wipes the strip and its marks |
| Reset | trigger | sends the replay head back to *Offset* (Replay Sync Free) |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Pen | control | the live pen position, writing or not |
| Replay | control | the strip, read at the replay head |
| Marker | trigger | a pulse whenever the replay head passes a mark |
| Position | control | the replay head, 0 … 1 along the strip |
