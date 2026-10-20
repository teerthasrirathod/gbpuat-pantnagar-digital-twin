// Minimal headless-Chrome driver over the DevTools protocol (no dependencies).
// node cdp.mjs <url> <steps.js> [outPrefix] [width] [height]
// steps.js exports an array of { js?: string, shot?: name, wait?: ms } run in order.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [url, stepsFile, outPrefix = "shot", W = "1400", Hh = "900"] = process.argv.slice(2);
const chrome = process.env.BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const userDir = path.join(process.env.TEMP, "cdp-profile-" + Date.now());
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, `--window-size=${W},${Hh}`, ...(process.env.GPU ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]), "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const logs = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return; }
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("chrome did not start");
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
async function main() {
  await connect();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.type + ": " + d.params.args.map((a) => a.value !== undefined ? a.value : a.description || "").join(" "));
    else if (d.method === "Runtime.exceptionThrown") logs.push("EXCEPTION: " + (d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text));
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +Hh, deviceScaleFactor: 1, mobile: +W < 700 });
  await send("Page.navigate", { url });
  const steps = (await import("file://" + path.resolve(stepsFile).replace(/\\/g, "/"))).default;
  for (const s of steps) {
    if (s.wait) await sleep(s.wait);
    if (s.js) {
      const r = await send("Runtime.evaluate", { expression: `(async () => { ${s.js} })()`, awaitPromise: true, returnByValue: true, timeout: 600000 });
      if (r.exceptionDetails) console.log("step error:", r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      else if (s.save && r.result) { fs.writeFileSync(s.save, typeof r.result.value === "string" ? r.result.value : JSON.stringify(r.result.value, null, 1)); console.log("wrote", s.save); }
      else if (r.result && r.result.value !== undefined) console.log(JSON.stringify(r.result.value, null, 1));
    }
    // real input: { click: [x, y] }, { rclick: [x, y] }, { drag: [x0, y0, x1, y1] }, { keys: ["w", ...], hold: ms }, { type: "text" }
    if (s.click || s.rclick) {
      const [x, y] = s.click || s.rclick, button = s.rclick ? "right" : "left";
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
    }
    if (s.drag) {
      const [x0, y0, x1, y1] = s.drag;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1 });
      for (let i = 1; i <= 8; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, button: "left", buttons: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1 });
    }
    if (s.keys) {
      const names = { Enter: ["Enter", 13], " ": ["Space", 32], Escape: ["Escape", 27], Delete: ["Delete", 46], Tab: ["Tab", 9] };
      for (const k of s.keys) {
        const [code, vk] = names[k] || [k.length === 1 ? "Key" + k.toUpperCase() : k, k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0];
        const mod = (s.ctrl ? 2 : 0) | (s.shift ? 8 : 0);
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mod, text: k.length === 1 && !s.ctrl ? k : undefined });
        if (s.hold) await sleep(s.hold);
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mod });
      }
    }
    if (s.type) await send("Input.insertText", { text: s.type });
    if (s.shot) {
      let opt = { format: "png" };
      if (s.full) { const m = await send("Page.getLayoutMetrics"); const c = m.cssContentSize || m.contentSize; opt = { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: c.width, height: Math.min(c.height, 6000), scale: 1 } }; }
      const r = await send("Page.captureScreenshot", opt);
      const f = `${outPrefix}-${s.shot}.png`;
      fs.writeFileSync(f, Buffer.from(r.data, "base64"));
      console.log("saved", f);
    }
  }
  console.log("--- console ---\n" + logs.filter((l) => !/deprecated/.test(l)).slice(-40).join("\n"));
}
main().catch((e) => console.error(e)).finally(() => { try { ws && ws.close(); } catch (e) {} proc.kill(); setTimeout(() => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {} process.exit(0); }, 500); });
