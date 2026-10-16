/* Pantnagar Sandbox - plan mode for the campus twin.
   Draw buildings, roads and areas; place Wi-Fi, street lights, docks, bins, trees and more; change
   or remove what exists; and see the effect with the Rust engine (js/sim-wasm.js): Wi-Fi coverage,
   street lighting, walking access, budget, and green and water numbers. Plans are GeoJSON files
   (open in QGIS too), shareable as links, and print as a proposal report. */
(function () {
  "use strict";
  let started = false;
  const start = () => { if (started || !window.__campus || !window.__campus.plan) return; started = true; init(); };
  window.addEventListener("campus:ready", start);
  start();

  function init() {
    const C = window.__campus, A = C.plan, D = window.CAMPUS;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const fmt = (n, d = 0) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
    const inr = (x) => (x >= 1e7 ? "₹" + fmt(x / 1e7, 2) + " crore" : x >= 1e5 ? "₹" + fmt(x / 1e5, 2) + " lakh" : "₹" + fmt(x));
    const pct = (x) => (x == null ? "-" : fmt(x * 100) + "%");
    const LAT0 = D.meta.origin.lat, LON0 = D.meta.origin.lon, M_LAT = 110540, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
    const toLL = (x, z) => [+(LON0 + x / M_LON).toFixed(7), +(LAT0 - z / M_LAT).toFixed(7)];
    const fromLL = (lon, lat) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
    const pip = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
    const mean = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
    const lineLen = (P) => { let l = 0; for (let i = 1; i < P.length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return l; };
    const GN = D.graph.nodes, GE = D.graph.edges;

    // ---------------------------------------------------------------------------------------
    // Icons and colours
    const ICON = {
      select: "M5 3l13 7.5-5.5 1.6L10 18z",
      building: "M4 21V8l8-5 8 5v13M9 21v-6h6v6M4 21h16",
      road: "M8 3L5 21M16 3l3 18M12 4v3M12 10v3M12 16v3",
      area: "M4 7l7-4 9 4-2 12-12 2z",
      wifi_ap: "M2 9a15 15 0 0120 0M5.5 12.5a10 10 0 0113 0M9 16a5 5 0 016 0M12 19.5h.01",
      street_light: "M8 21h8M12 21V6a3 3 0 013-3h3M16 5.5h4l-1 2.5h-2z",
      light_road: "M4 21h4M6 21V8l3-2M14 21h4M16 21V8l3-2M3 13h18",
      cctv: "M3 8l11 4-2 4L3 12zM13 14l2 4h4M19 15v5",
      ev_charger: "M6 21V5a2 2 0 012-2h5a2 2 0 012 2v16M4 21h13M11 7l-2 4h3l-2 4M15 9h2a2 2 0 012 2v4a1 1 0 002 0V8",
      bike_dock: "M6 17.5a3.5 3.5 0 100-.01M18 17.5a3.5 3.5 0 100-.01M6 17.5L9 10h6l3 7.5M9 10l3 7.5H6M14 7h3",
      shuttle_stop: "M5 17V6a3 3 0 013-3h8a3 3 0 013 3v11zM5 11h14M7 20v-3M17 20v-3M8 14h.01M16 14h.01",
      vending: "M6 3h12v18H6zM9 7h6v6H9zM9 17h3",
      water_point: "M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z",
      bin: "M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6",
      bench: "M4 11h16M5 15h14M6 11V7h12v4M6 15v4M18 15v4",
      note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
      tree: "M12 22v-6M12 16a6 6 0 100-12 6 6 0 000 12z",
      solar_roof: "M3 11l3-7h12l3 7zM3 11h18M9 4l-1.5 7M15 4l1.5 7M12 11v7M8 21h8",
      rwh: "M3 10l9-6 9 6M8 13s-2.5 3-2.5 4.5a2.5 2.5 0 005 0C10.5 16 8 13 8 13zM15 12h4v9h-4z",
      tree_tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
      tree_remove: "M12 22v-6M12 16a6 6 0 100-12 6 6 0 000 12zM4 4l16 16",
      building_edit: "M4 21V9l8-5 8 5v12M12 10v7M8.5 13.5h7",
      demolish: "M4 21V9l8-5 8 5v12M8 11l8 8M16 11l-8 8",
      route: "M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a3 3 0 000-6h-4a3 3 0 010-6h6",
      wifi_pick: "M4 21V8l8-5 8 5v13M8 13a6 6 0 018 0M10 16a3 3 0 014 0",
      plus: "M12 5v14M5 12h14",
      check: "M4 12l5 5L20 6",
      play: "M7 4l13 8-13 8z",
      target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01",
      custom_point: "M12 21s-7-6.5-7-11a7 7 0 0114 0c0 4.5-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
      custom_line: "M3 17c3-6 6-6 9 0s6 6 9 0",
      custom_polygon: "M4 5h16v14H4z",
    };
    const COL = {
      building: "#b97c0c", road: "#5b6168", area: "#3a9d5d", wifi_ap: "#2b7bd6", street_light: "#d99a0b", light_road: "#d99a0b", cctv: "#6b5bd6",
      ev_charger: "#1aa36b", bike_dock: "#e26a2c", shuttle_stop: "#c0392b", vending: "#8e44ad", water_point: "#1f9bd1", bin: "#4f7a28",
      bench: "#8a6d4b", note: "#4a5560", tree: "#2e8b3a", solar_roof: "#d4a106", rwh: "#2a83b8", tree_tag: "#3c9a5f", tree_remove: "#b03a2e",
      building_edit: "#b97c0c", demolish: "#b03a2e", route: "#2b6896", wifi_pick: "#2b7bd6",
    };
    const svg = (k, color) => `<svg class="i" viewBox="0 0 24 24"${color ? ` style="color:${color}"` : ""}><path d="${ICON[k] || (K[k] && K[k].custom ? ICON["custom_" + K[k].geom] : ICON.note)}"/></svg>`;
    const AREA_COL = { garden: 0x6fbf5a, parking: 0x9aa0a6, plaza: 0xd8c9a8, sports: 0xc56a4a, solar_farm: 0x24406b, rain_garden: 0x4aa3d8 };
    const ROAD = { footpath: [1.8, "path", "footway"], cycle_track: [2.5, "path", "cycleway"], lane: [3.75, "minor", "service"], two_lane: [7, "major", "tertiary"] };
    const THEMES = ["Waste Recycling", "Robust Wi-Fi in Hostels", "Automatic Vending Machines (AVMs) in Hostels", "Water Recycling in Hostels", "Public Bicycle Sharing System", "Campus Landscaping", "Automation of the No Dues System", "Strengthening Campus Lighting", "Tree Tagging", "Clean and Green Campus", "Saving Food Waste", "Managing Monkeys and Stray Animals", "Other"];

    // ---------------------------------------------------------------------------------------
    // Engine (Rust -> WebAssembly, embedded as base64 so the page works from a file)
    const enc = new TextEncoder(), dec = new TextDecoder();
    const E = {
      ex: null, loading: null, cat: null,
      load() {
        if (this.loading) return this.loading;
        this.loading = (async () => {
          if (!window.SIM_WASM) throw new Error("The planning engine (js/sim-wasm.js) is missing: run `twin sim-pack`.");
          const bin = Uint8Array.from(atob(window.SIM_WASM), (c) => c.charCodeAt(0));
          const { instance } = await WebAssembly.instantiate(bin, { env: { now: () => performance.now() } });
          this.ex = instance.exports;
          A.applyPlanGraph(null);
          const t0 = performance.now();
          const r = this.str("world_load", JSON.stringify(D));
          if (r.rc) throw new Error(r.json.msg);
          console.info(`[sandbox] engine ready in ${(performance.now() - t0).toFixed(0)} ms`, r.json);
          this.cat = this.call("catalog_json");
          this.warm();
          return this;
        })();
        this.loading.catch(() => { this.loading = null; });
        return this.loading;
      },
      // Browsers start WebAssembly on a quick baseline compiler and optimise code once it gets hot.
      // A tiny plan run through every model makes the first real run fast.
      warm() {
        const t0 = performance.now();
        const h = D.buildings.find((b) => b.t === "hostel") || D.buildings[0];
        let x = 0, z = 0;
        const r = h.r[0];
        for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
        x /= r.length / 2; z /= r.length / 2;
        const pt = (kind, dx, dz, props = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: toLL(x + dx, z + dz) }, properties: { kind, ...props } });
        const fc = { type: "FeatureCollection", features: [pt("wifi_ap", 0, 0, { band: "5" }), pt("wifi_ap", 10, 0, { band: "2.4" }), pt("street_light", 20, 20), pt("bin", 30, 0), pt("bike_dock", -30, 0)] };
        try {
          for (let k = 0; k < 3; k++) {
            this.str("plan_set", JSON.stringify(fc));
            this.call("plan_evaluate");
            this.grid("plan_wifi_grid", 120 * 120, x - 240, z - 240, 4, 120, 120, 0, 1);
            this.grid("plan_lux_grid", 100 * 100, x - 100, z - 100, 2, 100, 100, 1);
            this.call("plan_route", x - 200, z, x + 200, z + 50, 1);
            this.str("plan_suggest_wifi", JSON.stringify({ points: [[x, z]], band: "5", max: 2 }));
          }
          this.str("plan_set", JSON.stringify({ type: "FeatureCollection", features: [] }));
        } catch (e) { console.warn("[sandbox] warm-up failed", e); }
        console.info("[sandbox] warm-up " + (performance.now() - t0).toFixed(0) + " ms");
      },
      read(n) { return dec.decode(new Uint8Array(this.ex.memory.buffer, this.ex.out_ptr(), n)); },
      str(fn, s) {
        const b = enc.encode(s), p = this.ex.alloc(b.length);
        new Uint8Array(this.ex.memory.buffer, p, b.length).set(b);
        try { const rc = this.ex[fn](p, b.length); return { rc, json: JSON.parse(this.read(this.ex.out_len())) }; } finally { this.ex.free(p, b.length); }
      },
      call(fn, ...a) { return JSON.parse(this.read(this.ex[fn](...a))); },
      grid(fn, n, ...a) { const p = this.ex[fn](...a); return new Float32Array(this.ex.memory.buffer, p, n).slice(); },
      fail(e) {
        let m = "";
        try { m = this.read(this.ex.last_panic()); } catch (_) { /* instance is gone */ }
        console.error("[sandbox] engine error", e, m);
        this.ex = null; this.loading = null; R = null;
        A.toast("The planning engine stopped (" + (m || e.message || e) + "). It restarts on the next change.");
      },
    };

    // ---------------------------------------------------------------------------------------
    // Plan state. Items keep local metres; files carry lon/lat.
    const freshMeta = () => ({ title: "Untitled scenario", notes: "", categories_off: [], targets: {}, budget: { cap: 0, contingency: 5, tax: 0, extra: [] }, wifi_targets: ["hostel"], wifi_buildings: [], costs: {}, maint: {}, reach: {}, assumptions: {} });
    const S = { meta: freshMeta(), items: [], seq: 1 };
    let sel = null, tool = "select", draft = null, drag = null, shape = "rect", showPlan = true, R = null;
    let K = {};
    const undo = [], redo = [];
    const snap = () => JSON.stringify({ meta: S.meta, items: S.items, seq: S.seq });
    function restore(str) { const o = JSON.parse(str); S.meta = o.meta; S.items = o.items; S.seq = o.seq; if (!S.items.some((i) => i.id === sel)) sel = null; }
    function mutate(fn, opts = {}) {
      undo.push(snap()); if (undo.length > 120) undo.shift();
      redo.length = 0;
      fn();
      changed(opts);
    }
    function changed(opts = {}) {
      renderItems(); renderList(); renderCard(); updateUndo();
      if (!opts.quiet) schedule();
    }
    function doUndo() { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); changed(); }
    function doRedo() { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); changed(); }
    function updateUndo() { $("plan-undo").disabled = !undo.length; $("plan-redo").disabled = !redo.length; }

    const geomOf = (kind) => { const g = K[kind] && K[kind].geom; return g === "line" ? "line" : g === "polygon" ? "polygon" : "point"; };
    function defaults(kind) {
      const o = {};
      for (const p of (K[kind] && K[kind].params) || []) if (p.default !== "" && p.default != null) o[p.key] = p.default;
      return o;
    }
    function newItem(kind, pts, props = {}) {
      const it = { id: "i" + S.seq++, kind, status: (K[kind] && K[kind].status) || "proposed", name: "", g: geomOf(kind), pts, props: { ...defaults(kind), ...props } };
      return it;
    }
    const num = (it, k, d) => { const v = Number(it.props[k]); return Number.isFinite(v) && it.props[k] !== "" ? v : d; };
    const itemTitle = (it) => it.name || (it.kind === "tree_tag" && R && R.byId[it.id] && R.byId[it.id].info.tree ? `Tree ${R.byId[it.id].info.tree}${it.props.species ? " · " + it.props.species : ""}` : (K[it.kind] ? K[it.kind].label : it.kind));

    function toGeoJSON() {
      return {
        type: "FeatureCollection",
        sandbox: { version: 1, tool: "Pantnagar Sandbox", ...S.meta, custom_kinds: customKinds.filter((k) => S.items.some((i) => i.kind === k.key)), updated: new Date().toISOString() },
        features: S.items.map((it) => {
          const c = it.pts.map((p) => toLL(p[0], p[1]));
          const geometry = it.g === "point" ? { type: "Point", coordinates: c[0] } : it.g === "line" ? { type: "LineString", coordinates: c } : { type: "Polygon", coordinates: [[...c, c[0]]] };
          return { type: "Feature", id: it.id, geometry, properties: { kind: it.kind, status: it.status, name: it.name || "", ...it.props } };
        }),
      };
    }
    function fromGeoJSON(o) {
      if (!o || !Array.isArray(o.features)) throw new Error("Not a plan file (no features)");
      const items = [];
      let seq = 1;
      for (const f of o.features) {
        const p = { ...(f.properties || {}) }, g = f.geometry || {};
        if (!p.kind || !K[p.kind]) continue;
        let pts;
        if (g.type === "Point") pts = [fromLL(g.coordinates[0], g.coordinates[1])];
        else if (g.type === "LineString") pts = g.coordinates.map((c) => fromLL(c[0], c[1]));
        else if (g.type === "Polygon") { pts = g.coordinates[0].map((c) => fromLL(c[0], c[1])); if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop(); }
        else continue;
        const id = String(f.id != null ? f.id : p.id != null ? p.id : "i" + seq);
        const m = /^i(\d+)$/.exec(id); if (m) seq = Math.max(seq, +m[1] + 1);
        const it = { id, kind: p.kind, status: p.status === "existing" ? "existing" : "proposed", name: p.name || "", g: geomOf(p.kind), pts, props: {} };
        for (const k in p) if (!["kind", "status", "name", "id"].includes(k)) it.props[k] = p[k];
        items.push(it);
      }
      // Ids must be unique.
      const seen = new Set();
      for (const it of items) { if (seen.has(it.id)) it.id = "i" + seq++; seen.add(it.id); }
      const meta = { ...freshMeta() };
      for (const k in o.sandbox || {}) if (!["version", "tool", "updated", "custom_kinds"].includes(k)) meta[k] = o.sandbox[k];
      if (!meta.notes && meta.summary) meta.notes = meta.summary;
      return { meta, items, seq: Math.max(seq, items.length + 1) };
    }
    // Opening a file, a link or a sample always makes a new scenario, so nothing is overwritten.
    function loadPlan(o, msg) { newScenario(o, msg); }

    // ---------------------------------------------------------------------------------------
    // Lookups: campus buildings (ignoring what the plan hides) and mapped trees.
    const bGrid = new Map(), BG = 50;
    for (const b of C.blds) {
      for (let i = Math.floor(b.bb[0] / BG); i <= Math.floor(b.bb[2] / BG); i++) for (let j = Math.floor(b.bb[1] / BG); j <= Math.floor(b.bb[3] / BG); j++) {
        const k = i + "," + j; if (!bGrid.has(k)) bGrid.set(k, []); bGrid.get(k).push(b);
      }
    }
    const bldAt = (x, z) => (bGrid.get(Math.floor(x / BG) + "," + Math.floor(z / BG)) || []).find((b) => x >= b.bb[0] && x <= b.bb[2] && z >= b.bb[1] && z <= b.bb[3] && pip(x, z, b.rings[0]));
    const TR = D.trees, tGrid = new Map(), TG = 20;
    for (let i = 0; i < TR.length / 3; i++) { const k = Math.floor(TR[i * 3] / TG) + "," + Math.floor(TR[i * 3 + 1] / TG); if (!tGrid.has(k)) tGrid.set(k, []); tGrid.get(k).push(i); }
    function treesNear(x, z, r, fn) {
      for (let i = Math.floor((x - r) / TG); i <= Math.floor((x + r) / TG); i++) for (let j = Math.floor((z - r) / TG); j <= Math.floor((z + r) / TG); j++) for (const t of tGrid.get(i + "," + j) || []) fn(t, TR[t * 3], TR[t * 3 + 1]);
    }
    function treeAt(x, z, r = 6) { let best = -1, bd = r; treesNear(x, z, r, (t, tx, tz) => { const d = Math.hypot(tx - x, tz - z); if (d < bd) { bd = d; best = t; } }); return best; }
    function treesIn(ring, out) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of ring) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      treesNear(cx, cz, Math.max(x1 - x0, z1 - z0) / 2 + 1, (t, tx, tz) => { if (pip(tx, tz, ring)) out.add(t); });
    }
    function treesAlong(P, half, out) {
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
        treesNear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.sqrt(l2) / 2 + half + 1, (t, tx, tz) => {
          const u = Math.max(0, Math.min(1, ((tx - a[0]) * dx + (tz - a[1]) * dz) / l2));
          if (Math.hypot(tx - a[0] - u * dx, tz - a[1] - u * dz) <= half + 1) out.add(t);
        });
      }
    }
    // A point inside a building near where it was clicked.
    function insidePoint(b, x, z) {
      if (pip(x, z, b.rings[0])) return [x, z];
      const c = b.c;
      for (let t = 0.1; t <= 1; t += 0.1) { const px = x + (c[0] - x) * t, pz = z + (c[1] - z) * t; if (pip(px, pz, b.rings[0])) return [px, pz]; }
      return [c[0], c[1]];
    }
    function planBuildingAt(x, z) {
      return S.items.find((it) => it.kind === "building" && it.pts.length >= 3 && pip(x, z, it.pts));
    }

    // ---------------------------------------------------------------------------------------
    // 3D: items, generated lights, selection, drafts, overlays
    const G = C.groups.plan;
    const items3d = new THREE.Group(), sel3d = new THREE.Group(), draft3d = new THREE.Group(), over3d = new THREE.Group(), glow3d = new THREE.Group();
    G.add(items3d, sel3d, draft3d, over3d, glow3d);
    glow3d.visible = false;
    let pickables = [], handles = [];
    const GEO = {
      box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0),
    };
    const MATS = new Map();
    const lam = (hex) => MATS.get(hex) || (MATS.set(hex, new THREE.MeshLambertMaterial({ color: hex })), MATS.get(hex));
    function part(geo, hex, x, y, z, sx, sy, sz, ry = 0) { const m = new THREE.Mesh(GEO[geo], lam(hex)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry; return m; }
    function dispose(g) {
      for (const o of [...g.children]) {
        g.remove(o);
        o.traverse((m) => { if (m.userData.own && m.geometry) m.geometry.dispose(); if (m.userData.ownMat && m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
      }
    }
    const own = (o, matToo) => { o.traverse((m) => { if (m.geometry) m.userData.own = true; if (matToo) m.userData.ownMat = true; }); return o; };

    const iconCache = new Map();
    function iconMat(kind, flag) {
      const key = kind + "|" + (flag || "");
      if (iconCache.has(key)) return iconCache.get(key);
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d");
      x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2);
      x.fillStyle = flag === "base" ? "#7b877e" : COL[kind] || "#4a5560"; x.fill();
      x.lineWidth = 4; x.strokeStyle = "#fff"; x.stroke();
      x.save(); x.translate(17.6, 17.6); x.scale(1.2, 1.2);
      x.strokeStyle = "#fff"; x.lineWidth = 2.1; x.lineCap = "round"; x.lineJoin = "round";
      if (K[kind] && K[kind].custom) { x.restore(); x.fillStyle = "#fff"; x.font = "bold 30px sans-serif"; x.textAlign = "center"; x.fillText((K[kind].label || "?")[0].toUpperCase(), 32, 43); }
      else { x.stroke(new Path2D(ICON[kind] || ICON.note)); x.restore(); }
      if (flag === "warn") { x.beginPath(); x.arc(52, 12, 10, 0, Math.PI * 2); x.fillStyle = "#e67e22"; x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 3; x.stroke(); x.fillStyle = "#fff"; x.font = "bold 14px sans-serif"; x.textAlign = "center"; x.fillText("!", 52, 17); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false });
      iconCache.set(key, m);
      return m;
    }
    function icon(kind, x, y, z, id, flag, s = 0.034) {
      const sp = new THREE.Sprite(iconMat(kind, flag));
      sp.position.set(x, y, z); sp.scale.set(s, s, 1); sp.center.set(0.5, 0.1); sp.renderOrder = 20;
      sp.userData.id = id;
      return sp;
    }
    const glowTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,236,190,1)"); g.addColorStop(0.25, "rgba(255,214,140,0.55)"); g.addColorStop(1, "rgba(255,190,90,0)");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    function glow(x, y, z, s = 7) { const g = new THREE.Sprite(glowMat); g.position.set(x, y, z); g.scale.set(s, s, 1); return g; }
    function drapedLine(P, color, lift = 0.8, closed = false, opts = {}) {
      const pts = [];
      const Q = closed ? [...P, P[0]] : P;
      for (let i = 0; i < Q.length - 1 || (i === 0 && Q.length === 1); i++) {
        const a = Q[i], b = Q[Math.min(i + 1, Q.length - 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 15));
        for (let k = 0; k < n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; pts.push(x, A.H(x, z) + lift, z); }
      }
      const last = Q[Q.length - 1]; pts.push(last[0], A.H(last[0], last[1]) + lift, last[1]);
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mo = { color, depthTest: !opts.top, transparent: true, opacity: opts.opacity || 1, toneMapped: false };
      const m = opts.dashed ? new THREE.LineDashedMaterial({ ...mo, dashSize: 4, gapSize: 3 }) : new THREE.LineBasicMaterial(mo);
      const l = new THREE.Line(g, m);
      if (opts.dashed) l.computeLineDistances();
      l.renderOrder = opts.top ? 15 : 3;
      l.userData.own = true; l.userData.ownMat = true;
      return l;
    }
    function fillPoly(P, color, lift, opacity = 0.8, flatY) {
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(P.map((p) => new THREE.Vector2(p[0], p[1])), []); } catch (e) { return null; }
      const pos = [];
      for (const t of tris) for (const i of t) { const p = P[i]; pos.push(p[0], flatY != null ? flatY : A.H(p[0], p[1]) + lift, p[1]); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      m.userData.own = true; m.userData.ownMat = true;
      return m;
    }
    function inset(P, d) {
      const c = mean(P);
      return P.map((p) => { const dx = p[0] - c[0], dz = p[1] - c[1], L = Math.hypot(dx, dz) || 1; return [p[0] - (dx / L) * Math.min(d, L * 0.4), p[1] - (dz / L) * Math.min(d, L * 0.4)]; });
    }
    const tint = (hex, k) => { const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255; return [r + (1 - r) * k, g + (1 - g) * k, b + (1 - b) * k]; };
    function roadYaw(x, z) {
      const ne = A.nearestEdge(x, z, 40);
      if (!ne) return 0;
      const e = GE[ne.k], ax = GN[e[0] * 2], az = GN[e[0] * 2 + 1], bx = GN[e[1] * 2], bz = GN[e[1] * 2 + 1];
      const px = ax + (bx - ax) * ne.t, pz = az + (bz - az) * ne.t, dx = px - x, dz = pz - z;
      return Math.atan2(-dz, dx);
    }
    // Building context for things placed on roofs.
    function roofOf(x, z) {
      const pb = planBuildingAt(x, z);
      if (pb) { let g = Infinity; for (const p of pb.pts) g = Math.min(g, A.H(p[0], p[1])); return { ring: pb.pts, top: g + num(pb, "floors", 3) * 3.3, floors: num(pb, "floors", 3), ground: g }; }
      const b = bldAt(x, z);
      if (!b) return null;
      const ed = S.items.find((it) => it.kind === "building_edit" && bldAt(it.pts[0][0], it.pts[0][1]) === b);
      const floors = ed && num(ed, "floors", 0) >= 1 ? num(ed, "floors", 0) : b.f;
      return { ring: b.rings[0], top: ed && num(ed, "floors", 0) >= 1 ? b.ground + floors * 3.3 : b.top, floors, ground: b.ground, b };
    }

    function renderItems() {
      dispose(items3d); dispose(glow3d);
      pickables = [];
      const hideB = new Set(), hideT = new Set(), labels = [];
      G.visible = true;
      items3d.visible = showPlan;
      if (!showPlan) { A.setHiddenBuildings(hideB); A.setHiddenTrees(hideT); A.setPlanLabels([]); renderSelection(); A.markDirty(); return; }
      for (const it of S.items) {
        const o = itemOn(it) ? drawItem(it, hideB, hideT, labels) : ghostItem(it);
        if (o) items3d.add(o);
      }
      if (R && R.gen_lights) for (const [x, z, i] of R.gen_lights) {
        const it = S.items[i];
        if (!it || it.kind !== "road") continue;
        items3d.add(A.makeLamp(x, z, roadYaw(x, z), 8));
        glow3d.add(glow(x, A.H(x, z) + 7.6, z));
      }
      A.setHiddenBuildings(hideB);
      A.setHiddenTrees(hideT);
      A.setPlanLabels(labels);
      renderSelection();
      A.markDirty();
    }

    function ghostItem(it) {
      const p = it.g === "point" ? it.pts[0] : mean(it.pts), sp = icon(it.kind, p[0], A.H(p[0], p[1]) + 3, p[1], it.id, "base", 0.026);
      pickables.push(sp);
      return sp;
    }
    function drawItem(it, hideB, hideT, labels) {
      const grp = new THREE.Group();
      const P = it.pts, [x, z] = P[0], y0 = A.H(x, z), id = it.id;
      const r = R && R.byId && R.byId[it.id];
      const flag = r && r.warn && r.warn.length ? "warn" : it.status === "existing" ? "base" : "";
      const prop = it.status === "proposed";
      const pick = (o) => { o.traverse((m) => { if (m.isMesh || m.isSprite) { m.userData.id = id; pickables.push(m); } }); return o; };
      let iy = y0 + 3, ix = x, iz = z;
      switch (it.kind) {
        case "building": {
          if (P.length < 3) return null;
          const floors = num(it, "floors", 3), t = it.props.type || "academic";
          const m = A.makeBuilding(P, floors, { wall: tint(A.TYPE_COLOUR[t] || 0xbbbbbb, 0.72), roof: tint(A.TYPE_COLOUR[t] || 0xbbbbbb, 0.5) });
          if (m) { grp.add(pick(own(m))); iy = m.userData.top + 2; }
          grp.add(drapedLine(P, prop ? 0xb97c0c : 0x2b6896, 0.7, true));
          if (prop) treesIn(P, hideT);
          [ix, iz] = mean(P);
          if (it.name) labels.push({ text: it.name, x: ix, z: iz, y: iy + 2 });
          break;
        }
        case "road": {
          if (P.length < 2) return null;
          const [w, g] = ROAD[it.props.type] || ROAD.lane;
          const m = A.makeRoad(P, w, g);
          if (m) { m.userData.own = true; grp.add(pick(m)); }
          grp.add(drapedLine(P, prop ? 0xb97c0c : 0x2b6896, 0.55, false, { opacity: 0.6 }));
          if (prop) treesAlong(P, w / 2, hideT);
          const mid = P[Math.floor(P.length / 2)];
          [ix, iz] = P.length % 2 ? mid : [(P[P.length / 2 - 1][0] + mid[0]) / 2, (P[P.length / 2 - 1][1] + mid[1]) / 2];
          iy = A.H(ix, iz) + 2;
          if (it.name) labels.push({ text: it.name, x: ix, z: iz, y: iy + 1 });
          break;
        }
        case "area": {
          if (P.length < 3) return null;
          const u = it.props.use || "garden";
          const f = fillPoly(P, AREA_COL[u] || 0x6fbf5a, 0.45, u === "solar_farm" ? 0.92 : 0.72);
          if (f) grp.add(pick(f));
          if (u === "solar_farm") { const f2 = fillPoly(inset(P, 2), 0x34558a, 1.2, 1); if (f2) grp.add(pick(f2)); }
          grp.add(drapedLine(P, prop ? 0xb97c0c : 0x2b6896, 0.7, true));
          if (prop && !["garden", "rain_garden"].includes(u)) treesIn(P, hideT);
          [ix, iz] = mean(P); iy = A.H(ix, iz) + 2;
          if (it.name) labels.push({ text: it.name, x: ix, z: iz, y: iy + 1 });
          break;
        }
        case "wifi_ap": {
          const roof = roofOf(x, z);
          if (roof) { const fl = Math.min(num(it, "floor", 0), Math.max(0, roof.floors - 1)); iy = roof.ground + fl * 3.3 + 2.8; grp.add(part("box", 0xf4f4f4, x, iy - 0.1, z, 0.35, 0.08, 0.35)); }
          else { const h = num(it, "pole", 6); grp.add(part("cyl", 0x9aa0a6, x, y0, z, 0.12, h, 0.12), part("box", 0xf4f4f4, x, y0 + h, z, 0.3, 0.3, 0.3)); iy = y0 + h + 1; }
          break;
        }
        case "street_light": {
          const h = num(it, "height", 8);
          grp.add(A.makeLamp(x, z, roadYaw(x, z), h));
          if (it.props.supply === "solar") grp.add(part("box", 0x1d3557, x, y0 + h + 0.3, z, 1.1, 0.05, 0.7));
          glow3d.add(glow(x + Math.cos(roadYaw(x, z)) * 1.3, y0 + h * 0.97, z - Math.sin(roadYaw(x, z)) * 1.3));
          iy = y0 + h + 1.5;
          break;
        }
        case "cctv": {
          grp.add(part("cyl", 0x9aa0a6, x, y0, z, 0.1, 4.5, 0.1), part("box", 0xeeeeee, x, y0 + 4.3, z, 0.25, 0.25, 0.5, -(num(it, "heading", 0) * Math.PI) / 180));
          const rr = num(it, "range", 30), fov = Math.min(360, num(it, "fov", 90)), hd = (num(it, "heading", 0) * Math.PI) / 180;
          const fan = [[x, z]];
          for (let k = 0; k <= 16; k++) { const a = hd - (fov * Math.PI) / 360 + ((fov * Math.PI) / 180) * (k / 16); fan.push([x + Math.sin(a) * rr, z - Math.cos(a) * rr]); }
          const f = fillPoly(fan, 0x6b5bd6, 0.6, 0.18); if (f) grp.add(f);
          iy = y0 + 5.5;
          break;
        }
        case "ev_charger": grp.add(part("box", 0x1aa36b, x, y0, z, 0.5, 1.4, 0.35), part("box", 0x10202a, x, y0 + 1.0, z + 0.18, 0.3, 0.25, 0.02)); iy = y0 + 2.5; break;
        case "bike_dock": {
          const n = Math.max(2, Math.min(20, num(it, "docks", 10))), L = n * 0.75 + 0.6, yaw = roadYaw(x, z);
          grp.add(part("box", 0x5b6168, x, y0, z, L, 0.08, 1.8, yaw));
          for (let k = 0; k < n; k++) { const o = -L / 2 + 0.6 + k * 0.75, bx = x + Math.cos(yaw) * o, bz = z - Math.sin(yaw) * o; grp.add(part("box", k % 2 ? 0xe26a2c : 0x2c2c2c, bx, y0 + 0.08, bz, 0.06, 1.0, 1.7, yaw)); }
          iy = y0 + 2.5;
          break;
        }
        case "shuttle_stop": {
          const yaw = roadYaw(x, z);
          for (const s of [-1.8, 1.8]) grp.add(part("box", 0x6b7075, x + Math.cos(yaw) * s, y0, z - Math.sin(yaw) * s, 0.1, 2.6, 0.1, yaw));
          grp.add(part("box", 0xc0392b, x, y0 + 2.6, z, 4.2, 0.12, 1.8, yaw), part("box", 0xb8d4e3, x - Math.sin(yaw) * 0.8, y0 + 0.3, z - Math.cos(yaw) * 0.8, 3.8, 2.0, 0.05, yaw));
          iy = y0 + 4;
          break;
        }
        case "vending": grp.add(part("box", 0x8e44ad, x, y0, z, 1.0, 1.9, 0.8), part("box", 0xe9e2f2, x, y0 + 0.7, z + 0.41, 0.6, 1.0, 0.02)); iy = y0 + 3; break;
        case "water_point": grp.add(part("box", 0x1f9bd1, x, y0, z, 0.8, 1.4, 0.6), part("box", 0xf2f6f8, x, y0 + 1.4, z, 0.8, 0.12, 0.6)); iy = y0 + 2.6; break;
        case "bin": grp.add(part("cyl", 0x2e7d32, x - 0.35, y0, z, 0.55, 0.95, 0.55), part("cyl", 0x1565c0, x + 0.35, y0, z, 0.55, 0.95, 0.55)); iy = y0 + 2.2; break;
        case "bench": {
          const yaw = roadYaw(x, z);
          grp.add(part("box", 0x8a6d4b, x, y0 + 0.42, z, 1.8, 0.07, 0.5, yaw), part("box", 0x8a6d4b, x + Math.sin(yaw) * 0.22, y0 + 0.5, z + Math.cos(yaw) * 0.22, 1.8, 0.45, 0.05, yaw), part("box", 0x3c3f42, x, y0, z, 1.5, 0.42, 0.4, yaw));
          iy = y0 + 2;
          break;
        }
        case "tree": grp.add(A.makeTree(x, z, 4.5)); iy = y0 + 6; break;
        case "note": iy = y0 + 2; if (it.props.text) labels.push({ text: String(it.props.text).slice(0, 60), x, z, y: y0 + 4 }); break;
        case "solar_roof": {
          const roof = roofOf(x, z);
          if (roof) {
            // Panels cover the share of the roof set on the item, centred on the roof.
            const k = Math.sqrt(Math.max(0.05, Math.min(0.9, num(it, "share", 50) / 100))), c = mean(roof.ring);
            const f = fillPoly(roof.ring.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]), 0x1d3557, 0, 1, roof.top + 0.7);
            if (f) grp.add(pick(f)); iy = roof.top + 2;
          }
          break;
        }
        case "rwh": {
          const roof = roofOf(x, z);
          const base = roof ? roof.top + 0.6 : y0;
          grp.add(part("cyl", 0x2a83b8, x, base, z, 2.2, 1.8, 2.2));
          iy = base + 3;
          break;
        }
        case "tree_tag": case "tree_remove": {
          const t = treeAt(x, z, 4);
          const h = t >= 0 ? TR[t * 3 + 2] : 6;
          if (t >= 0 && it.kind === "tree_remove" && prop) hideT.add(t);
          if (it.kind === "tree_remove") grp.add(part("cyl", 0x6b4a2f, x, y0, z, 0.6, 0.4, 0.6));
          iy = y0 + (it.kind === "tree_remove" ? 2 : h + 1);
          if (it.kind === "tree_tag" && r && r.info.tree) labels.push({ text: `${r.info.tree}${it.props.species ? " " + it.props.species : ""}`, x, z, y: iy + 2 });
          break;
        }
        case "demolish": case "building_edit": {
          const b = bldAt(x, z);
          if (!b) break;
          hideB.add(b.i);
          if (it.kind === "demolish") {
            if (prop) { grp.add(drapedLine(b.rings[0], 0xb03a2e, 0.6, true, { dashed: true })); const f = fillPoly(b.rings[0], 0x8a6d55, 0.3, 0.55); if (f) grp.add(pick(f)); }
            iy = b.ground + 3;
          } else {
            const floors = num(it, "floors", 0) >= 1 ? num(it, "floors", 0) : b.f, t = it.props.type || b.t;
            const m = A.makeBuilding(b.rings[0], floors, { wall: tint(A.TYPE_COLOUR[t] || 0xbbbbbb, 0.72), roof: tint(A.TYPE_COLOUR[t] || 0xbbbbbb, 0.5) });
            if (m) { grp.add(pick(own(m))); iy = m.userData.top + 2; }
          }
          [ix, iz] = [x, z];
          break;
        }
        default:
          if (K[it.kind] && K[it.kind].custom) {
            const hex = parseInt((COL[it.kind] || "#5b6168").slice(1), 16);
            if (it.g === "polygon" && P.length >= 3) {
              const f = fillPoly(P, hex, 0.5, 0.6); if (f) grp.add(pick(f));
              grp.add(drapedLine(P, hex, 0.7, true));
              [ix, iz] = mean(P); iy = A.H(ix, iz) + 2;
            } else if (it.g === "line" && P.length >= 2) {
              for (let i = 1; i < P.length; i++) {
                const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (-(b[1] - a[1]) / L) * 0.9, nz = ((b[0] - a[0]) / L) * 0.9;
                const f = fillPoly([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], hex, 0.6, 0.85);
                if (f) grp.add(pick(f));
              }
              [ix, iz] = P[Math.floor(P.length / 2)]; iy = A.H(ix, iz) + 2;
            } else {
              grp.add(part("cyl", 0x6b7075, x, y0, z, 0.12, 1.6, 0.12), part("box", hex, x, y0 + 1.6, z, 0.7, 0.7, 0.7));
              iy = y0 + 3.2;
            }
            if (it.name) labels.push({ text: it.name, x: ix, z: iz, y: iy + 1 });
          }
          break;
      }
      grp.add(pick(icon(it.kind, ix, iy, iz, id, flag)));
      return grp;
    }

    function renderSelection() {
      dispose(sel3d);
      handles = [];
      const it = S.items.find((i) => i.id === sel);
      // Wi-Fi target picks
      for (const ll of S.meta.wifi_buildings || []) {
        const [x, z] = fromLL(ll[0], ll[1]);
        const b = bldAt(x, z), pb = planBuildingAt(x, z);
        const ring = pb ? pb.pts : b ? b.rings[0] : null;
        if (ring && (tool === "wifi_pick" || OV.wifi)) sel3d.add(drapedLine(ring, 0x2b7bd6, 1.2, true, { top: true }));
      }
      if (!it || !showPlan) { A.markDirty(); return; }
      const col = 0xffffff;
      if (it.g !== "point") {
        sel3d.add(drapedLine(it.pts, 0x111111, 1.0, it.g === "polygon", { top: true, opacity: 0.5 }));
        sel3d.add(drapedLine(it.pts, col, 1.1, it.g === "polygon", { top: true, dashed: true }));
        it.pts.forEach((p, k) => {
          const h = new THREE.Sprite(handleMat);
          h.position.set(p[0], A.H(p[0], p[1]) + 1.2, p[1]); h.scale.set(0.016, 0.016, 1); h.center.set(0.5, 0.5); h.renderOrder = 25;
          h.userData.handle = k;
          sel3d.add(h); handles.push(h);
        });
      } else {
        const [x, z] = it.pts[0];
        const ring = [];
        for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; ring.push([x + Math.cos(a) * 3, z + Math.sin(a) * 3]); }
        sel3d.add(drapedLine(ring, col, 0.7, true, { top: true }));
      }
      A.markDirty();
    }
    const handleMat = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 32;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.strokeStyle = "#b97c0c"; x.lineWidth = 6; x.fillRect(4, 4, 24, 24); x.strokeRect(4, 4, 24, 24);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false });
    })();

    // ---------------------------------------------------------------------------------------
    // Pointer and keyboard
    function worldHit(e) {
      const pb = A.pickBuilding(e.clientX, e.clientY), gh = A.groundHit(e.clientX, e.clientY);
      const cam = C.camera.position;
      const plan = A.raycast(e.clientX, e.clientY, pickables.filter((m) => m.isMesh))[0];
      let best = null;
      if (gh) best = { x: gh.x, z: gh.z, d: cam.distanceTo(gh) };
      if (pb && (!best || pb.dist < best.d)) best = { x: pb.point.x, z: pb.point.z, d: pb.dist, b: pb.b };
      if (plan && (!best || plan.distance < best.d)) best = { x: plan.point.x, z: plan.point.z, d: plan.distance, item: plan.object.userData.id, b: null };
      return best;
    }
    function pickItem(e) {
      const hs = handles.length ? A.raycast(e.clientX, e.clientY, handles) : [];
      if (hs.length) return { id: sel, handle: hs[0].object.userData.handle };
      const hit = A.raycast(e.clientX, e.clientY, pickables)[0];
      return hit ? { id: hit.object.userData.id } : null;
    }
    function snapRoad(x, z, maxD = 10) {
      const ne = A.nearestEdge(x, z, maxD);
      if (!ne) return null;
      const e = GE[ne.k], ax = GN[e[0] * 2], az = GN[e[0] * 2 + 1], bx = GN[e[1] * 2], bz = GN[e[1] * 2 + 1];
      // prefer the end node when close to it
      const L = Math.hypot(bx - ax, bz - az);
      if (ne.t * L < 5) return [ax, az];
      if ((1 - ne.t) * L < 5) return [bx, bz];
      return [ax + (bx - ax) * ne.t, az + (bz - az) * ne.t];
    }
    let hoverPt = null;
    const hooks = {
      mode(m, prev) { if (m === "plan") enterPlan(); else if (prev === "plan") leavePlan(m); },
      down(e) {
        if (tool !== "select") return false;
        // Only the selected item (or its corner handles) can be dragged; elsewhere the camera moves.
        const p = pickItem(e);
        if (!p || !p.id || p.id !== sel) return false;
        const it = S.items.find((i) => i.id === p.id);
        if (!it) return false;
        const g = A.groundHit(e.clientX, e.clientY);
        if (!g) return true;
        drag = { id: it.id, handle: p.handle, x: g.x, z: g.z, before: snap(), moved: false, sx: e.clientX, sy: e.clientY };
        return true;
      },
      move(e) {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        drag.moved = true;
        const g = A.groundHit(e.clientX, e.clientY);
        if (!g) return;
        const it = S.items.find((i) => i.id === drag.id);
        if (!it) return;
        if (drag.handle != null) {
          let p = [g.x, g.z];
          if (it.kind === "road") p = snapRoad(g.x, g.z, 8) || p;
          it.pts[drag.handle] = p;
        } else {
          const dx = g.x - drag.x, dz = g.z - drag.z;
          it.pts = it.pts.map((p) => [p[0] + dx, p[1] + dz]);
          drag.x = g.x; drag.z = g.z;
        }
        renderItems();
      },
      up() {
        if (drag && drag.moved) { undo.push(drag.before); redo.length = 0; changed(); }
        drag = null;
      },
      hover(e) {
        const p = tool === "select" ? pickItem(e) : null;
        A.canvas.style.cursor = tool !== "select" ? "crosshair" : p ? "pointer" : "";
        if (draft || ["building", "area", "road", "route"].includes(tool)) {
          const h = worldHit(e);
          hoverPt = h ? [h.x, h.z] : null;
          if (hoverPt && (tool === "road" || tool === "route")) hoverPt = snapRoad(hoverPt[0], hoverPt[1], 10) || hoverPt;
          renderDraft();
        }
      },
      click(e) { onTool(e); },
      dblclick() { if (draft) finishDraft(); },
      key(e) {
        const k = e.key, ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && (k === "z" || k === "Z")) { e.shiftKey ? doRedo() : doUndo(); e.preventDefault(); return true; }
        if (ctrl && (k === "y" || k === "Y")) { doRedo(); e.preventDefault(); return true; }
        if (ctrl && (k === "d" || k === "D")) { duplicate(); e.preventDefault(); return true; }
        if (k === "Escape") { if (draft) cancelDraft(); else if (tool !== "select") setTool("select"); else if (sel) select(null); return true; }
        if (k === "Enter" && draft) { finishDraft(); return true; }
        if (k === "Backspace" && draft) { draft.pts.pop(); if (!draft.pts.length) cancelDraft(); else renderDraft(); e.preventDefault(); return true; }
        if ((k === "Delete" || k === "Backspace") && sel) { remove(sel); e.preventDefault(); return true; }
        return false;
      },
    };
    A.setHooks(hooks);

    function select(id) { sel = id; renderSelection(); renderList(); renderCard(); }
    function remove(id) { mutate(() => { S.items = S.items.filter((i) => i.id !== id); if (sel === id) sel = null; }); }
    function duplicate() {
      const it = S.items.find((i) => i.id === sel);
      if (!it) return;
      mutate(() => { const c = JSON.parse(JSON.stringify(it)); c.id = "i" + S.seq++; c.pts = c.pts.map((p) => [p[0] + 8, p[1] + 8]); S.items.push(c); sel = c.id; });
    }
    function add(it) { mutate(() => { S.items.push(it); sel = it.id; }); }

    function onTool(e) {
      if (tool === "select") { const p = pickItem(e); select(p ? p.id : null); return; }
      const k = K[tool];
      const h = worldHit(e);
      if (!h) return;
      if (tool === "route") { routeClick(h); return; }
      if (tool === "wifi_pick") {
        const pb = h.item ? S.items.find((i) => i.id === h.item && i.kind === "building") : null;
        const b = h.b || (!pb && bldAt(h.x, h.z));
        if (!b && !pb) { A.toast("Click a building to measure Wi-Fi inside it"); return; }
        const ring = pb ? pb.pts : b.rings[0];
        mutate(() => {
          const list = S.meta.wifi_buildings || (S.meta.wifi_buildings = []);
          const i = list.findIndex((ll) => { const q = fromLL(ll[0], ll[1]); return pip(q[0], q[1], ring); });
          if (i >= 0) list.splice(i, 1);
          else { const q = pb ? mean(pb.pts) : insidePoint(b, h.x, h.z); list.push(toLL(q[0], q[1])); }
        });
        return;
      }
      if (tool === "light_road") { lightRoad(h); return; }
      if (!k) return;
      if (k.geom === "point") {
        let pt = [h.x, h.z];
        add(newItem(tool, [pt]));
        return;
      }
      if (k.geom === "on-building") {
        const pb = h.item ? S.items.find((i) => i.id === h.item && i.kind === "building") : null;
        if (["demolish", "building_edit"].includes(tool)) {
          const b = h.b;
          if (!b) { A.toast(pb ? "This building was added in this scenario: select it and edit or delete it instead" : "Click an existing building"); return; }
          const prev = S.items.find((it) => (it.kind === "demolish" || it.kind === "building_edit") && bldAt(it.pts[0][0], it.pts[0][1]) === b);
          if (prev) { select(prev.id); A.toast("This building already has a change in this scenario"); return; }
          add(newItem(tool, [insidePoint(b, h.x, h.z)], tool === "building_edit" ? { floors: b.f + 1, type: "" } : {}));
          return;
        }
        if (!h.b && !pb) { A.toast("Click on a roof"); return; }
        add(newItem(tool, [pb ? [h.x, h.z] : insidePoint(h.b, h.x, h.z)]));
        return;
      }
      if (k.geom === "on-tree") {
        const t = treeAt(h.x, h.z, 7);
        if (t < 0) { A.toast("No mapped tree here. Zoom in and click on a tree."); return; }
        const prev = S.items.find((it) => it.kind === tool && treeAt(it.pts[0][0], it.pts[0][1], 1) === t);
        if (prev) { select(prev.id); return; }
        add(newItem(tool, [[TR[t * 3], TR[t * 3 + 1]]]));
        return;
      }
      // Lines and polygons
      let pt = [h.x, h.z];
      if (tool === "road") pt = snapRoad(h.x, h.z, 10) || pt;
      if (!draft) draft = { kind: tool, pts: [] };
      const last = draft.pts[draft.pts.length - 1];
      if (last && Math.hypot(last[0] - pt[0], last[1] - pt[1]) < 0.5) return;
      draft.pts.push(pt);
      if (shape === "rect" && (tool === "building" || tool === "area") && draft.pts.length === 3) { draft.pts = rectFrom(draft.pts); finishDraft(); return; }
      renderDraft();
      showDrawBar();
    }
    function rectFrom([a, b, c]) {
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      const d = (c[0] - a[0]) * nx + (c[1] - a[1]) * nz;
      return [a, b, [b[0] + nx * d, b[1] + nz * d], [a[0] + nx * d, a[1] + nz * d]];
    }
    function renderDraft() {
      dispose(draft3d);
      if (!draft && tool !== "route") return;
      if (draft && draft.pts.length) {
        let pts = [...draft.pts];
        if (hoverPt) pts.push(hoverPt);
        const rect = shape === "rect" && (draft.kind === "building" || draft.kind === "area");
        if (rect && pts.length === 3) pts = rectFrom(pts);
        const closed = draft.kind !== "road" && (rect ? pts.length === 4 : pts.length > 2);
        if (pts.length >= 2) draft3d.add(drapedLine(pts, 0xb97c0c, 1.0, closed, { top: true }));
        if (closed && pts.length >= 3) { const f = fillPoly(pts, 0xb97c0c, 0.6, 0.25); if (f) draft3d.add(f); }
        for (const p of draft.pts) { const h = new THREE.Sprite(handleMat); h.position.set(p[0], A.H(p[0], p[1]) + 1, p[1]); h.scale.set(0.013, 0.013, 1); h.renderOrder = 25; draft3d.add(h); }
        const L = draft.kind === "road" ? lineLen(pts) : closed ? area(pts) : 0;
        $("plan-draw-info").textContent = draft.kind === "road" ? fmt(L) + " m" : closed ? fmt(L) + " m²" : "";
      }
      if (hoverPt && (tool === "road" || tool === "route")) {
        const ring = [];
        for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push([hoverPt[0] + Math.cos(a) * 2.5, hoverPt[1] + Math.sin(a) * 2.5]); }
        draft3d.add(drapedLine(ring, 0xb97c0c, 0.9, true, { top: true }));
      }
      A.markDirty();
    }
    function showDrawBar() {
      const bar = $("plan-draw");
      if (!draft) { bar.hidden = true; return; }
      const rect = shape === "rect" && (draft.kind === "building" || draft.kind === "area");
      const n = draft.pts.length;
      const tip = rect ? ["Click the first corner", "Click the second corner (one wall)", "Click to set the depth"][Math.min(n, 2)] : draft.kind === "road" ? (n < 2 ? "Click along the route" : "Keep clicking, or finish") : n < 3 ? "Click the corners" : "Keep clicking, or finish";
      $("plan-draw-tip").textContent = tip;
      $("plan-draw-done").hidden = rect || n < (draft.kind === "road" ? 2 : 3);
      bar.hidden = false;
    }
    function finishDraft() {
      if (!draft) return;
      const k = draft.kind, pts = draft.pts.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.3);
      draft = null; hoverPt = null; renderDraft(); showDrawBar();
      if (k === "road" ? pts.length < 2 : pts.length < 3) return;
      add(newItem(k, pts));
    }
    function cancelDraft() { draft = null; hoverPt = null; dispose(draft3d); showDrawBar(); A.markDirty(); }

    // "Light a road": lights along a mapped road on alternate sides.
    function lightRoad(h) {
      const ne = A.nearestEdge(h.x, h.z, 25);
      if (!ne) { A.toast("Click on a road"); return; }
      const r = D.roads[GE[ne.k][2]];
      if (!r) return;
      const spacing = +$("plan-light-spacing").value || 30;
      const P = [];
      for (let i = 0; i < r.p.length; i += 2) P.push([r.p[i], r.p[i + 1]]);
      const out = [];
      let acc = spacing / 2, side = 1;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.1) continue;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        while (acc < L) {
          const x = a[0] + ux * acc - uz * side * (r.w / 2 + 1), z = a[1] + uz * acc + ux * side * (r.w / 2 + 1);
          if (Math.hypot(x - h.x, z - h.z) < 800 && A.inCB(x, z) && !bldAt(x, z)) out.push([x, z]);
          acc += spacing; side = -side;
        }
        acc -= L;
      }
      if (!out.length) { A.toast("Nothing to light here"); return; }
      mutate(() => { for (const p of out) S.items.push(newItem("street_light", [p])); });
      A.toast(`Added ${out.length} street lights along ${r.n || "this road"} (every ${spacing} m, within 800 m)`);
    }

    // ---------------------------------------------------------------------------------------
    // Engine runs
    let evalTimer = 0;
    function schedule() {
      autosave();
      if (!autoRun) { stale = true; renderSim(); return; }
      clearTimeout(evalTimer); evalTimer = setTimeout(runEngine, 140);
    }
    async function runEngine() {
      try { await E.load(); } catch (e) { A.toast(e.message || String(e)); return; }
      const t0 = performance.now();
      try {
        const r = E.str("plan_set", JSON.stringify(forEngine(toGeoJSON())));
        if (r.rc) { A.toast(r.json.msg || "Plan could not be read"); return; }
        R = E.call("plan_evaluate");
        R.byId = Object.fromEntries(R.items.map((x) => [x.id, x]));
      } catch (e) { E.fail(e); return; }
      console.info(`[sandbox] evaluated ${S.items.length} items in ${(performance.now() - t0).toFixed(0)} ms`);
      applyGraph();
      stale = false;
      renderItems(); renderList(); renderCard(); renderKpis(); renderSim(); renderBudget();
      refreshOverlays(true);
      autosave();
    }
    function applyGraph() {
      if (!showPlan || !R) { A.applyPlanGraph(null); return; }
      const roads = [];
      S.items.forEach((it, i) => {
        if (it.kind !== "road" || it.pts.length < 2) return;
        const [w, , c] = ROAD[it.props.type] || ROAD.lane;
        roads.push([i, { p: it.pts.flat(), w, c, n: it.name || null, s: null, br: false }]);
      });
      A.applyPlanGraph(R.graph, roads);
    }

    // ---------------------------------------------------------------------------------------
    // Overlays: Wi-Fi and light heatmaps, dark spots, catchments, routes
    const OV = { wifi: false, lux: false, night: false, floor: 0, catch: false, key: "", at: null };
    const WIFI_STOPS = [[-50, 26, 152, 80, 210], [-60, 102, 189, 99, 200], [-67, 166, 217, 106, 190], [-72, 254, 224, 139, 165], [-78, 253, 174, 97, 120], [-85, 244, 109, 67, 55], [-90, 215, 48, 39, 0]];
    const LUX_STOPS = [[30, 255, 252, 235, 235], [15, 255, 240, 175, 220], [8, 255, 214, 110, 205], [4, 250, 170, 70, 185], [1, 205, 110, 60, 130], [0.3, 120, 80, 130, 60], [0.1, 60, 50, 110, 0]];
    function ramp(stops, v) {
      if (v >= stops[0][0]) return stops[0].slice(1);
      for (let i = 1; i < stops.length; i++) if (v >= stops[i][0]) { const a = stops[i - 1], b = stops[i], t = (v - b[0]) / (a[0] - b[0]); return [1, 2, 3, 4].map((k) => b[k] + (a[k] - b[k]) * t); }
      return null;
    }
    function overlayMesh(x0, z0, cell, nx, nz, rgba, lift, additive) {
      const tex = new THREE.DataTexture(rgba, nx, nz, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
      const W = nx * cell, Hh = nz * cell, sx = Math.max(2, Math.round(W / 30)), sz = Math.max(2, Math.round(Hh / 30));
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= sz; j++) for (let i = 0; i <= sx; i++) { const x = x0 + (W * i) / sx, z = z0 + (Hh * j) / sz; pos.push(x, A.H(x, z) + lift, z); uv.push(i / sx, j / sz); }
      for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) { const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      m.renderOrder = 6; m.userData.own = true; m.userData.ownMat = true;
      return m;
    }
    function viewWindow(maxHalf, minCell) {
      const v = A.view, half = Math.max(120, Math.min(maxHalf, v.dist * 0.8));
      const cell = Math.max(minCell, (half * 2) / 520);
      const n = Math.ceil((half * 2) / cell);
      return { x0: v.tx - half, z0: v.tz - half, cell, nx: n, nz: n, half };
    }
    async function refreshOverlays(force) {
      if (!OV.wifi && !OV.lux && !OV.catch && !routeLines.length) { if (over3d.children.length) { dispose(over3d); A.markDirty(); } legend(); return; }
      try { await E.load(); } catch (e) { return; }
      if (!R) return;
      const which = showPlan ? 1 : 0;
      // Wi-Fi rays cost grows with 1/cell²: 3 m is plenty for rooms and keeps a refresh near 0.3 s.
      const win = viewWindow(OV.lux && !OV.wifi ? 650 : 900, OV.wifi ? 3 : 1.5);
      const key = [OV.wifi, OV.lux, OV.floor, OV.catch, which, Math.round(win.x0), Math.round(win.z0), Math.round(win.cell * 10)].join(",");
      if (!force && key === OV.key) return;
      OV.key = key; OV.at = { tx: A.view.tx, tz: A.view.tz, dist: A.view.dist };
      dispose(over3d);
      try {
        if (OV.wifi) {
          const n = win.nx * win.nz, g = E.grid("plan_wifi_grid", n, win.x0, win.z0, win.cell, win.nx, win.nz, OV.floor, which);
          const rgba = new Uint8Array(n * 4);
          for (let i = 0; i < n; i++) { const c = g[i] > -199 ? ramp(WIFI_STOPS, g[i]) : null; if (c) rgba.set(c, i * 4); }
          over3d.add(overlayMesh(win.x0, win.z0, win.cell, win.nx, win.nz, rgba, 1.0 + OV.floor * 3.3, false));
        }
        if (OV.lux) {
          const n = win.nx * win.nz, g = E.grid("plan_lux_grid", n, win.x0, win.z0, win.cell, win.nx, win.nz, which);
          const rgba = new Uint8Array(n * 4);
          for (let i = 0; i < n; i++) { const c = g[i] > 0.1 ? ramp(LUX_STOPS, g[i]) : null; if (c) rgba.set(c, i * 4); }
          over3d.add(overlayMesh(win.x0, win.z0, win.cell, win.nx, win.nz, rgba, 0.9, OV.night));
          if (showPlan) for (const [x, z] of R.light.dark) {
            const ring = []; for (let k = 0; k <= 20; k++) { const a = (k / 20) * Math.PI * 2; ring.push([x + Math.cos(a) * 6, z + Math.sin(a) * 6]); }
            over3d.add(drapedLine(ring, 0xd7301f, 1.3, true, { top: true }));
          }
        }
      } catch (e) { E.fail(e); return; }
      if (OV.catch && showPlan) {
        const rad = E.cat.facilities;
        for (const it of S.items) if (rad[it.kind]) {
          const [x, z] = it.pts[0], r = rad[it.kind], ring = [];
          for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; ring.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
          over3d.add(drapedLine(ring, parseInt((COL[it.kind] || "#555").slice(1), 16), 1.0, true, { opacity: 0.8 }));
        }
      }
      for (const l of routeLines) over3d.add(l());
      legend();
      A.markDirty();
    }
    setInterval(() => {
      if (!(OV.wifi || OV.lux) || !OV.at || A.mode() === "street") return;
      const v = A.view, half = Math.max(120, Math.min(900, OV.at.dist * 0.8));
      if (Math.hypot(v.tx - OV.at.tx, v.tz - OV.at.tz) > half * 0.35 || v.dist / OV.at.dist > 1.5 || OV.at.dist / v.dist > 1.5) refreshOverlays();
    }, 600);
    function legend() {
      const el = $("plan-legend");
      const parts = [];
      if (OV.wifi) parts.push(`<b>Wi-Fi signal${OV.floor ? ", floor " + OV.floor : ", ground floor"}</b><div class="ramp" style="background:linear-gradient(90deg,#d7302700,#f46d43,#fdae61,#fee08b,#a6d96a,#66bd63,#1a9850)"></div><div class="ramp-l"><span>-90</span><span>-75 usable</span><span>-67 good</span><span>-50 dBm</span></div>`);
      if (OV.lux) parts.push(`<b>Street light on the ground</b><div class="ramp" style="background:linear-gradient(90deg,#3c326e00,#cd6e3c,#faaa46,#ffd66e,#fff0af,#fffceb)"></div><div class="ramp-l"><span>0.3</span><span>4</span><span>8</span><span>15</span><span>30 lux</span></div>${R && R.light.dark.length && showPlan ? `<div class="note">Red rings: dark spots on lit roads</div>` : ""}`);
      if (OV.catch) parts.push(`<b>Walking catchments</b><div class="note">Circles show each amenity's reach; the numbers use real walking routes.</div>`);
      el.innerHTML = parts.join("<hr>");
      el.hidden = !parts.length;
    }

    // Route tool
    let routeA = null, routeLines = [], routeRes = null;
    function routeClick(h) {
      if (!routeA) { routeA = [h.x, h.z]; routeLines = [() => marker(routeA, 0x2b6896)]; routeRes = null; refreshOverlays(true); renderSim(); A.toast("Now click where you are going"); return; }
      const b = [h.x, h.z], a = routeA;
      routeA = null;
      try {
        const r0 = E.call("plan_route", a[0], a[1], b[0], b[1], 0), r1 = E.call("plan_route", a[0], a[1], b[0], b[1], 1);
        routeRes = { a, b, base: r0, plan: r1 };
      } catch (e) { E.fail(e); return; }
      const toPts = (r) => { const out = []; for (let i = 0; i < r.path.length; i += 2) out.push([r.path[i], r.path[i + 1]]); return out; };
      routeLines = [() => marker(a, 0x2b6896), () => marker(b, 0xb03a2e)];
      if (routeRes.base.ok) routeLines.push(() => drapedLine(toPts(routeRes.base), 0x6b7075, 1.6, false, { top: true, dashed: true }));
      if (routeRes.plan.ok && showPlan) routeLines.push(() => drapedLine(toPts(routeRes.plan), 0xe67e22, 1.8, false, { top: true }));
      refreshOverlays(true); renderSim();
      setTool("select");
      document.querySelector('#plan-tabs [data-ptab="sim"]').click();
    }
    function marker(p, color) {
      const g = new THREE.Group(), ring = [];
      for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push([p[0] + Math.cos(a) * 5, p[1] + Math.sin(a) * 5]); }
      g.add(drapedLine(ring, color, 1.4, true, { top: true }));
      return g;
    }

    // ---------------------------------------------------------------------------------------
    // Panel
    function setTool(t) {
      if (draft && t !== tool) cancelDraft();
      tool = t;
      document.body.dataset.tool = t;
      document.querySelectorAll("#plan-tools [data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === t));
      const k = K[t];
      const help = t === "select" ? "Click anything you added to edit it; drag the selected item or its corners to move them. Delete removes it; Ctrl+Z undoes."
        : t === "light_road" ? "Click a mapped road to line it with street lights."
        : t === "route" ? "Click where you start, then where you are going."
        : t === "wifi_pick" ? "Click buildings to add or remove them from the Wi-Fi measurement."
        : (k && k.help) || (k && k.geom === "point" ? "Click on the map to place it. Keep clicking to place more; Esc when done." : "");
      const shapeUi = t === "building" || t === "area" ? `<div class="seg small" id="plan-shape"><button data-shape="rect" aria-pressed="${shape === "rect"}">Rectangle</button><button data-shape="free" aria-pressed="${shape === "free"}">Any shape</button></div>` : "";
      const lightUi = t === "light_road" ? `<label class="inline">Every <select id="plan-light-spacing"><option>25</option><option selected>30</option><option>35</option><option>40</option></select> m</label>` : "";
      $("plan-help").innerHTML = `<div>${esc(help)}</div>${shapeUi}${lightUi}`;
      $("plan-help").hidden = !help;
      const sh = $("plan-shape");
      if (sh) sh.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; shape = b.dataset.shape; cancelDraft(); setTool(tool); });
      renderSelection();
      A.canvas.style.cursor = t === "select" ? "" : "crosshair";
    }
    const warnOf = (it) => R && R.byId && R.byId[it.id] && R.byId[it.id].warn.length ? R.byId[it.id].warn : null;
    function infoRows(it, r) {
      const i = (r && r.info) || {}, rows = [];
      if (i.area != null && it.kind !== "solar_roof") rows.push(["Footprint", fmt(i.area) + " m²"]);
      if (i.gfa != null) rows.push(["Floor area", fmt(i.gfa) + " m²"]);
      if (i.people) rows.push(["About", fmt(i.people) + " people"]);
      if (i.length != null) rows.push(["Length", fmt(i.length) + " m"]);
      if (i.junctions != null) rows.push(["Joins the network at", i.junctions + (i.junctions === 1 ? " point" : " points")]);
      if (i.lights) rows.push(["Street lights", fmt(i.lights)]);
      if (i.building) rows.push(["Building", `${esc(i.building.name || A.TYPE_LABEL[i.building.type] || i.building.type)} · ${i.building.floors} floors · ${fmt(i.building.area)} m²`]);
      if (i.kwp != null) rows.push(["Solar", fmt(i.kwp, 1) + " kWp" + (i.kwh ? " · " + fmt(i.kwh) + " kWh a year" : "")]);
      if (i.m3 != null) rows.push(["Rain collected", fmt(i.m3) + " m³ a year"]);
      if (i.added) rows.push(["Added floor area", fmt(i.added) + " m²"]);
      if (i.tree) rows.push(["Tree", i.tree + (i.height ? ` · about ${i.height} m tall` : "")]);
      return rows;
    }
    function field(p, it) {
      const v = it.props[p.key] != null ? it.props[p.key] : p.default;
      if (p.type === "select") {
        let opts = p.options;
        if (opts === "$types") opts = (it.kind === "building_edit" ? [["", "Keep as it is"]] : []).concat(D.meta.types);
        return `<label><span>${esc(p.label)}</span><select data-p="${p.key}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
      }
      if (p.type === "number") return `<label><span>${esc(p.label)}</span><span class="numu"><input type="number" data-p="${p.key}" value="${esc(v)}" min="${p.min}" max="${p.max}" step="${p.step || 1}">${p.unit ? `<i>${esc(p.unit)}</i>` : ""}</span></label>`;
      return `<label><span>${esc(p.label)}</span><input type="text" data-p="${p.key}" value="${esc(v)}"></label>`;
    }
    function renderCard() {
      const card = $("plan-card");
      const it = S.items.find((i) => i.id === sel);
      document.body.classList.toggle("plan-card-open", !!it && A.mode() === "plan");
      if (!it || A.mode() !== "plan") { card.hidden = true; return; }
      const k = K[it.kind] || { label: it.kind, params: [] }, r = R && R.byId && R.byId[it.id];
      const rows = infoRows(it, r);
      const warn = (r && r.warn) || [];
      card.innerHTML = `
        <button class="icon-btn close" id="plan-card-close" aria-label="Close"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="card-head">${svg(it.kind, COL[it.kind])}<h2>${esc(k.label)}</h2></div>
        <input class="name" data-f="name" placeholder="Name (optional)" value="${esc(it.name)}">
        <div class="seg small status"><button data-status="proposed" aria-pressed="${it.status === "proposed"}" title="Part of the plan">Proposed</button><button data-status="existing" aria-pressed="${it.status === "existing"}" title="Already on the ground: counts as today">Existing</button></div>
        <div class="fields">${k.params.map((p) => field(p, it)).join("")}</div>
        ${rows.length ? `<table class="kv">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>` : ""}
        ${warn.map((w) => `<div class="pwarn">${esc(w)}</div>`).join("")}
        <div class="actions">
          <button data-act="zoom">Zoom to</button>
          ${["building", "road", "area", "building_edit"].includes(it.kind) ? '<button data-act="street">See at street level</button>' : ""}
          <button data-act="dup">Duplicate</button>
          <button data-act="del" class="danger">Delete</button>
        </div>`;
      card.hidden = false;
      $("plan-card-close").onclick = () => select(null);
      card.querySelectorAll("[data-p]").forEach((el) => el.addEventListener("change", () => {
        const p = k.params.find((q) => q.key === el.dataset.p);
        let v = el.value;
        if (p && p.type === "number") { v = Number(v); if (!Number.isFinite(v)) return; if (p.min != null) v = Math.max(p.min, v); if (p.max != null) v = Math.min(p.max, v); }
        mutate(() => { if (v === "" && it.kind === "building_edit") delete it.props[el.dataset.p]; else it.props[el.dataset.p] = v; });
      }));
      card.querySelector("[data-f=name]").addEventListener("change", (e) => mutate(() => { it.name = e.target.value.trim(); }));
      card.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => mutate(() => { it.status = b.dataset.status; })));
      card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.act;
        if (a === "del") remove(it.id);
        else if (a === "dup") duplicate();
        else if (a === "zoom") fitTo([it]);
        else if (a === "street") { const c = it.g === "point" ? it.pts[0] : it.kind === "road" ? it.pts[0] : mean(it.pts); A.enterStreet(c[0], c[1]); }
      }));
    }
    function fitTo(list) {
      const pts = list.flatMap((i) => i.pts);
      if (!pts.length) return;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
      A.flyTo({ tx: (x0 + x1) / 2, tz: (z0 + z1) / 2, dist: Math.max(180, Math.max(x1 - x0, z1 - z0) * 1.6) });
    }
    function delta(a, b, f = pct) { return `<span class="d0">${f(a)}</span><svg class="i arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg><span class="d1${b > a ? " up" : b < a ? " down" : ""}">${f(b)}</span>`; }
    async function suggestWifi() {
      if (!R) return;
      const picks = (S.meta.wifi_buildings || []).map((ll) => fromLL(ll[0], ll[1]));
      const band = $("wifi-band").value;
      // One building per call, re-applying the plan in between so neighbours share coverage.
      const n = picks.length || R.wifi.targets.length;
      if (!n) { A.toast("No buildings to cover: tick a type or pick buildings first"); return; }
      const before = snap(), added = [], rows = [];
      for (let k = 0; k < n; k++) {
        A.toast(`Placing access points: building ${k + 1} of ${n}…`);
        await new Promise((r) => setTimeout(r, 30));
        let res;
        try {
          E.str("plan_set", JSON.stringify(forEngine(toGeoJSON())));
          res = E.str("plan_suggest_wifi", JSON.stringify(picks.length ? { points: [picks[k]], band, power: 20, target: 0.95, max: 40 } : { points: [], only: k, band, power: 20, target: 0.95, max: 40 })).json;
        } catch (e) { E.fail(e); return; }
        for (const a of res.aps || []) { const it = newItem("wifi_ap", [[a.x, a.z]], { band, power: 20, floor: a.floor, pole: 6 }); S.items.push(it); added.push(it); }
        rows.push(...(res.buildings || []));
      }
      if (!added.length) { A.toast("Those buildings already have good signal"); return; }
      undo.push(before); redo.length = 0;
      changed();
      const b0 = rows.reduce((s, b) => s + b.before, 0) / rows.length, b1 = rows.reduce((s, b) => s + b.after, 0) / rows.length;
      A.toast(`Added ${added.length} access points in ${rows.filter((b) => b.added).length} buildings: good signal ${pct(b0)} → ${pct(b1)} on average`);
    }
    const slug = () => (S.meta.title || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
    function download(name, text, type) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    $("plan-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try { loadPlan(JSON.parse(await f.text()), "Opened " + f.name); $("plan-title").value = S.meta.title; } catch (err) { A.toast("Could not open that file: " + err.message); }
    });

    // Share links: #plan=<deflate-raw, base64url>
    const b64u = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    async function shareLink() {
      const txt = JSON.stringify(toGeoJSON());
      let code;
      if (window.CompressionStream) code = "z" + b64u(new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()));
      else code = "j" + b64u(enc.encode(txt));
      const url = location.href.split("#")[0] + "#plan=" + code;
      try { await navigator.clipboard.writeText(url); A.toast(`Link copied (${fmt(url.length)} characters). Anyone with it sees this plan.`); } catch (e) { window.prompt("Copy this link", url); }
    }
    async function readShared(code) {
      const raw = unb64u(code.slice(1));
      if (code[0] === "z") return JSON.parse(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
      return JSON.parse(dec.decode(raw));
    }

    // ---------------------------------------------------------------------------------------
    // Categories and item types. Built-in types come from the engine catalogue; people can add
    // their own, which live in this browser and travel inside every scenario file.
    const KINDS_KEY = "pantnagar-sandbox:kinds:v1";
    const store = {
      get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
      del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
    };
    let customKinds = [];
    try { customKinds = JSON.parse(store.get(KINDS_KEY)) || []; } catch (e) { customKinds = []; }
    const saveKinds = () => store.set(KINDS_KEY, JSON.stringify(customKinds));
    function mergeKinds(list) {
      for (const k of list || []) {
        if (!k || !k.key) continue;
        const i = customKinds.findIndex((x) => x.key === k.key);
        if (i >= 0) customKinds[i] = { ...customKinds[i], ...k }; else customKinds.push(k);
      }
      saveKinds();
    }
    function buildK() {
      K = Object.fromEntries(E.cat.kinds.map((k) => [k.key, k]));
      for (const c of customKinds) { K[c.key] = { key: c.key, label: c.label, group: c.category, geom: c.geom, params: [], custom: true, help: c.geom === "point" ? "" : c.geom === "line" ? "Click along the line; double-click or Enter to finish." : "Click the corners; double-click or Enter to finish." }; COL[c.key] = c.color || "#5b6168"; }
    }
    function categories() {
      const list = E.cat.groups.map(([key, label]) => ({ key, label }));
      for (const c of customKinds) if (!list.some((g) => g.key === c.category)) list.push({ key: c.category, label: c.categoryLabel || c.category, custom: true });
      return list;
    }
    const catLabel = (key) => (categories().find((c) => c.key === key) || { label: key }).label;
    const catOf = (kind) => (kind === "light_road" ? "lighting" : (K[kind] && K[kind].group) || "notes");
    const catOn = (key) => !(S.meta.categories_off || []).includes(key);
    const itemOn = (it) => catOn(catOf(it.kind));
    // Budget line key -> category ("road:lane" -> roads, "building_add" -> buildings).
    const lineCat = (key) => { const k = key.split(":")[0]; return k === "building_add" ? "buildings" : catOf(k); };
    const usedCats = () => { const n = {}; for (const it of S.items) { const c = catOf(it.kind); n[c] = (n[c] || 0) + 1; } return n; };
    const DEFAULT_TARGETS = { wifi: 95, light: 90, access: 60, trees: 10 };
    const targets = () => ({ ...DEFAULT_TARGETS, access_by: {}, ...(S.meta.targets || {}) });

    // Total cost: items from the engine, the user's extra lines, contingency and taxes.
    function totals() {
      const b = R ? R.budget : { capex: 0, opex: 0, lines: [] }, B = S.meta.budget || {};
      const extras = (B.extra || []).reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.rate) || 0), 0);
      const base = b.capex + extras, cont = (base * (Number(B.contingency != null ? B.contingency : 5) || 0)) / 100, tax = ((base + cont) * (Number(B.tax) || 0)) / 100;
      return { items: b.capex, extras, base, cont, tax, total: base + cont + tax, opex: b.opex, cap: Number(B.cap) || 0 };
    }

    // What works and what does not: every simulated measure against its target.
    function verdicts() {
      if (!R) return [];
      const T = targets(), out = [];
      if (catOn("wifi") && R.wifi.plan.aps) out.push({ key: "wifi", label: "Wi-Fi: floor area with good signal", value: R.wifi.plan.good * 100, target: T.wifi, unit: "%", ok: R.wifi.plan.good * 100 >= T.wifi });
      if (catOn("lighting") && R.light.study_m) { const v = (R.light.plan.ok_m / R.light.study_m) * 100; out.push({ key: "light", label: "Lighting: road lit to IS 1944", value: v, target: T.light, unit: "%", ok: v >= T.light }); }
      for (const a of R.access) { const t = T.access_by[a.kind] != null ? T.access_by[a.kind] : T.access; out.push({ key: "access:" + a.kind, label: `${a.label}: people within ${a.radius} m`, value: a.plan.pct * 100, target: t, unit: "%", ok: a.plan.pct * 100 >= t }); }
      const lost = R.green.removed + R.green.affected;
      if (lost || R.green.planted) out.push({ key: "trees", label: "Trees lost", value: lost, target: T.trees, unit: "", ok: lost <= T.trees, max: true });
      const t = totals();
      if (t.cap > 0) out.push({ key: "budget", label: "Total cost within the budget", value: t.total, target: t.cap, money: true, ok: t.total <= t.cap, max: true });
      if (S.items.length) out.push({ key: "conflicts", label: "No conflicts (overlaps, loose roads, misplaced items)", value: R.warnings, target: 0, ok: R.warnings === 0, max: true, fixed: true });
      return out;
    }
    const vval = (v, x) => (v.money ? inr(x) : fmt(x, v.unit === "%" ? 0 : 0) + (v.unit || ""));
    function setTarget(key, val) {
      mutate(() => {
        if (key === "budget") { (S.meta.budget || (S.meta.budget = {})).cap = val; return; }
        const T = S.meta.targets || (S.meta.targets = {});
        if (key.startsWith("access:")) (T.access_by || (T.access_by = {}))[key.slice(7)] = val; else T[key] = val;
      });
    }

    function renderTools() {
      const extra = { lighting: [["light_road", "Light a road"]] };
      const n = usedCats();
      let h = `<div class="ptools"><button class="ptool" data-tool="select">${svg("select")}<span>Select</span></button></div>`;
      for (const c of categories()) {
        const ks = Object.values(K).filter((k) => k.group === c.key);
        if (!ks.length) continue;
        h += `<h4>${esc(c.label)}${n[c.key] ? ` <span class="cnt">${n[c.key]}</span>` : ""}</h4><div class="ptools">` +
          ks.map((k) => `<button class="ptool${k.custom ? " custom" : ""}" data-tool="${k.key}" title="${esc(k.help || k.label)}">${svg(k.key, COL[k.key])}<span>${esc(k.label)}</span></button>`).join("") +
          (extra[c.key] || []).map(([k, l]) => `<button class="ptool" data-tool="${k}">${svg(k, COL[k])}<span>${esc(l)}</span></button>`).join("") + `</div>`;
      }
      h += `<div class="actions"><button id="tools-new-type">${svg("plus")} New item type</button></div>`;
      $("plan-tools").innerHTML = h;
      $("tools-new-type").onclick = () => { showTab("types"); const d = $("type-new"); if (d) { d.open = true; const i = d.querySelector("[data-nt=label]"); if (i) i.focus(); } };
      setTool(tool);
    }
    function renderList() {
      $("plan-count").textContent = S.items.length ? String(S.items.length) : "";
      if (!S.items.length) { $("plan-items").innerHTML = `<li class="empty">Nothing here yet. Pick a tool and click on the map, or open a sample in the Report tab.</li>`; return; }
      const groups = new Map();
      for (const it of S.items) { const c = catOf(it.kind); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
      let h = "";
      for (const c of categories()) {
        const list = groups.get(c.key);
        if (!list) continue;
        const on = catOn(c.key);
        h += `<li class="grp${on ? "" : " off"}">${esc(c.label)} <span>${list.length}${on ? "" : " · not simulated"}</span></li>`;
        h += list.map((it) => {
          const w = warnOf(it);
          return `<li data-id="${it.id}" class="${it.id === sel ? "sel" : ""}${on ? "" : " off"}">${svg(it.kind, COL[it.kind])}<span class="t">${esc(itemTitle(it))}</span>${it.status === "existing" ? '<span class="pill">existing</span>' : ""}${w ? `<span class="warn" title="${esc(w.join(" "))}">!</span>` : ""}</li>`;
        }).join("");
      }
      $("plan-items").innerHTML = h;
    }
    function renderKpis() {
      const el = $("plan-kpis");
      if (!R) { el.innerHTML = ""; return; }
      const t = totals(), v = verdicts(), ok = v.filter((x) => x.ok).length, chips = [];
      chips.push(`<div class="kpi"><span>Total cost${t.cap ? ` of ${inr(t.cap)}` : ""}</span><b class="${t.cap && t.total > t.cap ? "bad" : ""}">${inr(t.total)}</b></div>`);
      chips.push(`<div class="kpi"><span>Running cost</span><b>${inr(t.opex)}<small>/yr</small></b></div>`);
      if (v.length) chips.push(`<button class="kpi ${ok === v.length ? "good" : "warn"}" id="kpi-verdict"><span>Targets met</span><b>${ok} of ${v.length}</b></button>`);
      for (const x of v.filter((x) => x.key === "wifi" || x.key === "light").slice(0, 2)) chips.push(`<div class="kpi"><span>${esc(x.label.split(":")[0])}</span><b class="${x.ok ? "ok" : "bad"}">${fmt(x.value)}%<small> / ${x.target}%</small></b></div>`);
      el.innerHTML = chips.join("");
      const kv = $("kpi-verdict");
      if (kv) kv.onclick = () => showTab("sim");
    }

    // Simulate: choose categories, run, read the verdicts, then the details per model.
    let autoRun = store.get("pantnagar-sandbox:autorun") !== "0", stale = false;
    function catChips(id) {
      const n = usedCats();
      const cats = categories().filter((c) => n[c.key]);
      if (!cats.length) return `<div class="note">Add something to the scenario first.</div>`;
      return `<div class="catchips" id="${id}">${cats.map((c) => `<label class="catchip${catOn(c.key) ? " on" : ""}"><input type="checkbox" data-cat="${c.key}" ${catOn(c.key) ? "checked" : ""}>${esc(c.label)} <small>${n[c.key]}</small></label>`).join("")}
        <span class="catall"><button data-catall="1">All</button><button data-catall="0">None</button></span></div>`;
    }
    function wireCatChips(root) {
      root.querySelectorAll("[data-cat]").forEach((c) => c.addEventListener("change", () => mutate(() => {
        const off = new Set(S.meta.categories_off || []);
        c.checked ? off.delete(c.dataset.cat) : off.add(c.dataset.cat);
        S.meta.categories_off = [...off];
      })));
      root.querySelectorAll("[data-catall]").forEach((b) => b.addEventListener("click", () => mutate(() => {
        S.meta.categories_off = b.dataset.catall === "1" ? [] : Object.keys(usedCats());
      })));
    }
    function renderSim() {
      const el = $("ptab-sim");
      if (!E.cat) return;
      const types = ["hostel", "academic", "admin", "institutional", "school", "health", "residential"];
      const tgt = new Set(S.meta.wifi_targets || []);
      const counts = D.meta.counts.buildings_in_campus_by_type;
      const w = R && R.wifi, l = R && R.light, g = R && R.green;
      const v = verdicts(), ok = v.filter((x) => x.ok).length;
      let h = `<section class="sim run"><h3>${svg("check")} Simulate these categories</h3>${catChips("sim-cats")}
        <div class="runbar"><button id="sim-run" class="primary">${svg("play")} Run simulation</button><label class="toggle"><input type="checkbox" id="sim-auto" ${autoRun ? "checked" : ""}> Run automatically as I edit</label></div>
        ${stale ? `<div class="pwarn">Results are out of date: press Run simulation.</div>` : ""}</section>`;
      if (R && v.length) {
        h += `<section class="sim verdicts"><h3>${svg("target")} What works <span class="vsum ${ok === v.length ? "ok" : "bad"}">${ok} of ${v.length} targets met</span></h3>
          <table class="vt"><thead><tr><th></th><th>Check</th><th>Result</th><th>Target</th></tr></thead><tbody>
          ${v.map((x) => `<tr class="${x.ok ? "ok" : "bad"}"><td>${x.ok ? "✓" : "✗"}</td><td>${esc(x.label)}</td><td>${vval(x, x.value)}</td><td>${x.fixed ? (x.max ? "0" : "") : `<span class="tin">${x.max ? "≤" : "≥"} <input type="number" data-target="${esc(x.key)}" value="${x.money ? x.target : Math.round(x.target)}" min="0" step="any">${x.unit === "%" ? "%" : ""}</span>`}</td></tr>`).join("")}
          </tbody></table><div class="note">Edit a target to change what counts as working. A budget limit can be set in the Budget tab.</div></section>`;
      }
      const showWifi = catOn("wifi"), showLight = catOn("lighting");
      const showAccess = (R && R.access.length) || ["mobility", "amenities", "waste", "water"].some((c) => catOn(c) && usedCats()[c]);
      const showGreen = ["trees", "water", "energy", "buildings"].some((c) => catOn(c) && usedCats()[c]);
      if (showWifi) h += `<section class="sim"><h3>${svg("wifi_ap", COL.wifi_ap)} Wi-Fi coverage</h3>
        <div class="toggles"><label class="toggle"><input type="checkbox" id="ov-wifi" ${OV.wifi ? "checked" : ""}> Signal map</label>
        <label class="inline">Floor <select id="ov-floor">${Array.from({ length: 8 }, (_, i) => `<option value="${i}"${i === OV.floor ? " selected" : ""}>${i === 0 ? "Ground" : i}</option>`).join("")}</select></label></div>
        <div class="note">Measured in: ${types.filter((t) => counts[t]).map((t) => `<label class="tchk"><input type="checkbox" data-wt="${t}" ${tgt.has(t) ? "checked" : ""}>${esc(A.TYPE_LABEL[t] || t)} <small>${counts[t]}</small></label>`).join("")}
        ${(S.meta.wifi_buildings || []).length ? `<span class="pill">+${S.meta.wifi_buildings.length} picked</span>` : ""}</div>
        ${w ? `<div class="big">${delta(w.base.good, w.plan.good)} <span class="note">of ${fmt(w.gfa)} m² floor area gets good signal (-67 dBm), with ${w.plan.aps} access point${w.plan.aps === 1 ? "" : "s"}</span></div>` : ""}
        ${w && w.targets.length ? `<details ${w.targets.length <= 6 ? "open" : ""}><summary>${w.targets.length} buildings</summary><table class="kv">${w.targets.slice().sort((a, b) => a.plan.good - b.plan.good).map((t) => `<tr data-go="${t.c[0]},${t.c[1]}"><td>${esc(t.name)} <small>${t.floors} fl</small></td><td>${delta(t.base.good, t.plan.good)}</td></tr>`).join("")}</table></details>` : ""}
        <div class="actions"><button id="wifi-pick">${tool === "wifi_pick" ? "Done picking" : "Pick buildings"}</button><button id="wifi-suggest" class="primary">Suggest access points</button>
        <select id="wifi-band" title="Band for suggested access points"><option value="5">5 GHz</option><option value="2.4">2.4 GHz</option></select></div></section>`;
      if (showLight) h += `<section class="sim"><h3>${svg("street_light", COL.street_light)} Street lighting</h3>
        <div class="toggles"><label class="toggle"><input type="checkbox" id="ov-lux" ${OV.lux ? "checked" : ""}> Light on the ground</label><label class="toggle"><input type="checkbox" id="ov-night" ${OV.night ? "checked" : ""}> Night view</label></div>
        ${l && l.study_m ? `<div class="big">${delta(l.base.ok_m / l.study_m, l.plan.ok_m / l.study_m)} <span class="note">of ${fmt(l.study_m)} m of road near the lights meets IS 1944 (15 / 8 / 4 lux)</span></div>
          <table class="kv"><tr><td>Average on the road</td><td>${fmt(l.base.avg, 1)} → <b>${fmt(l.plan.avg, 1)} lux</b></td></tr><tr><td>Darkest point</td><td>${fmt(l.base.min, 1)} → <b>${fmt(l.plan.min, 1)} lux</b></td></tr><tr><td>Evenness (min / avg)</td><td>${fmt(l.plan.u0, 2)}</td></tr><tr><td>Dark spots</td><td>${l.dark.length}</td></tr><tr><td>Energy</td><td>${fmt(l.kwh)} kWh a year</td></tr></table>`
          : `<div class="note">Place street lights (or use "Light a road") to see how well roads are lit. The street lights drawn on the map are illustrative, not surveyed: map real ones as "existing" to include them.</div>`}
      </section>`;
      if (showAccess) h += `<section class="sim"><h3>${svg("bike_dock", COL.bike_dock)} Walking access</h3>
        <div class="toggles"><label class="toggle"><input type="checkbox" id="ov-catch" ${OV.catch ? "checked" : ""}> Catchments</label></div>
        ${R && R.access.length ? `<table class="kv">${R.access.map((a) => `<tr><td>${esc(a.label)} <small>≤ ${a.radius} m, ${a.plan.count}</small></td><td>${delta(a.base.pct, a.plan.pct)}</td></tr>`).join("")}</table><div class="note">Share of people in campus buildings (estimated from floor area) who can walk to one within that distance on real roads and paths. Change the distance in the Types tab.</div>`
          : `<div class="note">Amenities with a walking reach (docks, water points, bins, vending machines, shuttle stops, or your own types) show who can reach them on foot.</div>`}
      </section>`;
      const rr = routeRes;
      h += `<section class="sim"><h3>${svg("route", COL.route)} Route</h3>
        <div class="actions"><button id="route-go" class="${tool === "route" ? "primary" : ""}">${tool === "route" ? (routeA ? "Click the destination" : "Click the start") : "Find a walking route"}</button>${rr ? '<button id="route-clear">Clear</button>' : ""}</div>
        ${rr ? `<table class="kv"><tr><td>Today</td><td>${rr.base.ok ? `${fmt(rr.base.dist)} m · ${fmt(rr.base.minutes, 1)} min` : esc(rr.base.msg)}</td></tr><tr><td>With the changes</td><td>${rr.plan.ok ? `<b>${fmt(rr.plan.dist)} m · ${fmt(rr.plan.minutes, 1)} min</b>` : esc(rr.plan.msg)}</td></tr>${rr.base.ok && rr.plan.ok && rr.plan.dist < rr.base.dist ? `<tr><td>Saved</td><td><b>${fmt(rr.base.dist - rr.plan.dist)} m</b> per trip</td></tr>` : ""}<tr><td>As the crow flies</td><td>${fmt(rr.base.straight || rr.plan.straight)} m</td></tr></table>` : `<div class="note">Compare walking routes today and with your new roads and paths.</div>`}
      </section>`;
      if (g && showGreen) h += `<section class="sim"><h3>${svg("tree", COL.tree)} Green, water and energy</h3><table class="kv">
        <tr><td>Trees planted / lost</td><td>${g.planted} / ${g.removed + g.affected}${g.affected ? ` <small>(${g.affected} in the way of new work)</small>` : ""}</td></tr>
        <tr><td>CO₂ taken up by trees</td><td>${g.co2_kg >= 0 ? "+" : ""}${fmt(g.co2_kg)} kg a year when grown</td></tr>
        <tr><td>Solar</td><td>${fmt(g.solar_kwp, 1)} kWp · ${fmt(g.solar_kwh)} kWh · ${fmt(g.solar_co2_t, 1)} t CO₂ avoided a year</td></tr>
        <tr><td>Rainwater harvested</td><td>${fmt(g.rwh_m3)} m³ a year</td></tr>
        <tr><td>Storm runoff (${g.storm_mm} mm rain)</td><td>${g.runoff_m3 >= 0 ? "+" : ""}${fmt(g.runoff_m3)} m³, ${fmt(g.captured_m3)} m³ captured</td></tr>
        <tr><td>Trees tagged</td><td>${g.tagged}</td></tr></table></section>`;
      if (R && (catOn("buildings") || catOn("roads")) && (R.build.new || R.build.demolished || R.build.added_gfa || Object.keys(R.roads.new_m).length)) h += `<section class="sim"><h3>${svg("building", COL.building)} Buildings and roads</h3><table class="kv">
        <tr><td>New buildings</td><td>${R.build.new} · ${fmt(R.build.gfa)} m² floor area · about ${fmt(R.build.people)} people</td></tr>
        <tr><td>Demolished</td><td>${R.build.demolished} · ${fmt(R.build.demolished_gfa)} m²</td></tr>
        <tr><td>Floors added</td><td>${fmt(R.build.added_gfa)} m²</td></tr>
        ${Object.entries(R.roads.new_m).map(([k, v]) => `<tr><td>New ${esc((K.road.params[0].options.find((o) => o[0] === k) || [k, k])[1])}</td><td>${fmt(v)} m</td></tr>`).join("")}
        <tr><td>New junctions</td><td>${R.roads.junctions}${R.roads.loose ? ` · <span class="pwarn-i">${R.roads.loose} not joined</span>` : ""}</td></tr></table></section>`;
      h += `<details class="sim"><summary>Model assumptions</summary><div class="fields">${Object.entries(E.cat.assumptions).map(([k, a]) => `<label><span>${esc(a.label)}</span><span class="numu"><input type="number" data-as="${k}" step="any" value="${esc((S.meta.assumptions || {})[k] != null ? S.meta.assumptions[k] : a.value)}"><i>${esc(a.unit)}</i></span></label>`).join("")}</div>
        ${Object.entries(E.cat.models).map(([k, t]) => `<p class="note"><b>${esc(k === "wifi" ? "Wi-Fi" : k[0].toUpperCase() + k.slice(1))}:</b> ${esc(t)}</p>`).join("")}</details>`;
      el.innerHTML = h;
      const on = (id, ev, fn) => { const x = $(id); if (x) x.addEventListener(ev, fn); };
      wireCatChips(el);
      on("sim-run", "click", () => { stale = false; runEngine(); });
      on("sim-auto", "change", (e) => { autoRun = e.target.checked; store.set("pantnagar-sandbox:autorun", autoRun ? "1" : "0"); if (autoRun && stale) { stale = false; runEngine(); } });
      on("ov-wifi", "change", (e) => { OV.wifi = e.target.checked; A.setXray(OV.wifi); refreshOverlays(true); renderSelection(); });
      on("ov-floor", "change", (e) => { OV.floor = +e.target.value; refreshOverlays(true); });
      on("ov-lux", "change", (e) => { OV.lux = e.target.checked; refreshOverlays(true); });
      on("ov-night", "change", (e) => { OV.night = e.target.checked; A.setNight(OV.night); glow3d.visible = OV.night; if (OV.night && !OV.lux) { OV.lux = true; $("ov-lux").checked = true; } refreshOverlays(true); });
      on("ov-catch", "change", (e) => { OV.catch = e.target.checked; refreshOverlays(true); });
      on("wifi-pick", "click", () => { setTool(tool === "wifi_pick" ? "select" : "wifi_pick"); renderSim(); });
      on("wifi-suggest", "click", suggestWifi);
      on("route-go", "click", () => { setTool("route"); routeA = null; renderSim(); });
      on("route-clear", "click", () => { routeRes = null; routeLines = []; refreshOverlays(true); renderSim(); });
      el.querySelectorAll("[data-target]").forEach((i) => i.addEventListener("change", () => { const x = Number(i.value); if (Number.isFinite(x) && x >= 0) setTarget(i.dataset.target, x); }));
      el.querySelectorAll("[data-wt]").forEach((c) => c.addEventListener("change", () => mutate(() => {
        const s = new Set(S.meta.wifi_targets || []);
        c.checked ? s.add(c.dataset.wt) : s.delete(c.dataset.wt);
        S.meta.wifi_targets = [...s];
      })));
      el.querySelectorAll("[data-as]").forEach((c) => c.addEventListener("change", () => mutate(() => { const x = Number(c.value); if (Number.isFinite(x)) (S.meta.assumptions || (S.meta.assumptions = {}))[c.dataset.as] = x; })));
      el.querySelectorAll("tr[data-go]").forEach((tr) => tr.addEventListener("click", () => { const [x, z] = tr.dataset.go.split(",").map(Number); A.flyTo({ tx: x, tz: z, dist: 220 }); }));
    }

    // Budget: quantities from the map, editable rates, extra lines, contingency, taxes, a limit.
    function renderBudget() {
      const el = $("ptab-budget");
      const B = S.meta.budget || {}, t = totals(), b = R ? R.budget : { lines: [], capex: 0, opex: 0 };
      const byCat = new Map();
      for (const x of b.lines) { const c = lineCat(x.key); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(x); }
      const pctUsed = t.cap ? Math.min(100, (t.total / t.cap) * 100) : 0;
      el.innerHTML = `
        <div class="big">${inr(t.total)} <span class="note">total to build${t.cap ? (t.total <= t.cap ? `: within the budget of ${inr(t.cap)}, ${inr(t.cap - t.total)} left` : `: <b class="bad">over the budget of ${inr(t.cap)} by ${inr(t.total - t.cap)}</b>`) : ""}</span></div>
        ${t.cap ? `<div class="meter ${t.total > t.cap ? "over" : ""}"><i style="width:${pctUsed}%"></i></div>` : ""}
        <div class="fields bset">
          <label><span>Budget available</span><span class="numu"><i>₹</i><input type="number" data-b="cap" value="${B.cap || ""}" min="0" step="1000" placeholder="No limit"></span></label>
          <label><span>Contingency</span><span class="numu"><input type="number" data-b="contingency" value="${B.contingency != null ? B.contingency : 5}" min="0" max="100" step="1"><i>%</i></span></label>
          <label><span>Taxes (GST)</span><span class="numu"><input type="number" data-b="tax" value="${B.tax != null ? B.tax : 0}" min="0" max="100" step="1"><i>%</i></span></label>
        </div>
        <h3>Included categories</h3>${catChips("budget-cats")}
        ${b.lines.length ? `<table class="budget"><thead><tr><th>Item</th><th>Qty</th><th>Rate ₹</th><th>Cost</th></tr></thead>
          ${categories().filter((c) => byCat.has(c.key)).map((c) => { const ls = byCat.get(c.key); const sub = ls.reduce((s, x) => s + x.capex, 0); return `<tbody><tr class="cat"><td colspan="3">${esc(c.label)}</td><td>${inr(sub)}</td></tr>
            ${ls.map((x) => `<tr><td>${esc(x.label)}</td><td>${fmt(x.qty, x.qty < 10 && x.qty % 1 ? 1 : 0)} <small>${esc(x.unit)}</small></td><td><input type="number" data-rate="${esc(x.key)}" value="${x.rate}" min="0" step="any"></td><td>${inr(x.capex)}</td></tr>`).join("")}</tbody>`; }).join("")}
          </table>` : `<div class="note">Nothing to cost yet: place items on the map, or tick their categories above.</div>`}
        <h3>Other costs</h3>
        <table class="budget extra"><thead><tr><th>Item</th><th>Qty</th><th>Rate ₹</th><th></th></tr></thead><tbody>
          ${(B.extra || []).map((x, i) => `<tr><td><input data-x="${i}" data-f="label" value="${esc(x.label)}" placeholder="e.g. Survey and design"></td><td><input type="number" data-x="${i}" data-f="qty" value="${x.qty}" min="0" step="any"></td><td><input type="number" data-x="${i}" data-f="rate" value="${x.rate}" min="0" step="any"></td><td><button class="icon-btn" data-xdel="${i}" aria-label="Remove">×</button></td></tr>`).join("")}
        </tbody></table>
        <div class="actions"><button id="budget-add">+ Add a cost line</button></div>
        <table class="kv sum">
          <tr><td>Items on the map</td><td>${inr(t.items)}</td></tr>
          <tr><td>Other costs</td><td>${inr(t.extras)}</td></tr>
          <tr><td>Contingency</td><td>${inr(t.cont)}</td></tr>
          <tr><td>Taxes</td><td>${inr(t.tax)}</td></tr>
          <tr class="tot"><td>Total to build</td><td>${inr(t.total)}</td></tr>
          <tr><td>Running and upkeep a year</td><td>${inr(t.opex)}${R && R.budget.kwh ? ` <small>incl. ${fmt(R.budget.kwh)} kWh</small>` : ""}</td></tr>
          ${R && R.budget.savings ? `<tr><td>Solar saves a year</td><td>${inr(R.budget.savings)}${R.budget.payback_solar ? ` <small>pays back in ${fmt(R.budget.payback_solar, 1)} yr</small>` : ""}</td></tr>` : ""}
        </table>
        <p class="note">Rates are indicative 2026 figures. Change any rate here or in the Types tab; your rates are saved with the scenario.</p>
        <div class="actions"><button id="budget-csv">Download budget (CSV)</button></div>`;
      wireCatChips(el);
      el.querySelectorAll("[data-rate]").forEach((i) => i.addEventListener("change", () => mutate(() => { const x = Number(i.value); if (Number.isFinite(x) && x >= 0) (S.meta.costs || (S.meta.costs = {}))[i.dataset.rate] = x; })));
      el.querySelectorAll("[data-b]").forEach((i) => i.addEventListener("change", () => mutate(() => { const x = Number(i.value); (S.meta.budget || (S.meta.budget = {}))[i.dataset.b] = Number.isFinite(x) && x >= 0 ? x : 0; })));
      el.querySelectorAll("[data-x]").forEach((i) => i.addEventListener("change", () => mutate(() => { const x = S.meta.budget.extra[+i.dataset.x]; x[i.dataset.f] = i.dataset.f === "label" ? i.value : Number(i.value) || 0; })));
      el.querySelectorAll("[data-xdel]").forEach((bt) => bt.addEventListener("click", () => mutate(() => { S.meta.budget.extra.splice(+bt.dataset.xdel, 1); })));
      $("budget-add").onclick = () => mutate(() => { const bb = S.meta.budget || (S.meta.budget = {}); (bb.extra || (bb.extra = [])).push({ label: "", qty: 1, rate: 0 }); });
      $("budget-csv").onclick = () => {
        const rows = [["Category", "Item", "Quantity", "Unit", "Rate (INR)", "Cost (INR)"], ...b.lines.map((x) => [catLabel(lineCat(x.key)), x.label, x.qty, x.unit, x.rate, x.capex]),
          ...(B.extra || []).map((x) => ["Other", x.label, x.qty, "", x.rate, (Number(x.qty) || 0) * (Number(x.rate) || 0)]),
          ["", "Contingency", "", "", "", Math.round(t.cont)], ["", "Taxes", "", "", "", Math.round(t.tax)], ["", "Total to build", "", "", "", Math.round(t.total)], ["", "Running and upkeep a year", "", "", "", Math.round(t.opex)]];
        download(slug() + "-budget.csv", rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n"), "text/csv");
      };
    }

    // Types: edit rates, upkeep and walking reach of every item type; create new types and categories.
    const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
    function renderTypes() {
      const el = $("ptab-types");
      if (!E.cat) return;
      const rates = E.cat.rates, fac = E.cat.facilities, M = S.meta;
      const rowsBy = new Map();
      for (const [key, r] of Object.entries(rates)) { const c = lineCat(key); if (!rowsBy.has(c)) rowsBy.set(c, []); rowsBy.get(c).push({ key, r }); }
      for (const k of customKinds) { if (!rowsBy.has(k.category)) rowsBy.set(k.category, []); rowsBy.get(k.category).push({ custom: k }); }
      const reachOf = (kind) => (M.reach && M.reach[kind] != null ? M.reach[kind] : fac[kind]);
      const catOpts = categories().map((c) => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join("");
      el.innerHTML = `
        <details class="sim" id="type-new"><summary>${svg("plus")} New item type</summary>
          <div class="fields">
            <label><span>Name</span><input data-nt="label" placeholder="e.g. Solar water cooler"></label>
            <label><span>Category</span><select data-nt="category">${catOpts}<option value="__new">New category…</option></select></label>
            <label data-ntnew hidden><span>New category name</span><input data-nt="categoryLabel" placeholder="e.g. Health"></label>
            <label><span>Drawn as</span><select data-nt="geom"><option value="point">A point</option><option value="line">A line</option><option value="polygon">An area</option></select></label>
            <label><span>Cost <i data-ntunit>each</i></span><span class="numu"><i>₹</i><input type="number" data-nt="rate" min="0" step="any" value="0"></span></label>
            <label><span>Upkeep a year</span><span class="numu"><input type="number" data-nt="maint" min="0" step="any" value="5"><i>% of cost</i></span></label>
            <label><span>Electricity a year</span><span class="numu"><input type="number" data-nt="kwh" min="0" step="any" value="0"><i>kWh each</i></span></label>
            <label><span>Walking reach</span><span class="numu"><input type="number" data-nt="reach" min="0" step="10" value="0"><i>m (0 = not an amenity)</i></span></label>
            <label><span>Colour</span><input type="color" data-nt="color" value="#3a7bd5"></label>
          </div>
          <div class="actions"><button id="nt-add" class="primary">Add item type</button></div>
          <p class="note">New types appear in the Design tab under their category, count in the budget, and, with a walking reach, in walking access.</p>
        </details>
        ${categories().filter((c) => rowsBy.has(c.key)).map((c) => `<section class="sim types"><h3>${esc(c.label)}</h3><table class="budget types">
          <thead><tr><th>Type</th><th>Cost ₹</th><th>Upkeep %</th><th>Reach m</th><th></th></tr></thead><tbody>
          ${rowsBy.get(c.key).map((row) => {
            if (row.custom) {
              const k = row.custom, unit = k.geom === "line" ? "per m" : k.geom === "polygon" ? "per m²" : "each";
              return `<tr class="custom"><td>${svg(k.key, k.color)} ${esc(k.label)} <small>${unit}</small></td><td><input type="number" data-ck="${k.key}" data-f="rate" value="${k.rate || 0}" min="0" step="any"></td><td><input type="number" data-ck="${k.key}" data-f="maint" value="${k.maint || 0}" min="0" step="any"></td><td><input type="number" data-ck="${k.key}" data-f="reach" value="${k.reach || 0}" min="0" step="10"></td><td><button class="icon-btn" data-ckdel="${k.key}" aria-label="Delete type" title="Delete this type">×</button></td></tr>`;
            }
            const { key, r } = row, kind = key.split(":")[0];
            const reach = fac[kind] != null && kind === key ? `<input type="number" data-reach="${kind}" value="${reachOf(kind)}" min="0" step="10">` : "";
            return `<tr><td>${esc(r.label)} <small>${esc(r.unit)}</small></td><td><input type="number" data-rate="${esc(key)}" value="${M.costs && M.costs[key] != null ? M.costs[key] : r.rate}" min="0" step="any"></td><td><input type="number" data-maint="${esc(key)}" value="${M.maint && M.maint[key] != null ? M.maint[key] : r.maint}" min="0" step="any"></td><td>${reach}</td><td></td></tr>`;
          }).join("")}</tbody></table></section>`).join("")}
        <div class="actions"><button id="types-reset">Reset built-in rates to defaults</button></div>`;
      const nt = (f) => el.querySelector(`[data-nt=${f}]`);
      nt("category").addEventListener("change", () => { el.querySelector("[data-ntnew]").hidden = nt("category").value !== "__new"; });
      nt("geom").addEventListener("change", () => { el.querySelector("[data-ntunit]").textContent = { point: "each", line: "per metre", polygon: "per m²" }[nt("geom").value]; });
      $("nt-add").onclick = () => {
        const label = nt("label").value.trim();
        if (!label) { A.toast("Give the new type a name"); nt("label").focus(); return; }
        let category = nt("category").value, categoryLabel = "";
        if (category === "__new") { categoryLabel = nt("categoryLabel").value.trim(); if (!categoryLabel) { A.toast("Name the new category"); return; } category = "c_" + slugify(categoryLabel); }
        let key = "x_" + slugify(label);
        while (K[key]) key += "_";
        const k = { key, label, category, categoryLabel: categoryLabel || catLabel(category), geom: nt("geom").value, rate: Number(nt("rate").value) || 0, maint: Number(nt("maint").value) || 0, kwh: Number(nt("kwh").value) || 0, reach: Number(nt("reach").value) || 0, color: nt("color").value };
        customKinds.push(k); saveKinds(); buildK(); iconCache.clear();
        renderTools(); renderTypes(); schedule();
        A.toast(`Added "${label}" to ${k.categoryLabel}. Find it in the Design tab.`);
      };
      el.querySelectorAll("[data-rate]").forEach((i) => i.addEventListener("change", () => mutate(() => { const x = Number(i.value); if (Number.isFinite(x) && x >= 0) (S.meta.costs || (S.meta.costs = {}))[i.dataset.rate] = x; })));
      el.querySelectorAll("[data-maint]").forEach((i) => i.addEventListener("change", () => mutate(() => { const x = Number(i.value); if (Number.isFinite(x) && x >= 0) (S.meta.maint || (S.meta.maint = {}))[i.dataset.maint] = x; })));
      el.querySelectorAll("[data-reach]").forEach((i) => i.addEventListener("change", () => mutate(() => { const x = Number(i.value); if (Number.isFinite(x) && x >= 0) (S.meta.reach || (S.meta.reach = {}))[i.dataset.reach] = x; })));
      el.querySelectorAll("[data-ck]").forEach((i) => i.addEventListener("change", () => { const k = customKinds.find((c) => c.key === i.dataset.ck); if (!k) return; k[i.dataset.f] = Number(i.value) || 0; saveKinds(); schedule(); }));
      el.querySelectorAll("[data-ckdel]").forEach((b) => b.addEventListener("click", () => {
        const key = b.dataset.ckdel, n = S.items.filter((it) => it.kind === key).length;
        if (n && !confirm(`Delete this type and its ${n} item${n > 1 ? "s" : ""} in this scenario?`)) return;
        mutate(() => { S.items = S.items.filter((it) => it.kind !== key); });
        customKinds = customKinds.filter((c) => c.key !== key); saveKinds(); buildK(); renderTools(); renderTypes(); schedule();
      }));
      $("types-reset").onclick = () => mutate(() => { S.meta.costs = {}; S.meta.maint = {}; S.meta.reach = {}; });
    }

    // Report: the scenario's notes, files, links, samples and a comparison of all scenarios.
    let compareRows = null;
    function renderReport() {
      const el = $("ptab-file");
      const ex = window.SANDBOX_EXAMPLES || [];
      el.innerHTML = `
        <div class="fields wide"><label><span>What this scenario tries</span><textarea data-m="notes" rows="4" placeholder="The idea, the reasons, open questions. Goes at the top of the report.">${esc(S.meta.notes || S.meta.summary || "")}</textarea></label></div>
        <div class="actions">
          <button id="file-report" class="primary">Scenario report</button>
          <button id="file-save">Save scenario file</button>
          <button id="file-open">Open scenario file</button>
          <button id="file-share">Copy share link</button>
        </div>
        <h3>Compare scenarios</h3>
        <div class="actions"><button id="file-compare">${compareRows ? "Compare again" : "Compare all scenarios"}</button></div>
        ${compareRows ? `<table class="budget compare"><thead><tr><th>Scenario</th><th>Items</th><th>Cost</th><th>Targets</th></tr></thead><tbody>${compareRows.map((r) => `<tr data-open="${r.id}" class="${r.id === LIB.current ? "cur" : ""}"><td>${esc(r.title)}</td><td>${r.items}</td><td>${inr(r.total)}</td><td>${r.ok} / ${r.n}</td></tr>`).join("")}</tbody></table>` : `<p class="note">Runs every saved scenario through the simulation and lists cost and targets met side by side.</p>`}
        ${ex.length ? `<h3>Sample scenarios</h3><ul class="examples">${ex.map((x, i) => `<li data-ex="${i}"><b>${esc((x.plan.sandbox && x.plan.sandbox.title) || x.file)}</b><span>${esc((x.plan.sandbox && (x.plan.sandbox.summary || x.plan.sandbox.notes)) || "")}</span></li>`).join("")}</ul><p class="note">A sample opens as a new scenario, so your work is kept.</p>` : ""}
        <p class="note">Scenario files are GeoJSON: they open in QGIS and other GIS tools and back in the Sandbox. Share links carry the whole scenario in the address.</p>`;
      el.querySelectorAll("[data-m]").forEach((i) => i.addEventListener("change", () => { const before = snap(); S.meta[i.dataset.m] = i.value; undo.push(before); redo.length = 0; updateUndo(); autosave(); }));
      $("file-report").onclick = openReport;
      $("file-save").onclick = () => download(slug() + ".geojson", JSON.stringify(toGeoJSON(), null, 1), "application/geo+json");
      $("file-open").onclick = () => $("plan-file").click();
      $("file-share").onclick = shareLink;
      $("file-compare").onclick = compareAll;
      el.querySelectorAll("[data-open]").forEach((tr) => tr.addEventListener("click", () => openScenario(tr.dataset.open)));
      el.querySelectorAll("[data-ex]").forEach((li) => li.addEventListener("click", () => { const x = ex[+li.dataset.ex]; try { newScenario(JSON.parse(JSON.stringify(x.plan)), "Opened the sample as a new scenario"); } catch (e) { A.toast(e.message); } }));
    }
    // The engine sees only the categories ticked in a scenario.
    function forEngine(o) {
      const off = new Set((o.sandbox && o.sandbox.categories_off) || []);
      return { ...o, features: o.features.filter((f) => !off.has(catOf(f.properties.kind))) };
    }
    async function compareAll() {
      saveScenario();
      const rows = [];
      try {
        for (const s of LIB.list) {
          A.toast(`Simulating ${s.title || "scenario"}…`);
          await new Promise((r) => setTimeout(r, 20));
          let o = null; try { o = JSON.parse(store.get(SCN(s.id))); } catch (e) { /* unreadable */ }
          if (!o) continue;
          mergeKinds(o.sandbox && o.sandbox.custom_kinds); buildK();
          const r = E.str("plan_set", JSON.stringify(forEngine(o)));
          if (r.rc) continue;
          const res = E.call("plan_evaluate");
          // Same totals and verdicts as the panel, computed with that scenario's settings.
          const keepR = R, keepMeta = S.meta;
          R = res; S.meta = { ...freshMeta(), ...(o.sandbox || {}) };
          const t = totals(), v = verdicts();
          R = keepR; S.meta = keepMeta;
          rows.push({ id: s.id, title: (o.sandbox && o.sandbox.title) || s.title, items: o.features.length, total: t.total, ok: v.filter((x) => x.ok).length, n: v.length });
        }
      } catch (e) { E.fail(e); return; }
      compareRows = rows;
      runEngine();
      renderReport();
      A.toast(`Compared ${rows.length} scenarios`);
    }

    // Scenario library (this browser): several scenarios side by side.
    const LIB_KEY = "pantnagar-sandbox:scenarios:v1", SCN = (id) => "pantnagar-sandbox:scenario:" + id;
    let LIB = { list: [], current: null };
    const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const libSave = () => store.set(LIB_KEY, JSON.stringify(LIB));
    function libLoad() {
      try { const o = JSON.parse(store.get(LIB_KEY)); if (o && Array.isArray(o.list)) LIB = o; } catch (e) { /* first visit */ }
      if (!LIB.list.length) {
        const old = store.get("pantnagar-sandbox:v1");
        if (old) {
          const id = newId();
          let title = "Scenario 1";
          try { title = JSON.parse(old).sandbox.title || title; } catch (e) { /* keep default */ }
          store.set(SCN(id), old); LIB.list.push({ id, title, updated: Date.now() }); LIB.current = id; libSave();
        }
      }
    }
    function saveScenario() {
      if (!booted) return;
      if (!LIB.current) LIB.current = newId();
      let e = LIB.list.find((x) => x.id === LIB.current);
      if (!e) { e = { id: LIB.current }; LIB.list.unshift(e); }
      Object.assign(e, { title: S.meta.title, updated: Date.now(), items: S.items.length, total: R ? totals().total : e.total || 0 });
      if (!store.set(SCN(LIB.current), JSON.stringify(toGeoJSON()))) A.toast("This browser would not save the scenario: use Save scenario file");
      libSave();
      renderScenarios();
    }
    let saveTimer = 0;
    function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveScenario, 400); }
    function setScenario(p, id) {
      S.meta = p.meta; S.items = p.items; S.seq = p.seq; sel = null;
      undo.length = 0; redo.length = 0;
      LIB.current = id; libSave();
      cancelDraft(); setTool("select"); routeRes = null; routeLines = [];
      $("plan-title").value = S.meta.title;
      renderTools(); changed(); renderReport(); renderTypes(); renderScenarios();
    }
    function openScenario(id) {
      $("scn-list").hidden = true;
      if (id === LIB.current) return;
      saveScenario();
      let o = null;
      try { o = JSON.parse(store.get(SCN(id))); } catch (e) { /* unreadable */ }
      if (!o) { A.toast("That scenario could not be read"); return; }
      mergeKinds(o.sandbox && o.sandbox.custom_kinds); buildK();
      setScenario(fromGeoJSON(o), id);
      fitTo(S.items);
    }
    function newScenario(o, msg) {
      if (LIB.current) saveScenario();
      if (o) { mergeKinds(o.sandbox && o.sandbox.custom_kinds); buildK(); }
      const p = o ? fromGeoJSON(o) : { meta: { ...freshMeta(), title: "Scenario " + (LIB.list.length + 1) }, items: [], seq: 1 };
      const id = newId();
      LIB.list.unshift({ id, title: p.meta.title, updated: Date.now(), items: p.items.length });
      setScenario(p, id);
      saveScenario();
      if (p.items.length) fitTo(S.items);
      if (msg) A.toast(msg);
    }
    function deleteScenario() {
      if (!confirm(`Delete "${S.meta.title}"? This cannot be undone (save the file first if you may need it).`)) return;
      store.del(SCN(LIB.current));
      LIB.list = LIB.list.filter((x) => x.id !== LIB.current);
      LIB.current = null;
      if (LIB.list.length) { const id = LIB.list[0].id; LIB.current = "__"; openScenario(id); } else newScenario(null);
      libSave(); renderScenarios();
    }
    function renderScenarios() {
      const el = $("scn-list");
      if (!el) return;
      el.innerHTML = `<ul>${LIB.list.map((s) => `<li data-scn="${s.id}" class="${s.id === LIB.current ? "cur" : ""}"><b>${esc(s.title || "Untitled")}</b><span>${s.items || 0} item${s.items === 1 ? "" : "s"}${s.total ? " · " + inr(s.total) : ""}</span></li>`).join("")}</ul>
        <div class="actions"><button data-sa="new" class="primary">+ New scenario</button><button data-sa="dup">Duplicate this one</button><button data-sa="del" class="danger">Delete this one</button></div>`;
      el.querySelectorAll("[data-scn]").forEach((li) => li.addEventListener("click", () => openScenario(li.dataset.scn)));
      el.querySelectorAll("[data-sa]").forEach((b) => b.addEventListener("click", () => {
        el.hidden = true;
        if (b.dataset.sa === "new") newScenario(null, "New empty scenario");
        else if (b.dataset.sa === "dup") { const o = toGeoJSON(); o.sandbox.title = S.meta.title + " (copy)"; newScenario(o, "Duplicated: change it and compare"); }
        else deleteScenario();
      }));
    }

    // ---------------------------------------------------------------------------------------
    // Scenario report (opens as a printable page)
    function openReport() {
      if (!R) { A.toast("Add something to the scenario first"); return; }
      const m = S.meta, w = R.wifi, l = R.light, g = R.green, t = totals(), v = verdicts(), B = m.budget || {};
      const shot = A.snapshot(1.5);
      const included = categories().filter((c) => usedCats()[c.key] && catOn(c.key)).map((c) => c.label);
      const excluded = categories().filter((c) => usedCats()[c.key] && !catOn(c.key)).map((c) => c.label);
      const counts = new Map();
      for (const it of S.items) if (it.status === "proposed" && itemOn(it)) { const c = catOf(it.kind); if (!counts.has(c)) counts.set(c, {}); const o = counts.get(c); o[it.kind] = (o[it.kind] || 0) + 1; }
      const changes = categories().filter((c) => counts.has(c.key)).map((c) => `<tr><td>${esc(c.label)}</td><td>${Object.entries(counts.get(c.key)).map(([k, n]) => `${n} × ${esc((K[k] && K[k].label) || k)}`).join(", ")}</td></tr>`).join("");
      const res = [];
      if (catOn("wifi") && (w.plan.aps || w.base.aps)) res.push([`Wi-Fi: floor area with good signal (-67 dBm), ${fmt(w.gfa)} m² measured`, pct(w.base.good), pct(w.plan.good)]);
      if (catOn("lighting") && l.study_m) res.push([`Road lit to IS 1944 (${fmt(l.study_m)} m studied)`, pct(l.base.ok_m / l.study_m), pct(l.plan.ok_m / l.study_m)], ["Average light on the road", fmt(l.base.avg, 1) + " lux", fmt(l.plan.avg, 1) + " lux"]);
      for (const a of R.access) res.push([`People within ${a.radius} m walk of a ${esc(a.label.toLowerCase())}`, pct(a.base.pct), pct(a.plan.pct)]);
      if (routeRes && routeRes.base.ok && routeRes.plan.ok) res.push(["Sample walking route", fmt(routeRes.base.dist) + " m", fmt(routeRes.plan.dist) + " m"]);
      const greens = [["Trees planted", g.planted], ["Trees lost", g.removed + g.affected], ["CO₂ taken up by trees (kg/yr, grown)", fmt(g.co2_kg)], ["Solar", `${fmt(g.solar_kwp, 1)} kWp, ${fmt(g.solar_kwh)} kWh/yr, ${fmt(g.solar_co2_t, 1)} t CO₂/yr avoided`], ["Rainwater harvested", fmt(g.rwh_m3) + " m³/yr"], [`Storm runoff change (${g.storm_mm} mm)`, `${fmt(g.runoff_m3)} m³, ${fmt(g.captured_m3)} m³ captured`]].filter((r) => r[1] && r[1] !== "0" && !/^0(\.0)? kWp/.test(r[1]));
      const byCat = new Map();
      for (const x of R.budget.lines) { const c = lineCat(x.key); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(x); }
      const para = (s) => esc(s || "").split(/\n+/).filter(Boolean).map((p) => `<p>${p}</p>`).join("");
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)} - scenario report</title>
<style>
:root{--ink:#17201a;--ink2:#4f5d53;--line:#d9ddd5;--accent:#b97c0c}
body{font:15px/1.55 "Segoe UI",system-ui,sans-serif;color:var(--ink);background:#fff;max-width:860px;margin:0 auto;padding:28px 22px 60px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 8px;border-bottom:2px solid var(--accent);padding-bottom:4px}
.sub{color:var(--ink2)}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border-bottom:1px solid var(--line);padding:6px 6px;text-align:left;vertical-align:top}
th{font-size:12.5px;color:var(--ink2);text-transform:uppercase;letter-spacing:.03em}td.n,th.n{text-align:right;white-space:nowrap}tfoot td,tr.tot td{font-weight:700}tr.cat td{background:#f5f6f2;font-weight:600}
img{width:100%;border-radius:10px;border:1px solid var(--line)}.note{color:var(--ink2);font-size:13px}.ok{color:#1e8a4c;font-weight:700}.bad{color:#c0392b;font-weight:700}
.bar{position:sticky;top:0;background:#fff;padding:8px 0;display:flex;gap:8px;justify-content:flex-end}.bar button{padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:#f3f4f0;cursor:pointer;font:inherit}
@media print{.bar{display:none}body{padding:0}h2{break-after:avoid}table,img{break-inside:avoid}}
</style></head><body>
<div class="bar"><button onclick="print()">Print or save as PDF</button></div>
<h1>${esc(m.title)}</h1>
<div class="sub">Pantnagar Sandbox scenario · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} · simulated: ${esc(included.join(", ") || "nothing")}${excluded.length ? ` · left out: ${esc(excluded.join(", "))}` : ""}</div>
${para(m.notes || m.summary)}
<p><img src="${shot}" alt="3D view of the scenario"></p>
<h2>What works</h2>${v.length ? `<table><thead><tr><th></th><th>Check</th><th class="n">Result</th><th class="n">Target</th></tr></thead><tbody>${v.map((x) => `<tr><td class="${x.ok ? "ok" : "bad"}">${x.ok ? "✓" : "✗"}</td><td>${esc(x.label)}</td><td class="n">${vval(x, x.value)}</td><td class="n">${x.max ? "≤ " : "≥ "}${vval(x, x.target)}</td></tr>`).join("")}</tbody></table><p><b>${v.filter((x) => x.ok).length} of ${v.length}</b> targets met.</p>` : "<p>No targets apply yet.</p>"}
${R.warnings ? `<p class="note">Conflicts to resolve: ${R.items.flatMap((x) => x.warn.map((t) => `${esc(itemTitle(S.items.find((i) => i.id === x.id) || { kind: "" }))}: ${esc(t)}`)).join("; ")}</p>` : ""}
<h2>Changes</h2>${changes ? `<table><tbody>${changes}</tbody></table>` : "<p>None.</p>"}
<h2>Results: today and with the changes</h2>${res.length ? `<table><thead><tr><th>Measure</th><th class="n">Today</th><th class="n">With the changes</th></tr></thead><tbody>${res.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n"><b>${r[2]}</b></td></tr>`).join("")}</tbody></table>` : ""}
${greens.length ? `<table><tbody>${greens.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td></tr>`).join("")}</tbody></table>` : ""}
<h2>Budget</h2><table><thead><tr><th>Item</th><th class="n">Quantity</th><th class="n">Rate (₹)</th><th class="n">Cost</th></tr></thead><tbody>
${categories().filter((c) => byCat.has(c.key)).map((c) => `<tr class="cat"><td colspan="3">${esc(c.label)}</td><td class="n">${inr(byCat.get(c.key).reduce((s, x) => s + x.capex, 0))}</td></tr>${byCat.get(c.key).map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${fmt(x.qty, x.qty % 1 ? 1 : 0)} ${esc(x.unit)}</td><td class="n">${fmt(x.rate)}</td><td class="n">${inr(x.capex)}</td></tr>`).join("")}`).join("")}
${(B.extra || []).length ? `<tr class="cat"><td colspan="3">Other costs</td><td class="n">${inr(t.extras)}</td></tr>${B.extra.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${fmt(x.qty)}</td><td class="n">${fmt(x.rate)}</td><td class="n">${inr((Number(x.qty) || 0) * (Number(x.rate) || 0))}</td></tr>`).join("")}` : ""}
</tbody><tfoot><tr><td colspan="3">Contingency (${fmt(B.contingency != null ? B.contingency : 5)}%)</td><td class="n">${inr(t.cont)}</td></tr><tr><td colspan="3">Taxes (${fmt(B.tax || 0)}%)</td><td class="n">${inr(t.tax)}</td></tr><tr class="tot"><td colspan="3">Total to build</td><td class="n">${inr(t.total)}</td></tr>${t.cap ? `<tr><td colspan="3">Budget available</td><td class="n">${inr(t.cap)}</td></tr>` : ""}<tr><td colspan="3">Running and upkeep a year</td><td class="n">${inr(t.opex)}</td></tr></tfoot></table>
<p class="note">Rates are indicative 2026 planning figures${Object.keys(m.costs || {}).length ? ", with this scenario's own rates where set" : ""}; final costs need quotations.</p>
<h2>How it was simulated</h2><p>Pantnagar Sandbox, an open digital twin of the GBPUAT campus (${fmt(D.buildings.length)} buildings, ${fmt(D.trees.length / 3)} mapped trees and the road network from OpenStreetMap, Google Open Buildings, Microsoft footprints, Sentinel-2 and Meta canopy height). Models:</p>
<ul>${Object.entries(E.cat.models).map(([k, s]) => `<li><b>${k === "wifi" ? "Wi-Fi" : k[0].toUpperCase() + k.slice(1)}:</b> ${esc(s)}</li>`).join("")}</ul>
<p class="note">The scenario file (GeoJSON) reproduces every number in this report.</p>
</body></html>`;
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const win = window.open(url, "_blank");
      if (!win) download(slug() + "-report.html", html, "text/html");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ---------------------------------------------------------------------------------------
    // Entering and leaving plan mode
    let panelWas = null, booted = false;
    async function enterPlan() {
      panelWas = !$("panel").classList.contains("closed");
      A.setPanel(false);
      $("info").hidden = true;
      $("plan").hidden = false;
      if (!booted) {
        $("plan-tools").innerHTML = `<div class="note">Starting the planning engine…</div>`;
        try { await E.load(); } catch (e) { $("plan-tools").innerHTML = `<div class="pwarn">${esc(e.message || e)}</div>`; return; }
        buildK();
        booted = true;
        libLoad();
        let o = null;
        if (LIB.current) try { o = JSON.parse(store.get(SCN(LIB.current))); } catch (e) { o = null; }
        if (o) { mergeKinds(o.sandbox && o.sandbox.custom_kinds); buildK(); setScenario(fromGeoJSON(o), LIB.current); }
        else newScenario(null);
      } else { renderCard(); }
    }
    function leavePlan(m) {
      $("plan").hidden = true;
      $("plan-card").hidden = true;
      document.body.classList.remove("plan-card-open");
      cancelDraft();
      setTool("select");
      if (m === "aerial" && panelWas) A.setPanel(true);
    }

    // Static panel wiring
    // The panel button shows or hides the plan panel while planning.
    $("panel-btn").addEventListener("click", (e) => {
      if (A.mode() !== "plan") return;
      e.stopImmediatePropagation();
      $("plan").hidden = !$("plan").hidden;
      $("panel-btn").setAttribute("aria-pressed", !$("plan").hidden);
    }, true);
    $("mode-plan").addEventListener("click", () => {
      const m = A.mode();
      if (m === "plan") return;
      if (m === "street") C.exitStreet();
      A.setMode("plan");
    });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyP" || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const m = A.mode();
      if (m === "aerial") A.setMode("plan"); else if (m === "plan" && !draft) A.setMode("aerial");
    });
    $("plan-tools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (!b) return; setTool(tool === b.dataset.tool && b.dataset.tool !== "select" ? "select" : b.dataset.tool); if (tool === "route") routeA = null; });
    $("plan-items").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (!li) return; select(li.dataset.id); const it = S.items.find((i) => i.id === li.dataset.id); if (it) fitTo([it]); });
    $("plan-undo").addEventListener("click", doUndo);
    $("plan-redo").addEventListener("click", doRedo);
    $("plan-title").addEventListener("change", (e) => { const before = snap(); S.meta.title = e.target.value.trim() || "Untitled scenario"; undo.push(before); updateUndo(); autosave(); });
    $("scn-btn").addEventListener("click", () => { const l = $("scn-list"); l.hidden = !l.hidden; $("scn-btn").setAttribute("aria-expanded", !l.hidden); if (!l.hidden) renderScenarios(); });
    $("plan-draw-done").addEventListener("click", finishDraft);
    $("plan-draw-back").addEventListener("click", () => { if (!draft) return; draft.pts.pop(); if (!draft.pts.length) cancelDraft(); else { renderDraft(); showDrawBar(); } });
    $("plan-draw-cancel").addEventListener("click", cancelDraft);
    function showTab(p) {
      document.querySelectorAll("#plan-tabs button").forEach((u) => u.setAttribute("aria-selected", u.dataset.ptab === p));
      for (const q of ["build", "sim", "budget", "types", "file"]) $("ptab-" + q).hidden = q !== p;
    }
    document.querySelectorAll("#plan-tabs button").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.ptab)));
    $("plan-ab").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-ab]");
      if (!b) return;
      showPlan = b.dataset.ab === "plan";
      $("plan-ab").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      applyGraph(); renderItems(); refreshOverlays(true);
    });

    // A shared plan in the address opens straight into plan mode.
    const hm = location.hash.match(/plan=([A-Za-z0-9_-]+)/);
    if (hm) {
      (async () => {
        try {
          const o = await readShared(hm[1]);
          A.setMode("plan");
          await E.load();
          while (!booted) await new Promise((r) => setTimeout(r, 50));
          loadPlan(o, "Opened a shared scenario as a new scenario");
        } catch (e) { A.toast("Could not open the shared plan: " + (e.message || e)); }
      })();
    }
    window.__sandbox = { S, E, OV, get R() { return R; }, get LIB() { return LIB; }, toGeoJSON, loadPlan, newScenario, openScenario, setTool, select, runEngine, refreshOverlays, verdicts, totals, showTab };
  }
})();
