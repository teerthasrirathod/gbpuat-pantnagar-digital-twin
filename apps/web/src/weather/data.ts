// Weather data and its interpolation, with no browser dependencies so that it can be tested. Six model points (Pantnagar and
// five about 25 km away) give hourly series; a state for any moment and place is found by interpolating in time (hourly to
// the second) and in space (an inverse-distance blend of the six points, so a storm to the north reaches the campus first
// from that side). Everything is a model estimate (ECMWF, about 9 km grid), not a station observation.

export const LAT0 = 29.0205;
export const LON0 = 79.4935;
const M_LAT = 110_540;
const M_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const HOUR = 3_600_000;
const IST = 5.5 * HOUR;

export interface WeatherPointDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Pantnagar and five points on a ring about 25 km out: the foothills to the north and the four other sides. */
export const POINTS: WeatherPointDef[] = [
  { id: "pantnagar", name: "Pantnagar", lat: 29.0205, lon: 79.4935 },
  { id: "n", name: "North (foothills)", lat: 29.2467, lon: 79.4935 },
  { id: "ene", name: "East-north-east", lat: 29.0904, lon: 79.7378 },
  { id: "sse", name: "South-south-east", lat: 28.837, lon: 79.6445 },
  { id: "ssw", name: "South-south-west", lat: 28.837, lon: 79.3425 },
  { id: "wnw", name: "West-north-west", lat: 29.0904, lon: 79.2492 },
];

export const HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "visibility",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "shortwave_radiation",
] as const;
export type Variable = (typeof HOURLY)[number];

export type DataKind = "stored" | "live" | "cache" | "typical";

export interface WeatherPoint extends WeatherPointDef {
  /** hour boundaries in milliseconds since the epoch */
  times: number[];
  series: Partial<Record<Variable, Float32Array>>;
}

export interface WeatherData {
  points: WeatherPoint[];
  kind: DataKind;
  fetchedAt: number;
  generatedAt: number | null;
}

/** One place and moment: what the simulation draws. */
export interface WeatherState {
  /** cloud cover, 0 to 1 */
  cloud: number;
  /** rain rate in mm per hour */
  rain: number;
  /** visibility in metres */
  visibility: number;
  /** wind speed in km/h, and the direction it blows from in degrees */
  wind: number;
  windDir: number;
  gust: number;
  /** how wet the ground is, 0 to 1 */
  wet: number;
  temperature: number;
  humidity: number;
  /** WMO weather code */
  code: number;
  day: boolean;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

interface RawPoint {
  hourly: Record<string, (number | null)[] | string[]>;
}

/** Turns the answer of the weather service, or the stored file, into series with hour boundaries in milliseconds. */
export function normalise(raw: unknown, kind: DataKind, fetchedAt: number): WeatherData {
  const r = raw as { points?: RawPoint[]; generatedAt?: string };
  const arr: RawPoint[] = Array.isArray(raw) ? (raw as RawPoint[]) : (r.points ?? []);
  if (arr.length < 1) throw new Error("the weather data has no points");
  const points = arr.map((p, i) => {
    const hourly = p.hourly;
    const timeStrings = hourly.time as string[] | undefined;
    if (!timeStrings) throw new Error("the weather data has no times");
    const times = timeStrings.map((s) => Date.parse(`${s}+05:30`));
    const series: WeatherPoint["series"] = {};
    for (const k of HOURLY) {
      const a = hourly[k] as (number | null)[] | undefined;
      if (a) series[k] = Float32Array.from(a, (v) => (v === null || v === undefined ? Number.NaN : v));
    }
    return { ...(POINTS[i] ?? POINTS[0]), times, series } as WeatherPoint;
  });
  return { points, kind, fetchedAt, generatedAt: r.generatedAt ? Date.parse(r.generatedAt) : null };
}

/** IMD 1991-2020 normals for Pantnagar by month: minimum and maximum temperature and rain in mm. Used only without any data. */
const NORMALS: [number, number, number][] = [
  [5.5, 19.6, 28],
  [7.7, 24.0, 34.6],
  [11.5, 29.2, 22.4],
  [16.0, 34.9, 15],
  [21.0, 36.7, 46.4],
  [24.3, 35.8, 180],
  [25.3, 33.0, 398],
  [25.0, 32.6, 412],
  [23.1, 32.5, 264],
  [16.9, 31.0, 30],
  [10.3, 27.4, 3.1],
  [6.2, 22.6, 11.6],
];

/** A plain typical day of the current month, for when there is no live data, no stored file and no cache. */
export function typicalData(nowMs: number): WeatherData {
  const mo = new Date(nowMs + IST).getUTCMonth();
  const [tn, tx] = NORMALS[mo] as [number, number, number];
  const t0 = Math.floor(nowMs / HOUR) * HOUR - 48 * HOUR;
  const n = 120;
  const times: number[] = [];
  const series: WeatherPoint["series"] = {};
  for (const k of HOURLY) series[k] = new Float32Array(n);
  const s = series as Record<Variable, Float32Array>;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * HOUR;
    const h = new Date(t + IST).getUTCHours();
    times.push(t);
    s.temperature_2m[i] = tn + (tx - tn) * (0.5 + 0.5 * Math.sin(((h - 9) / 24) * 2 * Math.PI));
    s.relative_humidity_2m[i] = 60;
    s.precipitation[i] = 0;
    s.weather_code[i] = 1;
    s.cloud_cover[i] = 25;
    s.wind_speed_10m[i] = 6;
    s.wind_direction_10m[i] = 270;
    s.wind_gusts_10m[i] = 12;
    s.visibility[i] = (mo === 11 || mo === 0) && h >= 3 && h <= 9 ? 700 : 10_000; // dawn fog in December and January
    s.shortwave_radiation[i] = Math.max(0, 700 * Math.sin(((h - 6) / 12) * Math.PI));
  }
  return { points: POINTS.map((p) => ({ ...p, times, series })), kind: "typical", fetchedAt: nowMs, generatedAt: null };
}

/** The value of one series at a moment: linear between the hours, flat beyond the ends. NaN where there is no value. */
export function at(pt: WeatherPoint, key: Variable, t: number): number {
  const a = pt.series[key];
  const n = pt.times.length;
  if (!a || n === 0) return Number.NaN;
  if (t <= (pt.times[0] as number)) return a[0] as number;
  if (t >= (pt.times[n - 1] as number)) return a[n - 1] as number;
  const i = Math.floor((t - (pt.times[0] as number)) / HOUR);
  const f = (t - (pt.times[i] as number)) / HOUR;
  const x = a[i] as number;
  const y = a[i + 1] as number;
  return Number.isNaN(x) ? y : Number.isNaN(y) ? x : x + (y - x) * f;
}

/** A wind direction interpolated through its sine and cosine, so that 350 degrees to 10 degrees goes through north. */
export function atDirection(pt: WeatherPoint, key: Variable, t: number): number {
  const a = pt.series[key];
  const n = pt.times.length;
  if (!a || n < 2) return 0;
  const i = clamp(Math.floor((t - (pt.times[0] as number)) / HOUR), 0, n - 2);
  const f = clamp((t - (pt.times[i] as number)) / HOUR, 0, 1);
  const r = Math.PI / 180;
  const x = Math.sin((a[i] as number) * r) * (1 - f) + Math.sin((a[i + 1] as number) * r) * f;
  const y = Math.cos((a[i] as number) * r) * (1 - f) + Math.cos((a[i + 1] as number) * r) * f;
  return (Math.atan2(x, y) / r + 360) % 360;
}

/** Weights of the points for a position in local metres (x east, z south of the campus origin): nearer points count more. */
export function weights(points: WeatherPoint[], x: number, z: number): number[] {
  const lat = LAT0 - z / M_LAT;
  const lon = LON0 + x / M_LON;
  const w = points.map((p) => 1 / (Math.hypot((p.lat - lat) * 110.54, (p.lon - lon) * 97.3) + 3) ** 2);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}

function blend(points: WeatherPoint[], key: Variable, t: number, w: number[]): number {
  let s = 0;
  let ws = 0;
  points.forEach((p, i) => {
    const v = at(p, key, t);
    if (!Number.isNaN(v)) {
      s += v * (w[i] as number);
      ws += w[i] as number;
    }
  });
  return ws ? s / ws : Number.NaN;
}

/** How wet the ground is: rain over the last twelve hours, each hour counting less (a decay of about four hours). */
export function wetness(pt: WeatherPoint, t: number): number {
  let sum = 0;
  for (let k = 0; k <= 12; k++) {
    const r = at(pt, "precipitation", t - k * HOUR);
    if (r > 0) sum += r * Math.exp(-k / 4);
  }
  return 1 - Math.exp(-0.35 * sum);
}

/** The weather at a moment and a place (local metres from the campus origin). */
export function sample(data: WeatherData, t: number, x: number, z: number): WeatherState {
  const pts = data.points;
  const w = weights(pts, x, z);
  const home = pts[0] as WeatherPoint;
  const sw = at(home, "shortwave_radiation", t);
  const hour = new Date(t + IST).getUTCHours() + new Date(t + IST).getUTCMinutes() / 60;
  let cloud = clamp(blend(pts, "cloud_cover", t, w) / 100, 0, 1);
  const rain = Math.max(0, blend(pts, "precipitation", t, w));
  if (rain > 0.1) cloud = Math.max(cloud, 0.85);
  const vis = blend(pts, "visibility", t, w);
  return {
    cloud: Number.isNaN(cloud) ? 0.2 : cloud,
    rain: Number.isNaN(rain) ? 0 : rain,
    visibility: Math.max(100, Number.isNaN(vis) ? 10_000 : vis),
    wind: Math.max(0, blend(pts, "wind_speed_10m", t, w) || 0),
    windDir: atDirection(home, "wind_direction_10m", t),
    gust: Math.max(0, at(home, "wind_gusts_10m", t) || 0),
    wet: wetness(home, t),
    temperature: at(home, "temperature_2m", t),
    humidity: at(home, "relative_humidity_2m", t),
    code: Math.round(at(home, "weather_code", t)) || 0,
    day: sw > 5 || (hour > 6.5 && hour < 17.5),
  };
}

/** Situations to preview in the address (#wx=rain) or from the interface, whatever the real weather is doing. */
export const PREVIEWS: Record<string, WeatherState> = {
  clear: {
    cloud: 0.05,
    rain: 0,
    visibility: 10_000,
    wind: 8,
    windDir: 290,
    gust: 14,
    wet: 0,
    temperature: 27,
    humidity: 45,
    code: 0,
    day: true,
  },
  cloudy: {
    cloud: 0.75,
    rain: 0,
    visibility: 8000,
    wind: 12,
    windDir: 280,
    gust: 20,
    wet: 0.1,
    temperature: 24,
    humidity: 65,
    code: 3,
    day: true,
  },
  rain: {
    cloud: 0.95,
    rain: 6,
    visibility: 2500,
    wind: 24,
    windDir: 250,
    gust: 38,
    wet: 0.9,
    temperature: 24,
    humidity: 92,
    code: 63,
    day: true,
  },
  storm: {
    cloud: 1,
    rain: 22,
    visibility: 1200,
    wind: 42,
    windDir: 280,
    gust: 70,
    wet: 1,
    temperature: 26,
    humidity: 95,
    code: 95,
    day: true,
  },
  fog: {
    cloud: 0.5,
    rain: 0,
    visibility: 300,
    wind: 3,
    windDir: 300,
    gust: 5,
    wet: 0.2,
    temperature: 9,
    humidity: 98,
    code: 45,
    day: true,
  },
};

export const compass = (deg: number): string => {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] as string;
};

/** The words for a WMO weather code. */
export function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}
