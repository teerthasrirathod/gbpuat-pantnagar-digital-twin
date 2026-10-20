// Keyboard-only drawing at the cross (building, road), light a whole road by clicking it, and the Move tool.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const st = `const a = window.__sandbox.api; const bar = document.getElementById("plan-draw"); return JSON.stringify({ items: a.S.items.length, kinds: a.S.items.map(i => i.kind).join(","), tool: a.tool, tip: bar.hidden ? "hidden" : document.getElementById("plan-draw-tip").innerText, info: document.getElementById("plan-draw-info").innerText, finishShown: !document.getElementById("plan-draw-done").hidden, toast: document.getElementById("toast").classList.contains("off") ? "" : document.getElementById("toast").innerText.replace(/\\n/g, " ") })`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(500)} document.querySelector("[data-goal=build]").click(); ${wait(300)} window.__campus.plan.flyTo({ tx: -1500, tz: -300, dist: 260 }); ${wait(2500)} document.querySelector('[data-tool=building]').click(); ${wait(300)} return "building tool, camera near hostels"` },
  { keys: [" "] }, { wait: 300, js: st },
  { keys: ["d"], hold: 500 }, { wait: 800, keys: [" "] }, { wait: 300, js: st },
  { keys: ["w"], hold: 500 }, { wait: 800, keys: [" "] },
  { wait: 800, js: st },
  { shot: "kb-building" },
  { js: `document.querySelector('[data-tool=road]').click(); ${wait(300)} return "road tool"` },
  { keys: [" "] }, { keys: ["d"], hold: 400 }, { wait: 700, keys: [" "] }, { keys: ["s"], hold: 400 }, { wait: 700, keys: [" "] },
  { wait: 300, js: st },
  { keys: ["Enter"] },
  { wait: 800, js: st },
  { shot: "kb-road" },
  { js: `const a = window.__sandbox.api; const it = a.S.items.find(i => i.kind === "building"); a.select(it.id); ${wait(300)} const before = it.pts[0].slice(); document.querySelector("#plan-card [data-act=move]").click(); ${wait(300)} return "move tool: " + a.tool + " bar=" + document.getElementById("plan-draw-tip").innerText + " before=" + before.map(v => v.toFixed(0))` },
  { click: [900, 500] },
  { wait: 800, js: `const a = window.__sandbox.api; const it = a.S.items.find(i => i.kind === "building"); return "after move: tool=" + a.tool + " pt0=" + it.pts[0].map(v => v.toFixed(0)) + " items=" + a.S.items.length` },
  { js: `const A = window.__campus.plan; const GN = window.CAMPUS.graph.nodes; const v = A.view; let best = null; for (let i = 0; i < GN.length / 2; i++) { const x = GN[i * 2], z = GN[i * 2 + 1]; const d = Math.hypot(x - v.tx, z - v.tz); if (d < 120 && (!best || d < best.d)) best = { x, z, d }; } const p = new THREE.Vector3(best.x, A.H(best.x, best.z), best.z).project(window.__campus.camera); sessionStorage.setItem("road", JSON.stringify([ (p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight ])); document.querySelector('[data-tool=light_road]').click() || 0; ${wait(300)} return "road node screen=" + sessionStorage.getItem("road") + " tool=" + window.__sandbox.api.tool` },
  { click: [683, 384] },
  { wait: 1500, js: `const a = window.__sandbox.api; return "after road click: tool=" + a.tool + " items=" + a.S.items.length + " lights=" + a.S.items.filter(i => i.kind === "street_light").length + " toast=" + document.getElementById("toast").innerText.replace(/\\n/g, " ")` },
  { shot: "lightroad" },
];
