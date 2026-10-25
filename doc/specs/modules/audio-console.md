# Audio Console

Type id `audio-console` · category *Audio/Mixing* · colour `#f97316`

## 1. Purpose

A mixing console for the board: up to 32 channel strips, each with a mono/stereo choice, a high-pass and a
low-pass filter, a three-band EQ, up to four aux sends, a pan or balance, a fader with a meter, and solo, mute and
record arm; one return strip per aux bus; a master strip with the same processing, a limiter and its own record
arm. Every channel can also leave through a direct output. A multitrack recorder writes every armed channel, aux
bus and the master to its own file.

It is the larger sibling of the [Audio Mixer](audio-mixer.md), which stays as it is: four channels, one send, no
recorder. A board that has an Audio Mixer keeps it.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1…32 L | `audio` | Left (or mono) input of channel *k*. Shown while *k* ≤ *Channels*. |
| In 1…32 R | `audio` | Right input. Shown (and read) only while the channel's *Stereo* setting is on and *k* ≤ *Channels*; switching the channel to mono hides the jack and keeps its cable. |
| Return 1…4 L / R | `audio` | Stereo return of aux bus *j* (*R* unpatched copies *L*). Shown while *j* ≤ *Aux Buses*. |

Every knob is also an input (`specs.md` section 7.3). Knobs and jacks of channels above *Channels* are hidden;
their cables are kept.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L / R | `audio` | The main output (the master). With *Mono Main* on both carry the same signal. |
| Level | `control` (unipolar) | An envelope follower on the main output, for ducking and visualisation. |
| Recording | `gate` | High while a take is being written. |
| Send 1…4 L / R | `audio` | The send bus of aux bus *j*: the sum of every channel at its *Send j* level. Shown while *j* ≤ *Aux Buses*. |
| Direct 1…32 L / R | `audio` | Channel *k* on its own, before or after its fader (*Direct Point*). Shown while *k* ≤ *Direct Outs*. |

## 3. Controls

**Setup** (settings)

| Setting | Values | Default | |
|---|---|---|---|
| Channels | 1…32 | 8 | How many strips, input pairs and knob sets exist. |
| Aux Buses | 0…4 | 2 | How many send buses, send knobs, returns and aux strips. |
| Direct Outs | 0…32 | 0 | How many channels get a direct output pair. |
| Direct Point | Post-fader, Pre-fader | Post-fader | Where the direct outputs are taken. Pre-fader is after the filters and EQ. |
| Mono Main | Off, On | Off | Sums the whole console to mono: no pan, *Out L* = *Out R*. |
| Limiter | Off, On | On | A lookahead peak limiter on the main output (−0.3 dBFS, as in the Audio Mixer). |
| Send Point 1…4 | Post-fader, Pre-fader | Post-fader | Per aux bus. Pre-fader sends ignore the fader and the solo, but follow the mute. |

**Channel *k*** (knobs unless noted)

| Control | Range | Default |
|---|---|---|
| Level | −60 (silence)…+6 dB | 0 dB |
| Pan | −1…+1 | 0 (a balance on a stereo channel) |
| HP | 20…1000 Hz | 20 Hz (off) |
| LP | 1…20 kHz | 20 kHz (off) |
| Lo / Mid / Hi | −15…+15 dB | 0 |
| Send 1…4 | −60 (silence)…0 dB | silence |
| Mute, Solo, Arm, Stereo | settings (Off, On) | Off |

The Lo band is a shelf at 100 Hz, Mid a bell at 1 kHz (Q 0.9), Hi a shelf at 8 kHz. Frequencies are fixed in this
version (see *Later*). Send levels stop at 0 dB: thirty-two channels at +6 dB would put sixty-four times full scale
on one bus.

**Aux strip *j***: Return (fader, −60…+6 dB), Balance, Mute and Arm. **Master**: the same strip as a channel
(Level, Balance, HP, LP, Lo, Mid, Hi, Mute) and Arm; no solo and no sends.

**Record settings**

| Setting | Values | Default |
|---|---|---|
| Start and Stop | Manual, Follow Transport | Manual |
| Format | WAV 16-bit, WAV 24-bit, WAV 32-bit float | WAV 24-bit |
| Channel Tap | Input, Post-fader | Input |

Button: **Record**. The view adds Arm all and Unarm all (they set every visible *Arm*).

## 4. Behaviour

### 4.1 Signal flow

```
In L (R) → [mono: R = L] → HP → LP → Lo → Mid → Hi ─┬─ Direct (pre-fader)
                                                     ├─ pre-fader sends ─────────────┐
                                                     └→ Level → Mute → Pan ─┬─ Direct (post-fader)
                                                                           ├→ Solo → main bus
                                                                           └─ post-fader sends ┐
 Send j bus ← the sum of every channel's send j ←──────────────────────────────────────────────┘
 main bus + Return j × (level, balance, mute) → master HP → LP → Lo → Mid → Hi → Balance → Level → Mute
   → Mono Main → Limiter → Out L / R
```

- A filter or a band that is neutral (HP at 20 Hz, LP at 20 kHz, an EQ band within ±0.05 dB) is skipped entirely, so
  an idle strip costs very little.
- Filter and EQ coefficients are computed once per 32-sample chunk; gains glide (5 ms) so moving a fader or a pan
  never clicks. Mute and solo ramp over 5 ms.
- *Solo* removes the other channels from the main bus. Sends and direct outputs keep running, so a reverb keeps its
  tail while you solo. A pre-fader send follows *Mute* but not the fader.
- Pan and balance follow the Audio Mixer's laws: an equal-power pan for a mono channel (−3 dB at the centre), a
  cosine balance for a stereo one (the centre passes unchanged, and nothing is ever boosted).

### 4.2 Returns

A return is a stereo input that joins the main bus. The cable that brings it back from an effect is a feedback
cable (`specs.md` section 7.5): it arrives one chunk (32 samples, about 0.7 ms) late. That is inaudible for reverbs
and delays and wrong for parallel compression. A return never feeds another aux bus, so the console cannot loop on
itself.

### 4.3 Recording

The recorder is **tracks, a session and takes**.

- A **track** is one file. Each armed channel is a track (one channel for mono, two for stereo), each armed aux bus
  records its send bus as a stereo track, and the master records the main output as a stereo track. Files are named
  after the strip: the channel's name from the view, "Ch 3" by default, "Aux 1", "Master".
- A **session** starts when *Record* is pressed and ends when it is pressed again. **The armed tracks are fixed
  for the whole session**: arming or disarming during a session changes the next session. Pressing *Record* with
  nothing armed does nothing and says so.
- A **take** is the audio between a start and a stop. Within a session:
  - *Manual*: one take, from *Record* to *Stop*, however often the transport starts and stops. This records many
    channels from a Live session regardless of play and stop.
  - *Follow Transport*: a take for every play-to-stop. Press *Record* first; the session then waits. If the
    transport is already running, the first take starts at once. The next play starts the next take, in new files.
- **Channel Tap**: *Input* records the channel as it arrives, before the filters, the EQ and the fader: the dry
  stem, whatever you do to the mix afterwards. *Post-fader* records after the filters, EQ, fader and mute, before
  pan. Aux buses and the master are always taken as they leave.
- Files are written by the **recorder service**, not by the module (`doc/specs/recorder-service.md`): the module
  hands blocks of samples to it and the service writes them to disk on its own thread. A module never sees a path.
  Where the files go, and how long a take can be, is the service's business; the module only shows it.
- **Time left**: free space divided by the armed tracks' data rate. It is an estimate of the room, not a promise:
  the service stops a take if the disk is too slow or a file reaches 4 GB, and says why.

The *Recording* output is high during a take.

### 4.4 Names

Channel names are node data (`names`, up to 24 characters each) and are written into the file names. They are
edited in the strip. A name that is empty is "Ch k". The service makes names safe (no separators or reserved
characters) and makes duplicates unique ("Kick", "Kick 2").

## 5. Module view

The strips run left to right: channels, aux strips, master. Each channel strip, top to bottom: name, Mono/Stereo,
filters (HP, LP), EQ (Hi, Mid, Lo), sends, pan/balance, a fader with a meter beside it, and the **S M R** buttons
(solo, mute, record arm) in a fixed three-column grid so they line up in every strip. An aux strip has Balance, the
return fader (with a stereo meter of the return) and **M** and **R** in the M and R columns; the master the same
plus a gain-reduction readout.

Below the strips, the **Record** panel:

- **Record** (red while a take is written, outlined while a session waits for the transport) and
  **Arm all / Unarm all**, with a count of the armed tracks.
- **Time left** and where the files go; the take's length while recording; a message if something went wrong.
- **Setup**: Channels, Aux Buses, Direct Outs, Direct Point, Mono Main, Limiter, the send points.
- **Record settings**: Start and Stop, Format, Channel Tap.
- **View**: toggles that hide the EQ, the filters, the sends or the S / M / R buttons, to make the strips more
  compact. A hidden section keeps working; only the view changes. The choice is saved with the board (`view` in the
  node's data).

Strips beyond *Channels* are not drawn; the strip row scrolls sideways.

## 6. Saved state

Node data: `names` (32 strings) and `view` (`eq`, `flt`, `snd`, `btn`: 1 or 0). Everything else is knobs and
settings. A session is never saved: a board that is loaded does not record.

## 7. Engine requirements

- Jacks and knobs shown by a setting (`ShowIf`) exist already.
- The **recorder service** (`engine/Recording.h`, `doc/specs/recorder-service.md`).
- A wasm module reaches the service through the `bleep_record_*` imports (`module-abi.md`, section 5b), so that
  the module is the same file in the apps, the plugins and the browser.

## 8. Tests

- `modules/audio-console/tests/test_audio_console.cpp`: unity and equal-power pan; pan hard left; the fader and the
  mute (the send follows the mute); solo removes a channel from the main bus but not from the send; post- and
  pre-fader sends; the high-pass corner and slope, the Lo, Mid and Hi bands against their analytic response; neutral
  settings pass the signal unchanged; direct outputs and recorder taps pre and post fader; channels above the count
  are silent; a return joins the main bus; master mute.
- `tests/audio_console_record_test.cpp`: the real module with the audio on another thread: a manual session
  writes one file per armed track with the right channel counts, names and content; follow-transport makes one
  take per play with numbered files; the post-fader tap; nothing armed does not start.
- `tests/recording_test.cpp`: the service (see its spec).
- The module harness drives every knob and input of the console with random values: finite outputs and no runaways.

## 9. Later

- Frequencies and Q for the EQ and the shelves, a parametric mid, and a phase invert and an input trim.
- A second mid band, per-channel inserts, and channel strips that can be dragged into any order.
- Groups (link the faders or the mutes of several channels), VCA masters, a mute-gate input per channel.
- A record gate input; punch in and out; a pre-roll for *Follow Transport*.
- MP3 and FLAC as formats (see `doc/specs/recorder-service.md`, *Later*); WAV is the only format now.
- Solo modes (AFL, PFL) and a cue/monitor output.
- The browser: it records into memory with a fixed budget and offers a zip (`doc/specs/recorder-service.md`, section 5); later the
  Origin Private File System, and streaming downloads (*Later* there).
