// Rain: thin streaks that fall in a box around the camera, slanted by the wind. Nothing is stored per drop: the vertex
// shader works out where each streak is from its index and the time, so the rain is free to run and never goes stale.
import {
  cameraPosition,
  cross,
  float,
  hash,
  instanceIndex,
  mix,
  mod,
  normalize,
  positionGeometry,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { EnvUniforms } from "./types.ts";

const COUNT = 3600;
const BOX = 46; // metres across the box of falling rain
const HEIGHT = 30;
const FALL = 9; // metres per second

export interface Rain {
  mesh: THREE.InstancedMesh;
  /** `density` 0 to 1, `wind` as the horizontal drift of the drops in metres per second (x east, z south) */
  set(density: number, windX: number, windZ: number): void;
}

export function createRain(env: EnvUniforms): Rain {
  const density = uniform(0);
  const drift = uniform(new THREE.Vector2());
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });

  const id = float(instanceIndex);
  const r1 = hash(id);
  const r2 = hash(id.add(11.3));
  const r3 = hash(id.add(23.7));
  const r4 = hash(id.add(41.1));
  // each drop has a fixed place in a repeating grid of boxes, so it stays put in the world while the camera moves
  const rel = vec2(
    mod(
      r1
        .mul(BOX)
        .sub(cameraPosition.x)
        .add(BOX / 2),
      float(BOX),
    ).sub(BOX / 2),
    mod(
      r2
        .mul(BOX)
        .sub(cameraPosition.z)
        .add(BOX / 2),
      float(BOX),
    ).sub(BOX / 2),
  );
  const y = mod(r3.mul(HEIGHT).sub(time.mul(FALL)), float(HEIGHT)).sub(HEIGHT * 0.45);
  const centre = vec3(cameraPosition.x.add(rel.x), cameraPosition.y.add(y), cameraPosition.z.add(rel.y));
  const len = float(1.0).add(r4.mul(0.9));
  const dir = normalize(vec3(drift.x, -FALL, drift.y));
  const toCamera = normalize(cameraPosition.sub(centre));
  const side = normalize(cross(dir, toCamera));
  const local = positionGeometry; // a unit quad, x across and y along
  const worldPos = centre.add(dir.mul(local.y.mul(len))).add(side.mul(local.x.mul(0.014)));
  material.positionNode = worldPos;

  const across = float(1).sub(local.x.abs().mul(2)); // not used for shape: the quad is thin
  void across;
  const along = uv().y.mul(Math.PI).sin();
  const dist = rel.length();
  const nearFade = smoothstep(0.6, 2.2, dist.add(y.abs().mul(0.0)));
  const far = float(1).sub(smoothstep(14, BOX / 2, dist));
  const present = float(1).sub(smoothstep(density.sub(0.001), density, r4.mul(0.999)));
  const light = mix(float(1), float(0.3), env.night);
  material.colorNode = vec3(0.8, 0.86, 0.94).mul(light);
  material.opacityNode = along.mul(far).mul(nearFade).mul(present).mul(0.45);

  const quad = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(quad, material, COUNT);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.visible = false;
  mesh.name = "rain";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    set(d, windX, windZ) {
      density.value = d;
      drift.value.set(windX, windZ);
      mesh.visible = d > 0.02;
    },
  };
}
