import { useMemo, useRef, useState } from 'react';
import type { Yearly } from './lib/climate';

/**
 * Yearly mean temperature over the record, as a thin line with a soft area.
 * One series, one measure — the point is the upward drift, so the line is the
 * hero and the axes stay recessive. Hover reads off a single year.
 */
const VBW = 760;
const VBH = 240;
const PAD = { top: 16, right: 16, bottom: 26, left: 38 };

export function YearlyMeanChart({ yearly }: { yearly: Yearly[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const geom = useMemo(() => {
    if (yearly.length < 2) return null;
    const xs = yearly.map((y) => y.year);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const means = yearly.map((y) => y.mean);
    const minY = Math.min(...means);
    const maxY = Math.max(...means);
    const padY = (maxY - minY) * 0.12 || 1;
    const lo = minY - padY;
    const hi = maxY + padY;
    const plotW = VBW - PAD.left - PAD.right;
    const plotH = VBH - PAD.top - PAD.bottom;
    const sx = (yr: number) => PAD.left + ((yr - minX) / (maxX - minX || 1)) * plotW;
    const sy = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
    const pts = yearly.map((y) => ({ ...y, x: sx(y.year), y: sy(y.mean) }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const base = PAD.top + plotH;
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${base} L${pts[0].x.toFixed(1)},${base} Z`;
    const yTicks = [lo, (lo + hi) / 2, hi];
    return { pts, minX, maxX, lo, hi, base, line, area, sy, yTicks };
  }, [yearly]);

  if (!geom) return null;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = ((e.clientX - rect.left) / rect.width) * VBW;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < geom.pts.length; i += 1) {
      const d = Math.abs(geom.pts[i].x - rx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const hot = hoverIdx != null ? geom.pts[hoverIdx] : null;

  return (
    <div className="yc-wrap" ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHoverIdx(null)}>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="yc-svg" role="img" aria-label="Yearly average temperature over time">
        <defs>
          <linearGradient id="ycFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e53e3e" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#e53e3e" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {geom.yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={geom.sy(v)} x2={VBW - PAD.right} y2={geom.sy(v)} className="yc-grid" />
            <text x={PAD.left - 7} y={geom.sy(v) + 4} className="yc-axis" textAnchor="end">
              {v.toFixed(0)}°
            </text>
          </g>
        ))}
        <text x={PAD.left} y={VBH - 8} className="yc-axis" textAnchor="start">
          {geom.minX}
        </text>
        <text x={VBW - PAD.right} y={VBH - 8} className="yc-axis" textAnchor="end">
          {geom.maxX}
        </text>
        <path d={geom.area} fill="url(#ycFill)" />
        <path d={geom.line} className="yc-line" fill="none" />
        {hot && (
          <>
            <line x1={hot.x} y1={PAD.top} x2={hot.x} y2={geom.base} className="yc-cross" />
            <circle cx={hot.x} cy={hot.y} r="4" className="yc-dot" />
          </>
        )}
      </svg>
      {hot && (
        <div className="yc-tip" style={{ left: `${(hot.x / VBW) * 100}%`, top: `${(hot.y / VBH) * 100}%` }}>
          <strong>{hot.mean.toFixed(1)}°C</strong>
          <span>{hot.year} average</span>
        </div>
      )}
    </div>
  );
}
