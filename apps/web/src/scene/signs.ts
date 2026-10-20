// Name boards on the buildings that have a name in the data: a fascia sign in the band between the ground-floor
// and first-floor windows, on the wall that stands nearest a road. The names are real (from the map data); the
// board's look and exact position are illustrative.
import * as THREE from "three/webgpu";
import { outward } from "../core/geometry.ts";
import type { Hero } from "../data/types.ts";
import { planFloors } from "./buildings.ts";

const ROW = 128;
const COLS_PX = 1024;

interface Sign {
  text: string;
  /** centre of the board on the wall, wall normal, and the board size in metres */
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  width: number;
  height: number;
}

function distanceToPolyline(x: number, z: number, flat: readonly number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const ax = flat[i] as number;
    const az = flat[i + 1] as number;
    const bx = flat[i + 2] as number;
    const bz = flat[i + 3] as number;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Writes each name into one row of a canvas and returns it as a texture. */
function paintNames(names: string[]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = COLS_PX;
  canvas.height = ROW * Math.max(1, names.length);
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  names.forEach((name, i) => {
    const y = i * ROW;
    g.fillStyle = "#1d4a35";
    g.fillRect(0, y, COLS_PX, ROW);
    g.strokeStyle = "#d9c98f";
    g.lineWidth = 5;
    g.strokeRect(8, y + 8, COLS_PX - 16, ROW - 16);
    let size = 62;
    g.font = `600 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    while (g.measureText(name).width > COLS_PX - 80 && size > 24) {
      size -= 2;
      g.font = `600 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    }
    g.fillStyle = "#f3ead0";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(name, COLS_PX / 2, y + ROW / 2 + 2);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

export interface Signs {
  group: THREE.Group;
  count: number;
}

export function createSigns(hero: Hero): Signs {
  const [x0, z0, x1, z1] = hero.box;
  const signs: Sign[] = [];
  for (const b of hero.buildings) {
    if (!b.name || b.centre[0] < x0 || b.centre[0] > x1 || b.centre[1] < z0 || b.centre[1] > z1) continue;
    const ring = b.outer;
    let best: { score: number; a: [number, number]; c: [number, number]; len: number } | null = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as [number, number];
      const c = ring[(i + 1) % ring.length] as [number, number];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 7) continue;
      const mx = (a[0] + c[0]) / 2;
      const mz = (a[1] + c[1]) / 2;
      // the wall that stands nearest a road, and among near ties the longer one
      let road = 200;
      for (const r of hero.file.roads) road = Math.min(road, distanceToPolyline(mx, mz, r.p));
      const score = road - len * 0.15;
      if (!best || score < best.score) best = { score, a, c, len };
    }
    if (!best) continue;
    const { a, c, len } = best;
    const [nx, nz] = outward(a, c);
    const { floorHeight } = planFloors(b);
    const width = Math.min(len * 0.8, Math.max(3.2, b.name.length * 0.32));
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2;
    signs.push({
      text: b.name,
      x: mx + nx * 0.045,
      y: b.ground + floorHeight * 1.03,
      z: mz + nz * 0.045,
      nx,
      nz,
      width,
      height: Math.min(0.9, width / 7),
    });
  }
  const group = new THREE.Group();
  group.name = "signs";
  if (!signs.length) return { group, count: 0 };
  const map = paintNames(signs.map((s) => s.text));
  const material = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.55, metalness: 0 });
  const rows = signs.length;
  signs.forEach((s, i) => {
    const geo = new THREE.PlaneGeometry(s.width, s.height);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // each sign shows its own row of the canvas (the top row of the canvas is v = 1)
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + (1 - uv.getY(k))) / rows);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(s.x, s.y, s.z);
    // a plane faces +z; turn it to face along the wall normal
    mesh.rotation.y = Math.atan2(s.nx, s.nz);
    mesh.receiveShadow = true;
    mesh.name = `sign:${s.text}`;
    group.add(mesh);
  });
  return { group, count: signs.length };
}
