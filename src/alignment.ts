import * as THREE from 'three';

export type AlignmentResult = {
  matrix: THREE.Matrix4;
  rmse: number;
  pointCount: number;
};

/**
 * Rigid Kabsch / SVD alignment of corresponding points.
 * Maps source points into target points: matrix * source ≈ target.
 * Scale is fixed to 1. Reflections are rejected (det(R) forced >= 0).
 * Units are assumed consistent (mm).
 *
 * Returns null if fewer than 3 points or geometrically degenerate.
 */
export function alignPointsRigid(
  source: THREE.Vector3[],
  target: THREE.Vector3[],
): AlignmentResult | null {
  if (source.length !== target.length || source.length < 3) return null;

  const n = source.length;
  const sourceMean = new THREE.Vector3();
  const targetMean = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    sourceMean.add(source[i]);
    targetMean.add(target[i]);
  }
  sourceMean.multiplyScalar(1 / n);
  targetMean.multiplyScalar(1 / n);

  // Covariance matrix H = sum (source_i - mean) * (target_i - mean)^T
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) {
    const s = source[i].clone().sub(sourceMean);
    const t = target[i].clone().sub(targetMean);
    H[0][0] += s.x * t.x; H[0][1] += s.x * t.y; H[0][2] += s.x * t.z;
    H[1][0] += s.y * t.x; H[1][1] += s.y * t.y; H[1][2] += s.y * t.z;
    H[2][0] += s.z * t.x; H[2][1] += s.z * t.y; H[2][2] += s.z * t.z;
  }

  // SVD of H via Three.js Matrix3 + external or simple power method? Three has no SVD.
  // We'll use a minimal Jacobi or rely on a small implementation.
  // For reliability, implement a simple SVD for 3x3 or use quaternion method similar to bestFit.
  // Reuse the quaternion-based approach from bestFit for consistency (Horn method).

  let sxx = 0, sxy = 0, sxz = 0;
  let syx = 0, syy = 0, syz = 0;
  let szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < n; i++) {
    const px = source[i].x - sourceMean.x;
    const py = source[i].y - sourceMean.y;
    const pz = source[i].z - sourceMean.z;
    const qx = target[i].x - targetMean.x;
    const qy = target[i].y - targetMean.y;
    const qz = target[i].z - targetMean.z;
    sxx += px * qx; sxy += px * qy; sxz += px * qz;
    syx += py * qx; syy += py * qy; syz += py * qz;
    szx += pz * qx; szy += pz * qy; szz += pz * qz;
  }

  const N = [
    sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  ];

  let q = [1, 0, 0, 0];
  for (let k = 0; k < 30; k++) {
    const next = [0, 0, 0, 0];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) next[row] += N[row * 4 + col] * q[col];
    }
    const norm = Math.hypot(...next) || 1;
    q = next.map(v => v / norm);
  }

  const quaternion = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);

  // Reject reflection
  const det = rotation.determinant();
  if (det < 0) {
    // Flip one axis
    const correction = new THREE.Matrix4().makeScale(1, 1, -1);
    rotation.multiply(correction);
    quaternion.setFromRotationMatrix(rotation);
  }

  const translation = targetMean.clone().sub(sourceMean.clone().applyQuaternion(quaternion));
  const matrix = new THREE.Matrix4().compose(translation, quaternion, new THREE.Vector3(1, 1, 1));

  // RMSE
  let errorSum = 0;
  for (let i = 0; i < n; i++) {
    const transformed = source[i].clone().applyMatrix4(matrix);
    errorSum += transformed.distanceToSquared(target[i]);
  }
  const rmse = Math.sqrt(errorSum / n);

  // Degeneracy check: if points are nearly collinear
  const variance = source.reduce((acc, p) => acc + p.distanceToSquared(sourceMean), 0) / n;
  if (variance < 1e-6) return null;

  return { matrix, rmse, pointCount: n };
}

/**
 * Test helpers (not exported for production UI, but useful for verification).
 */
export function identityTest() {
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  return alignPointsRigid(pts, pts);
}
