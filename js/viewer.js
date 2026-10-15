/* GBPUAT Pantnagar 3D twin - viewer (v1.1).
 *
 * Low-compute design:
 *  - Geometry is merged on load into a few BufferGeometries; detected buildings and trees are
 *    split into spatial chunks so far-away chunks are skipped (trees switch to a cheaper shape).
 *  - Terrain is one indexed grid; overlays are draped onto it once at load.
 *  - The scene renders only while something moves. Moving frames use an adaptive resolution;
 *    the still frame is supersampled, so no MSAA is needed.
 *  - Labels are DOM nodes placed by projection with simple collision avoidance.
 */
(async function () {
  "use strict";

  const D = window.CAMPUS_DATA;
  const IMG = window.CAMPUS_IMAGERY || {};
  const $ = (id) => document.getElementById(id);
  const loadBar = $("load-bar"), loadText = $("load-text");
  const step = (pct, text) => new Promise((resolve) => {
    loadBar.style.width = pct + "%";
    loadText.textContent = text;
    setTimeout(resolve, 16); // let the browser paint the progress
  });
  if (!window.THREE || !D) {
    loadText.textContent = "This copy is missing its data files (three.min.js or data/campus-data.js).";
    return;
  }
  // If anything fails while the scene is being built, say so on the loading screen.
  const reportFailure = (msg) => {
    if (!$("loading").hidden) loadText.textContent = "The 3D view could not be built: " + msg;
  };
  window.addEventListener("error", (e) => reportFailure(e.message));
  window.addEventListener("unhandledrejection", (e) => reportFailure(String(e.reason && e.reason.message || e.reason)));
  let dirty = true; // set whenever the scene needs to be redrawn

  // ---------- constants -------------------------------------------------------
  const B = D.meta.bounds;
  const CX = (B.x0 + B.x1) / 2, CZ = (B.z0 + B.z1) / 2;
  const SPAN = Math.max(B.x1 - B.x0, B.z1 - B.z0);
  const SKY = 0xd9e5ec;           // horizon colour (fog); the sky gradient is CSS behind the canvas
  const GROUND_COLOUR = 0xcfc39c;
  const WALL_TILE_M = 3.0;        // one window bay every 3 m
  const STOREY_M = 3.3;           // one window row per storey
  const WALL_BASE_SHADE = 0.62;   // wall colour at ground level vs eaves (fake ambient occlusion)
  const DRAPE_MAX_EDGE = 80;      // land-use triangles are split to this size before draping
  const ROAD_MAX_SEG = 40;        // road polylines are densified to this step before draping
  const ML_CHUNK = 600, ML_RANGE = 2600;               // detected buildings: chunk size, draw distance
  const TREE_CHUNK = 800, TREE_HI_RANGE = 1300, TREE_LO_RANGE = 7500;
  const NEW_RGB = [0.85, 0.22, 0.05];                  // "built since 2016" highlight (linear)

  const BUILDING_STYLE = {
    university: [0xd9c7a3, 0x8e5b3e], college: [0xd9c7a3, 0x8e5b3e], school: [0xe4d5b5, 0x9a5f42],
    hospital: [0xf1f1ee, 0x9fb3bd], hostel: [0xcfbc98, 0x7a4d37], dormitory: [0xcfbc98, 0x7a4d37],
    retail: [0xd7d2c9, 0x6e6e6e], commercial: [0xd7d2c9, 0x6e6e6e], industrial: [0xbdbdb8, 0x55595c],
    warehouse: [0xbdbdb8, 0x55595c], church: [0xf2efe6, 0xb0453b], temple: [0xf2efe6, 0xb0453b],
    default: [0xe6dccb, 0x9b6a4b],
  };
  const ML_WALLS = [0xe8dfd0, 0xd9cdb8, 0xcfc7bb, 0xe3d6c2, 0xc9c0b0];
  const AREA_STYLE = {
    water: [0x3d7fb3, 1.4], grass: [0x9cc27f, 1.2], forest: [0x4f7f43, 1.3], scrub: [0xa6b274, 1.25],
    farm: [0xc7b56a, 1.15], sport: [0xa5d08f, 1.35], residential: [0xd8d0b6, 1.3], commercial: [0xcdc6b6, 1.32],
    cemetery: [0x9db09d, 1.28], paved: [0xb9b7b2, 1.36], campus: [0xc8e0b0, 1.45], other: [0xcbc3a2, 1.2],
  };
  const ROAD_STYLE = {
    motorway: [0x6f6f6f, 1.9], trunk: [0x6f6f6f, 1.9], trunk_link: [0x6f6f6f, 1.85],
    primary: [0x737373, 1.85], secondary: [0x7d7d7d, 1.8], tertiary: [0x8a8a8a, 1.78],
    unclassified: [0x9a9a9a, 1.75], residential: [0x9a9a9a, 1.75], living_street: [0xaaa79f, 1.72],
    road: [0x9a9a9a, 1.75], service: [0xb3afa6, 1.7], pedestrian: [0xc8c2b8, 1.68],
    track: [0xb09a73, 1.65], path: [0xcbb994, 1.62], footway: [0xcbb994, 1.62],
    cycleway: [0xcbb994, 1.62], steps: [0xcbb994, 1.62], bridleway: [0xb09a73, 1.62],
  };
  const LABEL_RANGE = { college: 4500, bld: 900, poi: 2000, campus: 3200, sport: 2600, grass: 2600, farm: 4500, water: 4500 };
  const LABEL_PRIORITY = { college: 0, poi: 1, campus: 2, farm: 2, bld: 3 };
  const LANDCOVER_NAMES = {
    "4d7c42": "Tree cover", "a4b46c": "Shrubland", "a9cf88": "Grassland", "d6c47c": "Cropland",
    "c8c3ba": "Built-up", "d9ceb1": "Bare ground", "3d7fb3": "Water", "7fb0a0": "Wetland",
  };

  // ---------- helpers -----------------------------------------------------------
  // Hex colours are sRGB; convert to the linear working space so they match sRGB textures.
  const hexRGB = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hashUnit = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
  const fmtInt = (n) => Math.round(n).toLocaleString("en-IN");
  const pretty = (k) => String(k || "place").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const toVec2 = (flat) => {
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return out;
  };
  const toPairs = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
  function triangulate(rings) {
    const contour = toVec2(rings[0]);
    const holes = rings.slice(1).map(toVec2);
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes); // mutates the input arrays
    return { pts: contour.concat(...holes), faces };
  }
  function polyCentroid(flat) {
    let x = 0, z = 0;
    const n = flat.length / 2;
    for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; }
    return { x: x / n, z: z / n };
  }
  function polyArea(flat) {
    let a = 0;
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += flat[2 * i] * flat[2 * j + 1] - flat[2 * j] * flat[2 * i + 1]; }
    return Math.abs(a) / 2;
  }
  // Local metres -> WGS84 (inverse of tools/geo.mjs).
  const ORIGIN = D.meta.origin;
  const M_LAT = 110540, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
  const toLatLon = (x, z) => ({ lat: ORIGIN.lat - z / M_LAT, lon: ORIGIN.lon + x / M_LON });
  const fmtLatLon = ({ lat, lon }) => `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`;

  // ---------- terrain ---------------------------------------------------------
  const T = D.terrain || null;
  // Height (m above terrain.base) at local x/z, interpolated on exactly the two triangles per grid
  // cell that the terrain mesh uses, so draped overlays sit on the drawn surface.
  function H(x, z) {
    if (!T) return 0;
    const fx = clamp((x - T.x0) / T.dx, 0, T.nx - 1.0001);
    const fz = clamp((z - T.z0) / T.dz, 0, T.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = T.h;
    const a = h[j * T.nx + i], b = h[j * T.nx + i + 1], c = h[(j + 1) * T.nx + i], d = h[(j + 1) * T.nx + i + 1];
    if (tx + tz <= 1) return a + tx * (b - a) + tz * (c - a);
    return d + (1 - tx) * (c - d) + (1 - tz) * (b - d);
  }
  const elevation = (x, z) => (T ? T.base : 0) + H(x, z);

  function buildTerrainMesh() {
    const nx = T.nx, nz = T.nz;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = T.x0 + i * T.dx; pos[k * 3 + 1] = T.h[k]; pos[k * 3 + 2] = T.z0 + j * T.dz;
        uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = 1 - j / (nz - 1); // textures are north-up over the window
      }
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: GROUND_COLOUR }));
  }

  // ---------- geometry batches ------------------------------------------------
  class Batch {
    constructor(withUV) { this.pos = []; this.nor = []; this.col = []; this.uv = withUV ? [] : null; }
    get triangles() { return this.pos.length / 9; }
    tri(a, b, c, rgb, uva, uvb, uvc) { this.tri3(a, b, c, rgb, rgb, rgb, uva, uvb, uvc); }
    tri3(a, b, c, ca, cb, cc, uva, uvb, uvc) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      this.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
      if (this.uv) for (const q of [uva || [0, 0], uvb || [0, 0], uvc || [0, 0]]) this.uv.push(q[0], q[1]);
    }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
      if (this.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      return g;
    }
  }

  // Split a 2D triangle by bisecting its longest edge until every edge is at most maxLen.
  function subdivide(a, b, c, maxLen, out, depth = 0) {
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const lab = d(a, b), lbc = d(b, c), lca = d(c, a);
    const L = Math.max(lab, lbc, lca);
    if (L <= maxLen || depth > 24) { out.push([a, b, c]); return out; }
    const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (L === lab) { const mm = m(a, b); subdivide(a, mm, c, maxLen, out, depth + 1); subdivide(mm, b, c, maxLen, out, depth + 1); }
    else if (L === lbc) { const mm = m(b, c); subdivide(a, b, mm, maxLen, out, depth + 1); subdivide(a, mm, c, maxLen, out, depth + 1); }
    else { const mm = m(c, a); subdivide(a, b, mm, maxLen, out, depth + 1); subdivide(mm, b, c, maxLen, out, depth + 1); }
    return out;
  }
  function addDrapedPolygon(batch, rings, lift, rgb) {
    const { pts, faces } = triangulate(rings);
    for (const f of faces) {
      for (const [a, b, c] of subdivide([pts[f[0]].x, pts[f[0]].y], [pts[f[1]].x, pts[f[1]].y], [pts[f[2]].x, pts[f[2]].y], DRAPE_MAX_EDGE, [])) {
        batch.tri([a[0], H(a[0], a[1]) + lift, a[1]], [b[0], H(b[0], b[1]) + lift, b[1]], [c[0], H(c[0], c[1]) + lift, c[1]], rgb);
      }
    }
  }
  function densify(flat, maxLen) {
    const out = [];
    for (let i = 0; i < flat.length - 2; i += 2) {
      const x0 = flat[i], z0 = flat[i + 1], x1 = flat[i + 2], z1 = flat[i + 3];
      out.push([x0, z0]);
      const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / maxLen);
      for (let k = 1; k <= n; k++) { const t = k / (n + 1); out.push([lerp(x0, x1, t), lerp(z0, z1, t)]); }
    }
    if (flat.length >= 2) out.push([flat[flat.length - 2], flat[flat.length - 1]]);
    return out;
  }
  function ribbon(batch, flat, width, lift, rgb) {
    const P = [];
    for (const p of densify(flat, ROAD_MAX_SEG)) {
      const last = P[P.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 0.05 || Math.abs(last[1] - p[1]) > 0.05) P.push(p);
    }
    const m = P.length;
    if (m < 2) return;
    const hw = width / 2;
    const segN = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
    const L = [], R = [];
    for (let i = 0; i < m; i++) {
      let mx, mz, s;
      if (i === 0) { [mx, mz] = segN(P[0], P[1]); s = hw; }
      else if (i === m - 1) { [mx, mz] = segN(P[m - 2], P[m - 1]); s = hw; }
      else {
        const n1 = segN(P[i - 1], P[i]), n2 = segN(P[i], P[i + 1]);
        mx = n1[0] + n2[0]; mz = n1[1] + n2[1];
        const ml = Math.hypot(mx, mz) || 1;
        mx /= ml; mz /= ml;
        s = hw / Math.max(0.35, mx * n1[0] + mz * n1[1]);
      }
      const lx = P[i][0] + mx * s, lz = P[i][1] + mz * s, rx = P[i][0] - mx * s, rz = P[i][1] - mz * s;
      L.push([lx, H(lx, lz) + lift, lz]);
      R.push([rx, H(rx, rz) + lift, rz]);
    }
    for (let i = 0; i < m - 1; i++) { batch.tri(L[i], R[i], L[i + 1], rgb); batch.tri(R[i], R[i + 1], L[i + 1], rgb); }
  }

  // Extruded footprint: walls (window texture, darker base) and a roof following the terrain.
  function extrude(batch, ringsFlat, h, wall, roof) {
    const wallBase = wall.map((c) => c * WALL_BASE_SHADE);
    for (const flat of ringsFlat) {
      const ring = toPairs(flat);
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 0.2) continue;
        const u1 = len / WALL_TILE_M, v1 = h / STOREY_M;
        const pb = H(p[0], p[1]), qb = H(q[0], q[1]);
        const A = [p[0], pb - 0.3, p[1]], Bv = [q[0], qb - 0.3, q[1]], C = [q[0], qb + h, q[1]], Dv = [p[0], pb + h, p[1]];
        batch.tri3(A, Bv, C, wallBase, wallBase, wall, [0, 0], [u1, 0], [u1, v1]);
        batch.tri3(A, C, Dv, wallBase, wall, wall, [0, 0], [u1, v1], [0, v1]);
      }
    }
    const { pts, faces } = triangulate(ringsFlat);
    const r0 = [0.02, 0.02]; // the plain-wall corner of the window texture
    for (const f of faces) {
      const a = pts[f[0]], b = pts[f[1]], c = pts[f[2]];
      batch.tri([a.x, H(a.x, a.y) + h, a.y], [b.x, H(b.x, b.y) + h, b.y], [c.x, H(c.x, c.y) + h, c.y], roof, r0, r0, r0);
    }
  }

  // Precompute a "highlighted" copy of a mesh's colours for buildings built since 2016.
  function highlightColours(colours, starts, isNew) {
    const out = colours.slice();
    const nAvg = (NEW_RGB[0] + NEW_RGB[1] + NEW_RGB[2]) / 3;
    for (let b = 0; b < starts.length - 1; b++) {
      if (!isNew(b)) continue;
      for (let v = starts[b] * 3; v < starts[b + 1] * 3; v++) {
        const k = v * 3;
        const avg = (out[k] + out[k + 1] + out[k + 2]) / 3;
        for (let c = 0; c < 3; c++) out[k + c] = lerp(out[k + c], (NEW_RGB[c] * avg) / nAvg, 0.8);
      }
    }
    return out;
  }
  // Index of the building that owns triangle `tri`, given each building's first triangle.
  function ownerOf(starts, tri) {
    let lo = 0, hi = starts.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= tri) lo = mid; else hi = mid - 1; }
    return lo;
  }

  // ---------- renderer / scene ------------------------------------------------
  const canvas = $("view");
  let renderer;
  try {
    // No MSAA and no logarithmic depth (both are costly on integrated GPUs); still frames are
    // supersampled instead.
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    loadText.textContent = "WebGL is not available in this browser, so the 3D view cannot start.";
    return;
  }
  renderer.setPixelRatio(1);
  renderer.setClearColor(SKY, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY, SPAN * 1.2, SPAN * 4);
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x8b7d5a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff3dd, 0.95);
  sun.position.set(-900, 1400, 700);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 60000);

  const groups = {};
  for (const k of ["terrain", "land", "water", "roads", "rail", "outline", "bld", "bldML", "trees", "pins", "select"]) {
    groups[k] = new THREE.Group();
    scene.add(groups[k]);
  }

  await step(8, "Shaping the terrain");
  const loadTexture = (uri) => {
    if (!uri) return null;
    const t = new THREE.TextureLoader().load(uri, () => { dirty = true; });
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const satTex = loadTexture(IMG.satellite);
  const lcTex = loadTexture(IMG.landcover);
  const terrainMats = {
    map: new THREE.MeshLambertMaterial(lcTex ? { map: lcTex } : { color: GROUND_COLOUR }),
    satellite: new THREE.MeshBasicMaterial(satTex ? { map: satTex } : { color: GROUND_COLOUR }),
  };
  let terrainMesh = null;
  if (T) {
    terrainMesh = buildTerrainMesh();
    groups.terrain.add(terrainMesh);
  } else {
    const g = new THREE.PlaneGeometry(B.x1 - B.x0, B.z1 - B.z0);
    g.rotateX(-Math.PI / 2);
    terrainMesh = new THREE.Mesh(g, terrainMats.map);
    terrainMesh.position.set(CX, 0, CZ);
    groups.terrain.add(terrainMesh);
  }
  {
    const g = new THREE.PlaneGeometry(SPAN * 6, SPAN * 6);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: GROUND_COLOUR }));
    m.position.set(CX, -8, CZ);
    groups.terrain.add(m);
  }

  // Wall texture: plain wall with dark glazing, one 128 px tile repeated per bay and storey.
  const windowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "#2c3b4a"; x.fillRect(34, 40, 60, 46);
    x.fillStyle = "#e9eef2"; x.fillRect(62, 40, 4, 46);
    x.fillStyle = "#d8d8d8"; x.fillRect(0, 122, 128, 6);   // floor band
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 2;
    return t;
  })();
  const bMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTex, side: THREE.DoubleSide });

  await step(18, "Draping land use, water and roads");
  const matVC = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  {
    const landBatch = new Batch(false), waterBatch = new Batch(false);
    for (const a of D.areas) {
      const [colour, lift] = AREA_STYLE[a.k] || AREA_STYLE.other;
      addDrapedPolygon(a.k === "water" ? waterBatch : landBatch, a.r, lift, hexRGB(colour));
    }
    groups.land.add(new THREE.Mesh(landBatch.geometry(), matVC));
    groups.water.add(new THREE.Mesh(waterBatch.geometry(), matVC));
  }
  {
    // Outlines of the named university areas mapped in OSM (campus and farm polygons).
    const pts = [];
    for (const a of D.areas) {
      if (!a.n || !/Pant|University/i.test(a.n)) continue;
      for (const ring of a.r) {
        const P = densify(ring, 40);
        for (let i = 0; i < P.length; i++) {
          const p = P[i], q = P[(i + 1) % P.length];
          pts.push(p[0], H(p[0], p[1]) + 3, p[1], q[0], H(q[0], q[1]) + 3, q[1]);
        }
      }
    }
    if (pts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      groups.outline.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffd400 })));
    }
  }
  const matRoads = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  {
    const roadBatch = new Batch(false), railBatch = new Batch(false), waterLineBatch = new Batch(false);
    const powerPts = [];
    for (const r of D.roads) {
      const [colour, lift] = ROAD_STYLE[r.c] || [0x9a9a9a, 1.75];
      ribbon(roadBatch, r.p, Math.max(r.w, r.c === "track" || r.c === "path" ? 2.0 : 3.0), lift, hexRGB(colour));
    }
    for (const l of D.lines) {
      if (l.k.startsWith("waterway:")) ribbon(waterLineBatch, l.p, Math.max(l.w, 1.6), 1.6, hexRGB(0x3d7fb3));
      else if (l.k === "rail") ribbon(railBatch, l.p, 3.2, 2.0, hexRGB(0x6b6258));
      else if (l.k === "power") {
        const p = l.p;
        for (let i = 0; i < p.length - 2; i += 2) powerPts.push(p[i], H(p[i], p[i + 1]) + 14, p[i + 1], p[i + 2], H(p[i + 2], p[i + 3]) + 14, p[i + 3]);
      }
    }
    groups.roads.add(new THREE.Mesh(roadBatch.geometry(), matRoads));
    groups.rail.add(new THREE.Mesh(railBatch.geometry(), matVC));
    groups.water.add(new THREE.Mesh(waterLineBatch.geometry(), matVC));
    if (powerPts.length) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(powerPts, 3));
      groups.rail.add(new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: 0x222222 })));
    }
  }

  // ---------- mapped (OSM) buildings ------------------------------------------
  await step(32, "Raising mapped buildings");
  const pickables = []; // meshes that can be clicked: {mesh, kind, starts?, ids?}
  {
    const batch = new Batch(true);
    const starts = [];
    D.buildings.forEach((b) => {
      starts.push(batch.triangles);
      const style = BUILDING_STYLE[b.t] || BUILDING_STYLE.default;
      const jitter = 0.94 + 0.12 * hashUnit(b.id % 100003);
      const wall = hexRGB(style[0]).map((c) => c * jitter);
      let roof = hexRGB(style[1]).map((c) => c * jitter);
      if (b.rc) { const sat = hexRGB(b.rc); roof = roof.map((c, k) => c * 0.4 + sat[k] * 0.6); }
      extrude(batch, b.r, b.h, wall, roof);
    });
    starts.push(batch.triangles);
    const geo = batch.geometry();
    const mesh = new THREE.Mesh(geo, bMat);
    const base = geo.attributes.color.array.slice();
    const lit = highlightColours(base, starts, (i) => !!D.buildings[i].nw);
    mesh.userData = { kind: "osm", starts, colours: { base, lit } };
    groups.bld.add(mesh);
    pickables.push(mesh);
  }

  // ---------- detected (ML) buildings: real footprints, chunked ----------------
  const mlChunks = [];
  {
    const ml = D.mlBld || [];
    await step(42, `Raising ${fmtInt(ml.length)} detected buildings`);
    const buckets = new Map();
    ml.forEach((b, i) => {
      // b = [source, flags, height, roof colour, x1, z1, ...]
      let x = 0, z = 0;
      const n = (b.length - 4) / 2;
      for (let k = 4; k < b.length; k += 2) { x += b[k]; z += b[k + 1]; }
      const key = Math.floor(x / n / ML_CHUNK) + "," + Math.floor(z / n / ML_CHUNK);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    });
    const walls = ML_WALLS.map(hexRGB);
    let done = 0;
    for (const [key, ids] of buckets) {
      const batch = new Batch(true);
      const starts = [];
      for (const i of ids) {
        const b = ml[i];
        starts.push(batch.triangles);
        const wall = walls[Math.floor(hashUnit(i + 7) * walls.length)];
        let roof = wall.map((c) => c * 0.82);
        if (b[3]) { const sat = hexRGB(b[3]); roof = roof.map((c, k) => c * 0.35 + sat[k] * 0.65); }
        extrude(batch, [b.slice(4)], b[2], wall, roof);
      }
      starts.push(batch.triangles);
      const geo = batch.geometry();
      const mesh = new THREE.Mesh(geo, bMat);
      const base = geo.attributes.color.array.slice();
      const lit = highlightColours(base, starts, (k) => (ml[ids[k]][1] & 2) !== 0);
      mesh.userData = { kind: "ml", starts, ids, colours: { base, lit } };
      const [kx, kz] = key.split(",").map(Number);
      groups.bldML.add(mesh);
      mlChunks.push({ mesh, x: (kx + 0.5) * ML_CHUNK, z: (kz + 0.5) * ML_CHUNK });
      pickables.push(mesh);
      if (++done % 40 === 0) await step(42 + Math.round((done / buckets.size) * 22), `Raising ${fmtInt(ml.length)} detected buildings`);
    }
  }

  // ---------- trees: two levels of detail, chunked ------------------------------
  await step(68, "Planting trees");
  const treeChunks = [];
  {
    // Detailed tree (26 triangles): trunk + faceted crown. Far tree (8 triangles): crown only.
    // Geometry is in "tree units": x/z in crown radii, y in tree heights.
    const gradient = (g, y0, y1, c0, c1) => {
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const t = clamp((p.getY(v) - y0) / (y1 - y0), 0, 1);
        for (let k = 0; k < 3; k++) col[v * 3 + k] = lerp(c0[k], c1[k], t);
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    const crownLo = hexRGB(0x2e5e2c), crownHi = hexRGB(0x6f9c4b), trunkC = hexRGB(0x5b4331);
    const crownHiDetail = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
    crownHiDetail.scale(1, 0.42, 1); crownHiDetail.translate(0, 0.62, 0);
    gradient(crownHiDetail, 0.2, 1.04, crownLo, crownHi);
    const trunk = new THREE.CylinderGeometry(0.08, 0.12, 0.5, 3, 1, true).toNonIndexed();
    trunk.translate(0, 0.25, 0);
    gradient(trunk, 0, 1, trunkC, trunkC);
    const merge = (geos) => {
      const g = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "color"]) {
        const total = geos.reduce((s, x) => s + x.attributes[name].array.length, 0);
        const arr = new Float32Array(total);
        let o = 0;
        for (const x of geos) { arr.set(x.attributes[name].array, o); o += x.attributes[name].array.length; }
        g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
      }
      return g;
    };
    const hiGeo = merge([crownHiDetail, trunk]);
    const loGeo = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
    loGeo.scale(1, 0.42, 1); loGeo.translate(0, 0.62, 0);
    gradient(loGeo, 0.2, 1.04, crownLo, crownHi);
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });

    const t = D.trees || [];
    const n = Math.floor(t.length / 3);
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(t[3 * i] / TREE_CHUNK) + "," + Math.floor(t[3 * i + 1] / TREE_CHUNK);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    for (const [key, ids] of buckets) {
      const hi = new THREE.InstancedMesh(hiGeo, treeMat, ids.length);
      const lo = new THREE.InstancedMesh(loGeo, treeMat, ids.length);
      ids.forEach((i, k) => {
        const x = t[3 * i], z = t[3 * i + 1], h = t[3 * i + 2];
        // Tall trees (eucalyptus, poplar) are narrow; shorter ones (mango, sal) spread wide.
        const r = h >= 14 ? clamp(0.13 * h + 0.9, 1.6, 4.2) : clamp(0.3 * h + 1.0, 1.8, 5.8);
        const j1 = hashUnit(i + 1), j2 = hashUnit(i + 101), j3 = hashUnit(i + 211);
        q.setFromAxisAngle(yAxis, j2 * Math.PI * 2);
        pos.set(x, H(x, z) - 0.2, z);
        sc.set(r * (0.85 + 0.3 * j3), h, r * (0.85 + 0.3 * j2));
        m4.compose(pos, q, sc);
        hi.setMatrixAt(k, m4);
        lo.setMatrixAt(k, m4);
        // Mild per-tree variation in brightness and hue; taller crowns read slightly darker.
        const b = clamp(1.12 - h / 70, 0.78, 1.1) * (0.88 + 0.24 * j1);
        tint.setRGB(b * (0.92 + 0.12 * j3), b, b * (0.88 + 0.1 * j2));
        hi.setColorAt(k, tint);
        lo.setColorAt(k, tint);
      });
      for (const m of [hi, lo]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        if (m.computeBoundingSphere) m.computeBoundingSphere();
        groups.trees.add(m);
      }
      const [kx, kz] = key.split(",").map(Number);
      treeChunks.push({ hi, lo, x: (kx + 0.5) * TREE_CHUNK, z: (kz + 0.5) * TREE_CHUNK });
    }
  }

  // ---------- points of interest ------------------------------------------------
  await step(80, "Placing points of interest");
  const poiList = D.points.filter((p) => p.n);
  {
    const g = new THREE.OctahedronGeometry(2.2, 0);
    g.scale(1, 1.6, 1);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xe4572e }), Math.max(1, poiList.length));
    const m4 = new THREE.Matrix4();
    poiList.forEach((p, i) => { m4.makeTranslation(p.x, H(p.x, p.z) + 10, p.z); mesh.setMatrixAt(i, m4); });
    mesh.count = poiList.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    mesh.userData = { kind: "poi" };
    groups.pins.add(mesh);
    pickables.push(mesh);
  }
  pickables.push(terrainMesh);
  terrainMesh.userData = { kind: "ground" };

  // ---------- camera ----------------------------------------------------------
  // Input moves a `goal`; the visible `view` eases toward it every frame (exponential smoothing).
  const view = { target: new THREE.Vector3(CX, 0, CZ), theta: 0.55, phi: 0.82, radius: SPAN * 0.7 };
  const goal = { x: CX, z: CZ, theta: 0.55, phi: 0.82, radius: SPAN * 0.7 };
  const vel = { theta: 0, phi: 0, x: 0, z: 0 };
  const EASE_INPUT = 14, EASE_FLY = 3.2;
  let ease = EASE_INPUT;
  let dragging = false;

  function clampGoal() {
    goal.phi = clamp(goal.phi, 0.03, 1.48);
    goal.radius = clamp(goal.radius, 25, SPAN * 3);
    goal.x = clamp(goal.x, B.x0 - SPAN * 0.2, B.x1 + SPAN * 0.2);
    goal.z = clamp(goal.z, B.z0 - SPAN * 0.2, B.z1 + SPAN * 0.2);
  }
  function applyView() {
    view.target.y = H(view.target.x, view.target.z);
    const sp = Math.sin(view.phi);
    camera.position.set(
      view.target.x + view.radius * sp * Math.sin(view.theta),
      view.target.y + view.radius * Math.cos(view.phi),
      view.target.z + view.radius * sp * Math.cos(view.theta)
    );
    camera.lookAt(view.target);
    camera.near = clamp(view.radius * 0.05, 0.5, 1000);
    camera.far = view.radius * 4 + SPAN * 4;
    camera.updateProjectionMatrix();
  }
  const gliding = () => Math.abs(vel.theta) + Math.abs(vel.phi) > 1e-3 || Math.hypot(vel.x, vel.z) > goal.radius * 1e-3;
  function cameraMoving() {
    return gliding() ||
      Math.abs(goal.theta - view.theta) > 1e-4 || Math.abs(goal.phi - view.phi) > 1e-4 ||
      Math.abs(Math.log(goal.radius / view.radius)) > 1e-4 ||
      Math.hypot(goal.x - view.target.x, goal.z - view.target.z) > view.radius * 1e-4;
  }
  function stepCamera(dt) {
    if (!dragging && gliding()) {
      goal.theta += vel.theta * dt; goal.phi += vel.phi * dt; goal.x += vel.x * dt; goal.z += vel.z * dt;
      const decay = Math.exp(-dt * 4.5);
      vel.theta *= decay; vel.phi *= decay; vel.x *= decay; vel.z *= decay;
      clampGoal();
    } else if (!dragging) {
      vel.theta = vel.phi = vel.x = vel.z = 0;
    }
    const k = 1 - Math.exp(-dt * ease);
    view.target.x += (goal.x - view.target.x) * k;
    view.target.z += (goal.z - view.target.z) * k;
    view.theta += (goal.theta - view.theta) * k;
    view.phi += (goal.phi - view.phi) * k;
    view.radius = Math.exp(Math.log(view.radius) + Math.log(goal.radius / view.radius) * k);
    applyView();
    if (!cameraMoving()) ease = EASE_INPUT;
  }
  function flyTo(tx, tz, radius, phi) {
    goal.x = tx; goal.z = tz; goal.radius = radius;
    if (phi != null) goal.phi = phi;
    vel.theta = vel.phi = vel.x = vel.z = 0;
    clampGoal();
    ease = EASE_FLY;
  }

  const avgOf = (list, fallback) => {
    if (!list.length) return fallback;
    let x = 0, z = 0;
    for (const p of list) { x += p.x; z += p.z; }
    return { x: x / list.length, z: z / list.length };
  };
  const campusCore = D.meta.core || { x: CX, z: CZ };
  const farmCentre = avgOf(D.areas.filter((a) => a.k === "farm").map((a) => polyCentroid(a.r[0])), { x: CX, z: CZ });
  const PRESETS = {
    overview: () => flyTo(campusCore.x, campusCore.z, SPAN * 0.5, 0.9),
    top: () => flyTo(campusCore.x, campusCore.z, SPAN * 0.5, 0.03),
    core: () => flyTo(campusCore.x, campusCore.z, 1700, 0.8),
    farms: () => flyTo(farmCentre.x, farmCentre.z, 3200, 0.9),
  };

  // ---------- picking & info card ------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2(), _hit = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function setPointer(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
  }
  // Point on the ground under a screen position (plane at the target's height; cheap, for zoom).
  function groundUnder(clientX, clientY) {
    setPointer(clientX, clientY);
    groundPlane.constant = -view.target.y;
    if (!raycaster.ray.intersectPlane(groundPlane, _hit)) return null;
    if (_hit.distanceTo(camera.position) > view.radius * 6) return null;
    return { x: _hit.x, z: _hit.z };
  }
  const visibleInScene = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function pick(clientX, clientY) {
    setPointer(clientX, clientY);
    const hits = raycaster.intersectObjects(pickables.filter(visibleInScene), false);
    return hits[0] || null;
  }

  // Land cover under a point, read from the land-cover texture (decoded once, lazily).
  let lcPixels = null;
  function landCoverAt(x, z) {
    if (!IMG.landcover) return null;
    if (!lcPixels) {
      const img = lcTex && lcTex.image;
      if (!img || !img.width) return null;
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      lcPixels = { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
    }
    const i = Math.floor(((x - B.x0) / (B.x1 - B.x0)) * lcPixels.w);
    const j = Math.floor(((z - B.z0) / (B.z1 - B.z0)) * lcPixels.h);
    if (i < 0 || j < 0 || i >= lcPixels.w || j >= lcPixels.h) return null;
    const k = (j * lcPixels.w + i) * 4;
    const hex = [0, 1, 2].map((o) => lcPixels.data[k + o].toString(16).padStart(2, "0")).join("");
    return LANDCOVER_NAMES[hex] || null;
  }

  const info = $("info");
  const ICON = {
    street: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.5"/><path d="M12 9v6M9 21l3-6 3 6M8 12h8"/></svg>',
    map: '<svg class="i" viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14"/></svg>',
    osm: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><circle cx="12" cy="10" r="2"/></svg>',
    web: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.7 2.5 14.3 0 17M12 3.5c-2.5 2.7-2.5 14.3 0 17"/></svg>',
    copy: '<svg class="i" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V5h10"/></svg>',
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const selection = { obj: null };

  function showInfo({ title, sub, pills = [], facts = [], x, z, links = [] }) {
    const ll = toLatLon(x, z);
    $("info-title").textContent = title;
    $("info-sub").textContent = sub || "";
    $("info-pills").innerHTML = pills.map(([cls, text]) => `<span class="pill ${cls}">${esc(text)}</span>`).join("");
    const allFacts = [...facts, ["Ground", `${elevation(x, z).toFixed(0)} m above sea level`], ["Location", fmtLatLon(ll)]];
    $("info-facts").innerHTML = allFacts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    const lat = ll.lat.toFixed(6), lon = ll.lon.toFixed(6);
    const actions = [
      [`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`, ICON.street, "Street View"],
      [`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, ICON.map, "Google Maps"],
      ...links,
    ];
    $("info-actions").innerHTML =
      actions.map(([href, icon, text]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${icon}${esc(text)}</a>`).join("") +
      `<button type="button" id="copy-ll">${ICON.copy}Copy coordinates</button>`;
    $("copy-ll").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const text = `${lat}, ${lon}`;
      const done = () => { btn.lastChild.textContent = "Copied"; };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { btn.lastChild.textContent = text; });
      else btn.lastChild.textContent = text;
    });
    info.hidden = false;
  }
  function closeInfo() { info.hidden = true; setSelection(null); }
  $("info-close").addEventListener("click", closeInfo);

  // Selection outline (roof ring, base ring and corner posts) drawn on top.
  function setSelection(ringsFlat, h) {
    if (selection.obj) { groups.select.remove(selection.obj); selection.obj.geometry.dispose(); selection.obj = null; }
    if (ringsFlat) {
      const pts = [];
      for (const flat of ringsFlat) {
        const ring = toPairs(flat);
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          const pb = H(p[0], p[1]), qb = H(q[0], q[1]);
          pts.push(p[0], pb + h + 0.3, p[1], q[0], qb + h + 0.3, q[1]);
          pts.push(p[0], pb + 0.2, p[1], q[0], qb + 0.2, q[1]);
          pts.push(p[0], pb + 0.2, p[1], p[0], pb + h + 0.3, p[1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffb21e, depthTest: false, transparent: true }));
      m.renderOrder = 10;
      groups.select.add(m);
      selection.obj = m;
    }
    dirty = true;
  }

  const heightPill = (measured, tagged) =>
    tagged ? ["measured", "Height mapped"] : measured ? ["measured", "Height measured"] : ["estimated", "Height estimated"];
  function inspect(hit) {
    if (!hit) { closeInfo(); return; }
    const ud = hit.object.userData;
    if (ud.kind === "osm") {
      const b = D.buildings[ownerOf(ud.starts, hit.faceIndex)];
      const c = polyCentroid(b.r[0]);
      const pills = [["", pretty(b.t === "yes" ? "building" : b.t)], heightPill(b.hm, b.ht)];
      if (b.nw) pills.push(["new", "New since 2016"]);
      showInfo({
        title: b.n || pretty(b.t === "yes" ? "Building" : b.t + " building"),
        sub: "Mapped in OpenStreetMap",
        pills,
        facts: [["Height", `${b.h.toFixed(1)} m`], ["Footprint", `${fmtInt(polyArea(b.r[0]))} m²`]],
        x: c.x, z: c.z,
        links: [[`https://www.openstreetmap.org/?mlat=${toLatLon(c.x, c.z).lat.toFixed(6)}&mlon=${toLatLon(c.x, c.z).lon.toFixed(6)}#map=19/${toLatLon(c.x, c.z).lat.toFixed(6)}/${toLatLon(c.x, c.z).lon.toFixed(6)}`, ICON.osm, "OpenStreetMap"]],
      });
      setSelection(b.r, b.h);
    } else if (ud.kind === "ml") {
      const b = D.mlBld[ud.ids[ownerOf(ud.starts, hit.faceIndex)]];
      const ring = b.slice(4);
      const c = polyCentroid(ring);
      const src = ["Microsoft ML footprints", "Google Open Buildings", "Overture"][b[0]] || "Overture";
      const pills = [["", "Detected building"], heightPill(b[1] & 1, false)];
      if (b[1] & 2) pills.push(["new", "New since 2016"]);
      showInfo({
        title: "Building",
        sub: `Detected from satellite imagery (${src})`,
        pills,
        facts: [["Height", `${b[2].toFixed(1)} m`], ["Footprint", `${fmtInt(polyArea(ring))} m²`]],
        x: c.x, z: c.z,
      });
      setSelection([ring], b[2]);
    } else if (ud.kind === "poi" && hit.instanceId != null) {
      showPoi(poiList[hit.instanceId]);
    } else {
      const p = hit.point;
      const lc = landCoverAt(p.x, p.z);
      showInfo({
        title: lc || "Ground",
        sub: lc ? "Land cover from ESA WorldCover 2021" : "",
        facts: [],
        x: p.x, z: p.z,
      });
      setSelection(null);
    }
  }
  function showPoi(p) {
    const links = p.w ? [[p.w, ICON.web, "Website"]] : [];
    showInfo({
      title: p.n,
      sub: `${pretty(p.k)} · ${p.src === "ov" ? "Overture Maps" : "OpenStreetMap"}`,
      x: p.x, z: p.z, links,
    });
    setSelection(null);
  }

  // ---------- input -----------------------------------------------------------
  function panWorld(right, up) {
    const rx = Math.cos(goal.theta), rz = -Math.sin(goal.theta);
    const ux = -Math.sin(goal.theta), uz = -Math.cos(goal.theta);
    goal.x += right * rx + up * ux;
    goal.z += right * rz + up * uz;
  }
  const pointers = new Map();
  let pinch = 0, lastMoveT = 0, downAt = null;
  const sample = { theta: 0, phi: 0, x: 0, z: 0 };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 });
    pinch = 0; dragging = true; ease = EASE_INPUT;
    vel.theta = vel.phi = vel.x = vel.z = 0;
    sample.theta = sample.phi = sample.x = sample.z = 0;
    lastMoveT = performance.now();
    downAt = { x: e.clientX, y: e.clientY, t: lastMoveT, button: e.button };
    canvas.classList.add("dragging");
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (pointers.size === 0) {
      dragging = false;
      canvas.classList.remove("dragging");
      if (performance.now() - lastMoveT < 60) Object.assign(vel, sample);
      // A short press without movement is a click: inspect what is under the pointer.
      if (e.type === "pointerup" && downAt && downAt.button === 0 &&
          Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5 && performance.now() - downAt.t < 400) {
        vel.theta = vel.phi = vel.x = vel.z = 0;
        inspect(pick(e.clientX, e.clientY));
      }
      downAt = null;
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  let cursorPending = null;
  canvas.addEventListener("pointermove", (e) => {
    cursorPending = { x: e.clientX, y: e.clientY };
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const now = performance.now();
    const dt = Math.max(0.008, (now - lastMoveT) / 1000);
    lastMoveT = now;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const blend = (key, v) => { sample[key] = sample[key] * 0.5 + (v / dt) * 0.5; };
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) goal.radius *= pinch / d;
      pinch = d;
    } else if (p.pan || (e.buttons & 4)) {
      const s = view.radius * 0.0018;
      const bx = goal.x, bz = goal.z;
      panWorld(-dx * s, dy * s);
      blend("x", goal.x - bx); blend("z", goal.z - bz);
    } else if (e.buttons & 1) {
      goal.theta -= dx * 0.006;
      goal.phi -= dy * 0.006;
      blend("theta", -dx * 0.006); blend("phi", -dy * 0.006);
    }
    clampGoal();
  });
  canvas.addEventListener("pointerleave", () => { cursorPending = null; $("cursor").textContent = "Move over the map"; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const f = Math.exp(clamp(e.deltaY, -240, 240) * 0.0016);
    const before = goal.radius;
    goal.radius = clamp(goal.radius * f, 25, SPAN * 3);
    const p = groundUnder(e.clientX, e.clientY);
    if (p) {
      const ratio = goal.radius / before;
      goal.x = p.x + (goal.x - p.x) * ratio;
      goal.z = p.z + (goal.z - p.z) * ratio;
    }
    vel.theta = vel.phi = vel.x = vel.z = 0;
    ease = 9;
    clampGoal();
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    const p = groundUnder(e.clientX, e.clientY);
    if (p) flyTo(p.x, p.z, Math.max(150, goal.radius * 0.45));
  });

  // ---------- panel, layers, basemap ---------------------------------------------
  const panel = $("panel");
  $("panel-toggle").addEventListener("click", (e) => {
    const collapsed = panel.classList.toggle("collapsed");
    e.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  });
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll('[role="tab"]')) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        $(t.getAttribute("aria-controls")).hidden = !on;
      }
    });
  }
  document.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => PRESETS[btn.dataset.view]()));

  const labelLayer = $("labels");
  const setNewHighlight = (on) => {
    for (const m of pickables) {
      const c = m.userData.colours;
      if (!c) continue;
      m.geometry.attributes.color.array.set(on ? c.lit : c.base);
      m.geometry.attributes.color.needsUpdate = true;
    }
  };
  const toggles = {
    "ly-bld": (on) => (groups.bld.visible = on),
    "ly-ml": (on) => (groups.bldML.visible = on),
    "ly-new": (on) => setNewHighlight(on),
    "ly-trees": (on) => (groups.trees.visible = on),
    "ly-water": (on) => (groups.water.visible = on),
    "ly-land": (on) => (groups.land.visible = on),
    "ly-roads": (on) => (groups.roads.visible = on),
    "ly-rail": (on) => (groups.rail.visible = on),
    "ly-outline": (on) => (groups.outline.visible = on),
    "ly-pins": (on) => (groups.pins.visible = on),
    "ly-labels": (on) => labelLayer.classList.toggle("off", !on),
  };
  for (const [id, fn] of Object.entries(toggles)) $(id).addEventListener("change", (e) => { fn(e.target.checked); dirty = true; });
  const setLayer = (id, on) => { $(id).checked = on; toggles[id](on); };

  // Satellite: Sentinel-2 true colour, OSM land use and water hidden, roads semi-transparent.
  // Land cover: ESA WorldCover colours with OSM land use and water drawn on top.
  function setBasemap(mode) {
    const sat = mode === "satellite" && !!satTex;
    terrainMesh.material = sat ? terrainMats.satellite : terrainMats.map;
    matRoads.transparent = sat;
    matRoads.opacity = sat ? 0.55 : 1;
    matRoads.depthWrite = !sat;
    matRoads.needsUpdate = true;
    setLayer("ly-land", !sat);
    setLayer("ly-water", !sat);
    $("bm-satellite").setAttribute("aria-pressed", String(sat));
    $("bm-map").setAttribute("aria-pressed", String(!sat));
    dirty = true;
  }
  $("bm-satellite").addEventListener("click", () => setBasemap("satellite"));
  $("bm-map").addEventListener("click", () => setBasemap("map"));

  // ---------- places lists ---------------------------------------------------------
  function placeList(root, groupsMap, openFirst) {
    let first = true;
    for (const [g, list] of groupsMap) {
      const det = document.createElement("details");
      if (openFirst && first) det.open = true;
      first = false;
      det.innerHTML = `<summary>${esc(g)}<span class="n">${list.length}</span></summary>`;
      const box = document.createElement("div");
      box.className = "placelist";
      for (const item of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<span>${esc(item.label)}</span><small>${esc(item.hint || "")}</small>`;
        b.addEventListener("click", item.go);
        box.appendChild(b);
      }
      det.appendChild(box);
      root.appendChild(det);
    }
  }
  const officialGroups = new Map();
  for (const p of D.places || []) {
    if (!officialGroups.has(p.g)) officialGroups.set(p.g, []);
    officialGroups.get(p.g).push({
      label: p.n,
      hint: "",
      go: () => { flyTo(p.x, p.z, 420, 0.85); showInfo({ title: p.n, sub: p.g === "Colleges" ? "Constituent college (gbpuat.ac.in)" : p.g, facts: p.osm && p.osm !== p.n ? [["Name on map", p.osm]] : [], x: p.x, z: p.z }); setSelection(null); },
    });
  }
  placeList($("places-list"), officialGroups, true);
  {
    const byCat = new Map();
    for (const p of poiList) {
      const k = pretty(p.k);
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k).push({ label: p.n, hint: "", go: () => { flyTo(p.x, p.z, 380, 0.85); showPoi(p); } });
    }
    const top = [...byCat.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
    placeList($("poi-list"), new Map(top), false);
  }

  // ---------- search -----------------------------------------------------------------
  const searchIndex = [];
  {
    const seen = new Set();
    const add = (name, kind, x, z, open) => {
      const key = name.toLowerCase() + "|" + Math.round(x / 50) + "|" + Math.round(z / 50);
      if (!name || seen.has(key)) return;
      seen.add(key);
      searchIndex.push({ name, kind, x, z, lower: name.toLowerCase(), open });
    };
    for (const p of D.places || []) add(p.n, p.g === "Colleges" ? "College" : p.g.replace(/ \(.*/, ""), p.x, p.z, null);
    for (const p of poiList) add(p.n, pretty(p.k), p.x, p.z, () => showPoi(p));
    for (const l of D.labels) add(l.n, l.k === "bld" ? "Building" : pretty(l.k), l.x, l.z, null);
  }
  const findInput = $("find"), results = $("results");
  let resultItems = [], activeResult = -1;
  function runSearch() {
    const q = findInput.value.trim().toLowerCase();
    if (!q) { results.hidden = true; findInput.setAttribute("aria-expanded", "false"); return; }
    const words = q.split(/\s+/);
    resultItems = searchIndex
      .map((it) => {
        const kindLower = it.kind.toLowerCase();
        if (!words.every((w) => it.lower.includes(w) || kindLower.includes(w))) return null;
        const score = (it.lower.startsWith(q) ? 0 : it.lower.includes(q) ? 1 : 2) + (it.kind === "College" ? -0.5 : 0);
        return { it, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.it.name.length - b.it.name.length)
      .slice(0, 12)
      .map((r) => r.it);
    activeResult = resultItems.length ? 0 : -1;
    results.innerHTML = resultItems.length
      ? resultItems.map((it, i) => `<li role="option" id="res-${i}" aria-selected="${i === 0}"><span class="t">${esc(it.name)}</span><span class="k">${esc(it.kind)}</span></li>`).join("")
      : `<li class="empty">No match. Try a college, hostel (bhawan), bank or "atm".</li>`;
    results.hidden = false;
    findInput.setAttribute("aria-expanded", "true");
  }
  function chooseResult(i) {
    const it = resultItems[i];
    if (!it) return;
    flyTo(it.x, it.z, it.kind === "Building" ? 380 : 450, 0.85);
    if (it.open) it.open();
    else { showInfo({ title: it.name, sub: it.kind, x: it.x, z: it.z }); setSelection(null); }
    results.hidden = true;
    findInput.setAttribute("aria-expanded", "false");
    findInput.blur();
  }
  findInput.addEventListener("input", runSearch);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!resultItems.length) return;
      activeResult = (activeResult + (e.key === "ArrowDown" ? 1 : -1) + resultItems.length) % resultItems.length;
      results.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === activeResult)));
      $("res-" + activeResult).scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { chooseResult(Math.max(0, activeResult)); }
    else if (e.key === "Escape") { results.hidden = true; findInput.blur(); }
  });
  results.addEventListener("click", (e) => {
    const li = e.target.closest("li[role=option]");
    if (li) chooseResult(Number(li.id.slice(4)));
  });

  // ---------- map controls -------------------------------------------------------------
  $("zoom-in").addEventListener("click", () => { goal.radius = clamp(goal.radius * 0.6, 25, SPAN * 3); ease = 8; });
  $("zoom-out").addEventListener("click", () => { goal.radius = clamp(goal.radius / 0.6, 25, SPAN * 3); ease = 8; });
  $("compass").addEventListener("click", () => {
    goal.theta = Math.round(goal.theta / (Math.PI * 2)) * Math.PI * 2; // nearest "north up"
    ease = 6;
  });
  $("tilt").addEventListener("click", () => { goal.phi = goal.phi > 0.3 ? 0.03 : 0.85; ease = 6; });
  $("fullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  $("shot").addEventListener("click", () => {
    setScale(STILL_SCALE);
    updateChunks();
    renderer.render(scene, camera);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      const d = new Date();
      a.download = `gbpuat-twin-${d.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  });
  const help = $("help");
  $("help-btn").addEventListener("click", () => { help.hidden = false; $("help-close").focus(); });
  $("help-close").addEventListener("click", () => { help.hidden = true; });
  help.addEventListener("click", (e) => { if (e.target === help) help.hidden = true; });

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "/") { e.preventDefault(); panel.classList.remove("collapsed"); findInput.focus(); return; }
    if (e.key === "?") { help.hidden = !help.hidden; return; }
    if (e.key === "Escape") { help.hidden = true; closeInfo(); return; }
    const stepM = goal.radius * 0.08;
    const moves = { ArrowLeft: [-stepM, 0], ArrowRight: [stepM, 0], ArrowUp: [0, stepM], ArrowDown: [0, -stepM] };
    if (moves[e.key]) panWorld(...moves[e.key]);
    else if (e.key === "+" || e.key === "=") goal.radius *= 0.8;
    else if (e.key === "-" || e.key === "_") goal.radius *= 1.25;
    else if (e.key === "q" || e.key === "Q") goal.theta += 0.12;
    else if (e.key === "e" || e.key === "E") goal.theta -= 0.12;
    else if (e.key === "r" || e.key === "R") { PRESETS.overview(); return; }
    else return;
    ease = 10;
    clampGoal();
  });

  // ---------- labels (with collision avoidance) ---------------------------------------
  await step(90, "Placing labels");
  const labelItems = [];
  {
    const collegeNames = new Set((D.places || []).filter((p) => p.g === "Colleges").map((p) => p.osm));
    const frag = document.createDocumentFragment();
    for (const L of D.labels) {
      if (!L.n) continue;
      const k = collegeNames.has(L.n) ? "college" : L.k;
      const el = document.createElement("div");
      el.className = "lbl k-" + k;
      el.textContent = L.n;
      frag.appendChild(el);
      labelItems.push({
        el, shown: false, pri: LABEL_PRIORITY[k] ?? 4, range: LABEL_RANGE[k] || 1500,
        w: L.n.length * 6.2 + 16, wp: new THREE.Vector3(L.x, H(L.x, L.z) + 8, L.z),
      });
    }
    labelItems.sort((a, b) => a.pri - b.pri);
    labelLayer.appendChild(frag);
  }
  const _p = new THREE.Vector3();
  function updateLabels() {
    if (labelLayer.classList.contains("off")) return;
    const w = window.innerWidth, h = window.innerHeight;
    const placed = [];
    for (const L of labelItems) {
      let show = false, px = 0, py = 0;
      if (camera.position.distanceTo(L.wp) <= L.range) {
        _p.copy(L.wp).project(camera);
        if (_p.z < 1 && _p.z > -1 && Math.abs(_p.x) < 1.02 && Math.abs(_p.y) < 1.02) {
          px = (_p.x * 0.5 + 0.5) * w;
          py = (-_p.y * 0.5 + 0.5) * h;
          const r = [px - L.w / 2, py - 26, px + L.w / 2, py - 6];
          show = !placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
          if (show) placed.push(r);
        }
      }
      if (show) {
        if (!L.shown) { L.el.style.display = "block"; L.shown = true; }
        L.el.style.left = px.toFixed(0) + "px";
        L.el.style.top = py.toFixed(0) + "px";
      } else if (L.shown) {
        L.el.style.display = "none";
        L.shown = false;
      }
    }
  }

  // ---------- readouts: scale bar, compass, cursor ----------------------------------
  const scaleText = $("scale-text"), scaleBar = $("scale-bar"), compassSvg = $("compass").querySelector("svg");
  function updateReadouts() {
    const dist = camera.position.distanceTo(view.target);
    const mpp = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / window.innerHeight;
    const target = mpp * 110;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() || pow;
    scaleBar.style.width = (nice / mpp).toFixed(0) + "px";
    scaleText.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    compassSvg.style.transform = `rotate(${view.theta}rad)`;
    $("tilt").setAttribute("aria-pressed", String(goal.phi < 0.3));
  }
  function updateCursor() {
    if (!cursorPending) return;
    const p = groundUnder(cursorPending.x, cursorPending.y);
    cursorPending = null;
    if (!p) return;
    $("cursor").textContent = `${fmtLatLon(toLatLon(p.x, p.z))} · ${elevation(p.x, p.z).toFixed(0)} m`;
  }

  // ---------- chunk visibility ---------------------------------------------------------
  function updateChunks() {
    const cp = camera.position;
    for (const c of mlChunks) {
      const dx = c.x - cp.x, dz = c.z - cp.z;
      c.mesh.visible = dx * dx + dz * dz + cp.y * cp.y < ML_RANGE * ML_RANGE;
    }
    for (const c of treeChunks) {
      const d2 = (c.x - cp.x) ** 2 + (c.z - cp.z) ** 2 + cp.y * cp.y;
      c.hi.visible = d2 < TREE_HI_RANGE * TREE_HI_RANGE;
      c.lo.visible = !c.hi.visible && d2 < TREE_LO_RANGE * TREE_LO_RANGE;
    }
  }

  // ---------- data tab ------------------------------------------------------------------
  {
    const ml = D.mlBld || [];
    const measured = ml.filter((b) => b[1] & 1).length + D.buildings.filter((b) => b.hm || b.ht).length;
    const newer = ml.filter((b) => b[1] & 2).length + D.buildings.filter((b) => b.nw).length;
    const facts = [
      ["Mapped buildings", fmtInt(D.buildings.length)],
      ["Detected buildings", fmtInt(ml.length)],
      ["Heights measured", fmtInt(measured)],
      ["New since 2016", fmtInt(newer)],
      ["Trees", fmtInt((D.trees || []).length / 3)],
      ["Places of interest", fmtInt(poiList.length)],
      ["Road segments", fmtInt(D.roads.length)],
      ["Area covered", "11.7 × 8.9 km"],
    ];
    $("facts").innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    $("sources").innerHTML = (D.meta.sources || []).map((s) => {
      let t = `${s.layer}: ${s.name}`;
      if (s.date) t += ` (${s.date})`;
      if (s.release) t += ` (release ${s.release})`;
      return `<li>${esc(t)} - ${esc(s.licence)}</li>`;
    }).join("");
  }

  // ---------- adaptive resolution + render loop ---------------------------------------
  const DPR = window.devicePixelRatio || 1;
  const STILL_SCALE = clamp(DPR * 1.5, 1, 2);
  const MOTION_MAX = Math.min(DPR, 1.25), MOTION_MIN = 0.45;
  let motionScale = Math.min(DPR, 1), currentScale = 0;
  function setScale(sc) {
    sc = Math.round(sc * 20) / 20;
    if (sc === currentScale) return;
    currentScale = sc;
    renderer.setPixelRatio(sc);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  window.addEventListener("resize", resize);

  const stTri = $("st-tri"), stCalls = $("st-calls"), stMs = $("st-ms");
  let lastFrame = performance.now(), wasMoving = false, stillPending = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - lastFrame) / 1000;
    const dt = Math.min(0.25, Math.max(0, rawDt));
    lastFrame = now;
    updateCursor();
    const moving = cameraMoving() || dragging;
    if (moving) {
      stepCamera(dt);
      dirty = true;
      if (wasMoving && rawDt > 0 && rawDt < 0.25) { // ignore gaps from hidden tabs
        if (rawDt > 1 / 40) motionScale = Math.max(MOTION_MIN, motionScale * 0.88);
        else if (rawDt < 1 / 56) motionScale = Math.min(MOTION_MAX, motionScale * 1.04);
      }
    } else if (wasMoving) {
      stillPending = true; // camera just stopped: draw one sharp frame
    }
    wasMoving = moving;
    if (!dirty && !stillPending) return;
    dirty = false;
    setScale(moving ? motionScale : STILL_SCALE);
    stillPending = false;
    const t0 = performance.now();
    updateChunks();
    renderer.render(scene, camera);
    updateLabels();
    updateReadouts();
    stTri.textContent = fmtInt(renderer.info.render.triangles);
    stCalls.textContent = renderer.info.render.calls;
    stMs.textContent = `${(performance.now() - t0).toFixed(1)} ms @ ${currentScale.toFixed(2)}x`;
  }

  // ---------- start -----------------------------------------------------------------
  await step(100, "Ready");
  const startPreset = { "#core": "core", "#farms": "farms", "#top": "top" }[location.hash];
  view.target.set(campusCore.x, 0, campusCore.z);
  view.radius = SPAN * 0.5;
  view.phi = 0.9;
  Object.assign(goal, { x: campusCore.x, z: campusCore.z, radius: view.radius, phi: view.phi, theta: view.theta });
  if (startPreset === "core") Object.assign(view, { radius: 1700, phi: 0.8 });
  if (startPreset === "top") view.phi = 0.03;
  if (startPreset === "farms") { view.target.set(farmCentre.x, 0, farmCentre.z); view.radius = 3200; }
  Object.assign(goal, { x: view.target.x, z: view.target.z, radius: view.radius, phi: view.phi });
  setBasemap(satTex ? "satellite" : "map");
  resize();
  applyView();
  requestAnimationFrame(frame);
  $("loading").hidden = true;
  // Debug/test handle. settle() finishes any camera motion synchronously and renders once, so
  // scripted checks work even where the browser pauses animation frames (hidden tabs).
  const settle = () => {
    for (let i = 0; i < 600 && cameraMoving(); i++) stepCamera(1 / 30);
    applyView();
    camera.updateMatrixWorld();
    updateChunks();
    renderer.render(scene, camera);
    updateLabels();
    updateReadouts();
  };
  window.__twin = { scene, camera, renderer, view, goal, flyTo, groups, H, setScale, inspect, pick, settle, mlChunks, treeChunks };
})();
