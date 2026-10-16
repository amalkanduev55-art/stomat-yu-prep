import * as THREE from 'three';
import { crownGeometry, toothIds, toothPosition } from './geometry';
import { scanToWorkspaceRotation } from './scanOrientation';

/** Bounds of the built-in tooth arch only. Surgical guide, bur slots and drill are intentionally excluded. */
export function getDemoToothArchBounds() {
  const bounds = new THREE.Box3();
  toothIds.forEach((_, index) => {
    const geometry = crownGeometry(index);
    geometry.computeBoundingBox();
    const position = toothPosition(index);
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (index - 6.5) * .215, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    if (geometry.boundingBox) bounds.union(geometry.boundingBox.clone().applyMatrix4(transform));
    geometry.dispose();
  });
  return bounds;
}

/**
 * Visual fit of an XY-oriented imported scan to the built-in tooth arch.
 * Rotate XY into XZ (scanToWorkspaceRotation), fit the arch footprint in X/Z, preserve the scan's thickness
 * (Y after rotation), then translate its bounding-box center to the target center.
 * This deliberately avoids Y scaling, which can flatten tooth/gingiva volume.
 * It is a visual fit, not anatomical registration; X/Z scaling can still distort anatomy.
 */
export function fitScanToDemoToothArch(source: THREE.BufferGeometry) {
  if (!source.boundingBox) source.computeBoundingBox();
  const sourceBounds = source.boundingBox;
  if (!sourceBounds || sourceBounds.isEmpty()) throw new Error('Не удалось определить габариты STL');

  const targetBounds = getDemoToothArchBounds();
  // Same orientation as on import: XY arch plane → XZ, occlusal up, anterior teeth in front.
  const rotation = scanToWorkspaceRotation();
  const rotatedBounds = sourceBounds.clone().applyMatrix4(rotation);
  const sourceSize = rotatedBounds.getSize(new THREE.Vector3());
  const targetSize = targetBounds.getSize(new THREE.Vector3());
  if ([sourceSize.x, sourceSize.y, sourceSize.z, targetSize.x, targetSize.z].some(v => v < 1e-6)) {
    throw new Error('У STL или встроенного зубного ряда слишком малый размер по одной из осей');
  }

  // Match the arch footprint only. Preserve vertical thickness after rotation.
  const scale = new THREE.Vector3(
    targetSize.x / sourceSize.x,
    1,
    targetSize.z / sourceSize.z,
  );
  const sourceCenter = rotatedBounds.getCenter(new THREE.Vector3());
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());
  const matrix = new THREE.Matrix4()
    .makeTranslation(targetCenter.x, targetCenter.y, targetCenter.z)
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .multiply(new THREE.Matrix4().makeTranslation(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z))
    .multiply(rotation);

  return {
    matrix,
    scale,
    sourceBounds: sourceBounds.clone(),
    targetBounds,
  };
}
