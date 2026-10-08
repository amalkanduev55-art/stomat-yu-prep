import * as THREE from 'three';
import { toothIds } from './geometry';

function taperedRoot(length: number, radius: number, start: number, offset: number, bend: number, depthScale: number) {
  const profile = [new THREE.Vector2(0, start - length)];
  for (let step = 1; step <= 32; step++) {
    const fraction = step / 32;
    profile.push(new THREE.Vector2(radius * Math.pow(fraction, .58) * (1 - .12 * Math.sin(fraction * Math.PI)), start - length + fraction * length));
  }
  profile.push(new THREE.Vector2(0, start));
  const geometry = new THREE.LatheGeometry(profile, 40);
  const vertices = geometry.attributes.position;
  for (let vertex = 0; vertex < vertices.count; vertex++) {
    const fraction = (start - vertices.getY(vertex)) / length;
    vertices.setXYZ(vertex, vertices.getX(vertex) + offset + bend * fraction * fraction, vertices.getY(vertex), vertices.getZ(vertex) * depthScale + .25 * Math.sin(fraction * Math.PI));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export default function rootGeometry(index: number): THREE.BufferGeometry[] {
  const number = toothIds[index] % 10;
  const direction = index < 7 ? -1 : 1;
  if (number >= 6) return [
    taperedRoot(3.2, 1.65, -.55, 0, 0, 1.35),
    taperedRoot(8.4, 1.02, -2.7, -1, -.8, 1.2),
    taperedRoot(7.7, .94, -2.7, 1, .75, 1.25),
  ];
  const length = number === 3 ? 12.4 : number >= 4 ? 10.4 : number === 1 ? 9.1 : 10;
  return [taperedRoot(length + (index % 3) * .22, number >= 4 ? 1.45 : number === 3 ? 1.3 : 1.18, -.55, 0, direction * .65, number >= 4 ? 1.25 : 1.05)];
}
