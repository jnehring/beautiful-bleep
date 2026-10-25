# Verb

![Verb in the module view](reverb.png)

## Introduction

Verb is a stereo reverb built to be **played**, not just set. Every knob,
including *Size* and *Decay*, can be modulated, even at audio rate, without
zipper noise or clicks. It goes from small rooms through halls to endless,
slowly drifting pads, and **Freeze** holds whatever is in the reverb for as
long as you like. Patch an envelope onto *Size* for swelling spaces, an LFO
onto *Decay* for breathing tails, or a sequencer onto *Freeze* for rhythmic
holds. Switch **Type** to *Spring* and the same knobs drive a different tank:
a metallic, dispersive, boingy spring-like tail.

## How does it work?

The sound first passes a **pre-delay**, then four *diffusers* per channel
(allpass filters that smear the onset into a dense wash), then the *tank*: a
feedback delay network of 16 delay lines (8 in *Eco* quality) whose outputs
are mixed and fed back into each other. Every line loses a little level and
a little treble on each pass, which sets how long and how dark the tail is.
Slow internal modulation of the line lengths keeps the tail from ringing
metallically.

- **Size** scales every delay in the tank, from a small booth (≈ 3 m) to a
  huge space (≈ 60 m). Moving it bends the tail in pitch like tape speeding
  up or slowing down, never a click; very fast modulation turns into a
  shimmer.
- **Decay** is the time the tail takes to fall by 60 dB (T60), 0.1 s to
  60 s. Above that the knob enters the *infinite* zone: between 92 % and
  96 % the decay stretches towards endless, and from 96 % up the tail never
  fades (the view says *Infinite*). New sound keeps piling up there, so a
  soft limiter steps in whenever the tank gets loud.
- **Damping** makes the highs die faster than the mids (at 100 % the treble
  decays ten times faster). **Bass** stretches (up to 2×) or shortens (down
  to ½) the lows.
- **Diffusion**: low values keep the early echoes audible; high values give
  a smooth wash.
- **Mod Rate** and **Mod Depth**: speed and amount of the internal movement.
  0 % depth is static (and can ring); 100 % is a seasick chorus.
- **Tone** tilts the reverb around 800 Hz, ±6 dB: dark ↔ bright.
- **Width** sets the stereo width of the reverb: 0 % mono, 100 % as the tank
  makes it, 150 % wider.
- **Mix** blends dry and wet with equal power. *Wet L/R* always carry the
  reverb alone.

### Type: Hall and Spring

**Hall** (the default) is the tank described above. **Spring** replaces it
with a coil: for each channel a delay line the length of the coil, in a
feedback loop with 36 chained allpass filters. The allpasses delay the lows
more than the highs, so on every round trip a note is smeared into a falling
chirp, and the echoes pile up into the metallic "sproing" of a real spring.
The two channels are coils of different length, so a mono input still gives
a stereo tail. A soft limiter (tanh) sits at the loop's write point, so
loud input makes the tail compress, never explode.

With *Spring* the knobs mean:

- **Size** is the length of the coil: 22 ms per round trip at 0 % (a tight,
  fast flutter) to 122 ms at 100 % (slow, separate drips). Moving it bends
  the pitch of the tail.
- **Diffusion** is the **dispersion**: how strongly the lows lag the highs.
  At 0 % the coil is only a ringing delay; at 100 % each hit becomes a long,
  drooping chirp.
- **Decay**, **Damping** and **Bass** work as in the hall (T60 per round
  trip, treble loss, low-band T60). Damping at 40 % already gives the dull,
  wet tone of a coil. The infinite zone holds the coil indefinitely.
- **Mod Depth** makes it boing: the level of what enters the coil shortens
  the loop for a moment, so every hit bends upward and then sags back as the
  hit dies away. A slow wobble of the length (speed: **Mod Rate**) is added.
  At 0 % the coil is static.
- **Pre-delay**, **Tone**, **Width**, **Mix**, **Freeze** and **Clear**
  behave as before. *Quality* and *Seed* only belong to the hall and are
  hidden while *Spring* is selected.

Switching *Type* goes through the same 10 ms fade as *Quality* and *Seed*:
the old tail is cut cleanly, the new tank starts empty.

### Room: early reflections

Real rooms announce themselves before the tail starts: the first few echoes
off the walls, floor and ceiling arrive as separate, panned clicks that tell
the ear how big the room is and where you stand in it. **Room** adds exactly
that, ahead of either tank: *Booth*, *Studio*, *Club*, *Hall* or *Chapel*
(*Off* by default). Verb places a source and a listener in a box of that
size and works out where the sound bounces: the 24 earliest echoes, each with
its own delay, level, stereo position and darkening (walls and air swallow the
highs with every bounce). **Early** sets their level (100 % has the energy of
the dry sound), and **Size** stretches the room from half to double its size.
Pre-delay, Tone, Width and Freeze apply to the reflections as to the tail.

**Freeze** (the gate input, or the latching *Freeze* button in the view):
within 20 ms the input to the tank fades out and the tail stops decaying.
The modulation keeps running, so the held sound shimmers instead of
freezing solid. *Size* and *Mod Depth* still act on it; *Decay*, *Damping*
and *Bass* return when you release. The dry path is untouched, so you can
play over a frozen pad.

**Clear** (trigger input or button) fades the reverb out over 10 ms,
empties it and fades back in. **Clear on Play** empties it when the
transport starts, so two renders of the same section are identical.
Otherwise a tail from before keeps ringing, as on a hardware reverb. The
internal modulation restarts from **Seed** on every transport start, so it
repeats too. Changing *Quality* or *Seed* also goes through a short fade.

**Pre-delay Sync** sets the pre-delay to a note value at the song tempo
(1/64 to 1/2, straight, dotted or triplet, at most 1 s); the *Pre-delay*
knob is hidden then.

The view shows the decay of the lows, mids and highs from the current
(modulated) settings on a log time axis, with the pre-delay as a gap, a
Freeze button that lights while frozen (from the button or the gate), and a
meter of the wet level.

## How to use it?

- **Send effect:** *Mix* 100 %, feed it from a send or a mixer's aux, take
  *Out* (or *Wet*) back in.
- **Insert:** *Mix* 20–40 % directly after a voice or a drum bus.
- **Swelling space:** an ADSR onto *Size* (and a little onto *Decay*).
- **Breathing tail:** a slow LFO onto *Decay* or *Damping*.
- **Endless pad:** *Decay* at the top (Infinite), *Mix* 100 %, play chords
  in, then lower *Decay* to let it go. Or *Freeze* with a gate from a
  sequencer for rhythmic holds.
- **Ducked reverb:** the *Env* output of a drum bus onto *Mix* with a
  negative amount.
- **Tempo pre-delay:** *Pre-delay Sync* 1/16 or 1/8 keeps the reverb off
  the transient, in time.
- **Shimmer-ish:** *Mod Depth* high, *Mod Rate* 2–4 Hz, *Tone* bright.
- **Boing spring:** *Type* Spring, *Size* about 40 %, *Diffusion* 70 % or
  more, *Mod Depth* 40 %. Feed it short, bright hits (a click, a snare, a
  plucked tone) and sweep *Size* for a coil being stretched.
- **Dub throw:** *Type* Spring, *Mix* 100 % on an aux, a gate or a drum
  trigger onto the input, *Decay* about 3 s; ride *Decay* up for a throw.
- **A place for a dry sound:** *Room* Studio, *Early* 60 %, *Decay* about
  1 s, *Pre-delay* 0: a close, believable room around a drum or a voice.
- **Spatial effects:** an audio-rate oscillator onto *Size* turns the tail
  into a frequency-modulated cloud.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Verb does. In the standalone app open **File → Presets…** (⌘P) and pick *Verb* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Verb: Endless Hall** | Sparse, soft notes sink into a huge hall: Size is almost full, Decay is over twenty seconds and Pre-delay leaves each note clean before the bloom. Try Decay and Size together, or push Mix to 100 %. |
| **Verb: Drum Booth** | A drum beat in a tiny, dry room: low Size, a short Decay and high Damping glue the kit together. Raise Size and Decay to move the same beat into a hall, or widen it with Width. |
| **Verb: Frozen Chord** | A square LFO closes the Freeze gate for a couple of bars at a time, holding whatever is in the tank as an endless chord, then lets go so the next phrase can be caught. Edit the LFO's Sync, or latch Freeze yourself. |
| **Verb: Tide Pool** | Slow LFOs ride Size and Tone while Mod Depth swirls the tail, so the room seems to inhale and exhale around a gentle arpeggio. Every Verb knob modulates click-free: patch your own LFO into Decay. |
| **Verb: Dark Cellar** | A low plucked bass line in a cellar: Bass is boosted, Tone and Damping pull the tail dark, and Eco quality keeps it light. Lower Bass or lift Tone to hear the same room turn into a bright stairwell. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Verb view has 18 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Small Room** | A tight room for natural ambience. |
| **Medium Hall** | General-purpose hall. |
| **Bright Plate** | Dense, bright and fast building plate. |
| **Vocal Space** | Pre-delay keeps a voice clear in front. |
| **Warm Chamber** | Dark and cozy. |
| **Big Cathedral** | Huge stone space with a long tail. |
| **Wide Pad** | A lush, wide wash for sustained sounds. |
| **Shimmer Mod** | Heavy modulation gives a chorus-like shimmer. |
| **Gated Snap** | Short, punchy burst for snares. |
| **Dub Spring** | Sparse, metallic-sounding tail. |
| **Dark Abyss** | Very long, dark and rumbling. |
| **Infinite Freeze** | Practically endless; gate Freeze to hold a chord. |
| **Mono Closet** | Very small and mono: a hint of space. |
| **Eco Wash** | A cheaper eight-line reverb for busy patches. |
| **Boing Spring** | A bright coil that bends up on every hit and droops back: feed it clicks and snares. |
| **Long Drip** | A long coil with slow, separate drips; the lows trail behind the highs. |
| **Tight Flutter** | A short coil: fast metallic flutter with little chirp. |
| **Held Coil** | An endless, wobbling metal drone; play into it, then lower Decay to let it go. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Size | 0 – 100 % | 50 % |
| Decay | 0.1 s – 60 s, then ∞ (top 8 % of the knob) | 2.5 s |
| Pre-delay | 0 – 1000 ms | 20 ms |
| Diffusion | 0 – 100 % | 70 % |
| Damping | 0 – 100 % | 40 % |
| Bass | 0.5× – 2× | 1× |
| Mod Rate | 0.05 – 8 Hz | 0.6 Hz |
| Mod Depth | 0 – 100 % | 25 % |
| Tone | −1 … +1 | 0 |
| Width | 0 – 150 % | 100 % |
| Mix | 0 – 100 % | 35 % |
| Pre-delay Sync | Free, 1/64 … 1/2 (triplet, straight, dotted) | Free |
| Quality | Eco (8 lines), Fine (16 lines) | Fine |
| Clear on Play | Off, On | Off |
| Seed | 0 – 999 | 1 |
| Freeze (latch) | Off, On | Off |
| Type | Hall, Spring | Hall |
| Room | Off, Booth, Studio, Club, Hall, Chapel | Off |
| Early | 0 – 100 % | 50 % |

- **Decay:** the knob reads seconds; past 60 s (92 %) it is the infinite
  zone, from 96 % fully infinite.
- **Damping:** high T60 = Decay × (1 − 0.9 × Damping).
- **Bass:** low T60 (below ≈ 250 Hz) = Decay × Bass.
- **Type:** the tank. *Hall* is the 8/16-line FDN, *Spring* the dispersive
  coil (see above). Not modulatable. *Diffusion* is the coil's dispersion,
  *Size* its length (22 – 122 ms) and *Mod Depth* the boing in *Spring*.
- **Room / Early:** the early-reflections box and its level (see above); both types.
- **Quality:** *Eco* costs about half the CPU; *Fine* is denser. Hall only.
- **Seed:** the start phases and rates of the internal modulation. Hall only.
- **Freeze (latch):** the view's Freeze button; saved with the board (the
  reverb itself opens empty).
- The settings are not modulatable; all knobs are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In L | audio | left input; also feeds the right channel when *In R* is not patched |
| In R | audio | right input |
| Freeze | gate | while high, the reverb holds its contents (ORed with the latch) |
| Clear | trigger | empties the reverb with a 10 ms fade |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out L, Out R | audio | the dry/wet mix set by *Mix* |
| Wet L, Wet R | audio | the reverb only (after *Tone* and *Width*) |
| Env | control, 0 – 1 | envelope follower on the wet signal (5 ms attack, 200 ms release) |

Verb uses about 2.5 MB of memory per instance at 48 kHz (the Spring tank needs less). Inside a Voice Cell
every voice gets its own reverb, so it's usually better placed after the cell.
