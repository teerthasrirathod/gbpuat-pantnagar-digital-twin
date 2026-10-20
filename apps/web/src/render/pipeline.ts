// The image pipeline: scene colour, normals, depth and velocity in one pass, then ambient occlusion,
// temporal anti-aliasing, bloom and a light grade, all before the renderer's tone mapping.
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { float, mix, mrt, normalView, output, pass, saturation, screenUV, uniform, vec3, velocity } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Gfx } from "./renderer.ts";

/** off: plain MSAA render; medium: bloom and grade; high: also GTAO and temporal anti-aliasing */
export type Quality = "off" | "medium" | "high";

export interface Pipeline {
  quality: Quality;
  /** how strongly the occlusion darkens, 0 to 1 */
  aoStrength: THREE.UniformNode<"float", number>;
  bloomStrength: THREE.UniformNode<"float", number>;
  render(): void;
  /** rebuilds the passes for another quality level */
  setQuality(q: Quality): void;
}

export function createPipeline(gfx: Gfx, scene: THREE.Scene, camera: THREE.PerspectiveCamera, initial: Quality): Pipeline {
  const aoStrength = uniform(0.7);
  const bloomStrength = uniform(0.1);
  let rp: THREE.RenderPipeline | null = null;

  const build = (q: Quality): THREE.RenderPipeline | null => {
    if (q === "off") return null;
    const p = new THREE.RenderPipeline(gfx.renderer);
    const high = q === "high";
    // TRAA needs the pass without MSAA; the medium tier keeps it for clean edges
    const scenePass = pass(scene, camera, { samples: high ? 0 : 4 });
    if (high) scenePass.setMRT(mrt({ output, normal: normalView, velocity }));
    const colour = scenePass.getTextureNode("output");
    let node: any = colour;

    if (high) {
      const depth = scenePass.getTextureNode("depth");
      const normal = scenePass.getTextureNode("normal");
      const g = ao(depth, normal, camera);
      g.resolutionScale = 0.5;
      g.radius.value = 1.4;
      g.thickness.value = 1.2;
      g.samples.value = 12;
      const occlusion = mix(float(1), g.getTextureNode().r, aoStrength);
      node = vec3(colour.rgb.mul(occlusion));
      node = traa(node, depth, scenePass.getTextureNode("velocity"), camera);
    }

    // bloom works on the HDR values; the sky is masked out by its depth because its radiance would veil the whole frame
    const sceneDepth = scenePass.getTextureNode("depth").r;
    const glow = bloom(node.mul(sceneDepth.lessThan(0.99999).toFloat()), 1, 0.5, 1.6);
    glow.strength = bloomStrength;
    node = node.add(glow);

    // a light grade: a touch more colour, and a soft vignette that settles the corners
    node = saturation(node, 1.08);
    const d = screenUV.sub(0.5).length();
    node = node.mul(float(1).sub(d.mul(d).mul(0.35)));
    p.outputNode = node;
    return p;
  };

  const self: Pipeline = {
    quality: initial,
    aoStrength,
    bloomStrength,
    render() {
      if (rp) rp.render();
      else gfx.renderer.render(scene, camera);
    },
    setQuality(q) {
      rp?.dispose?.();
      self.quality = q;
      rp = build(q);
    },
  };
  rp = build(initial);
  return self;
}
