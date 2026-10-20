import { describe, expect, it } from "vitest";
import { at, atDirection, compass, describe as describeCode, normalise, POINTS, sample, typicalData, weights, wetness } from "./data.ts";

/** An answer shaped like Open-Meteo's: six points, three hours of data each, times as local (IST) strings. */
function raw(rain: number[] = [0, 0, 0], dir: number[] = [350, 10, 30]) {
  const hourly = (extra: Record<string, number[]>) => ({
    time: ["2026-10-19T08:00", "2026-10-19T09:00", "2026-10-19T10:00"],
    temperature_2m: [20, 22, 24],
    relative_humidity_2m: [70, 65, 60],
    precipitation: rain,
    weather_code: [1, 2, 3],
    cloud_cover: [10, 50, 90],
    visibility: [10000, 8000, 6000],
    wind_speed_10m: [5, 10, 15],
    wind_direction_10m: dir,
    wind_gusts_10m: [10, 20, 30],
    shortwave_radiation: [300, 500, 600],
    ...extra,
  });
  return { generatedAt: "2026-10-19T02:30:00Z", points: POINTS.map(() => ({ hourly: hourly({}) })) };
}
const T8 = Date.parse("2026-10-19T08:00+05:30");
const HOUR = 3_600_000;

describe("normalise", () => {
  it("reads six points with hour boundaries in milliseconds", () => {
    const d = normalise(raw(), "stored", 1);
    expect(d.points).toHaveLength(6);
    expect(d.points[0]?.times[0]).toBe(T8);
    expect(d.points[0]?.times[2]).toBe(T8 + 2 * HOUR);
    expect(d.generatedAt).toBe(Date.parse("2026-10-19T02:30:00Z"));
  });
  it("turns missing values into NaN and rejects data with no points", () => {
    const r = raw();
    (r.points[0] as { hourly: Record<string, unknown> }).hourly.cloud_cover = [10, null, 90];
    const d = normalise(r, "live", 1);
    const cover = (d.points[0] as (typeof d.points)[number]).series.cloud_cover as Float32Array;
    expect(Number.isNaN(cover[1] as number)).toBe(true);
    expect(() => normalise({ points: [] }, "live", 1)).toThrow();
  });
});

describe("interpolation", () => {
  const d = normalise(raw(), "live", 1);
  const home = d.points[0] as (typeof d.points)[number];
  it("is linear between hours and flat beyond the ends", () => {
    expect(at(home, "temperature_2m", T8 + HOUR / 2)).toBeCloseTo(21, 4);
    expect(at(home, "temperature_2m", T8 - 5 * HOUR)).toBe(20);
    expect(at(home, "temperature_2m", T8 + 9 * HOUR)).toBe(24);
  });
  it("skips over a missing hour instead of returning NaN", () => {
    const r = raw();
    (r.points[0] as { hourly: Record<string, unknown> }).hourly.temperature_2m = [20, null, 24];
    const p = normalise(r, "live", 1).points[0] as typeof home;
    expect(at(p, "temperature_2m", T8 + HOUR / 2)).toBeCloseTo(20, 4);
    expect(at(p, "temperature_2m", T8 + HOUR * 1.5)).toBeCloseTo(24, 4);
  });
  it("turns a wind direction through north rather than the long way round", () => {
    const x = atDirection(home, "wind_direction_10m", T8 + HOUR / 2); // 350 -> 10
    expect(Math.min(x, 360 - x)).toBeLessThan(1);
  });
});

describe("space and wetness", () => {
  const d = normalise(raw(), "live", 1);
  it("weights sum to one and favour the nearest point", () => {
    const w = weights(d.points, 0, 0);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(w[0]).toBe(Math.max(...w));
    // far to the north the northern point counts more than the southern ones
    const north = weights(d.points, 0, -22000);
    expect(north[1]).toBeGreaterThan(north[3] as number);
  });
  it("keeps the ground wet for hours after rain and dries it", () => {
    const rainy = normalise(raw([8, 0, 0]), "live", 1).points[0] as (typeof d.points)[number];
    const soon = wetness(rainy, T8 + HOUR);
    const later = wetness(rainy, T8 + 10 * HOUR);
    expect(soon).toBeGreaterThan(0.8);
    expect(later).toBeLessThan(soon);
    expect(wetness(d.points[0] as (typeof d.points)[number], T8 + HOUR)).toBe(0);
  });
});

describe("sample", () => {
  it("gives a complete state for a moment and a place", () => {
    const s = sample(normalise(raw(), "live", 1), T8 + HOUR, 0, 0);
    expect(s.cloud).toBeCloseTo(0.5, 2);
    expect(s.temperature).toBeCloseTo(22, 3);
    expect(s.visibility).toBeCloseTo(8000, 0);
    expect(s.wind).toBeCloseTo(10, 3);
    expect(s.day).toBe(true);
  });
  it("makes any rainy hour overcast", () => {
    const s = sample(normalise(raw([0, 4, 0]), "live", 1), T8 + HOUR, 0, 0);
    expect(s.rain).toBeGreaterThan(3);
    expect(s.cloud).toBeGreaterThanOrEqual(0.85);
  });
  it("has a typical-day fallback with all six points", () => {
    const typ = typicalData(Date.parse("2026-10-19T04:00:00Z"));
    expect(typ.points).toHaveLength(6);
    expect(sample(typ, Date.parse("2026-10-19T04:00:00Z"), 0, 0).rain).toBe(0);
  });
});

describe("words", () => {
  it("names compass directions and weather codes", () => {
    expect(compass(0)).toBe("N");
    expect(compass(270)).toBe("W");
    expect(compass(359)).toBe("N");
    expect(describeCode(0)).toBe("Clear");
    expect(describeCode(63)).toBe("Rain");
    expect(describeCode(95)).toBe("Thunderstorm");
  });
});
