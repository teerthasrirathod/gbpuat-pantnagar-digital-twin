// The land beyond the hero window: a skirt that continues the terrain from the edge of the window out to the horizon,
// so that an aerial view does not end in a square. It is deliberately plain: a patchwork of farm parcels (this is
// the Tarai plain, mostly fields), seen through haze. It carries no data about the real land use.
import { color, float, mix, positionWorld, smoothstep, step, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Hero } from "../data/types.ts";
import { cellsAt, fieldsAt, type N, patches } from "./tsl-noise.ts";
import type { FloatUniform } from "./types.ts";

const REACH = 16000; // metres from the window

/** Points around the rectangle grown by `o` metres, evenly spaced by arc length, with the four corners always included. */
function loop(box: [number, number, number, number], o: number, spacing: number): { x: number; z: number; t: number }[] {
  const [x0, z0, x1, z1] = [box[0] - o, box[1] - o, box[2] + o, box[3] + o];
  const w = x1 - x0;
  const h = z1 - z0;
  const per = 2 * (w + h);
  const pts: { x: number; z: number; t: number }[] = [];
  const edge = (ax: number, az: number, bx: number, bz: number, len: number, start: number): void => {
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i < n; i++) {
      const f = i / n;
      pts.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, t: (start + len * f) / per });
    }
  };
  edge(x0, z0, x1, z0, w, 0);
  edge(x1, z0, x1, z1, h, w);
  edge(x1, z1, x0, z1, w, w + h);
  edge(x0, z1, x0, z0, h, 2 * w + h);
  return pts;
}

/** The terrain skirt as rings that grow coarser outward. Heights are the edge heights carried outward. */
export function buildFarGround(hero: Hero): THREE.BufferGeometry {
  const T = hero.file.terrain;
  const box = hero.box;
  const rings: { x: number; z: number; t: number }[][] = [];
  let o = 0;
  let width = 40;
  let level = 0;
  rings.push(loop(box, 0, T.step));
  while (o < REACH) {
    o += width;
    level++;
    rings.push(loop(box, o, Math.min(width, T.step * 2 ** level)));
    width *= 1.55;
  }
  const pos: number[] = [];
  const index: number[] = [];
  const base = rings.map((r) => {
    const start = pos.length / 3;
    for (const p of r) pos.push(p.x, hero.heightAt(p.x, p.z) - 0.05, p.z);
    return start;
  });
  // join each ring to the next by walking both along the perimeter and always advancing the one that is behind
  for (let k = 0; k + 1 < rings.length; k++) {
    const a = rings[k] as (typeof rings)[number];
    const b = rings[k + 1] as (typeof rings)[number];
    const a0 = base[k] as number;
    const b0 = base[k + 1] as number;
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      const ai = i % a.length;
      const bj = j % b.length;
      const an = (i + 1) % a.length;
      const bn = (j + 1) % b.length;
      const ta = i + 1 >= a.length ? 1 : (a[an] as { t: number }).t;
      const tb = j + 1 >= b.length ? 1 : (b[bn] as { t: number }).t;
      if (i < a.length && (j >= b.length || ta <= tb)) {
        index.push(a0 + ai, b0 + bj, a0 + an);
        i++;
      } else {
        index.push(a0 + ai, b0 + bj, b0 + bn);
        j++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // flat land: every normal points up, whichever way the triangles are wound
  const up = new Float32Array(pos.length);
  for (let k = 1; k < up.length; k += 3) up[k] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(up, 3));
  return g;
}

export function createFarGroundMaterial(wet: FloatUniform): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const p = positionWorld.xz;
  // farm parcels: each cell of a coarse pattern is one field with its own crop colour
  const parcels = cellsAt(p, 5200, 0.17);
  const small = cellsAt(p, 1700, 0.43);
  const id = parcels.b;
  const id2 = small.b;
  const crops: [number, number][] = [
    [0xb4a458, 0xc9b567], // ripe wheat
    [0x5d8c36, 0x74a244], // green crop
    [0x86704f, 0x9a8460], // fallow soil
    [0x78a047, 0x8db555], // young crop
    [0x3d5d2d, 0x4c7237], // orchard and tree blocks
    [0x6a5238, 0x806447], // ploughed
  ];
  const tone = fieldsAt(p, 900, 0.1).g;
  const pickCrop = (r: N): N => {
    let c: N = color(crops[0]?.[0] ?? 0);
    for (const [i, [a, b]] of crops.entries()) {
      const lo = i / crops.length;
      const hi = (i + 1) / crops.length;
      c = mix(c, mix(color(a), color(b), tone), step(lo, r).mul(float(1).sub(step(hi, r))));
    }
    return c;
  };
  let field: N = pickCrop(id);
  // some big parcels are split in two by a second, finer pattern
  field = mix(field, pickCrop(id2), patches(fieldsAt(p, 7000, 0.31).r, 0.55, 0.62));
  // crop rows and field-to-field variation
  field = field.mul(mix(float(0.86), float(1.1), fieldsAt(p, 160).b));
  // bunds and tracks between the fields
  const border = float(1).sub(smoothstep(float(0), float(0.035), parcels.g));
  field = mix(field, color(0x6d6048), border.mul(0.6));
  // tree lines, villages' worth of dark clumps
  const trees = patches(fieldsAt(p, 1300, 0.7).a, 0.7, 0.8).mul(patches(fieldsAt(p, 330, 0.1).b, 0.5, 0.65));
  field = mix(field, vec3(0.04, 0.1, 0.03), trees.mul(0.8));
  m.colorNode = field.mul(mix(float(1), float(0.62), wet));
  m.roughnessNode = float(0.95);
  m.metalnessNode = float(0);
  return m;
}

export function createFarGround(hero: Hero, wet: FloatUniform): THREE.Mesh {
  const mesh = new THREE.Mesh(buildFarGround(hero), createFarGroundMaterial(wet));
  mesh.name = "far-ground";
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}
