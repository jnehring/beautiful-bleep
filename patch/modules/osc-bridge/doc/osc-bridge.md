# OSC Bridge

## Introduction

OSC Bridge talks to the outside world in OSC, the message format that control apps, tablets, show-control and visual software
use over a network. Six lanes bring messages in as signals, gates and triggers; six lanes send your signals out as messages.
It stays off, and touches no network, until you turn **Network On**.

## How does it work?

**Switching on.** Turn on *Network On*. The bridge listens on *Listen Port* (9000) and sends to the *host* and *Send Port* (9001)
you choose. By default only programs on this computer can reach it; set *Accept From* to *Local Network* to hear other devices. Only one OSC
Bridge can have the port at a time.

**Receiving.** Each receive lane has an **address pattern**, such as `/fader/1`, or `/fader/*` for all faders, or `/ch/{1,2}/level`. When
a message arrives whose address fits, the lane acts on one of its numbers (*Arg 1 – 4*):

- **Value:** the number is scaled from *its range* to 0 … 1 (or −1 … +1) and appears at the lane's output, smoothed over the time you set.
- **Gate:** the output is high while the number is 0.5 or more. A message without a number gives a short gate.
- **Trigger:** every matching message gives a short pulse.

Press **Learn** on a lane and then move a control on your device: the lane takes the address of the newest message. The status line
shows the newest message and its numbers, which is also how you find out what a device sends.

**Sending.** Each send lane watches its input and sends the value to an address. As **Value** it sends when the signal moves, at most *rate* times per
second, with the cable's range mapped onto the numbers you choose. As **Gate** it sends one number on the rising edge and another on the falling one, as **Trigger** it sends
a number for each rising edge. Messages carry one decimal number.

**Activity** pulses whenever any message arrives, matching a lane or not.

## How to use it?

- **A control surface:** Network On, Learn on four lanes, wire the outputs to a filter, a reverb mix and so on.
- **Clock from another program:** a Trigger lane on `/clock`, into a sequencer's clock input.
- **Send what the board does:** an LFO into a send lane with the address a visual tool listens to, rate 30.
- **Notes as gates:** a Gate lane on `/note/on` with its range 0 … 1 gates an envelope from outside.
- **Remote between two computers:** Accept From *Local Network* on one, its address as host on the other, and the ports matching.

## Reference

### Settings

| Setting | Values | Default |
|---|---|---|
| Network On | off, on | off |
| Listen Port | 1024 – 65535 | 9000 |
| Accept From | This Computer, Local Network | This Computer |
| Send Port | 1 – 65535 | 9001 |

The view also holds the host (default 127.0.0.1) and the lanes: address, argument, mode, range, smoothing or rate.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Send 1 – 6 | control | the signal a send lane sends |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Receive 1 – 6 | control | the value, gate or trigger of a receive lane |
| Activity | trigger | a pulse for every message that arrives |
