# Pantnagar Sandbox

**Try a change to Pantnagar on its digital twin, see what works and what does not, and only then put a budget on it.**

Plan mode (the **Try an idea** button, or the `P` key) in the campus twin (`GBPUAT-Campus-3D.html` or `campus/index.html`) is a simulation sandbox. It is written for people who are not technical: a four-step path, plain-language results, and Undo instead of "are you sure" boxes. You work the way an owner of the place would:

1. **Goal**: say what you want to improve (Wi-Fi in hostels, street lighting, cycle sharing, water, solar and trees, bins and drinking water, or a new building), or start from a ready-made example.
2. **Changes**: add things to the map. Each goal has a one-click quick start ("Place Wi-Fi in all the hostels for me", "Add rainwater harvesting to all the hostels") and puts its own tools first.
3. **Results**: see what the changes achieve against your targets, as sentences with a word and a symbol as well as a colour, and what it costs. The detailed numbers, maps and cost lines are one click further down.
4. **Share**: make a printable report, copy a link, save a file, compare plans.

Everything runs in the browser and works offline. The simulation engine is written in Rust (`twin/sim`) and runs as WebAssembly in the page and as a command-line tool (`twin sim`). The design reasoning is in [plan-ux-design.md](plan-ux-design.md).

## The panel

| Step | What it is for |
| --- | --- |
| **1 Goal** | Pick what to improve, or open an example. First-time visitors can take a one-minute tour. |
| **2 Changes** | The quick start for the goal, then **Add things to the map** (the eight most useful first, everything else under *More things you can add*, including your own kinds of item), then **Your changes**: every item you added, with Remove. Click an item on the map or in the list for its card: name, settings, *New* or *Already there*, arrows to move it 2 m, **Pick a new spot**, copy, remove. |
| **3 Results** | One card per result, in words: *"With your Wi-Fi points, 96% of the floor area … gets a signal good enough for a video call, up from 0% today."* Each has a gauge (today, your target, your plan), a status word (Target met, Almost there, Not there yet) and buttons to show it on the map. Below the cards, folded away: **Show the numbers and the maps** (the full simulation: categories to include, targets you can edit, Wi-Fi coverage, street lighting, walking access, routes, green/water/energy, buildings and roads, model assumptions), **Cost, line by line** (budget available, contingency, taxes, editable rates, other cost lines, CSV) and **Rates, upkeep and your own item types**. |
| **4 Share** | A checklist of what is ready, notes on what the plan is for, **Make a printable report**, **Copy a link to share**, **Save as a file**, **Open a saved file**, **Compare my plans side by side**, and **Start from a ready-made example**. |

The plan name sits at the top; **Plans** opens your saved plans (open, new, copy, delete). **Today / With this plan** switches the whole map, and the strip under the steps (the headline result for your goal, the cost, targets met) is always visible and updates as you work. **Undo** and **Redo** are always at the top; **Help** has the four steps, a word list and an honest note on accuracy; **Display** sets text size, stronger contrast, less movement and whether letter-key shortcuts are on.

## Designing

- **One placement, then done.** Choose something, click on the map where it goes, and the tool switches off with an **Undo** message. Tick **Keep adding** (in the bar at the bottom of the map) to place several.
- **Without a mouse click**: a cross marks the middle of the screen while you place something. `Enter` or `Space` puts it there; move the map with `W A S D` or the arrow keys first. For buildings, areas and roads each press adds a point and `Enter` finishes.
- **Buildings and areas**: three clicks make a rectangle (corner, corner, depth); **Any shape** clicks every corner; **Finish**, `Enter` or a double-click finishes. A building drawn from far above can be far too large, so the card warns when it is.
- **Roads and paths**: click along the route. Ends within 12 m of a road join it, and crossings become junctions, so new roads are part of the network: street view walks and drives on them, and routes use them.
- **On a building** (rooftop solar, rainwater harvesting, change floors or use, remove a building) and **on a tree** (record, remove): click it.
- **Light a whole road**: click a mapped road to line it with street lights, one every 25–40 m.
- Click anything you added to edit it. Drag the selected item, or its corner handles, to move it, or use the arrows on its card. `Delete` removes, `Ctrl+Z` undoes, `Ctrl+D` copies. Removing never asks "are you sure": it says what it removed and offers Undo.
- Dragging the map moves it; right-drag (or Shift-drag) turns it.

**Existing** items are things already on the ground but missing from the map (real access points, street lights, tagged trees). They count as *today*, so results show what your changes add. The street lights drawn in the normal view are illustrative and do not count.

## Simulating

These are the models behind the Results step (the detail is under *Show the numbers and the maps*).

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

Defaults: Wi-Fi 95% good signal, lighting 90% of road to standard, each amenity 60% of people within reach, at most 10 trees lost, no conflicts, and the total within the budget available (when set). Change any of them under *Show the numbers and the maps* on the Results step; they are saved with the plan.

## Budget

- Quantities come from the map: counts, metres of road, square metres of area, kWp of solar, m² of roof.
- Rates are indicative 2026 figures: change them under *Cost, line by line* or *Rates, upkeep and your own item types* on the Results step. Your rates, upkeep percentages and walking reaches are saved in the plan.
- **Other costs** are free lines for anything not on the map (survey, design, labour, software, training).
- Total = items + other costs + contingency, plus taxes. The running cost is upkeep plus electricity.

## Plans, files and links

- Plans are kept in your browser (a "saved on this computer" note appears at the top). **Make a copy** of one to try a variation, then **Compare my plans side by side** on the Share step to see cost and targets met together. Deleting a plan is the one place that asks first, because it cannot be undone.
- **Save as a file** downloads GeoJSON (it opens in QGIS and back in the Sandbox). The format is in [plan-format.md](plan-format.md). Opening a file, a link or an example always makes a new plan, so nothing is overwritten.
- **Copy a link to share** puts the whole plan in a link (`#plan=...`).
- **Make a printable report** opens a page: what works, changes, results today and with the changes, budget, and how it was simulated.

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
- Page side: `campus/js/plan.js` (drawing, 3D, engine calls, plans, files, report; it exposes `window.__sandbox.api` and `sandbox:*` events) and `campus/js/plan-guide.js` (the guided shell: steps, goal screen, result sentences, messages, help, tour, display settings).
- Rebuild the engine for the page with `twin sim-pack` (needs `rustup target add wasm32-unknown-unknown` once), then `twin bundle` for the single-file HTML.
