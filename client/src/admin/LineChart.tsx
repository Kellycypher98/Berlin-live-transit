import { useEffect, useMemo, useRef, useState } from "react";

export type Series = { key: string; label: string; color: string; values: number[] };

type Props = { times: number[]; series: Series[]; height?: number; format?: (n: number) => string; label: string };

const hhmm = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const PAD = { top: 10, right: 92, bottom: 24, left: 44 };

function niceMax(v: number) {
  if (v <= 20) return Math.max(4, Math.ceil(v / 4) * 4); // whole-number ticks for small counts
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Small SVG line chart: one y-axis from zero, legend + end labels, crosshair tooltip on hover. */
export function LineChart({ times, series, height = 190, format = n => n.toLocaleString("de-DE"), label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = times.length;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const iw = width - PAD.left - PAD.right, ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;

  const paths = useMemo(() => series.map(s => s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")),
    [series, width, max, n]); // eslint-disable-line react-hooks/exhaustive-deps

  // End labels, pushed apart so they never overlap
  const ends = series.map(s => ({ s, y: y(s.values.at(-1) ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;

  // As many time labels as fit (about one per 90 px), always the first and last
  const nTicks = Math.max(2, Math.min(5, Math.floor(iw / 90) + 1));
  const xTicks = n > 1 ? Array.from({ length: nTicks }, (_, k) => Math.round((k / (nTicks - 1)) * (n - 1))) : [];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (n < 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.left) / iw) * (n - 1)))));
  };

  return (
    <div className="chart" ref={box}>
      {series.length > 1 && (
        <ul className="legend">
          {series.map(s => <li key={s.key}><span className="key" style={{ background: s.color }} />{s.label}</li>)}
        </ul>
      )}
      {n === 0 ? <p className="muted small chart-empty">Collecting data… (one point every 10 s)</p> : (
        <svg width={width} height={height} role="img" aria-label={label}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <g key={f}>
              <line className="grid" x1={PAD.left} x2={PAD.left + iw} y1={y(max * f)} y2={y(max * f)} />
              <text className="tick" x={PAD.left - 6} y={y(max * f)} textAnchor="end" dominantBaseline="middle">{format(max * f)}</text>
            </g>
          ))}
          {xTicks.map(i => (
            <text key={i} className="tick" x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {hhmm.format(times[i])}
            </text>
          ))}
          {series.map((s, k) => <path key={s.key} d={paths[k]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {ends.map(({ s, y: ly }) => (
            <g key={s.key}>
              <circle cx={x(n - 1)} cy={y(s.values.at(-1) ?? 0)} r={3.5} fill={s.color} className="end-dot" />
              <text className="end-label" x={x(n - 1) + 8} y={ly} dominantBaseline="middle">
                <tspan className="v">{format(s.values.at(-1) ?? 0)}</tspan>
                {series.length > 1 && <tspan className="l"> {s.label}</tspan>}
              </text>
            </g>
          ))}
          {hover != null && (
            <g pointerEvents="none">
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} />
              {series.map(s => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} className="end-dot" />)}
            </g>
          )}
        </svg>
      )}
      {hover != null && n > 0 && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, width - 170), top: PAD.top }}>
          <div className="tt-time">{hhmm.format(times[hover])}</div>
          {series.map(s => (
            <div key={s.key} className="tt-row">
              <span className="key" style={{ background: s.color }} />
              <b>{format(s.values[hover])}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
