import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/** Map button under the zoom control: find me / jump back to me. */
export function LocateButton({ on, locating, onClick }: { on: boolean; locating: boolean; onClick: () => void }) {
  const map = useMap();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const ctl = new L.Control({ position: "topright" });
    ctl.onAdd = () => {
      const el = L.DomUtil.create("div", "leaflet-bar locate-ctl");
      L.DomEvent.disableClickPropagation(el);
      return el;
    };
    ctl.addTo(map);
    setHost(ctl.getContainer() ?? null);
    return () => { ctl.remove(); };
  }, [map]);
  useEffect(() => {
    if (!host) return;
    host.innerHTML = "";
    const b = L.DomUtil.create("a", `locate-btn ${on ? "on" : ""} ${locating ? "busy" : ""}`, host) as HTMLAnchorElement;
    b.href = "#"; b.role = "button";
    b.title = "Back to my location";
    b.setAttribute("aria-label", b.title);
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5"/></svg>`;
    L.DomEvent.on(b, "click", e => { L.DomEvent.preventDefault(e); onClick(); });
  }, [host, on, locating, onClick]);
  return null;
}
