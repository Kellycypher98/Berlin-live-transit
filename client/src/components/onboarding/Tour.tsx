import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t, useLang } from "../../i18n";
import { ModeIcon } from "../icons/modeIcons";
import { PlaceIcon } from "../icons/PlaceIcon";
import logo from "../../assets/logo-128.png";
import { useInstall } from "../../hooks/useInstall";

const SEEN_KEY = "blt-tour-v1";

type Step = {
  /** CSS selector of the part of the page to highlight; none = a centred card. */
  target?: string;
  title: string;
  body: string;
  visual?: "modes" | "logo" | "track" | "install";
};

const STEPS: Step[] = [
  { title: "Welcome to Berlin Live Transit", body: "See every U-Bahn, S-Bahn, tram, bus and ferry in Berlin move on the map, live. Here's a 30-second tour.", visual: "logo" },
  { title: "The vehicles", body: "Each badge is a vehicle: U for U-Bahn, S for S-Bahn, plus tram, bus and ferry icons. The arrow shows where it's heading. Zoom in to see line numbers; tap a vehicle for its direction and delay.", visual: "modes" },
  { target: ".search-form", title: "Plan a journey", body: "Type any address, place or station, or use your location. Pick when you want to leave or arrive, and you'll get connections with walking directions." },
  { target: ".near-me-btn", title: "Stations near you", body: "One tap shows the closest stops with walking times. Tap a stop for its next departures." },
  { title: "Track your ride live", body: "In any connection, tap \"Track this journey live\". The map follows your vehicle and tells you when to board and when to get off.", visual: "track" },
  { target: ".panel", title: "Choose what you see", body: "Switch transport types and the line map on or off, and change the language here." },
  { title: "Add it to your home screen", body: "Open it like an app: full screen, one tap away.", visual: "install" },
];
export const INSTALL_STEP = STEPS.length - 1;

export function hasSeenTour() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: the tour may show again */ }
}

/** First-use walkthrough: highlights parts of the app one at a time. */
export function Tour({ open, onClose, startAt = 0 }: { open: boolean; onClose: () => void; startAt?: number }) {
  useLang();
  const install = useInstall();
  // Already running as an installed app: no install step
  const steps = install.installed ? STEPS.slice(0, INSTALL_STEP) : STEPS;
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const s = steps[Math.min(step, steps.length - 1)];

  useEffect(() => { if (open) setStep(Math.min(startAt, steps.length - 1)); }, [open, startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => { markSeen(); onClose(); }, [onClose]);
  const next = useCallback(() => (step < steps.length - 1 ? setStep(step + 1) : finish()), [step, steps.length, finish]);
  const back = () => setStep(Math.max(0, step - 1));

  // Find the highlighted element (and follow it on resize / scroll)
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = s.target ? document.querySelector(s.target) : null;
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? r : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, step, s.target]);

  // Place the card next to the highlight: below it if there's room, otherwise above; centred without one
  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const card = cardRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 12, gap = 12;
    if (!rect) { setCardPos({ left: (vw - card.width) / 2, top: Math.max(m, (vh - card.height) / 2) }); return; }
    let top = rect.bottom + gap;
    if (top + card.height > vh - m) top = rect.top - gap - card.height;
    if (top < m) top = Math.min(vh - card.height - m, Math.max(m, rect.top + 16)); // tall target: overlap it
    const left = Math.min(vw - card.width - m, Math.max(m, rect.left + rect.width / 2 - card.width / 2));
    setCardPos({ left, top });
  }, [open, rect, step]);

  // Keyboard: → next, ← back, Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) cardRef.current?.querySelector<HTMLButtonElement>(".tour-next")?.focus(); }, [open, step]);

  if (!open) return null;
  const pad = 6;
  const last = step === steps.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect
        ? <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-dim" />}
      <div className="tour-card" ref={cardRef} style={cardPos ? { left: cardPos.left, top: cardPos.top } : { visibility: "hidden" }}>
        {s.visual === "logo" && <img className="tour-logo" src={logo} alt="" width={44} height={44} />}
        {s.visual === "modes" && (
          <div className="tour-visual" aria-hidden>
            {(["subway", "suburban", "tram", "bus", "regional", "ferry"] as const).map(m => <ModeIcon key={m} mode={m} size={26} />)}
          </div>
        )}
        {s.visual === "track" && (
          <div className="tour-visual" aria-hidden>
            <span className="tour-track"><span className="live-pulse" /> {t("Track this journey live")}</span>
          </div>
        )}
        <h2 id="tour-title">{t(s.title)}</h2>
        <p>{t(s.body)}</p>
        {s.visual === "install" && <InstallHelp install={install} onDone={finish} />}
        {s.target === ".near-me-btn" && !rect && <p className="muted small"><PlaceIcon kind="location" size={12} /> {t("You'll find it in the search panel.")}</p>}
        <div className="tour-foot">
          <span className="tour-dots" aria-label={t("Step {n} of {total}", { n: step + 1, total: steps.length })}>
            {steps.map((_, k) => <span key={k} className={k === step ? "on" : ""} />)}
          </span>
          {step === 0
            ? <button className="btn sm tour-skip" onClick={finish}>{t("Skip")}</button>
            : <button className="btn sm" onClick={back}>{t("Back")}</button>}
          <button className="btn sm primary tour-next" onClick={next}>{last ? t("Got it") : step === 0 ? t("Show me") : t("Next")}</button>
        </div>
      </div>
    </div>
  );
}

/** How to add the app to the home screen on this device. */
function InstallHelp({ install, onDone }: { install: ReturnType<typeof useInstall>; onDone: () => void }) {
  if (install.canPrompt) {
    return (
      <button className="btn install-btn" onClick={async () => { if (await install.prompt()) onDone(); }}>
        <img src={logo} alt="" width={20} height={20} /> {t("Install app")}
      </button>
    );
  }
  if (install.isIOS) {
    return (
      <ol className="install-steps">
        <li>{t("Tap Share")} <ShareIcon /> {t("in the browser bar")}</li>
        <li>{t("Choose \"Add to Home Screen\"")} <AddIcon /></li>
      </ol>
    );
  }
  return <p className="muted small">{t("Open your browser menu (⋮ or ⋯) and choose \"Install app\" or \"Add to Home Screen\".")}</p>;
}

const ShareIcon = () => (
  <svg className="inline-icon" width="16" height="16" viewBox="0 0 24 24" aria-label="Share" role="img">
    <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const AddIcon = () => (
  <svg className="inline-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
