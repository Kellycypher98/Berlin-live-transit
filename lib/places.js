// Place search: addresses and points of interest, for journeys from/to anywhere (not only stations).
// Sources, best first:
//   1. VBB community API /locations (addresses + POIs from VBB's own place index)
//   2. Photon (OpenStreetMap-based geocoder by komoot), biased to Berlin
// Stations themselves are searched in the browser from our own station list.
// Results are cached for 10 minutes so typing doesn't hammer either service.

import { httpFetch } from "./http.js";

const PHOTON = process.env.PHOTON_URL || "https://photon.komoot.io";
const BOX = { west: 12.9, south: 52.3, east: 13.85, north: 52.72 };
const cache = new Map(); // key -> { at, data }
const TTL = 10 * 60e3;

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const p = fn().then(data => { cache.set(key, { at: Date.now(), data }); return data; });
  p.catch(() => cache.delete(key));
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data: p });
  return p;
}

const inBox = (lat, lng) => lat >= BOX.south && lat <= BOX.north && lng >= BOX.west && lng <= BOX.east;
const round = x => Math.round(x * 1e6) / 1e6;

/** VBB community API: addresses and POIs (stops are left to our own station search). */
async function vbbPlaces(baseUrl, q) {
  const params = new URLSearchParams({ query: q, results: "8", stops: "false", addresses: "true", poi: "true", fuzzy: "true", language: "de" });
  const res = await httpFetch(`${baseUrl}/locations?${params}`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : [])
    .filter(l => l.type === "location" && Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map(l => {
      if (l.poi) return { kind: "poi", name: l.name, detail: l.address ?? null, lat: round(l.latitude), lng: round(l.longitude) };
      // "10243 Berlin-Friedrichshain, Karl-Marx-Allee 34" -> street first, area underneath
      const a = l.address ?? l.name ?? "";
      const m = a.match(/^(\d{5}\s[^,]+),\s*(.+)$/);
      return { kind: "address", name: m ? m[2] : a, detail: m ? m[1] : null, lat: round(l.latitude), lng: round(l.longitude) };
    });
}

function photonName(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const area = [p.postcode, p.district || p.city].filter(Boolean).join(" ");
  if (p.name && p.name !== p.street) return { name: p.name, detail: [street, area].filter(Boolean).join(", ") || null, kind: "poi" };
  return { name: street || p.name || "?", detail: area || null, kind: "address" };
}

/** Photon: OpenStreetMap geocoder, biased to central Berlin and limited to the Berlin area. */
async function photonPlaces(q) {
  const params = new URLSearchParams({ q, limit: "8", lat: "52.52", lon: "13.405", lang: "de", bbox: `${BOX.west},${BOX.south},${BOX.east},${BOX.north}` });
  const res = await httpFetch(`${PHOTON}/api/?${params}`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.features ?? [])
    .map(f => {
      const [lng, lat] = f.geometry?.coordinates ?? [];
      if (!Number.isFinite(lat) || !inBox(lat, lng)) return null;
      return { ...photonName(f.properties ?? {}), lat: round(lat), lng: round(lng) };
    })
    .filter(Boolean);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(p => {
    const k = `${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/** Addresses and places matching `q`. Returns { source, places, note? }. */
export function searchPlaces(baseUrl, q) {
  const key = q.trim().toLowerCase();
  return cached(`q:${key}`, async () => {
    try {
      const places = await vbbPlaces(baseUrl, q);
      if (places.length) return { source: "vbb", places: dedupe(places).slice(0, 8) };
    } catch { /* fall through to Photon */ }
    try {
      return { source: "osm", places: dedupe(await photonPlaces(q)).slice(0, 8) };
    } catch (e) {
      return { source: "none", places: [], note: "Address search is unavailable right now; you can still pick stations." };
    }
  });
}

/** A readable name for a point (street + number), or null. */
export function reversePlace(lat, lng) {
  return cached(`r:${lat.toFixed(4)},${lng.toFixed(4)}`, async () => {
    try {
      const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: "de", limit: "1" });
      const res = await httpFetch(`${PHOTON}/reverse?${params}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const f = (await res.json()).features?.[0];
      if (!f) return null;
      const n = photonName(f.properties ?? {});
      return { name: n.name, detail: n.detail };
    } catch { return null; }
  });
}
