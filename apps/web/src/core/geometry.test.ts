import { describe, expect, it } from "vitest";
import { bbox, centroid, flatToRing, inset, orientedRect, outward, pointInRing, positive, ringArea, triangulate } from "./geometry.ts";

const square = flatToRing([0, 0, 10, 0, 10, 10, 0, 10]);

describe("rings", () => {
  it("drops a repeated closing point", () => {
    expect(flatToRing([0, 0, 1, 0, 1, 1, 0, 0])).toHaveLength(3);
  });
  it("has a positive area for the building winding and flips on request", () => {
    expect(ringArea(square)).toBe(100);
    expect(ringArea([...square].reverse())).toBe(-100);
    expect(ringArea(positive([...square].reverse()))).toBe(100);
  });
  it("finds centroid, bounds and containment", () => {
    expect(centroid(square)).toEqual([5, 5]);
    expect(bbox(square)).toEqual([0, 0, 10, 10]);
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(11, 5, square)).toBe(false);
  });
});

describe("normals", () => {
  it("points away from the inside for every edge of a positive ring", () => {
    const c = centroid(square);
    for (let i = 0; i < square.length; i++) {
      const a = square[i] as readonly [number, number];
      const b = square[(i + 1) % square.length] as readonly [number, number];
      const n = outward(a, b);
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const away = (mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1];
      expect(away).toBeGreaterThan(0);
    }
  });
});

describe("inset", () => {
  it("shrinks a square by the distance on every side", () => {
    const r = inset(square, 1);
    const [x0, z0, x1, z1] = bbox(r);
    expect(x0).toBeCloseTo(1, 5);
    expect(z0).toBeCloseTo(1, 5);
    expect(x1).toBeCloseTo(9, 5);
    expect(z1).toBeCloseTo(9, 5);
  });
});

describe("oriented rectangle", () => {
  it("measures a rotated 20 x 8 rectangle", () => {
    const a = Math.PI / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts: [number, number][] = [
      [-10, -4],
      [10, -4],
      [10, 4],
      [-10, 4],
    ];
    const ring = pts.map(([x, z]): [number, number] => [x * c - z * s + 50, x * s + z * c + 30]);
    const r = orientedRect(ring);
    expect(r).not.toBeNull();
    expect(r?.length).toBeCloseTo(20, 4);
    expect(r?.width).toBeCloseTo(8, 4);
    expect(r?.cx).toBeCloseTo(50, 4);
    expect(r?.cz).toBeCloseTo(30, 4);
  });
});

describe("triangulate", () => {
  it("covers the area of a square with a square hole", () => {
    const hole = flatToRing([3, 3, 3, 7, 7, 7, 7, 3]);
    const { flat, indices } = triangulate(square, [hole]);
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i] as number, indices[i + 1] as number, indices[i + 2] as number];
      const ax = flat[a * 2] as number;
      const az = flat[a * 2 + 1] as number;
      const bx = flat[b * 2] as number;
      const bz = flat[b * 2 + 1] as number;
      const cx = flat[c * 2] as number;
      const cz = flat[c * 2 + 1] as number;
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    expect(area).toBeCloseTo(100 - 16, 6);
  });
});
