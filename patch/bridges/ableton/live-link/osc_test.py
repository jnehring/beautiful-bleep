#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Stands in for Bleep Board while you build the Bleep Live Link device in Max for Live.

A device has 4 rows (0..3) and a CHANNEL (1..8); it listens on UDP port 9871 + channel - 1. This sends
/bleep/param <row> <value> to that port, the same packets the board sends (patch/bridges/ableton/LiveLinkOsc.h).
It also listens on port 9880 for a device's /bleep/hello <channel> and prints it, so you can see the handshake work.
Python 3, standard library only.

The channel: -c N or --channel N (default 1, or the environment variable BLEEP_CHANNEL).

One message, then it exits:
    osc_test.py on 1                 row 1 of channel 1: a switch on (sends 1)
    osc_test.py off 1                a switch off (sends 0)
    osc_test.py item 0 2             a dropdown: pick item 2 (the first is 0), for a menu of 4 items
    osc_test.py item 0 5 8           item 5 of a menu with 8 items (the count is optional, default 4)
    osc_test.py set 2 0.25           any value on row 2, e.g. an offset of 0.25 for a dial
    osc_test.py release 0 1          send 0 to rows 0 and 1, as the board does when a cable is removed
    osc_test.py on 1 -c 2            the same on the device of channel 2

A stream (Ctrl-C stops it and releases the rows):
    osc_test.py sine 0               row 0 as a 0.2 Hz sine, offsets -0.5 … +0.5
    osc_test.py sine 0 --amp 0.2     a smaller swing: ±0.2 around the parameter's own position
    osc_test.py sine 0 1 --hz 1      rows 0 and 1 together (the second a quarter turn later)
    osc_test.py ramp 3               row 3 up from 0 to 1 and back, once a second each way

The board sends a menu row a value from 0 to 1, and the row picks item = round(value × (items − 1)). `item` does that sum
for you, so the count only matters if the menu does not have 4 items. A switch is a menu of two items: `item 0 1 2` is on.

Watch the mapped parameter in Live: a dial moves around its own knob position and goes back when you stop.
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
MAX_CHANNEL = 8


def pad(b: bytes) -> bytes:
    b += b"\0"
    return b + b"\0" * (-len(b) % 4)


def param(row: int, offset: float) -> bytes:
    return pad(b"/bleep/param") + pad(b",if") + struct.pack(">if", row, offset)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["sine", "ramp", "set", "release", "on", "off", "item"])
    ap.add_argument("rows", nargs="+", type=float,
                    help=f"row numbers 0..{ROWS - 1}; `set`: the row, then the value; `item`: the row, the item, and the number of items if not 4")
    ap.add_argument("-c", "--channel", type=int, default=int(os.environ.get("BLEEP_CHANNEL", "1")),
                    help="the device's channel, 1..8 (default: $BLEEP_CHANNEL, or 1)")
    ap.add_argument("--of", type=int, default=None, help="`item`: how many items the menu has (same as the third number)")
    ap.add_argument("--hz", type=float, default=0.2, help="sine/ramp rate (default 0.2)")
    ap.add_argument("--amp", type=float, default=None,
                    help="sine: swing of ±amp around the base (default 0.5); ramp: peak offset (default 1.0)")
    ap.add_argument("--rate", type=float, default=100.0, help="messages per second per row (default 100, like the board)")
    ap.add_argument("--seconds", type=float, default=0.0, help="stop after this long (default: until Ctrl-C)")
    a = ap.parse_args()

    if not 1 <= a.channel <= MAX_CHANNEL:
        ap.error(f"the channel is 1..{MAX_CHANNEL}")
    device = ("127.0.0.1", FIRST_DEVICE_PORT + a.channel - 1)
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
            send(r, 0.0)
        return

    hello = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        hello.bind(("127.0.0.1", BOARD_PORT))
        hello.setblocking(False)
    except OSError:
        print(f"note: port {BOARD_PORT} is taken (Bleep Board running?), so /bleep/hello is not shown")
        hello = None

    print(f"sending to {device[0]}:{device[1]} (channel {a.channel}), rows {rows}, Ctrl-C to stop (then the rows are released)")
    t0 = time.monotonic()
    try:
        while a.seconds <= 0 or time.monotonic() - t0 < a.seconds:
            t = time.monotonic() - t0
            for n, r in enumerate(rows):
                phase = a.hz * t + n * 0.25
                if a.mode == "sine":
                    v = (0.5 if a.amp is None else a.amp) * math.sin(2 * math.pi * phase)
                else:
                    x = phase % 1.0
                    v = (1.0 if a.amp is None else a.amp) * (2 * x if x < 0.5 else 2 * (1 - x))
                send(r, v)
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
            send(r, 0.0)


if __name__ == "__main__":
    main()
