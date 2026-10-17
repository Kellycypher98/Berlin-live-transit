import { isRail, type Station } from "./api";

export type Me = { lat: number; lng: number; acc: number };
export type NearStation = { s: Station; d: number };

const RADIUS = 1500;  // metres
const COUNT = 6;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const kx = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111_195, (a.lng - b.lng) * 111_195 * kx);
}
/** Same walking estimate as the server's planner: detour factor 1.3 at 1.25 m/s. */
export const walkMin = (d: number) => Math.max(1, Math.round((d * 1.3) / 1.25 / 60));

/** The closest stops around you, always including the nearest U/S/regional station if one is within reach. */
export function nearestStations(stations: Station[], me: Me): NearStation[] {
  const all: NearStation[] = [];
  for (const s of stations) {
    const d = distanceM(me, s);
    if (d <= RADIUS * 1.4) all.push({ s, d });
  }
  all.sort((a, b) => a.d - b.d);
  const out = all.filter(x => x.d <= RADIUS).slice(0, COUNT);
  if (!out.some(x => isRail(x.s))) {
    const rail = all.find(x => isRail(x.s));
    if (rail) out.splice(Math.max(0, out.length - 1), 1, rail);
  }
  return out.sort((a, b) => a.d - b.d);
}
