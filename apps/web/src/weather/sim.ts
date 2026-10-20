// The weather simulation: it looks up the data for the moment and place being shown and eases what is drawn toward it, so
// that nothing pops when the time is scrubbed or the data refreshes. It can be switched off (a plain clear day) or told to
// show a preview situation whatever the real weather is doing.
import { PREVIEWS, sample, type WeatherData, type WeatherState } from "./data.ts";

const CLEAR_DAY: WeatherState = {
  cloud: 0.12,
  rain: 0,
  visibility: 10_000,
  wind: 6,
  windDir: 270,
  gust: 10,
  wet: 0,
  temperature: Number.NaN,
  humidity: Number.NaN,
  code: 0,
  day: true,
};

export class WeatherSim {
  data: WeatherData;
  enabled = true;
  /** a named preview, or null to follow the data */
  preview: string | null = null;
  /** what is drawn now: the target, eased */
  readonly current: WeatherState = { ...CLEAR_DAY };
  /** where the data says it is heading */
  target: WeatherState = { ...CLEAR_DAY };
  private jumped = true;

  constructor(data: WeatherData) {
    this.data = data;
  }

  setData(d: WeatherData): void {
    this.data = d;
  }

  /** Snap to the target at the next update (after a jump in time, say). */
  jump(): void {
    this.jumped = true;
  }

  /** Eases toward the weather at `ms` over place (x, z); returns the state to draw. */
  update(dt: number, ms: number, x: number, z: number): WeatherState {
    if (!this.enabled) this.target = { ...CLEAR_DAY, day: this.target.day };
    else if (this.preview && PREVIEWS[this.preview]) this.target = { ...(PREVIEWS[this.preview] as WeatherState) };
    else this.target = sample(this.data, ms, x, z);
    const k = this.jumped ? 1 : 1 - Math.exp(-Math.min(dt, 5) / 5);
    this.jumped = false;
    const c = this.current;
    const t = this.target;
    c.cloud += (t.cloud - c.cloud) * k;
    c.rain += (t.rain - c.rain) * k;
    c.wet += (t.wet - c.wet) * k;
    c.wind += (t.wind - c.wind) * k;
    c.gust += (t.gust - c.gust) * k;
    // visibility spans two orders of magnitude, so it is eased in its logarithm
    c.visibility = Math.exp(Math.log(c.visibility) + (Math.log(t.visibility) - Math.log(c.visibility)) * k);
    c.windDir = t.windDir;
    c.temperature = t.temperature;
    c.humidity = t.humidity;
    c.code = t.code;
    c.day = t.day;
    return c;
  }
}
