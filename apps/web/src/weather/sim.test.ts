import { describe, expect, it } from "vitest";
import { typicalData } from "./data.ts";
import { WeatherSim } from "./sim.ts";

const NOW = Date.parse("2026-10-19T04:00:00Z");

describe("WeatherSim", () => {
  it("snaps to the weather on the first update and then eases toward changes", () => {
    const sim = new WeatherSim(typicalData(NOW));
    const first = sim.update(0.016, NOW, 0, 0);
    expect(first.rain).toBe(0);
    sim.preview = "storm";
    const a = { ...sim.update(1, NOW, 0, 0) }; // one second toward a storm
    expect(a.rain).toBeGreaterThan(0);
    expect(a.rain).toBeLessThan(22); // not there yet
    for (let i = 0; i < 40; i++) sim.update(1, NOW, 0, 0);
    expect(sim.current.rain).toBeGreaterThan(21);
    expect(sim.current.visibility).toBeLessThan(1400);
  });
  it("jumps straight to the target after jump()", () => {
    const sim = new WeatherSim(typicalData(NOW));
    sim.update(0.016, NOW, 0, 0);
    sim.preview = "rain";
    sim.jump();
    expect(sim.update(0.016, NOW, 0, 0).rain).toBeCloseTo(6, 3);
  });
  it("shows a plain clear day when switched off", () => {
    const sim = new WeatherSim(typicalData(NOW));
    sim.preview = "storm";
    sim.jump();
    sim.update(0.016, NOW, 0, 0);
    sim.enabled = false;
    sim.jump();
    const s = sim.update(0.016, NOW, 0, 0);
    expect(s.rain).toBe(0);
    expect(s.cloud).toBeLessThan(0.2);
  });
});
