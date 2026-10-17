// Network map: one set of paths per line (U-Bahn, S-Bahn, tram, regional, ferry), built from
// the track shapes of today's trips. Each line has many shape variants (directions, short
// turns, depot runs); a variant is only added when it covers track the line doesn't have yet.

import { simplify } from "./shapes.js";

const MAP_PRODUCTS = new Set(["subway", "suburban", "tram", "regional", "ferry"]);
const BOX = { north: 52.80, south: 52.25, west: 12.90, east: 13.95 }; // Berlin plus a margin
const CELL = 0.0005; // ~35–55 m grid used to detect track that's already drawn

export function buildLineMap(index, log = console.log) {
  const started = Date.now();
  // line -> shape index -> number of trips
  const lines = new Map();
  for (const t of index.trips) {
    if (t.shape < 0 || !t.sd || !MAP_PRODUCTS.has(t.product) || t.day !== 0) continue;
    const key = `${t.product}|${t.line}`;
    let shapes = lines.get(key);
    if (!shapes) lines.set(key, (shapes = new Map()));
    shapes.set(t.shape, (shapes.get(t.shape) ?? 0) + 1);
  }

  const out = [];
  for (const [key, shapeCounts] of lines) {
    const [product, line] = key.split("|");
    // Most-used, longest variants first
    const candidates = [...shapeCounts.entries()]
      .map(([si, trips]) => ({ si, trips, len: index.shapes[si].d.at(-1) }))
      .sort((a, b) => b.trips - a.trips || b.len - a.len);
    const covered = new Set();
    const paths = [];
    for (const { si } of candidates) {
      const sh = index.shapes[si];
      const samples = sample(sh, 40);
      const done = samples.filter(([la, ln]) => covered.has(cellKey(la, ln))).length;
      if (samples.length && done / samples.length > 0.85) continue; // nothing new
      for (const [la, ln] of samples) markAround(covered, la, ln);
      const pts = [];
      for (let i = 0; i < sh.lat.length; i++) pts.push([sh.lat[i], sh.lng[i]]);
      for (const run of clip(pts)) {
        const simple = simplify(run, 6);
        if (simple.length > 1) paths.push(simple.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]));
      }
    }
    if (paths.length) out.push({ line, product, paths });
  }
  // Draw order: regional and S-Bahn under U-Bahn, trams on top
  const ORDER = { regional: 0, ferry: 1, suburban: 2, subway: 3, tram: 4 };
  out.sort((a, b) => ORDER[a.product] - ORDER[b.product] || a.line.localeCompare(b.line, "de", { numeric: true }));
  log(`Line map ready: ${out.length} lines, ${out.reduce((n, l) => n + l.paths.length, 0)} paths, ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  return out;
}

const cellKey = (la, ln) => `${Math.floor(la / CELL)}:${Math.floor(ln / CELL)}`;
function markAround(set, la, ln) {
  const y = Math.floor(la / CELL), x = Math.floor(ln / CELL);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set.add(`${y + dy}:${x + dx}`);
}

/** Points every `step` metres along a shape. */
function sample(sh, step) {
  const out = [];
  let next = 0;
  for (let i = 0; i < sh.d.length; i++) {
    if (sh.d[i] >= next) { out.push([sh.lat[i], sh.lng[i]]); next = sh.d[i] + step; }
  }
  return out;
}

/** Splits a path into the runs that lie inside the map box. */
function clip(pts) {
  const runs = [];
  let cur = [];
  for (const p of pts) {
    const inside = p[0] <= BOX.north && p[0] >= BOX.south && p[1] >= BOX.west && p[1] <= BOX.east;
    if (inside) cur.push(p);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}
