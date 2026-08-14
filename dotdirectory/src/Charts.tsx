import { useMemo } from 'react';
import { tierOf, type Listing, type Records, type Tier } from './chain';

/*
 * Two charts, both derived at view time from what the contract already returned.
 * No extra reads and no stored history: arrival blocks make the growth curve
 * computable from a single snapshot, which is the whole reason firstSeenBlock
 * went into the contract.
 *
 * dotmetrics' chart rules, followed: at most two hues — pink for the measured
 * series, a neutral for the track or remainder — and no gradients on data. One
 * series needs no legend, so the growth chart has none; the composition bar has
 * three segments and is labelled directly rather than by a colour key.
 */

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });

/** Cumulative names over time, bucketed by month of arrival. */
export function GrowthChart({ labels }: { labels: Listing[] }) {
  const points = useMemo(() => {
    const dated = labels
      .filter((l) => l.firstSeenAt)
      .sort((a, b) => a.firstSeenBlock - b.firstSeenBlock);
    if (dated.length === 0) return [];

    const buckets = new Map<string, { at: Date; n: number }>();
    for (const l of dated) {
      const d = l.firstSeenAt as Date;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const b = buckets.get(key);
      if (b) b.n += 1;
      else buckets.set(key, { at: new Date(d.getFullYear(), d.getMonth(), 1), n: 1 });
    }
    let running = 0;
    return [...buckets.values()]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((b) => ({ at: b.at, added: b.n, total: (running += b.n) }));
  }, [labels]);

  if (points.length < 2) return null;

  const W = 640;
  const H = 150;
  const PAD = { l: 34, r: 8, t: 10, b: 20 };
  const max = points[points.length - 1].total;
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);

  // Stepped, because a name arrives at a moment rather than easing in.
  const line = points
    .map((p, i) => (i === 0 ? `M${x(i)} ${y(p.total)}` : `H${x(i)}V${y(p.total)}`))
    .join(' ');
  const area = `${line} V${H - PAD.b} H${x(0)} Z`;

  const ticks = [0, Math.round(max / 2), max];

  return (
    <figure className="chart">
      <figcaption>
        Names on-chain over time
        <span>cumulative, by month of first announcement</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative names, ending at ${max}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="tick" x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <path className="area" d={area} />
        <path className="line" d={line} />
        <circle className="end" cx={x(points.length - 1)} cy={y(max)} r="3.5" />
        {points.map((p, i) =>
          i === 0 || i === points.length - 1 ? (
            <text
              key={p.at.getTime()}
              className="tick"
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : 'end'}
            >
              {MONTH.format(p.at)}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}

const TIER_TEXT: Record<Tier, string> = {
  described: 'described',
  deployed: 'deployed only',
  registered: 'name only',
};

/** What the ecosystem has actually published, as one stacked bar. */
export function CompositionChart({
  records,
  total,
}: {
  records: Map<string, Records>;
  total: number;
}) {
  const tally = useMemo(() => {
    const t: Record<Tier, number> = { described: 0, deployed: 0, registered: 0 };
    for (const r of records.values()) t[tierOf(r)] += 1;
    return t;
  }, [records]);

  const read = tally.described + tally.deployed + tally.registered;
  if (read === 0) return null;

  const order: Tier[] = ['described', 'deployed', 'registered'];
  let offset = 0;

  return (
    <figure className="chart">
      <figcaption>
        What those names have published
        <span>
          {read} of {total} read
        </span>
      </figcaption>
      <svg viewBox="0 0 640 46" role="img" aria-label="Composition by what each name publishes">
        {order.map((t) => {
          const w = (tally[t] / read) * 640;
          const seg = (
            <rect key={t} className={`seg ${t}`} x={offset} y="0" width={Math.max(0, w - 2)} height="16" rx="3" />
          );
          offset += w;
          return seg;
        })}
        {(() => {
          let at = 0;
          return order.map((t) => {
            const w = (tally[t] / read) * 640;
            const label = (
              <text key={`l-${t}`} className="seglabel" x={at} y="34">
                {tally[t]} {TIER_TEXT[t]}
              </text>
            );
            at += w;
            return tally[t] > 0 ? label : null;
          });
        })()}
      </svg>
    </figure>
  );
}
