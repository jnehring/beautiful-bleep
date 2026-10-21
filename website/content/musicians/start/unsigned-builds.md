---
title: Installing unsigned builds
description: Open the Bleep App and the VST3 plugins on macOS and Windows when the system warns that the developer is unknown.
order: 4
---

# Installing unsigned builds

The Bleep App and the plugins are free, and for now they are **not signed with a
paid developer certificate**. Apple and Microsoft charge for those, so macOS and
Windows warn you the first time you open a download. The files are not damaged,
and the warning does not mean something is wrong: the system just doesn't know
who made them. It is a one-time step per download.

You can check a download against the checksum (SHA-256) shown for it in the
[Bleep Library](/library/detail/?kind=plugin&slug=bleep-app) before you open it.

## macOS

### The Bleep App

1. Open the downloaded file and drag **Bleep App** to *Applications*.
2. Open it. macOS says it cannot verify the app. Click **Done**.
3. Open **System Settings → Privacy & Security**, scroll down to the message
   about *Bleep App* and click **Open Anyway**. Confirm with your password.

On macOS 14 and older, right-click the app and choose **Open** instead; that
works there too.

### The VST3 plugins

Copy the `.vst3` files to `~/Library/Audio/Plug-Ins/VST3` as described in
[Install in Live](getting-started.md). If your DAW does not list them, or says a
plugin could not be loaded, macOS has quarantined the files. Remove the flag in
Terminal, then rescan plugins:

```bash
xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/*.vst3
```

The same command works for the app:

```bash
xattr -dr com.apple.quarantine /Applications/Bleep\ App.app
```

## Windows

### The Bleep App

1. Run the downloaded file. Windows shows **Windows protected your PC**.
2. Click **More info**, then **Run anyway**.

If you downloaded a zip, right-click it, choose **Properties**, tick
**Unblock** and click OK before you extract it. That avoids the warning for
every file inside.

### The VST3 plugins

Copy the `.vst3` files to `C:\Program Files\Common Files\VST3` and rescan in your
DAW. Plugins rarely trigger a warning. If one does not load, unblock it as
above: right-click the file, **Properties**, **Unblock**.

## Linux

No signing is involved. Make the app executable (`chmod +x`) and run it.

## Still stuck?

- The DAW does not show the plugins: rescan, and check that the files are in
  the VST3 folder of your system, not in a subfolder of another folder.
- macOS keeps blocking the app: run the `xattr` command above on the app, then
  open it again.
