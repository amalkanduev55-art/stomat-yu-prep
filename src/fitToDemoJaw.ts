import * as THREE from 'three';
import { crownGeometry, toothIds, toothPosition } from './geometry';

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
 * Force-fit an XY-oriented scan into the built-in tooth arch envelope.
 * Rotates source XY plane to target XZ plane, scales the arch footprint in X/Z,
 * and preserves Y thickness after rotation to avoid flattening the scan. X/Z scaling
 * may still distort anatomy and this is only a visual fit, not anatomical registration.
 */
export function fitScanToDemoToothArch(source: THREE.BufferGeometry) {
  if (!source.boundingBox) source.computeBoundingBox();
  const sourceBounds = source.boundingBox;
  if (!sourceBounds || sourceBounds.isEmpty()) throw new Error('Не удалось определить габариты STL');
  const targetBounds = getDemoToothArchBounds();
  // For this scan convention, -90° keeps the occlusal surface above the jaw base.
  // +90° inverted the vertical anatomy and made the lower jaw look like an upper jaw.
  const rotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const rotatedBounds = sourceBounds.clone().applyMatrix4(rotation);
  const sourceSize = rotatedBounds.getSize(new THREE.Vector3());
  const targetSize = targetBounds.getSize(new THREE.Vector3());
  if ([sourceSize.x, sourceSize.y, sourceSize.z].some(v => v < 1e-6)) {
    throw new Error('У STL слишком малый размер по одной из осей');
  }
  // Match the arch footprint in X/Z but preserve the scan's vertical thickness
  // after XY -> XZ rotation. Independent Y scaling was flattening the anatomy.
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
  return { matrix, scale, sourceBounds: sourceBounds.clone(), targetBounds, rotationRadians: -Math.PI / 2 };
}
