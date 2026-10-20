// A guided tour: the camera flies through a few viewpoints while the time of day runs from morning to night. Each shot
// slides the camera and the point it looks at from one place to another; between shots the camera follows its target
// with a little smoothing, so the cuts become gentle swoops.
import * as THREE from "three/webgpu";
import type { Hero } from "../data/types.ts";

export interface Shot {
  caption: string;
  /** camera start and end: x, height above the ground, z */
  from: [number, number, number];
  to: [number, number, number];
  /** the point looked at, at the start and the end: x, height above the ground, z */
  lookFrom: [number, number, number];
  lookTo: [number, number, number];
  seconds: number;
  /** India Standard Time hours at the start and end of the shot */
  hours: [number, number];
}

/** The tour of the Library avenue: from above, down to the street, along it, close to a wall, golden hour, night. */
export const HERO_TOUR: Shot[] = [
  {
    caption: "The campus from above",
    from: [-250, 210, 100],
    to: [-520, 150, 40],
    lookFrom: [-440, 6, -200],
    lookTo: [-480, 8, -170],
    seconds: 9,
    hours: [8, 9.5],
  },
  {
    caption: "The Library and its avenue",
    from: [-580, 24, -10],
    to: [-545, 2.4, -48],
    lookFrom: [-612, 8, -118],
    lookTo: [-600, 6, -105],
    seconds: 8,
    hours: [9.5, 10.5],
  },
  {
    caption: "Walking the avenue",
    from: [-500, 1.7, -75],
    to: [-560, 1.7, -100],
    lookFrom: [-640, 3, -122],
    lookTo: [-650, 3, -128],
    seconds: 9,
    hours: [10.5, 12.5],
  },
  {
    caption: "Up close: windows set into the wall",
    from: [-575, 2.1, -60],
    to: [-598, 3.4, -72],
    lookFrom: [-612, 4, -100],
    lookTo: [-605, 6, -118],
    seconds: 7,
    hours: [12.5, 14.5],
  },
  {
    caption: "Golden hour",
    from: [-560, 38, -20],
    to: [-430, 62, -60],
    lookFrom: [-500, 8, -150],
    lookTo: [-520, 8, -160],
    seconds: 9,
    hours: [16.6, 17.6],
  },
  {
    caption: "After dark: lit windows, lamps, the moon",
    from: [-545, 2.4, -45],
    to: [-545, 18, -30],
    lookFrom: [-612, 8, -118],
    lookTo: [-605, 12, -118],
    seconds: 10,
    hours: [19.6, 21],
  },
];

const ease = (t: number): number => t * t * (3 - 2 * t);

export class Tour {
  active = false;
  private shot = 0;
  private t = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fresh = true;

  constructor(
    private readonly hero: Hero,
    private readonly shots: Shot[] = HERO_TOUR,
  ) {}

  start(): void {
    this.active = true;
    this.shot = 0;
    this.t = 0;
    this.fresh = true;
  }

  stop(): void {
    this.active = false;
  }

  get caption(): string {
    return this.shots[this.shot]?.caption ?? "";
  }

  /** Moves the camera; returns the hour to show, or null when the tour has ended. */
  update(dt: number, camera: THREE.PerspectiveCamera): number | null {
    const s = this.shots[this.shot];
    if (!s) {
      this.active = false;
      return null;
    }
    this.t += dt;
    const f = Math.min(1, this.t / s.seconds);
    const k = ease(f);
    const place = (a: [number, number, number], b: [number, number, number], out: THREE.Vector3): void => {
      const x = a[0] + (b[0] - a[0]) * k;
      const z = a[2] + (b[2] - a[2]) * k;
      out.set(x, this.hero.heightAt(x, z) + a[1] + (b[1] - a[1]) * k, z);
    };
    const target = new THREE.Vector3();
    const aim = new THREE.Vector3();
    place(s.from, s.to, target);
    place(s.lookFrom, s.lookTo, aim);
    if (this.fresh) {
      this.pos.copy(target);
      this.look.copy(aim);
      this.fresh = false;
    }
    // follow the targets with smoothing, so that a cut becomes a swoop
    const follow = 1 - Math.exp(-dt * 2.6);
    this.pos.lerp(target, follow);
    this.look.lerp(aim, follow);
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
    camera.fov = 58;
    camera.near = 0.15;
    camera.far = 6000;
    camera.updateProjectionMatrix();
    const hour = s.hours[0] + (s.hours[1] - s.hours[0]) * f;
    if (this.t >= s.seconds) {
      this.shot++;
      this.t = 0;
      if (this.shot >= this.shots.length) this.active = false;
    }
    return this.active ? hour : null;
  }
}
