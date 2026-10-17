// Live tracking of one trip (the vehicle a traveller is waiting for or riding).
//
// Position sources, best first:
//   1. live     — the community API's live position (radar), matched by trip id, or by
//                 same line close to where the timetable says the vehicle should be
//   2. delays   — official timetable moved by the official live delay
//   3. timetable
// If the trip isn't in our timetable (rare), the community API's /trips endpoint is asked directly.

import { httpFetch } from "./http.js";
import { delayFor, locateTrip } from "./positions.js";
import { hafasId, serviceMidnightMs, distanceM } from "./journeys.js";

const normLine = l => (l ?? "").replace(/\s+/g, "").toUpperCase();
const normDir = d => (d ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(s\+u|s|u)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
/** Same direction if one headsign's first word appears in the other ("S+U Pankow" ~ "Pankow (Berlin)"). */
function sameDirection(a, b) {
  const x = normDir(a), y = normDir(b);
  if (!x || !y) return true; // unknown: don't rule it out
  return x.includes(y.split(" ")[0]) || y.includes(x.split(" ")[0]);
}

/** trip id + day -> trip object, built once per index. */
export function tripLookup(index) {
  if (!index._tripLookup) {
    const m = new Map();
    for (const t of index.trips) m.set(`${t.id}|${t.day}`, t);
    index._tripLookup = m;
  }
  return index._tripLookup;
}

/** HAFAS station id (9 digits) -> station index, built once per index. */
function hafasStations(index) {
  if (!index._hafas) {
    const m = new Map();
    index.stations.id.forEach((id, i) => { const h = hafasId(id); if (h && !m.has(h)) m.set(h, i); });
    index._hafas = m;
  }
  return index._hafas;
}

/**
 * Finds the timetable trip behind a community-API journey leg: same line, departing the same
 * station at the same planned time. Returns { trip, day, board, alight } or null.
 */
export function matchCommunityLeg(index, leg) {
  const hs = hafasStations(index);
  const fromSt = hs.get(hafasId(leg.fromId ?? "") ?? "");
  const toSt = hs.get(hafasId(leg.toId ?? "") ?? "");
  const planned = Date.parse(leg.plannedDep ?? leg.dep);
  if (fromSt === undefined || !Number.isFinite(planned)) return null;
  const midnight = serviceMidnightMs(index.serviceDate);
  const want = normLine(leg.line);
  const { stops } = index;
  let best = null, bestDiff = 90_000; // within 90 s of the planned departure, closest wins
  for (const t of index.trips) {
    if (normLine(t.line) !== want) continue;
    const off = t.day * 86400;
    for (let i = 0; i < t.stops.length - 1; i++) {
      if (stops.station[t.stops[i]] !== fromSt) continue;
      const diff = Math.abs(midnight + (t.dep[i] + off) * 1000 - planned);
      if (diff > bestDiff) continue;
      let alight = -1;
      if (toSt !== undefined) for (let j = i + 1; j < t.stops.length; j++) if (stops.station[t.stops[j]] === toSt) { alight = j; break; }
      if (toSt !== undefined && alight < 0) continue; // this run doesn't reach the destination
      best = { trip: t.id, day: t.day, board: i, alight: alight >= 0 ? alight : t.stops.length - 1 };
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Current state of a timetable trip, with the best available position.
 * `radarVehicles`: fresh live vehicles (from the radar poller), may be empty.
 */
export function trackTrip(index, ref, nowSec, rt, radarVehicles = []) {
  const trip = tripLookup(index).get(`${ref.trip}|${ref.day}`);
  if (!trip) return null;
  const { stops, stations } = index;
  const midnight = serviceMidnightMs(index.serviceDate);
  const off = trip.day * 86400;
  const iso = s => new Date(midnight + (s + off) * 1000).toISOString();

  const tDay = nowSec - off;
  const update = trip.day === 1 ? null : rt?.updates.get(trip.id);
  const cancelled = !!update?.canceled;
  const delay = update ? delayFor(trip, update, tDay, index.stopLookup) : null;
  const t = tDay - (delay ?? 0);
  const state = cancelled ? "cancelled" : t < trip.start ? "scheduled" : t > trip.end ? "finished" : "running";

  const loc = locateTrip(index, trip, Math.min(Math.max(t, trip.start), trip.end));
  let lat = loc.lat, lng = loc.lng, heading = loc.heading;
  let source = delay !== null ? "delays" : "timetable";
  let liveDelay = delay;

  // Prefer a live position: same HAFAS trip id, or same line within 1.5 km of the expected spot
  if (state === "running" || state === "scheduled") {
    let best = null, bestD = Infinity;
    for (const v of radarVehicles) {
      if (ref.hafas && v.id === `r:${ref.hafas}`) { best = v; bestD = 0; break; }
      if (normLine(v.line) !== normLine(trip.line) || !sameDirection(v.dir, trip.dir)) continue;
      const d = distanceM(lat, lng, v.lat, v.lng);
      if (d < 1500 && d < bestD) { best = v; bestD = d; }
    }
    if (best && (state === "running" || bestD < 300)) {
      lat = best.lat; lng = best.lng; source = "live";
      if (best.delay != null) liveDelay = best.delay;
    }
  }

  // trip.stops is a typed array: Array.from, because .map on it would coerce the objects to numbers
  const stopList = Array.from(trip.stops, (s, i) => {
    const st = stops.station[s];
    return {
      name: stations.name[st], station: st, lat: stops.lat[s], lng: stops.lng[s],
      arr: iso(trip.arr[i]), dep: iso(trip.dep[i]),
    };
  });
  // Next stop the vehicle hasn't reached yet
  const next = state === "scheduled" ? 0 : state === "finished" ? stopList.length : loc.dwelling ? loc.i : loc.i + 1;

  return {
    ref: { trip: trip.id, day: trip.day },
    line: trip.line, product: trip.product, dir: trip.dir,
    state, source, delay: liveDelay,
    lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, heading,
    atStop: state === "running" && loc.dwelling ? loc.i : null,
    next, stops: stopList,
    updatedAt: new Date().toISOString(),
  };
}

/** Fallback: ask the community API about a trip we couldn't find in the timetable. */
export async function trackCommunityTrip(baseUrl, hafasTripId, timeoutMs = 8000) {
  const q = new URLSearchParams({ stopovers: "true", polyline: "false", remarks: "false", language: "en" });
  const res = await httpFetch(`${baseUrl}/trips/${encodeURIComponent(hafasTripId)}?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const trip = data.trip ?? data;
  const sto = trip.stopovers ?? [];
  const now = Date.now();
  const stopList = sto.map(s => ({
    name: s.stop?.name ?? "?", station: null,
    lat: s.stop?.location?.latitude, lng: s.stop?.location?.longitude,
    arr: s.plannedArrival ?? s.plannedDeparture, dep: s.plannedDeparture ?? s.plannedArrival,
    delay: s.departureDelay ?? s.arrivalDelay ?? null,
  }));
  let next = sto.findIndex(s => Date.parse(s.arrival ?? s.departure ?? s.plannedArrival ?? s.plannedDeparture) > now);
  if (next < 0) next = stopList.length;
  const loc = trip.currentLocation;
  const first = Date.parse(sto[0]?.departure ?? sto[0]?.plannedDeparture);
  const state = trip.cancelled ? "cancelled" : now < first ? "scheduled" : next >= stopList.length ? "finished" : "running";
  const fallback = stopList[Math.min(next, stopList.length - 1)];
  return {
    ref: { hafas: hafasTripId },
    line: trip.line?.name ?? "?", product: trip.line?.product ?? "unknown", dir: trip.direction ?? "",
    state, source: loc ? "live" : "timetable",
    delay: stopList[Math.min(next, stopList.length - 1)]?.delay ?? null,
    lat: loc?.latitude ?? fallback?.lat, lng: loc?.longitude ?? fallback?.lng, heading: null,
    atStop: null, next, stops: stopList,
    updatedAt: new Date().toISOString(),
  };
}
