// Click a building to inspect it: a ray from the click is cast at the building meshes, the hit point is matched to a
// footprint, and the building is outlined with a soft glow. A click is a press and release that hardly moves.
import { float, time, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Building } from "../data/types.ts";

export interface Picker {
  /** the building shown as selected, if any */
  readonly selected: Building | null;
  select(b: Building | null): void;
  dispose(): void;
}

const PARAPET = 0.9;

/**
 * A soft glow and a bright outline around a footprint, from the ground to the roof. The outline is the same shape drawn a
 * little larger with only its back faces showing, which leaves a rim around the silhouette wherever the building is seen.
 */
function highlightMeshes(b: Building): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape(b.outer.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const h of b.holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
  const top = b.ground + b.height + PARAPET + 0.15;
  const bottom = b.ground - 0.4;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, steps: 1 });
  // the extrusion runs along shape z; swap the axes so it runs up: (x, y, z) -> (x, z + bottom, y), centred on the building
  const [cx, cz] = b.centre;
  const cy = (top + bottom) / 2;
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - cx, p.getZ(i) + bottom - cy, p.getY(i) - cz);
  geo.computeVertexNormals();
  const pulse = float(0.8).add(time.mul(3.2).sin().mul(0.2));
  const shell = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  shell.colorNode = vec3(0.12, 0.5, 0.34).mul(pulse);
  shell.opacityNode = float(0.5);
  const glow = new THREE.Mesh(geo, shell);
  glow.position.set(cx, cy, cz);
  g.add(glow);
  const rim = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  rim.colorNode = vec3(0.45, 1.0, 0.7).mul(pulse).mul(1.6);
  const outline = new THREE.Mesh(geo, rim);
  outline.position.set(cx, cy, cz);
  // grow it by about a metre all round, whatever the size of the building
  const size = Math.max(8, Math.sqrt(b.footprint));
  outline.scale.set(1 + 1.1 / size, 1 + 0.9 / (top - bottom), 1 + 1.1 / size);
  outline.renderOrder = 4;
  g.add(outline);
  g.renderOrder = 5;
  return g;
}

export function createPicker(opts: {
  canvas: HTMLElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  targets: THREE.Object3D;
  find: (x: number, z: number) => Building | null;
  onSelect: (b: Building | null) => void;
  /** pointer events that start on this element are ignored (the interface) */
  ignore?: (e: PointerEvent) => boolean;
}): Picker {
  const ray = new THREE.Raycaster();
  ray.far = 4000;
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; t: number } | null = null;
  let glow: THREE.Group | null = null;
  const picker: Picker = {
    selected: null,
    select(b) {
      if (glow) {
        opts.scene.remove(glow);
        for (const c of glow.children) {
          (c as THREE.Mesh).geometry.dispose();
        }
        glow = null;
      }
      (picker as { selected: Building | null }).selected = b;
      if (b) {
        glow = highlightMeshes(b);
        opts.scene.add(glow);
      }
      opts.onSelect(b);
    },
    dispose() {
      opts.canvas.removeEventListener("pointerdown", onDown);
      opts.canvas.removeEventListener("pointerup", onUp);
    },
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || opts.ignore?.(e)) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e: PointerEvent): void => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 5 || !quick) return;
    const rect = opts.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, opts.camera);
    const hits = ray.intersectObject(opts.targets, true);
    const hit = hits.find((h) => h.object.name === "walls" || h.object.name === "roofs");
    const found = hit ? opts.find(hit.point.x, hit.point.z) : null;
    picker.select(found);
  };
  opts.canvas.addEventListener("pointerdown", onDown);
  opts.canvas.addEventListener("pointerup", onUp);
  return picker;
}
