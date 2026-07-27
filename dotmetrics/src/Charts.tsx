import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Unix seconds → "Jul 24" in UTC. */
function utcDay(unix: number): string {
  const d = new Date(unix * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Where a `.chart-tip` may sit without being cut off.
 *
 * `.panel` clips its overflow, so the sheet's default "float above the point"
 * transform puts a tooltip on the top row of a grid outside the card and out of
 * sight. Every tip here therefore hangs BELOW its anchor, and near a left or
 * right edge it stops centring and pins to that edge instead — a tooltip that
 * runs off the side of a phone is no tooltip at all.
 */
const TIP_MARGIN = 96;

function tipAlign(left: number, wrapWidth: number): string {
  if (left < TIP_MARGIN) return ' tip-below tip-l';
  if (left > wrapWidth - TIP_MARGIN) return ' tip-below tip-r';
  return ' tip-below';
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

  let readout: string;
  if (dead) readout = 'no block feed';
  else if (head == null) readout = 'waiting for heads';
  else if (stalled) readout = `stalled ${Math.round(silence / 1000)}s`;
  else readout = `#${fmt(head)}${mean != null ? ` · ${mean.toFixed(1)}s avg` : ''}`;

  const label =
    head == null
      ? dead
        ? 'Block pulse: the block feed could not be reached'
        : 'Block pulse: no heads received yet'
      : stalled
        ? `Block pulse stalled: no new head for ${Math.round(silence / 1000)} seconds, last was ${head}`
        : `Block pulse: head ${head}${mean != null ? `, ${mean.toFixed(1)} second mean interval over the last ${gaps.length} blocks` : ''}`;

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null);
  const [tipXY, setTipXY] = useState<{ left: number; top: number; wrap: number } | null>(null);

  const { rows, max, total } = useMemo(() => {
    const dated = points.filter((p) => Number.isFinite(p.at) && p.at > 0);
    const byDay = new Map<number, HeatRow>();
    for (const p of dated) {
      const dayIndex = Math.floor(p.at / 86_400);
      let row = byDay.get(dayIndex);
      if (!row) {
        row = {
          dayIndex,
          label: utcDay(dayIndex * 86_400),
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
          label: utcDay(d * 86_400),
          total: 0,
          hours: Array.from({ length: COLS }, () => [] as string[]),
        },
      );
    }
    let peak = 0;
    for (const r of out) for (const h of r.hours) peak = Math.max(peak, h.length);
    return { rows: out, max: peak, total: dated.length };
  }, [points]);

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
            ? 'Registration heatmap: no registrations in the indexed range'
            : `Registration heatmap: ${total} registrations across ${rows.length} UTC days, peak ${max} in one hour. Arrow keys move between cells.`
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
          UTC
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
              0 registrations in the indexed range — the grid fills as names arrive.
            </text>
          </>
        )}
      </svg>
      </div>

      {cell && tipXY && hovered && hoveredRow && (
        <div
          className={`chart-tip${tipAlign(tipXY.left, tipXY.wrap)}`}
          style={{ left: `${tipXY.left}px`, top: `${tipXY.top}px` }}
        >
          <strong>
            {hovered.length} name{hovered.length === 1 ? '' : 's'} registered
          </strong>
          <span>
            {hoveredRow.label}, {String(cell.col).padStart(2, '0')}:00 UTC
          </span>
          {hovered.length > 0 && (
            <span>
              {hovered.slice(0, 4).join(', ')}
              {hovered.length > 4 ? ` +${hovered.length - 4} more` : ''}
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
    return { d, n, first: utcDay(t0), last: utcDay(dated[dated.length - 1].at) };
  }, [points]);

  return (
    <svg
      className="spark-step"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label={
        geom
          ? `Cumulative registrations, ${geom.first} to ${geom.last}, rising to ${geom.n}`
          : 'Cumulative registrations: fewer than two dated registrations, nothing to plot'
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
  reverts: number;
  topContracts: { address: string; events: number }[];
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tipXY, setTipXY] = useState<{ left: number; top: number; wrap: number } | null>(null);

  const measured = eco.windowBlocks > 0;
  const calls = eco.contractEvents + eco.reverts;
  const blockSec = measured ? eco.windowSeconds / eco.windowBlocks : 0;
  const perK = measured ? (eco.contractEvents / eco.windowBlocks) * 1000 : 0;
  const revertPct = calls > 0 ? (eco.reverts / calls) * 100 : 0;
  const windowMin = Math.max(1, Math.round(eco.windowSeconds / 60));
  const top = eco.topContracts[0];

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setTipXY({ left: e.clientX - r.left, top: e.clientY - r.top + 8, wrap: r.width });
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
            ? `Call outcomes over the last ${eco.windowBlocks} blocks: ${eco.reverts} reverted and ${eco.contractEvents} emitted, of ${calls} calls`
            : 'Call outcomes: not measured yet'
        }
      >
        {measured && calls > 0 && (
          <>
            <span
              className="vitals-seg is-revert"
              style={{ width: `${(eco.reverts / calls) * 100}%` }}
            />
            <span
              className="vitals-seg is-event"
              style={{ width: `${(eco.contractEvents / calls) * 100}%` }}
            />
          </>
        )}
      </div>

      <div className="vitals-reads">
        <span className="vitals-read">
          <b className="mono">{measured ? `${blockSec.toFixed(1)}s blocks` : 'measuring…'}</b>
          <i>
            {measured
              ? `${fmt(eco.windowBlocks)} blocks in ${fmt(eco.windowSeconds)}s (~${windowMin} min)`
              : 'no window measured yet'}
          </i>
        </span>
        <span className="vitals-read">
          <b className="mono">
            {measured ? `${Math.round(perK)} events / 1k blocks` : 'measuring…'}
          </b>
          <i>
            {measured
              ? `${fmt(eco.contractEvents)} events from ${fmt(eco.activeContracts)} contract${eco.activeContracts === 1 ? '' : 's'} · last ${fmt(eco.windowBlocks)} blocks`
              : 'no events counted yet'}
          </i>
        </span>
        <span className="vitals-read">
          <b className={`mono${calls > 0 ? ' is-warn' : ''}`}>
            {calls > 0 ? `${Math.round(revertPct)}% reverted` : 'measuring…'}
          </b>
          <i>
            {calls > 0
              ? `${fmt(eco.reverts)} of ${fmt(calls)} calls · last ${fmt(eco.windowBlocks)} blocks (~${windowMin} min)`
              : 'no calls seen in the window'}
          </i>
        </span>
      </div>

      {tipXY && measured && (
        <div
          className={`chart-tip${tipAlign(tipXY.left, tipXY.wrap)}`}
          style={{ left: `${tipXY.left}px`, top: `${tipXY.top}px` }}
        >
          <strong>
            {fmt(calls)} contract calls in {fmt(eco.windowBlocks)} blocks
          </strong>
          <span>
            {fmt(eco.reverts)} reverted · {fmt(eco.contractEvents)} emitted{' '}
            <code>revive.ContractEmitted</code>
          </span>
          {top && (
            <span>
              busiest {shortAddr(top.address)} · {fmt(top.events)} of {fmt(eco.contractEvents)}{' '}
              events
            </span>
          )}
          <span>measured at head #{fmt(eco.headBlock)}</span>
        </div>
      )}
    </div>
  );
}
