# GBPUAT Pantnagar - 3D digital twin

A lightweight, browser-based 3D digital twin of the **G.B. Pant University of Agriculture & Technology (GBPUAT)** campus and surroundings in Pantnagar, Udham Singh Nagar, Uttarakhand.

- Renders with **Three.js r160** (vendored, no build step, no server, works offline).
- Combines **OpenStreetMap**, **Overture Maps** (Google and Microsoft building footprints, places), **Google Open Buildings 2.5D** heights, **Sentinel-2** imagery, **ESA WorldCover**, **Meta/WRI** canopy height and **Copernicus** terrain.
- Low compute: chunked and instanced geometry with levels of detail, render on demand, adaptive resolution, no shadows or post-processing. About 8-10 ms per frame on an Intel UHD Graphics 600.

## Just want to run it?

1. Download **`GBPUAT-Pantnagar-Digital-Twin.html`** from the [latest release](https://github.com/teerthasrirathod/gbpuat-pantnagar-digital-twin/releases/latest) (about 5 MB).
2. Double-click it. It opens in your browser (Chrome, Edge, Firefox or Brave) and works offline. There is nothing to install.

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
| `GBPUAT-Pantnagar-Digital-Twin.html` | Generated single-file version of everything below; just open it |
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
