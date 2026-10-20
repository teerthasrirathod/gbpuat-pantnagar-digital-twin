// Street furniture and life: lamp posts, benches and bins along the roads and paths, parked vehicles and bicycle
// clusters on the hard ground in front of buildings, moving traffic and walking people.
//
// All of this is scene dressing. The data says where the roads, paths and buildings are, not where each bench or car
// stands, so these are placed by seeded rules (deterministic, the same on every visit) and are illustrative.
import { attribute, cos, float, floor, mix, mod, positionGeometry, select, sin, step, time, vec3, vertexColor } from "three/tsl";
import * as THREE from "three/webgpu";
import { hashString, mulberry32 } from "../core/rng.ts";
import { BuildingIndex, pointAt, polylineLength, sampleAlong } from "../core/spatial.ts";
import type { Hero } from "../data/types.ts";
import { type Splat, sampleSplat } from "./ground.ts";
import * as models from "./props-models.ts";
import type { EnvUniforms, FloatUniform } from "./types.ts";

// ---- material --------------------------------------------------------------------------------------------------

interface PropMaterialOptions {
  /** lights glow at night (street lamps, and the lights of moving vehicles) */
  glow: boolean;
  /** swing the legs and arms of walking figures */
  walk: boolean;
}

function createPropMaterial(env: EnvUniforms, wet: FloatUniform, opts: PropMaterialOptions): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const aMat = attribute("aMat", "vec4");
  const tint = attribute("iTint", "vec3");
  const tint2 = attribute("iTint2", "vec3");
  const unit = mod(aMat.w, float(10));
  const base = vertexColor();
  const isPaint = step(4.5, unit).mul(step(unit, 5.5));
  const isTrim = step(5.5, unit).mul(step(unit, 6.5));
  const painted = mix(mix(base, base.mul(tint), isPaint), base.mul(tint2), isTrim);
  m.colorNode = painted.mul(mix(float(1), float(0.75), wet));
  m.roughnessNode = aMat.x.mul(mix(float(1), float(0.7), wet));
  m.metalnessNode = aMat.y;
  if (opts.glow) m.emissiveNode = base.mul(aMat.z).mul(env.night).mul(1.6);
  if (opts.walk) {
    const phase = attribute("iPhase", "float");
    const anim = floor(aMat.w.div(10));
    const swing = sin(time.mul(7.2).add(phase)).mul(0.55);
    const isLegL = step(0.5, anim).mul(step(anim, 1.5));
    const isLegR = step(1.5, anim).mul(step(anim, 2.5));
    const isArmL = step(2.5, anim).mul(step(anim, 3.5));
    const isArmR = step(3.5, anim).mul(step(anim, 4.5));
    // legs swing in opposition, each arm against the leg on its side
    const angle = isLegL.mul(swing).sub(isLegR.mul(swing)).sub(isArmL.mul(swing).mul(0.8)).add(isArmR.mul(swing).mul(0.8));
    const pivotY = select(anim.lessThan(2.5), float(0.86), float(1.4));
    // the swing is worked out in the figure's own frame (the raw vertex position), because the instance transform has
    // already been applied to positionLocal; the figure is then placed from its pose (x, y, z, yaw)
    const pose = attribute("iPose", "vec4");
    const p = positionGeometry;
    const dy = p.y.sub(pivotY);
    const c = cos(angle);
    const s = sin(angle);
    const moved = vec3(p.x.mul(c).sub(dy.mul(s)), pivotY.add(p.x.mul(s)).add(dy.mul(c)), p.z);
    // a gentle bob as they step
    const bob = sin(time.mul(14.4).add(phase.mul(2)))
      .abs()
      .mul(0.025);
    const lp = mix(p, moved, step(0.5, anim));
    const cy = cos(pose.w);
    const sy = sin(pose.w);
    m.positionNode = vec3(
      lp.x.mul(cy).add(lp.z.mul(sy)).add(pose.x),
      lp.y.add(pose.y).add(bob),
      lp.x.mul(sy).negate().add(lp.z.mul(cy)).add(pose.z),
    );
  }
  return m;
}

// ---- instancing helper -----------------------------------------------------------------------------------------

class Instances {
  readonly mesh: THREE.InstancedMesh;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly tint2: THREE.InstancedBufferAttribute;
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly pose: THREE.InstancedBufferAttribute;
  private n = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly col = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    readonly name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacity: number,
    castShadow = true,
  ) {
    const g = geometry.clone();
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.tint2 = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.pose = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    g.setAttribute("iTint", this.tint);
    g.setAttribute("iTint2", this.tint2);
    g.setAttribute("iPhase", this.phase);
    g.setAttribute("iPose", this.pose);
    this.mesh = new THREE.InstancedMesh(g, material, Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.name = name;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.n;
  }

  /** Adds an instance at a position, facing `yaw` radians (model +x turned toward the given heading). */
  add(x: number, y: number, z: number, yaw: number, tint?: number, tint2?: number, phase = 0, scale = 1): number {
    if (this.n >= this.capacity) return -1;
    const i = this.n++;
    this.set(i, x, y, z, yaw, scale);
    if (tint !== undefined) this.col.setHex(tint).toArray(this.tint.array as Float32Array, i * 3);
    if (tint2 !== undefined) this.col.setHex(tint2).toArray(this.tint2.array as Float32Array, i * 3);
    (this.phase.array as Float32Array)[i] = phase;
    this.mesh.count = this.n;
    this.tint.needsUpdate = true;
    this.tint2.needsUpdate = true;
    this.phase.needsUpdate = true;
    return i;
  }

  set(i: number, x: number, y: number, z: number, yaw: number, scale = 1): void {
    this.q.setFromAxisAngle(Instances.UP, yaw);
    this.pos.set(x, y, z);
    this.scl.setScalar(scale);
    this.mesh.setMatrixAt(i, this.m4.compose(this.pos, this.q, this.scl));
    this.mesh.instanceMatrix.needsUpdate = true;
    const a = this.pose.array as Float32Array;
    a[i * 4] = x;
    a[i * 4 + 1] = y;
    a[i * 4 + 2] = z;
    a[i * 4 + 3] = yaw;
    this.pose.needsUpdate = true;
  }
}

/** The yaw that turns a model's +x axis toward the heading (dx, dz). */
const yawToward = (dx: number, dz: number): number => Math.atan2(-dz, dx);

const CAR_COLOURS = [
  0xf2f2f0, 0xf2f2f0, 0xf2f2f0, 0xe8e8e6, 0xb9bcc0, 0xa4a8ad, 0x6e7378, 0x1c1e21, 0x9e1b1b, 0x1f3f78, 0x2c5c3f, 0xc7a46a,
];
const BIKE_COLOURS = [0x1c1e21, 0x1c1e21, 0x9e1b1b, 0x1f3f78, 0x6e7378, 0xd9d9d6];
const SHIRTS = [0xe8e4dc, 0x274c8a, 0x9b2c2c, 0x2f6b4a, 0xd9b84a, 0x6b6f76, 0xc7792b, 0x58407a, 0x1c1e21, 0x7fa3c7];
const TROUSERS = [0x1d2433, 0x1c1e21, 0x3b3a36, 0x4a5568, 0x6d5a45, 0x23344f];
const RICKSHAW_COLOURS = [0xe2b524, 0x2c7a4b, 0x2f5fa8, 0xd9d9d6];

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length] as T;

// ---- the props -------------------------------------------------------------------------------------------------

export interface Props {
  group: THREE.Group;
  /** moves the traffic and the pedestrians */
  update(dt: number): void;
  counts: Record<string, number>;
  triangles: number;
}

interface Mover {
  roads: number[];
  road: number;
  d: number;
  speed: number;
  /** +1 forward along the polyline, -1 backward */
  dir: number;
  lateral: number;
  index: number;
  yawOffset: number;
}

export function buildProps(hero: Hero, splat: Splat, env: EnvUniforms, wet: FloatUniform): Props {
  const group = new THREE.Group();
  group.name = "props";
  const rnd = mulberry32(hashString("props"));
  const index = new BuildingIndex(hero.buildings);
  const [x0, z0, x1, z1] = hero.core;
  const inCore = (x: number, z: number): boolean => x > x0 && x < x1 && z > z0 && z < z1;
  const ground = (x: number, z: number): number => hero.heightAt(x, z);
  const roads = hero.file.roads;
  const drivable = roads.map((r, i) => ({ r, i })).filter(({ r }) => r.c !== "path" && r.c !== "track" && r.w >= 3.5);
  const paths = roads.map((r, i) => ({ r, i })).filter(({ r }) => r.c === "path");

  const still = createPropMaterial(env, wet, { glow: false, walk: false });
  const lit = createPropMaterial(env, wet, { glow: true, walk: false });
  const walking = createPropMaterial(env, wet, { glow: false, walk: true });
  const used: { x: number; z: number }[] = [];
  const clear = (x: number, z: number, r: number): boolean => used.every((u) => (u.x - x) ** 2 + (u.z - z) ** 2 > r * r);

  // lamp posts, alternating sides, every 34 m along the drivable roads
  const lamps = new Instances("lamps", models.lampPost(), lit, 400);
  for (const { r } of drivable) {
    let side = rnd() < 0.5 ? 1 : -1;
    for (const s of sampleAlong(r.p, 34, 9 + rnd() * 10)) {
      side = -side;
      const off = r.w / 2 + 1.1;
      const nx = s.dz * side;
      const nz = -s.dx * side;
      const x = s.x + nx * off;
      const z = s.z + nz * off;
      if (!inCore(x, z) || index.blocked(x, z, 1.5) || !clear(x, z, 8)) continue;
      const surfaceHere = sampleSplat(splat, x, z);
      if (surfaceHere.road > 0.5) continue;
      lamps.add(x, ground(x, z), z, yawToward(-nx, -nz));
      used.push({ x, z });
    }
  }

  // benches and bins along the paths and beside the lawns
  const benches = new Instances("benches", models.bench(), still, 120);
  const bins = new Instances("bins", models.bin(), still, 80);
  for (const { r } of paths.concat(drivable)) {
    const isPath = r.c === "path";
    for (const s of sampleAlong(r.p, isPath ? 48 : 90, 12 + rnd() * 20)) {
      const side = rnd() < 0.5 ? 1 : -1;
      const off = r.w / 2 + (isPath ? 1.0 : 2.0);
      const nx = s.dz * side;
      const nz = -s.dx * side;
      const x = s.x + nx * off;
      const z = s.z + nz * off;
      if (!inCore(x, z) || index.blocked(x, z, 1.5) || !clear(x, z, 3.5)) continue;
      if (sampleSplat(splat, x, z).road > 0.4) continue;
      used.push({ x, z });
      if (rnd() < 0.7) benches.add(x, ground(x, z), z, Math.atan2(-nx, -nz));
      else bins.add(x, ground(x, z), z, rnd() * Math.PI * 2);
    }
  }

  // parked vehicles and bicycle clusters in front of the bigger buildings, on the hard ground
  const hatch = new Instances("cars:hatch", models.car("hatch"), still, 70);
  const sedan = new Instances("cars:sedan", models.car("sedan"), still, 50);
  const suv = new Instances("cars:suv", models.car("suv"), still, 40);
  const bikes = new Instances("bikes", models.motorbike(false), still, 140);
  const cycles = new Instances("cycles", models.bicycle(), still, 120);
  for (const b of hero.buildings) {
    if (b.footprint < 380 || !["academic", "admin", "institutional", "hostel", "commercial"].includes(b.type)) continue;
    if (b.centre[0] < x0 || b.centre[0] > x1 || b.centre[1] < z0 || b.centre[1] > z1) continue;
    const brnd = mulberry32(hashString(`${b.id}:park`));
    const ring = b.outer;
    // the two longest edges are where people park
    const edges = ring
      .map((a, i) => ({
        a,
        c: ring[(i + 1) % ring.length] as [number, number],
        len: Math.hypot(
          (ring[(i + 1) % ring.length] as [number, number])[0] - a[0],
          (ring[(i + 1) % ring.length] as [number, number])[1] - a[1],
        ),
      }))
      .filter((e) => e.len > 14)
      .sort((p, q) => q.len - p.len)
      .slice(0, 2);
    for (const e of edges) {
      const dx = (e.c[0] - e.a[0]) / e.len;
      const dz = (e.c[1] - e.a[1]) / e.len;
      const nx = dz;
      const nz = -dx; // outward normal for this winding
      const kind = brnd();
      const count = Math.min(6, 1 + Math.floor(e.len / 9) + Math.floor(brnd() * 2));
      let t = 3 + brnd() * 4;
      for (let i = 0; i < count && t < e.len - 3; i++) {
        const cars = kind < 0.4;
        const gap = cars ? 2.7 : 1.0;
        const off = cars ? 2.6 : 1.5;
        const x = e.a[0] + dx * t + nx * off;
        const z = e.a[1] + dz * t + nz * off;
        t += gap + brnd() * (cars ? 0.5 : 0.4);
        if (index.blocked(x, z, 0.9)) continue;
        const here = sampleSplat(splat, x, z);
        if (here.lawn > 0.35 || here.road > 0.6) continue;
        const y = ground(x, z);
        if (cars) {
          const set = pick([hatch, hatch, sedan, suv], brnd());
          // parked nose-in against the wall, or along it
          const yaw = brnd() < 0.5 ? yawToward(dx, dz) : yawToward(-nx, -nz);
          set.add(x, y, z, yaw, pick(CAR_COLOURS, brnd()), 0xffffff);
        } else if (brnd() < 0.55) {
          bikes.add(x, y, z, yawToward(-nx, -nz) + (brnd() - 0.5) * 0.5, pick(BIKE_COLOURS, brnd()), 0xffffff);
        } else {
          cycles.add(x, y, z, yawToward(-nx, -nz) + (brnd() - 0.5) * 0.9, pick(BIKE_COLOURS, brnd()), 0xffffff);
        }
      }
    }
  }

  // moving traffic: cars, motorbikes with riders, e-rickshaws, driving on the left of each road
  const moving: { set: Instances; movers: Mover[] }[] = [];
  const makeFleet = (
    name: string,
    geo: THREE.BufferGeometry,
    count: number,
    speed: [number, number],
    colours: readonly number[],
    withTrim: boolean,
  ): void => {
    const set = new Instances(name, geo, lit, count);
    const movers: Mover[] = [];
    for (let i = 0; i < count && drivable.length; i++) {
      const road = (drivable[Math.floor(rnd() * drivable.length)] as (typeof drivable)[number]).i;
      const len = polylineLength((roads[road] as (typeof roads)[number]).p);
      const idx = set.add(0, 0, 0, 0, pick(colours, rnd()), withTrim ? pick(SHIRTS, rnd()) : pick(TROUSERS, rnd()));
      movers.push({
        roads: drivable.map((d) => d.i),
        road,
        d: rnd() * len,
        speed: speed[0] + rnd() * (speed[1] - speed[0]),
        dir: rnd() < 0.5 ? 1 : -1,
        lateral: 0,
        index: idx,
        yawOffset: 0,
      });
    }
    moving.push({ set, movers });
  };
  makeFleet("traffic:hatch", models.car("hatch"), 5, [5, 8], CAR_COLOURS, false);
  makeFleet("traffic:sedan", models.car("sedan"), 3, [5, 8], CAR_COLOURS, false);
  makeFleet("traffic:bike", models.motorbike(true, 1), 8, [5, 9], BIKE_COLOURS, true);
  makeFleet("traffic:rickshaw", models.eRickshaw(), 4, [3, 5], RICKSHAW_COLOURS, false);

  // pedestrians, singly and in small groups, on the paths and along the roads
  const people: Instances[] = [];
  const walkers: { set: Instances; movers: Mover[] }[] = [];
  const walkRoutes = paths.concat(drivable);
  for (let v = 0; v < 4; v++) {
    const set = new Instances(`people:${v}`, models.walker(v), walking, 22);
    people.push(set);
    const movers: Mover[] = [];
    for (let i = 0; i < 18 && walkRoutes.length; i++) {
      const route = walkRoutes[Math.floor(rnd() * walkRoutes.length)] as (typeof walkRoutes)[number];
      const len = polylineLength(route.r.p);
      const dir = rnd() < 0.5 ? 1 : -1;
      const phase = rnd() * 6.28;
      const idx = set.add(0, 0, 0, 0, pick(SHIRTS, rnd()), pick(TROUSERS, rnd()), phase);
      movers.push({
        roads: [route.i],
        road: route.i,
        d: rnd() * len,
        speed: 1.1 + rnd() * 0.6,
        dir,
        lateral: (rnd() < 0.5 ? 1 : -1) * (route.r.c === "path" ? 0.25 : route.r.w / 2 + 0.7) * (0.6 + rnd() * 0.5),
        index: idx,
        yawOffset: 0,
      });
    }
    walkers.push({ set, movers });
  }

  const everything = [lamps, benches, bins, hatch, sedan, suv, bikes, cycles, ...moving.map((m) => m.set), ...people];
  for (const inst of everything) group.add(inst.mesh);

  const stepMovers = (list: { set: Instances; movers: Mover[] }[], dt: number, lane: boolean): void => {
    for (const { set, movers } of list) {
      for (const m of movers) {
        const road = roads[m.road] as (typeof roads)[number];
        const len = polylineLength(road.p);
        m.d += m.dir * m.speed * dt;
        if (m.d > len || m.d < 0) {
          if (lane) {
            // vehicles leave the area and a new one enters on another road
            m.road = m.roads[Math.floor(Math.random() * m.roads.length)] as number;
            const next = roads[m.road] as (typeof roads)[number];
            m.dir = Math.random() < 0.5 ? 1 : -1;
            m.d = m.dir > 0 ? 0 : polylineLength(next.p);
          } else {
            m.dir = -m.dir;
            m.d = Math.min(len, Math.max(0, m.d));
          }
        }
        const here = roads[m.road] as (typeof roads)[number];
        const at = pointAt(here.p, m.d);
        const fx = at.dx * m.dir;
        const fz = at.dz * m.dir;
        // lateral offset to the left of the direction of travel (left-hand traffic), or fixed for walkers
        const off = lane ? here.w * 0.25 : m.lateral * m.dir;
        const lx = fz;
        const lz = -fx;
        const x = at.x + lx * off;
        const z = at.z + lz * off;
        set.set(m.index, x, hero.heightAt(x, z), z, yawToward(fx, fz));
      }
    }
  };
  stepMovers(moving, 0, true);
  stepMovers(walkers, 0, false);

  const counts: Record<string, number> = {};
  let triangles = 0;
  for (const inst of everything) {
    counts[inst.name] = inst.count;
    triangles += ((inst.mesh.geometry.attributes.position as THREE.BufferAttribute).count / 3) * inst.count;
  }
  return {
    group,
    counts,
    triangles,
    update(dt: number) {
      stepMovers(moving, dt, true);
      stepMovers(walkers, dt, false);
    },
  };
}
