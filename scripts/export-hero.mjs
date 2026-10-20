// Cuts one hero window out of the campus data for the next-generation web app.
//
//   node scripts/export-hero.mjs [id] [centreX] [centreZ] [sizeMetres]
//   node scripts/export-hero.mjs hero-1 -400 -300 500
//
// Reads campus/data/campus-data.js (window.CAMPUS, written by `twin build`) and writes
// apps/web/public/data/<id>.json: buildings, trees, roads, mapped areas, walls and fences, places and a terrain
// height grid, all in the local frame (x east, z south, origin 29.0205 N 79.4935 E). Everything inside the window
// plus a margin is kept so that the edges of the hero area have context.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [id = "hero-1", cx0 = "-400", cz0 = "-300", size0 = "500"] = process.argv.slice(2);
const CX = Number(cx0),
  CZ = Number(cz0),
  SIZE = Number(size0),
  MARGIN = 80;
const x0 = CX - SIZE / 2 - MARGIN,
  x1 = CX + SIZE / 2 + MARGIN,
  z0 = CZ - SIZE / 2 - MARGIN,
  z1 = CZ + SIZE / 2 + MARGIN;

// Load window.CAMPUS from the generated JS file without running it in this realm.
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "campus/data/campus-data.js"), "utf8"), ctx);
const D = ctx.window.CAMPUS;
if (!D) throw new Error("campus-data.js did not define window.CAMPUS");

const inBox = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
const flatInBox = (f) => {
  for (let i = 0; i < f.length; i += 2) if (inBox(f[i], f[i + 1])) return true;
  return false;
};
const centroidOf = (f) => {
  let x = 0,
    z = 0;
  const n = f.length / 2;
  for (let i = 0; i < f.length; i += 2) {
    x += f[i];
    z += f[i + 1];
  }
  return [x / n, z / n];
};

// Terrain height, the same interpolation as the current viewer (campus/js/campus.js): the 30 m grid is averaged to 60 m
// and sampled on the triangles of each cell.
const T0 = D.terrain,
  T = { nx: Math.floor(T0.nx / 2), nz: Math.floor(T0.nz / 2), cell: T0.cell * 2, x0: T0.x0, z0: T0.z0 };
const TH = new Float32Array(T.nx * T.nz);
for (let j = 0; j < T.nz; j++)
  for (let i = 0; i < T.nx; i++) {
    const g = (a, b) => T0.h[(2 * j + b) * T0.nx + 2 * i + a] / 10;
    TH[j * T.nx + i] = (g(0, 0) + g(1, 0) + g(0, 1) + g(1, 1)) / 4;
  }
const tx0 = T.x0 + T.cell / 2,
  tz0 = T.z0 + T.cell / 2;
function H(x, z) {
  let fx = (x - tx0) / T.cell,
    fz = (z - tz0) / T.cell;
  fx = Math.min(Math.max(fx, 0), T.nx - 1.0001);
  fz = Math.min(Math.max(fz, 0), T.nz - 1.0001);
  const i = Math.floor(fx),
    j = Math.floor(fz),
    u = fx - i,
    v = fz - j;
  const a = TH[j * T.nx + i],
    b = TH[j * T.nx + i + 1],
    c = TH[(j + 1) * T.nx + i],
    d = TH[(j + 1) * T.nx + i + 1];
  return u > v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
}
// Height grid every 5 m over the window plus margin.
const STEP = 5,
  gx = Math.ceil((x1 - x0) / STEP) + 1,
  gz = Math.ceil((z1 - z0) / STEP) + 1;
const heights = [];
for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) heights.push(Math.round(H(x0 + i * STEP, z0 + j * STEP) * 100) / 100);

const round1 = (f) => f.map((v) => Math.round(v * 10) / 10);
const buildings = D.buildings
  .filter((b) => {
    const c = centroidOf(b.r[0]);
    return inBox(c[0], c[1]);
  })
  .map((b) => ({
    id: b.id,
    n: b.n || null,
    t: b.t,
    ts: b.ts,
    f: b.f,
    h: b.h,
    hs: b.hs,
    a: b.a,
    src: b.src,
    roof: b.roof,
    tag: b.tag || null,
    r: b.r.map(round1),
  }));
const trees = [];
for (let i = 0; i < D.trees.length; i += 3)
  if (inBox(D.trees[i], D.trees[i + 1])) trees.push(Math.round(D.trees[i] * 10) / 10, Math.round(D.trees[i + 1] * 10) / 10, D.trees[i + 2]);
const roads = D.roads.filter((r) => flatInBox(r.p)).map((r) => ({ c: r.c, w: r.w, n: r.n || null, s: r.s || null, p: round1(r.p) }));
const areas = D.areas.filter((a) => a.r.some(flatInBox)).map((a) => ({ k: a.k, n: a.n || null, r: a.r.map(round1) }));
const lines = D.lines.filter((l) => flatInBox(l.p)).map((l) => ({ k: l.k, w: l.w || 0, p: round1(l.p) }));
const pois = D.pois.filter((p) => inBox(p.x, p.z)).map((p) => ({ k: p.k, n: p.n, x: p.x, z: p.z }));
const water = D.water.areas.filter((a) => a.r.some(flatInBox)).map((a) => ({ src: a.src, r: a.r.map(round1) }));

const out = {
  version: 1,
  id,
  origin: D.meta.origin,
  window: { cx: CX, cz: CZ, size: SIZE, margin: MARGIN, box: [x0, z0, x1, z1] },
  terrain: { x0, z0, step: STEP, nx: gx, nz: gz, h: heights },
  buildings,
  trees,
  roads,
  areas,
  lines,
  pois,
  water,
  sources: D.meta.sources,
  notes:
    "Heights are Google Open Buildings 2.5D (about 4 m accuracy) or estimated from footprint area; many building types are guesses (ts = shape).",
};
const file = path.join(root, "apps/web/public/data", `${id}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
const ms = buildings.filter((b) => b.hs === "measured" || b.hs === "detected").length;
console.log(`${id}: window ${SIZE} m at (${CX}, ${CZ}) +${MARGIN} m margin -> ${file}`);
console.log(
  `  ${buildings.length} buildings (${ms} with a measured height, ${buildings.filter((b) => b.n).length} named), ${trees.length / 3} trees, ${roads.length} roads, ${areas.length} areas, ${lines.length} walls/fences, ${water.length} water, terrain ${gx}x${gz}`,
);
console.log(`  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
