/* GBPUAT Pantnagar digital twin - viewer.
 *
 * Low-compute design:
 *  - Everything is merged on load into a few BufferGeometries (one draw call per layer).
 *  - Terrain is one indexed grid mesh; overlays are draped onto it once at load time.
 *  - Trees and points of interest are InstancedMesh (a handful of draw calls in total).
 *  - The scene renders on demand (after input, animation or resize), not every frame.
 *  - No shadows, no post-processing, pixel ratio capped at 1.5, low-power GPU hint.
 *  - Labels are plain DOM nodes projected to the screen; only nearby labels are shown.
 */
(function () {
  "use strict";

  const D = window.CAMPUS_DATA;
  const statusEl = document.getElementById("status");
  if (!window.THREE || !D) {
    statusEl.textContent = "Missing vendor/three.min.js or data/campus-data.js";
    return;
  }

  // ---------- constants -------------------------------------------------------
  const B = D.meta.bounds;
  const CX = (B.x0 + B.x1) / 2;
  const CZ = (B.z0 + B.z1) / 2;
  const SPAN = Math.max(B.x1 - B.x0, B.z1 - B.z0);
  const SKY = 0xd9e5ec; // horizon colour (fog); the sky gradient itself is CSS behind the canvas
  const GROUND_COLOUR = 0xcfc39c;

  const WALL_TILE_M = 3.0;   // one window bay every 3 m horizontally
  const STOREY_M = 3.3;      // one window row per storey
  const WALL_BASE_SHADE = 0.62; // wall colour at ground level relative to the eaves (fake ambient occlusion)
  // Overlays are draped on a 150 m SRTM grid whose cells carry a few metres of noise, so they
  // are subdivided finely and lifted ~1 m to stay above the surface everywhere.
  const DRAPE_MAX_EDGE = 80; // triangles larger than this are subdivided before draping
  const ROAD_MAX_SEG = 40;   // polylines are densified to this step before draping

  const BUILDING_STYLE = {
    university: [0xd9c7a3, 0x8e5b3e],
    college: [0xd9c7a3, 0x8e5b3e],
    school: [0xe4d5b5, 0x9a5f42],
    hospital: [0xf1f1ee, 0x9fb3bd],
    hostel: [0xcfbc98, 0x7a4d37],
    dormitory: [0xcfbc98, 0x7a4d37],
    retail: [0xd7d2c9, 0x6e6e6e],
    commercial: [0xd7d2c9, 0x6e6e6e],
    industrial: [0xbdbdb8, 0x55595c],
    warehouse: [0xbdbdb8, 0x55595c],
    church: [0xf2efe6, 0xb0453b],
    temple: [0xf2efe6, 0xb0453b],
    default: [0xe6dccb, 0x9b6a4b],
  };

  // land-use class -> [colour, height above terrain (m)]. Stacked slightly to avoid z-fighting.
  const AREA_STYLE = {
    water: [0x3d7fb3, 1.4],
    grass: [0x9cc27f, 1.2],
    forest: [0x4f7f43, 1.3],
    scrub: [0xa6b274, 1.25],
    farm: [0xc7b56a, 1.15],
    sport: [0xa5d08f, 1.35],
    residential: [0xd8d0b6, 1.3],
    commercial: [0xcdc6b6, 1.32],
    cemetery: [0x9db09d, 1.28],
    paved: [0xb9b7b2, 1.36],
    campus: [0xc8e0b0, 1.45],
    other: [0xcbc3a2, 1.2],
  };

  // road class -> [colour, height above terrain (m)]
  const ROAD_STYLE = {
    motorway: [0x6f6f6f, 1.9], trunk: [0x6f6f6f, 1.9], trunk_link: [0x6f6f6f, 1.85],
    primary: [0x737373, 1.85], secondary: [0x7d7d7d, 1.8], tertiary: [0x8a8a8a, 1.78],
    unclassified: [0x9a9a9a, 1.75], residential: [0x9a9a9a, 1.75], living_street: [0xaaa79f, 1.72],
    road: [0x9a9a9a, 1.75], service: [0xb3afa6, 1.7], pedestrian: [0xc8c2b8, 1.68],
    track: [0xb09a73, 1.65], path: [0xcbb994, 1.62], footway: [0xcbb994, 1.62],
    cycleway: [0xcbb994, 1.62], steps: [0xcbb994, 1.62], bridleway: [0xb09a73, 1.62],
  };

  const LABEL_RANGE = { bld: 900, poi: 2200, campus: 3200, sport: 2600, grass: 2600, farm: 4500, water: 4500 };

  // ---------- helpers -----------------------------------------------------------
  // Hex colours are sRGB; convert to the linear working space so they match sRGB textures.
  const hexRGB = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hashUnit = (n) => {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  const toVec2 = (flat) => {
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return out;
  };
  // Triangulate polygon rings (rings[0] = outer, rest = holes) in local x/z.
  function triangulate(rings) {
    const contour = toVec2(rings[0]);
    const holes = rings.slice(1).map(toVec2);
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes); // mutates input arrays
    const pts = contour.concat(...holes);
    return { pts, faces };
  }
  function polyCentroid(flat) {
    let x = 0, z = 0;
    const n = flat.length / 2;
    for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; }
    return { x: x / n, z: z / n };
  }

  // ---------- terrain ---------------------------------------------------------
  const T = D.terrain || null;
  // Scene height (m above terrain.base) at local x/z. Interpolates on exactly the two triangles
  // per grid cell that buildTerrainMesh() uses, so draped overlays sit on the drawn surface.
  function H(x, z) {
    if (!T) return 0;
    const fx = clamp((x - T.x0) / T.dx, 0, T.nx - 1.0001);
    const fz = clamp((z - T.z0) / T.dz, 0, T.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = T.h;
    const a = h[j * T.nx + i];          // (i, j)
    const b = h[j * T.nx + i + 1];      // (i+1, j)
    const c = h[(j + 1) * T.nx + i];    // (i, j+1)
    const d = h[(j + 1) * T.nx + i + 1];
    if (tx + tz <= 1) return a + tx * (b - a) + tz * (c - a);  // triangle a, b, c
    return d + (1 - tx) * (c - d) + (1 - tz) * (b - d);        // triangle b, c, d
  }

  // Terrain mesh: indexed grid over the region, shaded with normals computed from the grid.
  function buildTerrainMesh() {
    const nx = T.nx, nz = T.nz;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = T.x0 + i * T.dx;
        pos[k + 1] = T.h[j * nx + i];
        pos[k + 2] = T.z0 + j * T.dz;
      }
    }
    // UV spans the whole study window (textures are in lon/lat over it, north at the top).
    const uv = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        uv[(j * nx + i) * 2] = i / (nx - 1);
        uv[(j * nx + i) * 2 + 1] = 1 - j / (nz - 1);
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
  // Vertex batch: positions, flat normals from winding, colours, optional UVs.
  class Batch {
    constructor(withUV) {
      this.pos = []; this.nor = []; this.col = []; this.uv = withUV ? [] : null;
    }
    tri(a, b, c, rgb, uva, uvb, uvc) {
      this.tri3(a, b, c, rgb, rgb, rgb, uva, uvb, uvc);
    }
    // Same as tri() but with a colour per vertex (used for the darker wall bases).
    tri3(a, b, c, ca, cb, cc, uva, uvb, uvc) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const p of [a, b, c]) this.pos.push(p[0], p[1], p[2]);
      for (let i = 0; i < 3; i++) this.nor.push(nx, ny, nz);
      this.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
      if (this.uv) {
        for (const q of [uva || [0, 0], uvb || [0, 0], uvc || [0, 0]]) this.uv.push(q[0], q[1]);
      }
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
  // (Longest-edge bisection keeps the count proportional to area, even for long thin slivers.)
  function subdivide(a, b, c, maxLen, out, depth = 0) {
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const lab = d(a, b), lbc = d(b, c), lca = d(c, a);
    const L = Math.max(lab, lbc, lca);
    if (L <= maxLen || depth > 24) {
      out.push([a, b, c]);
      return out;
    }
    const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (L === lab) {
      const mm = m(a, b);
      subdivide(a, mm, c, maxLen, out, depth + 1);
      subdivide(mm, b, c, maxLen, out, depth + 1);
    } else if (L === lbc) {
      const mm = m(b, c);
      subdivide(a, b, mm, maxLen, out, depth + 1);
      subdivide(a, mm, c, maxLen, out, depth + 1);
    } else {
      const mm = m(c, a);
      subdivide(a, b, mm, maxLen, out, depth + 1);
      subdivide(mm, b, c, maxLen, out, depth + 1);
    }
    return out;
  }

  // Polygon (rings) draped on terrain at a constant height above it.
  function addDrapedPolygon(batch, rings, lift, rgb) {
    const { pts, faces } = triangulate(rings);
    for (const f of faces) {
      const tris = subdivide([pts[f[0]].x, pts[f[0]].y], [pts[f[1]].x, pts[f[1]].y], [pts[f[2]].x, pts[f[2]].y], DRAPE_MAX_EDGE, []);
      for (const [a, b, c] of tris) {
        batch.tri(
          [a[0], H(a[0], a[1]) + lift, a[1]],
          [b[0], H(b[0], b[1]) + lift, b[1]],
          [c[0], H(c[0], c[1]) + lift, c[1]],
          rgb
        );
      }
    }
  }

  // Densify a flat polyline so no step is longer than maxLen.
  function densify(flat, maxLen) {
    const out = [];
    for (let i = 0; i < flat.length - 2; i += 2) {
      const x0 = flat[i], z0 = flat[i + 1], x1 = flat[i + 2], z1 = flat[i + 3];
      out.push([x0, z0]);
      const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / maxLen);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([lerp(x0, x1, t), lerp(z0, z1, t)]);
      }
    }
    if (flat.length >= 2) out.push([flat[flat.length - 2], flat[flat.length - 1]]);
    return out;
  }

  // Road / waterway / rail ribbon with mitred joins, draped on terrain.
  function ribbon(batch, flat, width, lift, rgb) {
    const P = [];
    for (const p of densify(flat, ROAD_MAX_SEG)) {
      const last = P[P.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 0.05 || Math.abs(last[1] - p[1]) > 0.05) P.push(p);
    }
    const m = P.length;
    if (m < 2) return;
    const hw = width / 2;
    const segN = (a, b) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    };
    const L = [], R = [];
    for (let i = 0; i < m; i++) {
      let mx, mz, s;
      if (i === 0) { [mx, mz] = segN(P[0], P[1]); s = hw; }
      else if (i === m - 1) { [mx, mz] = segN(P[m - 2], P[m - 1]); s = hw; }
      else {
        const n1 = segN(P[i - 1], P[i]);
        const n2 = segN(P[i], P[i + 1]);
        mx = n1[0] + n2[0]; mz = n1[1] + n2[1];
        const ml = Math.hypot(mx, mz) || 1;
        mx /= ml; mz /= ml;
        s = hw / Math.max(0.35, mx * n1[0] + mz * n1[1]);
      }
      const lx = P[i][0] + mx * s, lz = P[i][1] + mz * s;
      const rx = P[i][0] - mx * s, rz = P[i][1] - mz * s;
      L.push([lx, H(lx, lz) + lift, lz]);
      R.push([rx, H(rx, rz) + lift, rz]);
    }
    for (let i = 0; i < m - 1; i++) {
      batch.tri(L[i], R[i], L[i + 1], rgb);
      batch.tri(R[i], R[i + 1], L[i + 1], rgb);
    }
  }

  // ---------- renderer / scene ------------------------------------------------
  const canvas = document.getElementById("view");
  let renderer;
  try {
    // No MSAA and no logarithmic depth: both are expensive on integrated GPUs. Edges are smoothed
    // by rendering the still frame supersampled instead (see the render loop).
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    statusEl.textContent = "WebGL is not available in this browser.";
    return;
  }
  // Resolution scale is managed by the render loop (adaptive while moving, supersampled when still).
  renderer.setPixelRatio(1);
  renderer.setClearColor(SKY, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY, SPAN * 1.2, SPAN * 4);
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x8b7d5a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff3dd, 0.95);
  sun.position.set(-900, 1400, 700);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 60000);

  const groups = {
    terrain: new THREE.Group(), bld: new THREE.Group(), land: new THREE.Group(), water: new THREE.Group(),
    roads: new THREE.Group(), rail: new THREE.Group(), trees: new THREE.Group(), pins: new THREE.Group(),
    bldML: new THREE.Group(), outline: new THREE.Group(),
  };
  Object.values(groups).forEach((g) => scene.add(g));

  // Ground: draped terrain (or a flat plane when no elevation data is present).
  const IMG = window.CAMPUS_IMAGERY || {};
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
    // Map: lit land-cover colours (OSM land use is draped on top). Satellite: unlit, true colours.
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
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: GROUND_COLOUR }));
    m.position.set(CX, 0, CZ);
    groups.terrain.add(m);
  }
  // Large base under everything so the edge of the region never shows a hole.
  {
    const g = new THREE.PlaneGeometry(SPAN * 6, SPAN * 6);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: GROUND_COLOUR }));
    m.position.set(CX, -8, CZ);
    groups.terrain.add(m);
  }

  // Wall/roof texture: white wall with dark window glazing (one 128px canvas, repeated).
  const windowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = "#2c3b4a";
    x.fillRect(34, 40, 60, 46);     // window
    x.fillStyle = "#e9eef2";
    x.fillRect(62, 40, 4, 46);      // mullion
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 2;
    return t;
  })();

  // Buildings: walls + roofs in one draw call. Each vertex sits on the terrain under it.
  const bBatch = new Batch(true);
  for (const b of D.buildings) {
    const style = BUILDING_STYLE[b.t] || BUILDING_STYLE.default;
    const jitter = 0.94 + 0.12 * hashUnit(b.id % 100003);
    const wall = hexRGB(style[0]).map((c) => c * jitter);
    let roof = hexRGB(style[1]).map((c) => c * jitter);
    if (b.rc) {
      // Blend the default roof with the colour seen on the satellite image.
      const sat = hexRGB(b.rc);
      roof = roof.map((c, k) => c * 0.4 + sat[k] * 0.6);
    }
    const wallBase = wall.map((c) => c * WALL_BASE_SHADE);
    const h = b.h;
    const rings = b.r.map((flat) => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      return pts;
    });
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 0.2) continue;
        const u1 = len / WALL_TILE_M, v1 = h / STOREY_M;
        const pb = H(p[0], p[1]), qb = H(q[0], q[1]);
        const A = [p[0], pb, p[1]], Bv = [q[0], qb, q[1]];
        const C = [q[0], qb + h, q[1]], Dv = [p[0], pb + h, p[1]];
        bBatch.tri3(A, Bv, C, wallBase, wallBase, wall, [0, 0], [u1, 0], [u1, v1]);
        bBatch.tri3(A, C, Dv, wallBase, wall, wall, [0, 0], [u1, v1], [0, v1]);
      }
    }
    const { pts, faces } = triangulate(b.r);
    for (const f of faces) {
      const pa = pts[f[0]], pb2 = pts[f[1]], pc = pts[f[2]];
      bBatch.tri(
        [pa.x, H(pa.x, pa.y) + h, pa.y],
        [pb2.x, H(pb2.x, pb2.y) + h, pb2.y],
        [pc.x, H(pc.x, pc.y) + h, pc.y],
        roof, [0.02, 0.02], [0.02, 0.02], [0.02, 0.02]
      );
    }
  }
  groups.bld.add(new THREE.Mesh(
    bBatch.geometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTex, side: THREE.DoubleSide })
  ));

  // Land use (non-water) and water polygons, draped.
  const matVC = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const landBatch = new Batch(false);
  const waterBatch = new Batch(false);
  for (const a of D.areas) {
    const [colour, lift] = AREA_STYLE[a.k] || AREA_STYLE.other;
    addDrapedPolygon(a.k === "water" ? waterBatch : landBatch, a.r, lift, hexRGB(colour));
  }
  groups.land.add(new THREE.Mesh(landBatch.geometry(), matVC));

  // Outlines of the named university areas mapped in OSM (campus and farm polygons), draped.
  {
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

  // Roads, waterways, rail, power lines.
  const roadBatch = new Batch(false);
  const railBatch = new Batch(false);
  const waterLineBatch = new Batch(false);
  const powerPts = [];
  for (const r of D.roads) {
    const [colour, lift] = ROAD_STYLE[r.c] || [0x9a9a9a, 1.75];
    const width = Math.max(r.w, r.c === "track" || r.c === "path" ? 2.0 : 3.0);
    ribbon(roadBatch, r.p, width, lift, hexRGB(colour));
  }
  for (const l of D.lines) {
    if (l.k.startsWith("waterway:")) {
      ribbon(waterLineBatch, l.p, Math.max(l.w, 1.6), 1.6, hexRGB(0x3d7fb3));
    } else if (l.k === "rail") {
      ribbon(railBatch, l.p, 3.2, 2.0, hexRGB(0x6b6258));
    } else if (l.k === "power") {
      const p = l.p;
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        powerPts.push(ax, H(ax, az) + 14, az, bx, H(bx, bz) + 14, bz);
      }
    }
  }
  const matRoads = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  groups.roads.add(new THREE.Mesh(roadBatch.geometry(), matRoads));
  groups.rail.add(new THREE.Mesh(railBatch.geometry(), matVC));
  groups.water.add(new THREE.Mesh(waterBatch.geometry(), matVC));
  groups.water.add(new THREE.Mesh(waterLineBatch.geometry(), matVC));
  if (powerPts.length) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(powerPts, 3));
    groups.rail.add(new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: 0x222222 })));
  }

  // Trees: real crowns found as local maxima in the Meta/WRI 1.2 m canopy-height model, with their
  // measured heights. One octahedron per crown (8 triangles), instanced in a single draw call.
  {
    const t = D.trees || [];
    const n = Math.floor(t.length / 3);
    const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, n));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const greens = [0x3f7a3a, 0x4d8a3f, 0x2f6b35, 0x5c9447, 0x6f9a45].map((h) => new THREE.Color(h));
    const yAxis = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = t[3 * i], z = t[3 * i + 1], h = t[3 * i + 2];
      const r = clamp(0.2 * h + 1.0, 1.6, 5.5);
      const j1 = hashUnit(i + 1), j2 = hashUnit(i + 101), j3 = hashUnit(i + 211);
      q.setFromAxisAngle(yAxis, j2 * Math.PI);
      pos.set(x, H(x, z) + h * 0.62, z);
      sc.set(r * (0.85 + 0.3 * j3), h * 0.42, r * (0.85 + 0.3 * j2));
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(i, m4);
      // Taller crowns read darker; a little per-tree variation keeps stands from looking uniform.
      col.copy(greens[Math.floor(j1 * greens.length)]).multiplyScalar(clamp(1.15 - h / 60, 0.75, 1.1));
      mesh.setColorAt(i, col);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    groups.trees.add(mesh);
    groups.trees.userData.count = n;
  }

  // Extra buildings (Google / Microsoft ML footprints via Overture): oriented boxes, instanced and
  // chunked into 600 m cells so chunks far from the camera are skipped entirely.
  const mlChunks = [];
  {
    const mb = D.mlBoxes || [];
    const CH = 600;
    const buckets = new Map();
    for (let i = 0; i < mb.length; i += 6) {
      const k = Math.floor(mb[i] / CH) + "," + Math.floor(mb[i + 1] / CH);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
    // Unit box with per-vertex shade: darker at ground level, full brightness on the roof.
    const box = new THREE.BoxGeometry(1, 1, 1);
    {
      const p = box.attributes.position, nrm = box.attributes.normal;
      const shade = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const s0 = nrm.getY(v) > 0.5 ? 1 : p.getY(v) < 0 ? WALL_BASE_SHADE : 0.92;
        shade[v * 3] = shade[v * 3 + 1] = shade[v * 3 + 2] = s0;
      }
      box.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    }
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const roofs = D.mlRoof || [];
    const tint = new THREE.Color(), satC = new THREE.Color();
    const palette = [0xe8dfd0, 0xd9cdb8, 0xcfc7bb, 0xe3d6c2, 0xc2baab].map((h) => new THREE.Color(h));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const [key, idxs] of buckets) {
      const mesh = new THREE.InstancedMesh(box, mat, idxs.length);
      idxs.forEach((i, n) => {
        const cx = mb[i], cz = mb[i + 1], w = mb[i + 2], d = mb[i + 3], ang = mb[i + 4], h = mb[i + 5];
        q.setFromAxisAngle(yAxis, -ang);          // footprint angle runs x -> z; three.js yaw runs x -> -z
        pos.set(cx, H(cx, cz) + h / 2 - 0.3, cz); // sunk 0.3 m so the base never floats on a slope
        sc.set(w, h + 0.6, d);
        m4.compose(pos, q, sc);
        mesh.setMatrixAt(n, m4);
        tint.copy(palette[Math.floor(hashUnit(i + 7) * palette.length)]);
        const rc = roofs[i / 6];
        if (rc) tint.lerp(satC.setHex(rc), 0.55); // tone matches the satellite image under it
        mesh.setColorAt(n, tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
      const [kx, kz] = key.split(",").map(Number);
      groups.bldML.add(mesh);
      mlChunks.push({ mesh, x: (kx + 0.5) * CH, z: (kz + 0.5) * CH });
    }
  }
  const ML_RANGE = 3200; // metres from the camera beyond which ML building chunks are not drawn
  function updateMlChunks() {
    const cp = camera.position;
    for (const c of mlChunks) {
      const dx = c.x - cp.x, dz = c.z - cp.z;
      c.mesh.visible = dx * dx + dz * dz + cp.y * cp.y < ML_RANGE * ML_RANGE;
    }
  }

  // Points of interest: small markers above the ground.
  {
    const pts = D.points.filter((p) => p.n);
    const g = new THREE.OctahedronGeometry(2.4, 0);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xe4572e }), Math.max(1, pts.length));
    const m4 = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m4.makeTranslation(p.x, H(p.x, p.z) + 12, p.z);
      mesh.setMatrixAt(i, m4);
    });
    mesh.count = pts.length;
    mesh.instanceMatrix.needsUpdate = true;
    groups.pins.add(mesh);
  }

  const counts = {
    buildings: D.buildings.length,
    areas: D.areas.length,
    roads: D.roads.length,
    trees: groups.trees.userData.count || 0,
    ml: (D.mlBoxes || []).length / 6,
  };

  // ---------- camera ----------------------------------------------------------
  // Input moves a `goal`; the visible `view` eases toward it every frame (exponential smoothing).
  // That gives smooth drags, a short glide after a fling, eased zoom and soft fly-tos, while the
  // scene still renders only while something is actually moving.
  const view = { target: new THREE.Vector3(CX, 0, CZ), theta: 0.55, phi: 0.82, radius: SPAN * 0.7 };
  const goal = { x: CX, z: CZ, theta: 0.55, phi: 0.82, radius: SPAN * 0.7 };
  const vel = { theta: 0, phi: 0, x: 0, z: 0 }; // glide velocity after a fling (units per second)
  const EASE_INPUT = 14, EASE_FLY = 3.2;        // 1/s; higher = snappier
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
      goal.theta += vel.theta * dt; goal.phi += vel.phi * dt;
      goal.x += vel.x * dt; goal.z += vel.z * dt;
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

  // Soft fly-to: set the goal and ease toward it more slowly than for direct input.
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
  const campusCore = D.meta.core || avgOf(
    D.labels.filter((l) => l.k === "bld" && /Bhawan|Hostel|College|Library|Office|University|Hall|Centre|Center/i.test(l.n)),
    { x: CX, z: CZ }
  );
  const farmCentre = avgOf(D.areas.filter((a) => a.k === "farm").map((a) => polyCentroid(a.r[0])), { x: CX, z: CZ });

  const PRESETS = {
    overview: () => flyTo(campusCore.x, campusCore.z, SPAN * 0.5, 0.9),
    top: () => flyTo(campusCore.x, campusCore.z, SPAN * 0.5, 0.03),
    core: () => flyTo(campusCore.x, campusCore.z, 1700, 0.8),
    farms: () => flyTo(farmCentre.x, farmCentre.z, 3200, 0.9),
  };
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => PRESETS[btn.dataset.view]());
  });

  // ---------- input -----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _ndcPt = new THREE.Vector2(), _hit = new THREE.Vector3();
  // Point on the ground under a screen position (the plane at the target's height).
  function groundUnder(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    _ndcPt.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndcPt, camera);
    groundPlane.constant = -view.target.y;
    if (!raycaster.ray.intersectPlane(groundPlane, _hit)) return null;
    if (_hit.distanceTo(camera.position) > view.radius * 6) return null; // too close to the horizon
    return { x: _hit.x, z: _hit.z };
  }

  // Move the goal along the screen-right / screen-up directions on the ground plane.
  function panWorld(right, up) {
    const rx = Math.cos(goal.theta), rz = -Math.sin(goal.theta);
    const ux = -Math.sin(goal.theta), uz = -Math.cos(goal.theta);
    goal.x += right * rx + up * ux;
    goal.z += right * rz + up * uz;
  }

  const pointers = new Map();
  let pinch = 0;
  let lastMoveT = 0;
  const sample = { theta: 0, phi: 0, x: 0, z: 0 }; // smoothed drag velocity
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 });
    pinch = 0;
    dragging = true;
    ease = EASE_INPUT;
    vel.theta = vel.phi = vel.x = vel.z = 0;
    sample.theta = sample.phi = sample.x = sample.z = 0;
    lastMoveT = performance.now();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (pointers.size === 0) {
      dragging = false;
      // Glide only if the pointer was still moving when it was released.
      if (performance.now() - lastMoveT < 60) Object.assign(vel, sample);
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointermove", (e) => {
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
  // Wheel: eased zoom toward the point under the cursor.
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
  // Double-click: fly to that spot and zoom in.
  canvas.addEventListener("dblclick", (e) => {
    const p = groundUnder(e.clientX, e.clientY);
    if (p) flyTo(p.x, p.z, Math.max(150, goal.radius * 0.45));
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const step = goal.radius * 0.08;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
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

  // ---------- layer toggles ---------------------------------------------------
  const labelLayer = document.getElementById("labels");
  const toggles = {
    "ly-bld": () => (groups.bld.visible = document.getElementById("ly-bld").checked),
    "ly-roads": () => (groups.roads.visible = document.getElementById("ly-roads").checked),
    "ly-rail": () => (groups.rail.visible = document.getElementById("ly-rail").checked),
    "ly-land": () => (groups.land.visible = document.getElementById("ly-land").checked),
    "ly-water": () => (groups.water.visible = document.getElementById("ly-water").checked),
    "ly-trees": () => (groups.trees.visible = document.getElementById("ly-trees").checked),
    "ly-pins": () => (groups.pins.visible = document.getElementById("ly-pins").checked),
    "ly-ml": () => (groups.bldML.visible = document.getElementById("ly-ml").checked),
    "ly-outline": () => (groups.outline.visible = document.getElementById("ly-outline").checked),
    "ly-labels": () => labelLayer.classList.toggle("off", !document.getElementById("ly-labels").checked),
  };
  Object.entries(toggles).forEach(([id, fn]) => {
    document.getElementById(id).addEventListener("change", () => { fn(); dirty = true; });
  });
  const setLayer = (id, on) => {
    document.getElementById(id).checked = on;
    toggles[id]();
  };

  // ---------- basemap ---------------------------------------------------------
  // Satellite: Sentinel-2 true colour, OSM land use/water hidden, roads semi-transparent.
  // Map: ESA WorldCover colours with OSM land use and water drawn on top.
  function setBasemap(mode) {
    const sat = mode === "satellite" && !!satTex;
    if (terrainMesh) terrainMesh.material = sat ? terrainMats.satellite : terrainMats.map;
    matRoads.transparent = sat;
    matRoads.opacity = sat ? 0.55 : 1;
    matRoads.depthWrite = !sat;
    matRoads.needsUpdate = true;
    setLayer("ly-land", !sat);
    setLayer("ly-water", !sat);
    const radio = document.querySelector('input[name="basemap"][value="' + (sat ? "satellite" : "map") + '"]');
    if (radio) radio.checked = true;
    dirty = true;
  }
  document.querySelectorAll('input[name="basemap"]').forEach((r) => {
    r.addEventListener("change", () => { if (r.checked) setBasemap(r.value); });
  });

  // ---------- labels ----------------------------------------------------------
  const labelItems = [];
  {
    const frag = document.createDocumentFragment();
    for (const L of D.labels) {
      if (!L.n) continue;
      const el = document.createElement("div");
      el.className = "lbl k-" + L.k;
      el.textContent = L.n;
      frag.appendChild(el);
      labelItems.push({ el, range: LABEL_RANGE[L.k] || 1500, wp: new THREE.Vector3(L.x, H(L.x, L.z) + 8, L.z) });
    }
    labelLayer.appendChild(frag);
  }
  const _ndc = new THREE.Vector3();
  function updateLabels() {
    if (labelLayer.classList.contains("off")) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const L of labelItems) {
      const dist = camera.position.distanceTo(L.wp);
      _ndc.copy(L.wp).project(camera);
      const hidden = dist > L.range || _ndc.z > 1 || _ndc.z < -1 || Math.abs(_ndc.x) > 1.05 || Math.abs(_ndc.y) > 1.05;
      if (hidden) {
        if (L.el.style.display !== "none") L.el.style.display = "none";
        continue;
      }
      L.el.style.display = "block";
      L.el.style.left = ((_ndc.x * 0.5 + 0.5) * w).toFixed(0) + "px";
      L.el.style.top = ((-_ndc.y * 0.5 + 0.5) * h).toFixed(0) + "px";
    }
  }

  // ---------- panel collapse --------------------------------------------------
  {
    const panel = document.getElementById("panel");
    const btn = document.getElementById("panel-toggle");
    btn.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      btn.textContent = collapsed ? "Show" : "Hide";
      btn.setAttribute("aria-expanded", String(!collapsed));
    });
  }

  // ---------- places (official names matched to map features) ------------------
  {
    const root = document.getElementById("places-list");
    const byGroup = new Map();
    for (const p of D.places || []) {
      if (!byGroup.has(p.g)) byGroup.set(p.g, []);
      byGroup.get(p.g).push(p);
    }
    for (const [g, list] of byGroup) {
      const det = document.createElement("details");
      if (g === "Colleges") det.open = true;
      const sum = document.createElement("summary");
      sum.textContent = g + " (" + list.length + ")";
      det.appendChild(sum);
      for (const p of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "place";
        b.textContent = p.n;
        b.title = p.osm && p.osm !== p.n ? "OSM name: " + p.osm : "";
        b.addEventListener("click", () => flyTo(p.x, p.z, 420, 0.85));
        det.appendChild(b);
      }
      root.appendChild(det);
    }
    if (!byGroup.size) root.textContent = "No places located.";
  }

  // ---------- sources ---------------------------------------------------------
  {
    const ul = document.getElementById("sources");
    for (const src of D.meta.sources || []) {
      const li = document.createElement("li");
      let text = src.layer + ": " + src.name;
      if (src.date) text += " (" + src.date + ")";
      if (src.release) text += " (release " + src.release + ")";
      li.textContent = text + " - " + src.licence;
      ul.appendChild(li);
    }
  }

  // ---------- search ----------------------------------------------------------
  {
    const dl = document.getElementById("places");
    const names = new Map();
    for (const L of D.labels) if (L.n && !names.has(L.n)) names.set(L.n, L);
    for (const p of D.points) if (p.n && !names.has(p.n)) names.set(p.n, p);
    const frag = document.createDocumentFragment();
    [...names.keys()].sort().forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      frag.appendChild(o);
    });
    dl.appendChild(frag);
    const input = document.getElementById("find");
    const go = () => {
      const hit = names.get(input.value.trim());
      if (!hit) return;
      flyTo(hit.x, hit.z, hit.k === "bld" ? 380 : 900, 0.85);
    };
    input.addEventListener("change", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  // ---------- resize + render loop --------------------------------------------
  let dirty = true;
  // ---------- adaptive resolution ---------------------------------------------
  // While the camera moves, the render scale adapts to hold ~50+ fps; when it stops, one frame is
  // drawn supersampled so the still image is sharp and anti-aliased. Idle cost is zero.
  const DPR = window.devicePixelRatio || 1;
  const STILL_SCALE = clamp(DPR * 1.5, 1, 2);
  const MOTION_MAX = Math.min(DPR, 1.25), MOTION_MIN = 0.45;
  let motionScale = Math.min(DPR, 1);
  let currentScale = 0;
  function setScale(sc) {
    sc = Math.round(sc * 20) / 20; // quantise so the drawing buffer is not reallocated every frame
    if (sc === currentScale) return;
    currentScale = sc;
    renderer.setPixelRatio(sc);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  window.addEventListener("resize", resize);

  const statEls = {
    bld: document.getElementById("st-bld"),
    area: document.getElementById("st-area"),
    road: document.getElementById("st-road"),
    ml: document.getElementById("st-ml"),
    trees: document.getElementById("st-trees"),
    tri: document.getElementById("st-tri"),
    calls: document.getElementById("st-calls"),
    ms: document.getElementById("st-ms"),
  };
  statEls.bld.textContent = counts.buildings.toLocaleString();
  statEls.area.textContent = counts.areas.toLocaleString();
  statEls.road.textContent = counts.roads.toLocaleString();
  statEls.ml.textContent = counts.ml.toLocaleString();
  statEls.trees.textContent = counts.trees.toLocaleString();

  let lastFrame = performance.now();
  let wasMoving = false;
  let stillPending = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - lastFrame) / 1000;
    const dt = Math.min(0.25, Math.max(0, rawDt)); // easing is stable at any step
    lastFrame = now;
    const moving = cameraMoving() || dragging;
    if (moving) {
      stepCamera(dt);
      dirty = true;
      // Adapt the motion scale from the real frame interval (only between consecutive motion frames).
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
    updateMlChunks();
    renderer.render(scene, camera);
    updateLabels();
    statEls.tri.textContent = renderer.info.render.triangles.toLocaleString();
    statEls.calls.textContent = renderer.info.render.calls;
    statEls.ms.textContent = (performance.now() - t0).toFixed(1) + " ms @ " + currentScale.toFixed(2) + "x";
  }

  // Start framed on the campus core, not the centre of the (larger) study region.
  view.target.set(campusCore.x, 0, campusCore.z);
  view.radius = SPAN * 0.5;
  view.phi = 0.9;
  Object.assign(goal, { x: campusCore.x, z: campusCore.z, radius: view.radius, phi: view.phi, theta: view.theta });
  setBasemap(satTex ? "satellite" : "map");
  resize();
  applyView();
  requestAnimationFrame(frame);
  statusEl.style.display = "none";
  window.__twin = { scene, camera, renderer, view, goal, flyTo, groups, counts, H, setScale };
})();
