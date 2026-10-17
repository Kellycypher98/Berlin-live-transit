import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { fetchReverse, type Place } from "../../lib/api";

/** Right-click (long-press on phones) anywhere on the map: "Route from here" / "Route to here". */
export function MapPicker({ onPick }: { onPick: (end: "from" | "to", p: Place) => void }) {
  const map = useMap();
  useEffect(() => {
    const open = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const box = L.DomUtil.create("div", "pick-popup");
      const title = L.DomUtil.create("div", "pick-title", box);
      title.textContent = "This spot";
      const make = (label: string, end: "from" | "to") => {
        const b = L.DomUtil.create("button", "btn sm", box) as HTMLButtonElement;
        b.type = "button"; b.textContent = label;
        L.DomEvent.on(b, "click", ev => {
          L.DomEvent.stop(ev);
          map.closePopup();
          const place: Place = { kind: "location", name: "Dropped pin", lat, lng };
          onPick(end, place);
          fetchReverse(lat, lng).then(r => { if (r.name) onPick(end, { ...place, kind: "address", name: r.name, detail: r.detail ?? null }); }).catch(() => {});
        });
      };
      make("Route from here", "from");
      make("Route to here", "to");
      fetchReverse(lat, lng).then(r => { if (r.name) title.textContent = r.name; }).catch(() => {});
      L.popup({ closeButton: true, autoPan: true, className: "pick" }).setLatLng(e.latlng).setContent(box).openOn(map);
    };
    map.on("contextmenu", open);
    return () => { map.off("contextmenu", open); };
  }, [map, onPick]);
  return null;
}

/** Start and destination pins for addresses and map points (stations are highlighted on the station layer). */
export function PlacePins({ from, to }: { from: Place | null; to: Place | null }) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const pin = (p: Place, cls: string, label: string) => L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: "place-pin-wrap", html: `<span class="place-pin ${cls}" aria-label="${label}"></span>`, iconSize: [0, 0] }),
      keyboard: false, zIndexOffset: 1000,
    }).bindTooltip(`${label}: ${p.name.replace(/[<>&"]/g, "")}`, { direction: "top", offset: [0, -26] }).addTo(group);
    if (from && from.station == null) pin(from, "start", "Start");
    if (to && to.station == null) pin(to, "end", "Destination");
    return () => { group.remove(); };
  }, [map, from, to]);
  return null;
}

/** Tracking focus: marks the map so the street map can step back (react-leaflet won't update className later). */
export function FocusMode({ on }: { on: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().classList.toggle("focus", on);
  }, [map, on]);
  return null;
}
