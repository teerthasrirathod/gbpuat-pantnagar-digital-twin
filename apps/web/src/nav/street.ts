// Walking at eye height through the hero area: keys to move, drag to look, wheel to change the lens.
import type * as THREE from "three/webgpu";
import { bbox, pointInRing, type Ring } from "../core/geometry.ts";
import type { Hero } from "../data/types.ts";

export interface Pose {
  x: number;
  z: number;
  /** radians clockwise from north */
  yaw: number;
  /** radians above the horizon */
  pitch: number;
}

const EYE = 1.65;

export class StreetNav {
  pose: Pose;
  fov = 62;
  private readonly keys = new Set<string>();
  private readonly solids: { box: [number, number, number, number]; outer: Ring; holes: Ring[] }[];
  private dragging = false;
  /** an analogue stick: forward and sideways, each -1 to 1, added to the keys (set by the touch joystick) */
  private axis = { f: 0, s: 0, run: false };

  constructor(
    canvas: HTMLElement,
    private readonly hero: Hero,
    start: Pose,
  ) {
    this.pose = { ...start };
    this.solids = hero.buildings.map((b) => ({ box: bbox(b.outer), outer: b.outer, holes: b.holes }));
    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.pose.yaw += e.movementX * 0.0035;
      this.pose.pitch = Math.max(-1.2, Math.min(1.2, this.pose.pitch - e.movementY * 0.0035));
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.fov = Math.max(28, Math.min(90, this.fov + Math.sign(e.deltaY) * 3));
      },
      { passive: false },
    );
  }

  setAxis(f: number, s: number, run = false): void {
    this.axis.f = f;
    this.axis.s = s;
    this.axis.run = run;
  }

  /** Puts the walker at a point, moving it to the nearest open ground if that is inside a building. */
  teleport(x: number, z: number): void {
    for (let r = 0; r < 40; r += 1.5) {
      for (let a = 0; a < 8; a++) {
        const px = x + Math.cos((a * Math.PI) / 4) * r;
        const pz = z + Math.sin((a * Math.PI) / 4) * r;
        if (this.free(px, pz)) {
          this.pose.x = px;
          this.pose.z = pz;
          return;
        }
      }
    }
  }

  /** Is a point inside a building? */
  blocked(x: number, z: number): boolean {
    for (const s of this.solids) {
      const [x0, z0, x1, z1] = s.box;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      if (pointInRing(x, z, s.outer) && !s.holes.some((h) => pointInRing(x, z, h))) return true;
    }
    return false;
  }

  private free(x: number, z: number): boolean {
    const r = 0.45;
    return !(this.blocked(x + r, z) || this.blocked(x - r, z) || this.blocked(x, z + r) || this.blocked(x, z - r));
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    const k = this.keys;
    const f = Math.max(
      -1,
      Math.min(1, (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.axis.f),
    );
    const s = Math.max(-1, Math.min(1, (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + this.axis.s));
    if (k.has("ArrowLeft")) this.pose.yaw -= dt * 1.5;
    if (k.has("ArrowRight")) this.pose.yaw += dt * 1.5;
    if (k.has("KeyQ")) this.pose.yaw -= dt * 1.5;
    if (k.has("KeyE")) this.pose.yaw += dt * 1.5;
    if (f || s) {
      const speed = (k.has("ShiftLeft") || k.has("ShiftRight") || this.axis.run ? 8 : 3.6) * dt;
      const dx = Math.sin(this.pose.yaw);
      const dz = -Math.cos(this.pose.yaw);
      const mx = (dx * f - dz * s) * speed;
      const mz = (dz * f + dx * s) * speed;
      const [x0, z0, x1, z1] = this.hero.core;
      const inside = (x: number, z: number) => x > x0 - 20 && x < x1 + 20 && z > z0 - 20 && z < z1 + 20;
      const nx = this.pose.x + mx;
      const nz = this.pose.z + mz;
      if (inside(nx, nz) && this.free(nx, nz)) {
        this.pose.x = nx;
        this.pose.z = nz;
      } else if (inside(nx, this.pose.z) && this.free(nx, this.pose.z)) this.pose.x = nx;
      else if (inside(this.pose.x, nz) && this.free(this.pose.x, nz)) this.pose.z = nz;
    }
    this.apply(camera);
  }

  apply(camera: THREE.PerspectiveCamera): void {
    const { x, z, yaw, pitch } = this.pose;
    const y = this.hero.heightAt(x, z) + EYE;
    camera.position.set(x, y, z);
    const cp = Math.cos(pitch);
    camera.lookAt(x + Math.sin(yaw) * cp * 10, y + Math.sin(pitch) * 10, z - Math.cos(yaw) * cp * 10);
    camera.fov = this.fov;
    camera.near = 0.15;
    camera.far = 6000;
    camera.updateProjectionMatrix();
  }
}
