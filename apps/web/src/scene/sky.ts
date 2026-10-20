// Sky, sunlight and image-based light. The sun comes from the real date and time over Pantnagar.

import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import { exp, float, fog as fogNode, max, mix, positionLocal, positionView, smoothstep as tslSmoothstep, uniform, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { moonPosition } from "../core/moon.ts";
import { smoothstep } from "../core/rng.ts";
import { localSiderealDegrees, sunPosition } from "../core/sun.ts";
import { createNightSky, type NightSky } from "./night-sky.ts";

export const PANTNAGAR = { lat: 29.0205, lon: 79.4935 };

export interface Atmosphere {
  sky: SkyMesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** the haze: a gentle exponential fog near the camera and a ramp into the horizon colour far away */
  fog: { density: number; color: THREE.Color };
  /** moves the sun to a time (milliseconds since the epoch) and updates light colours; returns the sun elevation in degrees */
  setTime(utcMs: number): number;
  /** re-bakes the sky into the background cube and the environment map used for ambient light and reflections */
  bakeEnvironment(renderer: THREE.WebGPURenderer): void;
  /** call every frame: slowly refreshes the baked sky (the clouds drift), one cube face per frame */
  update(renderer: THREE.WebGPURenderer, dt: number): void;
  /** how far from the camera the sun casts shadows, in metres; the cascades are re-split to cover it */
  setShadowRange(metres: number): void;
  /** keeps the stars and the moon centred on the camera */
  follow(camera: THREE.Camera): void;
  /** the sun's direction (unit vector, world space) */
  direction: THREE.Vector3;
  /** the direction of the light that is shining: the sun by day, the moon by night */
  lightDirection: THREE.Vector3;
  /** exposure the renderer should use: low in sunlight, higher after dark, as an eye or a camera would adapt */
  exposure: number;
  /** cloud cover (0 to 1) and visibility (metres) from the weather: draws the clouds, dims the sun, thickens the haze */
  setWeather(cloud: number, visibility: number): void;
  /** how much thicker than a clear day the haze should be (1 is clear, 14 is dense fog) */
  readonly hazeFactor: number;
  /** 0 in daylight, 1 when it is properly dark */
  darkness: number;
  nightSky: NightSky;
  /** the baked sky cube (linear radiance, half float); exposed for tests and tools */
  skyCube: THREE.CubeRenderTarget;
}

export function createAtmosphere(scene: THREE.Scene, shadowSize = 1024, cascades = 4): Atmosphere {
  const sky = new SkyMesh();
  sky.scale.setScalar(20000);
  sky.turbidity.value = 3.2;
  sky.rayleigh.value = 1.4;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.8;
  // the sky, with its clouds, is a costly shader: it is drawn into a cube map now and then and the scene shows that
  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  // under a thick overcast the sky is a grey lid rather than the blue Preetham sky: a layer drawn over it, as bright as the
  // daylight (set from the sun in setTime) and a little darker overhead than at the horizon
  const overcastAmount = uniform(0);
  const overcastLight = uniform(1);
  const overcastWarmth = uniform(0);
  const overcastMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  const up = positionLocal.normalize().y.max(0);
  const grey = mix(vec3(6.2, 6.4, 6.8), vec3(3.4, 3.55, 3.9), up.pow(0.6));
  overcastMaterial.colorNode = mix(grey, grey.mul(vec3(1.0, 0.82, 0.66)), overcastWarmth).mul(overcastLight);
  overcastMaterial.opacityNode = overcastAmount;
  const overcast = new THREE.Mesh(new THREE.SphereGeometry(19000, 24, 16), overcastMaterial);
  overcast.renderOrder = 1;
  skyScene.add(overcast);
  const skyCube = new THREE.CubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: false });
  const skyCamera = new THREE.CubeCamera(0.1, 100000, skyCube);
  scene.background = skyCube.texture;

  const sun = new THREE.DirectionalLight(0xfff1dc, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1500;
  // cascaded shadow maps: a small, sharp map near the camera and coarser ones farther out
  const csm = new CSMShadowNode(sun, { cascades, maxFar: 240, mode: "practical", lightMargin: 200 });
  csm.fade = true;
  sun.shadow.shadowNode = csm;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x8a7a62, 0.2);
  scene.add(hemi);

  // the haze is tinted near the camera and takes the exact colour of the sky at the horizon far away, so that the
  // far ground dissolves into the sky without a seam (see readHorizon)
  const hazeDensity = uniform(0.00055);
  const hazeNear = uniform(new THREE.Color(0.1, 0.12, 0.15));
  const hazeFar = uniform(new THREE.Color(0.45, 0.5, 0.56));
  const depth = positionView.z.negate();
  // a clear day's haze reaches half strength; in fog it must close completely
  const hazeStrength = uniform(0.5);
  const gentle = float(1)
    .sub(exp(depth.mul(hazeDensity).pow(2).negate()))
    .mul(hazeStrength);
  const toHorizon = tslSmoothstep(2400, 5800, depth);
  scene.fogNode = fogNode(mix(hazeNear, hazeFar, toHorizon), max(gentle, toHorizon));
  const fog = {
    get density(): number {
      return hazeDensity.value;
    },
    set density(v: number) {
      hazeDensity.value = v;
    },
    color: new THREE.Color(),
  };

  const nightSky = createNightSky();
  scene.add(nightSky.group);

  const direction = new THREE.Vector3(0, 1, 0);
  const lightDirection = new THREE.Vector3(0, 1, 0);
  const dayHemiSky = new THREE.Color(0xcfe0ff);
  const nightHemiSky = new THREE.Color(0x3a4d80);
  const dayHemiGround = new THREE.Color(0x8a7a62);
  const nightHemiGround = new THREE.Color(0x14161d);
  const dayFog = new THREE.Color();
  const nightFog = new THREE.Color(0.025, 0.035, 0.065);
  const moonColour = new THREE.Color(0.62, 0.72, 1.0);
  let envRT: THREE.RenderTarget | null = null;
  let pending: (() => void) | null = null;

  let applyFog: () => void = () => {};
  const foggy = (): number => smoothstep(1.5, 6, state.haze);
  const state = { exposure: 0.45, darkness: 0, cloud: 0.12, haze: 1 };
  let lastUtc = Date.now();
  const setTime = (utcMs: number): number => {
    lastUtc = utcMs;
    const s = sunPosition(utcMs, PANTNAGAR.lat, PANTNAGAR.lon);
    const mp = moonPosition(utcMs, PANTNAGAR.lat, PANTNAGAR.lon);
    direction.set(...s.direction);
    sky.sunPosition.value.copy(direction);
    const el = s.elevation;
    const day = smoothstep(-2, 8, el);
    const warm = smoothstep(2, 35, el);
    const darkness = 1 - smoothstep(-14, -3, el);
    // moonlight: needs the moon up and the sun well down; a full moon is much brighter than a thin crescent
    const moonUp = smoothstep(0, 10, mp.elevation);
    const moonLight = (1 - smoothstep(-6, -2, el)) * moonUp * (0.12 + 0.88 * mp.illuminated ** 1.3);
    if (el > -2) {
      lightDirection.copy(direction);
      sun.color.setRGB(1.0, 0.55 + 0.4 * warm, 0.32 + 0.6 * warm);
      // cloud takes most of the direct sun and leaves a softer, even light
      sun.intensity = 2.0 * day * (0.35 + 0.65 * smoothstep(0, 25, el)) * (1 - 0.82 * state.cloud ** 1.3);
    } else {
      lightDirection.set(...mp.direction);
      sun.color.copy(moonColour);
      sun.intensity = 0.9 * moonLight;
    }
    sun.position.copy(lightDirection).multiplyScalar(1000);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    hemi.color.lerpColors(nightHemiSky, dayHemiSky, day);
    hemi.groundColor.lerpColors(nightHemiGround, dayHemiGround, day);
    hemi.intensity = (0.06 + 0.32 * day) * (1 - 0.12 * state.cloud) + (1 - day) * (0.26 + 0.2 * moonLight);
    // the overcast layer glows only as much as the day does, and warms a little when the sun is low
    overcastLight.value = smoothstep(-8, 12, el) * 0.8 + 0.02;
    overcastWarmth.value = (1 - smoothstep(2, 22, el)) * 0.45 * day;
    // haze colour follows the sky near the horizon, and goes deep blue at night
    dayFog.copy(horizon);
    applyFog = () => {
      fog.color.lerpColors(nightFog, dayFog.copy(horizon), day);
      hazeFar.value.copy(fog.color);
      // near haze is dark on a clear day (it only tints distance) and the full milky colour of the sky in fog
      hazeNear.value.copy(fog.color).multiplyScalar(0.16 + 0.84 * foggy());
    };
    applyFog();
    state.exposure = (0.45 + 1.15 * (1 - smoothstep(-10, 3, el))) * (1 + 0.3 * state.cloud * day);
    state.darkness = darkness;
    nightSky.set({
      latDeg: PANTNAGAR.lat,
      lstDeg: localSiderealDegrees(utcMs, PANTNAGAR.lon),
      sunDir: direction,
      moon: { direction: mp.direction, elevation: mp.elevation, illuminated: mp.illuminated },
      night: darkness,
    });
    pending?.();
    return el;
  };

  // weather: more cloud and a grayer, hazier air; the sky is redrawn by the caller when this changes enough
  const setWeather = (cloud: number, visibility: number): void => {
    state.cloud = cloud;
    state.haze = Math.min(14, Math.max(0.6, 3000 / visibility));
    // coverage runs past 1 so that a fully overcast sky has no gaps, whatever the cloud noise does
    sky.cloudCoverage.value = 0.05 + 1.2 * cloud;
    sky.cloudDensity.value = 0.3 + 0.7 * cloud;
    sky.turbidity.value = 3.2 + 1.2 * cloud + 1.0 * Math.min(10, state.haze);
    sky.mieCoefficient.value = 0.004 + 0.008 * cloud + 0.002 * Math.min(10, state.haze);
    hazeStrength.value = 0.5 + 0.5 * foggy();
    overcastAmount.value = 0.96 * smoothstep(0.3, 0.88, cloud);
    scene.environmentIntensity = 0.4 * (1 - 0.4 * cloud);
    setTime(lastUtc);
  };

  const bakeSkyFace = (renderer: THREE.WebGPURenderer, face: number): void => {
    // CubeCamera.update() orients its six cameras lazily; since each face is drawn on its own, do it here
    if (skyCamera.coordinateSystem !== renderer.coordinateSystem) {
      skyCamera.coordinateSystem = renderer.coordinateSystem;
      skyCamera.updateCoordinateSystem();
    }
    skyCamera.updateMatrixWorld();
    const camera = skyCamera.children[face] as THREE.PerspectiveCamera;
    const target = renderer.getRenderTarget();
    const activeFace = renderer.getActiveCubeFace();
    // the cube holds linear radiance; tone mapping happens once, when the finished frame goes to the screen
    const toneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(skyCube, face);
    renderer.render(skyScene, camera);
    renderer.setRenderTarget(target, activeFace);
    renderer.toneMapping = toneMapping;
  };
  // the haze takes the colour of the sky at the horizon, read back from the baked cube, so that the far ground
  // dissolves into the sky without a seam
  const horizon = new THREE.Color(0.5, 0.55, 0.62);
  let horizonReading = false;
  let horizonStale = false;
  let horizonTries = 0;
  const readHorizon = async (renderer: THREE.WebGPURenderer): Promise<void> => {
    if (horizonReading) {
      horizonStale = true; // the sky changed while a reading was in flight: read again when it ends
      return;
    }
    horizonReading = true;
    try {
      const size = skyCube.width;
      // the four side faces at the horizon row, one azimuth each; the readbacks run together
      const reads = [0, 1, 4, 5].map(
        (face) =>
          Promise.race([
            renderer.readRenderTargetPixelsAsync(skyCube, Math.round(size / 2), Math.round(size / 2), 1, 1, 0, face),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sky readback timed out")), 9000)),
          ]) as Promise<Uint16Array>,
      );
      const sum = new THREE.Color(0, 0, 0);
      for (const px of await Promise.all(reads)) {
        sum.r += THREE.DataUtils.fromHalfFloat(px[0] as number) / 4;
        sum.g += THREE.DataUtils.fromHalfFloat(px[1] as number) / 4;
        sum.b += THREE.DataUtils.fromHalfFloat(px[2] as number) / 4;
      }
      horizon.copy(sum);
      applyFog();
      horizonTries = 0;
    } catch (e) {
      // the first frames can take many seconds while shaders compile, so a late reading is normal: try again soon
      if (horizonTries++ < 8) setTimeout(() => void readHorizon(renderer), 2500);
      else console.warn("horizon colour not read:", e);
    } finally {
      horizonReading = false;
      if (horizonStale) {
        horizonStale = false;
        void readHorizon(renderer);
      }
    }
  };
  let nextFace = 6; // 6 means nothing is being refreshed
  let sinceBake = 0;
  const update = (renderer: THREE.WebGPURenderer, dt: number): void => {
    sinceBake += dt;
    if (nextFace >= 6 && sinceBake > 25) {
      nextFace = 0;
      sinceBake = 0;
    }
    if (nextFace < 6) {
      bakeSkyFace(renderer, nextFace++);
      if (nextFace >= 6) void readHorizon(renderer);
    }
  };

  const bakeEnvironment = (renderer: THREE.WebGPURenderer): void => {
    for (let face = 0; face < 6; face++) bakeSkyFace(renderer, face);
    void readHorizon(renderer);
    sinceBake = 0;
    nextFace = 6;
    const run = () => {
      const pm = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const copy = new SkyMesh();
      copy.scale.setScalar(20000);
      copy.turbidity.value = sky.turbidity.value;
      copy.rayleigh.value = sky.rayleigh.value;
      copy.mieCoefficient.value = sky.mieCoefficient.value;
      copy.mieDirectionalG.value = sky.mieDirectionalG.value;
      copy.cloudCoverage.value = 0; // the clouds themselves are not part of the ambient light, their grey is
      copy.sunPosition.value.copy(direction);
      copy.showSunDisc.value = false; // the sun is a real light; leaving the disc out avoids double lighting
      envScene.add(copy);
      const rt = pm.fromScene(envScene, 0, 0.1, 100000);
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.4 * (1 - 0.4 * state.cloud);
      pm.dispose();
    };
    run();
    pending = null;
  };

  let shadowRange = 240;
  const setShadowRange = (metres: number): void => {
    if (Math.abs(metres - shadowRange) / shadowRange < 0.08) return;
    shadowRange = metres;
    csm.maxFar = metres;
    if (csm.camera) csm.updateFrustums();
  };

  return {
    sky,
    sun,
    hemi,
    fog,
    setTime,
    setWeather,
    get hazeFactor() {
      return state.haze;
    },
    bakeEnvironment,
    update,
    setShadowRange,
    follow: (camera) => nightSky.follow(camera),
    direction,
    lightDirection,
    get exposure() {
      return state.exposure;
    },
    get darkness() {
      return state.darkness;
    },
    nightSky,
    skyCube,
  };
}
