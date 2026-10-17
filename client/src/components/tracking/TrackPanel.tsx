import { useState } from "react";
import { delayLabel, hhmm, type Journey, type Leg, type TrackState } from "../../lib/api";
import { boardAlight } from "../../hooks/useTracking";
import { lineStyle } from "../../lib/lines";
import { ModeIcon } from "../icons/modeIcons";
import { t } from "../../i18n";

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

const SOURCE_TEXT = { live: "Live position", delays: "Timetable + live delay", timetable: "Timetable estimate" } as const; // translated where shown

function minutesUntil(iso: string, delay: number | null | undefined) {
  return Math.round((Date.parse(iso) + (delay ?? 0) * 1000 - Date.now()) / 60000);
}
const inMin = (m: number) => (m <= 0 ? t("now") : m === 1 ? t("in 1 min") : t("in {n} min", { n: m }));

/** The headline: where the vehicle is relative to the traveller. */
function status(leg: Leg, tr: TrackState) {
  const { board, alight } = boardAlight(leg, tr);
  const s = tr.stops;
  const name = (i: number) => s[i]?.name ?? "";
  if (tr.state === "cancelled") return { tone: "bad", title: t("{line} is cancelled", { line: tr.line }), sub: t("Look for another connection.") };
  if (tr.next <= board || tr.state === "scheduled") {
    if (tr.atStop === board) return { tone: "go", title: t("{line} is at {stop}", { line: tr.line, stop: name(board) }), sub: t("Board now.") };
    const m = minutesUntil(s[board].dep, tr.delay);
    const stopsAway = Math.max(0, board - tr.next);
    return {
      tone: m <= 2 ? "go" : "wait",
      title: t("{line} reaches {stop} {when}", { line: tr.line, stop: name(board), when: inMin(m) }),
      sub: tr.state === "scheduled" ? t("Starts its run at {time}", { time: hhmm(s[0].dep) }) : stopsAway > 0 ? t(stopsAway > 1 ? "{n} stops away" : "1 stop away", { n: stopsAway }) : t("Approaching your stop"),
    };
  }
  if (tr.next <= alight && tr.state !== "finished") {
    if (tr.atStop === alight) return { tone: "go", title: t("At {stop}", { stop: name(alight) }), sub: t("Get off here.") };
    const left = alight - tr.next + 1;
    const m = minutesUntil(s[alight].arr, tr.delay);
    return {
      tone: left <= 1 ? "go" : "ride",
      title: left <= 1 ? t("Next stop: {stop}", { stop: name(alight) }) : t("{n} stops to {stop}", { n: left, stop: name(alight) }),
      sub: t("Arrives {time} ({when})", { time: hhmm(new Date(Date.parse(s[alight].arr) + (tr.delay ?? 0) * 1000).toISOString()), when: inMin(m) }),
    };
  }
  return { tone: "done", title: t("Arrived at {stop}", { stop: name(alight) }), sub: "" };
}

export function TrackPanel({ journey, legIndex, leg, data, error, follow, onFollow, onPickLeg, auto, onStop }: Props) {
  const rides = journey.legs.map((l, k) => ({ l, k })).filter(x => x.l.mode === "transit");
  const st = leg && data ? status(leg, data) : null;
  const range = leg && data ? boardAlight(leg, data) : null;

  // Phones: the stop list starts folded so the map (and your vehicle) stays visible
  const [showStops, setShowStops] = useState(() => !matchMedia("(max-width: 720px)").matches);
  const stopCount = range ? range.alight - range.board + 1 : 0;

  return (
    <section className="track-panel" aria-live="polite">
      <header className="track-head">
        <span className="live-pulse" aria-hidden />
        <strong>{t("Tracking live")}</strong>
        <button className="btn sm" onClick={onStop}>{t("Stop")}</button>
      </header>

      {rides.length > 1 && (
        <div className="track-steps" role="tablist" aria-label={t("Rides in this journey")}>
          <button role="tab" aria-selected={auto} className={auto ? "on" : ""} onClick={() => onPickLeg(null)}>{t("Auto")}</button>
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

      {error && !data && <p className="err">{t(error)}</p>}
      {!data && !error && <p className="muted">{t("Finding the vehicle…")}</p>}

      {st && data && (
        <>
          <div className={`track-status ${st.tone}`}>
            <span className="title">{st.title}</span>
            {st.sub && <span className="sub">{st.sub}</span>}
          </div>
          <div className="track-meta">
            <span className={`src ${data.source}`}>{t(SOURCE_TEXT[data.source])}</span>
            {data.delay != null && <span className={data.delay >= 60 ? "late-txt" : "ok-txt"}>{data.delay >= 60 ? t("{delay} min late", { delay: delayLabel(data.delay) ?? "" }) : t("On time")}</span>}
            {!follow && <button className="btn sm" onClick={onFollow}>{t("Re-center")}</button>}
          </div>

          {range && (
            <button className="stops-toggle track-stops-toggle" onClick={() => setShowStops(v => !v)} aria-expanded={showStops}>
              {t(showStops ? "Hide stops" : "Show all {n} stops", { n: stopCount })} {showStops ? "▴" : "▾"}
            </button>
          )}
          {range && showStops && (
            <ol className="track-stops">
              {data.stops.map((s, i) => {
                if (i < range.board || i > range.alight) return null;
                const passed = i < data.next && data.atStop !== i;
                const here = data.atStop === i || (data.atStop == null && i === data.next);
                const at = i === range.board ? s.dep : s.arr;
                return (
                  <li key={i} className={`${passed ? "passed" : ""} ${here ? "here" : ""} ${i === range.board || i === range.alight ? "end" : ""}`}>
                    <span className="t">{hhmm(at)}{data.delay != null && data.delay >= 60 && !passed && <span className="late">{delayLabel(data.delay)}</span>}</span>
                    <span className="dot" aria-hidden />
                    <span className="name">{s.name}{i === range.board ? ` · ${t("board")}` : i === range.alight ? ` · ${t("get off")}` : ""}</span>
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
