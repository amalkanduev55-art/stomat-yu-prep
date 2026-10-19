import * as THREE from 'three';

export type Shoulder = {
  /** Margin line on the scan surface (closed, about every 0.2 mm). */
  margin: THREE.Vector3[];
  /** Inner edge of the shoulder: the margin moved into the tooth across its surface by the shoulder width. */
  inner: THREE.Vector3[];
  /** The shoulder ledge between the two lines. */
  band: THREE.BufferGeometry;
  /** Length of the margin line, mm. */
  length: number;
};

/** Scan vertices and normals in workspace coordinates, binned on a 1 mm grid, per scan and placement. */
const surfaces = new WeakMap<THREE.BufferGeometry, Map<string, { points: Float32Array; normals: Float32Array; cells: Map<number, number[]> }>>();
const cellKey = (i: number, j: number, k: number) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
function surface(scan: THREE.BufferGeometry, transform: THREE.Matrix4 | null) {
  const placement = transform ? transform.elements.join(',') : '';
  let found = surfaces.get(scan)?.get(placement);
  if (found) return found;
  const position = scan.getAttribute('position');
  const normal = scan.getAttribute('normal');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform ?? new THREE.Matrix4());
  const points = new Float32Array(position.count * 3), normals = new Float32Array(position.count * 3);
  const cells = new Map<number, number[]>();
  const point = new THREE.Vector3(), direction = new THREE.Vector3();
  for (let v = 0; v < position.count; v++) {
    point.fromBufferAttribute(position, v);
    if (transform) point.applyMatrix4(transform);
    if (normal) direction.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix).normalize(); else direction.set(0, 1, 0);
    points.set([point.x, point.y, point.z], v * 3);
    normals.set([direction.x, direction.y, direction.z], v * 3);
    const key = cellKey(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z));
    const cell = cells.get(key);
    if (cell) cell.push(v); else cells.set(key, [v]);
  }
  found = { points, normals, cells };
  if (!surfaces.has(scan)) surfaces.set(scan, new Map());
  surfaces.get(scan)!.set(placement, found);
  return found;
}

/**
 * Shoulder of a planned preparation from margin points marked by hand on one tooth (at least 3, in order around it).
 * The points are joined into a closed smooth line that is laid on the scan; at every point of it the shoulder runs
 * `width` mm into the tooth, horizontally (across the tooth's axis, the insertion direction +Y), perpendicular to the
 * line. The scan itself is not changed.
 */
export function buildShoulder(marks: Array<[number, number, number]>, scan: THREE.BufferGeometry, transform: THREE.Matrix4 | null, width = .5): Shoulder | null {
  if (marks.length < 3) return null;
  const { points, normals, cells } = surface(scan, transform);
  const curve = new THREE.CatmullRomCurve3(marks.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  const count = Math.max(24, Math.ceil(curve.getLength() / .2));
  const near = (query: THREE.Vector3, radius: number) => {
    const found: number[] = [];
    const reach = Math.ceil(radius);
    const ci = Math.floor(query.x), cj = Math.floor(query.y), ck = Math.floor(query.z);
    for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) for (let k = ck - reach; k <= ck + reach; k++) {
      for (const v of cells.get(cellKey(i, j, k)) ?? []) {
        const dx = points[v * 3] - query.x, dy = points[v * 3 + 1] - query.y, dz = points[v * 3 + 2] - query.z;
        if (dx * dx + dy * dy + dz * dz <= radius * radius) found.push(v);
      }
    }
    return found;
  };
  // Lay the line on the scan: each sample goes to the nearest scan vertex; the outward normal there is the mean of the
  // vertex normals within 0.6 mm (one STL face normal alone is noisy).
  const margin: THREE.Vector3[] = [], outward: THREE.Vector3[] = [];
  for (let n = 0; n < count; n++) {
    const sample = curve.getPointAt(n / count);
    let best = -1, bestDistance = Infinity;
    for (const v of near(sample, 1.5)) {
      const dx = points[v * 3] - sample.x, dy = points[v * 3 + 1] - sample.y, dz = points[v * 3 + 2] - sample.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) { bestDistance = distance; best = v; }
    }
    const on = best >= 0 ? new THREE.Vector3(points[best * 3], points[best * 3 + 1], points[best * 3 + 2]) : sample;
    const normal = new THREE.Vector3();
    for (const v of near(on, .6)) normal.add(new THREE.Vector3(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]));
    margin.push(on);
    outward.push(normal);
  }
  // Snapping to vertices leaves a jagged line: smooth it along itself (±3 samples) and lift it 0.03 mm off the surface
  // so it is not hidden in it.
  const snapped = margin.map(point => point.clone());
  for (let n = 0; n < count; n++) {
    const sum = new THREE.Vector3();
    for (let k = -3; k <= 3; k++) sum.add(snapped[(n + k + count) % count]);
    margin[n].copy(sum.divideScalar(7)).addScaledVector(outward[n].lengthSq() > 0 ? outward[n].clone().normalize() : new THREE.Vector3(), .03);
  }
  // Into the tooth: against the surface normal, flattened to the horizontal and made perpendicular to the line, then
  // smoothed along it. Where the normal is nearly vertical, towards the middle of the marked line.
  const centre = margin.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(margin.length);
  const into = margin.map((point, n) => {
    const tangent = margin[(n + 1) % count].clone().sub(margin[(n + count - 1) % count]).setY(0);
    const direction = outward[n].clone().negate().setY(0);
    if (tangent.lengthSq() > 1e-9) direction.addScaledVector(tangent.normalize(), -direction.dot(tangent));
    if (direction.lengthSq() < 1e-4) direction.copy(centre).sub(point).setY(0);
    return direction.normalize();
  });
  const smooth = into.map((_, n) => {
    const sum = new THREE.Vector3();
    for (let k = -4; k <= 4; k++) sum.add(into[(n + k + count) % count]);
    return sum.normalize();
  });
  const inner = margin.map((point, n) => point.clone().addScaledVector(smooth[n], width));
  const positions: number[] = [];
  for (let n = 0; n < count; n++) {
    const a = margin[n], b = margin[(n + 1) % count], c = inner[(n + 1) % count], d = inner[n];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
  const band = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  band.computeVertexNormals();
  const length = margin.reduce((sum, point, n) => sum + point.distanceTo(margin[(n + 1) % count]), 0);
  return { margin, inner, band, length };
}
