// Automated contrast audit of the planning UI: every visible text element against its effective background,
// in light, dark and stronger-contrast, on each step. Reports anything below WCAG AA (4.5:1, or 3:1 for large text).
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const audit = `
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; if (!stack.length || stack[stack.length - 1].a < 1) base = document.documentElement.dataset.theme === "dark" ? { r: 20, g: 24, b: 22, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
  const bad = []; let checked = 0; const lows = [];
  const roots = ["#plan", "#plan-card", "#plan-draw", "#toast", "#plan-legend", "#plan-display"];
  for (const sel of roots) for (const root of document.querySelectorAll(sel)) {
    if (root.hidden || root.offsetParent === null && getComputedStyle(root).position !== "fixed") continue;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const t = n.textContent.trim(); if (!t) continue;
      const el = n.parentElement; const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden]") || el.closest(".sr")) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const fg0 = parse(cs.color); const bg = bgOf(el); const fg = over(fg0, bg);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5, c = ratio(fg, bg); checked++; lows.push([c, t.slice(0, 24)]);
      const disabled = el.closest("button:disabled, [disabled]");
      if (c < need && !disabled) bad.push(c.toFixed(2) + " < " + need + " :: " + sel + " :: '" + t.slice(0, 40) + "' " + cs.color + " on rgb(" + [bg.r, bg.g, bg.b].map(Math.round) + ") " + size + "px");
    }
  }
  return [...new Set(bad)].slice(0, 25).join("\\n") || "no contrast failures";`;
const theme = (t, hc) => `document.documentElement.dataset.theme = "${t}"; ${hc ? 'document.documentElement.dataset.contrast = "high";' : "delete document.documentElement.dataset.contrast;"} ${wait(400)}`;
const eachStep = (label) => [1, 2, 3, 4].map((n) => ({ js: `document.querySelector('[data-step="${n}"]').click(); ${wait(500)} ${audit}`, label: label + " step " + n }));
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(600)} document.querySelector("#step-goal details summary").click(); [...document.querySelectorAll("[data-ex]")].find(x => /Light the campus core/.test(x.innerText)).click(); ${until("window.__sandbox.api.R && !window.__sandbox.api.pending", 200)} ${wait(1500)} window.__sandbox.api.select(window.__sandbox.api.S.items[0].id); ${wait(500)} document.getElementById("plan-display-btn").click(); ${wait(300)} return "ready"` },
  ...[["light", false], ["dark", false], ["light", true], ["dark", true]].flatMap(([t, hc]) => [
    { js: `${theme(t, hc)} return "=== ${t}${hc ? " + high contrast" : ""} ==="` },
    ...eachStep(`${t}${hc ? "+hc" : ""}`).map((s) => ({ js: `${s.js.replace("return", "const out = (() => {").replace(/\n?$/, "")}` })).filter(() => false),
    ...[1, 2, 3, 4].map((n) => ({ js: `document.querySelector('[data-step="${n}"]').click(); ${wait(600)} ${audit.replace('return [...new Set(bad)].slice(0, 25).join("\\n") || "no contrast failures";', `return "step ${n}: " + ([...new Set(bad)].slice(0, 25).join(" | ") || "no contrast failures") + " (checked " + checked + ", lowest: " + lows.sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[0].toFixed(2) + " " + x[1]).join(" / ") + ")";`)}` })),
  ]),
];
