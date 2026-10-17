import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchPlaces, stationPlace, type Place, type PlaceResult } from "../../lib/api";
import { searchStations, type Indexed } from "../../lib/search";
import { lineStyle } from "../../lib/lines";
import { PlaceGlyph, PlaceIcon } from "../icons/PlaceIcon";
import { t } from "../../i18n";

type Props = {
  id: string;
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  searchIndex: Indexed[];
  disabled?: boolean;
  trailing?: React.ReactNode;
};

type Option = { key: string; place: Place };

/**
 * Search field for any place: stations (instant, from our own list) plus addresses and points of
 * interest (from the server, after a short pause in typing). ↑ ↓ to move, Enter to pick, Esc to close.
 */
export function PlaceInput({ id, label, placeholder, value, onChange, searchIndex, disabled, trailing }: Props) {
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<PlaceResult | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // The blur handler runs after a short delay; read the latest value from a ref, not a stale closure
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => { setText(value?.name ?? ""); }, [value]);

  // Addresses and places: ask the server 300 ms after typing stops
  const typed = open && text.trim().length >= 3 && text !== value?.name ? text.trim() : "";
  useEffect(() => {
    setRemote(null);
    if (!typed) { setRemoteLoading(false); return; }
    const ctrl = new AbortController();
    setRemoteLoading(true);
    const timer = setTimeout(() => {
      fetchPlaces(typed, ctrl.signal)
        .then(r => { if (!ctrl.signal.aborted) setRemote(r); })
        .catch(() => { if (!ctrl.signal.aborted) setRemote({ source: "none", places: [], note: t("Address search is unavailable right now.") }); })
        .finally(() => { if (!ctrl.signal.aborted) setRemoteLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [typed]);

  const stations = useMemo(() => (open ? searchStations(searchIndex, text, 5) : []), [open, text, searchIndex]);
  const options: Option[] = useMemo(() => [
    ...stations.map(s => ({ key: `s${s.i}`, place: stationPlace(s) })),
    ...(remote?.places ?? []).map((p, k) => ({ key: `p${k}`, place: { ...p } as Place })),
  ], [stations, remote]);
  useEffect(() => setActive(0), [text, options.length]);

  const pick = (p: Place) => { valueRef.current = p; onChange(p); setText(p.name); setOpen(false); inputRef.current?.blur(); };
  const nStations = stations.length;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row">
        <span className="field-glyph" aria-hidden>{value ? <PlaceGlyph place={value} size={16} /> : null}</span>
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          className={value ? "has-glyph" : ""}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          onFocus={e => { setOpen(true); e.currentTarget.select(); }}
          onBlur={() => setTimeout(() => { setOpen(false); setText(valueRef.current?.name ?? ""); }, 150)}
          onChange={e => { setText(e.target.value); setOpen(true); if (!e.target.value) { valueRef.current = null; onChange(null); } }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && options[active]) { e.preventDefault(); pick(options[active].place); }
            else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
          }}
        />
        {trailing}
      </div>
      {open && text.trim().length > 1 && text !== value?.name && (
        <div className="suggestions" id={listId} role="listbox">
          {options.map((o, k) => (
            <div key={o.key}>
              {k === 0 && nStations > 0 && <div className="sg-head">{t("Stations")}</div>}
              {k === nStations && <div className="sg-head">{t("Addresses & places")}</div>}
              <div
                id={`${listId}-${k}`}
                role="option"
                aria-selected={k === active}
                className="sg-item"
                onMouseDown={e => { e.preventDefault(); pick(o.place); }}
                onMouseEnter={() => setActive(k)}
              >
                <span className="sg-glyph"><PlaceGlyph place={o.place} size={16} /></span>
                <span className="sg-text">
                  <span className="sg-name">{o.place.name}</span>
                  {o.place.detail && <span className="sg-detail">{o.place.detail}</span>}
                </span>
                {o.place.kind === "station" && (
                  <span className="sg-lines">
                    {(o.place.lines ?? []).slice(0, 4).map(l => <span key={l} className="chip sm" style={lineStyle(l)}>{l}</span>)}
                    {(o.place.lines?.length ?? 0) > 4 && <span className="more">+{(o.place.lines?.length ?? 0) - 4}</span>}
                  </span>
                )}
              </div>
            </div>
          ))}
          {nStations === options.length && typed && (
            <div className="sg-note">
              {remoteLoading ? <><span className="mini-spin" aria-hidden /> {t("Looking up addresses…")}</>
                : remote?.note ? t(remote.note)
                : remote && !remote.places.length ? t("No addresses found.") : null}
            </div>
          )}
          {!options.length && !typed && <div className="sg-note">{t("No station matches \"{text}\". Type 3+ letters to search addresses.", { text: text.trim() })}</div>}
          {remote?.source === "osm" && remote.places.length > 0 && <div className="sg-note small"><PlaceIcon kind="address" size={11} /> {t("Addresses from OpenStreetMap")}</div>}
        </div>
      )}
    </div>
  );
}
