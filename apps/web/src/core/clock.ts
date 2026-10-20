// The time shown in the twin: it can stand still, run faster than real time, or follow the wall clock.
import { istHour, withIstHour } from "./sun.ts";

export class Clock {
  /** the moment being shown, in milliseconds since the epoch */
  ms: number;
  playing = false;
  /** simulated seconds per real second while playing */
  rate = 900;
  /** follows the wall clock (real time) */
  live = false;

  constructor(ms: number) {
    this.ms = ms;
  }

  /** Advances by `dt` real seconds; returns true if the moment changed. */
  tick(dt: number): boolean {
    if (this.live) {
      const now = Date.now();
      const changed = Math.abs(now - this.ms) > 1000;
      this.ms = now;
      return changed;
    }
    if (!this.playing) return false;
    this.ms += dt * this.rate * 1000;
    return true;
  }

  /** Jumps to an India Standard Time hour on the day being shown. */
  setHour(hour: number): void {
    this.live = false;
    this.ms = withIstHour(this.ms, hour);
  }

  /** Moves to the wall clock and follows it. */
  goLive(): void {
    this.live = true;
    this.playing = false;
    this.ms = Date.now();
  }

  get hour(): number {
    return istHour(this.ms);
  }
}
