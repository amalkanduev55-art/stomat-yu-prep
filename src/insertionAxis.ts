import * as THREE from 'three';
import type { ScanGuideResult } from './scanGuideGeometry';

export type InsertionAxis = {
  /** Unit direction the guide is put on along (from the teeth outwards, mostly +Y). */
  direction: THREE.Vector3;
  /** Tilt from the vertical, degrees. */
  tilt: number;
  /** Direction of the tilt in the occlusal plane, degrees: 0 = towards +X, 90 = towards the incisors (+Z). */
  azimuth: number;
  /** Undercut of the covered teeth along this axis: area of the surfaces facing away from it, projected on its plane, mm². */
  undercut: number;
  /** The same for the vertical axis, for comparison. */
  verticalUndercut: number;
};

/**
 * Insertion axis with the least undercut under the guide. The covered region is the part of the scan under `guide`
 * (its footprint over XZ, above its lower edge), so gum below the edge and teeth outside the span do not count. For a
 * direction d, every triangle facing away from d (n·d < 0) is hidden from it and has to be blocked out; the undercut is
 * the sum of area·(−n·d). Directions up to `maxTilt` from the vertical are searched on a grid and then refined; among
 * near-equal ones (within 1%) the least tilted wins.
 */
export function findInsertionAxis(scan: THREE.BufferGeometry, transform: THREE.Matrix4 | null, guide: THREE.BufferGeometry, options: { maxTilt?: number } = {}): InsertionAxis | null {
  const maxTilt = options.maxTilt ?? 20;
  // Footprint of the guide: per 0.5 mm cell, the lowest point of the guide body.
  const size = .5;
  const floor = new Map<number, number>();
  const key = (x: number, z: number) => (Math.floor(x / size) + 4096) * 8192 + Math.floor(z / size) + 4096;
  const guidePosition = guide.getAttribute('position');
  for (let v = 0; v < guidePosition.count; v++) {
    const k = key(guidePosition.getX(v), guidePosition.getZ(v)), y = guidePosition.getY(v);
    if (!(floor.get(k)! <= y)) floor.set(k, y);
  }
  const surface = scan.clone();
  if (transform) surface.applyMatrix4(transform);
  const position = surface.getAttribute('position'), index = surface.index;
  const count = (index ? index.count : position.count) / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const areaNormals: number[] = [];
  for (let t = 0; t < count; t++) {
    a.fromBufferAttribute(position, index ? index.getX(3 * t) : 3 * t);
    b.fromBufferAttribute(position, index ? index.getX(3 * t + 1) : 3 * t + 1);
    c.fromBufferAttribute(position, index ? index.getX(3 * t + 2) : 3 * t + 2);
    const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
    const below = floor.get(key(x, z));
    if (below === undefined || y < below) continue;
    // Cross product = normal × 2·area.
    b.sub(a); c.sub(a); b.cross(c).multiplyScalar(.5);
    areaNormals.push(b.x, b.y, b.z);
  }
  surface.dispose();
  if (!areaNormals.length) return null;
  const undercutOf = (d: THREE.Vector3) => {
    let sum = 0;
    for (let n = 0; n < areaNormals.length; n += 3) {
      const dot = areaNormals[n] * d.x + areaNormals[n + 1] * d.y + areaNormals[n + 2] * d.z;
      if (dot < 0) sum -= dot;
    }
    return sum;
  };
  const direction = (tilt: number, azimuth: number) => {
    const t = tilt * Math.PI / 180, p = azimuth * Math.PI / 180;
    return new THREE.Vector3(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p));
  };
  const candidates: Array<{ tilt: number; azimuth: number; undercut: number }> = [];
  const verticalUndercut = undercutOf(new THREE.Vector3(0, 1, 0));
  candidates.push({ tilt: 0, azimuth: 0, undercut: verticalUndercut });
  for (let tilt = 1; tilt <= maxTilt; tilt++) for (let azimuth = 0; azimuth < 360; azimuth += 10) candidates.push({ tilt, azimuth, undercut: undercutOf(direction(tilt, azimuth)) });
  const pick = () => {
    const least = Math.min(...candidates.map(candidate => candidate.undercut));
    return candidates.filter(candidate => candidate.undercut <= least * 1.01).sort((p, q) => p.tilt - q.tilt || p.undercut - q.undercut)[0];
  };
  const coarse = pick();
  for (let tilt = Math.max(0, coarse.tilt - 1); tilt <= Math.min(maxTilt, coarse.tilt + 1); tilt += .25) for (let azimuth = coarse.azimuth - 10; azimuth <= coarse.azimuth + 10; azimuth += 2) {
    if (tilt > 0) candidates.push({ tilt, azimuth: (azimuth + 360) % 360, undercut: undercutOf(direction(tilt, azimuth)) });
  }
  const best = pick();
  return { direction: direction(best.tilt, best.azimuth), tilt: best.tilt, azimuth: best.azimuth, undercut: best.undercut, verticalUndercut };
}

/**
 * Builds a scan guide along an insertion axis: the scan is turned so that the axis points up, the guide is built there
 * (its undercut block-out is vertical in that frame) and the result is turned back onto the scan, contacts included.
 */
export function buildAlongAxis(direction: THREE.Vector3, transform: THREE.Matrix4 | null, build: (transform: THREE.Matrix4) => ScanGuideResult | null): ScanGuideResult | null {
  const turn = new THREE.Quaternion().setFromUnitVectors(direction.clone().normalize(), new THREE.Vector3(0, 1, 0));
  const to = new THREE.Matrix4().makeRotationFromQuaternion(turn);
  const result = build(to.clone().multiply(transform ?? new THREE.Matrix4()));
  if (!result) return null;
  const back = turn.clone().invert();
  const backMatrix = new THREE.Matrix4().makeRotationFromQuaternion(back);
  result.geometry.applyMatrix4(backMatrix);
  return {
    ...result,
    contacts: result.contacts.map(contact => ({
      ...contact,
      point: contact.point.clone().applyMatrix4(backMatrix),
      tangent: contact.tangent.clone().applyQuaternion(back),
      normal: contact.normal.clone().applyQuaternion(back),
      path: contact.path.map(point => point.clone().applyMatrix4(backMatrix)),
    })),
  };
}
