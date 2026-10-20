import { describe, expect, it } from "vitest";
import { Clock } from "./clock.ts";
import { istToUtcMs } from "./sun.ts";

describe("Clock", () => {
  it("stands still until it is played", () => {
    const c = new Clock(istToUtcMs(2026, 10, 19, 10));
    expect(c.tick(1)).toBe(false);
    expect(c.hour).toBeCloseTo(10, 6);
  });
  it("runs at the chosen rate while playing", () => {
    const c = new Clock(istToUtcMs(2026, 10, 19, 10));
    c.playing = true;
    c.rate = 3600; // one real second is one simulated hour
    expect(c.tick(1)).toBe(true);
    expect(c.hour).toBeCloseTo(11, 6);
  });
  it("jumps to an hour of the same day and leaves live mode", () => {
    const c = new Clock(istToUtcMs(2026, 10, 19, 10));
    c.live = true;
    c.setHour(21.5);
    expect(c.live).toBe(false);
    expect(c.hour).toBeCloseTo(21.5, 6);
  });
  it("follows the wall clock when live", () => {
    const c = new Clock(0);
    c.goLive();
    expect(Math.abs(c.ms - Date.now())).toBeLessThan(2000);
    expect(c.tick(0.016)).toBe(false);
  });
});
