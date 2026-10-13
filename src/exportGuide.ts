import * as THREE from 'three';

/** Stable name of the printable guide body mesh inside guide-frame. */
export const GUIDE_BODY_NAME = 'guide-body';

/**
 * Find the guide body mesh by stable name.
 * Falls back to the single Mesh child only if exactly one exists (legacy scenes).
 * Does not select bur, stopper, or line visuals.
 */
export function findGuideBody(frame: THREE.Object3D): THREE.Mesh | null {
  const named = frame.getObjectByName(GUIDE_BODY_NAME);
  if (named instanceof THREE.Mesh && named.geometry) return named;

  const meshes: THREE.Mesh[] = [];
  for (const child of frame.children) {
    if (child instanceof THREE.Mesh && child.geometry && child.name !== 'bur' && child.name !== 'stopper') {
      meshes.push(child);
    }
  }
  return meshes.length === 1 ? meshes[0] : null;
}

/**
 * Prepare a clone of the guide body geometry in world coordinates for STL export.
 * - Updates world matrices of the body.
 * - Clones geometry (does not mutate the scene geometry).
 * - Applies matrixWorld exactly once.
 * - Returns null if coordinates are non-finite or geometry is empty.
 */
export function prepareGuideGeometryForExport(body: THREE.Mesh): THREE.BufferGeometry | null {
  body.updateMatrixWorld(true);
  const geometry = body.geometry.clone();
  geometry.applyMatrix4(body.matrixWorld);

  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) {
    geometry.dispose();
    return null;
  }
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      geometry.dispose();
      return null;
    }
  }
  return geometry;
}

/** Triangle count of an indexed or non-indexed BufferGeometry. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const pos = geometry.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Snapshot of original local positions for mutation checks.
 */
export function snapshotPositions(geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.getAttribute('position');
  return new Float32Array(pos.array as ArrayLike<number>);
}
