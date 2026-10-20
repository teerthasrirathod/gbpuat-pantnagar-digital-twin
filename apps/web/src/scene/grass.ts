// Grass: tufts of blades on the lawns around the camera. Nothing is stored per tuft. A fixed grid of instances follows
// the camera, and the vertex shader works out where each tuft stands from its world cell (so a tuft stays put as the
// camera moves), reads the terrain height and the lawn mask from textures, and hides tufts that are off the lawn.
import {
  cameraPosition,
  float,
  floor,
  instanceIndex,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { mulberry32 } from "../core/rng.ts";
import type { Hero } from "../data/types.ts";
import { type Splat, sharpenMask, warpedSplat } from "./ground.ts";
import { cellRandom, fieldsAt, type N } from "./tsl-noise.ts";
import type { FloatUniform } from "./types.ts";

const GRID = 66; // cells along each side of the square that follows the camera
const CELL = 0.5; // metres
const REACH = (GRID / 2) * CELL;

/** One tuft: seven blades, each a bent strip of three triangles, drawn from both sides. Unit height 1. */
function tuftGeometry(): THREE.BufferGeometry {
  const rnd = mulberry32(5);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const BLADES = 7;
  for (let b = 0; b < BLADES; b++) {
    const yaw = rnd() * Math.PI * 2;
    const cx = (rnd() - 0.5) * 0.4;
    const cz = (rnd() - 0.5) * 0.4;
    const h = 0.6 + rnd() * 0.6;
    const width = 0.07 + rnd() * 0.03;
    const bendDir = rnd() * Math.PI * 2;
    const bend = 0.12 + rnd() * 0.28;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // three rings of the strip: base, middle, tip; each is a (left, right) pair apart from the tip
    const ring = (t: number): [number, number, number, number, number, number] => {
      const w = width * (1 - t * 0.75);
      const y = h * t;
      const out = bend * t * t;
      const ox = Math.cos(bendDir) * out;
      const oz = Math.sin(bendDir) * out;
      const lx = cx + ox + (-w / 2) * cy;
      const lz = cz + oz + (-w / 2) * sy;
      const rx = cx + ox + (w / 2) * cy;
      const rz = cz + oz + (w / 2) * sy;
      return [lx, y, lz, rx, y, rz];
    };
    const r0 = ring(0);
    const r1 = ring(0.5);
    const r2 = ring(1);
    const shade = (y: number): number => 0.72 + 0.55 * Math.min(1, y / h);
    // each strip is a quad (two triangles), drawn from both sides so that either face catches the light
    const strip = (a: number[], b: number[]): void => {
      const c: number[][] = [
        [a[0] as number, a[1] as number, a[2] as number],
        [a[3] as number, a[4] as number, a[5] as number],
        [b[3] as number, b[4] as number, b[5] as number],
        [b[0] as number, b[1] as number, b[2] as number],
      ];
      for (const order of [
        [0, 1, 2, 0, 2, 3],
        [0, 2, 1, 0, 3, 2],
      ]) {
        for (const k of order) {
          const v = c[k] as number[];
          pos.push(v[0] as number, v[1] as number, v[2] as number);
          nor.push(0, 1, 0);
          const t = shade(v[1] as number);
          col.push(t, t, t);
        }
      }
    };
    strip(r0, r1);
    strip(r1, r2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** The terrain heights, relative to the lowest point, as a half-float texture the vertex shader can filter. */
function heightTexture(hero: Hero): { tex: THREE.DataTexture; base: number } {
  const T = hero.file.terrain;
  const base = Math.min(...T.h);
  const data = new Uint16Array(T.nx * T.nz);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat((T.h[i] as number) - base);
  const tex = new THREE.DataTexture(data, T.nx, T.nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, base };
}

export interface Grass {
  mesh: THREE.InstancedMesh;
  /** call each frame with the camera: moves the grid of tufts to follow it, hides the grass from the air */
  update(camera: THREE.Camera): void;
}

export function createGrass(hero: Hero, splat: Splat, wind: FloatUniform): Grass {
  const geo = tuftGeometry();
  const { tex: heights, base } = heightTexture(hero);
  const T = hero.file.terrain;
  const spanX = (T.nx - 1) * T.step;
  const spanZ = (T.nz - 1) * T.step;
  const centre = uniform(new THREE.Vector2());

  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide, roughness: 0.85, metalness: 0 });
  m.vertexColors = true;

  // where this tuft stands: its world cell, jittered inside the cell
  const id = floor(float(instanceIndex));
  const gx = id.mod(GRID);
  const gz = floor(id.div(GRID));
  const snapped = floor(centre.div(CELL));
  const cellX = snapped.x.add(gx).sub(GRID / 2);
  const cellZ = snapped.y.add(gz).sub(GRID / 2);
  const cell = vec2(cellX, cellZ);
  const rand = (k: number): N => cellRandom(cell, k);
  const jx = rand(1).sub(0.5);
  const jz = rand(2).sub(0.5);
  const wx = cellX.add(0.5).add(jx.mul(1.6)).mul(CELL);
  const wz = cellZ.add(0.5).add(jz.mul(1.6)).mul(CELL);
  const world = vec2(wx, wz);

  const hUv = vec2(wx.sub(T.x0).div(spanX), wz.sub(T.z0).div(spanZ));
  const ground = texture(heights, hUv).r.add(base);
  const dist = world.sub(vec2(cameraPosition.x, cameraPosition.z)).length();
  // the same warped masks as the ground, so that the grass stops exactly where the lawn does
  const masks = warpedSplat(splat, world, float(1).sub(smoothstep(float(12), float(80), dist)));
  const lawn = sharpenMask(masks.r)
    .mul(float(1).sub(sharpenMask(masks.b)))
    .mul(float(1).sub(sharpenMask(masks.g)));
  const present = smoothstep(0.5, 0.75, lawn).mul(float(1).sub(smoothstep(REACH * 0.55, REACH * 0.95, dist)));
  const height = float(0.055)
    .add(rand(4).mul(0.07))
    .add(fieldsAt(world, 31, 0.11).r.mul(0.06))
    .mul(present);
  const yaw = rand(3).mul(6.2831) as THREE.Node<"float">;
  const c = yaw.cos();
  const s = yaw.sin();
  const p = positionLocal;
  const sway = sin(time.mul(1.7).add(wx.mul(0.45)).add(wz.mul(0.31)))
    .mul(0.045)
    .add(sin(time.mul(3.3).add(wx.mul(1.3))).mul(0.015));
  const bend = p.y.mul(p.y).mul(sway).mul(wind);
  // taller tufts are a little broader; off the lawn the whole tuft shrinks to a point (not just in height, or the
  // blades would lie flat on the road)
  const scaleW = float(1)
    .add(height.mul(2))
    .mul(smoothstep(0.02, 0.1, present));
  const local = vec3(p.x.mul(scaleW), p.y.mul(height), p.z.mul(scaleW));
  const turned = vec3(local.x.mul(c).sub(local.z.mul(s)), local.y, local.x.mul(s).add(local.z.mul(c)));
  m.positionNode = vec3(wx, ground, wz)
    .add(turned)
    .add(vec3(bend.mul(height), 0, bend.mul(height).mul(0.6)));

  // colour: the same lawn colours as the ground, so the blades melt into it; darker at the root, paler at the tip
  const mid = fieldsAt(world, 31, 0.11).g;
  const lawnBase = mix(vec3(0.026, 0.1, 0.019), vec3(0.105, 0.23, 0.032), mid);
  const dry = smoothstep(0.58, 0.85, fieldsAt(world, 110, 0.37).r).mul(0.6);
  const tone = mix(lawnBase, vec3(0.26, 0.25, 0.075), dry);
  const jitter = float(0.8).add(rand(5).mul(0.5));
  m.colorNode = tone.mul(vertexColor()).mul(jitter) as N;

  const mesh = new THREE.InstancedMesh(geo, m, GRID * GRID);
  mesh.name = "grass";
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    update(camera) {
      centre.value.set(camera.position.x, camera.position.z);
      mesh.visible = camera.position.y - hero.heightAt(camera.position.x, camera.position.z) < 18;
    },
  };
}
