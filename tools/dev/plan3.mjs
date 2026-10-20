// Results, share, help, tour and display settings on a 1366x768 laptop, with a ready-made example loaded.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const idle = `${until("window.__sandbox.api.R && !window.__sandbox.api.pending", 200)} ${wait(1200)}`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(800)} return "in plan"` },
  { shot: "goal" },
  { js: `const li = [...document.querySelectorAll("[data-ex]")]; document.querySelector("#step-goal details summary").click(); ${wait(200)}; return li.map(x => x.innerText.split("\\n")[0]).join(" | ")` },
  { shot: "examples" },
  { js: `const li = [...document.querySelectorAll("[data-ex]")].find(x => /Light the campus core/.test(x.innerText)); li.click(); ${idle} const a = window.__sandbox.api; return "items=" + a.S.items.length + " step3=" + !document.getElementById("step-results").hidden` },
  { shot: "results-top" },
  { js: `document.getElementById("plan-body").scrollTop = 520; ${wait(300)} return document.getElementById("result-cards").innerText.replace(/\\n+/g, " | ").slice(0, 1600)` },
  { shot: "results-scrolled" },
  { js: `document.querySelector("[data-ov=lux]").click(); ${wait(2500)} return "overlay lux=" + window.__sandbox.api.OV.lux + " legend=" + document.getElementById("plan-legend").innerText.replace(/\\n+/g, " | ")` },
  { shot: "overlay" },
  { js: `document.querySelector('[data-step="4"]').click(); ${wait(500)} return document.getElementById("step-share").innerText.replace(/\\n+/g, " | ").slice(0, 900)` },
  { shot: "share" },
  { js: `document.getElementById("plan-help-btn").click(); ${wait(500)} return "dialog open=" + document.getElementById("plan-sheet").open` },
  { shot: "help" },
  { js: `document.getElementById("sheet-close").click(); ${wait(200)} document.getElementById("plan-display-btn").click(); ${wait(300)} document.querySelector('[data-size="20"]').click(); ${wait(400)} return "size=" + getComputedStyle(document.getElementById("plan")).fontSize` },
  { shot: "display-large" },
  { js: `document.getElementById("ds-reset").click(); document.getElementById("ds-close").click(); ${wait(200)} document.querySelector('[data-step="1"]').click(); ${wait(300)} document.querySelector('#step-goal [data-act=tour]').click(); ${wait(600)} return "tour: " + document.getElementById("tour").innerText.replace(/\\n+/g, " | ")` },
  { shot: "tour" },
  { js: `document.getElementById("t-next").click(); ${wait(300)} document.getElementById("t-next").click(); ${wait(500)} return "tour: " + document.getElementById("tour").innerText.replace(/\\n+/g, " | ")` },
  { shot: "tour3" },
];
