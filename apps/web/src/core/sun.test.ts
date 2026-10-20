import { describe, expect, it } from "vitest";
import { istHour, istToUtcMs, sunPosition, sunTimes, withIstHour } from "./sun.ts";

const LAT = 29.0205;
const LON = 79.4935;

describe("sun position over Pantnagar", () => {
  it("is nearly overhead at the June solstice around local solar noon", () => {
    // local solar noon is about 12:12 IST because Pantnagar lies west of the 82.5 E meridian
    const s = sunPosition(istToUtcMs(2026, 6, 21, 12, 12), LAT, LON);
    expect(s.elevation).toBeGreaterThan(83.5);
    expect(s.elevation).toBeLessThan(85);
  });
  it("is low in the south at the December solstice around noon", () => {
    const s = sunPosition(istToUtcMs(2026, 12, 21, 12, 12), LAT, LON);
    expect(s.elevation).toBeGreaterThan(36.5);
    expect(s.elevation).toBeLessThan(38.5);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(6);
    expect(s.direction[2]).toBeGreaterThan(0); // toward the south (+z)
  });
  it("rises in the east and sets in the west on an equinox", () => {
    const morning = sunPosition(istToUtcMs(2026, 3, 20, 7, 0), LAT, LON);
    const evening = sunPosition(istToUtcMs(2026, 3, 20, 17, 30), LAT, LON);
    expect(morning.azimuth).toBeGreaterThan(60);
    expect(morning.azimuth).toBeLessThan(120);
    expect(evening.azimuth).toBeGreaterThan(240);
    expect(evening.azimuth).toBeLessThan(300);
  });
  it("is below the horizon at night", () => {
    expect(sunPosition(istToUtcMs(2026, 10, 19, 23, 0), LAT, LON).elevation).toBeLessThan(-20);
  });
  it("returns a unit vector", () => {
    const d = sunPosition(istToUtcMs(2026, 10, 19, 10, 0), LAT, LON).direction;
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
  });
});

describe("sun times and clock helpers", () => {
  it("finds a plausible sunrise and sunset for mid October", () => {
    const t = sunTimes(istToUtcMs(2026, 10, 19, 12), LAT, LON);
    expect(t.sunrise).not.toBeNull();
    expect(t.sunset).not.toBeNull();
    expect(istHour(t.sunrise as number)).toBeGreaterThan(6.0);
    expect(istHour(t.sunrise as number)).toBeLessThan(6.6);
    expect(istHour(t.sunset as number)).toBeGreaterThan(17.3);
    expect(istHour(t.sunset as number)).toBeLessThan(18.0);
  });
  it("has a long day at the June solstice and a short one in December", () => {
    const june = sunTimes(istToUtcMs(2026, 6, 21, 12), LAT, LON);
    const dec = sunTimes(istToUtcMs(2026, 12, 21, 12), LAT, LON);
    const len = (x: { sunrise: number | null; sunset: number | null }) => ((x.sunset as number) - (x.sunrise as number)) / 3_600_000;
    expect(len(june)).toBeGreaterThan(13.4);
    expect(len(dec)).toBeLessThan(10.6);
  });
  it("converts between an instant and an IST hour of the same day", () => {
    const noon = istToUtcMs(2026, 10, 19, 12);
    expect(istHour(noon)).toBeCloseTo(12, 6);
    expect(withIstHour(noon, 21.5)).toBe(istToUtcMs(2026, 10, 19, 21, 30));
    expect(withIstHour(istToUtcMs(2026, 10, 19, 23, 59), 0.5)).toBe(istToUtcMs(2026, 10, 19, 0, 30));
  });
});
