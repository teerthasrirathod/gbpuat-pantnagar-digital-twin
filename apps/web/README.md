# apps/web: the next-generation viewer

A WebGPU renderer (three.js r186 with node materials, and an automatic WebGL2 fallback) for the Library avenue and the old colleges, built beside the current viewer in `campus/`. It is written in TypeScript, bundled with Vite, linted with Biome and tested with Vitest and Playwright.

```
npm install          # once, from the repository root
npm run dev          # http://127.0.0.1:5173/
npm run check        # lint, types, unit tests
npm run build        # apps/web/dist (about 1.2 MB of script, 343 KB gzipped, plus the hero data)
npm run e2e          # builds, then opens the production build in a browser (set PW_CHANNEL=chrome to use an installed Chrome)
```

## Address options

`/#street=x,z,heading` start pose (metres from the campus origin, heading in radians) · `#view` start in orbit · `#t=10.5` hour in India Standard Time (or `#t=now`) · `#wx=clear|cloudy|rain|storm|fog` preview a weather situation · `#q=off|medium|high` force the image quality · `#gov=on|off` the resolution governor (off by default under automation) · `#perf` show GPU milliseconds · `#renderer=webgl` use the WebGL2 backend.

## What is in it

- **Image**: render pipeline with ambient occlusion, temporal anti-aliasing and bloom; cascaded sun shadows; AgX tone mapping with adaptive exposure; a quality governor that trades resolution for frame rate.
- **Sky**: the real sun, moon (position and phase) and about 65 catalogue stars plus a Milky Way band, for the date and time over Pantnagar; clouds, overcast, fog and rain from the weather.
- **Weather**: six model points around Pantnagar from Open-Meteo (or the file stored by the scheduled job), interpolated in time and place; drives clouds, light, haze, wet ground, wind and rain.
- **Buildings**: footprints and heights from open data, drawn with recessed windows, furnished rooms behind the glass, sunshades, cornices and lit windows at night. Click one to see what the data says about it and how sure it is.
- **Ground and plants**: procedural soil, lawn, asphalt and paving from baked noise; real grass tufts around the camera; six illustrative tree species with wind.
- **Life**: lamp posts, benches, parked and moving vehicles and walking people. These are illustrative scene dressing placed by seeded rules, not survey data, and the interface says so.

## Layout

| Folder | What |
| --- | --- |
| `src/core` | pure maths: geometry, sun, moon, clock, spatial index, random numbers |
| `src/data` | the hero data file and its types |
| `src/render` | renderer, post-processing pipeline, quality governor |
| `src/scene` | everything that is drawn (ground, buildings, facade shader, trees, grass, props, sky, night sky, rain) |
| `src/weather` | weather data, interpolation, simulation and loading |
| `src/nav` | street walking and building picking |
| `src/ui` | the interface (plain DOM and CSS) |
| `../../scripts/export-hero.mjs` | exports the hero window from the campus data |
| `../../tools/dev` | helpers to look at the app on a real GPU |

## Data and licences

The hero data is exported from the campus data set; its sources and licences are listed in the app's Help sheet. Sun, moon and star positions are calculated here. Weather comes from Open-Meteo (CC BY 4.0).
