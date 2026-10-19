# Scene Arranger

## Introduction

A song-form machine for the things that choose patterns. It holds up to
sixteen scenes and a play order of up to sixteen slots; each slot says which
scene plays and how many times. When a scene has played out, its **follow
action** decides what comes next: carry on down the list, go to the next or
previous scene, jump to a given one, pick one at random, hold, or flip a
weighted coin.

The current scene leaves as a **Scene** CV that a pattern selector reads
directly (the Drum Grid's *Pattern* input, for one), as a **Change** trigger
on every new scene, and as eight **Lane** gates that light up for the scenes
you give each lane. You can launch scenes by hand with the *Launch* knob, the
*Launch* jack, *Next*, *Previous*, and have the switch wait for the next beat
or bar.

## How does it work?

**Time.** Unpatched, the module follows the song: one beat is a quarter note.
With a trigger in *Clock*, each pulse is one beat. *Beats per Bar* (4) tells
it where the bar lines are. *Scene Length* is how long one play of a scene
lasts: 1 or 2 beats, or 1 … 16 bars.

**Play order.** *Order Steps* is how many slots are used. Slot *n* holds a
scene (*Slot n*) and how many lengths it plays (*Repeat n*). After the last
slot the list starts again and *Cycle* sends a trigger. Scenes that are not
in the list can still be reached by launching or by a follow action; a scene
that is on the list plays the repeat count of its first slot, any other plays
once.

**Follow actions.** When a scene's repeats are over, its *Follow* decides:

- **Order**: the next slot of the play order.
- **Next / Previous**: the scene above or below (wrapping at *Scenes*).
- **Random**: any other scene, chosen from *Seed* so renders repeat.
- **Hold**: stay on the scene until something launches another one.
- **Jump**: go to the scene in *Jump*.
- **Chance**: go to *Jump* with the probability in *Chance*, otherwise carry on down the list.

**Launching.** *Launch* (a stepped knob, 0 = none), the *Launch* jack
(scene = ⌊value × 16⌋ + 1, acting when it changes), *Next* and *Previous*
(trigger jacks and buttons) all ask for a scene. *Launch Quantize* decides
when it happens: **Immediate**, at the next **Beat**, or at the next **Bar**.
While a launch waits, the *Queued* gate is high. A newer request replaces an
older one. A launch starts a new visit: the scene plays its repeat count from
that moment, counting the part of the length that is already running as the first.
*Restart* (button) and *Reset* (jack) go back to slot 1. A launch made while
the song is stopped decides which scene play starts on.

**Outputs.** *Scene* is the number of the scene: *Slot of 16* puts scene *n* in
the middle of slot *n* of 16, which is exactly what a 16-pattern selector reads;
*Linear* gives *n* / 15. *Change* is a short pulse every time a scene starts
(also when the list plays the same scene twice in a row). *Lane 1 … 8*: lane *k*
is high while the scene is between *Lane k From* and *Lane k To* (From 0 turns
a lane off); with *Lane Output* on *Trigger* it pulses when a scene inside its
range starts. Lanes are low while the song is stopped.

## How to use it?

- **Song form for a drum machine:** *Scene* into the Drum Grid's *Pattern*,
  scenes 1 to 4 for intro, groove, fill and break.
- **A fill every fourth round:** give a scene *Chance* with *Jump* to the fill scene.
- **Sections by lane:** lane 1 on scenes 1 … 8 for the kick, lane 2 on 3 … 8 for
  the hats, lane 3 on 5 … 8 for the lead, each into a VCA's gain or a mixer mute.
- **Live launching:** *Launch Quantize* on Bar, *Order Steps* 1 and *Follow* Hold:
  nothing moves until you ask, and then it lands on the bar.
- **Generative sections:** every scene on *Random*, with *Lane* gates doing the arrangement.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Scene Arranger does. In the standalone app open **File → Presets…** (⌘P) and pick *Scene Arranger* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Scene Arranger: Song Form** | The Scene output drives the Drum Grid's Pattern input: intro, groove, fill and break are four patterns, played in the order intro, groove x2, fill, groove x2, break by the arranger's play order. Change Repeat or Slot knobs to rewrite the song; the Cycle trigger marks each time round. |
| **Scene Arranger: Chance Fills** | Scene 2 is the groove and holds on a Chance follow action: each time round there is a one in three chance of jumping to the fill scene, otherwise it plays on. The fill always returns to the groove. Raise Chance 2 for busier fills, or change the Seed for another sequence. |
| **Scene Arranger: Lane Arrangement** | Four scenes of four bars bring layers in and out through the lane gates: the pad from the start, the bass from scene 2, the lead from scene 3 and the bells only in scene 4. Edit a lane's From and To to rearrange who plays when. |
| **Scene Arranger: Random Bells** | Six scenes that all follow Random: the arranger wanders between them and each scene's lane fires a trigger into its own bell tone, so the tune is a random walk that repeats exactly while the Seed stays put. Change the Seed for a new walk or the Scene Length for a faster one. |
| **Scene Arranger: Filter Staircase** | Eight scenes of one bar each, and the linear Scene output climbs a staircase that opens a low-pass filter on the arp; the Cycle trigger plays a clap when the staircase starts again. Change Scenes to shorten the climb or Follow on a scene to Previous to make it zigzag. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Scene Arranger view has 17 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Four Scene Loop** | Scenes 1 to 4, one bar each, round and round; manual launches wait for the bar line. |
| **Verse and Chorus** | A song shape: two verse rounds, two chorus rounds, then a bridge and an outro. |
| **Long Form** | Eight scenes of four bars, every odd one twice: a 48-bar arrangement. |
| **Ping Pong** | Up through the scenes and back down without repeating the end scenes. |
| **Random Walk** | Every scene hands over to a random other one; the seed makes the walk repeatable. |
| **Drift Forward** | Follow action Next on every scene: the order list is ignored and the scenes simply step on. |
| **Hold the Last** | Plays 1, 2, 3 and settles on scene 4 until you launch something else. |
| **Chance Breakdown** | After scene 3 there is a one in three chance of dropping back to scene 1 instead of moving on. |
| **Stutter Back** | Scene 2 always falls back to 1; scene 4 flips a coin between 3 and the start. |
| **Beat Launcher** | Nothing moves on its own: launches from the knob, buttons or jack land on the next beat. |
| **Bar Launcher** | Sixteen scenes for a pattern selector, launched on the bar; the Queued gate shows what is waiting. |
| **Immediate Switch** | Scenes change every beat and a launch cuts in at once: for fast, hands-on switching. |
| **Phrase Lengths** | Eight-bar phrases, the second and fourth played twice. |
| **Lane Groups** | Each lane covers a range of scenes: pairs, the whole run, the middle and the centre two. |
| **Lane Triggers** | Lane outputs give a short trigger when their scene starts instead of holding a gate. |
| **Linear Scene CV** | The Scene output climbs from 0 to 1 over scenes 1 to 16: a staircase for filters and pitch. |
| **Odd Meter Bars** | Seven beats to the bar: scene length and launches follow the odd bar. |
<!-- /generated -->

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Scenes | 1 – 16 | 8 |
| Order Steps | 1 – 16 | 8 |
| Launch | 0 (none) – 16 | 0 |
| Slot 1 … 16 | scene 1 – 16 | 1 … 16 |
| Repeat 1 … 16 | 1 – 16 | 1 |
| Follow 1 … 16 | Order, Next, Previous, Random, Hold, Jump, Chance | Order |
| Jump 1 … 16 | scene 1 – 16 (Jump and Chance) | 1 |
| Chance 1 … 16 | 0 – 100 % (Chance) | 50 % |
| Lane 1 … 8 From | 0 (off) – 16 | 1 … 8 |
| Lane 1 … 8 To | 1 – 16 | 1 … 8 |

### Settings

| Setting | Values | Default |
|---|---|---|
| Scene Length | 1 beat, 2 beats, 1, 2, 4, 8, 16 bars | 2 bars |
| Launch Quantize | Immediate, Beat, Bar | Bar |
| Beats per Bar | 1 – 16 | 4 |
| Scene CV | Slot of 16, Linear 0-1 | Slot of 16 |
| Lane Output | Gate, Trigger | Gate |
| Seed | 0 – 999 | 1 |
| Sync To | Auto, Clock, Transport | Auto |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | patched: each pulse is one beat |
| Reset | trigger | back to slot 1; the next beat is beat 0 |
| Next | trigger | launch the scene after the current (or queued) one |
| Previous | trigger | launch the scene before it |
| Launch | control | scene = ⌊value × 16⌋ + 1, launched when it changes |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Scene | control | the scene number, for pattern selectors |
| Change | trigger | a scene (visit) starts |
| Cycle | trigger | the play order wraps to slot 1 |
| Queued | gate | a launch is waiting for its beat or bar |
| Lane 1 … 8 | gate / trigger | the scene is in the lane's range |
