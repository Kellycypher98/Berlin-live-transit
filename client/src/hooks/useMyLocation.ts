import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../lib/nearby";

/** Follows your position while "Near me" is on. */
export function useMyLocation() {
  const [me, setMe] = useState<Me | null>(null);
  const [on, setOn] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const watch = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null; setOn(false); setMe(null); setLocating(false);
  }, []);

  const start = useCallback(() => {
    if (on && me) { setRecenter(k => k + 1); return; }   // already on: just jump back to you
    if (!navigator.geolocation) { setError("Your browser can't share its location."); return; }
    setOn(true); setLocating(true); setError(null);
    watch.current = navigator.geolocation.watchPosition(
      pos => {
        setLocating(false);
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
      },
      err => {
        setError(err.code === err.PERMISSION_DENIED ? "Location access is blocked. Allow it in your browser to see stations near you." : "Couldn't find your location.");
        stop();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }, [on, me, stop]);

  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);
  return { me, on, locating, error, start, stop, recenter, clearError: () => setError(null) };
}
