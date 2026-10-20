/* Campus 3D: graphics tiers.
   Light     the original unlit pipeline: baked light, flat shapes. Costs almost nothing.
   Balanced  for integrated GPUs (gfx-baked.js): the same cheap pipeline plus things prepared once on the CPU:
             painted facades, ground shadows, a painted sky, leafy trees. Anti-aliasing is free while you move and
             arrives when you stop: the still frame is rendered 8 times at sub-pixel offsets and averaged.
   High      real-time sunlight with soft shadows, a physical sky with a time of day, image-based light, PBR
   Ultra     materials (gfx-tex.js), leaf-card trees and grass (gfx-nature.js), an HDR pipeline with bloom,
             ACES film tone mapping, grading and FXAA; Ultra adds bigger shadows, sharper textures and more grass.
   It plugs into campus.js through __campus.gfx and is fully reversible at run time. The tier is picked from the
   GPU, can be changed in Layers > Graphics, and steps down by itself if movement is choppy. */
(function () {
  "use strict";
  const G = (window.__gfx = window.__gfx || {});
  const KEY = "gbpuat-campus:quality";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const PRESETS = {
    light: { name: "light", label: "Light", mode: "light" },
    balanced: { name: "balanced", label: "Balanced", mode: "baked", tex: 256, aniso: 4, cards: 16, scale: 1.0, samples: 8 },
    high: { name: "high", label: "High", mode: "lit", tex: 256, shadow: 2048, shadowR: 70, bloom: true, ssao: false, scale: 1.25, aniso: 8, cards: 36, grass: 128, ambient: false },
    ultra: { name: "ultra", label: "Ultra", mode: "lit", tex: 512, shadow: 4096, shadowR: 100, bloom: true, ssao: true, scale: 1.5, aniso: 16, cards: 60, grass: 192, ambient: true },
  };
  const ALIAS = { standard: "light" };
  const ORDER = ["light", "balanced", "high", "ultra"];
  const NOTES = {
    light: "The original look for any computer: baked lighting and simple shapes.",
    balanced: "Made for laptops with built-in graphics: sharper walls, ground shadows, a painted sky and leafy trees. Edges smooth out when you stop moving.",
    high: "Real sunlight and shadows, a sky with a time of day, sharper materials, leafy trees, grass and bloom. Needs a graphics card.",
    ultra: "High plus larger shadows, sharper textures, more grass, ambient occlusion. Needs a fast graphics card.",
  };

  function boot(C) {
    const A = C.gfx, renderer = C.renderer, scene = C.scene, camera = C.camera;
    const V3 = THREE.Vector3;
    const $ = (id) => document.getElementById(id);
    const isGL2 = renderer.capabilities.isWebGL2;
    const floatOK = isGL2 && !!renderer.getContext().getExtension("EXT_color_buffer_float");
    const HDR = floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;

    // ---------------------------------------------------------------------------------------
    // Which tier: the address (#gfx=high), then the saved choice, then the GPU.
    function gpuName() {
      try {
        const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      } catch (e) { return ""; }
    }
    const GPU = gpuName();
    // "ANGLE (Intel, Intel(R) UHD Graphics 600 (0x00003185) Direct3D11 ...)" -> "Intel UHD Graphics 600"
    function gpuLabel() {
      const m = GPU.match(/ANGLE \([^,]+, (.+?)(?: \(0x|, | Direct3D| vs_)/) || GPU.match(/^(.*?)(?: \(0x|$)/);
      const t = m ? m[1].replace(/\((R|TM)\)/g, "").replace(/\s+/g, " ").trim() : "";
      return /SwiftShader|llvmpipe|Software/i.test(GPU) ? "" : t;
    }
    function detect() {
      if (!isGL2) return "light";
      if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return "light";
      if (/SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(GPU)) return "light";
      if (/Mali|Adreno|PowerVR|VideoCore/i.test(GPU)) return "light";
      if (/RTX|GeForce|GTX|Quadro|Radeon RX|Radeon Pro|Apple M/i.test(GPU)) return "ultra";
      if (/Iris.*Xe|Arc|Radeon.*Graphics|Radeon\(TM\) Graphics/i.test(GPU)) return "high";
      return "balanced"; // Intel UHD/HD Graphics, older integrated GPUs and anything unknown
    }
    let explicit = true, wanted;
    {
      const h = (location.hash.match(/gfx=(light|standard|balanced|high|ultra)/) || [])[1];
      const saved = store.get(KEY);
      if (h) wanted = ALIAS[h] || h;
      else if (saved && (PRESETS[saved] || ALIAS[saved])) wanted = ALIAS[saved] || saved;
      else { wanted = detect(); explicit = false; }
    }

    // ---------------------------------------------------------------------------------------
    // Sky for the lit tiers: physical-looking gradient, sun and moon discs, stars, drifting clouds.
    const skyU = {
      uSunDir: { value: new V3(0, 1, 0) }, uMoonDir: { value: new V3(0, 1, 0) }, uTime: { value: 0 }, uClouds: { value: 1 }, uOvercast: { value: 0 }, uSunVis: { value: 1 },
    };
    const SKY_FN = `
      uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform float uTime; uniform float uClouds; uniform float uOvercast; uniform float uSunVis;
      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      vec3 skyColor(vec3 d) {
        float sh = uSunDir.y, y = d.y;
        float dayT = smoothstep(-0.04, 0.32, sh), up = smoothstep(-0.22, 0.04, sh);
        vec3 zen = mix(vec3(0.0025, 0.005, 0.014), mix(vec3(0.10, 0.15, 0.34), vec3(0.11, 0.28, 0.70), dayT), up);
        vec3 hor = mix(vec3(0.012, 0.02, 0.045), mix(vec3(1.05, 0.48, 0.20), vec3(0.58, 0.74, 0.92), dayT), up);
        float hz = pow(1.0 - clamp(y, 0.0, 1.0), 3.2);
        vec3 col = mix(zen, hor, hz);
        float sd = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.5, 0.22) * pow(sd, 5.0) * 0.75 * (1.0 - dayT) * up * uSunVis;
        col += vec3(1.0, 0.86, 0.66) * pow(sd, 48.0) * 1.4 * smoothstep(-0.12, 0.08, sh) * uSunVis;
        col += vec3(1.0, 0.95, 0.86) * smoothstep(0.99935, 0.99965, sd) * 40.0 * smoothstep(-0.04, 0.03, sh) * uSunVis;
        if (y < 0.0) col = mix(hor, hor * 0.55, clamp(-y * 3.0, 0.0, 1.0));
        float night = 1.0 - smoothstep(-0.22, 0.02, sh);
        if (night > 0.0 && y > 0.0) {
          vec3 sp = floor(d * 380.0);
          float st = step(0.9972, h3(sp)) * (0.6 + 0.4 * sin(uTime * 2.0 + h3(sp + 3.0) * 40.0));
          col += vec3(0.9, 0.95, 1.0) * st * night * 2.2 * smoothstep(0.02, 0.3, y) * (1.0 - uOvercast) * uSunVis;
          float md = dot(d, uMoonDir);
          col += vec3(0.9, 0.93, 1.0) * smoothstep(0.99905, 0.9993, md) * 8.0 * night * uSunVis;
          col += vec3(0.25, 0.3, 0.45) * pow(max(md, 0.0), 30.0) * 0.35 * night;
        }
        if (uClouds > 0.0 && y > 0.015) {
          vec2 uv = d.xz / (y + 0.1) * 1.4 + vec2(uTime * 0.006, uTime * 0.0022);
          float c = fbm(uv);
          float cov = mix(0.5, 0.3, uOvercast);
          c = smoothstep(cov, cov + 0.28, c) * smoothstep(0.015, 0.22, y);
          vec3 lit = mix(vec3(1.0, 0.62, 0.38), vec3(1.0, 0.99, 0.97), dayT) * (0.18 + 0.95 * up);
          vec3 ccol = mix(lit, vec3(0.025, 0.03, 0.045), night) * (0.78 + 0.4 * pow(sd, 3.0));
          ccol = mix(ccol, ccol * 0.55, uOvercast);
          col = mix(col, ccol, c * 0.9 * uClouds);
        }
        col = mix(col, vec3(dot(col, vec3(0.33))) * 0.7, uOvercast * 0.6);
        return col;
      }`;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: "varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
      fragmentShader: `varying vec3 vDir;\n${SKY_FN}\nuniform float uHaze; uniform vec3 uFog;\nvoid main() { vec3 d = normalize(vDir); vec3 c = skyColor(d); c = mix(c, uFog * 1.5, uHaze * (1.0 - 0.5 * smoothstep(0.0, 0.7, d.y))); gl_FragColor = vec4(c, 1.0); }`,
    }));
    sky.renderOrder = -1000; sky.frustumCulled = false; sky.scale.setScalar(1500);

    // Horizon colour on the CPU: fog and the haze at the edge of the map match the sky.
    const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    function horizonRGB(sh) {
      const dayT = smooth(-0.04, 0.32, sh), up = smooth(-0.22, 0.04, sh);
      return mixv([0.012, 0.02, 0.045], mixv([1.05, 0.48, 0.2], [0.58, 0.74, 0.92], dayT), up);
    }

    // Image-based light: the sky (without the sun, which is a real light) baked to a PMREM map.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envU = { uSunDir: skyU.uSunDir, uMoonDir: skyU.uMoonDir, uTime: skyU.uTime, uClouds: skyU.uClouds, uOvercast: skyU.uOvercast, uSunVis: { value: 0 } };
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      uniforms: envU, side: THREE.BackSide, depthWrite: false,
      vertexShader: "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `varying vec3 vDir;\n${SKY_FN}\nvoid main() { vec3 d = normalize(vDir); vec3 c = skyColor(d); if (d.y < 0.0) c = mix(c, vec3(0.16, 0.15, 0.13) * (0.12 + 0.88 * smoothstep(-0.2, 0.3, uSunDir.y)), smoothstep(0.0, -0.1, d.y)); c = mix(vec3(dot(c, vec3(0.333))), c, 0.6) * 1.35; gl_FragColor = vec4(c, 1.0); }`,
    })));
    let envRT = null, envHour = -99;
    function updateEnv(hour, force) {
      if (!force && envRT && Math.abs(hour - envHour) < 0.2) return;
      envHour = hour;
      const old = envRT;
      envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
      scene.environment = envRT.texture;
      if (old) old.dispose();
    }

    // ---------------------------------------------------------------------------------------
    // Sun, moon, sky light and time of day (lit tiers)
    const sun = new THREE.DirectionalLight(0xfff1dc, 3);
    const sunTarget = new THREE.Object3D();
    sun.target = sunTarget;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a7a62, 0.25);
    const fog = new THREE.Fog(0xcfdde8, 120, 1400);
    const HAZE = new THREE.Color(0.62, 0.65, 0.68);
    skyU.uHaze = { value: 0 }; skyU.uFog = { value: fog.color };
    const T = { hour: 10.5, sunDir: new V3(), moonDir: new V3(), day: 1, night: 0, dusk: 0, exposure: 1 };
    const NIGHT_U = { value: 0 }, WIND_U = { value: 0 };
    G.night = NIGHT_U; G.wind = WIND_U;
    let Q = PRESETS.light, active = false;
    const lit = () => Q.mode === "lit";
    function setHour(h) {
      h = ((h % 24) + 24) % 24;
      T.hour = h;
      // Sun rises in the east (+x) near 6:00, crosses the southern sky (+z) at noon, sets near 18:30.
      const th = ((h - 6) / 12.5) * Math.PI;
      T.sunDir.set(Math.cos(th), Math.sin(th) * 0.86, Math.sin(th) * 0.5).normalize();
      const mth = th + Math.PI;
      T.moonDir.set(Math.cos(mth), Math.abs(Math.sin(mth)) * 0.7 + 0.15, Math.sin(mth) * 0.4 - 0.2).normalize();
      const el = T.sunDir.y;
      T.day = smooth(-0.04, 0.3, el);
      T.night = 1 - smooth(-0.18, 0.04, el);
      T.dusk = Math.max(0, 1 - Math.abs(el - 0.03) / 0.16);
      skyU.uSunDir.value.copy(T.sunDir);
      skyU.uMoonDir.value.copy(T.moonDir);
      const useMoon = el < -0.02;
      const warm = smooth(0.0, 0.35, el);
      if (useMoon) { sun.color.setRGB(0.55, 0.68, 1.0); sun.intensity = 1.2 * T.night; }
      else { sun.color.setRGB(1.0, 0.62 + 0.33 * warm, 0.38 + 0.52 * warm); sun.intensity = 3.4 * smooth(-0.02, 0.12, el); }
      const wx = G.wx || { cloud: 0, haze: 0 };          // live weather (weather.js): cloud cover 0..1 and haze 0..1
      sun.intensity *= 1 - 0.72 * wx.cloud;
      skyU.uHaze.value = wx.haze;
      hemi.color.setRGB(0.42 + 0.33 * T.day, 0.5 + 0.32 * T.day, 0.68 + 0.27 * T.day);
      hemi.groundColor.setRGB(0.34, 0.3, 0.24);
      hemi.intensity = (0.1 + 0.2 * T.day) * (1 + 0.6 * wx.cloud) + 0.55 * T.night;   // moonlit blue ambient so the map stays readable at night
      const hz = horizonRGB(el);
      if (lit()) { fog.color.setRGB(hz[0] * 0.92, hz[1] * 0.95, hz[2]); if (wx.haze) fog.color.lerp(HAZE, wx.haze * (0.35 + 0.65 * T.day)); }
      T.exposure = 1.0 + 1.1 * T.night + 0.25 * wx.cloud;
      NIGHT_U.value = T.night;
      if (active && lit()) { updateEnv(h, false); A.markDirty(); }
      const s = $("gfx-hour"), t = $("gfx-hour-t");
      if (s && +s.value !== h) s.value = h;
      if (t) t.textContent = String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");
    }

    // The shadow camera follows what you look at, snapped to whole shadow texels so edges do not shimmer.
    const tA = new V3(), tB = new V3(), tC = new V3(), look = new V3();
    function shadowTick(mode) {
      if (!Q.shadow) return;
      const L = T.sunDir.y > -0.02 ? T.sunDir : T.moonDir;
      let R;
      if (mode === "street" || mode === "pick") {
        R = Q.shadowR;
        camera.getWorldDirection(look);
        look.y = 0; look.normalize();
        tA.copy(camera.position).addScaledVector(look, R * 0.45);
        tA.y = A.H(tA.x, tA.z);
      } else {
        const v = A.view;
        R = clamp(v.dist * 0.8, 130, 650);
        tA.set(v.tx, A.H(v.tx, v.tz), v.tz);
      }
      const size = Q.shadow, texel = (2 * R) / size;
      const cam = sun.shadow.camera;
      if (Math.abs(cam.right - R) > 1e-3) { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 2200; cam.updateProjectionMatrix(); }
      const right = tB.set(0, 1, 0).cross(L).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      const up = tC.copy(L).cross(right).normalize();
      const pr = Math.round(tA.dot(right) / texel) * texel, pu = Math.round(tA.dot(up) / texel) * texel, pf = tA.dot(L);
      sunTarget.position.set(right.x * pr + up.x * pu + L.x * pf, right.y * pr + up.y * pu + L.y * pf, right.z * pr + up.z * pu + L.z * pf);
      sun.position.copy(sunTarget.position).addScaledVector(L, 900);
      sunTarget.updateMatrixWorld();
    }
    function setShadowSize(size) {
      if (sun.shadow.map && sun.shadow.mapSize.x !== size) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.mapSize.set(size, size);
      sun.shadow.camera.right = -1; // forces the frustum to be rebuilt on the next tick
    }

    // ---------------------------------------------------------------------------------------
    // Post-processing. Lit tiers: HDR scene -> bloom pyramid -> composite (exposure, ACES, grading, vignette) -> FXAA.
    // Balanced: an 8-bit sRGB scene target -> one pass with FXAA, a gentle grade and a vignette.
    // One full-screen triangle does all the passes.
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quadScene = new THREE.Scene();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri);
    quad.frustumCulled = false;
    quadScene.add(quad);
    const VS = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
    const pass = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    const FXAA_FN = `
      vec3 fxaa(sampler2D tSrc, vec2 vUv, vec2 uTexel) {
        vec3 L = vec3(0.299, 0.587, 0.114);
        vec3 nw = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb, ne = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
        vec3 sw = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb, se = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb, m = texture2D(tSrc, vUv).rgb;
        float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m, L);
        float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
        vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
        float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
        vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
        float lb = dot(b, L);
        return (lb < lmin || lb > lmax) ? a : b;
      }`;
    const downMat = pass(`
      uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uFirst; varying vec2 vUv;
      vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
      void main() {
        vec3 c = (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.25;
        if (uFirst > 0.5) { float l = max(c.r, max(c.g, c.b)); c *= max(l - uThreshold, 0.0) / max(l, 1e-4); c = min(c, vec3(40.0)); }
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uFirst: { value: 0 } });
    const upMat = pass(`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      vec3 s(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
      void main() {
        vec3 c = s(-1.0, -1.0) + 2.0 * s(0.0, -1.0) + s(1.0, -1.0) + 2.0 * s(-1.0, 0.0) + 4.0 * s(0.0, 0.0) + 2.0 * s(1.0, 0.0) + s(-1.0, 1.0) + 2.0 * s(0.0, 1.0) + s(1.0, 1.0);
        gl_FragColor = vec4(c / 16.0, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, transparent: true });
    const compU = {
      tScene: { value: null }, tBloom: { value: null }, tAO: { value: null }, uHasAO: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 0.07 }, uVignette: { value: 0.28 }, uSat: { value: 1.06 }, uContrast: { value: 1.04 },
      uTime: { value: 0 }, uGrain: { value: 0.012 }, uHasBloom: { value: 1 },
    };
    const compMat = pass(`
      uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tAO; uniform float uHasAO, uExposure, uBloom, uVignette, uSat, uContrast, uTime, uGrain, uHasBloom; varying vec2 vUv;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec2 uv = vUv;
        vec3 col = texture2D(tScene, uv).rgb;
        if (uHasAO > 0.5) col *= texture2D(tAO, uv).r;
        if (uHasBloom > 0.5) col += texture2D(tBloom, uv).rgb * uBloom;
        col *= uExposure;
        col = aces(col);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
        float v = smoothstep(0.95, 0.3, length((uv - 0.5) * vec2(1.12, 1.0)));
        col *= mix(1.0 - uVignette, 1.0, v);
        col = srgb(col);
        float n = fract(sin(dot(uv * 943.1 + fract(uTime) * 71.0, vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - 0.5) * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }`, compU);
    const fxaaMat = pass(`
      uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      ${FXAA_FN}
      void main() { gl_FragColor = vec4(fxaa(tSrc, vUv, uTexel), 1.0); }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    // Progressive anti-aliasing (Balanced): each still frame is rendered at sub-pixel offsets and averaged.
    // accMat blends one sample into the running average (alpha = 1 / (n + 1)); presentMat shows the average.
    const accMat = pass(`
      uniform sampler2D tSrc; uniform float uW; varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, uW); }`, { tSrc: { value: null }, uW: { value: 1 } }, { transparent: true, blending: THREE.NormalBlending });
    const presentMat = pass(`
      uniform sampler2D tSrc; varying vec2 vUv;
      vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() { gl_FragColor = vec4(srgb(texture2D(tSrc, vUv).rgb), 1.0); }`, { tSrc: { value: null } });
    // Halton(2,3) offsets in pixels, centred on 0
    const OFFS = [[0.5, 1 / 3], [0.25, 2 / 3], [0.75, 1 / 9], [0.125, 4 / 9], [0.625, 7 / 9], [0.375, 2 / 9], [0.875, 5 / 9], [0.0625, 8 / 9]].map(([x, y]) => [x - 0.5, y - 0.5]);
    const PROG = { n: 0, idle: false };

    let rtScene = null, rtLdr = null, rtAO = null, rtAcc = null, mips = [], rtW = 0, rtH = 0, rtKey = "";
    const size2 = new THREE.Vector2();
    function ensureTargets() {
      renderer.getDrawingBufferSize(size2);
      const w = Math.max(2, size2.x), h = Math.max(2, size2.y), ao = !!(lit() && Q.ssao && G.ssao), key = `${w}x${h}|${Q.mode}|${ao}`;
      if (rtScene && key === rtKey) return;
      [rtScene, rtLdr, rtAO, rtAcc, ...mips].forEach((t) => t && t.dispose());
      rtKey = key; rtW = w; rtH = h; rtLdr = null; rtAO = null; rtAcc = null; mips = []; PROG.n = 0;
      if (!lit()) {
        // 8 bits are enough because the targets are sRGB: the GPU encodes on write and decodes on read
        rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
        rtScene.texture.colorSpace = THREE.SRGBColorSpace;
        rtAcc = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
        rtAcc.texture.colorSpace = THREE.SRGBColorSpace;
        return;
      }
      rtScene = new THREE.WebGLRenderTarget(w, h, { type: HDR, depthBuffer: true });
      if (ao) { rtScene.depthTexture = new THREE.DepthTexture(w, h); rtScene.depthTexture.type = THREE.UnsignedIntType; }
      rtLdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
      rtAO = ao ? new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.UnsignedByteType, depthBuffer: false }) : null;
      let mw = w >> 1, mh = h >> 1;
      for (let i = 0; i < 5 && mw > 4 && mh > 4; i++) { mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: HDR, depthBuffer: false })); mw >>= 1; mh >>= 1; }
    }
    function blit(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }
    function render(r, scn, cam, mode) {
      if (!lit()) {
        // moving: straight to the screen, as cheap as the Light tier. Still: refine by averaging offset frames.
        if (!PROG.idle) { renderer.setRenderTarget(null); renderer.render(scn, cam); return; }
        ensureTargets();
        const prevAuto = renderer.autoClear, k = PROG.n % OFFS.length;
        cam.setViewOffset(rtW, rtH, OFFS[k][0], OFFS[k][1], rtW, rtH);
        renderer.setRenderTarget(rtScene);
        renderer.autoClear = true;
        renderer.render(scn, cam);
        cam.clearViewOffset();
        renderer.autoClear = false;
        accMat.uniforms.tSrc.value = rtScene.texture; accMat.uniforms.uW.value = 1 / (k + 1);
        blit(accMat, rtAcc);
        presentMat.uniforms.tSrc.value = rtAcc.texture;
        blit(presentMat, null);
        renderer.autoClear = prevAuto;
        renderer.setRenderTarget(null);
        PROG.n++;
        return;
      }
      ensureTargets();
      renderer.info.reset();
      const prevAuto = renderer.autoClear;
      renderer.setRenderTarget(rtScene);
      renderer.autoClear = true;
      sky.position.copy(cam.position);
      renderer.render(scn, cam);
      renderer.autoClear = false;
      {
        if (Q.bloom && mips.length) {
          let src = rtScene.texture, sw = rtW, sh = rtH;
          for (let i = 0; i < mips.length; i++) {
            downMat.uniforms.tSrc.value = src; downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh); downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
            blit(downMat, mips[i]);
            src = mips[i].texture; sw = mips[i].width; sh = mips[i].height;
          }
          for (let i = mips.length - 1; i > 0; i--) {
            upMat.uniforms.tSrc.value = mips[i].texture; upMat.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
            blit(upMat, mips[i - 1]);
          }
          compU.tBloom.value = mips[0].texture; compU.uHasBloom.value = 1;
        } else compU.uHasBloom.value = 0;
        if (rtAO && G.ssao) { G.ssao.render(renderer, rtScene.depthTexture, rtAO, cam, quad, quadScene, quadCam); compU.tAO.value = rtAO.texture; compU.uHasAO.value = 1; }
        else compU.uHasAO.value = 0;
        compU.tScene.value = rtScene.texture;
        compU.uExposure.value = T.exposure;
        compU.uTime.value += 0.016;
        blit(compMat, rtLdr);
        fxaaMat.uniforms.tSrc.value = rtLdr.texture; fxaaMat.uniforms.uTexel.value.set(1 / rtW, 1 / rtH);
        blit(fxaaMat, null);
      }
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(null);
    }

    // ---------------------------------------------------------------------------------------
    // Materials of the lit tiers: lit versions of what the Light tier draws unlit, swapped in and out at run time.
    const swaps = [];          // [object, property, original] to undo
    const swap = (o, p, v) => { swaps.push([o, p, o[p]]); o[p] = v; };
    const litOf = new Map();
    // A lit twin of an existing basic or Lambert material.
    function standardFrom(m) {
      if (litOf.has(m)) return litOf.get(m);
      const l = new THREE.MeshStandardMaterial({
        map: m.map || null, vertexColors: m.vertexColors, color: m.color ? m.color.clone() : 0xffffff, side: m.side, transparent: m.transparent, opacity: m.opacity,
        polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits, depthWrite: m.depthWrite, roughness: 0.9, metalness: 0,
      });
      litOf.set(m, l);
      return l;
    }
    const TXS = { lit: null, baked: null };      // painted textures per family
    const TXK = { lit: 0, baked: 0 };            // and the size they were painted at
    let M = null;                                // lit materials
    let token = 0, busy = false;
    async function getTextures(P) {
      const fam = P.mode === "lit" ? "lit" : "baked", my = token;
      if (TXS[fam] && TXK[fam] === P.tex) { for (const t of Object.values(TXS[fam])) for (const k of ["map", "normal", "orm"]) if (t && t[k]) t[k].anisotropy = P.aniso; return true; }
      const fresh = G.makeTextures ? await G.makeTextures(P.tex, P.aniso, { albedoOnly: fam === "baked" }) : null;
      if (my !== token) return false;               // the choice changed while the textures were being painted
      if (TXS[fam]) for (const t of Object.values(TXS[fam])) for (const k of ["map", "normal", "orm"]) if (t && t[k]) t[k].dispose();
      TXS[fam] = fresh; TXK[fam] = P.tex;
      if (fam === "lit") buildLitMaterials();
      return true;
    }
    function buildLitMaterials() {
      if (M) for (const m of Object.values(M)) if (m && m.dispose) m.dispose();
      const TX = TXS.lit;
      const std = (o) => new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, ...o });
      const pbr = (t, o = {}) => (t ? std({ map: t.map, normalMap: t.normal, roughnessMap: t.orm, metalnessMap: t.orm, normalScale: new THREE.Vector2(1, 1), ...o }) : std({ roughness: 0.9, metalness: 0, ...o }));
      M = {};
      M.facade = pbr(TX && TX.facade, { vertexColors: true });
      M.house = pbr(TX && TX.house, { vertexColors: true });
      M.shed = pbr(TX && TX.shed, { vertexColors: true, side: THREE.DoubleSide });
      M.roof = pbr(TX && TX.roof, { vertexColors: true, side: THREE.DoubleSide });
      M.extra = std({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      M.tank = std({ color: 0x26282b, roughness: 0.55, metalness: 0.35 });
      M.lamp = std({ color: 0x8e949a, roughness: 0.45, metalness: 0.75 });
      M.road = {};
      for (const k of ["major", "minor", "dirt", "path"]) {
        const t = TX && TX[k];
        M.road[k] = (t ? std({ map: t.map, normalMap: t.normal, roughnessMap: t.orm, metalnessMap: t.orm, vertexColors: true }) : std({ map: A.TEX[k], vertexColors: true, roughness: 0.9, metalness: 0 }));
        Object.assign(M.road[k], { color: new THREE.Color(0xd8d8d8), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      }
      M.water = std({ vertexColors: true, roughness: 0.06, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, envMapIntensity: 1.4 });
      glowWindows(M.facade); glowWindows(M.house);
      for (const m of [M.facade, M.house, M.shed, M.roof, M.extra]) m.envMapIntensity = 0.9;
    }
    // Lit windows at night: the glass texels of the facade tiles glow, a random subset per window.
    function glowWindows(mat) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = NIGHT_U;
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;")
          .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          #ifdef USE_MAP
          { float lum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            float win = smoothstep(0.012, 0.004, lum);
            vec2 cell = floor(vMapUv + 0.001);
            float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
            vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.78, 0.88, 1.0), step(0.86, h));
            totalEmissiveRadiance += warm * win * step(0.5, h) * uNight * 2.4; }
          #endif`);
      };
      mat.customProgramCacheKey = () => "glowWindows";
    }
    let origMAT = null, origRoadMat = null;
    function eachMesh(group, fn) { group.traverse((o) => { if (o.isMesh) fn(o); }); }
    function swapIn() {
      const ground = A.ground();
      if (!origMAT) origMAT = { ...A.MAT };
      origRoadMat = { ...A.ROAD_MAT };
      Object.assign(A.MAT, { facade: M.facade, house: M.house, shed: M.shed, roof: M.roof, extra: M.extra, tank: M.tank });
      for (const k in M.road) {
        if (A.ROAD_MAT[k]) { const litM = M.road[k]; eachMesh(C.groups.roads, (o) => { if (o.material === A.ROAD_MAT[k]) swap(o, "material", litM); }); A.ROAD_MAT[k] = litM; }
      }
      eachMesh(C.groups.roads, (o) => { if (o.material.isMeshLambertMaterial) { swap(o, "material", standardFrom(o.material)); } o.receiveShadow = true; });
      eachMesh(C.groups.water, (o) => { swap(o, "material", M.water); o.receiveShadow = false; });
      for (const g of [C.groups.lights, C.groups.misc]) eachMesh(g, (o) => { if (o.material.isMeshLambertMaterial && o.material !== A.lampMat) swap(o, "material", standardFrom(o.material)); o.receiveShadow = true; });
      const ter = A.terrain();
      if (ter) {
        if (!G.terrainMat) G.terrainMat = G.makeGround ? G.makeGround(A, TXS.lit, Q) : new THREE.MeshStandardMaterial({ map: ground.satTex, roughness: 1, metalness: 0 });
        G.terrainMat.map = ground.mat.map;
        swap(ter, "material", G.terrainMat);
        ter.receiveShadow = true;
      }
    }
    function swapOut() {
      for (let i = swaps.length - 1; i >= 0; i--) { const [o, p, v] = swaps[i]; o[p] = v; }
      swaps.length = 0;
      if (origMAT) Object.assign(A.MAT, origMAT);
      if (origRoadMat) Object.assign(A.ROAD_MAT, origRoadMat);
      for (const g of [C.groups.roads, C.groups.water, C.groups.lights, C.groups.misc]) eachMesh(g, (o) => { o.receiveShadow = false; });
      const ter = A.terrain(); if (ter) ter.receiveShadow = false;
    }
    // The ground picker (satellite or land cover) still works while lit.
    document.querySelectorAll("input[name=ground]").forEach((r) => r.addEventListener("change", () => {
      if (active && lit() && G.terrainMat) { G.terrainMat.map = A.ground().mat.map; G.terrainMat.needsUpdate = true; A.markDirty(); }
    }));

    // ---------------------------------------------------------------------------------------
    // Switching tiers
    const hooks = {
      render,
      get lampMat() { return lit() && M ? M.lamp : null; },
      frame(dt, mode, moving, changed) {
        skyU.uTime.value += dt;
        WIND_U.value += dt;
        if (lit()) {
          shadowTick(mode);
          if (G.nature) G.nature.frame(dt, mode, camera);
        } else if (G.baked) G.baked.frame(dt, mode, camera);
        if (mode === "street" || mode === "pick") { fog.near = lit() ? 70 : 140; fog.far = lit() ? 1250 : 1100; }
        else { const d = A.view.dist; fog.near = Math.max(1800, d * 2.4); fog.far = Math.max(9000, d * 10); }
        const wx = G.wx;
        if (wx && wx.fogMul < 1) {
          let m = wx.fogMul;
          if (!(mode === "street" || mode === "pick")) m = 1 - (1 - m) * clamp(1 - A.view.dist / 1500, 0, 1);
          fog.near *= m; fog.far *= m;
        }
        // Slow GPUs: if the tier was chosen automatically and motion is choppy, step down once.
        if (!explicit && moving) {
          perf.t += dt; perf.avg = perf.avg * 0.96 + dt * 0.04;
          if (perf.t > 3 && perf.avg > 0.056) { perf.t = 0; perf.avg = 0.016; stepDown(); }
        }
        // Ambient motion (clouds, leaves) keeps the picture alive at about 20 fps when nothing else moves.
        if (Q.ambient && (mode === "street") && !moving) { perf.acc += dt; if (perf.acc > 0.05) { perf.acc = 0; return true; } }
        // Balanced: once the picture has been still for a frame, keep refining it until all samples are in.
        if (Q.samples) {
          if (changed) { PROG.n = 0; PROG.idle = false; }
          else if (PROG.n < Q.samples) { PROG.idle = true; return true; }
          else PROG.idle = false;
        }
        return false;
      },
      fog() { return fog; },
      mode() { A.markDirty(); },
      setNight(on) {
        if (!lit()) return false;
        if (on) { if (!T.saved) T.saved = T.hour; setHour(23); }
        else if (T.saved != null) { setHour(T.saved); T.saved = null; }
        return true;
      },
    };
    const perf = { t: 0, avg: 0.016, acc: 0 };
    function stepDown() {
      const next = ORDER[Math.max(0, ORDER.indexOf(Q.name) - 1)];
      A.toast("Graphics lowered to " + PRESETS[next].label + " to keep movement smooth. Change it in Layers > Graphics.");
      setQuality(next, false);
    }
    // Turn on the machinery shared by Balanced and the lit tiers (the render hooks), then each tier's own parts.
    function hookOn() {
      if (active) return;
      if (!G.stdTreeKit) G.stdTreeKit = { near: { ...A.TREEKIT.near }, mid: { ...A.TREEKIT.mid } };
      A.setHooks(hooks);
      active = true;
    }
    function litOn() {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sun.castShadow = true;
      A.lights.sun.visible = false; A.lights.hemi.visible = false;
      scene.add(sky, sun, sunTarget, hemi);
      document.body.classList.add("hq");
      renderer.info.autoReset = false;
      swapIn();
      A.setLit(true);
    }
    function litOff() {
      swapOut();
      A.setTreeKit(G.stdTreeKit);
      if (G.nature) G.nature.disable();
      A.setLit(false);
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      scene.remove(sky, sun, sunTarget, hemi);
      scene.environment = null;
      A.lights.sun.visible = true; A.lights.hemi.visible = true;
      renderer.info.autoReset = true;
      document.body.classList.remove("hq");
    }
    function bakedOn() {
      PROG.n = 0; PROG.idle = false;
      document.body.classList.add("gfx-baked");
      fog.color.copy(G.baked.horizon);
      G.baked.enable(C, Q, TXS.baked);
    }
    function bakedOff() {
      G.baked.disable();
      A.setTreeKit(G.stdTreeKit);
      document.body.classList.remove("gfx-baked");
    }
    function hookOff() {
      A.setHooks(null);
      renderer.info.autoReset = true;
      PROG.idle = false;
      active = false;
      scene.fog = A.mode() === "street" ? new THREE.Fog(A.SKY, 140, 1100) : null;
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
    }
    function refreshMaterials() { scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); }
    async function setQuality(name, remember = true) {
      name = ALIAS[name] || name;
      if (!PRESETS[name]) return;
      const my = ++token;
      if (remember) { explicit = true; store.set(KEY, name); }
      const next = PRESETS[name], was = Q;
      if (next.mode === "light") {
        if (active) { if (was.mode === "lit") litOff(); else if (was.mode === "baked") bakedOff(); hookOff(); refreshMaterials(); }
        Q = next;
        A.setBaseScale(Math.min(window.devicePixelRatio || 1, 1.25));
        syncUI();
        return;
      }
      // Paint what the tier needs first (a second or two) while the picture keeps working as it was.
      const fam = next.mode === "lit" ? "lit" : "baked";
      if (!TXS[fam] || TXK[fam] !== next.tex) { busy = next; syncUI(); }
      const ok = await getTextures(next);
      if (ok && next.mode === "baked" && G.baked) { await G.baked.prepare(C, next); if (my !== token) return; }
      busy = false;
      if (!ok || my !== token) { if (my === token) syncUI(); return; }
      // leave the old tier's parts, enter the new tier's
      if (active && (was.mode !== next.mode || (was.mode === "lit" && was.tex !== next.tex))) {
        if (was.mode === "lit") litOff(); else if (was.mode === "baked") bakedOff();
      }
      const switching = !active || was.mode !== next.mode || (was.mode === "lit" && was.tex !== next.tex);
      Q = next;
      hookOn();
      if (next.mode === "lit") {
        if (switching) litOn();
        setShadowSize(Q.shadow);
        updateEnv(T.hour, true);
        setHour(T.hour);
        if (G.nature) G.nature.enable(C, Q, TXS.lit);
        scene.fog = fog;
      } else {
        if (switching) bakedOn(); else { G.baked.enable(C, Q, TXS.baked); }
        scene.fog = fog;
        fog.color.copy(G.baked.horizon);
      }
      A.setBaseScale(Math.min(window.devicePixelRatio || 1, Q.scale));
      refreshMaterials();
      syncUI();
      A.markDirty();
    }

    // ---------------------------------------------------------------------------------------
    // Settings in the Layers tab
    function buildUI() {
      const st = document.createElement("style");
      st.textContent = `#gfx-box { margin-top: 6px; }
        #gfx-box .seg { width: 100%; } #gfx-box .seg button { flex: 1; padding-left: 4px; padding-right: 4px; }
        #gfx-hourrow { display: none; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; margin: 10px 2px 2px; font-size: 12.5px; }
        body.hq #gfx-hourrow { display: grid; }
        #gfx-hourrow input { width: 100%; accent-color: var(--accent); }
        #gfx-hour-t { font-family: var(--font-data); font-size: 12px; color: var(--ink-2); min-width: 40px; text-align: right; }`;
      document.head.appendChild(st);
      const pane = $("pane-layers");
      if (!pane) return;
      const box = document.createElement("div");
      box.id = "gfx-box";
      box.innerHTML = `<h3>Graphics</h3>
        <div class="seg" id="gfx-seg" role="group" aria-label="Graphics quality">${ORDER.map((k) => `<button data-q="${k}" aria-pressed="false">${PRESETS[k].label}</button>`).join("")}</div>
        <p class="note" id="gfx-note"></p>
        <div id="gfx-hourrow"><span>Time of day</span><input type="range" id="gfx-hour" min="5" max="22" step="0.25" value="10.5" aria-label="Time of day"><span id="gfx-hour-t"></span></div>`;
      pane.insertBefore(box, pane.firstChild);
      box.querySelectorAll("#gfx-seg button").forEach((b) => b.addEventListener("click", () => setQuality(b.dataset.q)));
      $("gfx-hour").addEventListener("input", (e) => { T.saved = null; setHour(+e.target.value); });
    }
    function syncUI() {
      document.querySelectorAll("#gfx-seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.q === Q.name));
      const n = $("gfx-note");
      if (n && busy) n.textContent = "Painting the " + busy.label + " textures, one moment...";
      else if (n) n.textContent = NOTES[Q.name] + (Q.mode !== "light" && gpuLabel() ? " GPU: " + gpuLabel() + "." : "");
      const s = $("gfx-hour"); if (s) s.value = T.hour;
    }
    buildUI();
    setHour(T.hour);
    // Weather changed the sky: redo the sun and sky light, and bake the sky light again.
    function applySky() { setHour(T.hour); if (active && lit()) updateEnv(T.hour, true); A.markDirty(); }
    G.api = { applySky, setQuality, setHour, state: T, quality: () => Q.name, materials: () => M, textures: () => TXS, sky, sun, hemi, fog, GPU, scene, presets: PRESETS, prog: PROG };
    setQuality(wanted, false);
    syncUI();
  }

  if (window.__campus && window.__campus.gfx) boot(window.__campus);
  else window.addEventListener("campus:ready", () => boot(window.__campus), { once: true });
})();
