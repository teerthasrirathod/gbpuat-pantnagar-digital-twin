// Builds site/ for GitHub Pages: the campus twin with the Sandbox as the home page and the
// whole-area twin under /area/. The `pages` workflow runs this on every push to main and
// publishes site/ to the gh-pages branch. Run `twin bundle` first when building locally.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, "area"), { recursive: true });
fs.copyFileSync(path.join(root, "GBPUAT-Campus-3D.html"), path.join(site, "index.html"));
fs.copyFileSync(path.join(root, "GBPUAT-Pantnagar-Digital-Twin.html"), path.join(site, "area", "index.html"));
fs.writeFileSync(path.join(site, ".nojekyll"), "");
// the next-generation viewer (apps/web) goes under /next/ when it has been built (npm run build)
const next = path.join(root, "apps", "web", "dist");
if (fs.existsSync(path.join(next, "index.html"))) {
  fs.cpSync(next, path.join(site, "next"), { recursive: true });
  console.log("site/next/  the new viewer");
} else console.log("apps/web/dist not found: the new viewer is not included (run npm run build first)");
for (const f of ["index.html", "area/index.html"]) console.log(`site/${f}  ${(fs.statSync(path.join(site, f)).size / 1e6).toFixed(2)} MB`);
