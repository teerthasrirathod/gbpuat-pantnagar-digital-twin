# Pantnagar Sandbox

**Try a change to Pantnagar on its digital twin, see what works and what does not, and only then put a budget on it.**

Plan mode in the campus twin (`GBPUAT-Campus-3D.html` or `campus/index.html`) is a simulation sandbox. You work the way an owner of the place would:

1. **Design** changes on the 3D map: new buildings, roads and areas, equipment and amenities, changes to what exists.
2. **Simulate** the categories you care about, one or several at a time, and read clear verdicts against your targets.
3. **Budget** it: quantities come from the map, and every rate, extra cost, contingency, tax and the spending limit is yours to set.
4. Keep several **scenarios**, compare them, and print a **report** of the one you choose.

Everything runs in the browser and works offline. The simulation engine is written in Rust (`twin/sim`) and runs as WebAssembly in the page and as a command-line tool (`twin sim`).

## The panel

| Tab | What it is for |
| --- | --- |
| **Design** | Tools by category. Click on the map to place, draw or change things. Your own item types appear under their category. The list below shows everything in the scenario, grouped by category. |
| **Simulate** | Tick the categories to simulate, then **Run simulation** (or leave **Run automatically** on). **What works** lists every check against its target, with ✓ or ✗; targets can be edited in place. Below are the details: Wi-Fi coverage, street lighting, walking access, routes, green/water/energy, buildings and roads, and the model assumptions. |
| **Budget** | Budget available, contingency and taxes; costs by category with editable rates; other cost lines (survey, design, labour…); totals, running cost and solar savings; CSV download. |
| **Types** | Every item type with its cost, yearly upkeep and walking reach, all editable. **New item type** creates your own (name, category or a new category, point / line / area, cost, upkeep, electricity, walking reach, colour). |
| **Report** | Notes on what the scenario tries, the scenario report, scenario files and share links, **Compare all scenarios**, and sample scenarios. |

The scenario name sits at the top of the panel; the button beside it opens **your scenarios** (open, new, duplicate, delete). **Today / With the changes** switches the whole view, and the figures under it (total cost, running cost, targets met) update as you work.

## Designing

- **Points** (Wi-Fi, lights, docks, bins…): click to place; keep clicking to place more; `Esc` when done.
- **Buildings and areas**: three clicks make a rectangle (corner, corner, depth); **Any shape** clicks every corner; double-click or `Enter` finishes.
- **Roads and paths**: click along the route. Ends within 12 m of a road join it, and crossings become junctions, so new roads are part of the network: street view walks and drives on them, and routes use them.
- **On a building** (rooftop solar, rainwater harvesting, change floors or use, demolish) and **on a tree** (tag, remove): click it.
- **Light a road**: click a mapped road to line it with street lights.
- Click anything you added to edit it: name, settings, **Proposed** or **Existing**. Drag it, or its corner handles, to move it. `Delete` removes, `Ctrl+Z` undoes, `Ctrl+D` duplicates.

**Existing** items are things already on the ground but missing from the map (real access points, street lights, tagged trees). They count as *today*, so results show what your changes add. The street lights drawn in the normal view are illustrative and do not count.

## Simulating

| Model | Result |
| --- | --- |
| **Wi-Fi coverage** | Share of floor area with good (-67 dBm) and usable (-75 dBm) signal in the measured buildings, per building and in total; a signal map for any floor; **Suggest access points** places them floor by floor until 95% of each building has good signal. |
| **Street lighting** | Road length meeting IS 1944 (15 lux main roads, 8 campus streets, 4 tracks and paths), average, darkest point, evenness, dark spots, energy; **Night view**. |
| **Walking access** | For every amenity type with a walking reach (built-in or your own): share of people in campus buildings who can walk to one within that reach on real roads and paths. |
| **Route** | Walking route and time between two points, today and with the changes. |
| **Green, water and energy** | Trees planted and lost, CO₂ taken up, solar kWp/kWh/CO₂, rainwater harvested, storm runoff. |
| **Buildings and roads** | New floor area and people, demolitions, new roads and junctions. |
| **Checks** | Buildings on buildings, roads or ponds; roads that do not join the network or cut through buildings; trees in the way; amenities far from any path; rooftop items not on a roof. |

Unticked categories stay on the map as grey markers and are left out of the simulation, the budget and the report, so you can test one idea at a time or several together.

### Targets ("What works")

Defaults: Wi-Fi 95% good signal, lighting 90% of road to standard, each amenity 60% of people within reach, at most 10 trees lost, no conflicts, and the total within the budget available (when set). Change any of them in the Simulate tab; they are saved with the scenario.

## Budget

- Quantities come from the map: counts, metres of road, square metres of area, kWp of solar, m² of roof.
- Rates are indicative 2026 figures: change them in the Budget or Types tab. Your rates, upkeep percentages and walking reaches are saved in the scenario.
- **Other costs** are free lines for anything not on the map (survey, design, labour, software, training).
- Total = items + other costs + contingency, plus taxes. The running cost is upkeep plus electricity.

## Scenarios, files and links

- Scenarios are kept in your browser. **Duplicate** one to try a variation, then **Compare all scenarios** in the Report tab to see cost and targets met side by side.
- **Save scenario file** downloads GeoJSON (it opens in QGIS and back in the Sandbox). The format is in [plan-format.md](plan-format.md). Opening a file, a share link or a sample always makes a new scenario.
- **Copy share link** puts the whole scenario in a link (`#plan=...`).
- **Scenario report** opens a printable page: what works, changes, results today and with the changes, budget, and how it was simulated.

From the command line:

```bash
cd twin && cargo build --release
./target/release/twin sim ../scenarios/hostel-wifi.geojson          # summary (Markdown)
./target/release/twin sim ../scenarios/hostel-wifi.geojson --json   # every number
```

## How the models work (and their limits)

- **Wi-Fi**: log-distance path loss from a 1 m reference (40.0 dB at 2.4 GHz, 47.3 dB at 5 GHz) plus 10 / 14 dB per exterior wall, 0.45 / 0.70 dB per metre inside a building and 15–16 dB for the first floor slab (+4–5 dB per further slab), in the style of ITU-R P.1238. Interior walls are not mapped; the per-metre loss stands in for them. A planning estimate: confirm with a site survey.
- **Lighting**: each light lights an elongated patch along the nearest road (Gaussian footprint 1.6 × mounting height along, 0.8 × across, 60% of the lamp output reaching the ground). A 9,000 lm light at 8 m every 30 m averages about 15 lux. Building shadows and trees are ignored.
- **Walking access**: shortest paths on the OSM road and path network plus your new roads; informal shortcuts are not in the network. People are estimated from floor area (for example 12 m² per hostel resident).
- **Costs** are indicative planning rates; use quotations for real spending.

## Extending it

- Built-in types, rates, walking reaches and assumptions: `twin/sim/src/catalog.rs` (the page builds its tools and forms from it).
- Models: `twin/sim/src/engine.rs`; road network logic: `graph.rs`.
- Page side (drawing, 3D, panels, report): `campus/js/plan.js`.
- Rebuild the engine for the page with `twin sim-pack` (needs `rustup target add wasm32-unknown-unknown` once), then `twin bundle` for the single-file HTML.
