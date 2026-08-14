import { useEffect, useState } from 'react';
import type { App } from '@parity/product-sdk/core';
import { useAnnouncer } from './announce';

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/**
 * Adding a name from the page — the thing that stops this directory depending
 * on anyone else's index. Whoever registers a `.dot` can put it here, and anyone
 * may do it for anyone: the contract admits a label only if the registry gives
 * it an owner.
 *
 * This file exists SEPARATELY so it can be loaded lazily. Importing it pulls in
 * the product SDK and its chain descriptors, and those carry the SCALE metadata
 * for every supported chain — measured at 250 kB to 880 kB each, eight of them.
 * A reader who will never sign should not download any of it, and on a page
 * served from Bulletin that is not a rounding error.
 */
export default function AnnouncePanel({ app, onAdded }: { app: App; onAdded: () => void }) {
  const { status, announce, reset } = useAnnouncer(app);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (status.phase === 'done') {
      setValue('');
      onAdded();
    }
  }, [status, onAdded]);

  const busy = status.phase === 'working';
  const canWrite = status.phase !== 'unavailable';

  return (
    <section className="announce">
      <div className="announce-row">
        <div className="announce-copy">
          <h2>Add a name</h2>
          <p>
            Registered <code>.dot</code> names do not announce themselves. Put one here and it
            appears for everyone — yours or anyone else's.
          </p>
        </div>

        {canWrite ? (
          <form
            className="announce-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void announce(value);
            }}
          >
            <input
              type="text"
              value={value}
              spellCheck={false}
              placeholder="yourname"
              aria-label="The .dot label to announce"
              disabled={busy}
              onChange={(e) => {
                setValue(e.target.value);
                if (status.phase === 'failed' || status.phase === 'done') reset();
              }}
            />
            <button type="submit" className="clear" disabled={busy || !value.trim()}>
              {busy ? 'working…' : 'Announce'}
            </button>
          </form>
        ) : null}
      </div>

      <p className={`announce-status ${status.phase}`}>
        {status.phase === 'unavailable' ? status.why : null}
        {status.phase === 'ready' ? `signing as ${short(status.address)}` : null}
        {status.phase === 'working' ? `${status.step}…` : null}
        {status.phase === 'done' ? `${status.label}.dot is in the directory` : null}
        {status.phase === 'failed' ? status.message : null}
      </p>
    </section>
  );
}
