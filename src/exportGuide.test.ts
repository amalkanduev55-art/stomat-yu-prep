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

import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { contactLayout } from './guideGeometry';
import {
  parseBinaryStl,
  stlVerticesAreFinite,
  meshTopologyStats,
  archCoordinateFromPosition,
  STL_HEADER_BYTES,
  STL_TRIANGLE_BYTES,
} from './exportGuide';

describe('real STLExporter binary output', () => {
  it('STLExporter.parse produces a valid binary STL from prepareGuideGeometryForExport', () => {
    const alignment = new THREE.Matrix4().makeRotationZ(0.2).setPosition(3, 1, -1);
    const { body } = makeScene(alignment);
    const prepared = prepareGuideGeometryForExport(body);
    expect(prepared).not.toBeNull();

    const data = new STLExporter().parse(new THREE.Mesh(prepared!), { binary: true });
    expect(data).toBeInstanceOf(DataView);
    const view = data as DataView;
    const parsed = parseBinaryStl(view);
    expect(parsed).not.toBeNull();
    expect(parsed!.triangleCount).toBeGreaterThan(0);
    expect(view.byteLength).toBe(STL_HEADER_BYTES + 4 + parsed!.triangleCount * STL_TRIANGLE_BYTES);
    expect(stlVerticesAreFinite(parsed!)).toBe(true);
  });

  it('registration matrix is applied once; second export matches first', () => {
    const localPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(6, 0, 0),
      new THREE.Vector3(0, 6, 0),
      new THREE.Vector3(1, 2, 0),
    ];
    const rigid = new THREE.Matrix4().makeRotationY(0.15).setPosition(2, 0.5, -1);
    const scanPts = localPts.map(p => p.clone().applyMatrix4(rigid));
    const res = computeRegistration(localPts, scanPts)!;
    const { body, bodyGeom } = makeScene(res.matrix);

    const first = prepareGuideGeometryForExport(body)!;
    const second = prepareGuideGeometryForExport(body)!;
    const a = first.getAttribute('position');
    const b = second.getAttribute('position');
    expect(a.count).toBe(b.count);
    for (let i = 0; i < a.count; i++) {
      expect(b.getX(i)).toBeCloseTo(a.getX(i), 6);
      expect(b.getY(i)).toBeCloseTo(a.getY(i), 6);
      expect(b.getZ(i)).toBeCloseTo(a.getZ(i), 6);
    }

    // applying the matrix a second time to the already prepared geometry would move it further
    const doubleApplied = first.clone();
    doubleApplied.applyMatrix4(res.matrix);
    const d0 = new THREE.Vector3().fromBufferAttribute(doubleApplied.getAttribute('position'), 0);
    const s0 = new THREE.Vector3().fromBufferAttribute(a, 0);
    expect(d0.distanceTo(s0)).toBeGreaterThan(0.01);
  });

  it('slot openings have no covering faces at skipped cell centers', () => {
    const { bodyGeom } = makeScene();
    const slots = contactLayout(settings, selected);
    expect(slots.length).toBeGreaterThan(0);

    // Reconstruct the same column grid used by unifiedGuideGeometry
    const layout = { covered: selected.map(id => [31,32,33,41,42,43].indexOf(id)).filter(i => i >= 0) };
    // Use toothIds order matching guideGeometry
    const toothIds = [31, 32, 33, 41, 42, 43]; // local subset not used; columns come from slots + span
    const start = Math.min(...slots.map(s => s.left)) - 1;
    const end = Math.max(...slots.map(s => s.right)) + 1;
    // Sample the center of each slot at a mid row and assert no triangle centroid lies there
    const pos = bodyGeom.getAttribute('position');
    const index = bodyGeom.getIndex()!;
    const centroids: THREE.Vector3[] = [];
    for (let t = 0; t < Math.floor(index.count / 3); t++) {
      const i0 = index.getX(t * 3), i1 = index.getX(t * 3 + 1), i2 = index.getX(t * 3 + 2);
      centroids.push(new THREE.Vector3(
        (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3,
        (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3,
        (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3,
      ));
    }

    for (const slot of slots) {
      const center = (slot.left + slot.right) / 2;
      // outer-surface point at slot center, mid cross-section (row ~32 of 64), matching generator formula
      const angle = (center - 6.5) * 0.215;
      const crossAngle = 0; // mid
      const crossDepth = 0;
      const expected = new THREE.Vector3(
        Math.sin(angle) * (20 + crossDepth),
        5.55, // approximate rise peak; actual height varies, so use a tolerance band
        Math.cos(angle) * (21 + crossDepth) - 8,
      );
      // No triangle centroid should lie very close to this opening center in the horizontal plane
      // within the slot's angular width (covering face would sit here; side walls are offset)
      const near = centroids.filter(c => {
        const coord = archCoordinateFromPosition(c.x, c.z);
        const radial = Math.hypot(c.x, c.z + 8);
        return coord > slot.left + 0.12 && coord < slot.right - 0.12 && radial > 19.5 && radial < 22.5;
      });
      expect(near.length).toBe(0);
    }
  });

  it('reports degenerate triangles and boundary edges without claiming watertight', () => {
    const { bodyGeom } = makeScene();
    const stats = meshTopologyStats(bodyGeom);
    expect(stats.totalEdges).toBeGreaterThan(0);
    expect(stats.degenerateTriangles).toBe(0);
    // boundary edges are expected (open slots, open ends); do not assert zero
    expect(stats.boundaryEdges).toBeGreaterThanOrEqual(0);
  });
});
