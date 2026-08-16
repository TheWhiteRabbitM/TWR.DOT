import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { App } from '@parity/product-sdk/core';
import {
  GATEWAY, MARKET, nameOf, readSellers, readShop,
  type Listing, type Seller, type Shop,
} from './chain';
import { Price, Stars } from './Stars';
import { HowTo } from './HowTo';

/**
 * Amazon's structure on Polkadot's palette, which is what was asked for and is
 * also the only combination that makes sense: the layout of a shop is solved
 * work — a filter rail, a dense grid, stars and price carrying the most weight,
 * a buy box pinned beside the item — while the colours and type are what make
 * this look like it belongs beside dotdirectory rather than beside a retailer.
 *
 * The one borrowed colour is the amber call-to-action, and it was already in
 * the sheet as --warn. Nothing else changed hue.
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
  const [rated, setRated] = useState(false);
  const [sort, setSort] = useState<Sort>('new');
  const [open, setOpen] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    try {
      const shop = await readShop();
      setState({ phase: 'ready', shop });
      const masks = [...new Set(shop.listings.map((l) => l.seller.toString()))].map(BigInt);
      readSellers(masks).then(setSellers).catch(() => setSellers(new Map()));
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = useMemo(
    () => (state.phase === 'ready' ? state.shop.listings.filter((l) => l.stock > 0) : []),
    [state],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = live;
    if (kind !== 'all') out = out.filter((l) => (kind === 'digital') === l.digital);
    if (rated) out = out.filter((l) => (sellers.get(l.seller.toString())?.reviews ?? 0) > 0);
    if (q) {
      out = out.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          nameOf(sellers.get(l.seller.toString()), l.seller).label.toLowerCase().includes(q),
      );
    }
    const rate = (l: Listing) => sellers.get(l.seller.toString())?.ratingX100 ?? 0;
    return [...out].sort((a, b) => {
      if (sort === 'cheap') return a.price < b.price ? -1 : a.price > b.price ? 1 : 0;
      if (sort === 'dear') return a.price > b.price ? -1 : a.price < b.price ? 1 : 0;
      if (sort === 'rated') return rate(b) - rate(a);
      return b.listedAt - a.listedAt;
    });
  }, [live, query, kind, rated, sort, sellers]);

  const openSeller = open ? sellers.get(open.seller.toString()) : undefined;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Amazdot</h1>
          <span className="tag">escrow on asset hub</span>
        </div>
        <input
          type="search"
          className="topsearch"
          value={query}
          placeholder="Search the market…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="topnote">no fee · no operator</span>
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
          {app ? (
            <Suspense fallback={null}>
              <TradePanel app={app} onChanged={() => void load()} />
            </Suspense>
          ) : null}

          <HowTo inHost={Boolean(app)} />

          <div className="layout">
            <aside className="rail">
              <h2>Kind</h2>
              <ul className="facets">
                {(['all', 'digital', 'physical'] as Kind[]).map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      className={kind === k ? 'on' : ''}
                      onClick={() => setKind(k)}
                    >
                      {k === 'all' ? 'Everything' : k === 'digital' ? 'Download now' : 'Shipped'}
                      <span>
                        {k === 'all'
                          ? live.length
                          : live.filter((l) => (k === 'digital') === l.digital).length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <h2>Seller</h2>
              <ul className="facets">
                <li>
                  <label className="check">
                    <input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} />
                    Has reviews
                    <span>{live.filter((l) => (sellers.get(l.seller.toString())?.reviews ?? 0) > 0).length}</span>
                  </label>
                </li>
              </ul>

              <h2>How it settles</h2>
              <p className="railnote">
                Your money sits in the contract, not with the seller. A digital dispute is decided
                by the chain; a shipped one only ends when both of you agree.
              </p>
            </aside>

            <section className="results">
              <div className="resulthead">
                <span>
                  <strong>{rows.length}</strong> {rows.length === 1 ? 'result' : 'results'}
                  {rows.length !== live.length ? ` of ${live.length}` : ''}
                </span>
                <label className="sortby">
                  Sort by
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    <option value="new">newest</option>
                    <option value="cheap">price: low to high</option>
                    <option value="dear">price: high to low</option>
                    <option value="rated">seller rating</option>
                  </select>
                </label>
              </div>

              {rows.length === 0 ? (
                <p className="status">
                  {live.length === 0
                    ? 'Nothing is for sale yet. The contract is live and empty — the first listing is somebody’s to make.'
                    : 'Nothing matches that.'}
                </p>
              ) : (
                <ul className="grid">
                  {rows.map((l) => {
                    const s = sellers.get(l.seller.toString());
                    const n = nameOf(s, l.seller);
                    return (
                      <li key={l.id} className="card">
                        <button type="button" className="card-hit" onClick={() => setOpen(l)}>
                          <div className={`thumb ${l.imageCid ? '' : 'blank'}`}>
                            {l.imageCid ? (
                              <img src={GATEWAY + l.imageCid} alt="" loading="lazy" />
                            ) : (
                              <span>{l.digital ? 'download' : 'parcel'}</span>
                            )}
                          </div>
                          <h3>{l.title}</h3>
                          <Stars x100={s?.ratingX100 ?? 0} count={s?.reviews ?? 0} />
                          <Price text={l.priceText} />
                          <p className="by">
                            {n.label}
                            {n.proven ? <span className="tick" title="proven .dot name">✓</span> : null}
                          </p>
                          <p className={`avail ${l.stock <= 3 ? 'low' : ''}`}>
                            {l.digital ? 'Instant download' : 'Ships from the seller'}
                            {l.stock <= 3 ? ` · only ${l.stock} left` : ''}
                          </p>
                        </button>
                        <span className="cta">{app ? 'Buy' : 'View'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

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
                <div className="detail">
                  <div className={`hero ${open.imageCid ? '' : 'blank'}`}>
                    {open.imageCid ? (
                      <img src={GATEWAY + open.imageCid} alt="" />
                    ) : (
                      <span>{open.digital ? 'download' : 'parcel'}</span>
                    )}
                  </div>

                  <div className="detail-main">
                    <h2>{open.title}</h2>
                    <p className="soldby">
                      {nameOf(openSeller, open.seller).label}
                      {nameOf(openSeller, open.seller).proven ? (
                        <span className="tick" title="proven .dot name">✓</span>
                      ) : null}
                      {openSeller?.owner ? <span className="addr"> · {short(openSeller.owner)}</span> : null}
                    </p>
                    <Stars x100={openSeller?.ratingX100 ?? 0} count={openSeller?.reviews ?? 0} />
                    <p className="note">
                      {open.digital
                        ? 'Pay and the seller sends the key sealed to your mask. If it does not open, dispute: to be paid they must publish the key in the clear, and if they cannot, you are refunded.'
                        : 'Pay and your address reaches the seller encrypted, never in the clear. Confirm when it arrives, or the seller is paid automatically after about three days. A dispute ends only when you both agree a split.'}
                    </p>
                  </div>

                  {/* The buy box, pinned beside the item the way a shop does it. */}
                  <aside className="buybox">
                    <Price text={open.priceText} />
                    <p className={`avail ${open.stock <= 3 ? 'low' : ''}`}>
                      {open.stock > 0 ? 'In stock' : 'Sold out'}
                      {open.stock <= 3 ? ` · only ${open.stock} left` : ''}
                    </p>
                    <p className="ship">
                      {open.digital ? 'Delivered as an encrypted key' : 'Shipped by the seller'}
                    </p>
                    {app ? (
                      <p className="status">Use the panel at the top of the page to buy.</p>
                    ) : (
                      <p className="status">Open in the Polkadot app to buy.</p>
                    )}
                    <dl>
                      <dt>completed sales</dt>
                      <dd>{openSeller?.sales ?? 0}</dd>
                      <dt>listing</dt>
                      <dd>#{open.id}</dd>
                    </dl>
                  </aside>
                </div>
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
                {state.shop.failedOver.length
                  ? ` after ${state.shop.failedOver.join(', ')} refused`
                  : ''}
              </span>
              <span className="addr">contract {MARKET}</span>
            </div>

            <details className="why">
              <summary>Why the stars here cannot be bought</summary>
              <p>
                A review can only be written from an order that was paid and completed, and a
                seller cannot buy from their own mask — the contract refuses it. So a five-star
                average costs whatever the items cost, paid to somebody else, rather than costing
                nothing. It is not unfakeable; it is expensive to fake, which is the most any
                marketplace has ever managed.
              </p>
              <p>
                A tick beside a name means the holder proved they own that <code>.dot</code> — the
                contract recomputed the namehash and asked the registry. A name without a tick is
                just text the seller typed.
              </p>
            </details>
          </footer>
        </>
      ) : null}
    </div>
  );
}
