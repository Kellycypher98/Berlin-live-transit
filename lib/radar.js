// Live vehicle positions from the community VBB API (v6.vbb.transport.rest /radar).
// Berlin is split into a grid of areas; each area is polled independently, so when some
// areas time out, only those areas fall back to timetable positions.

import { httpFetch } from "./http.js";

const DEFAULT_BOUNDS = { north: 52.70, south: 52.32, west: 13.05, east: 13.80 };

export class RadarPoller {
  constructor({ url, grid = 4, cycleMs = 20000, timeoutMs = 25000, concurrency = 2, freshMs = 75000, log = console.log }) {
    Object.assign(this, { url, grid, cycleMs, timeoutMs, concurrency, freshMs, log });
    this.bounds = DEFAULT_BOUNDS;
    this.tiles = this.makeTiles().map(b => ({ ...b, vehicles: [], okAt: 0, error: null }));
    this.failedSweeps = 0;
    this.stopped = false;
  }

  makeTiles() {
    const { north, south, west, east } = this.bounds;
    const dLat = (north - south) / this.grid, dLng = (east - west) / this.grid;
    const out = [];
    for (let r = 0; r < this.grid; r++) for (let c = 0; c < this.grid; c++) {
      out.push({ north: north - r * dLat, south: north - (r + 1) * dLat, west: west + c * dLng, east: west + (c + 1) * dLng });
    }
    return out;
  }

  /** Index of the area containing a point, or -1 outside the grid. */
  tileIndexOf(lat, lng) {
    const { north, south, west, east } = this.bounds;
    if (lat > north || lat < south || lng < west || lng > east) return -1;
    const r = Math.min(this.grid - 1, Math.floor((north - lat) / ((north - south) / this.grid)));
    const c = Math.min(this.grid - 1, Math.floor((lng - west) / ((east - west) / this.grid)));
    return r * this.grid + c;
  }

  isFresh(i, now = Date.now()) { return now - this.tiles[i].okAt < this.freshMs; }

  freshCount(now = Date.now()) { return this.tiles.filter((_, i) => this.isFresh(i, now)).length; }

  /** Vehicles from all fresh areas. */
  vehicles(now = Date.now()) {
    const out = [];
    this.tiles.forEach((t, i) => { if (this.isFresh(i, now)) out.push(...t.vehicles); });
    return out;
  }

  async fetchTile(t) {
    const q = new URLSearchParams({
      north: t.north.toFixed(5), south: t.south.toFixed(5), west: t.west.toFixed(5), east: t.east.toFixed(5),
      results: 400, frames: 0, polylines: false,
    });
    const url = `${this.url}?${q}`;
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await httpFetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          if (res.status === 401 || res.status === 403 || res.status === 429) { lastErr = err; break; }
          throw err;
        }
        const data = await res.json();
        return Array.isArray(data) ? data : (data.movements || []);
      } catch (e) {
        lastErr = e;
        if (attempt === 1) await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw lastErr;
  }

  toVehicle(mv) {
    // Delay of the next stop the vehicle hasn't passed yet
    let delay = null;
    for (const s of mv.nextStopovers ?? []) {
      const d = s.departureDelay ?? s.arrivalDelay;
      const when = s.departure ?? s.arrival;
      if (when && Date.parse(when) < Date.now()) continue;
      if (d != null) { delay = d; break; }
    }
    return {
      id: `r:${mv.tripId}`,
      lat: Math.round(mv.location.latitude * 1e5) / 1e5,
      lng: Math.round(mv.location.longitude * 1e5) / 1e5,
      product: mv.line?.product ?? "unknown",
      line: mv.line?.name ?? "?",
      dir: mv.direction ?? "",
      delay,
      source: "live",
    };
  }

  async sweep() {
    const started = Date.now();
    const queue = this.tiles.map((t, i) => i);
    let failed = 0;
    const worker = async () => {
      for (let i; (i = queue.shift()) !== undefined; ) {
        const t = this.tiles[i];
        try {
          const movements = await this.fetchTile(t);
          // Keep only vehicles actually inside this area, so neighbouring areas never double up
          t.vehicles = movements
            .filter(mv => mv.tripId && mv.location && this.tileIndexOf(mv.location.latitude, mv.location.longitude) === i)
            .map(mv => this.toVehicle(mv));
          t.okAt = Date.now(); t.error = null;
        } catch (e) {
          failed++; t.error = e.message;
        }
        await new Promise(r => setTimeout(r, 300));
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, worker));
    const total = this.tiles.length;
    this.failedSweeps = failed === total ? this.failedSweeps + 1 : 0;
    this.log(`live positions: ${total - failed}/${total} areas ok, ${this.vehicles().length} vehicles, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    return Date.now() - started;
  }

  start() {
    const loop = async () => {
      if (this.stopped) return;
      const took = await this.sweep();
      // When the API is completely down, back off (up to 5 min) to stay polite
      const backoff = this.failedSweeps ? Math.min(5 * 60000, this.cycleMs * 2 ** this.failedSweeps) : this.cycleMs;
      setTimeout(loop, Math.max(1000, backoff - took));
    };
    loop();
  }
}
