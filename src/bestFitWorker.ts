import * as THREE from 'three';
import { bestFitRigid } from './bestFit';

/** Best Fit off the main thread, so the page keeps responding during a long ICP run. */
export type BestFitRequest = { source: Float32Array; target: Float32Array; sourceMatrix: number[] | null; targetMatrix: number[] | null };

self.onmessage = (event: MessageEvent<BestFitRequest>) => {
  const { source, target, sourceMatrix, targetMatrix } = event.data;
  const geometry = (positions: Float32Array) => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const matrix = (elements: number[] | null) => elements ? new THREE.Matrix4().fromArray(elements) : null;
  const result = bestFitRigid(geometry(source), geometry(target), { sourceMatrix: matrix(sourceMatrix), targetMatrix: matrix(targetMatrix) });
  self.postMessage(result ? { ...result, matrix: result.matrix.toArray() } : null);
};
