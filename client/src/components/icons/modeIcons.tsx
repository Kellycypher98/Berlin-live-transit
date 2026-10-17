// Transport-mode badges, shared by the map (canvas) and the UI (inline SVG).
// U and S follow Berlin's station signage (blue square U, green circle S);
// tram, bus, regional train and ferry use simple pictograms drawn for this app.

import { MODES, modeOf, type ModeKey } from "../../lib/modes";

type Badge = { shape: "square" | "circle"; text?: string; path?: string };

// 24×24 pictograms, filled white with the even-odd rule (inner shapes become cut-outs)
// Tram: front view with a pantograph on the roof and rails under the wheels
const TRAM = "M7.6 1.2h8.8L12.9 4.9h-1.8z M11.4 4.6h1.2v1.3h-1.2z M7.6 5.6h8.8A2.6 2.6 0 0 1 19 8.2v8.2a2.6 2.6 0 0 1-2.6 2.6H7.6A2.6 2.6 0 0 1 5 16.4V8.2a2.6 2.6 0 0 1 2.6-2.6z M7 8.1v4.6h10V8.1z M8.6 14.4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z M15.4 14.4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z M7.4 19.6h2.1l-1.3 2.9H6.1z M14.5 19.6h2.1l1.3 2.9h-2.1z";
// Bus: side view with a row of windows and two wheels
const BUS = "M5.2 4h13.6A2.2 2.2 0 0 1 21 6.2v9.7a1.6 1.6 0 0 1-1.6 1.6h-.4a2.6 2.6 0 0 0-5.2 0H9.8a2.6 2.6 0 0 0-5.2 0h-.1A1.5 1.5 0 0 1 3 16V6.2A2.2 2.2 0 0 1 5.2 4z M5 6.3v4.6h3.1V6.3z M9.4 6.3v4.6h3.1V6.3z M13.8 6.3v4.6h3.1V6.3z M18.2 6.3v6.4h1.1V6.3z M7.2 15.9a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z M16.4 15.9a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z";
const FERRY = "M11 2.5h2V5h3.6l1 4.6 2.6 1.1-2 6.1c-.9.3-1.8.1-2.7-.5-1.3 1-2.9 1-4.2 0-1.3 1-2.9 1-4.2 0-.9.6-1.8.8-2.7.5l-2-6.1 2.6-1.1 1-4.6H11z M7.6 7l-.5 2.4h9.8L16.4 7z M2.5 20.2c1.6.7 3.2.7 4.8 0 1.6.7 3.2.7 4.7 0 1.6.7 3.2.7 4.8 0 1.6.7 3.2.7 4.7 0v1.9c-1.6.7-3.1.7-4.7 0-1.6.7-3.2.7-4.8 0-1.5.7-3.1.7-4.7 0-1.6.7-3.2.7-4.8 0z";

export const BADGES: Record<ModeKey, Badge> = {
  subway: { shape: "square", text: "U" },
  suburban: { shape: "circle", text: "S" },
  tram: { shape: "square", path: TRAM },
  bus: { shape: "square", path: BUS },
  regional: { shape: "square", text: "RE" },
  ferry: { shape: "circle", path: FERRY },
};

export const modeColor = (m: ModeKey) => MODES.find(x => x.key === m)!.color;

/** Inline SVG badge for the UI. */
export function ModeIcon({ mode, size = 18, title }: { mode: ModeKey | string; size?: number; title?: string }) {
  const key = (modeOf(mode as string) ?? (mode as ModeKey)) as ModeKey;
  const b = BADGES[key];
  if (!b) return null;
  const color = modeColor(key);
  return (
    <svg className="mode-icon" width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined}
      aria-label={title} aria-hidden={title ? undefined : true}>
      {b.shape === "circle"
        ? <circle cx="12" cy="12" r="12" fill={color} />
        : <rect width="24" height="24" rx="4.5" fill={color} />}
      {b.text && (
        <text x="12" y={b.text.length > 1 ? 16.4 : 17.6} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700"
          fontSize={b.text.length > 1 ? 12 : 17} letterSpacing={b.text.length > 1 ? -0.5 : 0} fill="#fff">{b.text}</text>
      )}
      {b.path && <path d={b.path} fill="#fff" fillRule="evenodd" transform="translate(3.6 3.6) scale(.7)" />}
    </svg>
  );
}

// ---------- canvas drawing (map) ----------

const pathCache = new Map<string, Path2D>();
const path2d = (d: string) => { let p = pathCache.get(d); if (!p) pathCache.set(d, (p = new Path2D(d))); return p; };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Draws the mode badge (shape + glyph) with its top-left at (x, y). */
export function drawBadge(ctx: CanvasRenderingContext2D, mode: ModeKey, x: number, y: number, size: number, color = modeColor(mode)) {
  const b = BADGES[mode];
  ctx.fillStyle = color;
  if (b.shape === "circle") { ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); }
  else roundRect(ctx, x, y, size, size, size * 0.19);
  ctx.fill();
  ctx.fillStyle = "#fff";
  if (b.text) {
    ctx.font = `700 ${Math.round(size * (b.text.length > 1 ? 0.5 : 0.72))}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b.text, x + size / 2, y + size / 2 + size * 0.04);
  }
  if (b.path) {
    ctx.save();
    const s = (size / 24) * 0.7, o = size * 0.15;
    ctx.translate(x + o, y + o); ctx.scale(s, s);
    ctx.fill(path2d(b.path), "evenodd");
    ctx.restore();
  }
}

export { roundRect };
