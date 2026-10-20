# Pro-quality plan: hero area first, infrastructure underneath

Written 2026-10-19 from four research reports (architecture, street-level techniques and assets, libraries, hero-area data) plus my own registry checks. The owner's direction: pro-level quality, the latest libraries everywhere, the whole codebase treated as infrastructure, and **quality over quantity**, which means a small hero area built to a very high standard instead of the whole 9.6 x 7.8 km window.

## Decisions

1. **Hero area first.** Hero 1 is a 500 m window centred at local (-400, -300), about 29.0232 N, 79.4894 E. It holds the Pantnagar University Library, the Old College of Technology, the College of Technology, the College of Basic Sciences and Humanities, three bank branches, the Plant Genetic Resources centre, the main avenue, the Convocation Ground, 21 lawn polygons and two fountains. It has 106 buildings, 8 named landmarks and the cleanest geometry. Hero 2 (later) is the fish-pond and farm edge around (1700, 400) for a contrasting scene. The density-only winner (780 houses, none named) was rejected: there is nothing to model by hand there.
2. **Strangler migration.** A new app in `apps/web` (Vite 8, TypeScript 7, three.js 0.186.1 with the WebGPU renderer and an automatic WebGL2 fallback, TSL materials) grows beside the current site. The current viewer, the Sandbox and the Light and Balanced tiers stay untouched and live until the new app has parity. The new app is served at `/next/`.
3. **Data stays honest.** The new app starts from the same data (`campus/data`), cut to the hero window by a script. Heights are Google 2.5D (about 4 m accuracy) or estimates, and many types are guesses; the new app shows the evidence just like the current one.
4. **Procedural first, real textures by permission.** Materials are painted in code now. Poly Haven and ambientCG CC0 textures need a download: I will ask with exact names, sizes and sources before fetching anything.
5. **No capture assumptions.** The owner can supply a photo survey of facade bays, leaves, signs and water tanks; the assistant cannot take photos. Drone flights near the campus airstrip need permission, so none are planned.

## Stack (versions checked against the npm registry on 2026-10-19)

| Area | Pick | Notes |
| --- | --- | --- |
| 3D | three 0.186.1 (r186, 2026-09-24), @types/three 0.186.0 | Pin exactly; TSL and the render pipeline are still renamed between releases. |
| Build | Vite 8.3.4, Node 24 | Rolldown and Oxc inside Vite. |
| Language | TypeScript 7.0.2 | Native compiler for `tsc --noEmit`. No programmatic API until 7.1, so typescript-eslint is out; Biome does the linting. |
| Lint and format | Biome 2.5.15 | |
| Tests | Vitest 5.0.5, Playwright 1.64.1 | Playwright drives the Chrome and Brave already installed; no browser download. |
| Package manager | pnpm | |
| Meshes and textures (later) | gltf-transform 4.5.1, meshoptimizer 1.3.0, KTX2 | For the hero assets. |
| Do not use | EffectComposer, pmndrs/postprocessing and takram clouds on the WebGPU renderer; GLSL `ShaderMaterial` or `onBeforeCompile` on it (port to TSL); `PCFSoftShadowMap` (removed in r186); anything under 7 days old. | |

## What makes the street view look pro (ranked, from the research)

1. Sun with cascaded shadows, a physical sky, sky light, AgX or Neutral tone mapping, a colour grade and haze.
2. Temporal anti-aliasing (stops leaf and grille shimmer).
3. Baked ambient occlusion on the hero meshes plus half-resolution live ambient occlusion for contacts.
4. **Real geometry on facades**: recessed windows, sunshades (chhajjas), parapets, jaali, grilles, AC units, water tanks, stair-head rooms, pipes, from a split-and-repeat facade grammar (written in TypeScript first, moved to Rust later) with hand-built landmarks.
5. PBR materials with macro variation and weathering (no visible tiling).
6. Ground contact: kerbs, drains, road markings, cracks, wetness tied to the live weather.
7. Species-accurate trees with wind, grass, undergrowth.
8. Aerial perspective and Terai winter fog.
9. Life: autos, scooters, buses, people, cattle, birds.
10. Reflections only for wet roads and glass.
Skip: global illumination, depth of field, motion blur, Gaussian splats (they cannot be relit under a dynamic sun).

Licensing traps: Quaternius packs are no longer plain CC0 (a 2026 licence forbids redistributing them as standalone items); Poly Pizza forbids ML use; Mixamo, Fab, BlenderKit and CGTrader files must not go in a public repository; the CGAL straight skeleton is GPL; Mapillary and KartaView are CC BY-SA (reference only). Record every asset's licence and download date. There are no free Indian auto-rickshaw, bus or tractor models; they will be modelled.

## Infrastructure (from the architecture plan)

- One Vite app, folders not packages: `apps/web/src/{core,data,lod,scene,render,nav,weather,ui,app}`, `crates/` later, `e2e/`, `scripts/`.
- Layers: data (tiles, decode), lod (what to load), scene (turns data into render-agnostic drawables and material slots), render (the backend owns GPU resources, sky, shadows, post, quality), nav (cameras, input, picking). Only `render`, `scene` and `nav` import three.
- Quality tiers are data, not code branches. A short frame-time test picks the tier (Brave hides GPU names).
- Tests: unit tests for geometry and data, golden screenshots from fixed camera poses (hash links), performance budgets (triangles, draw calls, download size) in CI. Frame time is judged on a real GPU only.
- CI: lint, typecheck, unit, build, end-to-end, size budget; deploy keeps the current site and adds `/next/`.
- Later: binary data tiles instead of JS globals, KTX2 imagery, a Rust facade grammar, a Svelte or Preact UI, a service worker for offline.

## Staged work

| Stage | What | Visible result |
| --- | --- | --- |
| A | Foundation: pnpm, Vite, TypeScript, Biome, Vitest, Playwright, CI; hero data export; first hero scene on WebGPU (terrain, roads, extruded buildings, trees, sky, sun shadows, street and orbit cameras) | The Library avenue in the new renderer, side by side with today's |
| B | Image quality stack: tone mapping, TAA, ambient occlusion, haze, bloom, weather hook | Same view, but looks lit and grounded |
| C | Facade grammar and roofs: depth, trim, weathering, rooftop clutter | Buildings stop looking like boxes |
| D | Landmarks: Library, Old College of Technology, College of Technology, Basic Sciences, banks | Hand-built hero buildings |
| E | Ground and vegetation: lawns, paths, kerbs, markings, species trees, grass, planting | The avenue looks alive |
| F | Props and life: lamps, benches, signs, tanks, autos, scooters, people | Scale and activity |
| G | Port the weather and the Sandbox overlays, the quality governor, the offline build | Parity with the current viewer |
| H | Hero 2 (ponds and farm edge), then flip `/next/` to `/` | |

## Status (2026-10-19, end of the first build day)

Built and working in `apps/web` (run with `npm run dev`, open `/#street=-524,-83,-1.22`; add `#perf` for GPU timings, `#q=off|medium|high` to pick the image pipeline, `#t=17.6` for a time of day in IST):

- **A, foundation**: npm workspaces, Vite 8, TypeScript 7 (strict), Biome, Vitest (23 tests: geometry, sun, moon, hero data), hero data export, WebGPU renderer with WebGL2 fallback.
- **B, image quality**: render pipeline with GTAO (half resolution), temporal anti-aliasing, bloom (sky masked out), light grade; cascaded sun shadows (4 x 1024); the sky and clouds baked into a cube map and refreshed slowly; AgX tone mapping with exposure that adapts from noon to night.
- **C, facades**: windows recessed with true parallax, frame, mullions, grilles, and a furnished room behind the glass (interior mapping); sun self-shadowing inside the recess; real projecting sunshades, cornice, coping and plinth; three window styles per building; lit rooms at night. The masks come from a small baked atlas, the noise from baked textures.
- **E, ground and vegetation**: ground drawn from baked noise (soil with pebbles and cracks, lawn, asphalt with aggregate and dusty edges, paving, concrete); wandering mask edges; real grass tufts around the camera, placed in the vertex shader; six illustrative tree species with painted leaf atlases and wind.
- **F, props and life**: lamp posts, benches, bins, parked cars and bicycle clusters on the hard ground, moving traffic (cars, motorbikes with riders, e-rickshaws), walking people. All of it is seeded scene dressing, not data.
- **Night**: a real moon (position and phase), about 65 catalogue stars plus a Milky Way band turning with sidereal time, moonlight, night ambient, lamps and lit windows.

Measured on the Intel UHD 600 development laptop (1280 x 760, GPU timestamps): about 200 to 450 ms per frame for the full scene, of which post-processing is roughly a third and shadows a quarter. That machine is roughly a tenth of a base M1; a quality governor (dynamic resolution, tier step-down) is the next performance task, and nothing here has been timed on an M1 yet.

Added later the same day: a far-ground skirt out to a hazy horizon (fog colour read from the baked sky so they meet without a seam); the interface (time-of-day dock with sunrise and sunset marks, playback and "now", view and quality controls, picture button, help sheet that separates data from illustration, click-to-inspect building cards with data provenance and a glowing outline); the weather port (six Open-Meteo points interpolated in time and place; clouds, an overcast sky layer, fog from visibility, dimmed sun, wet ground with puddles, wind, rain streaks; a weather card with live and preview modes); a resolution governor; Playwright smoke test and the `web` CI workflow (lint, types, 45 unit tests, build, size budget, browser test).

Also done: name boards on the named buildings (real names from the data, illustrative boards), tree level of detail, a guided tour (G), a minimap that teleports, a touch joystick, a staged loading screen, and `docs/architecture.md`.

Still to do: D (hand-built landmarks), the far ground and horizon beyond the hero window (the terrain currently ends in a square), G (weather port, Sandbox overlays, governor, UI, offline build), H (Hero 2), CI and golden screenshots, LOD for far trees and buildings.

## Owner tasks that unblock quality

- A photo survey of the hero area: facade bays and window details for each landmark, leaves of 6 to 8 tree species on a white sheet, signboards, water tanks, bus stops, lamp posts.
- Confirm or correct the data gaps listed for the hero window: 59 of 106 buildings have no measured height, and 98 are unnamed.
- Approve downloads of CC0 textures when I list them.
- Decide later: Svelte or Preact for the UI, and a self-hosted GPU test runner on your laptop.

## Risks

- The WebGPU renderer's WebGL2 fallback may be slower than the old renderer on weak GPUs, so the old renderer stays for them.
- three.js renames shader-node APIs between releases; pin exactly and migrate one release at a time.
- No M1 and no real-GPU CI: frame times are estimates until someone runs the benchmark on an M1.
- The hero data is only as good as its footprints (Google 2.5D), so landmark buildings are corrected by hand against photos.
