import * as THREE from 'three';

export type BestFitResult = {
  /** World-space rigid transform that moves the source model onto the target model (apply before its current matrix). */
  matrix: THREE.Matrix4;
  iterations: number;
  /** RMS distance of the kept (inlier) pairs after the last iteration, mm. */
  rmse: number;
  matchedPoints: number;
  converged: boolean;
};

function worldPoints(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4 | null, maxPoints: number) {
  const position = geometry.getAttribute('position');
  if (!position) return [];
  const stride = Math.max(1, Math.ceil(position.count / maxPoints));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i += stride) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    points.push(matrix ? point.applyMatrix4(matrix) : point);
  }
  return points;
}

/** Exact nearest vertex of the reference model through a uniform grid (numeric cell keys, flat coordinates). */
function nearestIndex(points: THREE.Vector3[], size = 1) {
  const xyz = new Float64Array(points.length * 3);
  points.forEach((point, index) => xyz.set([point.x, point.y, point.z], index * 3));
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
  points.forEach((point, index) => {
    const id = key(Math.floor(point.x / size), Math.floor(point.y / size), Math.floor(point.z / size));
    const cell = cells.get(id);
    if (cell) cell.push(index); else cells.set(id, [index]);
  });
  return (query: THREE.Vector3, maxRing = 12) => {
    const ci = Math.floor(query.x / size), cj = Math.floor(query.y / size), ck = Math.floor(query.z / size);
    const qx = query.x, qy = query.y, qz = query.z;
    let best = -1, bestDistance = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      // Every point outside the visited rings is at least (ring) cells away.
      if (best >= 0 && bestDistance <= (ring - 1) * (ring - 1) * size * size) break;
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) {
        // Only the shell of the cube: all k on its two faces in i or j, else just the two end cells.
        const face = Math.abs(i - ci) === ring || Math.abs(j - cj) === ring;
        for (let k = ck - ring; k <= ck + ring; k += face || ring === 0 ? 1 : 2 * ring) {
          const cell = cells.get(key(i, j, k));
          if (!cell) continue;
          for (const index of cell) {
            const dx = xyz[index * 3] - qx, dy = xyz[index * 3 + 1] - qy, dz = xyz[index * 3 + 2] - qz;
            const distance = dx * dx + dy * dy + dz * dz;
            if (distance < bestDistance) { bestDistance = distance; best = index; }
          }
        }
      }
    }
    return { index: best, distanceSquared: bestDistance };
  };
}

/** Rigid transform (Horn, unit quaternions) that best maps p[i] onto q[i] in the least-squares sense. */
function rigidTransform(pairs: Array<[THREE.Vector3, THREE.Vector3]>) {
  const pMean = new THREE.Vector3(), qMean = new THREE.Vector3();
  for (const [p, q] of pairs) { pMean.add(p); qMean.add(q); }
  pMean.multiplyScalar(1 / pairs.length);
  qMean.multiplyScalar(1 / pairs.length);
  let sxx = 0, sxy = 0, sxz = 0, syx = 0, syy = 0, syz = 0, szx = 0, szy = 0, szz = 0;
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
  // Power iteration finds the eigenvalue of largest magnitude; shifting by the Frobenius norm makes N positive
  // definite, so it converges to the largest (wanted) eigenvalue instead of a large negative one.
  const shift = Math.hypot(...n);
  for (let k = 0; k < 4; k++) n[k * 5] += shift;
  let q = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 200; iteration++) {
    const next = [0, 0, 0, 0];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) next[row] += n[row * 4 + col] * q[col];
    const norm = Math.hypot(...next) || 1;
    const change = Math.abs(next[0] / norm - q[0]) + Math.abs(next[1] / norm - q[1]) + Math.abs(next[2] / norm - q[2]) + Math.abs(next[3] / norm - q[3]);
    q = next.map(value => value / norm);
    if (change < 1e-12) break;
  }
  const quaternion = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
  const translation = qMean.clone().sub(pMean.clone().applyQuaternion(quaternion));
  return new THREE.Matrix4().compose(translation, quaternion, new THREE.Vector3(1, 1, 1));
}

/**
 * Trimmed point-to-point rigid ICP in world space. No scaling, no reflection.
 *
 * Moves `source` (with its current `sourceMatrix`) onto `target` (with `targetMatrix`). Only the closest `keep`
 * share of pairs is used in each step, so regions that really differ (a wax-up over prepared teeth) do not pull the
 * fit. Starts from the current placement: models exported in the same coordinate system are refined in place.
 */
export function bestFitRigid(
  sourceGeometry: THREE.BufferGeometry,
  targetGeometry: THREE.BufferGeometry,
  options: { sourceMatrix?: THREE.Matrix4 | null; targetMatrix?: THREE.Matrix4 | null; maxPoints?: number; referencePoints?: number; maxIterations?: number; /** Stop when one step moves the model by less than this, mm. */ tolerance?: number; keep?: number } = {},
): BestFitResult | null {
  const source = worldPoints(sourceGeometry, options.sourceMatrix ?? null, options.maxPoints ?? 3000);
  const target = worldPoints(targetGeometry, options.targetMatrix ?? null, options.referencePoints ?? 60000);
  if (source.length < 3 || target.length < 3) return null;
  const nearest = nearestIndex(target);
  const keep = THREE.MathUtils.clamp(options.keep ?? .6, .3, 1);
  const maxIterations = options.maxIterations ?? 300;
  const tolerance = options.tolerance ?? 1e-4;

  const matrix = new THREE.Matrix4();
  // Far apart (another coordinate system): start with the centroids on top of each other.
  const sourceCenter = source.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / source.length);
  const targetCenter = target.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / target.length);
  if (sourceCenter.distanceTo(targetCenter) > 10) matrix.makeTranslation(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y, targetCenter.z - sourceCenter.z);

  let rmse = Infinity, converged = false, iteration = 0, matched = 0;
  const moved = new THREE.Vector3();
  const radius = Math.sqrt(source.reduce((sum, point) => sum + point.distanceToSquared(sourceCenter), 0) / source.length);
  for (; iteration < maxIterations; iteration++) {
    const pairs: Array<{ p: THREE.Vector3; q: THREE.Vector3; d: number }> = [];
    for (const point of source) {
      moved.copy(point).applyMatrix4(matrix);
      const match = nearest(moved);
      if (match.index >= 0) pairs.push({ p: moved.clone(), q: target[match.index], d: match.distanceSquared });
    }
    if (pairs.length < 3) return null;
    pairs.sort((a, b) => a.d - b.d);
    const kept = pairs.slice(0, Math.max(3, Math.floor(pairs.length * keep)));
    matched = kept.length;
    rmse = Math.sqrt(kept.reduce((sum, pair) => sum + pair.d, 0) / kept.length);
    const step = rigidTransform(kept.map(pair => [pair.p, pair.q]));
    matrix.premultiply(step);
    // Converged when the step moves the model (radius ≈ its sampled extent) by less than `tolerance` mm.
    const angle = 2 * Math.acos(Math.min(1, Math.abs(new THREE.Quaternion().setFromRotationMatrix(step).w)));
    if (new THREE.Vector3().setFromMatrixPosition(step).length() + angle * radius < tolerance) { converged = true; break; }
  }
  return { matrix, iterations: iteration + 1, rmse, matchedPoints: matched, converged };
}
