// Where the sun is, from the date, the time and the place (NOAA low-precision formulas, good to about a tenth of a degree).
const RAD = Math.PI / 180;

export interface SunPosition {
  /** degrees clockwise from north */
  azimuth: number;
  /** degrees above the horizon (negative at night) */
  elevation: number;
  /** unit vector toward the sun in the local frame: x east, y up, z south */
  direction: [number, number, number];
}

export function sunPosition(utcMs: number, latDeg: number, lonDeg: number): SunPosition {
  const jd = utcMs / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const L = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const g = ((((357.528 + 0.9856003 * n) % 360) + 360) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 4e-7 * n) * RAD;
  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstHours = 18.697374558 + 24.06570982441908 * n;
  const lst = (((gmstHours * 15 + lonDeg) % 360) + 360) % 360;
  const H = ((lst * RAD - alpha + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const lat = latDeg * RAD;
  const sinEl = Math.sin(lat) * Math.sin(delta) + Math.cos(lat) * Math.cos(delta) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H) * Math.cos(delta), Math.sin(delta) * Math.cos(lat) - Math.cos(delta) * Math.cos(H) * Math.sin(lat));
  const east = Math.sin(az) * Math.cos(el);
  const north = Math.cos(az) * Math.cos(el);
  return { azimuth: (((az / RAD) % 360) + 360) % 360, elevation: el / RAD, direction: [east, Math.sin(el), -north] };
}

/** India Standard Time (UTC+5:30) as milliseconds since the epoch for a calendar date and clock time. */
export function istToUtcMs(year: number, month1: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month1 - 1, day, hour, minute) - 5.5 * 3_600_000;
}

/** Local sidereal time in degrees for a moment and a longitude: how far the stars have turned. */
export function localSiderealDegrees(utcMs: number, lonDeg: number): number {
  const jd = utcMs / 86_400_000 + 2_440_587.5;
  const gmstHours = 18.697374558 + 24.06570982441908 * (jd - 2_451_545.0);
  return (((gmstHours * 15 + lonDeg) % 360) + 360) % 360;
}

export interface SunTimes {
  /** milliseconds since the epoch, or null where the sun does not rise or set that day */
  sunrise: number | null;
  sunset: number | null;
}

/** When the sun crosses the horizon (a centre-of-disc elevation of -0.83 degrees) on the India Standard Time day that contains `utcMs`. */
export function sunTimes(utcMs: number, latDeg: number, lonDeg: number): SunTimes {
  const ist = utcMs + 5.5 * 3_600_000;
  const dayStartIst = Math.floor(ist / 86_400_000) * 86_400_000;
  const start = dayStartIst - 5.5 * 3_600_000; // midnight IST as a UTC instant
  let rise: number | null = null;
  let set: number | null = null;
  let prev = sunPosition(start, latDeg, lonDeg).elevation + 0.83;
  for (let m = 1; m <= 24 * 60; m++) {
    const t = start + m * 60_000;
    const e = sunPosition(t, latDeg, lonDeg).elevation + 0.83;
    if (prev < 0 && e >= 0 && rise === null) rise = t;
    if (prev >= 0 && e < 0 && set === null) set = t;
    prev = e;
  }
  return { sunrise: rise, sunset: set };
}

/** The India Standard Time hour (0 to 24, fractional) of a moment. */
export function istHour(utcMs: number): number {
  const ist = utcMs + 5.5 * 3_600_000;
  return (((ist % 86_400_000) + 86_400_000) % 86_400_000) / 3_600_000;
}

/** The moment, as UTC milliseconds, at an IST hour on the same IST calendar day as `utcMs`. */
export function withIstHour(utcMs: number, hour: number): number {
  const ist = utcMs + 5.5 * 3_600_000;
  const dayStartIst = Math.floor(ist / 86_400_000) * 86_400_000;
  return dayStartIst + hour * 3_600_000 - 5.5 * 3_600_000;
}
