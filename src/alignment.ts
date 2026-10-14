import * as THREE from 'three';

export type AlignmentPoint = { guide: THREE.Vector3; scan: THREE.Vector3 };

export type AlignmentResult = {
  matrix: THREE.Matrix4;
  rmse: number;
  points: number;
};

function centroid(points: THREE.Vector3[]) {
  const result = new THREE.Vector3();
  for (const point of points) result.add(point);
  return result.multiplyScalar(1 / points.length);
}

/**
 * Least-squares rigid registration of manually corresponding points.
 * The returned matrix maps guide coordinates -> scan coordinates.
 * Rotation + translation only; no scale.
 */
export function rigidAlignment(points: AlignmentPoint[]): AlignmentResult | null {
  if (points.length < 3) return null;

  const guide = points.map(point => point.guide);
  const scan = points.map(point => point.scan);
  const guideMean = centroid(guide);
  const scanMean = centroid(scan);

  const centeredGuide = guide.map(point => point.clone().sub(guideMean));
  const centeredScan = scan.map(point => point.clone().sub(scanMean));

  let covariance = 0;
  for (const point of centeredGuide) covariance += point.lengthSq();
  if (covariance < 1e-10) return null;

  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < points.length; i += 1) {
    const p = centeredGuide[i];
    const q = centeredScan[i];
    a[0][0] += p.x * q.x; a[0][1] += p.x * q.y; a[0][2] += p.x * q.z;
    a[1][0] += p.y * q.x; a[1][1] += p.y * q.y; a[1][2] += p.y * q.z;
    a[2][0] += p.z * q.x; a[2][1] += p.z * q.y; a[2][2] += p.z * q.z;
  }

  const n = [
    a[0][0] + a[1][1] + a[2][2], a[1][2] - a[2][1], a[2][0] - a[0][2], a[0][1] - a[1][0],
    a[1][2] - a[2][1], a[0][0] - a[1][1] - a[2][2], a[0][1] + a[1][0], a[2][0] + a[0][2],
    a[2][0] - a[0][2], a[0][1] + a[1][0], -a[0][0] + a[1][1] - a[2][2], a[1][2] + a[2][1],
    a[0][1] - a[1][0], a[2][0] + a[0][2], a[1][2] + a[2][1], -a[0][0] - a[1][1] + a[2][2],
  ];

  let eigen = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const next = [0, 0, 0, 0];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) next[row] += n[row * 4 + col] * eigen[col];
    }
    const norm = Math.hypot(...next);
    if (norm < 1e-12) return null;
    eigen = next.map(value => value / norm);
  }

  const quaternion = new THREE.Quaternion(eigen[1], eigen[2], eigen[3], eigen[0]).normalize();
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
  const translation = scanMean.clone().sub(guideMean.clone().applyQuaternion(quaternion));
  const matrix = rotation.setPosition(translation);

  let error = 0;
  for (const point of points) {
    const predicted = point.guide.clone().applyMatrix4(matrix);
    error += predicted.distanceToSquared(point.scan);
  }

  return { matrix, rmse: Math.sqrt(error / points.length), points: points.length };
}
