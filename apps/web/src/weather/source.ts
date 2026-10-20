// Getting the weather: a file stored by the scheduled job if it is fresh, otherwise straight from Open-Meteo (free, no key,
// open to browsers), otherwise the last good answer kept in the browser, otherwise a typical day. The page always has
// something to show, and it tries again in half an hour (or in two minutes after a failure).
import { type DataKind, HOURLY, normalise, POINTS, typicalData, type WeatherData } from "./data.ts";

const KEY = "gbpuat-campus:weather:v1"; // shared with the first viewer, which stores the same shape
const FILE_URL = "https://raw.githubusercontent.com/teerthasrirathod/gbpuat-pantnagar-digital-twin/weather-data/latest.json";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const CURRENT =
  "temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
const HOUR = 3_600_000;

const openMeteoUrl = (): string =>
  `${OPEN_METEO}?latitude=${POINTS.map((p) => p.lat).join(",")}&longitude=${POINTS.map((p) => p.lon).join(",")}&timezone=Asia/Kolkata&past_days=2&forecast_days=3&wind_speed_unit=kmh&current=${CURRENT}&hourly=${HOURLY.join(",")}`;

async function getJson(url: string, ms = 25_000): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const store = {
  read(): { fetchedAt: number; raw: unknown } | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  },
  write(v: { fetchedAt: number; raw: unknown }): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      // storage full or blocked: the weather still works, it is just not remembered
    }
  },
};

export interface WeatherSource {
  /** the data in use (never null: a typical day stands in until something better arrives) */
  readonly data: WeatherData;
  /** reasons the last attempts failed, for the interface */
  readonly errors: Record<string, string>;
  refresh(): Promise<void>;
  stop(): void;
}

export function startWeather(onData: (d: WeatherData) => void): WeatherSource {
  let data: WeatherData = typicalData(Date.now());
  const errors: Record<string, string> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading = false;
  let stopped = false;

  const set = (d: WeatherData): void => {
    data = d;
    onData(d);
  };

  const refresh = async (): Promise<void> => {
    if (loading || stopped) return;
    loading = true;
    let nextIn = 30 * 60_000;
    try {
      if (data.kind === "typical") {
        const cached = store.read();
        if (cached && Date.now() - cached.fetchedAt < 7 * 24 * HOUR) {
          try {
            set(normalise(cached.raw, "cache", cached.fetchedAt));
          } catch {
            // a bad cache is ignored
          }
        }
      }
      let raw: unknown = null;
      let kind: DataKind = "live";
      // 1. the file stored by the scheduled job, if it is recent
      try {
        const f = (await getJson(FILE_URL)) as { generatedAt?: string } | null;
        if (f?.generatedAt && Date.now() - Date.parse(f.generatedAt) < 4 * HOUR) {
          raw = f;
          kind = "stored";
        }
      } catch (e) {
        errors.stored = String(e);
      }
      // 2. otherwise straight from Open-Meteo
      if (!raw) {
        try {
          raw = await getJson(openMeteoUrl());
          kind = "live";
        } catch (e) {
          errors.direct = String(e);
        }
      }
      if (raw) {
        const d = normalise(raw, kind, Date.now());
        set(d);
        store.write({ fetchedAt: d.fetchedAt, raw });
      } else {
        nextIn = 2 * 60_000; // nothing arrived: try again soon
      }
    } catch (e) {
      errors.load = String(e);
      nextIn = 2 * 60_000;
    } finally {
      loading = false;
      if (!stopped) timer = setTimeout(() => void refresh(), nextIn);
    }
  };
  void refresh();
  return {
    get data() {
      return data;
    },
    errors,
    refresh: async () => {
      if (timer) clearTimeout(timer);
      await refresh();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
