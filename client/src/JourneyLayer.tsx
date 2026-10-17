import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Journey } from "./api";
import { lineStyle } from "./lines";

/** Draws the selected journey: coloured lines per ride, dashed grey for walks. Fits the map to it. */
export function JourneyLayer({ journey, activeLeg = null, fit = true }: { journey: Journey | null; activeLeg?: number | null; fit?: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!journey) return;
    if (!map.getPane("route")) {
      const pane = map.createPane("route");
      pane.style.zIndex = "380"; // below stations and vehicles
    }
    const group = L.featureGroup().addTo(map);
    journey.legs.forEach((leg, k) => {
      const pts = leg.path.filter(p => p[0] != null && p[1] != null);
      if (pts.length < 2) return;
      // While tracking, the ride being tracked is bold and the others are quieter
      const quiet = activeLeg != null && k !== activeLeg;
      if (leg.mode === "walk") {
        L.polyline(pts, { pane: "route", color: "#5b6875", weight: 4, dashArray: "2 8", lineCap: "round" }).addTo(group);
      } else {
        const color = lineStyle(leg.line, leg.product).background;
        L.polyline(pts, { pane: "route", color: "#ffffff", weight: quiet ? 7 : 12, opacity: 0.9 }).addTo(group); // halo
        L.polyline(pts, { pane: "route", color, weight: quiet ? 4 : 7, opacity: quiet ? 0.55 : 1 }).addTo(group);
        for (const s of leg.stops) {
          L.circleMarker([s.lat, s.lng], { pane: "route", radius: 3, color, weight: 2, fillColor: "#fff", fillOpacity: 1 })
            .bindTooltip(s.name, { direction: "top", className: "station-tip" }).addTo(group);
        }
      }
    });
    const b = group.getBounds();
    if (fit && b.isValid()) {
      // Leave room for the search panel on wide screens
      const wide = window.innerWidth > 720;
      map.fitBounds(b, { paddingTopLeft: [wide ? 400 : 20, wide ? 40 : 260], paddingBottomRight: [40, 40], maxZoom: 15 });
    }
    return () => { group.remove(); };
  }, [map, journey, activeLeg, fit]);

  return null;
}

/** Pans to a station when it's picked from search or the map. */
export function FlyTo({ target }: { target: { lat: number; lng: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, target?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
