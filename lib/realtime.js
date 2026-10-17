// Polls VBB's official GTFS-Realtime feed (trip updates = delays and cancellations).
// The feed is known to have gaps, so everything degrades to the plain timetable when it's empty.

import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { httpFetch } from "./http.js";

const { FeedMessage, TripDescriptor } = GtfsRealtimeBindings.transit_realtime;
const CANCELED = TripDescriptor.ScheduleRelationship.CANCELED;

let etag = null, last = null; // the feed sends an ETag: unchanged data comes back as 304

/**
 * Returns { fetchedAt, feedTimestamp, updates: Map<trip_id, { canceled, stops: [{ stopId, seq, delay }] }> }
 * Errors carry `status` (e.g. 403 when VBB blocks the request).
 */
export async function fetchTripUpdates(url) {
  const res = await httpFetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: etag && last ? { "if-none-match": etag } : {},
  });
  if (res.status === 304 && last) return { ...last, fetchedAt: Date.now(), bytes: 0 };
  if (!res.ok) {
    const err = new Error(res.status === 403
      ? "HTTP 403 (blocked by VBB; set CONTACT to your email so the app identifies itself)"
      : `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  etag = res.headers.get("etag");
  const buf = new Uint8Array(await res.arrayBuffer());
  const feed = FeedMessage.decode(buf);

  const updates = new Map();
  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    if (!tu?.trip?.tripId) continue;
    const canceled = tu.trip.scheduleRelationship === CANCELED;
    const stops = [];
    for (const s of tu.stopTimeUpdate ?? []) {
      const delay = s.departure?.delay ?? s.arrival?.delay;
      if (delay == null) continue;
      stops.push({ stopId: s.stopId ?? null, seq: s.stopSequence ?? null, delay: Number(delay) });
    }
    // A trip-level delay applies to the whole trip
    if (!stops.length && tu.delay != null) stops.push({ stopId: null, seq: null, delay: Number(tu.delay) });
    updates.set(tu.trip.tripId, { canceled, stops });
  }

  last = {
    fetchedAt: Date.now(),
    feedTimestamp: feed.header?.timestamp ? Number(feed.header.timestamp) * 1000 : null,
    bytes: buf.length,
    updates,
  };
  return last;
}
