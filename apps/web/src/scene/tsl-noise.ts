// Noise for shaders, read from the baked textures in noise-textures.ts. Everything works in metres on a 2D point.
import { float, mix, mx_cell_noise_float, smoothstep, texture, vec2, vec3 } from "three/tsl";
import { noiseKit } from "./noise-textures.ts";

export type N = any;

/**
 * Four fractal fields (R broad ... A finest, each 0..1) that repeat every `tile` metres. The same fields are read
 * at several tile sizes, with different offsets, to build detail at every scale without visible repetition.
 */
export const fieldsAt = (p: N, tile: number, offset = 0): N => texture(noiseKit().fields, p.div(tile).add(vec2(offset, offset * 0.73)));

/** Worley cells repeating every `tile` metres: R distance to centre, G distance to border, B cell id, A finer-cell distance. */
export const cellsAt = (p: N, tile: number, offset = 0): N => texture(noiseKit().cells, p.div(tile).add(vec2(offset, offset * 0.61)));

/** one random number in 0..1 for each integer cell of the point (tiles, slabs, bricks) */
export const cellRandom = (cell: N, seed: number): N => mx_cell_noise_float(vec3(cell, seed));

/** a soft threshold on noise, so a patch has a ragged edge: 0..1 */
export const patches = (n: N, lo: number, hi: number): N => smoothstep(float(lo), float(hi), n);

export const lerp = (a: N, b: N, t: N): N => mix(a, b, t);
