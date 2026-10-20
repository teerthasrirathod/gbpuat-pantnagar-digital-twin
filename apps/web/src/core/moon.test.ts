import { describe, expect, it } from "vitest";
import { moonPhaseName, moonPosition } from "./moon.ts";

const PANTNAGAR = { lat: 29.0205, lon: 79.4935 };

describe("moonPosition", () => {
  it("is nearly dark at the new moon of the 2024-04-08 eclipse", () => {
    const m = moonPosition(Date.UTC(2024, 3, 8, 18, 21), PANTNAGAR.lat, PANTNAGAR.lon);
    expect(m.illuminated).toBeLessThan(0.02);
  });
  it("is nearly full at the full moon of 2024-04-23", () => {
    const m = moonPosition(Date.UTC(2024, 3, 23, 23, 49), PANTNAGAR.lat, PANTNAGAR.lon);
    expect(m.illuminated).toBeGreaterThan(0.98);
  });
  it("is about half lit a week after the new moon", () => {
    const m = moonPosition(Date.UTC(2024, 3, 15, 19, 13), PANTNAGAR.lat, PANTNAGAR.lon); // first quarter
    expect(m.illuminated).toBeGreaterThan(0.45);
    expect(m.illuminated).toBeLessThan(0.55);
  });
  it("returns a unit direction that agrees with its elevation", () => {
    for (const hour of [0, 6, 12, 18]) {
      const m = moonPosition(Date.UTC(2026, 9, 19, hour), PANTNAGAR.lat, PANTNAGAR.lon);
      const [x, y, z] = m.direction;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
      expect(Math.asin(y) * (180 / Math.PI)).toBeCloseTo(m.elevation, 4);
    }
  });
  it("rises in the east and sets in the west, roughly, for a full moon", () => {
    // a full moon rises at sunset and is highest near local midnight
    const evening = moonPosition(Date.UTC(2024, 3, 23, 13, 0), PANTNAGAR.lat, PANTNAGAR.lon); // 18:30 IST
    const midnight = moonPosition(Date.UTC(2024, 3, 23, 18, 30), PANTNAGAR.lat, PANTNAGAR.lon); // 00:00 IST
    expect(evening.elevation).toBeLessThan(15);
    expect(midnight.elevation).toBeGreaterThan(30);
  });
});

describe("moonPhaseName", () => {
  it("names the phases around the circle", () => {
    expect(moonPhaseName(3)).toBe("New moon");
    expect(moonPhaseName(45)).toBe("Waxing crescent");
    expect(moonPhaseName(90)).toBe("First quarter");
    expect(moonPhaseName(135)).toBe("Waxing gibbous");
    expect(moonPhaseName(180)).toBe("Full moon");
    expect(moonPhaseName(225)).toBe("Waning gibbous");
    expect(moonPhaseName(270)).toBe("Last quarter");
    expect(moonPhaseName(315)).toBe("Waning crescent");
    expect(moonPhaseName(-10)).toBe("New moon");
  });
});
