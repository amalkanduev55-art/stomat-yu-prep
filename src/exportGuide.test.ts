import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { unifiedGuideGeometry } from './guideGeometry';
import {
  GUIDE_BODY_NAME,
  findGuideBody,
  prepareGuideGeometryForExport,
  triangleCount,
  snapshotPositions,
} from './exportGuide';
import { computeRegistration } from './registration';

const settings = { shaft: 1.2, clearance: 0.15, wall: 1.5 };
const selected = [33, 32, 31];

function makeScene(alignment?: THREE.Matrix4) {
  const frame = new THREE.Group();
  frame.name = 'guide-frame';
  if (alignment) {
    frame.matrix.copy(alignment);
    frame.matrixAutoUpdate = false;
  }

  // distractor mesh that would be picked if we only took children[0]
  const distractor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  distractor.name = 'bur-visual';
  frame.add(distractor);

  const bodyGeom = unifiedGuideGeometry(settings, 1, selected);
  const body = new THREE.Mesh(bodyGeom);
  body.name = GUIDE_BODY_NAME;
  frame.add(body);

  frame.updateMatrixWorld(true);
  return { frame, body, bodyGeom, distractor };
}

describe('export guide body selection and preparation', () => {
  it('finds guide body by name even when it is not the first child', () => {
    const { frame, body } = makeScene();
    const found = findGuideBody(frame);
    expect(found).toBe(body);
    expect(found!.name).toBe(GUIDE_BODY_NAME);
  });

  it('prepareGuideGeometryForExport applies matrixWorld once, keeps finite coords and triangles', () => {
    const alignment = new THREE.Matrix4().makeRotationZ(0.3).setPosition(5, -2, 1);
    const { frame, body, bodyGeom } = makeScene(alignment);
    const original = snapshotPositions(bodyGeom);

    const prepared = prepareGuideGeometryForExport(body);
    expect(prepared).not.toBeNull();
    expect(triangleCount(prepared!)).toBeGreaterThan(0);

    const pos = prepared!.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }

    // original scene geometry unchanged
    const after = bodyGeom.getAttribute('position');
    for (let i = 0; i < original.length; i++) {
      expect(after.array[i]).toBe(original[i]);
    }

    // second export does not accumulate
    const prepared2 = prepareGuideGeometryForExport(body);
    expect(prepared2).not.toBeNull();
    const p1 = prepared!.getAttribute('position');
    const p2 = prepared2!.getAttribute('position');
    expect(p1.count).toBe(p2.count);
    for (let i = 0; i < Math.min(9, p1.count * 3); i++) {
      expect(p2.array[i]).toBeCloseTo(p1.array[i], 6);
    }
  });

  it('exported geometry matches registration transform (guide local -> scan)', () => {
    const localPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(8, 0, 0),
      new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(2, 3, 0),
    ];
    const rigid = new THREE.Matrix4().makeRotationY(0.25).setPosition(4, 1, -2);
    const scanPts = localPts.map(p => p.clone().applyMatrix4(rigid));
    const res = computeRegistration(localPts, scanPts);
    expect(res).not.toBeNull();

    const { body, bodyGeom } = makeScene(res!.matrix);
    const prepared = prepareGuideGeometryForExport(body)!;

    // a known local vertex of the body, transformed by the same matrix, should match prepared
    const local = new THREE.Vector3().fromBufferAttribute(bodyGeom.getAttribute('position'), 0);
    const expected = local.clone().applyMatrix4(res!.matrix);
    const actual = new THREE.Vector3().fromBufferAttribute(prepared.getAttribute('position'), 0);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-4);
  });

  it('unified guide geometry contains wall/slot faces (not only lines)', () => {
    const geom = unifiedGuideGeometry(settings, 1, selected);
    expect(triangleCount(geom)).toBeGreaterThan(10);
    expect(geom.getAttribute('position').count).toBeGreaterThan(20);
  });
});
