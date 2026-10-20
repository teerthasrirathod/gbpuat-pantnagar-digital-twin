// Dark theme and the high-contrast option; the Wi-Fi example for something with a warning and a gauge that is "almost".
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const idle = `${until("window.__sandbox.api.R && !window.__sandbox.api.pending", 200)} ${wait(1200)}`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.documentElement.dataset.theme = "dark"; document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(800)} return "dark plan"` },
  { shot: "dark-goal" },
  { js: `document.querySelector("#step-goal details summary").click(); [...document.querySelectorAll("[data-ex]")].find(x => /new 4-storey/.test(x.innerText)).click(); ${idle} return document.getElementById("result-cards").innerText.replace(/\\n+/g, " | ").slice(0, 900)` },
  { shot: "dark-results" },
  { js: `document.documentElement.dataset.theme = "light"; document.documentElement.dataset.contrast = "high"; ${wait(500)} return "light + high contrast"` },
  { shot: "hc-results" },
  { js: `document.querySelector('[data-step="2"]').click(); ${wait(500)} const it = window.__sandbox.api.S.items.find(i => i.kind === "building"); window.__sandbox.api.select(it.id); ${wait(600)} return "selected " + it.id` },
  { shot: "hc-card" },
];
