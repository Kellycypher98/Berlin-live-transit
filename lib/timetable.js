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
import { placeStops } from "./shapes.js";

const DATA_DIR = new URL("../data/", import.meta.url);
const ZIP_PATH = new URL("gtfs.zip", DATA_DIR);
const MAX_AGE_MS = 3 * 24 * 3600 * 1000; // re-download the timetable every 3 days
const INDEX_FORMAT = "v5"; // bump when the index shape changes, so old caches are rebuilt

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

// ---------- compact storage ----------

/** Growable typed-array column: rows are appended without creating a JS object per row. */
class Column {
  constructor(Type, capacity = 1 << 16) { this.Type = Type; this.a = new Type(capacity); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  /** Exact-size copy; the oversized working buffer can then be freed. */
  done() { return this.a.slice(0, this.n); }
}

/**
 * Row order grouped by `group` (0..nGroups-1) and sorted by `seq` inside each group,
 * without sorting all rows at once: a counting pass, then small sorts per group.
 * Returns { order, start } — rows of group g are order[start[g] .. start[g+1]).
 */
function groupRows(group, seq, nGroups) {
  const start = new Int32Array(nGroups + 1);
  for (let i = 0; i < group.length; i++) start[group[i] + 1]++;
  for (let g = 0; g < nGroups; g++) start[g + 1] += start[g];
  const fill = start.slice(0, nGroups), order = new Int32Array(group.length);
  for (let i = 0; i < group.length; i++) order[fill[group[i]]++] = i;
  for (let g = 0; g < nGroups; g++) {
    const a = start[g], b = start[g + 1];
    if (b - a < 2) continue;
    let sorted = true;
    for (let i = a + 1; i < b; i++) if (seq[order[i]] < seq[order[i - 1]]) { sorted = false; break; }
    if (!sorted) order.subarray(a, b).sort((x, y) => seq[x] - seq[y]); // usually already in order
  }
  return { order, start };
}

// ---------- index ----------

// Yesterday's trips are only kept if they run late enough to matter: still on the road after
// midnight, or within the planner's 4-hour "arrive by" window before it.
const YESTERDAY_FROM = 86400 - 4 * 3600;

/**
 * Builds the index for `serviceDate` (YYYYMMDD), the day before and the day after.
 * Result: { stops: {id[], lat, lng, station[]}, stations: {id[], name[], lat[], lng[], products[], lines[]},
 *   shapes: [{ lat, lng, d }], trips: [{ id, day, line, dir, product, stops, arr, dep, start, end, shape, sd }] }
 * Per-trip arrays are typed-array views into a few large shared buffers.
 * `day` is 0 for serviceDate, -1 for the day before and 1 for the day after; a trip's times are
 * relative to its own day, so its time on serviceDate's clock is `t + day * 86400`.
 */
export async function buildIndex(serviceDate, feedVersion, log = console.log) {
  const cacheFile = new URL(`index-${INDEX_FORMAT}-${serviceDate}-${Math.round(feedVersion)}.bin`, DATA_DIR);
  if (existsSync(cacheFile)) {
    log("Loading timetable index from cache …");
    try { return readCache(await readFile(cacheFile)); }
    catch (e) { log(`Cache unreadable (${e.message}), rebuilding.`); }
  }

  const started = Date.now();
  log(`Building timetable index for ${serviceDate} (first run takes a minute or two) …`);
  const zip = await openZip(fileURLToPath(ZIP_PATH));
  const entries = await listEntries(zip);
  // Today, yesterday (trips running past midnight) and tomorrow (planning ahead)
  const days = [serviceDate, addDays(serviceDate, -1), addDays(serviceDate, 1)];

  // 1. Which services run on each day
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

  // 3. Trips running on any of the days; each gets a number for the columns below
  const tripNo = new Map(); // trip_id -> number
  const tripMeta = [];      // number -> { id, line, dir, product, days, shapeId }
  await eachRow(zip, entries, "trips.txt", get => {
    const sid = get("service_id");
    const dayList = [];
    if (active[0].has(sid)) dayList.push(0);
    if (active[1].has(sid)) dayList.push(-1);
    if (active[2].has(sid)) dayList.push(1);
    if (!dayList.length) return;
    const r = routes.get(get("route_id")) ?? { line: "?", product: "unknown" };
    tripNo.set(get("trip_id"), tripMeta.length);
    tripMeta.push({ id: get("trip_id"), line: r.line, dir: get("trip_headsign"), product: r.product, days: dayList, shapeId: get("shape_id") });
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
  stops.lat = Float64Array.from(stops.lat);
  stops.lng = Float64Array.from(stops.lng);

  // 5. Stop times (the big file), straight into typed columns — only for active trips
  const cTrip = new Column(Int32Array, 1 << 20), cSeq = new Column(Int32Array, 1 << 20), cStop = new Column(Int32Array, 1 << 20);
  const cArr = new Column(Int32Array, 1 << 20), cDep = new Column(Int32Array, 1 << 20);
  let rows = 0;
  await eachRow(zip, entries, "stop_times.txt", get => {
    if (++rows % 2_000_000 === 0) log(`  … ${(rows / 1e6).toFixed(0)}M stop times read`);
    const tn = tripNo.get(get("trip_id"));
    if (tn === undefined) return;
    const si = stopIndex.get(get("stop_id"));
    if (si === undefined) return;
    let arr = parseGtfsTime(get("arrival_time")), dep = parseGtfsTime(get("departure_time"));
    if (Number.isNaN(arr)) arr = dep;
    if (Number.isNaN(dep)) dep = arr;
    if (Number.isNaN(arr)) return; // untimed stop
    cTrip.push(tn); cSeq.push(+get("stop_sequence")); cStop.push(si); cArr.push(arr); cDep.push(dep);
  });
  const st = { trip: cTrip.done(), seq: cSeq.done(), stop: cStop.done(), arr: cArr.done(), dep: cDep.done() };
  const { order: stOrder, start: stStart } = groupRows(st.trip, st.seq, tripMeta.length);

  // Which trips are kept (2+ timed stops; yesterday's only if running late), and on which days
  const keepDays = tripMeta.map((m, tn) => {
    const a = stStart[tn], b = stStart[tn + 1];
    if (b - a < 2) return null;
    const end = st.arr[stOrder[b - 1]];
    const ds = m.days.filter(d => d !== -1 || end >= YESTERDAY_FROM);
    return ds.length ? ds : null;
  });

  // 5b. Track shapes used by the kept trips, also as columns
  const shapeNo = new Map(); // shape_id -> number
  keepDays.forEach((ds, tn) => {
    const sid = ds && tripMeta[tn].shapeId;
    if (sid && !shapeNo.has(sid)) shapeNo.set(sid, shapeNo.size);
  });
  const pShape = new Column(Int32Array, 1 << 20), pSeq = new Column(Int32Array, 1 << 20);
  const pLat = new Column(Float64Array, 1 << 20), pLng = new Column(Float64Array, 1 << 20);
  await eachRow(zip, entries, "shapes.txt", get => {
    const sn = shapeNo.get(get("shape_id"));
    if (sn === undefined) return;
    pShape.push(sn); pSeq.push(+get("shape_pt_sequence")); pLat.push(+get("shape_pt_lat")); pLng.push(+get("shape_pt_lon"));
  });
  zip.close();
  const pts = { shape: pShape.done(), seq: pSeq.done(), lat: pLat.done(), lng: pLng.done() };
  const { order: shOrder, start: shStart } = groupRows(pts.shape, pts.seq, shapeNo.size);
  // All shapes in three shared buffers; each shape is a view into them
  const SH = { lat: new Float32Array(pts.shape.length), lng: new Float32Array(pts.shape.length), d: new Float32Array(pts.shape.length) };
  const shapes = [], shapeAt = new Int32Array(shapeNo.size).fill(-1); // shape number -> index in `shapes`
  const shapeRanges = [];
  let w = 0;
  for (let sn = 0; sn < shapeNo.size; sn++) {
    const a = shStart[sn], b = shStart[sn + 1];
    if (b - a < 2) continue;
    const o = w;
    for (let i = a; i < b; i++, w++) {
      const r = shOrder[i];
      SH.lat[w] = pts.lat[r]; SH.lng[w] = pts.lng[r];
      SH.d[w] = w > o ? SH.d[w - 1] + dist(pts.lat[shOrder[i - 1]], pts.lng[shOrder[i - 1]], pts.lat[r], pts.lng[r]) : 0;
    }
    shapeAt[sn] = shapes.length;
    shapeRanges.push(o, w - o);
    shapes.push({ lat: SH.lat.subarray(o, w), lng: SH.lng.subarray(o, w), d: SH.d.subarray(o, w) });
  }
  const shapePoints = w;

  // 6. Trips: stop times copied into three shared buffers in trip order; each trip gets views.
  //    Stops are placed along the trip's shape once per (shape, stop pattern).
  let total = 0;
  keepDays.forEach((ds, tn) => { if (ds) total += stStart[tn + 1] - stStart[tn]; });
  const TT = { stops: new Int32Array(total), arr: new Int32Array(total), dep: new Int32Array(total) };
  const patterns = new Map(); // "shape|stop,stop,…" -> pattern number, or -1 if the shape doesn't fit
  const patternData = [];     // pattern number -> Float32Array of distances along the shape
  const patternShape = [];    // pattern number -> shape index
  const trips = [], tripRows = []; // tripRows: [offset, length, pattern] per base trip, for the cache
  let off = 0, onShape = 0, baseTrips = 0;
  keepDays.forEach((ds, tn) => {
    if (!ds) return;
    const m = tripMeta[tn], a = stStart[tn], len = stStart[tn + 1] - a, o = off;
    for (let i = 0; i < len; i++) {
      const r = stOrder[a + i];
      TT.stops[off] = st.stop[r]; TT.arr[off] = st.arr[r]; TT.dep[off] = st.dep[r]; off++;
    }
    const stopList = TT.stops.subarray(o, o + len);
    const sn = m.shapeId ? shapeNo.get(m.shapeId) : undefined;
    const shape = sn === undefined ? -1 : shapeAt[sn];
    let pat = -1;
    if (shape >= 0) {
      const key = `${shape}|${stopList.join(",")}`;
      pat = patterns.get(key);
      if (pat === undefined) {
        const dists = placeStops(shapes[shape], stops.lat, stops.lng, stopList);
        pat = dists ? patternData.push(Float32Array.from(dists)) - 1 : -1;
        if (pat >= 0) patternShape.push(shape);
        patterns.set(key, pat);
      }
    }
    if (pat >= 0) onShape++;
    baseTrips++;
    tripRows.push(o, len, pat);
    const base = {
      id: m.id, line: m.line, dir: m.dir, product: m.product,
      stops: stopList, arr: TT.arr.subarray(o, o + len), dep: TT.dep.subarray(o, o + len),
      start: TT.dep[o], end: TT.arr[o + len - 1],
      shape: pat >= 0 ? shape : -1, sd: pat >= 0 ? patternData[pat] : null,
    };
    for (const day of ds) trips.push({ ...base, day });
    // Which modes and lines serve each station
    for (let i = 0; i < len; i++) {
      const sti = stops.station[stopList[i]];
      stations.products[sti] |= PRODUCT_BITS[m.product] ?? 0;
      if (m.line) stations.lines[sti].add(m.line);
    }
  });
  const lineOrder = l => (/^S\d/.test(l) ? 0 : /^U\d/.test(l) ? 1 : /^M?\d+$/.test(l) && +l.replace("M", "") < 100 ? 2 : 3);
  const collator = new Intl.Collator("de", { numeric: true });
  stations.lines = stations.lines.map(ls => [...ls].sort((a, b) => lineOrder(a) - lineOrder(b) || collator.compare(a, b)));

  const index = { serviceDate, stops, stations, trips, shapes };
  log(`Timetable ready: ${trips.length} trips, ${stations.id.length} stations, ${stops.id.length} stops, ${rows.toLocaleString()} stop times scanned in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  log(`Track shapes: ${shapes.length} shapes (${shapePoints.toLocaleString()} points); ${Math.round((100 * onShape) / Math.max(1, baseTrips))}% of trips follow their track.`);

  // Cache (binary: big arrays as raw bytes), and remove old cache files
  for (const f of await readdir(DATA_DIR)) if (f.startsWith("index-")) await unlink(new URL(f, DATA_DIR)).catch(() => {});
  const pd = concatPatterns(patternData);
  await writeFile(cacheFile, writeCache({
    serviceDate, stopIds: stops.id, stopStation: stops.station, stations,
    trips: {
      id: [], line: [], dir: [], product: [], days: [],
    },
    shapeRanges, patternOffsets: pd.offsets, patternShape,
  }, { stopLat: stops.lat, stopLng: stops.lng, shLat: SH.lat.subarray(0, shapePoints), shLng: SH.lng.subarray(0, shapePoints), shD: SH.d.subarray(0, shapePoints),
       ttStops: TT.stops, ttArr: TT.arr, ttDep: TT.dep, sd: pd.data, tripRows: Int32Array.from(tripRows) }, tripMeta, keepDays));
  return index;
}

const toRad = d => (d * Math.PI) / 180;
function dist(lat1, lng1, lat2, lng2) {
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * 6371000;
}

function concatPatterns(list) {
  const offsets = [0];
  for (const p of list) offsets.push(offsets.at(-1) + p.length);
  const data = new Float32Array(offsets.at(-1));
  list.forEach((p, i) => data.set(p, offsets[i]));
  return { offsets, data };
}

// ---------- binary cache ----------
// File: "BLTX" | u32 header length | JSON header | padding to 8 bytes | raw typed arrays.
// The header lists every array's type, offset and length; on load they become views into the file.

const TYPES = { Int32Array, Float32Array, Float64Array };

function writeCache(header, arrays, tripMeta, keepDays) {
  // Base trips in the same order as tripRows
  keepDays.forEach((ds, tn) => {
    if (!ds) return;
    const m = tripMeta[tn];
    header.trips.id.push(m.id); header.trips.line.push(m.line); header.trips.dir.push(m.dir);
    header.trips.product.push(m.product); header.trips.days.push(ds);
  });
  const list = [];
  let pos = 0;
  for (const [name, a] of Object.entries(arrays)) {
    pos = Math.ceil(pos / 8) * 8;
    list.push({ name, type: a.constructor.name, offset: pos, length: a.length });
    pos += a.byteLength;
  }
  header.arrays = list;
  const json = Buffer.from(JSON.stringify(header));
  const dataStart = Math.ceil((8 + json.length) / 8) * 8;
  const out = Buffer.alloc(dataStart + pos);
  out.write("BLTX", 0, "latin1");
  out.writeUInt32LE(json.length, 4);
  json.copy(out, 8);
  for (const e of list) {
    const a = arrays[e.name];
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(out, dataStart + e.offset);
  }
  return out;
}

function readCache(buf) {
  if (buf.toString("latin1", 0, 4) !== "BLTX") throw new Error("not an index file");
  const jsonLen = buf.readUInt32LE(4);
  const h = JSON.parse(buf.toString("utf8", 8, 8 + jsonLen));
  const dataStart = Math.ceil((8 + jsonLen) / 8) * 8;
  // Typed arrays need aligned memory: copy once into a fresh buffer if the file buffer isn't aligned
  let ab = buf.buffer, base = buf.byteOffset + dataStart;
  if (base % 8) { const copy = new Uint8Array(buf.length - dataStart); copy.set(buf.subarray(dataStart)); ab = copy.buffer; base = 0; }
  const A = {};
  for (const e of h.arrays) A[e.name] = new TYPES[e.type](ab, base + e.offset, e.length);

  const stops = { id: h.stopIds, lat: A.stopLat, lng: A.stopLng, station: h.stopStation };
  const shapes = [];
  for (let i = 0; i < h.shapeRanges.length; i += 2) {
    const o = h.shapeRanges[i], n = h.shapeRanges[i + 1];
    shapes.push({ lat: A.shLat.subarray(o, o + n), lng: A.shLng.subarray(o, o + n), d: A.shD.subarray(o, o + n) });
  }
  const po = h.patternOffsets;
  const patterns = [];
  for (let p = 0; p + 1 < po.length; p++) patterns.push(A.sd.subarray(po[p], po[p + 1]));
  const trips = [], T = h.trips, R = A.tripRows;
  for (let k = 0; k < T.id.length; k++) {
    const o = R[k * 3], len = R[k * 3 + 1], pat = R[k * 3 + 2];
    const base = {
      id: T.id[k], line: T.line[k], dir: T.dir[k], product: T.product[k],
      stops: A.ttStops.subarray(o, o + len), arr: A.ttArr.subarray(o, o + len), dep: A.ttDep.subarray(o, o + len),
      start: A.ttDep[o], end: A.ttArr[o + len - 1],
      shape: pat >= 0 ? h.patternShape[pat] : -1, sd: pat >= 0 ? patterns[pat] : null,
    };
    for (const day of T.days[k]) trips.push({ ...base, day });
  }
  return { serviceDate: h.serviceDate, stops, stations: h.stations, trips, shapes };
}
