// A tiny kit for building low-poly props from primitives: boxes, cylinders and extruded profiles are placed with a
// matrix, given a colour and surface values, and merged into one geometry. One material then draws any prop.
//
// Per-vertex data (besides position and normal):
//   color   linear base colour
//   aMat    x roughness, y metalness, z emissive strength (shown at night), w part code (animation or tinting)
import * as THREE from "three/webgpu";

export interface Surface {
  roughness: number;
  metalness: number;
  emissive: number;
  /** 0 body; see the people and vehicles for the meaning of other codes */
  part: number;
}

export const surface = (roughness = 0.7, metalness = 0, emissive = 0, part = 0): Surface => ({ roughness, metalness, emissive, part });

export class Kit {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly m: number[] = [];

  /** Adds a geometry placed by `matrix`. */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, colour: THREE.ColorRepresentation, s: Surface = surface()): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const col = new THREE.Color(colour);
    for (let i = 0; i < pos.count; i++) {
      this.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      this.c.push(col.r, col.g, col.b);
      this.m.push(s.roughness, s.metalness, s.emissive, s.part);
    }
    g.dispose();
    return this;
  }

  /** Adds another kit's finished geometry, keeping its own colours and surface values. */
  append(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): this {
    const g = geometry.clone().applyMatrix4(matrix);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    const mat = g.attributes.aMat as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      this.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      this.c.push(col.getX(i), col.getY(i), col.getZ(i));
      this.m.push(mat.getX(i), mat.getY(i), mat.getZ(i), mat.getW(i));
    }
    g.dispose();
    return this;
  }

  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    colour: THREE.ColorRepresentation,
    s?: Surface,
    rotY = 0,
  ): this {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(Y, rotY), ONE);
    return this.add(new THREE.BoxGeometry(sx, sy, sz), m, colour, s);
  }

  /** A cylinder (or cone) standing on the y axis, by its base centre. */
  cylinder(
    cx: number,
    cy: number,
    cz: number,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    colour: THREE.ColorRepresentation,
    s?: Surface,
    segments = 10,
  ): this {
    const m = new THREE.Matrix4().makeTranslation(cx, cy + height / 2, cz);
    return this.add(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), m, colour, s);
  }

  /** A cylinder lying along an axis ('x' or 'z'), by its centre: wheels, handlebars, arms. */
  roll(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    length: number,
    axis: "x" | "z",
    colour: THREE.ColorRepresentation,
    s?: Surface,
    segments = 14,
  ): this {
    const q = new THREE.Quaternion().setFromAxisAngle(axis === "x" ? Z : X, Math.PI / 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, ONE);
    return this.add(new THREE.CylinderGeometry(radius, radius, length, segments), m, colour, s);
  }

  /** A side-view outline (x along the prop, y up) swept across `width` along z, with a small bevel. */
  profile(points: [number, number][], width: number, colour: THREE.ColorRepresentation, s?: Surface, bevel = 0.04, z = 0): this {
    const shape = new THREE.Shape();
    for (const [i, [x, y]] of points.entries()) {
      if (i) shape.lineTo(x, y);
      else shape.moveTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.001, width - bevel * 2),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      steps: 1,
    });
    geo.translate(0, 0, -(width - bevel * 2) / 2);
    return this.add(geo, new THREE.Matrix4().makeTranslation(0, 0, z), colour, s);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("aMat", new THREE.Float32BufferAttribute(this.m, 4));
    g.computeBoundingSphere();
    return g;
  }

  get triangles(): number {
    return this.p.length / 9;
  }
}

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
