import * as THREE from 'three';

/**
 * Convert GoldSrc Z-Up coordinates (gx, gy, gz) to Three.js Y-Up Vector3 (gx, gz, -gy).
 * Orientation-preserving transform (det = +1):
 *   +X = Forward (yaw = 0), +Y = Left (yaw = +90°), +Z = Up
 */
export function gsToThree(
  gx: number,
  gy: number,
  gz: number,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  return out.set(gx, gz, -gy);
}
