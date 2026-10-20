import { centroid, flatToRing, negative, positive } from "../core/geometry.ts";
import type { Building, Hero, HeroFile, Tree } from "./types.ts";

/** Checks the parts of the file the app relies on, so a bad export fails loudly and early. */
export function validateHero(f: unknown): asserts f is HeroFile {
  const o = f as Partial<HeroFile> | null;
  if (o?.version !== 1) throw new Error("hero file: unsupported version");
  if (!o.terrain || !Array.isArray(o.terrain.h) || o.terrain.h.length !== o.terrain.nx * o.terrain.nz)
    throw new Error("hero file: terrain grid is inconsistent");
  if (!Array.isArray(o.buildings) || !Array.isArray(o.trees) || o.trees.length % 3 !== 0)
    throw new Error("hero file: buildings or trees are malformed");
  if (o.window?.box.length !== 4) throw new Error("hero file: window is missing");
}

export function buildHero(file: HeroFile): Hero {
  validateHero(file);
  const { terrain: T } = file;
  const heightAt = (x: number, z: number): number => {
    const fx = Math.min(Math.max((x - T.x0) / T.step, 0), T.nx - 1.0001);
    const fz = Math.min(Math.max((z - T.z0) / T.step, 0), T.nz - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = (a: number, b: number) => T.h[(j + b) * T.nx + i + a] as number;
    const top = h(0, 0) + (h(1, 0) - h(0, 0)) * u;
    const bottom = h(0, 1) + (h(1, 1) - h(0, 1)) * u;
    return top + (bottom - top) * v;
  };
  const buildings: Building[] = [];
  for (const b of file.buildings) {
    const outerFlat = b.r[0];
    if (!outerFlat || outerFlat.length < 6) continue;
    const outer = positive(flatToRing(outerFlat));
    if (outer.length < 3) continue;
    const holes = b.r.slice(1).map((r) => negative(flatToRing(r)));
    let ground = Number.POSITIVE_INFINITY;
    for (const p of outer) ground = Math.min(ground, heightAt(p[0], p[1]));
    buildings.push({
      id: b.id,
      name: b.n,
      type: b.t,
      evidence: b.ts,
      floors: Math.max(1, b.f),
      height: b.h,
      heightSource: b.hs,
      footprint: b.a,
      roofColour: b.roof,
      outer,
      holes,
      centre: centroid(outer),
      ground,
    });
  }
  const trees: Tree[] = [];
  for (let i = 0; i < file.trees.length; i += 3) {
    const x = file.trees[i] as number;
    const z = file.trees[i + 1] as number;
    trees.push({ x, z, height: file.trees[i + 2] as number, ground: heightAt(x, z) });
  }
  const { cx, cz, size } = file.window;
  return {
    file,
    box: file.window.box,
    core: [cx - size / 2, cz - size / 2, cx + size / 2, cz + size / 2],
    heightAt,
    buildings,
    trees,
  };
}

export async function loadHero(url: string, signal?: AbortSignal): Promise<Hero> {
  const r = await fetch(url, signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`could not load ${url}: HTTP ${r.status}`);
  return buildHero((await r.json()) as HeroFile);
}
