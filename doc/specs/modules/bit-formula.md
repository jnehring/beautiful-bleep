# Bit Formula

Type id `bit-formula` · category *Sources/Generators* · colour `#a3e635`

## 1. Purpose

An integer-expression sound generator: a restricted expression language
compiled to bytecode on the message thread, evaluated once per clock tick on
the audio thread.

## 2. Jacks

Inputs: Pitch (pitch), Reset (trigger), In (audio → `x`). Outputs: Out
(audio), Value (control 0–1), MSB (gate).

## 3. Controls

Formula (stepped, 16 built-ins + Custom), A, B, C (0–255, modulatable),
Rate (hertz, 250 Hz – 48 kHz), Smooth, Bits (stepped 1–8), Level.

## 4. Behaviour

4.1 Clock. phase += min(Rate × 2^Pitch, 4 × sampleRate) / sampleRate; every
time it passes 1 (at most four times per sample) the program is evaluated
with t, then t increments. The byte is held between ticks.

4.2 Language. Variables t a b c x; decimal and 0x literals; unary − ~ !;
binary * / % + − << >> < <= > >= == != & ^ | && ||; ternary ?:. C precedence,
32-bit unsigned wrap. Division/remainder by 0 → 0; shift counts mod 32.
Compiles by recursive descent to at most 64 stack instructions with a stack of
at most 24; nesting depth ≤ 24, source ≤ 160 characters. Everything else
(identifiers longer than one letter, `.`, `;`, `=`, function calls) is a
compile error carrying its character position. Nothing is evaluated from text
on the audio thread; both branches of `?:` are always computed (there are no side effects).

4.3 Presets compile once (static); the custom program is compiled in `setData`
and published with `RtHandoff<BitProgram>`.

4.4 Output. byte = result & 255; Bits drops low bits; out = (byte − 127.5)/127.5;
Smooth: one-pole low-pass at 20 kHz × 0.01^Smooth.

## 5. Module view

The expression (editable on *Custom*, read-only text of the preset otherwise,
with the error position), eight lamps for the current byte, a scope of the
output.

## 6. Saved state

Node data `{"formula": "<text>"}`.

## 7. Engine requirements

None.

## 8. Tests

`tests/test_bit_formula.cpp`: precedence, wrapping and the safe division/shift
rules; rejection of text outside the grammar and of oversized programs; every
built-in formula is varied for several knob settings; clock rate, hold, Bits,
Smooth; a failed program is a quiet centre value.

## 9. Later

A `sin` table lookup, a second variable bank, stereo formulas.
