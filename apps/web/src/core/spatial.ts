// A coarse grid over the buildings, so that "is this point inside a building, or near one?" is a few lookups, not a scan.
import type { Building } from "../data/types.ts";
import { bbox, pointInRing } from "./geometry.ts";

const CELL = 24;

interface Entry {
  b: Building;
  box: [number, number, number, number];
}

export class BuildingIndex {
  private readonly cells = new Map<string, Entry[]>();

  constructor(buildings: readonly Building[]) {
    for (const b of buildings) {
      const box = bbox(b.outer);
      const entry: Entry = { b, box };
      for (let cx = Math.floor(box[0] / CELL); cx <= Math.floor(box[2] / CELL); cx++) {
        for (let cz = Math.floor(box[1] / CELL); cz <= Math.floor(box[3] / CELL); cz++) {
          const key = `${cx},${cz}`;
          const list = this.cells.get(key);
          if (list) list.push(entry);
          else this.cells.set(key, [entry]);
        }
      }
    }
  }

  /** The building the point is inside, or failing that the nearest wall within `margin` metres. */
  find(x: number, z: number, margin = 0.8): Building | null {
    const list = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return null;
    let best: Building | null = null;
    let bestD = margin;
    for (const { b, box } of list) {
      if (x < box[0] - margin || x > box[2] + margin || z < box[1] - margin || z > box[3] + margin) continue;
      if (pointInRing(x, z, b.outer) && !b.holes.some((h) => pointInRing(x, z, h))) return b;
      for (const ring of [b.outer, ...b.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i] as [number, number];
          const c = ring[(i + 1) % ring.length] as [number, number];
          const d = distanceToSegment(x, z, a[0], a[1], c[0], c[1]);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
      }
    }
    return best;
  }

  /** Is the point inside a building footprint (courtyards are open ground), or within `margin` metres of one? */
  blocked(x: number, z: number, margin = 0): boolean {
    const list = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return false;
    for (const { b, box } of list) {
      if (x < box[0] - margin || x > box[2] + margin || z < box[1] - margin || z > box[3] + margin) continue;
      if (margin === 0) {
        if (pointInRing(x, z, b.outer) && !b.holes.some((h) => pointInRing(x, z, h))) return true;
        continue;
      }
      // with a margin, test the four points around it as well: good enough for placing props clear of walls
      for (const [dx, dz] of [
        [0, 0],
        [margin, 0],
        [-margin, 0],
        [0, margin],
        [0, -margin],
      ] as const) {
        if (pointInRing(x + dx, z + dz, b.outer) && !b.holes.some((h) => pointInRing(x + dx, z + dz, h))) return true;
      }
    }
    return false;
  }
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** The building a point is inside of, or the nearest one within `margin` metres of a wall (null if none). */
export function findBuilding(index: BuildingIndex, x: number, z: number, margin = 0.8): Building | null {
  return index.find(x, z, margin);
}

/** Points along a polyline at a fixed spacing, each with the direction of travel there. */
export function sampleAlong(
  flat: readonly number[],
  spacing: number,
  start = 0,
): { x: number; z: number; dx: number; dz: number; d: number }[] {
  const out: { x: number; z: number; dx: number; dz: number; d: number }[] = [];
  let carried = start;
  let travelled = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const x0 = flat[i] as number;
    const z0 = flat[i + 1] as number;
    const x1 = flat[i + 2] as number;
    const z1 = flat[i + 3] as number;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    while (carried <= len) {
      out.push({ x: x0 + dx * carried, z: z0 + dz * carried, dx, dz, d: travelled + carried });
      carried += spacing;
    }
    carried -= len;
    travelled += len;
  }
  return out;
}

export function polylineLength(flat: readonly number[]): number {
  let total = 0;
  for (let i = 0; i + 3 < flat.length; i += 2)
    total += Math.hypot((flat[i + 2] as number) - (flat[i] as number), (flat[i + 3] as number) - (flat[i + 1] as number));
  return total;
}

/** The point and direction at distance `d` along a polyline (clamped to its ends). */
export function pointAt(flat: readonly number[], d: number): { x: number; z: number; dx: number; dz: number } {
  let left = Math.max(0, d);
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const x0 = flat[i] as number;
    const z0 = flat[i + 1] as number;
    const x1 = flat[i + 2] as number;
    const z1 = flat[i + 3] as number;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    if (left <= len || i + 4 >= flat.length) {
      const t = Math.min(1, left / len);
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / len, dz: (z1 - z0) / len };
    }
    left -= len;
  }
  return { x: flat[0] as number, z: flat[1] as number, dx: 1, dz: 0 };
}
