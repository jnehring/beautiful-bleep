# OSC Bridge

Type id `osc-bridge` · category *Utility* · colour `#fde047`

## 1. Purpose

Connects the board to anything that speaks OSC 1.0 over UDP: control surfaces and tablets, other software, show-control and
visual tools. Messages whose address matches a pattern become signals, gates and triggers inside the board; signals
become messages that go out. It is off until switched on and then uses one port; nothing is sent or received before.

## 2. Jacks

**Inputs**: *Send 1 … 6* (`control`).

**Outputs**: *Receive 1 … 6* (`control`, bipolar: values, gates or triggers according to the lane) and *Activity* (`trigger`: a pulse
when any message arrived).

## 3. Controls

| Control | Values | Default | Notes |
|---|---|---|---|
| Network On | off / on | off | Opens the UDP port. Nothing else in this module touches the network. |
| Listen Port | 1024 – 65535 | 9000 | |
| Accept From | This Computer, Local Network | This Computer | The first binds to 127.0.0.1 only; the second to every interface. |
| Send Port | 1 – 65535 | 9001 | Messages go to *host*:*Send Port*. |

**Node data** (JSON): `host` (name or address, default `127.0.0.1`), `receive` and `send`, six lanes each.

| Receive lane | Meaning |
|---|---|
| `pattern` | OSC address pattern (`?`, `*`, `[abc]`, `[a-z]`, `[!x]`, `{one,two}`; parts split at `/`). Empty: lane off. Default `/bleep/in/n`. |
| `arg` | Which numeric argument (0 – 3). |
| `mode` | 0 Value, 1 Gate, 2 Trigger. |
| `lo`, `hi`, `bipolar` | Value: the argument range that maps onto 0 … 1 (or −1 … +1); outside it is clamped. |
| `smooth` | Value: seconds of one-pole smoothing (0: none). |

| Send lane | Meaning |
|---|---|
| `address` | Plain OSC address. Empty: lane off. Default `/bleep/out/n`. |
| `mode` | 0 Value, 1 Gate, 2 Trigger. |
| `lo`, `hi`, `bipolar` | Value: the cable (0 … 1, or −1 … +1 with `bipolar`) maps onto `lo` … `hi`. Gate: `hi` is sent on the rising edge, `lo` on the falling one. Trigger: `hi` on a rising edge. |
| `rate` | Value: at most this many messages per second (1 – 500). |

## 4. Behaviour

**Packets.** OSC 1.0 messages and bundles (nested up to four levels deep; the time tag is ignored and messages act on arrival). Numeric arguments
`i f d h T F` become numbers; strings, blobs and other tags are skipped. At most four numeric arguments and 95 address characters are kept;
a malformed packet is dropped without side effects. Non-finite numbers become 0. Sent messages have one `f` argument.

**Receive lanes.** Each incoming message is tested against the six patterns; every lane that matches acts.
*Value* sets the target from the chosen argument (a message without it is ignored). *Gate* follows the argument (≥ 0.5 high); a message with no
arguments is a 10 ms gate. *Trigger* gives a 2 ms pulse for any matching message.

**Send lanes.** *Value*: the first sample after switching on is sent at once, later ones when the value moved by more than 0.2 % of the range and
`1/rate` seconds passed since the last message; a change held back by the rate limit is sent when it is due, so the final value always arrives.
Messages are queued for the network thread; a full queue (128) drops messages rather than wait.

**Threads.** One network thread (shared by all OSC Bridges in the process) reads the socket and fills a log of the last 256 messages; each module reads the log
at its own pace and, if it falls behind by more than 256, skips ahead. The audio thread never blocks and never allocates. The port is owned by the first
module that is switched on; another one meanwhile shows *Another OSC Bridge has the port*. Switching a module off or deleting it releases the port.

**Safety.** Listening is limited to this computer unless *Accept From* says otherwise. Incoming messages can only move the lanes' outputs; they cannot change
anything else in the board.

## 5. View

Status line (Off, Listening, port failure or busy; messages received and sent; the newest message with its arguments), the host to send to, six receive rows
(address pattern, **Learn** takes the newest message's address, argument, mode, range, smoothing) and six send rows (address, mode, range, rate).

## 6. Not done yet

- **The app has no OSC settings page and no per-project port**: the port is configured by the module only.
- **Strings and blobs** (for example sending a text) aren't supported.
- **Receive replies, bundles with time tags, and multicast** aren't implemented.
- **No test opens a real socket** (the unit tests cover everything but `OscPort.h`; it has been tried by hand only).
- **The wasm build** of the module (Bleep Library) has no sockets: the module there stays inactive.

## 7. Tests

`modules/osc-bridge/tests/test_osc_bridge.cpp`: decode of every supported tag, malformed and truncated packets, bundles, encode, address patterns, the message log
(order and lapping), receive lanes (range, smoothing, bipolar, gate, short gate, trigger), send lanes (first value, rate limit, final value, gate, trigger), a full queue.
