import { useCallback, useEffect, useState } from 'react';
import { useProductSDK } from '@parity/product-sdk/react';
import type { SignerAccount, SignerManager } from '@parity/product-sdk-signer';
import type { HexString } from 'polkadot-api';
import { getSignerManager, useSignerState } from './lib/signer';
import { createMockDriver } from './lib/mockDriver';
import { createChainDriver } from './lib/chainDriver';
import { CONTRACT_ADDRESS, PUBLIC_HOST, TERMS_MAX, TERMS_MIN, TIER } from './lib/config';
import { friendlyName, message, timeAgo } from './lib/human';
import type { AgreementRow, HandshakeDriver, KeptWord, MyState } from './lib/types';

/* ------------------------------------------------------------------ routing */

type Route = { name: 'mine' } | { name: 'detail'; id: number } | { name: 'new' };

function parseRoute(): Route {
  const hash = window.location.hash;
  const detail = hash.match(/^#\/a\/(\d+)$/);
  if (detail) return { name: 'detail', id: Number(detail[1]) };
  if (hash === '#/new') return { name: 'new' };
  return { name: 'mine' };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function publicUrl(id: number): string {
  return `${PUBLIC_HOST}/#/a/${id}`;
}

/* ------------------------------------------------------------------- pieces */

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1E2134" />
      <circle cx="13" cy="16" r="7" stroke="#fff" strokeWidth="2.2" fill="none" />
      <circle cx="20" cy="16" r="7" stroke="#fff" strokeWidth="2.2" fill="none" />
      <circle cx="16.5" cy="16" r="2.4" fill="#E6007A" />
    </svg>
  );
}

function StatePill({ state }: { state: AgreementRow['state'] }) {
  const map: Record<AgreementRow['state'], { label: string; cls: string }> = {
    proposed: { label: 'Waiting for the other person', cls: 'is-gray' },
    accepted: { label: 'Ready to seal', cls: 'is-blue' },
    sealed: { label: 'In force', cls: 'is-blue' },
    completed: { label: 'Completed', cls: 'is-green' },
    withdrawn: { label: 'Withdrawn', cls: 'is-dim' },
  };
  const { label, cls } = map[state];
  return <span className={`pill ${cls}`}>{label}</span>;
}

function PersonLine({ alias, tier, you }: { alias: string; tier: number; you: boolean }) {
  return (
    <span className="person">
      <strong>{you ? 'You' : friendlyName(alias)}</strong>
      {tier >= TIER.full ? (
        <span className="pill is-green">verified</span>
      ) : (
        <span className="pill is-gray">unverified</span>
      )}
    </span>
  );
}

function KeptWordCard({ title, record }: { title: string; record: KeptWord }) {
  return (
    <div className="keptword">
      <span className="keptword-title">{title}</span>
      <span className="keptword-nums">
        <strong>{record.completed}</strong> kept · <strong>{record.sealed}</strong> made
      </span>
      {record.sealed > 0 && record.sealed === record.completed && (
        <span className="pill is-green">every promise kept</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ screens */

interface ScreenProps {
  driver: HandshakeDriver;
  rows: AgreementRow[];
  me: MyState | null;
  refresh: () => void;
}

function MineScreen({ rows, me }: ScreenProps) {
  return (
    <>
      {me && <KeptWordCard title="Your word" record={me.record} />}

      <div className="toolbar">
        <h2 className="section-title">Your agreements</h2>
        <a className="btn is-primary" href="#/new">
          New agreement
        </a>
      </div>

      <div className="card">
        {rows.length === 0 && (
          <p className="empty">
            Nothing yet. Write your first agreement and send the link to the other person.
          </p>
        )}
        <ol className="plist">
          {rows.map((row) => (
            <li key={row.id}>
              <a href={`#/a/${row.id}`}>
                <div className="plist-main">
                  <span className="plist-title">{row.terms}</span>
                  <span className="plist-meta">
                    {me && row.proposer === me.alias
                      ? row.acceptor
                        ? `with ${friendlyName(row.acceptor)}`
                        : 'proposed by you'
                      : `from ${friendlyName(row.proposer)}`}{' '}
                    · {timeAgo(row.createdAt)}
                  </span>
                </div>
                <StatePill state={row.state} />
              </a>
            </li>
          ))}
        </ol>
      </div>

      <p className="hint">
        An agreement here is written once, accepted by the other person, and sealed by you.
        After that neither of you can change or erase it — and every completed agreement
        builds your record.
      </p>
    </>
  );
}

function DetailScreen({ id, driver, me, refresh }: ScreenProps & { id: number }) {
  const [row, setRow] = useState<AgreementRow | null>(null);
  const [otherRecord, setOtherRecord] = useState<KeptWord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    void driver
      .getOne(id)
      .then((next) => {
        setRow(next);
        const other =
          me && next.proposer === me.alias ? next.acceptor : next.proposer;
        if (other) {
          void driver.recordOf(other).then(setOtherRecord).catch(() => setOtherRecord(null));
        }
      })
      .catch((err) => setLoadError(message(err)));
  }, [driver, id, me]);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <div className="card pad">
        <p className="error">Could not load this agreement: {loadError}</p>
        <p className="backlink">
          <a href="#/">← Your agreements</a>
        </p>
      </div>
    );
  }
  if (!row) {
    return (
      <div className="card pad">
        <p className="empty">Opening the agreement…</p>
      </div>
    );
  }

  const isProposer = me !== null && row.proposer === me.alias;
  const isAcceptor = me !== null && row.acceptor !== null && row.acceptor === me.alias;
  const isParty = isProposer || isAcceptor;
  const canAct = me !== null && me.tier >= TIER.lite && !busy;

  const act = (fn: (id: number) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void fn(id)
      .then(() => {
        load();
        refresh();
      })
      .catch((err) => setError(message(err)))
      .finally(() => setBusy(false));
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(publicUrl(row.id)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const myDone = isProposer ? row.proposerDone : row.acceptorDone;
  const theirDone = isProposer ? row.acceptorDone : row.proposerDone;

  return (
    <article>
      <div className="card pad">
        <p className="detail-meta">
          Agreement #{row.id} · started {timeAgo(row.createdAt)} · <StatePill state={row.state} />
        </p>

        <blockquote className="terms">{row.terms}</blockquote>

        <div className="parties">
          <PersonLine alias={row.proposer} tier={row.proposerTier} you={isProposer} />
          <span className="parties-and">&amp;</span>
          {row.acceptor ? (
            <PersonLine alias={row.acceptor} tier={row.acceptorTier} you={isAcceptor} />
          ) : (
            <span className="person is-empty">waiting for the other person</span>
          )}
        </div>

        {otherRecord && row.acceptor && (
          <KeptWordCard
            title={`${friendlyName(isProposer ? row.acceptor : row.proposer)}'s word`}
            record={otherRecord}
          />
        )}

        {/* ------------------------------------------------ actions by state */}

        {row.state === 'proposed' && isProposer && (
          <div className="actions-block">
            <p className="hint">
              Now send this to the other person. When they accept, you'll see who they are
              and seal it.
            </p>
            <div className="actions">
              <button type="button" className="btn is-primary" onClick={copyLink}>
                {copied ? 'Copied ✓' : 'Copy link to send'}
              </button>
              <button type="button" className="btn" onClick={() => act(driver.withdraw)} disabled={!canAct}>
                Withdraw
              </button>
              {driver.mocked && (
                <button type="button" className="btn" onClick={() => act(driver.accept)} disabled={!canAct}>
                  Demo: the other person accepts
                </button>
              )}
            </div>
          </div>
        )}

        {row.state === 'proposed' && !isProposer && (
          <div className="actions-block">
            <p className="hint">
              {friendlyName(row.proposer)} proposes this agreement. Accepting shows them who
              you are; nothing is binding until they seal it.
            </p>
            <button
              type="button"
              className="btn is-primary is-big"
              onClick={() => act(driver.accept)}
              disabled={!canAct}
            >
              {busy ? 'Accepting…' : 'Accept this agreement'}
            </button>
            {me && me.tier === TIER.none && (
              <p className="hint">To accept, verify that you are a real person in the Polkadot app first.</p>
            )}
          </div>
        )}

        {row.state === 'accepted' && isProposer && row.acceptor && (
          <div className="actions-block">
            <p className="hint">
              <strong>{friendlyName(row.acceptor)}</strong> accepted. Sealing makes this
              permanent for both of you — check their record above first.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn is-primary is-big"
                onClick={() => act(driver.seal)}
                disabled={!canAct}
              >
                {busy ? 'Sealing…' : 'Seal the agreement'}
              </button>
              <button type="button" className="btn" onClick={() => act(driver.withdraw)} disabled={!canAct}>
                Withdraw
              </button>
            </div>
          </div>
        )}

        {row.state === 'accepted' && isAcceptor && (
          <p className="hint">
            You accepted. Waiting for {friendlyName(row.proposer)} to seal — nothing is
            binding yet.
          </p>
        )}

        {row.state === 'sealed' && isParty && (
          <div className="actions-block">
            {myDone ? (
              <p className="hint">
                You marked your side as done{theirDone ? '' : ' — waiting for the other person to confirm'}.
              </p>
            ) : (
              <button
                type="button"
                className="btn is-primary is-big"
                onClick={() => act(driver.markDone)}
                disabled={!canAct}
              >
                {busy ? 'Recording…' : 'Mark my side as done'}
              </button>
            )}
            <p className="hint">
              When both of you mark it done, the agreement is completed and both records
              grow.
            </p>
          </div>
        )}

        {row.state === 'completed' && (
          <div className="signedbox">
            <span className="signedbox-check">✓</span>
            <div>
              <strong>Completed.</strong>
              <p>Both sides kept their word — and both records now show it.</p>
            </div>
          </div>
        )}

        {row.state === 'withdrawn' && (
          <p className="hint">Withdrawn before sealing — this never became binding.</p>
        )}

        {error && <p className="error">{error}</p>}
      </div>

      <p className="backlink">
        <a href="#/">← Your agreements</a>
      </p>
    </article>
  );
}

function NewScreen({ driver, me, refresh }: ScreenProps) {
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = [...terms].length;
  const bytes = new TextEncoder().encode(terms).length;
  const valid = bytes >= TERMS_MIN && bytes <= TERMS_MAX;
  const allowed = me !== null && me.tier >= TIER.lite;

  const submit = () => {
    if (!valid || !allowed || busy) return;
    setBusy(true);
    setError(null);
    void driver
      .propose(terms.trim())
      .then((id) => {
        refresh();
        window.location.hash = `#/a/${id}`;
      })
      .catch((err) => {
        setError(message(err));
        setBusy(false);
      });
  };

  return (
    <div className="card pad">
      <h2 className="detail-title">New agreement</h2>

      <label className="field">
        <span>Write the agreement the way you'd say it out loud.</span>
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={5}
          maxLength={TERMS_MAX}
          placeholder={'Example: I’m lending you 200 in cash today. You pay me back by the end of March. No interest, no drama.'}
          autoFocus
        />
        <span className="field-count">{length} / {TERMS_MAX}</span>
      </label>

      <p className="hint is-warning">
        This is a public test network: the text will be readable by anyone. Use first names
        or nicknames, never addresses, phone numbers, or documents.
      </p>

      <div className="actions">
        <button type="button" className="btn is-primary" onClick={submit} disabled={!valid || !allowed || busy}>
          {busy ? 'Creating…' : 'Create and get the link'}
        </button>
        <a className="btn" href="#/">
          Cancel
        </a>
      </div>

      {!allowed && me && (
        <p className="hint">To make an agreement, verify that you are a real person in the Polkadot app first.</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------- shell */

function Shell({ driver }: { driver: HandshakeDriver }) {
  const route = useRoute();
  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [me, setMe] = useState<MyState | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string>('Opening');

  driver.onStep = setStep;

  const refresh = useCallback(() => {
    void driver
      .myAgreements()
      .then(({ rows: nextRows, me: nextMe }) => {
        setRows(nextRows);
        setMe(nextMe);
        setPhase('ready');
      })
      .catch((err) => {
        setError(message(err));
        setPhase('error');
      });
  }, [driver]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <BrandMark />
            Handshake
          </a>
          {me &&
            (me.tier >= TIER.full ? (
              <span className="pill is-green">✓ You're verified{me.username ? ` · ${me.username}` : ''}</span>
            ) : me.tier === TIER.lite ? (
              <span className="pill is-gray">Partly verified</span>
            ) : (
              <span className="pill is-dim">Not verified yet</span>
            ))}
        </div>
      </header>

      <main className="container">
        <p className="strapline">
          Plain agreements between real people — written once, sealed by both, kept forever.
        </p>

        {driver.mocked && (
          <p className="banner">
            You're looking at a demo. Everything works — you play both people — but nothing
            leaves this device. Open it in the Polkadot app for real agreements.
          </p>
        )}

        {phase === 'loading' && (
          <div className="card pad">
            <p className="empty">{step}…</p>
          </div>
        )}
        {phase === 'error' && (
          <div className="card pad">
            <p className="error">
              Something went wrong.{' '}
              <button type="button" className="linklike" onClick={refresh}>
                Try again
              </button>
            </p>
            <p className="hint">{error}</p>
          </div>
        )}

        {phase === 'ready' && route.name === 'mine' && (
          <MineScreen driver={driver} rows={rows} me={me} refresh={refresh} />
        )}
        {phase === 'ready' && route.name === 'detail' && (
          <DetailScreen driver={driver} rows={rows} me={me} refresh={refresh} id={route.id} />
        )}
        {phase === 'ready' && route.name === 'new' && (
          <NewScreen driver={driver} rows={rows} me={me} refresh={refresh} />
        )}
      </main>

      <footer className="footer">
        <p>Sealed agreements cannot be edited or deleted — not even by the people who built this.</p>
        <p className="footer-tech">
          Recorded on Polkadot devnet · contract <span>{CONTRACT_ADDRESS}</span> · test
          network, tokens carry no value
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------- mounts */

export function MockApp() {
  const [driver] = useState<HandshakeDriver>(() => createMockDriver(null));
  return <Shell driver={driver} />;
}

export function HostApp() {
  const manager = getSignerManager();
  const signer = useSignerState();

  useEffect(() => {
    if (signer.status === 'disconnected') {
      void manager.connect();
    }
  }, [manager, signer.status]);

  const account = signer.selectedAccount;

  if (!account) {
    return (
      <div className="page">
        <main className="container">
          <div className="card pad">
            <p className="empty">
              {signer.error ? `Wallet error: ${signer.error.message}` : 'Connecting…'}
            </p>
          </div>
        </main>
      </div>
    );
  }

  return <Connected account={account} manager={manager} />;
}

function Connected({ account, manager }: { account: SignerAccount; manager: SignerManager }) {
  const app = useProductSDK();
  const [driver, setDriver] = useState<HandshakeDriver | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createChainDriver({
      chain: app.chain,
      account: account.address,
      h160Address: account.h160Address as HexString,
      username: account.name,
      signerManager: manager,
    })
      .then((next) => {
        if (!cancelled) setDriver(next);
      })
      .catch((err) => {
        if (!cancelled) setError(message(err));
      });
    return () => {
      cancelled = true;
    };
  }, [app, account.address, account.h160Address, account.name, manager]);

  if (error) {
    return (
      <div className="page">
        <main className="container">
          <div className="card pad">
            <p className="error">Could not reach the network: {error}</p>
          </div>
        </main>
      </div>
    );
  }
  if (!driver) {
    return (
      <div className="page">
        <main className="container">
          <div className="card pad">
            <p className="empty">Opening your agreements…</p>
          </div>
        </main>
      </div>
    );
  }
  return <Shell driver={driver} />;
}
