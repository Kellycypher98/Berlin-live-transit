// Types and fetchers for the server's REST endpoints
import { locale, t } from "../i18n";

export type Station = { i: number; name: string; lat: number; lng: number; p: number; lines: string[] };

/** A journey end: a station, an address, a point of interest, or a raw location (my position, map pin). */
export type PlaceKind = "station" | "address" | "poi" | "location";
export type Place = { kind: PlaceKind; name: string; detail?: string | null; lat: number; lng: number; station?: number; lines?: string[]; p?: number };

export const stationPlace = (s: Station): Place => ({ kind: "station", name: s.name, lat: s.lat, lng: s.lng, station: s.i, lines: s.lines, p: s.p });
export const placeKey = (p: Place | null) => (!p ? "" : p.station != null ? `s:${p.station}` : `p:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);

export type LegPlace = { name: string; lat: number; lng: number; time?: string; station?: number | null };

export type Leg = {
  mode: "transit" | "walk";
  transfer?: boolean;
  line?: string;
  product?: string;
  dir?: string;
  from: LegPlace;
  to: LegPlace;
  dep: string;
  arr: string;
  delay?: number | null;
  distance?: number | null;
  streetRoute?: boolean;
  cancelled?: boolean;
  path: [number, number][];
  stops: LegPlace[];
  /** How to track this ride live: timetable trip (+ board/alight positions) and/or community trip id */
  track?: TrackRef;
};

export type TrackRef = { trip?: string; day?: number; board?: number; alight?: number; hafas?: string };

export type TrackStop = { name: string; station: number | null; lat: number; lng: number; arr: string; dep: string; delay?: number | null };

export type TrackState = {
  line: string; product: string; dir: string;
  state: "scheduled" | "running" | "finished" | "cancelled";
  source: "live" | "delays" | "timetable";
  delay: number | null;
  lat: number; lng: number; heading: number | null;
  atStop: number | null;   // index of the stop it's standing at
  next: number;            // index of the next stop it hasn't reached
  stops: TrackStop[];
  updatedAt: string;
};

export type Journey = { source: "live" | "timetable" | "walk"; dep: string; arr: string; duration: number; transfers: number; legs: Leg[] };

export type JourneyResult = {
  from: { name: string };
  to: { name: string };
  source: "live" | "timetable";
  mode: "depart" | "arrive";
  when: string;
  journeys: Journey[];
  notes: string[];
  outOfRange?: boolean;
};

export type Departure = { line: string; product: string; dir: string; planned: string; delay: number | null };

export type DepartureResult = { station: Station; departures: Departure[]; delays: boolean };

// Product bitmask (same as the server's PRODUCT_BITS)
export const P = { subway: 1, suburban: 2, tram: 4, bus: 8, regional: 16, ferry: 32 } as const;
export const isRail = (s: Station) => (s.p & (P.subway | P.suburban | P.regional)) !== 0;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(t(body.error || "Request failed ({status})", { status: res.status }));
  }
  // A cancelled or broken response must fail, never pass as an empty result
  return (await res.json()) as T;
}

export const fetchStations = (signal?: AbortSignal) =>
  getJson<{ stations: Station[] }>("/api/stations", signal).then(r => r.stations);

export const fetchDepartures = (i: number, signal?: AbortSignal) =>
  getJson<DepartureResult>(`/api/stations/${i}/departures`, signal);

export function fetchJourneys(from: Place, to: Place, opts: { when?: string | null; mode?: "depart" | "arrive" } = {}, signal?: AbortSignal) {
  const q = new URLSearchParams({ mode: opts.mode ?? "depart" });
  for (const [key, p] of [["from", from], ["to", to]] as const) {
    if (p.station != null) q.set(key, String(p.station));
    else { q.set(`${key}Lat`, String(p.lat)); q.set(`${key}Lng`, String(p.lng)); q.set(`${key}Name`, p.name); }
  }
  if (opts.when) q.set("when", opts.when);
  return getJson<JourneyResult>(`/api/journeys?${q}`, signal);
}

const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
export const hhmm = (iso: string) => timeFmt.format(new Date(iso));

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
/** "" for today, "Tomorrow" or e.g. "Sun 19 Oct" otherwise. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const k = dayKey.format(d);
  if (k === dayKey.format(new Date())) return "";
  if (k === dayKey.format(new Date(Date.now() + 86400000))) return t("Tomorrow");
  return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Berlin" }).format(d);
}

export function delayLabel(delay: number | null | undefined) {
  if (delay == null) return null;
  const min = Math.round(delay / 60);
  return min > 0 ? `+${min}` : min < 0 ? `${min}` : "0";
}

export type MapLine = { line: string; product: string; paths: [number, number][][] };

export const fetchLines = (signal?: AbortSignal) =>
  getJson<{ lines: MapLine[] }>("/api/lines", signal).then(r => r.lines);

export function fetchTrack(ref: TrackRef, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (ref.trip) { q.set("trip", ref.trip); q.set("day", String(ref.day ?? 0)); }
  if (ref.hafas) q.set("hafas", ref.hafas);
  return getJson<TrackState>(`/api/track?${q}`, signal);
}

export type PlaceResult = { source: "vbb" | "osm" | "none"; places: { kind: "address" | "poi"; name: string; detail?: string | null; lat: number; lng: number }[]; note?: string };

export const fetchPlaces = (q: string, signal?: AbortSignal) =>
  getJson<PlaceResult>(`/api/places?q=${encodeURIComponent(q)}`, signal);

export const fetchReverse = (lat: number, lng: number, signal?: AbortSignal) =>
  getJson<{ name: string | null; detail?: string | null }>(`/api/reverse?lat=${lat}&lng=${lng}`, signal);
