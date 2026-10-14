import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { alignPointsRigid } from './alignment';

function applyRigid(pts: THREE.Vector3[], m: THREE.Matrix4): THREE.Vector3[] {
  return pts.map(p => p.clone().applyMatrix4(m));
}

/** Fixed reproducible rotations (no Math.random). */
const fixedRotations: THREE.Matrix4[] = [
  new THREE.Matrix4().makeRotationX(Math.PI / 6),
  new THREE.Matrix4().makeRotationY(Math.PI / 4),
  new THREE.Matrix4().makeRotationZ(Math.PI / 3),
  new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, 0.7, 1.1)),
  new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(0.2, -0.3, 0.4, 0.8).normalize()),
];

const fixedTranslations: THREE.Vector3[] = [
  new THREE.Vector3(3, -2, 7),
  new THREE.Vector3(-5, 1, 0.5),
  new THREE.Vector3(0, 0, 10),
  new THREE.Vector3(1.25, -3.5, 2),
];

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

  it('pure rotation (fixed)', () => {
    for (const r of fixedRotations) {
      const target = applyRigid(basePoints, r);
      const res = alignPointsRigid(basePoints, target);
      expect(res).not.toBeNull();
      expect(res!.rmse).toBeLessThan(1e-4);
      expect(Math.abs(res!.matrix.determinant() - 1)).toBeLessThan(1e-3);
    }
  });

  it('180-degree orientation check around vertical Y axis with translation', () => {
    const expected = new THREE.Matrix4()
      .makeRotationY(Math.PI)
      .setPosition(4, -2, 7);
    const target = applyRigid(basePoints, expected);
    const res = alignPointsRigid(basePoints, target);

    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-4);
    expect(res!.matrix.determinant()).toBeCloseTo(1, 3);

    for (let i = 0; i < basePoints.length; i++) {
      const mapped = basePoints[i].clone().applyMatrix4(res!.matrix);
      expect(mapped.distanceTo(target[i])).toBeLessThan(1e-3);
    }

    const actualRotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().extractRotation(res!.matrix),
    );
    const expectedRotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().extractRotation(expected),
    );
    expect(actualRotation.angleTo(expectedRotation)).toBeLessThan(1e-4);
  });

  it('rotation + translation (fixed)', () => {
    for (const r of fixedRotations) {
      for (const t of fixedTranslations) {
        const m = r.clone().setPosition(t);
        const target = applyRigid(basePoints, m);
        const res = alignPointsRigid(basePoints, target);
        expect(res).not.toBeNull();
        expect(res!.rmse).toBeLessThan(1e-4);
        for (let i = 0; i < basePoints.length; i++) {
          const rec = basePoints[i].clone().applyMatrix4(res!.matrix);
          expect(rec.distanceTo(target[i])).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('three non-collinear points', () => {
    const src = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ];
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 5).setPosition(2, 3, 0);
    const tgt = applyRigid(src, m);
    const res = alignPointsRigid(src, tgt);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-5);
  });

  it('four or more planar non-collinear points', () => {
    const src = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(1, 1, 0),
      new THREE.Vector3(0.5, 1.5, 0),
    ];
    const m = new THREE.Matrix4().makeRotationX(0.4).makeRotationY(0.2).setPosition(1, -1, 5);
    const tgt = applyRigid(src, m);
    const res = alignPointsRigid(src, tgt);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-4);
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

  it('nearly collinear points returns null', () => {
    const nearCol = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 1e-8, 0),
      new THREE.Vector3(3, -1e-8, 0),
    ];
    expect(alignPointsRigid(nearCol, nearCol)).toBeNull();
  });

  it('degenerate target configuration returns null (source valid)', () => {
    const src = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    const tgtCol = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(3, 0, 0),
    ];
    expect(alignPointsRigid(src, tgtCol)).toBeNull();
  });

  it('no scaling', () => {
    const m = fixedRotations[0].clone().setPosition(1, 2, 3);
    const target = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, target)!;
    const scale = new THREE.Vector3();
    res.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1, 4);
    expect(scale.y).toBeCloseTo(1, 4);
    expect(scale.z).toBeCloseTo(1, 4);
  });

  it('no reflection on proper rigid transforms', () => {
    for (const r of fixedRotations) {
      const target = applyRigid(basePoints, r);
      const res = alignPointsRigid(basePoints, target)!;
      const det = res.matrix.determinant();
      expect(det).toBeGreaterThan(0.99);
      expect(det).toBeLessThan(1.01);
    }
  });

  it('reflected correspondences are rejected or produce high residual', () => {
    // Create a reflected set: mirror over XY plane (z -> -z)
    const src = basePoints;
    const reflected = src.map(p => new THREE.Vector3(p.x, p.y, -p.z));
    const res = alignPointsRigid(src, reflected);
    // Should either return null or a result with significant residual (not a perfect match)
    if (res !== null) {
      expect(res.rmse).toBeGreaterThan(1);
      // And matrix must still be a proper rotation (det ≈ +1)
      expect(res.matrix.determinant()).toBeGreaterThan(0.99);
    }
  });

  it('small and large coordinate scales', () => {
    const scales = [1e-3, 1, 1e3, 1e6];
    for (const s of scales) {
      const src = basePoints.map(p => p.clone().multiplyScalar(s));
      const m = fixedRotations[1].clone().setPosition(s * 0.5, -s * 0.2, s * 0.1);
      const tgt = applyRigid(src, m);
      const res = alignPointsRigid(src, tgt);
      expect(res).not.toBeNull();
      expect(res!.rmse / s).toBeLessThan(1e-4); // relative error
      expect(Number.isFinite(res!.rmse)).toBe(true);
    }
  });

  it('finite RMSE and correct direction', () => {
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 3).setPosition(5, 0, 0);
    const target = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, target);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.rmse)).toBe(true);
    expect(res!.rmse).toBeLessThan(1e-4);

    // Direction: source -> target
    const mapped = basePoints[0].clone().applyMatrix4(res!.matrix);
    expect(mapped.distanceTo(target[0])).toBeLessThan(1e-3);

    // Reverse should not map correctly
    const reverse = alignPointsRigid(target, basePoints);
    if (reverse) {
      const revMapped = basePoints[0].clone().applyMatrix4(reverse.matrix);
      expect(revMapped.distanceTo(target[0])).toBeGreaterThan(1);
    }
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

  it('nearly coincident / tiny scale with good relative geometry still works', () => {
    const near = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1e-8, 0, 0),
      new THREE.Vector3(0, 1e-8, 0),
      new THREE.Vector3(0, 0, 1e-8),
    ];
    // Relative geometry is fine (tetrahedron), so should succeed at any absolute scale
    const res = alignPointsRigid(near, near);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-15);
  });


  it('Jacobi: symmetric matrix with tau===0 and non-zero off-diagonal', () => {
    // Matrix where a_qq === a_pp for a pair, so tau=0, but apq != 0
    // Should still zero the off-diagonal correctly
    const src = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ];
    // Rotation that can produce such intermediate state; just verify end-to-end
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 4);
    const tgt = applyRigid(src, m);
    const res = alignPointsRigid(src, tgt);
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-6);
    expect(Number.isFinite(res!.rmse)).toBe(true);
  });

  it('correct alignment at small scales with non-zero rotation', () => {
    // 1e-6 and smaller hit double-precision limits in the covariance/Horn matrix (entries ~1e-12)
    const scales = [1e-4, 1e-3, 1e-2];
    for (const s of scales) {
      const src = [
        new THREE.Vector3(0, 0, 0).multiplyScalar(s),
        new THREE.Vector3(1, 0, 0).multiplyScalar(s),
        new THREE.Vector3(0, 1, 0).multiplyScalar(s),
        new THREE.Vector3(0.3, 0.4, 0).multiplyScalar(s),
      ];
      const m = new THREE.Matrix4().makeRotationZ(0.7).setPosition(s * 0.1, -s * 0.05, 0);
      const tgt = applyRigid(src, m);
      const res = alignPointsRigid(src, tgt);
      expect(res).not.toBeNull();
      expect(res!.rmse / s).toBeLessThan(1e-5);
      expect(Number.isFinite(res!.matrix.elements[0])).toBe(true);
    }
  });

  it('correct alignment at large scales', () => {
    const scales = [1e3, 1e5, 1e7];
    for (const s of scales) {
      const src = basePoints.map(p => p.clone().multiplyScalar(s));
      const m = fixedRotations[0].clone().setPosition(s * 2, -s * 1, s * 0.5);
      const tgt = applyRigid(src, m);
      const res = alignPointsRigid(src, tgt);
      expect(res).not.toBeNull();
      expect(res!.rmse / s).toBeLessThan(1e-4);
      expect(Number.isFinite(res!.rmse)).toBe(true);
    }
  });

  it('preserves three non-collinear and planar support after Jacobi fix', () => {
    const three = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(0, 3, 0),
    ];
    const m3 = new THREE.Matrix4().makeRotationY(0.5).setPosition(1, 1, 1);
    expect(alignPointsRigid(three, applyRigid(three, m3))!.rmse).toBeLessThan(1e-5);

    const planar = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(4, 0, 0),
      new THREE.Vector3(0, 4, 0),
      new THREE.Vector3(1, 2, 0),
      new THREE.Vector3(3, 1, 0),
    ];
    const mp = new THREE.Matrix4().makeRotationX(0.3).setPosition(-2, 0, 5);
    expect(alignPointsRigid(planar, applyRigid(planar, mp))!.rmse).toBeLessThan(1e-4);
  });

  it('still rejects collinear and near-collinear after Jacobi fix', () => {
    const col = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(10, 0, 0),
    ];
    expect(alignPointsRigid(col, col)).toBeNull();

    const near = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 1e-9, 0),
      new THREE.Vector3(3, -2e-9, 0),
    ];
    expect(alignPointsRigid(near, near)).toBeNull();
  });

  it('finite matrix and RMSE on valid inputs', () => {
    const m = fixedRotations[2].clone().setPosition(10, -5, 2);
    const tgt = applyRigid(basePoints, m);
    const res = alignPointsRigid(basePoints, tgt)!;
    expect(Number.isFinite(res.rmse)).toBe(true);
    for (const e of res.matrix.elements) {
      expect(Number.isFinite(e)).toBe(true);
    }
  });


  it('Jacobi scale-invariant: zero diagonals with non-zero off-diagonals still converge', () => {
    // Indirect test via alignment that exercises the solver on well-conditioned data
    const src = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ];
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const res = alignPointsRigid(src, applyRigid(src, m));
    expect(res).not.toBeNull();
    expect(res!.rmse).toBeLessThan(1e-8);
    expect(Number.isFinite(res!.rmse)).toBe(true);
  });

  it('rigid alignment with non-zero rotation across multiple scales (including <1e-4)', () => {
    // Scales where double precision still permits accurate relative error
    const scales = [1e-5, 1e-4, 1e-2, 1, 1e2, 1e4];
    const angles = [0.3, Math.PI / 4, 1.2];
    for (const s of scales) {
      for (const ang of angles) {
        const src = [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0.2, 0.3, 0),
        ].map(p => p.multiplyScalar(s));
        const m = new THREE.Matrix4().makeRotationZ(ang).setPosition(s * 0.15, -s * 0.08, 0);
        const tgt = applyRigid(src, m);
        const res = alignPointsRigid(src, tgt);
        expect(res).not.toBeNull();
        const rel = res!.rmse / s;
        expect(rel).toBeLessThan(1e-5);
        expect(Number.isFinite(res!.rmse)).toBe(true);
        for (const e of res!.matrix.elements) {
          expect(Number.isFinite(e)).toBe(true);
        }
      }
    }
  });

  it('order of pairs does not matter', () => {
    const m = fixedRotations[2].clone().setPosition(2, 3, -1);
    const target = applyRigid(basePoints, m);
    const order = [4, 1, 3, 0, 2];
    const srcPerm = order.map(i => basePoints[i]);
    const tgtPerm = order.map(i => target[i]);
    const res1 = alignPointsRigid(basePoints, target)!;
    const res2 = alignPointsRigid(srcPerm, tgtPerm)!;
    const test = new THREE.Vector3(1, 2, 3);
    const a = test.clone().applyMatrix4(res1.matrix);
    const b = test.clone().applyMatrix4(res2.matrix);
    expect(a.distanceTo(b)).toBeLessThan(1e-3);
  });
});

