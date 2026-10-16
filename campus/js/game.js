/* Grand Tour Pantnagar - an open-world driving game on the campus twin.
   Walk, borrow cars, scooters, autos and tractors, drive the real road network among traffic and
   pedestrians, run jobs at real campus places, and stay ahead of campus security.
   No weapons: the fun is driving, deliveries, races and chases. Lightweight by design: vehicles and
   people are instanced (a few draw calls in all), physics is arcade, sound is synthesised. */
(function () {
  "use strict";
  let started = false;
  const start = () => { if (started || !window.__campus || !window.__campus.game) return; started = true; init(); };
  window.addEventListener("campus:ready", start);
  start();

  function init() {
    const C = window.__campus, A = C.game, D = window.CAMPUS;
    const camera = C.camera, scene = C.scene, H = A.H;
    const $ = (id) => document.getElementById(id);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    const fwd = (yaw) => [Math.sin(yaw), -Math.cos(yaw)];
    const yawOf = (dx, dz) => Math.atan2(dx, -dz);
    const rnd = Math.random, pick = (a) => a[Math.floor(rnd() * a.length)];
    const fmt = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    // -------------------------------------------------------------------------------------
    // Road network (rebuilt on entry: plans can add roads)
    const GN = D.graph.nodes, GE = D.graph.edges;
    const nx = (n) => GN[n * 2], nz = (n) => GN[n * 2 + 1];
    const roadCls = (r) => {
      const c = r ? r.c : "service", sf = (r && r.s) || "";
      if (["path", "footway", "cycleway", "steps", "bridleway", "pedestrian"].includes(c)) return "path";
      if (c === "track" || /unpaved|dirt|earth|gravel|ground|sand|mud|grass/.test(sf)) return "dirt";
      if (/^(motorway|trunk|primary|secondary|tertiary)/.test(c)) return "major";
      return "minor";
    };
    const SPEED = { major: 13, minor: 9, dirt: 6, path: 0 };
    let NET = null;
    function buildNet() {
      const n = GN.length / 2, adjD = Array.from({ length: n }, () => []), adjW = Array.from({ length: n }, () => []);
      const len = [], cls = [], ok = [];
      GE.forEach((e, k) => {
        const good = A.edgeOk(k) && e[0] !== e[1];
        ok[k] = good;
        if (!good) return;
        const r = D.roads[e[2]];
        len[k] = Math.hypot(nx(e[1]) - nx(e[0]), nz(e[1]) - nz(e[0])) || 0.01;
        cls[k] = roadCls(r);
        adjW[e[0]].push(k); adjW[e[1]].push(k);
        if (cls[k] !== "path") { adjD[e[0]].push(k); adjD[e[1]].push(k); }
      });
      const driveNodes = [];
      for (let i = 0; i < n; i++) if (adjD[i].length) driveNodes.push(i);
      NET = { adjD, adjW, len, cls, ok, driveNodes };
    }
    const other = (k, n) => (GE[k][0] === n ? GE[k][1] : GE[k][0]);
    const roadW = (k) => ((D.roads[GE[k][2]] || {}).w || 5);
    const drivable = (k) => NET.ok[k] && NET.cls[k] !== "path";
    function nearestDrive(x, z, maxD = 120) { return A.nearestEdge(x, z, maxD, drivable); }
    function nearestNode(x, z, maxD = 200) {
      const ne = nearestDrive(x, z, maxD);
      if (!ne) return -1;
      const e = GE[ne.k];
      return ne.t < 0.5 ? e[0] : e[1];
    }
    // Shortest drivable path (node list) with a small binary heap.
    function route(from, to) {
      if (from < 0 || to < 0) return null;
      const n = GN.length / 2, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), heap = [];
      const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      dist[from] = 0; push(0, from);
      while (heap.length) {
        const [d, u] = pop();
        if (u === to) break;
        if (d > dist[u]) continue;
        for (const k of NET.adjD[u]) { const v = other(k, u), nd = d + NET.len[k]; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); } }
      }
      if (!isFinite(dist[to])) return null;
      const path = [];
      for (let v = to; v >= 0; v = prev[v]) path.push(v);
      return path.reverse();
    }
    // Is the straight line a-b free of buildings?
    function clearLine(ax, az, bx, bz) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 6);
      for (let i = 1; i < n; i++) { const t = i / n; if (A.buildingAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
      return true;
    }
    // Tree trunks
    const TR = D.trees, TG = 8, tGrid = new Map();
    for (let i = 0; i < TR.length / 3; i++) { const k = Math.floor(TR[i * 3] / TG) + "," + Math.floor(TR[i * 3 + 1] / TG); if (!tGrid.has(k)) tGrid.set(k, []); tGrid.get(k).push(i); }
    function treeHit(x, z, r) {
      const i0 = Math.floor((x - r - 1) / TG), i1 = Math.floor((x + r + 1) / TG), j0 = Math.floor((z - r - 1) / TG), j1 = Math.floor((z + r + 1) / TG);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const t of tGrid.get(i + "," + j) || []) {
        if (TR[t * 3 + 2] < 4) continue;
        if (Math.hypot(TR[t * 3] - x, TR[t * 3 + 1] - z) < r + 0.35) return true;
      }
      return false;
    }
    const solid = (x, z) => !A.inCB(x, z) || !!A.buildingAt(x, z);
    function spawnSpot(minD, maxD, filter) {
      for (let i = 0; i < 14; i++) {
        const a = rnd() * Math.PI * 2, d = minD + rnd() * (maxD - minD), px = P.x + Math.sin(a) * d, pz = P.z - Math.cos(a) * d;
        const ne = A.nearestEdge(px, pz, 70, filter);
        if (!ne) continue;
        const e = GE[ne.k], n = ne.t < 0.5 ? e[0] : e[1], dd = Math.hypot(nx(n) - P.x, nz(n) - P.z);
        if (dd >= minD * 0.8 && dd <= maxD * 1.1) return { k: ne.k, n };
      }
      return null;
    }

    // -------------------------------------------------------------------------------------
    // Low-poly models, merged per type, drawn as instanced meshes
    function boxes(list) {
      const pos = [], nor = [], col = [];
      const F = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
        [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
        [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]], [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]]];
      for (const [cx, cy, cz, sx, sy, sz, c] of list) {
        for (const [n, q] of F) {
          const v = q.map(([a, b, d]) => [cx + (a * sx) / 2, cy + (b * sy) / 2, cz + (d * sz) / 2]);
          for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...v[i]); nor.push(...n); col.push(...c); }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    }
    const W1 = [1, 1, 1], GL = [0.13, 0.16, 0.19], BK = [0.07, 0.07, 0.08], HL = [1, 0.97, 0.82], TL = [0.85, 0.08, 0.06], GR = [0.32, 0.33, 0.35], CH = [0.7, 0.72, 0.74];
    const wheels = (W, L, r, y = r, fz = L / 2 - 0.75, rz = L / 2 - 0.75) => [[-W / 2 + 0.1, y, -fz, 0.22, r * 2, r * 2, BK], [W / 2 - 0.1, y, -fz, 0.22, r * 2, r * 2, BK], [-W / 2 + 0.1, y, rz, 0.22, r * 2, r * 2, BK], [W / 2 - 0.1, y, rz, 0.22, r * 2, r * 2, BK]];
    const lights = (W, L, y) => [[-W / 2 + 0.3, y, -L / 2, 0.32, 0.14, 0.06, HL], [W / 2 - 0.3, y, -L / 2, 0.32, 0.14, 0.06, HL], [-W / 2 + 0.25, y, L / 2, 0.3, 0.12, 0.06, TL], [W / 2 - 0.25, y, L / 2, 0.3, 0.12, 0.06, TL]];
    const rider = (z, y) => [[0, y + 0.35, z, 0.4, 0.6, 0.26, [0.2, 0.32, 0.55]], [0, y + 0.8, z - 0.05, 0.26, 0.26, 0.28, [0.12, 0.12, 0.14]], [-0.12, y - 0.05, z - 0.25, 0.14, 0.3, 0.5, [0.18, 0.2, 0.28]], [0.12, y - 0.05, z - 0.25, 0.14, 0.3, 0.5, [0.18, 0.2, 0.28]]];
    const VT = {
      hatch: { L: 3.8, W: 1.7, max: 33, acc: 6, label: "Hatchback", seat: 0.5, paint: () => [[0, 0.62, 0, 1.7, 0.62, 3.8, W1], [0, 1.42, 0.25, 1.62, 0.06, 2.0, W1]], trim: () => [[0, 1.15, 0.25, 1.55, 0.5, 1.95, GL], ...wheels(1.7, 3.8, 0.32), ...lights(1.7, 3.8, 0.75), [0, 0.32, -1.9, 1.6, 0.2, 0.1, GR], [0, 0.32, 1.9, 1.6, 0.2, 0.1, GR]] },
      sedan: { L: 4.5, W: 1.76, max: 38, acc: 6.5, label: "Sedan", seat: 0.5, paint: () => [[0, 0.62, 0, 1.76, 0.6, 4.5, W1], [0, 1.38, 0.2, 1.66, 0.06, 2.0, W1]], trim: () => [[0, 1.12, 0.2, 1.6, 0.46, 1.95, GL], ...wheels(1.76, 4.5, 0.33), ...lights(1.76, 4.5, 0.74), [0, 0.32, -2.25, 1.66, 0.2, 0.1, GR]] },
      jeep: { L: 4.2, W: 1.8, max: 34, acc: 7, label: "Campus security jeep", seat: 0.5, police: true,
        paint: () => [[0, 0.85, 0, 1.8, 0.9, 4.2, W1], [0, 1.88, 0.35, 1.74, 0.06, 2.6, W1]],
        trim: () => [[0, 1.55, 0.35, 1.7, 0.6, 2.55, GL], ...wheels(1.8, 4.2, 0.38), ...lights(1.8, 4.2, 0.95), [0, 1.0, 0, 1.82, 0.16, 4.22, [0.1, 0.25, 0.65]], [-0.4, 2.0, 0.1, 0.6, 0.16, 0.3, [0.95, 0.1, 0.1]], [0.4, 2.0, 0.1, 0.6, 0.16, 0.3, [0.1, 0.25, 0.95]], [0, 0.95, 2.12, 1.2, 0.5, 0.06, [0.15, 0.15, 0.16]]] },
      auto: { L: 2.7, W: 1.3, max: 16, acc: 3.2, label: "Auto-rickshaw", seat: 0.3, paint: () => [[0, 0.65, 0.35, 1.3, 0.7, 1.9, W1], [0, 0.75, -0.95, 0.55, 0.6, 0.7, W1]], trim: () => [[0, 1.72, 0.25, 1.36, 0.08, 2.2, BK], [-0.62, 1.35, 0.95, 0.05, 0.75, 0.05, BK], [0.62, 1.35, 0.95, 0.05, 0.75, 0.05, BK], [0, 1.3, -0.75, 1.2, 0.85, 0.05, GL], [0, 0.28, -1.15, 0.16, 0.56, 0.56, BK], [-0.6, 0.28, 0.85, 0.18, 0.56, 0.56, BK], [0.6, 0.28, 0.85, 0.18, 0.56, 0.56, BK], [0, 0.85, -1.33, 0.22, 0.14, 0.06, HL]] },
      scooter: { L: 1.8, W: 0.7, max: 22, acc: 4.5, label: "Scooter", seat: 0.2, bike: true, paint: () => [[0, 0.55, 0.1, 0.42, 0.5, 1.3, W1], [0, 0.95, -0.55, 0.38, 0.75, 0.25, W1]], trim: () => [[0, 0.3, -0.7, 0.12, 0.6, 0.6, BK], [0, 0.3, 0.65, 0.12, 0.6, 0.6, BK], [0, 0.88, 0.3, 0.36, 0.1, 0.8, BK], [0, 1.3, -0.6, 0.65, 0.05, 0.05, CH], [0, 1.15, -0.72, 0.18, 0.12, 0.06, HL]], riderTrim: () => rider(0.25, 0.95) },
      tractor: { L: 3.4, W: 1.8, max: 11, acc: 2.5, label: "Farm tractor", seat: 0.3, paint: () => [[0, 1.05, -0.65, 0.8, 0.8, 1.8, W1], [-0.75, 1.2, 0.95, 0.35, 0.12, 1.0, W1], [0.75, 1.2, 0.95, 0.35, 0.12, 1.0, W1]], trim: () => [[-0.8, 0.7, 0.95, 0.3, 1.4, 1.4, BK], [0.8, 0.7, 0.95, 0.3, 1.4, 1.4, BK], [-0.6, 0.38, -1.25, 0.2, 0.76, 0.76, BK], [0.6, 0.38, -1.25, 0.2, 0.76, 0.76, BK], [0, 1.15, 0.75, 0.5, 0.15, 0.5, BK], [0, 1.9, -0.95, 0.1, 0.8, 0.1, BK], [0, 1.15, -1.56, 0.5, 0.2, 0.06, HL]], riderTrim: () => rider(0.75, 1.3) },
      bus: { L: 10, W: 2.5, max: 20, acc: 2.6, label: "University bus", seat: 0.7, paint: () => [[0, 1.75, 0, 2.5, 2.7, 10, W1]], trim: () => [[0, 2.15, 0, 2.54, 0.85, 9.6, GL], [0, 2.1, -5.01, 2.2, 1.1, 0.04, GL], ...wheels(2.5, 10, 0.5, 0.5, 3.5, 3.2), ...lights(2.5, 10, 0.9), [0, 0.95, 0, 2.55, 0.12, 10.02, [0.75, 0.55, 0.1]]] },
    };
    const PAINT = { hatch: ["#c0392b", "#ecf0f1", "#2c3e50", "#7f8c8d", "#2980b9", "#d35400", "#f1c40f", "#16a085", "#e8e4d8"], sedan: ["#ecf0f1", "#1b1f24", "#95a5a6", "#7b241c", "#1f3a5f"], jeep: ["#f4f6f7"], auto: ["#2e8b57", "#e2b40a", "#1e7d3c"], scooter: ["#c0392b", "#2c3e50", "#ecf0f1", "#8e44ad", "#16a085"], tractor: ["#c0392b", "#1f6f3a"], bus: ["#f4f1e8"] };
    const lamb = new THREE.MeshLambertMaterial({ vertexColors: true });
    const fleets = new Map();
    function fleet(key) {
      if (fleets.has(key)) return fleets.get(key);
      const [type, r] = key.split("_"), t = VT[type], cap = type === "bus" ? 10 : 70;
      const trimList = t.trim().concat(r && t.riderTrim ? t.riderTrim() : []);
      const paint = new THREE.InstancedMesh(boxes(t.paint()), lamb, cap), trim = new THREE.InstancedMesh(boxes(trimList), lamb, cap);
      for (const m of [paint, trim]) { m.frustumCulled = false; m.count = 0; root.add(m); }
      const f = { paint, trim, n: 0, cap };
      fleets.set(key, f);
      return f;
    }
    const root = new THREE.Group();
    root.visible = false;
    scene.add(root);

    // People: instanced parts (torso, head, legs, arms). Index 0 is the player.
    const PCAP = 90;
    const partGeo = {
      torso: new THREE.BoxGeometry(0.42, 0.6, 0.24),
      head: new THREE.BoxGeometry(0.24, 0.26, 0.24),
      limbL: new THREE.BoxGeometry(0.15, 0.85, 0.17).translate(0, -0.425, 0),
      limbA: new THREE.BoxGeometry(0.11, 0.62, 0.12).translate(0, -0.31, 0),
    };
    const pmat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const P_T = new THREE.InstancedMesh(partGeo.torso, pmat, PCAP), P_H = new THREE.InstancedMesh(partGeo.head, pmat, PCAP),
      P_L = new THREE.InstancedMesh(partGeo.limbL, pmat, PCAP * 2), P_A = new THREE.InstancedMesh(partGeo.limbA, pmat, PCAP * 2);
    for (const m of [P_T, P_H, P_L, P_A]) { m.frustumCulled = false; m.count = 0; root.add(m); }
    const SHIRTS = ["#e74c3c", "#3498db", "#ecf0f1", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#34495e", "#ff7aa2", "#2ecc71"], PANTS = ["#2c3e50", "#34495e", "#5d4037", "#1b2631", "#7f8c8d", "#283593"], SKIN = ["#c68642", "#8d5524", "#e0ac69", "#a0663f"];

    // Glows: headlights, tail lights, lamps, sirens, beacons
    const glowTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    function glowPoints(cap, size) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true }));
      p.frustumCulled = false; root.add(p);
      return { p, n: 0, cap, pos: g.attributes.position.array, col: g.attributes.color.array, add(x, y, z, r, gg, b) { if (this.n >= cap) return; this.pos.set([x, y, z], this.n * 3); this.col.set([r, gg, b], this.n * 3); this.n++; }, done() { g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.setDrawRange(0, this.n); this.n = 0; } };
    }
    const carGlow = glowPoints(600, 2.2), lampGlow = glowPoints(800, 9), sirenGlow = glowPoints(40, 5);
    // Headlight pool on the road in front of the player's car at night
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: 0xfff1c8, opacity: 0.55 });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat);
    pool.scale.set(9, 1, 16); pool.visible = false; root.add(pool);
    // Beacons
    const beaconGeo = new THREE.CylinderGeometry(2.2, 2.2, 40, 20, 1, true).translate(0, 20, 0);
    const ringGeo = new THREE.RingGeometry(2.4, 3.2, 32).rotateX(-Math.PI / 2);
    function beacon(color) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false })));
      g.add(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
      g.visible = false; root.add(g);
      return g;
    }
    // Guide arrow above the player
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false, fog: false }));
    arrow.visible = false; root.add(arrow);
    // Smoke from damaged cars
    const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x555555, transparent: true, opacity: 0.5, depthWrite: false });
    const smoke = Array.from({ length: 24 }, () => { const s = new THREE.Sprite(smokeMat); s.visible = false; root.add(s); return { s, t: 0 }; });
    let smokeI = 0;

    // -------------------------------------------------------------------------------------
    // World state
    const cars = [], peds = [], cops = [];
    const P = { x: 0, z: 0, y: 0, yaw: 0, vy: 0, car: null, health: 100, cash: 300, wanted: 0, coolT: 0, phase: 0, spd: 0, knock: 0, hitT: 0 };
    let started2 = false, paused = false, inTitle = true, clock = 17 * 60 + 35, camYaw = 0, camPitch = 0.28, camDist = 1, lastMouse = -9, camMode = 0, shake = 0;
    const keys = new Set();
    try { const sv = JSON.parse(localStorage.getItem("gtp-save:v1")); if (sv) { P.cash = sv.cash || 300; } } catch (e) { /* first game */ }
    const save = () => { try { localStorage.setItem("gtp-save:v1", JSON.stringify({ cash: P.cash, done: DONE, best: BEST })); } catch (e) { /* storage blocked */ } };
    let DONE = {}, BEST = {};
    try { const sv = JSON.parse(localStorage.getItem("gtp-save:v1")); if (sv) { DONE = sv.done || {}; BEST = sv.best || {}; } } catch (e) { /* first game */ }

    function fits(type, x, z, yaw) {
      const t = VT[type], probe = { t };
      if (corners(probe, x, z, yaw, -0.3).some(([a, b]) => solid(a, b))) return false;
      if (treeHit(x, z, t.L / 2)) return false;
      return !cars.some((c) => Math.hypot(c.x - x, c.z - z) < (c.t.L + t.L) / 2 + 0.5);
    }
    function makeCar(type, x, z, yaw, role, opts = {}) {
      const c = { type, t: VT[type], x, z, y: H(x, z), yaw, v: 0, steer: 0, role, driver: role === "traffic" || role === "cop" ? "ai" : null, paint: new THREE.Color(opts.paint || pick(PAINT[type])), dmg: 0, wreck: false, stun: 0, pitch: 0, roll: 0, ai: null, siren: role === "cop", honkT: 0 };
      cars.push(c);
      return c;
    }
    function removeCar(c) { const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1); const j = cops.indexOf(c); if (j >= 0) cops.splice(j, 1); }
    // Place a car on edge k going from node `from`.
    function onEdge(c, k, from, s) {
      const to = other(k, from);
      c.ai = { k, from, to, s, off: clamp(roadW(k) / 4, 1.1, 2.4) };
      const p = edgePos(c.ai);
      c.x = p[0]; c.z = p[1]; c.yaw = yawOf(nx(to) - nx(from), nz(to) - nz(from));
    }
    function edgePos(ai) {
      const ax = nx(ai.from), az = nz(ai.from), bx = nx(ai.to), bz = nz(ai.to), L = NET.len[ai.k], t = clamp(ai.s / L, 0, 1);
      const fx = (bx - ax) / L, fz = (bz - az) / L;
      return [ax + (bx - ax) * t + fz * ai.off, az + (bz - az) * t - fx * ai.off];
    }
    function spawnPed(x, z, k, from, s) {
      const p = { x, z, yaw: 0, v: 1.2 + rnd() * 0.5, phase: rnd() * 6, state: "walk", t: 0, k, from, to: k != null ? other(k, from) : -1, s: s || 0, side: rnd() < 0.5 ? 1 : -1, shirt: new THREE.Color(pick(SHIRTS)), pants: new THREE.Color(pick(PANTS)), skin: new THREE.Color(pick(SKIN)), fx: 0, fz: 0, say: null };
      peds.push(p);
      return p;
    }

    // -------------------------------------------------------------------------------------
    // Places and jobs
    const named = (re) => { const b = C.blds.find((x) => x.n && re.test(x.n)); return b ? b.c : null; };
    const poi = (re) => { const p = D.pois.find((x) => re.test(x.n)); return p ? [p.x, p.z] : null; };
    function roadside(pt) {
      if (!pt) return null;
      const ne = nearestDrive(pt[0], pt[1], 250);
      if (!ne) return null;
      const e = GE[ne.k], ax = nx(e[0]), az = nz(e[0]), bx = nx(e[1]), bz = nz(e[1]);
      const px = ax + (bx - ax) * ne.t, pz = az + (bz - az) * ne.t, dx = pt[0] - px, dz = pt[1] - pz, L = Math.hypot(dx, dz) || 1, off = Math.min(L, roadW(ne.k) / 2 + 2.5);
      return [px + (dx / L) * off, pz + (dz / L) * off];
    }
    const hostels = C.blds.filter((b) => b.t === "hostel" && b.n && b.a > 300).map((b) => ({ name: b.n, c: b.c }));
    const colleges = C.blds.filter((b) => b.t === "academic" && b.n && /College|Library/.test(b.n) && b.a > 800).map((b) => ({ name: b.n.replace("Pantnagar University ", ""), c: b.c }));
    let SITES = null;
    function sites() {
      if (SITES) return SITES;
      const lib = named(/University Library/) || [-608, -119];
      SITES = {
        library: { name: "University Library", p: roadside(lib) },
        canteen: { name: "Brijwasi Canteen", p: roadside(poi(/Brijwasi/) || [-405, -137]) },
        stadium: { name: "Stevenson Stadium", p: roadside(poi(/Stevenson/) || [435, 97]) },
        post: { name: "Post Office", p: roadside(poi(/Post Office/) || [-1554, -743]) },
        hospital: { name: "Campus hospital", p: roadside(poi(/hospital|dispensary|health/i) || named(/hospital|health/i) || lib) },
      };
      return SITES;
    }
    const JOBS = [
      { id: "chai", name: "Chai Express", site: "canteen", color: 0xff9f1c, blurb: "Hot chai for a hostel. It will not stay hot for long." },
      { id: "cab", name: "Campus Cab", site: "library", color: 0x2ec4b6, blurb: "Pick up a student at a hostel and drop them at class." },
      { id: "race", name: "Pantnagar Circuit", site: "stadium", color: 0xe71d36, blurb: "Hit every checkpoint before the clock runs out." },
      { id: "lost", name: "Lost and Found", site: "post", color: 0x9b5de5, blurb: "A bag was left somewhere on campus. Bring it back." },
    ];
    const giverBeacons = new Map();
    let job = null; // { def, stage, target:{x,z,label}, T, reward, points, ...}
    const targetBeacon = beacon(0xffd23f);
    let routeNodes = null, routeAt = { x: 1e9, z: 1e9, t: 0, tx: 0, tz: 0 }, waypoint = null;

    function startJob(def) {
      const S = sites();
      const here = [P.x, P.z];
      if (def.id === "chai") {
        const h = pick(hostels), to = roadside(h.c) || [P.x + 300, P.z];
        const d = Math.hypot(to[0] - here[0], to[1] - here[1]);
        job = { def, stage: 1, target: { x: to[0], z: to[1], label: h.name }, T: Math.round(d / 7 + 35), reward: Math.round(120 + d / 8), text: `Deliver the chai to <b>${esc(h.name)}</b>` };
      } else if (def.id === "cab") {
        const h = pick(hostels), from = roadside(h.c) || [P.x + 200, P.z];
        job = { def, stage: 0, target: { x: from[0], z: from[1], label: h.name }, T: 120, reward: 0, text: `Pick up the student at <b>${esc(h.name)}</b>`, needCar: true, college: pick(colleges) };
      } else if (def.id === "race") {
        const pts = racePoints();
        job = { def, stage: 1, points: pts, i: 0, target: { x: pts[0][0], z: pts[0][1], label: "Checkpoint 1" }, T: Math.round(pts.len / 12 + 20), reward: 400, text: `Checkpoint 1 of ${pts.length}`, needCar: true };
      } else {
        let spot = null;
        for (let i = 0; i < 40 && !spot; i++) { const n = pick(NET.driveNodes), d = Math.hypot(nx(n) - here[0], nz(n) - here[1]); if (d > 350 && d < 1000) spot = [nx(n), nz(n)]; }
        spot = spot || [here[0] + 300, here[1]];
        const d = Math.hypot(spot[0] - here[0], spot[1] - here[1]);
        job = { def, stage: 0, target: { x: spot[0], z: spot[1], label: "the lost bag" }, T: Math.round((2 * d) / 6 + 60), reward: Math.round(150 + d / 5), text: "Find the lost bag", home: S.post.p };
      }
      job.t0 = job.T;
      banner(def.name, def.blurb, 2.6, "job");
      AU.blip(660);
      routeAt.t = 0;
    }
    function racePoints() {
      const pts = [];
      let n = nearestNode(P.x, P.z), prevK = -1, acc = 0, total = 0;
      for (let step = 0; step < 400 && pts.length < 8; step++) {
        const opts = NET.adjD[n].filter((k) => k !== prevK && (NET.cls[k] === "major" || NET.cls[k] === "minor"));
        if (!opts.length) break;
        const k = pick(opts), m = other(k, n);
        acc += NET.len[k]; total += NET.len[k];
        if (acc > 280) { pts.push([nx(m), nz(m)]); acc = 0; }
        prevK = k; n = m;
      }
      if (pts.length < 3) pts.push([P.x + 200, P.z], [P.x + 200, P.z + 200], [P.x, P.z + 200]);
      pts.len = Math.max(total, 900);
      return pts;
    }
    function endJob(ok, extra) {
      if (!job) return;
      const def = job.def;
      if (ok) {
        const bonus = Math.max(0, Math.round(job.T * 2));
        const pay = job.reward + bonus;
        P.cash += pay; DONE[def.id] = (DONE[def.id] || 0) + 1;
        if (def.id === "race") { const tm = job.t0 - job.T; if (!BEST.race || tm < BEST.race) BEST.race = Math.round(tm); }
        banner("Job done", `+₹${fmt(pay)}${bonus ? ` (₹${fmt(bonus)} time bonus)` : ""}${extra ? " · " + extra : ""}`, 3.2, "pass");
        AU.jingle(true);
        save();
      } else {
        banner("Job failed", extra || "Out of time", 3, "fail");
        AU.jingle(false);
      }
      job = null; routeNodes = null; targetBeacon.visible = false;
    }
    function jobTick(dt) {
      if (!job) return;
      job.T -= dt;
      if (job.T <= 0) { endJob(false); return; }
      const inCar = !!P.car;
      const near = Math.hypot(P.x - job.target.x, P.z - job.target.z) < (inCar ? 7 : 4);
      if (job.needCar && !inCar && job.stage > 0) { prompt("Get back in a vehicle"); }
      if (!near) return;
      if (job.needCar && !inCar) { prompt("You need a vehicle for this job"); return; }
      const d = job.def.id;
      if (d === "chai") endJob(true);
      else if (d === "cab") {
        if (job.stage === 0) {
          if (Math.abs(P.car.v) > 2) { prompt("Stop to let the student in"); return; }
          const to = roadside(job.college.c) || [P.x + 300, P.z], dd = Math.hypot(to[0] - P.x, to[1] - P.z);
          job.stage = 1; job.target = { x: to[0], z: to[1], label: job.college.name }; job.T = Math.round(dd / 7 + 30); job.t0 = job.T; job.reward = Math.round(100 + dd / 6);
          job.text = `Drop the student at <b>${esc(job.college.name)}</b>`;
          say(pick(["Bhaiya, jaldi! Class hai.", "Late ho gaya, please hurry!", "Practical starts in five minutes!"]), 3.5);
          AU.blip(880); routeAt.t = 0;
        } else {
          if (Math.abs(P.car.v) > 2) { prompt("Stop to drop the student"); return; }
          say(pick(["Thank you bhaiya!", "Just in time!", "Best ride on campus."]), 2.5);
          endJob(true);
        }
      } else if (d === "race") {
        job.i++;
        AU.blip(990);
        if (job.i >= job.points.length) { endJob(true, `${Math.round(job.t0 - job.T)} s`); return; }
        const p = job.points[job.i];
        job.target = { x: p[0], z: p[1], label: `Checkpoint ${job.i + 1}` };
        job.text = `Checkpoint ${job.i + 1} of ${job.points.length}`;
        routeAt.t = 0;
      } else if (d === "lost") {
        if (job.stage === 0) { job.stage = 1; job.target = { x: job.home[0], z: job.home[1], label: "Post Office" }; job.text = "Bring the bag to the <b>Post Office</b>"; say("Found it! Now back to the Post Office.", 2.5); AU.blip(880); routeAt.t = 0; }
        else endJob(true);
      }
    }

    // -------------------------------------------------------------------------------------
    // Wanted level and campus security
    function crime(level, why) {
      const before = P.wanted;
      P.wanted = clamp(P.wanted + level, 0, 4);
      P.coolT = 0;
      if (P.wanted > before) { flashStars(); if (why) prompt(why, 2); }
    }
    let bustT = 0, copSpawnT = 0;
    function copsTick(dt) {
      const want = Math.min(P.wanted, 4);
      copSpawnT -= dt;
      if (cops.length < want && copSpawnT <= 0) {
        copSpawnT = 2;
        const sp = spawnSpot(140, 300, drivable);
        if (sp) {
          const c = makeCar("jeep", nx(sp.n), nz(sp.n), 0, "cop");
          onEdge(c, sp.k, sp.n, 0);
          c.ai.chase = true; c.ai.path = null; c.ai.pathT = 0;
          cops.push(c);
        }
      }
      // Evasion: no unit close with a clear view for 10 s drops a star.
      let seen = false;
      for (const c of cops) if (!c.wreck && Math.hypot(c.x - P.x, c.z - P.z) < 90 && clearLine(c.x, c.z, P.x, P.z)) seen = true;
      if (P.wanted > 0) {
        P.coolT = seen ? 0 : P.coolT + dt;
        if (P.coolT > 10) { P.wanted--; P.coolT = 0; flashStars(); if (!P.wanted) { banner("Lost them", "Campus security gave up", 2.2, "pass"); P.cash += 50; } }
      }
      if (!P.wanted) for (const c of cops.slice()) if (Math.hypot(c.x - P.x, c.z - P.z) > 180) removeCar(c);
      // Busted
      let close = false;
      for (const c of cops) if (!c.wreck && Math.hypot(c.x - P.x, c.z - P.z) < (P.car ? 7 : 4.5) && Math.abs(c.v) < 4) close = true;
      const slow = P.car ? Math.abs(P.car.v) < 2.5 : true;
      bustT = P.wanted && close && slow ? bustT + dt : Math.max(0, bustT - dt * 2);
      if (bustT > 2.5) busted();
    }
    function copDrive(c, dt) {
      const ai = c.ai;
      const tx = P.car ? P.car.x : P.x, tz = P.car ? P.car.z : P.z;
      const d = Math.hypot(tx - c.x, tz - c.z);
      let gx = tx, gz = tz;
      if (d > 45 || !clearLine(c.x, c.z, tx, tz)) {
        ai.pathT -= dt;
        if (ai.pathT <= 0 || !ai.path) { ai.path = route(nearestNode(c.x, c.z), nearestNode(tx, tz)); ai.pathT = 2; ai.pi = 0; }
        if (ai.path && ai.path.length) {
          while (ai.pi < ai.path.length - 1 && Math.hypot(nx(ai.path[ai.pi]) - c.x, nz(ai.path[ai.pi]) - c.z) < 9) ai.pi++;
          gx = nx(ai.path[ai.pi]); gz = nz(ai.path[ai.pi]);
        }
      }
      const want = yawOf(gx - c.x, gz - c.z), err = angDiff(c.yaw, want);
      const steer = clamp(err * 2.2, -1, 1), sharp = Math.abs(err) > 0.9;
      const throttle = d < 8 ? -0.3 : sharp && c.v > 8 ? -0.5 : 1;
      drive(c, throttle, steer, false, dt);
    }
    function busted() {
      bustT = 0;
      const fine = Math.round(P.cash * 0.15);
      P.cash -= fine; P.wanted = 0;
      if (P.car) leaveCar(true);
      for (const c of cops.slice()) removeCar(c);
      if (job) { job = null; routeNodes = null; targetBeacon.visible = false; }
      const s = sites().library.p;
      placePlayer(s[0], s[1]);
      banner("Busted", `Campus security fined you ₹${fmt(fine)}`, 3.5, "fail");
      AU.jingle(false);
      save();
    }
    function wasted() {
      const fee = Math.round(P.cash * 0.1);
      P.cash -= fee; P.wanted = 0; P.health = 100;
      if (P.car) leaveCar(true);
      for (const c of cops.slice()) removeCar(c);
      if (job) { job = null; routeNodes = null; targetBeacon.visible = false; }
      const s = sites().hospital.p;
      placePlayer(s[0], s[1]);
      banner("Wasted", `Patched up at the campus hospital: ₹${fmt(fee)}`, 3.5, "fail");
      AU.jingle(false);
      save();
    }

    // -------------------------------------------------------------------------------------
    // Driving (shared by the player, campus security and free cars)
    const corners = (c, x, z, yaw, inset = 0) => {
      const [fx, fz] = fwd(yaw), L = c.t.L / 2 - inset, W = c.t.W / 2 - inset * 0.5;
      return [[x + fx * L + fz * W, z + fz * L - fx * W], [x + fx * L - fz * W, z + fz * L + fx * W], [x - fx * L + fz * W, z - fz * L - fx * W], [x - fx * L - fz * W, z - fz * L + fx * W], [x + fx * L, z + fz * L]];
    };
    function drive(c, throttle, steerIn, hand, dt) {
      if (c.wreck) { throttle = 0; steerIn = 0; }
      const t = c.t, max = t.max * (c.dmg > 70 ? 0.6 : 1);
      // longitudinal
      // throttle forward; braking, then reverse, when pulling back
      if (throttle > 0) c.v += (c.v < -0.5 ? 14 : t.acc * (1 - Math.max(0, c.v) / max)) * throttle * dt;
      else if (throttle < 0) c.v -= (c.v > 0.5 ? 14 : t.acc * 0.6) * -throttle * dt;
      const off = !onRoad(c.x, c.z);
      const drag = 0.08 + (off ? 0.5 : 0) + (hand ? 1.6 : 0);
      c.v -= c.v * drag * dt + Math.sign(c.v) * (off ? 1.2 : 0.4) * dt;
      if (Math.abs(c.v) < 0.05 && throttle === 0) c.v = 0;
      c.v = clamp(c.v, -max * 0.3, max);
      // steering
      const sMax = (t.bike ? 0.7 : 0.55) * (1 - Math.min(0.65, (Math.abs(c.v) / max) * 0.8));
      c.steer += (steerIn * sMax - c.steer) * Math.min(1, dt * 7);
      const wb = t.L * 0.62;
      let yawRate = (c.v / wb) * Math.tan(c.steer) * (hand ? 1.5 : 1);
      const ny = c.yaw + yawRate * dt;
      const [fx, fz] = fwd(ny);
      const nxp = c.x + fx * c.v * dt, nzp = c.z + fz * c.v * dt;
      // buildings, trees, edge of the world
      let hit = false;
      const stuck = corners(c, c.x, c.z, c.yaw, 0.15).some(([a, b]) => solid(a, b));
      if (!stuck) for (const [px, pz] of corners(c, nxp, nzp, ny, 0.15)) if (solid(px, pz)) { hit = true; break; }
      if (!hit && !stuck && Math.abs(c.v) > 1 && treeHit(nxp + fx * c.t.L * 0.45, nzp + fz * c.t.L * 0.45, 0.3) && !treeHit(c.x + fx * c.t.L * 0.45, c.z + fz * c.t.L * 0.45, 0.3)) hit = true;
      if (hit) {
        const imp = Math.abs(c.v);
        c.v = -c.v * 0.25;
        if (imp > 3) bump(c, imp);
        // try to slide along whatever was hit
        if (!corners(c, nxp, c.z, c.yaw, 0.15).some(([a, b]) => solid(a, b))) c.x = nxp;
        else if (!corners(c, c.x, nzp, c.yaw, 0.15).some(([a, b]) => solid(a, b))) c.z = nzp;
        return;
      }
      c.x = nxp; c.z = nzp; c.yaw = ny;
      settle(c);
    }
    function settle(c) {
      const [fx, fz] = fwd(c.yaw), h = c.t.L * 0.4, w = c.t.W * 0.45;
      const yf = H(c.x + fx * h, c.z + fz * h), yb = H(c.x - fx * h, c.z - fz * h), yl = H(c.x + fz * w, c.z - fx * w), yr = H(c.x - fz * w, c.z + fx * w);
      c.y = (yf + yb + yl + yr) / 4;
      c.pitch = Math.atan2(yf - yb, h * 2);
      c.roll = Math.atan2(yl - yr, w * 2);
    }
    function onRoad(x, z) { const ne = A.nearestEdge(x, z, 12); return !!(ne && ne.d < roadW(ne.k) / 2 + 1.5); }
    function bump(c, imp) {
      c.dmg = Math.min(100, c.dmg + imp * 1.6);
      if (c.dmg >= 100 && !c.wreck) { c.wreck = true; c.v = 0; if (c === P.car) { prompt("Wrecked! Press F to get out", 3); AU.crash(1); } }
      if (c === P.car) { shake = Math.min(1, imp / 15); AU.crash(Math.min(1, imp / 18)); }
      else if (Math.hypot(c.x - P.x, c.z - P.z) < 60) AU.crash(Math.min(0.6, imp / 25));
    }

    // Car vs car (two circles per car)
    function circles(c) { const [fx, fz] = fwd(c.yaw), o = c.t.L / 2 - c.t.W / 2; return [[c.x + fx * o, c.z + fz * o], [c.x - fx * o, c.z - fz * o]]; }
    function carCollisions() {
      const dyn = cars.filter((c) => c === P.car || c.role === "cop" || c.role === "free");
      for (const a of dyn) {
        for (const b of cars) {
          if (a === b || Math.abs(a.x - b.x) > 12 || Math.abs(a.z - b.z) > 12) continue;
          const ra = a.t.W / 2 + 0.1, rb = b.t.W / 2 + 0.1;
          let best = null;
          for (const p of circles(a)) for (const q of circles(b)) { const dx = p[0] - q[0], dz = p[1] - q[1], d = Math.hypot(dx, dz); if (d < ra + rb && (!best || d < best.d)) best = { d, dx, dz }; }
          if (!best) continue;
          const nX = best.dx / (best.d || 1), nZ = best.dz / (best.d || 1), pen = ra + rb - best.d;
          const bDyn = b === P.car || b.role === "cop" || b.role === "free";
          a.x += nX * pen * (bDyn ? 0.5 : 1); a.z += nZ * pen * (bDyn ? 0.5 : 1);
          if (bDyn) { b.x -= nX * pen * 0.5; b.z -= nZ * pen * 0.5; }
          const rel = Math.abs(a.v - (b.v || 0) * Math.cos(angDiff(a.yaw, b.yaw)));
          if (rel > 2.5) {
            bump(a, rel); bump(b, rel * 0.8);
            a.v *= 0.45;
            if (b.role === "traffic" || b.role === "parked") { b.stun = 2.5; b.v = 0; b.honkT = 0.6; }
            if ((a === P.car && b.role === "cop") || (b === P.car && a.role === "cop")) crime(1, "You rammed campus security");
          }
        }
      }
    }

    // -------------------------------------------------------------------------------------
    // Player
    function placePlayer(x, z) {
      P.x = x; P.z = z; P.y = H(x, z); P.vy = 0; P.car = null;
      camYaw = P.yaw;
    }
    function enterCar() {
      let best = null, bd = 4.2;
      for (const c of cars) { const d = Math.hypot(c.x - P.x, c.z - P.z) - c.t.L * 0.3; if (d < bd && !c.wreck) { bd = d; best = c; } }
      if (!best) return false;
      if (best.driver === "ai") {
        // The driver gets out and runs.
        const [fx, fz] = fwd(best.yaw), sx = best.x + fz * (best.t.W / 2 + 1), sz = best.z - fx * (best.t.W / 2 + 1);
        const p = spawnPed(sx, sz, null, -1, 0);
        p.state = "flee"; p.t = 4; p.fx = sx - P.x; p.fz = sz - P.z;
        p.say = { text: best.role === "cop" ? "Hey! That's a security jeep!" : pick(["Meri gaadi!", "Oye! Chor!", "Arre, ruko!"]), t: 2.5 };
        crime(best.role === "cop" ? 2 : 1, best.role === "cop" ? "You took a security jeep" : "Car theft");
        const ci = cops.indexOf(best); if (ci >= 0) cops.splice(ci, 1);
      }
      best.role = "player"; best.driver = "player"; best.ai = null; best.stun = 0;
      P.car = best;
      AU.door();
      prompt(`${best.t.label}. W/S drive, A/D steer, Space handbrake, F to get out`, 3.5);
      return true;
    }
    function leaveCar(force) {
      const c = P.car;
      if (!c) return;
      if (!force && Math.abs(c.v) > 4) { prompt("Slow down to get out", 1.5); return; }
      const [fx, fz] = fwd(c.yaw);
      // India drives on the left: get out on the right (driver's) side, else the left.
      let ex = c.x - fz * (c.t.W / 2 + 0.9), ez = c.z + fx * (c.t.W / 2 + 0.9);
      if (solid(ex, ez)) { ex = c.x + fz * (c.t.W / 2 + 0.9); ez = c.z - fx * (c.t.W / 2 + 0.9); }
      if (solid(ex, ez)) { ex = c.x - fx * (c.t.L / 2 + 1); ez = c.z - fz * (c.t.L / 2 + 1); }
      c.role = "free"; c.driver = null;
      P.car = null; P.x = ex; P.z = ez; P.y = H(ex, ez); P.yaw = c.yaw; P.vy = 0;
      AU.door();
    }
    function footTick(dt) {
      if (P.knock > 0) { P.knock -= dt; return; }
      const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.sprint;
      let mx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      let mz = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      if (touch.on) { mx = touch.x; mz = -touch.y; }
      const mag = Math.min(1, Math.hypot(mx, mz));
      const spd = (sprint ? 6.2 : 2.4) * mag;
      if (mag > 0.05) {
        const want = camYaw + Math.atan2(mx, mz);
        P.yaw += angDiff(P.yaw, want) * Math.min(1, dt * 12);
        const [fx, fz] = fwd(P.yaw), dx = fx * spd * dt, dz = fz * spd * dt;
        const free = (x, z) => !solid(x, z) && !solid(x + 0.3, z) && !solid(x - 0.3, z) && !solid(x, z + 0.3) && !solid(x, z - 0.3) && !treeHit(x, z, 0.2) && !carAt(x, z);
        if (free(P.x + dx, P.z + dz)) { P.x += dx; P.z += dz; }
        else if (free(P.x + dx, P.z)) P.x += dx;
        else if (free(P.x, P.z + dz)) P.z += dz;
        P.phase += spd * dt * 2.4;
      } else P.phase *= 0.9;
      P.spd = spd;
      const g = H(P.x, P.z);
      if ((keys.has("Space") || touch.jump) && P.y <= g + 0.01) { P.vy = 5.2; touch.jump = false; }
      P.vy -= 15 * dt;
      P.y = Math.max(g, P.y + P.vy * dt);
      if (P.y === g) P.vy = 0;
    }
    function carAt(x, z) {
      for (const c of cars) {
        if (Math.abs(c.x - x) > 6 || Math.abs(c.z - z) > 6) continue;
        const [fx, fz] = fwd(c.yaw), dx = x - c.x, dz = z - c.z, along = dx * fx + dz * fz, across = dx * fz - dz * fx;
        if (Math.abs(along) < c.t.L / 2 + 0.2 && Math.abs(across) < c.t.W / 2 + 0.2) return c;
      }
      return null;
    }
    function carTick(dt) {
      const c = P.car;
      let thr = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      let st = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      if (touch.on) { st = touch.x; thr = -touch.y; }
      drive(c, thr, st, keys.has("Space") || touch.brake, dt);
      P.x = c.x; P.z = c.z; P.y = c.y; P.yaw = c.yaw;
      // People in the way
      if (Math.abs(c.v) > 2.5) {
        const [fx, fz] = fwd(c.yaw);
        for (const p of peds) {
          if (p.state === "down") continue;
          const dx = p.x - c.x, dz = p.z - c.z, along = dx * fx + dz * fz, across = dx * fz - dz * fx;
          if (Math.abs(across) < c.t.W / 2 + 0.4 && along > -c.t.L / 2 && along < c.t.L / 2 + 0.8) {
            knockPed(p, c);
            c.v *= 0.8;
            crime(1, "You hit a pedestrian");
          } else if (Math.abs(across) < 4 && along > 0 && along < 14 && Math.abs(c.v) > 6 && p.state === "walk") { p.state = "flee"; p.t = 1.6; p.fx = across > 0 ? fz : -fz; p.fz = across > 0 ? -fx : fx; }
        }
      }
      for (const c2 of cops) if (Math.hypot(c2.x - c.x, c2.z - c.z) < 60 && Math.abs(c.v) > 25 && !P.wanted) crime(1, "Speeding past campus security");
    }
    function knockPed(p, c) {
      p.state = "down"; p.t = 3.2; const [fx, fz] = fwd(c.yaw);
      p.fx = fx * Math.min(8, Math.abs(c.v) * 0.5); p.fz = fz * Math.min(8, Math.abs(c.v) * 0.5);
      p.say = { text: pick(["Arre bhai!", "Dhyan se chalao!", "Oye!", "Kya kar rahe ho?!", "Aankhen hai ya button?"]), t: 2.2 };
      AU.thud();
    }

    // -------------------------------------------------------------------------------------
    // Traffic and pedestrians
    let spawnT = 0;
    const TRAFFIC_N = 28, PED_N = 34;
    function populate(dt) {
      spawnT -= dt;
      if (spawnT > 0) return;
      spawnT = 0.35;
      // despawn far away
      for (const c of cars.slice()) { const d = Math.hypot(c.x - P.x, c.z - P.z); if ((c.role === "traffic" && d > 650) || ((c.role === "free" || c.wreck) && d > 900 && c !== P.car)) removeCar(c); }
      for (let i = peds.length - 1; i >= 0; i--) if (Math.hypot(peds[i].x - P.x, peds[i].z - P.z) > 300) peds.splice(i, 1);
      const nTraffic = cars.filter((c) => c.role === "traffic").length;
      if (nTraffic < TRAFFIC_N) {
        for (let i = 0; i < 1; i++) {
          const sp = spawnSpot(140, 480, drivable);
          if (!sp) break;
          const n = sp.n, k = sp.k;
          const r = rnd(), type = NET.cls[k] === "dirt" ? (r < 0.5 ? "tractor" : r < 0.8 ? "scooter" : "auto") : NET.cls[k] === "major" && r < 0.08 ? "bus" : r < 0.38 ? "hatch" : r < 0.55 ? "sedan" : r < 0.8 ? "auto" : r < 0.95 ? "scooter" : "tractor";
          const c = makeCar(type, 0, 0, 0, "traffic");
          onEdge(c, k, n, 0);
          c.v = SPEED[NET.cls[k]] * 0.6;
          c.ai.mood = 0.8 + rnd() * 0.35;
          break;
        }
      }
      if (peds.length < PED_N) {
        for (let i = peds.length < PED_N / 2 ? 4 : 1; i > 0; i--) { const sp = spawnSpot(35, 200, (k) => NET.ok[k]); if (sp) spawnPed(nx(sp.n), nz(sp.n), sp.k, sp.n, 0); }
      }
    }
    function nextEdge(at, cameK, adj) {
      const opts = adj[at].filter((k) => k !== cameK);
      if (!opts.length) return cameK;
      const inYaw = yawOf(nx(at) - nx(other(cameK, at)), nz(at) - nz(other(cameK, at)));
      let tot = 0;
      const w = opts.map((k) => { const o = other(k, at), turn = Math.abs(angDiff(inYaw, yawOf(nx(o) - nx(at), nz(o) - nz(at)))); const ww = 0.4 + Math.cos(turn) + 1; tot += ww; return ww; });
      let r = rnd() * tot;
      for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
      return opts[0];
    }
    function trafficTick(dt) {
      for (const c of cars) {
        if (c.role !== "traffic" || !c.ai) continue;
        if (c.stun > 0) { c.stun -= dt; c.honkT -= dt; continue; }
        const ai = c.ai, L = NET.len[ai.k];
        let target = SPEED[NET.cls[ai.k]] * ai.mood * (c.type === "tractor" ? 0.5 : c.type === "auto" ? 0.8 : c.type === "bus" ? 0.8 : 1);
        target = Math.min(target, c.t.max);
        // slow for a sharp turn ahead
        if (L - ai.s < 14) target = Math.min(target, 6);
        // keep a gap to anything ahead (cars, the player, people)
        const [fx, fz] = fwd(c.yaw);
        const ahead = (x, z, len) => { const dx = x - c.x, dz = z - c.z, along = dx * fx + dz * fz, across = Math.abs(dx * fz - dz * fx); return along > 0 && along < 32 && across < 2.3 ? along - len : Infinity; };
        let gap = Infinity;
        for (const o of cars) if (o !== c && Math.abs(o.x - c.x) < 34 && Math.abs(o.z - c.z) < 34) gap = Math.min(gap, ahead(o.x, o.z, (o.t.L + c.t.L) / 2));
        if (!P.car) gap = Math.min(gap, ahead(P.x, P.z, c.t.L / 2 + 0.5));
        for (const p of peds) if (p.state !== "down" && Math.abs(p.x - c.x) < 20 && Math.abs(p.z - c.z) < 20) gap = Math.min(gap, ahead(p.x, p.z, c.t.L / 2 + 0.5) + 1);
        if (gap < 30) target = Math.min(target, Math.max(0, (gap - 3) * 0.9));
        if (gap < 6 && Math.abs(c.v) < 1) { c.honkT -= dt; if (c.honkT <= 0) { c.honkT = 3 + rnd() * 3; if (Math.hypot(c.x - P.x, c.z - P.z) < 40) AU.honk(0.35, c.type === "bus" ? 0.6 : 0.3); } }
        c.v += clamp(target - c.v, -9 * dt, 3 * dt);
        ai.s += c.v * dt;
        while (ai.s >= NET.len[ai.k]) {
          ai.s -= NET.len[ai.k];
          const k2 = nextEdge(ai.to, ai.k, NET.adjD);
          if (k2 === ai.k) { const f = ai.to; ai.to = ai.from; ai.from = f; }
          else { ai.from = ai.to; ai.to = other(k2, ai.from); ai.k = k2; ai.off = clamp(roadW(k2) / 4, 1.1, 2.4); }
        }
        const p = edgePos(ai), want = yawOf(nx(ai.to) - nx(ai.from), nz(ai.to) - nz(ai.from));
        c.x = p[0]; c.z = p[1];
        c.yaw += angDiff(c.yaw, want) * Math.min(1, dt * 5);
        settle(c);
      }
      for (const c of cars) if (c.role === "free" && c !== P.car) { if (Math.abs(c.v) > 0.1) drive(c, 0, 0, true, dt); }
      for (const c of cops) if (!c.wreck) copDrive(c, dt);
    }
    function pedTick(dt) {
      for (const p of peds) {
        if (p.say) { p.say.t -= dt; if (p.say.t <= 0) p.say = null; }
        if (p.state === "down") {
          p.t -= dt;
          const nxp = p.x + p.fx * dt, nzp = p.z + p.fz * dt;
          if (!solid(nxp, nzp)) { p.x = nxp; p.z = nzp; }
          p.fx *= 0.9; p.fz *= 0.9;
          if (p.t <= 0) { p.state = "flee"; p.t = 3; p.fx = rnd() - 0.5; p.fz = rnd() - 0.5; }
          continue;
        }
        if (p.state === "flee") {
          p.t -= dt;
          const L = Math.hypot(p.fx, p.fz) || 1, sp = 4.2;
          const nxp = p.x + (p.fx / L) * sp * dt, nzp = p.z + (p.fz / L) * sp * dt;
          if (!solid(nxp, nzp)) { p.x = nxp; p.z = nzp; } else { p.fx = -p.fz; p.fz = p.fx; }
          p.yaw = yawOf(p.fx, p.fz); p.phase += sp * dt * 2.4;
          if (p.t <= 0) {
            const ne = A.nearestEdge(p.x, p.z, 80);
            if (ne) { const e = GE[ne.k]; p.k = ne.k; p.from = e[0]; p.to = e[1]; p.s = ne.t * (NET.len[ne.k] || 1); p.state = "walk"; } else p.t = 2;
          }
          continue;
        }
        if (p.k == null || !NET.ok[p.k]) { p.state = "flee"; p.t = 0.1; continue; }
        // horn or a fast car nearby scares people
        const L = NET.len[p.k];
        p.s += p.v * dt;
        if (p.s >= L) {
          p.s -= L;
          const k2 = nextEdge(p.to, p.k, NET.adjW);
          if (k2 === p.k) { const f = p.to; p.to = p.from; p.from = f; } else { p.from = p.to; p.to = other(k2, p.from); p.k = k2; }
        }
        const ax = nx(p.from), az = nz(p.from), bx = nx(p.to), bz = nz(p.to), LL = NET.len[p.k], t = clamp(p.s / LL, 0, 1);
        const fx = (bx - ax) / LL, fz = (bz - az) / LL, off = (roadW(p.k) / 2 + 1.1) * p.side;
        p.x = ax + (bx - ax) * t + fz * off; p.z = az + (bz - az) * t - fx * off;
        p.yaw = yawOf(fx, fz);
        p.phase += p.v * dt * 2.4;
      }
    }

    // -------------------------------------------------------------------------------------
    // Drawing: vehicles, people, lights
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), white = new THREE.Color(1, 1, 1);
    const pm = new THREE.Matrix4(), lm = new THREE.Matrix4();
    let night = 0;
    function draw(t) {
      for (const f of fleets.values()) f.n = 0;
      const cx = camera.position.x, cz = camera.position.z;
      const blink = Math.floor(t * 6) % 2;
      for (const c of cars) {
        const d = Math.hypot(c.x - cx, c.z - cz);
        if (d > 700) continue;
        const key = c.type + ((c.type === "scooter" || c.type === "tractor") && c.driver ? "_r" : "");
        const f = fleet(key);
        if (f.n >= f.cap) continue;
        e3.set(-c.pitch, -c.yaw, c.roll, "YXZ");
        q.setFromEuler(e3);
        m4.compose(v3.set(c.x, c.y, c.z), q, one);
        f.paint.setMatrixAt(f.n, m4); f.trim.setMatrixAt(f.n, m4);
        const pc = c.wreck ? new THREE.Color(0.18, 0.17, 0.16) : c.paint;
        f.paint.setColorAt(f.n, pc); f.trim.setColorAt(f.n, c.wreck ? new THREE.Color(0.4, 0.4, 0.4) : white);
        f.n++;
        if (d < 260) {
          const [fx, fz] = fwd(c.yaw), Lh = c.t.L / 2, Wl = c.t.W / 2 - 0.3, hy = c.y + 0.8;
          if (night > 0.2 && !c.wreck && (c.driver || c.role === "traffic")) {
            for (const s of [-1, 1]) carGlow.add(c.x + fx * (Lh + 0.1) + fz * Wl * s, hy, c.z + fz * (Lh + 0.1) - fx * Wl * s, 1, 0.92, 0.7);
            for (const s of [-1, 1]) carGlow.add(c.x - fx * (Lh + 0.1) + fz * Wl * s, hy, c.z - fz * (Lh + 0.1) - fx * Wl * s, 0.9, 0.08, 0.05);
          }
          if (c.siren && c.t.police && !c.wreck) {
            sirenGlow.add(c.x - fz * 0.4, c.y + 2.15, c.z + fx * 0.4, blink ? 1 : 0.1, 0.05, blink ? 0.05 : 0.15);
            sirenGlow.add(c.x + fz * 0.4, c.y + 2.15, c.z - fx * 0.4, 0.05, blink ? 0.1 : 0.3, blink ? 0.2 : 1);
          }
          if (c.dmg > 60 && rnd() < 0.15) puff(c.x + fx * Lh * 0.7, c.y + 1.2, c.z + fz * Lh * 0.7);
        }
      }
      for (const f of fleets.values()) {
        for (const m of [f.paint, f.trim]) { m.count = f.n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      }
      // people
      let n = 0;
      const person = (x, y, z, yaw, phase, moving, shirt, pants, skin, lying, seated) => {
        if (n >= PCAP) return;
        e3.set(lying ? -Math.PI / 2 : 0, -yaw, 0, "YXZ"); q.setFromEuler(e3);
        pm.compose(v3.set(x, y + (lying ? 0.25 : 0), z), q, one);
        const sw = moving ? Math.sin(phase) * 0.7 : 0;
        const put = (mesh, i, ox, oy, oz, rx, col) => { lm.makeRotationX(rx); lm.setPosition(ox, oy, oz); m4.multiplyMatrices(pm, lm); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, col); };
        put(P_T, n, 0, 1.33, 0, 0, shirt);
        put(P_H, n, 0, 1.78, 0, 0, skin);
        put(P_L, n * 2, -0.11, 1.03, 0, seated ? -1.4 : sw, pants);
        put(P_L, n * 2 + 1, 0.11, 1.03, 0, seated ? -1.4 : -sw, pants);
        put(P_A, n * 2, -0.28, 1.6, 0, -sw * 0.8, shirt);
        put(P_A, n * 2 + 1, 0.28, 1.6, 0, sw * 0.8, shirt);
        n++;
      };
      if (!P.car) person(P.x, P.y, P.z, P.yaw, P.phase, P.spd > 0.1, PLAYER_SHIRT, PLAYER_PANTS, PLAYER_SKIN, P.knock > 0, false);
      for (const p of peds) if (Math.hypot(p.x - cx, p.z - cz) < 260) person(p.x, H(p.x, p.z), p.z, p.yaw, p.phase, p.state !== "down", p.shirt, p.pants, p.skin, p.state === "down", false);
      for (const m of [P_T, P_H, P_L, P_A]) { m.count = m === P_T || m === P_H ? n : n * 2; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      // street lamps at night
      if (night > 0.2) for (const l of LAMPS) { if (Math.abs(l[0] - cx) < 450 && Math.abs(l[2] - cz) < 450) { const [ax, az] = [Math.cos(l[3]) * 1.35, -Math.sin(l[3]) * 1.35]; lampGlow.add(l[0] + ax, l[1] + 6.8, l[2] + az, 1, 0.82, 0.55); } }
      carGlow.done(); lampGlow.done(); sirenGlow.done();
      carGlow.p.visible = lampGlow.p.visible = night > 0.2;
      // headlight pool
      if (P.car && night > 0.3 && !P.car.wreck) {
        const [fx, fz] = fwd(P.car.yaw);
        pool.position.set(P.car.x + fx * (P.car.t.L / 2 + 8), H(P.car.x + fx * 10, P.car.z + fz * 10) + 0.4, P.car.z + fz * (P.car.t.L / 2 + 8));
        pool.rotation.y = -P.car.yaw; pool.visible = true; poolMat.opacity = 0.55 * night;
      } else pool.visible = false;
      // smoke
      for (const s of smoke) if (s.s.visible) { s.t -= 1 / 60; s.s.position.y += 0.03; s.s.scale.multiplyScalar(1.01); s.s.material.opacity = Math.max(0, s.t) * 0.4; if (s.t <= 0) s.s.visible = false; }
    }
    const PLAYER_SHIRT = new THREE.Color("#e2702b"), PLAYER_PANTS = new THREE.Color("#22314f"), PLAYER_SKIN = new THREE.Color("#b5783f");
    function puff(x, y, z) { const s = smoke[smokeI++ % smoke.length]; s.s.position.set(x, y, z); s.s.scale.set(1.2, 1.2, 1); s.s.visible = true; s.t = 1.2; }
    let LAMPS = [];

    // -------------------------------------------------------------------------------------
    // Camera
    function cameraTick(dt) {
      const tgt = P.car || P, isCar = !!P.car;
      const yawT = isCar ? P.car.yaw : P.yaw;
      // behind the vehicle unless the player is looking around
      if (performance.now() / 1000 - lastMouse > (isCar ? 1.2 : 3)) camYaw += angDiff(camYaw, yawT) * Math.min(1, dt * (isCar ? 2.8 : 1.2));
      const base = isCar ? Math.max(6.5, P.car.t.L * 1.4 + 3) : 4.2;
      const dist = base * [1, 1.6, 0.0001][camMode] * camDist;
      const speed = isCar ? Math.abs(P.car.v) : 0;
      const fov = isCar ? 62 + Math.min(18, speed * 0.5) : 58;
      const lookY = (tgt.y || P.y) + (isCar ? 1.3 : 1.55);
      const [fx, fz] = fwd(camYaw), cp = Math.cos(camPitch), sp = Math.sin(camPitch);
      let cxp = tgt.x - fx * dist * cp, czp = tgt.z - fz * dist * cp, cyp = lookY + dist * sp + (camMode === 2 ? 0.2 : 0.4);
      if (camMode === 2) { cxp = tgt.x + fx * (isCar ? 0.3 : 0.1); czp = tgt.z + fz * (isCar ? 0.3 : 0.1); cyp = lookY + 0.05; }
      // don't sit inside a building
      for (let i = 1; i <= 6 && camMode !== 2; i++) {
        const t = i / 6, x = tgt.x + (cxp - tgt.x) * t, z = tgt.z + (czp - tgt.z) * t;
        if (A.buildingAt(x, z)) { const tt = Math.max(0.15, (i - 1) / 6); cxp = tgt.x + (cxp - tgt.x) * tt; czp = tgt.z + (czp - tgt.z) * tt; cyp = lookY + (cyp - lookY) * tt + 0.5; break; }
      }
      cyp = Math.max(cyp, H(cxp, czp) + 0.4);
      const k = Math.min(1, dt * (isCar ? 9 : 12));
      camera.position.x += (cxp - camera.position.x) * k;
      camera.position.y += (cyp - camera.position.y) * k;
      camera.position.z += (czp - camera.position.z) * k;
      if (camMode === 2) camera.position.set(cxp, cyp, czp);
      const sh = shake * 0.25;
      shake = Math.max(0, shake - dt * 2);
      camera.lookAt(tgt.x + fx * (camMode === 2 ? 20 : 0) + (rnd() - 0.5) * sh, lookY - (camMode === 2 ? 0.6 : 0) + (rnd() - 0.5) * sh, tgt.z + fz * (camMode === 2 ? 20 : 0));
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.near = 0.25; camera.far = 2400;
      camera.updateProjectionMatrix();
    }

    // -------------------------------------------------------------------------------------
    // Time of day: 1 real second = 1 game minute.
    const SKYC = { day: new THREE.Color("#9fc4e4"), dusk: new THREE.Color("#e9a46a"), night: new THREE.Color("#0a1222") };
    const sky = new THREE.Color();
    function skyTick(dt) {
      clock = (clock + dt) % 1440;
      const h = clock / 60;
      const dayF = h < 5.5 || h > 19.5 ? 0 : h < 7 ? (h - 5.5) / 1.5 : h > 18 ? (19.5 - h) / 1.5 : 1;
      const duskF = Math.max(0, 1 - Math.abs(h - 18.4) / 1.2) + Math.max(0, 1 - Math.abs(h - 6.2) / 1.0);
      night = 1 - dayF;
      sky.copy(SKYC.night).lerp(SKYC.day, dayF).lerp(SKYC.dusk, Math.min(0.6, duskF * 0.6));
      C.renderer.setClearColor(sky, 1);
      if (scene.fog) { scene.fog.color.copy(sky); scene.fog.near = 120; scene.fog.far = night > 0.5 ? 700 : 1100; }
      A.setExposure(0.24 + 0.76 * dayF);
    }

    // -------------------------------------------------------------------------------------
    // Sound (synthesised; starts on the first click)
    const AU = {
      ctx: null, on: true, eng: null, engG: null, filt: null, sir: null, sirG: null, sirL: null,
      init() {
        if (this.ctx) return;
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
        const c = this.ctx, master = c.createGain(); master.gain.value = 0.9; master.connect(c.destination); this.master = master;
        this.eng = c.createOscillator(); this.eng.type = "sawtooth"; this.filt = c.createBiquadFilter(); this.filt.type = "lowpass"; this.filt.frequency.value = 600;
        this.engG = c.createGain(); this.engG.gain.value = 0;
        this.eng.connect(this.filt).connect(this.engG).connect(master); this.eng.start();
        this.sir = c.createOscillator(); this.sir.type = "triangle"; this.sirG = c.createGain(); this.sirG.gain.value = 0;
        this.sirL = c.createOscillator(); this.sirL.frequency.value = 1.6; const lg = c.createGain(); lg.gain.value = 260; this.sirL.connect(lg).connect(this.sir.frequency); this.sir.frequency.value = 860;
        this.sir.connect(this.sirG).connect(master); this.sir.start(); this.sirL.start();
        this.noise = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      },
      set(on) { this.on = on; if (this.master) this.master.gain.value = on ? 0.9 : 0; },
      tone(f, t0, dur, type = "triangle", g = 0.12) { if (!this.ctx || !this.on) return; const c = this.ctx, o = c.createOscillator(), gg = c.createGain(); o.type = type; o.frequency.value = f; gg.gain.setValueAtTime(g, c.currentTime + t0); gg.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + t0 + dur); o.connect(gg).connect(this.master); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05); },
      blip(f) { this.tone(f, 0, 0.18, "square", 0.05); },
      jingle(ok) { (ok ? [523, 659, 784, 1046] : [392, 330, 262, 196]).forEach((f, i) => this.tone(f, i * 0.12, 0.3, "triangle", 0.13)); },
      honk(dur = 0.35, g = 0.3) { this.tone(415, 0, dur, "square", 0.05 * g * 3); this.tone(520, 0, dur, "square", 0.05 * g * 3); },
      door() { this.tone(140, 0, 0.12, "square", 0.08); },
      thud() { this.crash(0.35); },
      crash(g) { if (!this.ctx || !this.on) return; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), gg = c.createGain(); s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 900; gg.gain.value = 0.5 * g; s.connect(f).connect(gg).connect(this.master); s.start(); },
      tick(dt) {
        if (!this.ctx) return;
        const c = P.car, t = this.ctx.currentTime;
        if (c && !c.wreck && !paused && !inTitle) {
          const max = c.t.max, sp = Math.abs(c.v), gear = max / 4, r = (sp % gear) / gear, rpm = sp < 0.3 ? 0.12 : 0.25 + 0.75 * (sp > gear * 3.9 ? 1 : r);
          const baseF = c.t.bike ? 70 : c.type === "tractor" || c.type === "bus" ? 32 : c.type === "auto" ? 55 : 42;
          this.eng.frequency.setTargetAtTime(baseF + rpm * baseF * 2.2, t, 0.05);
          this.filt.frequency.setTargetAtTime(400 + rpm * 1400, t, 0.05);
          this.engG.gain.setTargetAtTime(0.045, t, 0.1);
        } else this.engG.gain.setTargetAtTime(0, t, 0.1);
        let near = Infinity;
        for (const cp of cops) near = Math.min(near, Math.hypot(cp.x - P.x, cp.z - P.z));
        this.sirG.gain.setTargetAtTime(paused || inTitle ? 0 : Math.max(0, 1 - near / 260) * 0.06, t, 0.2);
      },
    };

    // -------------------------------------------------------------------------------------
    // HUD
    const css = document.createElement("style");
    css.textContent = `
      #g-hud,#g-title,#g-pause,#g-bigmap{position:fixed;inset:0;z-index:20;font-family:var(--font-ui);color:#fff;pointer-events:none}
      #g-hud[hidden],#g-title[hidden],#g-pause[hidden],#g-bigmap[hidden]{display:none}
      .g-big{font:900 italic 64px/1 "Arial Black","Segoe UI Black",Impact,sans-serif;letter-spacing:.01em;text-shadow:0 3px 0 #000,0 0 24px rgba(0,0,0,.6);-webkit-text-stroke:2px #000}
      #g-top{position:absolute;right:18px;top:16px;text-align:right;display:grid;gap:4px;justify-items:end}
      #g-time{font:700 22px/1 "Cascadia Mono",Consolas,monospace;text-shadow:0 2px 3px #000}
      #g-cash{font:900 30px/1 "Arial Black",Impact,sans-serif;color:#7ee081;text-shadow:0 2px 0 #000,0 0 8px rgba(0,0,0,.6);-webkit-text-stroke:1px #0b3d0f}
      #g-stars{font-size:26px;letter-spacing:2px;text-shadow:0 2px 2px #000;color:rgba(255,255,255,.25)}
      #g-stars b{color:#ffd23f} #g-stars.flash b{animation:gfl .3s 6 alternate}
      @keyframes gfl{to{color:#fff;opacity:.2}}
      #g-health{width:150px;height:8px;background:rgba(0,0,0,.5);border:2px solid #000;border-radius:2px}
      #g-health i{display:block;height:100%;background:#5fcf5f;width:100%}
      #g-mapwrap{position:absolute;left:18px;bottom:18px;width:210px;height:210px;border-radius:50%;overflow:hidden;border:4px solid rgba(0,0,0,.75);box-shadow:0 4px 16px rgba(0,0,0,.5)}
      #g-map{width:100%;height:100%;display:block}
      #g-speed{position:absolute;right:22px;bottom:20px;text-align:right;text-shadow:0 2px 3px #000}
      #g-speed b{font:900 italic 54px/1 "Arial Black",Impact,sans-serif;-webkit-text-stroke:1.5px #000}
      #g-speed span{font-weight:700;margin-left:4px}
      #g-speed small{display:block;font-weight:600;opacity:.85}
      #g-dmg{width:130px;height:6px;background:rgba(0,0,0,.5);margin:6px 0 0 auto;border:1px solid #000}#g-dmg i{display:block;height:100%;background:#e8b04a}
      #g-mission{position:absolute;left:50%;top:14px;transform:translateX(-50%);background:rgba(10,14,20,.72);padding:8px 16px;border-radius:10px;text-align:center;max-width:min(560px,80vw);box-shadow:0 4px 12px rgba(0,0,0,.4)}
      #g-mission h4{margin:0;font:800 13px/1.2 var(--font-ui);letter-spacing:.08em;text-transform:uppercase;color:#ffd23f}
      #g-mission p{margin:3px 0 0;font-size:15px}#g-mission em{font-style:normal;font:700 20px/1.2 "Cascadia Mono",Consolas,monospace;color:#fff}
      #g-prompt{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(0,0,0,.75);padding:9px 16px;border-radius:8px;font-size:15px;max-width:80vw;text-align:center}
      #g-banner{position:absolute;left:0;right:0;top:34%;text-align:center}
      #g-banner h1{margin:0}#g-banner p{margin:10px 0 0;font:700 20px/1.3 var(--font-ui);text-shadow:0 2px 3px #000}
      #g-banner.pass h1{color:#ffd23f}#g-banner.fail h1{color:#e63946}#g-banner.job h1{color:#fff;font-size:46px}
      #g-says{position:absolute;inset:0;overflow:hidden}
      .g-say{position:absolute;transform:translate(-50%,-100%);background:#fff;color:#111;font:700 13px/1.2 var(--font-ui);padding:5px 9px;border-radius:10px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)}
      .g-say:after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}
      #g-hint{position:absolute;left:240px;bottom:22px;font-size:12px;opacity:.75;text-shadow:0 1px 2px #000;line-height:1.5}
      #g-title{pointer-events:auto;background:radial-gradient(ellipse at 50% 30%,rgba(255,170,60,.35),rgba(5,8,14,.86) 70%);display:grid;place-items:center;text-align:center}
      #g-title .wrap{max-width:720px;padding:20px}
      #g-title h1{margin:0;font-size:clamp(40px,8vw,84px);color:#ffd23f}
      #g-title h2{margin:8px 0 22px;font:700 18px/1.3 var(--font-ui);color:#f3e9d2;text-shadow:0 2px 3px #000}
      .g-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
      .g-btn{pointer-events:auto;font:900 18px/1 "Arial Black",Impact,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:14px 26px;border-radius:10px;border:3px solid #000;background:#ffd23f;color:#111;cursor:pointer;box-shadow:0 4px 0 #000}
      .g-btn.alt{background:#f3f4f0}.g-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #000}
      .g-keys{margin:24px auto 0;display:grid;grid-template-columns:auto auto;gap:4px 18px;text-align:left;font-size:14px;max-width:520px;background:rgba(0,0,0,.45);padding:12px 16px;border-radius:10px}
      .g-keys kbd{font-family:"Cascadia Mono",Consolas,monospace;background:#fff;color:#111;border-radius:4px;padding:1px 6px;margin-right:2px;font-size:12px}
      .g-note{margin-top:14px;font-size:12px;opacity:.7}
      #g-pause{pointer-events:auto;background:rgba(5,8,14,.72);display:grid;place-items:center;text-align:center}
      #g-pause h1{margin:0 0 6px;color:#fff}#g-pause .stats{margin:10px 0 20px;font-size:15px;opacity:.9;line-height:1.6}
      #g-bigmap{pointer-events:auto;background:rgba(5,8,14,.85);display:grid;place-items:center}
      #g-bigmap canvas{max-width:94vw;max-height:86vh;border:3px solid #000;border-radius:8px;cursor:crosshair}
      #g-bigmap p{position:absolute;top:12px;left:0;right:0;text-align:center;font-weight:700;text-shadow:0 2px 2px #000}
      #g-touch{position:absolute;inset:0;pointer-events:none}
      #g-stick{position:absolute;left:24px;bottom:250px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:auto;touch-action:none}
      #g-stick i{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px;border-radius:50%;background:rgba(255,255,255,.55)}
      .g-tb{position:absolute;width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.45);border:2px solid rgba(255,255,255,.6);color:#fff;font:800 15px/1 var(--font-ui);pointer-events:auto;touch-action:none}
      body.game #topbar,body.game #panel,body.game #controls,body.game #readout,body.game #info,body.game #plan,body.game #plan-card,body.game #plan-legend,body.game #plan-draw,body.game #sv,body.game #minimap,body.game #sv-hint{display:none!important}
      body.game #modes{opacity:0;pointer-events:none}
      body.game #attrib{opacity:.55;font-size:9.5px}
      body.game #view{cursor:grab}
      @media (max-width:700px){.g-big{font-size:40px}#g-mapwrap{width:130px;height:130px;left:10px;top:70px;bottom:auto}#g-hint{display:none}#g-speed b{font-size:38px}#g-top{top:10px;right:10px}#g-cash{font-size:22px}#g-mission{top:auto;bottom:10px;max-width:58vw;left:auto;right:10px;transform:none}}
    `;
    document.head.appendChild(css);
    const hud = document.createElement("div");
    hud.innerHTML = `
      <div id="g-hud" hidden>
        <div id="g-says"></div>
        <div id="g-top"><div id="g-time"></div><div id="g-cash"></div><div id="g-stars"></div><div id="g-health"><i></i></div></div>
        <div id="g-mapwrap"><canvas id="g-map" width="420" height="420"></canvas></div>
        <div id="g-hint">F car · E job · H horn · C camera · M map · Esc menu</div>
        <div id="g-speed" hidden><b>0</b><span>km/h</span><small></small><div id="g-dmg"><i></i></div></div>
        <div id="g-mission" hidden><h4></h4><p></p><em></em></div>
        <div id="g-prompt" hidden></div>
        <div id="g-banner" hidden><h1 class="g-big"></h1><p></p></div>
        <div id="g-touch" hidden><div id="g-stick"><i></i></div>
          <button class="g-tb" id="g-tf" style="right:20px;bottom:250px">F</button><button class="g-tb" id="g-te" style="right:96px;bottom:200px">E</button>
          <button class="g-tb" id="g-tj" style="right:20px;bottom:170px">⤒</button><button class="g-tb" id="g-th" style="right:96px;bottom:120px">📯</button>
          <button class="g-tb" id="g-tm" style="right:20px;top:120px">☰</button></div>
      </div>
      <div id="g-title" hidden><div class="wrap">
        <h1 class="g-big">GRAND TOUR<br>PANTNAGAR</h1>
        <h2>An open-world drive through the real GBPUAT campus: 10,845 buildings, 212 km of roads, one very busy afternoon.</h2>
        <div class="g-btns"><button class="g-btn" id="g-play">Play</button><button class="g-btn alt" id="g-back">Back to the twin</button></div>
        <div class="g-keys">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Walk, or drive and steer</span>
          <span><kbd>Shift</kbd></span><span>Sprint</span>
          <span><kbd>Space</kbd></span><span>Jump, or handbrake</span>
          <span><kbd>F</kbd></span><span>Get in or out of a vehicle (take one from a driver and security will notice)</span>
          <span><kbd>E</kbd></span><span>Start a job at a coloured beacon</span>
          <span><kbd>H</kbd> <kbd>C</kbd> <kbd>M</kbd></span><span>Horn, camera, big map (click it to set a waypoint)</span>
          <span>Mouse drag</span><span>Look around · wheel to zoom</span>
          <span><kbd>Esc</kbd></span><span>Pause</span>
        </div>
        <div class="g-note">Jobs: Chai Express at Brijwasi Canteen · Campus Cab at the Library · Pantnagar Circuit at Stevenson Stadium · Lost and Found at the Post Office.<br>A game on a real map. Off the screen, drive safely and let people walk.</div>
      </div></div>
      <div id="g-pause" hidden><div class="wrap">
        <h1 class="g-big">PAUSED</h1>
        <div class="stats" id="g-stats"></div>
        <div class="g-btns"><button class="g-btn" id="g-resume">Resume</button><button class="g-btn alt" id="g-sound">Sound: on</button><button class="g-btn alt" id="g-tod">Skip to night</button><button class="g-btn alt" id="g-quit">Quit to the twin</button></div>
      </div></div>
      <div id="g-bigmap" hidden><p>Click to set a waypoint · M or Esc to close</p><canvas id="g-bm"></canvas></div>`;
    document.body.appendChild(hud);
    let promptT = 0, bannerT = 0, hudT = 0;
    function prompt(text, t = 1.2) { const el = $("g-prompt"); el.innerHTML = text; el.hidden = false; promptT = t; }
    function banner(title, sub, t, kind) { const el = $("g-banner"); el.className = kind || ""; el.querySelector("h1").textContent = title; el.querySelector("p").innerHTML = esc(sub || ""); el.hidden = false; bannerT = t; }
    function say(text, t) { sayList.push({ text, t, follow: true }); }
    const sayList = [];
    function flashStars() { const s = $("g-stars"); s.classList.remove("flash"); void s.offsetWidth; s.classList.add("flash"); }
    const v3b = new THREE.Vector3();
    function hudTick(dt) {
      promptT -= dt; if (promptT <= 0) $("g-prompt").hidden = true;
      bannerT -= dt; if (bannerT <= 0) $("g-banner").hidden = true;
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.1;
        const h = Math.floor(clock / 60), m = Math.floor(clock % 60);
        $("g-time").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        $("g-cash").textContent = "₹" + fmt(P.cash);
        $("g-stars").innerHTML = "<b>" + "★".repeat(P.wanted) + "</b>" + "★".repeat(4 - P.wanted);
        $("g-health").firstElementChild.style.width = P.health + "%";
        const sp = $("g-speed");
        sp.hidden = !P.car;
        if (P.car) { sp.querySelector("b").textContent = Math.round(Math.abs(P.car.v) * 3.6); sp.querySelector("small").textContent = P.car.t.label; $("g-dmg").firstElementChild.style.width = 100 - P.car.dmg + "%"; }
        const mi = $("g-mission");
        if (job) { mi.hidden = false; mi.querySelector("h4").textContent = job.def.name; mi.querySelector("p").innerHTML = job.text; mi.querySelector("em").textContent = `${Math.floor(job.T / 60)}:${String(Math.floor(job.T % 60)).padStart(2, "0")}`; }
        else if (waypoint) { mi.hidden = false; mi.querySelector("h4").textContent = "Waypoint"; mi.querySelector("p").textContent = `${fmt(Math.hypot(waypoint[0] - P.x, waypoint[1] - P.z))} m away`; mi.querySelector("em").textContent = ""; }
        else mi.hidden = true;
      }
      // speech bubbles
      const box = $("g-says");
      const bubbles = [];
      for (const p of peds) if (p.say) bubbles.push({ x: p.x, y: H(p.x, p.z) + 2.3, z: p.z, text: p.say.text });
      for (let i = sayList.length - 1; i >= 0; i--) { const s = sayList[i]; s.t -= dt; if (s.t <= 0) sayList.splice(i, 1); else bubbles.push({ x: P.x, y: P.y + (P.car ? 2.4 : 2.3), z: P.z, text: s.text }); }
      while (box.children.length < bubbles.length) { const d = document.createElement("div"); d.className = "g-say"; box.appendChild(d); }
      [...box.children].forEach((el, i) => {
        const b = bubbles[i];
        if (!b) { el.style.display = "none"; return; }
        v3b.set(b.x, b.y, b.z).project(camera);
        if (v3b.z > 1) { el.style.display = "none"; return; }
        el.style.display = "block"; el.textContent = b.text;
        el.style.left = ((v3b.x + 1) / 2) * innerWidth + "px"; el.style.top = ((1 - v3b.y) / 2) * innerHeight + "px";
      });
    }

    // Minimap on the satellite image, turning with the camera
    const mm = $("g-map"), mx = mm.getContext("2d");
    const SG = A.satGrid, satW = SG.nx * SG.cell, satH = SG.nz * SG.cell;
    function mapXY(img, x, z) { return [((x - SG.x0) / satW) * img.width, ((z - SG.z0) / satH) * img.height]; }
    function drawMap() {
      const img = A.satImage();
      const W = mm.width, R = W / 2, spd = P.car ? Math.abs(P.car.v) : 0, span = 170 + spd * 6;
      mx.save();
      mx.fillStyle = "#1b2a1e"; mx.fillRect(0, 0, W, W);
      mx.translate(R, R); mx.rotate(-camYaw);
      const s = R / span;
      if (img) {
        const [ix, iz] = mapXY(img, P.x, P.z), pxPerM = img.width / satW, srcR = span * 1.5 * pxPerM;
        mx.globalAlpha = 0.95;
        mx.drawImage(img, ix - srcR, iz - srcR, srcR * 2, srcR * 2, -span * 1.5 * s, -span * 1.5 * s, span * 3 * s, span * 3 * s);
        mx.globalAlpha = 1;
      }
      mx.fillStyle = "rgba(0,0,0,0.18)"; mx.fillRect(-W, -W, W * 2, W * 2);
      const P2 = (x, z) => [(x - P.x) * s, (z - P.z) * s];
      // route
      if (routeNodes && routeNodes.length > 1) {
        mx.strokeStyle = job ? "#ffd23f" : "#c77dff"; mx.lineWidth = 7; mx.lineCap = mx.lineJoin = "round"; mx.beginPath();
        const [a0, b0] = P2(P.x, P.z); mx.moveTo(a0, b0);
        for (const n of routeNodes) { const [a, b] = P2(nx(n), nz(n)); mx.lineTo(a, b); }
        const tg = targetPt(); if (tg) { const [a, b] = P2(tg[0], tg[1]); mx.lineTo(a, b); }
        mx.stroke();
      }
      const blip = (x, z, color, r, label, clampIt) => {
        let [a, b] = P2(x, z); const d = Math.hypot(a, b);
        if (d > R * 1.35 - 12) { if (!clampIt) return; a = (a / d) * (R * 1.35 - 12); b = (b / d) * (R * 1.35 - 12); }
        mx.save(); mx.translate(a, b); mx.rotate(camYaw);
        mx.fillStyle = color; mx.strokeStyle = "#000"; mx.lineWidth = 3; mx.beginPath(); mx.arc(0, 0, r, 0, Math.PI * 2); mx.fill(); mx.stroke();
        if (label) { mx.fillStyle = "#000"; mx.font = "bold 16px sans-serif"; mx.textAlign = "center"; mx.fillText(label, 0, 6); }
        mx.restore();
      };
      for (const c of cops) blip(c.x, c.z, Math.floor(performance.now() / 250) % 2 ? "#e63946" : "#3a86ff", 7, "", true);
      if (!job) for (const j of JOBS) { const st = sites()[j.site]; if (st && st.p) blip(st.p[0], st.p[1], "#" + j.color.toString(16).padStart(6, "0"), 12, j.name[0], true); }
      const tg = targetPt(); if (tg) blip(tg[0], tg[1], "#ffd23f", 11, job ? "!" : "W", true);
      mx.restore();
      // player arrow and north
      mx.save(); mx.translate(R, R); mx.rotate(angDiff(camYaw, P.car ? P.car.yaw : P.yaw));
      mx.fillStyle = "#fff"; mx.strokeStyle = "#000"; mx.lineWidth = 3; mx.beginPath(); mx.moveTo(0, -14); mx.lineTo(10, 11); mx.lineTo(0, 6); mx.lineTo(-10, 11); mx.closePath(); mx.fill(); mx.stroke(); mx.restore();
      const na = -camYaw - Math.PI / 2;
      mx.save(); mx.translate(R + Math.cos(na) * (R - 18), R + Math.sin(na) * (R - 18)); mx.fillStyle = "#fff"; mx.strokeStyle = "#000"; mx.lineWidth = 4; mx.font = "bold 22px sans-serif"; mx.textAlign = "center"; mx.strokeText("N", 0, 8); mx.fillText("N", 0, 8); mx.restore();
    }
    const targetPt = () => (job ? [job.target.x, job.target.z] : waypoint);
    function routeTick() {
      const tg = targetPt();
      if (!tg) { routeNodes = null; arrow.visible = false; targetBeacon.visible = false; return; }
      const now = performance.now() / 1000;
      if (now - routeAt.t > 1.5 && (Math.hypot(P.x - routeAt.x, P.z - routeAt.z) > 25 || routeAt.tx !== tg[0] || now - routeAt.t > 6)) {
        routeNodes = route(nearestNode(P.x, P.z), nearestNode(tg[0], tg[1]));
        routeAt = { x: P.x, z: P.z, t: now, tx: tg[0], tz: tg[1] };
      }
      targetBeacon.visible = true;
      targetBeacon.position.set(tg[0], H(tg[0], tg[1]), tg[1]);
      // guide arrow points along the route
      let gx = tg[0], gz = tg[1];
      if (routeNodes && routeNodes.length > 1) { for (const n of routeNodes) { if (Math.hypot(nx(n) - P.x, nz(n) - P.z) > 18) { gx = nx(n); gz = nz(n); break; } } }
      const base = P.car || P;
      arrow.visible = true;
      arrow.position.set(base.x, (base.y || P.y) + (P.car ? P.car.t.L * 0.35 + 2.4 : 2.6), base.z);
      arrow.rotation.set(0, -yawOf(gx - base.x, gz - base.z), 0);
    }
    // Big map
    const bm = $("g-bm"), bx = bm.getContext("2d");
    function openBigMap(on) {
      $("g-bigmap").hidden = !on;
      if (!on) return;
      const img = A.satImage(); if (!img) return;
      const sc = Math.min((innerWidth * 0.94) / img.width, (innerHeight * 0.86) / img.height);
      bm.width = Math.round(img.width * sc); bm.height = Math.round(img.height * sc);
      bx.drawImage(img, 0, 0, bm.width, bm.height);
      const toC = (x, z) => [((x - SG.x0) / satW) * bm.width, ((z - SG.z0) / satH) * bm.height];
      const dot = (x, z, col, r, l) => { const [a, b] = toC(x, z); bx.fillStyle = col; bx.strokeStyle = "#000"; bx.lineWidth = 2; bx.beginPath(); bx.arc(a, b, r, 0, Math.PI * 2); bx.fill(); bx.stroke(); if (l) { bx.font = "bold 13px sans-serif"; bx.fillStyle = "#fff"; bx.strokeStyle = "#000"; bx.lineWidth = 3; bx.strokeText(l, a + r + 3, b + 4); bx.fillText(l, a + r + 3, b + 4); } };
      for (const j of JOBS) { const st = sites()[j.site]; if (st && st.p) dot(st.p[0], st.p[1], "#" + j.color.toString(16).padStart(6, "0"), 7, j.name); }
      if (waypoint) dot(waypoint[0], waypoint[1], "#c77dff", 6, "Waypoint");
      dot(P.x, P.z, "#fff", 7, "You");
    }
    bm.addEventListener("click", (e) => {
      const r = bm.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const x = SG.x0 + u * satW, z = SG.z0 + v * satH;
      waypoint = [x, z]; routeAt.t = 0; AU.blip(740);
      openBigMap(false);
    });

    // -------------------------------------------------------------------------------------
    // Input
    const touch = { on: false, x: 0, y: 0, jump: false, brake: false, sprint: false };
    const playing = () => A.mode() === "game" && !paused && !inTitle && $("g-bigmap").hidden;
    window.addEventListener("keydown", (e) => {
      if (A.mode() !== "game" || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code === "Escape") { e.preventDefault(); if (!$("g-bigmap").hidden) openBigMap(false); else if (!inTitle) setPause(!paused); return; }
      if (e.code === "KeyM" && !inTitle) { openBigMap($("g-bigmap").hidden); return; }
      if (!playing()) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (e.repeat) { keys.add(e.code); return; }
      keys.add(e.code);
      if (e.code === "KeyF") P.car ? leaveCar(false) : enterCar() || prompt("Nothing to get into here", 1);
      if (e.code === "KeyE") tryJob();
      if (e.code === "KeyH") honk();
      if (e.code === "KeyC") camMode = (camMode + 1) % 3;
      if (e.code === "KeyN") clock = (clock + 360) % 1440;
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));
    window.addEventListener("blur", () => { keys.clear(); if (A.mode() === "game" && !inTitle) setPause(true); });
    function honk() {
      AU.honk(0.4, 1);
      for (const p of peds) if (p.state === "walk" && Math.hypot(p.x - P.x, p.z - P.z) < 15) { p.state = "flee"; p.t = 2; p.fx = p.x - P.x; p.fz = p.z - P.z; if (rnd() < 0.3) p.say = { text: pick(["Kya hua?!", "Haan haan, ja raha hoon", "Arre!"]), t: 1.6 }; }
    }
    function tryJob() {
      if (job) { prompt("Finish this job first, or press E again to give up", 2); if (job._quit) endJob(false, "You gave up"); job && (job._quit = true); return; }
      for (const j of JOBS) { const st = sites()[j.site]; if (st && st.p && Math.hypot(st.p[0] - P.x, st.p[1] - P.z) < 9) { startJob(j); return; } }
      prompt("Drive to a coloured beacon to start a job (see the map: M)", 2);
    }
    // Mouse look
    const cv = A.canvas || $("view");
    let dragLook = null;
    cv.addEventListener("pointerdown", (e) => { if (A.mode() !== "game" || inTitle) return; AU.init(); dragLook = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => {
      if (!dragLook || A.mode() !== "game") return;
      camYaw -= (e.clientX - dragLook.x) * 0.006; camPitch = clamp(camPitch + (e.clientY - dragLook.y) * 0.004, -0.1, 1.2);
      dragLook = { x: e.clientX, y: e.clientY }; lastMouse = performance.now() / 1000;
    });
    cv.addEventListener("pointerup", () => { dragLook = null; });
    cv.addEventListener("wheel", (e) => { if (A.mode() !== "game") return; camDist = clamp(camDist * (e.deltaY > 0 ? 1.12 : 0.89), 0.5, 3); }, { passive: true });
    // Touch controls
    const isTouch = matchMedia("(pointer: coarse)").matches;
    const stick = $("g-stick"), knob = stick.firstElementChild;
    stick.addEventListener("pointerdown", (e) => { touch.on = true; stick.setPointerCapture(e.pointerId); moveStick(e); });
    stick.addEventListener("pointermove", (e) => { if (touch.on) moveStick(e); });
    const endStick = () => { touch.on = false; touch.x = touch.y = 0; knob.style.transform = ""; };
    stick.addEventListener("pointerup", endStick); stick.addEventListener("pointercancel", endStick);
    function moveStick(e) {
      const r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), L = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
      const a = Math.atan2(dy, dx); touch.x = Math.cos(a) * L; touch.y = Math.sin(a) * L;
      knob.style.transform = `translate(${touch.x * 40}px, ${touch.y * 40}px)`;
    }
    const tb = (id, down, up) => { const b = $(id); b.addEventListener("pointerdown", (e) => { e.preventDefault(); AU.init(); down(); }); if (up) { b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); } };
    tb("g-tf", () => (P.car ? leaveCar(false) : enterCar() || prompt("Nothing to get into here", 1)));
    tb("g-te", tryJob);
    tb("g-tj", () => { touch.jump = true; touch.brake = true; }, () => { touch.brake = false; });
    tb("g-th", honk);
    tb("g-tm", () => setPause(true));

    // -------------------------------------------------------------------------------------
    // Flow: title, pause, enter/leave
    function setPause(on) {
      paused = on;
      $("g-pause").hidden = !on;
      if (on) $("g-stats").innerHTML = `Cash ₹${fmt(P.cash)}<br>Jobs done: ${JOBS.map((j) => `${esc(j.name)} ${DONE[j.id] || 0}`).join(" · ")}${BEST.race ? `<br>Best circuit time: ${BEST.race} s` : ""}`;
      keys.clear();
    }
    $("g-resume").onclick = () => setPause(false);
    $("g-sound").onclick = () => { AU.set(!AU.on); $("g-sound").textContent = "Sound: " + (AU.on ? "on" : "off"); };
    $("g-tod").onclick = () => { clock = clock / 60 > 6 && clock / 60 < 19 ? 20 * 60 : 8 * 60; $("g-tod").textContent = clock / 60 >= 19 || clock / 60 < 6 ? "Skip to day" : "Skip to night"; };
    $("g-quit").onclick = () => leave();
    $("g-back").onclick = () => leave();
    $("g-play").onclick = () => {
      AU.init();
      inTitle = false;
      $("g-title").hidden = true;
      $("g-hud").hidden = false;
      $("g-touch").hidden = !isTouch;
      if (!started2) firstStart();
      banner("Grand Tour Pantnagar", "Find a ride. Beacons on the map are jobs.", 3, "job");
    };
    function firstStart() {
      started2 = true;
      const S = sites();
      const lib = S.library.p || [-600, -100];
      // Start on the pavement by the library, with a scooter and a car parked close by.
      // a proper street (not a service lane) near the library
      const street = (k) => drivable(k) && ["tertiary", "secondary", "residential", "unclassified", "primary"].includes((D.roads[GE[k][2]] || {}).c);
      const main = (k) => drivable(k) && NET.cls[k] === "major" && NET.len[k] > 25;
      const ne = A.nearestEdge(lib[0], lib[1], 500, main) || A.nearestEdge(lib[0], lib[1], 400, street) || nearestDrive(lib[0], lib[1], 400);
      const e = ne ? GE[ne.k] : null, fyaw = e ? yawOf(nx(e[1]) - nx(e[0]), nz(e[1]) - nz(e[0])) : 0;
      P.yaw = camYaw = fyaw;
      const [fx, fz] = fwd(fyaw);
      // Start 20 m along the road from the library beacon, on the side away from it.
      let sx = lib[0], sz = lib[1];
      const startPt = ne ? [nx(GE[ne.k][0]) + (nx(GE[ne.k][1]) - nx(GE[ne.k][0])) * ne.t, nz(GE[ne.k][0]) + (nz(GE[ne.k][1]) - nz(GE[ne.k][0])) * ne.t] : lib;
      if (ne) {
        const ax = nx(e[0]), az = nz(e[0]), bx = nx(e[1]), bz = nz(e[1]), px = ax + (bx - ax) * ne.t, pz = az + (bz - az) * ne.t;
        const w2 = roadW(ne.k) / 2 + 1.2;
        for (const along of [0, 8, -8, 16]) for (const side of [1, -1]) { const x = px + fx * along + fz * w2 * side, z = pz + fz * along - fx * w2 * side; if (!solid(x, z) && sx === lib[0] && Math.hypot(x - lib[0], z - lib[1]) > 12) { sx = x; sz = z; } }
      }
      placePlayer(sx, sz);
      const ps = (dx, off, type) => {
        for (const o of [off, -off, off * 1.6, -off * 1.6]) {
          const x = sx + fx * dx + fz * o, z = sz + fz * dx - fx * o;
          if (fits(type, x, z, fyaw)) { const c = makeCar(type, x, z, fyaw, "parked"); settle(c); return; }
        }
      };
      ps(4.5, 0.6, "hatch"); ps(-4, 0.4, "scooter"); ps(11, 0.6, "sedan");
      // Parked vehicles by hostels and colleges
      for (const b of hostels.concat(colleges)) {
        const p = roadside(b.c);
        if (!p) continue;
        const ne2 = nearestDrive(p[0], p[1], 40);
        if (!ne2) continue;
        const e2 = GE[ne2.k], y2 = yawOf(nx(e2[1]) - nx(e2[0]), nz(e2[1]) - nz(e2[0]));
        for (let i = 0; i < 2; i++) { const [gx, gz] = fwd(y2), x = p[0] + gx * (i * 6 - 3), z = p[1] + gz * (i * 6 - 3), type = pick(["hatch", "hatch", "sedan", "scooter", "scooter", "auto"]); if (fits(type, x, z, y2)) { const c = makeCar(type, x, z, y2, "parked"); settle(c); } }
      }
      // A tractor at the farms for anyone who finds it
      const farm = C.blds.find((b) => b.t === "farm" && Math.hypot(b.c[0] - lib[0], b.c[1] - lib[1]) < 1500);
      if (farm) { const p = roadside(farm.c); if (p && fits("tractor", p[0], p[1], 0)) { const c = makeCar("tractor", p[0], p[1], 0, "parked", { paint: "#c0392b" }); settle(c); } }
      for (const j of JOBS) { const st = S[j.site]; if (!st || !st.p) continue; const g = beacon(j.color); g.position.set(st.p[0], H(st.p[0], st.p[1]), st.p[1]); g.visible = true; giverBeacons.set(j.id, g); }
    }
    let savedClear = null;
    function enter() {
      buildNet();
      LAMPS = A.lamps();
      root.visible = true;
      A.labels(true);
      if (savedClear === null) savedClear = { c: C.renderer.getClearColor(new THREE.Color()), a: C.renderer.getClearAlpha() };
      $("g-title").hidden = !inTitle;
      $("g-hud").hidden = inTitle;
      if (!inTitle) setPause(true);
    }
    function leave() {
      setPause(false);
      $("g-title").hidden = true;
      A.setMode("aerial");
    }
    function onLeave() {
      root.visible = false;
      $("g-hud").hidden = true; $("g-title").hidden = true; $("g-pause").hidden = true; $("g-bigmap").hidden = true;
      if (savedClear) C.renderer.setClearColor(savedClear.c, savedClear.a);
      A.setExposure(1);
      if (AU.engG) AU.engG.gain.value = 0;
      if (AU.sirG) AU.sirG.gain.value = 0;
      keys.clear();
    }
    A.setHooks({
      mode(m, prev) { if (m === "game") enter(); else if (prev === "game") onLeave(); },
      frame(dt) {
        skyTick(paused || inTitle ? 0 : dt);
        if (inTitle) {
          // slow orbit over the campus behind the title
          const t = performance.now() / 1000 * 0.05, lib = sites().library.p || [0, 0];
          camera.position.set(lib[0] + Math.sin(t) * 420, H(lib[0], lib[1]) + 160, lib[1] + Math.cos(t) * 420);
          camera.lookAt(lib[0], H(lib[0], lib[1]), lib[1]);
          camera.fov = 55; camera.near = 1; camera.far = 4000; camera.updateProjectionMatrix();
          return;
        }
        if (paused || !$("g-bigmap").hidden) { draw(performance.now() / 1000); AU.tick(dt); return; }
        populate(dt);
        if (P.car) carTick(dt); else footTick(dt);
        trafficTick(dt);
        pedTick(dt);
        carCollisions();
        if (!P.car) { // cars hitting the player on foot
          for (const c of cars) {
            if (Math.abs(c.v) < 3 || P.knock > 0) continue;
            const [fx, fz] = fwd(c.yaw), dx = P.x - c.x, dz = P.z - c.z, along = dx * fx + dz * fz, across = dx * fz - dz * fx;
            if (Math.abs(across) < c.t.W / 2 + 0.3 && Math.abs(along) < c.t.L / 2 + 0.3) { P.health -= Math.abs(c.v) * 2.2; P.knock = 1.4; shake = 0.8; AU.thud(); const k = Math.sign(across) || 1; P.x += fz * k * 1.5; P.z -= fx * k * 1.5; if (P.health <= 0) wasted(); }
          }
        } else if (P.car.dmg >= 100 && P.health > 0 && P.car.wreck) { /* waiting for the player to get out */ }
        copsTick(dt);
        jobTick(dt);
        routeTick();
        // job beacons
        for (const b of [...giverBeacons.values(), targetBeacon]) { const d = Math.hypot(b.position.x - camera.position.x, b.position.z - camera.position.z); b.children[0].material.opacity = 0.28 * clamp((d - 5) / 25, 0.06, 1); }
        for (const [id, g] of giverBeacons) { g.visible = !job; const st = sites()[JOBS.find((j) => j.id === id).site].p; if (!job && Math.hypot(st[0] - P.x, st[1] - P.z) < 9 && promptT <= 0) prompt(`Press E to start: <b>${esc(JOBS.find((j) => j.id === id).name)}</b>`, 0.3); }
        if (!P.car && promptT <= 0) { for (const c of cars) if (!c.wreck && Math.hypot(c.x - P.x, c.z - P.z) < 4.2 + c.t.L * 0.3) { prompt(`Press F to ${c.driver === "ai" ? "take" : "get in"}: ${c.t.label}`, 0.25); break; } }
        if (waypoint && Math.hypot(waypoint[0] - P.x, waypoint[1] - P.z) < 12) { waypoint = null; AU.blip(990); prompt("You have arrived", 1.5); }
        P.health = Math.min(100, P.health + dt * 0.8);
        cameraTick(dt);
        draw(performance.now() / 1000);
        hudTick(dt);
        drawMap();
        AU.tick(dt);
      },
    });

    // Entry points: the Play button and #play links.
    function play() {
      const m = A.mode();
      if (m === "street" && C.exitStreet) C.exitStreet();
      inTitle = !started2 ? true : inTitle;
      A.setMode("game");
    }
    if ($("mode-play")) $("mode-play").addEventListener("click", play);
    if (/(^|[#&])play\b/.test(location.hash)) setTimeout(play, 50);
    window.__game = { P, cars, peds, cops, keys, get job() { return job; }, startJob: (id) => startJob(JOBS.find((j) => j.id === id)), JOBS, sites, play, setPause, enterCar, leaveCar, get clock() { return clock; }, set clock(v) { clock = v; }, crime, start: () => $("g-play").click() };
  }
})();
