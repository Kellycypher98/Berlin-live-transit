// Loads the official VBB GTFS timetable and builds a compact index of the trips
// running on a given service day (plus the previous day, for trips past midnight).

import { httpFetch } from "./http.js";
import { createWriteStream, existsSync, statSync, mkdirSync } from "node:fs";
import { readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { addDays, parseGtfsTime, weekdayOf } from "./berlinTime.js";
import { makeShape, placeStops } from "./shapes.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const ZIP_PATH = new URL("gtfs.zip", DATA_DIR);
const MAX_AGE_MS = 3 * 24 * 3600 * 1000; // re-download the timetable every 3 days
const INDEX_FORMAT = "v4"; // bump when the index shape changes, so old caches are rebuilt

// Bitmask of transport modes serving a station
export const PRODUCT_BITS = { subway: 1, suburban: 2, tram: 4, bus: 8, regional: 16, ferry: 32 };

// VBB uses extended GTFS route types (100 = rail, 109 = S-Bahn, 400 = U-Bahn, 700 = bus, 900 = tram, 1000 = ferry)
export function productOf(routeType) {
  const t = +routeType;
  if (t === 109) return "suburban";
  if (t === 1 || (t >= 400 && t < 500)) return "subway";
  if (t === 0 || (t >= 900 && t < 1000)) return "tram";
  if (t === 3 || (t >= 700 && t < 800) || (t >= 200 && t < 300)) return "bus";
  if (t === 4 || (t >= 1000 && t < 1100) || t === 1200) return "ferry";
  if (t === 2 || (t >= 100 && t < 200)) return "regional";
  return "unknown";
}

// ---------- download ----------

export async function ensureGtfs(url, log = console.log) {
  mkdirSync(DATA_DIR, { recursive: true });
  const fresh = existsSync(ZIP_PATH) && Date.now() - statSync(ZIP_PATH).mtimeMs < MAX_AGE_MS;
  if (fresh) return statSync(ZIP_PATH).mtimeMs;

  log(`Downloading VBB timetable from ${url} …`);
  const res = await httpFetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) {
    if (existsSync(ZIP_PATH)) { log(`Download failed (HTTP ${res.status}); using the old timetable.`); return statSync(ZIP_PATH).mtimeMs; }
    throw new Error(`Timetable download failed: HTTP ${res.status}`);
  }
  const tmp = new URL("gtfs.zip.part", DATA_DIR);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, ZIP_PATH);
  log(`Timetable downloaded (${(statSync(ZIP_PATH).size / 1e6).toFixed(0)} MB).`);
  return statSync(ZIP_PATH).mtimeMs;
}

// ---------- zip + csv streaming ----------

function openZip(path) {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (e, z) => (e ? reject(e) : resolve(z))));
}

async function listEntries(zip) {
  const entries = new Map();
  await new Promise((resolve, reject) => {
    zip.on("entry", e => { entries.set(e.fileName.split("/").pop(), e); zip.readEntry(); });
    zip.on("end", resolve);
    zip.on("error", reject);
    zip.readEntry();
  });
  return entries;
}

/** Splits one CSV line; handles quoted fields with commas and "" escapes. */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(",");
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Streams rows of one GTFS file. onRow(getter) where getter(colName) returns the value. */
async function eachRow(zip, entries, name, onRow) {
  const entry = entries.get(name);
  if (!entry) return false;
  let header = null, rest = "";
  const handle = line => {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line) return;
    const cells = splitCsv(line);
    if (!header) {
      header = Object.fromEntries(cells.map((h, i) => [h.replace(/^﻿/, "").trim(), i]));
      return;
    }
    onRow(col => { const i = header[col]; return i === undefined ? "" : cells[i]; });
  };
  // Listeners are attached inside the callback: yauzl streams can finish before an
  // async iterator would get attached, which hangs on small files.
  await new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const decoder = new StringDecoder("utf8"); // keeps umlauts intact across chunk boundaries
      stream.on("data", chunk => {
        const lines = (rest + decoder.write(chunk)).split("\n");
        rest = lines.pop();
        try { for (const l of lines) handle(l); } catch (e) { stream.destroy(); reject(e); }
      });
      stream.on("end", () => { rest += decoder.end(); if (rest) handle(rest); resolve(); });
      stream.on("error", reject);
    });
  });
  return true;
}

// ---------- index ----------

/**
 * Builds the index for `serviceDate` (YYYYMMDD), the day before and the day after.
 * Result: { stops: {id[], lat[], lng[], station[]}, stations: {id[], name[], lat[], lng[], products[], lines[]}, trips: [{ id, day, line, dir, product, stops:[idx], arr:[s], dep:[s], start, end }] }
 * `day` is 0 for serviceDate, -1 for the day before and 1 for the day after; a trip's times are
 * relative to its own day, so its time on serviceDate's clock is `t + day * 86400`.
 */
export async function buildIndex(serviceDate, feedVersion, log = console.log) {
  const cacheFile = new URL(`index-${INDEX_FORMAT}-${serviceDate}-${Math.round(feedVersion)}.json`, DATA_DIR);
  if (existsSync(cacheFile)) {
    log("Loading timetable index from cache …");
    return unpack(JSON.parse(await readFile(cacheFile, "utf8")));
  }

  const started = Date.now();
  log(`Building timetable index for ${serviceDate} (first run takes a minute or two) …`);
  const zip = await openZip(fileURLToPath(ZIP_PATH));
  const entries = await listEntries(zip);
  // Today, yesterday (trips running past midnight) and tomorrow (planning ahead)
  const days = [serviceDate, addDays(serviceDate, -1), addDays(serviceDate, 1)];

  // 1. Which services run on each of the two days
  const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const active = days.map(() => new Set());
  await eachRow(zip, entries, "calendar.txt", get => {
    days.forEach((d, i) => {
      if (d >= get("start_date") && d <= get("end_date") && get(WD[weekdayOf(d)]) === "1") active[i].add(get("service_id"));
    });
  });
  await eachRow(zip, entries, "calendar_dates.txt", get => {
    const i = days.indexOf(get("date"));
    if (i < 0) return;
    if (get("exception_type") === "1") active[i].add(get("service_id"));
    else active[i].delete(get("service_id"));
  });

  // 2. Routes
  const routes = new Map();
  await eachRow(zip, entries, "routes.txt", get => {
    routes.set(get("route_id"), { line: get("route_short_name") || get("route_long_name"), product: productOf(get("route_type")) });
  });

  // 3. Trips running on either day
  const tripMeta = new Map(); // trip_id -> { line, dir, product, days: [0|-1] }
  await eachRow(zip, entries, "trips.txt", get => {
    const sid = get("service_id");
    const dayList = [];
    if (active[0].has(sid)) dayList.push(0);
    if (active[1].has(sid)) dayList.push(-1);
    if (active[2].has(sid)) dayList.push(1);
    if (!dayList.length) return;
    const r = routes.get(get("route_id")) ?? { line: "?", product: "unknown" };
    tripMeta.set(get("trip_id"), { line: r.line, dir: get("trip_headsign"), product: r.product, days: dayList, shapeId: get("shape_id") });
  });

  // 4. Stops and stations. Platforms point to their station via parent_station;
  //    a stop without a parent is its own station.
  const stopIndex = new Map();
  const stops = { id: [], lat: [], lng: [], station: [] };
  const rawStops = new Map(); // stop_id -> { name, lat, lng, parent, type }
  await eachRow(zip, entries, "stops.txt", get => {
    const lat = +get("stop_lat"), lng = +get("stop_lon");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    rawStops.set(get("stop_id"), { name: get("stop_name"), lat, lng, parent: get("parent_station"), type: get("location_type") || "0" });
  });
  const stationIndex = new Map();
  const stations = { id: [], name: [], lat: [], lng: [], products: [], lines: [] };
  const stationOf = id => {
    let key = id, r = rawStops.get(id);
    if (r?.parent && rawStops.has(r.parent)) { key = r.parent; r = rawStops.get(key); }
    let si = stationIndex.get(key);
    if (si === undefined) {
      si = stations.id.length;
      stationIndex.set(key, si);
      stations.id.push(key); stations.name.push(r.name); stations.lat.push(r.lat); stations.lng.push(r.lng);
      stations.products.push(0); stations.lines.push(new Set());
    }
    return si;
  };
  for (const [id, r] of rawStops) {
    if (r.type !== "0") continue; // only boardable stops/platforms
    stopIndex.set(id, stops.id.length);
    stops.id.push(id); stops.lat.push(r.lat); stops.lng.push(r.lng); stops.station.push(stationOf(id));
  }
  rawStops.clear();

  // 5. Stop times (the big file) — only for active trips
  const times = new Map(); // trip_id -> [[seq, stopIdx, arr, dep], ...]
  let rows = 0;
  await eachRow(zip, entries, "stop_times.txt", get => {
    if (++rows % 2_000_000 === 0) log(`  … ${(rows / 1e6).toFixed(0)}M stop times read`);
    const tid = get("trip_id");
    if (!tripMeta.has(tid)) return;
    const si = stopIndex.get(get("stop_id"));
    if (si === undefined) return;
    let arr = parseGtfsTime(get("arrival_time")), dep = parseGtfsTime(get("departure_time"));
    if (Number.isNaN(arr)) arr = dep;
    if (Number.isNaN(dep)) dep = arr;
    if (Number.isNaN(arr)) return; // untimed stop
    let list = times.get(tid);
    if (!list) times.set(tid, (list = []));
    list.push([+get("stop_sequence"), si, arr, dep]);
  });
  // 5b. Track shapes used by today's trips
  const wantShapes = new Set();
  for (const tid of times.keys()) { const sid = tripMeta.get(tid).shapeId; if (sid) wantShapes.add(sid); }
  const rawShapes = new Map(); // shape_id -> [[seq, lat, lng], ...]
  let shapeRows = 0;
  await eachRow(zip, entries, "shapes.txt", get => {
    const sid = get("shape_id");
    if (!wantShapes.has(sid)) return;
    shapeRows++;
    let pts = rawShapes.get(sid);
    if (!pts) rawShapes.set(sid, (pts = []));
    pts.push([+get("shape_pt_sequence"), +get("shape_pt_lat"), +get("shape_pt_lon")]);
  });
  zip.close();
  const shapes = [];            // index -> { lat[], lng[], d[] }
  const shapeIndex = new Map(); // shape_id -> index
  for (const [sid, pts] of rawShapes) {
    if (pts.length < 2) continue;
    shapeIndex.set(sid, shapes.length);
    shapes.push(makeShape(pts));
  }
  rawShapes.clear();

  // 6. Assemble. Stops are placed along the trip's shape once per (shape, stop pattern).
  const trips = [];
  const placed = new Map(); // "shape|stop,stop,…" -> distances along the shape, or null
  let onShape = 0;
  for (const [tid, list] of times) {
    if (list.length < 2) continue;
    list.sort((a, b) => a[0] - b[0]);
    const m = tripMeta.get(tid);
    const stopList = list.map(x => x[1]);
    const shape = m.shapeId ? shapeIndex.get(m.shapeId) ?? -1 : -1;
    let sd = null;
    if (shape >= 0) {
      const key = `${shape}|${stopList.join(",")}`;
      if (placed.has(key)) sd = placed.get(key);
      else {
        const dists = placeStops(shapes[shape], stops.lat, stops.lng, stopList);
        sd = dists ? Array.from(dists, x => Math.round(x * 10) / 10) : null;
        placed.set(key, sd);
      }
    }
    if (sd) onShape++;
    const base = {
      id: tid, line: m.line, dir: m.dir, product: m.product,
      stops: stopList, arr: list.map(x => x[2]), dep: list.map(x => x[3]),
      start: list[0][3], end: list[list.length - 1][2],
      shape: sd ? shape : -1, sd,
    };
    for (const day of m.days) trips.push({ ...base, day });
    // Which modes and lines serve each station
    for (const si of base.stops) {
      const st = stops.station[si];
      stations.products[st] |= PRODUCT_BITS[m.product] ?? 0;
      if (m.line) stations.lines[st].add(m.line);
    }
  }
  const lineOrder = l => (/^S\d/.test(l) ? 0 : /^U\d/.test(l) ? 1 : /^M?\d+$/.test(l) && +l.replace("M", "") < 100 ? 2 : 3);
  const collator = new Intl.Collator("de", { numeric: true });
  stations.lines = stations.lines.map(ls => [...ls].sort((a, b) => lineOrder(a) - lineOrder(b) || collator.compare(a, b)));

  // Plain, rounded arrays for the cache file
  const shapesOut = shapes.map(sh => ({
    lat: Array.from(sh.lat, x => Math.round(x * 1e6) / 1e6),
    lng: Array.from(sh.lng, x => Math.round(x * 1e6) / 1e6),
    d: Array.from(sh.d, x => Math.round(x * 10) / 10),
  }));
  const index = { serviceDate, stops, stations, trips, shapes: shapesOut };
  log(`Timetable ready: ${trips.length} trips, ${stations.id.length} stations, ${stops.id.length} stops, ${rows.toLocaleString()} stop times scanned in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  log(`Track shapes: ${shapes.length} shapes (${shapeRows.toLocaleString()} points); ${Math.round((100 * onShape) / Math.max(1, times.size))}% of trips follow their track.`);

  // Cache, and remove old cache files
  for (const f of await readdir(DATA_DIR)) if (f.startsWith("index-")) await unlink(new URL(f, DATA_DIR)).catch(() => {});
  await writeFile(cacheFile, JSON.stringify(pack(index)));
  return index;
}

// Cache format: trips that run on both days are stored once with days: [0, -1]
function pack(index) {
  const byId = new Map();
  for (const t of index.trips) {
    const p = byId.get(t.id);
    if (p) p.days.push(t.day);
    else { const { day, ...rest } = t; byId.set(t.id, { ...rest, days: [day] }); }
  }
  return { ...index, trips: [...byId.values()] };
}
function unpack(c) {
  const trips = [];
  for (const { days, ...t } of c.trips) for (const day of days) trips.push({ ...t, day });
  return { ...c, trips };
}
