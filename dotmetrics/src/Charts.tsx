import { useMemo, useRef, useState } from 'react';

/**
 * Hand-rolled SVG charts — no charting library, so nothing is added to the
 * bundle and every mark is under our control (byte's rule: keep it lean).
 *
 * One series, one hue: cumulative .dot registrations over the indexed block
 * range. A single-series chart needs no legend — the card title names it — and a
 * single hue sidesteps every categorical-colour concern. Thin 2px line, a light
 * gradient area, recessive grid, and a crosshair+tooltip on hover.
 */

export interface TrendPoint {
  block: number;
  count: number;
  name: string;
  /** Unix seconds of the registration block, when the indexer resolved it. */
  at?: number;
}

const VBW = 760;
const VBH = 268;
const PAD = { top: 18, right: 18, bottom: 40, left: 40 };

function compactBlock(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/** Seconds of elapsed time → "3h 12m" / "45m" / "30s". */
function elapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function RegistrationsTrend({ points }: { points: TrendPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const minX = points[0].block;
    const maxX = points[points.length - 1].block;
    const spanX = maxX - minX || 1;
    const maxY = points[points.length - 1].count;
    const plotW = VBW - PAD.left - PAD.right;
    const plotH = VBH - PAD.top - PAD.bottom;
    const sx = (b: number) => PAD.left + ((b - minX) / spanX) * plotW;
    const sy = (c: number) => PAD.top + plotH - (c / maxY) * plotH;
    const pts = points.map((p) => ({ ...p, x: sx(p.block), y: sy(p.count) }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const base = PAD.top + plotH;
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${base} L${pts[0].x.toFixed(1)},${base} Z`;
    // A handful of y gridlines at whole-app counts.
    const tickStep = Math.max(1, Math.ceil(maxY / 4));
    const yTicks: number[] = [];
    for (let v = 0; v <= maxY; v += tickStep) yTicks.push(v);
    if (yTicks[yTicks.length - 1] !== maxY) yTicks.push(maxY);
    const t0 = points[0].at;
    const tN = points[points.length - 1].at;
    const hasTime = typeof t0 === 'number' && typeof tN === 'number';
    const spanSeconds = hasTime ? tN - t0 : 0;
    return { pts, minX, maxX, maxY, plotW, plotH, base, line, area, yTicks, sy, hasTime, spanSeconds, t0 };
  }, [points]);

  if (!geom) return null;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratioX = ((e.clientX - rect.left) / rect.width) * VBW;
    // Nearest point by rendered x.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < geom.pts.length; i += 1) {
      const d = Math.abs(geom.pts[i].x - ratioX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const hover = hoverIdx != null ? geom.pts[hoverIdx] : null;

  return (
    <div
      className="chart-wrap"
      ref={wrapRef}
      onPointerMove={onMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="chart-svg" role="img" aria-label="Cumulative .dot app registrations over the indexed block range">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--md-primary)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--md-primary)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* recessive horizontal gridlines + y labels */}
        {geom.yTicks.map((v) => {
          const y = geom.sy(v);
          return (
            <g key={v}>
              <line x1={PAD.left} y1={y} x2={VBW - PAD.right} y2={y} className="chart-grid" />
              <text x={PAD.left - 8} y={y + 4} className="chart-axis" textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}

        {/* x-axis end labels: block number, and elapsed wall-clock time below */}
        <text x={PAD.left} y={VBH - 22} className="chart-axis" textAnchor="start">
          block {compactBlock(geom.minX)}
        </text>
        <text x={PAD.left} y={VBH - 8} className="chart-axis chart-axis-dim" textAnchor="start">
          {geom.hasTime ? 'start' : ''}
        </text>
        <text x={VBW - PAD.right} y={VBH - 22} className="chart-axis" textAnchor="end">
          block {compactBlock(geom.maxX)}
        </text>
        <text x={VBW - PAD.right} y={VBH - 8} className="chart-axis chart-axis-dim" textAnchor="end">
          {geom.hasTime ? `+${elapsed(geom.spanSeconds)}` : ''}
        </text>

        <path d={geom.area} fill="url(#areaFill)" />
        <path d={geom.line} className="chart-line" fill="none" />

        {hover && (
          <g>
            <line x1={hover.x} y1={PAD.top} x2={hover.x} y2={geom.base} className="chart-crosshair" />
            <circle cx={hover.x} cy={hover.y} r="4.5" className="chart-dot" />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="chart-tip"
          style={{
            left: `${(hover.x / VBW) * 100}%`,
            top: `${(hover.y / VBH) * 100}%`,
          }}
        >
          <strong>{hover.count}</strong> app{hover.count === 1 ? '' : 's'} registered
          <span>
            #{hover.name} · block {hover.block.toLocaleString('en-US')}
            {geom.hasTime && typeof hover.at === 'number' && typeof geom.t0 === 'number'
              ? ` · +${elapsed(hover.at - geom.t0)}`
              : ''}
          </span>
        </div>
      )}
    </div>
  );
}

/** Registrations grouped per UTC day, as thin rounded bars with counts. */
export function RegsPerDay({ points }: { points: TrendPoint[] }) {
  const days = new Map<string, number>();
  for (const p of points) {
    if (typeof p.at !== 'number') continue;
    const d = new Date(p.at * 1000).toISOString().slice(0, 10);
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  const rows = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map(([, n]) => n));
  return (
    <div className="regbars" role="img" aria-label="New registrations per day">
      {rows.map(([day, n]) => (
        <div className="regbar-col" key={day}>
          <span className="regbar-n">{n}</span>
          <span className="regbar-track">
            <span className="regbar-fill" style={{ height: `${(n / max) * 100}%` }} />
          </span>
          <span className="regbar-day">{day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** Tiny inline sparkline for a scorecard — same series, no axes, no interaction. */
export function Sparkline({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 30;
  const minX = points[0].block;
  const spanX = points[points.length - 1].block - minX || 1;
  const maxY = points[points.length - 1].count || 1;
  const p = points.map((pt) => {
    const x = ((pt.block - minX) / spanX) * (w - 2) + 1;
    const y = h - 3 - (pt.count / maxY) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`1,${h - 3} ${p.join(' ')} ${w - 1},${p[p.length - 1].split(',')[1]}`} className="spark-area" />
      <polyline points={p.join(' ')} className="spark-line" />
    </svg>
  );
}
