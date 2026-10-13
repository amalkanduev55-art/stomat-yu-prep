import * as THREE from 'three';

export type AlignmentResult = {
  matrix: THREE.Matrix4;
  rmse: number;
  pointCount: number;
};

/**
 * Rigid Horn (quaternion) alignment of corresponding points.
 * Maps source points into target points: matrix * source ≈ target.
 * Scale is fixed to 1. Reflections are rejected (largest eigenvalue of N
 * corresponds to a proper rotation; we additionally verify det ≈ +1).
 * Units are assumed consistent (mm).
 *
 * Algorithm: Horn 1987 — optimal quaternion from the 4×4 symmetric matrix N
 * built from the covariance of centered point pairs. The quaternion is the
 * eigenvector belonging to the largest eigenvalue of N.
 *
 * Returns null if fewer than 3 points, non-finite coordinates,
 * or geometrically degenerate configuration.
 */
export function alignPointsRigid(
  source: THREE.Vector3[],
  target: THREE.Vector3[],
): AlignmentResult | null {
  if (!source || !target || source.length !== target.length || source.length < 3) return null;

  for (let i = 0; i < source.length; i++) {
    if (!isFiniteVec(source[i]) || !isFiniteVec(target[i])) return null;
  }

  const n = source.length;
  const sourceMean = new THREE.Vector3();
  const targetMean = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    sourceMean.add(source[i]);
    targetMean.add(target[i]);
  }
  sourceMean.multiplyScalar(1 / n);
  targetMean.multiplyScalar(1 / n);

  const sCentered: THREE.Vector3[] = [];
  const tCentered: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    sCentered.push(source[i].clone().sub(sourceMean));
    tCentered.push(target[i].clone().sub(targetMean));
  }

  if (!hasSufficientSpan(sCentered)) return null;

  // Covariance sums for Horn matrix N
  let sxx = 0, sxy = 0, sxz = 0;
  let syx = 0, syy = 0, syz = 0;
  let szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < n; i++) {
    const px = sCentered[i].x, py = sCentered[i].y, pz = sCentered[i].z;
    const qx = tCentered[i].x, qy = tCentered[i].y, qz = tCentered[i].z;
    sxx += px * qx; sxy += px * qy; sxz += px * qz;
    syx += py * qx; syy += py * qy; syz += py * qz;
    szx += pz * qx; szy += pz * qy; szz += pz * qz;
  }

  // Horn 4×4 matrix N (symmetric)
  const N = [
    sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  ];

  const q = largestEigenvector4(N);
  if (!q) return null;

  const quaternion = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);

  // Reject reflection
  if (rotation.determinant() < 0.5) return null;

  const translation = targetMean.clone().sub(sourceMean.clone().applyQuaternion(quaternion));
  const matrix = new THREE.Matrix4().compose(translation, quaternion, new THREE.Vector3(1, 1, 1));

  // RMSE
  let errorSum = 0;
  for (let i = 0; i < n; i++) {
    const transformed = source[i].clone().applyMatrix4(matrix);
    errorSum += transformed.distanceToSquared(target[i]);
  }
  const rmse = Math.sqrt(errorSum / n);
  if (!Number.isFinite(rmse)) return null;

  return { matrix, rmse, pointCount: n };
}

function isFiniteVec(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function hasSufficientSpan(centered: THREE.Vector3[]): boolean {
  if (centered.length < 3) return false;
  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
  for (const p of centered) {
    sxx += p.x * p.x; syy += p.y * p.y; szz += p.z * p.z;
    sxy += p.x * p.y; sxz += p.x * p.z; syz += p.y * p.z;
  }
  const nn = centered.length;
  const trace = (sxx + syy + szz) / nn;
  if (trace < 1e-8) return false;
  const cov = [
    sxx / nn, sxy / nn, sxz / nn,
    sxy / nn, syy / nn, syz / nn,
    sxz / nn, syz / nn, szz / nn,
  ];
  const det = cov[0] * (cov[4] * cov[8] - cov[5] * cov[7]) -
              cov[1] * (cov[3] * cov[8] - cov[5] * cov[6]) +
              cov[2] * (cov[3] * cov[7] - cov[4] * cov[6]);
  return Math.abs(det) > Math.pow(trace, 3) * 1e-8;
}

/**
 * Power iteration with occasional random restarts to find the dominant eigenvector of a 4×4 symmetric matrix.
 * Sufficient for the Horn matrix when points are non-degenerate.
 */
function largestEigenvector4(N: number[]): number[] | null {
  let bestQ: number[] | null = null;
  let bestLambda = -Infinity;

  // Try a few starting vectors
  const starts = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0.5, 0.5, 0.5, 0.5],
  ];

  for (const start of starts) {
    let q = start.slice();
    for (let iter = 0; iter < 40; iter++) {
      const next = [0, 0, 0, 0];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) next[row] += N[row * 4 + col] * q[col];
      }
      const norm = Math.hypot(...next) || 1;
      q = next.map(v => v / norm);
    }
    // Rayleigh quotient
    let lambda = 0;
    const nq = [0, 0, 0, 0];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) nq[row] += N[row * 4 + col] * q[col];
    }
    for (let i = 0; i < 4; i++) lambda += q[i] * nq[i];
    if (lambda > bestLambda) {
      bestLambda = lambda;
      bestQ = q;
    }
  }

  if (!bestQ || !Number.isFinite(bestLambda)) return null;
  return bestQ;
}
