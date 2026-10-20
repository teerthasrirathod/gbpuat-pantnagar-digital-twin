// Review fixes: an Undo message never undoes something newer, the item card still works after Undo, focus survives a result,
// a half-drawn shape takes Undo, a malicious link cannot inject markup, stopping the Wi-Fi placement.
const wait = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
const until = (cond, n = 240) => `for (let i = 0; i < ${n} && !(${cond}); i++) await new Promise(r => setTimeout(r, 250));`;
const idle = `${until("window.__sandbox.api.R && !window.__sandbox.api.pending", 200)} ${wait(700)}`;
const toastOff = `document.getElementById("toast").classList.contains("off")`;
export default [
  { js: `${until('window.__campus && document.getElementById("loading").classList.contains("done")', 480)} ${wait(2000)} document.getElementById("mode-plan").click(); ${until("window.__sandbox && window.__sandbox.api.booted", 160)} ${wait(500)} document.querySelector("[data-goal=cycle]").click(); ${wait(300)} return "ready"` },
  // 1. the card after Undo
  { js: `const a = window.__sandbox.api; a.setTool("bike_dock"); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); ${wait(600)} const id = a.sel; const card = document.getElementById("plan-card"); card.querySelector("[data-nudge='1,0']").click(); ${wait(300)} card.querySelector("[data-nudge='1,0']").click(); ${wait(300)} return "placed, selected=" + id + " items=" + a.S.items.length` },
  { keys: ["z"], ctrl: true },
  { wait: 500, js: `const a = window.__sandbox.api; const nm = document.getElementById("pc-name"); nm.focus(); nm.value = "Library stand"; nm.dispatchEvent(new Event("change", { bubbles: true })); ${wait(400)} return "name after undo + rename: " + JSON.stringify(a.S.items[0].name) + " (should be Library stand)"` },
  // 2. a stale Undo message goes away
  { js: `const a = window.__sandbox.api; a.setTool("bin"); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); ${wait(600)} const shown1 = !${toastOff}; const t1 = document.getElementById("toast").innerText; document.querySelector("#plan-card [data-nudge='0,1']").click(); ${wait(400)} return "toast shown after placing: " + shown1 + " (" + t1.replace(/\\n/g, " ") + "); after a nudge the old Undo message is hidden: " + ${toastOff}` },
  // 3. focus survives a result in the cost section
  { js: `const a = window.__sandbox.api; document.querySelector('[data-step="3"]').click(); ${wait(300)} document.getElementById("d-budget").open = true; ${idle} const inp = document.querySelector("#ptab-budget [data-rate]"); inp.focus(); inp.value = String(Number(inp.value) + 1); inp.dispatchEvent(new Event("change", { bubbles: true })); ${idle} const f = document.activeElement; return "focus after result: " + f.tagName + " " + (f.getAttribute("data-rate") || f.id) + " same as before=" + (f.dataset.rate === inp.dataset.rate) + "; budget section still open=" + document.getElementById("d-budget").open` },
  // 4. Ctrl+Z while drawing takes back the point
  { js: `const a = window.__sandbox.api; document.querySelector('[data-step="2"]').click(); ${wait(300)} a.setTool("road"); window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true })); ${wait(300)} const n0 = a.S.items.length; return "drawing road, items=" + n0` },
  { keys: ["z"], ctrl: true },
  { wait: 400, js: `const a = window.__sandbox.api; return "after Ctrl+Z while drawing: items=" + a.S.items.length + " tool=" + a.tool + " (item count unchanged, draft cancelled or shortened)"` },
  { keys: ["Escape"] },
  // 5. a hostile link: ids and colours in markup
  { js: `const a = window.__sandbox.api; const o = window.__sandbox.toGeoJSON(); o.features[0].id = 'x" onmouseover="window.__pwned=1'; o.sandbox.custom_kinds = [{ key: "x_evil", label: "Evil <img src=x onerror=window.__pwned=2>", category: "c_evil", categoryLabel: "Evil", geom: "point", color: 'red" onload="window.__pwned=3' }]; o.features.push({ type: "Feature", geometry: { type: "Point", coordinates: o.features[0].geometry.coordinates }, properties: { kind: "x_evil" } }); window.__sandbox.loadPlan(o, "test"); ${idle} document.querySelector('[data-step="2"]').click(); ${wait(500)} const html = document.getElementById("plan-items").innerHTML + document.getElementById("plan-tools").innerHTML; return "pwned=" + window.__pwned + " | ids with quotes in markup: " + /onmouseover=/.test(html) + " | items=" + a.S.items.length + " custom kinds kept=" + Object.keys(a.K).filter(k => k === "x_evil").length` },
];
