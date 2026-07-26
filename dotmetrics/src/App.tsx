import { useCallback, useEffect, useMemo, useState } from 'react';
import { APPS } from './lib/registry';
import { loadDirectory, type DirectorySource } from './lib/directory';
import { startLiveTail } from './lib/livetail';
import { buildApps, type Discovered } from './lib/registry';
import { readContract, ping } from './lib/chain';
import { RegistrationsTrend, RegsPerDay, Sparkline, type TrendPoint } from './Charts';
import { openAppChat } from './lib/host-chat';
import ecosystemSnapshot from './lib/ecosystem.json';
import historyRaw from './lib/history.json';
import type { AppEntry, AppStats } from './lib/types';

const eco = ecosystemSnapshot as {
  measuredAt: number;
  headBlock: number;
  windowBlocks: number;
  windowSeconds: number;
  contractEvents: number;
  activeContracts: number;
  reverts: number;
  topContracts: { address: string; events: number }[];
};

type SortKey = 'new' | 'old' | 'name';

interface HistoryPoint {
  at: number;
  head: number;
  events: number;
  reverts: number;
  contracts: number;
}

/** One point per 6-hourly refresh run — the self-building activity series. */
const HISTORY = historyRaw as HistoryPoint[];

/** Events measured per refresh run, as compact bars. Grows on its own. */
function ActivityHistory() {
  if (HISTORY.length < 2) return null;
  const max = Math.max(1, ...HISTORY.map((h) => h.events));
  return (
    <div className="hist">
      <span className="act-l">Events per measurement ({HISTORY.length} runs)</span>
      <div className="hist-bars" role="img" aria-label="Contract events measured per refresh run">
        {HISTORY.slice(-24).map((h) => (
          <span
            key={h.at}
            className="hist-bar"
            style={{ height: `${Math.max(8, (h.events / max) * 100)}%` }}
            title={`${new Date(h.at * 1000).toISOString().slice(5, 16).replace('T', ' ')} · ${h.events} events · ${h.reverts} reverts`}
          />
        ))}
      </div>
    </div>
  );
}

const REFRESH_MS = 20_000;

type Loaded = { entry: AppEntry; stats: AppStats | null; error: boolean };

function useEcosystem() {
  // Start from the baked directory so the table renders instantly, then swap in
  // the copy fetched from Bulletin once it arrives.
  const [apps, setApps] = useState<AppEntry[]>(APPS);
  const [source, setSource] = useState<DirectorySource>('baked');
  const [directoryCid, setDirectoryCid] = useState<string | null>(null);
  const [rows, setRows] = useState<Loaded[]>(() =>
    APPS.map((entry) => ({ entry, stats: null, error: false })),
  );
  const [online, setOnline] = useState<boolean | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [liveTail, setLiveTail] = useState<boolean | null>(null);

  // Pull the live directory from Bulletin once on mount, then start the
  // real-time registry tail: recent blocks are scanned in the browser and new
  // registrations stream in the moment they land — no waiting for the indexer.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void loadDirectory().then((result) => {
      if (cancelled) return;
      setApps(result.apps);
      setSource(result.source);
      setDirectoryCid(result.cid);
      setRows((prev) => {
        const byId = new Map(prev.map((r) => [r.entry.id, r]));
        return result.apps.map(
          (entry) => byId.get(entry.id) ?? { entry, stats: null, error: false },
        );
      });

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
          setRows((prev) => {
            const have = new Set(prev.map((r) => r.entry.id));
            const add = fresh
              .filter((e) => !have.has(e.id))
              .map((entry) => ({ entry, stats: null, error: false }));
            return [...add, ...prev];
          });
        },
        (ok) => !cancelled && setLiveTail(ok),
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
    apps.forEach((entry, i) => {
      if (!entry.read) return; // discovered but no known contract: listed only
      void entry
        .read(readContract)
        .then((stats) => {
          setRows((prev) => {
            const next = [...prev];
            if (next[i]?.entry.id === entry.id) next[i] = { entry, stats, error: false };
            return next;
          });
          setUpdatedAt(Math.floor(Date.now() / 1000));
        })
        .catch(() => {
          setRows((prev) => {
            const next = [...prev];
            if (next[i]?.entry.id === entry.id)
              next[i] = { entry, stats: next[i].stats, error: true };
            return next;
          });
        });
    });
  }, [apps]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return { rows, online, updatedAt, reload: load, source, directoryCid, liveTail };
}

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

/** One-tap link into the Polkadot app's built-in chat. */
function ChatButton() {
  const [label, setLabel] = useState('💬 Chat');
  const go = async () => {
    setLabel('…');
    const r = await openAppChat('dotmetrics', 'dotmetrics community');
    if (r === 'outside') setLabel('In-app only');
    else if (r === 'failed') setLabel('Unavailable');
    else setLabel('Added ✓');
    window.setTimeout(() => setLabel('💬 Chat'), 2400);
  };
  return (
    <button type="button" className="chat-cta" onClick={go}>
      {label}
    </button>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1a73e8" />
      <path d="M7 22l5-7 4 4 6-10" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="27" cy="9" r="2.2" fill="#8ab4f8" />
    </svg>
  );
}

/** Horizontal strip of the newest registrations (last 7 days), tap to open. */
function NewThisWeek({
  rows,
  onPick,
}: {
  rows: { entry: AppEntry }[];
  onPick: (id: string) => void;
}) {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const fresh = rows
    .filter((r) => (r.entry.firstSeenAt ?? 0) >= cutoff)
    .sort((a, b) => (b.entry.firstSeenAt ?? 0) - (a.entry.firstSeenAt ?? 0))
    .slice(0, 12);
  if (fresh.length < 3) return null;
  return (
    <div className="fresh">
      <span className="fresh-hd">New this week · {fresh.length}</span>
      <div className="fresh-row">
        {fresh.map(({ entry }) => (
          <button key={entry.id} className="fresh-chip" onClick={() => onPick(entry.id)}>
            <span className="fresh-glyph" style={{ background: entry.accent }}>
              {entry.glyph}
            </span>
            <span className="fresh-name">
              {entry.name}
              <span className="fresh-when">{entry.firstSeenAt ? ago(entry.firstSeenAt) : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One index row + its expandable detail entry (Search-Console style). */
function FragmentRow({
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
  const registered = entry.firstSeenAt
    ? new Date(entry.firstSeenAt * 1000).toUTCString().replace(' GMT', ' UTC')
    : null;
  return (
    <>
      <tr className={`idx-row${open ? ' is-open' : ''}`} onClick={onToggle}>
        <td>
          <div className="app-cell">
            <span className="glyph" style={{ background: entry.accent }} aria-hidden="true">
              {entry.glyph}
            </span>
            <span className="app-name">
              {entry.name}
              <span className="app-domain">{entry.domain}</span>
            </span>
          </div>
        </td>
        <td className="hide-sm">
          {entry.firstSeenAt ? (
            <>
              {ago(entry.firstSeenAt)}
              <div className="app-domain">block {fmt(entry.firstSeenBlock ?? 0)}</div>
            </>
          ) : (
            <span className="muted">before index</span>
          )}
        </td>
        <td className="num">
          {stats ? (
            <>
              <span className="big-num">{fmt(stats.headline.value)}</span>
              <div className="app-domain">{stats.headline.label}</div>
            </>
          ) : entry.read ? (
            <span className="muted">reading…</span>
          ) : (
            <span className="muted" title="This app doesn't publish its contract, so its activity isn't attributable.">
              —
            </span>
          )}
        </td>
        <td className="num">
          <a
            className="open-link"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${entry.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            ↗
          </a>
        </td>
      </tr>
      {open && (
        <tr className="idx-detail">
          <td colSpan={4}>
            <div className="detail">
              <div className="detail-grid">
                <div>
                  <span className="detail-l">Domain</span>
                  <span className="detail-v mono">{entry.domain}</span>
                </div>
                <div>
                  <span className="detail-l">Registered</span>
                  <span className="detail-v">{registered ?? 'before the indexed range'}</span>
                </div>
                <div>
                  <span className="detail-l">Registration block</span>
                  <span className="detail-v mono">
                    {entry.firstSeenBlock ? `#${fmt(entry.firstSeenBlock)}` : '—'}
                  </span>
                </div>
                <div>
                  <span className="detail-l">Live metrics</span>
                  <span className="detail-v">
                    {stats
                      ? `${fmt(stats.headline.value)} ${stats.headline.label}` +
                        stats.metrics.map((m) => ` · ${fmt(m.value)} ${m.label}`).join('')
                      : entry.read
                        ? 'reading…'
                        : 'not attributable — the app does not publish its contract address'}
                  </span>
                </div>
              </div>
              <p className="detail-tag">{entry.tagline}</p>
              <a className="detail-open" href={entry.url} target="_blank" rel="noreferrer">
                Open {entry.domain} ↗
              </a>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function App() {
  const { rows, online, updatedAt, reload, source, directoryCid, liveTail } = useEcosystem();

  const totals = useMemo(() => {
    let interactions = 0;
    let verified = 0;
    let live = 0;
    for (const { stats } of rows) {
      if (!stats) continue;
      live += 1;
      interactions += stats.headline.value;
      for (const m of stats.metrics) {
        if (m.label.includes('verified') && !m.label.includes('un')) verified += m.value;
      }
    }
    return { interactions, verified, apps: rows.length, live };
  }, [rows]);

  const newest = useMemo(
    () => rows.reduce((max, r) => Math.max(max, r.entry.firstSeenBlock ?? 0), 0),
    [rows],
  );

  const newestAt = useMemo(
    () => rows.reduce((max, r) => Math.max(max, r.entry.firstSeenAt ?? 0), 0),
    [rows],
  );

  const reg24h = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - 86_400;
    return rows.filter((r) => (r.entry.firstSeenAt ?? 0) >= cutoff).length;
  }, [rows]);

  // Index controls — the directory will only grow, so it is searchable, sortable
  // and paged rather than one ever-longer list.
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('new');
  const [showAll, setShowAll] = useState(false);
  /** Which app's index entry is expanded (Search-Console style detail). */
  const [openApp, setOpenApp] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter(
          (r) =>
            r.entry.name.toLowerCase().includes(q) || r.entry.domain.toLowerCase().includes(q),
        )
      : rows;
    return [...matched].sort((a, b) => {
      if (sort === 'name') return a.entry.name.localeCompare(b.entry.name);
      const av = a.entry.firstSeenBlock ?? 0;
      const bv = b.entry.firstSeenBlock ?? 0;
      return sort === 'new' ? bv - av : av - bv;
    });
  }, [rows, query, sort]);

  const PAGE = 12;
  const shown = showAll ? filtered : filtered.slice(0, PAGE);

  // Cumulative registrations over the indexed block range — the real growth
  // series behind the trend chart and the scorecard sparkline. Apps whose
  // registration predates the indexed window carry block 0 and are excluded so
  // the timeline starts at the first block we actually saw.
  const trend = useMemo<TrendPoint[]>(() => {
    const dated = rows
      .map((r) => ({ block: r.entry.firstSeenBlock ?? 0, at: r.entry.firstSeenAt, name: r.entry.id }))
      .filter((e) => e.block > 0)
      .sort((a, b) => a.block - b.block);
    return dated.map((e, i) => ({ block: e.block, at: e.at, count: i + 1, name: e.name }));
  }, [rows]);

  const feed = useMemo(() => {
    const items = rows.flatMap(({ stats }) => stats?.activity ?? []);
    return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 6);
  }, [rows]);

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <Logo />
          <div>
            <h1>dotmetrics</h1>
            <p>Analytics for the .dot app ecosystem · Polkadot devnet</p>
          </div>
        </div>
        <div className={`status ${online === false ? 'is-off' : online ? 'is-on' : ''}`}>
          <span className="dot" />
          {online === false ? 'offline' : online ? (liveTail ? 'LIVE · real-time' : 'Live data') : 'connecting'}
          <span className="status-time">· {ago(updatedAt)}</span>
          <button type="button" className="refresh" onClick={reload} aria-label="refresh">
            ↻
          </button>
        </div>
        <ChatButton />
      </header>

      <section className="totals">
        <div className="total is-primary">
          <span className="total-l">.dot apps registered</span>
          <div className="total-row">
            <span className="total-n accent-blue">{fmt(totals.apps)}</span>
            <Sparkline points={trend} />
          </div>
          <span className="total-sub">indexed on-chain to #{fmt(newest)}</span>
        </div>
        <div className="total">
          <span className="total-l">New in last 24h</span>
          <span className="total-n">{fmt(reg24h)}</span>
          <span className="total-sub">names registered</span>
        </div>
        <div className="total">
          <span className="total-l">Newest registration</span>
          <span className="total-n" style={{ fontSize: '26px', paddingTop: '0.5rem' }}>
            {newestAt ? ago(newestAt) : '—'}
          </span>
          <span className="total-sub">most recent name seen</span>
        </div>
        <div className="total">
          <span className="total-l">On-chain events</span>
          <span className="total-n accent-green">
            {eco.windowBlocks > 0 ? fmt(eco.contractEvents) : '—'}
          </span>
          <span className="total-sub">
            {eco.windowBlocks > 0
              ? `from ${eco.activeContracts} contract${eco.activeContracts === 1 ? '' : 's'} · last ${fmt(eco.windowBlocks)} blocks`
              : 'measuring…'}
          </span>
        </div>
      </section>

      {trend.length >= 2 && (
        <div className="panel chart-card">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Ecosystem growth</h2>
              <span className="panel-note">cumulative .dot registrations · indexed on-chain</span>
            </div>
            <span className="chart-legend">
              <span className="chart-swatch" aria-hidden="true" />
              apps registered
            </span>
          </div>
          <RegistrationsTrend points={trend} />
        </div>
      )}

      {trend.length >= 2 && (
        <div className="split">
          <div className="panel chart-card">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">New registrations per day</h2>
                <span className="panel-note">UTC days · from block timestamps</span>
              </div>
            </div>
            <RegsPerDay points={trend} />
          </div>

          <div className="panel chart-card">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Contract activity</h2>
                <span className="panel-note">
                  measured over the last {fmt(eco.windowBlocks)} blocks (~
                  {Math.round(eco.windowSeconds / 60)} min) · {ago(eco.measuredAt)}
                </span>
              </div>
            </div>
            <div className="act">
              <div className="act-row">
                <span className="act-l">Events emitted</span>
                <span className="act-n">{fmt(eco.contractEvents)}</span>
              </div>
              <div className="act-row">
                <span className="act-l">Active contracts</span>
                <span className="act-n">{fmt(eco.activeContracts)}</span>
              </div>
              <div className="act-row">
                <span className="act-l">Reverted calls</span>
                <span className="act-n">{fmt(eco.reverts)}</span>
              </div>
              {eco.topContracts.length > 0 && (
                <div className="act-top">
                  <span className="act-l">Most active contract</span>
                  {eco.topContracts.slice(0, 3).map((t) => (
                    <span className="act-addr" key={t.address} title={t.address}>
                      {t.address.slice(0, 10)}…{t.address.slice(-6)}
                      <b>{fmt(t.events)} ev</b>
                    </span>
                  ))}
                </div>
              )}
              <ActivityHistory />
              <p className="act-foot">
                Counted from <code>revive.ContractEmitted</code> events on Asset Hub. Contracts
                aren't attributable to .dot names — apps don't publish their address on-chain —
                so this is ecosystem-wide, not per-app.
              </p>
            </div>
          </div>
        </div>
      )}

      <NewThisWeek
        rows={rows}
        onPick={(id) => {
          // Make sure the picked row is actually visible, then open its entry.
          setQuery('');
          setSort('new');
          setShowAll(true);
          setOpenApp(id);
        }}
      />

      <div className="coverage">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2zm0-8h-2V7h2z" />
        </svg>
        <span>
          Names are discovered by walking Asset Hub blocks — the registry can't be listed by a
          contract call, so the plaintext comes from registration calldata. Per-app usage
          can't be shown honestly: apps don't publish their contract address on-chain, so
          activity isn't attributable to a name. What's real is here — when each name was
          registered, and the ecosystem-wide contract events measured live. The two apps whose
          contract we do know also report their own on-chain reads.
        </span>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">The .dot index</h2>
            <span className="panel-note">
              {source === 'bulletin' ? (
                <>
                  {fmt(rows.length)} names ·{' '}
                  <a
                    href={`https://dweb.link/ipfs/${directoryCid}`}
                    target="_blank"
                    rel="noreferrer"
                    title={directoryCid ?? undefined}
                  >
                    live from Bulletin
                  </a>
                </>
              ) : (
                `${fmt(rows.length)} names · baked snapshot`
              )}
            </span>
          </div>
          <div className="index-tools">
            <input
              type="search"
              className="index-search"
              placeholder="Search names…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowAll(true);
              }}
              aria-label="Search .dot names"
            />
            {/* Segmented buttons, not a native select: dropdowns don't open
                inside the host shell's sandboxed iframe. */}
            <div className="seg" role="tablist" aria-label="Sort">
              {(
                [
                  ['new', 'Newest'],
                  ['old', 'Oldest'],
                  ['name', 'A–Z'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={sort === k}
                  className={`seg-btn${sort === k ? ' on' : ''}`}
                  onClick={() => setSort(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="hide-sm">Registered</th>
                <th className="num">On-chain reads</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ entry, stats }) => (
                <FragmentRow
                  key={entry.id}
                  entry={entry}
                  stats={stats}
                  open={openApp === entry.id}
                  onToggle={() => setOpenApp(openApp === entry.id ? null : entry.id)}
                />
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                    No names match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!showAll && filtered.length > PAGE && (
          <button type="button" className="index-more" onClick={() => setShowAll(true)}>
            Show all {fmt(filtered.length)} names
          </button>
        )}
      </div>

      {feed.length > 0 && (
        <div className="panel feed">
          <div className="panel-head">
            <h2 className="panel-title">Recent activity</h2>
            <span className="panel-note">newest first</span>
          </div>
          <ol>
            {feed.map((item, i) => (
              <li key={i}>
                <span className="feed-app">{item.app}</span>
                <span className="feed-text">{item.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <footer className="foot">
        Every figure is read live from Polkadot devnet Asset Hub over a public Ethereum RPC —
        no wallet, no sign-in, no personhood. Test network: tokens carry no value.
      </footer>
    </div>
  );
}
