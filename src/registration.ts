import * as THREE from 'three';
import { alignPointsRigid, type AlignmentResult } from './alignment';

export type RegStatus = 'idle' | 'picking' | 'ready' | 'done' | 'error';
export type PickPhase = 'scan' | 'guide';

export type RegistrationState = {
  alignmentMatrix: THREE.Matrix4 | null;
  alignmentResult: AlignmentResult | null;
  scanPoints: THREE.Vector3[];
  guidePoints: THREE.Vector3[];
  registrationMode: boolean;
  regStatus: RegStatus;
  pickPhase: PickPhase;
};

export function emptyRegistration(): RegistrationState {
  return {
    alignmentMatrix: null,
    alignmentResult: null,
    scanPoints: [],
    guidePoints: [],
    registrationMode: false,
    regStatus: 'idle',
    pickPhase: 'scan',
  };
}

/** Reset used when Original or Target model is loaded/replaced. */
export function resetRegistrationState(): RegistrationState {
  return emptyRegistration();
}

export function pairCount(state: RegistrationState): number {
  return Math.min(state.scanPoints.length, state.guidePoints.length);
}

export function hasIncompletePair(state: RegistrationState): boolean {
  return state.scanPoints.length !== state.guidePoints.length;
}

export function canCompute(state: RegistrationState): boolean {
  return !hasIncompletePair(state) && pairCount(state) >= 3;
}

export function addScanPoint(state: RegistrationState, point: THREE.Vector3): RegistrationState {
  if (state.pickPhase !== 'scan') return state;
  return {
    ...state,
    scanPoints: [...state.scanPoints, point.clone()],
    pickPhase: 'guide',
    regStatus: 'picking',
    registrationMode: true,
  };
}

export function addGuidePoint(state: RegistrationState, point: THREE.Vector3): RegistrationState {
  if (state.pickPhase !== 'guide') return state;
  return {
    ...state,
    guidePoints: [...state.guidePoints, point.clone()],
    pickPhase: 'scan',
    regStatus: 'picking',
    registrationMode: true,
  };
}

export function undoLastPair(state: RegistrationState): RegistrationState {
  if (state.scanPoints.length === 0 && state.guidePoints.length === 0) return state;
  if (state.scanPoints.length > state.guidePoints.length) {
    return {
      ...state,
      scanPoints: state.scanPoints.slice(0, -1),
      pickPhase: 'scan',
      regStatus: 'picking',
    };
  }
  return {
    ...state,
    scanPoints: state.scanPoints.slice(0, -1),
    guidePoints: state.guidePoints.slice(0, -1),
    pickPhase: 'scan',
    regStatus: state.scanPoints.length > 1 ? 'picking' : 'idle',
  };
}

export function matrixIsFinite(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every(e => Number.isFinite(e));
}

/**
 * Compute rigid alignment: guide local points -> stationary scan points.
 * Returns null on incomplete pairs, <3 points, degeneracy, non-finite result, or scaling.
 */
export function computeRegistration(
  guidePoints: THREE.Vector3[],
  scanPoints: THREE.Vector3[],
): AlignmentResult | null {
  if (guidePoints.length !== scanPoints.length || guidePoints.length < 3) return null;
  const res = alignPointsRigid(guidePoints, scanPoints);
  if (!res) return null;
  if (!Number.isFinite(res.rmse)) return null;
  if (!matrixIsFinite(res.matrix)) return null;
  const scale = new THREE.Vector3();
  res.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  if (Math.abs(scale.x - 1) > 1e-4 || Math.abs(scale.y - 1) > 1e-4 || Math.abs(scale.z - 1) > 1e-4) return null;
  return res;
}
