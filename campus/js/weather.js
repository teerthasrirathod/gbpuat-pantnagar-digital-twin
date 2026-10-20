/* Campus 3D: live weather.
   Six model points (Pantnagar plus five about 25 km away) come from Open-Meteo, either from a file stored by the
   scheduled job (tools/fetch_weather.mjs, .github/workflows/weather.yml) or straight from the API. The page then
   simulates the weather itself, like a game engine:
   - values are interpolated in time (hourly data to the second) and in space (inverse-distance blend of the six points),
   - smoothed, so nothing pops when you scrub the time,
   - and drive the sky and cloud cover, sun position, fog, rain streaks, wet surfaces and wind sway.
   Everything is a model estimate (ECMWF, 9 km grid), not a station observation. It works offline: the last good data is
   cached in the browser, and without it a typical month (IMD 1991-2020 normals) is used. */
(function () {
  "use strict";
  const G = (window.__gfx = window.__gfx || {});
  const KEY = "gbpuat-campus:weather:v1";
  const FILE_URL = "https://raw.githubusercontent.com/teerthasrirathod/gbpuat-pantnagar-digital-twin/weather-data/latest.json";
  const OM = "https://api.open-meteo.com/v1/forecast";
  const LAT0 = 29.0205, LON0 = 79.4935, M_LAT = 110540, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const IST = 5.5 * 3600e3, HOUR = 3600e3;
  // Pantnagar and five points on a ring about 25 km out: the foothills to the north and the four other sides.
  const POINTS = [
    { id: "pantnagar", name: "Pantnagar", lat: 29.0205, lon: 79.4935 },
    { id: "n", name: "North (foothills)", lat: 29.2467, lon: 79.4935 },
    { id: "ene", name: "East-north-east", lat: 29.0904, lon: 79.7378 },
    { id: "sse", name: "South-south-east", lat: 28.837, lon: 79.6445 },
    { id: "ssw", name: "South-south-west", lat: 28.837, lon: 79.3425 },
    { id: "wnw", name: "West-north-west", lat: 29.0904, lon: 79.2492 },
  ];
  const CURRENT = "temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
  const HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation", "weather_code", "cloud_cover", "visibility", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "wind_speed_850hPa", "wind_direction_850hPa", "shortwave_radiation", "et0_fao_evapotranspiration", "soil_moisture_9_to_27cm"];
  // IMD 1991-2020 normals for Pantnagar: [Tmin, Tmax, rain mm]. Used only when there is no live or cached data.
  const NORMALS = [[5.5, 19.6, 28], [7.7, 24.0, 34.6], [11.5, 29.2, 22.4], [16.0, 34.9, 15], [21.0, 36.7, 46.4], [24.3, 35.8, 180], [25.3, 33.0, 398], [25.0, 32.6, 412], [23.1, 32.5, 264], [16.9, 31.0, 30], [10.3, 27.4, 3.1], [6.2, 22.6, 11.6]];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);
  const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const WMO = (c) => (c === 0 ? "Clear" : c <= 2 ? "Partly cloudy" : c === 3 ? "Overcast" : c === 45 || c === 48 ? "Fog" : c <= 57 ? "Drizzle" : c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Rain showers" : c <= 86 ? "Snow showers" : "Thunderstorm");
  const ICON = (c, day) => (c >= 95 ? "⛈" : c >= 51 && c <= 82 ? "🌧" : c === 45 || c === 48 ? "🌫" : c === 3 ? "☁" : c >= 1 ? (day ? "⛅" : "☁") : day ? "☀" : "☾");

  function boot(C) {
    const A = C.gfx, scene = C.scene;
    const GA = () => G.api;
    const W = (G.wx = { cloud: 0, fogMul: 1, haze: 0, wet: 0, rain: 0, windAmp: 1 });
    G.windAmp = G.windAmp || { value: 1 };

    // ---------------------------------------------------------------------------------------
    // Data
    let data = null;           // { points: [{ ...POINTS[i], elevation, times[], s: { name: Float32Array } }], kind, fetchedAt }
    function normalise(raw, kind, fetchedAt) {
      const arr = Array.isArray(raw) ? raw : raw.points;
      if (!arr || arr.length < 1) throw new Error("no points");
      const points = arr.map((p, i) => {
        const h = p.hourly, times = h.time.map((s) => Date.parse(s + "+05:30"));
        const s = {};
        for (const k of HOURLY) if (h[k]) s[k] = Float32Array.from(h[k], (v) => (v == null ? NaN : v));
        return { ...POINTS[i], elevation: p.elevation, times, s, current: p.current || null };
      });
      return { points, kind, fetchedAt: fetchedAt || Date.now(), generatedAt: raw.generatedAt ? Date.parse(raw.generatedAt) : null };
    }
    function typical() {
      const now = new Date(Date.now() + IST), mo = now.getUTCMonth(), [tn, tx] = NORMALS[mo];
      const t0 = Math.floor(Date.now() / HOUR) * HOUR - 48 * HOUR, n = 120, times = [], s = {};
      for (const k of HOURLY) s[k] = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * HOUR, h = new Date(t + IST).getUTCHours();
        times.push(t);
        s.temperature_2m[i] = tn + (tx - tn) * (0.5 + 0.5 * Math.sin(((h - 9) / 24) * 2 * Math.PI));
        s.relative_humidity_2m[i] = 60; s.precipitation[i] = 0; s.weather_code[i] = 1; s.cloud_cover[i] = 25;
        s.wind_speed_10m[i] = 6; s.wind_direction_10m[i] = 270; s.wind_gusts_10m[i] = 12; s.wind_speed_850hPa[i] = 10; s.wind_direction_850hPa[i] = 270;
        s.visibility[i] = (mo === 11 || mo === 0) && h >= 3 && h <= 9 ? 700 : 10000; // dawn fog in December and January
        s.shortwave_radiation[i] = Math.max(0, 700 * Math.sin(((h - 6) / 12) * Math.PI)); s.et0_fao_evapotranspiration[i] = 0.2; s.soil_moisture_9_to_27cm[i] = NaN;
      }
      return { points: POINTS.map((p) => ({ ...p, elevation: null, times, s, current: null })), kind: "typical", fetchedAt: Date.now(), generatedAt: null };
    }
    const omUrl = () => `${OM}?latitude=${POINTS.map((p) => p.lat).join(",")}&longitude=${POINTS.map((p) => p.lon).join(",")}&timezone=Asia/Kolkata&past_days=2&forecast_days=3&wind_speed_unit=kmh&current=${CURRENT}&hourly=${HOURLY.join(",")}`;
    async function getJSON(url, ms = 25000) {   // generous: the page is busy painting textures when it starts
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
      try { const r = await fetch(url, { signal: ctl.signal, cache: "no-cache" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); } finally { clearTimeout(t); }
    }
    const store = {
      read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
      write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
    };
    let loading = false;
    async function load(force) {
      if (loading) return;
      loading = true;
      try {
        const cached = store.read();
        if (!data && cached && Date.now() - cached.fetchedAt < 7 * 24 * HOUR) { try { data = normalise(cached.raw, "cache", cached.fetchedAt); } catch (e) { /* bad cache */ } }
        if (!data) { data = typical(); }
        syncUI();
        let raw = null, kind = "live";
        // 1. the file stored by the scheduled job, if it is recent
        try {
          const f = await getJSON(FILE_URL);
          if (f && f.generatedAt && Date.now() - Date.parse(f.generatedAt) < 4 * HOUR) { raw = f; kind = "stored"; }
        } catch (e) { lastErr.stored = String(e); }
        // 2. otherwise straight from Open-Meteo
        if (!raw) { try { raw = await getJSON(omUrl()); kind = "live"; } catch (e) { raw = null; lastErr.direct = String(e); } }
        if (raw) {
          const d = normalise(raw, kind, Date.now());
          data = d;
          store.write({ fetchedAt: d.fetchedAt, raw });
        }
      } catch (e) { lastErr.load = String(e); console.warn("[weather]", e); }
      loading = false;
      // after a failure try again in about two minutes, after a success in thirty
      lastRefresh = data && data.kind !== "typical" && data.kind !== "cache" ? Date.now() : Date.now() - 28 * 60e3;
      tick(true);
      syncUI();
    }
    let lastRefresh = 0;
    const lastErr = {};

    // ---------------------------------------------------------------------------------------
    // Sampling: time (hourly data, linear) and space (inverse-distance blend of the six points)
    function at(pt, k, t) {
      const a = pt.s[k], n = pt.times.length;
      if (!a) return NaN;
      if (t <= pt.times[0]) return a[0];
      if (t >= pt.times[n - 1]) return a[n - 1];
      const i = Math.floor((t - pt.times[0]) / HOUR), f = (t - pt.times[i]) / HOUR, x = a[i], y = a[i + 1];
      return Number.isNaN(x) ? y : Number.isNaN(y) ? x : x + (y - x) * f;
    }
    function atDir(pt, k, t) {
      const i = Math.floor((t - pt.times[0]) / HOUR), a = pt.s[k], n = pt.times.length;
      if (!a) return 0;
      const j = clamp(i, 0, n - 2), f = clamp((t - pt.times[j]) / HOUR, 0, 1), r = Math.PI / 180;
      const x = Math.sin(a[j] * r) * (1 - f) + Math.sin(a[j + 1] * r) * f, y = Math.cos(a[j] * r) * (1 - f) + Math.cos(a[j + 1] * r) * f;
      return ((Math.atan2(x, y) / r) + 360) % 360;
    }
    // Weights for a position in local metres (x east, z south of the campus origin).
    function weights(x, z) {
      const lat = LAT0 - z / M_LAT, lon = LON0 + x / M_LON, w = [];
      let sum = 0;
      for (const p of data.points) {
        const d = Math.hypot((p.lat - lat) * 110.54, (p.lon - lon) * 97.3); // km
        const wi = 1 / Math.pow(d + 3, 2);
        w.push(wi); sum += wi;
      }
      return w.map((v) => v / sum);
    }
    function blend(k, t, w) { let s = 0, ws = 0; data.points.forEach((p, i) => { const v = at(p, k, t); if (!Number.isNaN(v)) { s += v * w[i]; ws += w[i]; } }); return ws ? s / ws : NaN; }
    // How wet the ground is at time t: rain over the last 12 hours, each hour counting less (decay of about 4 hours).
    function wetAt(pt, t) {
      let sum = 0;
      for (let k = 0; k <= 12; k++) { const r = at(pt, "precipitation", t - k * HOUR); if (r > 0) sum += r * Math.exp(-k / 4); }
      return 1 - Math.exp(-0.35 * sum);
    }

    // ---------------------------------------------------------------------------------------
    // The clock: now, or whatever the slider says
    const clock = { offsetH: 0, live: true };
    const nowT = () => Date.now() + clock.offsetH * HOUR;
    const hourIST = (t) => { const d = new Date(t + IST); return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; };
    const fmtTime = (t) => { const d = new Date(t + IST); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] + " " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };

    // ---------------------------------------------------------------------------------------
    // Simulation state (what is drawn). Targets come from the data; the rendered values ease toward them.
    const S = { on: true, followSun: true, override: null };
    // Preview a weather situation from the address: #wx=rain, storm, fog, clear or night (the real data is ignored).
    const PREVIEWS = {
      rain: { cloud: 0.95, rain: 6, vis: 2500, wind: 24, windDir: 250, wet: 0.9, temp: 24, hum: 92, code: 63, day: true, hour: 15, gust: 38, et0: 0.1, soil: 0.4 },
      storm: { cloud: 1, rain: 22, vis: 1200, wind: 42, windDir: 280, wet: 1, temp: 26, hum: 95, code: 95, day: true, hour: 17, gust: 70, et0: 0.05, soil: 0.45 },
      fog: { cloud: 0.5, rain: 0, vis: 300, wind: 3, windDir: 300, wet: 0.2, temp: 9, hum: 98, code: 45, day: true, hour: 8, gust: 5, et0: 0, soil: 0.5 },
      clear: { cloud: 0.05, rain: 0, vis: 10000, wind: 8, windDir: 290, wet: 0, temp: 27, hum: 45, code: 0, day: true, hour: 11, gust: 14, et0: 0.4, soil: 0.25 },
      night: { cloud: 0.1, rain: 0, vis: 9000, wind: 5, windDir: 290, wet: 0, temp: 18, hum: 80, code: 0, day: false, hour: 23, gust: 9, et0: 0, soil: 0.3 },
    };
    { const m = location.hash.match(/wx=(rain|storm|fog|clear|night)/); if (m) S.override = { ...PREVIEWS[m[1]] }; }
    const tgt = { cloud: 0, rain: 0, vis: 10000, wind: 0, windDir: 270, wet: 0, temp: 0, hum: 0, code: 0, day: true, hour: 12, gust: 0, rh: 0, et0: NaN, soil: NaN, press: NaN };
    const cur = { cloud: 0, rain: 0, fogMul: 1, wind: 0, wet: 0 };
    function target(t) {
      if (S.override) { Object.assign(tgt, S.override); return; }
      const cam = C.camera.position, w = weights(cam.x, cam.z), p0 = data.points[0];
      tgt.temp = at(p0, "temperature_2m", t); tgt.hum = at(p0, "relative_humidity_2m", t); tgt.code = Math.round(at(p0, "weather_code", t));
      tgt.cloud = clamp(blend("cloud_cover", t, w) / 100, 0, 1);
      tgt.rain = Math.max(0, blend("precipitation", t, w));
      tgt.vis = Math.max(100, blend("visibility", t, w) || 10000);
      tgt.wind = blend("wind_speed_10m", t, w); tgt.windDir = atDir(p0, "wind_direction_10m", t); tgt.gust = at(p0, "wind_gusts_10m", t);
      tgt.wet = wetAt(p0, t);
      tgt.et0 = at(p0, "et0_fao_evapotranspiration", t); tgt.soil = at(p0, "soil_moisture_9_to_27cm", t);
      tgt.hour = hourIST(t);
      const sw = at(p0, "shortwave_radiation", t); tgt.day = sw > 5 || (tgt.hour > 6.5 && tgt.hour < 17.5);
      if (tgt.rain > 0.1) tgt.cloud = Math.max(tgt.cloud, 0.85);
    }

    // ---------------------------------------------------------------------------------------
    // Rain: short streaks that fall in a box around the camera, slanted by the wind
    const N_RAIN = 2600, BOX = 46, HT = 30;
    const rainU = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uDensity: { value: 0 }, uWind: { value: new THREE.Vector2() }, uOpacity: { value: 0.4 } };
    const rain = (() => {
      const seed = new Float32Array(N_RAIN * 2 * 4), end = new Float32Array(N_RAIN * 2), pos = new Float32Array(N_RAIN * 2 * 3);
      let s = 1234567;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < N_RAIN; i++) {
        const a = rnd(), b = rnd(), c = rnd(), d = rnd();
        for (let k = 0; k < 2; k++) { const j = i * 2 + k; seed.set([a, b, c, d], j * 4); end[j] = k; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
      g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: rainU, transparent: true, depthWrite: false, fog: false,
        vertexShader: `
          attribute vec4 aSeed; attribute float aEnd;
          uniform vec3 uCam; uniform float uTime, uDensity; uniform vec2 uWind;
          varying float vA;
          void main() {
            if (aSeed.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
            float fall = 9.0, len = 1.1 + 0.9 * aSeed.z;
            vec2 w = aSeed.xz * ${BOX.toFixed(1)};
            vec2 rel = mod(w - uCam.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
            float y = mod(aSeed.y * ${HT.toFixed(1)} - uTime * fall, ${HT.toFixed(1)}) - ${(HT * 0.45).toFixed(1)};
            vec3 p = vec3(uCam.x + rel.x, uCam.y + y, uCam.z + rel.y);
            p.xz += uWind * (aEnd * len / fall + y / fall * 0.0);
            p.y += aEnd * len;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = length(rel);
            vA = (1.0 - smoothstep(14.0, ${(BOX / 2).toFixed(1)}, d)) * smoothstep(0.4, 1.5, -mv.z);
          }`,
        fragmentShader: `uniform float uOpacity; varying float vA; void main() { if (vA < 0.02) discard; gl_FragColor = vec4(0.78, 0.84, 0.92, vA * uOpacity); }`,
      });
      const l = new THREE.LineSegments(g, m);
      l.frustumCulled = false; l.renderOrder = 20; l.visible = false; l.name = "rain";
      l.onBeforeRender = (r, sc, cam) => { rainU.uCam.value.copy(cam.position); };
      scene.add(l);
      return l;
    })();

    // ---------------------------------------------------------------------------------------
    // Surfaces get darker and glossier when wet
    function applyWet(wet) {
      const mats = new Set();
      for (const m of Object.values(A.ROAD_MAT)) mats.add(m);
      for (const k of ["facade", "house", "shed", "roof", "extra"]) if (A.MAT[k]) mats.add(A.MAT[k]);
      const g = A.ground(); if (g && g.mat) mats.add(g.mat);
      const t = A.terrain(); if (t && t.material) mats.add(t.material);
      for (const m of mats) {
        if (!m.color) continue;
        const b = m.userData.wx0 || (m.userData.wx0 = { c: m.color.clone(), r: m.roughness });
        const road = Object.values(A.ROAD_MAT).includes(m);
        m.color.copy(b.c).multiplyScalar(1 - (road ? 0.32 : 0.16) * wet);
        if (m.isMeshStandardMaterial) m.roughness = b.r * (1 - 0.45 * wet);
      }
    }
    // For tiers without lighting the picture is dimmed by a thin overlay when it is overcast, rainy or foggy.
    const tint = document.createElement("div");
    tint.id = "wx-tint";
    document.body.appendChild(tint);

    // ---------------------------------------------------------------------------------------
    // Apply the rendered values to the scene
    let last = { cloudSky: -1, hour: -99, wet: -1, quality: "" };
    let lastTick = performance.now();
    function tick(force) {
      if (!data) return;
      const nowMs = performance.now(), dt = Math.min(5, (nowMs - lastTick) / 1000);
      lastTick = nowMs;
      const q = (GA() && GA().quality()) || "light", lit = q === "high" || q === "ultra";
      if (!S.on) { // weather switched off: neutral clear day
        Object.assign(tgt, { cloud: 0.12, rain: 0, vis: 10000, wind: 6, wet: 0 });
      } else target(nowT());
      const k = force || clock.jump ? 1 : 1 - Math.exp(-dt / 5);
      clock.jump = false;
      cur.cloud += (tgt.cloud - cur.cloud) * k; cur.rain += (tgt.rain - cur.rain) * k; cur.wet += (tgt.wet - cur.wet) * k; cur.wind += (tgt.wind - cur.wind) * k;
      cur.fogMul += (clamp(tgt.vis / 10000, 0.04, 1) - cur.fogMul) * k;
      W.cloud = cur.cloud; W.fogMul = cur.fogMul; W.haze = clamp((1 - cur.fogMul) * 0.7 + cur.cloud * 0.15, 0, 0.8); W.rain = cur.rain; W.wet = cur.wet;
      W.windAmp = clamp(0.35 + cur.wind / 18, 0.3, 3); G.windAmp.value = W.windAmp;
      const mode = A.mode(), street = mode === "street" || mode === "pick";
      // sky and sun (lit tiers)
      if (lit && GA()) {
        const sky = GA().sky.material.uniforms;
        sky.uOvercast.value = clamp(cur.cloud * 0.9, 0, 0.95); sky.uClouds.value = clamp(0.08 + cur.cloud * 0.95, 0, 1);
        const hr = S.followSun && S.on ? tgt.hour : null;
        if (hr != null && Math.abs(hr - last.hour) > 0.02) { last.hour = hr; GA().setHour(hr); }
        else if (Math.abs(cur.cloud - last.cloudSky) > 0.06 || force || last.quality !== q) { GA().applySky(); }
        if (Math.abs(cur.cloud - last.cloudSky) > 0.06) last.cloudSky = cur.cloud;
      }
      // fog without the lit pipeline (Light draws its own fog only in street view)
      if (q === "light" && scene.fog && scene.fog.isFog) { scene.fog.near = 140 * cur.fogMul; scene.fog.far = 1100 * cur.fogMul; }
      // tint overlay for the unlit tiers
      const dim = clamp(cur.cloud * 0.16 + Math.min(1, cur.rain / 4) * 0.1 + (1 - cur.fogMul) * 0.1 + (tgt.day ? 0 : 0.3), 0, 0.5);
      tint.style.opacity = !lit && S.on && mode !== "plan" ? String(dim) : "0";   // Plan keeps its analysis colours
      // rain
      const dens = clamp(Math.sqrt(cur.rain / 8), 0, 1);
      rainU.uDensity.value = dens;
      rainU.uOpacity.value = 0.22 + 0.3 * dens;
      const rad = ((cur.wind > 0 ? tgt.windDir + 180 : 0) * Math.PI) / 180, ws = cur.wind / 3.6;
      rainU.uWind.value.set(Math.sin(rad) * ws * 0.6, -Math.cos(rad) * ws * 0.6);
      rain.visible = street && dens > 0.02 && S.on;
      if (Math.abs(cur.wet - last.wet) > 0.015 || last.quality !== q) { applyWet(cur.wet); last.wet = cur.wet; }
      last.quality = q;
      // the painted sky of the Balanced tier takes the fog when it is thick
      if (G.baked && G.baked.sky) { const sm = G.baked.sky.material, f = W.haze > 0.2 && S.on; if (sm.fog !== f) { sm.fog = f; sm.needsUpdate = true; } }
      A.markDirty();
      if (nowMs - lastUI > 1000) { lastUI = nowMs; syncUI(); }
    }
    let lastUI = 0;
    // keep the rain moving: a redraw about 15 times a second while it rains in street view
    setInterval(() => {
      if (document.hidden) return;
      rainU.uTime.value = performance.now() / 1000;
      const mode = A.mode();
      if (rain.visible && (mode === "street" || mode === "pick")) A.markDirty();
    }, 66);
    setInterval(() => { if (!document.hidden) tick(false); }, 500);
    setInterval(() => { if (!document.hidden && Date.now() - lastRefresh > 30 * 60e3) load(); }, 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastRefresh > 30 * 60e3) load(); });

    // ---------------------------------------------------------------------------------------
    // Interface: a small readout and a Weather section in the Layers tab
    let hud = null;
    const st = document.createElement("style");
    st.textContent = `
      #wx-tint { position: fixed; inset: 0; pointer-events: none; z-index: 1; background: rgb(70, 82, 98); mix-blend-mode: multiply; opacity: 0; transition: opacity 1s; }
      #wx-chip { position: fixed; left: 12px; bottom: calc(52px + env(safe-area-inset-bottom, 0px)); z-index: 3; display: flex; gap: 10px; align-items: center; padding: 6px 11px; border: 0; cursor: pointer; font: inherit; font-size: 12.5px; color: var(--ink); }
      #wx-chip .ic { font-size: 18px; line-height: 1; }
      #wx-chip small { color: var(--ink-3); font-size: 11px; }
      body.street #wx-chip { bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
      #wx-box { margin: 4px 0 10px; }
      #wx-now { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; align-items: center; margin: 8px 0 4px; }
      #wx-now .big { font: 650 26px/1.1 var(--font-display); }
      #wx-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 10px; font-size: 12px; margin: 6px 0; }
      #wx-grid span { color: var(--ink-3); display: block; font-size: 11px; }
      #wx-time { width: 100%; accent-color: var(--accent); }
      #wx-timerow { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; font-size: 12.5px; margin: 8px 0 2px; }
      #wx-zones { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 6px 0; }
      #wx-zones td, #wx-zones th { text-align: left; padding: 2px 6px 2px 0; font-weight: 500; }
      #wx-zones th { color: var(--ink-3); font-weight: 600; }
      #wx-zones tr.me td { color: var(--accent); font-weight: 650; }
      @media (max-width: 700px) { #wx-chip small { display: none; } }`;
    document.head.appendChild(st);
    const chip = document.createElement("button");
    chip.id = "wx-chip"; chip.className = "chrome"; chip.title = "Weather (click for details)";
    document.body.appendChild(chip);
    hud = chip;
    function paintHud() {
      if (!S.on) { chip.innerHTML = `<span class="ic">☀</span><span>Weather off</span>`; return; }
      const t = Math.round(tgt.temp), w = Math.round(cur.wind), day = tgt.day;
      const age = S.override ? "preview" : data.kind === "typical" ? "typical month" : clock.offsetH ? fmtTime(nowT()) : "model";
      chip.innerHTML = `<span class="ic">${ICON(tgt.code, day)}</span><span><b>${Number.isFinite(t) ? t + "°C" : "–"}</b> ${WMO(tgt.code)}</span><small>${w} km/h ${compass(tgt.windDir + 180)}${cur.rain >= 0.05 ? " · " + cur.rain.toFixed(1) + " mm/h" : ""} · ${age}</small>`;
    }
    chip.addEventListener("click", () => {
      A.setPanel(true);
      const tab = document.querySelector("[data-tab=layers]"); if (tab) tab.click();
      const box = $("wx-box"); if (box) box.scrollIntoView({ block: "nearest" });
    });
    function buildBox() {
      const pane = $("pane-layers");
      if (!pane) return;
      const box = document.createElement("div");
      box.id = "wx-box";
      box.innerHTML = `<h3>Weather</h3>
        <label class="toggle"><input type="checkbox" id="wx-on" checked><span>Live weather on the map</span><span></span></label>
        <div id="wx-now"><div class="big" id="wx-temp"></div><div id="wx-desc"></div></div>
        <div id="wx-grid"></div>
        <div id="wx-timerow"><span id="wx-when">Now</span><button class="chip" id="wx-nowbtn" style="padding:3px 10px">Now</button></div>
        <input type="range" id="wx-time" min="-48" max="72" step="1" value="0" aria-label="Weather time, hours from now">
        <table id="wx-zones"></table>
        <label class="toggle"><input type="checkbox" id="wx-sun" checked><span>Sun follows the weather clock (High and Ultra; other tiers dim at night)</span><span></span></label>
        <p class="note" id="wx-src"></p>`;
      pane.insertBefore(box, pane.firstChild);
      $("wx-on").addEventListener("change", (e) => { S.on = e.target.checked; tick(true); syncUI(); });
      $("wx-sun").addEventListener("change", (e) => { S.followSun = e.target.checked; last.hour = -99; tick(true); });
      $("wx-time").addEventListener("input", (e) => { clock.offsetH = +e.target.value; clock.jump = true; tick(true); syncUI(); });
      $("wx-nowbtn").addEventListener("click", () => { clock.offsetH = 0; $("wx-time").value = 0; clock.jump = true; tick(true); syncUI(); });
      // moving the Graphics time slider by hand takes the sun off the weather clock
      const gh = $("gfx-hour");
      if (gh) gh.addEventListener("input", () => { S.followSun = false; $("wx-sun").checked = false; });
    }
    function syncUI() {
      if (!data || !$("wx-box")) return;
      const t = nowT(), p0 = data.points[0], w = weights(0, 0);
      $("wx-temp").textContent = Number.isFinite(tgt.temp) ? Math.round(tgt.temp) + "°C" : "–";
      $("wx-desc").innerHTML = `${WMO(tgt.code)}<br><small style="color:var(--ink-3)">Pantnagar, ${fmtTime(t)} IST</small>`;
      const f = (v, d = 0, u = "") => (Number.isFinite(v) ? v.toFixed(d) + u : "–");
      $("wx-grid").innerHTML = [
        ["Wind", f(tgt.wind, 0, " km/h ") + compass(tgt.windDir + 180)], ["Gusts", f(tgt.gust, 0, " km/h")], ["Humidity", f(tgt.hum, 0, "%")],
        ["Rain", f(tgt.rain, 1, " mm/h")], ["Cloud", f(tgt.cloud * 100, 0, "%")], ["Visibility", tgt.vis >= 10000 ? "10+ km" : f(tgt.vis / 1000, 1, " km")],
        ["Soil moisture", f(tgt.soil * 100, 0, "%")], ["Evaporation", f(tgt.et0, 2, " mm/h")], ["Wet ground", f(cur.wet * 100, 0, "%")],
      ].map(([a, b]) => `<div><span>${a}</span>${b}</div>`).join("");
      $("wx-when").textContent = clock.offsetH === 0 ? "Now" : (clock.offsetH > 0 ? "+" : "") + clock.offsetH + " h · " + fmtTime(t);
      $("wx-zones").innerHTML = `<tr><th>Place</th><th>Temp</th><th>Rain</th><th>Cloud</th><th>Wind</th></tr>` + data.points.map((p, i) => `<tr class="${i === 0 ? "me" : ""}"><td>${p.name}</td><td>${f(at(p, "temperature_2m", t), 0, "°")}</td><td>${f(at(p, "precipitation", t), 1)}</td><td>${f(at(p, "cloud_cover", t), 0, "%")}</td><td>${f(at(p, "wind_speed_10m", t), 0)}</td></tr>`).join("");
      const age = data.kind === "typical" ? "" : Math.round((Date.now() - (data.generatedAt || data.fetchedAt)) / 60000);
      const srcText = { live: "straight from Open-Meteo", stored: "from the stored file (updated by the scheduled job)", cache: "from the copy saved in this browser", typical: "none: showing a typical " + new Date(Date.now() + IST).toLocaleString("en", { month: "long", timeZone: "UTC" }) + " from IMD normals" }[data.kind];
      $("wx-src").innerHTML = `Model estimate (ECMWF, 9 km grid), not a station observation. Data ${srcText}${age !== "" ? ", " + (age < 90 ? age + " min" : Math.round(age / 60) + " h") + " old" : ""}. Rain here can differ a lot from the real rain: in October 2025 the model gave 26 mm where the IMD station recorded 98 mm. Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Official forecasts: <a href="https://mausam.imd.gov.in/" target="_blank" rel="noopener">IMD</a>.`;
      paintHud();
    }
    buildBox();
    window.__weather = { err: lastErr, data: () => data, state: () => ({ tgt, cur, W }), clock, setOverride(o) { S.override = o; tick(true); }, tick, load, POINTS, sample: (x, z, t) => { const w = weights(x, z); return { rain: blend("precipitation", t, w), cloud: blend("cloud_cover", t, w) }; } };
    load();
  }

  if (window.__campus && window.__campus.gfx) boot(window.__campus);
  else window.addEventListener("campus:ready", () => boot(window.__campus), { once: true });
})();
