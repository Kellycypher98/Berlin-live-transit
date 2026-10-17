import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { isRail, type Station } from "../../lib/api";
import { walkMin, type Me, type NearStation } from "../../lib/nearby";
import { t, useLang } from "../../i18n";

/** Your position (blue dot + accuracy ring) and a pulsing blip on each nearby station. */
export function NearbyLayer({ me, near, recenter, onSelect }: { me: Me | null; near: NearStation[]; recenter: number; onSelect: (s: Station) => void }) {
  const map = useMap();
  const { lang } = useLang();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const framed = useRef(false);

  // Frame you and your nearby stations once when found, and again on "back to me"
  useEffect(() => {
    if (!me) { framed.current = false; return; }
    if (framed.current && recenter === 0) return;
    const pts: L.LatLngExpression[] = [[me.lat, me.lng], ...near.slice(0, 4).map(n => [n.s.lat, n.s.lng] as [number, number])];
    const wide = window.innerWidth > 720;
    map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [wide ? 400 : 30, wide ? 40 : 280], paddingBottomRight: [50, 50], maxZoom: 16, duration: 0.8 });
    framed.current = true;
  }, [map, me != null, recenter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me) return;
    const group = L.layerGroup().addTo(map);
    near.forEach((n, k) => {
      const color = isRail(n.s) ? "#0065ae" : "#5b6875";
      L.marker([n.s.lat, n.s.lng], {
        icon: L.divIcon({
          className: "blip-wrap",
          html: `<span class="blip" style="--c:${color};--d:${k * 0.25}s"><i></i><i></i></span>`,
          iconSize: [0, 0],
        }),
        keyboard: false, zIndexOffset: 500,
      })
        .bindTooltip(`${n.s.name.replace(/[<>&"]/g, "")} · ${t("{n} min walk", { n: walkMin(n.d) })}`, { direction: "top", offset: [0, -10], className: "station-tip" })
        .on("click", () => onSelectRef.current(n.s))
        .addTo(group);
    });
    L.circle([me.lat, me.lng], { radius: Math.min(me.acc, 300), color: "#1a73e8", weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }).addTo(group);
    L.marker([me.lat, me.lng], {
      icon: L.divIcon({ className: "me-wrap", html: `<span class="me-dot"></span>`, iconSize: [0, 0] }),
      keyboard: false, interactive: false, zIndexOffset: 1500,
    }).addTo(group);
    return () => { group.remove(); };
  }, [map, me, near, lang]);

  return null;
}
