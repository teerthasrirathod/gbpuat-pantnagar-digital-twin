import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { Clock } from "./core/clock.ts";
import { BuildingIndex } from "./core/spatial.ts";
import { istHour, istToUtcMs } from "./core/sun.ts";
import { loadHero } from "./data/hero.ts";
import { OrbitFlyer } from "./nav/fly.ts";
import { createPicker } from "./nav/pick.ts";
import { type Pose, StreetNav } from "./nav/street.ts";
import { Tour } from "./nav/tour.ts";
import { createGovernor } from "./render/governor.ts";
import { createPipeline, type Quality } from "./render/pipeline.ts";
import { createRenderer, resizeToWindow } from "./render/renderer.ts";
import { buildBuildings } from "./scene/buildings.ts";
import { createFarGround } from "./scene/far-ground.ts";
import { createGrass } from "./scene/grass.ts";
import { createGround } from "./scene/ground.ts";
import { buildProps } from "./scene/props.ts";
import { createRain } from "./scene/rain.ts";
import { createSigns } from "./scene/signs.ts";
import { createAtmosphere, PANTNAGAR } from "./scene/sky.ts";
import { buildTrees } from "./scene/trees.ts";
import type { EnvUniforms } from "./scene/types.ts";
import { createJoystick } from "./ui/joystick.ts";
import { createMinimap } from "./ui/minimap.ts";
import { createUI, type Mode, type QualityChoice } from "./ui/ui.ts";
import { PREVIEWS, typicalData } from "./weather/data.ts";
import { WeatherSim } from "./weather/sim.ts";
import { startWeather } from "./weather/source.ts";

interface Params {
  renderer: "auto" | "webgl";
  /** an image quality chosen in the address; otherwise the governor decides */
  quality: Quality | null;
  /** adapt the resolution to the frame rate: on by default, off for automated runs and with #gov=off */
  governor: boolean;
  perf: boolean;
  mode: Mode;
  pose: Pose;
  /** hour in India Standard Time on today's date, or "now" */
  time: number | "now";
  /** a weather situation to show whatever the real weather is, from #wx=rain */
  weather: string | null;
}

/** Reads #street=x,z,heading | #view | #t=10.5 | #t=now | #q=off|medium|high | #gov=on|off | #perf | #renderer=webgl from the address. */
function parseHash(): Params {
  const h = location.hash;
  const num = (s: string | undefined, d: number) => (s === undefined || s === "" || Number.isNaN(Number(s)) ? d : Number(s));
  const street = h.match(/street=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/);
  const t = h.match(/[#&]t=(now|[\d.]+)/);
  return {
    renderer: /renderer=webgl/.test(h) ? "webgl" : "auto",
    perf: /[#&]perf(?:&|$)/.test(h),
    governor: /[#&]gov=on/.test(h) || (!/[#&]gov=off/.test(h) && !navigator.webdriver),
    quality: (h.match(/[#&]q=(off|medium|high)/)?.[1] as Quality | undefined) ?? null,
    mode: /view=/.test(h) ? "orbit" : "street",
    // the default start: the main avenue, looking along it past the Library
    pose: street
      ? { x: num(street[1], -524), z: num(street[2], -83), yaw: num(street[3], -1.22), pitch: -0.03 }
      : { x: -524, z: -83, yaw: -1.22, pitch: -0.03 },
    time: t ? (t[1] === "now" ? "now" : num(t[1], 10.5)) : 10.5,
    weather: ((m) => (m?.[1] && m[1] in PREVIEWS ? m[1] : null))(h.match(/[#&]wx=([a-z]+)/)),
  };
}

function setMessage(text: string | null, progress?: number): void {
  const el = document.getElementById("msg");
  if (!el) return;
  el.hidden = text === null;
  const stage = document.getElementById("stage");
  if (stage) stage.textContent = text ?? "";
  const fill = document.getElementById("barfill");
  if (fill && progress !== undefined) fill.style.width = `${Math.round(progress * 100)}%`;
}

/** Lets the browser paint a message before the next piece of heavy synchronous work. */
const breathe = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function stage(text: string, progress: number): Promise<void> {
  setMessage(text, progress);
  await breathe();
}

async function main(): Promise<void> {
  const params = parseHash();
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  await stage("Starting the graphics", 0.03);

  const maxRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const gfx = await createRenderer(canvas, {
    forceWebGL: params.renderer === "webgl",
    maxPixelRatio: maxRatio,
    trackTimestamp: params.perf,
  });
  await stage("Loading the campus data", 0.1);
  const hero = await loadHero(`${import.meta.env.BASE_URL}data/hero-1.json`);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 6000);
  const wet = uniform(0);
  const wind = uniform(1);
  const env: EnvUniforms = { night: uniform(0), sunDir: uniform(new THREE.Vector3(0, 1, 0)) };

  const pipeline = createPipeline(gfx, scene, camera, params.quality ?? "high");
  const governor = createGovernor({ gfx, pipeline, onResize: () => resizeToWindow(gfx, camera), maxRatio });
  governor.enabled = params.governor && params.quality === null;
  const atm = createAtmosphere(scene);
  const rain = createRain(env);
  scene.add(rain.mesh);
  // the weather: the stored or live data, simulated for the moment and place being shown
  const wxSim = new WeatherSim(typicalData(Date.now()));
  wxSim.preview = params.weather;
  const wxSource = startWeather((d) => wxSim.setData(d));
  let appliedCloud = -1;
  let appliedVisibility = -1;

  // ---- time ----
  const today = new Date();
  const clock = new Clock(
    params.time === "now"
      ? Date.now()
      : istToUtcMs(today.getFullYear(), today.getMonth() + 1, today.getDate(), Math.floor(params.time), Math.round((params.time % 1) * 60)),
  );
  if (params.time === "now") clock.goLive();
  let lastBake = -1e9;
  let needsBake = true;
  let lastClockMs = clock.ms;
  const applyTime = (): void => {
    if (Math.abs(clock.ms - lastClockMs) > 20 * 60_000) wxSim.jump();
    lastClockMs = clock.ms;
    atm.setTime(clock.ms);
    env.night.value = atm.darkness;
    env.sunDir.value.copy(atm.lightDirection);
    gfx.renderer.toneMappingExposure = atm.exposure;
    needsBake = true;
  };
  applyTime();
  atm.bakeEnvironment(gfx.renderer);
  lastBake = performance.now();
  needsBake = false;

  // ---- the world ----
  await stage("Laying the ground and raising the buildings", 0.3);
  const ground = createGround(hero, wet);
  scene.add(ground);
  scene.add(createFarGround(hero, wet));
  const buildings = buildBuildings(hero, wet, env);
  scene.add(buildings.group);
  scene.add(createSigns(hero).group);
  await stage("Planting trees and grass", 0.5);
  const trees = buildTrees(hero, wind);
  scene.add(trees.group);
  const grass = createGrass(hero, ground.userData.splat, wind);
  scene.add(grass.mesh);
  await stage("Placing lamps, vehicles and people", 0.62);
  const props = buildProps(hero, ground.userData.splat, env, wet);
  scene.add(props.group);

  // ---- cameras ----
  const street = new StreetNav(canvas, hero, params.pose);
  const flyer = new OrbitFlyer(hero);
  const orbit = new OrbitControls(camera, canvas);
  const [cx, cz] = [hero.file.window.cx, hero.file.window.cz];
  orbit.target.set(cx, hero.heightAt(cx, cz) + 8, cz);
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.minDistance = 4;
  orbit.maxDistance = 1800;
  camera.position.set(cx + 260, 190, cz + 330);
  orbit.update();
  let mode: Mode = params.mode;
  orbit.enabled = mode === "orbit";
  const setMode = (m: Mode): void => {
    mode = m;
    joystick?.setVisible(m === "street" && !tour.active);
    orbit.enabled = m === "orbit";
    if (m === "orbit") orbit.update();
  };

  // ---- quality and pictures ----
  let qualityChoice: QualityChoice = params.quality ?? "auto";
  const setQuality = (q: QualityChoice): void => {
    qualityChoice = q;
    if (q === "auto") {
      governor.enabled = params.governor || !navigator.webdriver;
    } else {
      governor.enabled = false;
      pipeline.setQuality(q);
      gfx.renderer.setPixelRatio(maxRatio);
      resizeToWindow(gfx, camera);
    }
  };
  let wantShot = false;

  // ---- the tour ----
  const tour = new Tour(hero);
  const stopTour = (): void => {
    if (!tour.active) return;
    tour.stop();
    ui.setCaption(null);
    ui.refreshTour();
    minimap.setVisible(true);
    joystick?.setVisible(mode === "street");
    camera.fov = street.fov;
    camera.updateProjectionMatrix();
    if (mode === "orbit") orbit.update();
  };

  // ---- interface ----
  const index = new BuildingIndex(hero.buildings);
  const picker = createPicker({
    canvas,
    camera,
    scene,
    targets: buildings.group,
    find: (x, z) => index.find(x, z, 0.9),
    onSelect: (b) => ui.showBuilding(b),
  });
  const ui = createUI(document.getElementById("app") as HTMLElement, {
    clock,
    lat: PANTNAGAR.lat,
    lon: PANTNAGAR.lon,
    getMode: () => mode,
    setMode,
    getQuality: () => qualityChoice,
    setQuality,
    screenshot: () => {
      wantShot = true;
    },
    onTime: applyTime,
    onBuildingClosed: () => picker.select(null),
    touring: () => tour.active,
    onTour: () => {
      if (tour.active) {
        stopTour();
        return;
      }
      picker.select(null);
      ui.showBuilding(null);
      tour.start();
      clock.playing = false;
      clock.live = false;
      ui.setCaption(tour.caption);
      ui.refreshTour();
      minimap.setVisible(false);
      joystick?.setVisible(false);
      ui.toast("Guided tour: press G or Esc to stop");
    },
    weather: {
      info: () => ({
        state: wxSim.current,
        kind: wxSim.data.kind,
        fetchedAt: wxSim.data.fetchedAt,
        enabled: wxSim.enabled,
        preview: wxSim.preview,
      }),
      setEnabled: (on) => {
        wxSim.enabled = on;
        wxSim.jump();
      },
      setPreview: (name) => {
        wxSim.preview = name;
        wxSim.jump();
      },
      refresh: () => void wxSource.refresh(),
    },
    sources: hero.file.sources as never,
  });
  const minimap = createMinimap(ui.root, hero, (x, z) => {
    if (tour.active) return;
    if (mode === "street") street.teleport(x, z);
    else {
      orbit.target.set(x, hero.heightAt(x, z) + 8, z);
      orbit.update();
    }
  });
  const joystick = createJoystick(ui.root, (f, s, run) => street.setAxis(f, s, run));
  joystick?.setVisible(mode === "street");
  const cycleQuality = (): void => {
    const order: QualityChoice[] = ["auto", "high", "medium", "off"];
    const next = order[(order.indexOf(qualityChoice) + 1) % order.length] as QualityChoice;
    setQuality(next);
    ui.toast(next === "auto" ? "Quality: automatic" : `Quality: ${next === "off" ? "basic" : next}`);
  };
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT" || (e.target as HTMLElement | null)?.tagName === "SELECT") return;
    if (tour.active && e.code !== "KeyG" && !e.code.startsWith("Shift")) stopTour();
    switch (e.code) {
      case "KeyV":
        setMode(mode === "street" ? "orbit" : "street");
        ui.refreshMode();
        break;
      case "KeyK":
        cycleQuality();
        break;
      case "KeyT":
        clock.playing = false;
        clock.setHour((clock.hour + (e.shiftKey ? 23 : 1)) % 24);
        applyTime();
        ui.refreshTime();
        break;
      case "KeyN":
        clock.goLive();
        applyTime();
        ui.refreshTime();
        break;
      case "Space":
        e.preventDefault();
        clock.live = false;
        clock.playing = !clock.playing;
        ui.refreshTime();
        break;
    }
  });
  window.addEventListener("resize", () => resizeToWindow(gfx, camera));
  resizeToWindow(gfx, camera);
  // compile the shaders now, behind the loading screen, instead of stalling the first frames
  await stage("Compiling shaders (the first time takes a little while)", 0.72);
  try {
    await gfx.renderer.compileAsync(scene, camera);
  } catch (e) {
    console.warn("shader precompile skipped:", e);
  }
  await stage("Almost ready", 0.95);

  // ---- the loop ----
  let last = performance.now();
  let frames = 0;
  let acc = 0;
  let ms = 0;
  let gpuMs = 0;
  let framesShown = 0;
  const loop = (): void => {
    const t = performance.now();
    const real = (t - last) / 1000;
    const dt = Math.min(0.1, real); // simulation step, capped so a stall never teleports the camera
    last = t;
    if (clock.tick(real)) applyTime();
    // the weather for this moment and place, eased: it drives the sky, the light, the haze, wet surfaces, wind and rain
    const w = wxSim.update(real, clock.ms, camera.position.x, camera.position.z);
    if (Math.abs(w.cloud - appliedCloud) > 0.02 || Math.abs(Math.log(w.visibility / Math.max(1, appliedVisibility))) > 0.08) {
      atm.setWeather(w.cloud, w.visibility);
      env.sunDir.value.copy(atm.lightDirection);
      gfx.renderer.toneMappingExposure = atm.exposure;
      if (Math.abs(w.cloud - appliedCloud) > 0.05) needsBake = true; // the sky is drawn again when the clouds have changed
      appliedCloud = w.cloud;
      appliedVisibility = w.visibility;
    }
    wet.value = w.wet;
    wind.value = Math.min(3, Math.max(0.3, 0.35 + w.wind / 18));
    const towards = ((w.windDir + 180) * Math.PI) / 180; // the wind blows from windDir, so the rain drifts the other way
    const drift = (w.wind / 3.6) * 0.6;
    const low = camera.position.y - hero.heightAt(camera.position.x, camera.position.z) < 80; // no rain curtain around a camera high above
    rain.set(low ? Math.min(1, Math.sqrt(Math.max(0, w.rain) / 8)) : 0, Math.sin(towards) * drift, -Math.cos(towards) * drift);
    // the sky is redrawn when time has moved: straight away when stopped, every few seconds while it runs
    if (needsBake && t - lastBake > (clock.playing || clock.live || tour.active ? 2500 : 350)) {
      atm.bakeEnvironment(gfx.renderer);
      lastBake = t;
      needsBake = false;
    }
    if (tour.active) {
      const hour = tour.update(Math.min(real, 0.5), camera); // wall-clock time, so the tour lasts as long on a slow machine
      if (hour === null) {
        stopTour();
        ui.toast("Tour finished");
      } else {
        clock.setHour(hour);
        applyTime();
        ui.setCaption(tour.caption);
        ui.refreshTime();
      }
    } else if (mode === "street") street.update(dt, camera);
    else {
      flyer.update(Math.min(real, 0.3), camera, orbit); // real elapsed time, so the speed does not depend on the frame rate
      orbit.update();
    }
    minimap.update(
      mode === "street" ? street.pose.x : camera.position.x,
      mode === "street" ? street.pose.z : camera.position.z,
      mode === "street" ? street.pose.yaw : Math.atan2(orbit.target.x - camera.position.x, -(orbit.target.z - camera.position.z)),
    );
    // shadows reach 240 m from a walker; from the air they must reach the ground below, a long way off
    atm.setShadowRange(mode === "street" ? 240 : Math.min(1600, Math.max(240, camera.position.distanceTo(orbit.target) * 2.4)));
    // haze thins with height: from the air one looks through less of it
    const above = Math.max(0, camera.position.y - hero.heightAt(camera.position.x, camera.position.z));
    atm.fog.density = 0.00055 * (1 - 0.7 * Math.min(1, above / 700)) * atm.hazeFactor;
    atm.follow(camera);
    props.update(dt);
    grass.update(camera);
    trees.update(camera);
    atm.update(gfx.renderer, dt);
    pipeline.render();
    if (wantShot) {
      wantShot = false;
      // the picture must be taken in the same task as the draw, while the drawing buffer is still valid
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        const when = new Date(clock.ms);
        a.href = URL.createObjectURL(blob);
        a.download = `gbpuat-pantnagar-${when.toISOString().slice(0, 10)}-${String(Math.round(istHour(clock.ms) * 60)).padStart(4, "0")}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        ui.toast("Picture saved");
      }, "image/png");
    }
    if (params.perf && frames % 8 === 0)
      void gfx.renderer.resolveTimestampsAsync("render").then(() => {
        gpuMs = gfx.renderer.info.render.timestamp;
      });
    governor.frame(real);
    if (framesShown < 3 && ++framesShown === 3) setMessage(null);
    acc += real;
    ms += performance.now() - t;
    frames++;
    if (acc > 0.5) {
      const info = gfx.renderer.info;
      ui.update({
        backend: gfx.backend === "webgpu" ? "WebGPU" : "WebGL2",
        tier: pipeline.quality === "off" ? "basic" : pipeline.quality,
        ratio: governor.enabled ? governor.ratio : null,
        fps: frames / acc,
        cpuMs: ms / frames,
        gpuMs: params.perf ? gpuMs : null,
        calls: info.render.calls,
        triangles: info.render.triangles,
        buildings: buildings.count,
        trees: trees.count,
      });
      acc = 0;
      frames = 0;
      ms = 0;
    }
  };
  gfx.renderer.setAnimationLoop(loop);

  // hooks for tests and screenshots
  (window as unknown as { __hero: unknown }).__hero = {
    THREE,
    gfx,
    pipeline,
    governor,
    scene,
    camera,
    street,
    orbit,
    hero,
    clock,
    picker,
    ui,
    setTime: (utcMs: number) => {
      clock.live = false;
      clock.playing = false;
      clock.ms = utcMs;
      applyTime();
      atm.bakeEnvironment(gfx.renderer);
      lastBake = performance.now();
      needsBake = false;
      ui.refreshTime();
    },
    setMode: (m: Mode) => {
      setMode(m);
      ui.refreshMode();
    },
    props,
    grass,
    wet,
    wind,
    atm,
    wx: wxSim,
    tour,
    minimap,
    flyer,
    wxSource,
    rain,
  };
}

main().catch((e) => {
  console.error(e);
  setMessage(`Could not start the 3D view: ${e instanceof Error ? e.message : String(e)}`);
});
