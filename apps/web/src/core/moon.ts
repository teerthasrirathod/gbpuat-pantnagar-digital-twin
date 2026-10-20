// Where the moon is and how much of it is lit, from the date, time and place (Paul Schlyter's low-precision lunar
// elements with the main perturbation terms: good to about half a degree, plenty for a sky).
const RAD = Math.PI / 180;
const norm360 = (d: number): number => ((d % 360) + 360) % 360;

export interface MoonPosition {
  /** degrees clockwise from north */
  azimuth: number;
  /** degrees above the horizon (negative when it is down) */
  elevation: number;
  /** unit vector toward the moon in the local frame: x east, y up, z south */
  direction: [number, number, number];
  /** fraction of the visible disc that is lit: 0 new, 0.5 quarter, 1 full */
  illuminated: number;
  /** angle between the moon and the sun along the ecliptic in degrees: 0 new, 180 full */
  elongation: number;
}

export function moonPosition(utcMs: number, latDeg: number, lonDeg: number): MoonPosition {
  const jd = utcMs / 86_400_000 + 2_440_587.5;
  const d = jd - 2_451_543.5; // days since 1999 December 31, 0h
  // the sun, for the phase and the perturbations
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = norm360(356.047 + 0.9856002585 * d);
  const Ls = norm360(ws + Ms);
  // the moon's orbit
  const N = norm360(125.1228 - 0.0529538083 * d);
  const inc = 5.1454;
  const w = norm360(318.0634 + 0.1643573223 * d);
  const e = 0.0549;
  const Mm = norm360(115.3654 + 13.0649929509 * d);
  const sinM = Math.sin(Mm * RAD);
  const cosM = Math.cos(Mm * RAD);
  let E = Mm + (e / RAD) * sinM * (1 + e * cosM);
  for (let i = 0; i < 3; i++) E -= (E - (e / RAD) * Math.sin(E * RAD) - Mm) / (1 - e * Math.cos(E * RAD));
  const a = 60.2666;
  const xv = a * (Math.cos(E * RAD) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
  const v = Math.atan2(yv, xv) / RAD;
  const r = Math.hypot(xv, yv);
  const vw = (v + w) * RAD;
  const Nr = N * RAD;
  const ir = inc * RAD;
  const xh = r * (Math.cos(Nr) * Math.cos(vw) - Math.sin(Nr) * Math.sin(vw) * Math.cos(ir));
  const yh = r * (Math.sin(Nr) * Math.cos(vw) + Math.cos(Nr) * Math.sin(vw) * Math.cos(ir));
  const zh = r * Math.sin(vw) * Math.sin(ir);
  let lon = Math.atan2(yh, xh) / RAD;
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) / RAD;
  // the largest perturbations
  const Lm = norm360(N + w + Mm);
  const D = (Lm - Ls) * RAD;
  const F = (Lm - N) * RAD;
  const m = Mm * RAD;
  const s = Ms * RAD;
  lon +=
    -1.274 * Math.sin(m - 2 * D) +
    0.658 * Math.sin(2 * D) -
    0.186 * Math.sin(s) -
    0.059 * Math.sin(2 * m - 2 * D) -
    0.057 * Math.sin(m - 2 * D + s) +
    0.053 * Math.sin(m + 2 * D) +
    0.046 * Math.sin(2 * D - s) +
    0.041 * Math.sin(m - s) -
    0.035 * Math.sin(D) -
    0.031 * Math.sin(m + s) -
    0.015 * Math.sin(2 * F - 2 * D) +
    0.011 * Math.sin(m - 4 * D);
  lat +=
    -0.173 * Math.sin(F - 2 * D) -
    0.055 * Math.sin(m - F - 2 * D) -
    0.046 * Math.sin(m + F - 2 * D) +
    0.033 * Math.sin(F + 2 * D) +
    0.017 * Math.sin(2 * m + F);
  // ecliptic to equatorial
  const ecl = (23.4393 - 3.563e-7 * d) * RAD;
  const xg = Math.cos(lon * RAD) * Math.cos(lat * RAD);
  const yg = Math.sin(lon * RAD) * Math.cos(lat * RAD);
  const zg = Math.sin(lat * RAD);
  const xe = xg;
  const ye = yg * Math.cos(ecl) - zg * Math.sin(ecl);
  const ze = yg * Math.sin(ecl) + zg * Math.cos(ecl);
  const ra = Math.atan2(ye, xe);
  const dec = Math.atan2(ze, Math.hypot(xe, ye));
  // hour angle, then altitude and azimuth
  const n = jd - 2_451_545.0;
  const gmstHours = 18.697374558 + 24.06570982441908 * n;
  const lst = norm360(gmstHours * 15 + lonDeg) * RAD;
  const H = lst - ra;
  const phi = latDeg * RAD;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(H) * Math.sin(phi));
  const east = Math.sin(az) * Math.cos(el);
  const north = Math.cos(az) * Math.cos(el);
  const elongation = norm360(lon - Ls);
  return {
    azimuth: norm360(az / RAD),
    elevation: el / RAD,
    direction: [east, sinEl, -north],
    illuminated: (1 - Math.cos(elongation * RAD)) / 2,
    elongation,
  };
}

/** The familiar name of the phase for an elongation (angle between moon and sun along the ecliptic, in degrees). */
export function moonPhaseName(elongation: number): string {
  const e = ((elongation % 360) + 360) % 360;
  if (e < 22.5 || e >= 337.5) return "New moon";
  if (e < 67.5) return "Waxing crescent";
  if (e < 112.5) return "First quarter";
  if (e < 157.5) return "Waxing gibbous";
  if (e < 202.5) return "Full moon";
  if (e < 247.5) return "Waning gibbous";
  if (e < 292.5) return "Last quarter";
  return "Waning crescent";
}
