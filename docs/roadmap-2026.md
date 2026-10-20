# Roadmap: better farms, live weather and a 2026 look

Drafted 2026-10-17 from five research reports (engine options, farm data in this repo, farm and crop data sources, live weather sources, visual techniques). Everything below marked "unverified" could not be confirmed. The M1 timings are estimates, because nobody has benchmarked this scene on an M1.

## 1. Three things to know first

1. **The ADD VALUE deadline is 20 October 2026, three days from now.** Nothing in the big plan below fits before it. Section 6 lists the small items that could, and the proposal still needs its team details.
2. **The look is limited more by data than by the engine.** Sentinel-2 imagery is blurry at street level, the terrain grid is 60 m, buildings are extruded footprints and farms are barely drawn. A new engine would not fix any of that. Farms, weather and baked lighting would.
3. **The design target is a base Apple M1 laptop.** We cannot test on one. Plan for a built-in benchmark that records frame times on other people's machines, and keep the Light and Balanced tiers as fallbacks.

## 2. Engine: do not switch to Unity

| Option | Result | Why |
| --- | --- | --- |
| three.js r186 with WebGPURenderer and TSL | **Recommended** | Smallest and most flexible; MIT; falls back to WebGL2; keeps the data, the Rust/WASM simulation and the DOM interface. |
| PlayCanvas | Plan B spike | Fastest WebGPU in the one benchmark found, but a smaller ecosystem. |
| Babylon.js | Not needed | Heavier, no clear gain. |
| Unity 6.6 web | No | Empty build is about 12 to 15 MB; WebGPU is opt-in; the simulation and interface would be rewritten; iOS memory crashes reported. Whether the free licence covers a university project is unverified. |
| Godot 4.7 | No | Web export is WebGL2 only. |
| Unreal | No | Pixel Streaming needs a server GPU per viewer. |
| Bevy / wgpu | Not now | Fits the Rust pipeline, but months to reach parity and no DOM interface. |
| CesiumJS with Google 3D Tiles | No | Terms forbid caching and offline use; needs a billing key; India coverage unconfirmed. |
| Gaussian splats | Landmarks only | Needs your own photo or video capture. |

Caveats found in the research:
- A downloaded `.html` file gets no WebGPU in Chrome. The offline file would use the WebGL2 path, so the existing High and Ultra tiers still matter.
- Safari's WebGPU needs macOS 26. An M1 still on macOS 15 gets WebGL2.
- On Windows laptops with two GPUs, Chrome may use the integrated one.
- Brave hides GPU names (so pick tiers by a short frame-time test, not by the GPU string), and Brave issue #54598 reports WebGPU falling back to software.
- three.js WebGPURenderer has an open per-object overhead issue, so merge and instance. This scene already does.
- WebGPU is not automatically faster. Measure it against the current WebGL2 High tier before committing.

## 3. Farms and agriculture

### What is wrong today (repo audit)
- Only **46 of 10,845** buildings are typed from a tag, a name or a place. The other 10,799 come from context or shape guesses.
- Campus "farm" buildings (737): 601 by context, 135 by shape, 1 by name, 0 by tag. 556 of them are huts and pump rooms (median 29 m², 3.2 m high) that sit inside the 2,918 ha "Pantnagar University Farms" polygon, so they are not sheds.
- 309 shape guesses include a railway station building typed as farm.
- Rule-order bugs in `twin/src/build.rs`: name beats tag, "store" is tested before "seed", "shed" matches "Watershed", "bhawan" makes Krishak Bhavan a hostel, and "directorate" or "department" makes the Directorate of University Farm and the Livestock Production department academic.
- The 110 mapped farmland, farmyard and orchard polygons are exported but never drawn.
- The 440 "industrial" buildings are Tata Motors and the SIDCUL estate, not campus.
- Land cover is one date (11 December 2025): 43% is "bare", and there is no crop type.
- The Sandbox has no crop, orchard, irrigation or tubewell items, and farm buildings count as zero people.
- OSM is almost empty for farms in the window: 1 farmland, 2 farmyard, 1 orchard, 21 fish-farm ponds, and no barns, greenhouses or cowsheds.

### Plan
1. **Confidence on every type ("ignore when unsure").** The `ts` field already records the evidence. Three levels:
   - A: tag, name or place. Show the type.
   - B: a matching OSM land-use polygon. Show the type with a "context" mark.
   - C: shape guess only. Do not show a type: grey "Building (type not confirmed)".
   Default on, with a switch to show guesses. Expect the legend to lose most of its types, which is the honest result until more evidence is added.
2. **Fix the rule bugs** listed above, and give the 556 small buildings in the university farm their own label ("Farm structure, small").
3. **Draw the farm polygons**: the 110 OSM areas, plus Fields of the World polygons (CC BY 4.0, 3,443 in the window, 951 of them 0.2 ha or larger). Those polygons are for geometry only: the India benchmark reports pixel recall 0.22 and object recall 0.06, and the confidence column is empty here. 92% of their area agrees with WorldCover cropland.
4. **Crop type from imagery**, shown only when confident:
   - Monthly NDVI from Sentinel-2 (Earth Search, no key, cloud-optimised files, about 100 to 200 MB per year for the window) and Sentinel-1 radar for July to September, when Sentinel-2 has no clear scenes.
   - Rules: rabi peak in February to March = wheat or mustard; water then an August to October peak = paddy; high NDVI from July to March = sugarcane; perennial high NDVI with tree canopy = orchard.
   - This is a proposal, not a validated method. The crop calendar beyond paddy nursery dates is unverified.
5. **Named university facilities.** Found and sourced: Norman E. Borlaug Crop Research Centre (139.61 ha), Breeder Seed Production Centre (284.08 ha), Vegetable (40 ha), Horticulture "Patharchatta" (181 ha), Floriculture (12 ha), Medicinal and Aromatic Plants (40 ha), Agroforestry (57 ha), Bee (32.4 ha), Mushroom (1 ha), Instructional Dairy and Poultry (about 500 acres), Fisheries College and Fish Seed Hatchery. **Most have no coordinates anywhere.** Ask the Directorate of University Farm for a farm block map. Until then, show only what has coordinates, and mark the 21 ponds near the hatchery as inferred.
6. **Confidence score** (proposal): OSM tag +50; named facility within 300 m +30; WorldCover agrees +20; Impact Observatory agrees +10; field overlap 60% or more +20; expected seasonal NDVI +15; penalties for being within 15 m of a road or building, source disagreement, or too few clear scenes. Show the crop at 60 or more, generic farmland at 40 to 59, nothing below 40. Overture labels alone never qualify (a feed store was tagged as a dairy farm).
7. **Sandbox items and models**: crop field, orchard, polyhouse, tubewell, farm pond, drip irrigation, solar pump, dairy shed, compost or biogas. Models: irrigation demand (crop coefficient times ET0 minus rain), crop water stress, runoff by land cover and soil wetness, solar pump sizing. These use the live weather in section 4.
8. **Verification**: no ground truth exists. Sample 50 fields on the satellite image by eye, or ask the university farm for its crop plan, before claiming any accuracy.

## 4. Live weather

### Sources tested with real requests (2026-10-17)
| Source | Browser access (CORS) | Verdict |
| --- | --- | --- |
| **Open-Meteo** | Open (`*`), no key, 0.7 s | **Primary.** Current, hourly -7 to +7 days: cloud layers, visibility, wind at 10 m and 850 hPa, radiation, ET0, VPD, soil temperature and moisture at five depths. Non-commercial, attribution required (CC BY 4.0), limits 600 per minute and 10,000 per day per IP. |
| MET Norway | Open | Fallback 1 (weather only, no soil or ET0). CORS rules "under review". |
| NASA POWER | Open | Fallback 2: daily, about 3 days late. |
| **IMD** (api.imd.gov.in) | **Closed**: key required, no CORS; legacy endpoints IP-whitelisted | Unusable from a static site. Free for non-commercial use but redistribution needs written approval. Do not scrape it or proxy it. |
| data.gov.in, MOSDAC, Bhuvan | Closed or key | No. |
| RainViewer, NASA GIBS | Open | Not a Pantnagar rain nowcast. |
| OpenWeatherMap and similar | Key | No: a key in public code gets abused. |
| GBPUAT Agrometeorology | No feed | The observatory data is offline. Ask the department (the nodal officer named in the report). |

No free live radar or rain nowcast that works in a browser was found for Pantnagar.

**The literal request, "an Indian site", cannot be met live from a static page.** The plan is Open-Meteo for live data, IMD's published 1991 to 2020 normals as the offline "typical month", links out to IMD's own pages, and a request to GBPUAT or IMD for a real station feed.

### Fetch on a schedule, store, then simulate (the owner's idea)

The owner suggested fetching the data, storing it, and simulating the live weather from the stored copy, like a game engine, using five or six places instead of one. This is a good architecture, with one correction about the places.

**How it would work**
1. A scheduled GitHub Actions job (every 30 to 60 minutes) fetches the sources and writes one small file, for example `weather/latest.json`, with the last 7 days and the next 7 days at each place.
2. The file lives on its own branch, not on `gh-pages`, because the site build rewrites `gh-pages` on every deployment. The page reads it from that branch's raw file address (raw GitHub files normally allow browser access and cache for about 5 minutes; unverified here).
3. The page reads the file and simulates the weather itself: it smooths between hourly values, blends places over the map, moves clouds and rain with the wind, and adds gusts. Everyone sees the same sky for the same hour.
4. If the file is old or missing, the page falls back to calling Open-Meteo directly, then to the last copy saved in the browser, then to the typical month.

**Why this is better than calling the sources from the page**
- A key (IMD needs one) stays in the job's secrets and never reaches the browser.
- No browser-access (CORS) problems, and no per-visitor rate limits.
- One place merges several sources and keeps a growing history.
- Visitors still get data if a source is down.

**What the IMD API needs.** Tested today: `aws_data`, `districtnowcast` and `sunmoon` all answer 401 Unauthorized, with no browser-access header. The reference page the owner linked lists the endpoints (city forecast, current station weather, automatic weather station data by state, district nowcast, district rainfall, warnings) but says nothing about keys or terms. Two things have to happen first, and neither can be done by the assistant:
1. IMD must issue a key. The research found the API documentation names IMD's nodal officer for this.
2. IMD must allow the data to be stored and shown on a public website. The research found a written reply (RTI, 11 September 2025) saying use is free for non-commercial purposes, with a certificate of undertaking that bars posting data online without written approval (unverified by me). Publishing a stored copy counts as posting. Ask in the same email as the key request. Do not scrape IMD's pages.
Station data from IMD would then be used to check and correct the model (rain was badly under-reported in the October 2025 test), not just displayed.

**The correction about the places.** The model behind Open-Meteo is a 9 km grid, and the research found the Pantnagar point is in the same grid cell as the whole 9.5 x 7.7 km window. Five or six places inside the campus would receive identical numbers, so they would add nothing. IMD gives the same limit: one station near the campus, and nowcasts per district. Places help over a larger area. Suggested layout:
- Pantnagar in the middle, plus five points about 15 to 30 km away: toward the Himalayan foothills in the north (the direction storms often arrive from), north-east, east, south and west.
- With those, the page can show a rain band or cloud front moving across the campus, driven by the 850 hPa wind between hourly updates.
- Small convective cells inside the campus would be procedural noise shaped by the model's CAPE and rain values, and labelled as simulated, not measured.
Open-Meteo accepts several places in one request. For IMD, current weather works by station ID only, so "exact coordinates" means choosing the nearest stations from the station list.

**Limits to keep in mind** (from general knowledge of GitHub, unverified here): scheduled workflows can run late, and in public repositories they are paused after about 60 days without repository activity, so the page must always cope with an old file and show its age.

### Accuracy (important)
For October 2025, IMD recorded 98.2 mm of rain at Pantnagar. The model data (ECMWF IFS 9 km via Open-Meteo) gave 26.4 mm. Night minimum temperatures were about 3 °C too warm. One month is not proof, but everything must be labelled "model estimate, not a station observation", and the Sandbox should not present rainfall as measured. Winter fog is captured well (visibility under 1 km on 21 of 31 days in January 2026).

### Fallback chain
Open-Meteo, then MET Norway, then NASA POWER, then the last good data saved in the browser (IndexedDB) with its age shown, then the typical month (built from IMD normals: January 5.5 to 19.6 °C, July rain 398 mm, and so on).

### What the live data drives
| Variable | Picture | Sandbox |
| --- | --- | --- |
| Real date and time (IST) | Sun position and sky | Day length, growing degree days |
| Low, mid, high cloud cover | Cloud decks | n/a |
| 850 hPa wind | Cloud drift | n/a |
| Solar radiation vs clear sky | Moving cloud shadows on fields, sun strength | Sunlight for crops |
| Rain rate | Rain streaks slanted by wind, splashes | Rain depth into runoff and rainwater tanks |
| Accumulated rain | Wet, dark, glossy surfaces that dry with ET0 and wind; puddles | Runoff to drains and ponds |
| Wind and gusts | Tree and crop sway, dust | n/a |
| Visibility | Fog density (3.912 / visibility) | n/a |
| Temperature, humidity | Readout, heat shimmer | Heat and cold stress |
| Soil moisture, ET0 | Crop colour: green to yellow to brown | Daily water balance (FAO-56) |

Plus a time slider over the past 7 and next 7 days, and the 10-year archive for seasonal replay. Soil hydraulic constants and crop coefficients in the report are engineering placeholders, not sourced values.

## 5. How to make it look 2026

Ranked by payoff per cost. All GPU costs are estimates for a base M1 at about 1440 x 900.

1. Filmic tone mapping, a time-of-day colour grade, height fog tinted by the sun, sky ambient light (under 0.3 ms). Flat unlit colour is most of the "2011" look. *Partly done in the High tier.*
2. **Baked ground ambient occlusion and per-building and per-tree vertex occlusion**, made in the Rust pipeline (about 0 ms at run time).
3. Land-cover-driven ground detail: grass, soil or stubble chosen by class, with macro tint, taking only brightness from free textures so the satellite hue stays true (0.5 to 1 ms).
4. **Field rows**: one slab per field with a row shader aligned to the field, bunds and channels, and a crop calendar giving colour and height by date (0.5 to 1 ms). This is what makes an agriculture university look like one.
5. Near-field instanced crop and grass blades within about 50 m, with wind (1 to 2 ms).
6. Temporal anti-aliasing (kills shimmer on rows, leaves, windows).
7. Cascaded sun shadows (2 to 4 ms).
8. Better sky and aerial perspective (a precomputed scattering sky).
9. Cloud layer plus moving cloud shadows from one noise source (under 0.3 ms).
10. Weather visuals: wet surfaces, puddles, rain, wind sway, lightning (about 1 ms total).
11. Building variety: hue, age, roof type, stains, roof tanks, solar panels, AC units.
12. Trees: species clumps with three levels of detail and impostors.
13. Water: sky reflection and moving normals.
14. Ambient occlusion on screen: low value once it is baked; street view on the top tier only.

Avoid: full-resolution volumetric clouds, screen-space reflections on fields, more than 3 shadow cascades, depth of field and tilt-shift, dense alpha-tested foliage (poor on Apple GPUs), MSAA together with TAA, rendering at full retina scale (cap at 1.25 to 1.5), treating AI-upscaled satellite images as ground truth, and Gaussian-splat scenes.

**Look by season** (for a Terai farm campus): mid-October is post-monsoon harvest, with golden stubble, ploughed dark loam, young mustard and tall sugarcane under a warm low sun. December and January are dense fog with grey-blue light, bright green wheat and mustard bloom. July to September is saturated green, flooded paddy mirroring the sky and heavy cloud. April to June is dusty ochre haze with gold stubble. Noon sun is about 84 degrees high in June and 38 degrees at the winter solstice (the agent's arithmetic).

## 6. Phases

**Phase 0 status (done 2026-10-17, not yet pushed):**
- Types are shown only with evidence (tag, name, place or land-use area); 9,427 guessed types now read "Type not confirmed", with a Layers switch to show them.
- The 110 mapped areas: farmland, farmyard and orchard are drawn and named; agricultural places have green labels.
- Live weather (`campus/js/weather.js`): six points, interpolation in time and space, rain, fog, wet surfaces, wind sway, sky and sun in High and Ultra, a time slider from -48 h to +72 h, an offline fallback chain.
- The scheduled fetch job (`tools/fetch_weather.mjs`, `.github/workflows/weather.yml`) is written and tested locally but only runs once pushed.
- Not done in Phase 0: the rule-order fixes in `build.rs` (they touch a handful of buildings and need a data rebuild), crop fields and crop types, IMD data, cloud shadows, puddles, the Sandbox water balance.

| Phase | What | Effort | Notes |
| --- | --- | --- | --- |
| 0, before 20 Oct | Fill the proposal's team details. Optionally add: confidence-based types and the rule fixes, draw the 110 farm polygons, a live weather readout using Open-Meteo with the sky, fog and wind following it. | 1 to 3 days | Small, low risk. No engine change. |
| 1 | Data: field polygons, NDVI and radar crop classes with confidence, named facilities, baked occlusion; Sandbox farm items and water-balance models | 1 to 2 weeks | Needs the university's farm map for validation. |
| 2 | Toolchain: bundle with esbuild, upgrade three.js to the current release (ESM only: `ShaderMaterial` and `onBeforeCompile` code must be ported to TSL), keep the Light and Balanced tiers, add a frame-time tier probe | 3 to 5 days | Do this before any WebGPU work. |
| 3 | WebGPU path with TSL materials, cascaded shadows, TAA, row shader, cloud shadows; measure against the current WebGL2 High tier | 1 to 2 weeks | Abort the WebGPU path if it is not faster. |
| 4 | Full weather simulation: rain, wet surfaces, puddles, fog, clouds, time slider; Sandbox runoff and crop stress from the live data | about 1 week | |
| 5 | Polish: building variety, tree levels of detail, water, seasons, a cinematic mode, a built-in benchmark that saves frame times | 1 to 2 weeks | |

The research put the renderer upgrade (phases 2 to 5 without data) at about 5 to 7 part-time weeks.

## 7. Risks and unverified items

- No M1 to test on. Every M1 timing here is an estimate.
- Crop-type accuracy has no ground truth; the confidence scheme is a proposal.
- Fields of the World recall in India is poor; use it for geometry only.
- Sentinel-2 has no clear scenes from July to September, so paddy needs radar (more download and processing).
- Open-Meteo is free for non-commercial use only; the pages are slightly inconsistent about commercial use. Keep the project non-commercial and show the attribution link.
- Open-Meteo rain and soil moisture are modelled, and can be far off for local storms.
- Unverified: Unity 6.6's WebGPU status, Google 3D Tiles coverage in India, current Safari 26.x bugs, Firefox WebGPU status (sources conflict), Safari and Firefox behaviour for downloaded files, coordinates for most university farms, whether the 21 ponds are fish ponds, whether "PCP" is the Plant Genetic Resources centre, the sugarcane and maize calendar, real IMD responses for Pantnagar.

## 8. Decisions needed from you

1. Do Phase 0 before 20 October, or leave the live site as it is and protect the proposal time?
2. Staged upgrade of the current viewer (recommended), or a spike of another engine?
3. Will you write to the GBPUAT Directorate of University Farm for a farm block map and crop plan, and to the Agrometeorology department for a station data feed?
4. Will you ask IMD for an API key and for written permission to store and show the data on a public site? A draft message is below. Without it, the stored file uses Open-Meteo only, and IMD stays as a link and as the source of the typical-month normals.
5. Weather places: Pantnagar plus five points 15 to 30 km out (recommended), or the single-point version.

Draft message to IMD (edit before sending; add your name, department and contact details):

> Subject: Request for API access and permission to display data: GBPUAT student project
>
> I am a student at G.B. Pant University of Agriculture and Technology, Pantnagar. We are building a free, non-commercial 3D digital twin of the campus and its farms (open source, public website). We would like to use the IMD API (api.imd.gov.in) for current weather and nowcasts near Pantnagar, to drive a weather simulation and to check forecast accuracy for crops. Please tell us how to get an API key, and whether we may store the responses in a public repository and show them on the website, with IMD named as the source. If not, please say what is allowed. We will not sell or resell the data.

## 9. Main sources

- WebGPU status: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status and https://caniuse.com/webgpu
- three.js releases and migration: https://github.com/mrdoob/three.js/releases and https://github.com/mrdoob/three.js/wiki/Migration-Guide
- Engine benchmark: https://github.com/mvaligursky/webgpu-webgl-benchmarks
- Unity 6.6 WebGPU limits: https://docs.unity3d.com/6000.6/Documentation/Manual/WebGPU-limitations.html
- Google 3D Tiles policies: https://developers.google.com/maps/documentation/tile/policies
- GBPUAT research farms: https://gbpuat.ac.in/directorates/directorate_experiment/index.html?id=8
- Fields of the World: https://source.coop/ftw/global-data and https://arxiv.org/html/2409.16252v2
- Sentinel-2 on Earth Search: https://earth-search.aws.element84.com/v1
- Sentinel-1 on Planetary Computer: https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc
- Open-Meteo: https://open-meteo.com/en/terms and https://open-meteo.com/en/docs
- IMD API reference: https://api.imd.gov.in/public/api_reference.html
- IMD Pantnagar normals: https://mausam.imd.gov.in/dehradun/mcdata/PANTNAGAR_EXTREME.pdf
- MET Norway terms: https://developer.yr.no/doc/TermsOfService/
- Visual references: https://iquilezles.org/articles/texturerepetition/ , https://iquilezles.org/articles/fog/ , https://threejs.org/docs/pages/TRAANode.html , https://threejs.org/docs/pages/CSMShadowNode.html , https://github.com/takram-design-engineering/three-geospatial
