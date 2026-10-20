/* Pantnagar Sandbox - the guided shell around plan mode.
   plan.js does the planning (map, engine, plans, files). This file is what a first-time, non-technical person meets:
   a four-step path (Goal, Changes, Results, Share), results written as sentences with a word and a symbol as well as a
   colour, messages with Undo instead of "are you sure" boxes, a short tour, a word list, and display settings
   (text size, contrast, less movement, letter-key shortcuts). It talks to plan.js through window.__sandbox.api and
   "sandbox:*" events, and works on phones as a bottom sheet. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const api = () => (window.__sandbox && window.__sandbox.api) || null;
  const on = (name, fn) => window.addEventListener("sandbox:" + name, (e) => fn(e.detail || {}));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  const phone = matchMedia("(max-width: 700px)");

  // ---------------------------------------------------------------------------------------
  function fitPanel() {
    const p = $("plan");
    if (p.hidden) return;
    p.classList.remove("scrolly");
    if (!p.classList.contains("sheet-peek") && $("plan-body").clientHeight < 250) p.classList.add("scrolly");
  }
  let fitQueued = false;
  function queueFit() { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitPanel(); }); }
  window.addEventListener("resize", queueFit);
  // Display settings: text size, contrast, motion, letter-key shortcuts. Applied at once, even before planning opens.
  const DISP_KEY = "pantnagar-sandbox:display:v1";
  let DISP = { size: 16, contrast: false, motion: false, keys: true };
  try { DISP = { ...DISP, ...JSON.parse(store.get(DISP_KEY) || "{}") }; } catch (e) { /* keep defaults */ }
  function applyDisplay() {
    const r = document.documentElement;
    r.style.setProperty("--pfs", DISP.size + "px");
    if (DISP.contrast) r.dataset.contrast = "high"; else delete r.dataset.contrast;
    if (DISP.motion) r.dataset.motion = "reduce"; else delete r.dataset.motion;
    window.__singleKeysOff = !DISP.keys;
    store.set(DISP_KEY, JSON.stringify(DISP));
    if (typeof queueFit === "function") queueFit();
  }
  applyDisplay();
  const SIZES = [[16, "Normal"], [18, "Large"], [20, "Larger"], [22, "Largest"]];
  function renderDisplay() {
    const el = $("plan-display");
    el.innerHTML = `
      <h4>Make it easier to read</h4>
      <div class="row"><span id="ds-size-l">Text size</span><div class="seg small" role="group" aria-labelledby="ds-size-l">${SIZES.map(([n, l], i) => `<button data-size="${n}" aria-pressed="${DISP.size === n}" aria-label="${l}"><span aria-hidden="true" style="font-size:${13 + i * 3}px">A</span></button>`).join("")}</div></div>
      <label class="chk"><input type="checkbox" data-d="contrast" ${DISP.contrast ? "checked" : ""}><span><b>Stronger contrast</b><br><small>Darker text and borders</small></span></label>
      <label class="chk"><input type="checkbox" data-d="motion" ${DISP.motion ? "checked" : ""}><span><b>Less movement</b><br><small>The map jumps instead of gliding</small></span></label>
      <label class="chk"><input type="checkbox" data-d="keys" ${DISP.keys ? "checked" : ""}><span><b>Letter-key shortcuts</b><br><small>W A S D, Q, E, P, V and R. Untick them if they get in your way.</small></span></label>
      <div class="row"><button class="pbtn small" id="ds-reset">Back to normal</button><button class="pbtn small primary" id="ds-close">Done</button></div>`;
    el.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => { DISP.size = +b.dataset.size; applyDisplay(); renderDisplay(); const nb = el.querySelector('[data-size="' + DISP.size + '"]'); if (nb) nb.focus(); }));
    el.querySelectorAll("[data-d]").forEach((c) => c.addEventListener("change", () => { DISP[c.dataset.d] = c.checked; applyDisplay(); }));
    $("ds-reset").onclick = () => { DISP = { size: 16, contrast: false, motion: false, keys: true }; applyDisplay(); renderDisplay(); };
    $("ds-close").onclick = () => closeDisplay(true);
  }
  function closeDisplay(refocus) {
    const p = $("plan-display");
    if (p.hidden) return;
    p.hidden = true;
    $("plan-display-btn").setAttribute("aria-expanded", "false");
    if (refocus) $("plan-display-btn").focus();
  }
  $("plan-display-btn").addEventListener("click", () => {
    const p = $("plan-display");
    if (!p.hidden) { closeDisplay(true); return; }
    renderDisplay(); p.hidden = false;
    $("plan-display-btn").setAttribute("aria-expanded", "true");
    const f = p.querySelector("button[aria-pressed=true]"); if (f) f.focus();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("plan-display").hidden) { closeDisplay(true); e.stopPropagation(); } }, true);
  document.addEventListener("pointerdown", (e) => { if (!$("plan-display").hidden && !e.target.closest("#plan-display, #plan-display-btn")) closeDisplay(false); });

  // ---------------------------------------------------------------------------------------
  // Messages: a toast that pauses while you read it and can carry Undo, a banner for problems, a dialog for the few real questions
  let toastTimer = 0, toastSeq = 0, curToast = null;
  const hideToast = () => {
    clearTimeout(toastTimer); toastSeq++; curToast = null;
    const el = $("toast"), had = el.contains(document.activeElement);
    el.classList.add("off"); el.dataset.progress = ""; el.textContent = "";
    if (had) $("view").focus({ preventScroll: true }); // a keyboard user who closed it keeps their place
  };
  const armToast = (ms) => {
    clearTimeout(toastTimer);
    if (!ms) return;
    toastTimer = setTimeout(function tick() { if ($("toast").matches(":hover, :focus-within")) { toastTimer = setTimeout(tick, 2500); return; } hideToast(); }, ms);
  };
  // The message area is always on the page (just squeezed to nothing when empty) so screen readers announce what lands in it.
  window.__planToast = function (msg, o = {}) {
    const el = $("toast");
    // a progress message only changes its words, so the Stop button stays put and screen readers are not flooded
    if (o.progress && el.dataset.progress === "1" && !el.classList.contains("off")) { const m = el.querySelector(".msg"); if (m) { m.textContent = msg; return; } }
    clearTimeout(toastTimer);
    toastSeq++;
    curToast = o;
    el.dataset.progress = o.progress ? "1" : "";
    el.setAttribute("aria-live", o.progress ? "off" : "polite");
    el.textContent = "";
    {
      const m = document.createElement("span"); m.className = "msg"; m.textContent = msg; el.appendChild(m);
      const btn = (label, fn, aria) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (aria) b.setAttribute("aria-label", aria); b.addEventListener("click", fn); el.appendChild(b); };
      if (o.undo) {
        btn("Undo", () => {
          const a = api();
          if (a && a.undoMatches(o.token)) { a.doUndo(); hideToast(); say("Undone"); }
          else window.__planToast("That has changed since. Use the Undo button at the top of the panel.", {});
        });
      }
      if (o.action) btn(o.action.label, () => { o.action.fn(); });
      btn("✕", hideToast, "Dismiss this message");
      el.classList.remove("off");
      armToast(o.sticky ? 0 : Math.min(12000, 5000 + msg.length * 45) + (o.undo ? 2500 : 0));
    }
  };
  function showBanner(html, acts) {
    const b = $("banner");
    b.innerHTML = `<span>${html}</span>`;
    for (const [label, fn] of acts || []) { const x = document.createElement("button"); x.className = "pbtn"; x.type = "button"; x.textContent = label; x.addEventListener("click", fn); b.appendChild(x); }
    const c = document.createElement("button"); c.className = "pbtn quiet"; c.type = "button"; c.textContent = "Dismiss"; c.addEventListener("click", () => { b.hidden = true; }); b.appendChild(c);
    b.hidden = false;
  }
  window.__planAsk = (o) => new Promise((resolve) => {
    const d = $("ask"), yes = $("ask-yes"), no = $("ask-no");
    $("ask-title").textContent = o.title || "Are you sure?";
    $("ask-body").textContent = o.body || "";
    yes.textContent = o.yes || "Yes"; no.textContent = o.no || "Cancel";
    yes.classList.toggle("danger", !!o.danger); yes.classList.toggle("primary", !o.danger);
    let done = false;
    const finish = (v) => { if (done) return; done = true; yes.onclick = no.onclick = null; d.removeEventListener("close", onClose); if (d.open) d.close(); resolve(v); };
    const onClose = () => finish(false);
    d.addEventListener("close", onClose);
    yes.onclick = () => finish(true); no.onclick = () => finish(false);
    d.showModal(); no.focus();
  });
  function say(text) { const el = $("sr-live"); el.textContent = ""; setTimeout(() => { el.textContent = text; }, 60); }
  on("say", (d) => say(d.text));

  // ---------------------------------------------------------------------------------------
  // The four steps
  const STEP_ID = [null, "step-goal", "step-changes", "step-results", "step-share"];
  const HEAD_ID = [null, "h-goal", "h-changes", "h-results", "h-share"];
  const STEP_NAME = [null, "Goal", "Changes", "Results", "Share"];
  let step = 1;
  const planOpen = () => !$("plan").hidden;
  function paintSteps() {
    const a = api(), items = a ? a.S.items.length : 0;
    const done = [false, !!(a && a.booted && (a.S.meta.goal || items)), items > 0, !!(a && a.R && items && !a.stale && !a.pending), false];
    document.querySelectorAll("#plan-steps button").forEach((b) => {
      const i = +b.dataset.step, isDone = done[i] && i !== step;
      b.classList.toggle("done", isDone);
      b.querySelector(".n").textContent = isDone ? "✓" : String(i);
      b.setAttribute("aria-label", `Step ${i}: ${STEP_NAME[i]}${isDone ? ", done" : ""}`);
      if (i === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
  }
  const FOOT = [null, [null, "Go to Changes ›"], ["‹ Goal", "See the results ›"], ["‹ Changes", "Share it ›"], ["‹ Results", "Close planning"]];
  function showStep(n, o = {}) {
    step = n;
    for (let i = 1; i <= 4; i++) $(STEP_ID[i]).hidden = i !== n;
    const [back, next] = FOOT[n];
    $("foot-back").hidden = !back; if (back) $("foot-back").textContent = back;
    $("foot-next").textContent = next;
    $("foot-next").classList.toggle("primary", n !== 1);
    renderStep(n);
    paintSteps();
    $("plan-body").scrollTop = 0; $("plan").scrollTop = 0;
    queueFit();
    if (o.focus !== false) { const h = $(HEAD_ID[n]); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
  }
  function renderStep(n) {
    if (n === 1) renderGoal(); else if (n === 2) renderQuick(); else if (n === 3) renderResults();
  }
  document.querySelectorAll("#plan-steps button").forEach((b) => b.addEventListener("click", () => showStep(+b.dataset.step)));
  $("foot-back").addEventListener("click", () => showStep(Math.max(1, step - 1)));
  $("foot-next").addEventListener("click", () => { if (step < 4) showStep(step + 1); else $("plan-close").click(); });

  let loadError = "";
  function retryEngine() { $("banner").hidden = true; loadError = ""; const A = window.__campus.plan; A.setMode("aerial"); setTimeout(() => A.setMode("plan"), 80); }
  const errorNote = () => `<div class="pwarn" role="alert"><b>The planning calculator could not start.</b> ${esc(loadError)} <button class="linkbtn" data-act="retry">Try again</button></div>`;
  // Step 1: what would you like to improve?
  function renderGoal() {
    const a = api(), el = $("step-goal"), ready = !!(a && a.booted);
    const items = ready ? a.S.items.length : 0;
    const first = !store.get("pantnagar-sandbox:seen");
    const ex = window.SANDBOX_EXAMPLES || [];
    el.innerHTML = `
      <h2 id="h-goal" tabindex="-1">What would you like to improve?</h2>
      <p>Pick one and we will set things up for you. You can change your mind at any time. Nothing here changes the real campus.${ready && !items && first ? ` <button class="linkbtn" data-act="tour">New here? Take a one-minute tour.</button>` : ""}</p>
      ${ready ? "" : loadError ? errorNote() : `<p class="engine-note" role="status">Getting the planning calculator ready…</p>`}
      ${ready && items ? `<div class="callout"><h3>Your plan is in progress</h3><p style="margin:0"><b>${esc(a.S.meta.title)}</b>: ${a.plural(items, "change")} so far.</p><div class="acts"><button class="pbtn primary" data-act="continue">Carry on with it ›</button></div></div>` : ""}
      <div class="goals" role="group" aria-label="Goals">
        ${(a ? a.GOALS : []).map((g) => `<button class="goal" data-goal="${g.key}" ${ready ? "" : "disabled"}><span class="gi">${a.svg(g.icon)}</span><b>${esc(g.title)}</b><span>${esc(g.blurb)}</span></button>`).join("")}
      </div>
      ${ready && ex.length ? `<details class="disc"><summary>Or start from a ready-made example</summary><ul class="examples">${ex.map((x, i) => `<li data-ex="${i}" tabindex="0" role="button"><b>${esc((x.plan.sandbox && x.plan.sandbox.title) || x.file)}</b><span>${esc((x.plan.sandbox && (x.plan.sandbox.summary || x.plan.sandbox.notes)) || "")}</span></li>`).join("")}</ul><p class="note">An example opens as a new plan, so your own work is kept.</p></details>` : ""}
      <div class="links">
        <button class="linkbtn" data-act="tour">Show me around (1 minute)</button>
        <button class="linkbtn" data-act="help">Help and word list</button>
        <button class="linkbtn" data-act="plans">My saved plans</button>
      </div>`;
  }
  $("step-goal").addEventListener("click", (e) => {
    const a = api(); if (!a) return;
    const g = e.target.closest("[data-goal]"), act = e.target.closest("[data-act]"), ex = e.target.closest("[data-ex]");
    if (g) { a.setGoal(g.dataset.goal); store.set("pantnagar-sandbox:seen", "1"); const goal = a.GOALS.find((x) => x.key === g.dataset.goal); say("Goal: " + goal.title); showStep(2); return; }
    if (ex) { openExample(+ex.dataset.ex); return; }
    if (!act) return;
    if (act.dataset.act === "continue") showStep(2);
    else if (act.dataset.act === "tour") startTour();
    else if (act.dataset.act === "help") openHelp();
    else if (act.dataset.act === "plans") { if ($("scn-list").hidden) $("scn-btn").click(); $("scn-btn").focus(); }
    else if (act.dataset.act === "retry") retryEngine();
  });
  $("step-goal").addEventListener("keydown", (e) => { const ex = e.target.closest("[data-ex]"); if (ex && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openExample(+ex.dataset.ex); } });
  function openExample(i) {
    const a = api(), x = (window.SANDBOX_EXAMPLES || [])[i];
    if (!a || !x) return;
    const goal = a.GOALS.find((g) => g.example === x.file);
    a.openExample(x.file, goal ? goal.key : "");
    store.set("pantnagar-sandbox:seen", "1");
    showStep(3);
  }

  // Step 2: the quick start for the goal. The tools themselves are drawn by plan.js.
  function renderQuick() {
    const a = api(), el = $("quick");
    if (!a || !a.booted) { el.innerHTML = ""; return; }
    const g = a.GOALS.find((x) => x.key === a.S.meta.goal);
    $("h-changes").textContent = g ? "Make your changes: " + g.title : "Make your changes";
    if (!g) { el.innerHTML = `<div class="callout quiet"><p style="margin:0">You have not chosen a goal. That is fine: add anything below. <button class="linkbtn" data-act="goal">Choose a goal</button></p></div>`; return; }
    el.innerHTML = g.quick
      ? `<div class="callout"><h3>Quick start</h3><p style="margin:0">The fastest way to see something happen. You can undo it.</p><div class="acts"><button class="pbtn primary" data-quick="${g.quick.id}">${esc(g.quick.label)}</button></div></div>`
      : `<div class="callout quiet"><p style="margin:0"><b>${esc(g.title)}.</b> ${esc(g.blurb)}. Choose something below, then click on the map where it should go.</p></div>`;
  }
  $("quick").addEventListener("click", async (e) => {
    const a = api(); if (!a) return;
    if (e.target.closest("[data-act=goal]")) { showStep(1); return; }
    const q = e.target.closest("[data-quick]"); if (!q) return;
    q.disabled = true;
    let r = null;
    try { r = await a.quick(q.dataset.quick); } finally { q.disabled = false; }
    if (r && r.added && ["wifi", "rwh"].includes(q.dataset.quick)) showStep(3);
  });

  // Step 3: what would this achieve? Sentences, not tables.
  const NONE = { cls: "none", word: "For information", icon: "i" };
  const badge = (st) => `<span class="badge ${st.cls}"><span aria-hidden="true">${st.icon}</span> ${esc(st.word)}</span>`;
  const rcard = (title, st, sentence, more, acts) => `<article class="rcard ${st.cls}"><h3 class="sr">${esc(title)}</h3>${badge(st)}<p class="sentence">${sentence}</p>${more || ""}${acts ? `<div class="acts">${acts}</div>` : ""}</article>`;
  const act = (label, attrs, primary) => `<button class="pbtn small${primary ? " primary" : ""}" ${attrs}>${esc(label)}</button>`;
  const toggle = (label, attrs, pressed) => `<button class="pbtn small" ${attrs} aria-pressed="${pressed ? "true" : "false"}">${esc(label)}</button>`;
  const NOUN = { bike_dock: "a cycle stand", bin: "the bins", water_point: "drinking water", vending: "a vending machine", ev_charger: "an EV charging point", shuttle_stop: "a shuttle stop", bench: "a bench" };
  function gauge(v, was, tgt) {
    const c = (x) => Math.max(0, Math.min(100, x)), f = (x) => Math.round(x);
    return `<div class="gauge" role="img" aria-label="With your plan ${f(v)} percent. Today ${f(was)} percent. Target ${f(tgt)} percent."><div class="fill" style="width:${c(v)}%"></div><div class="was" style="left:${c(was)}%"></div><div class="tgt" style="left:${c(tgt)}%"></div></div>
      <div class="gauge-l"><span>Today ${f(was)}%</span><span>Target ${f(tgt)}%</span><span><b>With your plan ${f(v)}%</b></span></div>`;
  }
  function cardWifi(a, R, V) {
    const w = R.wifi, v = V.find((x) => x.key === "wifi");
    if (!w.plan.aps && !w.base.aps) return rcard("Wi-Fi", NONE, `<strong>No Wi-Fi points yet.</strong> Add some and this card shows how much of the floor area gets a good signal. Or let the computer place them for you.`, "", act("Place Wi-Fi in all the hostels for me", 'data-quick="wifi"', true) + act("Add one myself", 'data-tool="wifi_ap"'));
    if (!v) return rcard("Wi-Fi", NONE, `Wi-Fi is left out of these results. You can include it under <em>Show the numbers and the maps</em>.`, "", act("Open the numbers", 'data-open="d-sim"'));
    const st = a.stateOf(v), px = (x) => a.pct(x);
    const more = gauge(v.value, w.base.good * 100, v.target);
    const hint = v.ok ? "" : `<p class="note">Try <em>Place more for me</em> again, or add points in the buildings listed under <em>Show the numbers and the maps</em>.</p>`;
    return rcard("Wi-Fi", st, `With your Wi-Fi points, <strong>${px(w.plan.good)}</strong> of the floor area in the ${a.plural(w.targets.length, "building")} checked gets a signal good enough for a video call, up from <strong>${px(w.base.good)}</strong> today. You have ${a.plural(w.plan.aps, "Wi-Fi point")}.`, more + hint,
      toggle("Signal on the map", 'data-ov="wifi"', a.OV.wifi) + act("Place more for me", 'data-quick="wifi"') + act("Building by building", 'data-open="d-sim"'));
  }
  function cardLight(a, R, V) {
    const l = R.light, v = V.find((x) => x.key === "light");
    if (!l.study_m) return rcard("Street lighting", NONE, `<strong>No street lights near a road yet.</strong> Place lights, or light a whole road in one click, to see how well the roads are lit.`, "", act("Light a whole road", 'data-tool="light_road"', true) + act("Place one light", 'data-tool="street_light"'));
    const st = v ? a.stateOf(v) : NONE, ok = l.plan.ok_m / l.study_m, was = l.base.ok_m / l.study_m;
    const more = v ? gauge(ok * 100, was * 100, v.target) : "";
    return rcard("Street lighting", st, `<strong>${a.pct(ok)}</strong> of the ${a.fmt(l.study_m)} m of road around your lights is lit well enough to walk safely (the Indian standard, IS 1944), up from <strong>${a.pct(was)}</strong> today. ${l.dark.length ? `${a.plural(l.dark.length, "dark spot")} remain${l.dark.length === 1 ? "s" : ""}.` : "No dark spots remain."}`, more,
      toggle("Light on the map", 'data-ov="lux"', a.OV.lux) + toggle("Night view", 'data-night="1"', a.OV.night) + act("The details", 'data-open="d-sim"'));
  }
  function cardAccess(a, R, V, kind) {
    const x = R.access.find((q) => q.kind === kind), v = V.find((q) => q.key === "access:" + kind), noun = NOUN[kind] || a.kindLabel(kind).toLowerCase();
    if (!x) return rcard("Walking access", NONE, `<strong>Nothing placed yet.</strong> Add some and this card shows how many people can walk to them.`, "", act("Add one", `data-tool="${esc(kind)}"`, true));
    const st = v ? a.stateOf(v) : NONE, more = v ? gauge(v.value, x.base.pct * 100, v.target) : "";
    return rcard("Walking access", st, `People within a ${x.radius} m walk of ${esc(noun)}: <strong>${a.pct(x.plan.pct)}</strong>, up from <strong>${a.pct(x.base.pct)}</strong> today. You have placed ${x.plan.count}.`, more,
      toggle("Reach on the map", 'data-ov="catch"', a.OV.catch) + act("Place more", `data-tool="${esc(kind)}"`));
  }
  function cardGreen(a, R) {
    const g = R.green, li = [];
    if (g.planted || g.removed || g.affected) li.push(`Trees: <strong>${g.planted}</strong> planted, <strong>${g.removed + g.affected}</strong> lost to new work`);
    if (g.rwh_m3) li.push(`Rain collected from roofs: <strong>${a.fmt(g.rwh_m3)}</strong> cubic metres a year`);
    if (g.solar_kwp) li.push(`Rooftop solar: <strong>${a.fmt(g.solar_kwp, 1)} kWp</strong>, about ${a.fmt(g.solar_kwh)} kWh a year, saving about ${a.fmt(g.solar_co2_t, 1)} tonnes of CO₂`);
    if (g.co2_kg) li.push(`Trees will take up about ${a.fmt(g.co2_kg)} kg of CO₂ a year once grown`);
    if (!li.length) return "";
    return rcard("Water, sun and trees", NONE, `<strong>Water, sun and trees</strong>`, `<ul>${li.map((x) => `<li>${x}</li>`).join("")}</ul>`, act("The details", 'data-open="d-sim"'));
  }
  function cardBuild(a, R) {
    const b = R.build, li = [];
    if (b.new) li.push(`<strong>${a.plural(b.new, "new building")}</strong>: ${a.fmt(b.gfa)} m² of floor area, room for about ${a.fmt(b.people)} people`);
    if (b.demolished) li.push(`${b.demolished} removed (${a.fmt(b.demolished_gfa)} m²)`);
    if (b.added_gfa) li.push(`${a.fmt(b.added_gfa)} m² added by extra floors`);
    const opts = (a.K.road && a.K.road.params && a.K.road.params[0] && a.K.road.params[0].options) || [];
    for (const [k, m] of Object.entries(R.roads.new_m || {})) li.push(`${a.fmt(m)} m of new ${esc(((opts.find((o) => o[0] === k) || [k, k])[1]).toLowerCase())}`);
    if (R.roads.loose) li.push(`${a.plural(R.roads.loose, "new road")} not joined to the road network`);
    if (!li.length) return "";
    return rcard("Buildings and roads", NONE, `<strong>Buildings and roads</strong>`, `<ul>${li.map((x) => `<li>${x}</li>`).join("")}</ul>`, "");
  }
  function cardCost(a, R) {
    const t = a.totals();
    const st = t.cap ? (t.total <= t.cap ? { cls: "ok", word: "Within your budget", icon: "✓" } : { cls: "bad", word: "Over your budget", icon: "✕" }) : { cls: "none", word: "Estimate", icon: "i" };
    const lim = t.cap ? ` Your budget is <strong>${a.inr(t.cap)}</strong>: ${t.total <= t.cap ? `${a.inr(t.cap - t.total)} to spare` : `over by ${a.inr(t.total - t.cap)}`}.` : " You have not set a budget limit.";
    return rcard("Cost", st, `Building this would cost about <strong>${a.inr(t.total)}</strong>, and about <strong>${a.inr(t.opex)}</strong> a year to run and look after.${lim}`, `<p class="note">Costs use indicative 2026 rates. Real costs need quotations.</p>`,
      act("See the cost line by line", 'data-open="d-budget"') + act("Set a budget limit", 'data-open="d-budget" data-focus="[data-b=cap]"'));
  }
  function cardCheck(a, R) {
    if (!R.warnings) return "";
    const rows = R.items.filter((x) => x.warn && x.warn.length).slice(0, 6).map((x) => {
      const it = a.S.items.find((i) => i.id === x.id);
      return it ? `<li><button class="linkbtn" data-sel="${esc(x.id)}">${esc(it.name || a.kindLabel(it.kind))}</button>: ${esc(x.warn.join(" "))}</li>` : "";
    }).join("");
    return rcard("Things to check", { cls: "close", word: "Needs a look", icon: "!" }, `<strong>${a.plural(R.warnings, "thing")} to check</strong> before you rely on these numbers.`, `<ul>${rows}</ul>`, "");
  }
  const LIMITS = {
    wifi: "Wi-Fi comes from a simple signal model of the walls and floors, not a site survey.",
    light: "Light is worked out from the lamps you place, not from lamps measured on site.",
    access: "People are estimated from the floor area of each building.",
    cost: "Costs are indicative 2026 rates.",
  };
  function renderResults() {
    const a = api(), el = $("result-cards");
    if (!a || !a.booted) { el.innerHTML = loadError ? errorNote() : `<p class="engine-note" role="status">Getting the planning calculator ready…</p>`; return; }
    const items = a.S.items.length, R = a.R;
    if (!items) { el.innerHTML = `<div class="callout quiet"><h3>Nothing to measure yet</h3><p style="margin:0">Add something to the map first, and the effect appears here.</p><div class="acts"><button class="pbtn primary" data-goto="2">Go and add something</button></div></div>`; return; }
    if (a.failed && !a.pending) { el.innerHTML = `<div class="callout"><h3>The calculator stopped</h3><p style="margin:0">Your plan is safe. Press Try again to work out the results.</p><div class="acts"><button class="pbtn primary" data-act="retry">Try again</button></div></div>`; return; }
    if (!R || a.pending) { el.innerHTML = `<p class="engine-note" role="status">Working out the results…</p>`; return; }
    const V = a.verdicts(), ok = V.filter((x) => x.ok).length, kinds = new Set(a.S.items.map((i) => i.kind));
    const g = a.GOALS.find((x) => x.key === a.goalKey()), head = g ? g.headline : "";
    const out = [], used = new Set(), add = (k, h) => { if (h && !used.has(k)) { used.add(k); out.push(h); } };
    const has = (...ks) => ks.some((k) => kinds.has(k));
    const first = (k) => { // the card for the chosen goal comes first, whether or not anything is placed yet
      if (k === "wifi") add("wifi", cardWifi(a, R, V)); else if (k === "light") add("light", cardLight(a, R, V));
      else if (k.startsWith("access:")) add(k, cardAccess(a, R, V, k.slice(7))); else if (k === "green") add("green", cardGreen(a, R)); else if (k === "build") add("build", cardBuild(a, R));
    };
    if (head) first(head);
    if (has("wifi_ap")) first("wifi");
    if (has("street_light", "light_road", "cctv")) first("light");
    for (const x of R.access) first("access:" + x.kind);
    if (has("tree", "tree_remove", "tree_tag", "solar_roof", "rwh")) first("green");
    if (has("building", "demolish", "building_edit", "road", "area")) first("build");
    add("cost", cardCost(a, R)); add("check", cardCheck(a, R));
    const lim = [...new Set([has("wifi_ap") && LIMITS.wifi, has("street_light", "light_road") && LIMITS.light, R.access.length && LIMITS.access, LIMITS.cost].filter(Boolean))];
    el.innerHTML = `<p class="lead"><b>${esc(a.S.meta.title)}</b>: ${a.plural(items, "change")}. ${V.length ? `<strong>${ok} of ${V.length}</strong> targets met.` : ""}</p>${out.join("")}
      <div class="limits"><b>What these numbers do not tell you.</b> They come from a computer model of the campus built from open map data. ${esc(lim.join(" "))} Use them to compare ideas and make your case, then check on site.</div>`;
  }
  $("result-cards").addEventListener("click", async (e) => {
    const a = api(); if (!a) return;
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.ov) { a.setOverlay(d.ov, !a.OV[d.ov]); renderResults(); const nb = document.querySelector('#result-cards [data-ov="' + d.ov + '"]'); if (nb) nb.focus(); return; }
    if (d.act === "retry") { a.runEngine(); return; }
    if (d.night) { const c = $("ov-night"); if (c) c.click(); else a.setOverlay("lux", !a.OV.lux); renderResults(); const nb = document.querySelector('#result-cards [data-night]'); if (nb) nb.focus(); return; }
    if (d.quick) { b.disabled = true; try { await a.quick(d.quick); } finally { b.disabled = false; } return; }
    if (d.tool) { a.setTool(d.tool); showStep(2, { focus: false }); return; }
    if (d.goto) { showStep(+d.goto); return; }
    if (d.open) { openDetails(d.open); if (d.focus) focusInside(d.focus, 40); return; }
    if (d.sel) { a.select(d.sel, { focus: false }); const it = a.S.items.find((i) => i.id === d.sel); if (it) a.fitTo([it]); }
  });
  // Focus a control that may sit inside fold-outs: open them first.
  function focusInside(sel, delay) {
    setTimeout(() => { const f = document.querySelector(sel); if (!f) return; for (let p = f.closest("details"); p; p = p.parentElement && p.parentElement.closest("details")) p.open = true; f.focus(); }, delay || 40);
  }
  function openDetails(id) { const d = $(id); if (!d) return; d.open = true; setTimeout(() => d.scrollIntoView({ block: "nearest", behavior: DISP.motion ? "auto" : "smooth" }), 0); }

  // other parts of plan.js ask for a step or a fold-out section
  const TABS = { goal: [1], build: [2], changes: [2], sim: [3, "d-sim"], results: [3], budget: [3, "d-budget"], types: [3, "d-types"], file: [4], share: [4] };
  on("goto", (d) => {
    const [n, det] = TABS[d.tab] || [2];
    showStep(n, { focus: false });
    const open = d.open || det;
    if (open) openDetails(open);
    if (d.focus) focusInside(d.focus, 60);
  });

  // ---------------------------------------------------------------------------------------
  // Following plan.js
  on("mode", (d) => {
    if (d.on) {
      showStep(step, { focus: false });
      renderDisplay();
    } else {
      hideToast(); $("banner").hidden = true; closeDisplay(false); endTour();
      document.body.classList.remove("plan-card-open");
    }
  });
  on("ready", () => {
    const a = api();
    loadError = "";
    if (tourI >= 0) { renderStep(step); paintSteps(); return; } // someone already started the tour: do not move them
    const ae = document.activeElement, calm = !ae || ae === document.body || ae === $("view") || !!ae.closest("#step-goal");
    showStep(a.S.items.length ? 2 : 1, { focus: calm });
  });
  on("error", (d) => {
    loadError = d.message || "Something went wrong.";
    showBanner(`The planning calculator could not start. ${esc(loadError)}`, [["Try again", retryEngine]]);
    renderStep(step);
  });
  on("scenario", () => {
    const a = api(); if (!a || !a.booted) return;
    showStep(a.S.items.length ? Math.max(2, step === 1 ? 2 : step) : 1, { focus: false });
  });
  on("opened", () => showStep(3, { focus: false })); // a shared link or a file: show what it achieves first
  on("changed", () => {
    paintSteps(); queueFit(); if (step === 3) renderResults();
    if (curToast && curToast.undo) { const a = api(); if (a && !a.undoMatches(curToast.token)) hideToast(); } // an Undo button must not undo something newer
  });
  let lastSaid = "";
  on("result", () => {
    paintSteps();
    if (step === 3) renderResults();
    const a = api(), h = a && a.headline();
    if (!h || !planOpen() || step !== 3) return;
    const msg = `Results updated. ${h.label}: ${h.value}. ${h.sub.replace(/[✓✕◐]/g, "").replace(/·/g, ",")}`;
    if (msg !== lastSaid) { lastSaid = msg; say(msg); }
  });
  on("goal", () => { paintSteps(); if (step === 2) renderQuick(); if (step === 3) renderResults(); });
  on("showplan", () => { if (step === 3) renderResults(); });
  on("tool", (d) => { closeDisplay(false); if (phone.matches) setPeek(d.tool !== "select"); });

  // Phone: the panel is a sheet at the bottom. It shrinks to a strip while you place things so the map is in view.
  let peek = false;
  function setPeek(v) {
    peek = v;
    $("plan").classList.toggle("sheet-peek", v);
    const b = $("plan-sheet-btn");
    b.textContent = v ? "More" : "Less";
    b.setAttribute("aria-expanded", String(!v));
  }
  $("plan-sheet-btn").addEventListener("click", () => setPeek(!peek));
  phone.addEventListener("change", () => { if (!phone.matches) setPeek(false); });

  // ---------------------------------------------------------------------------------------
  // Help, word list, tour
  const HELP_HTML = `
    <details open><summary>How this works: four steps</summary>
      <ol><li><b>Goal.</b> Say what you want to improve.</li><li><b>Changes.</b> Add things to the map: Wi-Fi points, street lights, cycle stands, a building and more.</li><li><b>Results.</b> See what the changes achieve and what they cost, in plain words.</li><li><b>Share.</b> Make a printable report or a link for colleagues.</li></ol>
      <p>Nothing here changes the real campus. Every change can be undone, and your plans are kept on this computer.</p></details>
    <details><summary>Placing things on the map</summary>
      <ul><li>Choose something under <b>Add things to the map</b>, then click on the map where it should go. It is placed once, and the tool switches off. Tick <b>Keep adding</b> to place several.</li>
      <li>You can also press <kbd>Enter</kbd> or <kbd>Space</kbd> to put it at the cross in the middle of the screen.</li>
      <li>Click anything you added to change it, move it with the arrows on its card, or remove it.</li>
      <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> or the <b>Undo</b> button takes back the last change. <kbd>Esc</kbd> stops what you are doing.</li></ul></details>
    <details><summary>Moving around the map</summary>
      <dl><dt>Mouse</dt><dd>Drag to move the map. Right-drag (or hold <kbd>Shift</kbd> and drag) to turn it. Wheel to zoom.</dd>
      <dt>Keyboard</dt><dd><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys to move, <kbd>Q</kbd> and <kbd>E</kbd> to turn, <kbd>+</kbd> and <kbd>-</kbd> to zoom, <kbd>Shift</kbd> to go faster.</dd>
      <dt>Touch</dt><dd>Drag to move, pinch to zoom.</dd></dl></details>
    <details><summary>Words used here</summary>
      <dl><dt>Good Wi-Fi</dt><dd>A signal of about −67 dBm or better: enough for a video call. dBm is signal strength; closer to zero is stronger.</dd>
      <dt>Lit well enough</dt><dd>Meets the Indian standard IS 1944 for road lighting, measured in lux (how bright the ground is).</dd>
      <dt>Floor area</dt><dd>The area of all floors of a building added together.</dd>
      <dt>kWp</dt><dd>The size of a solar installation: what it produces in full sunshine.</dd>
      <dt>Cost to build, running cost</dt><dd>What it costs once, and what it costs each year to run and look after.</dd>
      <dt>Contingency</dt><dd>An allowance for things that turn out to cost more than expected.</dd>
      <dt>Walking reach</dt><dd>How far people will walk to get to something, measured along real roads and paths.</dd>
      <dt>Today and With this plan</dt><dd>Today is the campus as it is. With this plan adds your changes. Switch between them to see the difference.</dd>
      <dt>Saved file</dt><dd>A standard map file (GeoJSON). It opens here again, and in map software such as QGIS.</dd></dl></details>
    <details><summary>How accurate is it?</summary>
      <p>The numbers come from a computer model of the campus, built from open map data: buildings, roads and trees. Wi-Fi uses a simple signal model, not a site survey. Lighting uses the lamps you place. People are estimated from the floor area of buildings. Costs are indicative 2026 rates.</p>
      <p>Use it to compare ideas and make your case, then check on site.</p></details>
    <div class="dlg-acts" style="justify-content:flex-start;margin-top:14px"><button class="pbtn" id="h-tour">Show me around</button></div>`;
  function openHelp() {
    $("sheet-body").innerHTML = HELP_HTML;
    $("h-tour").onclick = () => { $("plan-sheet").close(); startTour(); };
    $("plan-sheet").showModal();
  }
  $("plan-help-btn").addEventListener("click", openHelp);
  $("sheet-close").addEventListener("click", () => $("plan-sheet").close());

  const TOUR = [
    { step: 1, sel: "#plan-steps", title: "Four steps", text: "These are your path: Goal, Changes, Results, Share. You can click any of them at any time." },
    { step: 2, sel: "#plan-tools", title: "Add things to the map", text: "Choose something, then click the map where it should go. You place one thing at a time; tick Keep adding to place several." },
    { step: 2, sel: "#plan-undo", title: "Nothing is permanent", text: "Made a mistake? Undo takes back the last change. Removing something also offers Undo." },
    { step: 2, sel: "#plan-strip", title: "The numbers that matter", text: "These update as you change things. A symbol and a word go with every colour, so you never have to guess." },
    { step: 2, sel: "#plan-ab", title: "Today or your plan", text: "Switch between the campus as it is and the campus with your changes, to see the difference." },
    { step: 2, sel: "#plan-help-btn", title: "Help is always here", text: "Help has a word list and a plain explanation of how accurate the numbers are." },
  ];
  let tourI = -1;
  function endTour() {
    const had = $("tour").contains(document.activeElement);
    tourI = -1;
    $("tour").hidden = true;
    if (had) $("plan-help-btn").focus();
    document.querySelectorAll(".tour-hl").forEach((e) => e.classList.remove("tour-hl"));
  }
  function startTour() { store.set("pantnagar-sandbox:seen", "1"); showStep(1, { focus: false }); tourStep(0); }
  function tourStep(i) {
    if (i < 0 || i >= TOUR.length) { endTour(); return; }
    tourI = i;
    const s = TOUR[i];
    if (s.step !== step) showStep(s.step, { focus: false });
    document.querySelectorAll(".tour-hl").forEach((e) => e.classList.remove("tour-hl"));
    const target = document.querySelector(s.sel);
    if (phone.matches) setPeek(false);
    if (target) { target.classList.add("tour-hl"); target.scrollIntoView({ block: "nearest" }); }
    const el = $("tour");
    el.innerHTML = `<div class="tl">Step ${i + 1} of ${TOUR.length}</div><b>${esc(s.title)}</b><p style="margin:0">${esc(s.text)}</p>
      <div class="t-acts"><button class="pbtn small" id="t-skip">Close</button><span>${i ? '<button class="pbtn small" id="t-back">‹ Back</button> ' : ""}<button class="pbtn small primary" id="t-next">${i === TOUR.length - 1 ? "Finish" : "Next ›"}</button></span></div>`;
    el.hidden = false;
    const r = target ? target.getBoundingClientRect() : { top: 100, right: 0 };
    if (phone.matches) { Object.assign(el.style, { left: "12px", right: "12px", width: "auto", top: "12px", bottom: "auto" }); }
    else { Object.assign(el.style, { left: Math.min(innerWidth - 340, $("plan").getBoundingClientRect().right + 16) + "px", top: Math.max(12, Math.min(innerHeight - 240, r.top)) + "px", width: "", right: "auto", bottom: "auto" }); }
    $("t-skip").onclick = endTour;
    if ($("t-back")) $("t-back").onclick = () => tourStep(i - 1);
    $("t-next").onclick = () => tourStep(i + 1);
    $("t-next").focus();
  }
  $("tour").addEventListener("keydown", (e) => { if (e.key === "Escape") { endTour(); e.stopPropagation(); } });
})();
