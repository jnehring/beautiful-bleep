#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Stands in for Bleep Board while you build the Bleep Live Link device in Max for Live.

A device has 4 rows (0..3) and a CHANNEL (1..8); it listens on UDP port 9871 + channel - 1. This sends
/bleep/param <row> <value> to that port, the same packets the board sends (patch/bridges/ableton/LiveLinkOsc.h): the
value is a position 0..1 within the Live parameter's own range (a dial; a menu: 0 is the first item, 1 the last), or -1
when the board no longer drives the row. Python 3, standard library only.

The channel: -c N or --channel N (default 1, or the environment variable BLEEP_CHANNEL).

One message, then it exits:
    osc_test.py on 1                 row 1 of channel 1: a switch on (sends 1)
    osc_test.py off 1                a switch off (sends 0)
    osc_test.py item 0 2             a dropdown: pick item 2 (the first is 0), for a menu of 4 items
    osc_test.py item 0 5 8           item 5 of a menu with 8 items (the count is optional, default 4)
    osc_test.py set 2 0.25           any position on row 2: a quarter of the way through a dial's range
    osc_test.py release 0 1          -1 to rows 0 and 1: as if the board's node was deleted (the parameter is put back)
    osc_test.py on 1 -c 2            the same on the device of channel 2

A stream (Ctrl-C stops it and releases the rows):
    osc_test.py sine 0               row 0 as a 0.2 Hz sine around the middle, 0 .. 1
    osc_test.py sine 0 --amp 0.2     a smaller swing: 0.3 .. 0.7. --centre moves the middle (default 0.5)
    osc_test.py sine 0 1 --hz 1      rows 0 and 1 together (the second a quarter turn later)
    osc_test.py ramp 3               row 3 up from 0 to 1 and back, once a second each way

The device's side, to see what it reports without the board running (port 9880 must be free: quit Bleep Board's set or its sender):
    osc_test.py watch                prints every /bleep/hello and /bleep/info a device sends: which channel and row, what kind of
                                     parameter, its name, its range and its choices

The board's side, to see what it sends and to try it without a device:
    osc_test.py listen -c 2          stands in for the device: once a second, per row, messages per second and the range of the
                                     values. (No device may hold that channel's port: give the device another channel.)
    osc_test.py info 0 -c 1 --name Frequency --current 0.5
                                     stands in for the DEVICE and tells the board that row 0 is mapped to a continuous parameter
                                     (--adopt moves the node's knob there). --kind discrete --items Lowpass,Highpass,Bandpass,Notch
                                     --min 0 --max 3 --current 0.3333 reports a menu. `info 0 --kind none` says it is unmapped.

The board sends a menu row a position from 0 to 1, and the row picks item = round(position x (items - 1)). `item` does that
sum for you, so the count only matters if the menu does not have 4 items. A switch is a menu of two items: `item 0 1 2` is on.

Watch the mapped parameter in Live: it follows the position, and goes back where it was when you stop.
"""
import argparse
import math
import os
import socket
import struct
import time

FIRST_DEVICE_PORT = 9871   # channel 1; channel c listens on FIRST_DEVICE_PORT + c - 1
BOARD_PORT = 9880          # where the devices say hello (/bleep/hello <channel>)
ROWS = 4
DEFAULT_ITEMS = 4
RELEASED = -1.0   # sent instead of a position when the board no longer drives a row
MAX_CHANNEL = 8


def pad(b: bytes) -> bytes:
    b += b"\0"
    return b + b"\0" * (-len(b) % 4)


def param(row: int, offset: float) -> bytes:
    return pad(b"/bleep/param") + pad(b",if") + struct.pack(">if", row, offset)


def listen(port: int, channel: int) -> None:
    """Stands in for the device on a channel: prints, once a second and per row, how many /bleep/param messages arrived,
    the range of their values, and the largest step between two in a row. A slow LFO gives about 100 messages a second
    and tiny steps; if the steps or the rate are very different between two channels, the difference is on the board."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        raise SystemExit(f"port {port} is taken (a device on channel {channel} is running?). Give that device another channel.")
    s.settimeout(0.2)
    print(f"listening for channel {channel} on port {port}, Ctrl-C to stop")
    window, t0 = {}, time.monotonic()
    try:
        while True:
            try:
                d, _ = s.recvfrom(256)
                if d.startswith(b"/bleep/param\0") and len(d) >= 28:
                    row, val = struct.unpack(">i", d[20:24])[0], struct.unpack(">f", d[24:28])[0]
                    window.setdefault(row, []).append(val)
            except socket.timeout:
                pass
            now = time.monotonic()
            if now - t0 >= 1.0:
                if not window:
                    print("  (nothing this second)")
                for row in sorted(window):
                    v = window[row]
                    step = max((abs(b - a) for a, b in zip(v, v[1:])), default=0.0)
                    print(f"  row {row}: {len(v) / (now - t0):5.1f} msgs/s  value {min(v):+.3f} .. {max(v):+.3f}  last {v[-1]:+.3f}  biggest step {step:.4f}")
                window, t0 = {}, now
    except KeyboardInterrupt:
        pass


def read_osc(d: bytes):
    """A received packet as (address, [arguments]); strings, ints and floats only."""
    def string(at):
        end = d.index(b"\0", at)
        return d[at:end].decode("utf-8", "replace"), (end + 4) // 4 * 4
    addr, at = string(0)
    tags, at = string(at)
    args = []
    for t in tags[1:]:
        if t == "i":
            args.append(struct.unpack(">i", d[at:at + 4])[0]); at += 4
        elif t == "f":
            args.append(round(struct.unpack(">f", d[at:at + 4])[0], 4)); at += 4
        elif t == "s":
            v, at = string(at); args.append(v)
        else:
            raise ValueError(f"argument type {t}")
    return addr, args


def watch() -> None:
    """Stands in for the board: prints what the devices say."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.bind(("127.0.0.1", BOARD_PORT))
    except OSError:
        raise SystemExit(f"port {BOARD_PORT} is taken (Bleep Board is running?). Quit it, or remove the Live Params node.")
    print(f"watching for devices on port {BOARD_PORT}, Ctrl-C to stop")
    try:
        while True:
            d, _ = s.recvfrom(4096)
            try:
                addr, a = read_osc(d)
            except (ValueError, IndexError, struct.error):
                print("  (not a packet I understand)")
                continue
            if addr == "/bleep/hello" and a:
                print(f"  hello: the device on channel {a[0]} (re)started")
            elif addr == "/bleep/info" and len(a) >= 3:
                ch, row, kind = a[0], a[1], a[2]
                if kind == "none":
                    print(f"  channel {ch} row {row}: not mapped")
                elif len(a) >= 8:
                    name, cur, lo, hi, adopt, items = a[3], a[4], a[5], a[6], a[7], a[8:]
                    more = f"  items {items}" if items else ""
                    print(f"  channel {ch} row {row}: {kind} '{name}'  position {cur}  range {lo} .. {hi}{'  (just mapped)' if adopt else ''}{more}")
                else:
                    print(f"  channel {ch} row {row}: {kind}, too short: {a}")
            else:
                print(f"  {addr} {a}")
    except KeyboardInterrupt:
        pass


def info_packet(channel: int, row: int, kind: str, name: str, current: float, pmin: float, pmax: float, adopt: bool,
                items: list) -> bytes:
    """/bleep/info as the Bleep Live Link device sends it (see LiveLinkOsc.h: RowInfo)."""
    tags, data = ",iis", struct.pack(">ii", channel, row) + pad(kind.encode())
    if kind != "none":
        tags += "sfffi" + "s" * len(items)
        data += pad(name.encode()) + struct.pack(">fffi", current, pmin, pmax, 1 if adopt else 0)
        for item in items:
            data += pad(item.encode())
    return pad(b"/bleep/info") + pad(tags.encode()) + data


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["sine", "ramp", "set", "release", "on", "off", "item", "listen", "info", "watch"])
    ap.add_argument("rows", nargs="*", type=float,
                    help=f"row numbers 0..{ROWS - 1}; `set`: the row, then the value; `item`: the row, the item, and the number of items if not 4")
    ap.add_argument("-c", "--channel", type=int, default=int(os.environ.get("BLEEP_CHANNEL", "1")),
                    help="the device's channel, 1..8 (default: $BLEEP_CHANNEL, or 1)")
    ap.add_argument("--of", type=int, default=None, help="`item`: how many items the menu has (same as the third number)")
    ap.add_argument("--hz", type=float, default=0.2, help="sine/ramp rate (default 0.2)")
    ap.add_argument("--amp", type=float, default=None,
                    help="sine: swing of ±amp around the centre (default 0.5, so 0 .. 1); ramp: the top (default 1.0)")
    ap.add_argument("--centre", type=float, default=0.5, help="sine: the middle (default 0.5)")
    info = ap.add_argument_group("info (the device's side)")
    info.add_argument("--kind", choices=["continuous", "discrete", "none"], default="continuous")
    info.add_argument("--name", default="Parameter")
    info.add_argument("--current", type=float, default=0.5, help="the parameter's position 0..1 when it was mapped")
    info.add_argument("--min", type=float, default=0.0, dest="pmin", help="the parameter's own minimum")
    info.add_argument("--max", type=float, default=1.0, dest="pmax", help="the parameter's own maximum")
    info.add_argument("--items", default="", help="a discrete parameter's item names, separated by commas")
    info.add_argument("--adopt", action="store_true", help="the row was just mapped: the board moves the node's knob to --current")
    ap.add_argument("--rate", type=float, default=100.0, help="messages per second per row (default 100, like the board)")
    ap.add_argument("--seconds", type=float, default=0.0, help="stop after this long (default: until Ctrl-C)")
    a = ap.parse_args()

    if not 1 <= a.channel <= MAX_CHANNEL:
        ap.error(f"the channel is 1..{MAX_CHANNEL}")
    device = ("127.0.0.1", FIRST_DEVICE_PORT + a.channel - 1)
    if a.mode == "listen":
        listen(device[1], a.channel)
        return
    if a.mode == "watch":
        watch()
        return
    if a.mode == "info":
        if len(a.rows) != 1 or not 0 <= int(a.rows[0]) < ROWS:
            ap.error(f"info needs one row, 0..{ROWS - 1}: info 0 --name Frequency")
        items = [i for i in a.items.split(",") if i] if a.kind == "discrete" else []
        packet = info_packet(a.channel, int(a.rows[0]), a.kind, a.name, a.current, a.pmin, a.pmax, a.adopt, items)
        socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(packet, ("127.0.0.1", BOARD_PORT))
        print(f"told the board (port {BOARD_PORT}): channel {a.channel} row {int(a.rows[0])} is {a.kind}"
              + (f" '{a.name}'" if a.kind != "none" else ""))
        return
    if not a.rows:
        ap.error(f"{a.mode} needs at least one row")
    out = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def send(row: int, value: float) -> None:
        if not 0 <= row < ROWS:
            ap.error(f"a device has rows 0..{ROWS - 1}")
        out.sendto(param(row, value), device)

    if a.mode == "set":
        if len(a.rows) != 2:
            ap.error("set needs a row and a value: set 2 0.25")
        send(int(a.rows[0]), a.rows[1])
        return
    if a.mode in ("on", "off"):
        for r in a.rows:
            send(int(r), 1.0 if a.mode == "on" else 0.0)
        print(f"channel {a.channel}: {a.mode} on row{'s' if len(a.rows) > 1 else ''}", ", ".join(str(int(r)) for r in a.rows))
        return
    if a.mode == "item":
        if len(a.rows) not in (2, 3):
            ap.error("item needs a row and an item number: item 0 2 (and the number of items if it is not 4)")
        row, item = int(a.rows[0]), int(a.rows[1])
        count = a.of if a.of is not None else int(a.rows[2]) if len(a.rows) == 3 else DEFAULT_ITEMS
        if count < 1 or not 0 <= item < count:
            ap.error(f"the item is 0..{count - 1} for a menu of {count} items")
        value = item / (count - 1) if count > 1 else 0.0
        send(row, value)
        print(f"channel {a.channel}: row {row} item {item} of {count} (sends {value:.4f})")
        return
    rows = [int(r) for r in a.rows]
    if a.mode == "release":
        for r in rows:
            send(r, RELEASED)
        return

    hello = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        hello.bind(("127.0.0.1", BOARD_PORT))
        hello.setblocking(False)
    except OSError:
        print(f"note: port {BOARD_PORT} is taken (Bleep Board running?), so /bleep/hello is not shown")
        hello = None

    print(f"sending to {device[0]}:{device[1]} (channel {a.channel}), rows {rows}, Ctrl-C to stop (then the rows are released: -1)")
    t0 = time.monotonic()
    try:
        while a.seconds <= 0 or time.monotonic() - t0 < a.seconds:
            t = time.monotonic() - t0
            for n, r in enumerate(rows):
                phase = a.hz * t + n * 0.25
                if a.mode == "sine":
                    v = a.centre + (0.5 if a.amp is None else a.amp) * math.sin(2 * math.pi * phase)
                else:
                    x = phase % 1.0
                    v = (1.0 if a.amp is None else a.amp) * (2 * x if x < 0.5 else 2 * (1 - x))
                send(r, min(1.0, max(0.0, v)))
            if hello:
                try:
                    data, _ = hello.recvfrom(256)
                    if data.startswith(b"/bleep/hello\0") and len(data) >= 24:
                        print("device on channel", struct.unpack(">i", data[20:24])[0], "said hello")
                except BlockingIOError:
                    pass
            time.sleep(1.0 / a.rate)
    except KeyboardInterrupt:
        pass
    finally:
        for r in rows:
            send(r, RELEASED)


if __name__ == "__main__":
    main()
