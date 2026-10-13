import * as THREE from 'three';

/** Stable name of the printable guide body mesh inside guide-frame. */
export const GUIDE_BODY_NAME = 'guide-body';

/**
 * Find the guide body mesh by stable name.
 * Falls back to the single Mesh child only if exactly one exists (legacy scenes).
 * Does not select bur, stopper, or line visuals.
 */
export function findGuideBody(frame: THREE.Object3D): THREE.Mesh | null {
  const named = frame.getObjectByName(GUIDE_BODY_NAME);
  if (named instanceof THREE.Mesh && named.geometry) return named;

  const meshes: THREE.Mesh[] = [];
  for (const child of frame.children) {
    if (child instanceof THREE.Mesh && child.geometry && child.name !== 'bur' && child.name !== 'stopper') {
      meshes.push(child);
    }
  }
  return meshes.length === 1 ? meshes[0] : null;
}

/**
 * Prepare a clone of the guide body geometry in world coordinates for STL export.
 * - Updates world matrices of the body.
 * - Clones geometry (does not mutate the scene geometry).
 * - Applies matrixWorld exactly once.
 * - Returns null if coordinates are non-finite or geometry is empty.
 */
export function prepareGuideGeometryForExport(body: THREE.Mesh): THREE.BufferGeometry | null {
  body.updateMatrixWorld(true);
  const geometry = body.geometry.clone();
  geometry.applyMatrix4(body.matrixWorld);

  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) {
    geometry.dispose();
    return null;
  }
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      geometry.dispose();
      return null;
    }
  }
  return geometry;
}

/** Triangle count of an indexed or non-indexed BufferGeometry. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const pos = geometry.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Snapshot of original local positions for mutation checks.
 */
export function snapshotPositions(geometry: THREE.BufferGeometry): Float32Array {
  const pos = geometry.getAttribute('position');
  return new Float32Array(pos.array as ArrayLike<number>);
}


/** Binary STL header size (bytes). */
export const STL_HEADER_BYTES = 80;
/** Bytes per triangle in binary STL (normal + 3 verts + attribute). */
export const STL_TRIANGLE_BYTES = 50;

export type ParsedBinaryStl = {
  triangleCount: number;
  vertices: Float32Array; // xyz interleaved, 9 floats per triangle
};

/**
 * Parse a binary STL DataView / ArrayBuffer produced by STLExporter.parse({binary:true}).
 * Returns null if the buffer is too small or the declared count does not match the payload size.
 */
export function parseBinaryStl(data: ArrayBuffer | DataView): ParsedBinaryStl | null {
  const buffer = data instanceof DataView ? data.buffer : data;
  const view = new DataView(buffer);
  if (view.byteLength < STL_HEADER_BYTES + 4) return null;
  const triangleCount = view.getUint32(STL_HEADER_BYTES, true);
  const expected = STL_HEADER_BYTES + 4 + triangleCount * STL_TRIANGLE_BYTES;
  if (triangleCount === 0 || view.byteLength !== expected) return null;
  const vertices = new Float32Array(triangleCount * 9);
  let offset = STL_HEADER_BYTES + 4;
  let vi = 0;
  for (let t = 0; t < triangleCount; t++) {
    offset += 12; // skip normal
    for (let k = 0; k < 9; k++) {
      vertices[vi++] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // attribute
  }
  return { triangleCount, vertices };
}

export function stlVerticesAreFinite(parsed: ParsedBinaryStl): boolean {
  for (let i = 0; i < parsed.vertices.length; i++) {
    if (!Number.isFinite(parsed.vertices[i])) return false;
  }
  return true;
}

/**
 * Count degenerate triangles (area below epsilon) and edges that belong to exactly one face.
 * Does not claim the mesh is watertight.
 */
export function meshTopologyStats(geometry: THREE.BufferGeometry, areaEps = 1e-8): {
  degenerateTriangles: number;
  boundaryEdges: number;
  totalEdges: number;
} {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  const edgeCount = new Map<string, number>();
  let degenerate = 0;
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const a = v(i0), b = v(i1), c = v(i2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    if (area < areaEps) degenerate++;
    for (const [u, w] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
      const k = key(u, w);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const c of edgeCount.values()) if (c === 1) boundary++;
  return { degenerateTriangles: degenerate, boundaryEdges: boundary, totalEdges: edgeCount.size };
}

/**
 * Angular coordinate used by unifiedGuideGeometry (matches generation).
 * Returns the arch angle of a world/local point (before alignment).
 */
export function archCoordinateFromPosition(x: number, z: number): number {
  const angle = Math.atan2(x, z + 8);
  return angle / 0.215 + 6.5;
}
