// Tileable noise, baked once on the CPU into two small textures. Sampling these costs a handful of texture reads,
// where evaluating the same patterns procedurally per pixel costs dozens of noise octaves: the ground, the facades and
// the roofs all draw their variation from here.
import * as THREE from "three/webgpu";
import { mulberry32 } from "../core/rng.ts";

const SIZE = 512;

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** One octave of tileable value noise: a random lattice of `lat` x `lat` points, smoothly interpolated. */
function lattice(rnd: () => number, lat: number): Float32Array {
  const v = new Float32Array(lat * lat);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  return v;
}

/** Tileable fractal noise in 0..1 with a little contrast added, written into one channel of an RGBA buffer. */
function fillChannel(data: Uint8Array, channel: number, baseLattice: number, octaves: number, seed: number): void {
  const rnd = mulberry32(seed);
  const layers: { lat: number; v: Float32Array; amp: number }[] = [];
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const lat = baseLattice * 2 ** o;
    const amp = 0.55 ** o;
    layers.push({ lat, v: lattice(rnd, lat), amp });
    total += amp;
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (const { lat, v, amp } of layers) {
        const fx = (x / SIZE) * lat;
        const fy = (y / SIZE) * lat;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fade(fx - ix);
        const ty = fade(fy - iy);
        const x0 = ix % lat;
        const y0 = iy % lat;
        const x1 = (ix + 1) % lat;
        const y1 = (iy + 1) % lat;
        const a = v[y0 * lat + x0] as number;
        const b = v[y0 * lat + x1] as number;
        const c = v[y1 * lat + x0] as number;
        const d = v[y1 * lat + x1] as number;
        sum += (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty) * amp;
      }
      const n = Math.min(1, Math.max(0, (sum / total - 0.5) * 1.7 + 0.5));
      data[(y * SIZE + x) * 4 + channel] = Math.round(n * 255);
    }
  }
}

function tileable(data: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Four independent fractal fields, from broad (R) to fine (A). */
function buildFields(): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  fillChannel(data, 0, 4, 5, 11);
  fillChannel(data, 1, 8, 4, 23);
  fillChannel(data, 2, 16, 3, 37);
  fillChannel(data, 3, 32, 2, 51);
  return tileable(data);
}

/**
 * A tileable Worley pattern: R is the distance to the nearest cell centre (0 at the centre, about 1 at the cell
 * edge), G is the distance between the nearest and the second nearest (0 along the borders of the cells), B is a
 * random number for each cell and A is a second, finer pattern's distance.
 */
function buildCells(): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const layers: { n: number; points: Float32Array; ids: Float32Array }[] = [];
  const rnd = mulberry32(77);
  for (const n of [16, 40]) {
    const pts = new Float32Array(n * n * 2);
    const ids = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      pts[i * 2] = rnd();
      pts[i * 2 + 1] = rnd();
      ids[i] = rnd();
    }
    layers.push({ n, points: pts, ids });
  }
  const search = (layer: { n: number; points: Float32Array; ids: Float32Array }, u: number, v: number): [number, number, number] => {
    const { n, points, ids } = layer;
    const cx = Math.floor(u * n);
    const cy = Math.floor(v * n);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        const wx = ((gx % n) + n) % n;
        const wy = ((gy % n) + n) % n;
        const k = wy * n + wx;
        const px = gx + (points[k * 2] as number);
        const py = gy + (points[k * 2 + 1] as number);
        const d = Math.hypot(px - u * n, py - v * n);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = ids[k] as number;
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2, id];
  };
  const [coarse, fine] = layers as [(typeof layers)[number], (typeof layers)[number]];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE;
      const v = (y + 0.5) / SIZE;
      const [f1, f2, id] = search(coarse, u, v);
      const [g1] = search(fine, u, v);
      const o = (y * SIZE + x) * 4;
      data[o] = Math.min(255, Math.round(f1 * 255));
      data[o + 1] = Math.min(255, Math.round(Math.min(1, (f2 - f1) * 1.5) * 255));
      data[o + 2] = Math.round(id * 255);
      data[o + 3] = Math.min(255, Math.round(g1 * 255));
    }
  }
  return tileable(data);
}

export interface NoiseKit {
  /** four fractal fields: R broad, G medium, B fine, A finest, each 0..1 */
  fields: THREE.DataTexture;
  /** Worley cells: R distance to centre, G distance to border, B cell id, A finer-cell distance */
  cells: THREE.DataTexture;
}

let kit: NoiseKit | null = null;

/** The shared noise textures, built on first use. */
export function noiseKit(): NoiseKit {
  if (!kit) kit = { fields: buildFields(), cells: buildCells() };
  return kit;
}
