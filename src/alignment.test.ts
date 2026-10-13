import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { alignPointsRigid } from './alignment';

function randomRotation(): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
  ));
  return new THREE.Matrix4().makeRotationFromQuaternion(q);
}

function applyRigid(pts: THREE.Vector3[], m: THREE.Matrix4): THREE.Vector3[] {
  return pts.map(p => p.clone().applyMatrix4(m));
}

const basePoints: THREE.Vector3[] = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(10, 0, 0),
  new THREE.Vector3(0, 10, 0),
  new THREE.Vector3(0, 0, 10),
  new THREE.Vector3(5, 5, 5),
];

describe('alignPointsRigid', () => {
  it('identity', () => {
    const res = alignPointsRigid(basePoints, basePoints);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-6);
    expect(Math.abs(res!.matrix.determinant() - 1)).toBeLessThan(1e-4);
  });

  it('pure translation', () => {
    const t = new THREE.Matrix4().makeTranslation(3, -2, 7);
    const target = applyRigid(basePoints, t);
    const res = alignPointsRigid(basePoints, target);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-5);
    const recovered = basePoints[0].clone().applyMatrix4(res!.matrix);
    expect(recovered.distanceTo(target[0])).toBeLessThan(1e-4);
  });

  it('pure rotation', () => {
    const r = randomRotation();
    const target = applyRigid(basePoints, r);
    const res = alignPointsRigid(basePoints, target);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-4);
    expect(Math.abs(res!.matrix.determinant() - 1)).toBeLessThan(1e-3);
  });

  it('rotation + translation', () => {
    const m = randomRotation().setPosition(4, -1, 2);
    const target = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, target);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-4);
    for (let i = 0; i < basePoints.length; i++) {
      const rec = basePoints[i].clone().applyMatrix4(res!.matrix);
      expect(rec.distanceTo(target[i])).toBeLessThan(1e-3);
    }
  });

  it('multiple random rigid transforms', () => {
    for (let k = 0; k < 8; k++) {
      const m = randomRotation().setPosition(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      const target = applyRigid(basePoints, m);
      const res = alignPointsRigid(basePoints, target);
      expect(res).not.toBeNull();
      expect(res!.rmse).toBeLessThan(1e-3);
    }
  });

  it('no scaling', () => {
    const m = randomRotation().setPosition(1, 2, 3);
    const target = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, target)!;
    const scale = new THREE.Vector3();
    res.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1, 4);
    expect(scale.y).toBeCloseTo(1, 4);
    expect(scale.z).toBeCloseTo(1, 4);
  });

  it('no reflection (det ≈ +1)', () => {
    const m = randomRotation();
    const target = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, target)!;
    const det = res.matrix.determinant();
    expect(det).toBeGreaterThan(0.99);
    expect(det).toBeLessThan(1.01);
  });

  it('too few points returns null', () => {
    expect(alignPointsRigid(basePoints.slice(0, 2), basePoints.slice(0, 2))).toBeNull();
    expect(alignPointsRigid([], [])).toBeNull();
  });

  it('mismatched lengths returns null', () => {
    expect(alignPointsRigid(basePoints, basePoints.slice(0, 3))).toBeNull();
  });

  it('non-finite coordinates returns null', () => {
    const bad = basePoints.map(p => p.clone());
    bad[0].x = NaN;
    expect(alignPointsRigid(bad, basePoints)).toBeNull();
    bad[0].x = Infinity;
    expect(alignPointsRigid(bad, basePoints)).toBeNull();
  });

  it('collinear points returns null', () => {
    const col = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(3, 0, 0),
    ];
    expect(alignPointsRigid(col, col)).toBeNull();
  });

  it('nearly coincident points returns null', () => {
    const near = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1e-8, 0, 0),
      new THREE.Vector3(0, 1e-8, 0),
      new THREE.Vector3(0, 0, 1e-8),
    ];
    expect(alignPointsRigid(near, near)).toBeNull();
  });

  it('small noise produces reasonable RMSE', () => {
    const m = randomRotation().setPosition(1, 0, -1);
    const target = applyRigid(basePoints, m).map(p => p.add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
    )));
    const res = alignPointsRigid(basePoints, target);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(0.3);
    expect(res!.rmse).toBeGreaterThan(0);
  });

  it('order of pairs does not matter', () => {
    const m = randomRotation().setPosition(2, 3, -1);
    const target = applyRigid(basePoints, m);
    const order = [4, 1, 3, 0, 2];
    const srcPerm = order.map(i => basePoints[i]);
    const tgtPerm = order.map(i => target[i]);
    const res1 = alignPointsRigid(basePoints, target)!;
    const res2 = alignPointsRigid(srcPerm, tgtPerm)!;
    // Apply both matrices to a test point and compare
    const test = new THREE.Vector3(1, 2, 3);
    const a = test.clone().applyMatrix4(res1.matrix);
    const b = test.clone().applyMatrix4(res2.matrix);
    expect(a.distanceTo(b)).toBeLessThan(1e-3);
  });

  it('direction: source->target, not reverse', () => {
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 3).setPosition(5, 0, 0);
    const target = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, target)!;
    const wrong = alignPointsRigid(target, basePoints)!;
    // Correct direction should map source[0] close to target[0]
    const correct = basePoints[0].clone().applyMatrix4(res.matrix);
    expect(correct.distanceTo(target[0])).toBeLessThan(1e-3);
    // Reverse should not be the same as forward
    const rev = basePoints[0].clone().applyMatrix4(wrong.matrix);
    expect(rev.distanceTo(target[0])).toBeGreaterThan(1);
  });
});
