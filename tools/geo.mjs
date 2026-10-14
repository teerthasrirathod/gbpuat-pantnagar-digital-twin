// Shared geometry constants for the GBPUAT digital twin.
// Local frame: x = east (m), z = south (m), origin at ORIGIN; y = up (elevation).
// Used by fetch_osm.mjs, fetch_elevation.mjs and build_data.mjs so every step agrees.

import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("./region.json", import.meta.url), "utf8"));

// Study region (WGS84). Covers the campus, its farms and the surrounding town.
export const REGION = cfg.region;

// Local origin: approximate centre of the campus (WGS84).
export const ORIGIN = cfg.origin;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const proj = (lat, lon) => [
  (lon - ORIGIN.lon) * M_PER_DEG_LON,
  -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
];
export const unproj = (x, z) => ({
  lat: ORIGIN.lat - z / M_PER_DEG_LAT,
  lon: ORIGIN.lon + x / M_PER_DEG_LON,
});

// Region rectangle in local metres.
export const RECT = (() => {
  const [x0, zS] = proj(REGION.south, REGION.west);
  const [x1, zN] = proj(REGION.north, REGION.east);
  return { x0, x1, z0: zN, z1: zS };
})();

// Elevation grid over RECT: regular in metres, GRID_SPACING_M apart.
export const GRID_SPACING_M = cfg.grid_spacing_m;
export const GRID = (() => {
  const nx = Math.round((RECT.x1 - RECT.x0) / GRID_SPACING_M) + 1;
  const nz = Math.round((RECT.z1 - RECT.z0) / GRID_SPACING_M) + 1;
  return {
    nx,
    nz,
    x0: RECT.x0,
    z0: RECT.z0,
    dx: (RECT.x1 - RECT.x0) / (nx - 1),
    dz: (RECT.z1 - RECT.z0) / (nz - 1),
  };
})();
