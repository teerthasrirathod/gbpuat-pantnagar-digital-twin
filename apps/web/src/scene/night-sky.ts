// The night sky: the stars, a faint Milky Way, a glow near the horizon and the moon. Stars are placed from their real
// right ascension and declination (about sixty of the brightest, plus a procedural field of faint ones) and turn with
// the local sidereal time, so Orion and the Plough really are where they should be for the date and hour.
// The moon is a sphere lit by the sun, so its phase is simply what the geometry gives.
import {
  atan,
  dot,
  float,
  length,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { mulberry32 } from "../core/rng.ts";
import { noiseKit } from "./noise-textures.ts";

const RAD = Math.PI / 180;
const DOME = 5200; // metres: farther than anything in the scene, nearer than the camera far plane

/** Approximate J2000 positions of bright stars: right ascension in hours, declination in degrees, visual magnitude. */
const BRIGHT: [number, number, number][] = [
  [6.752, -16.716, -1.46], // Sirius
  [6.399, -52.696, -0.74], // Canopus
  [14.66, -60.835, -0.27], // Rigil Kentaurus
  [14.261, 19.182, -0.05], // Arcturus
  [18.615, 38.784, 0.03], // Vega
  [5.278, 45.998, 0.08], // Capella
  [5.242, -8.202, 0.13], // Rigel
  [7.655, 5.225, 0.34], // Procyon
  [1.629, -57.237, 0.46], // Achernar
  [5.919, 7.407, 0.5], // Betelgeuse
  [14.064, -60.373, 0.61], // Hadar
  [19.846, 8.868, 0.77], // Altair
  [12.443, -63.099, 0.76], // Acrux
  [4.599, 16.509, 0.85], // Aldebaran
  [16.49, -26.432, 0.96], // Antares
  [13.42, -11.161, 0.98], // Spica
  [7.755, 28.026, 1.14], // Pollux
  [22.961, -29.622, 1.16], // Fomalhaut
  [20.69, 45.28, 1.25], // Deneb
  [12.795, -59.689, 1.25], // Mimosa
  [10.14, 11.967, 1.35], // Regulus
  [6.977, -28.972, 1.5], // Adhara
  [7.577, 31.888, 1.58], // Castor
  [12.519, -57.113, 1.64], // Gacrux
  [17.56, -37.104, 1.62], // Shaula
  [5.419, 6.35, 1.64], // Bellatrix
  [5.438, 28.608, 1.65], // Elnath
  [9.22, -69.717, 1.68], // Miaplacidus
  [5.604, -1.202, 1.69], // Alnilam
  [22.137, -46.961, 1.74], // Alnair
  [5.679, -1.943, 1.77], // Alnitak
  [12.9, 55.96, 1.77], // Alioth
  [11.062, 61.751, 1.79], // Dubhe
  [3.405, 49.861, 1.8], // Mirfak
  [7.14, -26.393, 1.84], // Wezen
  [17.622, -42.998, 1.87], // Sargas
  [18.403, -34.385, 1.85], // Kaus Australis
  [13.793, 49.313, 1.86], // Alkaid
  [5.992, 44.948, 1.9], // Menkalinan
  [6.629, 16.399, 1.93], // Alhena
  [2.53, 89.264, 1.98], // Polaris
  [6.378, -17.956, 1.98], // Mirzam
  [9.46, -8.659, 1.98], // Alphard
  [2.12, 23.462, 2.0], // Hamal
  [0.727, -17.987, 2.04], // Diphda
  [18.921, -26.297, 2.05], // Nunki
  [1.162, 35.62, 2.05], // Mirach
  [0.14, 29.09, 2.07], // Alpheratz
  [5.796, -9.67, 2.06], // Saiph
  [5.533, -0.299, 2.23], // Mintaka
  [11.031, 56.382, 2.37], // Merak
  [11.897, 53.695, 2.44], // Phecda
  [13.399, 54.925, 2.27], // Mizar
  [12.257, 57.033, 3.31], // Megrez
  [0.675, 56.537, 2.23], // Schedar
  [0.153, 59.15, 2.27], // Caph
  [0.945, 60.717, 2.47], // Gamma Cassiopeiae
  [1.43, 60.235, 2.68], // Ruchbah
  [1.907, 63.67, 3.35], // Segin
];

/** Colour of a star from a rough temperature class, as linear RGB. */
const tint = (kind: number): [number, number, number] => {
  if (kind < 0.35) return [0.7, 0.8, 1.0]; // blue-white
  if (kind < 0.7) return [1.0, 0.97, 0.92]; // white
  if (kind < 0.9) return [1.0, 0.88, 0.62]; // yellow
  return [1.0, 0.65, 0.4]; // orange
};
const NAMED_TINT: Record<number, [number, number, number]> = {
  [5.919]: [1.0, 0.55, 0.35], // Betelgeuse
  [16.49]: [1.0, 0.5, 0.32], // Antares
  [4.599]: [1.0, 0.68, 0.45], // Aldebaran
  [14.261]: [1.0, 0.8, 0.55], // Arcturus
  [5.242]: [0.7, 0.8, 1.0], // Rigel
  [6.752]: [0.82, 0.9, 1.0], // Sirius
};

interface Star {
  ra: number; // radians
  dec: number;
  mag: number;
  colour: [number, number, number];
}

function buildCatalogue(): Star[] {
  const stars: Star[] = [];
  for (const [h, dec, mag] of BRIGHT) {
    stars.push({ ra: h * 15 * RAD, dec: dec * RAD, mag, colour: NAMED_TINT[h] ?? tint(0.5) });
  }
  const rnd = mulberry32(2026);
  // faint field stars everywhere, many more of them than the bright ones
  for (let i = 0; i < 1700; i++) {
    const z = rnd() * 2 - 1;
    stars.push({ ra: rnd() * Math.PI * 2, dec: Math.asin(z), mag: 3.2 + rnd() ** 0.55 * 3.4, colour: tint(rnd()) });
  }
  // the Milky Way: dim stars piled up around the galactic plane (north pole at RA 192.86 deg, Dec +27.13 deg)
  const ngp = new THREE.Vector3(
    Math.cos(27.128 * RAD) * Math.cos(192.859 * RAD),
    Math.cos(27.128 * RAD) * Math.sin(192.859 * RAD),
    Math.sin(27.128 * RAD),
  );
  const gc = new THREE.Vector3(
    Math.cos(-28.936 * RAD) * Math.cos(266.405 * RAD),
    Math.cos(-28.936 * RAD) * Math.sin(266.405 * RAD),
    Math.sin(-28.936 * RAD),
  );
  const gy = new THREE.Vector3().crossVectors(ngp, gc).normalize();
  const gx = new THREE.Vector3().crossVectors(gy, ngp).normalize();
  for (let i = 0; i < 5200; i++) {
    const l = rnd() * Math.PI * 2;
    // latitude concentrated near the plane, and the band is brighter toward the galactic centre
    const b = (rnd() + rnd() + rnd() - 1.5) * 0.22;
    const near = Math.max(0, Math.cos(l - 0)) * 0.5 + 0.5;
    if (rnd() > 0.25 + 0.75 * near) continue;
    const v = new THREE.Vector3()
      .addScaledVector(gx, Math.cos(b) * Math.cos(l))
      .addScaledVector(gy, Math.cos(b) * Math.sin(l))
      .addScaledVector(ngp, Math.sin(b));
    stars.push({ ra: Math.atan2(v.y, v.x), dec: Math.asin(v.z), mag: 5.4 + rnd() * 1.4, colour: tint(rnd() * 0.8) });
  }
  return stars;
}

export interface MoonState {
  /** unit vector toward the moon, local frame (x east, y up, z south) */
  direction: [number, number, number];
  elevation: number;
  illuminated: number;
}

export interface NightSky {
  group: THREE.Group;
  /** places everything for a moment: the sidereal time (degrees), the sun's direction, the moon and the darkness (0 day, 1 night) */
  set(args: { latDeg: number; lstDeg: number; sunDir: THREE.Vector3; moon: MoonState; night: number }): void;
  /** keeps the dome centred on the camera, so that it stays infinitely far away */
  follow(camera: THREE.Camera): void;
}

export function createNightSky(): NightSky {
  const group = new THREE.Group();
  group.name = "night-sky";
  const stars = buildCatalogue();
  const visibility = uniform(0);

  // the stars: a quad each, facing the centre, added to the sky
  const quad = new THREE.PlaneGeometry(1, 1);
  const starMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide, // the quads are turned to face the centre by a look-at, which leaves them facing outward
  });
  const d = length(uv().sub(0.5)).mul(2);
  const soft = float(1)
    .sub(smoothstep(0, 1, d))
    .pow(2.6);
  starMaterial.colorNode = vec3(1, 1, 1);
  starMaterial.opacityNode = soft.mul(visibility);
  const starMesh = new THREE.InstancedMesh(quad, starMaterial, stars.length);
  starMesh.frustumCulled = false;
  starMesh.renderOrder = 2;
  starMesh.name = "stars";
  group.add(starMesh);

  // a faint glow near the horizon, which is never quite black
  const glowMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const dirY = positionLocal.normalize().y;
  const horizon = float(1).sub(dirY.abs().pow(0.5));
  glowMaterial.colorNode = mix(vec3(0.0025, 0.0045, 0.011), vec3(0.012, 0.017, 0.03), horizon.pow(2));
  glowMaterial.opacityNode = visibility.mul(smoothstep(-0.05, 0.05, dirY).mul(0.7).add(0.3));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(DOME * 0.97, 24, 12), glowMaterial);
  glow.renderOrder = 1;
  glow.name = "night-glow";
  group.add(glow);

  // the moon: bigger than the real thing (a little over a degree across) so that it reads as the moon on a screen
  const sunDirUniform = uniform(new THREE.Vector3(0, 1, 0));
  const moonMaterial = new THREE.MeshBasicNodeMaterial({ fog: false, depthWrite: false });
  const n = normalLocal;
  const mu = atan(n.z, n.x)
    .div(Math.PI * 2)
    .add(0.5);
  const mv = n.y.asin().div(Math.PI).add(0.5);
  const noise = texture(noiseKit().fields, vec2(mu.mul(2), mv))
    .g.mul(0.6)
    .add(texture(noiseKit().fields, vec2(mu.mul(6), mv.mul(3))).b.mul(0.4));
  const maria = smoothstep(0.52, 0.68, noise);
  const albedo = mix(vec3(0.9, 0.88, 0.82), vec3(0.45, 0.45, 0.46), maria.mul(0.85));
  const lit = smoothstep(-0.04, 0.1, dot(normalWorld, sunDirUniform));
  moonMaterial.colorNode = albedo.mul(lit.mul(4.2).add(0.05));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(DOME * 0.0105, 24, 16), moonMaterial);
  moon.renderOrder = 3;
  moon.name = "moon";
  group.add(moon);
  // a soft halo around it
  const haloMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const hd = length(uv().sub(0.5)).mul(2);
  haloMaterial.colorNode = vec3(0.5, 0.6, 0.85);
  const haloGain = uniform(0.2);
  haloMaterial.opacityNode = float(1)
    .sub(smoothstep(0, 1, hd))
    .pow(3)
    .mul(haloGain);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(DOME * 0.12, DOME * 0.12), haloMaterial);
  halo.renderOrder = 2;
  group.add(halo);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  const lookAtMatrix = new THREE.Matrix4();

  return {
    group,
    follow(camera) {
      group.position.copy(camera.position);
    },
    set({ latDeg, lstDeg, sunDir, moon: moonState, night }) {
      visibility.value = night;
      starMesh.visible = glow.visible = night > 0.003;
      sunDirUniform.value.copy(sunDir);
      const phi = latDeg * RAD;
      const lst = lstDeg * RAD;
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i] as Star;
        const H = lst - st.ra;
        const east = -Math.sin(H) * Math.cos(st.dec);
        const upv = Math.sin(phi) * Math.sin(st.dec) + Math.cos(phi) * Math.cos(st.dec) * Math.cos(H);
        const north = Math.cos(phi) * Math.sin(st.dec) - Math.sin(phi) * Math.cos(st.dec) * Math.cos(H);
        p.set(east, upv, -north).multiplyScalar(DOME);
        // brighter stars are larger and stronger; those near the horizon are dimmed by the thick air
        const size = Math.max(14, 70 * 10 ** (-0.15 * st.mag));
        const horizonFade = Math.min(1, Math.max(0, (upv - 0.0) / 0.18));
        const strength = Math.min(5, 8 * 10 ** (-0.32 * (st.mag + 0.5))) * horizonFade;
        lookAtMatrix.lookAt(p, new THREE.Vector3(0, 0, 0), up);
        q.setFromRotationMatrix(lookAtMatrix);
        s.setScalar(size);
        starMesh.setMatrixAt(i, m4.compose(p, q, s));
        starMesh.setColorAt(i, colour.setRGB(st.colour[0] * strength, st.colour[1] * strength, st.colour[2] * strength));
      }
      starMesh.instanceMatrix.needsUpdate = true;
      if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;
      const md = new THREE.Vector3(...moonState.direction);
      moon.position.copy(md).multiplyScalar(DOME * 0.9);
      moon.visible = moonState.elevation > -1;
      halo.position.copy(moon.position).multiplyScalar(0.999);
      halo.lookAt(0, 0, 0);
      halo.visible = moon.visible;
      haloGain.value = 0.05 + 0.2 * moonState.illuminated;
    },
  };
}
