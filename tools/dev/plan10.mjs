// Leaving planning for street view and coming back; closing the panel; the P key; letter shortcuts switched off.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const mode = `window.__campus.plan.mode() + " planOpen=" + !document.getElementById("plan").hidden + " cardHidden=" + document.getElementById("plan-card").hidden + " step=" + [1,2,3,4].find(i => !document.getElementById(["", "step-goal", "step-changes", "step-results", "step-share"][i]).hidden)`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(500)} document.querySelector("[data-goal=build]").click(); ${wait(300)} await window.__sandbox.api.quick("block"); ${wait(900)} return "placed: " + ${mode}` },
  { js: `document.querySelector("#plan-card [data-act=street]").click(); ${wait(1500)} return "after street click: " + ${mode}` },
  { keys: ["Escape"] },
  { wait: 1200, js: `return "after Esc: " + ${mode}` },
  { js: `document.getElementById("plan-close").click(); ${wait(800)} return "after Close: " + ${mode}` },
  { keys: ["p"] },
  { wait: 800, js: `return "after P: " + ${mode}` },
  { js: `document.getElementById("plan-display-btn").click(); ${wait(300)} document.querySelector('[data-d=keys]').click(); ${wait(200)} document.getElementById("ds-close").click(); ${wait(200)} return "letter keys off=" + window.__singleKeysOff` },
  { keys: ["w"], hold: 700 },
  { wait: 800, js: `const v = window.__campus.view; return "W with shortcuts off moved camera? target=" + v.tx.toFixed(0) + "," + v.tz.toFixed(0) + " (start was near the block)" ` },
  { keys: ["ArrowUp"], hold: 700 },
  { wait: 800, js: `const v = window.__campus.view; return "ArrowUp still works: target=" + v.tx.toFixed(0) + "," + v.tz.toFixed(0)` },
];
