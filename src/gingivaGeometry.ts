import * as THREE from 'three';

const profile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1, -3.6, 0), new THREE.Vector3(-.94, -2, 0),
    new THREE.Vector3(-.7, -.9, 0), new THREE.Vector3(-.48, -.75, 0),
    new THREE.Vector3(0, -1.35, 0), new THREE.Vector3(.48, -.75, 0),
    new THREE.Vector3(.7, -.9, 0), new THREE.Vector3(.95, -2, 0),
    new THREE.Vector3(1, -4, 0), new THREE.Vector3(.85, -6.7, 0),
    new THREE.Vector3(.45, -7.4, 0), new THREE.Vector3(-.45, -7.4, 0),
    new THREE.Vector3(-.86, -6.5, 0),
  ], true, 'centripetal');

const surfaceHeights = new Map<string, number>();

export function gingivalSurfaceHeight(coordinate: number, radialDepth: number) {
  const key = `${coordinate.toFixed(6)}:${radialDepth.toFixed(6)}`;
  const cached = surfaceHeights.get(key);
  if (cached !== undefined) return cached;
  const width = 3.55 + .75 * THREE.MathUtils.smoothstep(Math.abs(coordinate - 6.5), 2.3, 5.3);
  const papilla = (1 - Math.cos(coordinate * Math.PI * 2)) * .58;
  let closest = Infinity;
  let height = -.9;
  for (let cross = 0; cross < 192; cross++) {
    const point = profile.getPoint(cross / 192);
    if (point.y < -2.5) continue;
    const bulge = .2 * Math.cos(coordinate * Math.PI * 2) * Math.exp(-((point.y + 3.4) ** 2) / 5);
    const distance = Math.abs(point.x * (width + bulge) - radialDepth);
    if (distance < closest) {
      closest = distance;
      const blend = THREE.MathUtils.smoothstep(point.y, -2.5, -.75);
      height = point.y + papilla * blend + .06 * Math.sin(coordinate * 7.1) * blend;
    }
  }
  if (surfaceHeights.size > 4096) surfaceHeights.clear();
  surfaceHeights.set(key, height);
  return height;
}

export default function gingivaGeometry() {
  const longitudinalSegments = 280;
  const crossSegments = 64;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const pale = new THREE.Color('#db9694');
  const deep = new THREE.Color('#b85f6c');
  for (let segment = 0; segment <= longitudinalSegments; segment++) {
    const coordinate = -.62 + 14.24 * segment / longitudinalSegments;
    const angle = (coordinate - 6.5) * .215;
    const width = 3.55 + .75 * THREE.MathUtils.smoothstep(Math.abs(coordinate - 6.5), 2.3, 5.3);
    const papilla = (1 - Math.cos(coordinate * Math.PI * 2)) * .58;
    for (let cross = 0; cross < crossSegments; cross++) {
      const point = profile.getPoint(cross / crossSegments);
      const topBlend = THREE.MathUtils.smoothstep(point.y, -2.5, -.75);
      const scallop = papilla * topBlend;
      const rootBulge = .2 * Math.cos(coordinate * Math.PI * 2) * Math.exp(-((point.y + 3.4) ** 2) / 5);
      const depth = point.x * (width + rootBulge);
      const height = point.y + scallop + .06 * Math.sin(coordinate * 7.1) * topBlend;
      positions.push(Math.sin(angle) * (20 + depth), height, Math.cos(angle) * (21 + depth) - 8);
      const shade = pale.clone().lerp(deep, .75 * THREE.MathUtils.smoothstep(-height, 1.5, 7));
      shade.multiplyScalar(1 + .015 * Math.sin(coordinate * 9 + cross * .2));
      colors.push(shade.r, shade.g, shade.b);
    }
  }
  for (let segment = 0; segment < longitudinalSegments; segment++) {
    for (let cross = 0; cross < crossSegments; cross++) {
      const next = (cross + 1) % crossSegments;
      const first = segment * crossSegments + cross;
      const second = segment * crossSegments + next;
      const third = (segment + 1) * crossSegments + next;
      const fourth = (segment + 1) * crossSegments + cross;
      indices.push(first, second, third, first, third, fourth);
    }
  }
  for (const segment of [0, longitudinalSegments]) {
    const center = new THREE.Vector3();
    for (let cross = 0; cross < crossSegments; cross++) center.add(new THREE.Vector3().fromArray(positions, (segment * crossSegments + cross) * 3));
    center.divideScalar(crossSegments);
    const centerIndex = positions.length / 3;
    positions.push(...center.toArray()); colors.push(deep.r, deep.g, deep.b);
    for (let cross = 0; cross < crossSegments; cross++) {
      const first = segment * crossSegments + cross;
      const second = segment * crossSegments + (cross + 1) % crossSegments;
      if (segment === 0) indices.push(centerIndex, second, first); else indices.push(centerIndex, first, second);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
