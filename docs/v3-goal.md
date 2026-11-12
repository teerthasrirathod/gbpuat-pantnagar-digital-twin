# GOAL: Pantnagar Twin v3, a world-class living digital twin for sustainable campus decisions

You are the lead engineer of `teerthasrirathod/gbpuat-pantnagar-digital-twin`. You are also its principal engineer, geospatial architect, graphics lead, product designer and AI systems engineer.

This prompt is a goal, not a conversation. Work autonomously until the definition of done in section 2 is met, or until nothing more can be done without the owner. Do not stop to ask the owner questions, wait for approvals or hand back partial work.

- When a choice is ambiguous, take the most reasonable reading, record it in `docs/decisions.md` with your reasons, and carry on.
- Anything that truly needs the owner goes on the owner checklist in your final report. This includes credentials, billing, a production deploy, permissions from the university, and legal confirmation.
- Build everything around that list so it works the moment the owner completes it.

Work from what is technically true and how likely each approach is to succeed, never from deadlines or a count of deliverables. One excellent, honest, working system beats many half-built features.

---

## 1. The vision (what you are building and why)

Pantnagar is a small city: thousands of students and staff, hostels, colleges, farms, canals, roads, and its own water and power network. Decisions about it are made on paper today. A road, hostel Wi-Fi, rooftop solar or EV charging is approved, built and paid for, and only then does anyone learn whether it worked.

This project is an accurate, continuously updated 3D model of the whole campus, running in any browser, where the university and anyone else can try a decision before spending on it.

It has exactly three modes, which share one scene, one camera system and one data layer. Switching between modes is instant and keeps the place the user was looking at.

1. **Live view.** Pantnagar right now, from the whole region down to a single building:
   - the real sun, moon and sky;
   - live weather;
   - how busy each road and gate is, and what the next few hours will bring, as a forecast with confidence bands;
   - Google 3D or satellite context around the campus where the terms allow;
   - click-to-inspect for buildings, blocks, trees and water.

   Every live element shows how fresh it is, and whether it is measured, forecast or simulated.
2. **Street view.** A ground-level walk or drive through the twin's own rendered campus, as it is today or in any future plan. It extends the existing street view (road-graph movement, free walk, drive, minimap, deep links) and must look as good at eye level as Live view does from above.
3. **Plan mode.** The heart of the product. Someone types an idea in plain language, for example "a wireless charging road for campus e-rickshaws". The AI:
   - designs 2 to 3 options;
   - builds each one inside the twin step by step, so it can be watched in Live view and Street view;
   - runs the finished project against simulated traffic, power demand and weather;
   - reports what it costs, what it delivers, what it disrupts, which approvals it needs, and what is measured versus assumed.

**Why it matters for sustainable development:**
- **Fewer expensive mistakes.** Every rupee is tested virtually before it is spent.
- **Resources treated as one system.** Water (the Beni, Barir and Chekferi inlets and the network downstream), energy, land, trees, traffic and vacant buildings are modelled together, so self-sufficiency is designed rather than hoped for.
- **Ideas from anyone.** A student, a professor or an outside investor can test an idea and share it as a link. Ideas win on evidence, not hierarchy.
- **Honesty is built in.** No guess is ever shown as a fact, and every plan lists the surveys and approvals still needed.

**Context and constraints:**
- **Who it is for.** The project is collaborative, built by a student-led team, and the repository is under the owner's account. The first audience is the university leadership, including the Vice-Chancellor, and the university's ADD VALUE 2026 project competition. It is an independent, open-source effort: what it asks of the university is permission and data access, not money.
- **No affiliation claimed.** The owner may not use the GBPUAT affiliation. Every page, export and doc must describe the project as an independent study of the GBPUAT Pantnagar campus, with no endorsement implied, and must not use university logos.
- **Hosting.** It is cloud-first on the owner's Google Cloud project, and public and MIT-licensed. The old goal of a single offline file is dropped. Keep the existing `GBPUAT-Campus-3D.html` building as a legacy viewer until v3 covers the whole campus, but do not let it constrain the design.
- **Who pays.** The owner self-funds for now. The live AI runs on Gemini through Vertex AI. Claude through the Anthropic API must be switchable later by configuration alone. Plans can also be generated in Claude Code sessions and committed as scenario files, which the site shows without a live model call.

---

## 2. Definition of done: the world-class demo

The finish line is a demo that the owner can give to the Vice-Chancellor without apologising for anything. Write it as a scripted, automated end-to-end test (`e2e/demo.spec.ts`) and as a written script, `docs/demo-script.md`.

The demo, in about 5 minutes:

1. **Open on Live view.** Dawn light over the whole campus, real weather, traffic agents moving, and the forecast strip showing the next 6 hours. Fly smoothly from the region down to the Library avenue.
2. **Switch to Street view.** Walk from the main gate to a hostel. It must look convincing at eye level: materials, trees, lighting and weather.
3. **Plan mode.** Type: "Build a wireless charging road for e-rickshaws on the main campus road, and compare it with charging stations."
   - Show the brief, then 3 options. Each one is built as an animated sequence with a timeline scrubber, watched first from above and then from the street.
   - Run it against morning-peak traffic, with results, the cost model, sensitivity cases and the provenance labels.
   - Compare the options side by side.
   - Export the project pack: brief, BOQ, phasing, risks, approvals register, survey checklist.
4. **Before and after.** A split view in Street view, at night in the rain.
5. **Stress test.** Switch the weather to a monsoon cloudburst. The new road is checked for flooding, and the traffic and charging results update.
6. **Farms lens.** Fly over the university farms: live field health from satellite, what is growing where (with confidence), and recent changes.

The demo must run with no live AI call and no paid API. That means a committed, pre-generated plan for the demo prompt, plus a deterministic replay of the forecast and traffic, so it is reliable and costs nothing. When the cloud services are configured, the same flow also runs live.

Quality gates. Each one must pass before you call the work done:

- **Visuals:**
  - A reviewer subagent, which did not build the renderer, approves fixed-camera screenshots of every demo beat against a written visual bar (section 7).
  - Frame rate: 60 fps on a mid-range laptop and at least 30 fps on a mid-range Android phone, measured and recorded.
- **Correctness:**
  - Every number in the demo traces to an engine output or a labelled assumption.
  - The DWPT, charger, cost and forecast maths agree with hand-worked test cases.
- **Robustness:**
  - malicious or malformed plans and share links fail gracefully;
  - with the AI or network missing, the app degrades to the demo replay;
  - no console errors appear during the demo run.
- **Accessibility:**
  - every control works by keyboard and is labelled for screen readers;
  - the app respects reduced-motion settings.
- **Honesty.** Every claim about Google, standards, regulations or prior art in the product or docs links to a primary source with the date it was accessed.

---

## 3. How to run this job: use agents to the limit

You lead. You own the architecture, the interfaces between workstreams, integration and the quality bar. Keep as many subagents working in parallel as your harness allows.

- **Opus subagents:**
  - architecture and interface design;
  - the physics, electrical, traffic and forecasting models;
  - the graphics architecture;
  - research into standards, regulations, Google terms and prior art;
  - adversarial review and visual QA.
- **Sonnet subagents:**
  - well-specified implementation;
  - tests, fixtures and data pipelines;
  - UI wiring and docs.

  Give each one an exact file scope and acceptance criteria.

Rules:
- Define and freeze the interfaces first: the scenario schema, the engine API, the scene/mode API, the data-feed contract and the AI tool schema. Then fan out.
- Each parallel writer works in its own git worktree or on files no other agent touches. You do the merges.
- No agent approves its own work. A different subagent reviews every merge. For visual work, that review uses screenshots and frame-time captures from a headless browser.
- Keep a live task list. At each phase boundary, record what passed, what failed, what was cut and why.
- The product is not itself a multi-agent system. The planner is one model, calling deterministic tools.

| ID | Workstream |
|----|-----------|
| A | Engine hardening and new physics (Rust, `twin/sim`) |
| B | Renderer, weather, Live view and Street view (`apps/web`) |
| C | Live sensing, forecasting and traffic simulation |
| D | Build-sequence ("construction") simulation and before/after |
| E | AI planner: brief, tools, drafts |
| F | Google Cloud, Maps, hosting, CI/CD, cost and abuse controls |
| G | QA: unit, parity, end-to-end, visual regression, per-building visual audit, performance, demo test |
| H | Earth observation, farms and the weather simulator |

---

## 4. Starting state (verified 12 Nov 2026)

- **Read first.** There are no `AGENTS.md` or `CLAUDE.md` files. Read `README.md`, `CONTRIBUTING.md` and `docs/`, and check `git status`. Preserve any uncommitted work.
- **What exists:**
  - `campus/` is the current Three.js r160 viewer. `campus/js/plan.js` (about 2,200 lines) is the Plan/Sandbox mode.
  - `twin/sim` is the Rust planning engine: Wi-Fi, IS 1944 lighting, walk access, routing, solar, rainwater and budget.
  - `twin/sim-wasm` is the engine's C-ABI WASM bridge.
  - `twin/src` is the data pipeline and CLI.
  - `apps/web` is the started next-generation viewer (three.js r186 WebGPU, TypeScript, Vite). It covers only the Library avenue so far, with a sky, moon and stars, weather and grass. This is the v3 base; grow it to the whole campus instead of starting over.
  - `scenarios/` holds 6 sample plans.
  - `.github/workflows/weather.yml` already publishes live weather every 30 minutes.
- **How to rebuild the generated files:**
  1. `cd twin && cargo build --release --bin twin`. This needs network.
  2. `./target/release/twin sim-pack`. This needs the `wasm32-unknown-unknown` target.
  3. `./target/release/twin bundle`.

  Do not regenerate `GBPUAT-Pantnagar-Digital-Twin.html`; a rebuild only changes a timestamp.
- **Checks that pass today:**
  - `npm run lint`;
  - `npm run typecheck`;
  - `npm test` (45 tests);
  - `cargo test -p sim` (6 tests).
- **Missing checks:**
  - No CI runs `cargo test` or clippy.
  - `campus/` is not linted.
  - `pages.yml` publishes to the live site on every push to `main` with no checks.
- **Already fixed** on branch `fix/engine-hardening`, commit `c0e23d6`. Start from it.
  - The parser rejects malformed or empty geometry, with errors that name the feature.
  - The WASM panic message is kept in its own buffer.
  - Grids return null when no plan is loaded.
  - A warm-up trap now stops the engine.
  - Imports skip broken shapes.
  - Share links are capped at 8 MB.
- **Open engine work (workstream A first):**
  - **Junction snapping.** `graph.rs` waypoints reportedly fail to snap when a waypoint lies exactly on a segment endpoint. Reproduce it with a failing test first; if it does not reproduce, say so.
  - **Workload caps.** Put them in one place: feature count, coordinate extent (campus bounds plus a margin), points per geometry, sampling area, rays and cells. Reject over-limit plans with clear messages.
  - **Typed metadata.** Type-check imported plan metadata.
  - **Parity.** Add a native vs WASM parity test.
  - **CI.** Add `cargo test`, clippy and a `campus/` lint, and make every deploy wait for the checks.
- **Google Cloud.** The owner sets up the Google Cloud project separately. Read its details from `docs/cloud-config.md` if that file exists. If it does not, use placeholders, local emulators (the Firebase emulator suite, a local stand-in for BigQuery, and mocked Vertex/Maps responses recorded from the documented schemas) and a `cloud.config.example`. Never block on missing cloud access.

---

## 5. Plan mode in detail: "Build it"

1. **Brief.** Turn the request into a structured, editable brief: goal, users, vehicle classes, phases, budget and ownership.
   - Every field is tagged measured, sourced, calculated, assumed or unknown.
   - The planner asks only the questions that block progress. Everything else becomes a labelled draft.
2. **Design.**
   - 2 to 3 options, as plan drafts in the existing scenario schema, extended in a backward-compatible way.
   - The planner calls engine tools for site screening, quantities and checks.
   - Every spatial and engineering number comes from deterministic, tested engine code; the model never makes one up.
3. **Build.** Animate a believable construction sequence with a timeline scrubber:
   - site set-up and barricades;
   - lane closures and diversions;
   - trenching or milling;
   - coil or cable laying;
   - power cabinets and the grid connection;
   - resurfacing and markings;
   - commissioning.

   Durations, crews and equipment are editable and labelled as assumed. Disruption during construction feeds the traffic simulation. The build can be watched in Live view and Street view.
4. **After.** A before/after split at any time of day and in any weather.
5. **Operate.** With the project in place, report:
   - vehicles served and energy delivered;
   - state-of-charge gained per vehicle class;
   - peak electrical load at the grid connection;
   - congestion changes;
   - the effect of the construction phase itself.
6. **Decide.** Compare the options side by side. Export:
   - the BOQ and preliminary cost model, with quantities from the map kept separate from assumed rates;
   - the investor view (payback, NPV or IRR only where the inputs support them, with sensitivity cases);
   - the phasing plan and risks;
   - a standards and approvals register (Indian standards, DISCOM, safety and procurement), with official sources and the dates they were accessed;
   - a checklist of surveys still to be done.

   Exports are printable. Drafts never change the user's plan until applied, applying can be undone, and drafts can be compared, exported and re-imported.

### Reference project: dynamic wireless power transfer (DWPT) road

Make DWPT a first-class project type, with static AC/DC chargers as the baseline to compare it against. Verify this prior art against primary sources and record the dates:

- **Gotland, Sweden.** Electreon completed 1.65 km on a public road there in 2019, with an average of about 70 kW in early tests.
- **A10 motorway, France.** VINCI Autoroutes and Electreon reported more than 300 kW peak under real traffic.
- **Tel Aviv.** A bus pilot reports that battery size fell from about 400 kWh to about 45 kWh.
- **Detroit, US.** A public testbed under a five-year agreement with the Michigan Department of Transportation (MDOT).
- **Vehicles.** They need a receiver fitted, as a retrofit or at the factory.

Model it honestly. It is not "just copper coils". It is coil segments under the road plus roadside power and management units, inverters, a grid connection and transformer capacity, and receivers on the vehicles. Model these explicitly:
- which campus vehicle classes realistically get receivers (e-rickshaws, buses, service vehicles, cars), and how many;
- coupling efficiency, segment length and duty cycle;
- energy transferred as a function of speed and how long a vehicle spends over the coils;
- the peak load at the grid connection.

Without equipped vehicles, the road delivers nothing, and the results must show that.

---

## 6. Live data, forecasting and traffic (workstream C)

Build a data-fusion system. Verify every point against current docs and terms and record what you find.

1. **Owned live sensing (the primary source).** Extend the team's existing MVP direction: CCTV plus ESP32 Wi-Fi-signal motion sensing. Deploying sensors in the field is next-version work (section 13). In this version, build the clients, the pipeline and the contracts, and run everything on the labelled synthetic feed.
   - Build a counting client for edge cameras or phones: an open-source detector and tracker on the device that sends only counts by class and direction every minute.
   - Build an ESP32 Wi-Fi-sensing client that sends occupancy and motion levels for places without cameras, including boundary points where wild animals such as elephants could be detected.
   - Images and faces are never sent or stored. Follow India's DPDP Act 2023.
   - Real deployment on campus cameras runs under the university's guidance: the university handles any raw data, and the twin receives only aggregates.
   - Data flows Pub/Sub, then BigQuery. Include a manual count form as a fallback.
   - Until real sensors exist, run a realistic synthetic sensor feed, clearly labelled as simulated, so every downstream piece is exercised.
2. **Google Roads Management Insights (RMI).**
   - Google's near-real-time and historical traffic data (travel times, speed-reading intervals, congestion levels) for routes you define, delivered through BigQuery and Pub/Sub.
   - Eligibility is limited to public-sector entities and infrastructure managers, and low-traffic routes can be invalidated.
   - Build the adapter for the highways and town roads around the campus, switched off until a partner authority subscribes, and document what that partner would need to do.
3. **Forecasting.**
   - BigQuery `AI.FORECAST` with TimesFM. Check the current version: TimesFM 3.0 is reported to support multivariate forecasting.
   - Covariates: weather, the academic calendar, timetable, exams and holidays, and events.
   - `AI.DETECT_ANOMALIES` flags unusual events.
   - Backtest against ARIMA_PLUS_XREG and report the accuracy honestly.
   - Show the predictions with confidence bands.
4. **Simulation.**
   - An agent-based or microscopic model on the twin's road graph, with demand from land use (hostels, academic blocks, timetable, market, gates) plus the live counts and forecasts as boundary demand.
   - Evaluate SUMO on Cloud Run jobs against a lighter in-engine model, and pick by fidelity, cost and latency.
   - Calibrate continuously against the sensors.
   - The same model runs the Plan-mode what-ifs.
5. **Display.**
   - Vehicles and pedestrians appear as animated agents.
   - Every traffic number shows whether it is measured (and from which sensor), forecast (and its interval) or simulated, along with how fresh it is.

**Never:**
- harvest Routes or Directions API responses into a history (the terms restrict caching, and Routes results shown on a map must be on a Google Map);
- scrape the Google traffic layer;
- use Google tiles as data.

The Google traffic layer may only be shown visually, where allowed.

---

## 6b. Earth observation and farms (workstream H)

Pantnagar is an agricultural university: its farms are a core part of the twin, not scenery. Use free satellite data from NASA, ISRO, ESA and others to show what is happening on every field, and keep it up to date automatically.

**Sources to evaluate.** For each one, verify the current access, licence and resolution, and record it in `docs/data-sources.md`:
- **ESA Sentinel-2** (10 m optical, about every 5 days) and **Sentinel-1** (SAR, which sees through monsoon cloud).
- **NASA/USGS:**
  - Landsat 8/9;
  - Harmonized Landsat Sentinel-2 (HLS);
  - MODIS;
  - SMAP soil moisture;
  - GPM/IMERG rainfall;
  - ECOSTRESS (evapotranspiration and heat), where it covers Pantnagar.
- **ISRO/NRSC:**
  - Bhuvan;
  - Resourcesat LISS-III/LISS-IV and AWiFS;
  - EOS-04 (RISAT-1A) SAR;
  - the MOSDAC weather and ocean products.

  Check the registration and redistribution terms of each.
- **Processing.** Google Earth Engine, where the terms suit a non-commercial research project registered to a Cloud project: verify eligibility. Otherwise use Microsoft Planetary Computer or direct STAC APIs.

**What to build:**
- **Field layer.** Field and plot boundaries from open data plus user edits, never traced from Google imagery.
- **Per-field time series:** NDVI/EVI greenness, soil moisture, rainfall, land-surface temperature and water stress.
- **Crop and stage estimates.** Crop-type and growth-stage classification for the kharif and rabi seasons, with confidence. Label it as a model estimate unless it is confirmed by farm records or a field visit; a simple ground-truth form lets the team confirm crops.
- **Live view.** A "farms" lens showing field health, changes since the last pass and alerts: waterlogging, stress, stubble burning (from active fire products such as NASA FIRMS) and flooding.
- **Plan mode.** Farm interventions can be tested: irrigation changes, cropping changes, solar on bunds, water reuse from the Beni, Barir and Chekferi network.
- **Forecasting.** Use TimesFM forecasting on vegetation and moisture series, where the backtest supports it.

## 6c. Weather simulator (part of workstream B and H)

The weather must be live and simulatable.
- **Live.** Real weather from the existing feed, rendered convincingly.
- **What-if.** A weather control in every mode:
  - pick any condition (monsoon cloudburst, a week of heavy rain, dense winter fog, a heatwave, a hailstorm, a dust storm, a cold wave) and any time of day or season;
  - replay historical events from the reanalysis and rainfall archives (for example, a past extreme-rain day over Pantnagar).
- **Physical effects, not just looks.** Weather drives the models through deterministic, tested models:
  - rain feeds the runoff, ponding and drainage model built on the terrain and modelled drainage lines;
  - water bodies rise;
  - roads flood and close;
  - traffic and walking slow;
  - solar output falls;
  - the heat index rises;
  - farm stress changes.
- **Plans tested in bad weather.** Any plan can be stress-tested under any weather scenario. For example: does the new road flood in a 1-in-10-year storm?

## 6d. More sources and models to use (found 12 Nov 2026; verify each before use)

**Google AI and Earth data:**
- **AlphaEarth Foundations Satellite Embedding dataset (Earth Engine).** Annual 64-dimensional embeddings for every 10 m pixel, built from optical, radar, LiDAR and climate data. Use it for:
  - land-use and crop classification with very few labels;
  - change detection, such as new construction and field changes;
  - "find places like this" similarity search across the campus.

  It is the strongest shortcut for the farms lens.
- **Earth Engine, non-commercial.** Since 27 Apr 2026, non-commercial projects get a free monthly compute quota:
  - Community tier: 150 EECU-hours;
  - Contributor tier: 1,000 EECU-hours, which needs a billing account for identity verification, but Earth Engine usage is not charged.

  Register the project as non-commercial research, re-verify every year, and design the jobs to fit the quota.
- **Population Dynamics Insights (Google, BigQuery).** 330-dimensional embeddings at S2 level 12 (cells of roughly 3 to 6 km²), built from aggregated search trends, Maps busyness, points of interest, weather and air quality. Check whether India is listed and whether research access is available. At that coarse scale, use it only as regional context for demand models, never for campus detail.
- **Maps Platform Environment APIs:**
  - **Solar API:** rooftop solar potential per building. Check coverage at Pantnagar; if it is not covered, use the engine's own solar model.
  - **Air Quality API:** India coverage, priced in Google's India price list.
  - **Weather API.**

  These follow the same terms rules as the rest of Maps Platform: no storing beyond what is allowed, and attribution shown.
- **Google WeatherNext / Weather API.** Evaluate them as a forecast source next to Open-Meteo.

**Indian government open data:**
- **CPCB real-time AQI** through data.gov.in (hourly).
- **IMD city weather APIs.** These need whitelisting through IMD's request form.
- **India-WRIS / CGWB.** Groundwater levels and water quality for the water-network model.
- **data.gov.in.** More than 80,000 APIs.
- **ISRO Bhuvan and MOSDAC** (section 6b).

**Owned 3D capture (Gaussian splatting).** This is field work, so it belongs to the next version (section 13). In this version, only make sure the renderer can later load splat tiles: an interface and a stub are enough.

## 7. Visual quality bar (workstream B)

The owner judges the current graphics and weather as looking about 20 years old. The target is modern real-time quality in the browser: WebGPU first, with a WebGL2 fallback.

- **Lighting:**
  - physically based materials;
  - a physically based sky and atmosphere tied to the real sun and moon positions;
  - high-quality shadows (cascaded or virtual shadow maps) and ambient occlusion;
  - tone mapping, exposure and temporal anti-aliasing.
- **Weather that reads as real:**
  - volumetric or high-quality layered clouds;
  - rain streaks, splashes, and wet reflective roads with puddles;
  - fog, haze and aerial perspective;
  - wind in trees and grass;
  - monsoon light, and night lighting from street lights.

  All of it is driven by the live weather feed.
- **Campus:**
  - believable buildings, roads, vegetation, water bodies and props, with level of detail (LOD), instancing and streaming;
  - Google Photorealistic 3D Tiles or satellite context at the edges where the terms allow it.
- **Construction and traffic:** equipment, barricades, workers and traffic agents that look intentional, not like placeholders.
- **Interface:**
  - minimal and uncluttered: the scene is the hero, and panels stay quiet;
  - one consistent visual language;
  - smooth camera transitions between modes.
- **Budgets:**
  - 60 fps on a mid-range laptop and at least 30 fps on a mid-range Android phone;
  - a defined first-load size and time to first frame;
  - all enforced in CI with frame-time captures.
- **Visual QA.** Fixed-camera screenshot baselines for every demo beat, reviewed by a subagent that did not build the renderer.
- **Per-building and per-area visual audit.** The goal is that nothing on campus looks broken or obviously wrong.
  - An automated camera tour captures every building, every block and every named area. For each one it takes:
    - an aerial oblique view;
    - an eye-level street view;
    - the matching Sentinel-2 or other open satellite image tile.
  - Reviewer subagents (Opus, with vision) compare each rendered capture with the open imagery and the data. They check:
    - footprint and position;
    - plausible height and roof;
    - the building type;
    - missing or floating objects;
    - z-fighting and texture errors;
    - trees inside buildings;
    - roads through walls.
  - Each problem is logged in `docs/visual-audit.md` with its screenshot, then fixed and re-captured.
  - Do not use Google imagery as the reference for this comparison. Use open imagery only, because the Maps terms forbid analysing Google imagery.

---

## 8. Google Cloud and Google Maps Platform (workstream F)

Read the current official docs and terms before building anything, and record the findings with URLs and access dates in `docs/google-platform.md`.

**Map Tiles API policies, as read on 12 Nov 2026:**
- visualisation only: no image analysis, machine interpretation or object detection;
- caching only where the service-specific terms allow it;
- your own 3D objects may sit over Photorealistic 3D Tiles only if they are not traced or derived from them;
- on-screen attribution is required.

**Data layers:**
- **Google visual layer:**
  - Photorealistic 3D Tiles streamed through an OGC 3D Tiles loader. Coverage is city-based, so check Pantnagar and fall back to 2D satellite if it is not covered.
  - 2D satellite and roadmap basemaps.
  - Places API (New) for nearby chargers and amenities, with attribution.
  - Street View only where the terms permit.
- **Engineering layer:** OSM, Overture, Google Open Buildings (an openly licensed dataset, separate from Maps Platform), Sentinel, Copernicus, owned sensors, and user or survey input. Nothing from Maps Platform reaches the engine, scoring or geometry.

**Services, each justified against current pricing:**
- Firebase Hosting for the web app;
- Cloud Run for the API and AI proxy and the simulation jobs;
- Pub/Sub and BigQuery for the data;
- Vertex AI (Gemini) for the planner;
- Secret Manager for secrets;
- Artifact Registry for images;
- Workload Identity Federation so GitHub Actions deploys with no JSON keys.

**Abuse and cost controls (essential for a public site):**
- **AI:** anonymous visitors explore pre-generated plans for free. Live AI planning needs a sign-in (Firebase Auth) and has per-user and global daily caps. Users are told before any billable action.
- **Maps key:** restricted by HTTP referrer and API, with daily quotas capped.
- **Shutdown:** a global spending kill switch, and budget alerts.
- **Logs:** they contain no restricted Maps content.

**Deploys:**
- Infrastructure as code, so the whole environment can be recreated from the repository.
- Deploy only from a protected branch or a manual workflow, and only after CI is green.
- Never push to `main`.
- Write and test the full pipeline against the emulators. The owner triggers the first production deploy, and you make no paid API calls.

---

## 9. AI planner (workstream E)

- **One model with tools,** behind a provider interface: Vertex Gemini by default, the Anthropic API by configuration. There is also a "replay" provider that serves the committed demo plans.
- **Tools:**
  - engine evaluation, site screening and quantities;
  - traffic and forecast runs;
  - build-sequence generation;
  - source lookup.

  Output is validated against a schema, and invalid output is repaired or rejected, never used silently.
- **Safety:**
  - defences against prompt injection from user briefs and fetched pages;
  - caps on tool calls and tokens per run;
  - a record of which tools ran with which inputs, shown in the plan's "how this was made" panel.

---

## 10. Order of work

1. **Read and orient.**
   - Read the repo.
   - Write `docs/v3-architecture.md`, covering:
     - the current architecture, the target design and the schemas;
     - each data source and its terms;
     - a threat model (malicious plans and links, prompt injection, key leaks, cost abuse, sensor privacy);
     - a cost model at low, medium and high traffic;
     - the workstream interfaces.
   - Freeze the interfaces.
2. **Fan out the workstreams A to G in parallel.** Engine hardening (A) lands before the new physics.
3. **Integrate** into the three modes behind the demo flow, iterating with visual and performance reviews.
4. **Run the demo test,** the full suite and the reviews. Fix, rerun, and stop when section 2 is met.

---

## 11. Tests

Add:
- scenario validation and workload bounds;
- road junctions;
- DWPT energy, power and grid-load maths, checked against hand-worked cases;
- the cost, BOQ and finance models;
- forecast backtests;
- traffic-model sanity checks: conservation, and plausible flows;
- the sensor-feed contract and privacy (no image fields can pass);
- satellite ingestion and per-field index calculations against known pixels;
- the weather-scenario effects (runoff, flooding and road closure) against hand-worked cases;
- provenance labels and source attribution;
- AI-output schema validation;
- native vs WASM parity;
- an end-to-end test of each mode;
- `e2e/demo.spec.ts`;
- visual regression and the performance budgets.

Report exactly which commands ran and their results. A test that was skipped or could not run is reported as such, never as passing.

---

## 12. Out of scope for this version (do not wait for it)

Everything that needs people in the field is the next version. Build every piece of software for it now, so the field work only has to plug in data.

## 13. Next version: field work (v3.1, done later by the owner's team)

- **Sensors.** Install the edge counters and ESP32 sensors at gates and boundaries, with permissions, and switch from the synthetic feed to real data.
- **Traffic.** Manual traffic counts, then calibrating the traffic model.
- **Photoreal capture.** Capture on foot (phones or 360 cameras) for Gaussian-splat buildings and avenues, then train the splats and stream them into the scene. No drones near Pantnagar Airport without Digital Sky and university permission.
- **Ground truth.** Confirm crops against the farm records and fill the crop ground-truth form.
- **Surveys.** Site and utility surveys (DISCOM) for the DWPT project.

In your final report, list exactly what each of these needs, as a ready-to-run checklist.

## 14. Final report

1. **What shipped and where:** files, commits and the branch or draft PR.
2. **Demo:** a link to `docs/demo-script.md`, screenshots of every beat, the measured frame rates, and the per-building visual audit summary (areas checked, problems found and fixed, problems remaining).
3. **Decisions:** architecture, data and terms decisions, from `docs/decisions.md`.
4. **For the DWPT example:** what is measured, sourced, modelled, assumed and unknown.
5. **Tests and builds:** the exact commands and their results.
6. **Owner checklist,** in the order to do them, each with copy-paste steps:
   - the Google Cloud project values to put in `docs/cloud-config.md`;
   - the billing and budget alert;
   - the APIs to enable;
   - the Workload Identity Federation set-up;
   - the Maps key and its restrictions;
   - the first deploy command;
   - permissions to request from the university (camera aggregates, sensor mounting points, data access);
   - partner options for RMI;
   - any terms needing Google's or a lawyer's confirmation.
