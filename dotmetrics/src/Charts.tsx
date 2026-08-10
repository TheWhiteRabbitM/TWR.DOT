import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { locale, t, useLang, type Lang } from './lib/i18n';

/**
 * Four marks, hand-rolled. No charting library — the bundle is already 1.4MB and
 * every mark here is simple enough that a dependency would cost more than it
 * saves.
 *
 * Rules this file obeys:
 *
 *  1. NO CHART RETURNS null. A chart that vanishes when it has no data is
 *     indistinguishable from a chart that failed to load. Every component here
 *     renders its frame and says, in words, why it is empty.
 *  2. One measured hue (--pink / --pink-fill), one neutral (--bg-3/--bg-4) for
 *     the remainder, --warn for reverts and stalls. Nothing else.
 *  3. Tooltips are the pointer-positioned `.chart-tip` element. Native `title=`
 *     is banned: it never fires on touch, and this app is opened inside a phone
 *     shell more often than not.
 *  4. Every number carries its denominator and its window. A bare count is a
 *     claim without evidence.
 *
 * Geometry classes (`.pulsestrip`, `.heatwrap`, `.vitals-*`) are defined in the
 * scoped layout sheet in App.tsx — see LAYOUT_CSS there.
 */

/* ------------------------------------------------------------------ shared */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Unix seconds → "Jul 24" / "24 lug", in UTC.
 *
 * The month name and the day/month order both follow the reader's locale; the
 * time zone never does. Every date on this page is a UTC block timestamp, and a
 * heatmap whose rows silently shifted by a day for a reader in Auckland would
 * be a different chart, not a translated one — hence the explicit `timeZone`.
 */
function utcDay(unix: number, lang: Lang): string {
  return new Date(unix * 1000).toLocaleDateString(locale(lang), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Thousands separators follow the reader. Tabular figures still don't jitter. */
function fmt(n: number, lang: Lang): string {
  return n.toLocaleString(locale(lang));
}

/**
 * Where a `.chart-tip` may sit without being cut off.
 *
 * `.panel` clips its overflow, so the sheet's default "float above the point"
 * transform puts a tooltip on the top row of a grid outside the card and out of
 * sight. Tips therefore hang BELOW their anchor — except near the bottom of the
 * chart, where below is just as far outside the card: the last row of a heatmap
 * is exactly the case where hanging down runs past the panel's edge. There the
 * tip flips back above. Near a left or right edge it stops centring and pins to
 * that edge instead — a tooltip that runs off the side of a phone is no tooltip
 * at all.
 */
const TIP_MARGIN = 96;

/** Roughly how tall a tip gets: three short lines plus padding and border. */
const TIP_HEIGHT = 78;

function tipAlign(left: number, wrapWidth: number, top = 0, wrapHeight = Infinity): string {
  // Not enough room underneath — the bottom row of a grid — so flip it up.
  const side = wrapHeight - top < TIP_HEIGHT ? ' tip-above' : ' tip-below';
  if (left < TIP_MARGIN) return `${side} tip-l`;
  if (left > wrapWidth - TIP_MARGIN) return `${side} tip-r`;
  return side;
}

/* ============================================================ A. pulse strip */

const PULSE_TICKS = 40;
/** A lit tick fades to nothing over this long — ~40 blocks at 2s. */
const PULSE_DECAY_MS = 80_000;
/** No head for this long and the chain, or our socket, has stopped. Say so. */
const PULSE_STALL_MS = 15_000;
/** Rolling mean is over this many observed gaps — not over all of history. */
const PULSE_MEAN_OVER = 20;
/** A gap longer than this is a reconnect, not a block time. It never enters the mean. */
const PULSE_GAP_MAX_MS = 60_000;

/** One `subscribeNewHeads` callback, as received. */
export interface HeadBeat {
  /** Block number from the header. */
  number: number;
  /** `Date.now()` at the moment the callback fired. */
  at: number;
}

/**
 * The top-bar heartbeat: 40 ticks, one lit per head received.
 *
 * The motion is bound to received events and nothing else — there is no CSS
 * animation loop anywhere in here. That is the whole point: when the chain (or
 * our socket) stops, the strip stops with it, and a stalled chain is visible
 * instead of being papered over by a pretty loop that runs regardless.
 *
 * Under `prefers-reduced-motion` the ticks stop travelling: a cursor walks the
 * strip and recolours in place, so the same information arrives without 40
 * elements shifting sideways on every block.
 */
export function PulseStrip({
  beat,
  connected,
}: {
  beat: HeadBeat | null;
  /** `false` once the tail has given up on the socket. `null` while it tries. */
  connected?: boolean | null;
}) {
  const lang = useLang();
  const reduced = useReducedMotion();
  const [slots, setSlots] = useState<number[]>(() => new Array<number>(PULSE_TICKS).fill(0));
  const [head, setHead] = useState<number | null>(null);
  const [lastAt, setLastAt] = useState(0);
  const [gaps, setGaps] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const cursor = useRef(0);
  const seen = useRef(-1);
  const prevAt = useRef(0);

  useEffect(() => {
    if (!beat || beat.number === seen.current) return;
    seen.current = beat.number;

    if (prevAt.current > 0) {
      const gap = beat.at - prevAt.current;
      // Only plausible block intervals shape the mean; a reconnect gap would
      // otherwise be reported as a 40-second block time.
      if (gap > 0 && gap < PULSE_GAP_MAX_MS) {
        setGaps((g) => [...g, gap].slice(-PULSE_MEAN_OVER));
      }
    }
    prevAt.current = beat.at;

    setSlots((cur) => {
      if (reduced) {
        const next = cur.slice();
        next[cursor.current] = beat.at;
        cursor.current = (cursor.current + 1) % PULSE_TICKS;
        return next;
      }
      return [...cur.slice(1), beat.at];
    });
    setHead(beat.number);
    setLastAt(beat.at);
    setNow(beat.at);
  }, [beat, reduced]);

  // A 1s clock for decay and for the stall counter. This moves opacity and
  // text, never position: the ticks themselves only ever move on a head.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const silence = lastAt ? now - lastAt : 0;
  const stalled = lastAt > 0 && silence > PULSE_STALL_MS;
  const mean = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000 : null;

  // "waiting" and "there is no feed" are different claims. A socket that has
  // already failed must not go on implying that heads are still on their way.
  const dead = head == null && connected === false;

  const stalledFor = Math.round(silence / 1000);
  const avg = mean != null ? mean.toFixed(1) : null;

  let readout: string;
  if (dead) readout = t('pulse.dead');
  else if (head == null) readout = t('pulse.waiting');
  else if (stalled) readout = t('pulse.stalled', { n: stalledFor });
  else if (avg != null) readout = t('pulse.head.avg', { head: fmt(head, lang), avg });
  else readout = t('pulse.head', { head: fmt(head, lang) });

  const label =
    head == null
      ? dead
        ? t('pulse.aria.dead')
        : t('pulse.aria.waiting')
      : stalled
        ? t('pulse.aria.stalled', { n: stalledFor, head })
        : avg != null
          ? t('pulse.aria.ok.avg', { head, avg, n: gaps.length })
          : t('pulse.aria.ok', { head });

  return (
    <div
      className={`pulsestrip${stalled || dead ? ' is-stalled' : ''}`}
      role="img"
      aria-label={label}
      // Deliberately NOT focusable. It sits above the search field in the DOM,
      // and the search must be the first thing Tab lands on; a readout with no
      // interaction has no business taking that slot. Screen readers still
      // reach it as an image with the label above.
    >
      <div className="pulsestrip-ticks">
        {slots.map((at, i) => {
          const age = at ? now - at : Infinity;
          const alive = age < PULSE_DECAY_MS;
          const v = alive ? Math.max(0.08, 1 - age / PULSE_DECAY_MS) : 0;
          return (
            <span
              key={i}
              className={`pulsestrip-tick${alive ? ' is-on' : ''}`}
              style={{ opacity: alive ? v : undefined }}
            />
          );
        })}
      </div>
      <span className={`pulsestrip-read mono${stalled || head == null ? ' is-warn' : ''}`}>
        {readout}
      </span>
    </div>
  );
}

/* ====================================================== B. registration heatmap */

/** One registration, as the index knows it. */
export interface RegPoint {
  label: string;
  /** Unix seconds of the registration block. */
  at: number;
}

const CELL = 16;
const GAP = 4;
const STRIDE = CELL + GAP;
const COLS = 24;
const GRID_W = COLS * STRIDE - GAP; // 357
const HEAT_LEFT = 58;
const HEAT_RIGHT = 48;
const HEAT_FOOT = 24;
const HEAT_W = HEAT_LEFT + GRID_W + HEAT_RIGHT;
/** Never more than a week of rows: beyond that a day-grid stops being readable. */
const HEAT_MAX_ROWS = 7;
/** Four steps. A continuous ramp reads as a gradient, and gradients on data lie. */
const RAMP = [0.26, 0.5, 0.74, 1];

interface HeatRow {
  dayIndex: number;
  label: string;
  total: number;
  hours: string[][];
}

/**
 * Registrations by UTC hour, one row per UTC day — the one growth chart.
 *
 * A day total sits in the right gutter, which is where a 1 / 27 / 10 / 4 shape
 * becomes legible: 24 near-empty cells and one dark one do not, on their own,
 * say "twenty-seven names landed here in a day".
 */
export function RegistrationHeatmap({ points }: { points: RegPoint[] }) {
  const lang = useLang();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null);
  const [tipXY, setTipXY] = useState<{ left: number; top: number; wrap: number; wrapH: number } | null>(null);

  const { rows, max, total } = useMemo(() => {
    const dated = points.filter((p) => Number.isFinite(p.at) && p.at > 0);
    const byDay = new Map<number, HeatRow>();
    for (const p of dated) {
      const dayIndex = Math.floor(p.at / 86_400);
      let row = byDay.get(dayIndex);
      if (!row) {
        row = {
          dayIndex,
          label: utcDay(dayIndex * 86_400, lang),
          total: 0,
          hours: Array.from({ length: COLS }, () => [] as string[]),
        };
        byDay.set(dayIndex, row);
      }
      row.hours[new Date(p.at * 1000).getUTCHours()].push(p.label);
      row.total += 1;
    }

    // Fill the calendar gaps: a day with no registrations is a fact about the
    // ecosystem and must occupy a row, not be silently skipped.
    const keys = [...byDay.keys()].sort((a, b) => a - b);
    const today = Math.floor(Date.now() / 86_400_000);
    const lastDay = keys.length ? Math.max(keys[keys.length - 1], today) : today;
    const firstDay = keys.length ? keys[0] : lastDay;
    const span = Math.min(HEAT_MAX_ROWS, Math.max(1, lastDay - firstDay + 1));
    const out: HeatRow[] = [];
    for (let d = lastDay - span + 1; d <= lastDay; d += 1) {
      out.push(
        byDay.get(d) ?? {
          dayIndex: d,
          label: utcDay(d * 86_400, lang),
          total: 0,
          hours: Array.from({ length: COLS }, () => [] as string[]),
        },
      );
    }
    let peak = 0;
    for (const r of out) for (const h of r.hours) peak = Math.max(peak, h.length);
    return { rows: out, max: peak, total: dated.length };
    // `lang` is a dependency because the row labels are localised month names.
  }, [points, lang]);

  const H = rows.length * STRIDE - GAP + HEAT_FOOT;

  const locate = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const wrap = wrapRef.current;
      if (!svg || !wrap) return;
      const r = svg.getBoundingClientRect();
      if (r.width === 0) return;
      const sx = ((clientX - r.left) / r.width) * HEAT_W;
      const sy = ((clientY - r.top) / r.height) * H;
      const col = Math.floor((sx - HEAT_LEFT) / STRIDE);
      const row = Math.floor(sy / STRIDE);
      if (col < 0 || col >= COLS || row < 0 || row >= rows.length) {
        setCell(null);
        return;
      }
      setCell({ row, col });
      const wr = wrap.getBoundingClientRect();
      const scale = r.width / HEAT_W;
      setTipXY({
        left: r.left - wr.left + (HEAT_LEFT + col * STRIDE + CELL / 2) * scale,
        top: r.top - wr.top + (row * STRIDE + CELL) * scale,
        wrap: wr.width,
        wrapH: wr.height,
      });
    },
    [rows.length, H],
  );

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => locate(e.clientX, e.clientY);

  const move = (dRow: number, dCol: number) => {
    setCell((cur) => {
      const base = cur ?? { row: rows.length - 1, col: 0 };
      const row = Math.min(rows.length - 1, Math.max(0, base.row + dRow));
      const col = Math.min(COLS - 1, Math.max(0, base.col + dCol));
      const svg = svgRef.current;
      const wrap = wrapRef.current;
      if (svg && wrap) {
        const r = svg.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const scale = r.width / HEAT_W;
        setTipXY({
          left: r.left - wr.left + (HEAT_LEFT + col * STRIDE + CELL / 2) * scale,
          top: r.top - wr.top + (row * STRIDE + CELL) * scale,
          wrap: wr.width,
          wrapH: wr.height,
        });
      }
      return { row, col };
    });
  };

  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const map: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    move(d[0], d[1]);
  };

  const hovered = cell ? rows[cell.row].hours[cell.col] : null;
  const hoveredRow = cell ? rows[cell.row] : null;

  return (
    <div
      className="heatwrap"
      ref={wrapRef}
      onPointerLeave={() => {
        setCell(null);
        setTipXY(null);
      }}
    >
      {/* The grid keeps its 12px cells and the SCROLLER moves, rather than the
          cells shrinking to 8px on a phone. The tooltip lives outside this
          scroller so it is never clipped by it. */}
      <div className="heat-scroll" onPointerMove={onMove}>
      <svg
        ref={svgRef}
        className="heat-svg"
        /* Scales down to fit a phone instead of scrolling: the day totals live
           in the right gutter, and a chart whose headline numbers sit past the
           edge of the screen has buried its own point. The pointer maths below
           already derives its scale from the rendered width. */
        width="100%"
        height={H}
        style={{ maxWidth: HEAT_W }}
        viewBox={`0 0 ${HEAT_W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setCell(null)}
        aria-label={
          total === 0
            ? t('heat.aria.empty')
            : t('heat.aria', { total, days: rows.length, max })
        }
      >
        {rows.map((row, ri) => (
          <g key={row.dayIndex}>
            <text x={HEAT_LEFT - 10} y={ri * STRIDE + 9} className="chart-axis" textAnchor="end">
              {row.label}
            </text>
            {row.hours.map((names, ci) => {
              const n = names.length;
              const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / Math.max(1, max)) * 4));
              const on = cell?.row === ri && cell?.col === ci;
              return (
                <g key={ci}>
                  <rect
                    x={HEAT_LEFT + ci * STRIDE}
                    y={ri * STRIDE}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    className="heat-track"
                  />
                  {n > 0 && (
                    <rect
                      x={HEAT_LEFT + ci * STRIDE}
                      y={ri * STRIDE}
                      width={CELL}
                      height={CELL}
                      rx={2}
                      className="heat-fill"
                      opacity={RAMP[level - 1]}
                    />
                  )}
                  {on && (
                    <rect
                      x={HEAT_LEFT + ci * STRIDE - 1.5}
                      y={ri * STRIDE - 1.5}
                      width={CELL + 3}
                      height={CELL + 3}
                      rx={3}
                      className="heat-focus"
                    />
                  )}
                </g>
              );
            })}
            <text
              x={HEAT_LEFT + GRID_W + 10}
              y={ri * STRIDE + 9}
              className={`chart-axis${row.total > 0 ? ' heat-total' : ''}`}
              textAnchor="start"
            >
              {row.total}
            </text>
          </g>
        ))}

        {[0, 6, 12, 18].map((h) => (
          <text
            key={h}
            x={HEAT_LEFT + h * STRIDE}
            y={H - 6}
            className="chart-axis"
            textAnchor="start"
          >
            {String(h).padStart(2, '0')}
          </text>
        ))}
        <text x={HEAT_LEFT + GRID_W} y={H - 6} className="chart-axis" textAnchor="end">
          {t('heat.utc')}
        </text>

        {/* The grid still renders when there is nothing in it: an empty
            calendar is a fact, a missing chart is a bug. */}
        {total === 0 && (
          <>
            <rect
              x={HEAT_LEFT}
              y={0}
              width={GRID_W}
              height={rows.length * STRIDE - GAP}
              className="heat-veil"
            />
            <text
              x={HEAT_LEFT + GRID_W / 2}
              y={(rows.length * STRIDE - GAP) / 2 + 4}
              className="chart-axis heat-empty"
              textAnchor="middle"
            >
              {t('heat.empty')}
            </text>
          </>
        )}
      </svg>
      </div>

      {cell && tipXY && hovered && hoveredRow && (
        <div
          className={`chart-tip${tipAlign(tipXY.left, tipXY.wrap, tipXY.top, tipXY.wrapH)}`}
          style={{ left: `${tipXY.left}px`, top: `${tipXY.top}px` }}
        >
          <strong>
            {hovered.length === 1 ? t('heat.tip.one') : t('heat.tip.n', { n: hovered.length })}
          </strong>
          <span>
            {t('heat.tip.when', {
              day: hoveredRow.label,
              hour: String(cell.col).padStart(2, '0'),
            })}
          </span>
          {hovered.length > 0 && (
            <span>
              {hovered.slice(0, 4).join(', ')}
              {hovered.length > 4 ? ` ${t('heat.tip.more', { n: hovered.length - 4 })}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ========================================================== C. step sparkline */

const SPARK_W = 210;
const SPARK_H = 56;

/**
 * Cumulative registrations beside the hero count, as a STEP line.
 *
 * A step, not a curve: a registration is a discrete event at a known second,
 * and a smoothed line between two of them draws growth that never happened.
 * No area fill, no axes, no tooltip — the number it sits beside is the value;
 * this only says what the approach to it looked like.
 *
 * Under two points there is nothing true to draw, so the box renders empty
 * rather than as a flat line, which would read as "no growth" instead of
 * "no data". The frame stays, so nothing reflows when the second name lands.
 */
export function StepSparkline({ points }: { points: RegPoint[] }) {
  const lang = useLang();
  const geom = useMemo(() => {
    const dated = points.filter((p) => Number.isFinite(p.at) && p.at > 0).sort((a, b) => a.at - b.at);
    if (dated.length < 2) return null;
    const t0 = dated[0].at;
    const span = dated[dated.length - 1].at - t0 || 1;
    const n = dated.length;
    const x = (at: number) => 1 + ((at - t0) / span) * (SPARK_W - 2);
    const y = (c: number) => SPARK_H - 2 - (c / n) * (SPARK_H - 4);
    let d = `M1,${y(0).toFixed(1)}`;
    dated.forEach((p, i) => {
      d += ` H${x(p.at).toFixed(1)} V${y(i + 1).toFixed(1)}`;
    });
    d += ` H${SPARK_W - 1}`;
    return { d, n, first: utcDay(t0, lang), last: utcDay(dated[dated.length - 1].at, lang) };
  }, [points, lang]);

  return (
    <svg
      className="spark-step"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label={
        geom
          ? t('spark.aria', { first: geom.first, last: geom.last, n: geom.n })
          : t('spark.aria.empty')
      }
    >
      {geom && <path d={geom.d} className="spark-step-line" />}
    </svg>
  );
}

/* ========================================================== D. chain vitals */

/** The ecosystem measurement one indexer run produced. */
export interface EcoSnapshot {
  measuredAt: number;
  headBlock: number;
  windowBlocks: number;
  windowSeconds: number;
  contractEvents: number;
  activeContracts: number;
  /**
   * Contract calls submitted in the window: every revive extrinsic.
   *
   * Optional because snapshots written before this counter existed do not
   * carry it, and a reader that finds it missing shows no rate at all
   * rather than falling back to the wrong one.
   */
  contractCalls?: number;
  /**
   * The busiest caller in the window and how many of its calls reverted.
   *
   * A revert rate without this is a trap. Measured over 201 blocks: 34
   * calls, 34 reverts, and 33 of them one address retrying one failing
   * call. "The ecosystem is 100% broken" and "one bot is in a loop" are the
   * same numbers, and only this field separates them.
   */
  topCaller?: { address: string; calls: number; reverts: number } | null;
  reverts: number;
  topContracts: { address: string; events: number }[];
  /**
   * Every address that emitted in the window, with its count — complete, not a
   * top-N. Optional only because a snapshot written before this field existed
   * must still parse; a reader that finds it missing shows no per-app figure at
   * all rather than inventing one.
   *
   * The window is repeated inside on purpose. A per-app count is meaningless
   * without its denominator, and carrying it here makes it impossible to render
   * the number beside the wrong one.
   */
  perContract?: {
    headBlock: number;
    windowBlocks: number;
    windowSeconds: number;
    events: Record<string, number>;
  };
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/**
 * Three chain-wide numbers, each with its denominator and its window.
 *
 * "25 reverts" is not a measurement — 25 out of how many, over what? Every
 * readout here reads `value · numerator of denominator · window`, because the
 * window is 151 blocks of a devnet and a reader who cannot see that will read
 * these as ecosystem totals.
 *
 * The single stacked bar shows the split the percentage claims: reverted calls
 * in --warn, successful contract events in --pink, and the neutral track behind
 * both, which is all you see before the first measurement lands.
 */
export function ChainVitals({ eco }: { eco: EcoSnapshot }) {
  const lang = useLang();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tipXY, setTipXY] = useState<{ left: number; top: number; wrap: number; wrapH: number } | null>(null);

  const measured = eco.windowBlocks > 0;

  /*
   * Calls, counted in calls.
   *
   * This used to divide by contractEvents + reverts, which adds an EVENT
   * count to an EXTRINSIC count. One call emits nought, one or ten events,
   * and a call that only writes state emits none at all, so the denominator
   * was never the number of calls and the percentage was never a rate. It
   * read 89% off three events beside twenty-five reverts.
   *
   * A percentage off a handful is an anecdote anyway: this window is five
   * minutes of a devnet and has been seen holding ten calls, every one an
   * unsigned revive.ethTransact from the same sender. Below the floor the
   * counts are shown and the percentage is not, because "100% reverted" out
   * of ten reads as a broken chain and means nothing of the kind.
   */
  const MIN_FOR_RATE = 30;
  const calls = eco.contractCalls;
  const haveCalls = typeof calls === 'number' && calls > 0;
  const rateWorthQuoting = haveCalls && (calls as number) >= MIN_FOR_RATE;

  /* When one address is most of the window, the rate is about that address
   * and not about the chain, and the readout has to say so. */
  const oneCaller =
    haveCalls && eco.topCaller && eco.topCaller.calls / (calls as number) >= 0.6
      ? eco.topCaller
      : null;
  const blockSec = measured ? eco.windowSeconds / eco.windowBlocks : 0;
  const perK = measured ? (eco.contractEvents / eco.windowBlocks) * 1000 : 0;
  const revertPct = haveCalls ? (eco.reverts / (calls as number)) * 100 : 0;
  const windowMin = Math.max(1, Math.round(eco.windowSeconds / 60));
  const top = eco.topContracts[0];

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setTipXY({ left: e.clientX - r.left, top: e.clientY - r.top + 8, wrap: r.width, wrapH: r.height });
  };

  return (
    <div className="vitals-strip" ref={wrapRef}>
      <div
        className="vitals-bar"
        onPointerMove={onMove}
        onPointerLeave={() => setTipXY(null)}
        tabIndex={0}
        role="img"
        aria-label={
          measured
            ? t('vitals.aria', {
                blocks: eco.windowBlocks,
                reverts: eco.reverts,
                events: eco.contractEvents,
                calls: calls ?? 0,
              })
            : t('vitals.aria.none')
        }
      >
        {measured && haveCalls && (
          <>
            <span
              className="vitals-seg is-revert"
              style={{ width: `${(eco.reverts / (calls as number)) * 100}%` }}
            />
            <span
              className="vitals-seg is-event"
              style={{ width: `${(Math.max(0, (calls as number) - eco.reverts) / (calls as number)) * 100}%` }}
            />
          </>
        )}
      </div>

      <div className="vitals-reads">
        <span className="vitals-read">
          <b className="mono">
            {measured
              ? t('vitals.blockTime', { s: blockSec.toFixed(1) })
              : t('vitals.measuring')}
          </b>
          <i>
            {measured
              ? t('vitals.blockTime.sub', {
                  blocks: fmt(eco.windowBlocks, lang),
                  secs: fmt(eco.windowSeconds, lang),
                  minutes: windowMin,
                })
              : t('vitals.blockTime.none')}
          </i>
        </span>
        <span className="vitals-read">
          <b className="mono">
            {measured ? t('vitals.events', { n: Math.round(perK) }) : t('vitals.measuring')}
          </b>
          <i>
            {measured
              ? eco.activeContracts === 1
                ? t('vitals.events.sub.one', {
                    events: fmt(eco.contractEvents, lang),
                    blocks: fmt(eco.windowBlocks, lang),
                  })
                : t('vitals.events.sub', {
                    events: fmt(eco.contractEvents, lang),
                    contracts: fmt(eco.activeContracts, lang),
                    blocks: fmt(eco.windowBlocks, lang),
                  })
              : t('vitals.events.none')}
          </i>
        </span>
        <span className="vitals-read">
          <b className={`mono${rateWorthQuoting ? ' is-warn' : ''}`}>
            {rateWorthQuoting
              ? t('vitals.reverts', { pct: Math.round(revertPct) })
              : haveCalls
                ? t('vitals.reverts.few', {
                    reverts: fmt(eco.reverts, lang),
                    calls: fmt(calls as number, lang),
                  })
                : t('vitals.measuring')}
          </b>
          <i>
            {oneCaller
              ? t('vitals.reverts.oneCaller', {
                  reverts: fmt(eco.reverts, lang),
                  calls: fmt(calls as number, lang),
                  share: Math.round((oneCaller.calls / (calls as number)) * 100),
                  addr: oneCaller.address.slice(0, 8) + '…' + oneCaller.address.slice(-4),
                  blocks: fmt(eco.windowBlocks, lang),
                  minutes: windowMin,
                })
              : rateWorthQuoting
                ? t('vitals.reverts.sub', {
                    reverts: fmt(eco.reverts, lang),
                    calls: fmt(calls as number, lang),
                    blocks: fmt(eco.windowBlocks, lang),
                    minutes: windowMin,
                  })
                : haveCalls
                  ? t('vitals.reverts.few.sub', {
                      blocks: fmt(eco.windowBlocks, lang),
                      minutes: windowMin,
                    })
                  : t('vitals.reverts.none')}
          </i>
        </span>
      </div>

      {tipXY && measured && (
        <div
          className={`chart-tip${tipAlign(tipXY.left, tipXY.wrap, tipXY.top, tipXY.wrapH)}`}
          style={{ left: `${tipXY.left}px`, top: `${tipXY.top}px` }}
        >
          <strong>
            {t('vitals.tip.calls', {
              calls: fmt(calls ?? 0, lang),
              blocks: fmt(eco.windowBlocks, lang),
            })}
          </strong>
          <span>
            {t('vitals.tip.split', {
              reverts: fmt(eco.reverts, lang),
              events: fmt(eco.contractEvents, lang),
            })}{' '}
            {/* The event name is an identifier from the chain, not prose. */}
            <code>revive.ContractEmitted</code>
          </span>
          {top && (
            <span>
              {t('vitals.tip.busiest', {
                address: shortAddr(top.address),
                events: fmt(top.events, lang),
                total: fmt(eco.contractEvents, lang),
              })}
            </span>
          )}
          <span>{t('vitals.tip.head', { head: fmt(eco.headBlock, lang) })}</span>
        </div>
      )}
    </div>
  );
}

/* ======================================================= E. survival / mortality */

/** One UTC day of the survival series. Extra fields on the JSON are ignored. */
export interface SurvivalPoint {
  /** ISO `YYYY-MM-DD`, the UTC day. */
  day: string;
  /** Bundles that answered the probe that day. */
  alive: number;
  /** Bundles with a contenthash that day — the denominator. */
  deployed: number;
}

/** One app the gateway has stopped serving. */
export interface Death {
  label: string;
  /** Unix seconds since which the bundle has been unreachable. */
  deadSince: number;
  /** Unix seconds it was last seen alive. */
  lastAliveAt: number;
  /** Whole days from first-seen to death, or null when first-seen is unknown. */
  lifespanDays: number | null;
}

const SURV_W = 460;
const SURV_H = 150;
const SURV_L = 30; // room for a two-digit y label
const SURV_R = 10;
const SURV_T = 10;
const SURV_B = 22; // room for the day labels

/**
 * Bundles still answering vs bundles deployed, one point per UTC day, plus the
 * headline the whole chart exists to earn: a median lifespan WITH the count of
 * apps it is a median over.
 *
 * This obeys the same rules as the four charts above. It never returns null: a
 * one-point series draws its two dots and says a line needs more days; a zero-
 * death graveyard is not hidden but stated, because "nothing has died yet" is a
 * finding about a young ecosystem, not an empty panel. And no number appears
 * without its denominator — the median carries "over N apps that have gone
 * dark", the empty case carries "all N deployed bundles answered".
 */
export function SurvivalChart({
  series,
  deaths,
  medianLifespanDays,
}: {
  series: SurvivalPoint[];
  deaths: Death[];
  medianLifespanDays: number | null;
}) {
  const lang = useLang();

  const pts = useMemo(
    () => series.filter((p) => Number.isFinite(p.deployed) && Number.isFinite(p.alive)),
    [series],
  );
  const n = pts.length;
  const last = n > 0 ? pts[n - 1] : null;
  const maxY = Math.max(1, ...pts.map((p) => p.deployed));

  const plotW = SURV_W - SURV_L - SURV_R;
  const plotH = SURV_H - SURV_T - SURV_B;
  const x = (i: number) => SURV_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => SURV_T + plotH - (v / maxY) * plotH;
  const path = (sel: (p: SurvivalPoint) => number) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(' ');

  const aria =
    n === 0
      ? t('survival.aria.empty')
      : n === 1
        ? t('survival.aria.one', { alive: last!.alive, deployed: last!.deployed })
        : t('survival.aria', { alive: last!.alive, deployed: last!.deployed, days: n });

  const deadCount = deaths.length;

  return (
    <div className="surv">
      <svg
        className="chart-svg surv-svg"
        width="100%"
        height={SURV_H}
        style={{ maxWidth: SURV_W }}
        viewBox={`0 0 ${SURV_W} ${SURV_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={aria}
      >
        {/* Baseline and ceiling only: 0 and the deployed count. Two gridlines,
            because the gap between the two series is the whole reading and more
            rules would only crowd it. */}
        {[0, maxY].map((v) => (
          <g key={v}>
            <line x1={SURV_L} y1={y(v)} x2={SURV_W - SURV_R} y2={y(v)} className="chart-grid" />
            <text x={SURV_L - 6} y={y(v) + 3} className="chart-axis" textAnchor="end">
              {fmt(v, lang)}
            </text>
          </g>
        ))}

        {/* Two lines only when two days exist to connect. */}
        {n >= 2 && (
          <>
            <path d={path((p) => p.deployed)} className="chart-line is-track" />
            <path d={path((p) => p.alive)} className="chart-line" />
          </>
        )}

        {/* Dots always, so a single day is a visible mark and not a blank. */}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.deployed)} r={2.5} className="surv-dot-dep" />
            <circle cx={x(i)} cy={y(p.alive)} r={2.5} className="surv-dot-alive" />
          </g>
        ))}

        {n > 0 && (
          <text
            x={x(0)}
            y={SURV_H - 6}
            className="chart-axis"
            textAnchor={n <= 1 ? 'middle' : 'start'}
          >
            {pts[0].day}
          </text>
        )}
        {n > 1 && (
          <text x={x(n - 1)} y={SURV_H - 6} className="chart-axis" textAnchor="end">
            {pts[n - 1].day}
          </text>
        )}
        {n === 0 && (
          <text
            x={SURV_W / 2}
            y={SURV_H / 2}
            className="chart-axis heat-empty"
            textAnchor="middle"
          >
            {t('survival.aria.empty')}
          </text>
        )}
      </svg>

      {n === 1 && <p className="surv-hint">{t('survival.day.hint')}</p>}

      {/* The headline. Zero deaths is stated with its denominator, not hidden. */}
      {deadCount === 0 ? (
        <p className="surv-median">
          {t('survival.deaths.none', { deployed: last ? fmt(last.deployed, lang) : '0' })}
        </p>
      ) : (
        <p className="surv-median">
          <b>
            {medianLifespanDays == null
              ? t('survival.median.unknown')
              : medianLifespanDays === 1
                ? t('survival.median.one')
                : t('survival.median', { days: fmt(medianLifespanDays, lang) })}
          </b>{' '}
          <span>
            {deadCount === 1
              ? t('survival.median.denom.one')
              : t('survival.median.denom', { n: fmt(deadCount, lang) })}
          </span>
        </p>
      )}

      {/* A short roll of what has gone dark, and for how long each lasted. Only
          when the graveyard is non-empty; when it is empty the line above has
          already said so. */}
      {deadCount > 0 && (
        <div className="surv-dead">
          <span className="surv-dead-h">{t('survival.dead.title')}</span>
          <ul>
            {deaths.map((d) => (
              <li key={d.label}>
                <span className="surv-dead-name">{d.label}</span>
                <span className="surv-dead-life">
                  {d.lifespanDays == null
                    ? t('survival.dead.lasted.unknown')
                    : d.lifespanDays === 1
                      ? t('survival.dead.lasted.one')
                      : t('survival.dead.lasted', { days: fmt(d.lifespanDays, lang) })}
                </span>
                <span className="surv-dead-since">
                  {t('survival.dead.since', { day: utcDay(d.deadSince, lang) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
