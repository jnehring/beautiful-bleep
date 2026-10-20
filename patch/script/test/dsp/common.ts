// Shared by the test harnesses: buffers the JS side reads and writes, and the unit interface.
export const OUT = new StaticArray<f32>(131072);
export const IN = new StaticArray<f32>(131072);
export function outPtr(): usize { return changetype<usize>(OUT); }
export function inPtr(): usize { return changetype<usize>(IN); }
export abstract class Unit { abstract tick(x: f32): f32; }
