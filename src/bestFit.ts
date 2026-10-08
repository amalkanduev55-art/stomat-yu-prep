import * as THREE from 'three';

export type BestFitResult = {
  matrix: THREE.Matrix4;
  iterations: number;
  rmse: number;
  matchedPoints: number;
  converged: boolean;
};

function sampleGeometry(geometry: THREE.BufferGeometry, maxPoints = 900): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  if (!position) return [];
  const count = position.count;
  const stride = Math.max(1, Math.ceil(count / maxPoints));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i += stride) {
    points.push(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
  }
  return points;
}

function nearest(point: THREE.Vector3, target: THREE.Vector3[]) {
  let best = target[0];
  let bestDistance = Infinity;
  for (let i = 0; i < target.length; i += 1) {
    const distance = point.distanceToSquared(target[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target[i];
    }
  }
  return { point: best, distanceSquared: bestDistance };
}

/**
 * Point-to-point rigid ICP. No scaling is applied.
 * This is intentionally a deterministic client-side geometric core for the PoC;
 * production clinical workloads should move to a robust spatial index/backend.
 */
export function bestFitRigid(
  sourceGeometry: THREE.BufferGeometry,
  targetGeometry: THREE.BufferGeometry,
  options: { maxPoints?: number; maxIterations?: number; tolerance?: number } = {},
): BestFitResult | null {
  const source = sampleGeometry(sourceGeometry, options.maxPoints ?? 900);
  const target = sampleGeometry(targetGeometry, options.maxPoints ?? 900);
  if (source.length < 3 || target.length < 3) return null;

  const matrix = new THREE.Matrix4();
  let previousRmse = Infinity;
  let rmse = Infinity;
  let converged = false;
  const maxIterations = options.maxIterations ?? 18;
  const tolerance = options.tolerance ?? 1e-4;
  let iteration = 0;

  for (; iteration < maxIterations; iteration += 1) {
    const transformed = source.map(point => point.clone().applyMatrix4(matrix));
    const pairs: Array<[THREE.Vector3, THREE.Vector3]> = [];
    let errorSum = 0;
    for (const point of transformed) {
      const match = nearest(point, target);
      pairs.push([point, match.point]);
      errorSum += match.distanceSquared;
    }
    rmse = Math.sqrt(errorSum / pairs.length);

    const pMean = new THREE.Vector3();
    const qMean = new THREE.Vector3();
    for (const [p, q] of pairs) {
      pMean.add(p);
      qMean.add(q);
    }
    pMean.multiplyScalar(1 / pairs.length);
    qMean.multiplyScalar(1 / pairs.length);

    let sxx = 0, sxy = 0, sxz = 0;
    let syx = 0, syy = 0, syz = 0;
    let szx = 0, szy = 0, szz = 0;
    for (const [p, q] of pairs) {
      const px = p.x - pMean.x, py = p.y - pMean.y, pz = p.z - pMean.z;
      const qx = q.x - qMean.x, qy = q.y - qMean.y, qz = q.z - qMean.z;
      sxx += px * qx; sxy += px * qy; sxz += px * qz;
      syx += py * qx; syy += py * qy; syz += py * qz;
      szx += pz * qx; szy += pz * qy; szz += pz * qz;
    }

    const n = [
      sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
      syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
      szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
      sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
    ];

    let q = [1, 0, 0, 0];
    for (let k = 0; k < 20; k += 1) {
      const next = [0, 0, 0, 0];
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) next[row] += n[row * 4 + col] * q[col];
      }
      const norm = Math.hypot(...next) || 1;
      q = next.map(value => value / norm);
    }

    const quaternion = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
    const rotation = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    const translation = qMean.clone().sub(pMean.clone().applyQuaternion(quaternion));
    const delta = new THREE.Matrix4().compose(translation, quaternion, new THREE.Vector3(1, 1, 1));
    matrix.premultiply(delta);

    if (Math.abs(previousRmse - rmse) < tolerance) {
      converged = true;
      break;
    }
    previousRmse = rmse;
  }

  return { matrix, iterations: iteration + 1, rmse, matchedPoints: source.length, converged };
}
