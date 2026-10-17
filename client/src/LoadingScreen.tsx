import { useEffect, useState } from "react";
import type { ConnectionState, Snapshot } from "./types";

type Props = {
  state: ConnectionState;
  snapshot: Snapshot | null;
  stationsReady: boolean;
  linesReady: boolean;
};

type Step = { label: string; done: boolean; active: boolean; note?: string };

/**
 * Full-screen loader until the map has something to show (vehicles), then a small pill
 * while stations, the timetable and the line map finish loading in the background.
 */
export function LoadingScreen({ state, snapshot, stationsReady, linesReady }: Props) {
  const connected = state === "open";
  const hasVehicles = !!snapshot?.updatedAt && snapshot.vehicles.length > 0;
  const timetableReady = !!snapshot?.sources?.timetable.ready || stationsReady;
  const [skipped, setSkipped] = useState(false);
  const [slow, setSlow] = useState(false);
  const [gone, setGone] = useState(false); // removed from the DOM after the fade-out

  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);

  const open = !(hasVehicles || skipped);
  useEffect(() => {
    if (open) { setGone(false); return; }
    const t = setTimeout(() => setGone(true), 450);
    return () => clearTimeout(t);
  }, [open]);

  const steps: Step[] = [
    { label: "Connecting to the live server", done: connected, active: !connected },
    { label: "Finding vehicles", done: hasVehicles, active: connected && !hasVehicles },
    {
      label: "Stations and timetable", done: timetableReady, active: connected && !timetableReady,
      note: "The first start downloads the VBB timetable, which takes a minute or two.",
    },
  ];
  const failed = state === "closed" || !!snapshot?.error;
  const message = state === "closed" ? "Can't reach the server. Retrying…" : snapshot?.error;

  const pending = [!stationsReady && "stations", !linesReady && "line map"].filter(Boolean);

  return (
    <>
      {!gone && (
        <div className={`loading-screen ${open ? "" : "out"}`} role="status" aria-live="polite" aria-busy={open}>
          <div className="loading-card">
            <div className="loading-mark" aria-hidden>
              <span /><span /><span />
            </div>
            <h1>Berlin Live Transit</h1>
            <p className="loading-sub">Every train, tram, bus and ferry, live.</p>
            <ol className="loading-steps">
              {steps.map(s => (
                <li key={s.label} className={s.done ? "done" : s.active ? "active" : ""}>
                  <span className="dot" aria-hidden />
                  <span>
                    {s.label}
                    {s.active && s.note && slow && <small>{s.note}</small>}
                  </span>
                </li>
              ))}
            </ol>
            {failed && message && <p className="loading-error">{message}</p>}
            {slow && open && (
              <button className="btn loading-skip" onClick={() => setSkipped(true)}>Show the map anyway</button>
            )}
          </div>
        </div>
      )}
      {!open && pending.length > 0 && (
        <div className="loading-pill" role="status">
          <span className="spinner" aria-hidden />
          Loading {pending.join(" and ")}…
        </div>
      )}
    </>
  );
}
