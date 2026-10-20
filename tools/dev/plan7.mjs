// What warnings does the rainwater quick start produce, and what does the engine failure banner look like?
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const idle = `${until("window.__sandbox.api.R && !window.__sandbox.api.pending", 200)} ${wait(800)}`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(600)} document.querySelector("[data-goal=green]").click(); ${wait(300)} document.querySelector("[data-quick=rwh]").click(); ${idle} const a = window.__sandbox.api; const w = a.R.items.filter(x => x.warn.length).map(x => x.id + ":" + x.warn.join("/")); return "items=" + a.S.items.length + " warnings=" + a.R.warnings + " :: " + w.slice(0, 6).join(" || ")` },
  { js: `const a = window.__sandbox.api; const it = a.S.items[0]; const b = window.__campus.blds.filter(b => b.t === "hostel"); return "hostels in C.blds=" + b.length + " first rwh pt=" + it.pts[0].map(v => v.toFixed(1)) + " roof=" + JSON.stringify(a.R.byId[it.id].info)` },
];
