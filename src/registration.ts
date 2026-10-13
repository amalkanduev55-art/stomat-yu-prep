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

function isFinitePoint(point: THREE.Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

/** Any edit to picks invalidates a previously calculated transform. */
function invalidateResult(state: RegistrationState): Pick<RegistrationState, 'alignmentMatrix' | 'alignmentResult'> {
  return { alignmentMatrix: null, alignmentResult: null };
}

export function addScanPoint(state: RegistrationState, point: THREE.Vector3): RegistrationState {
  if (state.pickPhase !== 'scan' || !isFinitePoint(point)) return state;
  return {
    ...state,
    ...invalidateResult(state),
    scanPoints: [...state.scanPoints, point.clone()],
    pickPhase: 'guide',
    regStatus: 'picking',
    registrationMode: true,
  };
}

export function addGuidePoint(state: RegistrationState, point: THREE.Vector3): RegistrationState {
  if (state.pickPhase !== 'guide' || !isFinitePoint(point)) return state;
  return {
    ...state,
    ...invalidateResult(state),
    guidePoints: [...state.guidePoints, point.clone()],
    pickPhase: 'scan',
    regStatus: 'picking',
    registrationMode: true,
  };
}

/** Removes an unfinished scan pick, or the most recent complete pair. */
export function undoLastPair(state: RegistrationState): RegistrationState {
  if (state.scanPoints.length === 0 && state.guidePoints.length === 0) return state;

  if (state.scanPoints.length > state.guidePoints.length) {
    const scanPoints = state.scanPoints.slice(0, -1);
    return {
      ...state,
      ...invalidateResult(state),
      scanPoints,
      pickPhase: 'scan',
      regStatus: scanPoints.length || state.guidePoints.length ? 'picking' : 'idle',
      registrationMode: scanPoints.length > 0 || state.guidePoints.length > 0,
    };
  }

  const scanPoints = state.scanPoints.slice(0, -1);
  const guidePoints = state.guidePoints.slice(0, -1);
  const hasPoints = scanPoints.length > 0 || guidePoints.length > 0;
  return {
    ...state,
    ...invalidateResult(state),
    scanPoints,
    guidePoints,
    pickPhase: 'scan',
    regStatus: hasPoints ? 'picking' : 'idle',
    registrationMode: hasPoints,
  };
}

export function matrixIsFinite(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every(Number.isFinite);
}

/**
 * Compute rigid alignment: guide-local points -> stationary scan points.
 * Returns null on incomplete pairs, <3 points, degeneracy, non-finite result, or scaling.
 */
export function computeRegistration(
  guidePoints: THREE.Vector3[],
  scanPoints: THREE.Vector3[],
): AlignmentResult | null {
  if (guidePoints.length !== scanPoints.length || guidePoints.length < 3) return null;
  if (guidePoints.some(point => !isFinitePoint(point)) || scanPoints.some(point => !isFinitePoint(point))) return null;

  const res = alignPointsRigid(guidePoints, scanPoints);
  if (!res || !Number.isFinite(res.rmse) || !matrixIsFinite(res.matrix)) return null;

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  res.matrix.decompose(position, rotation, scale);
  if (
    Math.abs(scale.x - 1) > 1e-4 ||
    Math.abs(scale.y - 1) > 1e-4 ||
    Math.abs(scale.z - 1) > 1e-4 ||
    Math.abs(rotation.length() - 1) > 1e-4
  ) return null;

  return res;
}
