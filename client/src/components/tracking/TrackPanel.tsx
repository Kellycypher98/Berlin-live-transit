import { delayLabel, hhmm, type Journey, type Leg, type TrackState } from "../../lib/api";
import { boardAlight } from "../../hooks/useTracking";
import { lineStyle } from "../../lib/lines";
import { ModeIcon } from "../icons/modeIcons";

type Props = {
  journey: Journey;
  legIndex: number;
  leg: Leg | null;
  data: TrackState | null;
  error: string | null;
  follow: boolean;
  onFollow: () => void;
  onPickLeg: (k: number | null) => void;
  auto: boolean;
  onStop: () => void;
};

const SOURCE_TEXT = { live: "Live position", delays: "Timetable + live delay", timetable: "Timetable estimate" } as const;

function minutesUntil(iso: string, delay: number | null | undefined) {
  return Math.round((Date.parse(iso) + (delay ?? 0) * 1000 - Date.now()) / 60000);
}
const inMin = (m: number) => (m <= 0 ? "now" : m === 1 ? "in 1 min" : `in ${m} min`);

/** The headline: where the vehicle is relative to the traveller. */
function status(leg: Leg, t: TrackState) {
  const { board, alight } = boardAlight(leg, t);
  const s = t.stops;
  const name = (i: number) => s[i]?.name ?? "";
  if (t.state === "cancelled") return { tone: "bad", title: `${t.line} is cancelled`, sub: "Look for another connection." };
  if (t.next <= board || t.state === "scheduled") {
    if (t.atStop === board) return { tone: "go", title: `${t.line} is at ${name(board)}`, sub: "Board now." };
    const m = minutesUntil(s[board].dep, t.delay);
    const stopsAway = Math.max(0, board - t.next);
    return {
      tone: m <= 2 ? "go" : "wait",
      title: `${t.line} reaches ${name(board)} ${inMin(m)}`,
      sub: t.state === "scheduled" ? `Starts its run at ${hhmm(s[0].dep)}` : stopsAway > 0 ? `${stopsAway} stop${stopsAway > 1 ? "s" : ""} away` : "Approaching your stop",
    };
  }
  if (t.next <= alight && t.state !== "finished") {
    if (t.atStop === alight) return { tone: "go", title: `At ${name(alight)}`, sub: "Get off here." };
    const left = alight - t.next + 1;
    const m = minutesUntil(s[alight].arr, t.delay);
    return {
      tone: left <= 1 ? "go" : "ride",
      title: left <= 1 ? `Next stop: ${name(alight)}` : `${left} stops to ${name(alight)}`,
      sub: `Arrives ${hhmm(new Date(Date.parse(s[alight].arr) + (t.delay ?? 0) * 1000).toISOString())} (${inMin(m)})`,
    };
  }
  return { tone: "done", title: `Arrived at ${name(alight)}`, sub: "" };
}

export function TrackPanel({ journey, legIndex, leg, data, error, follow, onFollow, onPickLeg, auto, onStop }: Props) {
  const rides = journey.legs.map((l, k) => ({ l, k })).filter(x => x.l.mode === "transit");
  const st = leg && data ? status(leg, data) : null;
  const range = leg && data ? boardAlight(leg, data) : null;

  return (
    <section className="track-panel" aria-live="polite">
      <header className="track-head">
        <span className="live-pulse" aria-hidden />
        <strong>Tracking live</strong>
        <button className="btn sm" onClick={onStop}>Stop</button>
      </header>

      {rides.length > 1 && (
        <div className="track-steps" role="tablist" aria-label="Rides in this journey">
          <button role="tab" aria-selected={auto} className={auto ? "on" : ""} onClick={() => onPickLeg(null)}>Auto</button>
          {rides.map(({ l, k }) => (
            <button key={k} role="tab" aria-selected={!auto && k === legIndex} className={k === legIndex ? (auto ? "cur" : "on") : ""} onClick={() => onPickLeg(k)}>
              <ModeIcon mode={l.product ?? "bus"} size={14} />
              <span className="chip sm" style={lineStyle(l.line, l.product)}>{l.line}</span>
            </button>
          ))}
        </div>
      )}

      {leg && (
        <div className="track-line">
          <ModeIcon mode={leg.product ?? "bus"} size={20} />
          <span className="chip" style={lineStyle(leg.line, leg.product)}>{leg.line}</span>
          <span className="dir">→ {leg.dir}</span>
        </div>
      )}

      {error && !data && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">Finding the vehicle…</p>}

      {st && data && (
        <>
          <div className={`track-status ${st.tone}`}>
            <span className="title">{st.title}</span>
            {st.sub && <span className="sub">{st.sub}</span>}
          </div>
          <div className="track-meta">
            <span className={`src ${data.source}`}>{SOURCE_TEXT[data.source]}</span>
            {data.delay != null && <span className={data.delay >= 60 ? "late-txt" : "ok-txt"}>{data.delay >= 60 ? `${delayLabel(data.delay)} min late` : "On time"}</span>}
            {!follow && <button className="btn sm" onClick={onFollow}>Re-center</button>}
          </div>

          {range && (
            <ol className="track-stops">
              {data.stops.map((s, i) => {
                if (i < range.board || i > range.alight) return null;
                const passed = i < data.next && data.atStop !== i;
                const here = data.atStop === i || (data.atStop == null && i === data.next);
                const t = i === range.board ? s.dep : s.arr;
                return (
                  <li key={i} className={`${passed ? "passed" : ""} ${here ? "here" : ""} ${i === range.board || i === range.alight ? "end" : ""}`}>
                    <span className="t">{hhmm(t)}{data.delay != null && data.delay >= 60 && !passed && <span className="late">{delayLabel(data.delay)}</span>}</span>
                    <span className="dot" aria-hidden />
                    <span className="name">{s.name}{i === range.board ? " · board" : i === range.alight ? " · get off" : ""}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
