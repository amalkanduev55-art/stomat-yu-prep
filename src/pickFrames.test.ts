import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  scanPointFromWorld,
  worldToGuideLocal,
  guideLocalToWorld,
  guideMarkersToWorld,
} from './pickFrames';

describe('registration coordinate frames', () => {
  it('clones finite scan points without changing their coordinates', () => {
    const point = new THREE.Vector3(1, 2, 3);
    const result = scanPointFromWorld(point);
    expect(result).not.toBeNull();
    expect(result).not.toBe(point);
    expect(result!.toArray()).toEqual([1, 2, 3]);
    expect(scanPointFromWorld(new THREE.Vector3(Number.NaN, 0, 0))).toBeNull();
  });

  it('round-trips world points through a translated and rotated guide frame', () => {
    const matrix = new THREE.Matrix4()
      .compose(
        new THREE.Vector3(12, -4, 8),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.6, 0.4)),
        new THREE.Vector3(1, 1, 1),
      );
    const local = new THREE.Vector3(2, 3, -5);
    const world = guideLocalToWorld(local, matrix);
    const recovered = worldToGuideLocal(world, matrix);
    expect(recovered).not.toBeNull();
    expect(recovered!.distanceTo(local)).toBeLessThan(1e-9);
  });

  it('rejects non-finite points and singular guide matrices', () => {
    expect(worldToGuideLocal(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0), new THREE.Matrix4())).toBeNull();
    const singular = new THREE.Matrix4().makeScale(1, 0, 1);
    expect(worldToGuideLocal(new THREE.Vector3(1, 2, 3), singular)).toBeNull();
  });

  it('converts all guide marker points consistently', () => {
    const matrix = new THREE.Matrix4().makeTranslation(10, 20, 30);
    const markers = [new THREE.Vector3(1, 2, 3), new THREE.Vector3(-1, 0, 4)];
    const world = guideMarkersToWorld(markers, matrix);
    expect(world.map(point => point.toArray())).toEqual([[11, 22, 33], [9, 20, 34]]);
    expect(markers[0].toArray()).toEqual([1, 2, 3]);
  });
});
