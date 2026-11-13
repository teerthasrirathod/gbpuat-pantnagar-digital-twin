# Decision log (v3 build)

Each entry: the decision, why, and what would change it. Newest last.

1. **`apps/web` is the v3 application; `campus/` is frozen as the legacy viewer.** The goal file says to grow the WebGPU viewer instead of starting over. The legacy viewer keeps building and receives fixes only.
2. **The traffic model lives in the Rust engine, not in SUMO.** The demo and the Plan-mode what-ifs must run in the browser with no backend, deterministically, and with native/WASM parity. A SUMO adapter (Cloud Run job, same `TrafficSummary` output) is specified in `pipelines/` as a later validation path, not as the product's engine. Revisit when real counts exist and a calibration comparison can be made.
3. **Whole campus as 500 m tiles in the existing hero file shape.** The hero loader, scene builders and tests are already data-driven on that shape, so tiling is a data change. Tiles stream by distance with level of detail.
4. **Scenario schema v2 is additive.** Every v1 file stays valid. New data sits under new `sandbox` keys and new item kinds.
5. **Provenance is a type, not a convention.** Inputs are `Quantity` objects; an unknown input blocks the results that need it instead of being guessed.
6. **Replay first.** Planner, feed, forecast and farms each have a committed replay source in the same contract shape as the live source. The demo runs on replay. Live sources switch on by configuration.
7. **Region `asia-south1` (Mumbai), project `pantnagar-twin`.** Closest region to the users. The project exists; billing is not linked yet, so nothing is deployed and all cloud code is tested against emulators and recorded fixtures.
8. **Gaussian-splat capture, sensor installation, traffic counts, crop ground truth and utility surveys are v3.1 field work.** The software for each is built now and runs on labelled synthetic or fixture data.
9. **No GBPUAT branding.** The product name is "Pantnagar Twin". Every page and export carries the independent-study line.
10. **Node 22 in the build sandbox, Node 24 required by `package.json`.** Tests are run on 22 here and the difference is reported; CI pins 24.
