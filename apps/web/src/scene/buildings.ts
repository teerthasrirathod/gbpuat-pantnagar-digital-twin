// Turns building footprints into geometry: walls with a bay and floor grid in their UVs, flat roofs with parapets,
// stair-head rooms and rooftop water tanks. All buildings of the hero area become a few merged meshes.
import * as THREE from "three/webgpu";
import { inset, orientedRect, outward, type Pt, pointInRing, type Ring, triangulate } from "../core/geometry.ts";
import { hashString, mulberry32 } from "../core/rng.ts";
import type { Building, Hero } from "../data/types.ts";
import { createFacadeMaterial, createRoofMaterial, createTankMaterial, FLAG_REAL_SHADE } from "./facade-material.ts";
import type { EnvUniforms, FloatUniform } from "./types.ts";

const BAY = 3.2;
const PARAPET = 0.9;

const WALL_PALETTE: Record<string, number[]> = {
  academic: [0xe8d7b1, 0xe2cfa4, 0xdcc89d],
  hostel: [0xeadb9e, 0xe6d28c],
  residential: [0xefe6d2, 0xeadcc0, 0xf0e4c8],
  house: [0xece2cf, 0xf0d9c8, 0xe2e4dc, 0xeed9a8, 0xdfe6e8],
  admin: [0xe4ddcc, 0xd9d0bd],
  health: [0xf2f2ee],
  school: [0xe8cf9c],
  commercial: [0xddd0c0, 0xe8d5b8],
  religious: [0xf6ead0, 0xf3d7a2],
  sports: [0xd9d3c6],
  farm: [0xc2baab],
  industrial: [0xbabdc0],
  utility: [0xcac3b7],
  institutional: [0xe2d6bd],
  unknown: [0xe4dac8],
};

class MeshBuilder {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  info: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    info: readonly number[],
    c: THREE.Color,
  ): number {
    const i = this.p.length / 3;
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    this.info.push(info[0] as number, info[1] as number, info[2] as number, info[3] as number);
    this.col.push(c.r, c.g, c.b);
    return i;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  get triangles(): number {
    return this.idx.length / 3;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("aInfo", new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface FloorPlan {
  floors: number;
  floorHeight: number;
}
/** Floor count and height that agree with the building height, whatever the data says about floors. */
export function planFloors(b: Pick<Building, "floors" | "height">): FloorPlan {
  let floors = Math.max(1, b.floors);
  let fh = b.height / floors;
  if (fh > 5.2 || fh < 2.6) {
    floors = Math.max(1, Math.round(b.height / 3.4));
    fh = b.height / floors;
  }
  return { floors, floorHeight: fh };
}

function wallColour(b: Building, rnd: () => number): THREE.Color {
  const pal = WALL_PALETTE[b.type] ?? WALL_PALETTE.unknown ?? [0xe4dac8];
  const hex = pal[Math.floor(rnd() * pal.length)] as number;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // a little per-building variation in lightness and warmth, so a row of houses does not look cloned
  c.setHSL(hsl.h + (rnd() - 0.5) * 0.015, hsl.s * (0.85 + rnd() * 0.3), hsl.l * (0.94 + rnd() * 0.1));
  return c;
}

function roofColour(b: Building): THREE.Color {
  const r = (b.roofColour >> 16) & 255;
  const g = (b.roofColour >> 8) & 255;
  const bl = b.roofColour & 255;
  const c = new THREE.Color().setRGB(r / 255, g / 255, bl / 255, THREE.SRGBColorSpace);
  // satellite roof colours are dark and noisy: blend toward a light concrete grey
  return c.lerp(new THREE.Color(0xb7b2a8), 0.55);
}

function wall(
  mb: MeshBuilder,
  a: Pt,
  b: Pt,
  y0: number,
  y1: number,
  ground: number,
  fh: number,
  info: number[],
  c: THREE.Color,
  flip = false,
): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.05) return;
  const [nx, nz] = outward(a, b);
  const sx = flip ? -1 : 1;
  const bays = info[0] === 0 ? Math.max(1, Math.round(L / BAY)) : Math.max(1, Math.round(L / BAY));
  const v0 = (y0 - ground) / fh;
  const v1 = (y1 - ground) / fh;
  const i0 = mb.vertex(a[0], y0, a[1], nx * sx, 0, nz * sx, 0, v0, info, c);
  const i1 = mb.vertex(b[0], y0, b[1], nx * sx, 0, nz * sx, bays, v0, info, c);
  const i2 = mb.vertex(b[0], y1, b[1], nx * sx, 0, nz * sx, bays, v1, info, c);
  const i3 = mb.vertex(a[0], y1, a[1], nx * sx, 0, nz * sx, 0, v1, info, c);
  if (flip) {
    mb.tri(i0, i1, i2);
    mb.tri(i0, i2, i3);
  } else {
    mb.tri(i0, i2, i1);
    mb.tri(i0, i3, i2);
  }
}

/** A quad whose triangles face the given normal, whatever order the corners come in. */
function quad(
  mb: MeshBuilder,
  p: [number, number, number][],
  n: [number, number, number],
  uv: [number, number][],
  info: number[],
  c: THREE.Color,
): void {
  const ids = p.map((q, i) =>
    mb.vertex(q[0], q[1], q[2], n[0], n[1], n[2], (uv[i] as [number, number])[0], (uv[i] as [number, number])[1], info, c),
  );
  const [a, b, d, e] = ids as [number, number, number, number];
  const p0 = p[0] as [number, number, number];
  const p1 = p[1] as [number, number, number];
  const p2 = p[2] as [number, number, number];
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const gx = uy * vz - uz * vy;
  const gy = uz * vx - ux * vz;
  const gz = ux * vy - uy * vx;
  if (gx * n[0] + gy * n[1] + gz * n[2] >= 0) {
    mb.tri(a, b, d);
    mb.tri(a, d, e);
  } else {
    mb.tri(a, d, b);
    mb.tri(a, e, d);
  }
}

/**
 * A band that projects from a wall: a sunshade, a string course, a coping or a plinth. It has a front, a top and an
 * underside; the ends run on past the wall by the projection so that the bands of two walls close up at a corner.
 */
function ledge(
  mb: MeshBuilder,
  a: Pt,
  b: Pt,
  y0: number,
  y1: number,
  proj: number,
  ground: number,
  fh: number,
  info: number[],
  c: THREE.Color,
): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1.5) return;
  const [nx, nz] = outward(a, b);
  const dx = (b[0] - a[0]) / L;
  const dz = (b[1] - a[1]) / L;
  const wa: Pt = [a[0] - dx * proj, a[1] - dz * proj];
  const wb: Pt = [b[0] + dx * proj, b[1] + dz * proj];
  const oa: Pt = [wa[0] + nx * proj, wa[1] + nz * proj];
  const ob: Pt = [wb[0] + nx * proj, wb[1] + nz * proj];
  const v0 = (y0 - ground) / fh;
  const v1 = (y1 - ground) / fh;
  const u1 = L / BAY;
  quad(
    mb,
    [
      [oa[0], y0, oa[1]],
      [ob[0], y0, ob[1]],
      [ob[0], y1, ob[1]],
      [oa[0], y1, oa[1]],
    ],
    [nx, 0, nz],
    [
      [0, v0],
      [u1, v0],
      [u1, v1],
      [0, v1],
    ],
    info,
    c,
  );
  quad(
    mb,
    [
      [wa[0], y1, wa[1]],
      [wb[0], y1, wb[1]],
      [ob[0], y1, ob[1]],
      [oa[0], y1, oa[1]],
    ],
    [0, 1, 0],
    [
      [0, 0],
      [u1, 0],
      [u1, 0.2],
      [0, 0.2],
    ],
    info,
    c,
  );
  quad(
    mb,
    [
      [wa[0], y0, wa[1]],
      [wb[0], y0, wb[1]],
      [ob[0], y0, ob[1]],
      [oa[0], y0, oa[1]],
    ],
    [0, -1, 0],
    [
      [0, 0],
      [u1, 0],
      [u1, 0.2],
      [0, 0.2],
    ],
    info,
    c,
  );
}

/** Heights of the window head as a fraction of the floor height for each of the three window styles in the facade shader. */
const WINDOW_HEAD = [0.74, 0.7, 0.8];

function flatTop(mb: MeshBuilder, ring: Ring, holes: Ring[], y: number, c: THREE.Color, info: number[], uvScale = 1): void {
  const { flat, indices } = triangulate(ring, holes);
  const base = mb.p.length / 3;
  for (let i = 0; i < flat.length; i += 2)
    mb.vertex(
      flat[i] as number,
      y,
      flat[i + 1] as number,
      0,
      1,
      0,
      (flat[i] as number) * uvScale,
      (flat[i + 1] as number) * uvScale,
      info,
      c,
    );
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] as number;
    const b = indices[i + 1] as number;
    const d = indices[i + 2] as number;
    const cross =
      ((flat[b * 2] as number) - (flat[a * 2] as number)) * ((flat[d * 2 + 1] as number) - (flat[a * 2 + 1] as number)) -
      ((flat[b * 2 + 1] as number) - (flat[a * 2 + 1] as number)) * ((flat[d * 2] as number) - (flat[a * 2] as number));
    if (cross > 0) mb.tri(base + a, base + d, base + b);
    else mb.tri(base + a, base + b, base + d);
  }
}

/** A plain box (stair-head room) standing on a roof, aligned with an oriented rectangle. */
function box(
  mb: MeshBuilder,
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  len: number,
  wid: number,
  y0: number,
  y1: number,
  c: THREE.Color,
  roof: THREE.Color,
  roofMb: MeshBuilder,
): void {
  const hx = len / 2;
  const hz = wid / 2;
  const corner = (sx: number, sz: number): Pt => [cx + ux * hx * sx - uz * hz * sz, cz + uz * hx * sx + ux * hz * sz];
  const ring: Pt[] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  // make the corner ring wind positively so that the wall normals face outward
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = ring[i] as Pt;
    const q = ring[(i + 1) % 4] as Pt;
    area += p[0] * q[1] - q[0] * p[1];
  }
  const r = area < 0 ? [...ring].reverse() : ring;
  for (let i = 0; i < 4; i++) wall(mb, r[i] as Pt, r[(i + 1) % 4] as Pt, y0, y1, y0, 3, [0, 3, 0, 0], c);
  flatTop(roofMb, r, [], y1, roof, [0, 3, 0, 0]);
}

export interface BuildingMeshes {
  group: THREE.Group;
  materials: { facade: THREE.MeshStandardNodeMaterial; roof: THREE.MeshStandardNodeMaterial };
  triangles: number;
  count: number;
}

/** Buildings are merged per square of this many metres, so that frustum and shadow culling can skip whole districts. */
const CHUNK = 100;

interface Chunk {
  walls: MeshBuilder;
  roofs: MeshBuilder;
  tanks: [number, number, number][];
}

export function buildBuildings(hero: Hero, wet: FloatUniform, env: EnvUniforms): BuildingMeshes {
  const chunks = new Map<string, Chunk>();
  const chunkAt = (x: number, z: number): Chunk => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) {
      c = { walls: new MeshBuilder(), roofs: new MeshBuilder(), tanks: [] };
      chunks.set(key, c);
    }
    return c;
  };
  const [x0, z0, x1, z1] = hero.box;
  let count = 0;
  for (const b of hero.buildings) {
    if (b.centre[0] < x0 || b.centre[0] > x1 || b.centre[1] < z0 || b.centre[1] > z1) continue;
    count++;
    const { walls, roofs, tanks } = chunkAt(b.centre[0], b.centre[1]);
    const rnd = mulberry32(hashString(b.id));
    const { floors, floorHeight: fh } = planFloors(b);
    const ground = b.ground;
    const roofY = ground + b.height;
    const wc = wallColour(b, rnd);
    const rc = roofColour(b);
    const seed = rnd();
    const info = [BAY, fh, 0, seed];
    // big institutional and residential blocks get real sunshades above their windows, a cornice and a plinth
    const detailed = b.footprint >= 90 && floors >= 2 && !["farm", "industrial", "utility", "house"].includes(b.type);
    const shades = detailed && rnd() < 0.6;
    const flags = shades ? FLAG_REAL_SHADE : 0;
    // walls: from below the terrain (it slopes) up to the roof
    const ring = b.outer;
    for (let i = 0; i < ring.length; i++)
      wall(
        walls,
        ring[i] as Pt,
        ring[(i + 1) % ring.length] as Pt,
        ground - 0.6,
        roofY,
        ground,
        fh,
        [info[0] as number, fh, flags + rnd() * 0.99, seed],
        wc,
      );
    for (const h of b.holes)
      for (let i = 0; i < h.length; i++)
        wall(walls, h[i] as Pt, h[(i + 1) % h.length] as Pt, ground - 0.6, roofY, ground, fh, [BAY, fh, flags + rnd() * 0.99, seed], wc);
    flatTop(roofs, ring, b.holes, roofY, rc, [0, fh, 0, seed], 1);
    if (b.footprint < 20) continue;
    if (detailed) {
      const plainInfo = [0, fh, 0, seed];
      const head = WINDOW_HEAD[Math.floor(seed * 2.999)] as number;
      const trim = new THREE.Color(wc).multiplyScalar(1.06);
      const all = [ring, ...b.holes];
      for (const r of all) {
        for (let i = 0; i < r.length; i++) {
          const a = r[i] as Pt;
          const c2 = r[(i + 1) % r.length] as Pt;
          ledge(walls, a, c2, ground - 0.25, ground + 0.5, 0.06, ground, fh, plainInfo, trim); // plinth
          ledge(walls, a, c2, roofY + PARAPET - 0.14, roofY + PARAPET, 0.09, ground, fh, plainInfo, trim); // coping
          ledge(walls, a, c2, roofY - 0.3, roofY - 0.04, 0.13, ground, fh, plainInfo, trim); // string course
          if (shades)
            for (let k = 0; k < floors; k++) {
              const y = ground + (k + head + 0.07) * fh;
              ledge(walls, a, c2, y, y + 0.1, 0.55, ground, fh, plainInfo, trim);
            }
        }
      }
    }
    // parapet: outer face, inner face and cap
    const inner = inset(ring, 0.28);
    const plain = [0, fh, 0, seed];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Pt;
      const c = ring[(i + 1) % ring.length] as Pt;
      wall(walls, a, c, roofY, roofY + PARAPET, ground, fh, plain, wc);
      const ia = inner[i] as Pt;
      const ic = inner[(i + 1) % inner.length] as Pt;
      wall(walls, ic, ia, roofY, roofY + PARAPET, ground, fh, plain, wc);
      // cap between the outer and inner edge
      const n = outward(a, c);
      const q0 = roofs.vertex(a[0], roofY + PARAPET, a[1], 0, 1, 0, 0, 0, plain, wc);
      const q1 = roofs.vertex(c[0], roofY + PARAPET, c[1], 0, 1, 0, 1, 0, plain, wc);
      const q2 = roofs.vertex(ic[0], roofY + PARAPET, ic[1], 0, 1, 0, 1, 1, plain, wc);
      const q3 = roofs.vertex(ia[0], roofY + PARAPET, ia[1], 0, 1, 0, 0, 1, plain, wc);
      void n;
      roofs.tri(q0, q1, q2);
      roofs.tri(q0, q2, q3);
    }
    // stair-head room and water tanks on flat roofs of bigger buildings
    const rect = orientedRect(ring);
    const free = (x: number, z: number): boolean => pointInRing(x, z, inner) && !b.holes.some((h) => pointInRing(x, z, h));
    if (rect && floors >= 2 && b.footprint >= 90 && !["farm", "industrial", "utility"].includes(b.type)) {
      for (let t = 0; t < 10; t++) {
        const x = rect.cx + (rnd() - 0.5) * Math.max(0, rect.length - 6);
        const z = rect.cz + (rnd() - 0.5) * Math.max(0, rect.width - 6);
        const ux = rect.ux;
        const uz = rect.uz;
        const ok = [
          [-1.6, -2.1],
          [1.6, -2.1],
          [1.6, 2.1],
          [-1.6, 2.1],
        ].every(([sx, sz]) => free(x + ux * (sx as number) - uz * (sz as number), z + uz * (sx as number) + ux * (sz as number)));
        if (ok) {
          box(walls, x, z, ux, uz, 3.2, 4.2, roofY, roofY + 2.7, wc, rc, roofs);
          break;
        }
      }
    }
    if (b.footprint >= 35 && !["farm", "industrial", "utility"].includes(b.type)) {
      const n = Math.min(4, Math.max(1, Math.round(b.footprint / 260)));
      for (let k = 0; k < n; k++) {
        for (let t = 0; t < 10; t++) {
          const bb = ring.reduce<[number, number, number, number]>(
            (m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1]), Math.max(m[2], p[0]), Math.max(m[3], p[1])],
            [Infinity, Infinity, -Infinity, -Infinity],
          );
          const x = bb[0] + 1.5 + rnd() * Math.max(0, bb[2] - bb[0] - 3);
          const z = bb[1] + 1.5 + rnd() * Math.max(0, bb[3] - bb[1] - 3);
          if (free(x, z) && free(x + 0.9, z) && free(x - 0.9, z) && free(x, z + 0.9) && free(x, z - 0.9)) {
            tanks.push([x, roofY, z]);
            break;
          }
        }
      }
    }
  }

  const group = new THREE.Group();
  group.name = "buildings";
  const facade = createFacadeMaterial(wet, env);
  const roof = createRoofMaterial(wet);
  const tankMaterial = createTankMaterial();
  const tankGeometry = new THREE.CylinderGeometry(0.65, 0.65, 1.3, 14).translate(0, 0.65, 0);
  const tankTriangles = tankGeometry.index ? tankGeometry.index.count / 3 : 0;
  const m4 = new THREE.Matrix4();
  let triangles = 0;
  for (const [key, ch] of chunks) {
    const wallMesh = new THREE.Mesh(ch.walls.geometry(), facade);
    const roofMesh = new THREE.Mesh(ch.roofs.geometry(), roof);
    wallMesh.name = "walls";
    roofMesh.name = "roofs";
    wallMesh.userData.chunk = key;
    roofMesh.userData.chunk = key;
    for (const m of [wallMesh, roofMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    triangles += ch.walls.triangles + ch.roofs.triangles;
    if (ch.tanks.length) {
      const im = new THREE.InstancedMesh(tankGeometry, tankMaterial, ch.tanks.length);
      for (const [i, t] of ch.tanks.entries()) im.setMatrixAt(i, m4.makeTranslation(t[0], t[1], t[2]));
      im.castShadow = true;
      im.receiveShadow = true;
      im.name = "tanks";
      im.computeBoundingSphere();
      group.add(im);
      triangles += tankTriangles * ch.tanks.length;
    }
  }
  return { group, materials: { facade, roof }, triangles, count };
}
