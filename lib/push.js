// Notifications while the app is closed: the phone gives us a push subscription, we keep watching
// the journey here and send short updates ("U2 in 3 min", "Next stop: Alexanderplatz — get off").
// Each update replaces the previous notification (same tag), so it reads like one live card.
// Everything is in memory: a server restart ends running watches (the app can switch them on again).

import webpush from "web-push";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DATA_DIR = new URL("../data/", import.meta.url);
const KEY_FILE = new URL("vapid.json", DATA_DIR);
const TICK_MS = 20_000;
const MAX_WATCHES = 1000, MAX_PER_IP = 3;
const MAX_LIFETIME_MS = 4 * 3600e3;

// ---------- keys ----------
// VAPID keys identify this server to the push services. Created once and kept in data/ (a Docker volume),
// because changing them would invalidate every subscription. Env vars override the file.
function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(KEY_FILE)) return JSON.parse(readFileSync(KEY_FILE, "utf8"));
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(KEY_FILE, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

// ---------- texts ----------
const TEXT = {
  en: {
    inMin: n => (n <= 0 ? "now" : `in ${n} min`),
    reaches: (line, stop, when) => `${line} reaches ${stop} ${when}`,
    stopsAway: n => (n === 1 ? "1 stop away" : `${n} stops away`),
    approaching: "Approaching your stop",
    boardNow: (line, stop) => `${line} is at ${stop} — board now`,
    stopsTo: (n, stop) => `${n} stops to ${stop}`,
    nextStop: stop => `Next stop: ${stop} — get off`,
    getOff: stop => `${stop} — get off here`,
    arrives: (time, when) => `Arrives ${time} (${when})`,
    late: n => `+${n} min late`,
    onTime: "on time",
    cancelled: line => `${line} is cancelled`,
    lookElsewhere: "Open the app for another connection.",
    arrived: stop => `You've arrived at ${stop}`,
    change: (line, stop) => `Change to ${line} at ${stop}`,
    enabled: "Notifications are on",
    enabledBody: "You'll get updates here while the app is closed.",
  },
  de: {
    inMin: n => (n <= 0 ? "jetzt" : `in ${n} Min.`),
    reaches: (line, stop, when) => `${line} erreicht ${stop} ${when}`,
    stopsAway: n => (n === 1 ? "noch 1 Halt entfernt" : `noch ${n} Halte entfernt`),
    approaching: "Gleich an deiner Haltestelle",
    boardNow: (line, stop) => `${line} steht in ${stop} – jetzt einsteigen`,
    stopsTo: (n, stop) => `Noch ${n} Halte bis ${stop}`,
    nextStop: stop => `Nächster Halt: ${stop} – aussteigen`,
    getOff: stop => `${stop} – hier aussteigen`,
    arrives: (time, when) => `Ankunft ${time} (${when})`,
    late: n => `+${n} Min. Verspätung`,
    onTime: "pünktlich",
    cancelled: line => `${line} fällt aus`,
    lookElsewhere: "Öffne die App für eine andere Verbindung.",
    arrived: stop => `Angekommen in ${stop}`,
    change: (line, stop) => `Umsteigen in ${line} in ${stop}`,
    enabled: "Benachrichtigungen sind an",
    enabledBody: "Du bekommst hier Updates, solange die App geschlossen ist.",
  },
};
const hhmm = ms => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(ms);
const plain = s => s.replace(/\s*\((Berlin|Bln)\)$/, "");

/** Board / alight positions in the tracked trip's stop list (same rule as the app). */
export function boardAlight(ride, t) {
  if (ride.track?.board != null && ride.track?.alight != null && t.stops.length > ride.track.alight) {
    return { board: ride.track.board, alight: ride.track.alight };
  }
  const n = s => s.toLowerCase().replace(/^(s\+u|s|u)\s+/, "").replace(/\s*\(.*\)$/, "").trim();
  const b = t.stops.findIndex(s => n(s.name) === n(ride.from));
  const a = t.stops.findIndex((s, i) => i > b && n(s.name) === n(ride.to));
  return { board: b >= 0 ? b : 0, alight: a >= 0 ? a : t.stops.length - 1 };
}

/**
 * What to tell the traveller now. `key` changes only when the message should change, so we don't
 * spam; `important` updates buzz (board now, get off, cancelled, big delay change), the rest replace quietly.
 */
export function describe(ride, t, L, now = Date.now()) {
  const { board, alight } = boardAlight(ride, t);
  const s = t.stops, name = i => plain(s[i]?.name ?? "");
  const delayMin = t.delay != null ? Math.round(t.delay / 60) : null;
  const delayText = delayMin == null ? "" : delayMin >= 1 ? L.late(delayMin) : L.onTime;
  const mins = iso => Math.round((Date.parse(iso) + (t.delay ?? 0) * 1000 - now) / 60000);
  const line = t.line;

  if (t.state === "cancelled") return { key: "cancelled", important: true, title: L.cancelled(line), body: L.lookElsewhere };
  if (t.next <= board || t.state === "scheduled") {
    if (t.atStop === board) return { key: "board", important: true, title: L.boardNow(line, name(board)), body: `→ ${plain(t.dir)} · ${delayText}` };
    const m = Math.max(0, mins(s[board].dep));
    const bucket = m > 15 ? "15+" : m > 10 ? "10+" : m > 5 ? String(Math.ceil(m / 2) * 2) : String(m); // fewer updates far out
    const away = Math.max(0, board - t.next);
    return {
      key: `wait:${bucket}:${delayMin}`, important: m <= 2 && m >= 0,
      title: L.reaches(line, name(board), L.inMin(m)),
      body: [away > 0 ? L.stopsAway(away) : L.approaching, delayText].filter(Boolean).join(" · "),
    };
  }
  if (t.next <= alight && t.state !== "finished") {
    if (t.atStop === alight) return { key: "getoff", important: true, title: L.getOff(name(alight)), body: delayText };
    const left = alight - t.next + 1;
    const arr = Date.parse(s[alight].arr) + (t.delay ?? 0) * 1000;
    const body = [L.arrives(hhmm(arr), L.inMin(mins(s[alight].arr))), delayText].filter(Boolean).join(" · ");
    if (left <= 1) return { key: "next", important: true, title: L.nextStop(name(alight)), body };
    return { key: `ride:${left}:${delayMin}`, important: false, title: L.stopsTo(left, name(alight)), body };
  }
  return { key: "done", important: false, done: true, title: L.arrived(name(alight)), body: "" };
}

// ---------- watches ----------

/**
 * startPush({ track, log }) — `track(ref)` returns the same state as GET /api/track.
 * Returns the HTTP handlers and a count for the admin page.
 */
export function startPush({ track, log = console.log, contact = "", send = null }) {
  const keys = vapidKeys();
  const subject = /^mailto:|^https:/.test(contact) ? contact : contact.includes("@") ? `mailto:${contact}` : "mailto:admin@example.com";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const sendPush = send ?? ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts));

  const watches = new Map(); // id -> watch
  let sent = 0, failed = 0;

  async function notify(w, msg) {
    const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: `blt-${w.id}`, renotify: !!msg.important, url: "/" });
    try {
      await sendPush(w.sub, payload, { TTL: 120, urgency: msg.important ? "high" : "normal" });
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) watches.delete(w.id); // subscription gone (app removed, permission revoked)
      else log(`push failed (${e.statusCode ?? e.message})`);
    }
  }

  /** The ride to look at: the first one not yet arrived (1 min grace), like the app's "Auto". */
  function currentRide(w, now) {
    for (let k = 0; k < w.rides.length; k++) {
      const r = w.rides[k];
      if (Date.parse(r.arr) + (w.delays[k] ?? 0) * 1000 + 60_000 > now) return k;
    }
    return -1;
  }

  async function check(w, now = Date.now()) {
    const k = currentRide(w, now);
    if (k < 0 || now - w.createdAt > MAX_LIFETIME_MS) {
      const last = w.rides.at(-1);
      if (k < 0 && w.lastKey !== "done") await notify(w, { title: w.L.arrived(plain(last.to)), body: "" });
      watches.delete(w.id);
      return;
    }
    const ride = w.rides[k];
    let t;
    try { t = await track(ride.track); } catch { return; } // try again next round
    if (!t) return;
    if (t.delay != null) w.delays[k] = t.delay;
    let msg = describe(ride, t, w.L, now);
    // A finished ride with another one coming: point to the change instead of "arrived"
    if (msg.done && k < w.rides.length - 1) {
      const nx = w.rides[k + 1];
      msg = { key: `change:${k}`, important: true, title: w.L.change(nx.line, plain(nx.from)), body: "" };
    }
    const key = `${k}|${msg.key}`;
    if (key === w.lastKey) return;
    w.lastKey = key;
    await notify(w, msg);
    if (msg.done) watches.delete(w.id);
  }

  let running = false;
  setInterval(async () => {
    if (running || !watches.size) return;
    running = true;
    try {
      // A few at a time, so one slow lookup doesn't hold up the rest
      const list = [...watches.values()];
      for (let i = 0; i < list.length; i += 10) await Promise.all(list.slice(i, i + 10).map(w => check(w).catch(() => {})));
    } finally { running = false; }
  }, TICK_MS).unref();

  /** POST /api/push/watch body: { subscription, rides: [...], lang } */
  async function watch(body, ip) {
    const sub = body?.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\/[^\s]{8,600}$/.test(sub.endpoint)
      || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string"
      || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) {
      return [400, { error: "Invalid push subscription." }];
    }
    const rides = Array.isArray(body.rides) ? body.rides.slice(0, 6).map(r => ({
      line: String(r.line ?? "").slice(0, 20), dir: String(r.dir ?? "").slice(0, 120),
      from: String(r.from ?? "").slice(0, 120), to: String(r.to ?? "").slice(0, 120),
      dep: String(r.dep ?? ""), arr: String(r.arr ?? ""),
      track: r.track && typeof r.track === "object" ? {
        trip: r.track.trip ? String(r.track.trip).slice(0, 200) : undefined,
        day: [-1, 0, 1].includes(r.track.day) ? r.track.day : 0,
        hafas: r.track.hafas ? String(r.track.hafas).slice(0, 300) : undefined,
        board: Number.isInteger(r.track.board) ? r.track.board : undefined,
        alight: Number.isInteger(r.track.alight) ? r.track.alight : undefined,
      } : null,
    })).filter(r => r.track && (r.track.trip || r.track.hafas) && Number.isFinite(Date.parse(r.arr))) : [];
    if (!rides.length) return [400, { error: "This journey can't be followed." }];

    // One watch per subscription: replace an older one (e.g. the user picked another connection)
    for (const [id, w] of watches) if (w.sub.endpoint === sub.endpoint) watches.delete(id);
    if (watches.size >= MAX_WATCHES) return [503, { error: "Too many people are being notified right now. Try again later." }];
    if ([...watches.values()].filter(w => w.ip === ip).length >= MAX_PER_IP) return [429, { error: "Too many notifications from this network." }];

    const lang = body.lang === "de" ? "de" : "en";
    const w = { id: randomUUID(), sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, rides, L: TEXT[lang], lang, ip, delays: {}, lastKey: null, createdAt: Date.now() };
    watches.set(w.id, w);
    check(w).catch(() => {}); // first update right away
    return [200, { id: w.id }];
  }

  function unwatch(body) {
    if (typeof body?.id === "string") watches.delete(body.id);
    return [200, { ok: true }];
  }

  return { publicKey: keys.publicKey, watch, unwatch, stats: () => ({ watching: watches.size, sent, failed }), _check: check, _watches: watches };
}
