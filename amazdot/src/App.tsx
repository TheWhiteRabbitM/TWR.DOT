import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { App } from '@parity/product-sdk/core';
import {
  GATEWAY, MARKET, readSellers, readShop, type Listing, type Seller, type Shop,
} from './chain';

/**
 * The trade panel arrives only when there is a wallet to sign with. Loading the
 * SDK for a reader who is only browsing would double the page — measured at
 * 460 kB against 1,027 kB on dotdirectory — and this page is served from
 * Bulletin, where that is not a rounding error.
 */
const TradePanel = lazy(() => import('./TradePanel'));

type Kind = 'all' | 'digital' | 'physical';
type Sort = 'new' | 'cheap' | 'dear' | 'rated';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; shop: Shop };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function Store({ app }: { app: App | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [sellers, setSellers] = useState<Map<string, Seller>>(new Map());
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('new');
  const [open, setOpen] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const shop = await readShop();
      setState({ phase: 'ready', shop });
      // Seller details are a second pass on purpose: the shelves are what the
      // page is for, and they must not wait on reputation lookups.
      const masks = [...new Set(shop.listings.map((l) => l.seller.toString()))].map(BigInt);
      readSellers(masks).then(setSellers).catch(() => setSellers(new Map()));
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (state.phase !== 'ready') return [];
    const q = query.trim().toLowerCase();
    let out = state.shop.listings.filter((l) => l.stock > 0);
    if (kind !== 'all') out = out.filter((l) => (kind === 'digital') === l.digital);
    if (q) {
      out = out.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          (sellers.get(l.seller.toString())?.name ?? '').includes(q),
      );
    }
    const rate = (l: Listing) => sellers.get(l.seller.toString())?.ratingX100 ?? 0;
    return [...out].sort((a, b) => {
      if (sort === 'cheap') return a.price < b.price ? -1 : a.price > b.price ? 1 : 0;
      if (sort === 'dear') return a.price > b.price ? -1 : a.price < b.price ? 1 : 0;
      if (sort === 'rated') return rate(b) - rate(a);
      return b.listedAt - a.listedAt;
    });
  }, [state, query, kind, sort, sellers]);

  const counts = useMemo(() => {
    if (state.phase !== 'ready') return { digital: 0, physical: 0, sellers: 0 };
    const live = state.shop.listings.filter((l) => l.stock > 0);
    return {
      digital: live.filter((l) => l.digital).length,
      physical: live.filter((l) => !l.digital).length,
      sellers: new Set(live.map((l) => l.seller.toString())).size,
    };
  }, [state]);

  return (
    <main>
      <header>
        <p className="eyebrow">
          <span className="dot" /> escrow on asset hub · no platform fee · no operator
        </p>
        <h1>Amazdot</h1>
        <p className="lede">
          A market where the money waits in a contract, and the reviews cannot be bought because
          only a paid order can write one.
        </p>
      </header>

      {state.phase === 'loading' ? <p className="status">reading the shelves…</p> : null}

      {state.phase === 'error' ? (
        <p className="status bad">
          Could not reach the chain: {state.message}.{' '}
          <button type="button" className="link" onClick={() => void load()}>
            try again
          </button>
        </p>
      ) : null}

      {state.phase === 'ready' ? (
        <>
          <section className="counts">
            <span>
              <strong>{counts.digital + counts.physical}</strong> in stock
            </span>
            <span>
              <strong>{counts.digital}</strong> download now
            </span>
            <span>
              <strong>{counts.physical}</strong> shipped
            </span>
            <span>
              from <strong>{counts.sellers}</strong> {counts.sellers === 1 ? 'seller' : 'sellers'}
            </span>
          </section>

          {app ? (
            <Suspense fallback={null}>
              <TradePanel app={app} onChanged={() => void load()} />
            </Suspense>
          ) : (
            <p className="status">
              Open this in the Polkadot app to buy or to sell — browsing needs nothing.
            </p>
          )}

          <section className="controls">
            <input
              type="search"
              value={query}
              placeholder="Filter by name or seller…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="chips">
              {(['all', 'digital', 'physical'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip ${kind === k ? 'on' : ''}`}
                  onClick={() => setKind(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="new">newest</option>
              <option value="cheap">cheapest</option>
              <option value="dear">dearest</option>
              <option value="rated">best rated</option>
            </select>
          </section>

          {rows.length === 0 ? (
            <p className="status">
              {state.shop.listings.length === 0
                ? 'Nothing is for sale yet. The contract is live and empty — the first listing is somebody’s to make.'
                : 'Nothing matches that.'}
            </p>
          ) : (
            <section className="grid">
              {rows.map((l) => {
                const s = sellers.get(l.seller.toString());
                return (
                  <article key={l.id} className="card">
                    <button type="button" className="card-hit" onClick={() => setOpen(l)}>
                      <div className={`thumb ${l.imageCid ? '' : 'blank'}`}>
                        {l.imageCid ? (
                          <img src={GATEWAY + l.imageCid} alt="" loading="lazy" />
                        ) : (
                          <span>{l.digital ? 'download' : 'parcel'}</span>
                        )}
                      </div>
                      <h3>{l.title}</h3>
                      <p className="price">
                        {l.priceText} <span>PAS</span>
                      </p>
                      <p className="by">
                        {s?.name ? `${s.name}.dot` : `mask #${l.seller}`}
                        {s && s.reviews > 0 ? (
                          <span className="stars">
                            {(s.ratingX100 / 100).toFixed(1)}★ ({s.reviews})
                          </span>
                        ) : (
                          <span className="stars none">no reviews yet</span>
                        )}
                      </p>
                      <p className="meta">
                        {l.digital ? 'digital' : 'shipped'} · {l.stock} left
                      </p>
                    </button>
                  </article>
                );
              })}
            </section>
          )}

          {open ? (
            <div
              className="sheet"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.target === e.currentTarget && setOpen(null)}
            >
              <div className="sheet-body">
                <button type="button" className="close" onClick={() => setOpen(null)}>
                  close
                </button>
                <h2>{open.title}</h2>
                <p className="price big">
                  {open.priceText} <span>PAS</span>
                </p>
                <dl>
                  <dt>kind</dt>
                  <dd>{open.digital ? 'digital — delivered as an encrypted key' : 'shipped'}</dd>
                  <dt>seller</dt>
                  <dd>
                    {sellers.get(open.seller.toString())?.name
                      ? `${sellers.get(open.seller.toString())?.name}.dot`
                      : `mask #${open.seller}`}
                    {sellers.get(open.seller.toString())?.owner
                      ? ` · ${short(sellers.get(open.seller.toString())!.owner!)}`
                      : ''}
                  </dd>
                  <dt>completed sales</dt>
                  <dd>{sellers.get(open.seller.toString())?.sales ?? 0}</dd>
                  <dt>in stock</dt>
                  <dd>{open.stock}</dd>
                  <dt>listing</dt>
                  <dd>#{open.id}</dd>
                </dl>
                <p className="note">
                  {open.digital
                    ? 'Pay and the seller sends the key sealed to your mask. If it does not open, dispute: the seller must publish the key in the clear to be paid, and if they cannot, you are refunded.'
                    : 'Pay and your address goes to the seller encrypted — never in the clear. A shipped order releases after you confirm, or after about three days. A dispute ends only when both of you agree a split.'}
                </p>
                {!app ? (
                  <p className="status">Open this in the Polkadot app to buy.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <footer>
            <div className="prov">
              <span>
                block <strong>{state.shop.blockNumber.toLocaleString('en-GB')}</strong>
              </span>
              <span>
                via <strong>{new URL(state.shop.endpoint).host}</strong>
                {state.shop.failedOver.length ? ` after ${state.shop.failedOver.join(', ')} refused` : ''}
              </span>
              <span className="addr">contract {MARKET}</span>
            </div>

            <details className="why">
              <summary>How the escrow settles without an arbiter</summary>
              <p>
                A digital seller commits to <code>keccak256(key)</code> before anyone pays. On
                payment they send that key sealed to your mask. If you dispute, they can win by
                publishing the key in the clear — the contract checks it against the commitment
                made before the sale. So a false dispute gains a file everyone else now has, and
                an honest seller never needs a judge.
              </p>
              <p>
                Physical goods have no such proof, and this does not pretend otherwise. Escrow,
                your confirmation, a timeout that pays the seller, and a split both sides propose
                separately. When neither yields, the money stays put. That is the honest shape of
                the problem rather than an invented winner.
              </p>
              <p>
                No admin, no owner, no pause, no fee. Not as a promise — there is no function that
                could take a cut, freeze an order or empty the escrow.
              </p>
            </details>
          </footer>
        </>
      ) : null}
    </main>
  );
}
