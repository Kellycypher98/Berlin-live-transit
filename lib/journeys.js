// Journey planning and departures.
//
// Journeys: the community API (v6.vbb.transport.rest/journeys) is tried first because it knows
// live delays. If it's slow or down, a local planner answers from the official timetable,
// using the Connection Scan Algorithm (CSA): all departures of the day sorted by time, scanned once.

import { httpFetch } from "./http.js";
import { delayFor } from "./positions.js";
import { slice, simplify } from "./shapes.js";

const MIN_CHANGE_S = 120;          // minimum time to change between two vehicles
const WALK_SPEED_MS = 1.2;         // metres per second (with some margin)
const MAX_WALK_M = 300;            // walk between nearby stops up to this distance
const SAME_STATION_WALK_S = 180;   // changing platforms within one station
const SEARCH_WINDOW_S = 4 * 3600;  // look for journeys up to 4 h ahead

const toRad = d => (d * Math.PI) / 180;
export function distanceM(lat1, lng1, lat2, lng2) {
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * 6371000;
}

// ---------------------------------------------------------------------------
// Network: sorted connections + footpaths, built once per service day
// ---------------------------------------------------------------------------

export function buildNetwork(index, log = console.log) {
  const started = Date.now();
  const { trips, stops } = index;

  // Connections: one per pair of consecutive stops of every trip. Times are seconds
  // since midnight of the service day; yesterday's trips are shifted by -24 h.
  let n = 0;
  for (const t of trips) n += t.stops.length - 1;
  const order = new Uint32Array(n);
  const depT = new Int32Array(n), arrT = new Int32Array(n), from = new Int32Array(n), to = new Int32Array(n);
  const trip = new Int32Array(n), pos = new Int32Array(n);
  let k = 0;
  trips.forEach((t, ti) => {
    const off = t.day * 86400;
    for (let i = 0; i < t.stops.length - 1; i++, k++) {
      depT[k] = t.dep[i] + off; arrT[k] = t.arr[i + 1] + off;
      from[k] = t.stops[i]; to[k] = t.stops[i + 1]; trip[k] = ti; pos[k] = i;
      order[k] = k;
    }
  });
  order.sort((a, b) => depT[a] - depT[b] || arrT[a] - arrT[b]);
  const c = {
    depT: Int32Array.from(order, i => depT[i]), arrT: Int32Array.from(order, i => arrT[i]),
    from: Int32Array.from(order, i => from[i]), to: Int32Array.from(order, i => to[i]),
    trip: Int32Array.from(order, i => trip[i]), pos: Int32Array.from(order, i => pos[i]),
  };
  // Same connections ordered by arrival, latest first — for "arrive by" searches
  const byArr = new Uint32Array(n);
  for (let i = 0; i < n; i++) byArr[i] = i;
  byArr.sort((a, b) => c.arrT[b] - c.arrT[a]);

  // Footpaths between stops of the same station, and between stops less than MAX_WALK_M apart
  const nStops = stops.id.length;
  const cell = 0.004; // ~300-450 m grid cells
  const grid = new Map();
  for (let s = 0; s < nStops; s++) {
    const kk = `${Math.floor(stops.lat[s] / cell)}:${Math.floor(stops.lng[s] / cell)}`;
    let list = grid.get(kk); if (!list) grid.set(kk, (list = [])); list.push(s);
  }
  const fpStart = new Int32Array(nStops + 1);
  const fpTo = [], fpDur = [];
  for (let s = 0; s < nStops; s++) {
    fpStart[s] = fpTo.length;
    const gy = Math.floor(stops.lat[s] / cell), gx = Math.floor(stops.lng[s] / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const q of grid.get(`${gy + dy}:${gx + dx}`) ?? []) {
        if (q === s) continue;
        const d = distanceM(stops.lat[s], stops.lng[s], stops.lat[q], stops.lng[q]);
        const sameStation = stops.station[q] === stops.station[s];
        if (!sameStation && d > MAX_WALK_M) continue;
        fpTo.push(q);
        fpDur.push(Math.max(sameStation ? SAME_STATION_WALK_S : 60, Math.round(d / WALK_SPEED_MS) + 60));
      }
    }
  }
  fpStart[nStops] = fpTo.length;

  // Stops of each station
  const stationStops = new Map();
  for (let s = 0; s < nStops; s++) {
    const st = stops.station[s];
    let l = stationStops.get(st); if (!l) stationStops.set(st, (l = [])); l.push(s);
  }

  log(`Journey planner ready: ${n.toLocaleString()} connections, ${fpTo.length.toLocaleString()} walking links, ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  return { c, n, byArr, grid, cell, fp: { start: fpStart, to: Int32Array.from(fpTo), dur: Int32Array.from(fpDur) }, stationStops, serviceDate: index.serviceDate };
}

// ---------------------------------------------------------------------------
// Connection Scan: earliest arrival from one station to another
// ---------------------------------------------------------------------------

function firstConnectionAt(c, n, t) {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c.depT[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
}

// Walking to/from arbitrary points: straight-line distance × detour factor, at an easy pace
const DETOUR = 1.3;
const WALK_PACE_MS = 1.25;
export const walkSeconds = m => Math.round((m * DETOUR) / WALK_PACE_MS);
const MAX_ACCESS_M = 1000;  // look for stops this far from a start or destination address
const WALK_ONLY_MAX_M = 2500;

/** Stops within `radius` metres of a point, nearest first (at most 40). */
export function nearbyStops(net, index, lat, lng, radius = MAX_ACCESS_M) {
  const { stops } = index;
  const cell = net.cell, r = Math.ceil(radius / 250) + 1;
  const gy = Math.floor(lat / cell), gx = Math.floor(lng / cell);
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    for (const s of net.grid.get(`${gy + dy}:${gx + dx}`) ?? []) {
      const d = distanceM(lat, lng, stops.lat[s], stops.lng[s]);
      if (d <= radius) out.push({ stop: s, d });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, 40);
}

/**
 * A journey end for the local planner: a station (all of its stops, no walking) or a point
 * (stops within walking range, each with its walking time). Returns Map(stop -> seconds).
 */
export function endpointStops(net, index, place) {
  if (place.station != null) return new Map((net.stationStops.get(place.station) ?? []).map(s => [s, 0]));
  let near = nearbyStops(net, index, place.lat, place.lng);
  if (!near.length) near = nearbyStops(net, index, place.lat, place.lng, 2000);
  return new Map(near.map(({ stop, d }) => [stop, walkSeconds(d)]));
}

// Connection Scan from several start stops (each with its walking time) to several end stops
function scan(net, index, origins, targets, departSec) {
  const { c, n, fp } = net;
  const nStops = index.stops.id.length;
  const INF = 0x7fffffff;
  const arrival = new Int32Array(nStops).fill(INF);
  const inConn = new Int32Array(nStops).fill(-1);    // reached by riding this connection
  const walkFrom = new Int32Array(nStops).fill(-1);  // or by walking from this stop
  const boarded = new Int32Array(index.trips.length).fill(-1); // first connection used on each trip
  if (!origins.size || !targets.size) return null;

  let best = INF, bestStop = -1;
  const reach = (q, tq) => {
    const egress = targets.get(q);
    if (egress !== undefined && tq + egress < best) { best = tq + egress; bestStop = q; }
  };
  const relax = (s, t) => {
    for (let j = fp.start[s]; j < fp.start[s + 1]; j++) {
      const q = fp.to[j], tq = t + fp.dur[j];
      if (tq < arrival[q]) { arrival[q] = tq; inConn[q] = -1; walkFrom[q] = s; reach(q, tq); }
    }
  };
  for (const [s, acc] of origins) if (departSec + acc < arrival[s]) { arrival[s] = departSec + acc; reach(s, arrival[s]); }
  for (const s of origins.keys()) relax(s, arrival[s]);

  const end = departSec + SEARCH_WINDOW_S;
  for (let i = firstConnectionAt(c, n, departSec); i < n; i++) {
    const dep = c.depT[i];
    if (dep > best || dep > end) break;
    const tr = c.trip[i];
    if (boarded[tr] < 0) {
      const s = c.from[i];
      if (arrival[s] === INF) continue;
      const ready = arrival[s] + (inConn[s] >= 0 ? MIN_CHANGE_S : 0);
      if (ready > dep) continue;
      boarded[tr] = i;
    }
    const q = c.to[i], tq = c.arrT[i];
    if (tq < arrival[q]) {
      arrival[q] = tq; inConn[q] = i; walkFrom[q] = -1;
      reach(q, tq);
      relax(q, tq);
    }
  }
  if (bestStop < 0) return null;

  // Walk back from the end stop to the start stop
  const legs = [];
  let s = bestStop, guard = 0;
  while ((inConn[s] >= 0 || walkFrom[s] >= 0) && guard++ < 60) {
    if (inConn[s] >= 0) {
      const last = inConn[s], first = boarded[c.trip[last]];
      legs.push({ type: "transit", trip: c.trip[last], fromPos: c.pos[first], toPos: c.pos[last] + 1, dep: c.depT[first], arr: c.arrT[last] });
      s = c.from[first];
    } else {
      const w = walkFrom[s];
      legs.push({ type: "walk", fromStop: w, toStop: s, dur: arrival[s] - arrival[w] });
      s = w;
    }
  }
  legs.reverse();
  return { legs, startStop: s, endStop: bestStop, access: origins.get(s) ?? 0, egress: targets.get(bestStop) ?? 0 };
}

// Reverse Connection Scan: the latest departure that still arrives by `arriveSec`
function scanBack(net, index, origins, targets, arriveSec) {
  const { c, n, byArr, fp } = net;
  const nStops = index.stops.id.length;
  const NEG = -0x7fffffff;
  const latest = new Int32Array(nStops).fill(NEG);   // latest time you can be here and still make it
  const outConn = new Int32Array(nStops).fill(-1);   // leave by boarding this connection
  const walkTo = new Int32Array(nStops).fill(-1);    // or by walking to this stop
  const walkDur = new Int32Array(nStops);
  const alight = new Int32Array(index.trips.length).fill(-1); // where each usable trip is left
  if (!origins.size || !targets.size) return null;

  let best = NEG, bestStop = -1;
  const reach = (q, tq) => {
    const access = origins.get(q);
    if (access !== undefined && tq - access > best) { best = tq - access; bestStop = q; }
  };
  const relax = (s, t) => { // walking links are symmetric, so walking q -> s takes the same time
    for (let j = fp.start[s]; j < fp.start[s + 1]; j++) {
      const q = fp.to[j], tq = t - fp.dur[j];
      if (tq > latest[q]) { latest[q] = tq; outConn[q] = -1; walkTo[q] = s; walkDur[q] = fp.dur[j]; reach(q, tq); }
    }
  };
  for (const [s, egr] of targets) if (arriveSec - egr > latest[s]) { latest[s] = arriveSec - egr; reach(s, latest[s]); }
  for (const s of targets.keys()) relax(s, latest[s]);

  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c.arrT[byArr[mid]] > arriveSec) lo = mid + 1; else hi = mid; }
  const stop = arriveSec - SEARCH_WINDOW_S;
  for (let k = lo; k < n; k++) {
    const i = byArr[k], arr = c.arrT[i];
    if (arr < best || arr < stop) break;
    const tr = c.trip[i];
    if (alight[tr] < 0) {
      const v = c.to[i];
      if (latest[v] === NEG) continue;
      if (arr + (outConn[v] >= 0 ? MIN_CHANGE_S : 0) > latest[v]) continue;
      alight[tr] = i;
    }
    const u = c.from[i], dep = c.depT[i];
    if (dep > latest[u]) {
      latest[u] = dep; outConn[u] = i; walkTo[u] = -1;
      reach(u, dep);
      relax(u, dep);
    }
  }
  if (bestStop < 0) return null;

  const legs = [];
  let s = bestStop, guard = 0;
  while ((outConn[s] >= 0 || walkTo[s] >= 0) && guard++ < 60) {
    if (outConn[s] >= 0) {
      const b = outConn[s], e = alight[c.trip[b]];
      legs.push({ type: "transit", trip: c.trip[b], fromPos: c.pos[b], toPos: c.pos[e] + 1, dep: c.depT[b], arr: c.arrT[e] });
      s = c.to[e];
    } else {
      legs.push({ type: "walk", fromStop: s, toStop: walkTo[s], dur: walkDur[s] });
      s = walkTo[s];
    }
  }
  return { legs, startStop: bestStop, endStop: s, access: origins.get(bestStop) ?? 0, egress: targets.get(s) ?? 0 };
}

/** Adds the walks to/from the address, drops walks inside the start/end station, and times every walk. */
function finishLegs(r, index, from, to) {
  const legs = r.legs.slice();
  const st = index.stops.station;
  if (from.station != null) while (legs.length && legs[0].type === "walk" && st[legs[0].toStop] === from.station) legs.shift();
  if (to.station != null) while (legs.length && legs.at(-1).type === "walk" && st[legs.at(-1).fromStop] === to.station) legs.pop();
  if (from.station == null && r.access > 0) legs.unshift({ type: "walk", fromPlace: from, toStop: r.startStop, dur: r.access });
  if (to.station == null && r.egress > 0) legs.push({ type: "walk", fromStop: r.endStop, toPlace: to, dur: r.egress });
  if (!legs.some(l => l.type === "transit")) return null;
  // A walk starts when the previous ride arrives; walks before the first ride end as it leaves
  const firstRide = legs.findIndex(l => l.type === "transit");
  for (let k = firstRide - 1; k >= 0; k--) { legs[k].arr = legs[k + 1].dep; legs[k].dep = legs[k].arr - legs[k].dur; }
  for (let k = firstRide + 1; k < legs.length; k++) {
    if (legs[k].type !== "walk") continue;
    legs[k].dep = legs[k - 1].arr; legs[k].arr = legs[k].dep + legs[k].dur;
  }
  return legs;
}

/**
 * Up to `count` journeys between two places (stations or points). mode "depart": leaving at or
 * after `sec`, earliest first; mode "arrive": arriving by `sec`. Times are service-day seconds.
 * `from`/`to`: { station } or { lat, lng, name }.
 */
export function planLocal(net, index, from, to, sec, { mode = "depart", count = 3, rt = null } = {}) {
  const origins = endpointStops(net, index, from);
  const targets = endpointStops(net, index, to);
  const out = [];
  let t = sec;
  for (let k = 0; k < count + 2 && out.length < count; k++) {
    const r = mode === "arrive" ? scanBack(net, index, origins, targets, t) : scan(net, index, origins, targets, t);
    if (!r) break;
    const legs = finishLegs(r, index, from, to);
    if (!legs) break;
    const rides = legs.filter(l => l.type === "transit");
    const sig = rides.map(l => index.trips[l.trip].id).join(">");
    if (!out.some(j => j.sig === sig)) out.push({ sig, legs });
    t = mode === "arrive" ? rides.at(-1).arr - 60 : rides[0].dep + 60;
  }
  if (mode === "arrive") out.reverse();
  const journeys = out.map(j => formatLocal(j.legs, index, rt));

  // Short distances: walking the whole way is an option too
  const a = placeCoords(index, from), b = placeCoords(index, to);
  const d = distanceM(a.lat, a.lng, b.lat, b.lng);
  if (d <= WALK_ONLY_MAX_M) {
    const w = walkSeconds(d), midnight = serviceMidnightMs(index.serviceDate);
    const dep = mode === "arrive" ? sec - w : sec, arr = dep + w;
    const iso = x => new Date(midnight + x * 1000).toISOString();
    journeys.push(summarize([{
      mode: "walk", transfer: false, from: { ...a, name: from.name ?? a.name }, to: { ...b, name: to.name ?? b.name },
      dep: iso(dep), arr: iso(arr), distance: Math.round(d), path: [[a.lat, a.lng], [b.lat, b.lng]], stops: [],
    }], "walk"));
  }
  return journeys;
}

function placeCoords(index, p) {
  if (p.station != null) return { lat: index.stations.lat[p.station], lng: index.stations.lng[p.station], name: index.stations.name[p.station] };
  return { lat: p.lat, lng: p.lng, name: p.name };
}

function formatLocal(legs, index, rt) {
  const { stops, stations, trips } = index;
  const midnight = serviceMidnightMs(index.serviceDate);
  const iso = s => new Date(midnight + s * 1000).toISOString();
  const place = s => ({ name: stations.name[stops.station[s]], lat: stops.lat[s], lng: stops.lng[s], station: stops.station[s] });
  const pointOf = p => ({ name: p.name ?? "Selected location", lat: p.lat, lng: p.lng });

  const outLegs = legs.map(l => {
    if (l.type === "walk") {
      const a = l.fromPlace ? pointOf(l.fromPlace) : place(l.fromStop);
      const b = l.toPlace ? pointOf(l.toPlace) : place(l.toStop);
      return {
        mode: "walk", transfer: a.station != null && a.station === b.station, from: a, to: b, dep: iso(l.dep), arr: iso(l.arr),
        distance: Math.round(distanceM(a.lat, a.lng, b.lat, b.lng) * (l.fromPlace || l.toPlace ? DETOUR : 1)),
        path: [[a.lat, a.lng], [b.lat, b.lng]], stops: [],
      };
    }
    const t = trips[l.trip];
    const update = t.day === 1 ? null : rt?.updates.get(t.id);
    const delay = update ? delayFor(t, update, t.dep[l.fromPos], index.stopLookup) : null;
    const seq = [];
    for (let i = l.fromPos; i <= l.toPos; i++) {
      seq.push({ ...place(t.stops[i]), time: iso((i === l.fromPos ? t.dep[i] : t.arr[i]) + t.day * 86400) });
    }
    return {
      mode: "transit", line: t.line, product: t.product, dir: t.dir,
      from: seq[0], to: seq.at(-1), dep: iso(l.dep), arr: iso(l.arr), delay,
      track: { trip: t.id, day: t.day, board: l.fromPos, alight: l.toPos },
      path: t.sd
        ? simplify(slice(index.shapes[t.shape], t.sd[l.fromPos], t.sd[l.toPos]), 4).map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5])
        : seq.map(p => [p.lat, p.lng]),
      stops: seq.slice(1, -1),
    };
  });
  return summarize(outLegs, "timetable");
}

function summarize(legs, source) {
  const dep = legs[0].dep, arr = legs.at(-1).arr;
  return {
    source, dep, arr,
    duration: Math.round((Date.parse(arr) - Date.parse(dep)) / 60000),
    transfers: Math.max(0, legs.filter(l => l.mode === "transit").length - 1),
    legs,
  };
}

/** Epoch ms of 00:00 Berlin time on a service date (GTFS times count from here). */
export function serviceMidnightMs(yyyymmdd) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  // Find the UTC offset Berlin had at noon that day (handles summer/winter time)
  const noonUtc = Date.UTC(y, m - 1, d, 12);
  const berlinNoon = new Date(noonUtc).toLocaleString("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23" });
  const hour = +berlinNoon.split(", ")[1].split(":")[0];
  return Date.UTC(y, m - 1, d) - (hour - 12) * 3600000;
}

// ---------------------------------------------------------------------------
// Community API journeys (live delays) — tried first
// ---------------------------------------------------------------------------

/** VBB station ids contain a 9-digit HAFAS id (e.g. de:11000:900100003 -> 900100003). */
export function hafasId(gtfsId) {
  return gtfsId.match(/9\d{8}/)?.[0] ?? null;
}

export async function fetchCommunityJourneys(baseUrl, from, to, { count = 3, when = null, mode = "depart", timeoutMs = 10000 } = {}) {
  const q = new URLSearchParams({ results: String(count), stopovers: "true", remarks: "false", language: "en" });
  if (when) q.set(mode === "arrive" ? "arrival" : "departure", new Date(when).toISOString());
  const loc = (k, st) => {
    const id = st.id ? hafasId(st.id) : null;
    if (id) q.set(k, id);
    else { q.set(`${k}.latitude`, String(st.lat)); q.set(`${k}.longitude`, String(st.lng)); q.set(`${k}.address`, st.name || "Location"); }
  };
  loc("from", from); loc("to", to);
  const res = await httpFetch(`${baseUrl}/journeys?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const journeys = (data.journeys ?? []).map(j => {
    const legs = (j.legs ?? []).map(convertCommunityLeg).filter(Boolean);
    return legs.length ? summarize(legs, "live") : null;
  }).filter(Boolean);
  if (!journeys.length) throw new Error("no journeys returned");
  return journeys;
}

function placeOf(x) {
  const s = x?.location || x?.latitude != null ? x : x?.stop ?? x;
  const l = s?.location ?? s ?? {};
  return { name: s?.name ?? s?.address ?? "?", lat: l.latitude, lng: l.longitude };
}

function convertCommunityLeg(leg) {
  const from = placeOf(leg.origin), to = placeOf(leg.destination);
  const dep = leg.departure ?? leg.plannedDeparture, arr = leg.arrival ?? leg.plannedArrival;
  if (!dep || !arr) return null;
  if (leg.walking) {
    return {
      mode: "walk", transfer: from.name === to.name, from, to, dep, arr, distance: leg.distance ?? null,
      path: [[from.lat, from.lng], [to.lat, to.lng]].filter(p => p[0] != null), stops: [],
    };
  }
  const stopovers = (leg.stopovers ?? []).map(s => ({
    ...placeOf(s.stop), time: s.departure ?? s.arrival ?? s.plannedDeparture ?? s.plannedArrival,
  })).filter(s => s.lat != null);
  const path = stopovers.length ? stopovers.map(s => [s.lat, s.lng]) : [[from.lat, from.lng], [to.lat, to.lng]];
  return {
    mode: "transit", line: leg.line?.name ?? "?", product: leg.line?.product ?? "unknown", dir: leg.direction ?? "",
    from, to, dep, arr, delay: leg.departureDelay ?? null,
    path, stops: stopovers.slice(1, -1),
    cancelled: !!leg.cancelled,
    // Used to find this trip in the timetable for live tracking
    fromId: leg.origin?.id ?? null, toId: leg.destination?.id ?? null,
    plannedDep: leg.plannedDeparture ?? null, hafasTrip: leg.tripId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Departures at a station (timetable + live delays)
// ---------------------------------------------------------------------------

export function departures(index, station, nowSec, rt, { windowS = 3600, limit = 25 } = {}) {
  const { trips, stops } = index;
  const midnight = serviceMidnightMs(index.serviceDate);
  const out = [];
  for (const t of trips) {
    const off = t.day * 86400;
    if (t.start + off > nowSec + windowS || t.end + off < nowSec - 600) continue;
    for (let i = 0; i < t.stops.length - 1; i++) {
      if (stops.station[t.stops[i]] !== station) continue;
      const planned = t.dep[i] + off;
      if (planned > nowSec + windowS || planned < nowSec - 1800) continue;
      const update = t.day === 1 ? null : rt?.updates.get(t.id);
      if (update?.canceled) continue;
      const delay = update ? delayFor(t, update, t.dep[i], index.stopLookup) : null;
      const actual = planned + (delay ?? 0);
      if (actual < nowSec - 30) continue;
      out.push({ line: t.line, product: t.product, dir: t.dir, planned: new Date(midnight + planned * 1000).toISOString(), delay, sort: actual });
    }
  }
  out.sort((a, b) => a.sort - b.sort);
  // The same trip can appear twice at a station (loops); keep the first
  return out.slice(0, limit).map(({ sort, ...d }) => d);
}
