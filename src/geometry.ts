import * as THREE from 'three';
import { gingivalSurfaceHeight } from './gingivaGeometry';

export const toothIds = [37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47];
export function toothPosition(index: number): [number, number, number] {
  const angle = (index - 6.5) * 0.215;
  return [Math.sin(angle) * 20, 0, Math.cos(angle) * 21 - 8];
}
export function crownGeometry(index: number) {
  const geometry = new THREE.SphereGeometry(1, 64, 48);
  const vertices = geometry.attributes.position;
  const number = toothIds[index] % 10;
  const posterior = number >= 4;
  const molar = number >= 6;
  const canine = number === 3;
  const width = molar ? 2.36 : posterior ? 2.08 : canine ? 1.85 : number === 1 ? 2.04 : 1.75;
  const depthRadius = molar ? 2.85 : posterior ? 2.55 : canine ? 1.9 : 1.65;
  const colors: number[] = [];
  for (let vertex = 0; vertex < vertices.count; vertex++) {
    const horizontal = vertices.getX(vertex);
    const vertical = vertices.getY(vertex);
    const depth = vertices.getZ(vertex);
    const taper = .69 + .31 * Math.sin((vertical + 1) * Math.PI / 3);
    const exponent = posterior ? .65 : .58;
    const horizontalPosition = Math.sign(horizontal) * Math.pow(Math.abs(horizontal), exponent) * width * taper;
    const depthPosition = Math.sign(depth) * Math.pow(Math.abs(depth), posterior ? .65 : .9) * depthRadius * taper * (posterior ? 1 : 1 - .38 * Math.max(0, vertical));
    let height = vertical * 3.15 + 1.8;
    if (posterior && vertical > .5) {
      const cuspCenters = molar ? [[-1.15, -1.2], [1.1, -1.15], [-1.05, 1.2], [1.1, 1.05]] : [[0, -1.35], [0, 1.25]];
      const cusps = cuspCenters.reduce((sum, [horizontalCenter, depthCenter]) => sum + .75 * Math.exp(-((horizontalPosition - horizontalCenter) ** 2 + (depthPosition - depthCenter) ** 2) / .8), 0);
      const groove = .18 * Math.exp(-(horizontalPosition ** 2) / .1) + .12 * Math.exp(-(depthPosition ** 2) / .1);
      const blend = THREE.MathUtils.smoothstep(vertical, .5, .85);
      height = THREE.MathUtils.lerp(height, 4.3 + cusps - groove, blend);
    } else if (!posterior && vertical > .55) {
      const incisal = canine ? 4.48 + .54 * Math.exp(-(horizontalPosition ** 2) / .8) : 4.72 + .08 * Math.cos(horizontalPosition * 4);
      height = THREE.MathUtils.lerp(height, incisal, THREE.MathUtils.smoothstep(vertical, .55, .9));
    }
    vertices.setXYZ(vertex, horizontalPosition, height, depthPosition);
    const enamel = new THREE.Color('#f5efdf').lerp(new THREE.Color('#d6bd99'), Math.max(0, .35 - vertical) * .27);
    colors.push(enamel.r, enamel.g, enamel.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
export function shellPoint(index: number, horizontal: number, angle: number, thickness: number, outer = true) {
  const depth = 2.45 + .8 * THREE.MathUtils.smoothstep(Math.abs(index - 6.5), 2.3, 3.3);
  const offset = outer ? thickness : 0;
  const rise = Math.pow(Math.max(0, Math.cos(angle)), .55);
  const coordinate = index + horizontal / 4.3;
  const front = gingivalSurfaceHeight(coordinate, depth + offset) + .08;
  const back = gingivalSurfaceHeight(coordinate, -depth - offset) + .08;
  const margin = THREE.MathUtils.lerp(front, back, (Math.sin(angle) + 1) / 2);
  return new THREE.Vector3(horizontal, THREE.MathUtils.lerp(margin, 5.55 + offset, rise), -(depth + offset) * Math.sin(angle));
}


export function stopperGeometry(outerDiameter: number, innerDiameter: number, height: number, shape: number) {
  if (innerDiameter >= outerDiameter) return null;
  const outside = outerDiameter / 2;
  const inside = innerDiameter / 2;
  const topOutside = shape === 1 ? inside + (outside - inside) * .8 : outside;
  return new THREE.LatheGeometry([
    new THREE.Vector2(inside, 0), new THREE.Vector2(outside, 0),
    new THREE.Vector2(topOutside, height), new THREE.Vector2(inside, height), new THREE.Vector2(inside, 0),
  ], 64);
}
