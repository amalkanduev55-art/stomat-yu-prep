import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type RemovalMap = {
  /** Original surface (its own coordinates, indexed) with a per-vertex `color` attribute: the heatmap. */
  geometry: THREE.BufferGeometry;
  /** Per vertex of `geometry`: how far Original lies outside Target, mm (negative where Target adds material). */
  depth: Float32Array;
  /** Tissue to remove: Original surface outside Target, integrated over its area, mm³. */
  removedVolume: number;
  /** Material Target adds over Original (wax-up), mm³. */
  addedVolume: number;
  /** Deepest removal, mm (capped at `reach`). */
  maxDepth: number;
  /** Original surface area where removal exceeds the threshold, mm². */
  removedArea: number;
  /** Depth of the heatmap scale (red), mm. */
  scale: number;
};

/**
 * Removal map Original → Target. For every vertex of Original the distance to the nearest Target triangle is measured
 * in world space; it counts as removal where Original lies outside Target, judged by Original's own surface normal, so
 * the winding and open rims of Target do not matter. Differences below `threshold` (registration noise) count as zero.
 * Volumes are the depth integrated over the Original surface (area × mean depth per triangle), which is exact for a
 * layer of constant depth and close for thin layers on curved teeth.
 */
export function computeRemovalMap(
  original: THREE.BufferGeometry,
  originalMatrix: THREE.Matrix4 | null,
  target: THREE.BufferGeometry,
  targetMatrix: THREE.Matrix4 | null,
  options: { reach?: number; threshold?: number; scale?: number } = {},
): RemovalMap {
  const reach = options.reach ?? 3, threshold = options.threshold ?? .05, scale = options.scale ?? 2;
  const surface = original.clone();
  for (const name of Object.keys(surface.attributes)) if (name !== 'position') surface.deleteAttribute(name);
  const geometry = mergeVertices(surface, 1e-4);
  surface.dispose();
  geometry.computeVertexNormals();
  const world = target.clone();
  if (targetMatrix) world.applyMatrix4(targetMatrix);
  const nearest = nearestTriangle(world, reach);
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(originalMatrix ?? new THREE.Matrix4());
  const point = new THREE.Vector3(), away = new THREE.Vector3(), n = new THREE.Vector3();
  const depth = new Float32Array(position.count);
  for (let v = 0; v < position.count; v++) {
    point.fromBufferAttribute(position, v);
    if (originalMatrix) point.applyMatrix4(originalMatrix);
    const d = nearest(point, away);
    if (d < threshold || d >= reach) { depth[v] = 0; continue; }
    // `away` points from the nearest Target point to this vertex, whatever Target's winding.
    n.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix);
    depth[v] = away.dot(n) >= 0 ? d : -d;
  }
  world.dispose();

  let removedVolume = 0, addedVolume = 0, removedArea = 0, maxDepth = 0;
  const index = geometry.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const scaleFactor = originalMatrix ? Math.cbrt(Math.abs(originalMatrix.determinant())) : 1;
  for (let t = 0; t < index.count; t += 3) {
    const i = index.getX(t), j = index.getX(t + 1), k = index.getX(t + 2);
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, j); c.fromBufferAttribute(position, k);
    const area = b.sub(a).cross(c.sub(a)).length() / 2 * scaleFactor * scaleFactor;
    const removal = (Math.max(0, depth[i]) + Math.max(0, depth[j]) + Math.max(0, depth[k])) / 3;
    const addition = (Math.max(0, -depth[i]) + Math.max(0, -depth[j]) + Math.max(0, -depth[k])) / 3;
    removedVolume += area * removal;
    addedVolume += area * addition;
    if (removal > 0) removedArea += area;
  }
  for (const value of depth) if (value > maxDepth) maxDepth = value;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(heatColors(depth, scale), 3));
  return { geometry, depth, removedVolume, addedVolume, maxDepth, removedArea, scale };
}

/** Untouched: ivory. Removal: yellow → orange → red at `scale` mm. Addition: light → deep blue. */
export function heatColors(depth: Float32Array, scale: number) {
  const colors = new Float32Array(depth.length * 3);
  const ivory = new THREE.Color('#e8dcc4'), color = new THREE.Color();
  const removal = [new THREE.Color('#f2d64b'), new THREE.Color('#ee8a2a'), new THREE.Color('#c8262b')];
  const addition = [new THREE.Color('#8ec5ea'), new THREE.Color('#2a5fbf')];
  for (let v = 0; v < depth.length; v++) {
    const d = depth[v];
    if (d === 0) color.copy(ivory);
    else if (d > 0) {
      const s = Math.min(1, d / scale) * 2;
      color.copy(removal[Math.min(1, Math.floor(s))]).lerp(removal[Math.min(2, Math.floor(s) + 1)], s - Math.floor(s));
    } else color.copy(addition[0]).lerp(addition[1], Math.min(1, -d / scale));
    colors[3 * v] = color.r; colors[3 * v + 1] = color.g; colors[3 * v + 2] = color.b;
  }
  return colors;
}

/**
 * Unsigned distance to the nearest triangle, up to `reach`, through a fine uniform grid searched in growing shells,
 * so points close to the surface (most of them) look at a handful of triangles. `away` receives the direction from the
 * nearest surface point to the query point.
 */
function nearestTriangle(mesh: THREE.BufferGeometry, reach: number) {
  const position = mesh.getAttribute('position');
  const index = mesh.index;
  const count = (index ? index.count : position.count) / 3;
  const vertices = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) for (let n = 0; n < 3; n++) {
    const v = index ? index.getX(3 * t + n) : 3 * t + n;
    vertices[9 * t + 3 * n] = position.getX(v); vertices[9 * t + 3 * n + 1] = position.getY(v); vertices[9 * t + 3 * n + 2] = position.getZ(v);
  }
  const size = .5;
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
  for (let t = 0; t < count; t++) {
    const o = 9 * t;
    const lo = [0, 1, 2].map(axis => Math.floor(Math.min(vertices[o + axis], vertices[o + 3 + axis], vertices[o + 6 + axis]) / size));
    const hi = [0, 1, 2].map(axis => Math.floor(Math.max(vertices[o + axis], vertices[o + 3 + axis], vertices[o + 6 + axis]) / size));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const cell = cells.get(key(i, j, k));
      if (cell) cell.push(t); else cells.set(key(i, j, k), [t]);
    }
  }
  const seen = new Uint32Array(count);
  let stamp = 0;
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), best = new THREE.Vector3();
  const rings = Math.ceil(reach / size);
  return (point: THREE.Vector3, away: THREE.Vector3) => {
    stamp++;
    let distance = reach;
    const ci = Math.floor(point.x / size), cj = Math.floor(point.y / size), ck = Math.floor(point.z / size);
    for (let ring = 0; ring <= rings; ring++) {
      // Every triangle not yet visited is at least (ring − 1) cells away.
      if (distance <= (ring - 1) * size) break;
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) for (let k = ck - ring; k <= ck + ring; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== ring) continue;
        const cell = cells.get(key(i, j, k));
        if (!cell) continue;
        for (const t of cell) {
          if (seen[t] === stamp) continue;
          seen[t] = stamp;
          const o = 9 * t;
          triangle.a.set(vertices[o], vertices[o + 1], vertices[o + 2]);
          triangle.b.set(vertices[o + 3], vertices[o + 4], vertices[o + 5]);
          triangle.c.set(vertices[o + 6], vertices[o + 7], vertices[o + 8]);
          triangle.closestPointToPoint(point, closest);
          const d = closest.distanceTo(point);
          if (d < distance) { distance = d; best.copy(closest); }
        }
      }
    }
    if (distance > 0 && distance < reach) away.subVectors(point, best).divideScalar(distance); else away.set(0, 0, 0);
    return distance;
  };
}
