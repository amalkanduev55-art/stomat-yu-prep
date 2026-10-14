import * as THREE from 'three';

export type LandmarkPair = {
  /** Point selected on the model that will be moved. */
  source: THREE.Vector3;
  /** Corresponding point in the reference coordinate system. */
  target: THREE.Vector3;
};

export type LandmarkAlignment = {
  matrix: THREE.Matrix4;
  rmsError: number;
  maxError: number;
  pointErrors: number[];
};

/**
 * Builds a rigid transform from three or more corresponding landmarks.
 * No scale or reflection is allowed. The first three non-collinear pairs define
 * the frame; remaining pairs are used to report fit error, not to hide a bad fit.
 *
 * This is a deterministic landmark-frame MVP, not a clinical registration solver.
 */
export function alignByLandmarkFrame(
  pairs: LandmarkPair[],
  minimumBaseline = 0.5,
): LandmarkAlignment | null {
  if (pairs.length < 3) return null;
  const [a, b, c] = pairs;
  const sourceX = b.source.clone().sub(a.source);
  const sourceZ = new THREE.Vector3().crossVectors(sourceX, c.source.clone().sub(a.source));
  const targetX = b.target.clone().sub(a.target);
  const targetZ = new THREE.Vector3().crossVectors(targetX, c.target.clone().sub(a.target));

  if (
    sourceX.length() < minimumBaseline ||
    targetX.length() < minimumBaseline ||
    sourceZ.length() < minimumBaseline ||
    targetZ.length() < minimumBaseline
  ) return null;

  sourceX.normalize();
  sourceZ.normalize();
  const sourceY = new THREE.Vector3().crossVectors(sourceZ, sourceX).normalize();
  targetX.normalize();
  targetZ.normalize();
  const targetY = new THREE.Vector3().crossVectors(targetZ, targetX).normalize();

  const sourceBasis = new THREE.Matrix4().makeBasis(sourceX, sourceY, sourceZ);
  const targetBasis = new THREE.Matrix4().makeBasis(targetX, targetY, targetZ);
  const rotation = targetBasis.multiply(sourceBasis.clone().invert());
  const translation = a.target.clone().sub(a.source.clone().applyMatrix4(rotation));
  rotation.setPosition(translation);

  const pointErrors = pairs.map(pair =>
    pair.source.clone().applyMatrix4(rotation).distanceTo(pair.target),
  );
  const rmsError = Math.sqrt(pointErrors.reduce((sum, error) => sum + error * error, 0) / pointErrors.length);
  return { matrix: rotation, rmsError, maxError: Math.max(...pointErrors), pointErrors };
}

/** Returns finite bounds for an imported mesh without changing its vertices. */
export function getMeshCoordinateReport(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const finite = [size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite);
  if (!finite || size.length() <= 0) return null;
  return {
    size: [size.x, size.y, size.z] as [number, number, number],
    center: [center.x, center.y, center.z] as [number, number, number],
    diagonal: size.length(),
  };
}
