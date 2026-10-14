import * as THREE from 'three';

export type AlignmentResult = {
  matrix: THREE.Matrix4;
  rmse: number;
  pointCount: number;
};

/**
 * Rigid Horn (quaternion) alignment of corresponding points.
 * Maps source points into target points: matrix * source ≈ target.
 * Scale is fixed to 1. Reflections are rejected.
 * Units are assumed consistent (mm).
 *
 * Algorithm: Horn 1987 — optimal quaternion from the 4×4 symmetric matrix N
 * built from the covariance of centered point pairs. The quaternion is the
 * eigenvector belonging to the largest algebraic eigenvalue of N.
 *
 * Returns null if fewer than 3 points, non-finite coordinates,
 * or geometrically degenerate configuration (collinear / near-collinear).
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

  // Geometric rank / condition check: require at least rank-2 span (non-collinear)
  // Scale-independent relative tolerance on the second eigenvalue.
  if (!hasSufficientGeometricRank(sCentered) || !hasSufficientGeometricRank(tCentered)) return null;

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

  // Normalize quaternion (w, x, y, z)
  const norm = Math.hypot(q[0], q[1], q[2], q[3]);
  if (norm < 1e-12) return null;
  const qw = q[0] / norm, qx = q[1] / norm, qy = q[2] / norm, qz = q[3] / norm;

  const quaternion = new THREE.Quaternion(qx, qy, qz, qw).normalize();
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);

  // Reject reflection (proper rotation required)
  const det = rotation.determinant();
  if (det < 0.5) return null;

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

/**
 * Checks that the centered points span at least a 2-dimensional space
 * with a reasonable condition number (not collinear / near-collinear).
 * Uses relative eigenvalue ratio — independent of absolute coordinate scale.
 * Tolerance is chosen relative to double-precision practical limits for geometric rank.
 */
function hasSufficientGeometricRank(centered: THREE.Vector3[], relativeTol = 1e-6): boolean {
  if (centered.length < 3) return false;

  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
  for (const p of centered) {
    sxx += p.x * p.x;
    syy += p.y * p.y;
    szz += p.z * p.z;
    sxy += p.x * p.y;
    sxz += p.x * p.z;
    syz += p.y * p.z;
  }
  const nn = centered.length;
  const C = [
    sxx / nn, sxy / nn, sxz / nn,
    sxy / nn, syy / nn, syz / nn,
    sxz / nn, syz / nn, szz / nn,
  ];

  const evals = eigenvaluesSymmetric3x3(C);
  evals.sort((a, b) => b - a); // descending
  const lambda1 = evals[0];
  const lambda2 = evals[1];

  if (!(lambda1 > 0) || !Number.isFinite(lambda1)) return false;
  return lambda2 > relativeTol * lambda1;
}

/** Analytic eigenvalues of a 3×3 symmetric matrix (given as row-major flat array). */
function eigenvaluesSymmetric3x3(m: number[]): number[] {
  // Use Jacobi for robustness and consistency
  const { eigenvalues } = jacobiEigenSymmetric3(m);
  return eigenvalues;
}

/**
 * Jacobi eigenvalue algorithm for 3×3 symmetric matrix.
 * Returns eigenvalues and eigenvectors (columns of V).
 */
function jacobiEigenSymmetric3(m: number[]): { eigenvalues: number[]; eigenvectors: number[] } {
  // Copy into a
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // identity

  const maxSweeps = 20;
  const relEps = 1e-12;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Scale from all elements (handles zero diagonals with non-zero off-diagonals)
    let scale = 0;
    for (let i = 0; i < 9; i++) {
      const v = Math.abs(a[i]);
      if (Number.isFinite(v) && v > scale) scale = v;
    }
    if (scale === 0 || !Number.isFinite(scale)) break; // zero / invalid matrix

    let maxOff = 0;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = Math.abs(a[p * 3 + q]);
        if (apq > maxOff) maxOff = apq;
      }
    }
    if (maxOff < relEps * scale) break;

    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const app = a[p * 3 + p];
        const aqq = a[q * 3 + q];
        const apq = a[p * 3 + q];
        // Skip only if negligible relative to overall matrix scale (scale-invariant)
        if (Math.abs(apq) < relEps * scale) continue;

        const tau = (aqq - app) / (2 * apq);
        // Stable Jacobi t: when tau===0 yields t=1 (45° rotation), avoids Math.sign(0)=0
        let t;
        if (tau >= 0) {
          t = 1.0 / (tau + Math.sqrt(1 + tau * tau));
        } else {
          t = -1.0 / (-tau + Math.sqrt(1 + tau * tau));
        }
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        // Update a
        a[p * 3 + p] = app - t * apq;
        a[q * 3 + q] = aqq + t * apq;
        a[p * 3 + q] = a[q * 3 + p] = 0;

        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = a[r * 3 + p];
            const arq = a[r * 3 + q];
            a[r * 3 + p] = a[p * 3 + r] = c * arp - s * arq;
            a[r * 3 + q] = a[q * 3 + r] = s * arp + c * arq;
          }
        }

        // Update V
        for (let r = 0; r < 3; r++) {
          const vrp = v[r * 3 + p];
          const vrq = v[r * 3 + q];
          v[r * 3 + p] = c * vrp - s * vrq;
          v[r * 3 + q] = s * vrp + c * vrq;
        }
      }
    }
  }

  return {
    eigenvalues: [a[0], a[4], a[8]],
    eigenvectors: v,
  };
}

/**
 * Deterministic Jacobi method for the largest algebraic eigenvector of a 4×4 symmetric matrix.
 * Replaces the previous power-iteration with random restarts.
 */
function largestEigenvector4(N: number[]): number[] | null {
  const { eigenvalues, eigenvectors } = jacobiEigenSymmetric4(N);
  let maxIdx = 0;
  let maxVal = eigenvalues[0];
  for (let i = 1; i < 4; i++) {
    if (eigenvalues[i] > maxVal) {
      maxVal = eigenvalues[i];
      maxIdx = i;
    }
  }
  if (!Number.isFinite(maxVal)) return null;

  // Eigenvector is column maxIdx of V (row-major stored)
  const q = [
    eigenvectors[0 * 4 + maxIdx],
    eigenvectors[1 * 4 + maxIdx],
    eigenvectors[2 * 4 + maxIdx],
    eigenvectors[3 * 4 + maxIdx],
  ];
  return q;
}

/**
 * Classical Jacobi eigenvalue algorithm for 4×4 symmetric matrices.
 * Deterministic, no random starts. Returns eigenvalues and eigenvectors (V columns).
 */
function jacobiEigenSymmetric4(m: number[]): { eigenvalues: number[]; eigenvectors: number[] } {
  const a = m.slice(); // 16 elements
  const v = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) v[i * 4 + i] = 1;

  const maxSweeps = 30;
  const relEps = 1e-12;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Scale from all elements (handles zero diagonals with non-zero off-diagonals)
    let scale = 0;
    for (let i = 0; i < 16; i++) {
      const v = Math.abs(a[i]);
      if (Number.isFinite(v) && v > scale) scale = v;
    }
    if (scale === 0 || !Number.isFinite(scale)) break; // zero / invalid matrix

    let maxOff = 0;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        maxOff = Math.max(maxOff, Math.abs(a[p * 4 + q]));
      }
    }
    if (maxOff < relEps * scale) break;

    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        const app = a[p * 4 + p];
        const aqq = a[q * 4 + q];
        const apq = a[p * 4 + q];
        // Skip only if negligible relative to overall matrix scale (scale-invariant)
        if (Math.abs(apq) < relEps * scale) continue;

        const tau = (aqq - app) / (2 * apq);
        // Stable Jacobi t: when tau===0 yields t=1, avoids Math.sign(0)=0
        let t;
        if (tau >= 0) {
          t = 1.0 / (tau + Math.sqrt(1 + tau * tau));
        } else {
          t = -1.0 / (-tau + Math.sqrt(1 + tau * tau));
        }
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        a[p * 4 + p] = app - t * apq;
        a[q * 4 + q] = aqq + t * apq;
        a[p * 4 + q] = a[q * 4 + p] = 0;

        for (let r = 0; r < 4; r++) {
          if (r !== p && r !== q) {
            const arp = a[r * 4 + p];
            const arq = a[r * 4 + q];
            a[r * 4 + p] = a[p * 4 + r] = c * arp - s * arq;
            a[r * 4 + q] = a[q * 4 + r] = s * arp + c * arq;
          }
        }

        for (let r = 0; r < 4; r++) {
          const vrp = v[r * 4 + p];
          const vrq = v[r * 4 + q];
          v[r * 4 + p] = c * vrp - s * vrq;
          v[r * 4 + q] = s * vrp + c * vrq;
        }
      }
    }
  }

  return {
    eigenvalues: [a[0], a[5], a[10], a[15]],
    eigenvectors: v,
  };
}
