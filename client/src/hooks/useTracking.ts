import { useEffect, useMemo, useState } from "react";
import { fetchTrack, type Journey, type Leg, type TrackState } from "../lib/api";

export type Tracking = { journey: Journey; leg: number | null }; // leg = index into journey.legs; null = follow the journey automatically

const POLL_MS = 5000;

/** Index of the ride to track: the first one that hasn't arrived yet (with 1 min grace). */
function autoLeg(j: Journey, now: number, delays: Record<number, number>) {
  let lastRide = -1;
  for (let k = 0; k < j.legs.length; k++) {
    const l = j.legs[k];
    if (l.mode !== "transit") continue;
    lastRide = k;
    if (Date.parse(l.arr) + (delays[k] ?? 0) * 1000 + 60_000 > now) return k;
  }
  return lastRide;
}

/** Board / alight positions in the tracked trip's stop list. */
export function boardAlight(leg: Leg, t: TrackState) {
  if (leg.track?.board != null && leg.track?.alight != null && t.stops.length > leg.track.alight) {
    return { board: leg.track.board, alight: leg.track.alight };
  }
  const n = (s: string) => s.toLowerCase().replace(/^(s\+u|s|u)\s+/, "").replace(/\s*\(.*\)$/, "").trim();
  const b = t.stops.findIndex(s => n(s.name) === n(leg.from.name));
  const a = t.stops.findIndex((s, i) => i > b && n(s.name) === n(leg.to.name));
  return { board: b >= 0 ? b : 0, alight: a >= 0 ? a : t.stops.length - 1 };
}

/** Polls the tracked ride every 5 s and moves on to the next ride after each change. */
export function useTracking(tracking: Tracking | null) {
  const [data, setData] = useState<TrackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delays, setDelays] = useState<Record<number, number>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => { setDelays({}); }, [tracking?.journey]);
  useEffect(() => {
    if (!tracking) return;
    const t = setInterval(() => setTick(x => x + 1), POLL_MS);
    return () => clearInterval(t);
  }, [tracking]);

  const legIndex = useMemo(
    () => (tracking ? tracking.leg ?? autoLeg(tracking.journey, Date.now(), delays) : -1),
    [tracking, delays, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const leg = tracking && legIndex >= 0 ? tracking.journey.legs[legIndex] : null;

  useEffect(() => { setData(null); setError(null); }, [tracking?.journey, legIndex]);

  useEffect(() => {
    if (!leg?.track) { if (leg) setError("This ride can't be tracked live."); return; }
    const ctrl = new AbortController();
    fetchTrack(leg.track, ctrl.signal)
      .then(d => {
        if (ctrl.signal.aborted) return;
        setData(d); setError(null);
        if (d.delay != null) setDelays(prev => (prev[legIndex] === d.delay ? prev : { ...prev, [legIndex]: d.delay! }));
      })
      .catch(e => { if (!ctrl.signal.aborted) setError(e.message); });
    return () => ctrl.abort();
  }, [leg, legIndex, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { leg, legIndex, data, error };
}
