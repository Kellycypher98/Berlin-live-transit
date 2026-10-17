import { stationPlace, type Station } from "../../lib/api";
import { PlaceGlyph, PlaceIcon } from "../icons/PlaceIcon";
import { lineStyle } from "../../lib/lines";
import { walkMin, type NearStation } from "../../lib/nearby";

/** "Near you" list in the side panel. */
export function NearbyList({ near, locating, onSelect, onFrom, onClose }: {
  near: NearStation[]; locating: boolean;
  onSelect: (s: Station) => void; onFrom: (s: Station) => void; onClose: () => void;
}) {
  return (
    <section className="nearby" aria-label="Stations near you">
      <header>
        <PlaceIcon kind="location" size={16} />
        <h2>Near you</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Hide stations near you">×</button>
      </header>
      {locating && <p className="muted small">Finding your location…</p>}
      {!locating && near.length === 0 && <p className="muted small">No stations within 1.5 km.</p>}
      <ul>
        {near.map(({ s, d }) => (
          <li key={s.i}>
            <button className="nearby-row" onClick={() => onSelect(s)}>
              <PlaceGlyph place={stationPlace(s)} size={20} />
              <span className="nb-main">
                <span className="nb-name">{s.name}</span>
                <span className="nb-lines">
                  {s.lines.slice(0, 5).map(l => <span key={l} className="chip" style={lineStyle(l)}>{l}</span>)}
                  {s.lines.length > 5 && <span className="more">+{s.lines.length - 5}</span>}
                </span>
              </span>
              <span className="nb-dist">
                <b>{walkMin(d)} min</b>
                <span>{d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`}</span>
              </span>
            </button>
            <button className="btn sm nb-go" onClick={() => onFrom(s)} title={`Route from ${s.name}`}>From here</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
