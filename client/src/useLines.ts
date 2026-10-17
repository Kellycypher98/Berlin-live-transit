import { useEffect, useState } from "react";
import { fetchLines, type MapLine } from "./api";

/** Loads the network map once; retries while the server is still building its timetable. */
export function useLines() {
  const [lines, setLines] = useState<MapLine[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchLines(ctrl.signal)
        .then(setLines)
        .catch(() => { if (!ctrl.signal.aborted) timer = setTimeout(load, 10000); });
    load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, []);
  return lines;
}
