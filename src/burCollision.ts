import * as THREE from 'three';

/** Bur sizes and stopper position that decide where the bur reaches, mm and degrees (the Settings fields). */
export type BurSettings = { diameter: number; length: number; shaft: number; totalLength: number; profile: number; stopperPosition: number; angle: number };

/** A slot to check: the contact it cuts at, the stopper path over the guide there and the teeth on both sides. */
export type CollisionSlot = {
  key: string;
  label: string;
  /** Contact on the arch and the unit vector along the arch there (towards the higher tooth index). */
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  path: THREE.Vector3[];
  /** Whether the tooth on the lower-index side and on the higher-index side is prepared (the bur may cut it). */
  lowerPrepared: boolean;
  upperPrepared: boolean;
};

export type SlotCollision = { key: string; label: string; neighbour: number; gum: number; neighbourPoints: number; gumPoints: number };

export type BurCollisions = {
  slots: SlotCollision[];
  /** Points of the scan the bur cuts where it must not: neighbouring unprepared teeth and gum, world coordinates. */
  neighbourPoints: Float32Array;
  gumPoints: Float32Array;
  /** Deepest cut into a neighbouring tooth and into the gum, mm (radial depth inside the bur). */
  neighbour: number;
  gum: number;
};

/** Point of the stopper path at the cross-arch parameter the bur animation uses (−1.42 … 1.42). */
export function scanPathPoint(path: THREE.Vector3[], crossAngle: number) {
  return pathCurve(path).getPointAt(THREE.MathUtils.clamp((crossAngle + 1.42) / 2.84, 0, 1));
}
/** Unit tangent of a scan stopper path at the same parameter as scanPathPoint. */
export function scanPathTangent(path: THREE.Vector3[], crossAngle: number) {
  return pathCurve(path).getTangentAt(THREE.MathUtils.clamp((crossAngle + 1.42) / 2.84, 0, 1));
}
// Smooth curve through the path points (constant speed by arc length), so the bur does not snap at each point.
const pathCurves = new WeakMap<THREE.Vector3[], THREE.CatmullRomCurve3>();
function pathCurve(path: THREE.Vector3[]) {
  let curve = pathCurves.get(path);
  if (!curve) { curve = new THREE.CatmullRomCurve3(path, false, 'centripetal'); curve.arcLengthDivisions = 400; pathCurves.set(path, curve); }
  return curve;
}

/**
 * Pose of the bur on a scan stopper path, the same as the animation: the bur stands across the path, its stopper on the
 * guide. Returns the bur origin (top of the working part) and its unit axis pointing up the shaft.
 */
export function burPose(path: THREE.Vector3[], contactTangent: THREE.Vector3, crossAngle: number, settings: BurSettings) {
  const contact = scanPathPoint(path, crossAngle);
  const tangent = scanPathTangent(path, crossAngle);
  const insertion = new THREE.Vector3().crossVectors(tangent, contactTangent);
  if (insertion.lengthSq() < 1e-8) insertion.crossVectors(tangent, new THREE.Vector3(0, 0, 1));
  insertion.normalize();
  if (insertion.y < 0) insertion.negate();
  const origin = contact.addScaledVector(insertion, settings.stopperPosition + .08);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), insertion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), settings.angle * Math.PI / 180));
  return { origin, axis: new THREE.Vector3(0, 1, 0).applyQuaternion(rotation) };
}

/** Scan vertices in workspace coordinates, binned on a 1 mm grid, per scan and placement. */
const scanGrids = new WeakMap<THREE.BufferGeometry, Map<string, { points: Float32Array; cells: Map<number, number[]> }>>();
const cellKey = (i: number, j: number, k: number) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
function scanGrid(scan: THREE.BufferGeometry, transform: THREE.Matrix4 | null) {
  const placement = transform ? transform.elements.join(',') : '';
  let grid = scanGrids.get(scan)?.get(placement);
  if (grid) return grid;
  const position = scan.getAttribute('position');
  const points = new Float32Array(position.count * 3);
  const cells = new Map<number, number[]>();
  const point = new THREE.Vector3();
  // STL triangles repeat their corners; one copy of each position is enough.
  const seen = new Set<string>();
  for (let v = 0; v < position.count; v++) {
    point.fromBufferAttribute(position, v);
    if (transform) point.applyMatrix4(transform);
    const id = `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    points.set([point.x, point.y, point.z], v * 3);
    const key = cellKey(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z));
    const cell = cells.get(key);
    if (cell) cell.push(v); else cells.set(key, [v]);
  }
  grid = { points, cells };
  if (!scanGrids.has(scan)) scanGrids.set(scan, new Map());
  scanGrids.get(scan)!.set(placement, grid);
  return grid;
}

/**
 * Where the bur, moved along each slot's stopper path, cuts the scan where it must not. The bur is the working part
 * (cylinder or cone tapering to 70% at the tip) plus the shaft; every scan point inside it is cut, as deep as it lies
 * inside. A cut point is gum if it lies below the gum line (`gumLine` gives its height at x, z, or null where unknown);
 * otherwise it is a neighbouring tooth when it lies on the side of the contact whose tooth is not prepared. Cuts shallower than `threshold` are scan noise and do not count.
 */
export function findBurCollisions(scan: THREE.BufferGeometry, transform: THREE.Matrix4 | null, slots: CollisionSlot[], settings: BurSettings, gumLine: (x: number, z: number) => number | null, options: { steps?: number; threshold?: number } = {}): BurCollisions {
  const steps = options.steps ?? 64, threshold = options.threshold ?? .05;
  const { points, cells } = scanGrid(scan, transform);
  const tipRadius = settings.diameter / 2 * (settings.profile === 1 ? 1 : .7);
  const shaftLength = Math.max(0, settings.totalLength - settings.length);
  const reach = Math.max(settings.diameter, settings.shaft) / 2 + .01;
  // Deepest cut per scan point, and which kind it is (1 neighbour, 2 gum).
  const depth = new Map<number, number>();
  const kind = new Map<number, number>();
  const result: SlotCollision[] = [];
  const start = new THREE.Vector3(), end = new THREE.Vector3(), offset = new THREE.Vector3();
  for (const slot of slots) {
    let neighbour = 0, gum = 0;
    const neighbourSet = new Set<number>(), gumSet = new Set<number>();
    for (let step = 0; step <= steps; step++) {
      const { origin, axis } = burPose(slot.path, slot.tangent, -1.42 + 2.84 * step / steps, settings);
      start.copy(origin).addScaledVector(axis, -settings.length);
      end.copy(origin).addScaledVector(axis, shaftLength);
      const lo = start.clone().min(end).subScalar(reach), hi = start.clone().max(end).addScalar(reach);
      for (let i = Math.floor(lo.x); i <= Math.floor(hi.x); i++) for (let j = Math.floor(lo.y); j <= Math.floor(hi.y); j++) for (let k = Math.floor(lo.z); k <= Math.floor(hi.z); k++) {
        const cell = cells.get(cellKey(i, j, k));
        if (!cell) continue;
        for (const v of cell) {
          offset.set(points[v * 3] - origin.x, points[v * 3 + 1] - origin.y, points[v * 3 + 2] - origin.z);
          const along = offset.dot(axis);
          if (along < -settings.length || along > shaftLength) continue;
          const radius = along >= 0 ? settings.shaft / 2 : settings.diameter / 2 + (tipRadius - settings.diameter / 2) * (-along / settings.length);
          const inside = radius - Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
          if (inside <= threshold) continue;
          const x = points[v * 3], y = points[v * 3 + 1], z = points[v * 3 + 2];
          const line = gumLine(x, z);
          let type = 0;
          if (line !== null && y < line) type = 2;
          else {
            const side = (x - slot.point.x) * slot.tangent.x + (y - slot.point.y) * slot.tangent.y + (z - slot.point.z) * slot.tangent.z;
            if (side < 0 ? !slot.lowerPrepared : !slot.upperPrepared) type = 1;
          }
          if (!type) continue;
          if (type === 1) { neighbour = Math.max(neighbour, inside); neighbourSet.add(v); } else { gum = Math.max(gum, inside); gumSet.add(v); }
          if (inside > (depth.get(v) ?? 0)) { depth.set(v, inside); kind.set(v, type); }
        }
      }
    }
    result.push({ key: slot.key, label: slot.label, neighbour, gum, neighbourPoints: neighbourSet.size, gumPoints: gumSet.size });
  }
  const gather = (type: number) => {
    const out: number[] = [];
    kind.forEach((value, v) => { if (value === type) out.push(points[v * 3], points[v * 3 + 1], points[v * 3 + 2]); });
    return new Float32Array(out);
  };
  return { slots: result, neighbourPoints: gather(1), gumPoints: gather(2), neighbour: Math.max(0, ...result.map(slot => slot.neighbour)), gum: Math.max(0, ...result.map(slot => slot.gum)) };
}

/**
 * Gum line around a guide. The guide's lower edge is built `gumOffset` above the gum, so near any point the lowest
 * point of the guide within `radius` in plan (its edge on the nearer side) minus `gumOffset` is taken as the gum
 * height there. Null farther than `radius` from the guide.
 */
export function gumLineNear(guide: THREE.BufferGeometry, gumOffset: number, radius = 5) {
  const size = .5;
  const floor = new Map<number, number>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + j + 4096;
  const position = guide.getAttribute('position');
  for (let v = 0; v < position.count; v++) {
    const k = key(Math.floor(position.getX(v) / size), Math.floor(position.getZ(v) / size));
    const y = position.getY(v);
    if (y < (floor.get(k) ?? Infinity)) floor.set(k, y);
  }
  const reach = Math.ceil(radius / size);
  const cache = new Map<number, number | null>();
  return (x: number, z: number) => {
    const i = Math.floor(x / size), j = Math.floor(z / size), k = key(i, j);
    if (cache.has(k)) return cache.get(k)!;
    let lowest = Infinity;
    for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) {
      if (di * di + dj * dj > reach * reach) continue;
      const y = floor.get(key(i + di, j + dj));
      if (y !== undefined && y < lowest) lowest = y;
    }
    const line = lowest === Infinity ? null : lowest - gumOffset;
    cache.set(k, line);
    return line;
  };
}
