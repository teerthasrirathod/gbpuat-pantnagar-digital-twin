// The quality governor: watches the real frame rate and trades resolution for speed, so that the same build runs well on
// a base M1 and on something slower. It lowers the pixel ratio first (cheap and barely noticeable), and only if that is
// not enough does it step the image pipeline down; when there is headroom it climbs back up, slowly, with hysteresis so
// that it does not flicker between levels.
import type { Pipeline, Quality } from "./pipeline.ts";
import type { Gfx } from "./renderer.ts";

export interface GovernorOptions {
  gfx: Gfx;
  pipeline: Pipeline;
  /** called after the pixel ratio changes, so that the app can resize its targets */
  onResize: () => void;
  /** the highest pixel ratio to use (the device ratio, capped) */
  maxRatio: number;
  minRatio?: number;
  /** frames per second to hold */
  target?: number;
}

export interface Governor {
  enabled: boolean;
  /** the pixel ratio in use */
  readonly ratio: number;
  /** feed it the real time of each frame, in seconds */
  frame(dt: number): void;
}

const STEP = 0.1;
const ORDER: Quality[] = ["off", "medium", "high"];

export function createGovernor(opts: GovernorOptions): Governor {
  const target = opts.target ?? 50;
  const min = opts.minRatio ?? 0.5;
  let ratio = opts.maxRatio;
  let ema = 1 / target;
  let sinceCheck = 0;
  let slowChecks = 0;
  let fastChecks = 0;
  let sinceChange = 0;
  const gov: Governor = {
    enabled: true,
    get ratio() {
      return ratio;
    },
    frame(dt) {
      if (!gov.enabled) return;
      // a long stall (a tab switch, shader compilation) says nothing about steady speed
      if (dt > 3) return;
      ema += (dt - ema) * 0.25;
      sinceCheck += dt;
      sinceChange += dt;
      if (sinceCheck < 0.75) return;
      sinceCheck = 0;
      const budget = 1 / target;
      if (ema > budget * 1.18) {
        slowChecks++;
        fastChecks = 0;
      } else if (ema < budget * 0.72) {
        fastChecks++;
        slowChecks = 0;
      } else {
        slowChecks = 0;
        fastChecks = 0;
      }
      // quick to drop, slow to rise, and never straight after a change. Pixel cost goes with the square of the
      // ratio, so the drop is sized from how far over budget the frame is.
      if (slowChecks >= 2 && sinceChange > 1.5) {
        slowChecks = 0;
        if (ratio > min + 1e-6) set(Math.max(min, ratio * Math.min(0.95, Math.max(0.6, Math.sqrt(budget / ema) * 1.05))));
        else stepPipeline(-1);
      } else if (fastChecks >= 6 && sinceChange > 4) {
        fastChecks = 0;
        if (opts.pipeline.quality !== "high" && ratio <= min + 0.21) stepPipeline(1);
        else if (ratio < opts.maxRatio - 1e-6) set(Math.min(opts.maxRatio, ratio + STEP));
        else if (opts.pipeline.quality !== "high") stepPipeline(1);
      }
    },
  };
  const set = (r: number): void => {
    ratio = Math.round(r * 100) / 100;
    opts.gfx.renderer.setPixelRatio(ratio);
    opts.onResize();
    sinceChange = 0;
    ema = 1 / target; // measure again at the new size
  };
  const stepPipeline = (dir: -1 | 1): void => {
    const i = ORDER.indexOf(opts.pipeline.quality) + dir;
    const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, i))] as Quality;
    if (next === opts.pipeline.quality) return;
    opts.pipeline.setQuality(next);
    // a lower tier is cheaper, so start it at a higher resolution again
    if (dir < 0) set(Math.min(opts.maxRatio, Math.max(ratio, 0.8)));
    sinceChange = 0;
    ema = 1 / target;
  };
  return gov;
}
