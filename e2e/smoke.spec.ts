import { expect, test } from "@playwright/test";

interface HeroHook {
  hero: { buildings: unknown[]; trees: unknown[] };
  gfx: { backend: string };
  setTime(utcMs: number): number;
  street: { pose: { x: number; z: number; yaw: number } };
  props: { counts: Record<string, number> };
}
declare global {
  interface Window {
    __hero?: HeroHook;
  }
}

test.describe("hero area", () => {
  test("starts, loads the data and draws on the WebGL2 backend", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    // the test must not depend on the network: answer the two weather hosts with a small fixed forecast
    const hours = Array.from(
      { length: 72 },
      (_, i) => `2026-10-${String(17 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`,
    );
    const series = (v: number) => hours.map(() => v);
    const point = {
      hourly: {
        time: hours,
        temperature_2m: series(26),
        relative_humidity_2m: series(55),
        precipitation: series(0),
        weather_code: series(1),
        cloud_cover: series(20),
        visibility: series(10000),
        wind_speed_10m: series(8),
        wind_direction_10m: series(270),
        wind_gusts_10m: series(14),
        shortwave_radiation: series(400),
      },
    };
    await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ json: Array.from({ length: 6 }, () => point) }));
    await page.route("https://raw.githubusercontent.com/**", (r) => r.fulfill({ json: {} }));

    await page.goto("/#renderer=webgl&q=off&street=-524,-83,-1.22&t=10.5");
    await page.waitForFunction(() => window.__hero !== undefined, undefined, { timeout: 600_000 });
    // the first frames take a long time on a software renderer; wait for the HUD to report one
    await page.waitForFunction(() => /fps/.test(document.getElementById("hud")?.textContent ?? ""), undefined, { timeout: 600_000 });

    const info = await page.evaluate(() => {
      const h = window.__hero as HeroHook;
      return { backend: h.gfx.backend, buildings: h.hero.buildings.length, trees: h.hero.trees.length, props: h.props.counts };
    });
    expect(info.backend).toBe("webgl2");
    expect(info.buildings).toBeGreaterThan(100);
    expect(info.trees).toBeGreaterThan(100);
    expect(Object.values(info.props).reduce((a, b) => a + b, 0)).toBeGreaterThan(50);

    const day = await page.screenshot();
    expect(day.byteLength).toBeGreaterThan(20_000); // a blank page compresses to a few kilobytes

    // the night view must look different from the day view
    await page.evaluate(() => {
      const d = new Date();
      (window.__hero as HeroHook).setTime(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 21) - 5.5 * 3_600_000);
    });
    await page.waitForTimeout(20_000);
    const night = await page.screenshot();
    expect(Buffer.compare(day, night)).not.toBe(0);
    expect(night.byteLength).toBeGreaterThan(5_000);

    expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  });
});
