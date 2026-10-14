import * as THREE from 'three';

/**
 * Registration coordinate contract:
 * - scan points are stored in scan/world coordinates; the scan never moves.
 * - guide points are stored in guide-local coordinates, independent of current pose.
 * - the fitted rigid matrix maps guide-local points to scan/world points.
 */
function isFiniteVec(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isUsableMatrix(m: THREE.Matrix4): boolean {
  if (!m.elements.every(Number.isFinite)) return false;
  const determinant = m.determinant();
  return Number.isFinite(determinant) && Math.abs(determinant) > 1e-12;
}

export function scanPointFromWorld(world: THREE.Vector3): THREE.Vector3 | null {
  return isFiniteVec(world) ? world.clone() : null;
}

export function worldToGuideLocal(
  world: THREE.Vector3,
  guideMatrixWorld: THREE.Matrix4,
): THREE.Vector3 | null {
  if (!isFiniteVec(world) || !isUsableMatrix(guideMatrixWorld)) return null;
  const local = world.clone().applyMatrix4(guideMatrixWorld.clone().invert());
  return isFiniteVec(local) ? local : null;
}

export function guideLocalToWorld(
  local: THREE.Vector3,
  guideMatrixWorld: THREE.Matrix4,
): THREE.Vector3 {
  return local.clone().applyMatrix4(guideMatrixWorld);
}

export function guideMarkersToWorld(
  localPoints: THREE.Vector3[],
  guideMatrixWorld: THREE.Matrix4,
): THREE.Vector3[] {
  return localPoints.map(point => guideLocalToWorld(point, guideMatrixWorld));
}
