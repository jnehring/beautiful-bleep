---
title: Settings
description: What File → Settings holds in the Bleep App, the Bleep plugins in Live and Bleep Play in the browser.
order: 5
---

# Settings

**File → Settings…** opens the settings of the place you are in. Changes apply
the moment you make them; there is no Save button. In the app the shortcut is
⌘, (Ctrl+, on Windows and Linux).

Each place has its own tabs, because each place controls different things.
Live runs the audio and MIDI of a plugin, and your browser runs those of Bleep
Play. Bleep never offers a setting it cannot change.

| Tab | [Bleep App](standalone.md) | Plugins in Live | [Bleep Play](../start/ways-to-use.md) |
|---|---|---|---|
| [Audio](#audio) | yes | | yes |
| [MIDI](#midi) | yes, with sync | | yes |
| [Web](#web-the-app) / [App](#app-bleep-play) | Web | | App |
| [Recordings](#recordings) | yes | yes | |
| [Library](#library) | yes | yes | yes |
| [Data](#data-bleep-play) | | | yes |

## Audio

### In the Bleep App

- **Driver, Output and Input:** your audio interface. Pick *None* to leave the
  output or the input unused.
- **Sample rate** and **Buffer size:** a smaller buffer means less delay and more
  chance of dropouts. The menu shows the delay of each size in milliseconds.
  If your interface does not offer a size with this input and output, the
  Settings say so and the interface keeps the size it runs at.
- **Output channels** and **Input channels:** shown for interfaces with more than
  one pair. Each pair you switch on becomes an *In* or *Out* port you can
  place with **Add → Port**.
- **Right now:** the delay, the CPU load and the number of dropouts. These
  numbers move while you play.
- **System audio:** captures what your computer plays. See [Process what your
  computer plays](../connect/system-audio.md).

If no audio device runs, the tab says so: pick an output.

### In Bleep Play

- **Output:** the speakers or headphones to play to. Only Chrome and Edge can
  choose; other browsers always use the system's default output, and the tab
  says so. The list shows device names once your browser has been given audio or
  microphone permission; before that the devices are numbered.
- **Latency:** *Interactive* (the lowest delay, the default), *Balanced* or
  *Playback* (the fewest dropouts, for slower computers). The browser reads it
  when audio starts. If audio is already running, a **Restart audio** button
  appears: it reloads the page, your board is kept, and you press *Start
  audio* again.
- **Right now:** the sample rate and the delay your browser reports.

In a plugin there is no Audio tab: Live owns the audio device, so choose it in
Live's own Settings. The audio dot in the board's top bar opens Settings only in
the app and in Bleep Play.

## MIDI

### In the Bleep App (MIDI and sync)

- **Inputs:** switch on the controllers the app listens to.
- **Output:** where the app's MIDI Out goes.
- **Bleep App MIDI ports:** how many virtual ports the app offers to other
  programs, such as Live (0 to 8, default 2). See [the standalone
  app](standalone.md#midi-to-and-from-live).
- **Ableton Link** and **Tempo:** share tempo and play state with other Link apps
  on your network. The tempo you set is used when nobody else sets it.

### In Bleep Play

The browser asks once whether the page may use your MIDI devices. The tab shows
**Allow MIDI access** until you decide; the question comes when you press it, not
when you open Settings.

- **Inputs:** a switch for each controller. A switched-off controller is ignored.
- A **MIDI Device** node on the board picks its own controller and wins over
  these switches. They apply to boards without one.

Safari has no Web MIDI, and the tab says so there.

## Web (the app)

The link to Bleep Play and to Live plugins whose *Board* is *Bleep Play*. It is
off until you switch it on; see [Connecting](../connect/connecting.md) for
the whole path.

- **Let Bleep Play pages connect to this app:** the app then listens on this
  computer only.
- **Port:** 47100 unless it is taken.
- **Connected boards:** which pages are connected and in which latency mode.
- **Pages you allowed:** a page that is not served by the app asks first. **Forget**
  takes a page off the list.

## Recordings

Where the [Audio Console](recording.md) and other recording modules save their files.

- **Folder:** the Recordings folder. The default is `Music/Beautiful Bleep/Recordings` in your home folder. Type a full path, or press
  **Choose…** to pick a folder. A path that is not a full path, that cannot be made or that Bleep cannot write to is refused
  with a reason, and nothing changes.
- **Show in the file manager** opens the folder, and **Use the default folder** goes back to the default.
- The line below shows how much room the disk has.

A change applies to the next recording; one that is running keeps writing where it started. The choice is kept in Bleep's
data folder, which the app and every plugin share, so a folder chosen in one is the folder of all. Bleep Play has no
folder: it keeps recordings in memory and offers them as a download.

## App (Bleep Play)

The side of the link that lives in the browser: whether this page is connected
to Bleep App, and a **Connect to app** button. It is the same button as in the
side menu. The port is set in the app, under Settings → Web; the page uses the
app's own address when the app serves it, and the standard port otherwise.

## Library

The Library holds the modules and plugins you install. Its settings are the same
in all three places, except where noted.

- **Channel:** *stable* or *beta*. Beta has newer modules that are less tested.
- **Check for module updates at start** (app only, on by default): the app asks
  the library what is new every time it starts. Switch it off and you check by
  hand with **Check for updates**.
- **Library address** (app, under *Advanced*): only for a self-hosted or
  development library. It takes effect at the next start, and the app asks you to
  confirm before it uses another library.
- **Check for updates** and **Show data folder** (app and plugin).

The **app and the plugins share one data folder**. The channel and the other
library settings you set in a plugin are the app's too, and the other way round.

In Bleep Play the library is the website you are on, so there is no address
field. A change of channel is read when the page loads: the tab offers **Reload
now**.

In a plugin, Settings has only the Library tab. The Library
window itself (where you install modules) is under the *Library* menu.

## Data (Bleep Play)

What Bleep Play keeps in this browser: your board, your saved presets and these
settings. Nothing is sent anywhere. Each row has a **Clear** button:

| Row | What it removes |
|---|---|
| Board | Your board. The page reloads with the default one. |
| Saved presets | The presets you saved in this browser. |
| Settings | Puts the settings of this page back to their defaults. |
| Everything | All three, then the page reloads. |

Each asks first. To keep a board, use **File → Download Project** before you
clear it.

If your browser does not let the page store anything (a private window, or
blocked site data), the tabs say so at the top: your choices last until you close
the page.
