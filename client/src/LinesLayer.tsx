import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { MapLine } from "./api";
import { lineStyle } from "./lines";
import { modeOf, type ModeKey } from "./modes";

/** none: normal map · journey: a route is shown · focus: tracking, the rest nearly disappears */
export type Fade = "none" | "journey" | "focus";
type Props = { lines: MapLine[]; enabled: Set<ModeKey>; fade: Fade };

/** Line widths by mode; rail lines are bolder, trams thinner, regional lines thin and faded. */
function widthFor(product: string, zoom: number) {
  const boost = zoom >= 15 ? 1.5 : zoom >= 13 ? 1 : 0;
  if (product === "subway" || product === "suburban") return 3.5 + boost;
  if (product === "tram") return 2.2 + boost * 0.6;
  return 2;
}

/**
 * The network map under everything else: each line's track in its official colour,
 * with a thin white casing so crossing lines stay readable. Follows the mode toggles.
 */
export function LinesLayer({ lines, enabled, fade }: Props) {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane("lines")) map.createPane("lines").style.zIndex = "370";
    const renderer = L.canvas({ pane: "lines", padding: 0.5 });
    const group = L.layerGroup().addTo(map);

    const draw = () => {
      group.clearLayers();
      const z = map.getZoom();
      const opacity = fade === "focus" ? 0.08 : fade === "journey" ? 0.3 : 0.85;
      for (const l of lines) {
        const mode = modeOf(l.product);
        if (!mode || !enabled.has(mode)) continue;
        const w = widthFor(l.product, z);
        const color = lineStyle(l.line, l.product).background;
        const common = { renderer, pane: "lines", interactive: false, lineCap: "round" as const, lineJoin: "round" as const };
        for (const path of l.paths) {
          L.polyline(path, { ...common, color: "#ffffff", weight: w + 2, opacity: opacity * 0.9 }).addTo(group);
          L.polyline(path, { ...common, color, weight: w, opacity, dashArray: l.product === "regional" ? "6 4" : undefined }).addTo(group);
        }
      }
    };
    draw();
    map.on("zoomend", draw);
    return () => { map.off("zoomend", draw); group.remove(); };
  }, [map, lines, enabled, fade]);

  return null;
}
