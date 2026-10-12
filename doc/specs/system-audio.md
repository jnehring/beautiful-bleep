# System Audio

Status: built. Checked end to end on macOS 14.4 (in the app) and Linux (the backend against a PulseAudio server); Windows only compiled (§8, §10). How the standalone app takes in **what the computer plays** (a music player, a browser, a video call) as a node on the board, without a virtual audio driver. Extends `specs.md` §11.

## 1. What it is

A **System** node for the board of the Bleep App. Its outputs *L* and *R* carry the mix of everything the computer plays to its speakers. Patch it into modules, record it, process it live.

- **Standalone app only.** Not in the plugins (a DAW has its own routing) and not in Bleep Play.
- **Off until asked.** *Settings → Audio → System audio → Capture what this computer plays*. Capturing needs a permission on macOS and is private information on every system, so nothing is captured before the user turns it on. Turning it on adds the *System* port to **Add → Port**; the node is placed from there, like *In 3/4* (a new board starts with *In 1/2* and *Out 1/2* only).
- **A normal audio input.** The node is an *Audio In* node with the name *System* and the ID `system-in`: same ports, same *Gain* dial, same documentation (`audio-in.md`). Projects keep their cables to it; when the capture is off or fails, the node is a ghost like any port that is gone (`specs.md` §6).
- **No driver, no aggregate device.** The operating system's own capture API is used on each platform (§6).

## 2. Requirements

| Platform | Needs | Without it |
|---|---|---|
| macOS | macOS 14.2 or later; the user allows *System Audio Recording* once | Settings says "needs macOS 14.2 or later"; the existing way (a loopback driver such as BlackHole as an input device) keeps working |
| Windows | Windows 10 or later. Leaving the app's own sound out needs Windows 10 build 20348 or later | Capture works, with the app's own sound included (§3) |
| Linux | PulseAudio or PipeWire (with `pipewire-pulse`), and the app built with `libpulse` | The build has no System Audio (CMake says so); a JACK or loopback-module setup keeps working as an ordinary input device |

## 3. Feedback: the app's own sound

If the app plays to the speakers and captures the speakers, then a cable from *System* to an *Audio Out* makes a loop: what comes out is captured, played, captured again.

- **Default: the app's own sound is left out of the capture** (*Leave out Bleep App's own sound*, on). The capture then holds everything except this process.
- **macOS** leaves the process out with the tap itself (§6.1). **Windows** with process loopback in *exclude* mode (§6.2). **Linux** cannot: a monitor carries the whole sink. There the setting is disabled, with a note: play the app to another output than the one you capture.
- **When the exclusion could not be set up** (older Windows; on macOS before the app has played any sound and Core Audio knows the process), the capture runs without it, and the status line says *Bleep App's own sound included*. On macOS the app tries again every moment until the process is known, and swaps the capture in without a gap that matters.
- Turning the setting off captures everything, including the app. Useful for recording the app's own output together with the rest.

## 4. In the app

### 4.1 Settings

*Settings → Audio*, below the device settings (also when no audio device runs: the capture does not need one):

| Control | Meaning |
|---|---|
| Capture what this computer plays | On: start capturing and offer the *System* port. Off: stop; a *System* node already on the board becomes a ghost |
| Leave out Bleep App's own sound | §3. Disabled where the platform cannot |
| Output to capture | Linux: the sinks' monitors the sound server lists; *Default output* follows the system's default. Not shown elsewhere |
| Status line | *Capturing at 48.0 kHz · Bleep App's own sound left out · signal* (or *silent*) |
| Hint | While silent, on macOS: where the permission is |
| Error | Why capturing did not start (permission, no sound server, no output device), or what broke later |

The settings are kept in the app's settings file: `systemAudio` (default off), `systemAudioExclude` (default on), `systemAudioSource` (default empty).

### 4.2 The node

`AppController` adds an audio port `system-in` named *System* when a capture runs (`syncPorts`), next to the device's *In 1/2* …; the engine sees an ordinary `PortKind::AudioIn`. A port's id is stable, so a board saved with cables to *System* connects again as soon as the capture runs, also on another machine of another platform.

## 5. The shared part

Platform backends only produce frames; everything else is the same code (`patch/app/SystemAudioBuffer.h`, no JUCE, covered by `bleep_system_audio_test`).

```
 capture thread                                        audio callback
 (backend, the capture's clock)                        (the device's clock)
 ┌────────────────────────┐    ┌──────────────┐    ┌──────────────────────────┐
 │ OS capture API  ─ f32 ─┼───▶│  StereoRing  │───▶│ SystemAudioReader        │──▶ System node
 │ 1…n channels, any rate │    │  lock-free   │    │ resample, fill-steered   │
 └────────────────────────┘    └──────────────┘    └──────────────────────────┘
```

- **`StereoRing`**: single-producer single-consumer, 131072 stereo frames. A backend writes interleaved or planar float frames of any channel count (mono is copied to both sides, more than two channels use the first two) or silence. It tracks the peak since the last look, for the *signal* indicator in Settings.
- **`SystemAudioReader`**: the audio callback reads a block at the **device's** clock from a ring written at the **capture's** clock. The clocks differ by some parts per million (and often by sample rate: 44.1 against 48 kHz), so a plain read would sooner or later run dry or overflow. The reader resamples with linear interpolation, and a slow control loop steers the ratio to hold the ring at a target fill (the average fill, smoothed over about half a second, sets the ratio within ±0.5 %). That is a small, steady pitch correction, not a click.
- **Latency** is the target fill: 30 ms, or three device blocks if that is more; the capture API's own buffer comes on top (about 10 to 20 ms). The reader adds it on purpose: it is what absorbs a capture that delivers in bursts.
- **Start, stall, dropout.** At the start, and after running dry, the reader plays silence until the target fill has accumulated, and then plays from `target` frames behind the newest frame. A ring that grew past four times the target (the app was suspended, the backend restarted) skips to the target. Both are counted, not logged on the audio thread.
- **Real time.** The callback allocates nothing and takes no lock other than the app's existing try-lock on its ports.
- **Ownership.** The `SystemAudio` object is replaced under the ports lock (`portsLock_`) and destroyed outside it; the callback sees either the old or the new one, never half.

## 6. The backends

One class per platform behind `SystemAudio` (`patch/app/SystemAudio.h`), chosen in CMake. No JUCE types in them (the system headers clash with JUCE's).

```cpp
std::string start(const SystemAudioOptions&);   // "" or an error message for the user
void        stop();
void        poll();            // message thread, ~10 Hz: follow output changes
double      sampleRate();      // of the frames in ring()
bool        excluding();       // the app's own sound is left out
std::string problem();         // something that broke after start
```

### 6.1 macOS: Core Audio process tap (`SystemAudioMac.mm`)

- `CATapDescription` with `initStereoGlobalTapButExcludeProcesses:` (own process in the list when exclusion is on), private, unmuted: the speakers keep playing. `AudioHardwareCreateProcessTap`.
- The tap is read through a **private aggregate device** with the default output as its main sub-device (it supplies the clock) and the tap on its tap list with drift compensation. An `AudioDeviceIOProc` copies the tap's stream into the ring. The aggregate's nominal rate is the capture rate.
- The tap's stream is the last input buffer with the tap's channel count (the sub-device's own inputs, if it has any, come first).
- **Default output changes** (a headset is plugged in): a Core Audio property listener only sets a flag; `poll()` rebuilds tap and aggregate on the message thread. A failed rebuild is retried every two seconds.
- **The own process** is found with `kAudioHardwarePropertyTranslatePIDToProcessObject`; it is unknown until the app's output has run, and `poll()` rebuilds with the exclusion as soon as it is known.
- **Permission.** `NSAudioCaptureUsageDescription` in the app's Info.plist; the system asks on first use. There is no public way to ask beforehand: while denied, the tap runs and delivers silence, which Settings shows as *silent* with the hint where to allow it (System Settings → Privacy & Security → Screen & System Audio Recording → System Audio Recording Only).
- **Availability.** The deployment target stays 10.15; the tap code is guarded with `@available(macOS 14.2, *)` and ARC is on for this file. Protected content (DRM) arrives silent: the system's rule.

### 6.2 Windows: WASAPI loopback (`SystemAudioWin.cpp`)

Tried in this order:

1. **Process loopback** (`ActivateAudioInterfaceAsync` on `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`, mode *exclude target process tree*, target = this process; Windows 10 build 20348+). Independent of the output device, with the app's sound left out. Event-driven, 48 kHz float stereo (the system converts).
2. **Device loopback**: the default render endpoint opened with `AUDCLNT_STREAMFLAGS_LOOPBACK` in its mix format (float; if the mix is not 32-bit float, stereo float with automatic conversion). Includes the app's sound. The thread checks the default endpoint once a second and reopens when it changed or the stream broke.

A loopback stream delivers **no packets while nothing plays**. The capture thread therefore writes silence for the elapsed time when 20 ms passed without a packet, so the ring runs on a steady clock and the reader never mistakes a pause for a dropout. A failed reopen is retried every half second and shows in Settings.

Build: `ole32` and `mmdevapi` are linked; the process-loopback code needs `audioclientactivationparams.h` from the Windows SDK (10.0.19041 or later) and is left out without it (then `canExclude()` is false).

### 6.3 Linux: PulseAudio monitor (`SystemAudioLinux.cpp`)

- A record stream on `@DEFAULT_MONITOR@` (the monitor of the default sink; it follows the default), or on the chosen `<sink>.monitor`. The server converts to 48 kHz float stereo. 10 ms fragments. `libpulse`'s threaded mainloop; data is copied in the read callback.
- **Outputs list.** `SystemAudio::sources()` asks the server for the sources that monitor a sink (one-shot, 2 s timeout); the app caches it for 15 s, because the Settings page refreshes every 1.5 s.
- **No exclusion** (§3). PipeWire is served through `pipewire-pulse`.
- CMake finds `libpulse` with pkg-config. Without it, the app is built with the stub and Settings says "not available in this build".

### 6.4 Other platforms

`SystemAudioStub.cpp`: `create()` returns null; Settings shows the reason.

## 7. CMake

| What | Where |
|---|---|
| Sources by platform | `BLEEP_SYSTEM_AUDIO_SOURCES` in `patch/CMakeLists.txt`: Mac `.mm` (with `-fobjc-arc`, frameworks CoreAudio and Foundation), Windows `.cpp` (`ole32`, `mmdevapi`), Linux `.cpp` (libpulse), else the stub |
| Info.plist | `NSAudioCaptureUsageDescription`, by `PLIST_TO_MERGE` |
| Test | `bleep_system_audio_test`, ctest `patch.system-audio` |

## 8. Tests and checks

- **Unit (`patch/tests/system_audio_test.cpp`, no JUCE):** the reader on a sine through the ring, at equal rates, 44.1 and 96 kHz into 48 kHz, ±300 ppm clock drift for 20 s, and bursty delivery. Checks: no dropout or overflow, no click (largest sample-to-sample step stays within a 440 Hz sine's), the pitch holds within about a cent; start and run-dry behaviour; overflow skip; channel mapping and the peak indicator.
- **In the app, macOS 14.4 (done):** `"Bleep App.app" --smoke --system-audio` while `afplay` plays a system sound: the report shows frames arriving at 48 kHz with the peak of the sound (0.21 for *Glass*), no underruns or overruns, own sound left out. The permission belongs to the app only when it is launched by LaunchServices (`open -W --stdout out.txt "Bleep App.app" --args --smoke --system-audio`); started from a shell, macOS credits the shell's parent app, which has no usage text, and the tap delivers silence.
- **Linux backend (done):** built against `libpulse` 16 in a container with a PulseAudio server and a null sink; a 440 Hz tone played to the sink arrives at the right level and pitch (441 Hz in a 2 s test, the start-up settling of the reader), no underruns, and `sources()` lists the sink's monitor. PipeWire (`pipewire-pulse`) was not run.
- **Windows:** compiled with MinGW-w64 (the device loopback path against its headers, the process-loopback path against Microsoft's documented declarations), never run: see §10.
- **By hand, still to do:** with the exclusion on, route the app's own output to the speakers and patch *System* to *Audio Out*: no feedback. Change the default output while capturing.

## 9. Not in this version

- **Choosing one program** (capture just the browser): Core Audio and Windows process loopback can; the setting would be a program list.
- **Choosing the output to capture** on macOS and Windows (only Linux has the list).
- **System audio in the plugins or Bleep Play.** The plugins have the DAW; the browser can ask for tab audio by itself (`getDisplayMedia`), which is a different feature.
- **Video, microphone mixing, per-process gain.**

## 10. Open questions

- **Windows is untested on a real system.** It compiles; the silence filling, endpoint changes and the process-loopback activation need a run (§8). PipeWire is untested on Linux.
- **Own-sound exclusion on macOS** is set up and reported by Core Audio (*left out*), but not yet confirmed by ear with the app playing.
- **macOS permission state.** There is no public call to ask whether the permission is granted. Detecting "the tap runs but is silent for long" is not reliable (nothing may be playing); the hint text carries it.
- **Several sub-devices with inputs on macOS.** The tap's stream is taken as the last buffer with the right channel count; an aggregate whose output device has its own stereo input stream next to it may need a closer look.
- **Tap while the app is not playing.** The own-process exclusion starts when Core Audio knows the process (§6.1); until then the app plays nothing, so nothing of its own is captured, but this has to be confirmed on a machine where the device starts late.
