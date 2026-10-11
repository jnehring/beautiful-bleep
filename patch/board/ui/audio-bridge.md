# Audio Bridge

## Introduction

A Live track's audio through the standalone app and back (*Bleep Audio Bridge*).
Live and the app run side by side, and the board processes the track.

## How does it work?

Like [Audio Insert](audio-insert.md): the track's audio arrives on *Send L/R*,
and what you patch into *Return L/R* goes back to Live. The two programs share
audio in memory, sample-locked. Live's transport and tempo also reach the board
through [Link](link.md).

## How to use it?

Put *Bleep Audio Bridge* on a track in Live, start the app, and patch *Send*
through your effects to *Return*.

## Reference

| Jack | Signal | What it does |
|---|---|---|
| Send L, Send R (outputs) | audio | The track's audio |
| Return L, Return R (inputs) | audio | Audio played back on the track |
