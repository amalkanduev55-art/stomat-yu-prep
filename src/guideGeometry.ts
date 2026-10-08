import * as THREE from 'three';
import { toothIds, toothPosition } from './geometry';
import { gingivalSurfaceHeight } from './gingivaGeometry';

type GuideSettings = { shaft: number; clearance: number; wall: number };
export type SlotCounts = Record<number, number>;

export function contactSlots(settings: GuideSettings, id: number) {
  const index = toothIds.indexOf(id);
  const width = settings.shaft + settings.clearance * 2;
  if (index < 0 || width > 4.05) return [];
  const mesial = index < 7 ? .5 : -.5;
  return [{ side: 'Мезиальный', delta: mesial }, { side: 'Дистальный', delta: -mesial }].flatMap(({ side, delta }) => {
    const coordinate = index + delta;
    if (coordinate < .5 || coordinate > toothIds.length - 1.5) return [];
    const first = toothIds[Math.floor(coordinate)];
    const second = toothIds[Math.ceil(coordinate)];
    return [{ side, coordinate, offset: delta * 4.3, left: coordinate - width / 8.6, right: coordinate + width / 8.6, key: `${first}-${second}`, label: `${first} ↔ ${second}` }];
  });
}

export function contactLayout(settings: GuideSettings, selected: number[]) {
  return [...new Map(selected.flatMap(id => contactSlots(settings, id)).map(slot => [slot.key, slot])).values()].sort((first, second) => first.coordinate - second.coordinate);
}

export function maximumSlotCount(settings: GuideSettings) {
  return Math.max(0, Math.min(6, Math.floor(4.55 / (settings.shaft + settings.clearance * 2 + .25))));
}

export function toothSlots(settings: GuideSettings, guide: number, id: number, counts: SlotCounts) {
  const index = toothIds.indexOf(id);
  const count = Math.max(0, Math.min(6, Math.round(counts[id] ?? 1)));
  const width = settings.shaft + settings.clearance * 2;
  if (index < 0 || !count || count > maximumSlotCount(settings)) return [];
  const span = count * width + (count - 1) * .25;
  const shift = guide === 2 ? Math.min(.25, Math.max(0, (4.3 - span) / 2)) : 0;
  return Array.from({ length: count }, (_, lane) => {
    const offset = (lane - (count - 1) / 2) * (width + .25) + shift;
    return { offset, left: index + (offset - width / 2) / 4.3, right: index + (offset + width / 2) / 4.3 };
  });
}

export function guideLayout(selected: number[]) {
  const working = [...new Set(selected.map(id => toothIds.indexOf(id)).filter(index => index >= 0))].sort((first, second) => first - second);
  if (!working.length) return { working, supports: [] as number[], covered: [] as number[] };
  const first = working[0];
  const last = working[working.length - 1];
  const supports = [first - 1, last + 1].filter(index => index >= 0 && index < toothIds.length);
  const start = Math.min(first, ...supports);
  const end = Math.max(last, ...supports);
  return { working, supports, covered: Array.from({ length: end - start + 1 }, (_, offset) => start + offset) };
}

export function guideDepth(coordinate: number) {
  return 2.45 + .8 * THREE.MathUtils.smoothstep(Math.abs(coordinate - 6.5), 2.3, 3.3);
}

export function guideSurfacePoint(coordinate: number, crossAngle: number, offset: number) {
  const depth = guideDepth(coordinate) + offset;
  const front = gingivalSurfaceHeight(coordinate, depth) + .08;
  const back = gingivalSurfaceHeight(coordinate, -depth) + .08;
  const margin = THREE.MathUtils.lerp(front, back, (Math.sin(crossAngle) + 1) / 2);
  const rise = Math.pow(Math.max(0, Math.cos(crossAngle)), .55);
  const angle = (coordinate - 6.5) * .215;
  const crossDepth = -depth * Math.sin(crossAngle);
  return new THREE.Vector3(Math.sin(angle) * (20 + crossDepth), THREE.MathUtils.lerp(margin, 5.55 + offset, rise), Math.cos(angle) * (21 + crossDepth) - 8);
}

export function unifiedGuideGeometry(settings: GuideSettings, guide: number, selected: number[], fragmentIndex?: number, slotCounts: SlotCounts = {}) {
  const layout = guideLayout(selected);
  if (!layout.working.length) return new THREE.BufferGeometry();
  const fragmentExtent = .6 + (settings.shaft + settings.clearance * 2) / 8.6;
  const start = fragmentIndex === undefined ? layout.covered[0] - .52 : fragmentIndex - fragmentExtent;
  const end = fragmentIndex === undefined ? layout.covered[layout.covered.length - 1] + .52 : fragmentIndex + fragmentExtent;
  const thickness = Math.min(1.2, Math.max(.25, settings.wall * .4));
  const slots = contactLayout(settings, fragmentIndex === undefined ? selected : [toothIds[fragmentIndex]]).map(slot => [slot.left, slot.right]);
  const boundaries = new Set([start, end, ...slots.flat()]);
  const segments = Math.ceil((end - start) * 18);
  for (let step = 0; step <= segments; step++) boundaries.add(start + (end - start) * step / segments);
  const columns = [...boundaries].filter(value => value >= start && value <= end).sort((first, second) => first - second).filter((value, index, array) => !index || value - array[index - 1] > .00001);
  const count = columns.length;
  const layerSize = count * 65;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let layer = 0; layer < 2; layer++) {
    const offset = layer === 0 ? thickness : 0;
    const margins = columns.map(coordinate => ({
      front: gingivalSurfaceHeight(coordinate, guideDepth(coordinate) + offset) + .08,
      back: gingivalSurfaceHeight(coordinate, -guideDepth(coordinate) - offset) + .08,
    }));
    for (let row = 0; row <= 64; row++) {
      const crossAngle = -Math.PI / 2 + Math.PI * row / 64;
      const rise = Math.pow(Math.max(0, Math.cos(crossAngle)), .55);
      for (let column = 0; column < columns.length; column++) {
        const coordinate = columns[column];
        const margin = THREE.MathUtils.lerp(margins[column].front, margins[column].back, (Math.sin(crossAngle) + 1) / 2);
        const height = THREE.MathUtils.lerp(margin, 5.55 + offset, rise);
        const angle = (coordinate - 6.5) * .215;
        const crossDepth = -(guideDepth(coordinate) + offset) * Math.sin(crossAngle);
        positions.push(Math.sin(angle) * (20 + crossDepth), height, Math.cos(angle) * (21 + crossDepth) - 8);
      }
    }
  }
  const active = (column: number, row: number) => {
    if (column < 0 || column >= count - 1 || row < 0 || row >= 64) return false;
    const center = (columns[column] + columns[column + 1]) / 2;
    return !(row >= 1 && row < 63 && slots.some(([left, right]) => center > left && center < right));
  };
  const face = (first: number, second: number, third: number, fourth: number) => indices.push(first, second, third, first, third, fourth);
  for (let row = 0; row < 64; row++) {
    for (let column = 0; column < count - 1; column++) {
      if (!active(column, row)) continue;
      const outer = [row * count + column, row * count + column + 1, (row + 1) * count + column + 1, (row + 1) * count + column];
      const inner = outer.map(vertex => vertex + layerSize);
      face(outer[0], outer[1], outer[2], outer[3]);
      face(inner[3], inner[2], inner[1], inner[0]);
      if (!active(column, row - 1)) face(outer[1], outer[0], inner[0], inner[1]);
      if (!active(column + 1, row)) face(outer[2], outer[1], inner[1], inner[2]);
      if (!active(column, row + 1)) face(outer[3], outer[2], inner[2], inner[3]);
      if (!active(column - 1, row)) face(outer[0], outer[3], inner[3], inner[0]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (fragmentIndex !== undefined) {
    const position = toothPosition(fragmentIndex);
    const transform = new THREE.Matrix4().makeRotationY(-(fragmentIndex - 6.5) * .215).multiply(new THREE.Matrix4().makeTranslation(-position[0], 0, -position[2]));
    geometry.applyMatrix4(transform);
  }
  return geometry;
}

export function exportGuide(settings: GuideSettings, guide: number, selected: number[], slotCounts: SlotCounts = {}) {
  const group = new THREE.Group();
  if (!selected.length) return group;
  group.add(new THREE.Mesh(unifiedGuideGeometry(settings, guide, selected, undefined, slotCounts), new THREE.MeshStandardMaterial()));
  group.updateMatrixWorld(true);
  return group;
}

export function scanBaseGeometry() {
  const shape = new THREE.Shape();
  for (let step = 0; step <= 100; step++) {
    const angle = -1.63 + 3.26 * step / 100;
    const horizontal = Math.sin(angle) * 25;
    const depth = Math.cos(angle) * 26 - 8;
    if (!step) shape.moveTo(horizontal, depth); else shape.lineTo(horizontal, depth);
  }
  for (let step = 100; step >= 0; step--) {
    const angle = -1.63 + 3.26 * step / 100;
    shape.lineTo(Math.sin(angle) * 15, Math.cos(angle) * 16 - 8);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: true, bevelThickness: .65, bevelSize: .8, bevelSegments: 4, steps: 1 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, -2.7, 0);
  return geometry;
}
