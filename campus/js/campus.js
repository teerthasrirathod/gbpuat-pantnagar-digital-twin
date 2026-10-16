/* GBPUAT Campus 3D - street-level viewer.
   Data: window.CAMPUS (twin build, Rust) and window.CAMPUS_IMG. Rendering: Three.js r160, no
   shadows or post-processing; detail is generated near the camera and dropped with distance. */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const loadBar = $("load-bar").firstElementChild, loadText = $("load-text");
  // Yield to the browser between steps so the progress bar can paint.
  const T_START = performance.now();
  let tLast = T_START;
  const step = (pct, text) => {
    const now = performance.now();
    console.info(`[load] ${(now - tLast).toFixed(0)} ms before "${text}" (total ${(now - T_START).toFixed(0)} ms)`);
    tLast = now;
    loadBar.style.width = pct + "%";
    loadText.textContent = text;
    // MessageChannel yields a task without the timer throttling some embedded/background views apply.
    return new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
  };
  window.addEventListener("error", (e) => { loadText.textContent = "Error: " + (e.message || e); });

  const D = window.CAMPUS, IMG = window.CAMPUS_IMG;
  if (!D || !window.THREE) { loadText.textContent = "Data or Three.js missing"; return; }
  let dirty = true;
  // Plan mode (js/plan.js) registers hooks here; planDrag is true while it owns a pointer drag.
  let PLAN = null, planDrag = false, streetFrom = "aerial";

  // ---------------------------------------------------------------------------------------
  // Utilities
  const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const toRing = (f) => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); return r; };
  const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const pip = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const centroid = (r) => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
  const fmt = (n, d = 0) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const LAT0 = D.meta.origin.lat, LON0 = D.meta.origin.lon, M_LAT = 110540, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const unproj = (x, z) => [LON0 + x / M_LON, LAT0 - z / M_LAT];
  const pretty = (k) => String(k || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const TYPE_LABEL = Object.fromEntries(D.meta.types);
  const TYPE_COLOUR = {
    academic: 0xd9a33f, hostel: 0x9a64c4, residential: 0x4f9fd8, house: 0x7fbfdc, admin: 0xe0c25a, health: 0xe0605a,
    school: 0xf0a060, commercial: 0xe07fb0, religious: 0xf28c28, sports: 0x5fc08a, farm: 0x8a9a5b, industrial: 0x8d8f99,
    utility: 0xb0a090, institutional: 0xc8a878, unknown: 0xbcb4a6,
  };
  const WALL = {
    academic: [0xe8d7b1, 0xe2cfa4], hostel: [0xeadb9e, 0xe6d28c], residential: [0xefe6d2, 0xeadcc0, 0xf0e4c8],
    house: [0xece2cf, 0xf0d9c8, 0xe2e4dc, 0xeed9a8, 0xdfe6e8, 0xf2e8e0], admin: [0xe4ddcc], health: [0xf2f2ee],
    school: [0xe8cf9c], commercial: [0xddd0c0, 0xe8d5b8], religious: [0xf6ead0, 0xf3d7a2], sports: [0xd9d3c6],
    farm: [0xc2baab], industrial: [0xbabdc0], utility: [0xcac3b7], institutional: [0xe2d6bd], unknown: [0xe4dac8],
  };
  const USE_COLOUR = {
    "Academic / institutional": 0xd9a33f, Hostels: 0x9a64c4, Housing: 0x4f9fd8, "Mixed built-up": 0xc79a6a,
    "Fields / farm": 0x9fbf5a, Wooded: 0x3f7f45, Water: 0x4a86b8, Airport: 0x888888, "Open land": 0xc9c08f,
  };

  // ---------------------------------------------------------------------------------------
  // Renderer, scene, camera
  await step(5, "Starting the renderer");
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Linear tone mapping at exposure 1 changes nothing by day; night view lowers the exposure.
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  const SKY = new THREE.Color(0xd4e3ec);
  const camera = new THREE.PerspectiveCamera(50, 1, 2, 60000);
  scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x6b6250, 1.15));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
  sun.position.set(-0.55, 1, 0.35).multiplyScalar(1000);
  scene.add(sun);

  const groups = {};
  for (const k of ["terrain", "roads", "water", "drain", "blocks", "blockfill", "villages", "bld", "trees", "lights", "misc", "plan"]) {
    groups[k] = new THREE.Group();
    scene.add(groups[k]);
  }
  groups.drain.visible = false;
  groups.blockfill.visible = false;

  // ---------------------------------------------------------------------------------------
  // Terrain: vertices at the 30 m grid cell centres; H() interpolates on the same triangles.
  await step(10, "Shaping the ground");
  // The campus is flat (about 12 m of relief), so the 30 m grid is averaged to 60 m for the mesh.
  const T0 = D.terrain, T = { nx: Math.floor(T0.nx / 2), nz: Math.floor(T0.nz / 2), cell: T0.cell * 2, x0: T0.x0, z0: T0.z0 };
  const TH = new Float32Array(T.nx * T.nz);
  for (let j = 0; j < T.nz; j++) for (let i = 0; i < T.nx; i++) {
    const g = (a, b) => T0.h[(2 * j + b) * T0.nx + 2 * i + a] / 10;
    TH[j * T.nx + i] = (g(0, 0) + g(1, 0) + g(0, 1) + g(1, 1)) / 4;
  }
  const tx0 = T.x0 + T.cell / 2, tz0 = T.z0 + T.cell / 2;
  function H(x, z) {
    let fx = (x - tx0) / T.cell, fz = (z - tz0) / T.cell;
    fx = Math.min(Math.max(fx, 0), T.nx - 1.0001);
    fz = Math.min(Math.max(fz, 0), T.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = TH[j * T.nx + i], b = TH[j * T.nx + i + 1], c = TH[(j + 1) * T.nx + i], d = TH[(j + 1) * T.nx + i + 1];
    return u > v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
  }
  const B = D.meta.bounds; // [x0, z0, x1, z1]
  let SAT_IMG = null;
  const SG = IMG.satGrid, satW = SG.nx * SG.cell, satH = SG.nz * SG.cell;
  {
    const pos = new Float32Array(T.nx * T.nz * 3), uv = new Float32Array(T.nx * T.nz * 2);
    for (let j = 0; j < T.nz; j++) for (let i = 0; i < T.nx; i++) {
      const k = j * T.nx + i, x = tx0 + i * T.cell, z = tz0 + j * T.cell;
      pos.set([x, TH[k], z], k * 3);
      uv.set([(x - SG.x0) / satW, 1 - (z - SG.z0) / satH], k * 2);
    }
    const idx = [];
    for (let j = 0; j < T.nz - 1; j++) for (let i = 0; i < T.nx - 1; i++) {
      const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1;
      idx.push(a, c, d, a, d, b); // diagonal a-d, consistent with H()
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const [satImg, lcImg] = await Promise.all([load(IMG.sat), load(IMG.lc)]);
    SAT_IMG = satImg;
    const satTex = new THREE.Texture(satImg);
    satTex.colorSpace = THREE.SRGBColorSpace;
    satTex.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
    satTex.needsUpdate = true;
    const lcTex = new THREE.Texture(lcImg);
    lcTex.colorSpace = THREE.SRGBColorSpace;
    lcTex.magFilter = THREE.NearestFilter;
    const LG = IMG.lcGrid, lcW = LG.nx * LG.cell, lcH = LG.nz * LG.cell;
    lcTex.repeat.set(satW / lcW, satH / lcH);
    lcTex.offset.set(0, 1 - satH / lcH);
    lcTex.needsUpdate = true;
    const detail = noiseTexture(256, 0.16, 7);
    // Unlit: the image already carries the light; per-pixel lighting on full-screen ground is the costliest thing on weak GPUs.
    const mat = new THREE.MeshBasicMaterial({ map: satTex });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nuniform sampler2D detailMap;")
        .replace("#include <map_fragment>", "#include <map_fragment>\n{ float dd = distance(vWPos, cameraPosition);\n  if (dd < 420.0) { float k = 1.0 - smoothstep(40.0, 420.0, dd);\n    vec3 det = texture2D(detailMap, vWPos.xz * 0.21).rgb * texture2D(detailMap, vWPos.xz * 0.037).rgb;\n    diffuseColor.rgb *= mix(vec3(1.0), det * 3.6, k * 0.5); } }");
    };
    const terrain = new THREE.Mesh(g, mat);
    terrain.name = "terrain";
    groups.terrain.add(terrain);
    window.__ground = { mat, satTex, lcTex };
  }

  function noiseTexture(size, amp, seed) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d"), im = ctx.createImageData(size, size), rnd = mulberry32(seed);
    for (let i = 0; i < size * size; i++) {
      const v = Math.round(255 * (0.5 + (rnd() - 0.5) * amp * 2));
      im.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---------------------------------------------------------------------------------------
  // Geometry batch with vertex colours (+ optional UVs)
  class Batch {
    constructor(uv) { this.p = []; this.c = []; this.u = uv ? [] : null; }
    v(x, y, z, col, uu, vv) { this.p.push(x, y, z); this.c.push(col[0], col[1], col[2]); if (this.u) this.u.push(uu || 0, vv || 0); }
    get tris() { return this.p.length / 9; }
    geometry(bake) {
      const g = new THREE.BufferGeometry();
      if (bake) bakeLight(this.p, this.c);
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      if (this.u) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
      g.computeVertexNormals();
      return g;
    }
  }

  // Flat faces get constant lighting, so it is baked into vertex colours once (sun + sky) and
  // the meshes render unlit: far cheaper than per-pixel lighting on a weak integrated GPU.
  const SUN_DIR = new THREE.Vector3(-0.55, 1, 0.35).normalize();
  function lightFor(nx, ny, nz) {
    const ndl = Math.max(0, nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z);
    return 0.4 + 0.1 * ny + 0.36 * ndl;
  }
  function bakeLight(p, c) {
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
      const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      // Double-sided surfaces (roofs, sheds) are lit from the side facing up / towards the sun.
      if (ny < -0.2) { nx = -nx; ny = -ny; nz = -nz; }
      const f = lightFor(nx, ny, nz);
      for (let k = 0; k < 9; k++) c[i + k] = Math.min(1, c[i + k] * f);
    }
  }

  // Densify a polyline so draped geometry follows the terrain.
  function densify(pts, maxLen) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / maxLen));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  }

  // Everything is clipped to the terrain window so nothing hangs in the air past its edge.
  // The terrain mesh spans the grid-cell centres, half a cell inside the window.
  const CB = [tx0 + 1, tz0 + 1, tx0 + (T.nx - 1) * T.cell - 1, tz0 + (T.nz - 1) * T.cell - 1];
  const inCB = (x, z) => x >= CB[0] && x <= CB[2] && z >= CB[1] && z <= CB[3];
  function clipLine(pts) {
    const out = [];
    let cur = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      let t0 = 0, t1 = 1;
      const edge = (p, q) => {
        if (p === 0) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      };
      if (edge(-dx, a[0] - CB[0]) && edge(dx, CB[2] - a[0]) && edge(-dz, a[1] - CB[1]) && edge(dz, CB[3] - a[1])) {
        if (!cur.length || t0 > 0) { if (cur.length > 1) out.push(cur); cur = [[a[0] + t0 * dx, a[1] + t0 * dz]]; }
        cur.push([a[0] + t1 * dx, a[1] + t1 * dz]);
        if (t1 < 1) { out.push(cur); cur = []; }
      } else if (cur.length) { if (cur.length > 1) out.push(cur); cur = []; }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }
  function clipRing(ring) {
    let out = ring;
    const planes = [[0, CB[0], 1], [0, CB[2], -1], [1, CB[1], 1], [1, CB[3], -1]];
    for (const [ax, v, sgn] of planes) {
      const inp = out;
      out = [];
      for (let i = 0; i < inp.length; i++) {
        const p = inp[i], q = inp[(i + 1) % inp.length];
        const pin = (p[ax] - v) * sgn >= 0, qin = (q[ax] - v) * sgn >= 0;
        if (pin) out.push(p);
        if (pin !== qin) { const t = (v - p[ax]) / (q[ax] - p[ax]); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      if (out.length < 3) return [];
    }
    return out;
  }

  // Ribbon along a polyline (draped). UV: u across 0..1, v = length / vScale.
  function ribbon(batch, pts, width, lift, col, vScale) {
    const P = densify(pts, 20);
    if (P.length < 2) return;
    let along = 0;
    const hw = width / 2;
    const L = [], R = [], V = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      if (i > 0) along += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      L.push([P[i][0] - dz * hw, P[i][1] + dx * hw]);
      R.push([P[i][0] + dz * hw, P[i][1] - dx * hw]);
      V.push(along / (vScale || 6));
    }
    for (let i = 0; i < P.length - 1; i++) {
      const l0 = L[i], r0 = R[i], l1 = L[i + 1], r1 = R[i + 1];
      const y = (p) => H(p[0], p[1]) + lift;
      batch.v(l0[0], y(l0), l0[1], col, 0, V[i]); batch.v(r1[0], y(r1), r1[1], col, 1, V[i + 1]); batch.v(r0[0], y(r0), r0[1], col, 1, V[i]);
      batch.v(l0[0], y(l0), l0[1], col, 0, V[i]); batch.v(l1[0], y(l1), l1[1], col, 0, V[i + 1]); batch.v(r1[0], y(r1), r1[1], col, 1, V[i + 1]);
    }
  }

  // Flat polygon draped on the terrain (triangulated, large triangles split).
  function drapedPolygon(batch, rings, lift, col, flatY) {
    const outer = rings[0].map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
    if (outer.length < 3) return;
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch (e) { return; }
    const all = outer.concat(...holes);
    const push = (a, b, c, depth) => {
      const ab = Math.hypot(a.x - b.x, a.y - b.y), bc = Math.hypot(b.x - c.x, b.y - c.y), ca = Math.hypot(c.x - a.x, c.y - a.y);
      const m = Math.max(ab, bc, ca);
      if (flatY == null && m > 45 && depth < 7) {
        if (m === ab) { const d = a.clone().add(b).multiplyScalar(0.5); push(a, d, c, depth + 1); push(d, b, c, depth + 1); }
        else if (m === bc) { const d = b.clone().add(c).multiplyScalar(0.5); push(a, b, d, depth + 1); push(a, d, c, depth + 1); }
        else { const d = c.clone().add(a).multiplyScalar(0.5); push(a, b, d, depth + 1); push(d, b, c, depth + 1); }
        return;
      }
      for (const p of [a, c, b]) batch.v(p.x, flatY != null ? flatY : H(p.x, p.y) + lift, p.y, col);
    };
    for (const t of tris) push(all[t[0]], all[t[1]], all[t[2]], 0);
  }

  function lineSegments(pointsFlat, color, opacity, dashed) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pointsFlat, 3));
    const m = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 30, gapSize: 18, transparent: opacity < 1, opacity })
      : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    const l = new THREE.LineSegments(g, m);
    if (dashed) l.computeLineDistances();
    return l;
  }
  function drapedOutline(out, ring, lift) {
    const P = densify(ring.concat([ring[0]]), 25);
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      out.push(a[0], H(a[0], a[1]) + lift, a[1], b[0], H(b[0], b[1]) + lift, b[1]);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Canvas textures: road surfaces and facades (greyscale, tinted by vertex colour)
  function canvasTex(w, h, draw, repeat = true) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function grain(ctx, w, h, base, amp, seed, n = 6000) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    const r = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const v = Math.floor(128 + (r() - 0.5) * amp);
      ctx.fillStyle = `rgba(${v},${v},${v},0.18)`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  }
  const TEX = {
    major: canvasTex(128, 256, (ctx, w, h) => {
      grain(ctx, w, h, "#5c5d5f", 120, 1);
      ctx.fillStyle = "#e9e6dc"; ctx.fillRect(w * 0.04, 0, w * 0.035, h); ctx.fillRect(w * 0.925, 0, w * 0.035, h);
      ctx.fillStyle = "#f2efe6"; ctx.fillRect(w * 0.485, h * 0.1, w * 0.03, h * 0.45);
    }),
    minor: canvasTex(128, 256, (ctx, w, h) => {
      grain(ctx, w, h, "#6b6a67", 130, 2);
      ctx.fillStyle = "rgba(150,140,120,0.5)"; ctx.fillRect(0, 0, w * 0.06, h); ctx.fillRect(w * 0.94, 0, w * 0.06, h);
    }),
    dirt: canvasTex(128, 256, (ctx, w, h) => {
      grain(ctx, w, h, "#9c876a", 140, 3, 9000);
      ctx.fillStyle = "rgba(90,74,52,0.35)"; ctx.fillRect(w * 0.18, 0, w * 0.14, h); ctx.fillRect(w * 0.68, 0, w * 0.14, h);
      ctx.fillStyle = "rgba(110,140,70,0.35)"; ctx.fillRect(w * 0.42, 0, w * 0.16, h);
    }),
    path: canvasTex(128, 128, (ctx, w, h) => {
      grain(ctx, w, h, "#a9a49a", 90, 4);
      ctx.strokeStyle = "rgba(80,76,70,0.35)"; ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }),
    // One bay (3.2 m) by one floor: wall, floor slab band, window with frame, sunshade above.
    facade: canvasTex(128, 128, (ctx, w, h) => {
      grain(ctx, w, h, "#ececec", 50, 5, 1500);
      ctx.fillStyle = "#c9c9c9"; ctx.fillRect(0, h * 0.9, w, h * 0.1);          // slab band (bottom of the floor tile)
      ctx.fillStyle = "#9a9a9a"; ctx.fillRect(w * 0.2, h * 0.17, w * 0.6, h * 0.05); // chhajja shadow
      ctx.fillStyle = "#d8d8d8"; ctx.fillRect(w * 0.18, h * 0.13, w * 0.64, h * 0.05); // chhajja
      ctx.fillStyle = "#f7f7f7"; ctx.fillRect(w * 0.26, h * 0.25, w * 0.48, h * 0.5);   // frame
      ctx.fillStyle = "#2f3b45"; ctx.fillRect(w * 0.29, h * 0.28, w * 0.42, h * 0.44);   // glass
      ctx.fillStyle = "#5d6e7c"; ctx.fillRect(w * 0.29, h * 0.28, w * 0.42, h * 0.08);
      ctx.fillStyle = "#f7f7f7"; ctx.fillRect(w * 0.49, h * 0.28, w * 0.02, h * 0.44); ctx.fillRect(w * 0.29, h * 0.49, w * 0.42, h * 0.02);
      ctx.fillStyle = "#bcbcbc"; ctx.fillRect(w * 0.24, h * 0.75, w * 0.52, h * 0.03);   // sill
    }),
    house: canvasTex(128, 128, (ctx, w, h) => {
      grain(ctx, w, h, "#ededed", 60, 6, 1800);
      ctx.fillStyle = "#cfcfcf"; ctx.fillRect(0, h * 0.92, w, h * 0.08);
      ctx.fillStyle = "#f6f6f6"; ctx.fillRect(w * 0.33, h * 0.3, w * 0.34, h * 0.38);
      ctx.fillStyle = "#3b4048"; ctx.fillRect(w * 0.36, h * 0.33, w * 0.28, h * 0.32);
      ctx.fillStyle = "#8b8b8b"; ctx.fillRect(w * 0.3, h * 0.24, w * 0.4, h * 0.04);
    }),
    shed: canvasTex(64, 128, (ctx, w, h) => {
      grain(ctx, w, h, "#dcdcdc", 40, 7, 600);
      for (let x = 0; x < w; x += 6) { ctx.fillStyle = x % 12 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.18)"; ctx.fillRect(x, 0, 3, h); }
    }),
  };
  const roofTex = noiseTexture(128, 0.14, 11);

  // ---------------------------------------------------------------------------------------
  // Roads
  await step(18, "Laying roads");
  const ROAD_GROUP = (c, s) => {
    if (["path", "footway", "cycleway", "steps", "bridleway", "pedestrian"].includes(c)) return "path";
    if (c === "track" || /unpaved|dirt|earth|gravel|ground|sand|mud|grass/.test(s || "")) return "dirt";
    if (["motorway", "trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link", "tertiary_link"].includes(c)) return "major";
    return "minor";
  };
  const ROAD_LIFT = { major: 0.32, minor: 0.28, dirt: 0.24, path: 0.2 };
  const roadBatches = { major: new Batch(true), minor: new Batch(true), dirt: new Batch(true), path: new Batch(true) };
  const white = [1, 1, 1];
  D.roads.forEach((r) => {
    const g = ROAD_GROUP(r.c, r.s);
    for (const piece of clipLine(toRing(r.p))) ribbon(roadBatches[g], piece, r.w, ROAD_LIFT[g], white, g === "path" ? 2 : 7);
  });
  const ROAD_MAT = {};
  const roadMat = (k) => ROAD_MAT[k] || (ROAD_MAT[k] = new THREE.MeshBasicMaterial({ map: TEX[k], vertexColors: true, color: 0xd8d8d8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  for (const k in roadBatches) {
    if (!roadBatches[k].tris) continue;
    const m = new THREE.Mesh(roadBatches[k].geometry(), roadMat(k));
    groups.roads.add(m);
  }
  // Kerbs on paved campus roads: thin raised strips along both edges.
  const kerbChunks = new Map();
  {
    const kc = [0.78, 0.77, 0.74];
    const kbFor = (x, z) => {
      const k = Math.floor(x / 500) + "," + Math.floor(z / 500);
      if (!kerbChunks.has(k)) kerbChunks.set(k, { cx: (Math.floor(x / 500) + 0.5) * 500, cz: (Math.floor(z / 500) + 0.5) * 500, b: new Batch(false), mesh: null });
      return kerbChunks.get(k).b;
    };
    for (const r of D.roads) {
      if (!["residential", "tertiary", "unclassified", "secondary", "primary", "living_street"].includes(r.c)) continue;
      for (const piece of clipLine(toRing(r.p))) {
      const P = densify(piece, 20);
      for (const side of [-1, 1]) {
        for (let i = 0; i < P.length - 1; i++) {
          const kb = kbFor(P[i][0], P[i][1]);
          const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = (-(b[1] - a[1]) / l) * side, nz = ((b[0] - a[0]) / l) * side, o = r.w / 2;
          const A = [a[0] + nx * o, a[1] + nz * o], Bq = [b[0] + nx * o, b[1] + nz * o];
          const ya = H(A[0], A[1]) + 0.32, yb = H(Bq[0], Bq[1]) + 0.32;
          kb.v(A[0], ya, A[1], kc); kb.v(Bq[0], yb + 0.15, Bq[1], kc); kb.v(Bq[0], yb, Bq[1], kc);
          kb.v(A[0], ya, A[1], kc); kb.v(A[0], ya + 0.15, A[1], kc); kb.v(Bq[0], yb + 0.15, Bq[1], kc);
        }
      }
      }
    }
    const km = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const kc2 of kerbChunks.values()) { kc2.mesh = new THREE.Mesh(kc2.b.geometry(), km); kc2.mesh.visible = false; kc2.b = null; groups.roads.add(kc2.mesh); }
  }

  // ---------------------------------------------------------------------------------------
  // Water
  await step(24, "Filling ponds and channels");
  {
    const wa = new Batch(false), wc = hexRGB(0x48789a), wc2 = hexRGB(0x5a8aa8);
    for (const a of D.water.areas) {
      const rings = a.r.map((r) => clipRing(toRing(r))).filter((r) => r.length >= 3);
      if (rings.length) drapedPolygon(wa, rings, 0.3, a.src === "osm" ? wc : wc2);
    }
    const wl = new Batch(false), dl = new Batch(false);
    for (const l of D.water.lines) for (const piece of clipLine(toRing(l.p))) ribbon(l.src === "modelled" ? dl : wl, piece, Math.max(1.5, l.w), l.src === "modelled" ? 0.12 : 0.2, l.src === "modelled" ? hexRGB(0x6fa4c2) : wc, 10);
    const wm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    if (wa.tris) groups.water.add(new THREE.Mesh(wa.geometry(), wm));
    if (wl.tris) groups.water.add(new THREE.Mesh(wl.geometry(), wm));
    if (dl.tris) groups.drain.add(new THREE.Mesh(dl.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.75 })));
  }

  // ---------------------------------------------------------------------------------------
  // Blocks and villages
  await step(28, "Drawing blocks");
  const blockRings = new Map();
  {
    const pts = [], fill = new Batch(false);
    for (const b of D.blocks) {
      const ring = toRing(b.r);
      blockRings.set(b.id, ring);
      drapedOutline(pts, ring, 1.2);
      drapedPolygon(fill, [ring], 0.9, hexRGB(USE_COLOUR[b.use] || 0xcccccc));
    }
    groups.blocks.add(lineSegments(pts, 0xffffff, 0.75));
    groups.blockfill.add(new THREE.Mesh(fill.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide })));
    const vp = [];
    for (const v of D.villages) for (const r of v.r) {
      const ring = clipRing(toRing(r));
      if (ring.length < 3) continue;
      const onEdge = (p) => Math.abs(p[0] - CB[0]) < 0.5 || Math.abs(p[0] - CB[2]) < 0.5 || Math.abs(p[1] - CB[1]) < 0.5 || Math.abs(p[1] - CB[3]) < 0.5;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (onEdge(a) && onEdge(b)) continue;
        const P = densify([a, b], 25);
        for (let k = 0; k < P.length - 1; k++) vp.push(P[k][0], H(P[k][0], P[k][1]) + 2.5, P[k][1], P[k + 1][0], H(P[k + 1][0], P[k + 1][1]) + 2.5, P[k + 1][1]);
      }
    }
    groups.villages.add(lineSegments(vp, 0xff7a3d, 1, true));
  }
  // Spatial index of blocks for ground picks.
  const blockGrid = new Map(), BG = 250;
  for (const b of D.blocks) {
    const r = blockRings.get(b.id);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of r) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    for (let i = Math.floor(x0 / BG); i <= Math.floor(x1 / BG); i++) for (let j = Math.floor(z0 / BG); j <= Math.floor(z1 / BG); j++) {
      const k = i + "," + j;
      if (!blockGrid.has(k)) blockGrid.set(k, []);
      blockGrid.get(k).push(b);
    }
  }
  const blockAt = (x, z) => (blockGrid.get(Math.floor(x / BG) + "," + Math.floor(z / BG)) || []).find((b) => pip(x, z, blockRings.get(b.id)));
  const blockById = new Map(D.blocks.map((b) => [b.id, b]));

  // ---------------------------------------------------------------------------------------
  // Buildings: footprints -> walls with floor/bay facade UVs, roofs, parapets, rooftop details.
  await step(34, "Raising buildings");
  const BAY = 3.2, CHUNK = 400;
  const blds = D.buildings.map((b, i) => {
    const rings = b.r.map(toRing);
    // Outer ring counter-clockwise in (x, z) => outward normals point away from the inside.
    if (ringArea(rings[0]) < 0) rings[0].reverse();
    for (let k = 1; k < rings.length; k++) if (ringArea(rings[k]) > 0) rings[k].reverse();
    let g = Infinity, gmax = -Infinity;
    for (const p of rings[0]) { const h = H(p[0], p[1]); g = Math.min(g, h); gmax = Math.max(gmax, h); }
    const c = centroid(rings[0]);
    const pal = WALL[b.t] || WALL.unknown;
    const rnd = mulberry32(i * 7919 + 13);
    return { ...b, i, rings, ground: g, top: g + b.h, c, wall: pal[Math.floor(rnd() * pal.length)], rnd };
  });
  const chunks = new Map();
  for (const b of blds) {
    const k = Math.floor(b.c[0] / CHUNK) + "," + Math.floor(b.c[1] / CHUNK);
    if (!chunks.has(k)) chunks.set(k, { key: k, list: [], cx: (Math.floor(b.c[0] / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(b.c[1] / CHUNK) + 0.5) * CHUNK, lod1: null, lod0: null });
    chunks.get(k).list.push(b);
  }

  const isShed = (b) => (b.t === "farm" || b.t === "industrial") && b.h < 7.5 && b.a >= 90;
  const facadeKind = (b) => (isShed(b) ? "shed" : ["house", "utility"].includes(b.t) || b.h < 4.6 ? "house" : "facade");

  // Minimum-area rectangle of a ring (for gable roofs).
  function minRect(r) {
    let best = null;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.5) continue;
      const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
      let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
      for (const p of r) {
        const s = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz, t = -(p[0] - a[0]) * uz + (p[1] - a[1]) * ux;
        s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
      }
      const area = (s1 - s0) * (t1 - t0);
      if (!best || area < best.area) best = { area, a, ux, uz, s0, s1, t0, t1 };
    }
    return best;
  }

  function inset(ring, d) {
    const n = ring.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = ring[(i - 1 + n) % n], c = ring[i], q = ring[(i + 1) % n];
      let ax = c[0] - p[0], az = c[1] - p[1], bx = q[0] - c[0], bz = q[1] - c[1];
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      ax /= la; az /= la; bx /= lb; bz /= lb;
      // inward normals for a CCW ring in (x, z) with z south: left of the direction
      const n1 = [az, -ax], n2 = [bz, -bx];
      let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const cos = Math.max(0.35, mx * n1[0] + mz * n1[1]);
      out.push([c[0] - (mx * d) / cos, c[1] - (mz * d) / cos]);
    }
    return out;
  }

  // Walls of one ring from y0 to y1 with facade UVs (u: bays, v: floors).
  function walls(batch, ring, y0, y1, floorH, col, outward) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      let a = ring[i], b = ring[(i + 1) % n];
      if (outward) [a, b] = [b, a]; // outer rings are CCW: swap so faces point outwards
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const bays = Math.max(1, Math.round(L / BAY));
      const v0 = (y0 - y0) / floorH, v1 = (y1 - y0) / floorH;
      // Darker base (fake ambient occlusion) via a second colour at the bottom vertices.
      const cb = [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8];
      batch.v(a[0], y0, a[1], cb, 0, v0); batch.v(b[0], y0, b[1], cb, bays, v0); batch.v(b[0], y1, b[1], col, bays, v1);
      batch.v(a[0], y0, a[1], cb, 0, v0); batch.v(b[0], y1, b[1], col, bays, v1); batch.v(a[0], y1, a[1], col, 0, v1);
    }
  }

  function roofPolygon(batch, rings, y, col) {
    const outer = rings[0].map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch (e) { return; }
    const all = outer.concat(...holes);
    const flatUV = batch.flatRoof;
    for (const t of tris) for (const k of [t[0], t[2], t[1]]) batch.v(all[k].x, y, all[k].y, col, flatUV ? 0.04 : all[k].x / 6, flatUV ? 0.03 : all[k].y / 6);
  }

  function box(batch, cx, cz, y0, w, d, h, ang, col) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4];
      batch.v(a[0], y0, a[1], col, 0, 0); batch.v(b[0], y0 + h, b[1], col, 1, 1); batch.v(b[0], y0, b[1], col, 1, 0);
      batch.v(a[0], y0, a[1], col, 0, 0); batch.v(a[0], y0 + h, a[1], col, 0, 1); batch.v(b[0], y0 + h, b[1], col, 1, 1);
    }
    batch.v(P[0][0], y0 + h, P[0][1], col); batch.v(P[2][0], y0 + h, P[2][1], col); batch.v(P[1][0], y0 + h, P[1][1], col);
    batch.v(P[0][0], y0 + h, P[0][1], col); batch.v(P[3][0], y0 + h, P[3][1], col); batch.v(P[2][0], y0 + h, P[2][1], col);
  }

  let typeColours = false;
  function wallColour(b) { return hexRGB(typeColours ? TYPE_COLOUR[b.t] || 0xbbbbbb : b.wall); }
  function roofColour(b) {
    if (typeColours) { const c = hexRGB(TYPE_COLOUR[b.t] || 0xbbbbbb); return [c[0] * 0.85, c[1] * 0.85, c[2] * 0.85]; }
    const base = isShed(b) ? [0.58, 0.6, 0.62] : [0.72, 0.7, 0.66];
    if (!b.roof) return base;
    const s = hexRGB(b.roof);
    return [base[0] * 0.55 + s[0] * 0.6, base[1] * 0.55 + s[1] * 0.6, base[2] * 0.55 + s[2] * 0.6];
  }

  const tankPositions = [];
  // detail: 0 = simple (walls + roof), 1 = full (parapet, stair cabin, gable roofs, tanks)
  function buildChunk(ch, detail) {
    // Simple level: everything in one facade-textured mesh (roofs sample a plain wall texel).
    const one = detail ? null : new Batch(true);
    const bf = detail ? { facade: new Batch(true), house: new Batch(true), shed: new Batch(true) } : { facade: one, house: one, shed: one };
    const roofs = detail ? new Batch(true) : one, extra = new Batch(false);
    if (one) one.flatRoof = true;
    const owners = { facade: [], house: [], shed: [], roof: [] };
    const tanks = [];
    for (const b of ch.list) {
      if (b.hidden) continue;
      const kind = facadeKind(b);
      const wc = wallColour(b), rc = roofColour(b);
      const floors = Math.max(1, b.f), y0 = b.ground - 0.4;
      const wb = bf[kind];
      if (detail) { owners[kind].push([wb.tris, b.i]); owners.roof.push([roofs.tris, b.i]); }
      else owners.facade.push([wb.tris, b.i]);
      const shed = detail && isShed(b) && b.rings.length === 1 ? minRect(b.rings[0]) : null;
      const rectOk = shed && shed.area / Math.max(1, Math.abs(ringArea(b.rings[0]))) < 1.3;
      if (rectOk) {
        // Gable roof along the long axis of the minimum rectangle.
        const { a, ux, uz, s0, s1, t0, t1 } = shed;
        const long = s1 - s0 >= t1 - t0;
        const P = (s, t) => [a[0] + s * ux - t * uz, a[1] + s * uz + t * ux];
        const span = long ? t1 - t0 : s1 - s0, rise = Math.min(4, span * 0.2);
        const eave = b.top - rise;
        const corners = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
        if (ringArea(corners) < 0) corners.reverse();
        walls(wb, corners, y0, eave, (eave - y0), wc, true);
        const ridgeA = long ? P(s0, (t0 + t1) / 2) : P((s0 + s1) / 2, t0), ridgeB = long ? P(s1, (t0 + t1) / 2) : P((s0 + s1) / 2, t1);
        const e = long ? [[P(s0, t0), P(s1, t0)], [P(s1, t1), P(s0, t1)]] : [[P(s1, t0), P(s1, t1)], [P(s0, t1), P(s0, t0)]];
        const top = eave + rise, rcol = rc;
        // two roof planes (double-sided via both windings) + gable triangles
        const quad = (p0, p1, p2, p3) => {
          for (const tri of [[p0, p1, p2], [p0, p2, p3], [p0, p2, p1], [p0, p3, p2]]) for (const p of tri) roofs.v(p[0], p[2], p[1], rcol, p[0] / 3, p[1] / 3);
        };
        const R = (p, y) => [p[0], p[1], y];
        if (long) {
          quad(R(e[0][0], eave), R(e[0][1], eave), R(ridgeB, top), R(ridgeA, top));
          quad(R(e[1][0], eave), R(e[1][1], eave), R(ridgeA, top), R(ridgeB, top));
        } else {
          quad(R(e[0][0], eave), R(e[0][1], eave), R(ridgeB, top), R(ridgeA, top));
          quad(R(e[1][0], eave), R(e[1][1], eave), R(ridgeA, top), R(ridgeB, top));
        }
        const gab = long ? [[P(s0, t0), P(s0, t1), ridgeA], [P(s1, t0), P(s1, t1), ridgeB]] : [[P(s0, t0), P(s1, t0), ridgeA], [P(s0, t1), P(s1, t1), ridgeB]];
        for (const [p, q, r] of gab) for (const tri of [[p, q, r], [p, r, q]]) for (const [pt, yy] of [[tri[0], tri[0] === r ? top : eave], [tri[1], tri[1] === r ? top : eave], [tri[2], tri[2] === r ? top : eave]]) wb.v(pt[0], yy, pt[1], wc, 0, 0);
        continue;
      }
      const roofY = b.top;
      const floorH = (roofY - b.ground) / floors;
      walls(wb, b.rings[0], y0, roofY, floorH, wc, true);
      for (const hole of b.rings.slice(1)) walls(wb, hole, y0, roofY, floorH, wc, false);
      roofPolygon(roofs, b.rings, roofY, rc);
      if (!detail || b.a < 20) continue;
      // Parapet: outer walls continue 0.9 m, inner face 0.22 m in, and a cap.
      const pc = [wc[0] * 0.95, wc[1] * 0.95, wc[2] * 0.95];
      const inn = inset(b.rings[0], 0.22);
      walls(extra, b.rings[0], roofY, roofY + 0.9, 3, pc, true);
      walls(extra, inn, roofY, roofY + 0.9, 3, pc, false);
      for (let k = 0; k < inn.length; k++) {
        const o0 = b.rings[0][k], o1 = b.rings[0][(k + 1) % inn.length], i0 = inn[k], i1 = inn[(k + 1) % inn.length], y = roofY + 0.9;
        extra.v(o0[0], y, o0[1], pc); extra.v(i1[0], y, i1[1], pc); extra.v(o1[0], y, o1[1], pc);
        extra.v(o0[0], y, o0[1], pc); extra.v(i0[0], y, i0[1], pc); extra.v(i1[0], y, i1[1], pc);
      }
      // Stair cabin ("mumty") and water tanks on flat roofs.
      const rnd = mulberry32(b.i * 31 + 7);
      const rect = minRect(b.rings[0]);
      const ang = rect ? Math.atan2(rect.uz, rect.ux) : 0;
      const randomInside = () => {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const p of inn) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
        for (let t = 0; t < 12; t++) {
          const x = x0 + 1.5 + rnd() * Math.max(0, x1 - x0 - 3), z = z0 + 1.5 + rnd() * Math.max(0, z1 - z0 - 3);
          if (pip(x, z, inn)) return [x, z];
        }
        return null;
      };
      if (floors >= 2 && b.a >= 90 && !["farm", "industrial", "utility"].includes(b.t)) {
        const p = randomInside();
        if (p) box(extra, p[0], p[1], roofY, 3.2, 4.2, 2.7, ang, wc);
      }
      if (["residential", "house", "hostel", "academic", "admin", "institutional", "health", "school", "commercial", "unknown"].includes(b.t) && b.a >= 35) {
        const n = Math.min(4, Math.max(1, Math.round(b.a / 260)));
        for (let k = 0; k < n; k++) { const p = randomInside(); if (p) tanks.push(p[0], roofY, p[1]); }
      }
    }
    const group = new THREE.Group();
    const meshes = [];
    if (!detail) {
      const m = new THREE.Mesh(one.geometry(true), MAT.facade);
      m.userData = { owners: owners.facade };
      group.add(m);
      group.userData.pick = [m];
      return group;
    }
    for (const k of ["facade", "house", "shed"]) {
      if (!bf[k].tris) continue;
      const m = new THREE.Mesh(bf[k].geometry(true), MAT[k]);
      m.userData = { owners: owners[k] };
      group.add(m); meshes.push(m);
    }
    if (roofs.tris) { const m = new THREE.Mesh(roofs.geometry(true), MAT.roof); m.userData = { owners: owners.roof }; group.add(m); meshes.push(m); }
    if (extra.tris) group.add(new THREE.Mesh(extra.geometry(true), MAT.extra));
    if (tanks.length) {
      const im = new THREE.InstancedMesh(TANK_GEO, MAT.tank, tanks.length / 3);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < tanks.length / 3; i++) im.setMatrixAt(i, m4.makeTranslation(tanks[i * 3], tanks[i * 3 + 1], tanks[i * 3 + 2]));
      group.add(im);
    }
    group.userData.pick = meshes;
    return group;
  }
  const MAT = {
    facade: new THREE.MeshBasicMaterial({ map: TEX.facade, vertexColors: true }),
    house: new THREE.MeshBasicMaterial({ map: TEX.house, vertexColors: true }),
    shed: new THREE.MeshBasicMaterial({ map: TEX.shed, vertexColors: true, side: THREE.DoubleSide }),
    roof: new THREE.MeshBasicMaterial({ map: roofTex, vertexColors: true, side: THREE.DoubleSide }),
    extra: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    tank: new THREE.MeshLambertMaterial({ color: 0x26282b }),
  };
  const TANK_GEO = new THREE.CylinderGeometry(0.65, 0.65, 1.3, 10).translate(0, 0.65, 0);

  for (const ch of chunks.values()) {
    ch.lod1 = buildChunk(ch, 0);
    groups.bld.add(ch.lod1);
  }
  function rebuildAllBuildings() {
    for (const ch of chunks.values()) {
      for (const g of [ch.lod0, ch.lod1]) if (g) { groups.bld.remove(g); g.traverse((o) => o.geometry && o.geometry !== TANK_GEO && o.geometry.dispose()); }
      ch.lod0 = null;
      ch.lod1 = buildChunk(ch, 0);
      groups.bld.add(ch.lod1);
    }
    dirty = true;
  }

  // Building collision index for free walk.
  const bGrid = new Map(), BGC = 40;
  for (const b of blds) {
    const r = b.rings[0];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of r) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    b.bb = [x0, z0, x1, z1];
    for (let i = Math.floor(x0 / BGC); i <= Math.floor(x1 / BGC); i++) for (let j = Math.floor(z0 / BGC); j <= Math.floor(z1 / BGC); j++) {
      const k = i + "," + j;
      if (!bGrid.has(k)) bGrid.set(k, []);
      bGrid.get(k).push(b);
    }
  }
  const buildingAt = (x, z) => (bGrid.get(Math.floor(x / BGC) + "," + Math.floor(z / BGC)) || []).find((b) => !b.hidden && x >= b.bb[0] && x <= b.bb[2] && z >= b.bb[1] && z <= b.bb[3] && pip(x, z, b.rings[0]) && !b.rings.slice(1).some((h) => pip(x, z, h)));

  // ---------------------------------------------------------------------------------------
  // Trees: points far away, simple crowns mid-range, detailed trees near the camera.
  await step(58, "Planting trees");
  const TR = D.trees, NT = TR.length / 3;
  {
    const pos = new Float32Array(NT * 3), col = new Float32Array(NT * 3);
    const rnd = mulberry32(99);
    for (let i = 0; i < NT; i++) {
      const x = TR[i * 3], z = TR[i * 3 + 1], h = TR[i * 3 + 2];
      pos.set([x, H(x, z) + h * 0.7, z], i * 3);
      const g = 0.32 + rnd() * 0.12;
      col.set([g * 0.55, g, g * 0.42], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: true, vertexColors: true }));
    pts.name = "treePoints";
    groups.trees.add(pts);
  }
  const TREE_CHUNK = 400;
  const treeHidden = new Set();
  const treeChunks = new Map();
  for (let i = 0; i < NT; i++) {
    const k = Math.floor(TR[i * 3] / TREE_CHUNK) + "," + Math.floor(TR[i * 3 + 1] / TREE_CHUNK);
    if (!treeChunks.has(k)) treeChunks.set(k, { cx: (Math.floor(TR[i * 3] / TREE_CHUNK) + 0.5) * TREE_CHUNK, cz: (Math.floor(TR[i * 3 + 1] / TREE_CHUNK) + 0.5) * TREE_CHUNK, idx: [], mid: null, near: null });
    treeChunks.get(k).idx.push(i);
  }
  const crownMid = (() => {
    const crown = new THREE.OctahedronGeometry(1, 0).scale(1, 1.15, 1).translate(0, 0.1, 0);
    return crown;
  })();
  const treeNearGeo = (() => {
    const trunk = new THREE.CylinderGeometry(0.022, 0.04, 1, 6).translate(0, 0.5, 0);
    const parts = [trunk];
    const blob = (x, y, z, s) => new THREE.IcosahedronGeometry(1, 1).scale(s, s * 0.85, s).translate(x, y, z);
    parts.push(blob(0, 0.78, 0, 0.36), blob(0.16, 0.7, 0.08, 0.26), blob(-0.14, 0.72, -0.1, 0.27), blob(0.02, 0.92, -0.05, 0.22));
    const cols = [];
    parts.forEach((p, k) => { const n = p.attributes.position.count; for (let i = 0; i < n; i++) { if (k === 0) cols.push(0.36, 0.27, 0.19); else { const y = p.attributes.position.getY(i); const s = 0.75 + y * 0.35; cols.push(0.27 * s, 0.45 * s, 0.2 * s); } } });
    const merged = mergeGeos(parts);
    merged.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    return merged;
  })();
  function mergeGeos(geos) {
    const pos = [], nor = [];
    for (const g of geos) {
      const gg = g.index ? g.toNonIndexed() : g;
      gg.computeVertexNormals();
      pos.push(...gg.attributes.position.array);
      nor.push(...gg.attributes.normal.array);
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    m.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    return m;
  }
  let crownMidBaked;
  // Fix colours to match the non-indexed merge.
  {
    const parts = [new THREE.CylinderGeometry(0.022, 0.04, 1, 6).translate(0, 0.5, 0)];
    const blob = (x, y, z, s) => new THREE.IcosahedronGeometry(1, 1).scale(s, s * 0.85, s).translate(x, y, z);
    parts.push(blob(0, 0.78, 0, 0.36), blob(0.16, 0.7, 0.08, 0.26), blob(-0.14, 0.72, -0.1, 0.27), blob(0.02, 0.92, -0.05, 0.22));
    const cols = [];
    parts.forEach((p, k) => {
      const g = p.index ? p.toNonIndexed() : p;
      for (let i = 0; i < g.attributes.position.count; i++) {
        if (k === 0) cols.push(0.36, 0.27, 0.19);
        else { const s = 0.72 + g.attributes.position.getY(i) * 0.4; cols.push(0.26 * s, 0.44 * s, 0.19 * s); }
      }
    });
    const tp = treeNearGeo.attributes.position.array, tn = treeNearGeo.attributes.normal.array;
    for (let i = 0; i < cols.length; i += 3) { const f = lightFor(tn[i], tn[i + 1], tn[i + 2]) * 1.05; cols[i] *= f; cols[i + 1] *= f; cols[i + 2] *= f; }
    treeNearGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    // Mid-range crown: flat-shaded octahedron with baked face light.
    const o = crownMid.index ? crownMid.toNonIndexed() : crownMid;
    o.computeVertexNormals();
    const op = o.attributes.position.array, oc = [];
    for (let i = 0; i < op.length; i += 9) {
      const ax = op[i + 3] - op[i], ay = op[i + 4] - op[i + 1], az = op[i + 5] - op[i + 2], bx = op[i + 6] - op[i], by = op[i + 7] - op[i + 1], bz = op[i + 8] - op[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
      const f = lightFor(nx / l, ny / l, nz / l) * 1.1;
      for (let k = 0; k < 3; k++) oc.push(f, f, f);
    }
    o.setAttribute("color", new THREE.Float32BufferAttribute(oc, 3));
    crownMidBaked = o;
  }
  const treeMidMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const treeNearMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  function treeMatrix(i, m4, rnd) {
    const x = TR[i * 3], z = TR[i * 3 + 1], h = Math.max(3, TR[i * 3 + 2]);
    const r = h >= 15 ? Math.min(4.5, 0.15 * h + 1) : Math.min(6, 0.32 * h + 1);
    const y = H(x, z);
    return { x, y, z, h, r, yaw: rnd() * Math.PI * 2, tint: 0.85 + rnd() * 0.3 };
  }
  function buildTreeChunk(tc, near) {
    const n = tc.idx.length, rnd = mulberry32(tc.idx[0] + (near ? 1 : 0));
    const im = new THREE.InstancedMesh(near ? treeNearGeo : crownMidBaked, near ? treeNearMat : treeMidMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    tc.idx.forEach((i, k) => {
      const t = treeMatrix(i, m4, rnd);
      if (treeHidden.has(i)) { im.setMatrixAt(k, m4.makeScale(0, 0, 0)); if (!near) im.setColorAt(k, c.setRGB(0, 0, 0)); return; }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
      if (near) { p.set(t.x, t.y, t.z); s.set(t.r * 2.6, t.h, t.r * 2.6); }
      else { p.set(t.x, t.y + t.h * 0.62, t.z); s.set(t.r, t.h * 0.42, t.r); }
      im.setMatrixAt(k, m4.compose(p, q, s));
      if (!near) im.setColorAt(k, c.setRGB(0.3 * t.tint, 0.45 * t.tint, 0.22 * t.tint));
    });
    im.frustumCulled = true;
    im.computeBoundingSphere();
    return im;
  }

  // ---------------------------------------------------------------------------------------
  // Street lights along paved campus roads, and mapped walls/fences
  await step(66, "Placing street lights");
  const lightChunks = new Map();
  {
    const campusRings = D.villages.filter((v) => v.campus).flatMap((v) => v.r.map(toRing));
    const inCampus = (x, z) => campusRings.some((r) => pip(x, z, r));
    for (const r of D.roads) {
      if (!["residential", "tertiary", "unclassified", "secondary", "primary", "trunk", "living_street"].includes(r.c)) continue;
      for (const P of clipLine(toRing(r.p))) {
      let acc = 17, side = 1;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.1) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        while (acc < L) {
          const x = a[0] + ux * acc - uz * side * (r.w / 2 + 1.5), z = a[1] + uz * acc + ux * side * (r.w / 2 + 1.5);
          if (inCampus(x, z) && !buildingAt(x, z)) {
            const k = Math.floor(x / 500) + "," + Math.floor(z / 500);
            if (!lightChunks.has(k)) lightChunks.set(k, { cx: (Math.floor(x / 500) + 0.5) * 500, cz: (Math.floor(z / 500) + 0.5) * 500, list: [], mesh: null });
            lightChunks.get(k).list.push([x, H(x, z), z, Math.atan2(-uz * side, ux * side)]);
          }
          acc += 34; side = -side;
        }
        acc -= L;
      }
      }
    }
  }
  const lampGeo = (() => {
    const pole = new THREE.CylinderGeometry(0.045, 0.075, 7, 6).translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(1.4, 0.08, 0.08).translate(0.7, 6.9, 0);
    const head = new THREE.BoxGeometry(0.6, 0.14, 0.28).translate(1.35, 6.82, 0);
    return mergeGeos([pole, arm, head]);
  })();
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xb4b8bc });
  function buildLights(lc) {
    const im = new THREE.InstancedMesh(lampGeo, lampMat, lc.list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    lc.list.forEach((l, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l[3]); im.setMatrixAt(i, m4.compose(p.set(l[0], l[1], l[2]), q, one)); });
    im.computeBoundingSphere();
    return im;
  }
  {
    const wb = new Batch(false), wcol = [0.74, 0.7, 0.64], rail = new Batch(false), runway = new Batch(true);
    for (const l0 of D.lines) for (const piece of clipLine(toRing(l0.p))) {
      const l = { ...l0, p: piece.flat() };
      const P = densify(piece, 6);
      if (l.k.startsWith("barrier:")) {
        const hgt = l.k === "barrier:fence" ? 1.5 : 2.0;
        for (let i = 0; i < P.length - 1; i++) {
          const a = P[i], b = P[i + 1], ya = H(a[0], a[1]), yb = H(b[0], b[1]);
          wb.v(a[0], ya, a[1], wcol); wb.v(b[0], yb + hgt, b[1], wcol); wb.v(b[0], yb, b[1], wcol);
          wb.v(a[0], ya, a[1], wcol); wb.v(a[0], ya + hgt, a[1], wcol); wb.v(b[0], yb + hgt, b[1], wcol);
        }
      } else if (l.k.startsWith("rail:")) ribbon(rail, toRing(l.p), 3.2, 0.35, hexRGB(0x5a534c), 4);
      else if (l.k === "aeroway:runway") ribbon(runway, toRing(l.p), l.w || 30, 0.36, white, 30);
      else if (l.k === "aeroway:taxiway") ribbon(runway, toRing(l.p), l.w || 15, 0.35, white, 15);
    }
    if (wb.tris) groups.lights.add(new THREE.Mesh(wb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    if (rail.tris) groups.misc.add(new THREE.Mesh(rail.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })));
    if (runway.tris) groups.misc.add(new THREE.Mesh(runway.geometry(), new THREE.MeshLambertMaterial({ map: TEX.major, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  }

  // ---------------------------------------------------------------------------------------
  // Road graph for street view
  await step(74, "Linking the road network");
  const GN = D.graph.nodes, GE = D.graph.edges;
  const nodeCount = GN.length / 2;
  const adj = Array.from({ length: nodeCount }, () => []);
  const edgeOk = GE.map((e) => inCB(GN[e[0] * 2], GN[e[0] * 2 + 1]) && inCB(GN[e[1] * 2], GN[e[1] * 2 + 1]));
  GE.forEach((e, k) => { if (edgeOk[k]) { adj[e[0]].push(k); adj[e[1]].push(k); } });
  const nx_ = (n) => GN[n * 2], nz_ = (n) => GN[n * 2 + 1];
  const edgeLen = GE.map((e) => Math.hypot(nx_(e[1]) - nx_(e[0]), nz_(e[1]) - nz_(e[0])));
  const edgeGrid = new Map(), EG = 60;
  GE.forEach((e, k) => {
    if (!edgeOk[k]) return;
    const x0 = Math.min(nx_(e[0]), nx_(e[1])), x1 = Math.max(nx_(e[0]), nx_(e[1])), z0 = Math.min(nz_(e[0]), nz_(e[1])), z1 = Math.max(nz_(e[0]), nz_(e[1]));
    for (let i = Math.floor(x0 / EG); i <= Math.floor(x1 / EG); i++) for (let j = Math.floor(z0 / EG); j <= Math.floor(z1 / EG); j++) {
      const key = i + "," + j;
      if (!edgeGrid.has(key)) edgeGrid.set(key, []);
      edgeGrid.get(key).push(k);
    }
  });
  function nearestEdge(x, z, maxD = 80, filter) {
    let best = null;
    const r = Math.ceil(maxD / EG);
    const ci = Math.floor(x / EG), cj = Math.floor(z / EG);
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (const k of edgeGrid.get(i + "," + j) || []) {
      if (filter && !filter(k)) continue;
      const e = GE[k], ax = nx_(e[0]), az = nz_(e[0]), bx = nx_(e[1]), bz = nz_(e[1]);
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d <= maxD && (!best || d < best.d)) best = { k, t, d };
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------
  // Labels
  await step(80, "Writing labels");
  const labelLayer = $("labels");
  const labels = [];
  const normName = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameName = (a, b) => { a = normName(a); b = normName(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
  function addLabel(text, kind, x, z, y, range, prio, bld) {
    const el = document.createElement("div");
    el.className = "lbl k-" + kind;
    el.textContent = text;
    labelLayer.appendChild(el);
    labels.push({ el, kind, x, z, y: y == null ? H(x, z) : y, range, prio, bld, w: 0, shown: false });
  }
  for (const b of D.blocks) if (b.n || b.s.buildings >= 25 || b.a > 300000) addLabel(b.n ? b.n : b.use + " · B" + b.id, "block", b.c[0], b.c[1], null, b.n ? 2600 : 1800, 3);
  for (const b of blds) if (b.n) addLabel(b.n, b.t, b.c[0], b.c[1], b.top + 2, 1300, b.t === "academic" || b.t === "hostel" ? 1 : 2, b);
  for (const p of D.pois) {
    const dup = blds.some((b) => b.n && sameName(b.n, p.n) && Math.hypot(b.c[0] - p.x, b.c[1] - p.z) < 300) ||
      D.blocks.some((b) => b.n && sameName(b.n, p.n) && Math.hypot(b.c[0] - p.x, b.c[1] - p.z) < 600);
    if (!dup) addLabel(p.n, "poi", p.x, p.z, null, 1000, 2);
  }
  for (const v of D.villages.filter((v) => v.campus)) {
    const r = toRing(v.r[0]), c = centroid(r);
    addLabel(v.n, "poi", c[0], c[1], null, 12000, 0);
  }

  // ---------------------------------------------------------------------------------------
  // Aerial camera: goal/view easing with glide.
  await step(86, "Setting up the camera");
  const view = { tx: 0, tz: 0, ty: 0, dist: 3200, theta: 0.35, phi: 0.95 };
  const goal = { ...view };
  const PRESETS = {
    overview: { tx: -1500, tz: 800, dist: 9500, theta: 0.0, phi: 0.75 },
    core: { tx: 350, tz: 0, dist: 1500, theta: 0.5, phi: 0.95 },
    airport: { tx: -1980, tz: -1250, dist: 1600, theta: -0.3, phi: 1.0 },
    housing: { tx: 900, tz: -620, dist: 900, theta: 0.9, phi: 1.05 },
    fields: { tx: -400, tz: 2600, dist: 3000, theta: 0.2, phi: 0.9 },
  };
  Object.assign(view, PRESETS.core);
  Object.assign(goal, PRESETS.core);
  let mode = "aerial";
  function applyAerial() {
    const sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    view.ty = H(view.tx, view.tz);
    camera.position.set(view.tx + view.dist * sp * Math.sin(view.theta), view.ty + view.dist * cp, view.tz + view.dist * sp * Math.cos(view.theta));
    camera.lookAt(view.tx, view.ty, view.tz);
    camera.fov = 50;
    camera.near = Math.max(1, view.dist / 400);
    camera.far = view.dist * 14 + 4000;
    camera.updateProjectionMatrix();
  }
  function flyTo(p) { Object.assign(goal, p); dirty = true; }

  // ---------------------------------------------------------------------------------------
  // Street view state
  const SV = {
    on: false, free: false, drive: false,
    x: 0, z: 0, yaw: 0, pitch: 0, fov: 72,
    e: -1, s: 0, dir: 1, // edge, distance along edge from its first node, travel direction (+1 a->b)
    atNode: -1, choices: [], sel: 0, keys: new Set(), vel: 0,
  };
  const EYE = { walk: 1.6, drive: 1.35 };
  function edgeHeading(k, fromNode) {
    const e = GE[k], a = fromNode === e[0] ? e[0] : e[1], b = fromNode === e[0] ? e[1] : e[0];
    return Math.atan2(nx_(b) - nx_(a), -(nz_(b) - nz_(a))); // yaw: 0 = north (-z), clockwise positive
  }
  const yawDir = (yaw) => [Math.sin(yaw), -Math.cos(yaw)];
  function svPosOnEdge() {
    const e = GE[SV.e], ax = nx_(e[0]), az = nz_(e[0]), bx = nx_(e[1]), bz = nz_(e[1]), L = edgeLen[SV.e] || 1;
    const t = SV.s / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    // Keep left (India): offset from the centreline on wider roads.
    const r = D.roads[e[2]], dx = ((bx - ax) / L) * SV.dir, dz = ((bz - az) / L) * SV.dir;
    const off = SV.drive ? (r.w >= 5 ? r.w / 4 : 0) : Math.max(0, r.w / 2 - 1.2);
    return [x + dz * off, z - dx * off];
  }
  function enterStreet(x, z) {
    const ne = nearestEdge(x, z, 150);
    if (!ne) { toast("No mapped road near here - try closer to a road"); return false; }
    SV.on = true; SV.free = false; SV.e = ne.k; SV.s = ne.t * edgeLen[ne.k];
    const e = GE[ne.k];
    const hdg = edgeHeading(ne.k, e[0]);
    const camYaw = mode !== "street" ? -view.theta : SV.yaw;
    SV.dir = Math.cos(hdg - camYaw) >= 0 ? 1 : -1;
    SV.yaw = SV.dir > 0 ? hdg : hdg + Math.PI;
    SV.pitch = -0.02; SV.atNode = -1; SV.vel = 0;
    [SV.x, SV.z] = svPosOnEdge();
    setMode("street");
    updateArrows();
    return true;
  }
  let panelBeforeStreet = null;
  function setMode(m) {
    const prev = mode;
    mode = m;
    if ((m === "pick" || m === "street") && prev === "plan") streetFrom = "plan";
    else if (m === "aerial" || m === "plan") streetFrom = "aerial";
    document.body.classList.toggle("street", m === "street");
    document.body.classList.toggle("planning", m === "plan");
    $("mode-aerial").setAttribute("aria-pressed", m === "aerial");
    $("mode-street").setAttribute("aria-pressed", m === "street" || m === "pick");
    if ($("mode-plan")) $("mode-plan").setAttribute("aria-pressed", m === "plan");
    if (PLAN && prev !== m) PLAN.mode(m, prev);
    $("sv").hidden = m !== "street";
    $("minimap").hidden = m !== "street";
    $("sv-hint").hidden = m !== "pick";
    document.body.classList.toggle("picking", m === "pick");
    // Map overlays are for the aerial view; street view shows the place itself.
    for (const [g, id] of [["blocks", "ly-blocks"], ["blockfill", "ly-blockfill"], ["villages", "ly-villages"]]) groups[g].visible = m !== "street" && $(id).checked;
    if (m === "street") {
      scene.fog = new THREE.Fog(SKY, 140, 1100);
      $("info").hidden = true;
      if (panelBeforeStreet === null) panelBeforeStreet = !$("panel").classList.contains("closed");
      setPanel(false);
    } else {
      scene.fog = null;
      if (panelBeforeStreet !== null && m === "aerial") { if (panelBeforeStreet && innerWidth > 700) setPanel(true); panelBeforeStreet = null; }
    }
    dirty = true;
  }
  function exitStreet() {
    SV.on = false;
    SV.keys.clear();
    SV.vel = 0;
    const [dx, dz] = yawDir(SV.yaw);
    Object.assign(view, { tx: SV.x + dx * 60, tz: SV.z + dz * 60, dist: 420, theta: -SV.yaw, phi: 1.05 });
    Object.assign(goal, view);
    setMode(streetFrom === "plan" ? "plan" : "aerial");
  }
  // Junction choices: edges leaving `node` other than `cameFrom`.
  function choicesAt(node, cameFrom) {
    return adj[node].filter((k) => k !== cameFrom || adj[node].length === 1).map((k) => ({ k, node, hdg: edgeHeading(k, node) }));
  }
  let arrowKey = "", arrowOpts = [];
  const ARROW_SVG = '<svg class="i" viewBox="0 0 24 24"><path d="M12 4l7 9h-4v7H9v-7H5z" fill="currentColor" stroke="none"/></svg>';
  // Press-and-hold moves; a short tap on "forward" steps ahead a few metres.
  function holdToMove(b, key) {
    let t0 = 0;
    const stop = () => { SV.keys.delete(key); };
    b.addEventListener("pointerdown", (e) => { e.stopPropagation(); t0 = performance.now(); SV.keys.add(key); dirty = true; });
    b.addEventListener("pointerup", stop);
    b.addEventListener("pointerleave", stop);
    b.addEventListener("pointercancel", stop);
    return () => performance.now() - t0 > 250; // was it a hold?
  }
  function updateArrows() {
    const box = $("sv-arrows");
    let opts = [];
    if (SV.on && SV.free) opts = [{ free: "fwd", hdg: SV.yaw }, { free: "back", hdg: SV.yaw + Math.PI }];
    else if (SV.on && SV.atNode >= 0) opts = SV.choices;
    else if (SV.on) {
      const e = GE[SV.e];
      opts = [{ k: SV.e, fwd: true, hdg: edgeHeading(SV.e, SV.dir > 0 ? e[0] : e[1]) }, { k: SV.e, back: true, hdg: edgeHeading(SV.e, SV.dir > 0 ? e[1] : e[0]) }];
    }
    const key = [SV.on, SV.free, SV.atNode, SV.e, SV.dir, SV.sel, opts.length].join(",");
    if (key !== arrowKey) {
      arrowKey = key;
      arrowOpts = opts;
      box.innerHTML = "";
      opts.forEach((o, i) => {
        const b = document.createElement("button");
        b.innerHTML = ARROW_SVG;
        if (o.free) {
          b.title = o.free === "fwd" ? "Walk forward (hold)" : "Walk back (hold)";
          holdToMove(b, o.free);
        } else {
          const r = D.roads[GE[o.k][2]];
          b.title = (r.n || pretty(r.c)) + (o.back ? " (turn around)" : o.fwd ? " (hold to move)" : "");
          if (SV.atNode >= 0 && i === SV.sel) b.classList.add("sel");
          const held = o.fwd ? holdToMove(b, "fwd") : null;
          b.addEventListener("click", () => { if (!(held && held())) takeOption(o); });
        }
        box.appendChild(b);
      });
    }
    // Re-aim the arrows for the current view direction.
    [...box.children].forEach((b, i) => {
      const o = arrowOpts[i];
      if (!o) return;
      const rel = (o.free ? (o.free === "fwd" ? 0 : Math.PI) : o.hdg - SV.yaw);
      const R = 52;
      b.style.transform = `translate(${Math.sin(rel) * R * 1.6}px, ${-Math.cos(rel) * R * 0.75}px) rotate(${rel}rad)`;
    });
  }
  function takeOption(o) {
    if (o.back) { SV.dir = -SV.dir; SV.yaw += Math.PI; SV.atNode = -1; updateArrows(); dirty = true; return; }
    if (o.fwd) { SV.keys.add("pulse"); return; }
    const e = GE[o.k];
    SV.e = o.k;
    SV.dir = e[0] === o.node ? 1 : -1;
    SV.s = SV.dir > 0 ? 0.01 : edgeLen[o.k] - 0.01;
    SV.atNode = -1;
    SV.targetYaw = o.hdg;
    SV.keys.add("pulse");
    updateArrows();
    dirty = true;
  }
  function stepFollow(dt) {
    const fwd = SV.keys.has("fwd") || SV.keys.has("pulse"), back = SV.keys.has("back");
    const speed = (SV.drive ? 11 : 1.6) * (SV.keys.has("run") ? (SV.drive ? 2.2 : 3.5) : 1);
    const want = fwd ? speed : back ? -speed * 0.6 : 0;
    SV.vel += (want - SV.vel) * Math.min(1, dt * (SV.drive ? 2.5 : 6));
    if (Math.abs(SV.vel) < 0.02 && !fwd && !back) { SV.vel = 0; return false; }
    if (SV.atNode >= 0) {
      if (back) { SV.atNode = -1; return true; }
      if (!fwd) { SV.vel = 0; return false; }
      // Continue along the selected option.
      const o = SV.choices[SV.sel];
      if (o) takeOption(o);
      return true;
    }
    SV.s += SV.vel * dt * SV.dir;
    const L = edgeLen[SV.e];
    if (SV.s < 0 || SV.s > L) {
      const e = GE[SV.e];
      const node = SV.s > L ? e[1] : e[0];
      SV.s = Math.max(0, Math.min(L, SV.s));
      if (SV.vel < 0) {
        // Backing up: continue through simple nodes, stop at junctions and dead ends.
        const ch = adj[node].filter((k) => k !== SV.e);
        if (ch.length === 1) {
          const k = ch[0], starts = GE[k][0] === node;
          SV.e = k; SV.dir = starts ? -1 : 1; SV.s = starts ? 0 : edgeLen[k];
        } else SV.vel = 0;
        [SV.x, SV.z] = svPosOnEdge();
        return true;
      }
      const ch = choicesAt(node, SV.e);
      if (ch.length === 1) {
        const o = ch[0];
        SV.e = o.k; SV.dir = GE[o.k][0] === node ? 1 : -1; SV.s = SV.dir > 0 ? 0 : edgeLen[o.k];
      } else {
        SV.atNode = node; SV.choices = ch.length ? ch : [];
        // Preselect the straightest way on.
        let best = 0, bd = Infinity;
        ch.forEach((c, i) => { const d = Math.abs(Math.atan2(Math.sin(c.hdg - SV.yaw), Math.cos(c.hdg - SV.yaw))); if (d < bd) { bd = d; best = i; } });
        SV.sel = best;
        SV.vel = 0;
        SV.keys.delete("pulse");
        updateArrows();
      }
    }
    [SV.x, SV.z] = svPosOnEdge();
    // Face the travel direction smoothly (unless the user is looking around).
    const e = GE[SV.e], hdg = edgeHeading(SV.e, SV.dir > 0 ? e[0] : e[1]);
    if (!dragging && SV.vel > 0.1) {
      const d = Math.atan2(Math.sin(hdg - SV.yaw), Math.cos(hdg - SV.yaw));
      SV.yaw += d * Math.min(1, dt * (SV.drive ? 3 : 2));
    }
    if (SV.keys.has("pulse") && SV.atNode < 0 && Math.abs(SV.vel) > speed * 0.9) SV.keys.delete("pulse");
    return true;
  }
  function stepFree(dt) {
    let f = 0, s = 0;
    if (SV.keys.has("fwd")) f += 1;
    if (SV.keys.has("back")) f -= 1;
    if (SV.keys.has("left")) s -= 1;
    if (SV.keys.has("right")) s += 1;
    if (SV.keys.has("turnL")) SV.yaw -= dt * 1.4;
    if (SV.keys.has("turnR")) SV.yaw += dt * 1.4;
    if (!f && !s) return SV.keys.has("turnL") || SV.keys.has("turnR");
    const speed = (SV.drive ? 9 : 1.6) * (SV.keys.has("run") ? 3.5 : 1);
    const [dx, dz] = yawDir(SV.yaw);
    const mx = (dx * f - dz * s) * speed * dt, mz = (dz * f + dx * s) * speed * dt;
    const inside = buildingAt(SV.x, SV.z);
    const free = (x, z) => { const b = buildingAt(x, z); return (!b || b === inside) && inCB(x, z); };
    if (free(SV.x + mx, SV.z + mz)) { SV.x += mx; SV.z += mz; }
    else if (free(SV.x + mx, SV.z)) SV.x += mx;
    else if (free(SV.x, SV.z + mz)) SV.z += mz;
    return true;
  }
  function applyStreet() {
    const eye = SV.drive ? EYE.drive : EYE.walk;
    const y = H(SV.x, SV.z) + 0.3 + eye;
    camera.position.set(SV.x, y, SV.z);
    const [dx, dz] = yawDir(SV.yaw);
    const cp = Math.cos(SV.pitch);
    camera.lookAt(SV.x + dx * cp * 10, y + Math.sin(SV.pitch) * 10, SV.z + dz * cp * 10);
    camera.fov = SV.fov;
    camera.near = 0.3;
    camera.far = 1500;
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------------------
  // Input
  let dragging = false, dragBtn = 0, lastX = 0, lastY = 0, downX = 0, downY = 0, vel = { th: 0, ph: 0, px: 0, pz: 0 };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  const touches = new Map();
  let pinchD = 0, didPinch = false;
  canvas.addEventListener("pointerdown", (e) => { if (!touches.size) didPinch = false; if (e.pointerType === "touch") touches.set(e.pointerId, [e.clientX, e.clientY]); });
  const endTouch = (e) => { touches.delete(e.pointerId); pinchD = 0; };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);
  canvas.addEventListener("pointermove", (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size !== 2) return;
    const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    didPinch = true;
    if (pinchD) {
      if (mode === "street") SV.fov = Math.max(30, Math.min(95, SV.fov * (pinchD / d)));
      else goal.dist = Math.max(25, Math.min(16000, goal.dist * (pinchD / d)));
      dirty = true;
    }
    pinchD = d;
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (mode === "plan" && PLAN && e.button === 0 && !e.shiftKey && touches.size < 2 && PLAN.down(e)) { planDrag = true; canvas.setPointerCapture(e.pointerId); return; }
    dragging = true; dragBtn = e.button === 2 || e.shiftKey ? 2 : 0;
    lastX = downX = e.clientX; lastY = downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (planDrag) { PLAN.move(e); return; }
    if (!dragging) { if (mode === "aerial" || mode === "plan") hoverReadout(e); if (mode === "plan" && PLAN) PLAN.hover(e); return; }
    if (touches.size >= 2) { lastX = e.clientX; lastY = e.clientY; return; } // pinching, not orbiting
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (mode === "street") {
      SV.yaw -= dx * 0.0042 * (SV.fov / 72);
      SV.pitch = Math.max(-1.2, Math.min(1.2, SV.pitch + dy * 0.0036 * (SV.fov / 72)));
      updateArrows();
    } else if (dragBtn === 2) {
      const k = goal.dist / canvas.clientHeight * 1.2, c = Math.cos(view.theta), s = Math.sin(view.theta);
      goal.tx -= (dx * c + dy * s) * k; goal.tz -= (-dx * s + dy * c) * k;
      vel.px = -(dx * c + dy * s) * k; vel.pz = -(-dx * s + dy * c) * k;
    } else {
      goal.theta -= dx * 0.005; goal.phi = Math.max(0.12, Math.min(1.38, goal.phi + dy * 0.004));
      vel.th = -dx * 0.005;
    }
    dirty = true;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (planDrag) { planDrag = false; PLAN.up(e); return; }
    dragging = false;
    canvas.classList.remove("dragging");
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && !didPinch) onClick(e);
    else if (mode === "aerial" || mode === "plan") { goal.theta += vel.th * 8; goal.tx += vel.px * 6; goal.tz += vel.pz * 6; }
    vel = { th: 0, ph: 0, px: 0, pz: 0 };
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (mode === "street") { SV.fov = Math.max(30, Math.min(95, SV.fov + Math.sign(e.deltaY) * 5)); dirty = true; return; }
    const f = Math.exp(Math.sign(e.deltaY) * 0.18);
    const hit = groundHit(e.clientX, e.clientY);
    const nd = Math.max(25, Math.min(16000, goal.dist * f));
    if (hit && f < 1) { const k = 1 - nd / goal.dist; goal.tx += (hit.x - goal.tx) * k; goal.tz += (hit.z - goal.tz) * k; }
    goal.dist = nd;
    dirty = true;
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    if (mode === "plan") { if (PLAN) PLAN.dblclick(e); return; }
    if (mode !== "aerial") return;
    const hit = groundHit(e.clientX, e.clientY);
    if (hit) flyTo({ tx: hit.x, tz: hit.z, dist: Math.max(120, goal.dist * 0.45) });
  });
  const keyMap = { ArrowUp: "fwd", KeyW: "fwd", ArrowDown: "back", KeyS: "back", KeyA: "left", KeyD: "right", ShiftLeft: "run", ShiftRight: "run", KeyQ: "turnL", KeyE: "turnR" };
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
    if (mode === "plan" && PLAN && $("help").hidden && PLAN.key(e)) return;
    if (e.key === "Escape") { if (!$("help").hidden) $("help").hidden = true; else if (mode === "street") exitStreet(); else if (mode === "pick") setMode(streetFrom === "plan" ? "plan" : "aerial"); else if (mode !== "aerial") setMode("aerial"); else $("info").hidden = true; return; }
    if (e.key === "?") { $("help").hidden = false; return; }
    if (e.key === "/") { e.preventDefault(); setPanel(true); $("find").focus(); return; }
    if (e.code === "KeyV") { mode === "aerial" || mode === "plan" ? setMode("pick") : mode === "street" ? exitStreet() : setMode("aerial"); return; }
    if (mode === "street") {
      if (!SV.free && SV.atNode >= 0 && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        SV.sel = (SV.sel + (e.code === "ArrowRight" ? 1 : SV.choices.length - 1)) % Math.max(1, SV.choices.length);
        updateArrows(); e.preventDefault(); return;
      }
      if (!SV.free && (e.code === "ArrowLeft" || e.code === "KeyA")) { SV.keys.add("turnL"); e.preventDefault(); return; }
      if (!SV.free && (e.code === "ArrowRight" || e.code === "KeyD")) { SV.keys.add("turnR"); e.preventDefault(); return; }
      if (SV.free && e.code === "ArrowLeft") { SV.keys.add("turnL"); e.preventDefault(); return; }
      if (SV.free && e.code === "ArrowRight") { SV.keys.add("turnR"); e.preventDefault(); return; }
      if (keyMap[e.code]) { SV.keys.add(keyMap[e.code]); e.preventDefault(); dirty = true; }
      return;
    }
    if (e.code === "KeyR") flyTo(PRESETS.core);
    const pan = goal.dist * 0.08, c = Math.cos(view.theta), s = Math.sin(view.theta);
    if (e.code === "ArrowUp") { goal.tx -= s * pan; goal.tz -= c * pan; }
    if (e.code === "ArrowDown") { goal.tx += s * pan; goal.tz += c * pan; }
    if (e.code === "ArrowLeft") { goal.tx -= c * pan; goal.tz += s * pan; }
    if (e.code === "ArrowRight") { goal.tx += c * pan; goal.tz -= s * pan; }
    if (e.code === "KeyQ") goal.theta += 0.15;
    if (e.code === "KeyE") goal.theta -= 0.15;
    if (e.key === "+" || e.key === "=") goal.dist = Math.max(25, goal.dist / 1.3);
    if (e.key === "-") goal.dist = Math.min(16000, goal.dist * 1.3);
    dirty = true;
  });
  window.addEventListener("blur", () => { SV.keys.clear(); });
  window.addEventListener("keyup", (e) => {
    const k = keyMap[e.code];
    if (k) SV.keys.delete(k);
    if (["ArrowLeft", "KeyA"].includes(e.code)) SV.keys.delete("turnL");
    if (["ArrowRight", "KeyD"].includes(e.code)) SV.keys.delete("turnR");
  });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function setRay(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function groundHit(cx, cy) {
    setRay(cx, cy);
    const hit = ray.intersectObject(groups.terrain, true)[0];
    return hit ? hit.point : null;
  }
  function pickBuilding(cx, cy) {
    setRay(cx, cy);
    const meshes = [];
    for (const ch of chunks.values()) { const g = ch.lod0 && ch.lod0.visible ? ch.lod0 : ch.lod1; if (g && g.visible) meshes.push(...g.userData.pick); }
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const owners = hit.object.userData.owners;
    let lo = 0, hi = owners.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (owners[m][0] <= hit.faceIndex) lo = m; else hi = m - 1; }
    return { b: blds[owners[lo][1]], point: hit.point, dist: hit.distance };
  }
  function onClick(e) {
    if (mode === "plan") { if (PLAN) PLAN.click(e); return; }
    if (mode === "pick") { const hit = groundHit(e.clientX, e.clientY); if (hit) enterStreet(hit.x, hit.z); return; }
    if (mode === "street") {
      const pb = pickBuilding(e.clientX, e.clientY);
      if (pb && pb.dist < 300) { showBuilding(pb.b); $("info").hidden = false; }
      return;
    }
    const pb = pickBuilding(e.clientX, e.clientY);
    const gh = groundHit(e.clientX, e.clientY);
    if (pb && (!gh || pb.dist <= camera.position.distanceTo(gh) + 1)) { showBuilding(pb.b); return; }
    if (gh) { const b = blockAt(gh.x, gh.z); if (b) showBlock(b, gh); else $("info").hidden = true; }
  }
  function hoverReadout(e) {
    const hit = groundHit(e.clientX, e.clientY);
    if (!hit) return;
    const [lon, lat] = unproj(hit.x, hit.z);
    $("cursor").textContent = `${lat.toFixed(5)}° N  ${lon.toFixed(5)}° E  ${(D.terrain.base + H(hit.x, hit.z)).toFixed(0)} m`;
  }

  // ---------------------------------------------------------------------------------------
  // Info cards
  const info = $("info"), infoBody = $("info-body");
  $("info-close").addEventListener("click", () => { info.hidden = true; selection(null); dirty = true; });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const SRC = ["OpenStreetMap", "Google Open Buildings", "Microsoft ML Buildings", "Detected in Google 2.5D presence raster"];
  const HS = { tagged: "height tagged in OSM", measured: "height measured (Google 2.5D)", estimated: "height estimated from size", detected: "height measured (Google 2.5D)" };
  const TS = { tag: "type from OSM tag", name: "type from name", place: "type from a place inside", context: "type from land use", shape: "type estimated from size and shape" };
  let selLine = null;
  function selection(b) {
    if (selLine) { scene.remove(selLine); selLine.geometry.dispose(); selLine = null; }
    if (!b) return;
    const pts = [];
    for (const r of b.rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length];
      pts.push(a[0], b.top + 1.2, a[1], c[0], b.top + 1.2, c[1], a[0], b.ground, a[1], c[0], b.ground, c[1], a[0], b.ground, a[1], a[0], b.top + 1.2, a[1]);
    }
    selLine = lineSegments(pts, 0xffb020, 1);
    selLine.material.depthTest = false;
    selLine.renderOrder = 10;
    scene.add(selLine);
  }
  function linkRow(lon, lat) {
    return `<div class="actions">
      <button data-act="walk">Walk here</button>
      <a target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}">Google Street View</a>
      <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}">Google Maps</a>
      <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=19/${lat.toFixed(6)}/${lon.toFixed(6)}">OSM</a>
    </div>`;
  }
  function showBuilding(b) {
    const [lon, lat] = unproj(b.c[0], b.c[1]);
    const blk = blockById.get(b.b);
    infoBody.innerHTML = `<h2>${esc(b.n || TYPE_LABEL[b.t] || "Building")}</h2>
      <div class="sub">${esc(TYPE_LABEL[b.t] || b.t)}${b.tag ? " · OSM building=" + esc(b.tag) : ""}</div>
      <div class="pills"><span class="pill ${b.hs === "estimated" ? "" : "ok"}">${HS[b.hs] || b.hs}</span><span class="pill">${TS[b.ts] || b.ts}</span></div>
      <table class="kv">
        <tr><td>Height</td><td>${b.h.toFixed(1)} m</td></tr>
        <tr><td>Floors (from height)</td><td>${b.f}</td></tr>
        <tr><td>Footprint</td><td>${fmt(b.a)} m²</td></tr>
        <tr><td>Floor area (approx.)</td><td>${fmt(b.a * b.f)} m²</td></tr>
        <tr><td>Ground</td><td>${(D.terrain.base + b.ground).toFixed(0)} m above sea level</td></tr>
        <tr><td>Block</td><td>${blk ? `<a href="#" data-block="${blk.id}">B${blk.id} · ${esc(blk.use)}</a>` : "-"}</td></tr>
        <tr><td>Footprint source</td><td style="font-family:inherit">${SRC[b.src]}</td></tr>
        <tr><td>Location</td><td>${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E</td></tr>
      </table>${linkRow(lon, lat)}`;
    info.hidden = false;
    selection(b);
    wireInfo(b.c[0], b.c[1]);
    dirty = true;
  }
  function bars(obj, total, labeler) {
    return `<div class="bars">${Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div class="bar"><span>${esc(labeler ? labeler(k) : pretty(k))}</span><i style="width:${Math.max(3, (100 * v) / Math.max(1, total))}%"></i><span class="num">${typeof v === "number" && v % 1 ? v.toFixed(1) : v}</span></div>`).join("")}</div>`;
  }
  // Block snapshot: satellite crop with the block outline and its buildings coloured by type.
  function blockThumb(b) {
    const ring = blockRings.get(b.id);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of ring) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    const pad = Math.max(20, (x1 - x0 + z1 - z0) * 0.04);
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    const W = 600, Hh = Math.round(Math.min(420, Math.max(220, (W * (z1 - z0)) / (x1 - x0))));
    const s = Math.min(W / (x1 - x0), Hh / (z1 - z0));
    const c = document.createElement("canvas");
    c.width = W; c.height = Hh;
    const ctx = c.getContext("2d");
    const ox = (W - (x1 - x0) * s) / 2, oz = (Hh - (z1 - z0) * s) / 2;
    const tx = (x) => ox + (x - x0) * s, tz = (z) => oz + (z - z0) * s;
    ctx.fillStyle = "#ccc"; ctx.fillRect(0, 0, W, Hh);
    if (SAT_IMG) {
      const sx = ((x0 - SG.x0) / satW) * SAT_IMG.width, sy = ((z0 - SG.z0) / satH) * SAT_IMG.height;
      const sw = ((x1 - x0) / satW) * SAT_IMG.width, sh = ((z1 - z0) / satH) * SAT_IMG.height;
      ctx.drawImage(SAT_IMG, sx, sy, sw, sh, ox, oz, (x1 - x0) * s, (z1 - z0) * s);
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.rect(0, 0, W, Hh);
    ring.forEach((p, k) => (k ? ctx.lineTo(tx(p[0]), tz(p[1])) : ctx.moveTo(tx(p[0]), tz(p[1]))));
    ctx.closePath(); ctx.fill("evenodd");
    for (const bl of blds) {
      if (bl.b !== b.id) continue;
      ctx.fillStyle = "#" + (TYPE_COLOUR[bl.t] || 0xbbbbbb).toString(16).padStart(6, "0");
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); bl.rings[0].forEach((p, k) => (k ? ctx.lineTo(tx(p[0]), tz(p[1])) : ctx.moveTo(tx(p[0]), tz(p[1])))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
    ctx.beginPath(); ring.forEach((p, k) => (k ? ctx.lineTo(tx(p[0]), tz(p[1])) : ctx.moveTo(tx(p[0]), tz(p[1])))); ctx.closePath(); ctx.stroke();
    c.style.cssText = "width:100%;border-radius:8px;margin:4px 0 6px;display:block";
    return c;
  }
  function showBlock(b) {
    const s = b.s;
    const [lon, lat] = unproj(b.c[0], b.c[1]);
    const roadsTot = Object.values(s.roads_km).reduce((a, v) => a + v, 0), waterTot = Object.values(s.water_km).reduce((a, v) => a + v, 0);
    infoBody.innerHTML = `<h2>${esc(b.n || b.use)}</h2>
      <div class="sub">Block B${b.id} · ${esc(b.use)} · ${fmt(b.a / 10000, 2)} ha${b.names.length > 1 ? " · " + esc(b.names.slice(1, 4).join(", ")) : ""}</div>
      <table class="kv">
        <tr><td>Buildings</td><td>${s.buildings}</td></tr>
        <tr><td>Footprint / floor area</td><td>${fmt(s.footprint_m2)} / ${fmt(s.floor_area_m2)} m²</td></tr>
        <tr><td>Trees (crowns)</td><td>${fmt(s.trees)}</td></tr>
        <tr><td>Roads bordering or inside</td><td>${roadsTot.toFixed(1)} km</td></tr>
        <tr><td>Waterways</td><td>${waterTot.toFixed(1)} km</td></tr>
      </table>
      ${s.buildings ? "<h3 style='margin:10px 0 2px;font-size:12px'>Buildings by type</h3>" + bars(s.by_type, s.buildings, (k) => TYPE_LABEL[k] || k) : ""}
      <h3 style="margin:10px 0 2px;font-size:12px">Ground cover (%)</h3>${bars(s.cover, 100)}
      ${roadsTot ? "<h3 style='margin:10px 0 2px;font-size:12px'>Roads (km)</h3>" + bars(s.roads_km, roadsTot) : ""}
      ${waterTot ? "<h3 style='margin:10px 0 2px;font-size:12px'>Waterways (km)</h3>" + bars(s.water_km, waterTot) : ""}
      ${linkRow(lon, lat)}`;
    infoBody.querySelector(".sub").after(blockThumb(b));
    info.hidden = false;
    selection(null);
    wireInfo(b.c[0], b.c[1]);
    dirty = true;
  }
  function wireInfo(x, z) {
    infoBody.querySelector("[data-act=walk]")?.addEventListener("click", () => enterStreet(x, z));
    infoBody.querySelectorAll("[data-block]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const b = blockById.get(+a.dataset.block);
      if (b) { showBlock(b); flyTo({ tx: b.c[0], tz: b.c[1], dist: Math.max(300, Math.sqrt(b.a) * 2.2) }); }
    }));
  }
  let toastTimer = 0;
  function toast(msg) {
    const h = $("sv-hint");
    h.textContent = msg; h.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { h.hidden = mode !== "pick"; h.textContent = "Click any road to drop in at street level"; }, 2600);
  }

  // ---------------------------------------------------------------------------------------
  // Panel: tabs, views, legend, blocks list, layers, data, search
  await step(90, "Filling the panel");
  function setPanel(on) { $("panel").classList.toggle("closed", !on); $("panel-btn").setAttribute("aria-pressed", on); }
  $("panel-btn").addEventListener("click", () => setPanel($("panel").classList.contains("closed")));
  document.querySelectorAll(".tabs button").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((u) => u.setAttribute("aria-selected", u === t));
    for (const p of ["explore", "blocks", "layers", "data"]) $("pane-" + p).hidden = p !== t.dataset.tab;
  }));
  const VIEWS = [["overview", "Whole campus"], ["core", "Campus core"], ["housing", "Housing colony"], ["airport", "Airport"], ["fields", "University farms"]];
  for (const [k, l] of VIEWS) {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = l;
    b.addEventListener("click", () => { if (mode !== "aerial" && mode !== "plan") setMode("aerial"); flyTo(PRESETS[k]); });
    $("views").appendChild(b);
  }
  const campusCounts = D.meta.counts.buildings_in_campus_by_type;
  let highlightType = null;
  for (const [k, l] of D.meta.types) {
    const n = blds.filter((b) => b.t === k).length;
    if (!n) continue;
    const b = document.createElement("button");
    b.innerHTML = `<span class="sw" style="background:#${TYPE_COLOUR[k].toString(16).padStart(6, "0")}"></span><span>${esc(l)}</span><span class="num">${fmt(n)}</span>`;
    b.setAttribute("aria-pressed", "false");
    b.dataset.type = k;
    b.addEventListener("click", () => {
      highlightType = highlightType === k ? null : k;
      document.querySelectorAll("#type-legend button").forEach((x) => x.setAttribute("aria-pressed", x === b && highlightType === k));
      highlight(highlightType);
    });
    $("type-legend").appendChild(b);
  }
  let hlLines = null;
  function highlight(k) {
    if (hlLines) { scene.remove(hlLines); hlLines.geometry.dispose(); hlLines = null; }
    if (!k) { dirty = true; return; }
    const pts = [];
    for (const b of blds) if (b.t === k) {
      const r = b.rings[0];
      for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length]; pts.push(a[0], b.top + 1.5, a[1], c[0], b.top + 1.5, c[1]); }
      pts.push(b.c[0], b.top + 1.5, b.c[1], b.c[0], b.top + 30, b.c[1]);
    }
    hlLines = lineSegments(pts, TYPE_COLOUR[k], 1);
    hlLines.material.depthTest = false; hlLines.renderOrder = 9;
    scene.add(hlLines);
    toast(`${TYPE_LABEL[k]}: ${blds.filter((b) => b.t === k).length} buildings highlighted`);
    dirty = true;
  }
  // Blocks list
  const blockSummary = () => {
    const nb = D.blocks.length;
    const byUse = {};
    for (const b of D.blocks) byUse[b.use] = (byUse[b.use] || 0) + 1;
    $("blocks-summary").textContent = `${nb} blocks: areas enclosed by roads, railways, the runway and mapped waterways inside Nagla and Phoolbag. ` + Object.entries(byUse).sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u} ${n}`).join(" · ");
  };
  blockSummary();
  const blockMetric = {
    buildings: (b) => b.s.buildings, a: (b) => b.a, trees: (b) => b.s.trees,
    roads: (b) => Object.values(b.s.roads_km).reduce((a, v) => a + v, 0), water: (b) => Object.values(b.s.water_km).reduce((a, v) => a + v, 0),
  };
  function renderBlockList() {
    const key = $("block-sort").value, f = blockMetric[key];
    const list = [...D.blocks].sort((a, b) => f(b) - f(a)).slice(0, 300);
    $("block-list").innerHTML = list.map((b) => `<li data-id="${b.id}"><span>${esc(b.n || b.use)} <span class="note">B${b.id}</span></span><span class="num">${key === "a" ? fmt(b.a / 10000, 1) + " ha" : key === "roads" || key === "water" ? f(b).toFixed(1) + " km" : fmt(f(b))}</span><small>${esc(b.use)} · ${b.s.buildings} buildings · ${fmt(b.s.trees)} trees · ${blockMetric.roads(b).toFixed(1)} km road</small></li>`).join("");
  }
  $("block-sort").addEventListener("change", renderBlockList);
  $("block-list").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const b = blockById.get(+li.dataset.id);
    if (mode !== "aerial") setMode("aerial");
    showBlock(b);
    flyTo({ tx: b.c[0], tz: b.c[1], dist: Math.max(260, Math.sqrt(b.a) * 2.4) });
  });
  renderBlockList();
  // Layers
  const toggles = {
    "ly-bld": (on) => (groups.bld.visible = on), "ly-trees": (on) => (groups.trees.visible = on), "ly-roads": (on) => (groups.roads.visible = on),
    "ly-water": (on) => (groups.water.visible = on), "ly-drain": (on) => (groups.drain.visible = on), "ly-blocks": (on) => (groups.blocks.visible = on),
    "ly-blockfill": (on) => (groups.blockfill.visible = on), "ly-lights": (on) => (groups.lights.visible = on), "ly-villages": (on) => (groups.villages.visible = on),
    "ly-labels": (on) => labelLayer.classList.toggle("off", !on),
    "ly-type": (on) => { typeColours = on; rebuildAllBuildings(); },
  };
  for (const id in toggles) $(id).addEventListener("change", (e) => { toggles[id](e.target.checked); dirty = true; });
  document.querySelectorAll("input[name=ground]").forEach((r) => r.addEventListener("change", () => {
    const g = window.__ground;
    g.mat.map = r.value === "lc" && r.checked ? g.lcTex : g.satTex;
    g.mat.needsUpdate = true; dirty = true;
  }));
  $("n-bld").textContent = fmt(blds.length);
  $("n-trees").textContent = fmt(NT);
  $("n-roads").textContent = fmt(D.roads.length);
  $("n-blocks").textContent = fmt(D.blocks.length);
  // Data tab
  {
    const c = D.meta.counts, bc = c.buildings;
    const inCampus = Object.values(campusCounts).reduce((a, v) => a + v, 0);
    const rows = [
      ["Buildings (whole window)", fmt(blds.length)],
      ["... inside Nagla + Phoolbag", fmt(inCampus)],
      ["... from OpenStreetMap", fmt(bc.osm)], ["... Google footprints", fmt(bc.google)], ["... Microsoft footprints", fmt(bc.microsoft)],
      ["... found only in Google 2.5D presence", fmt(bc.detected_from_presence)], ["Heights measured", fmt(bc.height_measured)],
      ["Trees (crowns)", fmt(c.trees)], ["Blocks", fmt(c.blocks)], ["Road graph nodes / links", fmt(c.graph_nodes) + " / " + fmt(c.graph_edges)],
      ["Ponds found in Sentinel-2", fmt(c.water.sentinel2_ponds)],
    ];
    $("facts").innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    const kmRows = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(pretty(k))}</td><td>${v.toFixed(1)}</td></tr>`).join("");
    $("road-facts").innerHTML = kmRows(c.roads_in_campus_km);
    $("water-facts").innerHTML = kmRows(c.water_in_campus_km) || "<tr><td>None mapped</td><td>0</td></tr>";
    $("sources").innerHTML = D.meta.sources.map((s) => `<div><b>${esc(s.layer)}:</b> ${esc(s.name)}${s.licence ? " (" + esc(s.licence) + ")" : ""}</div>`).join("");
  }
  // Search
  const index = [];
  for (const b of blds) if (b.n) index.push({ t: b.n, sub: TYPE_LABEL[b.t], go: () => { setMode("aerial"); showBuilding(b); flyTo({ tx: b.c[0], tz: b.c[1], dist: 260 }); } });
  for (const b of D.blocks) index.push({ t: (b.n || b.use) + " B" + b.id, sub: `Block · ${b.use} · ${b.s.buildings} buildings`, go: () => { setMode("aerial"); showBlock(b); flyTo({ tx: b.c[0], tz: b.c[1], dist: Math.max(260, Math.sqrt(b.a) * 2.4) }); } });
  const seenRoad = new Set();
  D.roads.forEach((r) => { if (r.n && !seenRoad.has(r.n)) { seenRoad.add(r.n); const p = toRing(r.p)[Math.floor(r.p.length / 4)]; index.push({ t: r.n, sub: "Road · " + pretty(r.c), go: () => enterStreet(p[0], p[1]) }); } });
  for (const p of D.pois) index.push({ t: p.n, sub: pretty(p.k), go: () => { setMode("aerial"); flyTo({ tx: p.x, tz: p.z, dist: 300 }); } });
  for (const [k, l] of D.meta.types) index.push({ t: l, sub: "Building type", go: () => {
    highlightType = k;
    highlight(k);
    document.querySelectorAll("#type-legend button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.type === k));
  } });
  const find = $("find"), results = $("results");
  let hits = [], sel = 0;
  function renderResults() {
    results.innerHTML = hits.map((h, i) => `<li role="option" aria-selected="${i === sel}"><b>${esc(h.t)}</b><small>${esc(h.sub)}</small></li>`).join("");
    results.hidden = !hits.length;
    find.setAttribute("aria-expanded", !!hits.length);
  }
  find.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    hits = q.length < 2 ? [] : index.filter((x) => x.t.toLowerCase().includes(q)).sort((a, b) => a.t.toLowerCase().indexOf(q) - b.t.toLowerCase().indexOf(q)).slice(0, 12);
    sel = 0;
    renderResults();
  });
  find.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(hits.length - 1, sel + 1); renderResults(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); renderResults(); e.preventDefault(); }
    if (e.key === "Enter" && hits[sel]) { hits[sel].go(); hits = []; renderResults(); find.blur(); }
    if (e.key === "Escape") { hits = []; renderResults(); find.blur(); }
  });
  results.addEventListener("click", (e) => { const li = e.target.closest("li"); if (!li) return; const i = [...results.children].indexOf(li); hits[i].go(); hits = []; renderResults(); });

  // Controls
  $("mode-aerial").addEventListener("click", () => { if (mode === "street") { streetFrom = "aerial"; exitStreet(); } else setMode("aerial"); });
  $("mode-street").addEventListener("click", () => {
    if (mode === "street") return;
    // Drop in at the road nearest the centre of the view; otherwise ask for a click.
    if ((mode === "aerial" || mode === "plan") && view.dist < 700 && enterStreet(view.tx, view.tz)) return;
    setMode("pick");
  });
  $("sv-exit").addEventListener("click", exitStreet);
  const svBtn = (a, b, on) => { $(a).setAttribute("aria-pressed", on); $(b).setAttribute("aria-pressed", !on); };
  $("sv-follow").addEventListener("click", () => {
    if (!SV.free) return;
    const ne = nearestEdge(SV.x, SV.z, 200);
    if (!ne) { toast("No road within 200 m - walk closer to a road"); return; }
    SV.free = false; SV.e = ne.k; SV.s = ne.t * edgeLen[ne.k]; SV.atNode = -1;
    svBtn("sv-follow", "sv-free", true); updateArrows(); dirty = true;
  });
  $("sv-free").addEventListener("click", () => { SV.free = true; SV.atNode = -1; svBtn("sv-follow", "sv-free", false); updateArrows(); dirty = true; });
  $("sv-walk").addEventListener("click", () => { SV.drive = false; svBtn("sv-walk", "sv-drive", true); dirty = true; });
  $("sv-drive").addEventListener("click", () => { SV.drive = true; svBtn("sv-walk", "sv-drive", false); dirty = true; });
  $("zoom-in").addEventListener("click", () => flyTo({ dist: Math.max(25, goal.dist / 1.6) }));
  $("zoom-out").addEventListener("click", () => flyTo({ dist: Math.min(16000, goal.dist * 1.6) }));
  $("compass").addEventListener("click", () => flyTo({ theta: 0 }));
  $("tilt").addEventListener("click", () => flyTo({ phi: goal.phi > 0.3 ? 0.08 : 0.95 }));
  $("fullscreen").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  $("help-btn").addEventListener("click", () => ($("help").hidden = false));
  $("help-close").addEventListener("click", () => ($("help").hidden = true));
  $("shot").addEventListener("click", () => {
    renderFrame(1.5);
    canvas.toBlob((blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gbpuat-campus-3d.png"; a.click(); });
  });

  // ---------------------------------------------------------------------------------------
  // LOD management, labels, minimap, render loop
  const LOD0_RANGE = 650, TREE_NEAR = 220, TREE_MID = 1000, LIGHT_RANGE = 700, KERB_RANGE = 450;
  function updateLods() {
    const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
    const alt = cy - H(cx, cz);
    let built = 0;
    for (const ch of chunks.values()) {
      const d = Math.hypot(ch.cx - cx, ch.cz - cz, alt * 0.6);
      const want0 = d < LOD0_RANGE;
      if (want0 && !ch.lod0 && built < 2) { ch.lod0 = buildChunk(ch, 1); groups.bld.add(ch.lod0); built++; dirty = true; }
      if (ch.lod0) ch.lod0.visible = want0;
      ch.lod1.visible = !(want0 && ch.lod0);
      if (ch.lod0 && d > LOD0_RANGE * 2.2) { groups.bld.remove(ch.lod0); ch.lod0.traverse((o) => o.geometry && o.geometry !== TANK_GEO && o.geometry.dispose()); ch.lod0 = null; }
    }
    let tb = 0;
    for (const tc of treeChunks.values()) {
      const d = Math.hypot(tc.cx - cx, tc.cz - cz, alt * 0.8);
      const wantNear = d < TREE_NEAR + 280, wantMid = d < TREE_MID;
      if (wantNear && !tc.near && tb < 2) { tc.near = buildTreeChunk(tc, true); groups.trees.add(tc.near); tb++; dirty = true; }
      if (wantMid && !tc.mid && tb < 3) { tc.mid = buildTreeChunk(tc, false); groups.trees.add(tc.mid); tb++; dirty = true; }
      if (tc.near) tc.near.visible = wantNear;
      if (tc.mid) tc.mid.visible = wantMid && !(wantNear && tc.near);
    }
    groups.trees.getObjectByName("treePoints").visible = alt > 300;
    for (const k of kerbChunks.values()) k.mesh.visible = Math.hypot(k.cx - cx, k.cz - cz, alt * 2) < KERB_RANGE + 360;
    for (const lc of lightChunks.values()) {
      const d = Math.hypot(lc.cx - cx, lc.cz - cz, alt);
      if (d < LIGHT_RANGE && !lc.mesh) { lc.mesh = buildLights(lc); groups.lights.add(lc.mesh); dirty = true; }
      if (lc.mesh) lc.mesh.visible = d < LIGHT_RANGE;
    }
    return built + tb > 0;
  }

  const v3 = new THREE.Vector3();
  function updateLabels() {
    if (labelLayer.classList.contains("off")) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const occupied = [];
    const camPos = camera.position;
    const vis = [];
    for (const l of labels) {
      if (l.bld && l.bld.hidden) { if (l.shown) { l.el.style.display = "none"; l.shown = false; } continue; }
      const d = Math.hypot(l.x - camPos.x, l.z - camPos.z, (l.y - camPos.y) * 0.5);
      if (mode === "street" && l.kind === "block") { if (l.shown) { l.el.style.display = "none"; l.shown = false; } continue; }
      const range = mode === "street" ? Math.min(l.range, 400) : l.range;
      if (d > range) { if (l.shown) { l.el.style.display = "none"; l.shown = false; } continue; }
      v3.set(l.x, l.y + 3, l.z).project(camera);
      if (v3.z > 1 || v3.x < -1.1 || v3.x > 1.1 || v3.y < -1.1 || v3.y > 1.1) { if (l.shown) { l.el.style.display = "none"; l.shown = false; } continue; }
      vis.push({ l, sx: ((v3.x + 1) / 2) * w, sy: ((1 - v3.y) / 2) * h, d });
    }
    if (mode === "street") {
      const cx = camPos.x, cz = camPos.z, cy = camPos.y;
      for (let i = vis.length - 1; i >= 0; i--) {
        const l = vis[i].l, dx = l.x - cx, dz = l.z - cz, D2 = Math.hypot(dx, dz);
        const ty = l.y + 3, n = Math.floor((D2 - 6) / 3);
        for (let k = 1; k <= n; k++) {
          const t = (k * 3) / D2, b = buildingAt(cx + dx * t, cz + dz * t);
          if (b && b !== l.bld && b.top > cy + (ty - cy) * t) {
            if (l.shown) { l.el.style.display = "none"; l.shown = false; }
            vis.splice(i, 1);
            break;
          }
        }
      }
    }
    vis.sort((a, b) => a.l.prio - b.l.prio || a.d - b.d);
    for (const { l, sx, sy } of vis) {
      if (!l.w) { l.el.style.display = "block"; l.w = l.el.offsetWidth || 80; l.el.style.display = l.shown ? "block" : "none"; }
      const box = [sx - l.w / 2, sy - 30, sx + l.w / 2, sy - 8];
      if (occupied.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) { if (l.shown) { l.el.style.display = "none"; l.shown = false; } continue; }
      occupied.push(box);
      l.el.style.display = "block";
      l.el.style.transform = `translate(${sx - l.w / 2}px, ${sy - 30}px)`;
      l.shown = true;
    }
  }

  const mm = $("minimap").firstElementChild, mctx = mm.getContext("2d");
  function drawMinimap() {
    const W = mm.width, R = 260, s = W / (2 * R);
    mctx.fillStyle = "#e9eee4"; mctx.fillRect(0, 0, W, W);
    const tx = (x) => (x - SV.x) * s + W / 2, tz = (z) => (z - SV.z) * s + W / 2;
    mctx.fillStyle = "#cfc6b8";
    for (let i = Math.floor((SV.x - R) / BGC); i <= Math.floor((SV.x + R) / BGC); i++) for (let j = Math.floor((SV.z - R) / BGC); j <= Math.floor((SV.z + R) / BGC); j++) {
      for (const b of bGrid.get(i + "," + j) || []) {
        const r = b.rings[0];
        mctx.beginPath(); r.forEach((p, k) => (k ? mctx.lineTo(tx(p[0]), tz(p[1])) : mctx.moveTo(tx(p[0]), tz(p[1])))); mctx.closePath(); mctx.fill();
      }
    }
    mctx.strokeStyle = "#7d7d7d"; mctx.lineCap = "round";
    const seen = new Set();
    for (let i = Math.floor((SV.x - R) / EG); i <= Math.floor((SV.x + R) / EG); i++) for (let j = Math.floor((SV.z - R) / EG); j <= Math.floor((SV.z + R) / EG); j++) {
      for (const k of edgeGrid.get(i + "," + j) || []) {
        if (seen.has(k)) continue; seen.add(k);
        const e = GE[k], r = D.roads[e[2]];
        mctx.lineWidth = Math.max(2, r.w * s);
        mctx.strokeStyle = k === SV.e ? "#c98a12" : ROAD_GROUP(r.c, r.s) === "major" ? "#6b6b6b" : "#9a9a9a";
        mctx.beginPath(); mctx.moveTo(tx(nx_(e[0])), tz(nz_(e[0]))); mctx.lineTo(tx(nx_(e[1])), tz(nz_(e[1]))); mctx.stroke();
      }
    }
    // view cone + position
    const fovH = 2 * Math.atan(Math.tan((SV.fov * Math.PI) / 360) * camera.aspect);
    mctx.fillStyle = "rgba(201,138,18,0.25)";
    mctx.beginPath(); mctx.moveTo(W / 2, W / 2);
    for (const a of [SV.yaw - fovH / 2, SV.yaw + fovH / 2]) { const [dx, dz] = yawDir(a); mctx.lineTo(W / 2 + dx * 90, W / 2 + dz * 90); }
    mctx.closePath(); mctx.fill();
    mctx.fillStyle = "#c0392b"; mctx.beginPath(); mctx.arc(W / 2, W / 2, 7, 0, 7); mctx.fill();
    mctx.strokeStyle = "#fff"; mctx.lineWidth = 2.5; mctx.stroke();
    mctx.fillStyle = "#333"; mctx.font = "bold 20px sans-serif"; mctx.fillText("N", W - 24, 26);
    const where = SV.free ? null : D.roads[GE[SV.e][2]];
    const blk = blockAt(SV.x, SV.z);
    $("sv-where").textContent = (where ? (where.n || pretty(where.c)) : "Free walk") + (blk ? " · " + blk.use : "");
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(scale);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  let scale = Math.min(window.devicePixelRatio || 1, 1.25);
  const BASE_SCALE = scale;
  window.addEventListener("resize", () => { dirty = true; });
  function renderFrame(s) {
    if (s && s !== scale) { scale = s; renderer.setPixelRatio(scale); }
    resize();
    renderer.render(scene, camera);
  }
  let last = performance.now(), msAvg = 16, frames = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let moving = false;
    if (mode === "street") {
      moving = SV.free ? stepFree(dt) : stepFollow(dt);
      applyStreet();
      if (moving) updateArrows();
    } else {
      const k = 1 - Math.exp(-dt * 6);
      let d = 0;
      for (const p of ["tx", "tz", "dist", "theta", "phi"]) {
        const diff = goal[p] - view[p];
        view[p] += diff * k;
        d += Math.abs(diff) / (p === "dist" ? Math.max(50, view.dist) : p === "tx" || p === "tz" ? Math.max(20, view.dist * 0.01) : 0.01);
      }
      moving = d > 0.01;
      applyAerial();
      $("compass-needle").style.transform = `rotate(${view.theta}rad)`;
    }
    const lodChanged = updateLods();
    if (moving || dirty || lodChanged) {
      const t0 = performance.now();
      renderFrame(moving ? Math.max(0.6, Math.min(BASE_SCALE, scale * (msAvg > 30 ? 0.92 : msAvg < 18 ? 1.04 : 1))) : BASE_SCALE);
      msAvg = msAvg * 0.9 + (performance.now() - t0) * 0.1;
      updateLabels();
      if (mode === "street") drawMinimap();
      if (++frames % 20 === 0) {
        const info = renderer.info.render;
        $("st-tri").textContent = fmt(info.triangles);
        $("st-calls").textContent = fmt(info.calls);
        $("st-ms").textContent = msAvg.toFixed(1) + " ms";
      }
      // scale bar
      if (mode === "aerial" || mode === "plan") {
        const mPerPx = (2 * view.dist * Math.tan((camera.fov * Math.PI) / 360)) / canvas.clientHeight;
        const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((v) => v / mPerPx > 60) || 5000;
        $("scale-bar").style.width = nice / mPerPx + "px";
        $("scale-text").textContent = nice >= 1000 ? nice / 1000 + " km" : nice + " m";
      }
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  // URL hash: #street=x,z,yaw drops straight into street view
  await step(98, "Ready");
  applyAerial();
  updateLods();
  requestAnimationFrame(frame);
  $("loading").classList.add("done");
  const m = location.hash.match(/street=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/);
  if (m) { SV.yaw = +(m[3] || 0); enterStreet(+m[1], +m[2]); }
  // #view=x,z,distance,heading,tilt opens the aerial view there (shareable links).
  const mv = location.hash.match(/view=(-?[\d.]+),(-?[\d.]+),([\d.]+)(?:,(-?[\d.]+))?(?:,([\d.]+))?/);
  if (mv && !m) {
    Object.assign(view, { tx: +mv[1], tz: +mv[2], dist: +mv[3], theta: +(mv[4] || 0.5), phi: +(mv[5] || 0.95) });
    Object.assign(goal, view);
    applyAerial();
    dirty = true;
  }

  // ---------------------------------------------------------------------------------------
  // Plan mode support: geometry makers, hiding what a plan removes, the plan's road graph,
  // night and x-ray display. Used by js/plan.js.
  function rebuildChunksOf(list) {
    const keys = new Set(list.map((b) => Math.floor(b.c[0] / CHUNK) + "," + Math.floor(b.c[1] / CHUNK)));
    for (const k of keys) {
      const ch = chunks.get(k);
      if (!ch) continue;
      for (const g of [ch.lod0, ch.lod1]) if (g) { groups.bld.remove(g); g.traverse((o) => o.geometry && o.geometry !== TANK_GEO && o.geometry.dispose()); }
      ch.lod0 = null;
      ch.lod1 = buildChunk(ch, 0);
      groups.bld.add(ch.lod1);
    }
    dirty = true;
  }
  function setHiddenBuildings(set) {
    const changed = [];
    for (const b of blds) { const h = set.has(b.i); if (!!b.hidden !== h) { b.hidden = h; changed.push(b); } }
    if (changed.length) rebuildChunksOf(changed);
  }
  function setHiddenTrees(set) {
    const changed = [];
    for (const i of treeHidden) if (!set.has(i)) changed.push(i);
    for (const i of set) if (!treeHidden.has(i)) changed.push(i);
    if (!changed.length) return;
    treeHidden.clear();
    for (const i of set) treeHidden.add(i);
    const pa = groups.trees.getObjectByName("treePoints").geometry.attributes.position;
    const keys = new Set();
    for (const i of changed) {
      const x = TR[i * 3], z = TR[i * 3 + 1];
      pa.setY(i, treeHidden.has(i) ? -1e5 : H(x, z) + TR[i * 3 + 2] * 0.7);
      keys.add(Math.floor(x / TREE_CHUNK) + "," + Math.floor(z / TREE_CHUNK));
    }
    pa.needsUpdate = true;
    for (const k of keys) {
      const tc = treeChunks.get(k);
      if (tc) for (const p of ["mid", "near"]) if (tc[p]) { groups.trees.remove(tc[p]); tc[p].dispose(); tc[p] = null; }
    }
    dirty = true;
  }
  function makeBuilding(ring, floors, opt = {}) {
    const r = ring.map((p) => [p[0], p[1]]);
    if (r.length < 3) return null;
    if (ringArea(r) < 0) r.reverse();
    let g = Infinity;
    for (const p of r) g = Math.min(g, H(p[0], p[1]));
    const fh = opt.floorH || 3.3, top = g + Math.max(1, floors) * fh;
    const wb = new Batch(true), rb = new Batch(true), ex = new Batch(false);
    const wc = opt.wall || [0.94, 0.92, 0.87], rc = opt.roof || [0.82, 0.8, 0.76];
    walls(wb, r, g - 0.4, top, fh, wc, true);
    roofPolygon(rb, [r], top, rc);
    if (Math.abs(ringArea(r)) > 20) {
      const inn = inset(r, 0.22);
      walls(ex, r, top, top + 0.9, 3, wc, true);
      walls(ex, inn, top, top + 0.9, 3, wc, false);
    }
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(wb.geometry(true), MAT.facade), new THREE.Mesh(rb.geometry(true), MAT.roof));
    if (ex.tris) grp.add(new THREE.Mesh(ex.geometry(true), MAT.extra));
    grp.userData.top = top;
    return grp;
  }
  function makeRoad(pts, width, g) {
    const b = new Batch(true);
    for (const piece of clipLine(pts)) ribbon(b, piece, width, ROAD_LIFT[g] + 0.03, white, g === "path" ? 2 : 7);
    return b.tris ? new THREE.Mesh(b.geometry(), roadMat(g)) : null;
  }
  function makeTree(x, z, h = 6) {
    const m = new THREE.Mesh(treeNearGeo, treeNearMat), r = Math.min(6, 0.32 * h + 1);
    m.position.set(x, H(x, z), z);
    m.scale.set(r * 2.6, h, r * 2.6);
    return m;
  }
  function makeLamp(x, z, yaw, height = 8) {
    const m = new THREE.Mesh(lampGeo, lampMat);
    m.position.set(x, H(x, z), z);
    m.rotation.y = yaw;
    m.scale.set(1, height / 7, 1);
    return m;
  }
  // The plan's road graph: new nodes and links appended, split links switched off.
  const G0 = { n: GN.length, e: GE.length, r: D.roads.length, ok: edgeOk.slice() };
  function applyPlanGraph(g, roads) {
    GN.length = G0.n; GE.length = G0.e; edgeLen.length = G0.e; edgeOk.length = G0.e; D.roads.length = G0.r;
    for (let k = 0; k < G0.e; k++) edgeOk[k] = G0.ok[k];
    if (g) {
      const roadIdx = new Map();
      for (const [item, r] of roads) { roadIdx.set(item, D.roads.length); D.roads.push(r); }
      for (const v of g.nodes) GN.push(v);
      for (const k of g.off) edgeOk[k] = false;
      for (const [a, b, r] of g.edges) {
        const ri = r >= 0 ? r : roadIdx.get(-r - 1);
        if (ri == null) continue;
        GE.push([a, b, ri]);
        edgeLen.push(Math.hypot(nx_(b) - nx_(a), nz_(b) - nz_(a)));
        edgeOk.push(inCB(nx_(a), nz_(a)) && inCB(nx_(b), nz_(b)));
      }
    }
    adj.length = 0;
    for (let i = 0; i < GN.length / 2; i++) adj.push([]);
    edgeGrid.clear();
    GE.forEach((e, k) => {
      if (!edgeOk[k]) return;
      adj[e[0]].push(k); adj[e[1]].push(k);
      const x0 = Math.min(nx_(e[0]), nx_(e[1])), x1 = Math.max(nx_(e[0]), nx_(e[1])), z0 = Math.min(nz_(e[0]), nz_(e[1])), z1 = Math.max(nz_(e[0]), nz_(e[1]));
      for (let i = Math.floor(x0 / EG); i <= Math.floor(x1 / EG); i++) for (let j = Math.floor(z0 / EG); j <= Math.floor(z1 / EG); j++) {
        const key = i + "," + j;
        if (!edgeGrid.has(key)) edgeGrid.set(key, []);
        edgeGrid.get(key).push(k);
      }
    });
  }
  function setNight(on) {
    renderer.toneMappingExposure = on ? 0.2 : 1;
    document.body.classList.toggle("night", on);
    dirty = true;
  }
  function setXray(on) {
    for (const k of ["facade", "house", "shed", "roof", "extra"]) {
      const m = MAT[k];
      m.transparent = on; m.opacity = on ? 0.22 : 1; m.depthWrite = !on; m.needsUpdate = true;
    }
    dirty = true;
  }
  function setPlanLabels(list) {
    for (let i = labels.length - 1; i >= 0; i--) if (labels[i].kind === "plan") { labels[i].el.remove(); labels.splice(i, 1); }
    for (const l of list) addLabel(l.text, "plan", l.x, l.z, l.y, l.range || 2500, 0);
    dirty = true;
  }
  function raycast(cx, cy, objects, recursive = false) {
    setRay(cx, cy);
    return ray.intersectObjects(objects, recursive);
  }
  function snapshot(s = 1.5) {
    renderFrame(s);
    const url = canvas.toDataURL("image/jpeg", 0.88);
    renderFrame(BASE_SCALE);
    return url;
  }

  window.__campus = {
    scene, camera, renderer, view, goal, SV, groups, H, flyTo, enterStreet, exitStreet, blds, chunks,
    // Test hook: advance street-view movement by n steps of dt seconds (works while rAF is paused).
    step(n, dt = 1 / 30) { for (let i = 0; i < n; i++) { if (mode === "street") (SV.free ? stepFree(dt) : stepFollow(dt)); } if (mode === "street") { applyStreet(); updateArrows(); } },
    updateArrows,
    plan: {
      setHooks(h) { PLAN = h; }, mode: () => mode, setMode, groundHit, pickBuilding, raycast, buildingAt, blockAt, nearestEdge, H,
      makeBuilding, makeRoad, makeTree, makeLamp, setHiddenBuildings, setHiddenTrees, applyPlanGraph, setNight, setXray, setPlanLabels,
      toast, setPanel, flyTo, markDirty: () => { dirty = true; }, TYPE_LABEL, TYPE_COLOUR, unproj, inCB, CB, canvas, view, goal, enterStreet, snapshot,
    },
    settle() { Object.assign(view, goal); mode === "street" ? applyStreet() : applyAerial(); for (let i = 0; i < 40; i++) updateLods(); renderFrame(BASE_SCALE); updateLabels(); if (mode === "street") drawMinimap(); },
  };
  window.dispatchEvent(new Event("campus:ready"));
})();
