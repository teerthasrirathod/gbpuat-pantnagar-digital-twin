// Build a compact, render-ready dataset for the GBPUAT (Pantnagar) digital twin
// from raw OpenStreetMap extracts saved by fetch_osm.mjs.
//
// Output: data/campus-data.js  ->  window.CAMPUS_DATA = {...}
// Coordinates are local metres: x = east, z = south (Three.js ground plane, y = up).
// Everything is clipped to the study region (REGION below), so the model has hard edges.
//
// Usage:  node tools/build_data.mjs

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { REGION, ORIGIN, proj, RECT, GRID } from "./geo.mjs";
import { encodePNG } from "./lib/png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_FILE = path.join(ROOT, "data", "campus-data.js");

// ---------- load + de-duplicate raw elements -------------------------------
const elements = new Map(); // "way/123" -> element
for (const f of fs.readdirSync(RAW_DIR)) {
  if (!f.startsWith("t_") || !f.endsWith(".json")) continue; // t_*.json = OSM tiles; elevation.json is separate
  const j = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), "utf8"));
  for (const e of j.elements) {
    const key = `${e.type}/${e.id}`;
    if (!elements.has(key)) elements.set(key, e);
  }
}
console.log("unique OSM elements:", elements.size);

// ---------- helpers ---------------------------------------------------------
const tagsOf = (e) => e.tags || {};
const named = (e) => tagsOf(e).name || tagsOf(e)["name:en"] || "";
const coordKey = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
const round1 = (v) => Math.round(v * 10) / 10;

function parseMeters(v) {
  if (v == null) return NaN;
  const m = String(v).replace(",", ".").match(/[\d.]+/);
  if (!m) return NaN;
  const n = parseFloat(m[0]);
  return /ft|feet|'/.test(String(v)) ? n * 0.3048 : n;
}

// Estimated building height in metres.
function buildingHeight(t) {
  const h = parseMeters(t.height);
  if (h > 0) return Math.min(h, 120);
  const lv = parseFloat(t["building:levels"]);
  if (lv > 0) return Math.min(lv * 3.3 + 0.6, 120);
  switch (t.building) {
    case "university":
    case "college":
    case "hospital":
    case "hostel":
    case "dormitory":
    case "school":
    case "public":
    case "government":
      return 11;
    case "retail":
    case "commercial":
    case "industrial":
    case "warehouse":
    case "office":
      return 8;
    case "church":
    case "temple":
    case "mosque":
      return 10;
    case "roof":
    case "shed":
    case "garage":
    case "garages":
    case "carport":
    case "farm_auxiliary":
    case "barn":
    case "stable":
    case "hut":
    case "cabin":
      return 3.5;
    default:
      return 5.5; // typical single/double storey house in the Tarai
  }
}

const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 11, secondary: 9, tertiary: 8,
  unclassified: 6, residential: 6, living_street: 5, road: 5,
  service: 4, pedestrian: 4, track: 3, path: 1.6, footway: 1.6,
  cycleway: 1.6, steps: 1.4, bridleway: 1.6,
};
const WATER_WIDTH = { river: 18, canal: 8, stream: 3, drain: 2.5, ditch: 1.2 };

// Ground-area classes: each gets a colour in the viewer.
function areaKind(t) {
  if (t.natural === "water" || t.water) return "water";
  if (t.waterway === "riverbank" || t.waterway === "dock") return "water";
  if (t.landuse === "grass" || t.landuse === "meadow" || t.landuse === "village_green" ||
      t.landuse === "greenfield" || t.landuse === "recreation_ground" || t.leisure === "park" ||
      t.leisure === "garden" || t.leisure === "playground") return "grass";
  if (t.landuse === "forest" || t.natural === "wood") return "forest";
  if (t.natural === "scrub" || t.natural === "heath" || t.natural === "grassland") return "scrub";
  if (t.landuse === "farmland" || t.landuse === "farmyard" || t.landuse === "orchard" ||
      t.landuse === "vineyard" || t.landuse === "plant_nursery" || t.landuse === "allotments") return "farm";
  if (t.leisure === "pitch" || t.leisure === "stadium" || t.leisure === "track" ||
      t.leisure === "golf_course") return "sport";
  if (t.landuse === "residential") return "residential";
  if (t.landuse === "industrial" || t.landuse === "commercial" || t.landuse === "retail") return "commercial";
  if (t.landuse === "cemetery" || t.landuse === "grave_yard") return "cemetery";
  if (t.aeroway === "aerodrome" || t.aeroway === "runway" || t.aeroway === "apron" ||
      t.aeroway === "taxiway" || t.amenity === "parking" || t.highway === "pedestrian_area") return "paved";
  if (t.amenity === "university" || t.amenity === "college" || t.amenity === "school" ||
      t.landuse === "education") return "campus";
  if (t.landuse) return "other";
  return null;
}

// Stitch member-way segments (lat/lon objects) of a multipolygon into closed rings.
function stitchRings(segments) {
  const rings = [];
  const remaining = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  while (remaining.length) {
    let ring = remaining.shift();
    let grew = true;
    while (grew) {
      if (ring.length >= 4 && coordKey(ring[0]) === coordKey(ring[ring.length - 1])) break;
      grew = false;
      const first = ring[0];
      const last = ring[ring.length - 1];
      for (let i = 0; i < remaining.length; i++) {
        const s = remaining[i];
        const sf = s[0];
        const sl = s[s.length - 1];
        if (coordKey(last) === coordKey(sf)) ring = ring.concat(s.slice(1));
        else if (coordKey(last) === coordKey(sl)) ring = ring.concat(s.slice(0, -1).reverse());
        else if (coordKey(first) === coordKey(sl)) ring = s.slice(0, -1).concat(ring);
        else if (coordKey(first) === coordKey(sf)) ring = s.slice().reverse().concat(ring.slice(1));
        else continue;
        remaining.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && coordKey(ring[0]) === coordKey(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Clip a polygon ring ([x,z] pairs) to RECT with Sutherland-Hodgman. Returns null if empty.
function clipRing(ring) {
  const clipEdge = (pts, inside, cut) => {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) res.push(cut(prev, cur));
        res.push(cur);
      } else if (pi) {
        res.push(cut(prev, cur));
      }
    }
    return res;
  };
  let pts = ring;
  pts = clipEdge(pts, (p) => p[0] >= RECT.x0, (a, b) => { const t = (RECT.x0 - a[0]) / (b[0] - a[0]); return [RECT.x0, a[1] + t * (b[1] - a[1])]; });
  if (pts.length) pts = clipEdge(pts, (p) => p[0] <= RECT.x1, (a, b) => { const t = (RECT.x1 - a[0]) / (b[0] - a[0]); return [RECT.x1, a[1] + t * (b[1] - a[1])]; });
  if (pts.length) pts = clipEdge(pts, (p) => p[1] >= RECT.z0, (a, b) => { const t = (RECT.z0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), RECT.z0]; });
  if (pts.length) pts = clipEdge(pts, (p) => p[1] <= RECT.z1, (a, b) => { const t = (RECT.z1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), RECT.z1]; });
  return pts.length >= 3 ? pts : null;
}

// Liang-Barsky clip of segment a-b to RECT. Returns [p, q] or null.
function clipSegment(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const p = [-dx, dx, -dz, dz];
  const q = [a[0] - RECT.x0, RECT.x1 - a[0], a[1] - RECT.z0, RECT.z1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dz], [a[0] + t1 * dx, a[1] + t1 * dz]];
}

// Clip a polyline to RECT. Returns an array of polylines (each an array of [x,z]).
function clipPolyline(pts) {
  const out = [];
  let chain = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const s = clipSegment(pts[i], pts[i + 1]);
    if (!s) { if (chain && chain.length >= 2) out.push(chain); chain = null; continue; }
    const [p, q] = s;
    if (!chain) chain = [p];
    else if (Math.hypot(chain[chain.length - 1][0] - p[0], chain[chain.length - 1][1] - p[1]) > 0.01) {
      if (chain.length >= 2) out.push(chain);
      chain = [p];
    }
    chain.push(q);
  }
  if (chain && chain.length >= 2) out.push(chain);
  return out;
}

const flat = (pts) => pts.flatMap((p) => [round1(p[0]), round1(p[1])]);
const centroid = (pts) => {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [round1(x / pts.length), round1(z / pts.length)];
};
const inRect = (x, z) => x >= RECT.x0 && x <= RECT.x1 && z >= RECT.z0 && z <= RECT.z1;

// ---------- classify --------------------------------------------------------
const out = {
  buildings: [], // {id, n, t, h, r:[flat ring, ...]} first ring = outer, rest = holes
  areas: [],     // {k, n, r:[flat ring, ...]}
  roads: [],     // {c, w, p: flat polyline}
  lines: [],     // {k, w, p: flat polyline}  waterways, railways, power lines
  points: [],    // {n, k, x, z}
  labels: [],    // {n, k, x, z}
};
const stats = { buildings: 0, areas: 0, roads: 0, lines: 0, points: 0, skipped: 0, clippedOut: 0 };

// rings: array of [x,z][]; rings[0] is the outer ring. Returns the clipped rings or null.
function clipRings(rings) {
  const outer = clipRing(rings[0]);
  if (!outer) return null;
  const holes = rings.slice(1).map(clipRing).filter(Boolean);
  return [outer, ...holes];
}

function pushPolygon(e, rings, isBuilding) {
  const t = tagsOf(e);
  const n = named(e);
  const clipped = clipRings(rings);
  if (!clipped) { stats.clippedOut++; return; }
  const [outer] = clipped;
  const c = centroid(outer);
  if (isBuilding) {
    const h = buildingHeight(t);
    const tagged = parseMeters(t.height) > 0 || parseFloat(t["building:levels"]) > 0;
    out.buildings.push({ id: e.id, n, t: t.building, h: round1(h), tagged, r: clipped.map(flat) });
    stats.buildings++;
    if (n) out.labels.push({ n, k: "bld", x: c[0], z: c[1] });
    return;
  }
  const k = areaKind(t);
  if (!k) return;
  out.areas.push({ k, n, r: clipped.map(flat) });
  stats.areas++;
  if (n && ["campus", "sport", "grass", "farm", "water"].includes(k)) {
    out.labels.push({ n, k, x: c[0], z: c[1] });
  }
}

function pushLine(t, pts, kindInfo) {
  for (const seg of clipPolyline(pts)) {
    if (!seg.some((p) => inRect(p[0], p[1]))) continue;
    if (kindInfo.kind === "road") out.roads.push({ c: t.highway, w: round1(kindInfo.w), p: flat(seg) });
    else out.lines.push({ k: kindInfo.kind, w: round1(kindInfo.w), p: flat(seg) });
    if (kindInfo.kind === "road") stats.roads++; else stats.lines++;
  }
}

for (const e of elements.values()) {
  const t = tagsOf(e);

  if (e.type === "node") {
    const name = named(e);
    if (!name) continue;
    if (!(t.amenity || t.tourism || t.shop || t.office || t.man_made)) continue;
    const [x, z] = proj(e.lat, e.lon);
    if (!inRect(x, z)) continue;
    const k = t.amenity || t.tourism || t.shop || t.office || t.man_made;
    out.points.push({ n: name, k, x: round1(x), z: round1(z) });
    stats.points++;
    if (["university", "college", "hospital", "school", "library", "police", "bank", "community_centre"].includes(t.amenity)) {
      out.labels.push({ n: name, k: "poi", x: round1(x), z: round1(z) });
    }
    continue;
  }

  if (e.type === "way") {
    if (!e.geometry || e.geometry.length < 2) { stats.skipped++; continue; }
    const pts = e.geometry.map((p) => proj(p.lat, p.lon));
    const closed = coordKey(e.geometry[0]) === coordKey(e.geometry[e.geometry.length - 1]) && pts.length >= 4;

    if (t.building && t.building !== "no" && closed) {
      pushPolygon(e, [pts], true);
      continue;
    }
    if (t.highway) {
      const w = parseMeters(t.width) || ROAD_WIDTH[t.highway] || 4;
      pushLine(t, pts, { kind: "road", w });
      continue;
    }
    if (t.waterway && !closed) {
      const w = parseMeters(t.width) || WATER_WIDTH[t.waterway] || 3;
      pushLine(t, pts, { kind: "waterway:" + t.waterway, w });
      continue;
    }
    if (t.railway && ["rail", "light_rail", "tram", "narrow_gauge"].includes(t.railway) && !closed) {
      pushLine(t, pts, { kind: "rail", w: 3.2 });
      continue;
    }
    if (t.power === "line" || t.power === "minor_line") {
      pushLine(t, pts, { kind: "power", w: 0.25 });
      continue;
    }
    if (closed && areaKind(t)) {
      pushPolygon(e, [pts], false);
      continue;
    }
    stats.skipped++;
    continue;
  }

  if (e.type === "relation") {
    if (!e.members) { stats.skipped++; continue; }
    if (!(t.type === "multipolygon" || t.type === "boundary")) { stats.skipped++; continue; }
    // Stitch in lat/lon (shared nodes compare exactly), then project the closed rings.
    const outerSegs = [];
    const innerSegs = [];
    for (const m of e.members) {
      if (m.type !== "way" || !m.geometry || m.geometry.length < 2) continue;
      if (m.role === "inner") innerSegs.push(m.geometry);
      else if (m.role === "outer" || m.role === "") outerSegs.push(m.geometry);
    }
    const project = (ring) => ring.map((p) => proj(p.lat, p.lon));
    const outers = stitchRings(outerSegs).map(project);
    const inners = stitchRings(innerSegs).map(project);
    if (!outers.length) { stats.skipped++; continue; }

    // Assign each hole to the outer ring that contains it; each outer starts a feature.
    const groups = outers.map((o) => [o]);
    for (const hole of inners) {
      for (let i = 0; i < outers.length; i++) {
        if (pointInRing(hole[0], outers[i])) { groups[i].push(hole); break; }
      }
    }
    for (const g of groups) pushPolygon(e, g, !!(t.building && t.building !== "no"));
  }
}

// ---------- shared helpers for the extra layers ----------------------------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const toRing = (flatArr) => { const r = []; for (let i = 0; i < flatArr.length; i += 2) r.push([flatArr[i], flatArr[i + 1]]); return r; };
const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]; a += x1 * z2 - x2 * z1; }
  return Math.abs(a) / 2;
};
const bboxOf = (r) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
};

// Uniform-grid index of polygon rings, for fast "is this point/footprint inside a building?" tests.
class RingIndex {
  constructor(cell = 100) { this.cell = cell; this.cells = new Map(); this.rings = []; }
  add(ring) {
    const id = this.rings.length;
    const bb = bboxOf(ring);
    this.rings.push({ ring, bb });
    for (let cx = Math.floor(bb[0] / this.cell); cx <= Math.floor(bb[2] / this.cell); cx++)
      for (let cz = Math.floor(bb[1] / this.cell); cz <= Math.floor(bb[3] / this.cell); cz++) {
        const k = cx + "," + cz;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(id);
      }
  }
  candidates(bb) {
    const seen = new Set();
    for (let cx = Math.floor(bb[0] / this.cell); cx <= Math.floor(bb[2] / this.cell); cx++)
      for (let cz = Math.floor(bb[1] / this.cell); cz <= Math.floor(bb[3] / this.cell); cz++)
        for (const id of this.cells.get(cx + "," + cz) || []) seen.add(id);
    return [...seen].map((id) => this.rings[id]);
  }
  containsPoint(x, z) {
    for (const c of this.candidates([x, z, x, z])) {
      if (x >= c.bb[0] && x <= c.bb[2] && z >= c.bb[1] && z <= c.bb[3] && pointInRing([x, z], c.ring)) return true;
    }
    return false;
  }
  // True if `ring` overlaps any indexed ring (vertex / centroid containment either way).
  overlaps(ring) {
    const bb = bboxOf(ring);
    const cen = centroid(ring);
    for (const c of this.candidates(bb)) {
      if (c.bb[2] < bb[0] || c.bb[0] > bb[2] || c.bb[3] < bb[1] || c.bb[1] > bb[3]) continue;
      if (pointInRing(cen, c.ring) || pointInRing(centroid(c.ring), ring)) return true;
      if (ring.some((p) => pointInRing(p, c.ring)) || c.ring.some((p) => pointInRing(p, ring))) return true;
    }
    return false;
  }
}

// ---------- measured building heights (Google Open Buildings 2.5D) --------
// 4 m raster of height above ground; a footprint's height is the 75th percentile of the
// building pixels whose centres fall inside it (the centroid pixel for very small footprints).
let HT = null;
const htPath = path.join(RAW_DIR, "building_heights.json");
if (fs.existsSync(htPath)) {
  const j = JSON.parse(fs.readFileSync(htPath, "utf8"));
  HT = { w: j.width, h: j.height, data: zlib.inflateSync(Buffer.from(j.data, "base64")), source: j.source };
}
const heightStats = { osmMeasured: 0, osmTagged: 0, osmGuessed: 0, mlMeasured: 0, mlGuessed: 0 };
function measuredHeight(ring) {
  if (!HT) return null;
  const W = RECT.x1 - RECT.x0, D = RECT.z1 - RECT.z0;
  const [x0, z0, x1, z1] = bboxOf(ring);
  const i0 = Math.max(0, Math.floor(((x0 - RECT.x0) / W) * HT.w)), i1 = Math.min(HT.w - 1, Math.floor(((x1 - RECT.x0) / W) * HT.w));
  const j0 = Math.max(0, Math.floor(((z0 - RECT.z0) / D) * HT.h)), j1 = Math.min(HT.h - 1, Math.floor(((z1 - RECT.z0) / D) * HT.h));
  const vals = [];
  for (let j = j0; j <= j1; j++) {
    const cz = RECT.z0 + ((j + 0.5) / HT.h) * D;
    for (let i = i0; i <= i1; i++) {
      const v = HT.data[j * HT.w + i];
      if (v && pointInRing([RECT.x0 + ((i + 0.5) / HT.w) * W, cz], ring)) vals.push(v / 2);
    }
  }
  if (!vals.length) {
    const [cx, cz] = centroid(ring);
    const i = Math.floor(((cx - RECT.x0) / W) * HT.w), j = Math.floor(((cz - RECT.z0) / D) * HT.h);
    const v = i >= 0 && i < HT.w && j >= 0 && j < HT.h ? HT.data[j * HT.w + i] : 0;
    return v ? v / 2 : null;
  }
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.75))];
}
const clampH = (h) => Math.min(60, Math.max(2.5, h));

// Same product for 2016: a building that is clearly present in 2023 but not in 2016 is flagged
// "new since 2016" (indicative only: the 2016 layer is less complete than 2023).
let HT16 = null;
const ht16Path = path.join(RAW_DIR, "building_heights_2016.json");
if (fs.existsSync(ht16Path)) {
  const j = JSON.parse(fs.readFileSync(ht16Path, "utf8"));
  HT16 = { w: j.width, h: j.height, data: zlib.inflateSync(Buffer.from(j.data, "base64")) };
}
// Share of the raster pixels inside a footprint that show a building (null if no pixel centre falls inside).
function presence(R4, ring) {
  if (!R4) return null;
  const W = RECT.x1 - RECT.x0, D = RECT.z1 - RECT.z0;
  const [x0, z0, x1, z1] = bboxOf(ring);
  const i0 = Math.max(0, Math.floor(((x0 - RECT.x0) / W) * R4.w)), i1 = Math.min(R4.w - 1, Math.floor(((x1 - RECT.x0) / W) * R4.w));
  const j0 = Math.max(0, Math.floor(((z0 - RECT.z0) / D) * R4.h)), j1 = Math.min(R4.h - 1, Math.floor(((z1 - RECT.z0) / D) * R4.h));
  let n = 0, nz = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      if (pointInRing([RECT.x0 + ((i + 0.5) / R4.w) * W, RECT.z0 + ((j + 0.5) / R4.h) * D], ring)) {
        n++;
        if (R4.data[j * R4.w + i]) nz++;
      }
  return n ? nz / n : null;
}
const newStats = { newSince2016: 0, checked: 0 };
function isNewSince2016(ring) {
  const p23 = presence(HT, ring), p16 = presence(HT16, ring);
  if (p23 == null || p16 == null) return false;
  newStats.checked++;
  const isNew = p23 >= 0.4 && p16 < 0.15;
  if (isNew) newStats.newSince2016++;
  return isNew;
}

// Drop near-duplicate and nearly collinear vertices (keeps shapes, shrinks the data).
function simplifyRing(ring, tol = 0.35) {
  let pts = ring.slice();
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1e-9;
      const dist = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / len;
      if (dist < tol || Math.hypot(b[0] - a[0], b[1] - a[1]) < tol) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}

// ---------- roof colours sampled from the Sentinel-2 image ------------------
// Mean colour of the 10 m pixels inside a footprint. Samples dominated by vegetation (crowns
// overhanging small roofs) are rejected, so those buildings keep their default roof colour.
let SAT = null;
const satRawPath = path.join(RAW_DIR, "satellite_10m.json");
if (fs.existsSync(satRawPath)) {
  const j = JSON.parse(fs.readFileSync(satRawPath, "utf8"));
  SAT = { w: j.width, h: j.height, data: zlib.inflateSync(Buffer.from(j.data, "base64")) };
}
const roofStats = { sampled: 0, rejectedGreen: 0 };
function roofColour(ring) {
  if (!SAT) return 0;
  const W = RECT.x1 - RECT.x0, D = RECT.z1 - RECT.z0;
  const [x0, z0, x1, z1] = bboxOf(ring);
  const i0 = Math.max(0, Math.floor(((x0 - RECT.x0) / W) * SAT.w)), i1 = Math.min(SAT.w - 1, Math.floor(((x1 - RECT.x0) / W) * SAT.w));
  const j0 = Math.max(0, Math.floor(((z0 - RECT.z0) / D) * SAT.h)), j1 = Math.min(SAT.h - 1, Math.floor(((z1 - RECT.z0) / D) * SAT.h));
  let r = 0, g = 0, b = 0, n = 0;
  const add = (i, j) => { const k = (j * SAT.w + i) * 3; r += SAT.data[k]; g += SAT.data[k + 1]; b += SAT.data[k + 2]; n++; };
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      if (pointInRing([RECT.x0 + ((i + 0.5) / SAT.w) * W, RECT.z0 + ((j + 0.5) / SAT.h) * D], ring)) add(i, j);
  if (!n) {
    const [cx, cz] = centroid(ring);
    const i = Math.floor(((cx - RECT.x0) / W) * SAT.w), j = Math.floor(((cz - RECT.z0) / D) * SAT.h);
    if (i < 0 || i >= SAT.w || j < 0 || j >= SAT.h) return 0;
    add(i, j);
  }
  r /= n; g /= n; b /= n;
  if (g > r * 1.04 && g > b * 1.04) { roofStats.rejectedGreen++; return 0; }
  roofStats.sampled++;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
for (const b of out.buildings) {
  if (b.tagged) { heightStats.osmTagged++; b.ht = 1; continue; }
  const m = measuredHeight(toRing(b.r[0]));
  if (m) { b.h = round1(clampH(m)); b.hm = 1; heightStats.osmMeasured++; } else heightStats.osmGuessed++;
}
for (const b of out.buildings) if (isNewSince2016(toRing(b.r[0]))) b.nw = 1;
for (const b of out.buildings) {
  delete b.tagged;
  const rc = roofColour(toRing(b.r[0]));
  if (rc) b.rc = rc;
}

const osmIndex = new RingIndex();
for (const b of out.buildings) osmIndex.add(toRing(b.r[0]));

// ---------- Overture ML building footprints (fill gaps in OSM) --------------
// Overture merges OSM, Microsoft ML, Google Open Buildings and Esri; OSM-sourced features are
// skipped (we use fresh OSM directly) and ML footprints that overlap an OSM building are dropped.
// Each entry: [source (0 Microsoft, 1 Google, 2 other), flags (1 = measured height, 2 = new since 2016),
//              height m, roof colour (0 = none), x1, z1, x2, z2, ...]  footprint ring, local metres
out.mlBld = [];
const mlStats = { total: 0, fromOsm: 0, overlapOsm: 0, tooSmall: 0, kept: 0, withHeight: 0, release: null, bySource: {} };
const mlIndex = new RingIndex();
const ovPath = path.join(RAW_DIR, "overture_buildings.json");
if (fs.existsSync(ovPath)) {
  const ov = JSON.parse(fs.readFileSync(ovPath, "utf8"));
  mlStats.release = ov.release;
  const SRC = (s) => (/microsoft/i.test(s) ? "ms" : /google/i.test(s) ? "go" : /esri/i.test(s) ? "es" : "ot");
  for (const b of ov.buildings) {
    mlStats.total++;
    if (/openstreetmap/i.test(b.source || "")) { mlStats.fromOsm++; continue; }
    const g = b.geom;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map((ring) => ring.map(([lon, lat]) => proj(lat, lon)));
      const clipped = clipRings(rings);
      if (!clipped) continue;
      const area = ringArea(clipped[0]);
      if (area < 12) { mlStats.tooSmall++; continue; }
      if (osmIndex.overlaps(clipped[0]) || mlIndex.overlaps(clipped[0])) { mlStats.overlapOsm++; continue; }
      let h = Number(b.height) > 0 ? Number(b.height) : Number(b.floors) > 0 ? Number(b.floors) * 3.3 + 0.6 : 0;
      if (h > 0) mlStats.withHeight++;
      const m = h > 0 ? null : measuredHeight(clipped[0]);
      let flags = 0;
      if (m) { h = clampH(m); heightStats.mlMeasured++; flags |= 1; }
      else if (!(h > 0)) { h = area < 40 ? 3.2 : area < 150 ? 4.5 : area < 500 ? 6 : 9; heightStats.mlGuessed++; } // size-based guess
      const s = SRC(b.source || "");
      mlStats.bySource[s] = (mlStats.bySource[s] || 0) + 1;
      if (isNewSince2016(clipped[0])) flags |= 2;
      const ring = simplifyRing(clipped[0]);
      if (ring.length < 3) continue;
      out.mlBld.push([s === "ms" ? 0 : s === "go" ? 1 : 2, flags, round1(Math.min(h, 60)), roofColour(clipped[0]), ...flat(ring)]);
      mlIndex.add(clipped[0]);
      mlStats.kept++;
    }
  }
  console.log("ML buildings:", mlStats);
} else {
  console.log("no overture_buildings.json: skipping ML footprints");
}

console.log("roof colours:", roofStats);
console.log("new since 2016:", newStats, HT16 ? "" : "(no building_heights_2016.json)");
console.log("building heights:", heightStats, HT ? "" : "(no building_heights.json: heights are estimated)");

// ---------- campus core (mean of named university buildings) ----------------
const coreLabels = out.labels.filter((l) => l.k === "bld" && /Bhawan|Hostel|College|Library|Office|University|Hall|Centre|Center/i.test(l.n));
const CORE = coreLabels.length
  ? { x: coreLabels.reduce((s, l) => s + l.x, 0) / coreLabels.length, z: coreLabels.reduce((s, l) => s + l.z, 0) / coreLabels.length }
  : { x: 0, z: 0 };

// ---------- trees from canopy height ----------------------------------------
// Local maxima of the 1.2 m canopy-height model, with heights. Dense near the campus core,
// thinned elsewhere, and never inside building footprints.
out.trees = []; // flat [x, z, h, x, z, h, ...]
const treeStats = { detected: 0, kept: 0, core: 0, outer: 0 };
const canopyPath = path.join(RAW_DIR, "canopy.json");
if (fs.existsSync(canopyPath)) {
  const c = JSON.parse(fs.readFileSync(canopyPath, "utf8"));
  // The viewer draws trees with two levels of detail, so the campus core can keep every crown.
  const CORE_RADIUS = 2200, BUDGET_CORE = 12000, BUDGET_OUTER = 9000;
  const rng = mulberry32(20261014);
  const core = [], outer = [];
  for (const [lon, lat, h] of c.trees) {
    treeStats.detected++;
    const [x, z] = proj(lat, lon);
    if (!inRect(x, z)) continue;
    if (osmIndex.containsPoint(x, z) || mlIndex.containsPoint(x, z)) continue;
    (Math.hypot(x - CORE.x, z - CORE.z) <= CORE_RADIUS ? core : outer).push([x, z, h]);
  }
  const take = (arr, n) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr.slice(0, n);
  };
  const keep = [...take(core, BUDGET_CORE), ...take(outer, BUDGET_OUTER)];
  treeStats.core = Math.min(core.length, BUDGET_CORE);
  treeStats.outer = Math.min(outer.length, BUDGET_OUTER);
  for (const [x, z, h] of keep) out.trees.push(round1(x), round1(z), round1(h));
  treeStats.kept = keep.length;
  treeStats.coreAvailable = core.length;
  treeStats.outerAvailable = outer.length;
  console.log("trees:", treeStats);
} else {
  console.log("no canopy.json: viewer falls back to procedural trees");
}

// ---------- Overture places (points of interest) ---------------------------
// Added to the OSM points unless OSM already has the same name within 150 m.
const placeStats = { total: 0, added: 0, duplicateOfOsm: 0, outside: 0 };
const pvPath = path.join(RAW_DIR, "overture_places.json");
const LABEL_CATS = new Set(["college_university", "hostel", "hospital", "library", "stadium_arena", "post_office", "police_station", "bank", "museum"]);
if (fs.existsSync(pvPath)) {
  const pv = JSON.parse(fs.readFileSync(pvPath, "utf8"));
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const existing = [...out.points, ...out.labels].map((p) => ({ n: norm(p.n), x: p.x, z: p.z }));
  for (const p of pv.places) {
    placeStats.total++;
    const [x, z] = proj(p.lat, p.lon);
    if (!inRect(x, z)) { placeStats.outside++; continue; }
    const n = norm(p.name);
    if (existing.some((e) => Math.hypot(e.x - x, e.z - z) < 150 && (e.n === n || e.n.includes(n) || n.includes(e.n)))) {
      placeStats.duplicateOfOsm++;
      continue;
    }
    const cat = p.category || "place";
    out.points.push({ n: p.name, k: cat, x: round1(x), z: round1(z), src: "ov", ...(p.website ? { w: p.website } : {}) });
    if (LABEL_CATS.has(cat)) out.labels.push({ n: p.name, k: "poi", x: round1(x), z: round1(z) });
    existing.push({ n, x, z });
    placeStats.added++;
  }
  console.log("Overture places:", placeStats);
}

// ---------- official places -> map positions --------------------------------
const places = [];
{
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "official_places.json"), "utf8")).places;
  const seenName = new Set();
  for (const p of spec) {
    const re = new RegExp(p.match, "i");
    const ex = p.exclude ? new RegExp(p.exclude, "i") : null;
    const hits = out.labels.filter((l) => re.test(l.n) && !(ex && ex.test(l.n)));
    if (!hits.length) { console.log("official place not found in OSM labels:", p.official); continue; }
    for (const h of p.official === "*" ? hits : hits.slice(0, 1)) {
      const key = p.group + "|" + h.n;
      if (seenName.has(key)) continue;
      seenName.add(key);
      places.push({ g: p.group, n: p.official === "*" ? h.n : p.official, osm: h.n, x: h.x, z: h.z });
    }
  }
  console.log("official places located:", places.length);
}

// ---------- land-cover texture (ESA WorldCover) -----------------------------
const WC_PALETTE = {
  10: [0x4d, 0x7c, 0x42], 20: [0xa4, 0xb4, 0x6c], 30: [0xa9, 0xcf, 0x88], 40: [0xd6, 0xc4, 0x7c],
  50: [0xc8, 0xc3, 0xba], 60: [0xd9, 0xce, 0xb1], 70: [0xf2, 0xf2, 0xf2], 80: [0x3d, 0x7f, 0xb3],
  90: [0x7f, 0xb0, 0xa0], 95: [0x4d, 0x8f, 0x6c], 100: [0xc9, 0xd6, 0x9a],
};
const imagery = {};
let landcoverStats = null;
const wcPath = path.join(RAW_DIR, "worldcover.json");
if (fs.existsSync(wcPath)) {
  const wc = JSON.parse(fs.readFileSync(wcPath, "utf8"));
  const cls = zlib.inflateSync(Buffer.from(wc.data, "base64"));
  const rgb = new Uint8Array(wc.width * wc.height * 3);
  const counts = {};
  for (let i = 0; i < cls.length; i++) {
    const col = WC_PALETTE[cls[i]] || [0xcf, 0xc3, 0x9c];
    rgb[i * 3] = col[0]; rgb[i * 3 + 1] = col[1]; rgb[i * 3 + 2] = col[2];
    counts[cls[i]] = (counts[cls[i]] || 0) + 1;
  }
  const png = encodePNG(wc.width, wc.height, rgb);
  imagery.landcover = "data:image/png;base64," + png.toString("base64");
  landcoverStats = Object.fromEntries(Object.entries(counts).map(([k, v]) => [wc.classes[k] || k, +((100 * v) / cls.length).toFixed(1)]));
  console.log("land-cover texture:", wc.width, "x", wc.height, "PNG", (png.length / 1024).toFixed(0), "KB", landcoverStats);
}

// ---------- satellite imagery (Sentinel-2) ----------------------------------
const satPath = path.join(ROOT, "data", "imagery", "satellite.jpg");
let satInfo = null;
if (fs.existsSync(satPath)) {
  imagery.satellite = "data:image/jpeg;base64," + fs.readFileSync(satPath).toString("base64");
  satInfo = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "imagery", "satellite.json"), "utf8"));
  console.log("satellite texture:", satInfo.scene, satInfo.date, satInfo.size_px.join("x"), (fs.statSync(satPath).size / 1024).toFixed(0), "KB");
}

// ---------- terrain ---------------------------------------------------------
// Elevation grid over RECT (Copernicus GLO-30). Missing samples are filled from neighbours.
function fillMissing(values, nx, nz) {
  const v = values.slice();
  for (let pass = 0; pass < 50 && v.some((x) => x === null); pass++) {
    const next = v.slice();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (v[j * nx + i] !== null) continue;
        const nb = [];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && ii < nx && jj >= 0 && jj < nz && v[jj * nx + ii] !== null) nb.push(v[jj * nx + ii]);
        }
        if (nb.length) next[j * nx + i] = nb.reduce((a, b) => a + b, 0) / nb.length;
      }
    }
    v.splice(0, v.length, ...next);
  }
  return v;
}

let terrain = null;
const elevPath = path.join(RAW_DIR, "elevation.json");
if (fs.existsSync(elevPath)) {
  const e = JSON.parse(fs.readFileSync(elevPath, "utf8"));
  if (e.values && e.values.length === GRID.nx * GRID.nz) {
    const filled = fillMissing(e.values, GRID.nx, GRID.nz);
    const base = Math.min(...filled);
    terrain = {
      nx: GRID.nx, nz: GRID.nz,
      x0: GRID.x0, z0: GRID.z0, dx: GRID.dx, dz: GRID.dz,
      base: Math.round(base * 10) / 10, // scene y = elevation - base
      min: Math.round(base * 10) / 10,
      max: Math.round(Math.max(...filled) * 10) / 10,
      missing: e.values.filter((x) => x === null).length,
      h: filled.map((x) => Math.round((x - base) * 10) / 10),
      source: e.source,
    };
    console.log("terrain grid:", GRID.nx, "x", GRID.nz, "elev min/max:", terrain.min, terrain.max, "filled:", terrain.missing);
  }
}
if (!terrain) console.log("no elevation.json found: terrain will be flat");

// ---------- census village boundaries (Uttarakhand State GIS Portal) ---------
// Nagla (CT), Phoolbag and Kalyanpur hold the campus, farms and airport: the closest
// published approximation of the university estate. Reference only, not a legal boundary.
const villages = [];
const vbPath = path.join(RAW_DIR, "village_boundaries.json");
if (fs.existsSync(vbPath)) {
  for (const v of JSON.parse(fs.readFileSync(vbPath, "utf8")).villages) {
    const clipped = v.rings.map((r) => clipRing(r.map(([lon, lat]) => proj(lat, lon)))).filter(Boolean);
    if (!clipped.length) continue;
    villages.push({ n: v.name, code: v.census2011_code, r: clipped.map(flat) });
    const big = clipped.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
    const c = centroid(big);
    if (pointInRing(c, big)) out.labels.push({ n: v.name, k: "village", x: c[0], z: c[1] });
  }
  console.log("village boundaries:", villages.map((v) => v.n).join(", "));
}

// ---------- outputs ---------------------------------------------------------
const data = {
  meta: {
    name: "GBPUAT (G.B. Pant University of Agriculture & Technology), Pantnagar - digital twin",
    origin: ORIGIN,
    region: REGION,
    generated: new Date().toISOString(),
    sources: [
      { layer: "Buildings, roads, land use, water, rail, POIs", name: "OpenStreetMap contributors", licence: "ODbL" },
      { layer: "Extra building footprints", name: "Overture Maps Foundation (Google Open Buildings, Microsoft ML Building Footprints)", licence: "ODbL / CDLA-Permissive-2.0", release: mlStats.release },
      { layer: "Satellite image", name: satInfo ? satInfo.attribution : "n/a", licence: "Copernicus Sentinel data: free, full and open", scene: satInfo && satInfo.scene, date: satInfo && satInfo.date },
      { layer: "Land cover", name: "ESA WorldCover 2021 (10 m)", licence: "CC BY 4.0" },
      { layer: "Trees", name: "Meta + WRI high-resolution canopy height", licence: "CC BY 4.0" },
      { layer: "Points of interest", name: "OpenStreetMap + Overture Maps places", licence: "ODbL / CDLA-Permissive-2.0" },
      { layer: "Building heights", name: HT ? HT.source.replace(/ (.*)$/, "") : "estimated", licence: "CC BY 4.0 / ODbL" },
      { layer: "Terrain", name: "Copernicus DEM GLO-30 (ESA/EU)", licence: "Copernicus: free, full and open" },
      ...(villages.length ? [{ layer: "Village boundaries", name: "Census 2011 villages via Bharat Maps (NIC), Uttarakhand State GIS Portal", licence: "Government of India, reference only" }] : []),
    ],
    units: "metres; x = east, z = south; y = up (relative to terrain.base)",
    bounds: {
      x0: Math.floor(RECT.x0), x1: Math.ceil(RECT.x1),
      z0: Math.floor(RECT.z0), z1: Math.ceil(RECT.z1),
    },
    core: { x: round1(CORE.x), z: round1(CORE.z) },
    counts: { ...stats, ml: mlStats, heights: heightStats, newSince2016: newStats, places: placeStats, trees: treeStats, landcover: landcoverStats, places: places.length },
  },
  terrain,
  buildings: out.buildings,
  mlBld: out.mlBld,
  trees: out.trees,
  places,
  areas: out.areas,
  villages,
  roads: out.roads,
  lines: out.lines,
  points: out.points,
  labels: out.labels,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  "/* Generated by tools/build_data.mjs (OSM, Overture, Copernicus, ESA, Meta/WRI). Do not edit by hand. */\n" +
    "window.CAMPUS_DATA = " + JSON.stringify(data) + ";\n"
);
// Imagery is embedded as data URIs so the page also works from file:// (textures from file:// are blocked).
const IMAGERY_FILE = path.join(ROOT, "data", "imagery.js");
fs.writeFileSync(
  IMAGERY_FILE,
  "/* Generated by tools/build_data.mjs. Embedded textures: Sentinel-2 satellite image and ESA WorldCover land cover. */\n" +
    "window.CAMPUS_IMAGERY = " + JSON.stringify({ ...imagery, satelliteInfo: satInfo }) + ";\n"
);
console.log("wrote", path.relative(ROOT, IMAGERY_FILE), (fs.statSync(IMAGERY_FILE).size / 1024).toFixed(0), "KB");

console.log(
  "buildings:", out.buildings.length, "areas:", out.areas.length, "roads:", out.roads.length,
  "lines:", out.lines.length, "points:", out.points.length, "labels:", out.labels.length
);
console.log("region rect (m):", RECT);
console.log("wrote", path.relative(ROOT, OUT_FILE), (fs.statSync(OUT_FILE).size / 1024).toFixed(0), "KB");
