import { useEffect, useMemo, useState } from 'react';
import { readBlockTimes, tierOf, type Listing, type Records } from './chain';

/*
 * Two panels, both in dotmetrics' idiom, because that idiom is better than what
 * was here before:
 *
 *   - A hero figure with a sparkline beside it and a prose breakdown under it.
 *     One sentence carries the composition that a stacked bar was spending a
 *     whole rectangle on, and reads instead of needing to be decoded.
 *   - A registration grid: one cell per UTC hour, one row per UTC day, the day's
 *     total in the right gutter. Hour granularity says something a monthly
 *     cumulative curve cannot — when people actually register.
 *
 * Both are computed from the snapshot already in hand. The grid additionally
 * fetches real header timestamps for the blocks inside its window: the derived
 * time on a Listing is head-minus-block times an average, which is fine for a
 * curve and would smear an hourly cell into the wrong day.
 */

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const RELATIVE = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

function ago(then: Date): string {
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 60) return RELATIVE.format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 48) return RELATIVE.format(-hours, 'hour');
  return RELATIVE.format(-Math.round(hours / 24), 'day');
}

/* ------------------------------------------------------------------ hero -- */

export function HeroPanel({
  labels,
  records,
}: {
  labels: Listing[];
  records: Map<string, Records>;
}) {
  const tally = useMemo(() => {
    const t = { described: 0, deployed: 0, registered: 0 };
    for (const r of records.values()) t[tierOf(r)] += 1;
    return t;
  }, [records]);

  /** Cumulative arrivals, one point per name, for the sparkline. */
  const spark = useMemo(() => {
    const dated = labels
      .filter((l) => l.firstSeenBlock > 0)
      .sort((a, b) => a.firstSeenBlock - b.firstSeenBlock);
    if (dated.length < 2) return null;

    const W = 200;
    const H = 46;
    const first = dated[0].firstSeenBlock;
    const span = dated[dated.length - 1].firstSeenBlock - first || 1;
    const pts = dated.map((l, i) => {
      const x = ((l.firstSeenBlock - first) / span) * W;
      const y = H - ((i + 1) / dated.length) * H;
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return { d: `M${pts.join(' L')}`, W, H };
  }, [labels]);

  const withBundle = tally.described + tally.deployed;
  const newest = useMemo(() => {
    const dated = labels.filter((l) => l.firstSeenAt);
    if (dated.length === 0) return null;
    return dated.reduce((a, b) => (a.firstSeenBlock > b.firstSeenBlock ? a : b)).firstSeenAt;
  }, [labels]);

  return (
    <section className="hero">
      <div className="hero-top">
        <span className="hero-figure">{labels.length}</span>
        {spark ? (
          <svg
            className="spark"
            viewBox={`0 0 ${spark.W} ${spark.H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Cumulative registrations over time"
          >
            <path d={spark.d} />
          </svg>
        ) : null}
      </div>
      {/* The composition as a sentence. It is the same four numbers a stacked bar
          would carry, and it states how they nest — which a bar cannot. */}
      <p className="hero-note">
        names indexed
        {records.size > 0 ? (
          <>
            {' · '}
            <strong>{withBundle}</strong> of them have a bundle {' · '}
            <strong>{tally.described}</strong> of those also describe themselves {' · '}
            <strong>{tally.registered}</strong> are a name and nothing else
          </>
        ) : (
          <> · reading records…</>
        )}
        {newest ? (
          <>
            {' · '}
            <span className="stale">newest {ago(newest)}</span>
          </>
        ) : null}
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- heatmap -- */

const DAYS = 7;

export function RegistrationGrid({ labels }: { labels: Listing[] }) {
  const [times, setTimes] = useState<Map<number, Date>>(new Map());
  const [failed, setFailed] = useState<string | null>(null);

  /** Blocks whose derived time already puts them near the window. A few days of
   *  slack on either side covers the derivation's own error. */
  const candidates = useMemo(() => {
    const cutoff = Date.now() - (DAYS + 3) * 86_400_000;
    return labels
      .filter((l) => l.firstSeenBlock > 0 && l.firstSeenAt && l.firstSeenAt.getTime() >= cutoff)
      .map((l) => l.firstSeenBlock);
  }, [labels]);

  useEffect(() => {
    if (candidates.length === 0) return;
    let alive = true;
    // Catch, rather than a bare `void`: an unhandled rejection here left the
    // grid uniformly empty and indistinguishable from a quiet week.
    readBlockTimes(candidates)
      .then((m) => {
        if (alive) setTimes(m);
      })
      .catch((err: unknown) => {
        if (alive) setFailed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [candidates]);

  const { rows, max, total } = useMemo(() => {
    // Rows are UTC days, newest last, ending today.
    const today = new Date();
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      - (DAYS - 1) * 86_400_000;

    const grid: { day: Date; hours: number[]; total: number }[] = [];
    for (let d = 0; d < DAYS; d += 1) {
      grid.push({ day: new Date(start + d * 86_400_000), hours: new Array(24).fill(0), total: 0 });
    }

    let hottest = 0;
    let counted = 0;
    for (const at of times.values()) {
      const dayIndex = Math.floor((at.getTime() - start) / 86_400_000);
      if (dayIndex < 0 || dayIndex >= DAYS) continue;
      const h = at.getUTCHours();
      const row = grid[dayIndex];
      row.hours[h] += 1;
      row.total += 1;
      counted += 1;
      if (row.hours[h] > hottest) hottest = row.hours[h];
    }
    return { rows: grid, max: hottest, total: counted };
  }, [times]);

  return (
    <section className="heat">
      <div className="heat-head">
        <div>
          <h2>Registrations</h2>
          <p>one cell per UTC hour · one row per UTC day · day total in the right gutter</p>
        </div>
        <span className="legend">
          <svg width="18" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="18" y2="4" />
          </svg>
          names registered
        </span>
      </div>

      <div className="heat-grid">
        {rows.map((row) => (
          <div className="heat-row" key={row.day.toISOString()}>
            <span className="heat-day">{DAY_LABEL.format(row.day)}</span>
            <div className="heat-cells">
              {row.hours.map((n, h) => (
                <span
                  key={h}
                  className={`cell${n > 0 ? ' hit' : ''}`}
                  // One hue, opacity carries magnitude — no rainbow, and an
                  // empty hour is visibly a cell rather than a gap.
                  style={n > 0 ? { opacity: 0.35 + 0.65 * (n / (max || 1)) } : undefined}
                  title={`${DAY_LABEL.format(row.day)} ${String(h).padStart(2, '0')}:00 UTC — ${n}`}
                />
              ))}
            </div>
            <span className={`heat-total${row.total > 0 ? ' on' : ''}`}>{row.total}</span>
          </div>
        ))}
        <div className="heat-axis">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>UTC</span>
        </div>
      </div>

      {failed ? (
        <p className="heat-empty warn">Could not read block times: {failed}</p>
      ) : total === 0 && candidates.length > 0 ? (
        <p className="heat-empty">reading block times for {candidates.length} recent names…</p>
      ) : total === 0 ? (
        <p className="heat-empty">
          Nothing registered in the last {DAYS} days. Every name in the directory arrived earlier.
        </p>
      ) : null}
    </section>
  );
}
