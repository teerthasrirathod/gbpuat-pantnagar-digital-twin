// The ground: a terrain mesh from the height grid, painted by a "splat" texture that says what covers each square
// metre (lawn, paving, road, apron around buildings), and a procedural material that turns those masks into soil,
// grass, asphalt and paving with fine detail. No image files are needed.

import {
  bumpMap,
  color,
  dot,
  float,
  floor,
  fract,
  mix,
  positionView,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { flatToRing, type Ring } from "../core/geometry.ts";
import type { Hero } from "../data/types.ts";
import { cellRandom, cellsAt, fieldsAt, type N, patches } from "./tsl-noise.ts";
import type { FloatUniform } from "./types.ts";

const SPLAT_RES = 0.5; // metres per pixel

export interface Splat {
  texture: THREE.DataTexture;
  box: [number, number, number, number];
  width: number;
  height: number;
}

const LAWN_KINDS = new Set(["landuse:grass", "leisure:garden", "leisure:park", "landuse:meadow", "landuse:orchard"]);
const ROAD_WIDTH: Record<string, number> = {
  tertiary: 7,
  secondary: 8,
  primary: 9,
  unclassified: 5,
  residential: 5,
  service: 3.6,
  living_street: 4,
  track: 3,
};
const PATH_CLASSES = new Set(["path", "footway", "cycleway", "pedestrian", "steps"]);

/** Draws the cover masks into one RGBA canvas: R lawn, G paving, B asphalt, A apron around buildings. */
export function buildSplat(hero: Hero): Splat {
  const [x0, z0, x1, z1] = hero.box;
  const w = Math.ceil((x1 - x0) / SPLAT_RES);
  const h = Math.ceil((z1 - z0) / SPLAT_RES);
  const layer = (draw: (g: CanvasRenderingContext2D, X: (x: number) => number, Z: (z: number) => number) => void): Uint8ClampedArray => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    g.lineCap = "round";
    g.lineJoin = "round";
    draw(
      g,
      (x) => (x - x0) / SPLAT_RES,
      (z) => (z - z0) / SPLAT_RES,
    );
    return g.getImageData(0, 0, w, h).data;
  };
  const fillRing = (g: CanvasRenderingContext2D, r: Ring, X: (x: number) => number, Z: (z: number) => number) => {
    g.beginPath();
    for (const [i, p] of r.entries()) {
      if (i) g.lineTo(X(p[0]), Z(p[1]));
      else g.moveTo(X(p[0]), Z(p[1]));
    }
    g.closePath();
    g.fill();
  };
  const stroke = (g: CanvasRenderingContext2D, flat: number[], width: number, X: (x: number) => number, Z: (z: number) => number) => {
    const pts = flatToRing(flat);
    if (pts.length < 2) return;
    g.lineWidth = width / SPLAT_RES;
    g.beginPath();
    for (const [i, p] of pts.entries()) {
      if (i) g.lineTo(X(p[0]), Z(p[1]));
      else g.moveTo(X(p[0]), Z(p[1]));
    }
    g.stroke();
  };

  const lawn = layer((g, X, Z) => {
    for (const a of hero.file.areas) if (LAWN_KINDS.has(a.k)) for (const r of a.r) fillRing(g, flatToRing(r), X, Z);
  });
  const paving = layer((g, X, Z) => {
    for (const r of hero.file.roads) if (PATH_CLASSES.has(r.c)) stroke(g, r.p, Math.max(1.6, r.w || 2), X, Z);
  });
  const asphalt = layer((g, X, Z) => {
    for (const r of hero.file.roads)
      if (!PATH_CLASSES.has(r.c) && r.c !== "track") stroke(g, r.p, r.w > 2 ? r.w : (ROAD_WIDTH[r.c] ?? 5), X, Z);
  });
  const apron = layer((g, X, Z) => {
    g.lineWidth = 2.6 / SPLAT_RES;
    for (const b of hero.buildings) {
      g.beginPath();
      for (const [i, p] of b.outer.entries()) {
        if (i) g.lineTo(X(p[0]), Z(p[1]));
        else g.moveTo(X(p[0]), Z(p[1]));
      }
      g.closePath();
      g.fill();
      g.stroke();
    }
  });

  // a raw data texture: a canvas would premultiply by alpha and destroy the masks wherever the apron mask is zero
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const road = (asphalt[i * 4 + 3] as number) / 255;
    const pave = paving[i * 4 + 3] as number;
    data[i * 4] = Math.min(lawn[i * 4 + 3] as number, 255 - pave * 0.8) * (1 - road);
    data[i * 4 + 1] = pave * (1 - road);
    data[i * 4 + 2] = road * 255;
    data[i * 4 + 3] = (apron[i * 4 + 3] as number) * (1 - road);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, box: hero.box, width: w, height: h };
}

export interface SurfaceMix {
  lawn: number;
  paving: number;
  road: number;
  apron: number;
}

/** What covers the ground at a point, read back from the splat on the CPU (each value 0 to 1): used to place props sensibly. */
export function sampleSplat(splat: Splat, x: number, z: number): SurfaceMix {
  const [x0, z0] = splat.box;
  const i = Math.min(splat.width - 1, Math.max(0, Math.floor((x - x0) / SPLAT_RES)));
  const j = Math.min(splat.height - 1, Math.max(0, Math.floor((z - z0) / SPLAT_RES)));
  const d = splat.texture.image.data as Uint8Array;
  const o = (j * splat.width + i) * 4;
  return {
    lawn: (d[o] as number) / 255,
    paving: (d[o + 1] as number) / 255,
    road: (d[o + 2] as number) / 255,
    apron: (d[o + 3] as number) / 255,
  };
}

export function buildTerrain(hero: Hero): THREE.BufferGeometry {
  const T = hero.file.terrain;
  const [x0, z0, x1, z1] = hero.box;
  const pos = new Float32Array(T.nx * T.nz * 3);
  const uvs = new Float32Array(T.nx * T.nz * 2);
  for (let j = 0; j < T.nz; j++) {
    for (let i = 0; i < T.nx; i++) {
      const k = j * T.nx + i;
      const x = T.x0 + i * T.step;
      const z = T.z0 + j * T.step;
      pos.set([x, T.h[k] as number, z], k * 3);
      uvs.set([(x - x0) / (x1 - x0), (z - z0) / (z1 - z0)], k * 2);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < T.nz - 1; j++) {
    for (let i = 0; i < T.nx - 1; i++) {
      const a = j * T.nx + i;
      const b = a + 1;
      const c = a + T.nx;
      const d = c + 1;
      idx.push(a, c, b, b, c, d); // counter-clockwise seen from above
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface GroundUniforms {
  /** 0 dry, 1 soaked: darkens and glosses the ground */
  wet: FloatUniform;
}

/** The splat read at a world position through the small domain warp that makes the edges between surfaces wander. */
export function warpedSplat(splat: Splat, p: N, detail: N): N {
  const [bx0, bz0, bx1, bz1] = splat.box;
  const f3 = fieldsAt(p, 7.3, 0.61);
  const f4 = fieldsAt(p, 1.9, 0.83);
  const warp = vec2(f3.r, f3.g)
    .sub(0.5)
    .add(vec2(f4.r, f4.g).sub(0.5).mul(0.3))
    .mul(mix(float(0.2), float(1), detail));
  const uvAt = vec2(p.x.sub(bx0).div(bx1 - bx0), p.y.sub(bz0).div(bz1 - bz0));
  return texture(splat.texture, uvAt.add(warp.div(vec2(bx1 - bx0, bz1 - bz0))));
}

/** Turns the soft edge of a mask into a crisp one. */
export const sharpenMask = (v: N): N => smoothstep(float(0.3), float(0.7), v);

export function createGroundMaterial(splat: Splat, wet: GroundUniforms["wet"]): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const dist = positionView.z.negate();
  // fine detail fades with distance so it never shimmers; the far ground settles to its average colour
  const detail = float(1).sub(smoothstep(float(12), float(80), dist));
  const fine = float(1).sub(smoothstep(float(4), float(30), dist));

  // noise fields at six scales, each one texture read giving four independent patterns
  const f0 = fieldsAt(p, 700);
  const f1 = fieldsAt(p, 110, 0.37);
  const f2 = fieldsAt(p, 31, 0.11);
  const f3 = fieldsAt(p, 7.3, 0.61);
  const f4 = fieldsAt(p, 1.9, 0.83);
  const stones = cellsAt(p, 0.9);
  const pebbles = cellsAt(p, 5, 0.2);
  const cracks = cellsAt(p, 11, 0.3);

  // the masks are looked up through a small domain warp, so the edges between surfaces wander like real ones
  const s = warpedSplat(splat, p, detail);
  const crisp = sharpenMask;
  const lawnMask = crisp(s.r);
  const paveMask = crisp(s.g);
  const roadMask = crisp(s.b);
  const apronMask = crisp(s.a);

  const macro = f0.r;
  const patchy = f1.r;
  const mid = f2.g;
  const grain = f4.a;
  const clod = f3.b;
  const fadeTo = (v: N, d: N): N => mix(float(0.5), v, d); // a field that settles to its mean with distance

  // soil: dusty alluvial brown with pale dust drifts, pebbles, dry cracks and sparse weeds
  const dust = patches(patchy, 0.55, 0.8);
  let soil: N = mix(color(0x74593f), color(0x9d8260), macro);
  soil = mix(soil, color(0xa5957a), dust.mul(0.5)).mul(mix(float(0.84), float(1.1), mid));
  const pebbleShape: N = float(1).sub(smoothstep(float(0.18), float(0.36), pebbles.a));
  soil = soil.mul(mix(float(1), mix(float(0.7), float(1.3), pebbles.b), pebbleShape.mul(0.7).mul(detail)));
  const crack: N = float(1)
    .sub(smoothstep(float(0), float(0.05), cracks.g))
    .mul(patches(f2.r, 0.62, 0.82))
    .mul(detail);
  soil = mix(soil, color(0x4a3a2c), crack.mul(0.45));
  const weeds = patches(f3.g, 0.6, 0.76).mul(patches(patchy, 0.5, 0.8));
  soil = mix(soil, mix(color(0x566a30), color(0x8a8346), clod), weeds.mul(0.75));

  // lawn: fresh green with dry patches, clumps, blade-scale speckle and faint mowing stripes
  const lawnBase = mix(color(0x2f5a26), color(0x5b8334), mid);
  let lawn: N = mix(lawnBase, color(0x8b8a4b), patches(patchy, 0.58, 0.85).mul(0.6));
  const stripe = sin(dot(p, vec2(0.62, 0.78)).mul(0.9))
    .mul(0.5)
    .add(0.5);
  lawn = lawn
    .mul(mix(float(0.78), float(1.14), fadeTo(grain, fine)))
    .mul(mix(float(0.94), float(1.06), fadeTo(stripe, detail)))
    .mul(mix(float(0.86), float(1.08), fadeTo(clod, detail)));

  // asphalt: dark and pale-grained, with repair patches, hairline cracks and dusty, crumbling edges
  let asphalt: N = mix(color(0x54545a), color(0x77777c), f1.g);
  asphalt = mix(asphalt, color(0x3c3c40), patches(f2.r, 0.62, 0.68).mul(0.65));
  const stone: N = float(1).sub(smoothstep(float(0.2), float(0.45), stones.r));
  asphalt = asphalt.mul(mix(float(1), mix(float(0.88), float(1.3), stone), fine));
  const asphaltCrack: N = float(1)
    .sub(smoothstep(float(0), float(0.03), cracks.g))
    .mul(patches(patchy, 0.6, 0.82))
    .mul(detail);
  asphalt = mix(asphalt, color(0x141516), asphaltCrack.mul(0.55));
  const edgeBand: N = float(1).sub(smoothstep(float(0.62), float(0.97), s.b));
  asphalt = mix(asphalt, mix(color(0x9a8b72), color(0x6d5a44), mid), edgeBand.mul(0.6));

  // paving: pale slabs of 0.5 m with dirty joints and a different tone on every slab
  const slab = fract(p.mul(2));
  const joint: N = float(1).sub(step(0.045, slab.x).mul(step(0.045, slab.y)));
  const slabTone = cellRandom(floor(p.mul(2)), 30);
  let paving: N = mix(color(0xa59a8a), color(0x8d8373), f2.b).mul(mix(float(0.88), float(1.08), slabTone));
  paving = mix(paving, color(0x4f4a40), joint.mul(0.55).mul(detail)).mul(float(1).sub(joint.mul(0.12)));

  // apron: poured concrete in 2.4 m bays with expansion joints, stains and a slab-to-slab tone
  const bay = fract(p.div(2.4));
  const bayJoint: N = float(1).sub(step(0.012, bay.x).mul(step(0.012, bay.y)));
  const bayTone = cellRandom(floor(p.div(2.4)), 32);
  let apron: N = mix(color(0xb4aea2), color(0x9d978b), f2.a).mul(mix(float(0.92), float(1.06), bayTone));
  apron = mix(apron, color(0x6c675c), patches(f3.r, 0.6, 0.85).mul(0.3));
  apron = apron.mul(float(1).sub(bayJoint.mul(0.4)));

  let c: N = mix(soil, lawn, lawnMask);
  c = mix(c, paving, paveMask);
  c = mix(c, apron, apronMask);
  c = mix(c, asphalt, roadMask);

  // rain: everything darkens, and in the low patches it stands as water
  const puddle: N = wet.mul(patches(f2.b, 0.55, 0.7));
  m.colorNode = c.mul(mix(float(1), float(0.62), wet)).mul(mix(float(1), float(0.7), puddle));
  const rough: N = mix(mix(mix(float(0.95), float(0.9), lawnMask), float(0.8), apronMask), float(0.9), roadMask);
  m.roughnessNode = mix(rough, float(0.3), wet.mul(0.8)).mul(mix(float(1), float(0.25), puddle));
  m.metalnessNode = float(0);

  // micro relief for the light to catch: clods and pebbles, grass tufts, aggregate, cracks and joints
  const relief: N = mix(
    mix(clod.mul(0.02).add(pebbleShape.mul(0.03)).sub(crack.mul(0.03)), grain.mul(0.012).add(mid.mul(0.03)), lawnMask),
    grain.mul(0.004).add(stone.mul(0.004)).sub(asphaltCrack.mul(0.01)),
    roadMask,
  ).sub(joint.mul(paveMask).mul(0.012));
  m.normalNode = bumpMap(relief.mul(detail), float(2.2));
  return m;
}

export function createGround(hero: Hero, wet: GroundUniforms["wet"]): THREE.Mesh {
  const splat = buildSplat(hero);
  const mesh = new THREE.Mesh(buildTerrain(hero), createGroundMaterial(splat, wet));
  mesh.receiveShadow = true;
  mesh.name = "ground";
  mesh.userData.splat = splat;
  return mesh;
}
