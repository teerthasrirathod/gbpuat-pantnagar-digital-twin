# Dev drivers

Small, dependency-free helpers for looking at the new web app (apps/web) on the real GPU. Playwright (in `e2e/`) is for tests; these are for quick looks and GPU timings.

- `cdp.mjs <url> <steps.mjs> [prefix] [width] [height]` drives headless Chrome or Brave over the DevTools protocol. A steps file exports an array of `{ js }` (run in the page, result printed) and `{ shot: "name" }` (saves `<prefix>-<name>.png`). Set `BROWSER` to the browser and `GPU=1` to use the real GPU (without it, SwiftShader is used and timings mean nothing).
- `shoot.sh <url> <steps.mjs> <prefix> [w] [h]` runs `cdp.mjs` with Brave on the real GPU and retries when Vite reloads the page in the middle of a run (it does that after the first edit that adds a dependency).
- The app exposes `window.__hero` for these scripts: `setTime(utcMs)`, `setMode("street"|"orbit")`, `street.pose`, `orbit`, `pipeline.setQuality("off"|"medium"|"high")`, `atm`, `props`, `grass`, `scene`. Open the app with `#perf` to see GPU milliseconds in the HUD (needs timestamp queries; on WebGL2 it shows 0).

Example: set 21:00 IST, look at the Library, take a picture.

    export default [
      { js: 'for (let i = 0; i < 400 && !window.__hero; i++) await new Promise(r => setTimeout(r, 250))' },
      { js: 'const h = window.__hero; const d = new Date(); h.setTime(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 21) - 5.5 * 3600000); await new Promise(r => setTimeout(r, 8000))' },
      { shot: 'night' },
    ];

## Journeys for the classic viewer's planning panel

`plan1.mjs` to `plan9.mjs` drive Plan mode ("Try an idea") in the classic viewer on the real GPU. Serve the repository (`twin serve 8090`, or any static server at the repository root) and run, for example:

    bash shoot.sh http://127.0.0.1:8090/campus/ plan1.mjs plan1 1366 768
    bash shoot.sh file:///C:/Pantnagar/GBPUAT-Campus-3D.html plan1.mjs bundle1 1366 768    # the single-file build

| File | What it walks through |
| --- | --- |
| `plan1.mjs` | first run: goal, quick start (Wi-Fi in every hostel), results |
| `plan2.mjs` | placing one thing, Undo from the message, Keep adding, a drawn building, Enter at the cross |
| `plan3.mjs` | results, share, help, tour and display settings on a 1366 x 768 laptop |
| `plan4.mjs` | phone width (run at 390 x 844): the bottom sheet |
| `plan5.mjs` | dark theme and stronger contrast |
| `plan6.mjs` | plans: switching, deleting with the dialog, the share-link round trip, comparing |
| `plan7.mjs` | warnings produced by the rainwater quick start (a diagnostic) |
| `plan8.mjs` | keyboard-only drawing at the cross, light a whole road, the Move tool |
| `plan9.mjs` | automated contrast audit of every visible text in the panel, in light, dark and stronger contrast |

`cdp.mjs` also accepts real input steps: `{ click: [x, y] }`, `{ rclick: [x, y] }`, `{ drag: [x0, y0, x1, y1] }`, `{ keys: ["w"], hold: ms, ctrl, shift }` and `{ type: "text" }`. Screenshots land next to the script and are git-ignored.
