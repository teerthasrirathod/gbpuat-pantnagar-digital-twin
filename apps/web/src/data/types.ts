import type { Pt, Ring } from "../core/geometry.ts";

/** Evidence behind a building's type: tag, name and place confirm it, context (land use) is good, shape is a guess. */
export type TypeEvidence = "tag" | "name" | "place" | "context" | "shape";
export type HeightSource = "tagged" | "measured" | "estimated" | "detected";

export interface RawBuilding {
  id: string;
  n: string | null;
  t: string;
  ts: TypeEvidence;
  f: number;
  h: number;
  hs: HeightSource;
  a: number;
  src: number;
  roof: number;
  tag: string | null;
  /** outer ring first, then holes, each a flat [x, z, x, z, ...] array */
  r: number[][];
}

export interface RawRoad {
  c: string;
  w: number;
  n: string | null;
  s: string | null;
  p: number[];
}
export interface RawArea {
  k: string;
  n: string | null;
  r: number[][];
}
export interface RawLine {
  k: string;
  w: number;
  p: number[];
}
export interface RawPoi {
  k: string;
  n: string;
  x: number;
  z: number;
}

export interface HeroFile {
  version: number;
  id: string;
  origin: { lat: number; lon: number };
  window: { cx: number; cz: number; size: number; margin: number; box: [number, number, number, number] };
  terrain: { x0: number; z0: number; step: number; nx: number; nz: number; h: number[] };
  buildings: RawBuilding[];
  trees: number[];
  roads: RawRoad[];
  areas: RawArea[];
  lines: RawLine[];
  pois: RawPoi[];
  water: { src: string; r: number[][] }[];
  sources: unknown;
  notes: string;
}

export interface Building {
  id: string;
  name: string | null;
  type: string;
  evidence: TypeEvidence;
  floors: number;
  height: number;
  heightSource: HeightSource;
  footprint: number;
  roofColour: number;
  /** outer ring (positive winding) */
  outer: Ring;
  holes: Ring[];
  centre: Pt;
  /** ground height at the lowest corner of the footprint */
  ground: number;
}

export interface Tree {
  x: number;
  z: number;
  height: number;
  ground: number;
}

export interface Hero {
  file: HeroFile;
  box: [number, number, number, number];
  /** square hero window without the margin: x0, z0, x1, z1 */
  core: [number, number, number, number];
  heightAt(x: number, z: number): number;
  buildings: Building[];
  trees: Tree[];
}
