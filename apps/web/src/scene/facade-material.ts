// The facade and roof materials, written as node (TSL) shaders so that they run on WebGPU and on the WebGL2 fallback.
// A wall quad carries uv = (bay, floor) and aInfo = (bay width in metres, floor height, flags + wall seed, building seed).
// A bay is one repeat of: plaster, a painted surround, a window opening that is recessed into the wall, a frame, glass
// with a furnished room behind it, an optional steel grille and a floor slab line. The recess is real in the shader:
// the view ray is traced into the wall (parallax), so the reveal, the frame and the room move as the camera moves.
// Walls with aInfo.x = 0 (parapets, rooftop rooms, ledges) stay plain plaster.

import {
  attribute,
  cameraPosition,
  color,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  min,
  mix,
  mod,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { fieldsAt } from "./tsl-noise.ts";
import type { EnvUniforms, FloatUniform } from "./types.ts";
import { WINDOW_OPENING, WINDOW_STYLES, windowAtlas } from "./window-atlas.ts";

type N = any;

/** Wall flag bits, stored in the integer part of aInfo.z. */
export const FLAG_REAL_SHADE = 1; // the sunshades above windows are real geometry, so the shader does not paint them

const box = (c: N, lo: N, hi: N, aa: N): N =>
  smoothstep(float(lo).sub(aa), float(lo).add(aa), c).mul(float(1).sub(smoothstep(float(hi).sub(aa), float(hi).add(aa), c)));

const RECESS = 0.22; // metres from the wall face to the window plane

export function createFacadeMaterial(wet: FloatUniform, env: EnvUniforms): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const atlas = windowAtlas();
  const info = attribute("aInfo", "vec4");
  const U = uv().x;
  const V = uv().y;
  const bx = fract(U);
  const fy = fract(V);
  const aaY = fwidth(V).mul(1.1);
  const bayW = max(info.x, float(1));
  const fh = max(info.y, float(1));
  const flags = floor(info.z);
  const realShade = mod(flags, float(2));
  const floors = step(0.0, V); // above the ground
  const windowsOn = step(0.1, info.x).mul(floors);
  const seed = info.w;
  const bayId = floor(U).add(floor(V).mul(31)).add(seed.mul(997));
  const rnd = hash(bayId);
  const rnd2 = hash(bayId.add(7.31));
  const rnd3 = hash(bayId.add(13.7));

  // each building has one of three window proportions and one of three frame colours
  const style = floor(seed.mul(2.999));
  const pick = (a: number, b: number, c: number): N => mix(mix(float(a), float(b), step(0.5, style)), float(c), step(1.5, style));
  const hy0 = pick(WINDOW_OPENING[0].y0, WINDOW_OPENING[1].y0, WINDOW_OPENING[2].y0);
  const hy1 = pick(WINDOW_OPENING[0].y1, WINDOW_OPENING[1].y1, WINDOW_OPENING[2].y1);
  const frameKind = fract(seed.mul(7.31));
  const frameColour = mix(mix(color(0xf1ede3), color(0x5a4636), step(0.4, frameKind)), color(0xa9afb3), step(0.75, frameKind));

  // the window masks come from the atlas; gradients come from the unwrapped bay coordinate so that mip-mapping
  // does not jump where the bay number wraps
  const gx = vec2(dFdx(U).div(WINDOW_STYLES), dFdx(V));
  const gy = vec2(dFdy(U).div(WINDOW_STYLES), dFdy(V));
  const sample = (tex: THREE.DataTexture, x: N, y: N): N =>
    texture(tex, vec2(x.clamp(0, 1).add(style).div(WINDOW_STYLES), y.clamp(0, 1))).grad(gx, gy);
  const wallA = sample(atlas.a, bx, fy);
  const wallB = sample(atlas.b, bx, fy);
  const hole = wallA.r.mul(windowsOn);
  const surround = wallA.g.mul(windowsOn);
  const sill = wallA.a.mul(windowsOn);
  const paintShade = float(1).sub(realShade); // painted unless the sunshade is real geometry
  const shade = wallB.b.mul(windowsOn).mul(paintShade);
  const shadeShadow = wallB.a.mul(windowsOn).mul(paintShade);

  // trace the view ray back to the window plane, which sits RECESS metres inside the wall
  const Nw = normalWorld.normalize();
  const Tw = vec3(Nw.z.negate(), float(0), Nw.x)
    .add(vec3(1e-6, 0, 0))
    .normalize(); // along increasing bay number
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const vn = max(dot(viewDir, Nw), float(0.1));
  const sx = dot(viewDir, Tw).div(vn).clamp(-6, 6); // metres of sideways travel per metre of depth
  const sy = viewDir.y.div(vn).clamp(-6, 6);
  const bxp = bx.sub(sx.mul(RECESS).div(bayW));
  const fyp = fy.sub(sy.mul(RECESS).div(fh));
  const back = sample(atlas.b, bxp, fyp);
  const frameBack = back.r; // frame and glass where the ray reaches the window plane inside the opening
  const glassBack = back.g;

  // the room behind the glass, found by tracing the same ray on to the back wall, the side walls, the floor or the ceiling
  const ug = bxp.mul(bayW);
  const vg = fyp.mul(fh);
  const roomDepth = rnd3.mul(2.2).add(3.2);
  const dxs = sx.abs().max(1e-3);
  const dys = sy.abs().max(1e-3);
  const zSide = select(sx.greaterThan(0), ug.div(dxs), bayW.sub(ug).div(dxs)).max(0);
  const zVert = select(sy.greaterThan(0), vg.div(dys), fh.sub(vg).div(dys)).max(0);
  const hitBack = step(roomDepth, zSide).mul(step(roomDepth, zVert));
  const hitSide = float(1).sub(hitBack).mul(step(zSide, zVert));
  const hitVert = float(1).sub(hitBack).sub(hitSide).max(0);
  const hitCeil = hitVert.mul(step(sy, float(0)));
  const hitFloor = hitVert.sub(hitCeil).max(0);
  const travel = min(min(roomDepth, zSide), zVert);
  const paint = mix(mix(color(0xd8d2c0), color(0xb4c8ae), step(0.33, rnd3)), color(0xc2ccd6), step(0.66, rnd3));
  const shelves = step(0.55, fieldsAt(vec2(ug.mul(3.5).add(rnd.mul(17)), vg.mul(2.6)), 16).b); // furniture and shelving
  const backWall = paint.mul(mix(float(1), float(0.55), shelves.mul(step(0.35, vg.div(fh)))));
  const room = backWall
    .mul(hitBack)
    .add(paint.mul(0.78).mul(hitSide))
    .add(color(0xe9e5db).mul(hitCeil))
    .add(color(0x6a6158).mul(0.8).mul(hitFloor))
    .mul(exp(travel.mul(-0.16)));
  const lit = step(0.62, rnd2).mul(float(0.6).add(rnd.mul(0.4))); // about a third of the rooms have the light on
  const hasCurtain = step(0.6, rnd);
  const curtainCol = mix(mix(color(0xb9a37a), color(0x7a8fa6), step(0.33, rnd2)), color(0x9a6f66), step(0.66, rnd2));
  const curtainTop = hy0.add(hy1.sub(hy0).mul(rnd3.mul(0.35).add(0.45)));
  const curtain = hasCurtain.mul(step(fyp, curtainTop)).mul(glassBack);

  // sun inside the recess: a point on the window plane is lit only if the sun ray leaves through the opening
  const sunT = dot(env.sunDir, Tw);
  const sunN = max(dot(env.sunDir, Nw), float(0.05));
  const exitX = bxp.add(sunT.div(sunN).mul(RECESS).div(bayW));
  const exitY = fyp.add(env.sunDir.y.div(sunN).mul(RECESS).div(fh));
  const recessLit = sample(atlas.a, exitX, exitY).r;
  const recessShade = mix(float(0.42), float(1), recessLit);

  // steel grille in front of the glass on about half of the windows
  const bars = wallA.b.mul(windowsOn).mul(step(rnd, 0.55));

  // plaster with macro stains, rain streaks under sills and a damp, dirty base
  const wp = positionWorld;
  const along = wp.x.add(wp.z); // distance along a wall, whichever way it runs
  const macro = fieldsAt(vec2(along, wp.y.mul(0.6)), 28).r;
  const micro = fieldsAt(vec2(along, wp.y), 1.6).a;
  const streakN = fieldsAt(vec2(U.mul(9.0), V.mul(0.9).add(seed.mul(3.7))), 16).b;
  const streak = smoothstep(0.55, 0.95, streakN)
    .mul(smoothstep(0.0, 0.2, float(0.2).sub(fy).add(0.2)))
    .mul(0.18)
    .mul(windowsOn);
  const dirt = float(1)
    .sub(smoothstep(-0.2, 1.1, V))
    .mul(0.3)
    .mul(floors.add(0.4).min(1.0));
  const plinth = box(V, -1.0, 0.16, fwidth(V).mul(1.1)); // painted plinth band at the foot of the wall
  const slab = box(fy, 0.955, 1.2, aaY)
    .add(box(fy, -0.2, 0.04, aaY))
    .min(1.0)
    .mul(windowsOn);
  const base = vertexColor();
  let wallCol: N = base.mul(mix(float(0.86), float(1.07), macro)).mul(mix(float(0.96), float(1.04), micro));
  wallCol = wallCol.mul(float(1).sub(streak)).mul(float(1).sub(dirt));
  wallCol = mix(wallCol, color(0x77695a), plinth.mul(0.85));
  wallCol = mix(wallCol, wallCol.mul(0.55), shadeShadow);
  wallCol = mix(wallCol, base.mul(1.12), slab.mul(0.7));
  wallCol = mix(wallCol, base.mul(1.06), sill.mul(0.8));
  wallCol = mix(wallCol, base.mul(1.15), shade);
  wallCol = mix(wallCol, mix(base, color(0xf1ede3), 0.8).mul(mix(float(0.92), float(1.03), micro)), surround);

  // inside the opening: the reveal (dark, shadowed plaster) where the ray hits the side of the recess,
  // otherwise the frame and the glass on the window plane
  const reveal = base.mul(0.5);
  const roomDay = room.mul(mix(float(0.12), float(0.3), rnd2));
  const roomCol = mix(roomDay, curtainCol.mul(0.5), curtain).mul(mix(float(1), float(0.4), step(0.5, rnd))); // some rooms are dim
  let opening: N = mix(reveal, frameColour.mul(0.9), frameBack);
  opening = mix(opening, roomCol, glassBack);
  opening = mix(opening, color(0x6f8fa8), glassBack.mul(0.12));
  opening = opening.mul(recessShade);
  let c: N = mix(wallCol, opening, hole);
  c = mix(c, color(0x16181b), bars);
  m.colorNode = c.mul(mix(float(1), float(0.7), wet));
  const glassMask = hole.mul(glassBack).mul(float(1).sub(bars));
  const frameMask = hole.mul(frameBack);
  m.roughnessNode = mix(mix(float(0.93), float(0.5), frameMask), float(0.06), glassMask).mul(mix(float(1), float(0.6), wet));
  m.metalnessNode = mix(float(0), float(0.25), glassMask);
  // lit rooms glow after dark
  const glow = mix(room, curtainCol, curtain.mul(0.6)).mul(lit).mul(env.night).mul(2.4).mul(glassMask);
  m.emissiveNode = glow.mul(color(0xffd9a0));
  return m;
}

/** Flat concrete roofs: pale, stained and weathered, tinted by the roof colour in the vertex data. */
export function createRoofMaterial(wet: FloatUniform): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const n1 = fieldsAt(p, 53).b;
  const n2 = fieldsAt(p, 4).b;
  const stain = smoothstep(0.55, 0.9, fieldsAt(p, 144, 0.4).b);
  const joints = fract(p.div(5.0));
  const joint = float(1).sub(step(0.01, joints.x).mul(step(0.01, joints.y)));
  let c = vertexColor()
    .mul(mix(float(0.78), float(1.05), n1))
    .mul(mix(float(0.94), float(1.04), n2));
  c = mix(c, c.mul(0.55), stain.mul(0.6));
  c = c.mul(float(1).sub(joint.mul(0.3)));
  m.colorNode = c.mul(mix(float(1), float(0.7), wet));
  m.roughnessNode = float(0.95).mul(mix(float(1), float(0.6), wet));
  m.metalnessNode = float(0);
  return m;
}

export function createTankMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = color(0x1c1f22);
  m.roughnessNode = float(0.5);
  m.metalnessNode = float(0.1);
  return m;
}
