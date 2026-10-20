// Placing things: one placement then done, Undo from the toast, Keep adding, a drawn building, keyboard placement at the cross.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const st = `const a = window.__sandbox.api; const c = document.getElementById("plan-card"); return JSON.stringify({ items: a.S.items.length, kinds: a.S.items.map(i => i.kind).join(","), tool: a.tool, sel: a.sel, card: c.hidden ? "hidden" : c.querySelector("h2").innerText, focus: document.activeElement.tagName + "#" + document.activeElement.id + "." + (document.activeElement.className || ""), toast: document.getElementById("toast").classList.contains("off") ? "" : document.getElementById("toast").innerText.replace(/\\n/g, " "), bar: document.getElementById("plan-draw").hidden ? "hidden" : document.getElementById("plan-draw-tip").innerText, cross: !document.getElementById("plan-cross").hidden })`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(500)} document.querySelector("[data-goal=light]").click(); ${wait(400)} return "in plan, goal light"` },
  { js: `document.querySelector('[data-tool=street_light]').click(); ${wait(300)} ${st}` },
  { shot: "tool-on" },
  { click: [900, 450] },
  { wait: 700, js: st },
  { shot: "placed" },
  { js: `document.querySelector("#toast button").click(); ${wait(400)} ${st}` },
  { js: `document.querySelector('[data-tool=bench]') || document.querySelector('.more-tools summary').click(); ${wait(200)} document.querySelector('[data-tool=bin]').click(); ${wait(200)} const k = document.getElementById("plan-keep"); k.click(); return "keep=" + window.__sandbox.api.keep` },
  { click: [850, 400] }, { wait: 500, click: [950, 500] },
  { wait: 700, js: st },
  { keys: ["Escape"] },
  { wait: 300, js: st },
  { js: `document.querySelector('[data-tool=building]').click(); ${wait(200)} return "building tool"` },
  { click: [800, 380] }, { wait: 250, click: [900, 380] }, { wait: 250, click: [900, 450] },
  { wait: 800, js: st },
  { shot: "building" },
  { js: `const c = document.getElementById("plan-card"); const b = c.querySelector("[data-nudge='1,0']"); const it = window.__sandbox.api.S.items.at(-1); const x0 = it.pts[0][0]; b.click(); b.click(); ${wait(300)} return "nudged x by " + (window.__sandbox.api.S.items.at(-1).pts[0][0] - x0).toFixed(2)` },
  { js: `document.querySelector('[data-status=existing]').click(); ${wait(300)} const f = document.activeElement; return "status button focus kept: " + f.dataset.status + " | " + document.getElementById("plan-card").innerText.slice(0, 200).replace(/\\n/g, " | ")` },
  { shot: "card" },
  { js: `window.__sandbox.api.doUndo(); window.__sandbox.api.doUndo(); ${wait(300)} document.querySelector('[data-tool=street_light]').click(); ${wait(200)} document.getElementById("plan-keep").checked && document.getElementById("plan-keep").click(); ${wait(100)}; ${st}` },
  { keys: ["Enter"] },
  { wait: 600, js: st },
  { shot: "enter-placed" },
];
