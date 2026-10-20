// Phone width (bottom sheet): mode bar, goal screen, results, placing with the sheet in peek mode.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2500)} return "ready " + innerWidth + "x" + innerHeight` },
  { shot: "bar" },
  { js: `document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(800)} const p = document.getElementById("plan").getBoundingClientRect(); return "plan sheet top=" + p.top.toFixed(0) + " h=" + p.height.toFixed(0) + " hscroll=" + (document.documentElement.scrollWidth > innerWidth)` },
  { shot: "goal" },
  { js: `document.querySelector("[data-goal=wifi]").click(); ${wait(400)} document.querySelector("[data-quick=wifi]").click(); ${until("window.__sandbox.api.R && window.__sandbox.api.S.items.length > 5 && !window.__sandbox.api.pending", 200)} ${wait(1500)} return "items=" + window.__sandbox.api.S.items.length` },
  { shot: "results" },
  { js: `document.querySelector('[data-step="2"]').click(); ${wait(400)} document.querySelector('[data-tool=street_light]').click(); ${wait(500)} const p = document.getElementById("plan").getBoundingClientRect(); return "peek=" + document.getElementById("plan").classList.contains("sheet-peek") + " sheet h=" + p.height.toFixed(0) + " bar=" + document.getElementById("plan-draw").getBoundingClientRect().top.toFixed(0)` },
  { shot: "peek" },
  { click: [200, 380] },
  { wait: 800, js: `const c = document.getElementById("plan-card").getBoundingClientRect(); return "card top=" + c.top.toFixed(0) + " h=" + c.height.toFixed(0) + " hidden=" + document.getElementById("plan-card").hidden + " tool=" + window.__sandbox.api.tool` },
  { shot: "card" },
];
