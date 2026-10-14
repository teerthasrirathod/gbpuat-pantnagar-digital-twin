# GBPUAT Pantnagar - 3D digital twin

A lightweight, browser-based 3D digital twin of the **G.B. Pant University of Agriculture & Technology (GBPUAT)** campus and surroundings in Pantnagar, Udham Singh Nagar, Uttarakhand.

- Renders with **Three.js r160** (vendored, no build step, no server GPU).
- Combines **OpenStreetMap**, **Overture / Google / Microsoft building footprints**, **Sentinel-2 satellite imagery**, **ESA WorldCover**, **Meta/WRI canopy height** and **Copernicus terrain**.
- Low compute: merged and instanced geometry, on-demand rendering, distance culling, no shadows or post-processing.

## Just want to run it?

1. Download **`GBPUAT-Pantnagar-Digital-Twin.html`** from the [latest release](https://github.com/teerthasrirathod/gbpuat-pantnagar-digital-twin/releases/latest) (about 4 MB).
2. Double-click it. It opens in your browser (Chrome, Edge, Firefox or Brave) and works offline. There is nothing to install.

## Open it (browser only)

Double-click **`GBPUAT-Pantnagar-Digital-Twin.html`**. It is a single 3.8 MB file that holds the page, Three.js, all data and the satellite image, so it needs no server, no install and no internet. You can move it, email it or put it on a USB stick. It was tested by loading it from an otherwise empty folder in Chrome.

`index.html` is the same viewer split into separate files and also opens directly from disk. Only if you want a local web server instead:

```bash
node tools/serve.mjs
```

Controls: drag to orbit (release while moving to glide), right-drag or Shift-drag to pan, wheel to zoom toward the cursor, double-click to fly to a spot, arrow keys to pan, `Q`/`E` to rotate, `+`/`-` to zoom, `R` to reset. Use the **Basemap** switch (Satellite / Land-cover map), the **Official places** list (names from gbpuat.ac.in), the search box, and the layer toggles.

## Data sources

| Layer | Source | Licence / attribution |
| --- | --- | --- |
| Mapped buildings, roads, land use, water, rail, POIs | OpenStreetMap via Overpass API (fetched 2026-10-14) | ODbL |
| Building heights | Google Open Buildings 2.5D Temporal v1, 2023 layer (4 m effective), public GCS bucket, no account needed | CC BY 4.0 or ODbL |
| Extra building footprints (22,262 kept) | Overture Maps release 2026-09-23.1 (Google Open Buildings 17,215, Microsoft ML 5,047) | ODbL / CDLA-Permissive-2.0 |
| Satellite image (also used to tint roofs) | Sentinel-2 L2A, scene S2C_44RLT_20251211_0_L2A (2025-12-11, 0.00001% cloud), 10 m, via Earth Search / AWS; Lanczos-upsampled to 3072 px and lightly sharpened | Contains modified Copernicus Sentinel data (free, full and open) |
| Land cover | ESA WorldCover 2021 v200, 10 m | CC BY 4.0 |
| Trees | Meta + WRI high-resolution canopy height (about 1.2 m), crowns found as local maxima | CC BY 4.0 |
| Terrain | Copernicus DEM GLO-30 (30 m), averaged to a 100 m grid, canopy-corrected | Copernicus: free, full and open |
| Place names | Official GBPUAT website (colleges, library, hospital, etc.), matched to OSM features | Names only |
| Viewer | Three.js r160 | MIT (`vendor/THREE-LICENSE.txt`) |

Google Maps was not used as a data source: its tiles and building data cannot be downloaded into a model under its terms. The Google Open Buildings footprints used here are the open dataset distributed through Overture.

## What the model contains

| Item | Count / detail |
| --- | --- |
| Mapped buildings (OSM, extruded footprints) | 153 (cross-check: Overture holds the same 153 OSM buildings) |
| Detected buildings (ML, oriented boxes) | 22,262 (2,504 dropped as overlapping OSM, 623 as under 12 m²) |
| Measured heights (Open Buildings 2.5D) | 12,857 of 22,262 detected buildings and 102 of 153 OSM buildings (1 OSM building has a mapped height); the rest use size-based guesses |
| Roof colours sampled from the satellite image | 14,388 buildings (8,027 samples rejected as tree-covered) |
| Trees (real crowns from canopy data) | 10,000 shown, from 86,165 detected; 7,000 near the campus core, 3,000 elsewhere |
| Land-use areas / road segments | 112 / 1,481 (about 454 km) |
| Terrain | 118 x 89 grid at 100 m; 213.5 m to 268.1 m above sea level after canopy correction |
| Official places located on the map | 29 (7 of 8 colleges, 8 facilities, 14 hostels/bhawans) |

Performance, measured on this PC's Intel UHD Graphics 600 (an entry-level integrated GPU): the campus core view costs about 10.6 ms of GPU time per frame at 1x resolution (pipelined benchmark; a bare clear is 1.6 ms), so about 60 fps is achievable. About 170k-210k triangles and 9-29 draw calls are on screen depending on the view.

How it stays smooth on weak GPUs:

- **Eased camera.** Input moves a goal and the view eases toward it, with a short glide after a fling, zoom toward the cursor and soft fly-tos.
- **Adaptive resolution.** While moving, the render scale adapts (0.45x-1.25x) to hold the frame rate; when the camera stops, one frame is drawn supersampled (up to 2x) for sharp, anti-aliased stills. MSAA and logarithmic depth are off because both are expensive on integrated GPUs.
- **Render on demand.** Nothing is drawn while the view is still, so idle GPU use is zero.
- **Culling and instancing.** Detected buildings are instanced boxes in 600 m chunks, skipped beyond 3.2 km from the camera. Trees are one instanced mesh of 8-triangle crowns.
- **Cheap realism.** Wall bases are darkened (fake ambient occlusion), roofs take their tone from the satellite image, trees vary in yaw, size and shade, and a CSS sky gradient sits behind the canvas.

## Rebuild the data

Raw extracts are in `data/raw/`. To refresh everything, run these from the project root. The Python tools need a virtual environment with `tools/requirements.txt`; the Node tools need nothing extra.

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
.venv/Scripts/python tools/fetch_building_heights.py
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
.venv/Scripts/python tools/fetch_imagery.py --scene S2C_44RLT_20251211_0_L2A
```

```bash
node tools/build_data.mjs
```

```bash
node tools/build_standalone.mjs
```

`build_standalone.mjs` regenerates the single-file HTML from the latest data. `fetch_canopy.py` must run before `fetch_elevation.py` (it supplies the canopy correction). `fetch_imagery.py --list` shows other clear scenes; Oct-Jan scenes are the clearest. The study window and grid spacing live in `tools/region.json`.

## Project layout

| Path | What it is |
| --- | --- |
| `GBPUAT-Pantnagar-Digital-Twin.html` | Generated single-file version of everything below; just open it |
| `index.html` | Page shell, panel, legend, styles |
| `js/viewer.js` | Scene build (terrain, basemaps, buildings, land use, roads, trees, labels), camera, search, places |
| `data/campus-data.js` | Generated: buildings, ML boxes, trees, areas, roads, places, labels, terrain grid |
| `data/imagery.js` | Generated: satellite and land-cover textures as data URIs |
| `data/imagery/` | `satellite.jpg` and its metadata |
| `data/raw/` | Raw OSM tiles, Overture buildings, WorldCover, canopy, elevation |
| `tools/region.json` | Study window, origin and grid spacing (single source of truth) |
| `tools/geo.mjs` | Shared local coordinate frame and elevation grid |
| `tools/fetch_*.mjs` / `fetch_*.py` | Data fetchers (one per source) |
| `tools/official_places.json` | Official names and the OSM patterns used to place them |
| `tools/build_data.mjs` | Clips, merges, de-duplicates and packs everything for the viewer |
| `tools/build_standalone.mjs` | Inlines everything into the single HTML file |
| `tools/serve.mjs` | Optional tiny static server (no dependencies) |
| `vendor/three.min.js` | Three.js r160 classic build |

Coordinates: x = east, z = south, y = up, in metres from the campus centre (29.0205 N, 79.4935 E). Study window: lat 28.99 to 29.07, lon 79.44 to 79.56, about 11.7 x 8.9 km (104 km²).

## Accuracy and limits (read before relying on it)

1. **Not the official boundary.** The university states the campus is "16,000 acres, contiguous" (about 65 km²) and the University Farm "nearly 6,000 acres" (about 24 km²). No boundary file is published or in OSM, so the model covers a fixed window. The yellow outlines show only the campus and farm polygons that OSM has mapped, which is a small part of the official area. A boundary file (KMZ or shapefile) from the university would let the model be clipped exactly.
2. **Satellite image is 10 m.** It shows fields, roads, tree cover and the campus layout clearly, but individual small buildings are blurred. The image is from one date (2025-12-11); crops and haze reflect that day.
3. **Detected buildings are machine-made.** Footprints from Google and Microsoft are detected from satellite images and can be wrong, merged, or missing. They are drawn as oriented boxes, not true shapes. Heights come from Google Open Buildings 2.5D where a building is detected there (mean absolute error about 1.5 m, 4 m effective resolution); otherwise they are guessed from footprint area (3.2 m under 40 m², 4.5 m under 150 m², 6 m under 500 m², 9 m above).
4. **OSM building heights** come from tags where mapped, then from Open Buildings 2.5D, and are estimated by type only as a last resort (11 m for university, college, hospital, hostel and school buildings; 5.5 m for houses). Roof colours come from 10 m pixels, so small roofs blend with their surroundings.
5. **Terrain is a surface model corrected for trees.** GLO-30 includes canopy and buildings. About half of the mean canopy height (k = 0.5) is subtracted, a value fitted to the data (the fit gave 0.33-0.57). Terrain accuracy is a few metres vertically. Earlier SRTM terrain agreed with GLO-30 to a mean of -1.7 m and a 2.6 m spread.
6. **Trees come from a canopy model**, so positions and heights are measured, but species, trunks and crown shapes are generic. Not every tree is shown (10,000 of 86,165 detected).
7. **Places:** 7 of the 8 colleges on the official site were found in OSM names (College of Post Graduate Studies and the University Hospital were not). Names differ slightly (for example, College of Community Science is "College of Home Science" in OSM).
8. **Not survey-grade.** For visualisation and planning discussions only.

## Next steps (if you want more fidelity)

- Ask the GBPUAT estate or works office for a campus boundary file and a building list or drone survey; those would replace the guessed heights and the OSM-only boundary.
- Higher-resolution imagery would sharpen the ground texture, but open global imagery is 10 m. Google's 2D satellite tiles (Map Tiles API) are much sharper and free up to 100,000 tiles a month, but Google's policy forbids storing or offline use and requires the Google logo, so they could only be an online-only layer that needs an API key. Esri, Maxar and Planet imagery need their own licences.
- A finer terrain grid (30 m) would sharpen slopes at the cost of more triangles.
