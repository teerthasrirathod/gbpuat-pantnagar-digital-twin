# Contributing

The twin is meant to be a shared, open model of Pantnagar that anyone can use to plan and test ideas. Contributions of every size help.

## Scenarios

Made something in the Sandbox? Save the scenario file and add it to [`scenarios/`](scenarios/README.md) in a pull request. The `sandbox` workflow evaluates it, so reviewers see its numbers without opening it.

## Corrections to the map

Most of the base data comes from open sources, and fixing the source fixes the twin for everyone:

- **Buildings, roads, names, ponds**: edit [OpenStreetMap](https://www.openstreetmap.org/#map=15/29.0205/79.4935). The twin picks up changes on the next `twin fetch osm` and `twin build`.
- **What exists on the ground** (real Wi-Fi access points, street lights, bins, trees): map them in the Sandbox with status **Existing** and share the scenario file. Surveyed layers can become part of the base model.
- **Wrong building type or height**: open an issue with the building's location (the card's map link) and what it should be.

## Code

| Area | Where |
| --- | --- |
| Data pipeline (fetch, analysis, packing) | `twin/src` (Rust) |
| Simulation engine (models, catalogue, scenario format) | `twin/sim/src` (Rust, also built to WebAssembly by `twin/sim-wasm`) |
| 3D viewer and street view | `campus/js/campus.js` |
| Plan mode (tools, 3D items, panels, report) | `campus/js/plan.js` |

Build and run:

```bash
rustup target add wasm32-unknown-unknown   # once
cd twin
cargo build --release
./target/release/twin sim-pack             # engine + examples for the page
./target/release/twin bundle               # single-file GBPUAT-Campus-3D.html
./target/release/twin serve 8090           # then open http://localhost:8090/
```

Guidelines:

- Keep the viewer offline-capable: data as scripts, no network calls at run time.
- Keep rendering light (merged geometry, levels of detail, render on demand); the target machine has integrated graphics.
- Rust dependencies must be pure Rust (the Windows GNU toolchain here has no C compiler).
- New model? Document its equations and limits in `docs/sandbox.md` and the catalogue's `models` text, which also goes into every report.
- Say where numbers come from. Indicative values (rates, occupancy) must be editable and labelled as indicative.
