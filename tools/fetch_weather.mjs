// Fetches the weather for Pantnagar and five points about 25 km around it from Open-Meteo and writes one small JSON
// file. The scheduled job (.github/workflows/weather.yml) runs this every 30 minutes and publishes the file on the
// `weather-data` branch; the viewer (campus/js/weather.js) reads it, and falls back to calling Open-Meteo itself.
//
//   node tools/fetch_weather.mjs [out.json]
//
// Keep POINTS and the variable lists in step with campus/js/weather.js.
// Open-Meteo is free for non-commercial use and needs attribution (CC BY 4.0): https://open-meteo.com/en/terms
// These values are model estimates (ECMWF, 9 km grid), not station observations.
import fs from "node:fs";
import path from "node:path";

const POINTS = [
  { id: "pantnagar", name: "Pantnagar", lat: 29.0205, lon: 79.4935 },
  { id: "n", name: "North (foothills)", lat: 29.2467, lon: 79.4935 },
  { id: "ene", name: "East-north-east", lat: 29.0904, lon: 79.7378 },
  { id: "sse", name: "South-south-east", lat: 28.837, lon: 79.6445 },
  { id: "ssw", name: "South-south-west", lat: 28.837, lon: 79.3425 },
  { id: "wnw", name: "West-north-west", lat: 29.0904, lon: 79.2492 },
];
const CURRENT = "temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
const HOURLY = ["temperature_2m", "relative_humidity_2m", "precipitation", "weather_code", "cloud_cover", "visibility", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "wind_speed_850hPa", "wind_direction_850hPa", "shortwave_radiation", "et0_fao_evapotranspiration", "soil_moisture_9_to_27cm"];

const url = `https://api.open-meteo.com/v1/forecast?latitude=${POINTS.map((p) => p.lat).join(",")}&longitude=${POINTS.map((p) => p.lon).join(",")}&timezone=Asia/Kolkata&past_days=2&forecast_days=3&wind_speed_unit=kmh&current=${CURRENT}&hourly=${HOURLY.join(",")}`;

async function get() {
  let err;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "gbpuat-pantnagar-digital-twin (student project, non-commercial)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 4000 * attempt)); }
  }
  throw err;
}

const raw = await get();
if (!Array.isArray(raw) || raw.length !== POINTS.length) throw new Error("unexpected response: expected " + POINTS.length + " points");
const points = raw.map((r, i) => {
  if (!r.hourly || !r.hourly.time || r.hourly.time.length < 100) throw new Error("point " + i + " has too few hours");
  for (const k of HOURLY) if (!r.hourly[k]) throw new Error("point " + i + " is missing " + k);
  return { ...POINTS[i], elevation: r.elevation, current: r.current, hourly: r.hourly };
});
// The newest hour with a real value must be recent, otherwise do not publish a stale file as fresh.
const t0 = Date.parse(points[0].current.time + "+05:30");
if (!(Date.now() - t0 < 3 * 3600e3)) throw new Error("current data is older than 3 hours: " + points[0].current.time);

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "Open-Meteo (ECMWF IFS, 9 km grid). Model estimate, not a station observation.",
  attribution: "Weather data by Open-Meteo.com, CC BY 4.0",
  timezone: "Asia/Kolkata",
  points,
};
const file = process.argv[2] || "weather/latest.json";
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`wrote ${file}: ${points.length} points, ${points[0].hourly.time.length} hours, ${(fs.statSync(file).size / 1024).toFixed(1)} KB, current ${points[0].current.time}`);
