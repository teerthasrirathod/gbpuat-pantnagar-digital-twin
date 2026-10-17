/* Campus 3D: procedural PBR textures for the high-quality mode.
   Everything is painted in code, so the page stays one offline file: no image downloads.
   Each material gets an albedo map (sRGB), a tangent-space normal map from a painted height field,
   and a packed roughness/metalness map (green = roughness, blue = metalness, as glTF does).
   Window glass, paint, plaster, tar, corrugated sheet and paving all differ in roughness and
   metalness, so the sun and the sky reflect differently off each of them. */
(function () {
  "use strict";
  const G = (window.__gfx = window.__gfx || {});
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------------------------------------
  // Tileable value noise
  function noiseField(w, h, period, rnd) {
    const pw = period, ph = Math.max(1, Math.round(period * h / w));
    const lat = new Float32Array(pw * ph);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const out = new Float32Array(w * h), kx = pw / w, ky = ph / h;
    for (let y = 0; y < h; y++) {
      const fy = y * ky, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ra = (y0 % ph) * pw, rb = ((y0 + 1) % ph) * pw;
      for (let x = 0; x < w; x++) {
        const fx = x * kx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), xa = x0 % pw, xb = (x0 + 1) % pw;
        const a = lat[ra + xa] + (lat[ra + xb] - lat[ra + xa]) * sx, b = lat[rb + xa] + (lat[rb + xb] - lat[rb + xa]) * sx;
        out[y * w + x] = a + (b - a) * sy;
      }
    }
    return out;
  }
  // Sum of octaves, roughly 0..1 around 0.5.
  function fbm(w, h, p0, octaves, rnd, gain = 0.5) {
    const out = new Float32Array(w * h);
    let amp = 1, tot = 0;
    for (let o = 0; o < octaves; o++) {
      const f = noiseField(w, h, p0 << o, rnd);
      for (let i = 0; i < out.length; i++) out[i] += f[i] * amp;
      tot += amp; amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // A surface being painted: albedo, height, roughness, metalness per pixel (y down, like an image).
  function surface(w, h) {
    const n = w * h;
    return { w, h, rgb: new Float32Array(n * 3), hgt: new Float32Array(n), rgh: new Float32Array(n), mtl: new Float32Array(n) };
  }
  function fill(s, m) {
    const n = s.w * s.h;
    for (let i = 0; i < n; i++) { s.rgb[i * 3] = m.c[0]; s.rgb[i * 3 + 1] = m.c[1]; s.rgb[i * 3 + 2] = m.c[2]; s.hgt[i] = m.h; s.rgh[i] = m.r; s.mtl[i] = m.m; }
  }
  // Antialiased rectangle in pixel units; alpha blends it over what is there.
  function rect(s, x0, y0, x1, y1, m, alpha = 1) {
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(s.h - 1, Math.ceil(y1) - 1), xa = Math.max(0, Math.floor(x0)), xb = Math.min(s.w - 1, Math.ceil(x1) - 1);
    for (let y = ya; y <= yb; y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0);
      if (cy <= 0) continue;
      for (let x = xa; x <= xb; x++) {
        const cx = Math.min(x + 1, x1) - Math.max(x, x0);
        if (cx <= 0) continue;
        const a = Math.min(1, cx * cy) * alpha, i = y * s.w + x;
        s.rgb[i * 3] += (m.c[0] - s.rgb[i * 3]) * a; s.rgb[i * 3 + 1] += (m.c[1] - s.rgb[i * 3 + 1]) * a; s.rgb[i * 3 + 2] += (m.c[2] - s.rgb[i * 3 + 2]) * a;
        s.hgt[i] += (m.h - s.hgt[i]) * a; s.rgh[i] += (m.r - s.rgh[i]) * a; s.mtl[i] += (m.m - s.mtl[i]) * a;
      }
    }
  }
  // Multiply the albedo by a vertical or horizontal ramp inside a box (fake contact shadow / dirt).
  function ramp(s, x0, y0, x1, y1, from, to, vertical = true) {
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(s.h - 1, Math.ceil(y1) - 1), xa = Math.max(0, Math.floor(x0)), xb = Math.min(s.w - 1, Math.ceil(x1) - 1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const t = vertical ? (y + 0.5 - y0) / (y1 - y0) : (x + 0.5 - x0) / (x1 - x0), f = from + (to - from) * clamp(t, 0, 1), i = (y * s.w + x) * 3;
      s.rgb[i] *= f; s.rgb[i + 1] *= f; s.rgb[i + 2] *= f;
    }
  }
  // Per-pixel albedo mottling and height grain on surfaces matching a test (usually "rough and not glass").
  function grain(s, rnd, opt) {
    const { w, h } = s, lo = fbm(w, h, 4, 4, rnd), mid = fbm(w, h, 16, 3, rnd), hi = noiseField(w, h, Math.min(w, 128), rnd);
    for (let i = 0; i < w * h; i++) {
      if (s.rgh[i] < (opt.minRough || 0.8)) continue;
      const m = 1 + (lo[i] - 0.5) * opt.low + (mid[i] - 0.5) * opt.mid + (hi[i] - 0.5) * opt.fine;
      s.rgb[i * 3] *= m; s.rgb[i * 3 + 1] *= m; s.rgb[i * 3 + 2] *= m;
      s.hgt[i] += (hi[i] - 0.5) * opt.bump + (mid[i] - 0.5) * (opt.bump * 0.8);
      s.rgh[i] = clamp(s.rgh[i] + (lo[i] - 0.5) * 0.1, 0, 1);
    }
  }

  // Height field to a tangent-space normal map (OpenGL style, tileable), then to textures.
  // With ALBEDO_ONLY (the Balanced tier, which has no real-time light) the relief is instead lit once from the
  // upper left and folded into the colours, and no normal or roughness maps are made.
  let ALBEDO_ONLY = false;
  function bake(s, strength, aniso) {
    const { w, h } = s, n = w * h, only = ALBEDO_ONLY;
    const alb = new Uint8Array(n * 4), nor = only ? null : new Uint8Array(n * 4), orm = only ? null : new Uint8Array(n * 4);
    for (let y = 0; y < h; y++) {
      const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w, row = (h - 1 - y) * w; // texture rows run bottom to top
      for (let x = 0; x < w; x++) {
        const xm = (x - 1 + w) % w, xp = (x + 1) % w, i = y0 + x, o = (row + x) * 4;
        const ddx = s.hgt[y0 + xp] - s.hgt[y0 + xm], ddy = s.hgt[yp + x] - s.hgt[ym + x];
        let k = 1;
        if (only) k = clamp(1 + 0.9 * ddx + 0.6 * ddy, 0.55, 1.4);
        else {
          const dx = ddx * strength, dy = ddy * strength;
          let nx = -dx, ny = dy, nz = 1;
          const l = 1 / Math.sqrt(nx * nx + ny * ny + 1); nx *= l; ny *= l; nz *= l;
          nor[o] = (nx * 0.5 + 0.5) * 255; nor[o + 1] = (ny * 0.5 + 0.5) * 255; nor[o + 2] = (nz * 0.5 + 0.5) * 255; nor[o + 3] = 255;
          orm[o] = 255; orm[o + 1] = clamp(s.rgh[i], 0, 1) * 255; orm[o + 2] = clamp(s.mtl[i], 0, 1) * 255; orm[o + 3] = 255;
        }
        alb[o] = clamp(s.rgb[i * 3] * k, 0, 1) * 255; alb[o + 1] = clamp(s.rgb[i * 3 + 1] * k, 0, 1) * 255; alb[o + 2] = clamp(s.rgb[i * 3 + 2] * k, 0, 1) * 255; alb[o + 3] = 255;
      }
    }
    const tex = (data, srgb) => {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.anisotropy = aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return only ? { map: tex(alb, true) } : { map: tex(alb, true), normal: tex(nor, false), orm: tex(orm, false) };
  }

  // ---------------------------------------------------------------------------------------
  // Materials as paint
  const PLASTER = { c: [0.93, 0.93, 0.92], h: 0.5, r: 0.92, m: 0 };
  const PAINT = { c: [0.97, 0.97, 0.96], h: 0.62, r: 0.5, m: 0 };
  const CONC = { c: [0.80, 0.80, 0.79], h: 0.58, r: 0.9, m: 0 };
  const GLASS = { c: [0.045, 0.06, 0.08], h: 0.36, r: 0.06, m: 0.6 };

  // One bay (3.2 m) wide by one floor: plaster, floor slab, sunshade, framed window with four panes, sill.
  function facade(S, aniso) {
    const rnd = mulberry32(5), s = surface(S, S), f = (x0, y0, x1, y1, m, a) => rect(s, x0 * S, y0 * S, x1 * S, y1 * S, m, a);
    fill(s, PLASTER);
    f(0, 0.90, 1, 1, { c: [0.87, 0.87, 0.86], h: 0.56, r: 0.9, m: 0 });   // slab band
    f(0, 0.885, 1, 0.90, { c: [0.7, 0.7, 0.7], h: 0.4, r: 0.95, m: 0 }); // shadow joint above the slab
    f(0.16, 0.125, 0.84, 0.18, { c: [0.87, 0.87, 0.86], h: 0.8, r: 0.9, m: 0 }); // sunshade (chhajja)
    ramp(s, 0.16 * S, 0.18 * S, 0.84 * S, 0.25 * S, 0.62, 1);   // its shadow on the wall
    f(0.245, 0.255, 0.755, 0.77, { c: [0.5, 0.5, 0.5], h: 0.4, r: 0.92, m: 0 }); // window reveal
    f(0.265, 0.27, 0.735, 0.755, PAINT);                        // frame
    for (const [x0, x1] of [[0.295, 0.488], [0.512, 0.705]]) for (const [y0, y1] of [[0.30, 0.50], [0.52, 0.725]]) {
      f(x0, y0, x1, y1, GLASS);
      ramp(s, x0 * S, y0 * S, x1 * S, y1 * S, 1.9, 0.8);       // sky reflected high in each pane, ground low
    }
    f(0.225, 0.755, 0.775, 0.79, { c: [0.8, 0.8, 0.78], h: 0.7, r: 0.9, m: 0 }); // sill
    ramp(s, 0.225 * S, 0.79 * S, 0.775 * S, 0.84 * S, 0.7, 1);
    grain(s, rnd, { low: 0.16, mid: 0.1, fine: 0.06, bump: 0.012 });
    // rain streaks below the sill and sunshade ends
    const st = noiseField(S, S, 32, rnd);
    for (let y = Math.floor(0.79 * S); y < S * 0.9; y++) for (let x = Math.floor(0.22 * S); x < 0.78 * S; x++) {
      const k = 1 - 0.18 * st[y * S + x] * (1 - (y / S - 0.79) / 0.11), i = (y * S + x) * 3;
      if (s.rgh[y * S + x] > 0.8) { s.rgb[i] *= k; s.rgb[i + 1] *= k; s.rgb[i + 2] *= k; }
    }
    return bake(s, S * 0.03, aniso);
  }
  // A small house: one window with a steel grille, painted plinth.
  function house(S, aniso) {
    const rnd = mulberry32(6), s = surface(S, S), f = (x0, y0, x1, y1, m, a) => rect(s, x0 * S, y0 * S, x1 * S, y1 * S, m, a);
    fill(s, PLASTER);
    f(0, 0.90, 1, 1, { c: [0.66, 0.64, 0.6], h: 0.56, r: 0.95, m: 0 }); // plinth
    f(0.31, 0.26, 0.69, 0.70, { c: [0.5, 0.5, 0.5], h: 0.4, r: 0.9, m: 0 });
    f(0.325, 0.275, 0.675, 0.685, PAINT);
    f(0.34, 0.29, 0.66, 0.67, GLASS);
    ramp(s, 0.34 * S, 0.29 * S, 0.66 * S, 0.67 * S, 1.8, 0.8);
    for (let k = 1; k < 8; k++) f(0.34 + k * 0.04 - 0.004, 0.29, 0.34 + k * 0.04 + 0.004, 0.67, { c: [0.15, 0.16, 0.17], h: 0.8, r: 0.5, m: 0.7 });
    f(0.30, 0.70, 0.70, 0.725, { c: [0.78, 0.78, 0.76], h: 0.68, r: 0.9, m: 0 });
    ramp(s, 0.30 * S, 0.725 * S, 0.70 * S, 0.78 * S, 0.7, 1);
    f(0.30, 0.20, 0.70, 0.235, { c: [0.58, 0.58, 0.57], h: 0.7, r: 0.9, m: 0 }); // lintel
    grain(s, rnd, { low: 0.2, mid: 0.12, fine: 0.07, bump: 0.014 });
    return bake(s, S * 0.03, aniso);
  }
  // Corrugated metal sheeting for sheds and workshops.
  function shed(S, aniso) {
    const rnd = mulberry32(7), s = surface(S, S);
    fill(s, { c: [0.66, 0.68, 0.7], h: 0.5, r: 0.45, m: 0.85 });
    const ribs = 10, rust = fbm(S, S, 4, 4, rnd), n2 = noiseField(S, S, 64, rnd);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, ph = Math.sin((x / S) * ribs * Math.PI * 2), r = rust[i];
      s.hgt[i] = 0.5 + ph * 0.35;
      const sh = 1 + ph * 0.18, rs = clamp((r - 0.55) * 3, 0, 1) * (0.4 + 0.6 * (y / S));
      s.rgb[i * 3] = (0.66 + rs * 0.12) * sh; s.rgb[i * 3 + 1] = (0.68 - rs * 0.14) * sh; s.rgb[i * 3 + 2] = (0.7 - rs * 0.3) * sh;
      s.rgh[i] = clamp(0.4 + rs * 0.5 + (n2[i] - 0.5) * 0.1, 0, 1);
      s.mtl[i] = 0.9 * (1 - rs);
    }
    for (let k = 0; k < ribs; k++) for (const yy of [0.06, 0.94]) rect(s, (k + 0.3) / ribs * S, (yy - 0.01) * S, (k + 0.36) / ribs * S, (yy + 0.01) * S, { c: [0.3, 0.3, 0.32], h: 0.9, r: 0.4, m: 0.9 }); // fixings
    return bake(s, S * 0.09, aniso);
  }
  // Flat concrete roof, one tile = 6 m: expansion joints, aggregate, water stains.
  function roof(S, aniso) {
    const rnd = mulberry32(11), s = surface(S, S);
    fill(s, { c: [0.60, 0.59, 0.57], h: 0.5, r: 0.95, m: 0 });
    for (const p of [0, 0.5]) { rect(s, p * S - 1, 0, p * S + 1, S, { c: [0.3, 0.3, 0.3], h: 0.3, r: 1, m: 0 }); rect(s, 0, p * S - 1, S, p * S + 1, { c: [0.3, 0.3, 0.3], h: 0.3, r: 1, m: 0 }); }
    grain(s, rnd, { low: 0.3, mid: 0.2, fine: 0.14, bump: 0.05, minRough: 0.5 });
    const stain = fbm(S, S, 3, 3, rnd);
    for (let i = 0; i < S * S; i++) { const k = clamp((stain[i] - 0.58) * 3.4, 0, 1) * 0.35; s.rgb[i * 3] *= 1 - k; s.rgb[i * 3 + 1] *= 1 - k * 0.95; s.rgb[i * 3 + 2] *= 1 - k * 0.8; s.rgh[i] = Math.min(1, s.rgh[i] + k * 0.05); }
    return bake(s, S * 0.04, aniso);
  }

  // Roads: u across the carriageway, v along (one tile = 7 m along).
  function asphalt(W, Hh, aniso, kind) {
    const rnd = mulberry32(kind === "major" ? 1 : 2), s = surface(W, Hh), major = kind === "major";
    const base = major ? [0.34, 0.34, 0.35] : [0.40, 0.395, 0.38];
    fill(s, { c: base, h: 0.5, r: 0.88, m: 0 });
    const fine = noiseField(W, Hh, Math.min(W, 256), rnd), mid = fbm(W, Hh, 8, 3, rnd), lo = fbm(W, Hh, 3, 3, rnd), crack = fbm(W, Hh, 12, 2, rnd);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = x / W;
      const track = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2)); // polished wheel tracks
      let m = 1 + (fine[i] - 0.5) * 0.22 + (mid[i] - 0.5) * 0.16 + (lo[i] - 0.5) * 0.16 - track * 0.06;
      const cr = Math.abs(crack[i] - 0.5) < 0.006 ? 1 : 0;  // hairline cracks and tar seams
      m *= 1 - cr * 0.45;
      s.rgb[i * 3] = base[0] * m; s.rgb[i * 3 + 1] = base[1] * m; s.rgb[i * 3 + 2] = base[2] * m;
      s.hgt[i] = 0.5 + (fine[i] - 0.5) * 0.2 + (mid[i] - 0.5) * 0.03 - cr * 0.22;
      s.rgh[i] = clamp(0.9 - track * 0.18 + (mid[i] - 0.5) * 0.12, 0, 1);
    }
    const line = { c: [0.93, 0.92, 0.88], h: 0.56, r: 0.55, m: 0 };
    if (major) {
      rect(s, W * 0.04, 0, W * 0.075, Hh, line); rect(s, W * 0.925, 0, W * 0.96, Hh, line);   // edge lines
      rect(s, W * 0.485, Hh * 0.1, W * 0.515, Hh * 0.55, line);                                // centre dash
      // paint wears: speckle it with the asphalt colour
      for (let k = 0; k < Hh * 5; k++) { const x = (Math.random() < 0.5 ? 0.04 + Math.random() * 0.035 : Math.random() < 0.5 ? 0.925 + Math.random() * 0.035 : 0.485 + Math.random() * 0.03) * W, y = Math.random() * Hh; rect(s, x, y, x + 1.5, y + 1.5, { c: base, h: 0.5, r: 0.88, m: 0 }, 0.7); }
    } else {
      // dusty sandy shoulders either side
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const u = x / W, e = Math.max(0, 1 - Math.min(u, 1 - u) / 0.09) * (0.5 + mid[y * W + x]), i = (y * W + x) * 3;
        s.rgb[i] += (0.62 - s.rgb[i]) * e * 0.55; s.rgb[i + 1] += (0.56 - s.rgb[i + 1]) * e * 0.55; s.rgb[i + 2] += (0.45 - s.rgb[i + 2]) * e * 0.55;
      }
    }
    return bake(s, W * 0.02, aniso);
  }
  function dirtRoad(W, Hh, aniso) {
    const rnd = mulberry32(3), s = surface(W, Hh);
    const fine = noiseField(W, Hh, Math.min(W, 256), rnd), mid = fbm(W, Hh, 6, 3, rnd), lo = fbm(W, Hh, 3, 3, rnd);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = x / W;
      const rut = Math.exp(-Math.pow((u - 0.25) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.75) / 0.07, 2));
      const grass = Math.exp(-Math.pow((u - 0.5) / 0.09, 2)) * clamp((mid[i] - 0.35) * 3, 0, 1);
      const m = 1 + (fine[i] - 0.5) * 0.3 + (lo[i] - 0.5) * 0.3;
      const r = 0.62 * m - rut * 0.08, g = 0.52 * m - rut * 0.07, b = 0.4 * m - rut * 0.06;
      s.rgb[i * 3] = r + (0.3 - r) * grass; s.rgb[i * 3 + 1] = g + (0.42 - g) * grass; s.rgb[i * 3 + 2] = b + (0.2 - b) * grass;
      s.hgt[i] = 0.5 - rut * 0.25 + (fine[i] - 0.5) * 0.4 + grass * 0.1;
      s.rgh[i] = 0.95; s.mtl[i] = 0;
    }
    return bake(s, W * 0.08, aniso);
  }
  function paving(S, aniso) {
    const rnd = mulberry32(4), s = surface(S, S), n = 6, t = S / n;
    fill(s, { c: [0.66, 0.64, 0.6], h: 0.5, r: 0.9, m: 0 });
    const tone = noiseField(n, n, n, rnd);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = 0.9 + tone[j * n + i] * 0.2;
      rect(s, i * t + 1.5, j * t + 1.5, (i + 1) * t - 1.5, (j + 1) * t - 1.5, { c: [0.7 * k, 0.68 * k, 0.64 * k], h: 0.55, r: 0.85, m: 0 });
    }
    grain(s, rnd, { low: 0.1, mid: 0.14, fine: 0.12, bump: 0.05, minRough: 0.5 });
    return bake(s, S * 0.06, aniso);
  }

  // Ground detail (tileable): R,G = normal XY, B = brightness (0.5 = unchanged). Used by the terrain shader.
  function groundDetail(S, aniso) {
    const mk = (seed, kinds) => {
      const rnd = mulberry32(seed), s = surface(S, S), lo = fbm(S, S, 4, 4, rnd), hi = noiseField(S, S, Math.min(S, 128), rnd), mid = fbm(S, S, 16, 3, rnd);
      for (let i = 0; i < S * S; i++) {
        s.hgt[i] = kinds.h(lo[i], mid[i], hi[i]);
        const b = kinds.b(lo[i], mid[i], hi[i]);
        s.rgb[i * 3] = s.rgb[i * 3 + 1] = s.rgb[i * 3 + 2] = b; s.rgh[i] = 1;
      }
      const t = bake(s, S * kinds.k, aniso);
      // pack: reuse the normal bytes for RG and the albedo for B
      const nd = t.normal.image.data, ad = t.map.image.data, out = new Uint8Array(S * S * 4);
      for (let i = 0; i < S * S; i++) { out[i * 4] = nd[i * 4]; out[i * 4 + 1] = nd[i * 4 + 1]; out[i * 4 + 2] = clamp(ad[i * 4], 0, 255); out[i * 4 + 3] = 255; }
      t.map.dispose(); t.normal.dispose(); t.orm.dispose();
      const tex = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = aniso; tex.needsUpdate = true;
      return tex;
    };
    return {
      grass: mk(21, { k: 0.03, h: (l, m, h) => m * 0.6 + h * 0.5 + l * 0.2, b: (l, m, h) => clamp(0.5 + (m - 0.5) * 0.55 + (h - 0.5) * 0.4 + (l - 0.5) * 0.5, 0, 1) }),
      soil: mk(22, { k: 0.04, h: (l, m, h) => m * 0.5 + h * 0.8, b: (l, m, h) => clamp(0.5 + (m - 0.5) * 0.4 + (h - 0.5) * 0.55 + (l - 0.5) * 0.3, 0, 1) }),
    };
  }

  // Painted one texture set at a time with a pause between them, so the page stays responsive.
  G.makeTextures = async function (size, aniso, opts = {}) {
    ALBEDO_ONLY = !!opts.albedoOnly;
    const t0 = performance.now(), S = size, out = {}, times = {};
    const pause = () => new Promise((r) => setTimeout(r, 0));
    const step = async (name, fn) => { const t = performance.now(); out[name] = fn(); times[name] = Math.round(performance.now() - t); await pause(); };
    const rw = Math.min(S * 2, 512), rh = rw * 2;
    await step("facade", () => facade(S, aniso));
    await step("house", () => house(S, aniso));
    await step("shed", () => shed(Math.min(S, 256), aniso));
    await step("roof", () => roof(S, aniso));
    await step("major", () => asphalt(rw, rh, aniso, "major"));
    await step("minor", () => asphalt(rw, rh, aniso, "minor"));
    await step("dirt", () => dirtRoad(256, 512, aniso));
    await step("path", () => paving(Math.min(S, 256), aniso));
    if (!ALBEDO_ONLY) await step("ground", () => groundDetail(Math.min(S, 256), aniso));
    ALBEDO_ONLY = false;
    G.texMs = Math.round(performance.now() - t0);
    G.texTimes = times;
    return out;
  };
})();
