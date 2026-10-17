// Track geometry from the GTFS shapes: each trip's stops are placed along its shape,
// so vehicles can move along the real track instead of in straight lines between stations.

const R = 6371000;
const toRad = d => (d * Math.PI) / 180;

/** Fast equirectangular distance in metres (accurate enough at city scale). */
function dist(lat1, lng1, lat2, lng2) {
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * R;
}

/** Builds { lat, lng, d } typed arrays (d = cumulative metres) from [[seq, lat, lng], ...]. */
export function makeShape(points) {
  points.sort((a, b) => a[0] - b[0]);
  const n = points.length;
  const lat = new Float64Array(n), lng = new Float64Array(n), d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = points[i][1]; lng[i] = points[i][2];
    d[i] = i ? d[i - 1] + dist(lat[i - 1], lng[i - 1], lat[i], lng[i]) : 0;
  }
  return { lat, lng, d };
}

/**
 * Distance along the shape for each stop, found by projecting the stops onto the shape in order
 * (each stop searches forward from the previous one, so loops and returns are handled).
 * Returns null when the shape doesn't fit the stops (more than 250 m away) — the trip then
 * falls back to straight lines.
 */
export function placeStops(shape, stopLat, stopLng, stopIdxs) {
  const { lat, lng, d } = shape;
  const n = lat.length;
  if (n < 2) return null;
  const out = new Float64Array(stopIdxs.length);
  let j0 = 0, last = 0;
  // Local planar coords around the first point, metres
  const kx = Math.cos(toRad(lat[0])) * R * Math.PI / 180, ky = R * Math.PI / 180;
  for (let s = 0; s < stopIdxs.length; s++) {
    const px = stopLng[stopIdxs[s]] * kx, py = stopLat[stopIdxs[s]] * ky;
    let best = Infinity, bestJ = j0, bestT = 0;
    for (let j = j0; j < n - 1; j++) {
      const ax = lng[j] * kx, ay = lat[j] * ky, bx = lng[j + 1] * kx, by = lat[j + 1] * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx - px, qy = ay + t * dy - py, dd = qx * qx + qy * qy;
      if (dd < best) { best = dd; bestJ = j; bestT = t; }
      // Stop searching once we're well past a good match
      if (best < 2500 && d[j] - d[bestJ] > 3000) break; // matched within 50 m, now 3 km further
    }
    if (best > 250 * 250) return null;
    const at = d[bestJ] + bestT * (d[bestJ + 1] - d[bestJ]);
    out[s] = Math.max(at, last);
    last = out[s]; j0 = bestJ;
  }
  return out;
}

/** Point and heading (degrees, 0 = north, clockwise) at `m` metres along the shape. */
export function pointAt(shape, m) {
  const { lat, lng, d } = shape;
  const n = d.length;
  if (m <= 0) return { lat: lat[0], lng: lng[0], heading: headingOf(shape, 0) };
  if (m >= d[n - 1]) return { lat: lat[n - 1], lng: lng[n - 1], heading: headingOf(shape, n - 2) };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= m) lo = mid; else hi = mid; }
  const seg = d[hi] - d[lo], t = seg > 0 ? (m - d[lo]) / seg : 0;
  return { lat: lat[lo] + (lat[hi] - lat[lo]) * t, lng: lng[lo] + (lng[hi] - lng[lo]) * t, heading: headingOf(shape, lo) };
}

function headingOf(shape, j) {
  const { lat, lng } = shape;
  const k = Math.max(0, Math.min(j, lat.length - 2));
  const dx = (lng[k + 1] - lng[k]) * Math.cos(toRad(lat[k])), dy = lat[k + 1] - lat[k];
  return Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360);
}

/** The part of a shape between two distances, as [[lat, lng], ...]. */
export function slice(shape, from, to) {
  const { lat, lng, d } = shape;
  const a = pointAt(shape, from), b = pointAt(shape, to);
  const out = [[a.lat, a.lng]];
  for (let i = 0; i < d.length; i++) if (d[i] > from && d[i] < to) out.push([lat[i], lng[i]]);
  out.push([b.lat, b.lng]);
  return out;
}

/** Douglas–Peucker simplification on [[lat, lng], ...] with a tolerance in metres. */
export function simplify(pts, tolM = 6) {
  if (pts.length < 3) return pts;
  const kx = Math.cos(toRad(pts[0][0])) * 111320, ky = 110540;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][1] * kx, ay = pts[a][0] * ky, bx = pts[b][1] * kx, by = pts[b][0] * ky;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const dd = Math.abs((pts[i][1] * kx - ax) * dy - (pts[i][0] * ky - ay) * dx) / len;
      if (dd > maxD) { maxD = dd; idx = i; }
    }
    if (maxD > tolM && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
