import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DIRECTORY,
  readDirectory,
  readRecords,
  tierOf,
  type Records,
  type Snapshot,
  type Tier,
} from './chain';

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const TIER_LABEL: Record<Tier, string> = {
  described: 'described',
  deployed: 'deployed',
  registered: 'name only',
};

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; snapshot: Snapshot };

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function App() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [records, setRecords] = useState<Map<string, Records>>(new Map());
  const [query, setQuery] = useState('');
  const [groupByOwner, setGroupByOwner] = useState(false);
  const [tierFilter, setTierFilter] = useState<Tier | 'all'>('all');
  /** A secondary read that failed. Shown rather than swallowed. */
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    setRecords(new Map());
    setDetailError(null);
    try {
      const snapshot = await readDirectory();
      setState({ phase: 'ready', snapshot });
      const names = snapshot.labels.map((l) => l.label);

      // Owners and arrival blocks now come with the list itself, so the only
      // remaining pass is the resolver records.
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = labels.map((l) => ({
      label: l.label,
      owner: l.owner,
      firstSeenAt: l.firstSeenAt,
      rec: records.get(l.label) ?? null,
    }));
    return rows.filter((r) => {
      if (tierFilter !== 'all' && (!r.rec || tierOf(r.rec) !== tierFilter)) return false;
      if (!q) return true;
      return (
        r.label.includes(q) ||
        (r.owner ?? '').toLowerCase().includes(q) ||
        (r.rec?.category ?? '').includes(q)
      );
    });
  }, [labels, records, query, tierFilter]);

  /** How many names sit at each tier, once their records have landed. */
  const tally = useMemo(() => {
    const t: Record<Tier, number> = { described: 0, deployed: 0, registered: 0 };
    for (const r of records.values()) t[tierOf(r)] += 1;
    return t;
  }, [records]);

  const byOwner = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of filtered) {
      if (!r.owner) continue;
      const list = map.get(r.owner) ?? [];
      list.push(r.label);
      map.set(r.owner, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">Read live from Asset Hub · no indexer · no snapshot</p>
        <h1>DotDirectory</h1>
        <p className="standfirst">
          Every <code>.dot</code> name registered on the devnet, kept as plaintext on-chain. This
          page ships with no data in it at all: the list you are reading was fetched from the
          contract when you opened it.
        </p>
      </header>

      <section className="why">
        <h2>Why this exists</h2>
        <p>
          DotNS is ENS-style — names are keys in a namehash-mapped store, and the registry's events
          carry the hash of a name, never its text. So there is no way to ask the chain what names
          exist, only who owns <code>namehash(x)</code> for an <code>x</code> you already have.
        </p>
        <p>
          Discovering them therefore meant walking every block and scraping plaintext out of raw
          extrinsic bytes — a job needing a machine, thirty minutes and a schedule, which in August
          2026 fell three days behind the chain and stayed there. This contract keeps the plaintext
          on-chain instead, so the same discovery is two calls and a browser can do it alone.
        </p>
        <p className="addr">
          Contract <code>{DIRECTORY}</code>
        </p>
      </section>

      {state.phase === 'loading' ? (
        <div className="panel loading">reading the contract…</div>
      ) : null}

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
          <div className="stats">
            <div className="stat">
              <span className="figure">{state.snapshot.labels.length}</span>
              <span className="label">names on-chain</span>
            </div>
            <div className="stat">
              <span className="figure">{tally.described || '—'}</span>
              <span className="label">described</span>
            </div>
            <div className="stat">
              <span className="figure">{tally.deployed || '—'}</span>
              <span className="label">deployed only</span>
            </div>
            <div className="stat">
              <span className="figure">{tally.registered || '—'}</span>
              <span className="label">name only</span>
            </div>
            <div className="stat">
              <span className="figure">{state.snapshot.blockNumber.toLocaleString('en-GB')}</span>
              <span className="label">block read at</span>
            </div>
            <div className="stat">
              <span className="figure">{state.snapshot.blockSeconds.toFixed(1)}s</span>
              <span className="label">measured block time</span>
            </div>
            <div className="stat">
              <span className="figure">
                {state.snapshot.lastChangedAt.toLocaleString('en-GB')}
              </span>
              <span className="label">last change</span>
            </div>
          </div>

          <div className="controls">
            <label className="field">
              <span>Search</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="name or owner address…"
              />
            </label>
            <label className="field">
              <span>State</span>
              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as Tier | 'all')}
              >
                <option value="all">Any state</option>
                <option value="described">Described (has a manifest)</option>
                <option value="deployed">Deployed only (bundle, no manifest)</option>
                <option value="registered">Name only (nothing published)</option>
              </select>
            </label>
            <button
              type="button"
              className={groupByOwner ? 'toggle on' : 'toggle'}
              aria-pressed={groupByOwner}
              onClick={() => setGroupByOwner((v) => !v)}
            >
              Group by owner
            </button>
            <button type="button" className="toggle" onClick={() => void load()}>
              Re-read
            </button>
            <span className="count">
              {filtered.length} of {state.snapshot.labels.length}
            </span>
          </div>

          {groupByOwner ? (
            <div className="owners">
              {byOwner.length === 0 ? (
                <p className="empty">Owners still loading, or none match.</p>
              ) : (
                byOwner.map(([owner, names]) => (
                  <div className="owner" key={owner}>
                    <div className="owner-head">
                      <code>{short(owner)}</code>
                      <span>{names.length} names</span>
                    </div>
                    <div className="chips">
                      {names.sort().map((n) => (
                        <span className="chip" key={n}>
                          {n}
                          <em>.dot</em>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="grid">
              {filtered.map((r) => (
                <a
                  className="card"
                  key={r.label}
                  href={`https://${r.label}.dot.li`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="name">
                    {r.label}
                    <em>.dot</em>
                  </span>
                  {r.rec ? (
                    <span className="tags">
                      <span className={`tier ${tierOf(r.rec)}`}>{TIER_LABEL[tierOf(r.rec)]}</span>
                      {r.rec.category ? <span className="cat">{r.rec.category}</span> : null}
                    </span>
                  ) : (
                    <span className="tags">
                      <span className="pending">reading records…</span>
                    </span>
                  )}
                  <span className="owner-line">
                    {r.owner ? short(r.owner) : <span className="pending">unowned</span>}
                    {r.firstSeenAt ? (
                      <span className="since">{DATE_FMT.format(r.firstSeenAt)}</span>
                    ) : null}
                  </span>
                </a>
              ))}
              {filtered.length === 0 ? <p className="empty">Nothing matches that.</p> : null}
            </div>
          )}

          {detailError ? (
            <p className="detail-error">
              Owners or records could not be read in full: {detailError}. The list above is still
              what the contract holds.
            </p>
          ) : null}

          <footer>
            <span>
              Read from <code>{state.snapshot.endpoint}</code>
              {state.snapshot.failedOver.length
                ? ` after ${state.snapshot.failedOver.join(', ')} refused`
                : ''}
              .
            </span>
            <span>
              Nothing on this page was baked at build time. Reload it and it asks the chain again.
            </span>
          </footer>
        </>
      ) : null}
    </div>
  );
}
