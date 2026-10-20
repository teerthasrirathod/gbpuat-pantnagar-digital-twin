// The window masks, rasterised once on the CPU. One bay of wall (3.2 m wide, one floor high) is drawn for each of the
// three window styles and the styles sit side by side in two RGBA textures. The facade shader then reads a handful of
// texels where it would otherwise evaluate dozens of smoothsteps per pixel, and mip-mapping filters the distance for free.
//
//   textureA (in the wall plane):  R opening   G painted surround   B grille bars   A sill
//   textureB (G and R also read on the window plane, B and A in the wall plane):
//                                  R frame     G glass             B painted sunshade   A shadow under the sunshade
import * as THREE from "three/webgpu";

const CELL = 192; // texels per style, both ways
export const WINDOW_STYLES = 3;

/** Opening of each style in bay units: x0, x1 (the rest is mirrored), y0, y1. */
export const WINDOW_OPENING = [
  { x0: 0.28, y0: 0.26, y1: 0.74, mullion: true },
  { x0: 0.2, y0: 0.3, y1: 0.7, mullion: false },
  { x0: 0.34, y0: 0.2, y1: 0.8, mullion: false },
] as const;

const SUPER = 4;

function raster(style: number, x: number, y: number): [number, number, number, number, number, number, number, number] {
  const o = WINDOW_OPENING[style] as (typeof WINDOW_OPENING)[number];
  const x0 = o.x0;
  const x1 = 1 - o.x0;
  const y0 = o.y0;
  const y1 = o.y1;
  const inR = (a: number, b: number, c: number, d: number): number => (x >= a && x <= b && y >= c && y <= d ? 1 : 0);
  const hole = inR(x0, x1, y0, y1);
  const outer = inR(x0 - 0.034, x1 + 0.034, y0 - 0.04, y1 + 0.04);
  const inner = inR(x0 + 0.036, x1 - 0.036, y0 + 0.04, y1 - 0.04);
  const mullion = o.mullion && Math.abs(x - 0.5) < 0.012 ? 1 : 0;
  const transom = y >= y1 - 0.19 && y <= y1 - 0.17 ? 1 : 0;
  const glass = inner * (1 - mullion) * (1 - transom);
  const frame = hole - glass;
  const bars = hole * (Math.abs(((((x - x0) / (x1 - x0)) * 8) % 1) - 0.5) < 0.13 || Math.abs(y - 0.495) < 0.01 ? 1 : 0);
  const sill = inR(x0 - 0.04, x1 + 0.04, y0 - 0.075, y0 - 0.04);
  const shade = inR(x0 - 0.11, x1 + 0.11, y1 + 0.055, y1 + 0.115);
  const shadeShadow = inR(x0 - 0.08, x1 + 0.08, y1 + 0.03, y1 + 0.055);
  return [hole, outer - hole, bars, sill, frame, glass, shade, shadeShadow];
}

export interface WindowAtlas {
  a: THREE.DataTexture;
  b: THREE.DataTexture;
}

function texture(data: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, CELL * WINDOW_STYLES, CELL, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

let atlas: WindowAtlas | null = null;

export function windowAtlas(): WindowAtlas {
  if (atlas) return atlas;
  const w = CELL * WINDOW_STYLES;
  const a = new Uint8Array(w * CELL * 4);
  const b = new Uint8Array(w * CELL * 4);
  for (let s = 0; s < WINDOW_STYLES; s++) {
    for (let j = 0; j < CELL; j++) {
      for (let i = 0; i < CELL; i++) {
        const acc = [0, 0, 0, 0, 0, 0, 0, 0];
        for (let sj = 0; sj < SUPER; sj++) {
          for (let si = 0; si < SUPER; si++) {
            const r = raster(s, (i + (si + 0.5) / SUPER) / CELL, (j + (sj + 0.5) / SUPER) / CELL);
            for (let k = 0; k < 8; k++) acc[k] = (acc[k] as number) + (r[k] as number);
          }
        }
        const o = (j * w + s * CELL + i) * 4;
        for (let k = 0; k < 4; k++) {
          a[o + k] = Math.round(((acc[k] as number) / (SUPER * SUPER)) * 255);
          b[o + k] = Math.round(((acc[4 + k] as number) / (SUPER * SUPER)) * 255);
        }
      }
    }
  }
  atlas = { a: texture(a), b: texture(b) };
  return atlas;
}
