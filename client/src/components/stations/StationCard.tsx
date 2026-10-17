import { useEffect, useState } from "react";
import { delayLabel, fetchDepartures, hhmm, type DepartureResult, type Station } from "../../lib/api";
import { lineStyle } from "../../lib/lines";
import { ModeIcon } from "../icons/modeIcons";
import { P } from "../../lib/api";
import { MODES } from "../../lib/modes";

const SERVED = [["subway", P.subway], ["suburban", P.suburban], ["regional", P.regional], ["tram", P.tram], ["bus", P.bus], ["ferry", P.ferry]] as const;

type Props = {
  station: Station;
  onClose: () => void;
  onFrom: (s: Station) => void;
  onTo: (s: Station) => void;
};

/** A station's lines and next departures (refreshed every 30 s), with route shortcuts. */
export function StationCard({ station, onClose, onFrom, onTo }: Props) {
  const [data, setData] = useState<DepartureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null); setError(null);
    const load = () => fetchDepartures(station.i, ctrl.signal).then(setData).catch(e => { if (!ctrl.signal.aborted) setError(e.message); });
    load();
    const t = setInterval(load, 30000);
    return () => { ctrl.abort(); clearInterval(t); };
  }, [station.i]);

  return (
    <section className="station-card" aria-label={station.name}>
      <header>
        <span className="served">
          {SERVED.filter(([, bit]) => station.p & bit).map(([m]) => <ModeIcon key={m} mode={m} size={20} title={MODES.find(x => x.key === m)?.label} />)}
        </span>
        <h2>{station.name}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close station">×</button>
      </header>
      <div className="chips">
        {station.lines.map(l => <span key={l} className="chip" style={lineStyle(l)}>{l}</span>)}
      </div>
      <div className="actions">
        <button className="btn" onClick={() => onFrom(station)}>Route from here</button>
        <button className="btn" onClick={() => onTo(station)}>Route to here</button>
      </div>

      <h3>Next departures {data && !data.delays && <span className="muted">· timetable</span>}</h3>
      {error && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.departures.length === 0 && <p className="muted">No departures in the next hour.</p>}
      {data && data.departures.length > 0 && (
        <ul className="departures">
          {data.departures.map((d, k) => {
            const dl = delayLabel(d.delay);
            return (
              <li key={k}>
                <span className="t">{hhmm(d.planned)}{dl && dl !== "0" && <span className="late">{dl}</span>}</span>
                <span className="dep-line"><ModeIcon mode={d.product} size={15} /><span className="chip" style={lineStyle(d.line, d.product)}>{d.line}</span></span>
                <span className="dir">{d.dir}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
