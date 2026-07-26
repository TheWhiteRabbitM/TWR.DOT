import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { fetchWud, ASSET_ID, type WudStats } from './lib/wud';
import { openAppChat } from './lib/host-chat';
import { openExternal } from './lib/host-nav';
import { loadSnapshot, BAKED, type Snapshot, type SnapshotSource } from './lib/snapshot';

const REFRESH_MS = 30_000;
const OFFICIAL = 'https://gavunwud.xyz/';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function compact(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmt(Math.round(n));
}

function pct(x: number): string {
  if (x >= 0.01) return `${(x * 100).toFixed(2)}%`;
  if (x >= 0.0001) return `${(x * 100).toFixed(3)}%`;
  return `${(x * 100).toFixed(4)}%`;
}

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}

function ago(t: number | null): string {
  if (!t) return '—';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export function App() {
  const [live, setLive] = useState<WudStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [chatLabel, setChatLabel] = useState('💬 Community chat');

  const goChat = async () => {
    setChatLabel('Opening…');
    const r = await openAppChat('wudcommunity', 'WUD community');
    if (r.status === 'outside') setChatLabel('Chat lives inside the Polkadot app');
    else if (r.status === 'failed') setChatLabel('Chat unavailable right now');
    // 'registered' is a real success: the room exists, the host just would not jump.
    else if (r.status === 'registered') setChatLabel('Room added — open the Chat tab');
    else setChatLabel('Opened in chat ✓');
    window.setTimeout(() => setChatLabel('💬 Community chat'), 3200);
  };

  // One handler shared by every external anchor. Taking the URL off the event
  // target keeps it a single stable function instead of one closure per
  // leaderboard row, and leaves each href intact for right-click / standalone.
  const onExternal = useCallback((e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    void openExternal(e.currentTarget.href);
  }, []);
  const [snap, setSnap] = useState<Snapshot>(BAKED);
  const [, setSnapSource] = useState<SnapshotSource>('baked');
  const TIER_BY_KEY = useMemo(() => new Map(snap.tiers.map((t) => [t.key, t])), [snap]);

  // Pull the holder snapshot from Bulletin once on mount; on any failure
  // loadSnapshot resolves to the baked copy, so the page never waits on it.
  useEffect(() => {
    let cancelled = false;
    void loadSnapshot().then((r) => {
      if (cancelled) return;
      setSnap(r.snap);
      setSnapSource(r.source);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(() => {
    fetchWud()
      .then((s) => {
        setLive(s);
        setError(null);
      })
      .catch((e) => setError(e?.message ?? String(e)));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const holders = live?.holders ?? snap.holders;
  const supply = live?.supply ?? snap.supply;
  const hasSnapshot = snap.top.length > 0;

  const copyAsset = () => {
    void navigator.clipboard.writeText(String(ASSET_ID)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-brand">
          <img className="bar-logo" src="./art/gavun-wud-logo.webp" alt="$WUD logo" />
          <div>
            <h1>WUD Community</h1>
            <p>Unofficial · live from Polkadot Asset Hub</p>
          </div>
        </div>
        <span className={`chip ${error ? 'is-err' : live ? 'is-ok' : ''}`}>
          <span className="dot" />
          {error ? 'offline' : live ? 'live' : 'connecting'}
          <span className="chip-time">· {ago(live?.fetchedAt ?? null)}</span>
        </span>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-mascot">
          {/* Official $WUD character — used with the community's permission. */}
          <img className="hero-art" src="./art/gavun-wud-black.png" alt="GAVUN WUD character" />
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Asset {ASSET_ID} · Polkadot Asset Hub</p>
          <h2>
            {live?.name ?? 'GAVUN WUD'}
            <span className="sym">${live?.symbol ?? 'WUD'}</span>
          </h2>
          <p className="lede">
            A community token with {holders ? fmt(holders) : '—'} holders.{' '}
            {error
              ? 'The figures here come from the last full snapshot of the chain — no wallet, no sign-in, nothing typed in by hand.'
              : 'Every number on this page is read straight off the chain — no wallet, no sign-in, nothing typed in by hand.'}
          </p>
          <div className="hero-actions">
            <a
              className="btn filled"
              href={OFFICIAL}
              target="_blank"
              rel="noreferrer"
              onClick={onExternal}
            >
              Official site
            </a>
            <button type="button" className="btn tonal" onClick={copyAsset}>
              {copied ? 'Copied ✓' : `Asset ID ${ASSET_ID}`}
            </button>
            <button type="button" className="btn tonal" onClick={goChat}>
              {chatLabel}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="notice err">
          <span>
            Can't reach a public Asset Hub node from this browser right now, so the figures
            below come from the last snapshot instead of live chain reads. Nothing else on the
            page changes.
          </span>
          <button type="button" className="btn text" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------- stats */}
      <section className="cards">
        <div className="card">
          <span className="card-l">Holders</span>
          <span className="card-n">{holders ? fmt(holders) : '…'}</span>
          <span className="card-s">accounts holding WUD</span>
        </div>
        <div className="card">
          <span className="card-l">Total supply</span>
          <span className="card-n">{supply ? compact(supply) : '…'}</span>
          <span className="card-s">{supply ? `${fmt(supply)} WUD` : ''}</span>
        </div>
        <div className="card">
          <span className="card-l">Top 10 hold</span>
          <span className="card-n accent">{hasSnapshot ? pct(snap.top10Share) : '…'}</span>
          <span className="card-s">of total supply</span>
        </div>
        <div className="card">
          <span className="card-l">Status</span>
          <span className="card-n ok">{live?.status ?? (error ? '—' : '…')}</span>
          <span className="card-s">{error ? 'needs a live connection' : 'assets pallet'}</span>
        </div>
      </section>

      {/* ----------------------------------------------------------- tiers */}
      {hasSnapshot && (
        <section className="panel">
          <div className="panel-head">
            <h3>The pod</h3>
            <span className="panel-note">every holder, bucketed by share of supply</span>
          </div>

          <div className="tierbar" role="img" aria-label="supply split by holder tier">
            {snap.tiers
              .filter((t) => t.total > 0)
              .map((t) => (
                <span
                  key={t.key}
                  className={`tierbar-seg tier-${t.key}`}
                  style={{ width: `${(t.total / snap.supply) * 100}%` }}
                  title={`${t.label}: ${pct(t.total / snap.supply)} of supply`}
                />
              ))}
          </div>

          <div className="tiers">
            {snap.tiers.map((t) => (
              <div className={`tier tier-${t.key}`} key={t.key}>
                <span className="tier-emoji" aria-hidden="true">
                  {t.emoji}
                </span>
                <span className="tier-label">{t.label}</span>
                <span className="tier-count">{fmt(t.count)}</span>
                <span className="tier-share">{pct(t.total / snap.supply)} of supply</span>
              </div>
            ))}
          </div>

          <p className="panel-foot">
            Read this with care: on Asset Hub the biggest positions are usually liquidity
            pools, bridges and burn addresses rather than individual people, so a large top
            share is not by itself a claim about anyone's holdings. Each address below links
            to a block explorer — check what a wallet actually is before drawing conclusions.
          </p>
        </section>
      )}

      {/* ----------------------------------------------------- leaderboard */}
      {hasSnapshot && (
        <section className="panel">
          <div className="panel-head">
            <h3>Top holders</h3>
            <span className="panel-note">
              snapshot {snap.updatedAt ? new Date(snap.updatedAt).toISOString().slice(0, 10) : ''}
            </span>
          </div>
          <div className="board">
            {snap.top.slice(0, 25).map((h) => {
              const tier = TIER_BY_KEY.get(h.tier);
              const width = (h.share / snap.top[0].share) * 100;
              return (
                <div className="row" key={h.rank}>
                  <span className="rank">{h.rank}</span>
                  <span className={`badge tier-${h.tier}`} title={tier?.label}>
                    {tier?.emoji ?? '•'}
                  </span>
                  <a
                    className="addr"
                    href={`https://assethub-polkadot.subscan.io/account/${h.address}`}
                    target="_blank"
                    rel="noreferrer"
                    title={h.address}
                    onClick={onExternal}
                  >
                    {shortAddr(h.address)}
                  </a>
                  <span className="hbar-wrap" aria-hidden="true">
                    <span className={`hbar tier-${h.tier}`} style={{ width: `${width}%` }} />
                  </span>
                  <span className="amt">{compact(h.amount)}</span>
                  <span className="share">{pct(h.share)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!hasSnapshot && (
        <div className="notice">
          Holder leaderboard is being built — it takes a full pass over 200k+ accounts.
        </div>
      )}

      <footer className="foot">
        <p>
          <strong>Unofficial.</strong> Made by the community, not by the $WUD team. For official
          information see{' '}
          <a href={OFFICIAL} target="_blank" rel="noreferrer" onClick={onExternal}>
            gavunwud.xyz
          </a>
          .
        </p>
        <p className="foot-dim">
          Live figures read from asset {ASSET_ID} on Polkadot Asset Hub. Holder rankings come
          from a periodic full snapshot. Official $WUD artwork used with the community's
          permission. Not financial advice.
        </p>
      </footer>
    </div>
  );
}
