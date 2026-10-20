// The interface: a brand card, a toolbar (view, quality, picture, full screen, help), a time dock, a card for the
// building you click, a help sheet that says what is data and what is illustrative, and a small stats panel.
// Plain DOM, no framework: the app drives it through the small API at the end of this file.

import type { Clock } from "../core/clock.ts";
import { moonPhaseName, moonPosition } from "../core/moon.ts";
import { istHour, sunPosition, sunTimes } from "../core/sun.ts";
import type { Building, HeroFile } from "../data/types.ts";
import type { Quality } from "../render/pipeline.ts";
import { compass, type DataKind, describe, type WeatherState } from "../weather/data.ts";
import "./ui.css";

export type Mode = "street" | "orbit";
export type QualityChoice = "auto" | Quality;

export interface WeatherInfo {
  /** what is being drawn now */
  state: WeatherState;
  kind: DataKind;
  /** when the data was fetched (milliseconds since the epoch) */
  fetchedAt: number;
  enabled: boolean;
  /** the name of a preview situation, or null when following the data */
  preview: string | null;
}

export interface WeatherApi {
  info(): WeatherInfo;
  setEnabled(on: boolean): void;
  setPreview(name: string | null): void;
  refresh(): void;
}

export interface UIOptions {
  weather: WeatherApi;
  /** the tour button was pressed (start it, or stop it when it is running) */
  onTour(): void;
  touring(): boolean;
  clock: Clock;
  lat: number;
  lon: number;
  getMode(): Mode;
  setMode(m: Mode): void;
  getQuality(): QualityChoice;
  setQuality(q: QualityChoice): void;
  screenshot(): void;
  /** the user changed the time: the app should apply the clock */
  onTime(): void;
  /** the building card was closed: the app should clear the selection */
  onBuildingClosed(): void;
  sources: HeroFile["sources"];
}

export interface Stats {
  backend: string;
  tier: string;
  ratio: number | null;
  fps: number;
  cpuMs: number;
  gpuMs: number | null;
  calls: number;
  triangles: number;
  buildings: number;
  trees: number;
}

export interface UI {
  /** call every few frames: refreshes the stats and, if the clock moved, the time dock */
  update(stats: Stats): void;
  /** call after the clock was changed from outside (keys, playback) */
  refreshTime(): void;
  showBuilding(b: Building | null): void;
  toast(text: string): void;
  refreshMode(): void;
  /** shows a caption above the time dock (null hides it) */
  setCaption(text: string | null): void;
  /** the element that holds everything, for adding the map and the walking stick */
  readonly root: HTMLElement;
  refreshTour(): void;
  toggleHelp(force?: boolean): void;
  toggleStats(force?: boolean): void;
}

const ICONS = {
  street: '<path d="M12 5.5a2 2 0 1 0 0 .01M9 21l1.2-6.2-2.4 1.4V12l4.2-1.8L16 12v4l-2.5-1.4L14.7 21"/>',
  orbit: '<circle cx="12" cy="12" r="3.2"/><path d="M3 12c0-2.2 4-4 9-4s9 1.8 9 4-4 4-9 4-9-1.8-9-4z"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  tour: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8M12 17h.01"/>',
  stats: '<path d="M5 19V11M12 19V5M19 19v-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18z"/>',
  rain: '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 5.5 4.3 4.3 0 0 0 7 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  storm: '<path d="M7 13h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 4.5 4.3 4.3 0 0 0 7 13zM12.5 13l-2.5 4h3l-2 4"/>',
  fog: '<path d="M7 11h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 2.5 4.3 4.3 0 0 0 7 11zM4 15h16M6 19h12"/>',
} as const;

const svg = (name: keyof typeof ICONS): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

const TYPE_LABEL: Record<string, string> = {
  academic: "Academic",
  admin: "Administrative",
  institutional: "Institutional",
  residential: "Residential",
  house: "House",
  hostel: "Hostel",
  utility: "Utility",
  health: "Health",
  school: "School",
  commercial: "Commercial",
  religious: "Religious",
  sports: "Sports",
  farm: "Farm",
  industrial: "Industrial",
  unknown: "Unknown",
};

const EVIDENCE: Record<string, { label: string; tone: "good" | "maybe" | "bad"; note: string }> = {
  tag: { label: "Type confirmed", tone: "good", note: "from a map tag" },
  name: { label: "Type confirmed", tone: "good", note: "from its name" },
  place: { label: "Type confirmed", tone: "good", note: "from place data" },
  context: { label: "Type likely", tone: "maybe", note: "inferred from the land use around it" },
  shape: { label: "Type not confirmed", tone: "bad", note: "guessed from the shape of the footprint" },
};

const HEIGHT_SOURCE: Record<string, string> = {
  measured: "Measured by satellite (Google Open Buildings 2.5D, about 4 m accuracy)",
  detected: "Detected by satellite (Google Open Buildings)",
  tagged: "Tagged on the map",
  estimated: "Estimated from the footprint area",
};

const fmtDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const hhmm = (hour: number): string => {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60 + 1e-6);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** The colour of the sky track for a sun elevation, from night blue through the orange of twilight to day blue. */
function skyColour(el: number): string {
  const stops: [number, [number, number, number]][] = [
    [-18, [9, 16, 36]],
    [-8, [32, 38, 78]],
    [-1, [200, 100, 70]],
    [4, [238, 170, 100]],
    [14, [150, 195, 235]],
    [40, [106, 176, 238]],
  ];
  if (el <= (stops[0] as (typeof stops)[number])[0]) return `rgb(${(stops[0] as (typeof stops)[number])[1].join(",")})`;
  for (let i = 1; i < stops.length; i++) {
    const [e1, c1] = stops[i] as (typeof stops)[number];
    const [e0, c0] = stops[i - 1] as (typeof stops)[number];
    if (el <= e1) {
      const t = (el - e0) / (e1 - e0);
      return `rgb(${c0.map((v, k) => Math.round(v + ((c1[k] as number) - v) * t)).join(",")})`;
    }
  }
  return `rgb(${(stops[stops.length - 1] as (typeof stops)[number])[1].join(",")})`;
}

export function createUI(root: HTMLElement, o: UIOptions): UI {
  const ui = el("div", { id: "ui" });
  root.append(ui);

  // brand
  const brand = el(
    "header",
    { class: "card brand" },
    el("div", { class: "logo" }),
    el("div", {}, el("b", {}, "GBPUAT Pantnagar"), el("small", {}, "Campus digital twin · Library avenue and the old colleges")),
  );
  (brand.querySelector(".logo") as HTMLElement).innerHTML =
    '<svg viewBox="0 0 32 32" width="22" height="22"><path d="M6 24V14l10-7 10 7v10h-6v-7h-8v7z" fill="#f2e8cf"/></svg>';
  ui.append(brand);

  // toolbar
  const streetBtn = el("button", { type: "button", "aria-pressed": "true", title: "Walk at street level (V)" }, "Street");
  const orbitBtn = el("button", { type: "button", "aria-pressed": "false", title: "Fly over the campus (V)" }, "Orbit");
  const seg = el("div", { class: "seg", role: "group", "aria-label": "View" }, streetBtn, orbitBtn);
  const qualitySel = el(
    "select",
    { class: "sel", "aria-label": "Quality", title: "Image quality (K)" },
    el("option", { value: "auto" }, "Quality: auto"),
    el("option", { value: "high" }, "High"),
    el("option", { value: "medium" }, "Medium"),
    el("option", { value: "off" }, "Basic"),
  );
  const iconBtn = (icon: keyof typeof ICONS, title: string, pressed = false): HTMLButtonElement => {
    const b = el("button", { type: "button", class: "iconbtn", title, "aria-label": title });
    if (pressed) b.setAttribute("aria-pressed", "false");
    b.innerHTML = svg(icon);
    return b;
  };
  const shotBtn = iconBtn("camera", "Save a picture (P)");
  const fullBtn = iconBtn("full", "Full screen (F)");
  const statsBtn = iconBtn("stats", "Performance (I)", true);
  const tourBtn = iconBtn("tour", "Guided tour (G)", true);
  // when this viewer is served under /next/, the classic viewer with the Sandbox (plan and simulate) is one level up
  const classicUrl = /\/next\/?$/.test(location.pathname) ? new URL("../", location.href).href : null;
  const classicLink = classicUrl
    ? el("a", { class: "linkbtn", href: classicUrl, title: "Plan and simulate projects in the Sandbox (classic viewer)" }, "Sandbox")
    : null;
  const helpBtn = iconBtn("help", "Help and data (H)");
  const wxBtn = el("button", { type: "button", class: "wxbtn", title: "Weather", "aria-pressed": "false" });
  const toolbar = el(
    "nav",
    { class: "card toolbar", "aria-label": "View controls" },
    seg,
    qualitySel,
    wxBtn,
    tourBtn,
    ...(classicLink ? [classicLink] : []),
    shotBtn,
    fullBtn,
    statsBtn,
    helpBtn,
  );
  ui.append(toolbar);

  // time dock
  const playBtn = el("button", { type: "button", class: "play", title: "Play or pause time (Space)", "aria-label": "Play or pause time" });
  const readout = el("div", { class: "readout" }, el("b", {}), el("span", {}));
  const rateSel = el(
    "select",
    { class: "sel", "aria-label": "Playback speed", title: "Playback speed" },
    el("option", { value: "60" }, "1 min/s"),
    el("option", { value: "900", selected: "" }, "15 min/s"),
    el("option", { value: "3600" }, "1 h/s"),
  );
  const nowBtn = el("button", { type: "button", class: "now", "aria-pressed": "false", title: "Follow the real clock" }, "Now");
  const slider = el("input", {
    type: "range",
    min: "0",
    max: "1439",
    step: "5",
    value: "630",
    "aria-label": "Time of day (India Standard Time)",
  });
  const ticks = el("div", { class: "ticks", "aria-hidden": "true" });
  const track = el("div", { class: "track" }, slider, ticks);
  const dock = el(
    "section",
    { class: "card dock", "aria-label": "Time of day" },
    playBtn,
    readout,
    el("div", { class: "right" }, rateSel, nowBtn),
    track,
  );
  ui.append(dock);

  // stats
  const stats = el("div", { id: "hud", class: "card stats", hidden: "", role: "status" });
  ui.append(stats);

  const caption = el("div", { class: "caption", hidden: "", "aria-live": "polite" });
  ui.append(caption);

  // weather card
  const wxCard = el("aside", { class: "card wxcard", hidden: "", "aria-live": "polite" });
  ui.append(wxCard);

  // building card
  const info = el("aside", { class: "card info", hidden: "", "aria-live": "polite" });
  ui.append(info);

  // help
  const help = el("div", { class: "modal", hidden: "", role: "dialog", "aria-modal": "true", "aria-label": "Help and data" });
  ui.append(help);
  const toastEl = el("div", { class: "card toast", hidden: "", role: "status" });
  ui.append(toastEl);

  // ---- behaviour ----
  const setPressed = (b: HTMLElement, v: boolean): void => b.setAttribute("aria-pressed", String(v));
  const refreshMode = (): void => {
    setPressed(streetBtn, o.getMode() === "street");
    setPressed(orbitBtn, o.getMode() === "orbit");
  };
  streetBtn.addEventListener("click", () => {
    o.setMode("street");
    refreshMode();
  });
  orbitBtn.addEventListener("click", () => {
    o.setMode("orbit");
    refreshMode();
  });
  qualitySel.value = o.getQuality();
  qualitySel.addEventListener("change", () => o.setQuality(qualitySel.value as QualityChoice));
  shotBtn.addEventListener("click", () => o.screenshot());
  fullBtn.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  });
  tourBtn.addEventListener("click", () => o.onTour());
  statsBtn.addEventListener("click", () => ui_.toggleStats());
  wxBtn.addEventListener("click", () => {
    wxCard.hidden = !wxCard.hidden;
    setPressed(wxBtn, !wxCard.hidden);
    lastWx = "";
    refreshWeather();
  });
  helpBtn.addEventListener("click", () => ui_.toggleHelp());

  playBtn.addEventListener("click", () => {
    o.clock.live = false;
    o.clock.playing = !o.clock.playing;
    ui_.refreshTime();
  });
  rateSel.addEventListener("change", () => {
    o.clock.rate = Number(rateSel.value);
  });
  o.clock.rate = Number(rateSel.value);
  nowBtn.addEventListener("click", () => {
    o.clock.goLive();
    o.onTime();
    ui_.refreshTime();
  });
  slider.addEventListener("input", () => {
    o.clock.playing = false;
    o.clock.setHour(Number(slider.value) / 60);
    o.onTime();
    ui_.refreshTime();
  });

  // the sky colours along the slider, and sunrise and sunset marks, rebuilt when the day changes
  let trackDay = -1;
  const rebuildTrack = (): void => {
    const day = Math.floor((o.clock.ms + 5.5 * 3_600_000) / 86_400_000);
    if (day === trackDay) return;
    trackDay = day;
    const stops: string[] = [];
    const base = o.clock.ms - istHour(o.clock.ms) * 3_600_000;
    for (let i = 0; i <= 96; i++) {
      const el_ = sunPosition(base + i * 15 * 60_000, o.lat, o.lon).elevation;
      stops.push(`${skyColour(el_)} ${((i / 96) * 100).toFixed(2)}%`);
    }
    slider.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
    ticks.replaceChildren();
    const mark = (hour: number, label: string): void => {
      const s = el("span", {}, label);
      s.style.left = `${(hour / 24) * 100}%`;
      // the end labels sit inside the track instead of hanging over its edges
      if (hour <= 0) s.style.transform = "none";
      if (hour >= 24) s.style.transform = "translateX(-100%)";
      ticks.append(s);
    };
    mark(0, "00:00");
    mark(12, "12:00");
    mark(24, "24:00");
    const t = sunTimes(o.clock.ms, o.lat, o.lon);
    if (t.sunrise !== null) mark(istHour(t.sunrise), `↑ ${hhmm(istHour(t.sunrise))}`);
    if (t.sunset !== null) mark(istHour(t.sunset), `↓ ${hhmm(istHour(t.sunset))}`);
  };

  let lastReadout = "";
  const refreshTime = (): void => {
    rebuildTrack();
    const hour = istHour(o.clock.ms);
    slider.value = String(Math.min(1439, Math.floor((hour * 60) / 5) * 5));
    const sun = sunPosition(o.clock.ms, o.lat, o.lon);
    const moon = moonPosition(o.clock.ms, o.lat, o.lon);
    const when = `${fmtDate.format(new Date(o.clock.ms))} · ${hhmm(hour)} IST`;
    const sunText = sun.elevation > 0 ? `Sun ${Math.round(sun.elevation)}° up` : `Sun ${Math.round(-sun.elevation)}° below the horizon`;
    const moonText = `${moonPhaseName(moon.elongation)}, ${Math.round(moon.illuminated * 100)}% lit${moon.elevation > 0 ? "" : " (down)"}`;
    const key = `${when}|${sunText}|${moonText}|${o.clock.playing}|${o.clock.live}`;
    if (key !== lastReadout) {
      lastReadout = key;
      (readout.querySelector("b") as HTMLElement).textContent = when;
      (readout.querySelector("span") as HTMLElement).textContent = `${sunText} · ${moonText}`;
      playBtn.innerHTML = o.clock.playing
        ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      setPressed(nowBtn, o.clock.live);
    }
  };

  const wxIcon = (s: WeatherState): keyof typeof ICONS => {
    if (s.code >= 95) return "storm";
    if (s.code === 45 || s.code === 48 || s.visibility < 1500) return "fog";
    if (s.rain > 0.2 || (s.code >= 51 && s.code <= 82)) return "rain";
    if (s.cloud > 0.45) return "cloud";
    return s.day ? "sun" : "moon";
  };
  let lastWx = "";
  const refreshWeather = (): void => {
    const w = o.weather.info();
    const s = w.state;
    const temp = Number.isNaN(s.temperature) ? "" : `${Math.round(s.temperature)}°`;
    const label = w.enabled ? describe(s.code) : "Clear (weather off)";
    const key = [
      wxIcon(s),
      temp,
      wxCard.hidden,
      w.kind,
      w.preview,
      w.enabled,
      Math.round(s.cloud * 20),
      Math.round(s.rain * 4),
      Math.round(s.wind),
      Math.round(s.visibility / 100),
      Math.round(s.wet * 20),
    ].join("|");
    if (key === lastWx) return;
    lastWx = key;
    wxBtn.innerHTML = `${svg(wxIcon(s))}<span>${temp}</span>`;
    wxBtn.title = `Weather: ${label}`;
    if (wxCard.hidden) return;
    const status = !w.enabled
      ? "Off"
      : w.preview
        ? "Preview"
        : { stored: "Live, stored", live: "Live", cache: "Last saved", typical: "Typical day" }[w.kind];
    const ago = Math.max(0, Math.round((Date.now() - w.fetchedAt) / 60_000));
    const choice = (name: string | null, text: string, on: boolean): HTMLButtonElement => {
      const b = el("button", { type: "button", "aria-pressed": String(on) }, text);
      b.addEventListener("click", () => {
        if (name === "off") o.weather.setEnabled(false);
        else {
          o.weather.setEnabled(true);
          o.weather.setPreview(name);
        }
        lastWx = "";
        refreshWeather();
      });
      return b;
    };
    const close = el("button", { type: "button", class: "iconbtn close", "aria-label": "Close weather" });
    close.innerHTML = svg("close");
    close.addEventListener("click", () => {
      wxCard.hidden = true;
      setPressed(wxBtn, false);
    });
    const row = (k: string, v: string): Node[] => [el("dt", {}, k), el("dd", {}, v)];
    const big = el("div", { class: "wxbig" });
    big.innerHTML = `${svg(wxIcon(s))}<div><b>${temp || "-"}</b><span>${label}</span></div>`;
    const dataNote = w.preview
      ? "Showing a preview, not the real weather."
      : w.kind === "typical"
        ? "No live data yet: showing a typical day."
        : `Data fetched ${ago < 1 ? "just now" : `${ago} min ago`}.`;
    wxCard.replaceChildren(
      close,
      el("h2", {}, "Weather", el("span", { class: `chip ${w.kind === "typical" || w.preview ? "maybe" : "good"}` }, status)),
      big,
      el(
        "dl",
        { class: "kv" },
        ...row("Wind", `${Math.round(s.wind)} km/h from ${compass(s.windDir)}, gusts ${Math.round(s.gust)}`),
        ...row("Cloud", `${Math.round(s.cloud * 100)}%`),
        ...row("Rain", `${s.rain.toFixed(1)} mm/h`),
        ...row("Visibility", s.visibility >= 1000 ? `${(s.visibility / 1000).toFixed(1)} km` : `${Math.round(s.visibility)} m`),
        ...row("Humidity", Number.isNaN(s.humidity) ? "-" : `${Math.round(s.humidity)}%`),
        ...row("Ground", `${Math.round(s.wet * 100)}% wet`),
      ),
      el(
        "div",
        { class: "seg wxseg", role: "group", "aria-label": "Weather to show" },
        choice(null, "Live", w.enabled && !w.preview),
        choice("clear", "Clear", w.preview === "clear"),
        choice("cloudy", "Cloudy", w.preview === "cloudy"),
        choice("rain", "Rain", w.preview === "rain"),
        choice("storm", "Storm", w.preview === "storm"),
        choice("fog", "Fog", w.preview === "fog"),
        choice("off", "Off", !w.enabled),
      ),
      el(
        "p",
        { class: "note" },
        `A model estimate (ECMWF, about 9 km grid) blended from six points around Pantnagar, not a station reading. ${dataNote}`,
      ),
    );
  };

  const toast = (text: string): void => {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout((toast as unknown as { t?: number }).t);
    (toast as unknown as { t?: number }).t = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 2600);
  };

  const showBuilding = (b: Building | null): void => {
    if (!b) {
      info.hidden = true;
      return;
    }
    const ev = EVIDENCE[b.evidence] ?? (EVIDENCE.shape as (typeof EVIDENCE)[string]);
    const close = el("button", { type: "button", class: "iconbtn close", "aria-label": "Close" });
    close.innerHTML = svg("close");
    close.addEventListener("click", () => {
      info.hidden = true;
      o.onBuildingClosed();
    });
    const row = (k: string, v: string): Node[] => [el("dt", {}, k), el("dd", {}, v)];
    info.replaceChildren(
      close,
      el("h2", {}, b.name ?? "Building"),
      el(
        "div",
        { class: "chips" },
        el("span", { class: "chip" }, TYPE_LABEL[b.type] ?? b.type),
        el("span", { class: `chip ${ev.tone}`, title: ev.note }, ev.label),
      ),
      el(
        "dl",
        { class: "kv" },
        ...row("Height", `${b.height.toFixed(1)} m`),
        ...row("Height from", HEIGHT_SOURCE[b.heightSource] ?? b.heightSource),
        ...row("Floors", `${b.floors} (worked out from the height)`),
        ...row("Footprint", `${Math.round(b.footprint).toLocaleString("en-IN")} m²`),
        ...row("Type", `${TYPE_LABEL[b.type] ?? b.type}, ${ev.note}`),
        ...row("Map id", b.id),
      ),
      el(
        "p",
        { class: "note" },
        "Windows, doors, colours and roof details are illustrative: the data holds the footprint, height and type, not the facade.",
      ),
    );
    info.hidden = false;
  };

  const buildHelp = (): void => {
    const close = el("button", { type: "button", class: "iconbtn close", "aria-label": "Close help" });
    close.innerHTML = svg("close");
    close.addEventListener("click", () => ui_.toggleHelp(false));
    const keys: [string, string][] = [
      ["W A S D · arrows", "Walk (street) or fly (orbit)"],
      ["Q · E", "Turn left or right"],
      ["Shift", "Run, or fly faster"],
      ["Drag · wheel", "Look around · change the lens"],
      ["V", "Street or orbit view"],
      ["Space", "Play or pause time"],
      ["T · Shift T", "Next or previous hour"],
      ["N", "Follow the real clock"],
      ["K", "Cycle image quality"],
      ["P", "Save a picture"],
      ["G", "Guided tour (flies through the campus from morning to night)"],
      ["F", "Full screen"],
      ["I", "Performance numbers"],
      ["H or ?", "This help"],
      ["Click a building", "See what the data says about it"],
      ["Esc", "Close cards"],
    ];
    const sources = o.sources as { layer: string; name: string; licence?: string }[];
    help.replaceChildren(
      el(
        "div",
        { class: "sheet" },
        close,
        el("h2", {}, "GBPUAT Pantnagar digital twin"),
        el(
          "p",
          {},
          "A model of the central campus of G.B. Pant University of Agriculture and Technology, built from open data, drawn with a modern graphics pipeline. The sun, moon and stars are placed for the real date and time over Pantnagar.",
        ),
        el("h3", {}, "Controls"),
        el("div", { class: "keys" }, ...keys.map(([k, v]) => el("div", {}, el("kbd", {}, k), ` ${v}`))),
        el("h3", {}, "What is data and what is illustrative"),
        el(
          "ul",
          {},
          el(
            "li",
            {},
            "From data: where the buildings, roads, paths and lawns are, the height of each building (measured or estimated, see its card), the ground levels, and where mapped trees stand.",
          ),
          el(
            "li",
            {},
            "Illustrative: the look of the facades and windows, the species of each tree, lamp posts, benches, parked and moving vehicles, and the people. These follow rules (they never change between visits) but are not surveyed.",
          ),
          el("li", {}, "Beyond the central window the land is a generic patchwork of farm fields, there to give the view a horizon."),
        ),
        el("h3", {}, "Data sources"),
        el("ul", {}, ...sources.map((s) => el("li", {}, `${s.layer}: ${s.name}${s.licence ? ` (${s.licence})` : ""}`))),
        ...(classicUrl
          ? [
              el(
                "p",
                {},
                "To plan a project and test it here before testing it on the road, open the ",
                el("a", { href: classicUrl }, "Sandbox"),
                " in the classic viewer.",
              ),
            ]
          : []),
        el(
          "p",
          { class: "note" },
          "Open data is used under the licences listed. The Sun, Moon and star positions are calculated, not read from a service.",
        ),
      ),
    );
    help.addEventListener("click", (e) => {
      if (e.target === help) ui_.toggleHelp(false);
    });
  };

  const ui_: UI = {
    root: ui,
    setCaption(text) {
      caption.hidden = text === null;
      if (text !== null) caption.textContent = text;
    },
    refreshTour() {
      setPressed(tourBtn, o.touring());
      tourBtn.title = o.touring() ? "Stop the tour (G or Esc)" : "Guided tour (G)";
    },
    update(s) {
      stats.innerHTML = `<b>${s.backend}</b> · ${s.tier}${s.ratio !== null ? ` · ${Math.round(s.ratio * 100)}% res` : ""} · ${s.fps.toFixed(0)} fps · ${s.cpuMs.toFixed(1)} ms CPU${
        s.gpuMs !== null ? ` · ${s.gpuMs.toFixed(1)} ms GPU` : ""
      }<div class="row"><span>${s.calls} draw calls</span><span>${(s.triangles / 1000).toFixed(0)}k triangles</span><span>${s.buildings} buildings</span><span>${s.trees} mapped trees</span></div>`;
      if (o.clock.playing || o.clock.live) refreshTime();
      refreshWeather();
    },
    refreshTime,
    showBuilding,
    toast,
    refreshMode,
    toggleHelp(force) {
      const next = force ?? Boolean(help.hidden);
      if (next && help.childElementCount === 0) buildHelp();
      help.hidden = !next;
    },
    toggleStats(force) {
      const next = force ?? Boolean(stats.hidden);
      stats.hidden = !next;
      setPressed(statsBtn, next);
    },
  };

  refreshMode();
  refreshTime();
  refreshWeather();
  // keys that belong to the interface; the others are handled by the app
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT" || (e.target as HTMLElement | null)?.tagName === "SELECT") return;
    switch (e.code) {
      case "KeyH":
        ui_.toggleHelp();
        break;
      case "Slash":
        if (e.shiftKey) ui_.toggleHelp();
        break;
      case "KeyI":
        ui_.toggleStats();
        break;
      case "Escape":
        ui_.toggleHelp(false);
        if (!info.hidden) {
          showBuilding(null);
          o.onBuildingClosed();
        }
        break;
      case "KeyP":
        o.screenshot();
        break;
      case "KeyG":
        o.onTour();
        break;
      case "KeyF":
        fullBtn.click();
        break;
    }
  });
  void sunTimes;
  return ui_;
}
