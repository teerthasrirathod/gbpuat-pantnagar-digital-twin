// Plain 2D geometry on the ground plane. x points east, z points south, so a ring with a positive signed area
// (shoelace sum of x*z' - x'*z) runs clockwise when seen from above with north at the top.
import earcut from "earcut";

export type Pt = readonly [number, number];
export type Ring = Pt[];

export function flatToRing(f: readonly number[]): Ring {
  const r: Pt[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) r.push([f[i] as number, f[i + 1] as number]);
  // drop a repeated closing point
  const a = r[0];
  const b = r[r.length - 1];
  if (r.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) r.pop();
  return r;
}

/** Signed area; positive for the winding the building code treats as "outer". */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i] as Pt;
    const q = r[(i + 1) % r.length] as Pt;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** A copy of the ring wound so that its signed area is positive. */
export function positive(r: Ring): Ring {
  return ringArea(r) < 0 ? [...r].reverse() : r;
}
/** A copy of the ring wound so that its signed area is negative (holes). */
export function negative(r: Ring): Ring {
  return ringArea(r) > 0 ? [...r].reverse() : r;
}

export function centroid(r: Ring): Pt {
  let x = 0;
  let z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}

export function bbox(r: Ring): [number, number, number, number] {
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const p of r) {
    x0 = Math.min(x0, p[0]);
    z0 = Math.min(z0, p[1]);
    x1 = Math.max(x1, p[0]);
    z1 = Math.max(z1, p[1]);
  }
  return [x0, z0, x1, z1];
}

export function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i] as Pt;
    const b = r[j] as Pt;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Outward unit normal (x, z) of the edge a -> b for a ring with positive signed area. */
export function outward(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
}

/** Moves every vertex inward by d along the bisector of its two edges (ring with positive signed area). */
export function inset(ring: Ring, d: number): Ring {
  const n = ring.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n] as Pt;
    const c = ring[i] as Pt;
    const q = ring[(i + 1) % n] as Pt;
    const n1 = outward(p, c);
    const n2 = outward(c, q);
    let mx = n1[0] + n2[0];
    let mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = Math.max(0.35, mx * n1[0] + mz * n1[1]);
    out.push([c[0] - (mx * d) / cos, c[1] - (mz * d) / cos]);
  }
  return out;
}

export interface OrientedRect {
  /** centre */
  cx: number;
  cz: number;
  /** unit vector of the long axis and its length, the short extent */
  ux: number;
  uz: number;
  length: number;
  width: number;
  area: number;
}

/** Minimum-area rectangle around a ring, with the long axis first. */
export function orientedRect(r: Ring): OrientedRect | null {
  let best: OrientedRect | null = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i] as Pt;
    const b = r[(i + 1) % r.length] as Pt;
    const l = dist(a, b);
    if (l < 0.5) continue;
    const ux = (b[0] - a[0]) / l;
    const uz = (b[1] - a[1]) / l;
    let s0 = Number.POSITIVE_INFINITY;
    let s1 = Number.NEGATIVE_INFINITY;
    let t0 = Number.POSITIVE_INFINITY;
    let t1 = Number.NEGATIVE_INFINITY;
    for (const p of r) {
      const s = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz;
      const t = -(p[0] - a[0]) * uz + (p[1] - a[1]) * ux;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) {
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      const long = s1 - s0 >= t1 - t0;
      const cx = a[0] + sc * ux - tc * uz;
      const cz = a[1] + sc * uz + tc * ux;
      best = long
        ? { cx, cz, ux, uz, length: s1 - s0, width: t1 - t0, area }
        : { cx, cz, ux: -uz, uz: ux, length: t1 - t0, width: s1 - s0, area };
    }
  }
  return best;
}

/** Triangle indices for a polygon with optional holes; coordinates come back flat in the same order as outer then holes. */
export function triangulate(outer: Ring, holes: Ring[] = []): { flat: number[]; indices: number[] } {
  const flat: number[] = [];
  const holeIdx: number[] = [];
  for (const p of outer) flat.push(p[0], p[1]);
  for (const h of holes) {
    holeIdx.push(flat.length / 2);
    for (const p of h) flat.push(p[0], p[1]);
  }
  return { flat, indices: earcut(flat, holeIdx, 2) };
}
