import { useEffect, useMemo, useState } from "react";
import { fetchStations, type Station } from "../lib/api";
import { buildSearchIndex } from "../lib/search";

/** Loads all stations once; retries while the server is still building its timetable. */
export function useStations() {
  const [stations, setStations] = useState<Station[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchStations(ctrl.signal)
        .then(list => { setStations(list); setError(null); })
        .catch(e => {
          if (ctrl.signal.aborted) return;
          setError(e.message);
          timer = setTimeout(load, 10000);
        });
    load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, []);

  const searchIndex = useMemo(() => buildSearchIndex(stations), [stations]);
  const byId = useMemo(() => new Map(stations.map(s => [s.i, s])), [stations]);
  return { stations, searchIndex, byId, error };
}
