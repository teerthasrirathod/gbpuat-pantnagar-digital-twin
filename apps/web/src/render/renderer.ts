import * as THREE from "three/webgpu";

export type Backend = "webgpu" | "webgl2";

export interface Gfx {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
}

export interface RendererOptions {
  /** use the WebGL2 backend even where WebGPU exists (also the automatic fallback) */
  forceWebGL: boolean;
  /** cap on the device pixel ratio; a base M1 is fill-rate bound, so 1.5 is a sensible ceiling */
  maxPixelRatio: number;
  /** ask the GPU for pass timings (shows as GPU ms in the HUD); costs a little, for development */
  trackTimestamp?: boolean;
}

/** Creates the renderer and waits for the backend, which is WebGPU where available and WebGL2 otherwise. */
export async function createRenderer(canvas: HTMLCanvasElement, opts: RendererOptions): Promise<Gfx> {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: opts.forceWebGL,
    powerPreference: "high-performance",
    trackTimestamp: opts.trackTimestamp === true,
  });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.45; // photographic exposure compensation: the physical sky is far brighter than the lights
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
  return { renderer, backend };
}

export function resizeToWindow(gfx: Gfx, camera: THREE.PerspectiveCamera): void {
  gfx.renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
