import { useState } from "react";
import { dayLabel, delayLabel, hhmm, type Journey, type JourneyResult, type Leg } from "../../lib/api";
import { lineStyle } from "../../lib/lines";
import { ModeIcon } from "../icons/modeIcons";
import { PlaceIcon } from "../icons/PlaceIcon";
import { locale, t } from "../../i18n";

const legMinutes = (l: Leg) => Math.max(1, Math.round((Date.parse(l.arr) - Date.parse(l.dep)) / 60000));
const fmtDistance = (m?: number | null) => (m == null ? "" : m >= 1000 ? `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} km` : `${Math.round(m / 10) * 10} m`);

/** Walking minutes as a small badge (skipped for platform changes). */
function WalkChip({ leg }: { leg: Leg }) {
  return (
    <span className="walk-chip" title={t("Walk {distance}", { distance: fmtDistance(leg.distance) })}>
      <PlaceIcon kind="walk" size={13} />{legMinutes(leg)}
    </span>
  );
}

type Props = {
  result: JourneyResult;
  selected: number;
  onSelect: (k: number) => void;
  onEarlier: () => void;
  onLater: () => void;
  onTrack: (journeyIndex: number, leg: number | null) => void;
  onRefresh: () => void;
  refreshing: boolean;
  fetchedAt: number | null;
};

function RefreshButton({ onRefresh, refreshing, fetchedAt }: { onRefresh: () => void; refreshing: boolean; fetchedAt: number | null }) {
  const at = fetchedAt ? new Date(fetchedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <button className="refresh-btn" onClick={onRefresh} disabled={refreshing}
      aria-label={refreshing ? t("Refreshing connections") : t("Refresh connections")} title={t("Fetch fresh connections")}>
      <span className={`refresh-icon ${refreshing ? "spin" : ""}`} aria-hidden>↻</span>
      <span>{refreshing ? t("Refreshing…") : at ? t("Updated {time}", { time: at }) : t("Refresh")}</span>
    </button>
  );
}

function whenText(r: JourneyResult) {
  const day = dayLabel(r.when);
  const time = hhmm(r.when);
  return `${t(r.mode === "arrive" ? "Arriving by {time}" : "Departing from {time}", { time })}${day ? ` · ${day}` : ""}`;
}

export function JourneyList({ result, selected, onSelect, onEarlier, onLater, onTrack, onRefresh, refreshing, fetchedAt }: Props) {
  if (!result.journeys.length) {
    return (
      <div className="empty-state">
        <RefreshButton onRefresh={onRefresh} refreshing={refreshing} fetchedAt={fetchedAt} />
        <strong>{t("No connection found")}</strong>
        <p>
          {result.outOfRange
            ? t("The live journey planner is unavailable, and the timetable here only covers today and tomorrow. Try a time within the next two days.")
            : t(result.mode === "arrive"
              ? "Nothing runs from {from} to {to} in the 4 hours before {time}. Try another time or a nearby station."
              : "Nothing runs from {from} to {to} within 4 hours of {time}. Try another time or a nearby station.",
              { from: result.from.name, to: result.to.name, time: hhmm(result.when) })}
        </p>
      </div>
    );
  }
  return (
    <div className={`journeys ${refreshing ? "is-refreshing" : ""}`} aria-busy={refreshing}>
      <div className="results-head">
        <span className="when-text">{whenText(result)}</span>
        <span className={`source-note ${result.source}`}>
          {result.source === "live" ? t("Live, with delays") : t("Timetable")}
        </span>
      </div>
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} fetchedAt={fetchedAt} />
      <button className="btn page-btn" onClick={onEarlier}>↑ {t("Earlier")}</button>
      <ol className="journey-list">
        {result.journeys.map((j, k) => (
          <li key={k}>
            <JourneyCard journey={j} open={k === selected} onToggle={() => onSelect(k)} onTrack={leg => onTrack(k, leg)} />
          </li>
        ))}
      </ol>
      <button className="btn page-btn" onClick={onLater}>↓ {t("Later")}</button>
    </div>
  );
}

function JourneyCard({ journey: j, open, onToggle, onTrack }: { journey: Journey; open: boolean; onToggle: () => void; onTrack: (leg: number | null) => void }) {
  const rides = j.legs.filter(l => l.mode === "transit");
  const firstDelay = rides[0]?.delay;
  const walkOnly = rides.length === 0;
  const first = j.legs[0], last = j.legs.at(-1)!;
  const walkIn = first?.mode === "walk" && !first.transfer && !walkOnly ? first : null;
  const walkOut = last?.mode === "walk" && !last.transfer && !walkOnly ? last : null;
  return (
    <div className={`journey ${open ? "open" : ""}`}>
      <button className="journey-head" onClick={onToggle} aria-expanded={open}>
        <span className="j-times">
          {dayLabel(j.dep) && <span className="j-day">{dayLabel(j.dep)} </span>}
          {hhmm(j.dep)} – {hhmm(j.arr)}
          {firstDelay != null && firstDelay >= 60 && <span className="late"> {delayLabel(firstDelay)}</span>}
        </span>
        <span className="j-meta">
          {t("{n} min", { n: j.duration })} · {walkOnly ? fmtDistance(first.distance) : j.transfers === 0 ? t("direct") : t(j.transfers > 1 ? "{n} changes" : "1 change", { n: j.transfers })}
        </span>
        <span className="j-lines">
          {walkOnly && <span className="walk-chip wide"><PlaceIcon kind="walk" size={14} /> {t("Walk all the way")}</span>}
          {walkIn && <WalkChip leg={walkIn} />}
          {rides.map((l, k) => (
            <span key={k} className="ride-chip">
              {(k > 0 || walkIn) && <span className="sep" aria-hidden>›</span>}
              <ModeIcon mode={l.product ?? "bus"} size={15} />
              <span className="chip" style={lineStyle(l.line, l.product)}>{l.line}</span>
            </span>
          ))}
          {walkOut && <><span className="sep" aria-hidden>›</span><WalkChip leg={walkOut} /></>}
        </span>
      </button>
      {open && rides.some(l => l.track) && (
        <button className="btn track-btn" onClick={() => onTrack(null)}>
          <span className="live-pulse" aria-hidden /> {t("Track this journey live")}
        </button>
      )}
      {open && (
        <ol className="legs">
          {j.legs.map((l, k) => <LegRow key={k} leg={l} onTrack={l.track ? () => onTrack(k) : undefined} />)}
          <li className="leg-end">
            <span className="t">{hhmm(j.arr)}</span>
            <span className="place">{j.legs.at(-1)?.to.name}</span>
          </li>
        </ol>
      )}
    </div>
  );
}

function LegRow({ leg, onTrack }: { leg: Leg; onTrack?: () => void }) {
  const [showStops, setShowStops] = useState(false);
  const mins = Math.max(1, Math.round((Date.parse(leg.arr) - Date.parse(leg.dep)) / 60000));
  if (leg.mode === "walk") {
    if (leg.transfer) {
      return (
        <li className="leg walk">
          <span className="t" />
          <span className="walk-text">{t("Change platforms")} · {t("{n} min", { n: mins })}</span>
        </li>
      );
    }
    // Walks to/from an address: show where from, the distance, and whether it follows streets
    const dist = fmtDistance(leg.distance);
    return (
      <li className="leg walk">
        <span className="t">{hhmm(leg.dep)}</span>
        <div className="walk-body">
          <span className="place">{leg.from.name}</span>
          <span className="walk-text">
            <PlaceIcon kind="walk" size={14} /> {t(leg.streetRoute ? "Walk {distance}" : "Walk about {distance}", { distance: dist })} · {t("{n} min", { n: mins })}
          </span>
          <span className="muted small">{t("to {place}", { place: leg.to.name })}</span>
        </div>
      </li>
    );
  }
  const style = lineStyle(leg.line, leg.product);
  const d = delayLabel(leg.delay);
  return (
    <li className="leg ride" style={{ "--leg": style.background } as React.CSSProperties}>
      <span className="t">
        {hhmm(leg.dep)}
        {d && d !== "0" && <span className="late">{d}</span>}
      </span>
      <div className="ride-body">
        <span className="place">{leg.from.name}</span>
        <span className="ride-line">
          <ModeIcon mode={leg.product ?? "bus"} size={16} />
          <span className="chip" style={style}>{leg.line}</span> → {leg.dir}
          {leg.cancelled && <span className="cancelled">{t("Cancelled")}</span>}
          {onTrack && <button className="link-btn" onClick={onTrack}>{t("Track")}</button>}
        </span>
        {leg.stops.length > 0 && (
          <button className="stops-toggle" onClick={() => setShowStops(v => !v)} aria-expanded={showStops}>
            {t(showStops ? (leg.stops.length > 1 ? "Hide {n} stops" : "Hide 1 stop") : (leg.stops.length > 1 ? "Show {n} stops" : "Show 1 stop"), { n: leg.stops.length })} · {t("{n} min", { n: mins })}
          </button>
        )}
        {leg.stops.length === 0 && <span className="muted">{t("{n} min, no stops between", { n: mins })}</span>}
        {showStops && (
          <ol className="stopovers">
            {leg.stops.map((s, k) => (
              <li key={k}><span className="t">{s.time ? hhmm(s.time) : ""}</span>{s.name}</li>
            ))}
          </ol>
        )}
        <span className="place to">{leg.to.name} <span className="muted">· {t("arr. {time}", { time: hhmm(leg.arr) })}</span></span>
      </div>
    </li>
  );
}
