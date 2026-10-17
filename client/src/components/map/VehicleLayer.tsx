import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Vehicle } from "../../lib/types";
import { colorOf, modeOf, type ModeKey } from "../../lib/modes";
import { drawBadge, roundRect } from "../icons/modeIcons";
import { lineStyle } from "../../lib/lines";
import { t } from "../../i18n";

type Tracked = {
  v: Vehicle;
  mode: ModeKey | null;
  from: L.LatLng; to: L.LatLng; t0: number;
  pos: L.LatLng;            // current animated position
  heading: number | null;   // radians, screen space (0 = east); null until it has moved
  px?: L.Point;             // last drawn container point (for hit-testing)
  r?: number;               // last drawn hit radius
};

type Props = { vehicles: Vehicle[]; interval: number; enabled: Set<ModeKey>; dimmed?: boolean };

// Rail drawn last, so it sits on top of buses
const PRIORITY: Record<string, number> = { bus: 0, ferry: 1, tram: 2, regional: 3, suburban: 4, subway: 5 };

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const SOURCE_LABEL = { live: "live position", delays: "timetable + delay", timetable: "timetable" } as const;

/** "U2 → Ruhleben · +3 min" + source */
function tooltip(v: Vehicle) {
  let when = "";
  if (v.delay !== null) {
    const min = Math.round(v.delay / 60);
    when = min > 0 ? ` · <span class="tt-late">${t("+{n} min", { n: min })}</span>`
      : min < 0 ? ` · <span class="tt-ok">${t("{n} min", { n: min })}</span>`
      : ` · <span class="tt-ok">${t("on time")}</span>`;
  }
  return `${escape(v.line)} → ${escape(v.dir)}${when}<br><span class="tt-muted">${t(SOURCE_LABEL[v.source] ?? "")}</span>`;
}

/**
 * All vehicles are drawn on one canvas (thousands of DOM icons would be slow):
 *   zoom < 12  small coloured dots
 *   zoom 12–14 mode badges (U, S, tram, bus …) with a direction arrow
 *   zoom ≥ 15  line labels in the line's colour ("U2", "M10") with the mode badge
 * Hover / tap finds the nearest vehicle and shows a tooltip.
 */
export function VehicleLayer({ vehicles, interval, enabled, dimmed = false }: Props) {
  const map = useMap();
  const tracked = useRef(new Map<string, Tracked>());
  const order = useRef<Tracked[]>([]);
  const enabledRef = useRef(enabled);
  const intervalRef = useRef(interval);
  enabledRef.current = enabled;
  intervalRef.current = interval;
  const dimRef = useRef(dimmed);
  dimRef.current = dimmed; // while tracking, other vehicles fade into the background

  // Merge each new snapshot
  useEffect(() => {
    const now = performance.now();
    const seen = new Set<string>();
    for (const v of vehicles) {
      seen.add(v.id);
      const to = L.latLng(v.lat, v.lng);
      const t = tracked.current.get(v.id);
      if (t) {
        t.from = t.pos; t.to = to; t.t0 = now; t.v = v;
        if (v.h != null) t.heading = trackHeading(v.h);
        else {
          const a = map.project(t.from, 16), b = map.project(to, 16);
          if (a.distanceTo(b) > 3) t.heading = Math.atan2(b.y - a.y, b.x - a.x);
        }
      } else {
        tracked.current.set(v.id, { v, mode: modeOf(v.product), from: to, to, t0: now, pos: to, heading: v.h != null ? trackHeading(v.h) : null });
      }
    }
    for (const id of tracked.current.keys()) if (!seen.has(id)) tracked.current.delete(id);
    order.current = [...tracked.current.values()].sort((a, b) => (PRIORITY[a.v.product] ?? 0) - (PRIORITY[b.v.product] ?? 0));
  }, [vehicles, map]);

  useEffect(() => {
    // Canvas in its own pane, kept aligned with the viewport while the map pans
    if (!map.getPane("vehicles")) map.createPane("vehicles").style.zIndex = "400";
    const pane = map.getPane("vehicles")!;
    const canvas = L.DomUtil.create("canvas", "vehicle-canvas", pane) as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    const ctx = canvas.getContext("2d")!;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tip = L.tooltip({ direction: "top", offset: [0, -12], className: "vehicle-tip" });
    let hovered: Tracked | null = null;
    let zooming = false;
    let raf = 0;

    const resize = () => {
      const size = map.getSize(), dpr = window.devicePixelRatio || 1;
      canvas.width = size.x * dpr; canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
    };
    resize();

    const pillCache = new Map<string, number>(); // label width cache
    // Measured widths are wrong until Manrope has loaded; measure again once it has
    document.fonts?.ready.then(() => pillCache.clear());
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (zooming) return;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);
      const z = map.getZoom();
      const style = z < 12 ? "dot" : z < 15 ? "badge" : "label";
      const badge = z < 13 ? 15 : 18;
      const margin = 40;

      for (const t of order.current) {
        // animate between updates
        const k = reduceMotion ? 1 : Math.min(1, (now - t.t0) / intervalRef.current);
        t.pos = k >= 1 ? t.to : L.latLng(t.from.lat + (t.to.lat - t.from.lat) * k, t.from.lng + (t.to.lng - t.from.lng) * k);
        t.px = undefined;
        if (!t.mode || !enabledRef.current.has(t.mode)) continue;
        const p = map.latLngToContainerPoint(t.pos);
        if (p.x < -margin || p.y < -margin || p.x > size.x + margin || p.y > size.y + margin) continue;
        t.px = p;
        ctx.globalAlpha = (t.v.source === "live" ? 1 : 0.78) * (dimRef.current ? 0.12 : 1);

        if (style === "dot") {
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = colorOf(t.v.product); ctx.fill();
          ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke();
          t.r = 6;
          continue;
        }

        if (style === "badge") {
          const s = badge, x = p.x - s / 2, y = p.y - s / 2;
          drawArrow(ctx, p.x, p.y, s / 2 + 2, t.heading, colorOf(t.v.product));
          ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 2;
          drawBadge(ctx, t.mode, x, y, s);
          ctx.shadowBlur = 0;
          t.r = s / 2 + 3;
          continue;
        }

        // label: [badge][ line ]
        const label = t.v.line || "?";
        const ls = lineStyle(label, t.v.product);
        ctx.font = "700 12px 'Manrope Variable', Manrope, system-ui, sans-serif";
        let w = pillCache.get(label);
        if (w === undefined) { w = ctx.measureText(label).width; pillCache.set(label, w); }
        const s = 18, padR = 6, gap = 4, h = s;
        const total = s + gap + w + padR;
        const x = p.x - s / 2, y = p.y - h / 2; // badge centred on the vehicle, label to its right
        ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 3;
        roundRect(ctx, x, y, total, h, 4); ctx.fillStyle = ls.background; ctx.fill();
        ctx.shadowBlur = 0;
        drawBadge(ctx, t.mode, x, y, s);
        ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1;
        roundRect(ctx, x, y, total, h, 4); ctx.stroke();
        ctx.fillStyle = ls.color; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, x + s + gap, y + h / 2 + 0.5);
        // Arrow on top, so the label never hides it
        drawArrow(ctx, p.x, p.y, s / 2 + 2, t.heading, ls.background);
        t.r = 12;
      }
      ctx.globalAlpha = 1;
      if (hovered?.px) tip.setLatLng(hovered.pos);
    };
    raf = requestAnimationFrame(draw);

    // Hit-testing: nearest drawn vehicle under the pointer
    const pick = (cp: L.Point): Tracked | null => {
      let best: Tracked | null = null, bestD = Infinity;
      for (const t of order.current) {
        if (!t.px || !t.r) continue;
        const d = t.px.distanceTo(cp);
        if (d <= t.r && d < bestD) { best = t; bestD = d; }
      }
      return best;
    };
    const show = (t: Tracked | null) => {
      hovered = t;
      map.getContainer().style.cursor = t ? "pointer" : "";
      if (t) { tip.setContent(tooltip(t.v)).setLatLng(t.pos); if (!map.hasLayer(tip)) tip.addTo(map); }
      else if (map.hasLayer(tip)) tip.remove();
    };
    const onMove = (e: L.LeafletMouseEvent) => show(pick(e.containerPoint));
    const onClick = (e: L.LeafletMouseEvent) => { const t = pick(e.containerPoint); if (t) show(t); };
    const onZoomStart = () => { zooming = true; canvas.style.visibility = "hidden"; };
    const onZoomEnd = () => { zooming = false; canvas.style.visibility = ""; };

    map.on("mousemove", onMove);
    map.on("click", onClick);
    const onOut = () => show(null);
    map.on("mouseout", onOut);
    map.on("resize", resize);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    return () => {
      cancelAnimationFrame(raf);
      map.off("mousemove", onMove); map.off("click", onClick); map.off("resize", resize); map.off("mouseout", onOut);
      map.off("zoomstart", onZoomStart); map.off("zoomend", onZoomEnd);
      tip.remove(); canvas.remove();
    };
  }, [map]);

  return null;
}

/** Compass degrees (0 = north, clockwise) -> screen angle in radians (0 = east, y down). */
const trackHeading = (deg: number) => ((deg - 90) * Math.PI) / 180;

/** Small triangle just outside the badge, pointing where the vehicle is heading. */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, heading: number | null, color: string) {
  if (heading === null) return;
  const tipR = r + 6;
  const ax = x + Math.cos(heading) * tipR, ay = y + Math.sin(heading) * tipR;
  const left = heading + 2.5, right = heading - 2.5;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + Math.cos(left) * 7, ay + Math.sin(left) * 7);
  ctx.lineTo(ax + Math.cos(right) * 7, ay + Math.sin(right) * 7);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke();
}
