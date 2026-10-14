// Bundle the whole viewer into ONE self-contained HTML file: GBPUAT-Pantnagar-Digital-Twin.html
// (page, styles, Three.js, data, satellite/land-cover textures and viewer code all inline).
// The result needs no server, no internet and no install - just open it in a browser.
//
// Usage: node tools/build_standalone.mjs   (run after tools/build_data.mjs)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "GBPUAT-Pantnagar-Digital-Twin.html");

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// Keep an inlined script from closing its own <script> tag or opening an HTML comment.
const safe = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

let inlined = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  inlined++;
  const js = fs.readFileSync(path.join(ROOT, src), "utf8");
  return `<script>/* ${src} */\n${safe(js)}\n</script>`;
});
if (inlined === 0) throw new Error("no <script src> tags found to inline");
if (/<script src=|<link [^>]*href=/.test(html)) throw new Error("external resources remain");

fs.writeFileSync(OUT, html);
console.log("inlined", inlined, "scripts ->", path.relative(ROOT, OUT), (fs.statSync(OUT).size / 1048576).toFixed(2), "MB");
