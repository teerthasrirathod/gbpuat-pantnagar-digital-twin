# GBPUAT Pantnagar - 3D digital twin

A lightweight, browser-based 3D digital twin of the **G.B. Pant University of Agriculture & Technology (GBPUAT)** campus and surroundings in Pantnagar, Udham Singh Nagar, Uttarakhand.

- Renders with **Three.js r160** (vendored, no build step, no server, works offline).
- Combines **OpenStreetMap**, **Overture Maps** (Google and Microsoft building footprints, places), **Google Open Buildings 2.5D** heights, **Sentinel-2** imagery, **ESA WorldCover**, **Meta/WRI** canopy height and **Copernicus** terrain.
- Low compute: chunked and instanced geometry with levels of detail, render on demand, adaptive resolution, no shadows or post-processing. About 8-10 ms per frame on an Intel UHD Graphics 600.

## Just want to run it?

1. Download **`GBPUAT-Pantnagar-Digital-Twin.html`** from the [latest release](https://github.com/teerthasrirathod/gbpuat-pantnagar-digital-twin/releases/latest) (about 5 MB).
2. Double-click it. It opens in your browser (Chrome, Edge, Firefox or Brave) and works offline. There is nothing to install.

## Pantnagar Sandbox: try changes before spending (new in v2.0)

Press **Plan** in the campus twin to change Pantnagar on its digital twin, see what works and what does not, and only then put a budget on it.

- **Design**: draw buildings, roads, paths and areas; change or demolish buildings; tag or remove trees; place Wi-Fi, street lights, cameras, bicycle docks, bins, water points, vending machines, rooftop solar and more. Create your own item types and categories.
- **Simulate** any combination of categories: Wi-Fi signal floor by floor (with automatic access-point placement), street lighting against IS 1944 (with a night view), walking access to amenities, routes, trees, solar, rainwater and runoff, and conflict checks.
- **What works**: every result against an editable target, with ✓ or ✗, including staying within the budget.
- **Budget**: quantities from the map, editable rates and upkeep, extra cost lines, contingency, taxes, a budget limit, running cost.
- **Scenarios**: keep several, duplicate and compare them; print a report; share as a GeoJSON file or a link.

The engine is Rust (`twin/sim`), compiled to WebAssembly for the page and also run as `twin sim <scenario.geojson>`. It works offline. Six sample scenarios live in [`scenarios/`](scenarios/README.md).

Guides:
- [docs/sandbox.md](docs/sandbox.md): how to use it, the models and their limits
- [docs/plan-format.md](docs/plan-format.md): the scenario file format
- [docs/add-value-proposal.md](docs/add-value-proposal.md): the ADD VALUE 2026 proposal for this project, with the roadmap to live traffic simulation
- [CONTRIBUTING.md](CONTRIBUTING.md): how to add scenarios, corrections and code

## Campus street-level twin (new, Rust + Three.js)

`GBPUAT-Campus-3D.html` is a second, detailed model of the campus itself: the census villages **Nagla (CT)** and **Phoolbag** (campus core, hostels, staff colonies, west campus and the airport, about 47 km²). It opens the same way (double-click, offline).

- **Every building, one by one.** OSM buildings, Google and Microsoft footprints, plus buildings that appear only in Google's 2023 building-presence raster. Each is modelled from its own footprint: walls with window bays per floor (floors from measured height), parapets, stair cabins and rooftop water tanks on flat roofs, gable roofs on sheds, and courtyards.
- **Building types.** Academic, hostel, staff quarters, houses, offices, health, school, shops, religious, sports, farm sheds, workshops. Each type is taken from OSM tags or names, from places inside the building, from land use, or estimated from size and shape. The card always says which.
- **Blocks.** The campus is split into blocks bounded by roads, the railway, the runway and mapped waterways. Each block lists:
  - its buildings by type
  - its footprint and floor area
  - its tree count and ground cover (built, trees, water, crops, bare)
  - road length by class
  - waterway length

  It also shows a satellite snapshot with every building outlined in its type colour.
- **Street view.** Press **Street view** (or `V`) and click a road. `↑`/`↓` move along the road network. At junctions, pick an arrow or use `←`/`→`. Drag to look around. **Free walk** lets you roam anywhere with `WASD` (buildings block you), and **Drive** moves at road speed, keeping left. A minimap shows where you are. On phones, pinch to zoom and press and hold the arrows to walk. Links such as `#view=x,z,distance,heading,tilt` or `#street=x,z,heading` open a specific spot.
- **Waterways.** OpenStreetMap has almost no canals or drains here (22 ponds and 1 stream). The twin adds open water detected in Sentinel-2 (MNDWI) and *modelled* drainage lines from the terrain (shown separately and labelled as modelled).

**What the campus model contains** (Nagla + Phoolbag window, built 2026-10-15)

| Item | Count / detail |
| --- | --- |
| Buildings | 10,845 in the window, 7,413 inside the two campus villages |
| ... by footprint source | OSM 57 · Google 7,424 · Microsoft 1,615 · found only in Google's 2023 presence raster 1,749 (mostly outside the earlier Overture extract) |
| ... with a measured height | 4,927 (Google 2.5D); the rest are tagged or estimated from size |
| Campus buildings by type | houses 3,484 · staff quarters 2,158 · farm sheds 737 · workshops/stores 233 · institutional 203 · academic 41 · schools 49 · shops 21 · hostels 16 · offices 9 · unclassified 452 |
| Roads inside the campus villages | 212 km: tracks 52, unclassified 58, residential 30, trunk 12.5, service 11.5, secondary 9, tertiary 8, paths 13.5, others |
| Street-view road graph | 5,550 nodes, 5,981 links |
| Water | 28 OSM ponds and tanks + 14 found in Sentinel-2; 5.4 km of mapped stream; 53 km of *modelled* drainage lines |
| Trees | 44,164 crowns with heights (Meta/WRI canopy, 2 m) |
| Blocks | 252: housing 111, fields/farm 70, mixed 27, wooded 22, open 14, academic/institutional 7, airport 1 |
| Terrain check | within 1 m of the AAI-surveyed runway thresholds and reference point |

Performance on the Intel UHD Graphics 600 at 1x (1024 x 768, best of three):
- whole campus 10.1 ms
- campus core 7.3 ms
- close aerial 8.7 ms
- street view 7.2 ms

Unlit ground and baked face lighting keep the cost of each pixel down. Detailed building and tree models are built only near the camera.

### The Rust pipeline (`twin/`)

All campus data is fetched and processed by a single Rust tool. It reads only the campus window from public cloud-optimised GeoTIFFs over HTTP range requests and caches what it downloads.

```bash
cd twin && cargo build --release
```

```bash
./twin/target/release/twin fetch all
```

```bash
./twin/target/release/twin build
```

```bash
./twin/target/release/twin sim-pack
```

```bash
./twin/target/release/twin bundle
```

| Step | Source | Output |
| --- | --- | --- |
| `fetch osm` | OpenStreetMap (Overpass) | `data/campus/osm.json` |
| `fetch dem` | Copernicus DEM GLO-30 | terrain (30 m), corrected for trees and buildings |
| `fetch s2` | Sentinel-2 L2A (Earth Search) | 3 m image, MNDWI water and NDVI greenness (10 m) |
| `fetch canopy` | Meta + WRI canopy height | 2 m canopy, tree crowns |
| `fetch heights` | Google Open Buildings 2.5D Temporal 2023 | 2 m building presence and height |
| `build` | all of the above + Overture + census villages | `campus/data/campus-data.js`, `campus/data/campus-imagery.js` |
| `sim-pack` | `twin/sim` engine (WebAssembly) + `scenarios/*.geojson` | `campus/js/sim-wasm.js`, `campus/data/scenarios.js` |
| `bundle` | campus viewer | `GBPUAT-Campus-3D.html` |
| `sim <scenario.geojson> [--json]` | a scenario file | today vs scenario summary (Markdown) or every number (JSON) |

Windows notes:
- The pipeline builds with the plain `x86_64-pc-windows-gnu` Rust toolchain (no Visual Studio).
- It downloads through the `curl.exe` that ships with Windows.
- `twin serve` is an optional development server.
- `sim-pack` needs the WebAssembly target once: `rustup target add wasm32-unknown-unknown`.

## Using it

- **Move:** drag to orbit (let go while moving to glide), right-drag or Shift-drag to pan, wheel to zoom toward the cursor, double-click to fly to a spot. Keys: arrows pan, `Q`/`E` rotate, `+`/`-` zoom, `R` resets, `/` searches, `?` shows help.
- **Inspect:** click any building, place or patch of ground. The card shows the name or type, height (and whether it was measured, mapped or estimated), footprint area, ground elevation and coordinates, with links to open the spot in Google Street View, Google Maps or OpenStreetMap.
- **Find:** search colleges, hostels (bhawans), banks, ATMs, temples and more; or use the **Explore** tab for the official colleges and facilities and places around campus.
- **Layers:** switch between the satellite and land-cover basemaps, toggle buildings, trees, water, roads, outlines and labels, and highlight buildings that appeared since 2016.
- **Map controls:** zoom, compass (click to face north), 3D / top-down, full screen, and a button that saves a picture of the current view. A scale bar and the coordinates under the cursor sit bottom-left.

`index.html` is the same viewer split into separate files and also opens directly from disk. A local web server is optional:

```bash
node tools/serve.mjs
```

## Data sources

| Layer | Source | Licence / attribution |
| --- | --- | --- |
| Mapped buildings, roads, land use, water, rail | OpenStreetMap via Overpass API (fetched 2026-10-14) | ODbL |
| Detected building footprints (22,262) | Overture Maps release 2026-09-23.1: Google Open Buildings 17,215, Microsoft ML 5,047 | ODbL / CDLA-Permissive-2.0 |
| Building heights and change since 2016 | Google Open Buildings 2.5D Temporal v1, 2023 and 2016 layers (4 m effective), public GCS bucket, no account needed | CC BY 4.0 or ODbL |
| Points of interest (154) | OpenStreetMap plus Overture Maps places (150 added, 15 duplicates of OSM dropped) | ODbL / CDLA-Permissive-2.0 |
| Satellite image (also tints roofs) | Sentinel-2 L2A, scene S2C_44RLT_20251211_0_L2A (2025-12-11, 0.00001% cloud), 10 m, via Earth Search / AWS; Lanczos-upsampled to 3072 px and lightly sharpened | Contains modified Copernicus Sentinel data |
| Land cover | ESA WorldCover 2021 v200, 10 m | CC BY 4.0 |
| Trees | Meta + WRI high-resolution canopy height (about 1.2 m), crowns found as local maxima | CC BY 4.0 |
| Terrain | Copernicus DEM GLO-30 (30 m), averaged to a 100 m grid, canopy-corrected | Copernicus: free, full and open |
| Official place names | GBPUAT website (colleges, library, hospital, etc.), matched to map features | Names only |
| Viewer | Three.js r160 | MIT (`vendor/THREE-LICENSE.txt`) |

**Google Maps Platform is not used as a data source.** Its content (satellite tiles, Street View, Places, elevation) may not be stored or used offline under Google's terms, and using it live would mean shipping an API key inside a public file. The model links out to Google Maps and Street View instead (free, no key). A single-date Sentinel-2 image was chosen over a five-scene median composite after comparing both: the median looked softer and muddier.

## What the model contains

| Item | Count / detail |
| --- | --- |
| Mapped buildings (OSM, true footprints) | 153 |
| Detected buildings (true footprints, about 4-5 corners each) | 22,262 |
| Heights measured by Open Buildings 2.5D | 12,857 detected + 102 mapped buildings; 1 mapped building has a height tag; the rest are estimated |
| Buildings that appear since 2016 | 3,059 (3,047 detected + 12 mapped) |
| Trees with measured crowns and heights | 20,548 shown of 86,165 detected (every crown within 2.2 km of the campus core) |
| Points of interest | 154 (4 OSM + 150 Overture) |
| Official places located on the map | 32 (7 of 8 colleges, facilities, hostels and bhawans) |
| Land-use areas / road segments | 112 / 1,481 (about 454 km) |
| Terrain | 118 x 89 grid at 100 m; 213.5 m to 268.1 m above sea level |

### How it stays light

- **Chunks and distance limits.** Detected buildings are merged into 600 m chunks that are skipped beyond 2.6 km from the camera.
- **Tree levels of detail.** Trees are instanced in 800 m chunks: a 26-triangle tree with trunk near the camera, an 8-triangle crown further away, nothing beyond 7.5 km.
- **Eased camera.** Input moves a goal and the view eases toward it, with a glide after a fling.
- **Adaptive resolution.** While moving, the render scale adapts (0.45x-1.25x) to hold the frame rate. When the camera stops, one frame is drawn supersampled for sharp, anti-aliased stills. MSAA and logarithmic depth are off.
- **Render on demand.** Nothing is drawn while the view is still.

Measured on this PC's Intel UHD Graphics 600 (best of three pipelined runs at 1x): 9.6 ms per frame for the whole area, 7.6 ms at the campus core and 8.0 ms close up, with about 190k-210k triangles and 30-50 draw calls. The page loads in about 2 seconds.

## Rebuild the data

Raw extracts are in `data/raw/`. The Python tools need a virtual environment with `tools/requirements.txt`; the Node tools need nothing extra. Run from the project root:

```bash
python -m venv .venv && .venv/Scripts/pip install -r tools/requirements.txt
```

```bash
node tools/fetch_osm.mjs
```

```bash
.venv/Scripts/python tools/fetch_buildings.py
```

```bash
.venv/Scripts/python tools/fetch_places.py
```

```bash
.venv/Scripts/python tools/fetch_building_heights.py
```

```bash
.venv/Scripts/python tools/fetch_building_heights.py --year 2016
```

```bash
.venv/Scripts/python tools/fetch_canopy.py
```

```bash
.venv/Scripts/python tools/fetch_elevation.py --canopy-k 0.5
```

```bash
.venv/Scripts/python tools/fetch_landcover.py
```

```bash
.venv/Scripts/python tools/fetch_imagery.py --scene S2C_44RLT_20251211_0_L2A --width 3072
```

```bash
node tools/build_data.mjs
```

```bash
node tools/build_standalone.mjs
```

`fetch_canopy.py` must run before `fetch_elevation.py` (it supplies the canopy correction). `fetch_imagery.py --list` shows other clear scenes and `--composite N` makes a median of the N clearest dry-season scenes. `build_standalone.mjs` regenerates the single-file HTML. The study window and grid spacing live in `tools/region.json`.

## Project layout

| Path | What it is |
| --- | --- |
| `GBPUAT-Campus-3D.html` | Generated single-file campus street-level twin; just open it |
| `campus/` | Campus viewer: `index.html`, `js/campus.js` (buildings, street view, blocks), `data/*.js` from `twin build` |
| `twin/` | Rust pipeline: fetch (COG range reads, Overpass), analysis (buildings, types, blocks, water, trees, road graph), bundle, dev server |
| `twin/sim/` | Sandbox engine (Rust): scenario format, catalogue and rates, custom item types, Wi-Fi, lighting, access, routes, budget, green metrics |
| `twin/sim-wasm/` | WebAssembly exports of the engine for the page |
| `campus/js/plan.js` | Plan mode: scenarios, design tools, items in 3D, category simulation and targets, budget, item types, report, share links |
| `scenarios/` | Sample scenarios (GeoJSON) |
| `docs/` | Sandbox guide, scenario format, ADD VALUE proposal, research notes |
| `.github/workflows/sandbox.yml` | Evaluates plans submitted by pull request |
| `data/campus/osm.json` | OSM extract for the campus window (Overpass) |
| `data/raw/village_boundaries.json` | Census 2011 village boundaries (Uttarakhand State GIS Portal) |
| `data/raw/aai_vipt.json` | AAI eAIP Pantnagar airport data (runway, apron, navaids, 124 surveyed obstacles) |
| `GBPUAT-Pantnagar-Digital-Twin.html` | Generated single-file version of the whole-area twin below; just open it |
| `index.html` | Page shell: panel, map controls, info card, styles |
| `js/viewer.js` | Scene build, camera, picking, search, labels, render loop |
| `data/campus-data.js` | Generated: buildings, detected footprints, trees, areas, roads, places, labels, terrain |
| `data/imagery.js` | Generated: satellite and land-cover textures as data URIs |
| `data/raw/` | Raw extracts from every source |
| `tools/region.json` | Study window, origin and grid spacing (single source of truth) |
| `tools/fetch_*.mjs`, `tools/fetch_*.py` | One fetcher per source |
| `tools/official_places.json` | Official names and the patterns used to place them |
| `tools/build_data.mjs` | Clips, merges, de-duplicates and packs everything for the viewer |
| `tools/build_standalone.mjs` | Inlines everything into the single HTML file |
| `tools/serve.mjs` | Optional tiny static server |

Coordinates: x = east, z = south, y = up, in metres from the campus centre (29.0205 N, 79.4935 E). Study window: lat 28.99 to 29.07, lon 79.44 to 79.56, about 11.7 x 8.9 km (104 km²).

## Accuracy and limits

1. **Not the official boundary.** The university states the campus is "16,000 acres, contiguous" (about 65 km²) with nearly 6,000 acres of farm. No boundary file is published or mapped, so the model covers a fixed window. The yellow outlines show only the campus and farm polygons mapped in OSM.
2. **The satellite image is 10 m.** Fields, roads, tree cover and the campus layout are clear; small buildings are blurred. It shows one date (2025-12-11).
3. **Detected buildings are machine-made.** Footprints come from satellite images and can be wrong, merged or missing. Shapes are simplified to their main corners. Where Open Buildings 2.5D has no height, the height is guessed from footprint area.
4. **"New since 2016" is indicative.** It compares the 2016 and 2023 Open Buildings layers, and the 2016 layer is less complete, so some older buildings may be flagged.
5. **Trees come from a canopy model**, so positions and heights are measured, but shapes are generic (narrow for tall trees, wide for short ones).
6. **Street View links** open Google Maps online; coverage inside the campus may be limited.
7. **Not survey-grade.** For visualisation and planning discussions only.

## Next steps

- Google Dynamic World land cover via Earth Engine, once the Earth Engine project is registered (more recent than WorldCover 2021).
- An official campus boundary and building list from the GBPUAT estate or works office would replace the estimated parts.
