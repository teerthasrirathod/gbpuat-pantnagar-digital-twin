import type * as THREE from "three/webgpu";

/** A float uniform that can be changed from outside a shader: wetness, wind strength. */
export type FloatUniform = THREE.UniformNode<"float", number>;
export type Vec3Uniform = THREE.UniformNode<"vec3", THREE.Vector3>;

/** What the sky tells the materials: how dark it is (lit windows) and where the sun is (shadows inside window recesses). */
export interface EnvUniforms {
  /** 0 in daylight, 1 once the sun is well below the horizon */
  night: FloatUniform;
  /** unit vector toward the sun in world space */
  sunDir: Vec3Uniform;
}
