/* Campus 3D: the "Balanced" graphics tier.
   For integrated GPUs. It keeps the light, unlit pipeline of the Light tier, which costs almost nothing
   per pixel, and adds what can be prepared once on the CPU instead of lit in real time:
   - sharper painted facades, roofs and roads (relief is baked into the colours),
   - ground shadows of buildings and trees, rasterised into a small map around the camera,
   - a painted sky dome with clouds and a sun glow,
   - leafy trees made of a few leaf cards, shaded once,
   - FXAA edge smoothing and a gentle grade in the final pass (see gfx.js). */
(function () {
  "use strict";
  const G = (window.__gfx = window.__gfx || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const pause = () => new Promise((r) => setTimeout(r, 0));

  // The fixed sun the Light tier bakes into walls: from the west-south-west, high.
  const SUN = new THREE.Vector3(-0.55, 1, 0.35).normalize();
  const SH = { x: -SUN.x, z: -SUN.z }; // shadows fall away from the sun
  const SHL = Math.hypot(SH.x, SH.z) / SUN.y; // shadow length per metre of height
  const SHD = { x: SH.x / Math.hypot(SH.x, SH.z), z: SH.z / Math.hypot(SH.x, SH.z) };
  const SHADOW_STRENGTH = 0.46;

  // ---------------------------------------------------------------------------------------
  // Sky dome: an equirectangular picture painted once
  async function skyTexture() {
    const W = 1024, H = 512, c = canvas(W, H), g = c.getContext("2d"), img = g.createImageData(W, H), rnd = mulberry32(77);
    // value-noise lattice for clouds, wrapped in azimuth
    const NP = 96, lat = new Float32Array(NP * NP);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const vn = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = lat[((yi % NP + NP) % NP) * NP + ((xi % NP + NP) % NP)], b = lat[((yi % NP + NP) % NP) * NP + (((xi + 1) % NP + NP) % NP)];
      const cc = lat[(((yi + 1) % NP + NP) % NP) * NP + ((xi % NP + NP) % NP)], d = lat[(((yi + 1) % NP + NP) % NP) * NP + (((xi + 1) % NP + NP) % NP)];
      return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
    };
    const fbm = (x, y) => { let a = 0.5, s = 0; for (let i = 0; i < 4; i++) { s += a * vn(x, y); x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; a *= 0.5; } return s; };
    const sunAz = Math.atan2(SUN.z, SUN.x), sunEl = Math.asin(SUN.y);
    const zen = [0.2, 0.4, 0.78], hor = [0.8, 0.88, 0.96], below = [0.72, 0.78, 0.8];
    for (let y = 0; y < H; y++) {
      const el = (0.5 - (y + 0.5) / H) * Math.PI;          // elevation, +90 at the top row
      const sy = Math.sin(el), cy = Math.cos(el);
      for (let x = 0; x < W; x++) {
        const az = ((x + 0.5) / W) * Math.PI * 2;
        const dx = cy * Math.cos(az), dz = cy * Math.sin(az);
        let r, gg, b;
        if (el >= 0) {
          const t = Math.pow(1 - sy, 2.6);
          r = zen[0] + (hor[0] - zen[0]) * t; gg = zen[1] + (hor[1] - zen[1]) * t; b = zen[2] + (hor[2] - zen[2]) * t;
          // clouds: projected onto a plane, thinner and flatter near the horizon
          if (sy > 0.02) {
            const k = 1 / (sy + 0.12), u = dx * k * 7, v = dz * k * 7;
            let c = fbm(u * 0.5 + 40, v * 0.5 + 12);
            c = clamp((c - 0.46) / 0.26, 0, 1) * clamp(sy / 0.22, 0, 1);
            const shade = 0.86 + 0.14 * clamp((fbm(u * 0.5 + 41.1, v * 0.5 + 12.8) - c * 0.2) * 1.6, 0, 1);
            r += (shade - r) * c * 0.92; gg += (shade - gg) * c * 0.92; b += (shade * 0.98 - b) * c * 0.92;
          }
          // sun glow
          const sd = Math.max(0, dx * SUN.x / Math.hypot(SUN.x, SUN.z) * Math.cos(sunEl) + dz * SUN.z / Math.hypot(SUN.x, SUN.z) * Math.cos(sunEl) + sy * Math.sin(sunEl));
          const glow = Math.pow(sd, 22) * 0.55 + Math.pow(sd, 220) * 1.2;
          r += glow; gg += glow * 0.92; b += glow * 0.75;
        } else {
          const t = clamp(-sy * 4, 0, 1);
          r = hor[0] + (below[0] - hor[0]) * t; gg = hor[1] + (below[1] - hor[1]) * t; b = hor[2] + (below[2] - hor[2]) * t;
        }
        const i = (y * W + x) * 4;
        img.data[i] = clamp(r, 0, 1) * 255; img.data[i + 1] = clamp(gg, 0, 1) * 255; img.data[i + 2] = clamp(b, 0, 1) * 255; img.data[i + 3] = 255;
      }
      if (y % 64 === 63) await pause();
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    return t;
  }

  // ---------------------------------------------------------------------------------------
  // Ground shadows: buildings and trees rasterised into a map around the camera
  const SHADE = {
    u: { tShade: { value: null }, uShadeBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uShadeOn: { value: 0 } },
    canvas: null, ctx: null, tex: null, px: 768, cx: 1e9, cz: 1e9, size: 0, dirty: true,
  };
  function rasterShadows(A, cx, cz, size) {
    const t0 = performance.now();
    const px = SHADE.px, scale = px / size, x0 = cx - size / 2, z0 = cz - size / 2;
    if (!SHADE.canvas) { SHADE.canvas = canvas(px, px); SHADE.ctx = SHADE.canvas.getContext("2d", { willReadFrequently: true }); SHADE.data = new Uint8Array(px * px); SHADE.tex = new THREE.DataTexture(SHADE.data, px, px, THREE.RedFormat); SHADE.tex.magFilter = THREE.LinearFilter; SHADE.tex.minFilter = THREE.LinearFilter; SHADE.tex.wrapS = SHADE.tex.wrapT = THREE.ClampToEdgeWrapping; SHADE.tex.generateMipmaps = false; SHADE.u.tShade.value = SHADE.tex; }
    const g = SHADE.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.fillStyle = "#000";
    const X = (x) => (x - x0) * scale, Z = (z) => (z - z0) * scale;
    const margin = 70;
    // buildings: footprint plus each wall swept along the shadow direction (all pieces wound the same way so the union fills)
    for (const b of A.blds) {
      if (b.hidden) continue;
      const bx = b.c[0], bz = b.c[1];
      if (bx < x0 - margin || bx > x0 + size + margin || bz < z0 - margin || bz > z0 + size + margin) continue;
      const ring = b.rings[0], L = Math.min(60, b.h * SHL * 1.15), dx = SHD.x * L, dz = SHD.z * L;
      g.beginPath();
      let area = 0;
      for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
      const sgn = area >= 0 ? 1 : -1;
      g.moveTo(X(ring[0][0]), Z(ring[0][1]));
      for (let i = 1; i < ring.length; i++) g.lineTo(X(ring[i][0]), Z(ring[i][1]));
      g.closePath();
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], ex = q[0] - p[0], ez = q[1] - p[1];
        const cr = (ex * dz - ez * dx) * sgn;
        if (Math.abs(cr) < 1e-3) continue;
        // orient each swept quad like the footprint so overlaps add instead of cancel
        const s2 = cr >= 0 ? 1 : -1;
        if (s2 > 0) { g.moveTo(X(p[0]), Z(p[1])); g.lineTo(X(q[0]), Z(q[1])); g.lineTo(X(q[0] + dx), Z(q[1] + dz)); g.lineTo(X(p[0] + dx), Z(p[1] + dz)); }
        else { g.moveTo(X(p[0]), Z(p[1])); g.lineTo(X(p[0] + dx), Z(p[1] + dz)); g.lineTo(X(q[0] + dx), Z(q[1] + dz)); g.lineTo(X(q[0]), Z(q[1])); }
        g.closePath();
      }
      g.fill();
    }
    // trees: a soft oval where the crown projects
    const T = A.D.trees;
    g.globalAlpha = 0.8;
    g.beginPath();
    for (let i = 0; i < T.length; i += 3) {
      const x = T[i], z = T[i + 1];
      if (x < x0 - margin || x > x0 + size + margin || z < z0 - margin || z > z0 + size + margin) continue;
      const h = Math.max(3, T[i + 2]), r = (h >= 15 ? Math.min(4.5, 0.15 * h + 1) : Math.min(6, 0.32 * h + 1)) * 0.95, off = h * 0.55 * SHL;
      const cxp = X(x + SHD.x * off), czp = Z(z + SHD.z * off), rr = r * scale;
      g.moveTo(cxp + rr, czp); g.arc(cxp, czp, rr, 0, 6.2832);
    }
    g.fill();
    g.globalAlpha = 1;
    const a = g.getImageData(0, 0, px, px).data, out = SHADE.data;
    for (let i = 0, n = px * px; i < n; i++) out[i] = 255 - a[i * 4 + 3] * SHADOW_STRENGTH;
    SHADE.tex.needsUpdate = true;
    SHADE.u.uShadeBox.value.set(x0, z0, size, size);
    SHADE.cx = cx; SHADE.cz = cz; SHADE.size = size; SHADE.dirty = false;
    G.shadeMs = Math.round(performance.now() - t0); G.shadeRuns = (G.shadeRuns || 0) + 1;
  }
  // The map covers 700 m around you on the street and 2.4 km around the view target from the air.
  function shadowWindow(A, mode, camera) {
    const street = mode === "street" || mode === "pick";
    const size = street ? 720 : 2400;
    let cx, cz;
    if (street) { cx = camera.position.x; cz = camera.position.z; } else { cx = A.view.tx; cz = A.view.tz; }
    const lim = size * (street ? 0.33 : 0.25);
    if (SHADE.dirty || size !== SHADE.size || Math.abs(cx - SHADE.cx) > lim || Math.abs(cz - SHADE.cz) > lim) {
      rasterShadows(A, Math.round(cx / 40) * 40, Math.round(cz / 40) * 40, size);
      return true;
    }
    return false;
  }
  // Multiply a basic material's colour by the shadow map (world position in a varying).
  function shadePatch(mat, extra) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (extra && prev) prev(sh, r);
      Object.assign(sh.uniforms, SHADE.u);
      if (!sh.vertexShader.includes("varying vec3 vWPos;")) {
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;");
      }
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D tShade; uniform vec4 uShadeBox;")
        .replace("#include <map_fragment>", `#include <map_fragment>
        { vec2 su = (vWPos.xz - uShadeBox.xy) / uShadeBox.zw;
          if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) diffuseColor.rgb *= texture2D(tShade, su).r; }`);
    };
    mat.customProgramCacheKey = () => "shade" + (extra ? "+" : "");
    mat.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------
  // Trees: a trunk, a few limbs and leaf cards, lit once
  const lightFor = (nx, ny, nz) => 0.4 + 0.1 * ny + 0.36 * Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
  function treeGeometry(cards, seed) {
    const rnd = mulberry32(seed), pos = [], uv = [], col = [];
    const cc = new THREE.Vector3(0, 0.68, 0), R = new THREE.Vector3(0.4, 0.3, 0.4);
    const bark = (f) => [0.34 * f, 0.24 * f, 0.16 * f];
    const limb = (x0, y0, z0, x1, y1, z1, r0, r1) => {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const geo = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true).toNonIndexed();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1)));
      const p = geo.attributes.position, n = geo.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(0.04, 0.04);
        const f = lightFor(n.getX(i), n.getY(i), n.getZ(i)) * 1.15, c = bark(f);
        col.push(c[0], c[1], c[2]);
      }
    };
    limb(0, 0, 0, 0.01, 0.55, 0.005, 0.026, 0.013);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + rnd(), r = 0.15 + rnd() * 0.08; limb(0.01, 0.42 + rnd() * 0.1, 0.005, Math.cos(a) * r, 0.7 + rnd() * 0.12, Math.sin(a) * r, 0.012, 0.005); }
    const u = new THREE.Vector3(), v = new THREE.Vector3(), nrm = new THREE.Vector3(), c = new THREE.Vector3(), tmp = new THREE.Vector3(), sn = new THREE.Vector3();
    for (let i = 0; i < cards; i++) {
      do { c.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (c.lengthSq() > 1 || c.lengthSq() < 0.1);
      const dist = Math.sqrt(c.lengthSq()); c.multiply(R).add(cc);
      nrm.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      u.set(0, 1, 0).cross(nrm); if (u.lengthSq() < 1e-4) u.set(1, 0, 0); u.normalize();
      v.copy(nrm).cross(u).normalize();
      const s = 0.25 + rnd() * 0.09, flip = rnd() < 0.5 ? -1 : 1;
      sn.copy(c).sub(cc).divide(R).normalize(); sn.y += 0.35; sn.normalize();
      const ao = 0.5 + 0.5 * clamp(dist * 1.1, 0, 1) * (0.8 + 0.2 * clamp((c.y - 0.45) / 0.5, 0, 1));
      const f = lightFor(sn.x, sn.y, sn.z) * ao * 1.25;
      const cr = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        tmp.copy(c).addScaledVector(u, cr[k][0] * s * flip).addScaledVector(v, cr[k][1] * s);
        pos.push(tmp.x, tmp.y, tmp.z); uv.push(0.1 + 0.9 * cr[k][2], 0.1 + 0.9 * cr[k][3]); col.push(f, f, f);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  // ---------------------------------------------------------------------------------------
  const B = { on: false, saved: null, tex: null, sky: null, skyTex: null, treeMat: null, treeGeo: null, cards: 0, A: null };
  G.baked = {
    get sky() { return B.sky; },
    horizon: new THREE.Color().setRGB(0.8, 0.88, 0.96, THREE.SRGBColorSpace),
    // textures must already be painted (G.makeTextures with albedoOnly)
    async prepare(C, Q) {
      if (!B.skyTex) B.skyTex = await skyTexture();
      if (!B.sky) {
        B.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.MeshBasicMaterial({ map: B.skyTex, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }));
        B.sky.renderOrder = -1000; B.sky.frustumCulled = false; B.sky.scale.setScalar(600);
      }
    },
    enable(C, Q, TX) {
      const A = C.gfx;
      B.A = A; B.on = true;
      if (!B.saved) {
        const g = A.ground();
        B.saved = {
          maps: ["facade", "house", "shed", "roof"].map((k) => [A.MAT[k], A.MAT[k].map]),
          roads: Object.keys(A.ROAD_MAT).map((k) => [A.ROAD_MAT[k], A.ROAD_MAT[k].map, A.ROAD_MAT[k].onBeforeCompile, A.ROAD_MAT[k].customProgramCacheKey]),
          ground: [g.mat, g.mat.onBeforeCompile, g.mat.customProgramCacheKey],
        };
      }
      // painted textures with the relief baked in
      for (const [m, k] of [[A.MAT.facade, "facade"], [A.MAT.house, "house"], [A.MAT.shed, "shed"], [A.MAT.roof, "roof"]]) { if (TX[k]) { m.map = TX[k].map; m.needsUpdate = true; } }
      for (const k of Object.keys(A.ROAD_MAT)) { const m = A.ROAD_MAT[k]; if (TX[k]) m.map = TX[k].map; if (!B.patched) shadePatch(m, false); }
      if (!B.patched) shadePatch(A.ground().mat, true);
      B.patched = true;
      SHADE.u.uShadeOn.value = 1; SHADE.dirty = true;
      // trees
      if (B.cards !== Q.cards) { if (B.treeGeo) B.treeGeo.dispose(); B.treeGeo = treeGeometry(Q.cards, 7); B.cards = Q.cards; }
      if (!B.treeMat) {
        const leaf = G.leafTexture ? G.leafTexture(256) : null;
        if (leaf) leaf.anisotropy = 4;
        B.treeMat = new THREE.MeshBasicMaterial({ map: leaf, alphaTest: 0.5, vertexColors: true, side: THREE.DoubleSide });
        A.treeLodPatch(B.treeMat, true);
      }
      const tint = (c, t) => { const s = Math.sin(t.x * 0.37 + t.z * 0.91), s2 = Math.sin(t.x * 1.7 - t.z * 0.43); c.setRGB(t.tint * (0.9 + 0.12 * s), t.tint * (0.95 + 0.08 * s2), t.tint * (0.88 - 0.12 * s)); };
      A.setTreeKit({ near: { geo: B.treeGeo, mat: B.treeMat, tint, shadow: false } });
      C.scene.add(B.sky);
      B.sky.visible = true;
    },
    disable() {
      const A = B.A;
      if (!A || !B.saved) { B.on = false; return; }
      for (const [m, map] of B.saved.maps) { m.map = map; m.needsUpdate = true; }
      for (const [m, map, obc, key] of B.saved.roads) { m.map = map; m.onBeforeCompile = obc; m.customProgramCacheKey = key; m.needsUpdate = true; }
      const [gm, gobc, gkey] = B.saved.ground; gm.onBeforeCompile = gobc; gm.customProgramCacheKey = gkey; gm.needsUpdate = true;
      SHADE.u.uShadeOn.value = 0;
      B.patched = false;
      if (B.sky) B.sky.visible = false;
      B.on = false;
    },
    frame(dt, mode, camera) {
      if (!B.on) return;
      B.sky.position.copy(camera.position);
      if (shadowWindow(B.A, mode, camera)) B.A.markDirty();
    },
    invalidate() { SHADE.dirty = true; },
  };
})();
