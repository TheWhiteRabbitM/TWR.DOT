import { useCallback, useEffect, useMemo, useState } from 'react';
import { lazy, Suspense } from 'react';
import type { App } from '@parity/product-sdk/core';
import { HeroPanel, RegistrationGrid } from './Charts';

/**
 * Lazy on purpose. The panel's module pulls in the product SDK and its chain
 * descriptors, which carry SCALE metadata for every supported chain — eight
 * chunks between 250 kB and 880 kB. Loading that for a reader who will never
 * sign would double the page for a feature they cannot use, and this page is
 * served from Bulletin. It arrives only when there is a host to sign with.
 */
const RegisterPanel = lazy(() => import('./RegisterPanel'));
import { Discoveries } from './Discoveries';
import { Retention } from './Retention';
import {
  DIRECTORY,
  readDirectory,
  readRecords,
  tierOf,
  type Records,
  type Snapshot,
  type Tier,
} from './chain';

const TIER_LABEL: Record<Tier, string> = {
  described: 'described',
  deployed: 'deployed',
  registered: 'name only',
};

/** Best first, so sorting by state puts the most complete apps on top. */
const TIER_RANK: Record<Tier, number> = { described: 0, deployed: 1, registered: 2 };

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

type SortKey = 'name' | 'state' | 'arrived';

interface Row {
  label: string;
  owner: string | null;
  firstSeenBlock: number;
  firstSeenAt: Date | null;
  rec: Records | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; snapshot: Snapshot };

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function App({ app }: { app: App | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [records, setRecords] = useState<Map<string, Records>>(new Map());
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<Tier | 'all'>('all');
  /** A category name, 'all', or '__none' for names that declared none. */
  const [catFilter, setCatFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('arrived');
  const [asc, setAsc] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    setRecords(new Map());
    setDetailError(null);
    try {
      const snapshot = await readDirectory();
      setState({ phase: 'ready', snapshot });
      const names = snapshot.labels.map((l) => l.label);
      void (async () => {
        try {
          setRecords(await readRecords(names));
        } catch (err) {
          setDetailError(err instanceof Error ? err.message : String(err));
        }
      })();
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const labels = state.phase === 'ready' ? state.snapshot.labels : [];

  const rows: Row[] = useMemo(
    () => labels.map((l) => ({ ...l, rec: records.get(l.label) ?? null })),
    [labels, records],
  );

  const tally = useMemo(() => {
    const t: Record<Tier, number> = { described: 0, deployed: 0, registered: 0 };
    for (const r of records.values()) t[tierOf(r)] += 1;
    return t;
  }, [records]);

  /** Rebuilt only when the snapshot is, so the sweep's effect does not restart
   *  on every keystroke in the filter box. */
  const known = useMemo(
    () =>
      new Set(state.phase === 'ready' ? state.snapshot.labels.map((l) => l.label) : []),
    [state],
  );

  /** Categories are owner-declared, so the list is whatever they actually used. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records.values()) {
      if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [records]);

  const uncategorised = useMemo(
    () => [...records.values()].filter((r) => !r.category).length,
    [records],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (tierFilter !== 'all' && (!r.rec || tierOf(r.rec) !== tierFilter)) return false;
      if (catFilter === '__none') {
        if (r.rec?.category) return false;
      } else if (catFilter !== 'all' && r.rec?.category !== catFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.label.includes(q) ||
        (r.owner ?? '').toLowerCase().includes(q) ||
        (r.rec?.category ?? '').includes(q) ||
        (r.rec?.displayName ?? '').toLowerCase().includes(q) ||
        (r.rec?.description ?? '').toLowerCase().includes(q)
      );
    });
    const dir = asc ? 1 : -1;
    return out.sort((a, b) => {
      if (sort === 'name') return a.label.localeCompare(b.label) * dir;
      if (sort === 'arrived') return (a.firstSeenBlock - b.firstSeenBlock) * dir;
      const ra = a.rec ? TIER_RANK[tierOf(a.rec)] : 9;
      const rb = b.rec ? TIER_RANK[tierOf(b.rec)] : 9;
      return (ra - rb) * dir || a.label.localeCompare(b.label);
    });
  }, [rows, query, tierFilter, catFilter, sort, asc]);

  const head = (key: SortKey, text: string) => (
    <button
      type="button"
      className={`th${sort === key ? ' sorted' : ''}`}
      aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}
      onClick={() => (sort === key ? setAsc((v) => !v) : (setSort(key), setAsc(key === 'name')))}
    >
      {text}
      <span className="caret">{sort === key ? (asc ? '▲' : '▼') : ''}</span>
    </button>
  );

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" /> read live from Asset Hub · no indexer
        </p>
        <h1>DotDirectory</h1>
        <p className="standfirst">
          Every <code>.dot</code> name, kept as plaintext on-chain. Nothing on this page was baked
          at build time.
        </p>
      </header>

      {state.phase === 'loading' ? <div className="panel">reading the contract…</div> : null}

      {state.phase === 'error' ? (
        <div className="panel error">
          <strong>Could not read the chain.</strong>
          <span>{state.message}</span>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {state.phase === 'ready' ? (
        <>
          <div className="charts">
            <HeroPanel labels={state.snapshot.labels} records={records} />
            <RegistrationGrid labels={state.snapshot.labels} />
          </div>

          {app ? (
            <Suspense fallback={null}>
              <RegisterPanel
                app={app}
                categories={categories.map(([name]) => name)}
                onChanged={() => void load()}
              />
            </Suspense>
          ) : null}

          {/* Categories are declared by the owners, so this row is whatever they
              actually chose — not a taxonomy we imposed. "unclassified" is shown
              with the rest because how much of the ecosystem says nothing about
              itself is a fact worth seeing, not one worth hiding. */}
          {categories.length > 0 ? (
            <div className="cats">
              <button
                type="button"
                className={`catchip${catFilter === 'all' && tierFilter === 'all' ? ' on' : ''}`}
                onClick={() => {
                  setCatFilter('all');
                  setTierFilter('all');
                }}
              >
                all <span>{records.size}</span>
              </button>
              {/* State sits beside category rather than in its own row of tiles:
                  both are ways of narrowing the same list, and the hero sentence
                  above already carries the counts. */}
              {(['described', 'deployed', 'registered'] as Tier[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`catchip state${tierFilter === t ? ' on' : ''}`}
                  onClick={() => setTierFilter((v) => (v === t ? 'all' : t))}
                >
                  {TIER_LABEL[t]} <span>{tally[t]}</span>
                </button>
              ))}
              <span className="catsep" aria-hidden="true" />
              {categories.map(([name, n]) => (
                <button
                  type="button"
                  key={name}
                  className={`catchip${catFilter === name ? ' on' : ''}`}
                  onClick={() => setCatFilter((v) => (v === name ? 'all' : name))}
                >
                  {name} <span>{n}</span>
                </button>
              ))}
              {uncategorised > 0 ? (
                <button
                  type="button"
                  className={`catchip muted${catFilter === '__none' ? ' on' : ''}`}
                  onClick={() => setCatFilter((v) => (v === '__none' ? 'all' : '__none'))}
                >
                  unclassified <span>{uncategorised}</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="controls">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter by name, title, description or owner…"
              aria-label="Filter the directory"
            />
            {tierFilter !== 'all' ? (
              <button type="button" className="clear" onClick={() => setTierFilter('all')}>
                {TIER_LABEL[tierFilter]} ✕
              </button>
            ) : null}
            <button type="button" className="clear" onClick={() => void load()}>
              Re-read
            </button>
            <span className="count">
              {visible.length} of {state.snapshot.labels.length}
            </span>
          </div>

          <div className="table" role="table">
            <div className="tr th-row" role="row">
              {head('name', 'Name')}
              {head('state', 'State')}
              <span className="th static">Owner</span>
              {head('arrived', 'Arrived')}
            </div>

            {visible.length === 0 ? (
              <p className="empty">Nothing matches that.</p>
            ) : (
              visible.map((r) => (
                <a
                  className="tr"
                  role="row"
                  key={r.label}
                  href={`https://${r.label}.dot.li`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="td name">
                    {r.label}
                    <em>.dot</em>
                    {r.rec?.displayName && r.rec.displayName.toLowerCase() !== r.label ? (
                      <span className="alias">{r.rec.displayName}</span>
                    ) : null}
                  </span>
                  <span className="td" data-label="State">
                    {r.rec ? (
                      <span className={`tier ${tierOf(r.rec)}`}>{TIER_LABEL[tierOf(r.rec)]}</span>
                    ) : (
                      <span className="pending">reading…</span>
                    )}
                    {r.rec?.category ? <span className="cat">{r.rec.category}</span> : null}
                  </span>
                  <span className="td owner" data-label="Owner">
                    {r.owner ? short(r.owner) : '—'}
                  </span>
                  <span className="td arrived" data-label="Arrived">
                    {r.firstSeenAt ? DATE_FMT.format(r.firstSeenAt) : '—'}
                  </span>
                  {/* The description gets its own line rather than a column: it
                      is free text of unpredictable length, and squeezing it into
                      a fifth column is what pushed the table off the screen. */}
                  {r.rec?.description ? (
                    <span className="td desc">{r.rec.description}</span>
                  ) : null}
                </a>
              ))
            )}
          </div>

          {state.phase === 'ready' ? (
            <Discoveries known={known} seed={state.snapshot.blockNumber} onAnnounce={null} />
          ) : null}

          {detailError ? (
            <p className="detail-error">
              Records could not be read in full: {detailError}. The list above is still what the
              contract holds.
            </p>
          ) : null}

          <footer>
            <Retention />
            <div className="prov">
              <span>
                block <strong>{state.snapshot.blockNumber.toLocaleString('en-GB')}</strong>
              </span>
              <span>
                block time <strong>{state.snapshot.blockSeconds.toFixed(1)}s</strong>
              </span>
              <span>
                last change <strong>{state.snapshot.lastChangedAt.toLocaleString('en-GB')}</strong>
              </span>
              <span>
                via <strong>{state.snapshot.endpoint}</strong>
                {state.snapshot.failedOver.length
                  ? ` after ${state.snapshot.failedOver.join(', ')} refused`
                  : ''}
              </span>
            </div>

            <details className="why">
              <summary>Why this contract exists</summary>
              <p>
                DotNS is ENS-style: names are keys in a namehash-mapped store, and the registry's
                events carry the <em>hash</em> of a name, never its text. The chain cannot be asked
                what names exist — only who owns <code>namehash(x)</code> for an <code>x</code> you
                already have, and a hash does not run backwards.
              </p>
              <p>
                Discovery therefore meant walking every block and scraping ascii out of raw
                extrinsic bytes: a machine, thirty minutes, and a schedule that in August 2026 fell
                three days behind the chain. This contract keeps the plaintext on-chain instead, so
                the same discovery is a handful of calls and a browser can do it alone.
              </p>
              <p>
                Announcing is open to anyone and stores a label only if the registry gives it an
                owner. Pruning is open to anyone and removes one only if the registry says it is
                gone. No admin, no owner, no pause.
              </p>
              <p className="addr">
                <code>{DIRECTORY}</code>
              </p>
            </details>
          </footer>
        </>
      ) : null}
    </div>
  );
}
