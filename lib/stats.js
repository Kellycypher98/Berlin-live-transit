// In-memory stats for the admin dashboard. Nothing is written to disk and nothing
// personal is kept: visitors are counted by a salted hash that changes on every restart.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const HISTORY = 360;       // one point per tick: 10 s × 360 = the last hour
const LOG_SIZE = 40;

const startedAt = Date.now();
const salt = randomBytes(16);
const routes = new Map();  // "GET /api/journeys" -> { count, errors, totalMs, maxMs }
const history = [];        // { t, live, delays, timetable, clients }
const logs = [];           // recent warnings + errors
const counters = { journeys: 0, journeysLive: 0, journeysLocal: 0, tracks: 0, placeSearches: 0 };
let today = dayKey();
let visitorsToday = new Set();
let connectionsTotal = 0, peakClients = 0;

function dayKey(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}
function rollDay() {
  const k = dayKey();
  if (k !== today) { today = k; visitorsToday = new Set(); for (const c in counters) counters[c] = 0; }
}

/** Groups paths so /api/stations/123/departures counts as one route. */
function routeOf(path) {
  if (!path.startsWith("/api/") && path !== "/health") return null; // static files aren't interesting
  return path.replace(/\/\d+(?=\/|$)/g, "/:id");
}

/** Call at the start of every HTTP request; records the route, status and time on finish. */
export function trackRequest(req, res) {
  const route = routeOf(new URL(req.url, "http://x").pathname);
  if (!route || route.startsWith("/api/admin")) return;
  const t0 = performance.now();
  res.on("finish", () => {
    const ms = performance.now() - t0;
    const r = routes.get(route) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    r.count++; r.totalMs += ms; r.maxMs = Math.max(r.maxMs, ms);
    if (res.statusCode >= 500) r.errors++;
    routes.set(route, r);
  });
}

export function count(name, by = 1) { rollDay(); counters[name] = (counters[name] ?? 0) + by; }

export function trackConnection(req, clients) {
  rollDay();
  connectionsTotal++;
  peakClients = Math.max(peakClients, clients);
  const ip = clientIp(req);
  visitorsToday.add(createHash("sha256").update(salt).update(ip).digest("base64url").slice(0, 16));
}

export function recordTick(sources, clients) {
  history.push({ t: Date.now(), live: sources.live.vehicles, delays: sources.delays.vehicles, timetable: sources.timetable.vehicles, clients });
  if (history.length > HISTORY) history.shift();
}

/** Keeps the latest server warnings and errors (still printed to the terminal as usual). */
export function captureLogs() {
  for (const level of ["warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      logs.push({ t: Date.now(), level, message: args.map(a => (a instanceof Error ? a.message : String(a))).join(" ").slice(0, 300) });
      if (logs.length > LOG_SIZE) logs.shift();
      orig(...args);
    };
  }
}

export function statsSnapshot(extra) {
  rollDay();
  const mem = process.memoryUsage();
  return {
    now: Date.now(),
    startedAt,
    node: process.version,
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    visitorsToday: visitorsToday.size,
    connectionsTotal,
    peakClients,
    counters,
    routes: [...routes].map(([route, r]) => ({ route, count: r.count, errors: r.errors, avgMs: Math.round(r.totalMs / r.count), maxMs: Math.round(r.maxMs) }))
      .sort((a, b) => b.count - a.count),
    history,
    logs: [...logs].reverse(),
    ...extra,
  };
}

// ---------- access ----------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const failures = new Map(); // ip -> { n, until }

// Behind a host's proxy (Render, Fly, Netlify) every request comes from the proxy's address; set
// TRUST_PROXY=1 there to use the visitor's address from X-Forwarded-For instead. That header can be
// faked by the client, so it only feeds visitor counts and the lockout, never access decisions.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
export function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || "unknown";
}
const isLoopback = ip => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

/**
 * With ADMIN_TOKEN set, the dashboard needs "Authorization: Bearer <token>".
 * Without it, it only answers on this computer (localhost), so a deployed server is never open by accident.
 * Returns null when allowed, else [status, message].
 */
export function checkAdmin(req) {
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return [429, "Too many wrong tokens. Try again in a few minutes."];
  if (!ADMIN_TOKEN) {
    return isLoopback(req.socket.remoteAddress) && !req.headers["x-forwarded-for"] ? null
      : [403, "The admin dashboard is off. Set ADMIN_TOKEN on the server to use it remotely."];
  }
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(given).digest(), b = createHash("sha256").update(ADMIN_TOKEN).digest();
  if (given && timingSafeEqual(a, b)) { failures.delete(ip); return null; }
  if (!given) return [401, "Admin token required."]; // just opened the page: not a wrong guess
  const n = (f?.n ?? 0) + 1;
  failures.set(ip, { n, until: n >= 5 ? Date.now() + 10 * 60e3 : 0 });
  if (failures.size > 1000) failures.delete(failures.keys().next().value);
  return [401, "Wrong admin token."];
}

export const adminNeedsToken = () => !!ADMIN_TOKEN;
