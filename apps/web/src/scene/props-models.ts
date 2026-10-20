// Low-poly models of things found on a campus street: lamp posts, benches, bins, cars, motorbikes, scooters, bicycles,
// e-rickshaws and people. Each is built once from primitives (see mesh-kit.ts) and drawn many times as instances.
// Models face +x with their feet on y = 0; widths run along z.
import * as THREE from "three/webgpu";
import { Kit, surface } from "./mesh-kit.ts";

/**
 * Part codes (aMat.w): the units digit says how the instance colours apply, the tens digit says which part of a
 * walking figure swings.
 *   units: 0 fixed colour, 5 painted by the instance colour, 6 painted by the instance's second colour
 *   tens:  0 still, 1 left leg, 2 right leg, 3 left arm, 4 right arm
 */
export const PAINT = 5;
export const TRIM = 6;

const matte = surface(0.85);
const rubber = surface(0.9);
const glassSurface = surface(0.08, 0.2);
const metal = surface(0.4, 0.8);
const paintSurface = (part = PAINT) => surface(0.38, 0.25, 0, part);

// ---- street furniture -------------------------------------------------------------------------------------------

/** A lamp post with a curved arm: a 6.5 m pole, painted dark grey, with a lamp head that glows at night. */
export function lampPost(): THREE.BufferGeometry {
  const k = new Kit();
  k.cylinder(0, 0, 0, 0.1, 0.14, 0.4, 0x35383b, matte, 8);
  k.cylinder(0, 0.4, 0, 0.055, 0.09, 6.0, 0x4a4e52, surface(0.5, 0.6), 8);
  // the arm reaches out to +x and ends in a downward-facing lamp
  k.box(0.55, 6.42, 0, 1.25, 0.07, 0.07, 0x4a4e52, metal);
  k.box(1.2, 6.36, 0, 0.62, 0.12, 0.28, 0x2c2f32, surface(0.5, 0.5));
  k.box(1.2, 6.29, 0, 0.5, 0.03, 0.2, 0xfff0cf, surface(0.2, 0, 3.2));
  return k.geometry();
}

export function bench(): THREE.BufferGeometry {
  const k = new Kit();
  const wood = 0x6b4a2f;
  for (const z of [-0.2, -0.07, 0.06, 0.19]) k.box(0, 0.45, z, 1.6, 0.045, 0.1, wood, surface(0.8));
  k.box(-0.2, 0.74, -0.22, 1.6, 0.1, 0.04, wood, surface(0.8));
  k.box(-0.2, 0.9, -0.24, 1.6, 0.1, 0.04, wood, surface(0.8));
  for (const x of [-0.7, 0.7]) {
    k.box(x, 0.22, 0, 0.06, 0.44, 0.5, 0x2c2f32, metal);
    k.box(x - 0.05, 0.7, -0.22, 0.05, 0.55, 0.05, 0x2c2f32, metal);
  }
  return k.geometry();
}

export function bin(): THREE.BufferGeometry {
  const k = new Kit();
  k.cylinder(0, 0, 0, 0.27, 0.24, 0.8, 0x2f6b3f, surface(0.6), 12);
  k.cylinder(0, 0.8, 0, 0.29, 0.29, 0.05, 0x1f4a2b, surface(0.6), 12);
  return k.geometry();
}

export function bollard(): THREE.BufferGeometry {
  const k = new Kit();
  k.cylinder(0, 0, 0, 0.07, 0.08, 0.7, 0xe9e5d8, matte, 8);
  k.cylinder(0, 0.5, 0, 0.081, 0.081, 0.1, 0xd9a21b, matte, 8);
  return k.geometry();
}

// ---- vehicles ---------------------------------------------------------------------------------------------------

type CarKind = "hatch" | "sedan" | "suv";

const CARS: Record<
  CarKind,
  {
    body: [number, number][];
    glass: [number, number][];
    windshield: [[number, number], [number, number]];
    rear: [[number, number], [number, number]];
    wheelX: number;
    width: number;
    tail: number;
    nose: number;
  }
> = {
  hatch: {
    body: [
      [-1.78, 0.3],
      [-1.88, 0.62],
      [-1.84, 0.92],
      [-1.4, 0.96],
      [-0.88, 1.4],
      [0.5, 1.42],
      [1.04, 0.98],
      [1.7, 0.88],
      [1.88, 0.62],
      [1.84, 0.34],
      [1.55, 0.24],
      [-1.55, 0.24],
    ],
    glass: [
      [-1.28, 1.0],
      [-0.84, 1.33],
      [0.46, 1.35],
      [0.9, 1.0],
    ],
    windshield: [
      [0.5, 1.4],
      [1.03, 0.99],
    ],
    rear: [
      [-0.88, 1.38],
      [-1.38, 0.97],
    ],
    wheelX: 1.12,
    width: 1.62,
    tail: -1.87,
    nose: 1.88,
  },
  sedan: {
    body: [
      [-2.05, 0.32],
      [-2.1, 0.62],
      [-2.05, 0.98],
      [-1.35, 1.02],
      [-0.95, 1.42],
      [0.45, 1.44],
      [1.0, 1.02],
      [1.85, 0.92],
      [2.08, 0.66],
      [2.05, 0.34],
      [1.7, 0.24],
      [-1.7, 0.24],
    ],
    glass: [
      [-1.22, 1.05],
      [-0.9, 1.35],
      [0.4, 1.37],
      [0.9, 1.05],
    ],
    windshield: [
      [0.45, 1.42],
      [0.99, 1.03],
    ],
    rear: [
      [-0.95, 1.4],
      [-1.34, 1.03],
    ],
    wheelX: 1.3,
    width: 1.7,
    tail: -2.1,
    nose: 2.08,
  },
  suv: {
    body: [
      [-2.0, 0.4],
      [-2.05, 0.85],
      [-2.0, 1.55],
      [-1.0, 1.7],
      [0.55, 1.7],
      [1.12, 1.15],
      [1.8, 1.02],
      [2.02, 0.72],
      [1.98, 0.42],
      [1.6, 0.3],
      [-1.6, 0.3],
    ],
    glass: [
      [-1.85, 1.22],
      [-1.0, 1.6],
      [0.5, 1.6],
      [1.0, 1.2],
    ],
    windshield: [
      [0.55, 1.68],
      [1.1, 1.17],
    ],
    rear: [
      [-1.0, 1.68],
      [-1.98, 1.5],
    ],
    wheelX: 1.28,
    width: 1.8,
    tail: -2.04,
    nose: 2.02,
  },
};

const wheel = (k: Kit, x: number, z: number, r: number, w: number): void => {
  const side = Math.sign(z);
  k.roll(x, r, z, r, w, "z", 0x141414, rubber, 14);
  k.roll(x, r, z + side * w * 0.5, r * 0.55, 0.03, "z", 0xb8bcc0, surface(0.35, 0.8), 10);
};

/** A car painted by the instance colour (part code PAINT), with glass, lights, bumpers and wheels. */
export function car(kind: CarKind): THREE.BufferGeometry {
  const c = CARS[kind];
  const k = new Kit();
  const hw = c.width / 2;
  k.profile(c.body, c.width, 0xffffff, paintSurface(), 0.05);
  // side windows, a touch proud of the body so they read as glass
  for (const side of [-1, 1]) {
    const z = side * (hw + 0.012);
    k.profile(c.glass, 0.02, 0x11161b, glassSurface, 0, z);
  }
  const slope = (p: [[number, number], [number, number]], inset: number): void => {
    const [a, b] = p;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang),
      new THREE.Vector3(1, 1, 1),
    );
    k.add(
      new THREE.BoxGeometry(len, 0.03, c.width - inset),
      m.multiply(new THREE.Matrix4().makeTranslation(0, 0.028, 0)),
      0x11161b,
      glassSurface,
    );
  };
  slope(c.windshield, 0.14);
  slope(c.rear, 0.2);
  // bumpers, lights and a grille
  k.box(c.nose - 0.04, 0.4, 0, 0.14, 0.2, c.width - 0.04, 0x25282b, surface(0.7));
  k.box(c.tail + 0.04, 0.4, 0, 0.14, 0.2, c.width - 0.04, 0x25282b, surface(0.7));
  for (const side of [-1, 1]) {
    k.box(c.nose - 0.02, 0.68, side * (hw - 0.26), 0.05, 0.14, 0.32, 0xfff6e0, surface(0.15, 0, 0.9));
    k.box(c.tail + 0.01, 0.78, side * (hw - 0.24), 0.05, 0.14, 0.3, 0xd01818, surface(0.2, 0, 2.2));
    k.box(c.nose * 0.55 - 0.1, 1.0, side * (hw + 0.07), 0.14, 0.1, 0.1, 0x25282b, matte); // mirror
  }
  const r = kind === "suv" ? 0.37 : 0.31;
  for (const x of [c.wheelX, -c.wheelX]) {
    for (const side of [-1, 1]) {
      k.roll(x, r + 0.02, side * (hw + 0.005), r + 0.07, 0.04, "z", 0x0a0a0a, rubber, 14); // wheel arch
      wheel(k, x, side * (hw - 0.08), r, 0.24);
    }
  }
  return k.geometry();
}

/** A seated person (a rider): shirt painted by the instance colour, trousers by its second colour. */
export function seatedPerson(variant = 0): THREE.BufferGeometry {
  const k = new Kit();
  const skin = [0x8a5a3c, 0x9c6a48, 0x7a4c32, 0xb07a55][variant % 4] as number;
  const hip = 0.86;
  const torso = 0.5;
  for (const side of [-1, 1]) {
    k.box(0.2, hip + 0.02, side * 0.1, 0.46, 0.15, 0.15, 0xffffff, surface(0.85, 0, 0, TRIM)); // thigh forward
    k.box(0.43, hip - 0.24, side * 0.1, 0.15, 0.48, 0.15, 0xffffff, surface(0.85, 0, 0, TRIM)); // shin down
    k.box(0.5, hip - 0.5, side * 0.1, 0.24, 0.08, 0.12, 0x1a1a1a, matte);
  }
  k.box(0, hip + torso / 2 + 0.04, 0, 0.22, torso, 0.38, 0xffffff, surface(0.8, 0, 0, PAINT));
  k.add(new THREE.SphereGeometry(0.105, 10, 8), new THREE.Matrix4().makeTranslation(0.04, hip + torso + 0.2, 0), skin, matte);
  k.add(
    new THREE.SphereGeometry(0.115, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.Matrix4().makeTranslation(0.03, hip + torso + 0.215, 0),
    0x16110e,
    matte,
  );
  for (const side of [-1, 1]) k.box(0.3, hip + torso - 0.18, side * 0.26, 0.5, 0.1, 0.1, 0xffffff, surface(0.8, 0, 0, PAINT)); // arms to the handlebar
  return k.geometry();
}

/** A walking person. The part codes let the shader swing the legs and arms about the hips and shoulders. */
export function walker(variant = 0): THREE.BufferGeometry {
  const k = new Kit();
  const skin = [0x8a5a3c, 0x9c6a48, 0x7a4c32, 0xb07a55][variant % 4] as number;
  const hair = 0x16110e;
  const h = 1.62 + (variant % 3) * 0.05;
  const hip = h * 0.53;
  const legR = 0.075;
  const torso = h * 0.3;
  for (const [side, anim] of [
    [-1, 1],
    [1, 2],
  ] as const) {
    k.cylinder(0, 0.07, side * 0.1, legR * 0.8, legR, hip - 0.07, 0xffffff, surface(0.85, 0, 0, anim * 10 + TRIM), 7);
    k.box(0.06, 0.035, side * 0.1, 0.25, 0.07, 0.11, 0x1a1a1a, surface(0.85, 0, 0, anim * 10));
  }
  k.box(0, hip + torso / 2 + 0.04, 0, 0.2, torso, 0.36, 0xffffff, surface(0.8, 0, 0, PAINT));
  k.cylinder(0, hip + torso + 0.03, 0, 0.045, 0.055, 0.07, skin, matte, 7);
  k.add(new THREE.SphereGeometry(0.105, 10, 8), new THREE.Matrix4().makeTranslation(0, hip + torso + 0.17, 0), skin, matte);
  k.add(
    new THREE.SphereGeometry(0.11, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.Matrix4().makeTranslation(-0.012, hip + torso + 0.185, 0),
    hair,
    matte,
  );
  for (const [side, anim] of [
    [-1, 3],
    [1, 4],
  ] as const) {
    k.cylinder(0, hip + torso - 0.52, side * 0.235, legR * 0.62, legR * 0.7, 0.56, 0xffffff, surface(0.8, 0, 0, anim * 10 + PAINT), 6);
  }
  // a backpack on many of them
  if (variant % 2 === 0) k.box(-0.17, hip + torso * 0.6, 0, 0.14, 0.32, 0.28, 0x2d3f66, matte);
  return k.geometry();
}

/** A motorbike, optionally with a seated rider (painted by the instance colours). */
export function motorbike(withRider = false, variant = 0): THREE.BufferGeometry {
  const k = new Kit();
  const r = 0.31;
  for (const x of [-0.62, 0.65]) {
    k.roll(x, r, 0, r, 0.1, "z", 0x141414, rubber, 14);
    k.roll(x, r, 0, r * 0.45, 0.12, "z", 0xb8bcc0, metal, 8);
  }
  k.box(0.05, 0.42, 0, 0.9, 0.05, 0.12, 0x2c2f32, metal); // frame
  k.box(-0.0, 0.55, 0, 0.5, 0.2, 0.22, 0xffffff, paintSurface(), 0); // fuel tank
  k.box(-0.38, 0.62, 0, 0.55, 0.09, 0.2, 0x1b1b1b, surface(0.8)); // seat
  k.box(0.5, 0.36, 0, 0.5, 0.05, 0.1, 0x2c2f32, metal); // front fork
  k.box(0.48, 0.78, 0, 0.05, 0.05, 0.62, 0x2c2f32, metal); // handlebar
  k.box(0.6, 0.72, 0, 0.1, 0.12, 0.14, 0xfff6e0, surface(0.15, 0, 0.9)); // headlight
  k.roll(-0.3, 0.24, 0.17, 0.045, 0.7, "x", 0x8c9094, surface(0.35, 0.9), 8); // exhaust
  k.box(-0.92, 0.55, 0, 0.12, 0.06, 0.12, 0xd01818, surface(0.2, 0, 1.6)); // tail light
  if (withRider) k.append(seatedPerson(variant), new THREE.Matrix4().makeTranslation(-0.4, 0.5, 0));
  return k.geometry();
}

export function bicycle(): THREE.BufferGeometry {
  const k = new Kit();
  const r = 0.34;
  for (const x of [-0.5, 0.5]) {
    k.add(
      new THREE.TorusGeometry(r, 0.015, 5, 18),
      new THREE.Matrix4().compose(new THREE.Vector3(x, r, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)),
      0x141414,
      rubber,
    );
  }
  const bar = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang),
      new THREE.Vector3(1, 1, 1),
    );
    k.add(new THREE.BoxGeometry(len, 0.03, 0.03), m, 0xffffff, paintSurface());
  };
  bar(-0.5, r, -0.1, 0.62);
  bar(-0.1, 0.62, 0.35, 0.62);
  bar(0.35, 0.62, 0.5, r);
  bar(-0.1, 0.62, 0.0, r);
  bar(0.0, r, -0.5, r);
  bar(0.35, 0.62, 0.38, 0.78);
  k.box(0.38, 0.8, 0, 0.04, 0.04, 0.46, 0x2c2f32, metal);
  k.box(-0.13, 0.7, 0, 0.18, 0.04, 0.09, 0x1b1b1b, surface(0.8));
  return k.geometry();
}

/** An e-rickshaw: a three-wheeler with a canopy, a bench for passengers and a windscreen. */
export function eRickshaw(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(-0.15, 0.42, 0, 1.9, 0.12, 1.05, 0x25282b, surface(0.6)); // floor and chassis
  k.box(-0.35, 0.62, 0, 1.0, 0.1, 0.9, 0x6b3f2a, surface(0.8)); // passenger bench
  k.box(0.78, 0.5, 0, 0.5, 0.45, 0.8, 0xffffff, paintSurface(), 0); // front cowl
  k.box(-0.05, 1.82, 0, 1.75, 0.05, 1.1, 0xffffff, paintSurface(TRIM)); // roof
  for (const x of [-0.85, 0.55]) for (const z of [-0.5, 0.5]) k.box(x, 1.2, z, 0.04, 1.4, 0.04, 0x25282b, metal);
  k.box(0.6, 1.25, 0, 0.04, 0.7, 0.9, 0x11161b, glassSurface); // windscreen
  k.box(0.62, 0.62, 0, 0.06, 0.1, 0.5, 0xfff6e0, surface(0.15, 0, 0.9)); // headlight
  k.box(-1.1, 0.6, 0, 0.06, 0.1, 0.5, 0xd01818, surface(0.2, 0, 1.8)); // tail light
  for (const z of [-0.5, 0.5]) {
    k.roll(-0.75, 0.3, z, 0.3, 0.16, "z", 0x141414, rubber, 14);
  }
  k.roll(0.8, 0.28, 0, 0.28, 0.16, "z", 0x141414, rubber, 14);
  return k.geometry();
}
