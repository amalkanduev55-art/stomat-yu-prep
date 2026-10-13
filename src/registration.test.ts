import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  emptyRegistration,
  resetRegistrationState,
  addScanPoint,
  addGuidePoint,
  undoLastPair,
  canCompute,
  hasIncompletePair,
  computeRegistration,
  matrixIsFinite,
} from './registration';

function applyRigid(pts: THREE.Vector3[], m: THREE.Matrix4): THREE.Vector3[] {
  return pts.map(p => p.clone().applyMatrix4(m));
}

describe('registration reset', () => {
  it('resetRegistrationState clears matrix, points, mode and status', () => {
    const dirty = {
      ...emptyRegistration(),
      alignmentMatrix: new THREE.Matrix4().makeTranslation(1, 2, 3),
      scanPoints: [new THREE.Vector3(1, 0, 0)],
      guidePoints: [new THREE.Vector3(0, 1, 0)],
      registrationMode: true,
      regStatus: 'done' as const,
      pickPhase: 'guide' as const,
    };
    const reset = resetRegistrationState();
    expect(reset.alignmentMatrix).toBeNull();
    expect(reset.alignmentResult).toBeNull();
    expect(reset.scanPoints).toEqual([]);
    expect(reset.guidePoints).toEqual([]);
    expect(reset.registrationMode).toBe(false);
    expect(reset.regStatus).toBe('idle');
    expect(reset.pickPhase).toBe('scan');
    // previous state object is not mutated in a way that keeps the matrix
    expect(dirty.alignmentMatrix).not.toBeNull();
  });

  it('re-import simulation: after reset, previous matrix is not active', () => {
    const prev = new THREE.Matrix4().makeRotationY(0.5).setPosition(10, 0, 0);
    const state = resetRegistrationState();
    expect(state.alignmentMatrix).toBeNull();
    expect(state.alignmentMatrix).not.toBe(prev);
  });
});

describe('sequential pair picking', () => {
  it('requires scan then guide, displays pair progression, allows undo', () => {
    let s = emptyRegistration();
    expect(s.pickPhase).toBe('scan');
    s = addScanPoint(s, new THREE.Vector3(0, 0, 0));
    expect(s.scanPoints).toHaveLength(1);
    expect(s.pickPhase).toBe('guide');
    expect(hasIncompletePair(s)).toBe(true);
    expect(canCompute(s)).toBe(false);
    // second scan point ignored while waiting for guide
    s = addScanPoint(s, new THREE.Vector3(9, 9, 9));
    expect(s.scanPoints).toHaveLength(1);
    s = addGuidePoint(s, new THREE.Vector3(1, 0, 0));
    expect(s.guidePoints).toHaveLength(1);
    expect(s.pickPhase).toBe('scan');
    expect(hasIncompletePair(s)).toBe(false);
    s = undoLastPair(s);
    expect(s.scanPoints).toHaveLength(0);
    expect(s.guidePoints).toHaveLength(0);
    expect(s.pickPhase).toBe('scan');
  });

  it('undo removes incomplete scan point', () => {
    let s = addScanPoint(emptyRegistration(), new THREE.Vector3(1, 0, 0));
    s = undoLastPair(s);
    expect(s.scanPoints).toHaveLength(0);
    expect(s.pickPhase).toBe('scan');
  });
});

describe('computeRegistration direction and safety', () => {
  const base = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(0, 10, 0),
    new THREE.Vector3(2, 3, 0),
  ];

  it('maps guide local points onto stationary scan (no scaling)', () => {
    const m = new THREE.Matrix4().makeRotationZ(0.4).setPosition(5, -2, 1);
    const scan = applyRigid(base, m);
    const res = computeRegistration(base, scan);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.rmse)).toBe(true);
    expect(res!.rmse).toBeLessThan(1e-4);
    expect(matrixIsFinite(res!.matrix)).toBe(true);
    const scale = new THREE.Vector3();
    res!.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1, 4);
    expect(scale.y).toBeCloseTo(1, 4);
    expect(scale.z).toBeCloseTo(1, 4);
    // direction: guide point -> scan point
    const mapped = base[0].clone().applyMatrix4(res!.matrix);
    expect(mapped.distanceTo(scan[0])).toBeLessThan(1e-3);
  });

  it('rejects incomplete pairs and fewer than 3 points', () => {
    expect(computeRegistration(base.slice(0, 2), base.slice(0, 2))).toBeNull();
    expect(computeRegistration(base, base.slice(0, 3))).toBeNull();
  });

  it('rejects collinear configuration', () => {
    const col = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ];
    expect(computeRegistration(col, col)).toBeNull();
  });

  it('scan identity: applying result to guide does not imply moving scan', () => {
    const m = new THREE.Matrix4().makeTranslation(3, 0, 0);
    const scan = applyRigid(base, m);
    const res = computeRegistration(base, scan)!;
    // scan points themselves are unchanged inputs
    expect(scan[0].x).toBeCloseTo(3, 5);
    const movedGuide = base[1].clone().applyMatrix4(res.matrix);
    expect(movedGuide.distanceTo(scan[1])).toBeLessThan(1e-3);
  });
});

describe('export geometry after transform', () => {
  it('world matrix of transformed guide geometry is finite and matches alignment', () => {
    const base = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(4, 0, 0),
      new THREE.Vector3(0, 4, 0),
    ];
    const m = new THREE.Matrix4().makeRotationY(0.2).setPosition(1, 2, 3);
    const scan = applyRigid(base, m);
    const res = computeRegistration(base, scan)!;
    const geom = new THREE.BufferGeometry().setFromPoints(base);
    geom.applyMatrix4(res.matrix);
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }
    const p0 = new THREE.Vector3().fromBufferAttribute(pos, 0);
    expect(p0.distanceTo(scan[0])).toBeLessThan(1e-3);
  });
});

describe('registration result invalidation', () => {
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(0, 10, 0),
  ];

  it('clears calculated transform when a new scan point is picked', () => {
    let state = emptyRegistration();
    state = addScanPoint(state, points[0]);
    state = addGuidePoint(state, points[0]);
    state = addScanPoint(state, points[1]);
    state = addGuidePoint(state, points[1]);
    state = addScanPoint(state, points[2]);
    state = addGuidePoint(state, points[2]);
    const result = computeRegistration(state.guidePoints, state.scanPoints);
    expect(result).not.toBeNull();
    state = { ...state, alignmentMatrix: result!.matrix, alignmentResult: result, regStatus: 'done' };
    state = addScanPoint(state, new THREE.Vector3(4, 4, 4));
    expect(state.alignmentMatrix).toBeNull();
    expect(state.alignmentResult).toBeNull();
    expect(state.regStatus).toBe('picking');
  });

  it('clears calculated transform when undoing the last pair', () => {
    let state = emptyRegistration();
    state = addScanPoint(state, points[0]);
    state = addGuidePoint(state, points[0]);
    state = addScanPoint(state, points[1]);
    state = addGuidePoint(state, points[1]);
    state = addScanPoint(state, points[2]);
    state = addGuidePoint(state, points[2]);
    const result = computeRegistration(state.guidePoints, state.scanPoints);
    expect(result).not.toBeNull();
    state = { ...state, alignmentMatrix: result!.matrix, alignmentResult: result, regStatus: 'done', registrationMode: false };
    state = undoLastPair(state);
    expect(state.alignmentMatrix).toBeNull();
    expect(state.alignmentResult).toBeNull();
    expect(state.registrationMode).toBe(true);
    expect(state.regStatus).toBe('picking');
    expect(state.scanPoints).toHaveLength(2);
    expect(state.guidePoints).toHaveLength(2);
  });

  it('ignores non-finite picks', () => {
    const state = emptyRegistration();
    const invalid = addScanPoint(state, new THREE.Vector3(Number.NaN, 0, 0));
    expect(invalid).toBe(state);
    expect(invalid.scanPoints).toHaveLength(0);
  });
});
