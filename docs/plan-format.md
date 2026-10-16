# Scenario file format (version 1)

A scenario is a [GeoJSON](https://datatracker.ietf.org/doc/html/rfc7946) `FeatureCollection` in WGS 84 longitude/latitude. Scenario settings sit in a `sandbox` member (GeoJSON allows extra members), and each feature is one item.

```json
{
  "type": "FeatureCollection",
  "sandbox": {
    "version": 1,
    "title": "Wi-Fi in every hostel room",
    "notes": "What this scenario tries",
    "categories_off": [],
    "targets": { "wifi": 95 },
    "budget": { "cap": 6000000, "contingency": 5, "tax": 18, "extra": [{ "label": "Survey and design", "qty": 1, "rate": 150000 }] },
    "wifi_targets": ["hostel"],
    "wifi_buildings": [[79.48497, 29.02557]],
    "costs": { "wifi_ap": 30000 },
    "assumptions": { "tariff": 7.5 }
  },
  "features": [
    {
      "type": "Feature",
      "id": "i1",
      "geometry": { "type": "Point", "coordinates": [79.4931, 29.0217] },
      "properties": { "kind": "wifi_ap", "status": "proposed", "name": "", "band": "5", "power": 20, "floor": 1, "pole": 6 }
    }
  ]
}
```

## `sandbox`

| Key | Meaning |
| --- | --- |
| `title`, `notes` | Scenario name and what it tries (top of the report) |
| `categories_off` | Categories left out of the simulation, budget and report, e.g. `["wifi"]` |
| `targets` | `wifi` (% of floor area with good signal, default 95), `light` (% of road to IS 1944, 90), `access` (% of people within reach, 60), `access_by` (per amenity type), `trees` (most trees lost, 10) |
| `budget` | `cap` (budget available in ₹; 0 = no limit), `contingency` (%, default 5), `tax` (%), `extra` (other cost lines: `{label, qty, rate}`) |
| `costs` | Rate overrides in ₹, keyed like the budget lines (`wifi_ap`, `road:footpath`, `area:garden`, `street_light:solar`…) |
| `maint` | Upkeep overrides, % of cost a year, same keys as `costs` |
| `reach` | Walking reach overrides in m by item type (`bike_dock`, `bin`…); 0 removes a type from walking access |
| `custom_kinds` | Item types made by the user: `{key, label, category, categoryLabel, geom, rate, maint, kwh, reach, color}`; `geom` is `point`, `line` or `polygon`, and the rate is per item, per metre or per m² accordingly |
| `wifi_targets` | Building types whose floor area the Wi-Fi model measures (default `["hostel"]`) |
| `wifi_buildings` | Extra buildings to measure: one `[lon, lat]` point inside each |
| `assumptions` | Model inputs: `rain_mm`, `storm_mm`, `runoff_roof`, `tariff`, `solar_yield`, `grid_co2`, `tree_co2`, `light_hours`, `walk_speed` |

## Features

Every feature has `properties.kind` and `properties.status` (`"proposed"`, the default, or `"existing"`). `name` is optional. All other properties are parameters of that kind; anything missing takes its default.

| kind | geometry | parameters (default) |
| --- | --- | --- |
| `building` | Polygon (footprint) | `type` (`academic`; any building type of the twin), `floors` (3) |
| `road` | LineString | `type`: `footpath`, `cycle_track`, `lane`, `two_lane` (`lane`); `lights`: spacing in m, `0` for none |
| `area` | Polygon | `use`: `garden`, `parking`, `plaza`, `sports`, `solar_farm`, `rain_garden` |
| `wifi_ap` | Point | `band` `"2.4"` or `"5"`, `power` dBm (20), `floor` when indoors (0), `pole` height in m when outdoors (6) |
| `street_light` | Point | `lumens` (9000), `watts` (70), `height` m (8), `supply` `grid` or `solar` |
| `cctv` | Point | `range` m (30), `heading` ° (0 = north), `fov` ° (90) |
| `ev_charger`, `shuttle_stop`, `vending`, `water_point`, `bin`, `bench` | Point | none |
| any `custom_kinds` key | Point, LineString or Polygon (as defined) | none |
| `bike_dock` | Point | `docks` (10) |
| `note` | Point | `text` |
| `tree` | Point | `species` |
| `solar_roof` | Point on a roof | `share` of the roof used, % (50) |
| `rwh` | Point on a roof | none |
| `building_edit` | Point inside an existing building | `floors`, `type` (blank keeps the current use) |
| `demolish` | Point inside an existing building | none |
| `tree_tag` | Point on a mapped tree | `species`, `girth` cm, `health` (`good`, `fair`, `poor`, `dead`) |
| `tree_remove` | Point on a mapped tree | none |

Items that act on what exists (`building_edit`, `demolish`, `solar_roof`, `rwh`, `tree_tag`, `tree_remove`) find their building or tree by position, so plans keep working when the base data is rebuilt.

The authoritative list, with labels, limits and rates, is `twin/sim/src/catalog.rs`.
