import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { P, isRail, type Station } from "../../lib/api";

type Props = {
  stations: Station[];
  highlight: number[];            // station indexes to emphasise (from / to / selected)
  onSelect: (s: Station) => void;
  faded?: boolean;                // tracking: fade every station except the highlighted ones
};

/** Minimum zoom at which a station is drawn: rail first, then tram, then bus. */
function minZoom(s: Station) {
  if (isRail(s)) return 12;
  if (s.p & P.tram) return 14;
  return 15;
}

/**
 * Station dots in their own SVG pane above the vehicle canvas. SVG lets clicks on empty map
 * fall through to the vehicles below (a canvas on top would swallow them). Only stations in
 * view and allowed at the current zoom are drawn, so thousands of stops stay fast.
 */
export function StationsLayer({ stations, highlight, onSelect, faded = false }: Props) {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map.getPane("stations")) {
      const pane = map.createPane("stations");
      pane.style.zIndex = "410"; // above the vehicle canvas (overlay pane = 400)
    }
    const renderer = L.svg({ pane: "stations", padding: 0.3 });
    const group = L.layerGroup().addTo(map);
    const hl = new Set(highlight);

    const draw = () => {
      group.clearLayers();
      const z = map.getZoom();
      const view = map.getBounds().pad(0.2);
      for (const s of stations) {
        const isHl = hl.has(s.i);
        if (!isHl && z < minZoom(s)) continue;
        if (!view.contains([s.lat, s.lng])) continue;
        const rail = isRail(s);
        const m = L.circleMarker([s.lat, s.lng], {
          renderer, pane: "stations",
          radius: isHl ? 8 : rail ? (z >= 15 ? 5.5 : 4) : 3,
          weight: isHl ? 3 : rail ? 2 : 1.5,
          color: isHl ? "#16202b" : "#3d4a57",
          fillColor: "#ffffff", fillOpacity: 1,
          // While tracking, only your start / destination stay strong; the rest fades back
          opacity: faded && !isHl ? 0.15 : 1,
        });
        if (faded && !isHl) m.setStyle({ fillOpacity: 0.15 });
        m.bindTooltip(s.name, { direction: "top", offset: [0, -6], className: "station-tip" });
        m.on("click", () => onSelectRef.current(s));
        group.addLayer(m);
      }
    };
    draw();
    map.on("moveend zoomend", draw);
    return () => { map.off("moveend zoomend", draw); group.remove(); };
  }, [map, stations, highlight.join(","), faded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
