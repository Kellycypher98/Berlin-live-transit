import { useState } from "react";
import { MODES, type ModeKey } from "../../lib/modes";
import { ModeIcon } from "../icons/modeIcons";
import type { ConnectionState, Snapshot } from "../../lib/types";
import logo from "../../assets/logo-128.png";
import { LANGS, useLang } from "../../i18n";

type Props = {
  state: ConnectionState;
  snapshot: Snapshot | null;
  counts: Partial<Record<ModeKey, number>>;
  enabled: Set<ModeKey>;
  onToggle: (key: ModeKey) => void;
  showLines: boolean;
  onShowLines: (v: boolean) => void;
  linesReady: boolean;
};

export function ControlPanel({ state, snapshot, counts, enabled, onToggle, showLines, onShowLines, linesReady }: Props) {
  const { t, lang, setLang } = useLang();
  const vehiclesText = (n: number) => t(n === 1 ? "1 vehicle" : "{n} vehicles", { n });
  let status: string;
  let isError = false;
  if (state === "closed") { status = t("Disconnected. Reconnecting…"); isError = true; }
  else if (state === "connecting") status = t("Connecting…");
  else if (snapshot?.error) { status = t(snapshot.error); isError = true; }
  else if (!snapshot?.updatedAt) status = t("Loading live data and the VBB timetable…");
  else status = `${vehiclesText(snapshot.vehicles.length)} · ${new Date(snapshot.updatedAt).toLocaleTimeString("de-DE")}`;

  const src = state === "open" && snapshot?.updatedAt ? snapshot.sources : null;
  // Collapsed by default on phones so the map stays visible
  const [open, setOpen] = useState(() => window.innerWidth > 720);

  return (
    <aside className={`panel ${open ? "" : "collapsed"}`}>
      <button className="panel-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="brand" aria-hidden>
          <img src={logo} alt="" width={24} height={24} />
          <span className={`live ${state === "open" ? "on" : ""}`} />
        </span>
        <span className="title">Berlin Live Transit</span>
        <span className="count">{snapshot?.updatedAt ? `${snapshot.vehicles.length}` : ""}</span>
        <span className="chev" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && <>

      <div className="modes">
        {MODES.map(m => (
          <button
            key={m.key}
            id={`mode-${m.key}`}
            className="mode"
            aria-pressed={enabled.has(m.key)}
            onClick={() => onToggle(m.key)}
          >
            <ModeIcon mode={m.key} size={16} />
            {t(m.label)} <span className="n">{counts[m.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <label className="switch">
        <input id="show-lines" type="checkbox" checked={showLines} onChange={e => onShowLines(e.target.checked)} />
        <span className="track" aria-hidden><span className="thumb" /></span>
        <span>{t("Line map")} {!linesReady && showLines && <span className="muted">· {t("loading…")}</span>}</span>
      </label>

      <div className={`status ${isError ? "err" : ""}`} role="status">{status}</div>

      {src && (
        <ul className="sources" aria-label={t("Data sources")}>
          {src.live.enabled && (
            <li className={src.live.areas ? (src.live.areas === src.live.totalAreas ? "ok" : "part") : ""}>
              <span>{t("Live positions")}</span>
              <span className="v">{t("{n}/{total} areas", { n: src.live.areas, total: src.live.totalAreas })}</span>
            </li>
          )}
          <li className={src.delays.ok ? "ok" : ""} title={t(src.delays.message)}>
            <span>{t("Timetable + delays")}</span>
            <span className="v">{src.delays.ok ? vehiclesText(src.delays.vehicles) : t("delays off")}</span>
          </li>
          <li className={src.timetable.ready ? "ok" : ""}>
            <span>{t("Timetable only")}</span>
            <span className="v">{src.timetable.ready ? vehiclesText(src.timetable.vehicles) : t("loading…")}</span>
          </li>
        </ul>
      )}
      <div className="lang-switch" role="radiogroup" aria-label={t("Language")}>
        <span className="lang-label">{t("Language")}</span>
        {LANGS.map(l => (
          <button key={l.key} type="button" role="radio" aria-checked={lang === l.key} className={lang === l.key ? "on" : ""}
            onClick={() => setLang(l.key)} lang={l.key} title={l.label}>{l.label}</button>
        ))}
      </div>
      </>}
    </aside>
  );
}
