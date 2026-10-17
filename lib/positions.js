// Turns the timetable (+ live delays, when available) into vehicle positions.

import { pointAt } from "./shapes.js";

const BERLIN = { north: 52.70, south: 52.32, west: 13.05, east: 13.80 }; // slightly larger than the city

/** Delay in seconds for a trip at schedule time `t`, or null if no live data. */
export function delayFor(trip, update, t, stopLookup) {
  if (!update?.stops.length) return null;
  // Use the most recent stop update whose scheduled time has passed; before the first one, use the first.
  let best = update.stops[0].delay;
  for (const u of update.stops) {
    const si = u.stopId != null ? stopLookup.get(u.stopId) : undefined;
    if (si === undefined) continue;
    const i = trip.stops.indexOf(si);
    if (i < 0) continue;
    if (trip.dep[i] <= t) best = u.delay; else break;
  }
  return best;
}

/**
 * Where a trip is at schedule time `t` (seconds on the trip's own service day):
 * { lat, lng, heading, i, dwelling, k } — i = last stop reached, k = fraction to the next stop.
 * Follows the track shape when there is one, otherwise a straight line between stops.
 */
export function locateTrip(index, trip, t) {
  const { stops } = index;
  let lo = 0, hi = trip.dep.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (trip.arr[mid] <= t) lo = mid; else hi = mid - 1; }
  const i = lo, last = trip.stops.length - 1;
  const dwelling = t <= trip.dep[i] || i === last;
  const k = dwelling ? 0 : (trip.arr[i + 1] - trip.dep[i] > 0 ? Math.min(1, (t - trip.dep[i]) / (trip.arr[i + 1] - trip.dep[i])) : 1);
  if (trip.sd) {
    const m = dwelling ? trip.sd[i] : trip.sd[i] + (trip.sd[i + 1] - trip.sd[i]) * k;
    const p = pointAt(index.shapes[trip.shape], m);
    return { lat: p.lat, lng: p.lng, heading: p.heading, i, dwelling, k };
  }
  const a = trip.stops[i];
  if (dwelling) return { lat: stops.lat[a], lng: stops.lng[a], heading: null, i, dwelling, k };
  const b = trip.stops[i + 1];
  return { lat: stops.lat[a] + (stops.lat[b] - stops.lat[a]) * k, lng: stops.lng[a] + (stops.lng[b] - stops.lng[a]) * k, heading: null, i, dwelling, k };
}

/**
 * index: from buildIndex; nowSec: seconds since Berlin midnight on index.serviceDate;
 * rt: result of fetchTripUpdates or null.
 */
export function computePositions(index, nowSec, rt) {
  const { trips } = index;
  const out = [];
  let live = 0;

  for (const trip of trips) {
    const tDay = nowSec - trip.day * 86400; // time on this trip's own service day
    // quick reject with a generous delay margin
    if (tDay < trip.start - 3600 || tDay > trip.end + 3600) continue;

    const update = trip.day === 1 ? null : rt?.updates.get(trip.id); // live data is for running trips
    if (update?.canceled) continue;
    const delay = delayFor(trip, update, tDay, index.stopLookup);
    const t = tDay - (delay ?? 0); // where the vehicle is in its schedule

    if (t < trip.start || t > trip.end) continue;

    const { lat, lng, heading } = locateTrip(index, trip, t);

    if (lat > BERLIN.north || lat < BERLIN.south || lng < BERLIN.west || lng > BERLIN.east) continue;
    if (delay !== null) live++;

    out.push({
      id: `t:${trip.id}:${trip.day}`,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      product: trip.product,
      line: trip.line,
      dir: trip.dir,
      delay, // seconds, or null = timetable only
      source: delay !== null ? "delays" : "timetable",
      h: heading, // direction of travel in degrees (0 = north), when known from the track
    });
  }
  return { vehicles: out, live };
}

/**
 * Final touches on a freshly built or cached index: the stop_id -> stop index lookup used to
 * match live stop updates. (The index already stores its arrays compactly as typed arrays.)
 */
export function prepareIndex(index) {
  index.stopLookup = new Map(index.stops.id.map((id, i) => [id, i]));
  return index;
}
