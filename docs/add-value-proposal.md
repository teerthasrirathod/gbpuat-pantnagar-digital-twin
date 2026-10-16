# ADD VALUE 2026 proposal (draft)

*University Project Competition "ADD VALUE" 2026, University Planning and Technical Cell, GBPUAT. Last date for submission: 20 October 2026. Team details (section 9) still need filling in, and the budget lines checking against current prices.*

## 1. Project title

**Pantnagar Sandbox: a digital twin of the campus to try every change before spending on it**

Theme: beyond the suggested list. One tool that serves every suggested theme, from Wi-Fi in hostels and campus lighting to bicycle sharing, waste, water and tree tagging.

## 2. Problem statement

Changes to the campus are decided from drawings, site walks and rough estimates. There is no shared, up-to-date digital model of the campus with its buildings, trees, roads and installed equipment, and no way to test an idea before paying for it. So:

- the benefit of a project (rooms with good Wi-Fi, road length lit to standard, students within reach of a bicycle dock or a bin) is guessed, not measured;
- alternatives are hard to compare, and budgets are set before anyone knows what will actually work;
- problems appear after installation: dead zones, dark gaps between poles, facilities nobody can reach, buildings that cut trees or block paths;
- what already exists (access points, street lights, trees) is not recorded digitally, so every project starts from zero.

## 3. Objectives

1. An open, offline 3D digital twin of the campus (10,845 buildings, 44,164 mapped trees, 212 km of roads and paths) that runs on any laptop or phone.
2. A sandbox where anyone can change the campus on the twin, simulate the effect, check it against targets, and only then set the budget.
3. Field validation of the Wi-Fi and lighting models, and digital records of what exists (access points, street lights, tagged trees).
4. Hand-over to the University Planning and Technical Cell, with training, as a standing planning tool.
5. A path to live simulation of traffic and activity with AI models (roadmap, section 4).

## 4. Proposed solution

**Already built and working (version 2.0, open source):**

- **The twin.**
  - Every building modelled from its own footprint (OpenStreetMap, Google and Microsoft footprints, Google 2.5D heights).
  - Trees from Meta/WRI canopy height, plus terrain, ponds and drainage.
  - Blocks with building, road, water and tree counts.
  - Street view for walking and driving the roads.
- **The Sandbox.**
  - **Design:**
    - draw buildings, roads and areas;
    - add floors to a building, demolish it, or tag and remove trees;
    - place Wi-Fi access points, street lights, cameras, bicycle docks, shuttle stops, EV chargers, vending machines, water points, bins, benches, rooftop solar and rainwater harvesting.
    - New roads join the road network.
  - **Item types:** every type's cost, yearly upkeep and walking reach can be edited, and anyone can create new item types and categories, e.g. "sanitary pad vending machine" under Amenities.
  - **Simulate** any combination of categories:
    - Wi-Fi signal floor by floor, with automatic access-point placement;
    - street lighting against IS 1944, with a night view;
    - walking access to every amenity on the real path network, and routes;
    - trees, CO₂, solar, rainwater and storm runoff;
    - automatic conflict checks.
  - **What works:** each result is checked against an editable target (✓ or ✗), including staying within the budget.
  - **Budget:**
    - quantities come from the map; rates are editable;
    - extra cost lines, contingency, taxes and the budget limit;
    - running cost, and solar payback.
  - **Scenarios:** keep several, duplicate and compare them; print a scenario report; share as a file (GeoJSON, opens in QGIS) or a link.
  - **Engine:** written in Rust, runs in the browser (WebAssembly) and from the command line.

**Roadmap:**

| Version | Adds |
| --- | --- |
| 2.0 (now) | Twin + Sandbox as above |
| 3 | Field-calibrated models; layers of what exists (access points, street lights, 500 tagged trees with QR codes); indoor floor plans for hostels; sun and shade |
| 4 | Pantnagar township beyond the campus; water supply, drainage and power networks; footfall from timetables and events; shared online scenarios for teams |
| 5 | **Live simulation of traffic and activity**: agent-based movement of people and vehicles on the road network; AI models trained on counts and sensor data; an AI assistant that proposes and tests changes ("fix the dark spots on this road for under ₹10 lakh") |

## 5. Implementation methodology

| Weeks | Activity | Output |
| --- | --- | --- |
| Done | Version 2.0: twin, Sandbox, engine, six sample scenarios | Working tool, open source |
| 1-4 | **Validation**: Wi-Fi signal measured with phone analyser apps at marked points in two hostels; lux readings on about 2 km of lit road at night; models tuned | Calibrated models, published error |
| 3-8 | **Mapping what exists**: with the computer centre and the estate office, record access points and street lights; tree tagging pilot with weatherproof QR tags on about 500 trees linked to their records in the twin | Baseline layers, 500 tagged trees |
| 6-10 | **Use**: two workshops for student teams and offices; each team tests its own ideas and prints its report | Scenarios and reports from users |
| 10-12 | **Hand-over**: touchscreen kiosk in the library running the twin; documentation; training for Planning and Technical Cell staff | Kiosk, trained users |
| Next | Versions 3 to 5 as in the roadmap | |

## 6. Estimated budget

| Item | Quantity | Rate (₹) | Cost (₹) |
| --- | --- | --- | --- |
| Digital lux meter | 2 | 3,000 | 6,000 |
| Weatherproof QR tree tags with fixings | 500 | 40 | 20,000 |
| Measuring wheel and survey markers | 1 set | 4,000 | 4,000 |
| Printing: survey sheets, A1 campus maps, workshop posters | - | - | 6,000 |
| Workshops (two, about 60 participants each) | 2 | 5,000 | 10,000 |
| Touchscreen kiosk for the library (43" display, mini PC, stand) | 1 | 1,20,000 | 1,20,000 |
| Contingency (10%) | | | 16,600 |
| **Total** | | | **1,82,600** |

Without the kiosk: about ₹50,000. Software, data and hosting cost nothing: the tool is open source, uses open data, and runs offline or on free static hosting.

## 7. Expected outcomes

- **Decisions tested before money is spent.** The sample scenarios already show the kind of answers the Sandbox gives:
  - good Wi-Fi on every floor of the 16 mapped hostels needs about 183 access points (about ₹59 lakh);
  - lighting the streets around the library to IS 1944 needs about 334 LED lights (about ₹1.6 crore);
  - 19 bicycle docks put about half of the campus population within a 5-minute walk.

  These are planning estimates, which validation will check.
- **Budgets that fit.** Every scenario carries its own bill of quantities, running cost and targets, so options can be compared side by side and trimmed to the money available.
- **Measured accuracy**: published error of the Wi-Fi model (target ±6 dB) and lighting model (target ±30%) after tuning.
- **Digital records** of existing access points, street lights and 500 tagged trees.
- **One tool for every campus theme**, open to every student team and office.

## 8. Sustainability and replicability

- **No running cost**: runs offline in a browser; data refreshes with one command from open sources.
- **Open and maintainable**: MIT licence; code and documentation on GitHub. A student club can maintain it; scenarios submitted by pull request are checked automatically.
- **Lasting records**: scenarios are standard GeoJSON, readable by any GIS.
- **Replicable**: the pipeline is generic. Point it at another boundary (any census village or town) to build a twin of Pantnagar township, other GBPUAT stations or another university.

### Fit with the evaluation criteria

| Criterion | How the project meets it |
| --- | --- |
| Innovativeness | A campus digital twin with built-in simulation, targets and budgeting, made by students and open to all; nothing like it exists for the campus today |
| Feasibility | Version 2.0 already works; the funded work is measurement, mapping and training with standard instruments |
| Replicability | Works for any building, department or campus; every other project can use it |
| Cost-effectiveness | About ₹1.8 lakh (₹50,000 without the kiosk), against projects worth crores that it helps size correctly |

## 9. Team details

| Name | Programme | Department / college | Contact |
| --- | --- | --- | --- |
| | | | |
| | | | |
| | | | |

Mentor:

## Limits to state honestly

- Building footprints and heights are satellite-derived and can be wrong; interior walls are not mapped, so Wi-Fi results are estimates until checked on site.
- Street lights drawn in the normal view are illustrative; real lights must be mapped.
- Costs are indicative and need quotations; people per building are estimated from floor area.
