// Usage: node tools/fetch_osm.mjs   (run from the project root; writes data/raw/*.json, resumable)
// Fetch OSM features for the Pantnagar campus region in tiles (Overpass API).
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { REGION } from "./geo.mjs";

const OUT = "data/raw";
const UA = "PantnagarDigitalTwin/1.0 (local research)";
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
// Region comes from tools/region.json (via geo.mjs); tiles are STEP_LAT x STEP_LON degrees.
const { south: S, north: N, west: W, east: E } = REGION;
const STEP_LAT = 0.02, STEP_LON = 0.03;

mkdirSync(OUT, { recursive: true });
const tiles = [];
for (let s = S; s < N - 1e-9; s += STEP_LAT)
  for (let w = W; w < E - 1e-9; w += STEP_LON)
    tiles.push([s, w, Math.min(s + STEP_LAT, N), Math.min(w + STEP_LON, E)]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [s, w, n, e] of tiles) {
  const name = `${OUT}/t_${s.toFixed(3)}_${w.toFixed(3)}.json`;
  if (existsSync(name)) { console.log("skip", name); continue; }
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:180];
(
  way["building"](${bb});
  way["highway"](${bb});
  way["landuse"](${bb});
  way["natural"](${bb});
  way["waterway"](${bb});
  way["leisure"](${bb});
  way["amenity"](${bb});
  way["aeroway"](${bb});
  way["railway"](${bb});
  way["power"](${bb});
  way["man_made"](${bb});
  way["place"](${bb});
  relation["boundary"](${bb});
  relation["landuse"](${bb});
  relation["building"](${bb});
  node["amenity"](${bb});
  node["tourism"](${bb});
);
out geom;`;
  let ok = false;
  for (let attempt = 0; attempt < 6 && !ok; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const body = execFileSync("curl", ["-s", "-m", "240", "-A", UA, "--data-binary", q, ep], { maxBuffer: 512 * 1024 * 1024 }).toString();
      const j = JSON.parse(body);
      writeFileSync(name, JSON.stringify(j));
      console.log("ok", name, "elements:", j.elements.length, "via", ep);
      ok = true;
    } catch (err) {
      console.log("retry", name, attempt, ep, String(err.message).slice(0, 120));
      await sleep(8000 * (attempt + 1));
    }
  }
  if (!ok) console.log("FAILED", name);
}
console.log("DONE");
