// Trees: six illustrative species, each with its own crown shape and a painted leaf atlas. A tree is a tapering trunk,
// a few limbs, and lobes of leaf cards that face outward, shaded with soft normals and swaying in the wind.
//
// The data only says where a tree stands and how tall it is, so the species of each tree is an illustrative choice
// (seeded, so it never changes) rather than an identification.
import { cos, float, hash, instanceIndex, max, mix, positionLocal, sin, time, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { hashString, mulberry32 } from "../core/rng.ts";
import type { Hero } from "../data/types.ts";
import type { FloatUniform } from "./types.ts";

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

// ---- species ---------------------------------------------------------------------------------------------------

type LeafKind = "pinnate" | "lance" | "sickle" | "heart" | "ovate" | "tiny";

interface Species {
  name: string;
  leaf: LeafKind;
  /** hue, saturation and lightness ranges of the leaves, in degrees and percent */
  hue: [number, number];
  sat: [number, number];
  lum: [number, number];
  /** crown diameter as a fraction of tree height, and where the crown sits */
  crownRatio: number;
  crownBase: number;
  /** crown ellipsoid half-sizes in unit space (the unit tree is 1 high), flatness for umbrella crowns */
  crownY: number;
  lobes: number;
  cardsPerLobe: number;
  card: number;
  /** how far the cards droop: 0 faces outward, 1 hangs straight down */
  droop: number;
  trunk: number;
}

const SPECIES: Species[] = [
  {
    name: "neem",
    leaf: "pinnate",
    hue: [86, 104],
    sat: [34, 52],
    lum: [20, 34],
    crownRatio: 0.95,
    crownBase: 0.4,
    crownY: 0.3,
    lobes: 9,
    cardsPerLobe: 14,
    card: 0.16,
    droop: 0.15,
    trunk: 0.03,
  },
  {
    name: "mango",
    leaf: "lance",
    hue: [96, 118],
    sat: [36, 54],
    lum: [15, 27],
    crownRatio: 1.0,
    crownBase: 0.32,
    crownY: 0.36,
    lobes: 9,
    cardsPerLobe: 13,
    card: 0.17,
    droop: 0.35,
    trunk: 0.036,
  },
  {
    name: "eucalyptus",
    leaf: "sickle",
    hue: [118, 150],
    sat: [16, 30],
    lum: [22, 36],
    crownRatio: 0.42,
    crownBase: 0.48,
    crownY: 0.46,
    lobes: 8,
    cardsPerLobe: 12,
    card: 0.15,
    droop: 0.6,
    trunk: 0.03,
  },
  {
    name: "rain tree",
    leaf: "tiny",
    hue: [84, 100],
    sat: [38, 56],
    lum: [26, 40],
    crownRatio: 1.35,
    crownBase: 0.52,
    crownY: 0.2,
    lobes: 12,
    cardsPerLobe: 13,
    card: 0.16,
    droop: 0.2,
    trunk: 0.028,
  },
  {
    name: "peepal",
    leaf: "heart",
    hue: [92, 112],
    sat: [40, 58],
    lum: [24, 38],
    crownRatio: 1.1,
    crownBase: 0.42,
    crownY: 0.34,
    lobes: 10,
    cardsPerLobe: 12,
    card: 0.17,
    droop: 0.3,
    trunk: 0.034,
  },
  {
    name: "silver oak",
    leaf: "ovate",
    hue: [88, 108],
    sat: [30, 46],
    lum: [22, 34],
    crownRatio: 0.55,
    crownBase: 0.38,
    crownY: 0.42,
    lobes: 9,
    cardsPerLobe: 12,
    card: 0.15,
    droop: 0.2,
    trunk: 0.034,
  },
];

/** Picks a species for a tree from its height and a random number, so tall trees are tall kinds. */
function pickSpecies(height: number, r: number): number {
  const tall = height > 17;
  const w = tall ? [0.12, 0.1, 0.3, 0.2, 0.1, 0.18] : [0.3, 0.24, 0.02, 0.1, 0.2, 0.14];
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i] as number;
    if (r < acc) return i;
  }
  return 0;
}

// ---- leaf atlas ------------------------------------------------------------------------------------------------

const CELL = 512;
const COLS = 2;
const ROWS = 3;

interface CellUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Where a species' leaf sprite sits in the atlas, in texture coordinates (v up), inset by a few texels. */
function cellUV(index: number): CellUV {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const inset = 3 / CELL;
  return {
    u0: (col + inset) / COLS,
    u1: (col + 1 - inset) / COLS,
    v0: (ROWS - 1 - row + inset) / ROWS,
    v1: (ROWS - row - inset) / ROWS,
  };
}

type Painter = (g: CanvasRenderingContext2D, rnd: () => number, sp: Species, colour: boolean) => void;

/** One leaf drawn from its base at the origin, pointing up (negative y). In `colour` mode it has shading and a vein. */
function drawLeaf(
  g: CanvasRenderingContext2D,
  colour: boolean,
  sp: Species,
  rnd: () => number,
  x: number,
  y: number,
  angle: number,
  len: number,
  wid: number,
  kind: LeafKind,
  light: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, 0);
  if (kind === "heart") {
    g.bezierCurveTo(wid * 1.25, -len * 0.1, wid * 1.0, -len * 0.62, wid * 0.12, -len * 0.82);
    g.quadraticCurveTo(0, -len * 0.94, -len * 0.02, -len);
    g.quadraticCurveTo(-wid * 0.2, -len * 0.9, -wid * 0.12, -len * 0.82);
    g.bezierCurveTo(-wid * 1.0, -len * 0.62, -wid * 1.25, -len * 0.1, 0, 0);
  } else if (kind === "sickle") {
    g.quadraticCurveTo(wid * 1.2, -len * 0.4, wid * 0.4, -len);
    g.quadraticCurveTo(-wid * 0.2, -len * 0.5, 0, 0);
  } else {
    g.quadraticCurveTo(wid * 1.15, -len * 0.45, 0, -len);
    g.quadraticCurveTo(-wid * 1.15, -len * 0.45, 0, 0);
  }
  g.closePath();
  if (colour) {
    const hue = sp.hue[0] + rnd() * (sp.hue[1] - sp.hue[0]);
    const sat = sp.sat[0] + rnd() * (sp.sat[1] - sp.sat[0]);
    const lum = (sp.lum[0] + rnd() * (sp.lum[1] - sp.lum[0])) * (0.7 + light * 0.6);
    const gr = g.createLinearGradient(-wid, 0, wid, -len * 0.5);
    gr.addColorStop(0, `hsl(${hue},${sat}%,${lum * 0.82}%)`);
    gr.addColorStop(1, `hsl(${hue - 5},${sat + 4}%,${lum * 1.22}%)`);
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = `hsla(${hue + 10},${sat * 0.6}%,${lum * 1.7}%,0.5)`;
    g.lineWidth = Math.max(0.8, len / 55);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(kind === "sickle" ? wid * 0.25 : 0, -len * 0.9);
    g.stroke();
    g.lineWidth = Math.max(0.5, len / 110);
    g.globalAlpha = 0.32;
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      g.beginPath();
      g.moveTo(0, -len * t);
      g.lineTo(wid * 0.55, -len * (t + 0.16));
      g.moveTo(0, -len * t);
      g.lineTo(-wid * 0.55, -len * (t + 0.16));
      g.stroke();
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "#fff";
    g.fill();
  }
  g.restore();
}

const paintSprig: Painter = (g, rnd, sp, colour) => {
  const S = CELL;
  const twig = (x0: number, y0: number, ang: number, len: number, leafLen: number, leafWid: number, kind: LeafKind, n: number) => {
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    if (colour) {
      g.strokeStyle = "#4a3a26";
      g.lineWidth = S / 120;
    } else {
      g.strokeStyle = "#fff";
      g.lineWidth = S / 120;
    }
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + dx * len, y0 + dy * len);
    g.stroke();
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const px = x0 + dx * len * t;
      const py = y0 + dy * len * t;
      const l = leafLen * (1 - t * 0.35) * (0.85 + rnd() * 0.3);
      const spread = kind === "sickle" ? 0.5 : kind === "pinnate" || kind === "tiny" ? 1.15 : 0.85;
      drawLeaf(g, colour, sp, rnd, px, py, ang - spread + (rnd() - 0.5) * 0.4, l, l * leafWid, kind, t);
      drawLeaf(g, colour, sp, rnd, px, py, ang + spread + (rnd() - 0.5) * 0.4, l, l * leafWid, kind, t);
    }
    drawLeaf(g, colour, sp, rnd, x0 + dx * len, y0 + dy * len, ang, leafLen * 0.8, leafLen * 0.8 * leafWid, kind, 1);
  };
  const ox = S * 0.5;
  const oy = S * 0.94;
  switch (sp.leaf) {
    case "pinnate":
    case "tiny": {
      // a compound leaf: many small leaflets along a few rachises
      const n = sp.leaf === "tiny" ? 14 : 11;
      for (let s = 0; s < 6; s++) {
        const ang = -0.95 + (s / 5) * 1.9 + (rnd() - 0.5) * 0.2;
        twig(
          ox,
          oy,
          ang,
          S * (0.62 + rnd() * 0.12),
          S * (sp.leaf === "tiny" ? 0.075 : 0.09),
          0.34,
          sp.leaf === "tiny" ? "ovate" : "lance",
          n,
        );
      }
      break;
    }
    case "lance":
      for (let s = 0; s < 6; s++) {
        const ang = -1.0 + (s / 5) * 2.0 + (rnd() - 0.5) * 0.25;
        twig(ox, oy, ang, S * (0.5 + rnd() * 0.15), S * 0.16, 0.22, "lance", 6);
      }
      break;
    case "sickle":
      // many narrow leaves hanging in bunches
      for (let s = 0; s < 34; s++) {
        const ang = -1.0 + (s / 33) * 2.0 + (rnd() - 0.5) * 0.3;
        const len = S * (0.26 + rnd() * 0.12);
        drawLeaf(g, colour, sp, rnd, ox + (rnd() - 0.5) * 140, oy - rnd() * S * 0.3, ang, len, len * 0.1, "sickle", rnd());
      }
      break;
    case "heart":
      for (let s = 0; s < 6; s++) {
        const ang = -1.0 + (s / 5) * 2.0 + (rnd() - 0.5) * 0.25;
        twig(ox, oy, ang, S * (0.5 + rnd() * 0.15), S * 0.13, 0.5, "heart", 5);
      }
      break;
    case "ovate":
      for (let s = 0; s < 5; s++) {
        const ang = -0.9 + (s / 4) * 1.8 + (rnd() - 0.5) * 0.2;
        twig(ox, oy, ang, S * (0.6 + rnd() * 0.15), S * 0.12, 0.42, "ovate", 9);
      }
      break;
  }
};

/** The atlas: one leaf sprite per species, with colour dilated into the transparent texels so edges never fringe dark. */
function buildLeafAtlas(): THREE.DataTexture {
  const W = CELL * COLS;
  const H = CELL * ROWS;
  const make = (): CanvasRenderingContext2D => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  };
  const cg = make();
  const ag = make();
  cg.fillStyle = "#3d5a26";
  cg.fillRect(0, 0, W, H);
  ag.fillStyle = "#000";
  ag.fillRect(0, 0, W, H);
  SPECIES.forEach((sp, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const mean = `hsl(${(sp.hue[0] + sp.hue[1]) / 2},${(sp.sat[0] + sp.sat[1]) / 2}%,${(sp.lum[0] + sp.lum[1]) / 2}%)`;
    for (const [g, colour] of [
      [cg, true],
      [ag, false],
    ] as const) {
      g.save();
      g.beginPath();
      g.rect(col * CELL, row * CELL, CELL, CELL);
      g.clip();
      g.translate(col * CELL, row * CELL);
      if (colour) {
        g.fillStyle = mean;
        g.fillRect(0, 0, CELL, CELL);
      }
      paintSprig(g, mulberry32(1000 + i), sp, colour);
      g.restore();
    }
  });
  const rgb = cg.getImageData(0, 0, W, H).data;
  const alpha = ag.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  // canvas row 0 is the top; texture row 0 is the bottom
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    const dst = y * W * 4;
    for (let x = 0; x < W; x++) {
      out[dst + x * 4] = rgb[src + x * 4] as number;
      out[dst + x * 4 + 1] = rgb[src + x * 4 + 1] as number;
      out[dst + x * 4 + 2] = rgb[src + x * 4 + 2] as number;
      out[dst + x * 4 + 3] = alpha[src + x * 4] as number;
    }
  }
  // an opaque patch in the first texel block, which the trunk and limbs sample
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const o = (y * W + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; // white, so the vertex colour alone makes the bark
    }
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ---- geometry --------------------------------------------------------------------------------------------------

interface Buffers {
  pos: number[];
  nor: number[];
  uvs: number[];
  col: number[];
}

const TRUNK_UV = [0.002, 0.002] as const;

function limb(b: Buffers, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, colour: [number, number, number]): void {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(r1, r0, len, 7, 1, true).toNonIndexed();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyMatrix4(
    new THREE.Matrix4().compose(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)),
  );
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    b.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    b.nor.push(n.getX(i), n.getY(i), n.getZ(i));
    b.uvs.push(TRUNK_UV[0], TRUNK_UV[1]);
    b.col.push(colour[0], colour[1], colour[2]);
  }
}

/** One tree of a species in unit space: height 1, crown diameter 1. The instance matrix scales it to the real tree. */
export function treeGeometry(species: number, seed: number, detail = 1): THREE.BufferGeometry {
  const sp = SPECIES[species] as Species;
  const rnd = mulberry32(seed * 7919 + species);
  const b: Buffers = { pos: [], nor: [], uvs: [], col: [] };
  const bark: [number, number, number] = [0.13, 0.09, 0.06];

  // trunk, leaning a little, with a flare at the root; then limbs out to the lobes
  const lean = new THREE.Vector3((rnd() - 0.5) * 0.05, 0, (rnd() - 0.5) * 0.05);
  const topY = sp.crownBase + sp.crownY * 0.35;
  const top = new THREE.Vector3(lean.x, topY, lean.z);
  limb(b, new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean.x * 0.5, topY * 0.4, lean.z * 0.5), sp.trunk * 1.35, sp.trunk, bark);
  limb(b, new THREE.Vector3(lean.x * 0.5, topY * 0.4, lean.z * 0.5), top, sp.trunk, sp.trunk * 0.62, bark);

  const crown = new THREE.Vector3(lean.x, sp.crownBase + sp.crownY, lean.z);
  const rx = 0.5;
  const ry = sp.crownY;
  const lobes: THREE.Vector3[] = [];
  for (let i = 0; i < sp.lobes; i++) {
    let p: THREE.Vector3;
    let tries = 0;
    do {
      p = new THREE.Vector3((rnd() * 2 - 1) * rx * 0.72, (rnd() * 2 - 1) * ry * 0.7, (rnd() * 2 - 1) * rx * 0.72);
      tries++;
    } while (tries < 20 && (p.x * p.x + p.z * p.z) / (rx * rx * 0.5) + (p.y * p.y) / (ry * ry * 0.5) > 1);
    // keep the lobes apart
    if (lobes.every((q) => q.distanceTo(p) > 0.16)) lobes.push(p);
    else if (tries > 4) lobes.push(p);
  }
  const lobeRadius = Math.max(0.12, (rx * 1.5) / Math.sqrt(lobes.length + 2));
  for (const l of lobes) {
    const to = new THREE.Vector3().addVectors(crown, l);
    const mid = new THREE.Vector3().lerpVectors(top, to, 0.5).add(new THREE.Vector3((rnd() - 0.5) * 0.03, 0.02, (rnd() - 0.5) * 0.03));
    limb(b, top, mid, sp.trunk * 0.5, sp.trunk * 0.34, bark);
    limb(b, mid, to, sp.trunk * 0.34, sp.trunk * 0.12, bark);
  }

  // leaf cards in each lobe, facing outward and drooping by species
  const c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const lobeN = new THREE.Vector3();
  const crownN = new THREE.Vector3();
  const sn = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const uv = cellUV(SPECIES.indexOf(sp));
  for (const l of lobes) {
    const centre = new THREE.Vector3().addVectors(crown, l);
    // a lighter tree has fewer cards, each larger, so that it covers about the same area from far away
    const cards = Math.max(3, Math.ceil(sp.cardsPerLobe * detail));
    for (let i = 0; i < cards; i++) {
      // a point inside the lobe, pushed toward its surface so the lobe is a shell of leaves with a little depth
      do c.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      while (c.lengthSq() > 1 || c.lengthSq() < 0.12);
      const depth = Math.sqrt(c.lengthSq());
      const pos = new THREE.Vector3().copy(c).multiplyScalar(lobeRadius).add(centre);
      lobeN.copy(c).normalize();
      crownN
        .subVectors(pos, crown)
        .divide(new THREE.Vector3(rx, ry, rx))
        .normalize();
      // the card faces outward from the lobe, sagging toward straight down by the species' droop
      nrm.copy(lobeN).multiplyScalar(0.7).addScaledVector(crownN, 0.3);
      nrm.y -= sp.droop * 0.9;
      nrm.normalize();
      u.set(0, 1, 0).cross(nrm);
      if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
      u.normalize();
      v.copy(nrm).cross(u).normalize();
      const roll = rnd() * Math.PI * 2;
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const ru = new THREE.Vector3().copy(u).multiplyScalar(cr).addScaledVector(v, sr);
      const rv = new THREE.Vector3().copy(v).multiplyScalar(cr).addScaledVector(u, -sr);
      const s = sp.card * (0.8 + rnd() * 0.45) * Math.sqrt(sp.cardsPerLobe / cards);
      // soft shading normal: part lobe, part whole crown, tipped up so that the top of a tree catches the sun
      sn.copy(lobeN).multiplyScalar(0.45).addScaledVector(crownN, 0.55);
      sn.y += 0.3;
      sn.normalize();
      const interior = clamp((1 - depth) * 0.5, 0, 1);
      const lowness = clamp((pos.y - crown.y) / (ry * 1.1) + 0.5, 0, 1);
      const ao = clamp(0.5 + 0.5 * lowness - interior * 0.35 + (rnd() - 0.5) * 0.12, 0.3, 1);
      const hueJitter = (rnd() - 0.5) * 0.14;
      const corners: [number, number, number, number][] = [
        [-1, -0.05, 0, 0],
        [1, -0.05, 1, 0],
        [1, 1.95, 1, 1],
        [-1, 1.95, 0, 1],
      ];
      const emit = (k: number, back: boolean) => {
        const q = corners[k] as [number, number, number, number];
        tmp
          .copy(pos)
          .addScaledVector(ru, q[0] * s)
          .addScaledVector(rv, (q[1] - 0.95) * s);
        b.pos.push(tmp.x, tmp.y, tmp.z);
        b.nor.push(sn.x, sn.y, sn.z);
        const uu = back ? 1 - q[2] : q[2];
        b.uvs.push(uv.u0 + (uv.u1 - uv.u0) * uu, uv.v0 + (uv.v1 - uv.v0) * q[3]);
        b.col.push(ao * (1 + hueJitter), ao, ao * (1 - hueJitter));
      };
      for (const t of [
        [0, 1, 2],
        [0, 2, 3],
      ] as const)
        for (const k of t) emit(k, false);
      for (const t of [
        [0, 2, 1],
        [0, 3, 2],
      ] as const)
        for (const k of t) emit(k, true);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uvs, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}

// ---- material --------------------------------------------------------------------------------------------------

export interface TreeUniforms {
  /** wind strength multiplier: 1 is a light breeze */
  wind: FloatUniform;
}

export function createLeafMaterial(map: THREE.Texture, wind: TreeUniforms["wind"]): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ map, alphaTest: 0.42, side: THREE.FrontSide, roughness: 0.78, metalness: 0 });
  m.vertexColors = true;
  const phase = hash(instanceIndex).mul(6.2831);
  // the whole crown rocks (more toward the top); each card flutters on its own, by where it hangs
  const h = max(positionLocal.y.sub(0.3), float(0));
  const cardPhase = positionLocal.x.mul(23.0).add(positionLocal.z.mul(17.0)).add(positionLocal.y.mul(11.0));
  const sway = vec3(
    sin(time.mul(1.5).add(phase))
      .mul(0.03)
      .add(sin(time.mul(3.1).add(phase.mul(2))).mul(0.012)),
    0,
    cos(time.mul(1.2).add(phase))
      .mul(0.022)
      .add(cos(time.mul(2.7).add(phase.mul(1.7))).mul(0.01)),
  );
  const flutter = vec3(
    sin(time.mul(7.3).add(cardPhase)),
    sin(time.mul(5.1).add(cardPhase.mul(1.3))).mul(0.5),
    cos(time.mul(6.2).add(cardPhase)),
  ).mul(0.006);
  m.positionNode = positionLocal.add(sway.mul(h).mul(wind)).add(flutter.mul(mix(float(0.4), float(1), h.mul(2).min(1))).mul(wind));
  return m;
}

// ---- placement -------------------------------------------------------------------------------------------------

export interface TreeMeshes {
  group: THREE.Group;
  triangles: number;
  count: number;
  /** call every frame: trees near the camera use the full model, the rest a lighter one */
  update(camera: THREE.Camera): void;
}

const VARIANTS = 2;
/** trees closer than this (metres) are drawn in full detail */
const NEAR = 85;
const FAR_DETAIL = 0.34;

interface Item {
  t: { x: number; z: number; height: number; ground: number };
  r: number;
  matrix: THREE.Matrix4;
  colour: THREE.Color;
}

export function buildTrees(hero: Hero, wind: TreeUniforms["wind"]): TreeMeshes {
  const [x0, z0, x1, z1] = hero.box;
  const list = hero.trees.filter((t) => t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1);
  const material = createLeafMaterial(buildLeafAtlas(), wind);
  const group = new THREE.Group();
  group.name = "trees";

  // bucket the trees by species and variant, so that each bucket is two instanced draws (near and far)
  const buckets = new Map<string, { sp: number; variant: number; items: Item[] }>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const t of list) {
    const rnd = mulberry32(hashString(`${t.x.toFixed(1)},${t.z.toFixed(1)}`));
    const sp = pickSpecies(t.height, rnd());
    const variant = Math.floor(rnd() * VARIANTS);
    const key = `${sp}:${variant}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { sp, variant, items: [] };
      buckets.set(key, bucket);
    }
    const r = rnd();
    const kind = SPECIES[sp] as Species;
    const h = Math.max(3.5, t.height);
    const width = h * kind.crownRatio * (0.85 + r * 0.3);
    q.setFromAxisAngle(up, r * Math.PI * 2 * 7.13);
    pos.set(t.x, t.ground, t.z);
    sc.set(width, h, width);
    // a little colour difference from tree to tree: some are paler, some deeper, some warmer
    const tint = 0.84 + ((r * 13.7) % 1) * 0.3;
    const k = Math.sin(t.x * 0.37 + t.z * 0.91);
    bucket.items.push({
      t,
      r,
      matrix: new THREE.Matrix4().compose(pos, q, sc),
      colour: new THREE.Color(tint * (0.9 + 0.1 * k), tint * 0.95, tint * (0.9 - 0.1 * k)),
    });
  }
  void m4;

  interface Level {
    near: THREE.InstancedMesh;
    far: THREE.InstancedMesh;
    items: Item[];
  }
  const levels: Level[] = [];
  const make = (geo: THREE.BufferGeometry, n: number, name: string): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, n));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // the trees of one kind are spread over the whole area
    mesh.name = name;
    mesh.count = 0;
    // an instance colour buffer must exist before the first draw
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    group.add(mesh);
    return mesh;
  };
  let triangles = 0;
  for (const { sp, variant, items } of buckets.values()) {
    const kind = SPECIES[sp] as Species;
    const nearGeo = treeGeometry(sp, variant + 1, 1);
    const farGeo = treeGeometry(sp, variant + 1, FAR_DETAIL);
    levels.push({
      near: make(nearGeo, items.length, `trees:${kind.name}:near`),
      far: make(farGeo, items.length, `trees:${kind.name}:far`),
      items,
    });
    triangles += ((farGeo.attributes.position as THREE.BufferAttribute).count / 3) * items.length;
  }

  const placed = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  let lastUpdate = 0;
  const update = (camera: THREE.Camera): void => {
    const now = performance.now();
    // only when the camera has moved a few metres, and not more than a few times a second
    if (now - lastUpdate < 250 || camera.position.distanceToSquared(placed) < 25) return;
    lastUpdate = now;
    placed.copy(camera.position);
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const { near, far, items } of levels) {
      let n = 0;
      let f = 0;
      for (const it of items) {
        const dx = it.t.x - cx;
        const dz = it.t.z - cz;
        if (dx * dx + dz * dz < NEAR * NEAR) {
          near.setMatrixAt(n, it.matrix);
          near.setColorAt(n, it.colour);
          n++;
        } else {
          far.setMatrixAt(f, it.matrix);
          far.setColorAt(f, it.colour);
          f++;
        }
      }
      near.count = n;
      far.count = f;
      near.instanceMatrix.needsUpdate = true;
      far.instanceMatrix.needsUpdate = true;
      if (near.instanceColor) near.instanceColor.needsUpdate = true;
      if (far.instanceColor) far.instanceColor.needsUpdate = true;
    }
  };
  placed.set(Number.POSITIVE_INFINITY, 0, 0);
  return { group, triangles, count: list.length, update };
}
