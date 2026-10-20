// A small map of the hero window: lawns, roads, building footprints and trees drawn once, with a marker for where the
// camera is and which way it looks. Click it to go there.

import { flatToRing } from "../core/geometry.ts";
import type { Hero } from "../data/types.ts";

export interface Minimap {
  element: HTMLElement;
  /** call every frame or two: x, z in metres and the heading in radians clockwise from north */
  update(x: number, z: number, heading: number): void;
  setVisible(v: boolean): void;
}

const SIZE = 176; // css pixels
const LAWNS = new Set(["landuse:grass", "leisure:garden", "leisure:park", "landuse:meadow", "landuse:orchard"]);

/** Adds a polyline to the current path. */
function trace(
  g: CanvasRenderingContext2D,
  pts: readonly (readonly [number, number])[],
  X: (x: number) => number,
  Z: (z: number) => number,
): void {
  for (const [i, [x, z]] of pts.entries()) {
    if (i) g.lineTo(X(x), Z(z));
    else g.moveTo(X(x), Z(z));
  }
}

export function createMinimap(parent: HTMLElement, hero: Hero, onGo: (x: number, z: number) => void): Minimap {
  const [x0, z0, x1] = hero.core;
  const w = x1 - x0;
  const scale = SIZE / w;
  const root = document.createElement("div");
  root.className = "card minimap";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Map of the central campus: click to go to a place");
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(SIZE * dpr);
  canvas.style.width = canvas.style.height = `${SIZE}px`;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.scale(dpr, dpr);
  const X = (x: number): number => (x - x0) * scale;
  const Z = (z: number): number => (z - z0) * scale;

  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  g.fillStyle = dark ? "#1b241d" : "#ece8dc";
  g.fillRect(0, 0, SIZE, SIZE);
  // lawns
  g.fillStyle = dark ? "#2d4a33" : "#bfd3a4";
  for (const a of hero.file.areas) {
    if (!LAWNS.has(a.k)) continue;
    for (const r of a.r) {
      const ring = flatToRing(r);
      g.beginPath();
      trace(g, ring, X, Z);
      g.closePath();
      g.fill();
    }
  }
  // roads and paths
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const r of hero.file.roads) {
    const ring = flatToRing(r.p);
    g.beginPath();
    trace(g, ring, X, Z);
    g.strokeStyle = r.c === "path" ? (dark ? "#8a8f84" : "#cfcab9") : dark ? "#aeb3a8" : "#ffffff";
    g.lineWidth = Math.max(1, (r.c === "path" ? 1.6 : r.w) * scale * (r.c === "path" ? 1 : 0.9));
    g.stroke();
  }
  // buildings
  g.fillStyle = dark ? "#c9bfa4" : "#8b7f68";
  for (const b of hero.buildings) {
    g.beginPath();
    trace(g, b.outer, X, Z);
    g.closePath();
    g.fill();
  }
  // trees
  g.fillStyle = dark ? "#58a36f" : "#4f8a4a";
  for (const t of hero.trees) {
    g.beginPath();
    g.arc(X(t.x), Z(t.z), Math.max(0.9, t.height * 0.09 * scale), 0, Math.PI * 2);
    g.fill();
  }
  root.append(canvas);

  const marker = document.createElement("div");
  marker.className = "me";
  marker.innerHTML =
    '<svg viewBox="-12 -12 24 24" width="24" height="24"><path d="M0 -10 L7 7 L0 3 L-7 7 Z" fill="#e0a32e" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  root.append(marker);
  parent.append(root);

  root.addEventListener("pointerdown", (e) => e.stopPropagation());
  root.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    onGo(x0 + ((e.clientX - r.left) / r.width) * w, z0 + ((e.clientY - r.top) / r.height) * w);
  });
  return {
    element: root,
    update(x, z, heading) {
      const px = Math.max(0, Math.min(SIZE, X(x)));
      const pz = Math.max(0, Math.min(SIZE, Z(z)));
      marker.style.transform = `translate(${px - 12}px, ${pz - 12}px) rotate(${heading}rad)`;
    },
    setVisible(v) {
      root.hidden = !v;
    },
  };
}
