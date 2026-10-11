# Audio Insert

## Introduction

*Bleep FX* in Live: a track's audio goes through the board and back to the same
track, like an insert effect.

## How does it work?

The track's audio leaves on *Send L/R*. Whatever you patch into *Return L/R*
plays on the track. Patch a path from send to return through your effects. The
board treats the path as a normal signal chain, with no extra feedback delay.

## How to use it?

*Send L/R* into a Filter and a Reverb, and the Reverb's output into *Return L/R*.

## Reference

| Jack | Signal | What it does |
|---|---|---|
| Send L, Send R (outputs) | audio | The track's audio |
| Return L, Return R (inputs) | audio | Audio played back on the track |
