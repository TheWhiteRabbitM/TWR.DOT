import { useEffect, useState } from 'react';
import type { App } from '@parity/product-sdk/core';
import { parseEther, keccak256, toUtf8Bytes } from 'ethers';
import { readOrdersOf, STATE_LABEL, priceOf, type Order } from './chain';
import { useTrader } from './trade';

/**
 * Both sides of the counter, for whoever is signed in.
 *
 * Separate file so it can be lazily imported: it pulls the product SDK and its
 * chain descriptors, which carry SCALE metadata for every supported chain —
 * eight chunks between 250 kB and 880 kB. A visitor who is only browsing should
 * download none of it.
 */
export default function TradePanel({ app, onChanged }: { app: App; onChanged: () => void }) {
  const { status, address, mask, list, act, reset } = useTrader(app);
  const [tab, setTab] = useState<'orders' | 'sell'>('orders');
  const [orders, setOrders] = useState<Order[] | null>(null);

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [digital, setDigital] = useState(true);
  const [payloadCid, setPayloadCid] = useState('');
  const [imageCid, setImageCid] = useState('');
  const [secret, setSecret] = useState('');

  const busy = status.phase === 'working';

  useEffect(() => {
    if (!address) return;
    let alive = true;
    // Orders are keyed by the H160 the contract saw, which the trader hook has
    // already derived; refetch whenever a write lands.
    readOrdersOf(address)
      .then((o) => alive && setOrders(o))
      .catch(() => alive && setOrders([]));
    return () => {
      alive = false;
    };
  }, [address, status]);

  useEffect(() => {
    if (status.phase === 'done') onChanged();
  }, [status, onChanged]);

  if (status.phase === 'unavailable') {
    return <p className="status">{status.why}</p>;
  }

  return (
    <section className="trade">
      <div className="tabs">
        <button type="button" className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
          Your orders
        </button>
        <button type="button" className={tab === 'sell' ? 'on' : ''} onClick={() => setTab('sell')}>
          Sell something
        </button>
        <span className="who">mask #{String(mask)}</span>
      </div>

      {tab === 'orders' ? (
        orders === null ? (
          <p className="status">reading your orders…</p>
        ) : orders.length === 0 ? (
          <p className="status">You have not bought anything here yet.</p>
        ) : (
          <ul className="orders">
            {orders.map((o) => (
              <li key={o.id}>
                <span className="oid">#{o.id}</span>
                <span className="ostate">{STATE_LABEL[o.state] ?? o.state}</span>
                <span className="oprice">{priceOf(o.paid)} PAS</span>
                {o.sealedKey && o.sealedKey !== '0x' ? (
                  <code className="okey" title="sealed to your mask — decrypt with your mailbox key">
                    {o.sealedKey.slice(0, 22)}…
                  </code>
                ) : null}
                {o.state === 2 ? (
                  <>
                    <button type="button" className="clear small" disabled={busy}
                      onClick={() => void act('confirm', o.id)}>
                      confirm
                    </button>
                    <button type="button" className="ghost small" disabled={busy}
                      onClick={() => void act('dispute', o.id, 'did not arrive or did not work')}>
                      dispute
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : (
        <form
          className="sellform"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            // The key NEVER leaves the browser: what goes on-chain is its hash,
            // committed before anyone can pay, which is the whole basis of the
            // dispute rule. Encrypting the payload with it is the seller's job,
            // off-chain, before uploading.
            const commit = digital
              ? keccak256(toUtf8Bytes(secret))
              : '0x' + '00'.repeat(32);
            void list({
              title: title.trim(),
              price: parseEther(price || '0'),
              stock: Number(stock) || 1,
              digital,
              descCid: '',
              imageCid: imageCid.trim(),
              payloadCid: payloadCid.trim(),
              keyCommit: commit,
            });
          }}
        >
          <label className="field">
            <span>What is it</span>
            <input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field narrow">
            <span>Price (PAS)</span>
            <input value={price} inputMode="decimal" placeholder="0.5" disabled={busy}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field narrow">
            <span>Stock</span>
            <input value={stock} inputMode="numeric" disabled={busy}
              onChange={(e) => setStock(e.target.value)} />
          </label>
          <label className="field narrow">
            <span>Kind</span>
            <select value={digital ? 'digital' : 'physical'} disabled={busy}
              onChange={(e) => setDigital(e.target.value === 'digital')}>
              <option value="digital">digital</option>
              <option value="physical">shipped</option>
            </select>
          </label>
          <label className="field">
            <span>Image CID (optional)</span>
            <input value={imageCid} spellCheck={false} disabled={busy}
              onChange={(e) => setImageCid(e.target.value)} />
          </label>

          {digital ? (
            <>
              <label className="field">
                <span>Encrypted file CID</span>
                <input value={payloadCid} spellCheck={false} placeholder="bafkrei…" disabled={busy}
                  onChange={(e) => setPayloadCid(e.target.value)} />
              </label>
              <label className="field">
                <span>The key you encrypted it with</span>
                <input value={secret} spellCheck={false} disabled={busy}
                  onChange={(e) => setSecret(e.target.value)} />
                <em className="hint">
                  Stays in this browser. Only its hash is stored, and only that lets you win a
                  dispute later — so keep it: without it you cannot prove delivery.
                </em>
              </label>
            </>
          ) : null}

          <button type="submit" className="clear" disabled={busy || !title.trim() || !price}>
            {busy ? 'working…' : 'Put it up for sale'}
          </button>
        </form>
      )}

      <p className={`status ${status.phase}`} aria-live="polite">
        {status.phase === 'working' ? `${status.step}…` : null}
        {status.phase === 'done' ? status.what : null}
        {status.phase === 'failed' ? (
          <>
            {status.message}{' '}
            <button type="button" className="link" onClick={reset}>
              dismiss
            </button>
          </>
        ) : null}
      </p>
    </section>
  );
}
