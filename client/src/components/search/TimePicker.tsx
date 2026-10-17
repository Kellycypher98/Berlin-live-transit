export type TimeMode = "now" | "depart" | "arrive";
export type TimeChoice = { mode: TimeMode; date: string; time: string }; // date YYYY-MM-DD, time HH:MM (Berlin)

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Now, rounded up to the next 5 minutes. */
export function defaultChoice(mode: TimeMode = "now"): TimeChoice {
  const d = new Date(Date.now() + 5 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return { mode, date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** The chosen moment as an ISO string, or null for "now". Uses the device's time zone (Berlin for local users). */
export function choiceToIso(c: TimeChoice): string | null {
  if (c.mode === "now") return null;
  const d = new Date(`${c.date}T${c.time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const MODES: { key: TimeMode; label: string }[] = [
  { key: "now", label: "Leave now" },
  { key: "depart", label: "Depart at" },
  { key: "arrive", label: "Arrive by" },
];

export function TimePicker({ value, onChange }: { value: TimeChoice; onChange: (c: TimeChoice) => void }) {
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  const max = ymd(new Date(Date.now() + 60 * 86400000));
  return (
    <div className="time-picker">
      <div className="seg" role="radiogroup" aria-label="When">
        {MODES.map(m => (
          <button
            key={m.key} type="button" role="radio" aria-checked={value.mode === m.key}
            className={value.mode === m.key ? "on" : ""}
            onClick={() => onChange(m.key === "now" ? { ...value, mode: "now" } : { ...(value.mode === "now" ? defaultChoice() : value), mode: m.key })}
          >{m.label}</button>
        ))}
      </div>
      {value.mode !== "now" && (
        <div className="when-row">
          <div className="day-chips">
            <button type="button" className={value.date === today ? "on" : ""} onClick={() => onChange({ ...value, date: today })}>Today</button>
            <button type="button" className={value.date === tomorrow ? "on" : ""} onClick={() => onChange({ ...value, date: tomorrow })}>Tomorrow</button>
          </div>
          <input id="when-date" type="date" aria-label="Date" value={value.date} min={today} max={max}
            onChange={e => e.target.value && onChange({ ...value, date: e.target.value })} />
          <input id="when-time" type="time" aria-label="Time" step={300} value={value.time}
            onChange={e => e.target.value && onChange({ ...value, time: e.target.value })} />
        </div>
      )}
    </div>
  );
}
