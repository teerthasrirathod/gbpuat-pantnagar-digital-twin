// Flying the orbit camera with the keyboard: W A S D or the arrows move it over the ground in any direction while held (Shift
// for speed), Q and E turn it around the point it looks at. The speed follows the distance, so close up it is a gentle
// glide and from high above it crosses the campus in a few seconds.
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as THREE from "three/webgpu";
import type { Hero } from "../data/types.ts";

const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyQ", "KeyE"]);

export class OrbitFlyer {
  private readonly held = new Set<string>();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor(private readonly hero: Hero) {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (MOVE.has(e.code) || e.code === "ShiftLeft" || e.code === "ShiftRight") this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
  }

  /** True while a movement key is down (so the app can keep drawing). */
  get active(): boolean {
    for (const k of this.held) if (MOVE.has(k)) return true;
    return false;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, orbit: OrbitControls): void {
    const h = this.held;
    if (!this.active) return;
    const fast = h.has("ShiftLeft") || h.has("ShiftRight");
    const f = (h.has("KeyW") || h.has("ArrowUp") ? 1 : 0) - (h.has("KeyS") || h.has("ArrowDown") ? 1 : 0);
    const r = (h.has("KeyD") || h.has("ArrowRight") ? 1 : 0) - (h.has("KeyA") || h.has("ArrowLeft") ? 1 : 0);
    const turn = (h.has("KeyQ") ? 1 : 0) - (h.has("KeyE") ? 1 : 0);
    const target = orbit.target;
    this.offset.subVectors(camera.position, target);
    if (turn) {
      const a = turn * dt * (fast ? 2.2 : 1.2);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ox = this.offset.x;
      this.offset.x = ox * c - this.offset.z * s;
      this.offset.z = ox * s + this.offset.z * c;
    }
    let moved = false;
    if (f || r) {
      // forward is toward the point looked at, flattened onto the ground
      this.fwd.set(-this.offset.x, 0, -this.offset.z);
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
      this.fwd.normalize();
      this.right.set(-this.fwd.z, 0, this.fwd.x);
      const dist = Math.max(8, this.offset.length());
      const speed = (dist * (fast ? 1.3 : 0.42) * dt) / Math.hypot(f, r);
      this.delta
        .copy(this.fwd)
        .multiplyScalar(f * speed)
        .addScaledVector(this.right, r * speed);
      const [x0, z0, x1, z1] = this.hero.box;
      target.x = Math.max(x0, Math.min(x1, target.x + this.delta.x));
      target.z = Math.max(z0, Math.min(z1, target.z + this.delta.z));
      moved = true;
    }
    if (moved) {
      // keep the point looked at a little above the ground, and the camera at the same height above it as before
      const ground = this.hero.heightAt(target.x, target.z) + 8;
      const dy = ground - target.y;
      target.y = ground;
      camera.position.y += dy;
    }
    camera.position.set(target.x + this.offset.x, camera.position.y, target.z + this.offset.z);
    orbit.update();
  }
}
