# Sample scenarios

Open any of these in the Sandbox (**Plan → Report → Sample scenarios**, or **Open scenario file**); each opens as a new scenario, or evaluate it with `twin sim <file>`. They were made in the Sandbox itself and are starting points, not approved designs.

| File | Contest theme | What it shows |
| --- | --- | --- |
| `hostel-wifi.geojson` | Robust Wi-Fi in Hostels | 183 access points placed floor by floor by **Suggest access points**: good signal in 96% of the floor area of the 16 mapped hostels |
| `campus-lighting.geojson` | Strengthening Campus Lighting | 334 LED street lights every 30 m on the streets within 600 m of the library, a quarter solar |
| `bicycle-sharing.geojson` | Public Bicycle Sharing System | 19 docks for refurbished abandoned bicycles beside hostels, colleges, the library, the stadium and the market |
| `green-campus.geojson` | Water Recycling in Hostels | Rainwater harvesting on 15 hostels, rooftop solar on the library, an avenue of native trees |
| `waste-and-water.geojson` | Waste Recycling | Twin bins outside hostels and colleges, drinking-water points and vending machines |
| `new-hostel-block.geojson` | Other (new building) | A 4-storey hostel sited clear of buildings, roads and trees, with a lit footpath, Wi-Fi, solar and rainwater harvesting |

## Add your scenario

1. Make it in the Sandbox and describe it in the **Report** tab.
2. **Save scenario file** and put it here with a short, lower-case name (`library-reading-garden.geojson`).
3. Open a pull request. The `sandbox` workflow evaluates every changed scenario and writes the summary into the run, so reviewers see the numbers.
4. Run `twin sim-pack` (or ask a maintainer) to add it to the samples in the app.
