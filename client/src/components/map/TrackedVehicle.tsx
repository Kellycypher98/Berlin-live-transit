import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { TrackState } from "../../lib/api";
import { lineStyle } from "../../lib/lines";
import { BADGES, modeColor } from "../icons/modeIcons";
import { modeOf } from "../../lib/modes";

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Big highlighted marker for the tracked vehicle; glides between updates and keeps the map on it while following. */
export function TrackedVehicle({ data, follow, onUnfollow }: { data: TrackState | null; follow: boolean; onUnfollow: () => void }) {
  const map = useMap();
  const marker = useRef<L.Marker | null>(null);
  const anim = useRef<{ from: L.LatLng; to: L.LatLng; t0: number } | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // Stop following when the user drags the map
  useEffect(() => {
    const onDrag = () => { if (followRef.current) onUnfollow(); };
    map.on("dragstart", onDrag);
    return () => { map.off("dragstart", onDrag); };
  }, [map, onUnfollow]);

  useEffect(() => {
    if (!data || data.lat == null) { marker.current?.remove(); marker.current = null; return; }
    if (!map.getPane("tracked")) map.createPane("tracked").style.zIndex = "640";
    const mode = modeOf(data.product) ?? "bus";
    const ls = lineStyle(data.line, data.product);
    const b = BADGES[mode];
    const badge = b.text
      ? `<span class="tv-badge ${b.shape}" style="background:${modeColor(mode)}">${b.text}</span>`
      : `<span class="tv-badge ${b.shape}" style="background:${modeColor(mode)}"><svg viewBox="0 0 24 24" width="16" height="16"><path d="${b.path}" fill="#fff" fill-rule="evenodd"/></svg></span>`;
    const arrow = data.heading != null ? `<span class="tv-arrow" style="transform:rotate(${data.heading}deg)"></span>` : "";
    const html = `<div class="tv ${data.source}">${arrow}<span class="tv-ring" style="border-color:${ls.background}"></span><span class="tv-pill" style="background:${ls.background};color:${ls.color}">${badge}<b>${esc(data.line)}</b></span></div>`;
    const icon = L.divIcon({ className: "tv-wrap", html, iconSize: [0, 0] });
    const to = L.latLng(data.lat, data.lng);
    if (!marker.current) {
      marker.current = L.marker(to, { icon, pane: "tracked", interactive: false, keyboard: false }).addTo(map);
      map.setView(to, Math.max(map.getZoom(), 15), { animate: true });
    } else {
      marker.current.setIcon(icon);
      anim.current = { from: marker.current.getLatLng(), to, t0: performance.now() };
    }
    if (followRef.current) map.panTo(to, { animate: true, duration: 1 });
  }, [map, data]);

  // Glide the marker over 4 s towards each new position
  useEffect(() => {
    let raf = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = (now: number) => {
      const a = anim.current;
      if (a && marker.current) {
        const k = reduce ? 1 : Math.min(1, (now - a.t0) / 4000);
        marker.current.setLatLng([a.from.lat + (a.to.lat - a.from.lat) * k, a.from.lng + (a.to.lng - a.from.lng) * k]);
        if (k >= 1) anim.current = null;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => { marker.current?.remove(); marker.current = null; }, []);

  // When following is switched back on, jump to the vehicle
  useEffect(() => {
    if (follow && marker.current) map.panTo(marker.current.getLatLng(), { animate: true });
  }, [follow, map]);

  return null;
}
