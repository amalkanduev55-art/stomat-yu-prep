import * as THREE from 'three';

/**
 * Orientation of an imported jaw scan into the workspace axes. Rotation only: no scale, no shift.
 *
 * Scan convention (checked on test-data/lower.stl): arch plane XY, occlusal side +Z, anterior teeth +Y.
 * Workspace convention (geometry.ts): arch plane XZ, occlusal side +Y, anterior teeth +Z.
 *
 * X −90° alone maps occlusal +Z → +Y but sends the anterior teeth +Y → −Z (front and back swapped).
 * X +90° keeps the anterior teeth in front but turns the scan upside down (+Z → −Y).
 * Only X −90° followed by Y 180° gives both: +Z → +Y, +Y → +Z, X → −X (proper rotation, det = +1).
 */
export function scanToWorkspaceRotation() {
  return new THREE.Matrix4()
    .makeRotationY(Math.PI)
    .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
}

/** Applies `rotation` about the geometry's own bounding-box center, so the center stays where it was. */
export function rotateAboutBoundsCenter(geometry: THREE.BufferGeometry, rotation: THREE.Matrix4) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  return new THREE.Matrix4()
    .makeTranslation(center.x, center.y, center.z)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}
