// Walking routes along real streets (OpenStreetMap, FOSSGIS OSRM foot profile) for the walks at
// the start and end of a journey. Best effort: if the service is slow or down, the planner's
// straight-line estimate stays. Cached, and limited to a few requests per search.

import { httpFetch } from "./http.js";

const OSRM = process.env.WALK_ROUTER_URL || "https://routing.openstreetmap.de/routed-foot";
const cache = new Map();

export async function walkRoute(a, b, timeoutMs = 2500) {
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const url = `${OSRM}/route/v1/foot/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
  const p = (async () => {
    const res = await httpFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = (await res.json()).routes?.[0];
    if (!r?.geometry?.coordinates?.length) throw new Error("no route");
    return {
      distance: Math.round(r.distance),
      path: r.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
    };
  })();
  cache.set(key, p.catch(() => null));
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return cache.get(key);
}

const PACE = 1.25; // metres per second along the actual street route

/**
 * Replaces straight-line walks (longer than 100 m, not platform changes) with street routes.
 * Walks at the very start or end also get their time from the street distance: the first walk
 * still ends when the first ride leaves, the last one starts when the last ride arrives.
 */
export async function enhanceWalks(journeys, budgetMs = 3000) {
  const jobs = [];
  for (const j of journeys) j.legs.forEach((leg, k) => {
    if (leg.mode !== "walk" || leg.transfer || leg.streetRoute) return;
    if ((leg.distance ?? 0) < 100 || leg.from.lat == null || leg.to.lat == null || jobs.length >= 8) return;
    const atStart = k === 0, atEnd = k === j.legs.length - 1;
    jobs.push(walkRoute(leg.from, leg.to).then(r => {
      if (!r) return;
      leg.path = r.path; leg.distance = r.distance; leg.streetRoute = true;
      const dur = Math.max(60, Math.round(r.distance / PACE)) * 1000;
      if (atStart && atEnd) leg.arr = new Date(Date.parse(leg.dep) + dur).toISOString();     // walk-only
      else if (atStart) leg.dep = new Date(Date.parse(leg.arr) - dur).toISOString();
      else if (atEnd) leg.arr = new Date(Date.parse(leg.dep) + dur).toISOString();
      if (atStart || atEnd) {
        j.dep = j.legs[0].dep; j.arr = j.legs.at(-1).arr;
        j.duration = Math.round((Date.parse(j.arr) - Date.parse(j.dep)) / 60000);
      }
    }).catch(() => {}));
  });
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, budgetMs))]);
  return journeys;
}
