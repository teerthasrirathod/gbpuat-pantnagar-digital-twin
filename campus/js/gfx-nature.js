/* Campus 3D: trees, grass and ground detail for the high-quality mode.
   - Trees are leaf-card models (alpha-tested leaf textures painted in code) with soft spherical
     shading, per-tree tints, wind sway and sun shadows; distant trees are lumpy crowns.
   - Grass is a field of tufts placed by the GPU around the camera, only on real lawn: the grass
     mask is built from the satellite image with roads, buildings and water cut out.
   - The ground gets two scales of grass or soil detail (colour and normal) that fade with distance. */
(function () {
  "use strict";
  const G = (window.__gfx = window.__gfx || {});
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

  // ---------------------------------------------------------------------------------------
  // Textures painted in code
  function leafTexture(S) {
    const c = canvas(S, S), g = c.getContext("2d"), rnd = mulberry32(31);
    g.fillStyle = "#fff"; g.fillRect(0, S - 20, 20, 20);        // opaque white patch the trunk samples (bottom left)
    const leaf = (x, y, ang, len, wid, light) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      const hue = 88 + rnd() * 24, sat = 38 + rnd() * 20, lum = 20 + light * 20 + rnd() * 6;
      const gr = g.createLinearGradient(0, 0, 0, -len);
      gr.addColorStop(0, `hsl(${hue},${sat}%,${lum * 0.8}%)`); gr.addColorStop(1, `hsl(${hue - 6},${sat + 6}%,${lum * 1.25}%)`);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(wid, -len * 0.45, 0, -len); g.quadraticCurveTo(-wid, -len * 0.45, 0, 0); g.fill();
      g.strokeStyle = `hsla(${hue + 8},30%,${lum * 1.6}%,0.55)`; g.lineWidth = Math.max(0.6, S / 300); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.92); g.stroke();
      g.restore();
    };
    // sprigs radiating from the lower middle, leaves in pairs along each
    for (let s = 0; s < 9; s++) {
      const ang = -1.15 + (s / 8) * 2.3 + (rnd() - 0.5) * 0.2, len = S * (0.34 + rnd() * 0.14), ox = S * 0.5, oy = S * 0.9;
      const dx = Math.sin(ang), dy = -Math.cos(ang);
      g.strokeStyle = "#3a2c1c"; g.lineWidth = S / 140; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + dx * len, oy + dy * len); g.stroke();
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, px = ox + dx * len * t, py = oy + dy * len * t, ll = S * (0.1 - t * 0.03) * (0.85 + rnd() * 0.3);
        leaf(px, py, ang - 0.9 + (rnd() - 0.5) * 0.3, ll, ll * 0.3, t);
        leaf(px, py, ang + 0.9 + (rnd() - 0.5) * 0.3, ll, ll * 0.3, t);
      }
      leaf(ox + dx * len, oy + dy * len, ang, S * 0.09, S * 0.03, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
    return t;
  }
  G.leafTexture = leafTexture;
  function grassTexture() {
    const W = 128, Hh = 256, c = canvas(W, Hh), g = c.getContext("2d"), rnd = mulberry32(41);
    for (let i = 0; i < 26; i++) {
      const x = W * (0.12 + rnd() * 0.76), h = Hh * (0.45 + rnd() * 0.5), lean = (rnd() - 0.5) * W * 0.5, bw = W * (0.03 + rnd() * 0.035);
      const dry = rnd() < 0.18;
      const gr = g.createLinearGradient(0, Hh, 0, Hh - h);
      gr.addColorStop(0, dry ? "#5d5547" : "#4b524a"); gr.addColorStop(0.55, dry ? "#8a8168" : "#7c8a6c"); gr.addColorStop(1, dry ? "#cbbf98" : "#c4d29c");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - bw, Hh); g.quadraticCurveTo(x - bw * 0.4 + lean * 0.2, Hh - h * 0.55, x + lean, Hh - h); g.quadraticCurveTo(x + bw * 0.4 + lean * 0.2, Hh - h * 0.55, x + bw, Hh); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
    return t;
  }

  // ---------------------------------------------------------------------------------------
  // Tree models in unit space: y from 0 (ground) to 1 (top), crown about 0.8 wide. campus.js scales them
  // by (2.6 r, h, 2.6 r) per tree.
  function merge(parts) {
    const pos = [], nor = [], uv = [], col = [];
    for (const p of parts) { pos.push(...p.pos); nor.push(...p.nor); uv.push(...p.uv); col.push(...p.col); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
  function limb(x0, y0, z0, x1, y1, z1, r0, r1, color) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const geo = new THREE.CylinderGeometry(r1, r0, len, 6, 1, true).toNonIndexed();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1)));
    const n = geo.attributes.position.count, out = { pos: [], nor: [], uv: [], col: [] };
    for (let i = 0; i < n; i++) {
      out.pos.push(geo.attributes.position.getX(i), geo.attributes.position.getY(i), geo.attributes.position.getZ(i));
      out.nor.push(geo.attributes.normal.getX(i), geo.attributes.normal.getY(i), geo.attributes.normal.getZ(i));
      out.uv.push(0.04, 0.04); out.col.push(color[0], color[1], color[2]);
    }
    return out;
  }
  function treeGeometry(cards, seed) {
    const rnd = mulberry32(seed), parts = [];
    const bark = [0.1, 0.065, 0.04], cc = new THREE.Vector3(0, 0.68, 0), R = new THREE.Vector3(0.4, 0.3, 0.4);
    parts.push(limb(0, 0, 0, 0.01, 0.55, 0.005, 0.024, 0.012, bark));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rnd(), r = 0.16 + rnd() * 0.08;
      parts.push(limb(0.01, 0.42 + rnd() * 0.1, 0.005, Math.cos(a) * r, 0.7 + rnd() * 0.12, Math.sin(a) * r, 0.011, 0.005, bark));
    }
    // leaf cards: random orientation, centres in an ellipsoid shell, soft spherical normals, darker inside
    const out = { pos: [], nor: [], uv: [], col: [] }, u = new THREE.Vector3(), v = new THREE.Vector3(), nrm = new THREE.Vector3(), c = new THREE.Vector3(), tmp = new THREE.Vector3(), sn = new THREE.Vector3();
    for (let i = 0; i < cards; i++) {
      do { c.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (c.lengthSq() > 1 || c.lengthSq() < 0.08);
      const dist = Math.sqrt(c.lengthSq()); c.multiply(R).add(cc);
      nrm.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      u.set(0, 1, 0).cross(nrm); if (u.lengthSq() < 1e-4) u.set(1, 0, 0); u.normalize();
      v.copy(nrm).cross(u).normalize();
      const s = 0.19 + rnd() * 0.08, flip = rnd() < 0.5 ? -1 : 1;
      const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
      sn.copy(c).sub(cc).divide(R).normalize(); sn.y += 0.35; sn.normalize();
      const ao = 0.42 + 0.58 * clamp(dist * 1.1, 0, 1) * (0.8 + 0.2 * clamp((c.y - 0.45) / 0.5, 0, 1));
      const push = (k, back) => {
        const cr = corners[k];
        tmp.copy(c).addScaledVector(u, cr[0] * s * flip).addScaledVector(v, cr[1] * s);
        out.pos.push(tmp.x, tmp.y, tmp.z); out.nor.push(sn.x, sn.y, sn.z); out.uv.push(0.1 + 0.9 * (back ? 1 - cr[2] : cr[2]), 0.1 + 0.9 * cr[3]); out.col.push(ao, ao, ao);
      };
      for (const t of [[0, 1, 2], [0, 2, 3]]) for (const k of t) push(k, false);
      for (const t of [[0, 2, 1], [0, 3, 2]]) for (const k of t) push(k, true);   // back faces, so one-sided lighting works
    }
    parts.push(out);
    return merge(parts);
  }
  function crownGeometry(seed) {
    const rnd = mulberry32(seed), g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position, n = p.count, nor = [], col = [], lump = new Map();
    const key = (x, y, z) => Math.round(x * 100) + "," + Math.round(y * 100) + "," + Math.round(z * 100);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = key(x, y, z);
      if (!lump.has(k)) lump.set(k, 0.82 + rnd() * 0.36);
      const f = lump.get(k);
      nor.push(x, y * 0.8 + 0.2, z);
      p.setXYZ(i, x * f, y * f * 1.1 + 0.1, z * f);
      const ao = 0.5 + 0.5 * clamp(y * 0.5 + 0.55, 0, 1);
      col.push(ao, ao, ao);
    }
    const nn = new Float32Array(nor.length);
    for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nn[i] = nor[i] / l; nn[i + 1] = nor[i + 1] / l; nn[i + 2] = nor[i + 2] / l; }
    g.setAttribute("normal", new THREE.BufferAttribute(nn, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  // ---------------------------------------------------------------------------------------
  // Grass mask: where lawn can grow (red channel, 0..1), on a grid over the campus.
  function buildMask(A) {
    const t0 = performance.now(), [x0, z0, x1, z1] = A.CB, W = x1 - x0, Hh = z1 - z0;
    const cell = Math.max(2, Math.max(W, Hh) / 1536), w = Math.ceil(W / cell), h = Math.ceil(Hh / cell);
    const SG = A.SG, img = A.satImage();
    const c1 = canvas(w, h), g1 = c1.getContext("2d", { willReadFrequently: true });
    g1.imageSmoothingEnabled = true;
    g1.drawImage(img, (x0 - SG.x0) / SG.cell, (z0 - SG.z0) / SG.cell, W / SG.cell, Hh / SG.cell, 0, 0, w, h);
    const px = g1.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], d = g - Math.max(r, b);
      data[i] = clamp((d - 4) / 26, 0, 1) * 255;
    }
    // cut out roads, paths, buildings and water, each with a margin
    const c2 = canvas(w, h), g2 = c2.getContext("2d", { willReadFrequently: true });
    g2.fillStyle = "#000"; g2.strokeStyle = "#000"; g2.lineCap = "round"; g2.lineJoin = "round";
    const X = (x) => (x - x0) / cell, Z = (z) => (z - z0) / cell;
    for (const r of A.D.roads) {
      const pts = A.toRing(r.p); if (pts.length < 2) continue;
      g2.lineWidth = (Math.max(2.4, r.w) + 2.2) / cell;
      g2.beginPath(); pts.forEach((p, i) => (i ? g2.lineTo(X(p[0]), Z(p[1])) : g2.moveTo(X(p[0]), Z(p[1])))); g2.stroke();
    }
    g2.lineWidth = 3.2 / cell;
    for (const b of A.blds) {
      const ring = b.rings[0];
      g2.beginPath(); ring.forEach((p, i) => (i ? g2.lineTo(X(p[0]), Z(p[1])) : g2.moveTo(X(p[0]), Z(p[1])))); g2.closePath(); g2.fill(); g2.stroke();
    }
    g2.lineWidth = 2.4 / cell;
    for (const a of A.D.water.areas) for (const r of a.r) {
      const ring = A.toRing(r);
      g2.beginPath(); ring.forEach((p, i) => (i ? g2.lineTo(X(p[0]), Z(p[1])) : g2.moveTo(X(p[0]), Z(p[1])))); g2.closePath(); g2.fill(); g2.stroke();
    }
    const ex = g2.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) data[i] = data[i] * (1 - ex[i * 4 + 3] / 255);
    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
    G.maskMs = Math.round(performance.now() - t0);
    return { tex, box: new THREE.Vector4(x0, z0, w * cell, h * cell) };
  }

  // ---------------------------------------------------------------------------------------
  // Ground: the satellite image plus grass/soil detail that fades with distance
  G.makeGround = function (A, TX, Q) {
    const ground = A.ground();
    const mat = new THREE.MeshStandardMaterial({ map: ground.satTex, roughness: 1, metalness: 0, envMapIntensity: 0.8 });
    const det = TX && TX.ground;
    if (!det) return mat;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tG = { value: det.grass }; sh.uniforms.tS = { value: det.soil };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nuniform sampler2D tG; uniform sampler2D tS;\nvec4 gDet1, gDet2; float gNear, gVeg;")
        .replace("#include <map_fragment>", `#include <map_fragment>
        {
          float dd = distance(vWPos, cameraPosition);
          vec3 s0 = diffuseColor.rgb;
          gVeg = smoothstep(0.012, 0.11, s0.g - max(s0.r, s0.b));
          vec2 p1 = vWPos.xz * 0.82, p2 = vWPos.xz * 0.21;
          gDet1 = mix(texture2D(tS, p1), texture2D(tG, p1), gVeg);
          gDet2 = mix(texture2D(tS, p2), texture2D(tG, p2), gVeg);
          gNear = 1.0 - smoothstep(30.0, 260.0, dd);
          float k = (gDet1.b - 0.5) * 1.1 + (gDet2.b - 0.5) * 1.5;
          diffuseColor.rgb *= 1.0 + k * (0.1 + 0.22 * gNear) * (1.0 - smoothstep(60.0, 600.0, dd));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 1.12, 0.66), gVeg * gNear * 0.45);
        }`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          vec2 dn = ((gDet1.rg - 0.5) * 2.0 + (gDet2.rg - 0.5) * 1.2) * (1.0 - smoothstep(15.0, 170.0, distance(vWPos, cameraPosition)));
          normal = normalize(normal + mat3(viewMatrix) * vec3(dn.x, 0.0, -dn.y) * 0.5);
        }`);
    };
    mat.customProgramCacheKey = () => "campusGround";
    return mat;
  };

  // ---------------------------------------------------------------------------------------
  // Enable / disable the nature layer for a tier
  const N = { on: false, cards: 0, leaf: null, mats: null, geos: {}, grass: null, grassGrid: 0, mask: null };
  G.nature = {
    enable(C, Q, TX) {
      const A = C.gfx;
      N.on = true;
      if (!N.leaf) N.leaf = leafTexture(256);
      N.leaf.anisotropy = Q.aniso;
      if (!N.mats) {
        const wind = G.wind || { value: 0 };
        const sway = (sh) => {
          sh.uniforms.uWind = wind; sh.uniforms.uAmp = G.windAmp || (G.windAmp = { value: 1 });
          sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uWind; uniform float uAmp;")
            .replace("#include <begin_vertex>", `#include <begin_vertex>
            { float hh = max(0.0, position.y - 0.35);
              #ifdef USE_INSTANCING
              float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
              #else
              float ph = 0.0;
              #endif
              transformed.x += uAmp * (sin(uWind * 1.5 + ph) * 0.03 + sin(uWind * 3.1 + ph * 2.0 + position.x * 9.0) * 0.012) * hh;
              transformed.z += uAmp * (cos(uWind * 1.2 + ph) * 0.022 + cos(uWind * 2.7 + ph * 1.7 + position.z * 9.0) * 0.01) * hh; }`);
        };
        const near = new THREE.MeshStandardMaterial({ map: N.leaf, alphaTest: 0.5, vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.FrontSide, envMapIntensity: 0.9 });
        near.onBeforeCompile = sway;
        near.customProgramCacheKey = () => "treeNear";
        const mid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.9 });
        mid.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLeafP;").replace("#include <project_vertex>", "#include <project_vertex>\nvLeafP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
          sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
            varying vec3 vLeafP;
            float lh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
            float ln(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(mix(lh(i), lh(i + vec3(1, 0, 0)), f.x), mix(lh(i + vec3(0, 1, 0)), lh(i + vec3(1, 1, 0)), f.x), f.y),
                         mix(mix(lh(i + vec3(0, 0, 1)), lh(i + vec3(1, 0, 1)), f.x), mix(lh(i + vec3(0, 1, 1)), lh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
            .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.62 + 0.8 * ln(vLeafP * 0.9) * (0.55 + 0.45 * ln(vLeafP * 2.7));");
        };
        mid.customProgramCacheKey = () => "treeMid";
        A.treeLodPatch(near, true); A.treeLodPatch(mid, false);
        N.mats = { near, mid };
      }
      if (N.cards !== Q.cards) {
        for (const g of Object.values(N.geos)) g.dispose();
        N.geos = { near: treeGeometry(Q.cards, 7), mid: crownGeometry(9) };
        N.cards = Q.cards;
      }
      const tintNear = (c, t) => { const s = Math.sin(t.x * 0.37 + t.z * 0.91), s2 = Math.sin(t.x * 1.7 - t.z * 0.43); c.setRGB(t.tint * (0.82 + 0.14 * s), t.tint * (0.8 + 0.08 * s2), t.tint * (0.78 - 0.12 * s)); };
      const tintMid = (c, t) => { const s = Math.sin(t.x * 0.37 + t.z * 0.91); c.setRGB(0.045 * t.tint * (1 + 0.25 * s), 0.1 * t.tint, 0.024 * t.tint * (1 - 0.3 * s)); };
      A.setTreeKit({ near: { geo: N.geos.near, mat: N.mats.near, tint: tintNear, shadow: true }, mid: { geo: N.geos.mid, mat: N.mats.mid, tint: tintMid, shadow: false } });
      // grass: the mask and the tuft field are made when first needed (in street view), not at start-up
      N.C = C; N.q = Q;
      if (N.grass && N.grassGrid !== Q.grass) { C.scene.remove(N.grass); N.grass.geometry.dispose(); N.grass = null; }
      clearTimeout(N.timer);
      N.timer = setTimeout(() => { if (N.on) ensureGrass(); }, 1500);
    },
    disable() {
      N.on = false;
      if (N.grass) N.grass.visible = false;
    },
    frame(dt, mode, camera) {
      if (!N.on) return;
      if (!N.grass) { if (mode !== "street") return; ensureGrass(); }
      const A = N.C.gfx, g = N.grass, u = N.gu;
      const cx = camera.position.x, cz = camera.position.z, gy = A.H(cx, cz);
      g.visible = (mode === "street") && camera.position.y - gy < 40;
      if (!g.visible) return;
      u.uCam.value.set(cx, gy, cz);
      u.uSlope.value.set((A.H(cx + 3, cz) - A.H(cx - 3, cz)) / 6, (A.H(cx, cz + 3) - A.H(cx, cz - 3)) / 6);
      u.uTime.value = (G.wind && G.wind.value) || 0;
    },
  };

  function ensureGrass() {
    if (!N.q || !N.q.grass || (N.grass && N.grassGrid === N.q.grass)) return;
    if (!N.mask) N.mask = buildMask(N.C.gfx);
    makeGrass(N.C, N.q.grass);
  }
  function makeGrass(C, grid) {
    const A = C.gfx;
    N.C = C;
    if (N.grass) { C.scene.remove(N.grass); N.grass.geometry.dispose(); }
    // one tuft = three crossed quads; the cell id is stored per vertex so the GPU can place it
    const tuft = [], cellId = [], uvs = [], nors = [];
    const planes = [0, Math.PI / 3, (2 * Math.PI) / 3];
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
      for (const a of planes) {
        const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
        const q = [[-cx, 0, -cz, 0, 0], [cx, 0, cz, 1, 0], [cx, 1, cz, 1, 1], [-cx, 1, -cz, 0, 1]];
        for (const k of [0, 1, 2, 0, 2, 3]) { tuft.push(q[k][0], q[k][1], q[k][2]); uvs.push(q[k][3], q[k][4]); nors.push(0, 1, 0); cellId.push(i, j); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(tuft, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nors, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("aCell", new THREE.Float32BufferAttribute(cellId, 2));
    const cell = grid >= 180 ? 0.28 : 0.32;
    const sat = A.ground().satTex, SG = A.SG;
    const u = {
      uCam: { value: new THREE.Vector3() }, uSlope: { value: new THREE.Vector2() }, uTime: { value: 0 }, uGrid: { value: grid }, uCell: { value: cell }, uAmp: G.windAmp || (G.windAmp = { value: 1 }),
      tMask: { value: N.mask.tex }, uMaskBox: { value: N.mask.box }, tSat: { value: sat }, uSatBox: { value: new THREE.Vector4(SG.x0, SG.z0, SG.nx * SG.cell, SG.nz * SG.cell) },
    };
    N.gu = u;
    if (!N.grassTex) N.grassTex = grassTexture();
    const mat = new THREE.MeshStandardMaterial({ map: N.grassTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 1.1 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
        attribute vec2 aCell; uniform vec3 uCam; uniform vec2 uSlope; uniform float uTime, uGrid, uCell, uAmp; uniform sampler2D tMask; uniform vec4 uMaskBox; uniform sampler2D tSat; uniform vec4 uSatBox;
        varying vec3 vTint;
        vec2 hash22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }`)
        .replace("#include <begin_vertex>", `
        vec2 baseCell = floor(uCam.xz / uCell);
        vec2 ci = aCell + uGrid * floor((baseCell - aCell + uGrid * 0.5) / uGrid);
        vec2 h1 = hash22(ci), h2 = hash22(ci + 17.0);
        vec2 wp = (ci + 0.15 + 0.7 * h1) * uCell;
        vec2 muv = (wp - uMaskBox.xy) / uMaskBox.zw;
        float dens = (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) ? texture2D(tMask, muv).r : 0.0;
        float dist = distance(wp, uCam.xz), reach = uGrid * uCell * 0.5;
        float fade = 1.0 - smoothstep(reach * 0.55, reach * 0.95, dist);
        float keep = step(h2.x, smoothstep(0.02, 0.35, dens)) * fade;
        float ht = (0.13 + 0.2 * h2.y) * (0.7 + 0.3 * dens) * keep;
        float yaw = h1.x * 6.2831, cs = cos(yaw), sn = sin(yaw);
        float wd = (0.5 + 0.35 * h1.y) * keep;
        vec2 lp = vec2(position.x * cs - position.z * sn, position.x * sn + position.z * cs) * wd;
        float gy = uCam.y + uSlope.x * (wp.x - uCam.x) + uSlope.y * (wp.y - uCam.z);
        float sway = sin(uTime * 1.7 + wp.x * 0.8 + wp.y * 0.6) * 0.07 * uAmp * position.y * position.y * ht;
        vec3 transformed = vec3(wp.x + lp.x + sway, gy + position.y * ht - 0.02, wp.y + lp.y + sway * 0.6);
        vec2 suv = (wp - uSatBox.xy) / uSatBox.zw;
        vTint = clamp(texture2D(tSat, suv).rgb * 1.9, 0.18, 1.2) * (0.8 + 0.4 * h2.x);`);
      // blades are lit as if facing up from either side: do not flip the normal on back faces
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vTint;")
        .replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""))
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= vTint;");
    };
    mat.customProgramCacheKey = () => "campusGrass";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.renderOrder = 2;
    mesh.name = "grass";
    C.scene.add(mesh);
    N.grass = mesh; N.grassGrid = grid;
  }
})();
