import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ScanGuideOptions = {
  /** Gap between the scan surface and the inner surface of the guide, mm (Settings.clearance). */
  clearance: number;
  /** Guide wall thickness, mm (Settings.wall). */
  wall: number;
  /** Gap between the guide's lower edge and the gingival margin found on the scan, mm (0 = down to the gum). */
  gumOffset?: number;
  /** Arch span the body covers, in tooth index space: [first contact or arch end, last contact or arch end]. */
  span?: [number, number];
  /** Heightfield grid step, mm. */
  cell?: number;
  /** Contacts to open as bur slots, in tooth index space (guideGeometry contact coordinates). */
  slots?: number[];
  /** Slot width, mm (bur shaft + 2 × slot clearance). */
  slotWidth?: number;
  /** Gingival margin points marked by hand on the scan (workspace coordinates); they override the detected margin nearby. */
  gumPoints?: Array<[number, number, number]>;
  /** Height of the continuous lower rim left under each slot, mm. */
  rim?: number;
  /** Body thickness away from the slots, mm (default: `wall`). Within `seat` of each slot, where the stopper rests, the
   * body keeps the full `wall`, so the stopper height and the bur depth do not depend on it. */
  shell?: number;
  seat?: number;
};

export type ScanGuideResult = {
  geometry: THREE.BufferGeometry;
  /** Smallest 3D distance between the fitted inner surface and the scan triangles, mm. */
  minimumGap: number;
  /** Points of the inner surface within clearance + 0.05 mm of the scan (the seating contact area). */
  coveredVertices: number;
  cell: number;
  /** Interproximal contacts found on the scan, with the stopper path over the guide next to each. */
  contacts: Array<ScanContact & { path: THREE.Vector3[] }>;
  /** Number of requested slots that matched a contact found on the scan. */
  slotsCut: number;
};

/** Fitted inner surfaces per scan and Offset, so changing the wall, slots or gum edge does not refit. */
const fittedInner = new WeakMap<THREE.BufferGeometry, Map<string, { inner: Float32Array; minimumGap: number; coveredVertices: number }>>();
/** Crease points per scan and placement (creasePoints), which do not depend on any guide setting. */
const creaseCache = new WeakMap<THREE.BufferGeometry, Map<string, Float32Array>>();

/**
 * Guide body built directly on the imported scan, in workspace coordinates (insertion axis = +Y).
 *
 * 1. Top envelope of the scan as a heightfield over XZ. Taking the highest surface at every XZ point
 *    blocks out all undercuts for a vertical insertion path, so the guide can be seated.
 * 2. Inner surface = envelope offset by `clearance` (Minkowski offset by a ball). It is then checked against the scan
 *    triangles and lifted only where it is closer than `clearance`, so the real gap is ≥ clearance and stays close to
 *    it. Outer surface = the fitted inner surface offset by `wall`.
 * 3. Its lower edge follows the gingival margin found on the scan (buccal and lingual separately), and along the
 *    arch it covers only `span`: the teeth being prepared plus the unprepared support teeth around them.
 * 4. Bur slots are cut across the arch at the requested interproximal contacts (detectScanContacts), down to a
 *    continuous lower rim so the guide stays in one piece.
 *
 * The scan is not moved, scaled or modified.
 */
export function buildScanGuide(source: THREE.BufferGeometry, transform: THREE.Matrix4 | null, options: ScanGuideOptions): ScanGuideResult | null {
  const cell = options.cell ?? 0.25;
  const gumOffset = Math.max(0, options.gumOffset ?? 0);
  const clearance = Math.max(0, options.clearance);
  const wall = Math.max(0.2, options.wall);
  const scan = source.clone();
  if (transform) scan.applyMatrix4(transform);
  scan.computeBoundingBox();
  const bounds = scan.boundingBox;
  const position = scan.getAttribute('position');
  if (!bounds || !position || bounds.isEmpty()) { scan.dispose(); return null; }

  // The grid does not depend on the wall (up to 3 mm), so the fitted inner surface can be reused when only it changes.
  const margin = clearance + Math.max(3, wall) + 2 * cell;
  const x0 = bounds.min.x - margin, z0 = bounds.min.z - margin;
  const nx = Math.ceil((bounds.max.x + margin - x0) / cell) + 1;
  const nz = Math.ceil((bounds.max.z + margin - z0) / cell) + 1;
  const at = (i: number, j: number) => j * nx + i;
  const height = new Float32Array(nx * nz).fill(-Infinity);
  // Lowest scan surface over each node: where the scan ends (its open rim), the guide must end too.
  const low = new Float32Array(nx * nz).fill(Infinity);

  // 1. Top envelope: rasterize every triangle in XZ and splat every vertex.
  const index = scan.index;
  const triangleCount = (index ? index.count : position.count) / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const vertex = (k: number) => index ? index.getX(k) : k;
  for (let t = 0; t < triangleCount; t++) {
    a.fromBufferAttribute(position, vertex(3 * t)); b.fromBufferAttribute(position, vertex(3 * t + 1)); c.fromBufferAttribute(position, vertex(3 * t + 2));
    for (const p of [a, b, c]) {
      const i = Math.round((p.x - x0) / cell), j = Math.round((p.z - z0) / cell);
      if (p.y > height[at(i, j)]) height[at(i, j)] = p.y;
      if (p.y < low[at(i, j)]) low[at(i, j)] = p.y;
    }
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-12) continue;
    const iMin = Math.ceil((Math.min(a.x, b.x, c.x) - x0) / cell), iMax = Math.floor((Math.max(a.x, b.x, c.x) - x0) / cell);
    const jMin = Math.ceil((Math.min(a.z, b.z, c.z) - z0) / cell), jMax = Math.floor((Math.max(a.z, b.z, c.z) - z0) / cell);
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * a.y + v * b.y + w * c.y;
      if (y > height[at(i, j)]) height[at(i, j)] = y;
      if (y < low[at(i, j)]) low[at(i, j)] = y;
    }
  }

  // 2. Offset of the region below a heightfield (the envelope by default) by a ball of radius r. For the outer surface,
  // distances are shortened by one cell diagonal, so the interpolated surface never dips below the true offset at steep
  // walls. The inner surface starts without that slack and is then fitted to the scan triangles themselves (step 2b).
  const offset = (radius: number, slack: number, from = height) => {
    const reach = Math.ceil((radius + slack) / cell);
    const kernel: Array<[number, number, number]> = [];
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const d = Math.max(0, Math.hypot(di, dj) * cell - slack);
      if (d <= radius) kernel.push([di, dj, Math.sqrt(radius * radius - d * d)]);
    }
    const result = new Float32Array(nx * nz).fill(-Infinity);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const h = from[at(i, j)];
      if (h === -Infinity) continue;
      for (const [di, dj, lift] of kernel) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const k = at(ii, jj);
        if (h + lift > result[k]) result[k] = h + lift;
      }
    }
    return result;
  };

  // 2b. Exact fit on the triangles: the inner surface of the mesh (grid nodes, edge midpoints and triangle centres)
  // is checked against the true 3D distance to the scan triangles and lifted along +Y wherever it is closer than
  // `clearance`. Lifting only, so the gap is never smaller than the Offset and no larger than the fit needs.
  const probe = new THREE.Vector3(), away = new THREE.Vector3();
  // Points of the triangulated surface over the cells that pass `use`: nodes, edge midpoints, triangle centres.
  // Each sample is a flat [node, weight, node, weight, ...] list; every point is listed once.
  const surfaceSamples = (use: (i: number, j: number) => boolean) => {
    const list: number[][] = [];
    const listed = new Uint8Array(nx * nz * 6);
    const add = (key: number, sample: number[]) => { if (!listed[key]) { listed[key] = 1; list.push(sample); } };
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      if (!use(i, j)) continue;
      const p = at(i, j), q = at(i + 1, j), r = at(i + 1, j + 1), s = at(i, j + 1);
      for (const k of [p, q, r, s]) add(6 * k, [k, 1]);
      add(6 * p + 1, [p, .5, q, .5]); add(6 * p + 2, [p, .5, s, .5]); add(6 * q + 2, [q, .5, r, .5]); add(6 * s + 1, [s, .5, r, .5]);
      add(6 * p + 3, [p, .5, r, .5]);
      add(6 * p + 4, [p, 1 / 3, q, 1 / 3, r, 1 / 3]); add(6 * p + 5, [p, 1 / 3, r, 1 / 3, s, 1 / 3]);
    }
    return list;
  };
  const place = (sample: number[], heights: Float32Array) => {
    probe.set(0, 0, 0);
    for (let n = 0; n < sample.length; n += 2) {
      const k = sample[n], w = sample[n + 1];
      probe.x += w * (x0 + (k % nx) * cell); probe.y += w * heights[k]; probe.z += w * (z0 + Math.floor(k / nx) * cell);
    }
    return probe;
  };
  const fitKey = `${clearance}|${cell}|${transform ? transform.elements.join(',') : ''}`;
  let fitted = fittedInner.get(source)?.get(fitKey);
  if (!fitted || fitted.inner.length !== nx * nz) {
    // Without slack the inner offset ends exactly `clearance` beyond the scan outline; past that ring the conservative
    // offset carries on, so the side walls of the body are not drawn as steep triangles through the scan.
    const inner = offset(clearance, 0);
    const innerRing = offset(clearance, cell * Math.SQRT2);
    for (let k = 0; k < inner.length; k++) if (inner[k] === -Infinity) inner[k] = innerRing[k];
    const nearest = scanDistance(scan, clearance + .05);
    const finite = (k: number) => inner[k] !== -Infinity;
    const samples = surfaceSamples((i, j) => finite(at(i, j)) && finite(at(i + 1, j)) && finite(at(i + 1, j + 1)) && finite(at(i, j + 1)));
    let pending = samples;
    const lift = new Float32Array(nx * nz);
    for (let pass = 0; pass < 40 && pending.length; pass++) {
      lift.fill(0);
      for (const sample of pending) {
        const distance = nearest(place(sample, inner), away);
        if (distance >= clearance - 1e-4) continue;
        // Moving up by dy changes the signed distance by about dy · (direction away from the scan).y. Only the nodes
        // not above the point are lifted: on a steep side wall that tilts the surface away from the scan instead of
        // sliding it along the wall.
        const dy = (clearance - distance) / Math.max(.25, away.y) + 1e-3;
        const y = probe.y;
        for (let n = 0; n < sample.length; n += 2) if (inner[sample[n]] <= y + 1e-6 && dy > lift[sample[n]]) lift[sample[n]] = dy;
      }
      for (let k = 0; k < lift.length; k++) inner[k] += lift[k];
      pending = pending.filter(sample => sample.some((k, n) => n % 2 === 0 && lift[k] > 0));
    }
    // Report on the fitted surface: true 3D distance to the scan triangles where it faces the scan.
    let minimumGap = Infinity, coveredVertices = 0;
    for (const sample of samples) {
      const distance = nearest(place(sample, inner), away);
      if (distance >= clearance + .05) continue;
      coveredVertices++;
      minimumGap = Math.min(minimumGap, distance);
    }
    fitted = { inner, minimumGap, coveredVertices };
    if (!fittedInner.has(source)) fittedInner.set(source, new Map());
    fittedInner.get(source)!.set(fitKey, fitted);
  }
  const inner = fitted.inner;
  const { minimumGap, coveredVertices } = fitted;
  // Outer surface = the fitted inner surface offset by the wall, so wherever the fit lifted the inner surface (narrow
  // grooves, steep walls) the wall keeps its full thickness instead of thinning out into holes.
  const outer = offset(wall, cell * Math.SQRT2, inner);
  const shell = Math.min(wall, Math.max(.2, options.shell ?? wall));
  const thin = shell < wall ? offset(shell, cell * Math.SQRT2, inner) : outer;

  // 3. Occlusal plane y = p0 + p1·x + p2·z from local maxima (cusp tips), refit without low outliers.
  const peakReach = Math.round(2.5 / cell);
  const peaks: THREE.Vector3[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const h = height[at(i, j)];
    if (h === -Infinity) continue;
    let peak = true;
    for (let dj = -peakReach; dj <= peakReach && peak; dj += 2) for (let di = -peakReach; di <= peakReach; di += 2) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && height[at(ii, jj)] > h) { peak = false; break; }
    }
    if (peak) peaks.push(new THREE.Vector3(x0 + i * cell, h, z0 + j * cell));
  }
  if (peaks.length < 3) { scan.dispose(); return null; }
  let plane = fitPlane(peaks);
  for (let pass = 0; pass < 3; pass++) {
    const kept = peaks.filter(p => p.y >= plane(p.x, p.z) - 1.5);
    if (kept.length < 3) break;
    plane = fitPlane(kept);
  }

  const cusps = peaks.filter(p => p.y >= plane(p.x, p.z) - 1.5);
  const sample = (x: number, z: number) => {
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -Infinity : height[at(i, j)];
  };
  const arch = detectScanContacts(sample, cusps, { reference: plane });
  if (!arch.frames.length) { scan.dispose(); return null; }
  const contacts = arch.contacts;

  // Gingival margin per arch sample and side: the crease where the gum meets the crown on the scan triangles
  // (creaseMargins). Where none is found, the heightfield fallback: undercuts are blocked out in the envelope, so
  // walking outwards from the arch line the crown wall falls steeply and then meets the gum, and the margin is the
  // sharpest concave bend of that cross-section between 2.5 and 12 mm below the crown top.
  const crowns = arch.frames.map(({ point, normal }) => Math.max(...[-2, -1, 0, 1, 2].map(s => sample(point.x + normal.x * s, point.z + normal.z * s))));
  const creaseKey = transform ? transform.elements.join(',') : '';
  let crease = creaseCache.get(source)?.get(creaseKey);
  if (!crease) {
    crease = creasePoints(scan);
    if (!creaseCache.has(source)) creaseCache.set(source, new Map());
    creaseCache.get(source)!.set(creaseKey, crease);
  }
  const creases = creaseMargins(crease, arch.frames, crowns);
  const margins = arch.frames.map(({ point, normal }, frame) => {
    const crown = crowns[frame];
    return [-1, 1].map((side, n) => {
      if (Number.isFinite(creases[frame][n])) return creases[frame][n];
      const profile: number[] = [];
      for (let s = 0; s <= 14; s += .2) profile.push(sample(point.x + normal.x * s * side, point.z + normal.z * s * side));
      const smooth = profile.map((_, k) => {
        const window = profile.slice(Math.max(0, k - 2), k + 3).filter(v => v > -Infinity);
        return window.length ? window.reduce((sum, v) => sum + v, 0) / window.length : -Infinity;
      });
      let best = -Infinity, bend = 0;
      for (let k = 3; k < smooth.length - 3; k++) {
        const h = smooth[k];
        if (h === -Infinity || smooth[k - 3] === -Infinity || smooth[k + 3] === -Infinity) continue;
        if (h > crown - 2.5 || h < crown - 12) continue;
        const concavity = smooth[k - 3] - 2 * h + smooth[k + 3];
        if (concavity > bend) { bend = concavity; best = h; }
      }
      return bend > .3 ? best : crown - 8;
    });
  });
  // Median over ±1.5 mm of arch so single scan defects do not notch the edge.
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  const window = Math.round(1.5 / .2);
  const gum = margins.map((_, k) => [0, 1].map(side => median(margins.slice(Math.max(0, k - window), k + window + 1).map(m => m[side]))));
  // The edge runs as one smooth line along the arch. Single samples where the margin was missed (no crease, fallback,
  // a crease on the gum below) lie deeper than their neighbours and hung as tabs: take the upper quartile over ±3 mm of
  // arch, then average over ±1.5 mm.
  // A clinical crown is under 8.5 mm tall: a margin deeper than that below the highest crown point within ±3 mm is a fold
  // of the mucosa, not the gum line, and is raised to that depth first.
  const quartile = Math.round(3 / .2), soften = Math.round(1.5 / .2);
  gum.forEach((sides, k) => {
    const crownTop = Math.max(...crowns.slice(Math.max(0, k - quartile), k + quartile + 1));
    if (Number.isFinite(crownTop)) for (const side of [0, 1]) sides[side] = Math.max(sides[side], crownTop - 8.5);
  });
  const upper = gum.map((_, k) => [0, 1].map(side => {
    const near = gum.slice(Math.max(0, k - quartile), k + quartile + 1).map(m => m[side]).sort((a, b) => a - b);
    return near[Math.floor(near.length * .75)];
  }));
  upper.forEach((_, k) => { for (const side of [0, 1]) {
    const near = upper.slice(Math.max(0, k - soften), k + soften + 1).map(m => m[side]);
    gum[k][side] = near.reduce((sum, v) => sum + v, 0) / near.length;
  } });
  // The edge never runs below the scan. Where the scan is cut off close under the crowns, the margin found (or the
  // fallback) can lie below its open rim, and the body then hung past the rim in tabs. Per arch sample and side: the
  // lowest scan point within ±0.5 mm of the cross-section, then the highest of those over ±1 mm of arch, so the edge
  // stays on the scan along a jagged rim too.
  const scanLow = arch.frames.map(({ point, tangent, normal }) => [-1, 1].map(side => {
    let lowest = Infinity;
    for (let s = 0; s <= 14; s += cell) for (const t of [-.5, 0, .5]) {
      const x = point.x + normal.x * s * side + tangent.x * t, z = point.z + normal.z * s * side + tangent.z * t;
      const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
      if (i >= 0 && j >= 0 && i < nx && j < nz && low[at(i, j)] < lowest) lowest = low[at(i, j)];
    }
    return lowest;
  }));
  const rimReach = Math.round(1 / .2);
  gum.forEach((sides, k) => { for (const side of [0, 1]) {
    const rimHeight = Math.max(...scanLow.slice(Math.max(0, k - rimReach), k + rimReach + 1).map(lows => lows[side]).filter(Number.isFinite));
    if (rimHeight > sides[side]) sides[side] = rimHeight;
  } });
  // Hand-marked margin points: each moves the detected margin on its side of the arch to its own height
  // within ±1.5 mm of arch, fading out by ±4 mm; overlapping points are blended by weight.
  const nearestFrame = (x: number, z: number) => {
    let best = 0, distance = Infinity;
    arch.frames.forEach((frame, k) => {
      const d = (frame.point.x - x) ** 2 + (frame.point.z - z) ** 2;
      if (d < distance) { distance = d; best = k; }
    });
    return best;
  };
  const marks = (options.gumPoints ?? []).map(([x, y, z]) => {
    const k = nearestFrame(x, z), frame = arch.frames[k];
    const side = (x - frame.point.x) * frame.normal.x + (z - frame.point.z) * frame.normal.z < 0 ? 0 : 1;
    return { k, side, shift: y - gum[k][side] };
  });
  if (marks.length) {
    const plateau = 1.5 / .2, fade = 2.5 / .2;
    const corrected = gum.map((sides, k) => sides.map((height, side) => {
      let weight = 0, shift = 0;
      for (const mark of marks) {
        if (mark.side !== side) continue;
        const w = Math.max(0, 1 - Math.max(0, Math.abs(mark.k - k) - plateau) / fade) ** 2;
        weight += w; shift += w * mark.shift;
      }
      return weight ? height + shift / Math.max(1, weight) : height;
    }));
    corrected.forEach((sides, k) => { gum[k] = sides; });
  }
  const arcOf = (coordinate: number, fallback: number) => contacts.find(contact => Math.abs(contact.coordinate - coordinate) < .01)?.arc ?? fallback;
  const lastArc = arch.frames[arch.frames.length - 1].arc;
  const spanFrom = options.span ? arcOf(options.span[0], -Infinity) : -Infinity;
  const spanTo = options.span ? arcOf(options.span[1], Infinity) : Infinity;
  // Nearest arch sample for a point: its gingival floor on that side, or −∞ outside the covered span.
  const floorAt = (x: number, z: number) => {
    let best = 0, distance = Infinity;
    for (let k = 0; k < arch.frames.length; k += 2) {
      const d = (arch.frames[k].point.x - x) ** 2 + (arch.frames[k].point.z - z) ** 2;
      if (d < distance) { distance = d; best = k; }
    }
    for (let k = Math.max(0, best - 2); k <= Math.min(arch.frames.length - 1, best + 2); k++) {
      const d = (arch.frames[k].point.x - x) ** 2 + (arch.frames[k].point.z - z) ** 2;
      if (d < distance) { distance = d; best = k; }
    }
    const frame = arch.frames[best];
    if (frame.arc < spanFrom || frame.arc > spanTo || (frame.arc === lastArc && spanTo < Infinity) || (best === 0 && spanFrom > -Infinity)) return Infinity;
    const side = (x - frame.point.x) * frame.normal.x + (z - frame.point.z) * frame.normal.z < 0 ? 0 : 1;
    return gum[best][side] + gumOffset;
  };

  // Bur slots: a band across the arch at each requested contact, cut down to a continuous lower rim.
  const rim = options.rim ?? 1;
  const slotHalf = (options.slotWidth ?? 0) / 2 + cell;
  const slotContacts = contacts.filter(contact => options.slots?.some(coordinate => Math.abs(coordinate - contact.coordinate) < .01));
  const inSlot = (x: number, z: number) => slotContacts.some(({ point, tangent, normal }) => {
    const dx = x - point.x, dz = z - point.z;
    return Math.abs(dx * tangent.x + dz * tangent.z) <= slotHalf && Math.abs(dx * normal.x + dz * normal.z) <= 12;
  });
  const seatHalf = slotHalf + (options.seat ?? 3);
  const nearSlot = (x: number, z: number) => slotContacts.some(({ point, tangent }) => Math.abs((x - point.x) * tangent.x + (z - point.z) * tangent.z) <= seatHalf);
  const outerAt = (x: number, z: number) => {
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -Infinity : outer[at(i, j)];
  };
  // Bilinear height of the outer surface (nearest node where a neighbour is missing), for smooth stopper paths.
  const outerSmoothAt = (x: number, z: number) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return outerAt(x, z);
    const h = [outer[at(i, j)], outer[at(i + 1, j)], outer[at(i, j + 1)], outer[at(i + 1, j + 1)]];
    if (h.some(value => value === -Infinity)) return outerAt(x, z);
    const u = fx - i, v = fz - j;
    return h[0] * (1 - u) * (1 - v) + h[1] * u * (1 - v) + h[2] * (1 - u) * v + h[3] * u * v;
  };
  // Path of the stopper over the guide surface next to each contact, from one side of the arch to the other.
  const paths = contacts.map(({ point, normal, frame }) => {
    const floor = Math.min(...gum[frame]) + gumOffset + rim;
    const reachable = (s: number) => outerAt(point.x + normal.x * s, point.z + normal.z * s) > floor + .5;
    let from = 0, to = 0;
    while (from > -12 && reachable(from - cell)) from -= cell;
    while (to < 12 && reachable(to + cell)) to += cell;
    const raw = Array.from({ length: 65 }, (_, n) => {
      const s = from + (to - from) * n / 64;
      const x = point.x + normal.x * s, z = point.z + normal.z * s;
      return new THREE.Vector3(x, outerSmoothAt(x, z), z);
    });
    // The surface is a 0.25 mm grid, so its profile is stepped: smooth the heights (binomial passes), then lift the
    // smoothed profile by its own smoothed deficit so the stopper rides on the guide instead of sinking into it.
    const smooth = (values: number[], passes: number) => {
      let current = values;
      for (let pass = 0; pass < passes; pass++) current = current.map((value, n) => n === 0 || n === current.length - 1 ? value : (current[n - 1] + 2 * value + current[n + 1]) / 4);
      return current;
    };
    const heights = raw.map(point => point.y);
    const smoothed = smooth(heights, 6);
    const lift = smooth(heights.map((height, n) => Math.max(0, height - smoothed[n])), 3);
    const deficit = Math.max(0, ...heights.map((height, n) => height - smoothed[n] - lift[n]));
    return raw.map((point, n) => point.clone().setY(smoothed[n] + lift[n] + deficit));
  });

  // Node heights of the body: top = outer offset (full wall around the slots, `shell` elsewhere), bottom = inner offset
  // clipped by the gingival floor.
  const top = new Float32Array(nx * nz), bottom = new Float32Array(nx * nz);
  const valid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = at(i, j);
    const x = x0 + i * cell, z = z0 + j * cell;
    const surface = nearSlot(x, z) ? outer[k] : thin[k];
    if (surface === -Infinity) { valid[k] = 0; continue; }
    const floor = floorAt(x, z);
    top[k] = slotContacts.length && inSlot(x, z) ? Math.min(surface, floor + rim) : surface;
    bottom[k] = Math.max(inner[k], floor);
    valid[k] = floor < Infinity && top[k] - bottom[k] >= 0.2 ? 1 : 0;
  }
  const cells = new Uint8Array((nx - 1) * (nz - 1));
  const cellAt = (i: number, j: number) => j * (nx - 1) + i;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    cells[cellAt(i, j)] = valid[at(i, j)] & valid[at(i + 1, j)] & valid[at(i, j + 1)] & valid[at(i + 1, j + 1)];
  }
  keepLargestComponent(cells, nx - 1, nz - 1);

  // Closed mesh: top quads (+Y), bottom quads (−Y), side walls on every boundary edge of the cell mask.
  const out: number[] = [];
  const node = (i: number, j: number, upper: boolean) => [x0 + i * cell, upper ? top[at(i, j)] : bottom[at(i, j)], z0 + j * cell];
  const quad = (p: number[], q: number[], r: number[], s: number[]) => out.push(...p, ...q, ...r, ...p, ...r, ...s);
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < nx - 1 && j < nz - 1 && cells[cellAt(i, j)] === 1;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (!inside(i, j)) continue;
    quad(node(i, j, true), node(i, j + 1, true), node(i + 1, j + 1, true), node(i + 1, j, true));
    quad(node(i, j, false), node(i + 1, j, false), node(i + 1, j + 1, false), node(i, j + 1, false));
    if (!inside(i, j - 1)) quad(node(i, j, false), node(i, j, true), node(i + 1, j, true), node(i + 1, j, false));
    if (!inside(i, j + 1)) quad(node(i + 1, j + 1, false), node(i + 1, j + 1, true), node(i, j + 1, true), node(i, j + 1, false));
    if (!inside(i - 1, j)) quad(node(i, j + 1, false), node(i, j + 1, true), node(i, j, true), node(i, j, false));
    if (!inside(i + 1, j)) quad(node(i + 1, j, false), node(i + 1, j, true), node(i + 1, j + 1, true), node(i + 1, j + 1, false));
  }
  if (!out.length) { scan.dispose(); return null; }

  scan.dispose();

  const faceted = new THREE.BufferGeometry();
  faceted.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  // The grid steps on steep walls would show as stripes with flat shading: smooth normals across bends under 60°.
  const geometry = toCreasedNormals(faceted, Math.PI / 3);
  if (geometry !== faceted) faceted.dispose();
  geometry.computeBoundingBox();
  return { geometry, minimumGap, coveredVertices, cell, contacts: contacts.map((contact, n) => ({ ...contact, path: paths[n] })), slotsCut: slotContacts.length };
}

/**
 * Sharp concave creases of the scan surface as flat [x, y, z, curvature, ...]. The gum meets the crown in such a
 * crease, which is found on the triangles even where it lies in an undercut that the heightfield cannot see.
 */
function creasePoints(scan: THREE.BufferGeometry) {
  const surface = scan.clone();
  for (const name of Object.keys(surface.attributes)) if (name !== 'position') surface.deleteAttribute(name);
  const merged = mergeVertices(surface, 1e-4);
  surface.dispose();
  merged.computeVertexNormals();
  const position = merged.getAttribute('position'), normal = merged.getAttribute('normal'), index = merged.index;
  if (!index) { merged.dispose(); return new Float32Array(0); }
  // Mean concavity per vertex: how far its neighbours rise above its tangent plane, 2·(d·n)/|d|² (≈ 1/radius, mm⁻¹),
  // then averaged over the triangle fan twice so single noisy vertices do not count as a crease.
  let curvature = new Float32Array(position.count);
  const weight = new Float32Array(position.count);
  for (let t = 0; t < index.count; t += 3) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    if (a === b) continue;
    const i = index.getX(t + a), j = index.getX(t + b);
    const dx = position.getX(j) - position.getX(i), dy = position.getY(j) - position.getY(i), dz = position.getZ(j) - position.getZ(i);
    curvature[i] += 2 * (dx * normal.getX(i) + dy * normal.getY(i) + dz * normal.getZ(i)) / Math.max(1e-6, dx * dx + dy * dy + dz * dz);
    weight[i]++;
  }
  for (let i = 0; i < curvature.length; i++) curvature[i] = weight[i] ? curvature[i] / weight[i] : 0;
  // The open rim of the scan has half a fan and reads as a false crease: drop its vertices and two rings around them.
  const edges = new Map<number, number>();
  for (let t = 0; t < index.count; t += 3) for (let a = 0; a < 3; a++) {
    const i = index.getX(t + a), j = index.getX(t + (a + 1) % 3);
    const key = Math.min(i, j) * position.count + Math.max(i, j);
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  let rim = new Uint8Array(position.count);
  edges.forEach((uses, key) => { if (uses === 1) { rim[Math.floor(key / position.count)] = 1; rim[key % position.count] = 1; } });
  for (let ring = 0; ring < 2; ring++) {
    const grown = rim.slice();
    for (let t = 0; t < index.count; t += 3) {
      const v = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      if (rim[v[0]] || rim[v[1]] || rim[v[2]]) for (const i of v) grown[i] = 1;
    }
    rim = grown;
  }
  for (let pass = 0; pass < 2; pass++) {
    const sum = new Float32Array(position.count);
    weight.fill(0);
    for (let t = 0; t < index.count; t += 3) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const i = index.getX(t + a);
      sum[i] += curvature[index.getX(t + b)];
      weight[i]++;
    }
    curvature = sum.map((value, i) => weight[i] ? value / weight[i] : 0);
  }
  const points: number[] = [];
  for (let v = 0; v < position.count; v++) if (curvature[v] >= .8 && !rim[v]) points.push(position.getX(v), position.getY(v), position.getZ(v), curvature[v]);
  merged.dispose();
  return new Float32Array(points);
}

/**
 * Gingival margin from the crease points (creasePoints). For every arch frame and side (0 = −normal, 1 = +normal)
 * returns the height of the lowest crease within ±0.75 mm of the frame's cross-section and 2.5–10 mm below the crown
 * top (the curvature-weighted centre of its band), or NaN where there is none.
 */
function creaseMargins(points: Float32Array, frames: ArchFrame[], crowns: number[]) {
  const result = frames.map(() => [NaN, NaN]);
  if (frames.length < 2) return result;
  const spacing = Math.max(1e-3, (frames[frames.length - 1].arc - frames[0].arc) / (frames.length - 1));
  const reach = Math.max(1, Math.round(.75 / spacing));
  // Every crease point with each frame whose cross-section it lies on, and the side of the arch it is on.
  const visit = (each: (k: number, side: number, y: number, weight: number) => void) => {
    for (let v = 0; v < points.length; v += 4) {
      const x = points[v], y = points[v + 1], z = points[v + 2];
      let nearest = 0, distance = Infinity;
      for (let k = 0; k < frames.length; k += 4) {
        const d = (frames[k].point.x - x) ** 2 + (frames[k].point.z - z) ** 2;
        if (d < distance) { distance = d; nearest = k; }
      }
      for (let k = Math.max(0, nearest - 4); k <= Math.min(frames.length - 1, nearest + 4); k++) {
        const d = (frames[k].point.x - x) ** 2 + (frames[k].point.z - z) ** 2;
        if (d < distance) { distance = d; nearest = k; }
      }
      for (let k = Math.max(0, nearest - reach); k <= Math.min(frames.length - 1, nearest + reach); k++) {
        const { point, tangent, normal: across } = frames[k];
        const dx = x - point.x, dz = z - point.z;
        if (Math.abs(dx * tangent.x + dz * tangent.z) > .75) continue;
        const s = dx * across.x + dz * across.z, depth = crowns[k] - y;
        if (Math.abs(s) > 14 || depth < 2.5 || depth > 10) continue;
        each(k, s < 0 ? 0 : 1, y, points[v + 3]);
      }
    }
  };
  // The gum line runs on continuously along the arch, while creases on the gum below it (a ridge, a scan seam) are
  // short: first the lowest crease per frame, then the same search limited to 1.5 mm below the median of those over
  // ±4 mm of arch.
  const lowestAbove = (limit: number[][]) => {
    const lowest = frames.map(() => [Infinity, Infinity]);
    visit((k, side, y) => { if (y >= limit[k][side] && y < lowest[k][side]) lowest[k][side] = y; });
    return lowest;
  };
  const first = lowestAbove(frames.map(() => [-Infinity, -Infinity]));
  const span = Math.round(4 / spacing);
  const limit = frames.map((_, k) => [0, 1].map(side => {
    const near = first.slice(Math.max(0, k - span), k + span + 1).map(sides => sides[side]).filter(Number.isFinite).sort((a, b) => a - b);
    return near.length ? near[near.length >> 1] - 1.5 : -Infinity;
  }));
  // The smoothed crease is a band a few vertices wide: find its lowest point, then centre on the band above it.
  const lowest = lowestAbove(limit);
  const sum = frames.map(() => [0, 0]), total = frames.map(() => [0, 0]);
  visit((k, side, y, weight) => { if (y <= lowest[k][side] + .6) { sum[k][side] += weight * y; total[k][side] += weight; } });
  result.forEach((sides, k) => { for (const side of [0, 1]) if (total[k][side]) sides[side] = sum[k][side] / total[k][side]; });
  return result;
}

/**
 * Signed distance to the nearest scan triangle (negative behind the scan surface, judged by the triangle's
 * winding when the nearest point lies inside a face; on an edge or a vertex, including the open rim of the scan,
 * it counts as outside), limited to `reach` (returns `reach` when nothing is closer). `away` receives the unit vector that
 * points out of the scan surface from the nearest scan point.
 */
function scanDistance(scan: THREE.BufferGeometry, reach: number) {
  const position = scan.getAttribute('position');
  const index = scan.index;
  const count = (index ? index.count : position.count) / 3;
  const vertices = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) for (let n = 0; n < 3; n++) {
    const v = index ? index.getX(3 * t + n) : 3 * t + n;
    vertices[9 * t + 3 * n] = position.getX(v); vertices[9 * t + 3 * n + 1] = position.getY(v); vertices[9 * t + 3 * n + 2] = position.getZ(v);
  }
  const size = Math.max(.5, 2 * reach);
  const buckets = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
  for (let t = 0; t < count; t++) {
    const o = 9 * t;
    const lo = [0, 1, 2].map(axis => Math.floor(Math.min(vertices[o + axis], vertices[o + 3 + axis], vertices[o + 6 + axis]) / size));
    const hi = [0, 1, 2].map(axis => Math.floor(Math.max(vertices[o + axis], vertices[o + 3 + axis], vertices[o + 6 + axis]) / size));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const bucket = buckets.get(key(i, j, k));
      if (bucket) bucket.push(t); else buckets.set(key(i, j, k), [t]);
    }
  }
  const seen = new Uint32Array(count);
  let stamp = 0;
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), best = new THREE.Vector3(), normal = new THREE.Vector3(), weights = new THREE.Vector3();
  let bestTriangle = -1;
  return (point: THREE.Vector3, away: THREE.Vector3) => {
    stamp++;
    let distance = reach;
    bestTriangle = -1;
    away.set(0, 1, 0);
    for (let k = Math.floor((point.z - reach) / size); k <= Math.floor((point.z + reach) / size); k++)
      for (let j = Math.floor((point.y - reach) / size); j <= Math.floor((point.y + reach) / size); j++)
      for (let i = Math.floor((point.x - reach) / size); i <= Math.floor((point.x + reach) / size); i++) {
        const bucket = buckets.get(key(i, j, k));
        if (!bucket) continue;
        for (const t of bucket) {
          if (seen[t] === stamp) continue;
          seen[t] = stamp;
          const o = 9 * t;
          if (Math.min(vertices[o], vertices[o + 3], vertices[o + 6]) > point.x + distance || Math.max(vertices[o], vertices[o + 3], vertices[o + 6]) < point.x - distance) continue;
          if (Math.min(vertices[o + 1], vertices[o + 4], vertices[o + 7]) > point.y + distance || Math.max(vertices[o + 1], vertices[o + 4], vertices[o + 7]) < point.y - distance) continue;
          if (Math.min(vertices[o + 2], vertices[o + 5], vertices[o + 8]) > point.z + distance || Math.max(vertices[o + 2], vertices[o + 5], vertices[o + 8]) < point.z - distance) continue;
          triangle.a.set(vertices[o], vertices[o + 1], vertices[o + 2]);
          triangle.b.set(vertices[o + 3], vertices[o + 4], vertices[o + 5]);
          triangle.c.set(vertices[o + 6], vertices[o + 7], vertices[o + 8]);
          triangle.closestPointToPoint(point, closest);
          const d = closest.distanceTo(point);
          if (d < distance) { distance = d; best.copy(closest); bestTriangle = t; }
        }
      }
    if (bestTriangle < 0) return distance;
    const o = 9 * bestTriangle;
    triangle.a.set(vertices[o], vertices[o + 1], vertices[o + 2]);
    triangle.b.set(vertices[o + 3], vertices[o + 4], vertices[o + 5]);
    triangle.c.set(vertices[o + 6], vertices[o + 7], vertices[o + 8]);
    triangle.getNormal(normal);
    if (distance < 1e-9) { away.copy(normal); return 0; }
    away.subVectors(point, best).divideScalar(distance);
    triangle.getBarycoord(best, weights);
    if (away.dot(normal) >= 0 || Math.min(weights.x, weights.y, weights.z) < 1e-4) return distance;
    away.negate();
    return -distance;
  };
}

function fitPlane(points: THREE.Vector3[]) {
  // Least squares for y = p0 + p1·x + p2·z.
  let n = 0, sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (const p of points) { n++; sx += p.x; sz += p.z; sy += p.y; sxx += p.x * p.x; szz += p.z * p.z; sxz += p.x * p.z; sxy += p.x * p.y; szy += p.z * p.y; }
  const m = new THREE.Matrix3().set(n, sx, sz, sx, sxx, sxz, sz, sxz, szz);
  if (Math.abs(m.determinant()) < 1e-9) { const mean = sy / n; return () => mean; }
  const p = new THREE.Vector3(sy, sxy, szy).applyMatrix3(m.invert());
  return (x: number, z: number) => p.x + p.y * x + p.z * z;
}

function keepLargestComponent(cells: Uint8Array, width: number, depth: number) {
  const label = new Int32Array(cells.length).fill(-1);
  let best = -1, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || label[start] >= 0) continue;
    let size = 0;
    label[start] = next; stack.push(start);
    while (stack.length) {
      const k = stack.pop()!; size++;
      const i = k % width, j = (k - i) / width;
      for (const [ii, jj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (ii < 0 || jj < 0 || ii >= width || jj >= depth) continue;
        const neighbour = jj * width + ii;
        if (cells[neighbour] && label[neighbour] < 0) { label[neighbour] = next; stack.push(neighbour); }
      }
    }
    if (size > bestSize) { bestSize = size; best = next; }
    next++;
  }
  for (let k = 0; k < cells.length; k++) if (label[k] !== best) cells[k] = 0;
}

export type ScanContact = {
  /** Position in the app's tooth index space (geometry.ts toothIds): 6.5 is the midline, 5.5 the next contact on the −X side. */
  coordinate: number;
  /** Contact on the arch line (y = top of the scan there). */
  point: THREE.Vector3;
  /** Unit vector along the arch, in XZ. */
  tangent: THREE.Vector3;
  /** Unit vector across the arch (buccal → lingual is not guaranteed), in XZ. */
  normal: THREE.Vector3;
  /** How far the profile dips below its highest point within ±2.5 mm, mm (0 = no visible embrasure). */
  depth: number;
  /** Distance along the arch line from its −X end, mm, and the index of that arch sample. */
  arc: number;
  frame: number;
};

/** Sample of the fitted arch line, every 0.2 mm from its −X end. */
export type ArchFrame = { theta: number; point: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3; arc: number };

/**
 * Interproximal contacts of a scan from its top envelope.
 * The arch line r(θ) is fitted through cusp tips around a point inside the arch; along that line the
 * highest scan point across the arch is profiled. Embrasures are dips of that profile; they are matched
 * to a lower-arch tooth-width template so that weak anterior embrasures are still placed and numbered.
 */
export function detectScanContacts(sample: (x: number, z: number) => number, cusps: THREE.Vector3[], options: { step?: number; halfWidth?: number; crownBand?: number; reference?: (x: number, z: number) => number } = {}): { contacts: ScanContact[]; frames: ArchFrame[] } {
  const step = options.step ?? 0.2, halfWidth = options.halfWidth ?? 6;
  if (cusps.length < 8) return { contacts: [], frames: [] };
  const xs = cusps.map(p => p.x), zs = cusps.map(p => p.z);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const origin = { x: xs.reduce((sum, x) => sum + x, 0) / xs.length, z: zMin + .25 * (zMax - zMin) };
  const polar = cusps.map(p => ({ theta: Math.atan2(p.x - origin.x, p.z - origin.z), radius: Math.hypot(p.x - origin.x, p.z - origin.z) }));
  const coefficients = fitPolynomial(polar.map(p => p.theta), polar.map(p => p.radius), 4);
  const radius = (theta: number) => coefficients.reduce((sum, c, power) => sum + c * theta ** power, 0);
  const arch = (theta: number) => new THREE.Vector3(origin.x + radius(theta) * Math.sin(theta), 0, origin.z + radius(theta) * Math.cos(theta));
  const thetaMin = Math.min(...polar.map(p => p.theta)), thetaMax = Math.max(...polar.map(p => p.theta));

  // Sample the arch line at roughly equal arc length.
  const fine = 2000;
  const length: number[] = [0];
  for (let k = 1; k <= fine; k++) length.push(length[k - 1] + arch(thetaMin + (thetaMax - thetaMin) * k / fine).distanceTo(arch(thetaMin + (thetaMax - thetaMin) * (k - 1) / fine)));
  const count = Math.floor(length[fine] / step);
  const thetas: number[] = [];
  for (let k = 0, f = 0; k <= count; k++) {
    while (f < fine && length[f + 1] < k * step) f++;
    thetas.push(thetaMin + (thetaMax - thetaMin) * f / fine);
  }
  const frames: ArchFrame[] = thetas.map(theta => {
    const point = arch(theta);
    const tangent = arch(theta + 1e-4).sub(arch(theta - 1e-4)).normalize();
    return { theta, point, tangent, normal: new THREE.Vector3(tangent.z, 0, -tangent.x), arc: 0 };
  });
  const raw = frames.map(({ point, normal }) => {
    let top = -Infinity;
    for (let s = -halfWidth; s <= halfWidth; s += step) top = Math.max(top, sample(point.x + normal.x * s, point.z + normal.z * s));
    return top;
  });
  const profile = raw.map((_, k) => {
    let sum = 0, n = 0;
    for (let d = -2; d <= 2; d++) { const v = raw[k + d]; if (v !== undefined && v > -Infinity) { sum += v; n++; } }
    return n ? sum / n : -Infinity;
  });
  // Crown width across the arch: samples within `crownBand` mm of the occlusal plane. It narrows at embrasures
  // even where incisal edges touch.
  const crownBand = options.crownBand ?? 2.5;
  const width = frames.map(({ point, normal }) => {
    const level = (options.reference ? options.reference(point.x, point.z) : profile[0]) - crownBand;
    let n = 0;
    for (let s = -halfWidth; s <= halfWidth; s += step) if (sample(point.x + normal.x * s, point.z + normal.z * s) > level) n++;
    return n * step;
  });
  // Dip at every sample: how far a signal lies below its highest value within ±2.5 mm.
  const reach = Math.round(2.5 / step);
  const dipOf = (signal: number[]) => signal.map((h, k) => {
    if (h === -Infinity) return 0;
    let high = h;
    for (let d = -reach; d <= reach; d++) { const v = signal[k + d]; if (v !== undefined && v > high) high = v; }
    return high - h;
  });
  const heightDip = dipOf(profile), widthDip = dipOf(width);
  const guard = Math.round(4 / step);
  const dip = heightDip.map((h, k) => k < guard || k > heightDip.length - 1 - guard ? 0 : h + .5 * widthDip[k]);

  // Tooth-width template (mean lower mesiodistal widths, mm) in toothIds order 37…31, 41…47.
  // Contacts are placed by dynamic programming: maximise the summed dip while each tooth keeps a
  // plausible width. Missing teeth at either end of the arch are allowed.
  const template = [10.5, 11.2, 7.1, 7.0, 6.9, 5.9, 5.4, 5.4, 5.9, 6.9, 7.0, 7.1, 11.2, 10.5];
  const total = profile.length - 1;
  const scale = THREE.MathUtils.clamp(total * step / (template.reduce((sum, w) => sum + w, 0) - 4), .85, 1.3);
  const widths = template.map(w => w * scale);
  const penalty = (tooth: number, length: number) => {
    const ratio = length / widths[tooth];
    return ratio < .65 || ratio > 1.45 ? Infinity : 4 * (ratio - 1) ** 2;
  };
  const edge = (tooth: number, length: number) => length > widths[tooth] * 1.3 ? Infinity : 0;
  const contactsCount = template.length - 1;
  const best = Array.from({ length: contactsCount }, () => new Float64Array(total + 1).fill(-Infinity));
  const from = Array.from({ length: contactsCount }, () => new Int32Array(total + 1).fill(-1));
  for (let c = 0; c < contactsCount; c++) for (let k = 0; k <= total; k++) {
    // Contact c separates tooth c and tooth c + 1. Either tooth c is the first one on the arch …
    let value = -edge(c, k * step), origin = -1;
    // … or the previous contact c − 1 closes tooth c.
    if (c > 0) {
      const lo = Math.max(0, k - Math.ceil(widths[c] * 1.45 / step)), hi = k - Math.floor(widths[c] * .65 / step);
      for (let q = lo; q <= hi; q++) {
        if (best[c - 1][q] === -Infinity) continue;
        const v = best[c - 1][q] - penalty(c, (k - q) * step);
        if (v > value) { value = v; origin = q; }
      }
    }
    if (value === -Infinity) continue;
    best[c][k] = value + dip[k];
    from[c][k] = origin;
  }
  let endContact = -1, endSample = -1, endValue = -Infinity;
  for (let c = 0; c < contactsCount; c++) for (let k = 0; k <= total; k++) {
    if (best[c][k] === -Infinity) continue;
    const v = best[c][k] - edge(c + 1, (total - k) * step);
    if (v > endValue) { endValue = v; endContact = c; endSample = k; }
  }
  frames.forEach((frame, k) => { frame.arc = k * step; });
  if (endContact < 0) return { contacts: [], frames };
  const placed: Array<{ c: number; k: number }> = [];
  for (let c = endContact, k = endSample; c >= 0 && k >= 0; k = from[c][k], c--) {
    placed.unshift({ c, k });
    if (from[c][k] < 0) break;
  }
  return { frames, contacts: placed.map(({ c, k }) => ({
    coordinate: c + .5,
    point: frames[k].point.clone().setY(profile[k]),
    tangent: frames[k].tangent.clone(),
    normal: frames[k].normal.clone(),
    depth: dip[k],
    arc: k * step,
    frame: k,
  })) };
}

function fitPolynomial(xs: number[], ys: number[], degree: number) {
  const n = degree + 1;
  const a = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  xs.forEach((x, k) => {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) a[row][col] += x ** (row + col);
      a[row][n] += ys[k] * x ** row;
    }
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (Math.abs(a[col][col]) < 1e-12) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, k) => Math.abs(row[k]) < 1e-12 ? 0 : row[n] / row[k]);
}
