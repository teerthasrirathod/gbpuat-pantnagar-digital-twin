import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ringArea } from "../core/geometry.ts";
import { buildHero, validateHero } from "./hero.ts";
import type { HeroFile } from "./types.ts";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/hero-1.json");
const exists = fs.existsSync(file);

describe.skipIf(!exists)("hero-1 data", () => {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as HeroFile;
  const hero = buildHero(raw);

  it("passes validation", () => {
    expect(() => validateHero(raw)).not.toThrow();
  });
  it("contains the landmark buildings of the Library avenue", () => {
    const names = hero.buildings.map((b) => b.name);
    for (const n of ["Pantnagar University Library", "Old College of Technology", "College of Technology"]) expect(names).toContain(n);
  });
  it("winds every outer ring positively and every hole negatively", () => {
    for (const b of hero.buildings) {
      expect(ringArea(b.outer)).toBeGreaterThan(0);
      for (const h of b.holes) expect(ringArea(h)).toBeLessThan(0);
    }
  });
  it("samples terrain heights inside the data range", () => {
    const [x0, z0, x1, z1] = hero.core;
    const lo = Math.min(...raw.terrain.h);
    const hi = Math.max(...raw.terrain.h);
    for (const [x, z] of [
      [x0, z0],
      [x1, z1],
      [(x0 + x1) / 2, (z0 + z1) / 2],
    ] as const) {
      const h = hero.heightAt(x, z);
      expect(h).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(h).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
  it("keeps a plausible building count for a 500 m window", () => {
    expect(hero.buildings.length).toBeGreaterThan(100);
    expect(hero.buildings.length).toBeLessThan(400);
  });
});

describe("validateHero", () => {
  it("rejects a file with an inconsistent terrain grid", () => {
    expect(() =>
      validateHero({ version: 1, terrain: { nx: 2, nz: 2, h: [1] }, buildings: [], trees: [], window: { box: [0, 0, 1, 1] } }),
    ).toThrow(/terrain/);
  });
});
