// First-run journey in the classic viewer's Plan mode: goal -> quick start -> results. Run with shoot.sh against /campus/.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const ready = `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2500)} return "viewer ready"`;
export default [
  { js: ready },
  { js: `document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(600)} const a = window.__sandbox.api; return "booted=" + a.booted + " step1=" + document.getElementById("step-goal").innerText.slice(0, 160).replace(/\\n/g, " | ")` },
  { shot: "goal" },
  { js: `document.querySelector("[data-goal=wifi]").click(); ${wait(500)} return document.getElementById("step-changes").innerText.slice(0, 300).replace(/\\n/g, " | ")` },
  { shot: "changes" },
  { js: `document.querySelector("[data-quick=wifi]").click(); ${until("window.__sandbox.api.R && window.__sandbox.api.S.items.length > 5 && !window.__sandbox.api.pending", 200)} ${wait(1500)} const a = window.__sandbox.api; return "items=" + a.S.items.length + " tool=" + a.tool + " step3 visible=" + !document.getElementById("step-results").hidden + " :: " + document.getElementById("result-cards").innerText.slice(0, 500).replace(/\\n/g, " | ")` },
  { shot: "results" },
  { js: `return "strip: " + document.getElementById("plan-strip").innerText.replace(/\\n/g, " | ")` },
];
