import { useRef, useState } from 'react';
import { stripeColor, type Anomaly } from './lib/climate';

/**
 * Warming stripes — one vertical bar per year, coloured by that year's
 * temperature anomaly. Ed Hawkins' visualisation: no axes, no numbers, the
 * shift from blue to red is the whole message. Hovering a stripe names its year.
 */
export function WarmingStripes({ anomalies, span }: { anomalies: Anomaly[]; span: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const n = anomalies.length;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hot = hover != null ? anomalies[hover] : null;

  return (
    <div
      className="stripes"
      ref={wrapRef}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="stripes-svg" role="img" aria-label="Yearly temperature anomalies as coloured stripes, oldest left to newest right">
        {anomalies.map((a, i) => (
          <rect
            key={a.year}
            x={i}
            y={0}
            width={1.02}
            height={100}
            fill={stripeColor(a.anomaly, span)}
          />
        ))}
        {hover != null && (
          <rect x={hover} y={0} width={1.02} height={100} className="stripe-hi" />
        )}
      </svg>
      {hot && (
        <div
          className="stripe-tip"
          style={{ left: `${((hover! + 0.5) / n) * 100}%` }}
        >
          <strong>{hot.year}</strong>
          <span>{hot.anomaly >= 0 ? '+' : ''}{hot.anomaly.toFixed(2)}°C vs 1961–90</span>
        </div>
      )}
    </div>
  );
}
