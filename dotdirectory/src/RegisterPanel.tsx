import { useCallback, useEffect, useState } from 'react';
import type { App } from '@parity/product-sdk/core';
import { readName } from './chain';
import type { NameState } from './chain';
import { useRegistrar } from './register';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The form a site owner fills in to appear here.
 *
 * It is deliberately a LOOKUP first and a form second. Typing a name and being
 * told what the chain already knows about it — registered or not, listed or not,
 * yours or someone else's — is most of the value, and it costs no wallet and no
 * signature. Only once that is on screen does the form show which of the two
 * writes are actually available, so nobody is invited to sign something the
 * resolver will refuse.
 *
 * This file is SEPARATE so it can be loaded lazily. Importing it pulls in the
 * product SDK and its chain descriptors, which carry SCALE metadata for every
 * supported chain — measured at 250 kB to 880 kB each, eight of them. A reader
 * who will never sign should not download any of it, and on a page served from
 * Bulletin that is not a rounding error.
 */
export default function RegisterPanel({
  app,
  categories,
  onChanged,
}: {
  app: App;
  /** The categories names actually use, offered as suggestions rather than a
   *  fixed vocabulary — the field is owner-declared free text on-chain. */
  categories: string[];
  onChanged: () => void;
}) {
  const { status, owns, submit, reset } = useRegistrar(app);
  const [label, setLabel] = useState('');
  const [state, setState] = useState<NameState | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: '', description: '', category: '' });

  const busy = status.phase === 'working';
  const canWrite = status.phase !== 'unavailable';

  // The lookup is debounced rather than button-driven: it is three eth_calls on
  // a public RPC, and making people press "check" before the form can help them
  // is a step that exists only to save requests nobody is paying for.
  useEffect(() => {
    const clean = label.trim().toLowerCase().replace(/\.dot$/, '');
    if (!clean) {
      setState(null);
      setLookupError(null);
      return;
    }
    let alive = true;
    setLooking(true);
    const t = setTimeout(() => {
      readName(clean)
        .then((s) => {
          if (!alive) return;
          setState(s);
          setLookupError(null);
          // Prefill from what the name already says, so an owner editing one
          // field does not silently blank the other.
          setForm({
            displayName: s.records.displayName ?? '',
            description: s.records.description ?? '',
            category: s.records.category ?? '',
          });
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setState(null);
          setLookupError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => alive && setLooking(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [label]);

  useEffect(() => {
    if (status.phase === 'done') onChanged();
  }, [status, onChanged]);

  const mine = state ? owns(state) : false;

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (state && !busy) void submit(state, form);
    },
    [state, form, busy, submit],
  );

  return (
    <section className="register">
      <div className="register-head">
        <h2>Register your site</h2>
        <p>
          A registered <code>.dot</code> does not announce itself. Put yours in the directory and
          say what it is — the name can be added by anyone, the description only by its owner.
        </p>
      </div>

      <form className="register-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Name</span>
          <div className="with-suffix">
            <input
              type="text"
              value={label}
              spellCheck={false}
              autoComplete="off"
              placeholder="yourname"
              disabled={busy}
              onChange={(e) => {
                setLabel(e.target.value);
                if (status.phase === 'failed' || status.phase === 'done') reset();
              }}
            />
            <span className="suffix">.dot</span>
          </div>
        </label>

        {/* What the chain says, before anything is signed. */}
        <p className="lookup" aria-live="polite">
          {looking ? 'checking the chain…' : null}
          {!looking && lookupError ? `could not read the chain: ${lookupError}` : null}
          {!looking && !lookupError && state && !state.registered ? (
            <span className="no">
              not registered in DotNS — register the name first, then it can be listed here
            </span>
          ) : null}
          {!looking && !lookupError && state?.registered ? (
            <>
              <span className="yes">registered</span>
              {state.listed ? ' · already in the directory' : ' · not in the directory yet'}
              {state.records.deployed ? ' · has a site deployed' : null}
              {state.owner ? ` · owner ${short(state.owner)}` : null}
              {canWrite ? (mine ? ' · that is you' : ' · not your account') : null}
            </>
          ) : null}
        </p>

        {/* The description fields only appear for the owner, because only the
            owner can write them — showing them to everyone would be an invitation
            to a refusal. */}
        {state?.registered && mine ? (
          <>
            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                value={form.displayName}
                placeholder={state.label}
                disabled={busy}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label className="field">
              <span>What it is</span>
              <textarea
                rows={2}
                value={form.description}
                placeholder="One sentence. This is the line the directory shows."
                disabled={busy}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Category</span>
              <input
                type="text"
                list="known-categories"
                value={form.category}
                spellCheck={false}
                placeholder="social, tools, games…"
                disabled={busy}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
              <datalist id="known-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </>
        ) : null}

        {canWrite ? (
          <button
            type="submit"
            className="clear"
            disabled={busy || !state?.registered || (state.listed && !mine)}
          >
            {busy ? 'working…' : state?.listed ? 'Update' : 'Add to the directory'}
          </button>
        ) : null}
      </form>

      <p className={`register-status ${status.phase}`} aria-live="polite">
        {status.phase === 'unavailable' ? status.why : null}
        {status.phase === 'ready' ? `signing as ${short(status.address)}` : null}
        {status.phase === 'working' ? `${status.step}…` : null}
        {status.phase === 'done'
          ? `${status.label}.dot — ${status.did.join(', ') || 'nothing to change'}`
          : null}
        {status.phase === 'failed' ? status.message : null}
      </p>
    </section>
  );
}
