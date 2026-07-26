import { useCallback, useEffect, useState } from 'react';
import { useProductSDK } from '@parity/product-sdk/react';
import type { SignerAccount, SignerManager } from '@parity/product-sdk-signer';
import type { HexString } from 'polkadot-api';
import { getSignerManager, useSignerState } from './lib/signer';
import { Rabbit, useRabbitSequence } from './Rabbit';
import { createMockDriver } from './lib/mockDriver';
import { createChainDriver } from './lib/chainDriver';
import { CONTRACT_ADDRESS, DEVNET, PUBLIC_HOST, TIER, TITLE_MAX, TITLE_MIN } from './lib/config';
import type { MyState, PetitionRow, PetitionsDriver } from './lib/types';

/* ------------------------------------------------------------------ routing */

type Route = { name: 'list' } | { name: 'detail'; id: number } | { name: 'new' };

function parseRoute(): Route {
  const hash = window.location.hash;
  const detail = hash.match(/^#\/p\/(\d+)$/);
  if (detail) return { name: 'detail', id: Number(detail[1]) };
  if (hash === '#/new') return { name: 'new' };
  return { name: 'list' };
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

/* ---------------------------------------------------------- human language */

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** "today", "yesterday", "5 days ago" — dates are for machines. */
function timeAgo(unixSeconds: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

const ADJECTIVES = [
  'Quiet', 'Bright', 'Steady', 'Gentle', 'Bold', 'Calm', 'Swift', 'Honest',
  'Patient', 'Clear', 'Warm', 'Brave', 'Plain', 'Keen', 'Early', 'Lively',
  'Frank', 'Mild', 'Sharp', 'Sound', 'True', 'Fair', 'Firm', 'Free',
];
const NOUNS = [
  'Heron', 'Lantern', 'Harbor', 'Meadow', 'Signal', 'Anchor', 'Beacon', 'Cedar',
  'Compass', 'Falcon', 'Garden', 'Bridge', 'Willow', 'Summit', 'Prairie', 'Harvest',
  'Quarry', 'Sparrow', 'Terrace', 'Mill', 'Orchard', 'Haven', 'Fjord', 'Grove',
];

/**
 * A readable name derived from the anonymous signature id. Raw hex means
 * nothing to a person; "Quiet Heron" is memorable, still reveals nothing, and
 * is stable — the same person is the same name everywhere in this app.
 */
function friendlyName(alias: string): string {
  let h = 0;
  for (let i = 0; i < alias.length; i += 1) h = (h * 31 + alias.charCodeAt(i)) >>> 0;
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 5) % NOUNS.length]}`;
}

/** Signature milestones — gives a count something to walk toward. */
function nextMilestone(count: number): number {
  for (const m of [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
    if (count < m) return m;
  }
  return Math.ceil((count + 1) / 10000) * 10000;
}

function publicUrl(id: number): string {
  return `${PUBLIC_HOST}/#/p/${id}`;
}

/** Everything a recipient needs to check the numbers without trusting us. */
function evidenceOf(row: PetitionRow): string {
  return [
    `OPENPETITION #${row.id}: "${row.title}"`,
    ``,
    `Signatures from verified real people: ${row.fullCount}`,
    `Signatures from unverified accounts:  ${row.liteCount}`,
    `Each person can sign only once. This is enforced by the network itself,`,
    `not by this website. Signing again from a new wallet, a new device, or a`,
    `reinstalled app is rejected.`,
    ``,
    `Read it here:  ${publicUrl(row.id)}`,
    `Check it yourself: contract ${CONTRACT_ADDRESS}`,
    `on Polkadot devnet Asset Hub (chain id ${DEVNET.assetHubEvmChainId}),`,
    `method get(${row.id}), via any RPC, for example ${DEVNET.ethRpc}`,
  ].join('\n');
}

function mailtoOf(row: PetitionRow): string {
  const subject = `Petition: ${row.title}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(evidenceOf(row))}`;
}

/* ------------------------------------------------------------------- pieces */

function TierBadge({ me }: { me: MyState | null }) {
  if (!me) return null;
  if (me.tier >= TIER.full) {
    return <span className="pill is-green">You're verified{me.username ? ` · ${me.username}` : ''}</span>;
  }
  if (me.tier === TIER.lite) {
    return <span className="pill is-gray">Partly verified{me.username ? ` · ${me.username}` : ''}</span>;
  }
  return <span className="pill is-dim">Not verified yet</span>;
}

function Counts({ row }: { row: PetitionRow }) {
  return (
    <span className="counts">
      <span className="pill is-green" title="People who proved they are real and distinct">
        {row.fullCount} verified
      </span>
      {row.liteCount > 0 && (
        <span className="pill is-gray" title="Accounts that have not completed verification">
          {row.liteCount} unverified
        </span>
      )}
    </span>
  );
}

function HowItWorks() {
  return (
    <div className="card how">
      <div className="how-step">
        <span className="how-n">1</span>
        <p>
          <strong>Anyone can read.</strong> Petitions are public. No account, no sign-up.
        </p>
      </div>
      <div className="how-step">
        <span className="how-n">2</span>
        <p>
          <strong>One person, one signature.</strong> Signatures come from verified real
          people. No bots, no duplicates: the network itself makes cheating impossible.
        </p>
      </div>
      <div className="how-step">
        <span className="how-n">3</span>
        <p>
          <strong>The numbers stand on their own.</strong> Send a petition to whoever can
          act on it. They can check the count without trusting this site.
        </p>
      </div>
    </div>
  );
}

/**
 * Shown when someone who isn't verified tries to sign or start a petition.
 *
 * A dApp can't deep-link into the host's identity flow (the host API only
 * navigates to external URLs), so this explains the one-time step clearly and
 * up front instead of a small dead-end line under a disabled button.
 */
function VerifyNotice({
  action = 'sign',
  onTryDemo,
}: {
  action?: 'sign' | 'start';
  onTryDemo?: () => void;
}) {
  // No demo to offer means demo is already running and is itself showing an
  // unverified account. The copy has to change, and the screen still needs a
  // way out — otherwise it is a dead end with no control on it at all.
  const alreadyDemo = !onTryDemo;
  return (
    <div className="verify">
      <div className="verify-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M12 2.5l7.5 3v5c0 4.6-3.1 8.4-7.5 9.5-4.4-1.1-7.5-4.9-7.5-9.5v-5l7.5-3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M8.5 12l2.3 2.3L15.5 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <h3 className="verify-title">
          {alreadyDemo ? 'This account is not verified' : 'Try it now'}
        </h3>
        <p className="verify-body">
          {alreadyDemo ? (
            <>
              You can read every petition, but {action === 'start' ? 'starting' : 'signing'} one
              needs <em>proof of personhood</em> — the network's guarantee that every signer is
              a distinct real human. This is exactly what an unverified account sees.
            </>
          ) : (
            <>
              The live register only accepts signatures backed by <em>proof of personhood</em> —
              the network's guarantee that every signer is a distinct real human. On this test
              network that's still limited to a small set of accounts.
            </>
          )}
        </p>
        <p className="verify-how">
          {alreadyDemo
            ? 'Reading is open to everyone, always. Verification is granted by the network, not requested from this app.'
            : 'Demo mode gives you the complete experience right here: start petitions, sign them, share them. Nothing touches the chain, so nothing is permanent.'}
        </p>
        {onTryDemo ? (
          <button
            type="button"
            className="btn is-primary"
            onClick={onTryDemo}
            style={{ marginTop: '0.7rem' }}
          >
            Switch to demo mode
          </button>
        ) : (
          <a className="btn" href="#/" style={{ marginTop: '0.7rem', display: 'inline-flex' }}>
            Back to petitions
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ screens */

interface ScreenProps {
  driver: PetitionsDriver;
  rows: PetitionRow[];
  me: MyState | null;
  refresh: () => void;
  /** Present when the visitor can switch to demo mode (live register only). */
  onTryDemo?: () => void;
}

function ListScreen({ rows, me }: ScreenProps) {
  return (
    <>
      <HowItWorks />

      <div className="toolbar">
        <h2 className="section-title">Petitions</h2>
        <a className="btn is-primary" href="#/new">
          Start a petition
        </a>
      </div>

      <div className="card">
        {rows.length === 0 && (
          <p className="empty">No petitions yet. The first one is yours to start.</p>
        )}
        <ol className="plist">
          {rows.map((row) => {
            const mine = me !== null && row.author === me.alias;
            return (
              <li key={row.id}>
                <a href={`#/p/${row.id}`}>
                  <div className="plist-main">
                    <span className="plist-title">{row.title}</span>
                    <span className="plist-meta">
                      started {timeAgo(row.createdAt)} by {friendlyName(row.author)}
                      {mine ? ' (you)' : ''}
                    </span>
                  </div>
                  <Counts row={row} />
                </a>
              </li>
            );
          })}
        </ol>
      </div>

      {me && me.tier < TIER.full && (
        <p className="hint">
          {me.tier === TIER.none
            ? 'Reading is open to everyone. Signing and starting petitions on the live register need proof of personhood, which this test network grants to a limited set of accounts. You can try the full flow in demo mode — open this page in an ordinary web browser.'
            : 'Your signatures currently count as unverified. They become verified once your account reaches full proof of personhood.'}
        </p>
      )}
    </>
  );
}

function DetailScreen({ id, driver, rows, me, refresh, onTryDemo }: ScreenProps & { id: number }) {
  const row = rows.find((p) => p.id === id) ?? null;
  const [signedAt, setSignedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'proof' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSignedAt(null);
    void driver
      .signedTier(id)
      .then((tier) => {
        if (!cancelled) setSignedAt(tier);
      })
      .catch(() => {
        if (!cancelled) setSignedAt(0);
      });
    return () => {
      cancelled = true;
    };
  }, [driver, id]);

  if (!row) {
    return (
      <div className="card pad">
        <p className="empty">
          This petition doesn't exist. <a href="#/">Back to all petitions.</a>
        </p>
      </div>
    );
  }

  const alreadySigned = (signedAt ?? 0) > 0;
  const canSign = me !== null && me.tier >= TIER.lite && !alreadySigned && !busy;
  const milestone = nextMilestone(row.fullCount);
  const progress = Math.max(3, Math.min(100, Math.round((row.fullCount / milestone) * 100)));

  const doSign = () => {
    if (!canSign) return;
    setBusy(true);
    setError(null);
    void driver
      .sign(id)
      .then(() => {
        setSignedAt(me ? me.tier : 1);
        refresh();
      })
      .catch((err) => setError(message(err)))
      .finally(() => setBusy(false));
  };

  const copy = (what: 'link' | 'proof') => {
    const text = what === 'link' ? publicUrl(row.id) : evidenceOf(row);
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => setError('Could not copy — select the text below and copy it by hand.'));
  };

  return (
    <article>
      <div className="card pad">
        <p className="detail-meta">
          Started {timeAgo(row.createdAt)} by {friendlyName(row.author)}
          {me && row.author === me.alias ? ' (you)' : ''}
        </p>
        <h2 className="detail-title">{row.title}</h2>

        <div className="progress-wrap">
          <p className="progress-line">
            <strong className="is-green-text">{row.fullCount}</strong>{' '}
            {row.fullCount === 1 ? 'verified person has' : 'verified people have'} signed
            {row.liteCount > 0 && (
              <span className="progress-sub"> · plus {row.liteCount} unverified</span>
            )}
          </p>
          <div className="progress" role="img" aria-label={`${row.fullCount} of ${milestone}`}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="progress-goal">next goal: {milestone}</p>
        </div>

        {alreadySigned ? (
          <div className="signedbox">
            <svg className="signedbox-check" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="11" fill="#4caf50" />
              <path
                d="M6.5 11.5l3 3L15.5 8"
                stroke="#fff"
                strokeWidth="2.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <strong>You signed this petition.</strong>
              <p>
                {signedAt === TIER.full
                  ? 'Your signature counts as a verified person.'
                  : 'Your signature is marked unverified. It becomes verified once your account reaches full proof of personhood.'}
              </p>
            </div>
          </div>
        ) : me && me.tier === TIER.none ? (
          <VerifyNotice action="sign" onTryDemo={onTryDemo} />
        ) : (
          <div className="signarea">
            <button type="button" className="btn is-primary is-big" onClick={doSign} disabled={!canSign}>
              {busy ? 'Adding your signature…' : 'Sign this petition'}
            </button>
            <p className="hint">
              Signing does not reveal who you are, only that you are a real, distinct person.
              It cannot be undone.
            </p>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </div>

      <div className="card pad">
        <h3 className="section-title">Make it count</h3>
        <p className="hint">
          A petition works when it reaches someone who can act on it. Whoever receives it
          can check the numbers on their own. No account needed, no trust in this site.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => copy('link')}>
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
          <a className="btn" href={mailtoOf(row)}>
            Send by email
          </a>
        </div>
        <details className="proof">
          <summary>Proof anyone can check</summary>
          <div className="actions">
            <button type="button" className="btn" onClick={() => copy('proof')}>
              {copied === 'proof' ? 'Copied' : 'Copy proof'}
            </button>
          </div>
          <pre className="evidence">{evidenceOf(row)}</pre>
        </details>
      </div>

      <p className="backlink">
        <a href="#/">← All petitions</a>
      </p>
    </article>
  );
}

function NewScreen({ driver, me, refresh, onTryDemo }: ScreenProps) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = [...title].length;
  const bytes = new TextEncoder().encode(title).length;
  const valid = bytes >= TITLE_MIN && bytes <= TITLE_MAX;
  const allowed = me !== null && me.tier >= TIER.lite;

  const submit = () => {
    if (!valid || !allowed || busy) return;
    setBusy(true);
    setError(null);
    void driver
      .create(title.trim())
      .then((id) => {
        refresh();
        window.location.hash = `#/p/${id}`;
      })
      .catch((err) => {
        setError(message(err));
        setBusy(false);
      });
  };

  // Not allowed to write yet: explain up front instead of a dead-end form.
  if (me && me.tier < TIER.lite) {
    return (
      <div className="card pad">
        <h2 className="detail-title">Start a petition</h2>
        <VerifyNotice action="start" onTryDemo={onTryDemo} />
        <p className="backlink" style={{ marginTop: '1rem' }}>
          <a href="#/">← All petitions</a>
        </p>
      </div>
    );
  }

  return (
    <div className="card pad">
      <h2 className="detail-title">Start a petition</h2>

      <label className="field">
        <span>What should change? Say it in one clear sentence.</span>
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          rows={3}
          maxLength={TITLE_MAX}
          placeholder="Example: Our town should keep the library open on weekends."
          autoFocus
        />
        <span className="field-count">{length} / {TITLE_MAX}</span>
      </label>

      <p className="hint">
        Petitions are permanent: nobody can edit or delete them, not even you. Each person
        can start up to five, ever. Make it count.
      </p>

      <div className="actions">
        <button
          type="button"
          className="btn is-primary"
          onClick={submit}
          disabled={!valid || !allowed || busy}
        >
          {busy ? 'Publishing…' : 'Publish petition'}
        </button>
        <a className="btn" href="#/">
          Cancel
        </a>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------- shell */

function Shell({ driver, onTryDemo }: { driver: PetitionsDriver; onTryDemo?: () => void }) {
  const route = useRoute();
  const [rows, setRows] = useState<PetitionRow[]>([]);
  const [me, setMe] = useState<MyState | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string>('Opening the register');
  const [rabbit, setRabbit] = useState(false);
  useRabbitSequence(useCallback(() => setRabbit(true), []));

  driver.onStep = setStep;

  const refresh = useCallback(() => {
    void driver
      .list()
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
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#1E2134" />
              <path
                d="M7 21c3-8 6-11 7-9.5 1 1.5-3 8 0 8.5 2.5.5 4-6 6-6"
                stroke="#fff"
                strokeWidth="2.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="24" cy="21" r="2.6" fill="#E6007A" />
            </svg>
            OpenPetition
          </a>
          <TierBadge me={me} />
        </div>
      </header>

      <main className="container">
        <p className="strapline">
          Petitions signed by real people. One signature per person, guaranteed.
        </p>

        {driver.mocked && (
          <p className="banner">
            You're in demo mode — start and sign petitions freely to try it out; nothing
            here touches a chain. The live register runs inside the Polkadot app and is
            open to accounts with proof of personhood.
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
              Something went wrong loading the register.{' '}
              <button type="button" className="linklike" onClick={refresh}>
                Try again
              </button>
            </p>
            <p className="hint">{error}</p>
          </div>
        )}

        {phase === 'ready' && route.name === 'list' && (
          <ListScreen driver={driver} rows={rows} me={me} refresh={refresh} onTryDemo={onTryDemo} />
        )}
        {phase === 'ready' && route.name === 'detail' && (
          <DetailScreen
            driver={driver}
            rows={rows}
            me={me}
            refresh={refresh}
            onTryDemo={onTryDemo}
            id={route.id}
          />
        )}
        {phase === 'ready' && route.name === 'new' && (
          <NewScreen driver={driver} rows={rows} me={me} refresh={refresh} onTryDemo={onTryDemo} />
        )}
      </main>

      <footer className="footer">
        <p>Nothing here can be edited or deleted, not even by the people who built it.</p>
        <p className="footer-tech">
          Recorded on Polkadot devnet · contract <span>{CONTRACT_ADDRESS}</span> · test
          network, tokens carry no value
        </p>
      </footer>

      {rabbit && <Rabbit onDone={() => setRabbit(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------- mounts */

export function MockApp() {
  const [driver] = useState<PetitionsDriver>(() => createMockDriver(null));
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
  const [driver, setDriver] = useState<PetitionsDriver | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Anyone can fall back to the full demo experience without leaving the app.
  const [demo, setDemo] = useState<PetitionsDriver | null>(null);
  const tryDemo = useCallback(() => {
    setDemo(createMockDriver(account.name));
    window.location.hash = '#/';
  }, [account.name]);

  useEffect(() => {
    let cancelled = false;
    if (demo) return;
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
  }, [app, account.address, account.h160Address, account.name, manager, demo]);

  // Demo takes over as soon as it's chosen, even if the chain path failed.
  if (demo) return <Shell driver={demo} />;

  if (error) {
    return (
      <div className="page">
        <main className="container">
          <div className="card pad">
            <p className="error">Could not reach the network: {error}</p>
            <div className="actions">
              <button type="button" className="btn is-primary" onClick={tryDemo}>
                Try demo mode instead
              </button>
            </div>
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
            <p className="empty">Opening the register…</p>
          </div>
        </main>
      </div>
    );
  }
  return <Shell driver={driver} onTryDemo={tryDemo} />;
}
