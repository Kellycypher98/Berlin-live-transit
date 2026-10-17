// Berlin Live Transit — backend
// Combines three VBB data sources, best first, per area of the map:
//   1. Live positions   — community API (v6.vbb.transport.rest /radar)
//   2. Timetable + live delays — official GTFS timetable + official GTFS-Realtime feed
//   3. Timetable only   — when both live feeds are down
// Berlin is split into 16 areas. Where live positions are fresh, they're used; everywhere
// else the timetable-based positions fill in. One snapshot is pushed to every client.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { berlinNow } from "./lib/berlinTime.js";
import { ensureGtfs, buildIndex } from "./lib/timetable.js";
import { fetchTripUpdates } from "./lib/realtime.js";
import { computePositions, prepareIndex } from "./lib/positions.js";
import { RadarPoller } from "./lib/radar.js";
import { buildNetwork, planLocal, fetchCommunityJourneys, departures, serviceMidnightMs } from "./lib/journeys.js";
import { gzipSync } from "node:zlib";
import { USER_AGENT } from "./lib/http.js";
import { buildLineMap } from "./lib/lines.js";
import { matchCommunityLeg, trackTrip, trackCommunityTrip } from "./lib/tracking.js";
import { searchPlaces, reversePlace } from "./lib/places.js";
import { enhanceWalks } from "./lib/walk.js";

const PORT = process.env.PORT || 3000;
const GTFS_URL = process.env.GTFS_URL
  || "https://unternehmen.vbb.de/fileadmin/user_upload/VBB/Dokumente/API-Datensaetze/gtfs-mastscharf/GTFS.zip";
const GTFS_RT_URL = process.env.GTFS_RT_URL || "https://production.gtfsrt.vbb.de/data";
const COMMUNITY_API = (process.env.COMMUNITY_API || "https://v6.vbb.transport.rest").replace(/\/$/, "");
const RADAR_URL = process.env.RADAR_URL || `${COMMUNITY_API}/radar`;
const RADAR_ENABLED = process.env.RADAR !== "off";
const TICK_MS = 10000;      // recompute + push positions every 10 s
const RT_POLL_MS = 30000;   // fetch live delays every 30 s
const RT_MAX_AGE_MS = 5 * 60 * 1000; // ignore live delays older than 5 min

const log = (...a) => console.log(...a);

let index = null;           // timetable for the current service day
let rt = null;              // latest realtime result
let rtStatus = { ok: false, message: "Not fetched yet", trips: 0 };
const radar = RADAR_ENABLED ? new RadarPoller({ url: RADAR_URL, log }) : null;
let snapshot = { type: "snapshot", interval: TICK_MS, updatedAt: null, vehicles: [], loading: true, sources: null };

// ---------- timetable (reloads when the Berlin date changes) ----------
let loadingFor = null;
let lastFailAt = 0;
async function loadTimetable() {
  const { date } = berlinNow();
  if (index?.serviceDate === date || loadingFor === date) return;
  if (Date.now() - lastFailAt < 5 * 60 * 1000) return; // wait 5 min after a failure
  loadingFor = date;
  try {
    const version = await ensureGtfs(GTFS_URL, log);
    index = prepareIndex(await buildIndex(date, version, log));
    lastFailAt = 0;
    network = null; stationsJson = null; linesJson = null;
    setTimeout(() => {
      try { getNetwork(); } catch (e) { console.error("Planner failed:", e.message); }
      try { linesPayload(); } catch (e) { console.error("Line map failed:", e.message); }
    }, 100);
  } catch (e) {
    lastFailAt = Date.now();
    console.error("Timetable failed to load:", e.message, "(retrying in 5 min)");
  } finally {
    loadingFor = null;
  }
}

// ---------- stations + journey planner ----------
let network = null;       // built lazily from the timetable (sorted connections + walking links)
let stationsJson = null;  // gzipped /api/stations response
let linesJson = null;     // gzipped /api/lines response
const BERLIN_BOX = { north: 52.72, south: 52.30, west: 13.0, east: 13.85 };

function getNetwork() {
  if (!index) return null;
  if (!network || network.serviceDate !== index.serviceDate) network = buildNetwork(index, log);
  return network;
}

function stationsPayload() {
  if (stationsJson) return stationsJson;
  const st = index.stations, list = [];
  for (let i = 0; i < st.id.length; i++) {
    if (!st.products[i]) continue; // nothing stops here today
    const lat = st.lat[i], lng = st.lng[i];
    if (lat > BERLIN_BOX.north || lat < BERLIN_BOX.south || lng < BERLIN_BOX.west || lng > BERLIN_BOX.east) continue;
    list.push({ i, name: st.name[i], lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, p: st.products[i], lines: st.lines[i] });
  }
  stationsJson = gzipSync(JSON.stringify({ serviceDate: index.serviceDate, stations: list }));
  return stationsJson;
}

function linesPayload() {
  if (!linesJson) linesJson = gzipSync(JSON.stringify({ serviceDate: index.serviceDate, lines: buildLineMap(index, log) }));
  return linesJson;
}

function stationRef(i) {
  const st = index.stations;
  return { i, id: st.id[i], name: st.name[i], lat: st.lat[i], lng: st.lng[i] };
}

function serviceSeconds(nowMs = Date.now()) {
  const now = berlinNow(nowMs);
  return now.date === index.serviceDate ? now.seconds : now.seconds + 86400;
}

// Journeys: community API first (knows live delays), then the local planner on the timetable.
// `from`/`to`: { station } or { lat, lng, name }. `when` is epoch ms (null = now);
// mode "depart" = leave at/after, "arrive" = arrive by.
async function findJourneys(fromP, toP, { when = null, mode = "depart" } = {}) {
  const from = describePlace(fromP), to = describePlace(toP);
  const notes = [];
  const at = when ?? Date.now();
  let result = null;
  try {
    const journeys = await fetchCommunityJourneys(COMMUNITY_API, from, to, { count: 3, when: at, mode });
    // Link each ride to our timetable so it can be tracked even if the live API drops out later
    for (const j of journeys) for (const leg of j.legs) {
      if (leg.mode !== "transit") continue;
      const m = matchCommunityLeg(index, leg);
      leg.track = { ...(m ?? {}), hafas: leg.hafasTrip ?? undefined };
      delete leg.fromId; delete leg.toId; delete leg.plannedDep; delete leg.hafasTrip;
    }
    result = { from, to, source: "live", mode, when: new Date(at).toISOString(), journeys, notes };
  } catch (e) {
    log(`journeys: community API failed (${e.message}), using local planner`);
    notes.push("Live journey planner unavailable; using the timetable.");
  }
  if (!result) {
    // The local timetable covers today and tomorrow
    const sec = Math.round((at - serviceMidnightMs(index.serviceDate)) / 1000);
    if (sec < 0 || sec >= 2 * 86400) {
      notes.push("Without the live planner, connections can only be found for today and tomorrow.");
      return { from, to, source: "timetable", mode, when: new Date(at).toISOString(), journeys: [], notes, outOfRange: true };
    }
    const net = getNetwork();
    const freshRt = rt && Date.now() - rt.fetchedAt < RT_MAX_AGE_MS ? rt : null;
    const journeys = net ? planLocal(net, index, fromP, toP, sec, { mode, count: 3, rt: freshRt }) : [];
    result = { from, to, source: "timetable", mode, when: new Date(at).toISOString(), journeys, notes };
  }
  // Walks to and from addresses along real streets (best effort, ~3 s budget)
  await enhanceWalks(result.journeys);
  return result;
}

/** A place as sent to the planners: stations carry their VBB id, points their coordinates. */
function describePlace(p) {
  if (p.station != null) return stationRef(p.station);
  return { name: p.name || "Selected location", lat: p.lat, lng: p.lng };
}

/** Reads one end of a journey from the query: `from=12` (station) or `fromLat`, `fromLng`, `fromName`. */
function parsePlace(q, key) {
  const raw = q.get(key);
  if (raw != null && raw !== "") {
    const i = Number(raw.replace(/^s:/, ""));
    if (!Number.isInteger(i) || i < 0 || i >= index.stations.id.length) return null;
    return { station: i };
  }
  const lat = Number(q.get(`${key}Lat`)), lng = Number(q.get(`${key}Lng`));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 52.2 || lat > 52.8 || lng < 12.8 || lng > 14) return null;
  const name = (q.get(`${key}Name`) || "").slice(0, 120);
  return { lat, lng, name };
}

// Tracking one vehicle: timetable trip first (with live position/delay when available),
// community API /trips as a fallback for trips we can't find
const communityTripCache = new Map(); // hafas id -> { at, data }
async function track({ trip, day, hafas }) {
  if (trip && index) {
    const freshRt = rt && Date.now() - rt.fetchedAt < RT_MAX_AGE_MS ? rt : null;
    const r = trackTrip(index, { trip, day, hafas }, serviceSeconds(), freshRt, radar ? radar.vehicles() : []);
    if (r) return r;
  }
  if (hafas) {
    const c = communityTripCache.get(hafas);
    if (c && Date.now() - c.at < 10000) return c.data;
    const data = await trackCommunityTrip(COMMUNITY_API, hafas);
    communityTripCache.set(hafas, { at: Date.now(), data });
    if (communityTripCache.size > 500) communityTripCache.delete(communityTripCache.keys().next().value);
    return data;
  }
  return null;
}

// ---------- official live delays ----------
let rtBlockedUntil = 0;
async function pollRealtime() {
  if (Date.now() < rtBlockedUntil) return;
  try {
    const r = await fetchTripUpdates(GTFS_RT_URL);
    let matched = 0;
    if (index) {
      const ids = new Set(index.trips.map(t => t.id));
      for (const id of r.updates.keys()) if (ids.has(id)) matched++;
    }
    rt = r;
    rtStatus = r.updates.size
      ? { ok: true, message: `${r.updates.size} trips with delays (${matched} matched)`, trips: r.updates.size }
      : { ok: false, message: "Delay feed is empty right now", trips: 0 };
    log(`delays: ${r.updates.size} trip updates, ${matched} matched to timetable, ${(r.bytes / 1e6).toFixed(1)} MB`);
  } catch (e) {
    rtStatus = { ok: false, message: `Delay feed unavailable (${e.message})`, trips: 0 };
    // Don't hammer a feed that refuses us; VBB allows 60 requests/minute, we use 2
    const wait = e.status === 403 || e.status === 429 ? 10 * 60e3 : 0;
    if (wait) rtBlockedUntil = Date.now() + wait;
    console.warn(`delay feed failed: ${e.message}${wait ? " — retrying in 10 min" : ""}`);
  }
}

// ---------- merge all sources ----------
function tick() {
  loadTimetable(); // no-op unless the day changed or it's still missing
  const nowMs = Date.now();

  // 1. Live positions from areas that answered recently
  const liveVehicles = radar ? radar.vehicles(nowMs) : [];
  const liveAreas = radar ? radar.freshCount(nowMs) : 0;
  const totalAreas = radar ? radar.tiles.length : 0;

  // 2./3. Timetable positions (with delays when fresh), only for areas without live positions
  let fallback = [], withDelays = 0;
  const freshRt = rt && nowMs - rt.fetchedAt < RT_MAX_AGE_MS ? rt : null;
  if (index && (!radar || liveAreas < totalAreas)) {
    const now = berlinNow(nowMs);
    const sec = now.date === index.serviceDate ? now.seconds : now.seconds + 86400; // date rolled over, new index loading
    const r = computePositions(index, sec, freshRt);
    fallback = radar ? r.vehicles.filter(v => !radar.isFresh(radar.tileIndexOf(v.lat, v.lng), nowMs)) : r.vehicles;
    withDelays = fallback.filter(v => v.delay !== null).length;
  }

  const vehicles = liveVehicles.concat(fallback);
  const waiting = !vehicles.length && !index; // nothing yet: timetable still loading and no live data
  snapshot = {
    type: "snapshot", interval: TICK_MS, updatedAt: waiting ? null : new Date(nowMs).toISOString(),
    vehicles,
    loading: !index,
    error: !index && lastFailAt && !liveVehicles.length ? "Timetable failed to load and live positions are down. Retrying…" : undefined,
    sources: {
      live: { enabled: !!radar, areas: liveAreas, totalAreas, vehicles: liveVehicles.length },
      delays: { ok: rtStatus.ok && !!freshRt, message: rtStatus.message, vehicles: withDelays },
      timetable: { ready: !!index, vehicles: fallback.length - withDelays },
    },
  };
  broadcast(JSON.stringify(snapshot));
}

// --- HTTP: API + the built React app (client/dist) ---
const DIST = fileURLToPath(new URL("./client/dist/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;

  if (path === "/api/vehicles") {
    // Plain JSON (handy for a React Native app or debugging)
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify(snapshot));
  }
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: snapshot.vehicles.length > 0, updatedAt: snapshot.updatedAt, vehicles: snapshot.vehicles.length, sources: snapshot.sources }));
  }

  if (path === "/api/stations") {
    if (!index) return sendJson(res, 503, { error: "The timetable is still loading. Try again in a minute." });
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "max-age=300" });
    return res.end(stationsPayload());
  }
  if (path === "/api/lines") {
    if (!index) return sendJson(res, 503, { error: "The timetable is still loading. Try again in a minute." });
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "max-age=600" });
    return res.end(linesPayload());
  }
  let m;
  if ((m = path.match(/^\/api\/stations\/(\d+)\/departures$/))) {
    if (!index) return sendJson(res, 503, { error: "The timetable is still loading. Try again in a minute." });
    const i = +m[1];
    if (!(i < index.stations.id.length)) return sendJson(res, 404, { error: "Unknown station" });
    const freshRt = rt && Date.now() - rt.fetchedAt < RT_MAX_AGE_MS ? rt : null;
    return sendJson(res, 200, {
      station: { ...stationRef(i), lines: index.stations.lines[i], p: index.stations.products[i] },
      departures: departures(index, i, serviceSeconds(), freshRt),
      delays: !!freshRt,
    });
  }
  if (path === "/api/places") {
    const q = (new URL(req.url, "http://x").searchParams.get("q") || "").trim();
    if (q.length < 3) return sendJson(res, 200, { source: "none", places: [] });
    if (q.length > 100) return sendJson(res, 400, { error: "Search text is too long." });
    return sendJson(res, 200, await searchPlaces(COMMUNITY_API, q));
  }
  if (path === "/api/reverse") {
    const q = new URL(req.url, "http://x").searchParams;
    const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return sendJson(res, 400, { error: "Invalid position." });
    return sendJson(res, 200, (await reversePlace(lat, lng)) ?? { name: null });
  }
  if (path === "/api/track") {
    const q = new URL(req.url, "http://x").searchParams;
    const trip = q.get("trip") || null, hafas = q.get("hafas") || null, day = Number(q.get("day") ?? 0);
    if ((!trip && !hafas) || (trip && trip.length > 200) || (hafas && hafas.length > 300) || ![-1, 0, 1].includes(day)) {
      return sendJson(res, 400, { error: "Missing or invalid trip." });
    }
    try {
      const r = await track({ trip, day, hafas });
      if (!r) return sendJson(res, 404, { error: "This vehicle can't be tracked right now." });
      return sendJson(res, 200, r);
    } catch (e) {
      log(`track failed: ${e.message}`);
      return sendJson(res, 502, { error: "Live tracking is unavailable right now. Try again in a moment." });
    }
  }
  if (path === "/api/journeys") {
    if (!index) return sendJson(res, 503, { error: "The timetable is still loading. Try again in a minute." });
    const q = new URL(req.url, "http://x").searchParams;
    const from = parsePlace(q, "from"), to = parsePlace(q, "to");
    if (!from || !to) return sendJson(res, 400, { error: "Pick a start and a destination in the Berlin area." });
    if (from.station != null && from.station === to.station) return sendJson(res, 400, { error: "Start and destination are the same station." });
    if (from.station == null && to.station == null && Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lng - to.lng) < 1e-5) {
      return sendJson(res, 400, { error: "Start and destination are the same place." });
    }
    const mode = q.get("mode") === "arrive" ? "arrive" : "depart";
    let when = null;
    if (q.get("when")) {
      when = Date.parse(q.get("when"));
      if (!Number.isFinite(when)) return sendJson(res, 400, { error: "That date or time isn't valid." });
      if (when < Date.now() - 2 * 3600e3 || when > Date.now() + 60 * 86400e3) {
        return sendJson(res, 400, { error: "Pick a time between now and 60 days ahead." });
      }
    }
    try {
      return sendJson(res, 200, await findJourneys(from, to, { when, mode }));
    } catch (e) {
      console.error("journeys failed:", e);
      return sendJson(res, 500, { error: "Couldn't plan this journey. Please try again." });
    }
  }

  // Static files from client/dist; unknown paths fall back to index.html (SPA)
  const file = normalize(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    const cache = file.includes(`${join(DIST, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": cache });
    res.end(body);
  } catch {
    try {
      res.writeHead(200, { "content-type": TYPES[".html"] });
      res.end(await readFile(join(DIST, "index.html")));
    } catch {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("React app not built yet. Run `npm run build`, or use `npm run dev` and open http://localhost:5173");
    }
  }
});

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// --- WebSocket: push snapshots ---
// perMessageDeflate compresses each update ~5-10x (thousands of vehicles every 10 s)
const wss = new WebSocketServer({ server, path: "/live", perMessageDeflate: { threshold: 1024 } });
wss.on("connection", ws => ws.send(JSON.stringify(snapshot)));
function broadcast(msg) { for (const c of wss.clients) if (c.readyState === 1) c.send(msg); }

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use (probably an old copy of this server).`);
    console.error(`Stop it with:  lsof -ti :${PORT} | xargs kill -9`);
    process.exit(1);
  }
  throw e;
});
wss.on("error", () => {}); // errors are reported by the HTTP server above

server.listen(PORT, () => {
  console.log(`Berlin Live Transit on http://localhost:${PORT}`);
  console.log(`Requests identify as: ${USER_AGENT}`);
  start();
});

async function start() {
  // Everything starts in parallel: live positions can show up while the timetable is still loading
  radar?.start();
  loadTimetable().then(pollRealtime);
  setInterval(tick, TICK_MS);
  setInterval(pollRealtime, RT_POLL_MS);
  setTimeout(tick, 1000);
}
