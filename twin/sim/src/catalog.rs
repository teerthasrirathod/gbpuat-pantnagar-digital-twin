//! What can be placed in a plan, its parameters, indicative unit costs and model assumptions.
//! Costs are indicative 2026 figures for planning only; every rate can be overridden per
//! scenario (`sandbox.costs`), and teams should replace them with real quotations.

use serde_json::{json, Value};

pub fn catalog() -> Value {
    let types = "$types";
    json!({
        "version": 1,
        "groups": [
            ["buildings", "Buildings & land"], ["roads", "Roads & paths"], ["wifi", "Wi-Fi & network"], ["lighting", "Lighting & safety"],
            ["mobility", "Mobility"], ["amenities", "Amenities"], ["waste", "Waste"], ["water", "Water"], ["energy", "Energy"],
            ["trees", "Trees & green"], ["notes", "Notes"]
        ],
        "kinds": [
            { "key": "building", "label": "Building", "group": "buildings", "geom": "polygon",
              "help": "Draw the footprint corner by corner. Double-click or press Enter to finish.",
              "params": [
                { "key": "type", "label": "Use", "type": "select", "options": types, "default": "academic" },
                { "key": "floors", "label": "Floors", "type": "number", "default": 3, "min": 1, "max": 20, "step": 1 }
              ] },
            { "key": "road", "label": "Road or path", "group": "roads", "geom": "line",
              "help": "Click along the route. Ends within 12 m of a road join it; crossings become junctions.",
              "params": [
                { "key": "type", "label": "Type", "type": "select", "default": "lane",
                  "options": [["footpath", "Footpath (1.8 m)"], ["cycle_track", "Cycle track (2.5 m)"], ["lane", "Single lane (3.75 m)"], ["two_lane", "Two-lane road (7 m)"]] },
                { "key": "lights", "label": "Street lights every", "type": "select", "default": "0",
                  "options": [["0", "No lights"], ["25", "25 m"], ["30", "30 m"], ["40", "40 m"]] }
              ] },
            { "key": "area", "label": "Area", "group": "buildings", "geom": "polygon",
              "help": "Draw the outline. Double-click or press Enter to finish.",
              "params": [
                { "key": "use", "label": "Use", "type": "select", "default": "garden",
                  "options": [["garden", "Garden / landscaping"], ["parking", "Parking"], ["plaza", "Paved plaza"], ["sports", "Sports court"], ["solar_farm", "Ground solar"], ["rain_garden", "Rain garden / recharge pond"]] }
              ] },
            { "key": "wifi_ap", "label": "Wi-Fi access point", "group": "wifi", "geom": "point",
              "help": "Inside a building it is mounted on the ceiling of the chosen floor; outside, on a pole.",
              "params": [
                { "key": "band", "label": "Band", "type": "select", "default": "5", "options": [["2.4", "2.4 GHz (range)"], ["5", "5 GHz (speed)"]] },
                { "key": "power", "label": "Transmit power", "type": "number", "default": 20, "min": 8, "max": 27, "step": 1, "unit": "dBm" },
                { "key": "floor", "label": "Floor (indoors)", "type": "number", "default": 0, "min": 0, "max": 19, "step": 1 },
                { "key": "pole", "label": "Pole height (outdoors)", "type": "number", "default": 6, "min": 2, "max": 20, "step": 0.5, "unit": "m" }
              ] },
            { "key": "street_light", "label": "Street light", "group": "lighting", "geom": "point",
              "params": [
                { "key": "lumens", "label": "Light output", "type": "number", "default": 9000, "min": 1000, "max": 30000, "step": 500, "unit": "lm" },
                { "key": "watts", "label": "Power", "type": "number", "default": 70, "min": 10, "max": 250, "step": 5, "unit": "W" },
                { "key": "height", "label": "Mounting height", "type": "number", "default": 8, "min": 3, "max": 14, "step": 0.5, "unit": "m" },
                { "key": "supply", "label": "Supply", "type": "select", "default": "grid", "options": [["grid", "Grid"], ["solar", "Solar with battery"]] }
              ] },
            { "key": "cctv", "label": "CCTV camera", "group": "lighting", "geom": "point",
              "params": [
                { "key": "range", "label": "Useful range", "type": "number", "default": 30, "min": 5, "max": 120, "step": 5, "unit": "m" },
                { "key": "heading", "label": "Facing", "type": "number", "default": 0, "min": 0, "max": 359, "step": 5, "unit": "°" },
                { "key": "fov", "label": "Field of view", "type": "number", "default": 90, "min": 20, "max": 360, "step": 5, "unit": "°" }
              ] },
            { "key": "ev_charger", "label": "EV charger", "group": "mobility", "geom": "point", "params": [] },
            { "key": "bike_dock", "label": "Bicycle dock", "group": "mobility", "geom": "point",
              "params": [{ "key": "docks", "label": "Bicycles", "type": "number", "default": 10, "min": 2, "max": 40, "step": 1 }] },
            { "key": "shuttle_stop", "label": "E-shuttle stop", "group": "mobility", "geom": "point", "params": [] },
            { "key": "vending", "label": "Vending machine", "group": "amenities", "geom": "point", "params": [] },
            { "key": "water_point", "label": "Drinking water point", "group": "water", "geom": "point", "params": [] },
            { "key": "bin", "label": "Waste bins (wet + dry)", "group": "waste", "geom": "point", "params": [] },
            { "key": "bench", "label": "Bench", "group": "amenities", "geom": "point", "params": [] },
            { "key": "note", "label": "Note", "group": "notes", "geom": "point",
              "params": [{ "key": "text", "label": "Text", "type": "text", "default": "" }] },
            { "key": "tree", "label": "Plant a tree", "group": "trees", "geom": "point",
              "params": [{ "key": "species", "label": "Species", "type": "text", "default": "Neem" }] },
            { "key": "solar_roof", "label": "Rooftop solar", "group": "energy", "geom": "on-building",
              "help": "Click a roof. Uses the share of the roof you set.",
              "params": [{ "key": "share", "label": "Roof used", "type": "number", "default": 50, "min": 5, "max": 90, "step": 5, "unit": "%" }] },
            { "key": "rwh", "label": "Rainwater harvesting", "group": "water", "geom": "on-building",
              "help": "Click a roof: collects its rain into a tank and recharge pit.", "params": [] },
            { "key": "tree_tag", "label": "Tag a tree", "group": "trees", "geom": "on-tree", "status": "existing",
              "help": "Click a mapped tree to give it an ID and record what it is.",
              "params": [
                { "key": "species", "label": "Species", "type": "text", "default": "" },
                { "key": "girth", "label": "Girth at 1.4 m", "type": "number", "default": 0, "min": 0, "max": 2000, "step": 5, "unit": "cm" },
                { "key": "health", "label": "Health", "type": "select", "default": "good", "options": [["good", "Good"], ["fair", "Fair"], ["poor", "Poor"], ["dead", "Dead"]] }
              ] },
            { "key": "tree_remove", "label": "Remove a tree", "group": "trees", "geom": "on-tree", "params": [] },
            { "key": "building_edit", "label": "Change a building", "group": "buildings", "geom": "on-building",
              "help": "Click a building to add floors or change its use.",
              "params": [
                { "key": "floors", "label": "Floors", "type": "number", "default": 0, "min": 1, "max": 20, "step": 1 },
                { "key": "type", "label": "Use", "type": "select", "options": types, "default": "" }
              ] },
            { "key": "demolish", "label": "Demolish a building", "group": "buildings", "geom": "on-building", "params": [] }
        ],
        "rates": {
            "building": { "label": "New floor area", "unit": "m²", "rate": 28000, "maint": 1.0 },
            "building_add": { "label": "Added floors (vertical extension)", "unit": "m²", "rate": 30000, "maint": 1.0 },
            "demolish": { "label": "Demolition and debris removal", "unit": "m²", "rate": 900, "maint": 0 },
            "road:footpath": { "label": "Footpath, interlocking pavers 1.8 m", "unit": "m", "rate": 3600, "maint": 2.0 },
            "road:cycle_track": { "label": "Cycle track 2.5 m", "unit": "m", "rate": 5200, "maint": 2.0 },
            "road:lane": { "label": "Single-lane road 3.75 m", "unit": "m", "rate": 14000, "maint": 3.0 },
            "road:two_lane": { "label": "Two-lane road 7 m with drains", "unit": "m", "rate": 30000, "maint": 3.0 },
            "area:garden": { "label": "Landscaping", "unit": "m²", "rate": 650, "maint": 8.0 },
            "area:parking": { "label": "Paved parking", "unit": "m²", "rate": 1900, "maint": 2.0 },
            "area:plaza": { "label": "Paved plaza", "unit": "m²", "rate": 2500, "maint": 2.0 },
            "area:sports": { "label": "Sports court", "unit": "m²", "rate": 3200, "maint": 3.0 },
            "area:solar_farm": { "label": "Ground-mounted solar", "unit": "kWp", "rate": 48000, "maint": 1.5 },
            "area:rain_garden": { "label": "Rain garden / recharge pond", "unit": "m²", "rate": 1500, "maint": 4.0 },
            "wifi_ap": { "label": "Wi-Fi 6 access point with PoE and cabling", "unit": "each", "rate": 32000, "maint": 6.0, "kwh": 130 },
            "street_light": { "label": "LED street light with pole and cabling", "unit": "each", "rate": 42000, "maint": 3.0 },
            "street_light:solar": { "label": "Solar LED street light", "unit": "each", "rate": 62000, "maint": 4.0 },
            "cctv": { "label": "CCTV camera with recording share", "unit": "each", "rate": 28000, "maint": 6.0, "kwh": 90 },
            "ev_charger": { "label": "EV charger (7 kW AC) with civil work", "unit": "each", "rate": 150000, "maint": 4.0 },
            "bike_dock": { "label": "Bicycle-sharing dock with a new bicycle, rack and lock (per bicycle; refurbished bicycles cost far less)", "unit": "bicycle", "rate": 28000, "maint": 10.0 },
            "shuttle_stop": { "label": "E-shuttle stop with shelter", "unit": "each", "rate": 180000, "maint": 3.0 },
            "vending": { "label": "Vending machine with base", "unit": "each", "rate": 150000, "maint": 5.0, "kwh": 1800 },
            "water_point": { "label": "RO drinking-water point", "unit": "each", "rate": 110000, "maint": 8.0, "kwh": 600 },
            "bin": { "label": "Twin waste bins (wet + dry)", "unit": "each", "rate": 9000, "maint": 10.0 },
            "bench": { "label": "Bench", "unit": "each", "rate": 12000, "maint": 3.0 },
            "tree": { "label": "Sapling with guard and two years of care", "unit": "each", "rate": 1500, "maint": 0 },
            "tree_remove": { "label": "Tree removal (with permission)", "unit": "each", "rate": 3000, "maint": 0 },
            "solar_roof": { "label": "Rooftop solar", "unit": "kWp", "rate": 50000, "maint": 1.5 },
            "rwh": { "label": "Rainwater harvesting (gutters, filter, tank, recharge pit)", "unit": "m² roof", "rate": 320, "maint": 3.0 }
        },
        "facilities": {
            "bike_dock": 300, "shuttle_stop": 400, "vending": 250, "water_point": 200, "bin": 100, "ev_charger": 500, "bench": 150
        },
        "people_m2": {
            "hostel": 12, "academic": 8, "school": 8, "admin": 15, "institutional": 20, "residential": 30, "house": 35, "health": 20, "commercial": 25, "sports": 50
        },
        "assumptions": {
            "rain_mm": { "label": "Annual rainfall", "unit": "mm", "value": 1430 },
            "storm_mm": { "label": "Design storm", "unit": "mm", "value": 50 },
            "runoff_roof": { "label": "Roof runoff coefficient", "unit": "", "value": 0.8 },
            "tariff": { "label": "Electricity tariff", "unit": "₹/kWh", "value": 8.0 },
            "solar_yield": { "label": "Solar yield", "unit": "kWh/kWp/yr", "value": 1450 },
            "grid_co2": { "label": "Grid emission factor", "unit": "kg CO₂/kWh", "value": 0.716 },
            "tree_co2": { "label": "CO₂ taken up by a grown tree", "unit": "kg/yr", "value": 21.8 },
            "light_hours": { "label": "Street lights on", "unit": "h/night", "value": 11.5 },
            "walk_speed": { "label": "Walking speed", "unit": "m/s", "value": 1.33 }
        },
        "models": {
            "wifi": "Log-distance path loss from 1 m reference (40.0 dB at 2.4 GHz, 47.3 dB at 5 GHz, exponent 2) plus 10/14 dB per exterior wall, 0.45/0.70 dB per metre inside a building, and 15/16 dB for the first floor slab with 4/5 dB for each further slab (ITU-R P.1238 style). Access point antenna gain 2 dBi. Good: -67 dBm or better (calls and video). Usable: -75 dBm.",
            "light": "Each light lights an elongated patch of road: a Gaussian footprint 1.6 × mounting height along the road and 0.8 × across it, carrying 60% of the lamp output (maintenance 0.8 × light output ratio 0.75). A 9,000 lm light at 8 m spaced 30 m apart then averages about 15 lux, as in usual LED street-light design. Targets from IS 1944: 15 lux on main roads, 8 lux on campus streets, 4 lux on tracks and paths. Building shadows are ignored.",
            "access": "Shortest walking distance on the road and path network (new roads included) from each building to the nearest facility. People are estimated from floor area per type.",
            "green": "Rooftop solar: 1 kWp per 10 m² of usable roof. Rainwater: roof area × rainfall × runoff coefficient. Storm runoff change uses runoff coefficients 0.9 roofs, 0.85 roads and paving, 0.3 open ground."
        }
    })
}
