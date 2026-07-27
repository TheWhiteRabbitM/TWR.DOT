import { useCallback, useEffect, useMemo, useState } from 'react';
import { APPS, buildApps, type Discovered } from './lib/registry';
import { loadDirectory, type DirectorySource } from './lib/directory';
import { startLiveTail } from './lib/livetail';
import { readContract, ping } from './lib/chain';
import { CONTENT_RESOLVER, REGISTRY } from './lib/dotns';
import {
  ChainVitals,
  PulseStrip,
  RegistrationHeatmap,
  StepSparkline,
  type EcoSnapshot,
  type HeadBeat,
  type RegPoint,
} from './Charts';
import { openAppChat } from './lib/host-chat';
import { openExternal } from './lib/host-nav';
import ecosystemSnapshot from './lib/ecosystem.json';
import type { AppEntry, AppStats } from './lib/types';

/**
 * dotmetrics — the index of the .dot ecosystem.
 *
 * This page used to be an analytics console. It was the wrong product: 42 apps
 * and three days of history do not fill a console, and the charts that filled it
 * were drawing shapes that the data did not contain. What does not exist
 * anywhere else is a SEARCHABLE, ATTRIBUTED list of .dot apps — the official
 * directory holds 19 labelhashes nobody can turn back into names, and we hold 42
 * names with an owner, a tier and a manifest each. So: search first, ranked
 * index second, analytics demoted to supporting evidence at the bottom.
 *
 * Every number on this page is a chain fact with a stated denominator and
 * window. There is no quality score anywhere — a "tier" says what exists on
 * chain (a manifest, a contenthash, nothing), never how good an app is, and
 * every row can be expanded to read its tier back in words.
 */

const eco = ecosystemSnapshot as EcoSnapshot;

/**
 * Layout for the sections this redesign introduced.
 *
 * It lives here rather than in styles.css because that file belongs to another
 * pass and this one owns only App.tsx and Charts.tsx. It adds no colours, no
 * radii and no type steps of its own — every value below is a token from
 * styles.css. Lift it into styles.css verbatim when the two passes merge; it is
 * a single contiguous block for exactly that reason.
 */
const LAYOUT_CSS = `
/* ---- search: the first interactive element on the page ---- */
.find { position: relative; display: flex; align-items: center; margin-top: var(--sp-4); }
.find-in {
  width: 100%; height: var(--sp-12); padding: 0 var(--sp-12) 0 var(--sp-4);
  border: 1px solid var(--line-strong); border-radius: var(--r-1);
  background: var(--bg-1); color: var(--tx-hi);
  /* 16px literal: anything smaller makes iOS Safari zoom the whole page on
     focus, and this app is opened inside a phone shell more often than not. */
  font-size: 16px; outline: none;
}
.find-in::placeholder { color: var(--tx-low); }
.find-in:focus { border-color: var(--pink); outline: 2px solid var(--pink); outline-offset: 1px; }
.find-clear {
  position: absolute; right: var(--sp-2); width: var(--sp-8); height: var(--sp-8);
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: var(--r-1); background: var(--bg-3);
  color: var(--tx-mid); font-size: var(--fs-3); line-height: 1; cursor: pointer;
}
.find-clear:hover { background: var(--bg-4); color: var(--tx-hi); }

/* ---- status line: one hero number, one step spark, one 12px line ---- */
.lede { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; padding: var(--sp-5) 0 var(--sp-2); }
.lede-n { font-size: var(--fs-6); font-weight: 600; line-height: 1; letter-spacing: -0.02em; color: var(--tx-hi); }
.lede-t { font-size: var(--fs-1); line-height: 1.4; color: var(--tx-mid); }
.lede-t b { font-weight: 500; color: var(--tx-hi); }
.lede-t .is-stale { color: var(--warn); }
.spark-step { flex: none; display: block; }
.spark-step-line { fill: none; stroke: var(--pink); stroke-width: 1.5; stroke-linecap: butt; stroke-linejoin: miter; }

/* ---- facets: one row, scrolled sideways, never wrapped ---- */
.facets { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.facets::-webkit-scrollbar { display: none; }
.facet { flex: none; }

/* ---- the index ---- */
.idx { margin-bottom: var(--sp-6); }
/* 72px exactly: 8+8 padding around three fixed line boxes (20 + 14 + 18) and
   two 2px gaps. The line-heights are pinned rather than inherited so a long
   display name cannot silently grow every row in the index. */
.idx-row { align-items: flex-start; min-height: 88px; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); }
.idx-ico {
  width: var(--sp-6); height: var(--sp-6); flex: none; margin-top: 2px; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--r-1); background: var(--bg-3); color: var(--tx-mid);
  font-size: var(--fs-1); font-weight: 600; text-transform: uppercase;
}
.idx-ico img { width: 100%; height: 100%; object-fit: cover; display: block; }
.idx-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.idx-l1 { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); height: var(--sp-6); }
.idx-title { font-size: var(--fs-3); font-weight: 500; line-height: var(--sp-6); color: var(--tx-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.idx-l2 { display: flex; align-items: baseline; gap: var(--sp-2); height: 16px; font-family: var(--mono); font-size: var(--fs-0); line-height: 16px; color: var(--tx-low); min-width: 0; }
.idx-l2 i { font-style: normal; white-space: nowrap; }
/* min-height, not height: a fixed height plus wrapping text cut descriptions
   mid-line with no ellipsis. The clamp is what limits the lines. */
.idx-l3 { min-height: 20px; font-size: var(--fs-2); line-height: 20px; color: var(--tx-mid); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
.idx-val { flex: none; align-self: center; text-align: right; }
.idx-val b { display: block; font-size: var(--fs-4); font-weight: 600; color: var(--tx-hi); }
.idx-val i { display: block; font-style: normal; font-size: var(--fs-0); color: var(--tx-low); }
.idx-detail {
  padding: 0 var(--sp-4) var(--sp-4) calc(var(--sp-4) + var(--sp-6) + var(--sp-3));
  background: var(--bg-2); border-bottom: 1px solid var(--line);
}
.idx-why { margin: 0 0 var(--sp-3); font-size: var(--fs-2); line-height: 1.45; color: var(--tx-hi); }
.idx-why b { font-weight: 600; }
.idx-empty { padding: var(--sp-6) var(--sp-4); text-align: center; font-size: var(--fs-2); color: var(--tx-low); }
.idx-count { padding: var(--sp-2) 0 var(--sp-3); font-size: var(--fs-1); color: var(--tx-low); }

/* ---- A. pulse strip ---- */
.pulsestrip { display: flex; align-items: center; gap: var(--sp-3); }
.pulsestrip-ticks { display: flex; align-items: center; gap: 2px; height: 12px; }
.pulsestrip-tick { width: 3px; height: 12px; flex: none; background: var(--bg-4); }
.pulsestrip-tick.is-on { background: var(--pink-fill); }
.pulsestrip.is-stalled .pulsestrip-tick { background: var(--bg-3); }
.pulsestrip.is-stalled .pulsestrip-tick.is-on { background: var(--warn); }
.pulsestrip-read { font-size: var(--fs-1); color: var(--tx-mid); white-space: nowrap; }
.pulsestrip-read.is-warn { color: var(--warn); }

/* ---- B. registration heatmap ---- */
.heatwrap { position: relative; padding: var(--sp-1) var(--sp-3) var(--sp-3); }
.heat-scroll { overflow-x: auto; scrollbar-width: thin; }
.heat-svg { display: block; }
.heat-track { fill: var(--bg-3); }
.heat-fill { fill: var(--pink-fill); }
.heat-focus { fill: none; stroke: var(--pink); stroke-width: 1.5; }
.heat-total { fill: var(--tx-mid); font-weight: 500; }
.heat-veil { fill: var(--bg-1); opacity: 0.86; }
.heat-empty { fill: var(--tx-mid); }

/* ---- D. chain vitals ---- */
.vitals-strip { position: relative; min-height: var(--sp-16); display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4) var(--sp-3); }
.vitals-bar { display: flex; height: 6px; border-radius: var(--r-1); background: var(--bg-4); overflow: hidden; }
.vitals-seg { display: block; height: 100%; }
.vitals-seg.is-revert { background: var(--warn); }
.vitals-seg.is-event { background: var(--pink-fill); }
.vitals-reads { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-6); }
.vitals-read { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vitals-read b { font-size: var(--fs-2); font-weight: 600; line-height: 16px; color: var(--tx-hi); }
.vitals-read b.is-warn { color: var(--warn); }
.vitals-read i { font-style: normal; font-size: var(--fs-0); line-height: 13px; color: var(--tx-low); }

/* ---- tooltips: below the anchor, and pinned inside the card at the edges.
   .panel clips its overflow, so the sheet's default "float above" transform
   puts a top-row tooltip outside the card entirely. ---- */
.chart-tip.tip-below { transform: translate(-50%, var(--sp-2)); white-space: normal; max-width: 17rem; }
.chart-tip.tip-below.tip-l { transform: translate(0, var(--sp-2)); }
.chart-tip.tip-below.tip-r { transform: translate(-100%, var(--sp-2)); }

/* ---- method + footer ---- */
.method p + p { padding-top: 0; }
.method ul { margin: 0; padding: 0 var(--sp-3) var(--sp-3) calc(var(--sp-3) + var(--sp-4)); }
.method li { margin: 0 0 2px; }
.method .mono { overflow-wrap: anywhere; }
.foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--sp-2) var(--sp-4); margin-top: var(--sp-6); }
.foot-prov { font-family: var(--mono); font-size: var(--fs-0); color: var(--tx-low); overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .pulsestrip-ticks { display: none; }
  /* Two lines on a phone: one line of 14px text truncates most of these
     descriptions to uselessness, and the extra row height is what stops the
     list reading as a wall. */
  .idx-l3 { -webkit-line-clamp: 2; }
}
`;

const REFRESH_MS = 20_000;

/* ------------------------------------------------------------- formatting */

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function ago(unixSeconds: number | null): string {
  if (!unixSeconds) return '—';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return h === 1 ? '1h ago' : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function exactUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/* --------------------------------------------------------------- the tiers */

const TIER_NAME = ['live data', 'published', 'deployed', 'name only'] as const;
const TIER_CLASS = ['is-live', 'is-published', 'is-deployed', 'is-name'] as const;

/**
 * Why this name sits where it sits, in words.
 *
 * A ranking nobody can inspect is a ranking nobody should trust, so every
 * expanded row states the chain fact that produced its tier. None of these
 * sentences is a judgement: they describe records that either exist or do not.
 */
function tierReason(e: AppEntry): string {
  switch (e.tier) {
    case 0:
      return 'Live data — dotmetrics holds a reader for this app’s own contract, so the figure on its row is measured from chain state, not reported by the app.';
    case 1:
      return e.contenthash
        ? 'Published — a manifest record on the content resolver names and describes it, and a contenthash points at the deployed bundle.'
        : 'Published — a manifest record names and describes it, but there is no contenthash: nothing is deployed behind the name yet.';
    case 2:
      return 'Deployed — a contenthash points at a bundle, but no manifest record describes it, so the name and the bundle are all the chain will tell us.';
    default:
      return 'No contenthash — name registered, nothing deployed.';
  }
}

/* ------------------------------------------------------------------- data */

interface Ecosystem {
  apps: AppEntry[];
  stats: Record<string, AppStats>;
  online: boolean | null;
  source: DirectorySource;
  directoryCid: string | null;
  excluded: string[];
  beat: HeadBeat | null;
  tailUp: boolean | null;
}

function useEcosystem(): Ecosystem {
  // Start from the baked directory so the index renders instantly, then swap in
  // the copy fetched from Bulletin once it arrives.
  const [apps, setApps] = useState<AppEntry[]>(APPS);
  const [source, setSource] = useState<DirectorySource>('baked');
  const [directoryCid, setDirectoryCid] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, AppStats>>({});
  const [online, setOnline] = useState<boolean | null>(null);
  /** The newest head the live tail has seen. Drives the pulse strip, nothing else. */
  const [beat, setBeat] = useState<HeadBeat | null>(null);
  /** `false` once the tail's socket has failed — "no feed" is not "still waiting". */
  const [tailUp, setTailUp] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void loadDirectory().then((result) => {
      if (cancelled) return;
      setApps(result.apps);
      setSource(result.source);
      setDirectoryCid(result.cid);
      setExcluded(result.excluded);

      const found: Record<string, Discovered> = {};
      const known = new Set(result.apps.map((a) => a.id));
      const checkpoint = result.apps.reduce((m, a) => Math.max(m, a.firstSeenBlock ?? 0), 0);
      void startLiveTail(
        known,
        checkpoint,
        (app) => {
          if (cancelled) return;
          found[app.label] = app;
          const fresh = buildApps(found).filter((e) => !known.has(e.id));
          setApps((prev) => {
            const have = new Set(prev.map((a) => a.id));
            return [...fresh.filter((e) => !have.has(e.id)), ...prev];
          });
        },
        (up) => {
          if (!cancelled) setTailUp(up);
        },
        (block) => {
          if (!cancelled) setBeat({ number: block, at: Date.now() });
        },
      ).then((t) => {
        stop = t.stop;
        if (cancelled) t.stop();
      });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const load = useCallback(() => {
    void ping().then(setOnline);
    for (const entry of apps) {
      if (!entry.read) continue; // indexed but no reader: listed, not measured
      void entry
        .read(readContract)
        .then((s) => setStats((prev) => ({ ...prev, [entry.id]: s })))
        .catch(() => {
          /* a failed read leaves the previous value standing, never a zero */
        });
    }
  }, [apps]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return { apps, stats, online, source, directoryCid, excluded, beat, tailUp };
}

/* ------------------------------------------------------------ leaving here */

/**
 * Leave for one of the indexed apps.
 *
 * Inside the shell the `.dot` name is the better destination: the host resolves
 * it as a deep link to the sibling app, which is what a directory of .dot apps
 * should hand you. Outside there is no resolver, so only the public gateway URL
 * works — and that is what stays in the anchor's `href` so right-click and
 * standalone use still land somewhere real.
 */
async function openEntry(entry: AppEntry): Promise<void> {
  let url = entry.url;
  try {
    const host = await import('@parity/product-sdk-host');
    if (host.isInsideContainerSync()) url = `https://${entry.domain}`;
  } catch {
    // No SDK at all means no shell, so the gateway URL stands.
  }
  await openExternal(url);
}

/* ------------------------------------------------------------- index row */

function AppIcon({ entry }: { entry: AppEntry }) {
  const [failed, setFailed] = useState(false);
  const mono = (entry.displayName ?? entry.id).trim().slice(0, 1) || '?';
  return (
    <span className="idx-ico" aria-hidden="true">
      {entry.iconCid && !failed ? (
        <img
          src={`https://dweb.link/ipfs/${entry.iconCid}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        mono
      )}
    </span>
  );
}

function IndexRow({
  entry,
  stats,
  open,
  onToggle,
}: {
  entry: AppEntry;
  stats: AppStats | null;
  open: boolean;
  onToggle: () => void;
}) {
  const title = entry.displayName ?? entry.name ?? entry.id;
  const tier = entry.tier;
  const detailId = `d-${entry.id}`;
  return (
    <>
      <div
        className={`idx-row${open ? ' is-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        onKeyDown={(e) => {
          // Rows used to be <tr onClick>: clickable with a mouse, invisible to
          // a keyboard. Enter and Space now do what the pointer does.
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <AppIcon entry={entry} />
        <span className="idx-main">
          <span className="idx-l1">
            <span className="idx-title">{title}</span>
            <span className={`badge ${TIER_CLASS[tier]}`}>{TIER_NAME[tier]}</span>
          </span>
          <span className="idx-l2">
            {entry.domain}
            <i>
              {entry.firstSeenAt ? `registered ${ago(entry.firstSeenAt)}` : 'before the indexed range'}
            </i>
          </span>
          <span className="idx-l3">
            {entry.description ?? (tier === 0 ? entry.tagline : 'No manifest record — the chain does not describe this name.')}
          </span>
        </span>
        {tier === 0 && (
          <span className="idx-val">
            {stats ? (
              <>
                <b>{fmt(stats.headline.value)}</b>
                <i>{stats.headline.label}</i>
              </>
            ) : (
              <i>reading…</i>
            )}
          </span>
        )}
      </div>

      {open && (
        <div className="idx-detail" id={detailId}>
          <p className="idx-why">{tierReason(entry)}</p>
          <div className="detail-grid">
            <div>
              <span className="detail-l">Owner</span>
              <span className="detail-v mono">{entry.owner || 'not recorded in this snapshot'}</span>
            </div>
            <div>
              <span className="detail-l">Contenthash</span>
              <span className="detail-v mono">{entry.contenthash ?? 'none'}</span>
            </div>
            <div>
              <span className="detail-l">Executable record</span>
              <span className="detail-v">
                {entry.hasExecutable
                  ? `present on app.${entry.id}.dot`
                  : `none on app.${entry.id}.dot`}
              </span>
            </div>
            <div>
              <span className="detail-l">Registered</span>
              <span className="detail-v mono">
                {entry.firstSeenBlock ? `#${fmt(entry.firstSeenBlock)}` : '—'}
                {entry.firstSeenAt ? ` · ${exactUtc(entry.firstSeenAt)}` : ''}
              </span>
            </div>
          </div>

          {stats && stats.metrics.length > 0 && (
            <p className="detail-tag">
              {stats.metrics.map((m) => `${fmt(m.value)} ${m.label}`).join(' · ')}
            </p>
          )}

          {/* The old page carried a global "Recent activity" feed. Only one app
              in the index actually produces one, so it belongs to that app's
              row rather than to the ecosystem. */}
          {stats && stats.activity.length > 0 && (
            <div className="feed">
              <ol>
                {stats.activity.map((item, i) => (
                  <li key={i}>
                    <span className="feed-app">{item.at ? ago(item.at) : 'recent'}</span>
                    <span className="feed-text">{item.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="detail-tag">
            <a
              className="detail-open"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                void openEntry(entry);
              }}
            >
              Open {entry.domain} ↗
            </a>
          </p>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ chat */

/** One-tap link into the Polkadot app's built-in chat. Footer, not masthead. */
function ChatButton() {
  const [label, setLabel] = useState('Chat');
  const go = async () => {
    setLabel('…');
    const r = await openAppChat('dotmetrics', 'dotmetrics community');
    // "registered" is a real outcome, not a failure: the room exists in the
    // user's chat list even when the host refuses to jump there for us.
    if (r.status === 'outside') setLabel('Chat lives inside the Polkadot app');
    else if (r.status === 'failed') setLabel('Chat unavailable right now');
    else if (r.status === 'registered') setLabel('Room added — open the Chat tab');
    else setLabel('Opened in chat ✓');
    window.setTimeout(() => setLabel('Chat'), 3200);
  };
  return (
    <button type="button" className="chat-cta" onClick={go}>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------- page */

type Facet = 'all' | 'live' | 'published' | 'deployed' | 'name' | 'new';

export function App() {
  const { apps, stats, online, source, directoryCid, excluded, beat, tailUp } = useEcosystem();

  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<Facet>('all');
  const [openApp, setOpenApp] = useState<string | null>(null);

  const startOfTodayUtc = useMemo(() => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  }, []);

  const counts = useMemo(() => {
    let live = 0;
    let published = 0;
    let deployed = 0;
    let nameOnly = 0;
    let today = 0;
    for (const a of apps) {
      if (a.tier === 0) live += 1;
      if (a.tier <= 1) published += 1;
      if (a.tier <= 2) deployed += 1;
      if (a.tier === 3) nameOnly += 1;
      if ((a.firstSeenAt ?? 0) >= startOfTodayUtc) today += 1;
    }
    return { all: apps.length, live, published, deployed, nameOnly, today };
  }, [apps, startOfTodayUtc]);

  /** Registrations, for the heatmap and the step spark. Undated names cannot be plotted. */
  const regPoints = useMemo<RegPoint[]>(
    () =>
      apps
        .filter((a) => (a.firstSeenAt ?? 0) > 0)
        .map((a) => ({ label: a.id, at: a.firstSeenAt as number })),
    [apps],
  );

  const searching = query.trim().length > 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Search always runs over the WHOLE index. A filter chip narrows a list;
    // it must never be able to hide a name someone typed the name of.
    const pool = q
      ? apps.filter((a) =>
          `${a.id} ${a.displayName ?? ''} ${a.name} ${a.description ?? ''}`
            .toLowerCase()
            .includes(q),
        )
      : apps.filter((a) => {
          switch (facet) {
            case 'live':
              return a.tier === 0;
            case 'published':
              return a.tier <= 1;
            case 'deployed':
              return a.tier <= 2;
            case 'name':
              return a.tier === 3;
            case 'new':
              return (a.firstSeenAt ?? 0) >= startOfTodayUtc;
            default:
              return true;
          }
        });
    // Tier first, then newest. Nothing here is a score: tier 0 leads because we
    // can show a measured number for it, not because it is "better".
    return [...pool].sort(
      (a, b) => a.tier - b.tier || (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0),
    );
  }, [apps, query, facet, startOfTodayUtc]);

  const facets: { key: Facet; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: counts.all },
    { key: 'live', label: 'Live data', n: counts.live },
    { key: 'published', label: 'Published', n: counts.published },
    { key: 'deployed', label: 'Deployed', n: counts.deployed },
    { key: 'name', label: 'Name only', n: counts.nameOnly },
    { key: 'new', label: 'New today', n: counts.today },
  ];

  const scanned = counts.all + excluded.length;
  const indexAge = Math.floor(Date.now() / 1000) - eco.measuredAt;

  return (
    <div className="app">
      <style>{LAYOUT_CSS}</style>

      {/* 1 ------------------------------------------------------------ bar */}
      <header className="bar">
        <h1>dotmetrics</h1>
        <span className="badge">devnet</span>
        <span className="bar-spacer" />
        <PulseStrip beat={beat} connected={tailUp} />
      </header>

      {/* 2 --------------------------------------------------------- search */}
      <div className="find">
        <input
          className="find-in"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${fmt(counts.all)} .dot apps by name or description`}
          aria-label="Search every indexed .dot name, display name and description"
        />
        {searching && (
          <button
            type="button"
            className="find-clear"
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* 3 ---------------------------------------------------- status line */}
      <div className="lede">
        <span className="lede-n">{fmt(counts.all)}</span>
        <StepSparkline points={regPoints} />
        <span className="lede-t">
          apps indexed · <b>{fmt(counts.deployed)}</b> deployed · <b>{fmt(counts.published)}</b>{' '}
          published · <b>{fmt(counts.live)}</b> with live data ·{' '}
          <span className={indexAge > 6 * 3600 ? 'is-stale' : undefined}>
            updated {ago(eco.measuredAt)}
          </span>
          {/* No manual refresh control: the contract reads re-run every 20s on
              their own and the pulse strip above already shows whether the
              chain is answering. A button here would only be a second way to
              do what the page is already doing. */}
          {online === false && <span className="is-stale"> · rpc unreachable</span>}
        </span>
      </div>

      {/* 4 ---------------------------------------------------------- facets */}
      <div className="facets" role="group" aria-label="Filter the index by what exists on chain">
        {facets.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`facet${!searching && facet === f.key ? ' is-on' : ''}`}
            aria-pressed={!searching && facet === f.key}
            onClick={() => {
              setQuery('');
              setFacet(f.key);
            }}
          >
            {f.label}
            <span className="facet-n">{fmt(f.n)}</span>
          </button>
        ))}
      </div>

      {/* 5 ----------------------------------------------------- the index */}
      <div className="idx-count">
        {searching ? (
          <>
            {fmt(shown.length)} of {fmt(counts.all)} names match “{query.trim()}” — search covers
            the whole index, not the selected filter.
          </>
        ) : (
          <>
            {fmt(shown.length)} names · ranked by what exists on chain, then newest first
          </>
        )}
      </div>

      <div className="idx">
        {shown.map((entry) => (
          <IndexRow
            key={entry.id}
            entry={entry}
            stats={stats[entry.id] ?? null}
            open={openApp === entry.id}
            onToggle={() => setOpenApp(openApp === entry.id ? null : entry.id)}
          />
        ))}
        {shown.length === 0 && (
          <div className="idx-empty">
            {searching
              ? `No name, display name or description in the index contains “${query.trim()}”.`
              : 'No name in the index matches this filter yet.'}
          </div>
        )}
      </div>

      {/* 6 -------------------------------------------------------- ecosystem */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Registrations</h2>
            <span className="panel-note">
              one cell per UTC hour · one row per UTC day · day total in the right gutter
            </span>
          </div>
          <span className="chart-legend">
            <span className="chart-swatch" aria-hidden="true" />
            names registered
          </span>
        </div>
        <RegistrationHeatmap points={regPoints} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Chain vitals</h2>
            <span className="panel-note">
              chain-wide, not per-app · measured {ago(eco.measuredAt)} at head #
              {fmt(eco.headBlock)}
            </span>
          </div>
          <span className="chart-legend">
            <span className="chart-swatch is-warn" aria-hidden="true" />
            reverted
            <span className="chart-swatch" aria-hidden="true" />
            emitted
          </span>
        </div>
        <ChainVitals eco={eco} />
      </div>

      {/* 7 ----------------------------------------------------------- method */}
      <details className="method">
        <summary>Method — how these names were found, and what was thrown away</summary>
        <p>
          Names are discovered by walking Asset Hub blocks — the registry can't be listed by a
          contract call, so the plaintext comes from registration calldata. Per-app usage can't be
          shown honestly: apps don't publish their contract address on-chain, so activity isn't
          attributable to a name. What's real is here — when each name was registered, and the
          ecosystem-wide contract events measured live. The four apps whose contract we do know
          also report their own on-chain reads.
        </p>
        <p>
          An ascii run in calldata is a lead, not a name. This scan proposed{' '}
          <b>{fmt(scanned)}</b> labels; <b>{fmt(excluded.length)}</b> of them returned a zero owner
          from <code className="mono">registry.owner(namehash(label + '.dot'))</code> and were
          never registrations at all, so <b>{fmt(counts.all)}</b> names remain. The rejected labels
          are listed rather than quietly dropped, because the gap between them is the difference
          between what a byte scan can see and what the registry actually holds:
        </p>
        <p className="mono">{excluded.length > 0 ? excluded.join(' · ') : 'none in this snapshot'}</p>
        <p>
          Records are read from the content resolver at{' '}
          <code className="mono">{CONTENT_RESOLVER}</code> directly, never by following{' '}
          <code className="mono">registry.resolver(node)</code> — that returns a dead resolver on
          this devnet whose <code className="mono">text()</code> and{' '}
          <code className="mono">contenthash()</code> revert for every name. Ownership comes from
          the registry at <code className="mono">{REGISTRY}</code>.
        </p>
        <p>
          Chain vitals count <code className="mono">revive.ContractEmitted</code> over the last{' '}
          {fmt(eco.windowBlocks)} blocks (~{Math.max(1, Math.round(eco.windowSeconds / 60))} min).
          Contracts are not attributable to .dot names, so this is ecosystem-wide. The busiest
          addresses in that window:
        </p>
        <ul>
          {eco.topContracts.length > 0 ? (
            eco.topContracts.map((t) => (
              <li key={t.address}>
                <span className="mono">{t.address}</span> — {fmt(t.events)} of{' '}
                {fmt(eco.contractEvents)} events
              </li>
            ))
          ) : (
            <li>no contract emitted an event in the measured window</li>
          )}
        </ul>
      </details>

      {/* 8 ----------------------------------------------------------- footer */}
      <div className="foot-row">
        <span className="foot-prov">
          {source === 'bulletin' && directoryCid ? (
            <>
              index live from Bulletin ·{' '}
              <a
                href={`https://dweb.link/ipfs/${directoryCid}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternal(`https://dweb.link/ipfs/${directoryCid}`);
                }}
              >
                {directoryCid}
              </a>
            </>
          ) : (
            'index from the snapshot baked into this build — Bulletin unreachable'
          )}
        </span>
        <ChatButton />
      </div>
      <footer className="foot">
        Every figure is read live from Polkadot devnet Asset Hub over a public Ethereum RPC — no
        wallet, no sign-in, no personhood. Test network: tokens carry no value.
      </footer>
    </div>
  );
}
