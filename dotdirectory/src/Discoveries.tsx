import { useEffect, useState } from 'react';
import { sweep } from './sweep';
import type { Found } from './sweep';

/**
 * Names the chain confirms exist but that nobody has put in the directory.
 *
 * This runs in the visitor's browser, after the list has painted, and finds
 * them by proposing candidates rather than by enumerating — see sweep.ts for
 * why enumeration is impossible and proposing is cheap. It is the piece that
 * makes discovery view-time: no indexer, no schedule, no machine that can fall
 * behind, because the work happens when someone is looking and stops when they
 * stop looking.
 *
 * Knowing costs nothing; recording costs a signature. So the sweep always runs
 * and always shows what it found, and adding a find to the directory stays a
 * deliberate act by someone with a wallet — which anyone may perform for
 * anyone, since the contract admits a label only if the registry gives it an
 * owner.
 */
export function Discoveries({
  known,
  seed,
  onAnnounce,
}: {
  known: Set<string>;
  /** Chain head — rotates which slice of the namespace this visit sweeps. */
  seed: number;
  /** Present only when there is a wallet. */
  onAnnounce: ((label: string) => void) | null;
}) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The list has to exist before there is anything to compare against, and
    // the sweep must never delay it — so it waits for a non-empty directory and
    // then runs in the background for the life of the page.
    //
    // NO `started` REF HERE, deliberately. A ref guard plus abort-on-cleanup
    // cancel each other out under StrictMode: the first mount starts the sweep,
    // the cleanup aborts it, and the second mount sees the ref already set and
    // never runs. The result was an aborted sweep reporting zero findings in the
    // same words as a complete one — a silent false negative, which is worse
    // than a visible failure. `known` and `seed` are stable once the snapshot
    // is, so letting the effect re-run is both correct and cheap.
    if (known.size === 0) return;
    const ac = new AbortController();

    sweep(known, seed, (done, total) => !ac.signal.aborted && setProgress({ done, total }), ac.signal)
      .then((hits) => {
        // An aborted sweep has NOT swept the namespace, so it must not be
        // allowed to answer as though it had.
        if (ac.signal.aborted) return;
        // Progress is kept, not cleared: it is what the finished sweep can say
        // about how much of the namespace it actually covered.
        setFound(hits.filter((h) => !known.has(h.label)));
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setProgress(null);
      });

    return () => ac.abort();
  }, [known, seed]);

  if (error) {
    return (
      <p className="sweep-status">Sweep could not run: {error}. The list above is unaffected.</p>
    );
  }

  // `found === null` means the sweep has not finished, which is a different
  // statement from "found nothing" and must not borrow its words.
  if (!found?.length) {
    return (
      <p className="sweep-status">
        {found === null
          ? `sweeping the namespace — ${progress?.done ?? 0}/${progress?.total ?? 700} candidates tested`
          : `namespace swept: ${progress?.total ?? 700} candidates, all of them already listed`}
      </p>
    );
  }

  return (
    <section className="sweep">
      <div className="sweep-head">
        <h2>Found on-chain, not listed</h2>
        <p>
          The registry confirms these names have owners, and no one has announced them here. Found
          by this browser, this visit — nothing scheduled, nothing stored.
        </p>
      </div>
      <ul className="sweep-list">
        {found.map((f) => (
          <li key={f.label}>
            <code>{f.label}.dot</code>
            {onAnnounce ? (
              <button type="button" className="clear small" onClick={() => onAnnounce(f.label)}>
                Add
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!onAnnounce ? (
        <p className="sweep-status">
          Open this in the Polkadot app to add them — anyone may announce anyone's name.
        </p>
      ) : null}
    </section>
  );
}
